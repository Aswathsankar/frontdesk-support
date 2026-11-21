# Frontdesk — Engineering Interview & Design Walkthrough

This guide is prepared for technical interviewers and code reviewers at **iNav Technologies**. It explains the architectural choices, database schema, concurrency guarantees, and SLA algorithms behind Frontdesk.

---

## 1. System Architecture Overview

```
                      +-----------------------------+
                      |       Client Browser        |
                      +--------------+--------------+
                                     |
              +----------------------+----------------------+
              |                                             |
   (Agent Requests / Cookie)                       (Public Requests)
              |                                             |
              v                                             v
     /api/agent/* (JWT Auth)                       /api/public/* (Rate-limited)
              |                                             |
              +----------------------+----------------------+
                                     |
                                     v
                        +---------------------------+
                        |   Fastify Node.js App     |
                        |   - SLA & Working Hours   |
                        |   - Audit Hash Chain      |
                        |   - Idempotent Auto-Close |
                        +-------------+-------------+
                                      |
                           (Raw SQL + Transactions)
                                      |
                                      v
                        +---------------------------+
                        |       MySQL 8 InnoDB      |
                        | - customer_visible_messages
                        | - Audit & Msg Triggers    |
                        | - Atomic Row Locks        |
                        +---------------------------+
```

---

## 2. Core Technical Decisions & Code Explanations

### Q1: Why combine Sequelize with Raw SQL instead of choosing one?
**Answer:**
Sequelize is well-suited for repetitive CRUD queries (e.g., retrieving lists, simple inserts). However, Sequelize's abstraction layer obscures critical low-level database features required for this system:
1. **Atomic Claiming:** We need an atomic `UPDATE ... WHERE assignee_id IS NULL` that returns affected rows directly from the MySQL wire protocol.
2. **Pessimistic Row Locking:** Implementing cryptographic audit chains requires `SELECT ... FOR UPDATE` on the ticket row to prevent concurrent transactions from interleaving or forking the hash chain.
3. **Database Views:** We query the `customer_visible_messages` view directly via SQL so that internal visibility notes are filtered at the storage engine level.
4. **Trigger Management:** Triggers cannot be generated cleanly through ORM syncs; numbered migration scripts execute raw DDL statements individually.

---

### Q2: How does the system solve INC-0291 (two agents claiming the same ticket)?
**Answer:**
In `backend/src/services/ticketService.js`:
```javascript
export async function claimTicket(sequelize, ticketId, agentId, agentName) {
  return await sequelize.transaction(async (t) => {
    // 1. Atomic claim: exactly one query execution
    const [result] = await sequelize.query(
      `UPDATE tickets 
       SET assignee_id = ?, status = 'open', version = version + 1 
       WHERE id = ? AND assignee_id IS NULL`,
      { replacements: [agentId, ticketId], transaction: t }
    );

    // affectedRows is 0 if another transaction already set assignee_id
    if (result.affectedRows === 0) {
      const [[current]] = await sequelize.query(
        `SELECT a.name FROM tickets t 
         LEFT JOIN agents a ON t.assignee_id = a.id 
         WHERE t.id = ?`,
        { replacements: [ticketId], transaction: t }
      );
      const err = new Error(`Ticket is already claimed by ${current?.name || 'another agent'}`);
      err.statusCode = 409;
      throw err;
    }

    // 2. Write immutable audit log in the exact same transaction
    await writeAuditEvent(sequelize, t, {
      ticket_id: ticketId,
      event_type: 'claimed',
      actor_type: 'agent',
      actor_id: agentId,
      payload: { agent_name: agentName },
    });
  });
}
```
**Why this works:** InnoDB executes the update under an exclusive index record lock. The first transaction to acquire the lock updates the row and sets `affectedRows = 1`. The second transaction blocks until the first commits, reads the updated row where `assignee_id IS NOT NULL`, fails the `WHERE` clause, and returns `affectedRows = 0`, triggering an HTTP 409 error.

---

### Q3: How does the system guarantee INC-0304 (internal notes never reach customers)?
**Answer:**
We employ defense-in-depth across three distinct layers:
1. **Database Layer (View):**
   ```sql
   CREATE OR REPLACE VIEW customer_visible_messages AS
   SELECT id, ticket_id, author_type, author_name, body, created_at
   FROM messages
   WHERE visibility = 'public';
   ```
   All public routes (`/api/public/*`) query `customer_visible_messages`. The server code literally does not query the raw `messages` table for customer endpoints.
2. **Controller Whitelist Serialization:**
   Customer serializers explicitly allowlist fields:
   ```javascript
   const TICKET_ALLOWLIST = [
     'id', 'customer_ref', 'customer_email', 'subject', 'priority',
     'status', 'created_at', 'first_response_at', 'resolved_at',
     'response_due_at', 'resolution_due_at',
   ];
   ```
   Internal fields like `assignee_id`, internal notes, agent personal emails, and audit chains are omitted from the response dictionary.
3. **Automated Canary Testing:**
   Our integration test injects a canary secret into an internal note and verifies that string does not exist in any public JSON, CSV export, or error payload.

---

### Q4: How is audit trail immutability and verification achieved (INC-0318)?
**Answer:**
1. **Database Triggers:**
   `BEFORE UPDATE` and `BEFORE DELETE` triggers reject modifications:
   ```sql
   CREATE TRIGGER audit_events_no_update
   BEFORE UPDATE ON audit_events
   FOR EACH ROW
   SIGNAL SQLSTATE '45000'
   SET MESSAGE_TEXT = 'audit_events rows are immutable: UPDATE forbidden';
   ```
2. **Hash Chain Generation:**
   In `backend/src/services/auditService.js`, every event is cryptographically linked:
   ```javascript
   const prevHash = lastEvent ? lastEvent.hash : '0'.repeat(64);
   const canonicalPayload = JSON.stringify(payload, Object.keys(payload).sort());
   const contentToHash = `${prevHash}|${ticket_id}|${event_type}|${actor_type}|${actor_id || ''}|${canonicalPayload}`;
   const hash = crypto.createHash('sha256').update(contentToHash).digest('hex');
   ```
3. **Verification API:**
   `GET /api/agent/audit/verify` iterates through every event sequentially per ticket, recalculating the SHA-256 hash using the canonical payload and the previous block's hash. If a single byte is changed, the mismatch is detected immediately.

---

### Q5: How does the working-hours clock handle weekends, holidays, and pauses?
**Answer:**
The working-hours engine (`backend/src/lib/workingHours.js`) is implemented as a **pure module** using Luxon:
- Working window: `09:30` to `18:30` IST (540 working minutes per day).
- When computing `addWorkingMinutes(start, minutes, holidays)`:
  1. Clamps `start` to the next valid working hour if it falls after-hours, on a weekend, or on a holiday.
  2. Traverses day-by-day. If the remaining minutes fit within the current day, it adds the minutes directly. Otherwise, it subtracts the remaining minutes in the day and advances to `09:30` of the next non-weekend, non-holiday day.
- **SLA Pauses:**
  When a ticket is set to `waiting_on_customer`, an entry in `sla_pauses` is recorded. When resumed, `workingMinutesBetween(paused_at, resumed_at, holidays)` calculates only the business minutes that elapsed during the pause and pushes the deadline forward by that exact duration.

---

### Q6: How does Frontdesk stay reliable on sleeping free-tier instances (Render)?
**Answer:**
Free web instances sleep after 15 minutes of inactivity:
1. **GET /health:** Exposes a lightweight probe for external pingers (e.g., UptimeRobot, cron-job.org) to keep the instance warm during business hours.
2. **Lazy Evaluation:** In addition to a background `node-cron` running every 5 minutes, every request to `GET /api/agent/tickets` invokes `autoCloseEligibleTickets()`. Even if the cron missed a run while the instance was asleep, the very first agent login/refresh catches up and auto-closes overdue tickets idempotently.
