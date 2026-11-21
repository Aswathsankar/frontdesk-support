# Frontdesk — Technical Notes, Assumptions & Known Limitations

This document satisfies the hiring assessment review criteria regarding **requirement extraction, edge cases, documented assumptions, incident handling, and honesty about platform constraints.**

---

## 1. Incident-Driven Requirements & Architecture

### INC-0291: Prevention of Concurrent Ticket Claiming
- **Root Cause in Spreadsheet/WhatsApp:** Two agents could open and claim the same ticket simultaneously with neither seeing the other's action.
- **Implementation in Frontdesk:**
  - Claim is executed as an **atomic single SQL statement**:
    ```sql
    UPDATE tickets 
    SET assignee_id = ?, status = 'open', version = version + 1 
    WHERE id = ? AND assignee_id IS NULL;
    ```
  - We inspect `affectedRows`. If `0`, another agent took the ticket a millisecond earlier. The server immediately returns an **HTTP 409 Conflict** with an informative error: `"Ticket is already claimed by <Agent Name>"`.
  - Reassignment is an explicit separate audited action (`POST /api/agent/tickets/:id/reassign`).
  - Optimistic locking using the `version` column is evaluated on status changes to prevent race conditions during updates.
- **Verification:** Tested using `Promise.all` issuing simultaneous claim requests with different agents — exactly one succeeds with 200, the other fails with 409.

---

### INC-0304: Strict Internal Note Leak Prevention
- **Root Cause in WhatsApp:** Private notes and internal technical discussions were accidentally forwarded or visible to customers.
- **Implementation in Frontdesk:**
  - Enforced at the **database layer** via a dedicated SQL View:
    ```sql
    CREATE OR REPLACE VIEW customer_visible_messages AS
    SELECT id, ticket_id, author_type, author_name, body, created_at
    FROM messages
    WHERE visibility = 'public';
    ```
  - The public routes (`/api/public/*`) **never** query the `messages` table directly. They query `customer_visible_messages`.
  - Customer API responses pass through strict **whitelist serializers** (`pickTicketFields`). Fields such as internal IDs, agent internal notes, employee IDs, and internal audit logs are physically absent from customer JSON payloads.
  - Public CSV exports (`GET /api/public/export.csv`) query only public ticket fields and public messages.
  - Error messages return sanitized text and never mirror back unvalidated message bodies.
- **Verification:** An end-to-end canary test creates a ticket with an internal note containing a unique UUID canary string (`INTERNAL_SECRET_CANARY_...`) and asserts that the string never appears in any public endpoint (detail, replies, export, error responses).

---

### INC-0318: Cryptographic Audit Trail & Database Immutability
- **Root Cause in Legacy System:** When tickets breached SLA or disputes arose, neither agents nor customers could prove when messages were sent or who made changes.
- **Implementation in Frontdesk:**
  - Every ticket transition (creation, claim, reassign, customer reply, agent reply, internal note, pause, resume, priority change, resolve, reopen, auto-close) writes an immutable record in `audit_events`.
  - **Cryptographic Hash Chain:**
    $$\text{hash}_n = \text{SHA-256}(\text{hash}_{n-1} + \text{canonicalJSON}(\text{event}))$$
  - **Concurrency Serialization:** Every state-changing transaction performs `SELECT id FROM tickets WHERE id = ? FOR UPDATE` at the beginning of the transaction, ensuring audit sequence numbers cannot fork.
  - **Database-Level Immutability:** Enforced via MySQL `BEFORE UPDATE` and `BEFORE DELETE` triggers that execute `SIGNAL SQLSTATE '45000'` on `audit_events` and `messages`.
- **Honest Platform Limitation on Aiven/MySQL:**
  - In MySQL, `TRUNCATE` bypasses row-level triggers. In an enterprise production cluster, this is resolved by provisioning a dedicated restricted database user without `DROP` or `TRUNCATE` privileges. On managed cloud services where a single administrative user (`avnadmin`) is shared, this constraint is documented here transparently.
  - Trigger immutability was tested by dropping triggers in test environments, modifying rows, restoring triggers, and verifying that `verifyChain` reliably detects the tampered block.

---

## 2. Business Logic Assumptions & Edge Cases

### 2.1 Working-Hours Clock (Mon–Fri, 09:30–18:30 IST)
- **Timezone:** All timestamps are stored in UTC (`DATETIME(3)`) and converted to `Asia/Kolkata` for working-hours calculations using Luxon.
- **Off-Hours Ticket Creation:** Tickets created at night or over the weekend start their SLA clock at 09:30 IST on the next valid working day (skipping weekends and registered Indian holidays).
- **Friday 18:00 Edge Case:** A ticket arriving Friday at 18:00 has 30 working minutes consumed before weekend closing (18:30). Over the weekend, 0 working minutes elapse. On Sunday morning, remaining SLA is identical to Friday 18:30.
- **Indian Holidays:** Managed via the `holidays` table, seeded with 16 public holidays for 2024–2025. Agent endpoints (`/api/agent/holidays`) allow adding and removing holidays dynamically.

### 2.2 SLA Pause / Resume Logic
- A ticket placed in `waiting_on_customer` pauses the SLA clock by recording an open record in `sla_pauses (paused_at, resumed_at = NULL)`.
- When the customer replies, `resumed_at` is set to the current UTC timestamp.
- The new deadline is computed as:
  $$\text{Adjusted Deadline} = \text{Initial Deadline} + \text{Working Minutes Elapsed During Pause}$$
- Pauses starting outside business hours only count working minutes once business hours commence. Multiple pauses accumulate additively.

### 2.3 Priority Changes Mid-Ticket
- **Assumption:** When an agent changes priority mid-ticket (e.g., medium $\rightarrow$ urgent):
  1. Deadlines are recomputed from the **original creation time** using the new priority's SLA, with all past working paused minutes added back.
  2. Upgrading to urgent can make a ticket **retroactively or immediately late**. This is intentional and surfaced clearly in the UI.
  3. If a first response has already been sent, the response SLA is **not retroactively breached**; only the resolution SLA is adjusted.
  4. The event is recorded in `audit_events` with both old and new priorities and deadline timestamps.

### 2.4 Auto-Close Mechanism
- If a ticket remains in `waiting_on_customer` with no customer activity for **5 working days** (2,700 working minutes), it automatically transitions to `closed` with `close_reason = 'auto_closed_no_reply'` and actor `system`.
- **Hybrid Triggering:** Because free-tier server instances (e.g., Render) sleep after inactivity, auto-close is triggered via two complementary mechanisms:
  1. Scheduled cron job (`node-cron`) every 5 minutes (`*/5 * * * *`).
  2. Lazy evaluation: executed during `GET /api/agent/tickets` requests.
  3. Operation is strictly idempotent.

### 2.5 Reopen Window
- Once resolved, a customer can reopen a ticket within **5 working days** of resolution.
- Beyond 5 working days, reopening is rejected with HTTP 400 and a helpful message directing the customer to create a new ticket (with optional `related_ticket_id`).

---

## 3. Technology Stack & Trade-offs

- **Backend:** Node.js 20 + Fastify (v4). Chosen for high throughput, low memory footprint, and native schema validation.
- **ORM & Raw SQL:** Sequelize provides model definitions for simple queries. Raw SQL (`sequelize.query`) with explicit transaction handles is used for atomic updates, locking (`FOR UPDATE`), and cryptographic audit chains.
- **Database:** MySQL 8 with InnoDB engine. Required for native support of triggers and views (reasons PlanetScale / TiDB were avoided).
- **Authentication:** JWT stored in an `httpOnly`, `SameSite=Lax` cookie, signed with a 256-bit secret, and hashed passwords via `bcryptjs`.
- **Frontend:** React 18 + Vite + Material UI (v5). Responsive agent workspace and a dedicated Public Customer Simulator.
