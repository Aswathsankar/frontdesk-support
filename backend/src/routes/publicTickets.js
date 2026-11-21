/**
 * Public ticket routes — no authentication required.
 * INC-0304: ALL responses use the customer_visible_messages VIEW.
 * Field ALLOWLIST enforced: internal notes, agent_id, assignee details never exposed.
 * Rate-limited via global rate-limit plugin (skip applied in app.js).
 */
import {
  createTicket,
  customerReply,
  reopenTicket,
} from '../services/ticketService.js';
import { getHolidays, canReopen } from '../services/slaService.js';

// ALLOWLIST: fields returned to customer for ticket detail
// Never includes: assignee_id, assignee details, internal messages, agent IDs
const TICKET_ALLOWLIST = [
  'id', 'customer_ref', 'customer_email', 'subject', 'priority',
  'status', 'created_at', 'first_response_at', 'resolved_at',
  'response_due_at', 'resolution_due_at',
];

function pickTicketFields(ticket) {
  const result = {};
  for (const key of TICKET_ALLOWLIST) {
    result[key] = ticket[key] ?? null;
  }
  return result;
}

export async function publicTicketRoutes(fastify) {
  // ── POST /api/public/tickets ────────────────────────────────────
  fastify.post('/tickets', {
    schema: {
      body: {
        type: 'object',
        required: ['customer_email', 'subject'],
        properties: {
          customer_email:   { type: 'string', format: 'email' },
          subject:          { type: 'string', minLength: 1, maxLength: 500 },
          priority:         { type: 'string', enum: ['urgent', 'medium', 'low'], default: 'medium' },
          related_ticket_id:{ type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    const { customer_email, subject, priority = 'medium', related_ticket_id } = req.body;
    const { id, customer_ref } = await createTicket(fastify.sequelize, {
      customer_email, subject, priority, related_ticket_id,
    });
    return reply.code(201).send({ id, customer_ref });
  });

  // ── GET /api/public/tickets/:ref ───────────────────────────────
  fastify.get('/tickets/:ref', async (req, reply) => {
    const { sequelize } = fastify;
    const { ref } = req.params;

    const [[ticket]] = await sequelize.query(
      'SELECT * FROM tickets WHERE customer_ref = ?',
      { replacements: [ref] }
    );
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });

    // INC-0304: use customer_visible_messages view — only public messages
    const [messages] = await sequelize.query(
      'SELECT * FROM customer_visible_messages WHERE ticket_id = ? ORDER BY created_at ASC',
      { replacements: [ticket.id] }
    );

    const holidays = await getHolidays(sequelize);
    const { allowed: canReopenTicket } = canReopen(ticket, holidays);

    return {
      ticket: pickTicketFields(ticket),
      messages, // already filtered by view — no internal fields
      can_reopen: canReopenTicket,
    };
  });

  // ── POST /api/public/tickets/:ref/reply ────────────────────────
  fastify.post('/tickets/:ref/reply', {
    schema: {
      body: {
        type: 'object',
        required: ['customer_email', 'body'],
        properties: {
          customer_email: { type: 'string', format: 'email' },
          body:           { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const { ref } = req.params;
    const { customer_email, body } = req.body;
    await customerReply(fastify.sequelize, ref, customer_email, body);
    return { ok: true };
  });

  // ── POST /api/public/tickets/:ref/reopen ───────────────────────
  fastify.post('/tickets/:ref/reopen', {
    schema: {
      body: {
        type: 'object',
        required: ['customer_email'],
        properties: {
          customer_email: { type: 'string', format: 'email' },
        },
      },
    },
  }, async (req, reply) => {
    const { ref } = req.params;
    const { customer_email } = req.body;
    try {
      await reopenTicket(fastify.sequelize, ref, customer_email);
      return { ok: true };
    } catch (err) {
      return reply.code(err.statusCode || 400).send({ error: err.message });
    }
  });

  // ── GET /api/public/export.csv ─────────────────────────────────
  // Exports public-facing ticket data only. No internal messages, no agent names.
  fastify.get('/export.csv', async (req, reply) => {
    const { sequelize } = fastify;

    const [tickets] = await sequelize.query(
      `SELECT customer_ref, customer_email, subject, priority, status,
              created_at, first_response_at, resolved_at,
              response_due_at, resolution_due_at
       FROM tickets
       WHERE status != 'closed' OR close_reason = 'resolved'
       ORDER BY created_at DESC`
    );

    const header = 'ref,email,subject,priority,status,created_at,first_response_at,resolved_at,response_due_at,resolution_due_at\n';
    const rows = tickets.map((t) =>
      [
        t.customer_ref,
        `"${(t.customer_email || '').replace(/"/g, '""')}"`,
        `"${(t.subject || '').replace(/"/g, '""')}"`,
        t.priority,
        t.status,
        t.created_at,
        t.first_response_at || '',
        t.resolved_at || '',
        t.response_due_at || '',
        t.resolution_due_at || '',
      ].join(',')
    ).join('\n');

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="tickets.csv"');
    return reply.send(header + rows);
  });
}
