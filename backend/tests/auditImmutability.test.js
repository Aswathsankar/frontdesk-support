/**
 * Audit immutability tests (INC-0318).
 * Tests:
 *   1. UPDATE on audit_events fails (trigger)
 *   2. DELETE on audit_events fails (trigger)
 *   3. Hash chain verifies correctly on a clean chain
 *   4. verifyChain detects a tampered row (simulated by temporarily
 *      dropping the trigger, modifying a row, restoring the trigger)
 *
 * Requires TEST_DATABASE_URL with a user that has SUPER/TRIGGER privilege
 * (Aiven free plan grants this). Falls back to skip.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Sequelize } from 'sequelize';
import { writeAuditEvent, verifyChain } from '../src/services/auditService.js';

const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)('Audit immutability (INC-0318)', () => {
  let seq;
  let testTicketId;

  beforeAll(async () => {
    seq = new Sequelize(dbUrl, { dialect: 'mysql', timezone: '+00:00', logging: false });
    await seq.query("SET time_zone = '+00:00'");

    // Create a minimal test ticket
    const ref = `audit-test-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 23);
    await seq.query(
      `INSERT INTO tickets (customer_ref, customer_email, subject, priority, status, created_at, response_due_at, resolution_due_at)
       VALUES (?, 'auditcheck@example.com', 'Audit test', 'medium', 'new', ?, ?, ?)`,
      { replacements: [ref, now, now, now] }
    );
    const [[t]] = await seq.query('SELECT id FROM tickets WHERE customer_ref = ?', { replacements: [ref] });
    testTicketId = t.id;

    // Write 3 audit events to build a chain
    const tx1 = await seq.transaction();
    await writeAuditEvent(seq, tx1, {
      ticket_id: testTicketId, event_type: 'created', actor_type: 'customer', actor_id: null,
      payload: { subject: 'Audit test', seq: 1 },
    });
    await tx1.commit();

    const tx2 = await seq.transaction();
    await writeAuditEvent(seq, tx2, {
      ticket_id: testTicketId, event_type: 'claimed', actor_type: 'agent', actor_id: 1,
      payload: { agent_name: 'Test Agent', seq: 2 },
    });
    await tx2.commit();

    const tx3 = await seq.transaction();
    await writeAuditEvent(seq, tx3, {
      ticket_id: testTicketId, event_type: 'agent_reply', actor_type: 'agent', actor_id: 1,
      payload: { body_preview: 'Hello', seq: 3 },
    });
    await tx3.commit();
  });

  afterAll(async () => {
    if (seq) await seq.close();
  });

  it('UPDATE on audit_events throws ER_SIGNAL_EXCEPTION', async () => {
    const [[firstEvent]] = await seq.query(
      'SELECT id FROM audit_events WHERE ticket_id = ? LIMIT 1',
      { replacements: [testTicketId] }
    );
    expect(firstEvent).toBeDefined();

    await expect(
      seq.query('UPDATE audit_events SET event_type = ? WHERE id = ?', {
        replacements: ['tampered', firstEvent.id],
      })
    ).rejects.toThrow();
  });

  it('DELETE on audit_events throws ER_SIGNAL_EXCEPTION', async () => {
    const [[firstEvent]] = await seq.query(
      'SELECT id FROM audit_events WHERE ticket_id = ? LIMIT 1',
      { replacements: [testTicketId] }
    );
    await expect(
      seq.query('DELETE FROM audit_events WHERE id = ?', {
        replacements: [firstEvent.id],
      })
    ).rejects.toThrow();
  });

  it('verifyChain returns valid=true for untampered chain', async () => {
    const result = await verifyChain(seq, testTicketId);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
    expect(result.totalEvents).toBeGreaterThanOrEqual(3);
  });

  it('verifyChain detects tampered row (drop trigger, tamper, restore)', async () => {
    // Drop the update trigger temporarily
    await seq.query('DROP TRIGGER IF EXISTS audit_events_no_update');

    // Tamper: modify the payload of the first event
    const [[firstEvent]] = await seq.query(
      'SELECT id FROM audit_events WHERE ticket_id = ? ORDER BY id ASC LIMIT 1',
      { replacements: [testTicketId] }
    );
    await seq.query(
      `UPDATE audit_events SET payload = JSON_SET(payload, '$.tampered', true) WHERE id = ?`,
      { replacements: [firstEvent.id] }
    );

    // Restore the trigger
    await seq.query(`
      CREATE TRIGGER audit_events_no_update
      BEFORE UPDATE ON audit_events
      FOR EACH ROW
      SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'audit_events rows are immutable: UPDATE forbidden'
    `);

    // Now verify — should detect the break
    const result = await verifyChain(seq, testTicketId);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(firstEvent.id);
  });
});
