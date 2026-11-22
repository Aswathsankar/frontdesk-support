# Frontdesk — Technical Notes & Architecture Decisions

This document details the edge cases, business logic assumptions, and technical trade-offs made during the development of Frontdesk.

---

## 1. Incident Handling & Architectural Safeguards

### INC-0291: Preventing Concurrent Ticket Claims
- **Root Cause:** Two agents opening the same ticket from a shared spreadsheet/chat and working on it simultaneously without mutual visibility.
- **Implementation:**
  - Ticket claiming is executed as an **atomic SQL statement**:
    ```sql
    UPDATE tickets 
    SET assignee_id = ?, status = 'open', version = version + 1 
    WHERE id = ? AND assignee_id IS NULL;
    ```
  - We evaluate `affectedRows`. If `0`, another agent claimed the ticket first. The server returns an **HTTP 409 Conflict** with an informative message (`Ticket is already claimed by <Agent Name>`).
  - Optimistic concurrency control using the `version` column is also enforced on status transitions to prevent race conditions during updates.
  - Reassignment is an explicit separate audited action (`POST /api/agent/tickets/:id/reassign`).
- **Testing:** Verified with simultaneous asynchronous claim requests using different agent sessions — exactly one receives a 200 OK while the other receives a 409 Conflict.

---

### INC-0304: Leak-Proof Internal Notes
- **Root Cause:** Internal notes containing technical debugging or private team context were mistakenly exposed to customers.
- **Implementation:**
  - Enforced at the **database layer** via a dedicated SQL View:
    ```sql
    CREATE OR REPLACE VIEW customer_visible_messages AS
    SELECT id, ticket_id, author_type, author_name, body, created_at
    FROM messages
    WHERE visibility = 'public';
    ```
  - Public routes (`/api/public/*`) never query the base `messages` table directly; they only query `customer_visible_messages`.
  - Customer API responses pass through strict whitelist serializers (`pickTicketFields`). Internal database IDs, agent notes, employee IDs, and internal audit logs are physically omitted from public payloads.
  - Public CSV exports (`GET /api/public/export.csv`) only export public tickets and public comments.
  - API errors sanitize internal error messages and never echo unvalidated message content.
- **Testing:** An automated canary test writes an internal note with a unique UUID canary string (`INTERNAL_SECRET_CANARY_...`) and verifies that this string never surfaces in public ticket details, public message lists, or CSV exports.

---

### INC-0318: Cryptographic Audit Trail & Database Immutability
- **Root Cause:** In SLA dispute cases, neither party had tamper-evident proof of when messages were sent or who modified ticket statuses.
- **Implementation:**
  - Every ticket transition (creation, claim, reassign, customer reply, agent reply, internal note, pause, resume, priority change, resolve, reopen, auto-close) writes an immutable record in `audit_events`.
  - **Cryptographic Hash Chain:**
    `hash_n = SHA-256(hash_(n-1) + canonicalJSON(event))`
  - **Concurrency Serialization:** Every state-changing transaction acquires an exclusive lock via `SELECT id FROM tickets WHERE id = ? FOR UPDATE` at the beginning of the transaction, ensuring audit sequence numbers cannot branch or fork under high load.
  - **Database Triggers:** MySQL `BEFORE UPDATE` and `BEFORE DELETE` triggers reject any modifications to `audit_events` and `messages` by raising `SQLSTATE '45000'`.
- **Platform Consideration on Managed MySQL:**
  - In MySQL, `TRUNCATE` operations bypass row-level triggers. In an enterprise production cluster, this is resolved by revoking `DROP` and `TRUNCATE` privileges from the application database role. On cloud instances with a single administrative user (`avnadmin`), application-level constraints and database triggers protect the records.
  - Immutability was tested by attempting direct updates/deletions on audit events in tests and verifying that the MySQL trigger rejects the query with an error.

---

## 2. Business Logic Assumptions & Edge Cases

### 2.1 Working-Hours Clock (Mon–Fri, 09:30–18:30 IST)
- **Timezone Handling:** All timestamps are stored in UTC (`DATETIME(3)`) and converted to `Asia/Kolkata` for working-hours calculations using Luxon.
- **Off-Hours Submissions:** Tickets created after 18:30 IST or over weekends/holidays start their SLA countdown at 09:30 IST on the next valid business day.
- **Weekend / Friday Cutoff:** A ticket arriving on Friday at 18:00 IST consumes 30 working minutes before the 18:30 cutoff. During the weekend, 0 working minutes elapse. On Monday at 09:30, the remaining SLA is identical to Friday 18:30.
- **Holiday Calendar:** Managed via the `holidays` table, seeded with 16 public holidays. Clocks skip holidays just like weekends.

### 2.2 SLA Pause & Resume Logic
- Marking a ticket `waiting_on_customer` pauses the SLA clock by recording an open record in `sla_pauses (paused_at, resumed_at = NULL)`.
- When the customer replies, `resumed_at` is set to the current UTC timestamp.
- The new deadline is computed as:
  `Adjusted Deadline = Initial Deadline + Working Minutes Elapsed During Pause`
- Pauses starting outside working hours only accumulate working minutes once business hours commence. Multiple pause intervals accumulate additively.

### 2.3 Priority Changes Mid-Ticket
- When an agent changes priority mid-ticket (e.g. Medium -> Urgent):
  1. Deadlines are recalculated from the **original creation time** using the new priority's SLA, with all past working paused minutes added back.
  2. Upgrading to Urgent can make an open ticket immediately late if the new threshold has already passed. This is intentional and clearly highlighted with a "LATE" badge.
  3. If a first response was already sent, the response SLA is not retroactively breached; only the resolution SLA is adjusted.
  4. The change is recorded in `audit_events` with both old and new priorities and deadline timestamps.

### 2.4 Auto-Close Mechanism
- If a ticket remains in `waiting_on_customer` without a customer reply for **5 consecutive working days** (2,700 working minutes), it automatically closes with `close_reason = 'auto_closed_no_reply'` and actor `system`.
- **Handling Free-Tier Instance Sleep:** Free-tier cloud instances sleep during periods of inactivity. To ensure reliable auto-close, Frontdesk uses a hybrid approach:
  1. A scheduled cron job running every 5 minutes (`*/5 * * * *`).
  2. Lazy evaluation triggered during agent ticket dashboard loads (`GET /api/agent/tickets`).
  3. The auto-close query is strictly idempotent (`WHERE status = 'waiting_on_customer' AND ...`).

### 2.5 Reopen Window
- Once resolved, a customer can reopen a ticket within **5 working days** of resolution.
- Beyond 5 working days, reopening is rejected with an HTTP 400 error advising the customer to open a new ticket.

---

## 3. Technology Stack & Trade-offs

- **Backend:** Node.js 20 + Fastify (v4). Chosen for high performance, low overhead, and clear plugin architecture.
- **Database Access:** Sequelize 6 provides model mapping, combined with raw SQL queries using transaction handles for atomic operations, row-level locks (`FOR UPDATE`), and cryptographic audit chains.
- **Database:** MySQL 8 with InnoDB engine, required for native trigger and view support.
- **Authentication:** JWT stored in an `httpOnly`, `SameSite=Lax` cookie with passwords hashed via `bcryptjs`.
- **Frontend:** React 18 + Vite + Material UI (MUI v5 Dark Theme) with responsive views for agents and a public customer portal.
