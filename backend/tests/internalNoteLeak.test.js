/**
 * Internal note leak test (INC-0304).
 * Creates a ticket with an internal note containing a unique canary string.
 * Asserts the canary NEVER appears in any public API response:
 *   - GET /api/public/tickets/:ref
 *   - GET /api/public/export.csv
 *   - POST /api/public/tickets/:ref/reply (error body)
 *
 * Uses Fastify inject (no real network).
 * Requires a real DB (TEST_DATABASE_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';

const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const shouldSkip = !dbUrl;

const CANARY = `INTERNAL_SECRET_CANARY_${Date.now()}`;

describe.skipIf(shouldSkip)('Internal note must never reach customer (INC-0304)', () => {
  let app;
  let ref;
  let agentToken;
  let ticketId;

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Login as first agent
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'priya@arvo.dev', password: 'Demo@1234' },
    });
    expect(loginRes.statusCode).toBe(200);
    const cookie = loginRes.cookies.find((c) => c.name === 'token');
    agentToken = cookie?.value;

    // Create a ticket as customer
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/public/tickets',
      payload: { customer_email: 'leaktest@example.com', subject: 'Leak test ticket', priority: 'medium' },
    });
    expect(createRes.statusCode).toBe(201);
    ref = JSON.parse(createRes.payload).customer_ref;
    ticketId = JSON.parse(createRes.payload).id;

    // Add a PUBLIC reply (agent)
    await app.inject({
      method: 'POST',
      url: `/api/agent/tickets/${ticketId}/reply`,
      headers: { cookie: `token=${agentToken}` },
      payload: { body: 'Public reply to customer' },
    });

    // Add an INTERNAL note with the canary
    await app.inject({
      method: 'POST',
      url: `/api/agent/tickets/${ticketId}/notes`,
      headers: { cookie: `token=${agentToken}` },
      payload: { body: CANARY },
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('Canary NOT in GET /api/public/tickets/:ref', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/public/tickets/${ref}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain(CANARY);
  });

  it('Canary NOT in GET /api/public/export.csv', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/export.csv',
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain(CANARY);
  });

  it('Canary NOT in reply endpoint response body', async () => {
    // Even in error messages — make a bad request
    const res = await app.inject({
      method: 'POST',
      url: `/api/public/tickets/${ref}/reply`,
      payload: { customer_email: 'leaktest@example.com', body: 'Follow-up' },
    });
    expect(res.payload).not.toContain(CANARY);
  });

  it('Canary IS visible in agent detail (control check)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/agent/tickets/${ticketId}`,
      headers: { cookie: `token=${agentToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain(CANARY); // agent CAN see it
  });
});
