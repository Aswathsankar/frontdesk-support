/**
 * Seed script: creates 9 agents, holiday list, and ~15 tickets
 * covering all required scenario types.
 *
 * Demo password for all agents: Demo@1234
 * Run: node src/db/seed.js
 */
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getConnection } from './connection.js';
import { defineModels } from './models/index.js';
import { addWorkingMinutes, nextWorkingStart } from '../lib/workingHours.js';
import { SLA_CONFIG } from '../config/constants.js';
import { DateTime } from 'luxon';

const DEMO_PASSWORD = 'Demo@1234';
const IST = 'Asia/Kolkata';

// Sample Indian holidays (2024-2026)
const HOLIDAYS = [
  { date: '2024-01-26', name: 'Republic Day' },
  { date: '2024-03-25', name: 'Holi' },
  { date: '2024-08-15', name: 'Independence Day' },
  { date: '2024-10-02', name: 'Gandhi Jayanti' },
  { date: '2024-11-01', name: 'Diwali' },
  { date: '2024-11-02', name: 'Diwali (holiday)' },
  { date: '2025-01-26', name: 'Republic Day' },
  { date: '2025-03-14', name: 'Holi' },
  { date: '2025-08-15', name: 'Independence Day' },
  { date: '2025-10-02', name: 'Gandhi Jayanti' },
  { date: '2025-10-20', name: 'Diwali' },
  { date: '2025-10-21', name: 'Diwali (holiday)' },
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-03-04', name: 'Holi' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
];

const AGENTS = [
  { name: 'Aswath Menon',   email: 'aswath@arvo.dev' },
  { name: 'Rahul Verma',    email: 'rahul@arvo.dev' },
  { name: 'Anjali Singh',   email: 'anjali@arvo.dev' },
  { name: 'Karan Mehta',    email: 'karan@arvo.dev' },
  { name: 'Deepika Nair',   email: 'deepika@arvo.dev' },
  { name: 'Arjun Patel',    email: 'arjun@arvo.dev' },
  { name: 'Sneha Reddy',    email: 'sneha@arvo.dev' },
  { name: 'Vikas Gupta',    email: 'vikas@arvo.dev' },
  { name: 'Meera Joshi',    email: 'meera@arvo.dev' },
];

async function seed() {
  const sequelize = await getConnection();
  const { Agent, Holiday, Ticket, Message, SlaPause, AuditEvent } = defineModels(sequelize);

  // Password hash
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  console.log('Seeding agents...');
  const agents = [];
  for (const a of AGENTS) {
    const [agent] = await Agent.upsert({ ...a, password_hash: hash }, { returning: true });
    agents.push(agent);
  }

  console.log('Seeding holidays...');
  for (const h of HOLIDAYS) {
    await Holiday.upsert(h);
  }
  const holidayDates = HOLIDAYS.map((h) => h.date);

  console.log('Seeding tickets...');
  const now = DateTime.now().setZone(IST);

  // Helper: UTC datetime string for Sequelize
  const utcStr = (dt) => dt.toUTC().toISO();

  // Helper: compute deadlines
  function deadlines(createdAt, priority) {
    const sla = SLA_CONFIG[priority];
    const start = nextWorkingStart(createdAt, holidayDates);
    const responseDue = addWorkingMinutes(start, sla.firstReply, holidayDates);
    let resolutionDue;
    if (priority === 'urgent') {
      // End of same working day 18:30 IST; if outside hours, next working day 18:30
      const startDt = DateTime.fromISO(start, { zone: IST });
      resolutionDue = startDt.set({ hour: 18, minute: 30, second: 0, millisecond: 0 }).toISO();
    } else {
      resolutionDue = addWorkingMinutes(start, sla.resolution, holidayDates);
    }
    return { response_due_at: responseDue, resolution_due_at: resolutionDue };
  }

  // --- Ticket 1: Late response – urgent, unassigned, response due 3 hours ago
  const t1Created = now.minus({ hours: 5 }).toISO();
  const t1Deadlines = deadlines(t1Created, 'urgent');
  await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'alice@example.com',
    subject: 'Cannot access the system at all - URGENT',
    priority: 'urgent', status: 'new', assignee_id: null,
    created_at: utcStr(DateTime.fromISO(t1Created)),
    ...{ response_due_at: now.minus({ hours: 3 }).toISO(), resolution_due_at: t1Deadlines.resolution_due_at },
  });

  // --- Ticket 2: Late resolution – medium, assigned to priya, response sent
  const t2Created = now.minus({ days: 5 }).toISO();
  const t2Deadlines = deadlines(t2Created, 'medium');
  const t2 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'bob@example.com',
    subject: 'Report export is broken',
    priority: 'medium', status: 'open', assignee_id: agents[0].id,
    created_at: utcStr(DateTime.fromISO(t2Created)),
    first_response_at: utcStr(now.minus({ days: 4, hours: 2 })),
    response_due_at: now.minus({ days: 3 }).toISO(),
    resolution_due_at: now.minus({ hours: 2 }).toISO(), // past = late
  });
  await Message.create({
    ticket_id: t2.id, author_type: 'customer', author_name: 'bob@example.com',
    body: 'Hi, the export feature gives me a 500 error.', visibility: 'public',
    created_at: utcStr(DateTime.fromISO(t2Created)),
  });
  await Message.create({
    ticket_id: t2.id, author_type: 'agent', author_id: agents[0].id, author_name: agents[0].name,
    body: 'Thanks Bob, we are investigating the export issue.', visibility: 'public',
    created_at: utcStr(now.minus({ days: 4, hours: 2 })),
  });

  // --- Ticket 3: Waiting on customer
  const t3Created = now.minus({ days: 2 }).toISO();
  const t3Deadlines = deadlines(t3Created, 'low');
  const t3 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'carol@example.com',
    subject: 'Question about pricing tiers',
    priority: 'low', status: 'waiting_on_customer', assignee_id: agents[1].id,
    created_at: utcStr(DateTime.fromISO(t3Created)),
    first_response_at: utcStr(now.minus({ days: 1, hours: 20 })),
    ...t3Deadlines,
  });
  await Message.create({
    ticket_id: t3.id, author_type: 'customer', author_name: 'carol@example.com',
    body: 'What is included in the Pro tier?', visibility: 'public',
    created_at: utcStr(DateTime.fromISO(t3Created)),
  });
  await Message.create({
    ticket_id: t3.id, author_type: 'agent', author_id: agents[1].id, author_name: agents[1].name,
    body: 'Could you clarify which integrations you are asking about?', visibility: 'public',
    created_at: utcStr(now.minus({ days: 1, hours: 20 })),
  });
  await SlaPause.create({
    ticket_id: t3.id,
    paused_at: utcStr(now.minus({ days: 1, hours: 20 })),
    resumed_at: null, // still paused
  });

  // --- Ticket 4: Nearly auto-closed (4.5 working days waiting)
  const t4PausedAt = now.minus({ days: 7 }); // roughly 4.5 working days ago
  const t4Created = now.minus({ days: 8 }).toISO();
  const t4Deadlines = deadlines(t4Created, 'medium');
  const t4 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'dave@example.com',
    subject: 'Integration with Slack stopped working',
    priority: 'medium', status: 'waiting_on_customer', assignee_id: agents[2].id,
    created_at: utcStr(DateTime.fromISO(t4Created)),
    first_response_at: utcStr(now.minus({ days: 7, hours: 23 })),
    ...t4Deadlines,
  });
  await SlaPause.create({
    ticket_id: t4.id,
    paused_at: utcStr(t4PausedAt),
    resumed_at: null,
  });

  // --- Ticket 5: Resolved inside reopen window (resolved 2 working days ago)
  const t5Created = now.minus({ days: 5 }).toISO();
  const t5Deadlines = deadlines(t5Created, 'low');
  const t5 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'eve@example.com',
    subject: 'Password reset email not arriving',
    priority: 'low', status: 'resolved', assignee_id: agents[3].id,
    created_at: utcStr(DateTime.fromISO(t5Created)),
    first_response_at: utcStr(now.minus({ days: 4 })),
    resolved_at: utcStr(now.minus({ days: 2 })), // within 5-day reopen window
    close_reason: 'resolved',
    ...t5Deadlines,
  });

  // --- Ticket 6: Resolved outside reopen window (resolved 8 days ago)
  const t6Created = now.minus({ days: 15 }).toISO();
  const t6Deadlines = deadlines(t6Created, 'medium');
  const t6 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'frank@example.com',
    subject: 'API rate limit too low for our use case',
    priority: 'medium', status: 'resolved', assignee_id: agents[4].id,
    created_at: utcStr(DateTime.fromISO(t6Created)),
    first_response_at: utcStr(now.minus({ days: 14 })),
    resolved_at: utcStr(now.minus({ days: 8 })), // outside 5-day reopen window
    close_reason: 'resolved',
    ...t6Deadlines,
  });

  // --- Ticket 7: Unassigned, medium priority, fresh
  const t7Created = now.minus({ hours: 2 }).toISO();
  const t7Deadlines = deadlines(t7Created, 'medium');
  await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'grace@example.com',
    subject: 'Need help with bulk user import',
    priority: 'medium', status: 'new', assignee_id: null,
    created_at: utcStr(DateTime.fromISO(t7Created)),
    ...t7Deadlines,
  });

  // --- Ticket 8: Has an internal note (must NOT leak to customer)
  const t8Created = now.minus({ days: 1 }).toISO();
  const t8Deadlines = deadlines(t8Created, 'medium');
  const t8 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'henry@example.com',
    subject: 'Dashboard numbers do not match our analytics',
    priority: 'medium', status: 'open', assignee_id: agents[0].id,
    created_at: utcStr(DateTime.fromISO(t8Created)),
    first_response_at: utcStr(now.minus({ hours: 20 })),
    ...t8Deadlines,
  });
  await Message.create({
    ticket_id: t8.id, author_type: 'customer', author_name: 'henry@example.com',
    body: 'The numbers are off by about 12%.', visibility: 'public',
    created_at: utcStr(DateTime.fromISO(t8Created)),
  });
  await Message.create({
    ticket_id: t8.id, author_type: 'agent', author_id: agents[0].id, author_name: agents[0].name,
    body: 'Thanks, we are looking into it.', visibility: 'public',
    created_at: utcStr(now.minus({ hours: 20 })),
  });
  // Internal note — MUST NEVER appear in public API
  await Message.create({
    ticket_id: t8.id, author_type: 'agent', author_id: agents[0].id, author_name: agents[0].name,
    body: 'INTERNAL_NOTE_CANARY: The discrepancy is due to a timezone bug in the analytics pipeline. Do not share this with the customer yet.',
    visibility: 'internal',
    created_at: utcStr(now.minus({ hours: 18 })),
  });

  // --- Ticket 9: Auto-closed ticket
  const t9Created = now.minus({ days: 20 }).toISO();
  const t9Deadlines = deadlines(t9Created, 'low');
  const t9 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'isabel@example.com',
    subject: 'Question about data export formats',
    priority: 'low', status: 'closed', assignee_id: agents[5].id,
    created_at: utcStr(DateTime.fromISO(t9Created)),
    first_response_at: utcStr(now.minus({ days: 19 })),
    closed_at: utcStr(now.minus({ days: 7 })),
    close_reason: 'auto_closed_no_reply',
    ...t9Deadlines,
  });

  // --- Ticket 10: Urgent, assigned, response sent on time
  const t10Created = now.minus({ hours: 3 }).toISO();
  const t10Deadlines = deadlines(t10Created, 'urgent');
  const t10 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'jake@example.com',
    subject: 'Production database is completely down',
    priority: 'urgent', status: 'open', assignee_id: agents[1].id,
    created_at: utcStr(DateTime.fromISO(t10Created)),
    first_response_at: utcStr(now.minus({ hours: 2, minutes: 45 })),
    ...t10Deadlines,
  });

  // --- Ticket 11: Medium, resolved with messages
  const t11Created = now.minus({ days: 4 }).toISO();
  const t11Deadlines = deadlines(t11Created, 'medium');
  const t11 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'kate@example.com',
    subject: 'Need to add 5 more team members',
    priority: 'medium', status: 'resolved', assignee_id: agents[6].id,
    created_at: utcStr(DateTime.fromISO(t11Created)),
    first_response_at: utcStr(now.minus({ days: 3, hours: 20 })),
    resolved_at: utcStr(now.minus({ days: 1 })),
    close_reason: 'resolved',
    ...t11Deadlines,
  });

  // --- Ticket 12: Low priority, new unassigned
  const t12Created = now.minus({ minutes: 30 }).toISO();
  const t12Deadlines = deadlines(t12Created, 'low');
  await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'leo@example.com',
    subject: 'Request for a training session',
    priority: 'low', status: 'new', assignee_id: null,
    created_at: utcStr(DateTime.fromISO(t12Created)),
    ...t12Deadlines,
  });

  // --- Ticket 13: Priority changed ticket (medium → urgent, now late)
  const t13Created = now.minus({ hours: 4 }).toISO();
  // Start as medium, priority changed to urgent
  const t13UrgentDeadlines = deadlines(t13Created, 'urgent');
  const t13 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'mia@example.com',
    subject: 'All users locked out after the latest update',
    priority: 'urgent', status: 'open', assignee_id: agents[7].id,
    created_at: utcStr(DateTime.fromISO(t13Created)),
    // response_due_at is in the past (created 4h ago, urgent SLA = 2h)
    response_due_at: now.minus({ hours: 2 }).toISO(),
    resolution_due_at: t13UrgentDeadlines.resolution_due_at,
  });

  // --- Ticket 14: Related ticket (follow-up after reopen window closed)
  const t14Created = now.minus({ minutes: 10 }).toISO();
  const t14Deadlines = deadlines(t14Created, 'low');
  await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'frank@example.com', // same customer as t6
    subject: 'Follow up: API rate limit issue still happening',
    priority: 'low', status: 'new', assignee_id: null,
    related_ticket_id: t6.id,
    created_at: utcStr(DateTime.fromISO(t14Created)),
    ...t14Deadlines,
  });

  // --- Ticket 15: Multi-pause SLA test ticket
  const t15Created = now.minus({ days: 3 }).toISO();
  const t15Deadlines = deadlines(t15Created, 'medium');
  const t15 = await Ticket.create({
    customer_ref: uuidv4(), customer_email: 'nina@example.com',
    subject: 'Webhook delivery failures intermittently',
    priority: 'medium', status: 'open', assignee_id: agents[8].id,
    created_at: utcStr(DateTime.fromISO(t15Created)),
    first_response_at: utcStr(now.minus({ days: 2, hours: 22 })),
    ...t15Deadlines,
  });
  // Two pauses (resumed and then paused again)
  await SlaPause.create({
    ticket_id: t15.id,
    paused_at: utcStr(now.minus({ days: 2, hours: 20 })),
    resumed_at: utcStr(now.minus({ days: 2, hours: 10 })),
  });
  await SlaPause.create({
    ticket_id: t15.id,
    paused_at: utcStr(now.minus({ days: 1, hours: 5 })),
    resumed_at: utcStr(now.minus({ hours: 20 })),
  });

  console.log('Seed complete! Demo password for all agents:', DEMO_PASSWORD);
  console.log('Agent logins:');
  AGENTS.forEach((a) => console.log(`  ${a.email} / ${DEMO_PASSWORD}`));
  await sequelize.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
