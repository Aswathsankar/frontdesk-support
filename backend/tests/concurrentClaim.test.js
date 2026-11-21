/**
 * Concurrent claim test (INC-0291).
 * Uses real DB via a test-specific Sequelize connection.
 * Tests that Promise.all with two simultaneous claims → exactly one wins.
 *
 * Requires TEST_DATABASE_URL env var or falls back to DB_* vars for a test DB.
 * Run docker-compose up to make the DB available.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Sequelize } from 'sequelize';
import { claimTicket } from '../src/services/ticketService.js';

// Skip gracefully if no DB configured
const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)('Concurrent claim (INC-0291)', () => {
  let seq;
  let testTicketId;
  let agent1Id, agent2Id;

  beforeAll(async () => {
    seq = new Sequelize(dbUrl, {
      dialect: 'mysql',
      timezone: '+00:00',
      logging: false,
    });
    await seq.query("SET time_zone = '+00:00'");

    // Insert test agents
    const [r1] = await seq.query(
      "INSERT INTO agents (name, email, password_hash) VALUES ('Test Agent 1', 'testagent1@test.local', 'x') ON DUPLICATE KEY UPDATE name=name",
    );
    const [[a1]] = await seq.query("SELECT id FROM agents WHERE email = 'testagent1@test.local'");
    agent1Id = a1.id;

    const [r2] = await seq.query(
      "INSERT INTO agents (name, email, password_hash) VALUES ('Test Agent 2', 'testagent2@test.local', 'x') ON DUPLICATE KEY UPDATE name=name",
    );
    const [[a2]] = await seq.query("SELECT id FROM agents WHERE email = 'testagent2@test.local'");
    agent2Id = a2.id;

    // Insert a fresh unassigned ticket
    const ref = `test-claim-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 23);
    await seq.query(
      `INSERT INTO tickets (customer_ref, customer_email, subject, priority, status, created_at, response_due_at, resolution_due_at)
       VALUES (?, 'claimtest@example.com', 'Claim test ticket', 'medium', 'new', ?, ?, ?)`,
      { replacements: [ref, now, now, now] }
    );
    const [[t]] = await seq.query('SELECT id FROM tickets WHERE customer_ref = ?', { replacements: [ref] });
    testTicketId = t.id;
  });

  afterAll(async () => {
    // Clean up
    if (seq) await seq.close();
  });

  it('Exactly one of two simultaneous claims succeeds (INC-0291)', async () => {
    // Fire both claims at exactly the same moment
    const results = await Promise.allSettled([
      claimTicket(seq, testTicketId, agent1Id, 'Test Agent 1'),
      claimTicket(seq, testTicketId, agent2Id, 'Test Agent 2'),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // The failure should be a 409
    const err = failures[0].reason;
    expect(err.statusCode).toBe(409);
    expect(err.message).toMatch(/already taken by/i);

    // Verify the ticket is now assigned to exactly one agent
    const [[ticket]] = await seq.query('SELECT assignee_id FROM tickets WHERE id = ?', {
      replacements: [testTicketId],
    });
    expect(ticket.assignee_id).not.toBeNull();
  });
});
