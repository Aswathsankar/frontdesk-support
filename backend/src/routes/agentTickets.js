/**
 * Agent ticket routes — all require JWT authentication.
 * Separate route group from public routes (INC-0304).
 * Serializers use a full field set (agents see internal notes).
 */
import {
  claimTicket,
  addReply,
  changePriority,
  resolveTicket,
  reassignTicket,
  setWaitingOnCustomer,
  autoCloseEligibleTickets,
} from '../services/ticketService.js';
import { verifyChain } from '../services/auditService.js';
import { getHolidays, checkBreach, timeRemaining } from '../services/slaService.js';

export async function agentTicketRoutes(fastify) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/agent/tickets ──────────────────────────────────────
  fastify.get('/tickets', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          filter:   { type: 'string', enum: ['mine', 'unassigned', 'late', 'waiting', 'all'] },
          page:     { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      },
    },
  }, async (req, reply) => {
    const { filter = 'all', page = 1, pageSize = 25 } = req.query;
    const { sequelize } = fastify;
    const agentId = req.user.id;

    // Lazy auto-close on every list request (free hosts sleep between requests)
    await autoCloseEligibleTickets(sequelize).catch(() => {});

    const holidays = await getHolidays(sequelize);
    const now = new Date().toISOString();

    let where = '';
    const replacements = [];

    if (filter === 'mine') {
      where = 'WHERE t.assignee_id = ?'; replacements.push(agentId);
    } else if (filter === 'unassigned') {
      where = 'WHERE t.assignee_id IS NULL AND t.status NOT IN ("resolved","closed")';
    } else if (filter === 'waiting') {
      where = 'WHERE t.status = "waiting_on_customer"';
    } else if (filter !== 'late') {
      // 'all': exclude fully closed
      where = 'WHERE t.status != "closed"';
    }

    const offset = (page - 1) * pageSize;

    const [tickets] = await sequelize.query(
      `SELECT t.*, a.name as assignee_name
       FROM tickets t
       LEFT JOIN agents a ON a.id = t.assignee_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      { replacements: [...replacements, pageSize, offset] }
    );

    // Fetch pauses for all tickets in this page
    const ticketIds = tickets.map((t) => t.id);
    let pauseMap = {};
    if (ticketIds.length > 0) {
      const [pauses] = await sequelize.query(
        `SELECT * FROM sla_pauses WHERE ticket_id IN (${ticketIds.map(() => '?').join(',')})`,
        { replacements: ticketIds }
      );
      for (const p of pauses) {
        if (!pauseMap[p.ticket_id]) pauseMap[p.ticket_id] = [];
        pauseMap[p.ticket_id].push(p);
      }
    }

    // Annotate each ticket with breach/remaining info
    let results = tickets.map((ticket) => {
      const pauses = pauseMap[ticket.id] || [];
      const breach = checkBreach(ticket, pauses, holidays, now);
      const remaining = timeRemaining(ticket, pauses, holidays, now);
      return {
        id: ticket.id,
        customer_ref: ticket.customer_ref,
        customer_email: ticket.customer_email,
        subject: ticket.subject,
        priority: ticket.priority,
        status: ticket.status,
        assignee_id: ticket.assignee_id,
        assignee_name: ticket.assignee_name,
        created_at: ticket.created_at,
        first_response_at: ticket.first_response_at,
        resolved_at: ticket.resolved_at,
        response_due_at: ticket.response_due_at,
        resolution_due_at: ticket.resolution_due_at,
        close_reason: ticket.close_reason,
        is_late: breach.isLate,
        response_late: breach.responseLate,
        resolution_late: breach.resolutionLate,
        response_remaining_min: remaining.responseRemaining,
        resolution_remaining_min: remaining.resolutionRemaining,
        is_waiting: ticket.status === 'waiting_on_customer',
      };
    });

    // Late filter needs breach info first
    if (filter === 'late') {
      results = results.filter((t) => t.is_late);
    }

    // Late tickets first
    results.sort((a, b) => {
      if (a.is_late && !b.is_late) return -1;
      if (!a.is_late && b.is_late) return 1;
      return new Date(a.created_at) - new Date(b.created_at);
    });

    return { tickets: results, page, pageSize };
  });

  // ── GET /api/agent/tickets/:id ──────────────────────────────────
  fastify.get('/tickets/:id', async (req, reply) => {
    const { sequelize } = fastify;
    const ticketId = parseInt(req.params.id);

    const [[ticket]] = await sequelize.query(
      `SELECT t.*, a.name as assignee_name
       FROM tickets t
       LEFT JOIN agents a ON a.id = t.assignee_id
       WHERE t.id = ?`,
      { replacements: [ticketId] }
    );
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });

    // All messages including internal (agent view)
    const [messages] = await sequelize.query(
      'SELECT * FROM messages WHERE ticket_id = ? ORDER BY created_at ASC',
      { replacements: [ticketId] }
    );

    const [pauses] = await sequelize.query(
      'SELECT * FROM sla_pauses WHERE ticket_id = ? ORDER BY paused_at ASC',
      { replacements: [ticketId] }
    );

    const holidays = await getHolidays(sequelize);
    const now = new Date().toISOString();
    const breach = checkBreach(ticket, pauses, holidays, now);
    const remaining = timeRemaining(ticket, pauses, holidays, now);

    return { ticket: { ...ticket, ...breach, ...remaining }, messages, pauses };
  });

  // ── POST /api/agent/tickets/:id/claim ──────────────────────────
  fastify.post('/tickets/:id/claim', async (req, reply) => {
    const ticketId = parseInt(req.params.id);
    const { id: agentId, name: agentName } = req.user;
    await claimTicket(fastify.sequelize, ticketId, agentId, agentName);
    return { ok: true };
  });

  // ── POST /api/agent/tickets/:id/reply ──────────────────────────
  fastify.post('/tickets/:id/reply', {
    schema: {
      body: {
        type: 'object',
        required: ['body'],
        properties: {
          body: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const ticketId = parseInt(req.params.id);
    const { id: agentId, name: agentName } = req.user;
    await addReply(fastify.sequelize, ticketId, agentId, agentName, req.body.body, 'public');
    return { ok: true };
  });

  // ── POST /api/agent/tickets/:id/notes ──────────────────────────
  fastify.post('/tickets/:id/notes', {
    schema: {
      body: {
        type: 'object',
        required: ['body'],
        properties: {
          body: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const ticketId = parseInt(req.params.id);
    const { id: agentId, name: agentName } = req.user;
    await addReply(fastify.sequelize, ticketId, agentId, agentName, req.body.body, 'internal');
    return { ok: true };
  });

  // ── POST /api/agent/tickets/:id/priority ───────────────────────
  fastify.post('/tickets/:id/priority', {
    schema: {
      body: {
        type: 'object',
        required: ['priority'],
        properties: {
          priority: { type: 'string', enum: ['urgent', 'medium', 'low'] },
        },
      },
    },
  }, async (req, reply) => {
    const ticketId = parseInt(req.params.id);
    const { id: agentId, name: agentName } = req.user;
    const result = await changePriority(fastify.sequelize, ticketId, agentId, agentName, req.body.priority);
    return { ok: true, ...result };
  });

  // ── POST /api/agent/tickets/:id/resolve ────────────────────────
  fastify.post('/tickets/:id/resolve', async (req, reply) => {
    const ticketId = parseInt(req.params.id);
    const { id: agentId, name: agentName } = req.user;
    await resolveTicket(fastify.sequelize, ticketId, agentId, agentName);
    return { ok: true };
  });

  // ── POST /api/agent/tickets/:id/wait ──────────────────────────
  fastify.post('/tickets/:id/wait', async (req, reply) => {
    const ticketId = parseInt(req.params.id);
    const { id: agentId, name: agentName } = req.user;
    await setWaitingOnCustomer(fastify.sequelize, ticketId, agentId, agentName);
    return { ok: true };
  });

  // ── POST /api/agent/tickets/:id/reassign ──────────────────────
  fastify.post('/tickets/:id/reassign', {
    schema: {
      body: {
        type: 'object',
        required: ['agent_id'],
        properties: {
          agent_id: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    const ticketId = parseInt(req.params.id);
    const { id: agentId, name: agentName } = req.user;
    const { agent_id: newAgentId } = req.body;

    const [[newAgent]] = await fastify.sequelize.query(
      'SELECT id, name FROM agents WHERE id = ?',
      { replacements: [newAgentId] }
    );
    if (!newAgent) return reply.code(404).send({ error: 'Agent not found' });

    await reassignTicket(fastify.sequelize, ticketId, agentId, agentName, newAgent.id, newAgent.name);
    return { ok: true };
  });

  // ── GET /api/agent/tickets/:id/audit ──────────────────────────
  fastify.get('/tickets/:id/audit', async (req, reply) => {
    const ticketId = parseInt(req.params.id);
    const [events] = await fastify.sequelize.query(
      'SELECT * FROM audit_events WHERE ticket_id = ? ORDER BY id ASC',
      { replacements: [ticketId] }
    );
    return { events };
  });

  // ── GET /api/agent/audit/verify ───────────────────────────────
  fastify.get('/audit/verify', async (req, reply) => {
    const result = await verifyChain(fastify.sequelize, null);
    return result;
  });

  // ── GET /api/agent/agents (list agents for reassign UI) ───────
  fastify.get('/agents', async (req, reply) => {
    const [agents] = await fastify.sequelize.query(
      'SELECT id, name, email FROM agents ORDER BY name ASC'
    );
    return { agents };
  });
}
