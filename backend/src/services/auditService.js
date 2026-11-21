/**
 * AuditService — append-only hash-chain audit log (INC-0318)
 *
 * Hash chain: hash = sha256(prev_hash || canonical_json_of_event)
 * Serialized per ticket via SELECT … FOR UPDATE on the ticket row,
 * so concurrent writes cannot fork the chain.
 *
 * Usage: always call writeAuditEvent INSIDE an existing transaction.
 */
import crypto from 'crypto';

/**
 * Canonicalize event payload for hashing.
 * Keys are sorted so the JSON is deterministic regardless of insertion order.
 */
function canonicalize(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * sha256(input) -> hex string
 */
function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * writeAuditEvent(sequelize, t, params) -> AuditEvent row
 *
 * Must be called inside transaction `t`.
 * Locks the ticket row (SELECT FOR UPDATE) to serialize the hash chain.
 *
 * @param {Sequelize} sequelize
 * @param {Transaction} t - active Sequelize transaction
 * @param {object} params
 *   - ticket_id {number}
 *   - event_type {string}
 *   - actor_type {'agent'|'customer'|'system'}
 *   - actor_id {number|null}
 *   - payload {object}
 */
export async function writeAuditEvent(sequelize, t, { ticket_id, event_type, actor_type, actor_id, payload }) {
  // 1. Lock the ticket row to serialize all audit writes for this ticket
  await sequelize.query(
    'SELECT id FROM tickets WHERE id = ? FOR UPDATE',
    { replacements: [ticket_id], transaction: t }
  );

  // 2. Get the most recent audit event for this ticket
  const [rows] = await sequelize.query(
    'SELECT hash FROM audit_events WHERE ticket_id = ? ORDER BY id DESC LIMIT 1',
    { replacements: [ticket_id], transaction: t }
  );
  const prevHash = rows.length > 0 ? rows[0].hash : null;

  // 3. Build the canonical payload (include ticket_id and event_type for context)
  const eventData = {
    ticket_id,
    event_type,
    actor_type,
    actor_id: actor_id ?? null,
    payload,
  };
  const canonicalJson = canonicalize(eventData);
  const hashInput = (prevHash ?? '') + canonicalJson;
  const hash = sha256(hashInput);

  // 4. Insert (the BEFORE UPDATE/DELETE triggers ensure immutability)
  await sequelize.query(
    `INSERT INTO audit_events (ticket_id, event_type, actor_type, actor_id, payload, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    {
      replacements: [ticket_id, event_type, actor_type, actor_id ?? null, JSON.stringify(payload), prevHash, hash],
      transaction: t,
    }
  );

  return { ticket_id, event_type, actor_type, actor_id, payload, prev_hash: prevHash, hash };
}

/**
 * verifyChain(sequelize, ticketId) -> { valid: bool, brokenAt: id|null, totalEvents: number }
 *
 * Reads all audit events for a ticket in order and validates the hash chain.
 * Any tampering (modified payload/hash) will cause a mismatch.
 */
export async function verifyChain(sequelize, ticketId) {
  const query = ticketId
    ? 'SELECT * FROM audit_events WHERE ticket_id = ? ORDER BY id ASC'
    : 'SELECT * FROM audit_events ORDER BY ticket_id ASC, id ASC';
  const replacements = ticketId ? [ticketId] : [];
  const [events] = await sequelize.query(query, { replacements });

  if (events.length === 0) return { valid: true, brokenAt: null, totalEvents: 0 };

  // Group by ticket_id to verify each chain independently
  const byTicket = {};
  for (const e of events) {
    if (!byTicket[e.ticket_id]) byTicket[e.ticket_id] = [];
    byTicket[e.ticket_id].push(e);
  }

  for (const [tid, evts] of Object.entries(byTicket)) {
    let expectedPrevHash = null;
    for (const e of evts) {
      const eventData = {
        ticket_id: e.ticket_id,
        event_type: e.event_type,
        actor_type: e.actor_type,
        actor_id: e.actor_id ?? null,
        payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
      };
      const canonicalJson = canonicalize(eventData);
      const hashInput = (expectedPrevHash ?? '') + canonicalJson;
      const expectedHash = sha256(hashInput);

      if (e.hash !== expectedHash || e.prev_hash !== expectedPrevHash) {
        return { valid: false, brokenAt: e.id, totalEvents: events.length };
      }
      expectedPrevHash = e.hash;
    }
  }

  return { valid: true, brokenAt: null, totalEvents: events.length };
}
