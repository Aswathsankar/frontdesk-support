/**
 * TicketService — core ticket operations.
 * All state-changing operations use transactions and write audit events
 * in the same transaction (INC-0318).
 */
import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { writeAuditEvent } from './auditService.js';
import {
  computeDeadlines,
  getHolidays,
  recomputeDeadlinesAfterPriorityChange,
  canReopen,
  shouldAutoClose,
  computePausedMinutes,
} from './slaService.js';

function nowUtc() {
  return DateTime.utc().toISO();
}

/**
 * createTicket — creates a ticket from a customer request.
 */
export async function createTicket(sequelize, { customer_email, subject, priority = 'medium', related_ticket_id = null }) {
  const holidays = await getHolidays(sequelize);
  const created_at = nowUtc();
  const { response_due_at, resolution_due_at } = computeDeadlines(created_at, priority, holidays);
  const customer_ref = uuidv4();

  const t = await sequelize.transaction();
  try {
    const [result] = await sequelize.query(
      `INSERT INTO tickets (customer_ref, customer_email, subject, priority, status, created_at, response_due_at, resolution_due_at, related_ticket_id)
       VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
      {
        replacements: [customer_ref, customer_email, subject, priority, created_at, response_due_at, resolution_due_at, related_ticket_id ?? null],
        transaction: t,
      }
    );
    const ticket_id = result.insertId;

    await writeAuditEvent(sequelize, t, {
      ticket_id,
      event_type: 'created',
      actor_type: 'customer',
      actor_id: null,
      payload: { customer_email, subject, priority, customer_ref, response_due_at, resolution_due_at },
    });

    // First message: initial description = subject (customer can add body in reply)
    await sequelize.query(
      `INSERT INTO messages (ticket_id, author_type, author_name, body, visibility, created_at)
       VALUES (?, 'customer', ?, ?, 'public', ?)`,
      { replacements: [ticket_id, customer_email, subject, created_at], transaction: t }
    );

    await t.commit();
    return { id: ticket_id, customer_ref };
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

/**
 * claimTicket — atomic claim (INC-0291).
 * Uses raw SQL: UPDATE WHERE assignee_id IS NULL; check affectedRows.
 * Returns { success, ticket } or throws HTTP 409.
 */
export async function claimTicket(sequelize, ticketId, agentId, agentName) {
  const t = await sequelize.transaction();
  try {
    // Atomic claim: only succeeds if assignee_id is NULL
    const [, meta] = await sequelize.query(
      `UPDATE tickets SET assignee_id = ?, status = 'open', version = version + 1
       WHERE id = ? AND assignee_id IS NULL`,
      { replacements: [agentId, ticketId], transaction: t }
    );

    if (meta.affectedRows === 0) {
      // Already taken — find out by whom
      const [[existing]] = await sequelize.query(
        `SELECT a.name FROM tickets t LEFT JOIN agents a ON a.id = t.assignee_id WHERE t.id = ?`,
        { replacements: [ticketId], transaction: t }
      );
      await t.rollback();
      const takenBy = existing?.name ?? 'another agent';
      const err = new Error(`Already taken by ${takenBy}`);
      err.statusCode = 409;
      err.takenBy = takenBy;
      throw err;
    }

    await writeAuditEvent(sequelize, t, {
      ticket_id: ticketId,
      event_type: 'claimed',
      actor_type: 'agent',
      actor_id: agentId,
      payload: { agent_name: agentName },
    });

    await t.commit();
    return { success: true };
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    throw err;
  }
}

/**
 * addReply — agent replies to customer (public) or adds internal note.
 * Marks first_response_at if not set and visibility='public'.
 */
export async function addReply(sequelize, ticketId, agentId, agentName, body, visibility = 'public') {
  const t = await sequelize.transaction();
  try {
    const created_at = nowUtc();

    // If public reply and ticket hasn't had a response yet, record first_response_at
    if (visibility === 'public') {
      await sequelize.query(
        `UPDATE tickets SET first_response_at = COALESCE(first_response_at, ?), status = 'open', version = version + 1
         WHERE id = ?`,
        { replacements: [created_at, ticketId], transaction: t }
      );
    }

    await sequelize.query(
      `INSERT INTO messages (ticket_id, author_type, author_id, author_name, body, visibility, created_at)
       VALUES (?, 'agent', ?, ?, ?, ?, ?)`,
      { replacements: [ticketId, agentId, agentName, body, visibility, created_at], transaction: t }
    );

    const event_type = visibility === 'internal' ? 'internal_note' : 'agent_reply';
    await writeAuditEvent(sequelize, t, {
      ticket_id: ticketId,
      event_type,
      actor_type: 'agent',
      actor_id: agentId,
      payload: {
        agent_name: agentName,
        visibility,
        // Never include the body in audit payload for internal notes — it could leak
        // in audit API. Store a placeholder; full body is in messages table.
        body_preview: visibility === 'internal' ? '[internal]' : body.substring(0, 100),
      },
    });

    await t.commit();
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    throw err;
  }
}

/**
 * customerReply — customer replies to a ticket (public only).
 * If ticket was waiting_on_customer, resumes the SLA pause.
 */
export async function customerReply(sequelize, ticketRef, customerEmail, body) {
  const holidays = await getHolidays(sequelize);
  const t = await sequelize.transaction();
  try {
    const [[ticket]] = await sequelize.query(
      `SELECT id, status, customer_email FROM tickets WHERE customer_ref = ? FOR UPDATE`,
      { replacements: [ticketRef], transaction: t }
    );
    if (!ticket) {
      await t.rollback();
      const err = new Error('Ticket not found'); err.statusCode = 404; throw err;
    }

    const created_at = nowUtc();

    if (ticket.status === 'waiting_on_customer') {
      // Resume open SLA pause
      await sequelize.query(
        `UPDATE sla_pauses SET resumed_at = ? WHERE ticket_id = ? AND resumed_at IS NULL`,
        { replacements: [created_at, ticket.id], transaction: t }
      );
      await sequelize.query(
        `UPDATE tickets SET status = 'open', version = version + 1 WHERE id = ?`,
        { replacements: [ticket.id], transaction: t }
      );
      await writeAuditEvent(sequelize, t, {
        ticket_id: ticket.id, event_type: 'sla_resumed', actor_type: 'customer', actor_id: null,
        payload: { customer_email: customerEmail, resumed_at: created_at },
      });
    }

    await sequelize.query(
      `INSERT INTO messages (ticket_id, author_type, author_name, body, visibility, created_at)
       VALUES (?, 'customer', ?, ?, 'public', ?)`,
      { replacements: [ticket.id, customerEmail, body, created_at], transaction: t }
    );

    await writeAuditEvent(sequelize, t, {
      ticket_id: ticket.id, event_type: 'customer_reply', actor_type: 'customer', actor_id: null,
      payload: { customer_email: customerEmail, body_preview: body.substring(0, 100) },
    });

    await t.commit();
    return { ticket_id: ticket.id };
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    throw err;
  }
}

/**
 * setWaitingOnCustomer — pause SLA, set status.
 */
export async function setWaitingOnCustomer(sequelize, ticketId, agentId, agentName) {
  const t = await sequelize.transaction();
  try {
    const paused_at = nowUtc();
    // Optimistic lock: increment version
    const [, meta] = await sequelize.query(
      `UPDATE tickets SET status = 'waiting_on_customer', version = version + 1 WHERE id = ? AND status NOT IN ('resolved','closed')`,
      { replacements: [ticketId], transaction: t }
    );
    if (meta.affectedRows === 0) {
      await t.rollback();
      const err = new Error('Cannot pause: ticket is resolved or closed'); err.statusCode = 409; throw err;
    }

    await sequelize.query(
      `INSERT INTO sla_pauses (ticket_id, paused_at) VALUES (?, ?)`,
      { replacements: [ticketId, paused_at], transaction: t }
    );

    await writeAuditEvent(sequelize, t, {
      ticket_id: ticketId, event_type: 'sla_paused', actor_type: 'agent', actor_id: agentId,
      payload: { agent_name: agentName, paused_at },
    });

    await t.commit();
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    throw err;
  }
}

/**
 * changePriority — recompute deadlines (Section 2.7).
 * If first reply already sent, response_due_at is recomputed but breach flag
 * of the old response SLA is preserved in the audit event.
 */
export async function changePriority(sequelize, ticketId, agentId, agentName, newPriority) {
  const holidays = await getHolidays(sequelize);
  const t = await sequelize.transaction();
  try {
    const [[ticket]] = await sequelize.query(
      `SELECT id, priority, created_at, first_response_at, response_due_at, resolution_due_at
       FROM tickets WHERE id = ? FOR UPDATE`,
      { replacements: [ticketId], transaction: t }
    );
    if (!ticket) {
      await t.rollback();
      const err = new Error('Ticket not found'); err.statusCode = 404; throw err;
    }

    const oldPriority = ticket.priority;
    const { response_due_at, resolution_due_at } = recomputeDeadlinesAfterPriorityChange(ticket, newPriority, holidays);

    await sequelize.query(
      `UPDATE tickets SET priority = ?, response_due_at = ?, resolution_due_at = ?, version = version + 1 WHERE id = ?`,
      { replacements: [newPriority, response_due_at, resolution_due_at, ticketId], transaction: t }
    );

    await writeAuditEvent(sequelize, t, {
      ticket_id: ticketId, event_type: 'priority_changed', actor_type: 'agent', actor_id: agentId,
      payload: {
        agent_name: agentName,
        old_priority: oldPriority,
        new_priority: newPriority,
        new_response_due_at: response_due_at,
        new_resolution_due_at: resolution_due_at,
        // Note: if first reply was already sent, response SLA breach is NOT retroactively changed
        first_reply_already_sent: !!ticket.first_response_at,
      },
    });

    await t.commit();
    return { response_due_at, resolution_due_at };
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    throw err;
  }
}

/**
 * resolveTicket — mark a ticket resolved.
 */
export async function resolveTicket(sequelize, ticketId, agentId, agentName) {
  const t = await sequelize.transaction();
  try {
    const resolved_at = nowUtc();
    const [, meta] = await sequelize.query(
      `UPDATE tickets SET status = 'resolved', resolved_at = ?, close_reason = 'resolved', version = version + 1
       WHERE id = ? AND status NOT IN ('resolved','closed')`,
      { replacements: [resolved_at, ticketId], transaction: t }
    );
    if (meta.affectedRows === 0) {
      await t.rollback();
      const err = new Error('Ticket already resolved or closed'); err.statusCode = 409; throw err;
    }

    // Close any open SLA pause
    await sequelize.query(
      `UPDATE sla_pauses SET resumed_at = ? WHERE ticket_id = ? AND resumed_at IS NULL`,
      { replacements: [resolved_at, ticketId], transaction: t }
    );

    await writeAuditEvent(sequelize, t, {
      ticket_id: ticketId, event_type: 'resolved', actor_type: 'agent', actor_id: agentId,
      payload: { agent_name: agentName, resolved_at },
    });

    await t.commit();
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    throw err;
  }
}

/**
 * reopenTicket — customer reopens a resolved ticket (within 5 working days).
 */
export async function reopenTicket(sequelize, ticketRef, customerEmail) {
  const holidays = await getHolidays(sequelize);
  const t = await sequelize.transaction();
  try {
    const [[ticket]] = await sequelize.query(
      `SELECT id, status, resolved_at, customer_email FROM tickets WHERE customer_ref = ? FOR UPDATE`,
      { replacements: [ticketRef], transaction: t }
    );
    if (!ticket) {
      await t.rollback();
      const err = new Error('Ticket not found'); err.statusCode = 404; throw err;
    }

    const { allowed, reason } = canReopen(ticket, holidays);
    if (!allowed) {
      await t.rollback();
      const err = new Error(reason); err.statusCode = 409; throw err;
    }

    const now = nowUtc();
    await sequelize.query(
      `UPDATE tickets SET status = 'open', resolved_at = NULL, close_reason = NULL, version = version + 1 WHERE id = ?`,
      { replacements: [ticket.id], transaction: t }
    );

    await writeAuditEvent(sequelize, t, {
      ticket_id: ticket.id, event_type: 'reopened', actor_type: 'customer', actor_id: null,
      payload: { customer_email: customerEmail, reopened_at: now },
    });

    await t.commit();
    return { ticket_id: ticket.id };
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    throw err;
  }
}

/**
 * autoCloseEligibleTickets — idempotent auto-close job.
 * Closes tickets in waiting_on_customer with 5+ working days since last pause.
 * Called by cron AND lazily on ticket-list requests.
 */
export async function autoCloseEligibleTickets(sequelize) {
  const holidays = await getHolidays(sequelize);
  const now = nowUtc();

  // Find all waiting tickets with an open pause
  const [waiting] = await sequelize.query(
    `SELECT t.id, t.status, sp.paused_at
     FROM tickets t
     JOIN sla_pauses sp ON sp.ticket_id = t.id AND sp.resumed_at IS NULL
     WHERE t.status = 'waiting_on_customer'`
  );

  const closed = [];
  for (const row of waiting) {
    if (shouldAutoClose(row, [{ paused_at: row.paused_at, resumed_at: null }], holidays, now)) {
      const t = await sequelize.transaction();
      try {
        const closed_at = now;
        const [, meta] = await sequelize.query(
          `UPDATE tickets SET status = 'closed', closed_at = ?, close_reason = 'auto_closed_no_reply', version = version + 1
           WHERE id = ? AND status = 'waiting_on_customer'`,
          { replacements: [closed_at, row.id], transaction: t }
        );
        if (meta.affectedRows > 0) {
          await sequelize.query(
            `UPDATE sla_pauses SET resumed_at = ? WHERE ticket_id = ? AND resumed_at IS NULL`,
            { replacements: [closed_at, row.id], transaction: t }
          );
          await writeAuditEvent(sequelize, t, {
            ticket_id: row.id, event_type: 'auto_closed', actor_type: 'system', actor_id: null,
            payload: { reason: 'auto_closed_no_reply', closed_at, paused_since: row.paused_at },
          });
          closed.push(row.id);
        }
        await t.commit();
      } catch (err) {
        if (t && !t.finished) await t.rollback();
        // Log but don't throw — auto-close is best-effort
        console.error('Auto-close error for ticket', row.id, err.message);
      }
    }
  }

  return closed;
}

/**
 * reassignTicket — explicit reassignment (separate from atomic claim).
 */
export async function reassignTicket(sequelize, ticketId, agentId, agentName, newAgentId, newAgentName) {
  const t = await sequelize.transaction();
  try {
    const [, meta] = await sequelize.query(
      `UPDATE tickets SET assignee_id = ?, version = version + 1 WHERE id = ?`,
      { replacements: [newAgentId, ticketId], transaction: t }
    );

    await writeAuditEvent(sequelize, t, {
      ticket_id: ticketId, event_type: 'reassigned', actor_type: 'agent', actor_id: agentId,
      payload: { from_agent: agentName, to_agent: newAgentName, to_agent_id: newAgentId },
    });

    await t.commit();
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    throw err;
  }
}
