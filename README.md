# Frontdesk — Support Ticket System

Frontdesk is a full-stack support ticketing web application built to replace an unversioned spreadsheet and chat workflow. It enforces strict business-hours SLA calculations (IST), atomic ticket assignment, cryptographic audit chains, and leak-proof internal communication.

- **Live URL:** https://frontdesk-support.onrender.com
- **Customer Portal:** https://frontdesk-support.onrender.com/customer
- **GitHub:** https://github.com/Aswathsankar/frontdesk-support

---

## Demo Credentials

The database comes pre-seeded with 9 agent accounts. All accounts share the password `Demo@1234`.

| Agent | Role | Email | Password |
|---|---|---|---|
| Aswath Menon | Lead Support Engineer | `aswath@arvo.dev` | `Demo@1234` |
| Rahul Verma | Support Engineer | `rahul@arvo.dev` | `Demo@1234` |
| Anjali Nair | Support Engineer | `anjali@arvo.dev` | `Demo@1234` |
| Karan Patel | Support Engineer | `karan@arvo.dev` | `Demo@1234` |

*(Customers do not need credentials; they access `/customer` to submit tickets, check status by UUID reference, reply, and reopen).*

---

## Architectural Solutions to Past Incidents

The application design directly addresses three critical failure modes identified from operational post-mortems:

### 1. INC-0291: Preventing Race Conditions on Ticket Claim
- **Problem:** Two agents opened the same unassigned ticket at the same time and both started working on it, duplicating effort and confusing the client.
- **Solution:** Ticket claiming is implemented as an atomic SQL write operation:
  ```sql
  UPDATE tickets 
  SET assignee_id = :agentId, status = 'open', version = version + 1 
  WHERE id = :ticketId AND assignee_id IS NULL;
  ```
  If `affectedRows === 0`, another agent claimed the ticket milliseconds prior. The server immediately returns an `HTTP 409 Conflict` with a clear message (`Ticket is already claimed by <Name>`). UI buttons also update optimistically with version checks.

### 2. INC-0304: Zero-Leak Internal Notes
- **Problem:** Private engineering notes and debugging comments were accidentally forwarded or exposed to customers.
- **Solution:** Defense-in-depth isolation at both the database and serialization levels:
  - **Database View:** A dedicated SQL view `customer_visible_messages` filters rows where `visibility = 'public'`. Public customer routes never query the base `messages` table directly.
  - **Allowlist Serialization:** The customer-facing API routes run all outputs through strict serializers (`pickTicketFields`) that physically omit internal IDs, agent employee numbers, and internal audit logs.
  - **Canary Test:** An automated end-to-end integration test posts a unique secret canary string inside an internal note and verifies that it never surfaces in public ticket details, public message lists, or CSV exports.

### 3. INC-0318: Tamper-Proof Cryptographic Audit Trail
- **Problem:** During an SLA breach dispute, the client and the team had conflicting records of when messages were sent and who changed ticket statuses.
- **Solution:** 
  - Every ticket event (creation, claim, note, public reply, pause, resume, priority change, resolve, reopen, auto-close) appends an immutable record into `audit_events`.
  - **Hash Chain:** Each event is linked cryptographically:
    `hash_n = SHA-256(hash_(n-1) + canonical_json(event_payload))`
  - **Row Locking:** State transitions use `SELECT id FROM tickets WHERE id = ? FOR UPDATE` inside a database transaction to prevent audit fork races under high concurrency.
  - **Database Triggers:** MySQL `BEFORE UPDATE` and `BEFORE DELETE` triggers reject any modifications to `audit_events` and `messages` by raising `SQLSTATE '45000'`.
  - Reviewers can verify the chain anytime via the UI "Audit Log" modal or via `GET /api/agent/tickets/:id/audit`.

---

## SLA & Working-Hours Logic

Support hours are configured strictly as **Monday through Friday, 09:30 to 18:30 IST (Asia/Kolkata)**.

- **Timezone Management:** All database records store UTC timestamps (`DATETIME(3)`). The working-hours engine converts times to `Asia/Kolkata` for calculation.
- **Off-Hours Submissions:** Tickets submitted on a weekend, holiday, or after 18:30 IST start their SLA countdown at 09:30 IST on the next business day.
- **Weekend / Holiday Exclusion:** Clocks pause at Friday 18:30 IST and resume Monday 09:30 IST. A table of 16 national holidays is seeded in the database and automatically bypassed.
- **SLA Tiers:**
  - **Urgent:** 120 working minutes first response; resolution by the end of the same working day.
  - **Medium:** 270 working minutes first response; resolution within 3 working days (1,620 working minutes).
  - **Low:** 540 working minutes first response; resolution within 5 working days (2,700 working minutes).
- **Pauses & Auto-Close:**
  - Marking a ticket `waiting_on_customer` pauses the SLA resolution clock. When the customer replies, the clock resumes with elapsed working minutes added to the target deadline.
  - If a ticket remains in `waiting_on_customer` for 5 consecutive working days without customer reply, it automatically transitions to `closed` with actor `system`.
  - Resolved tickets can be reopened by the customer within 5 working days. After 5 working days, reopening is rejected, advising the customer to open a new ticket.

---

## Tech Stack

- **Backend:** Node.js 20, Fastify 4, Sequelize 6 (models & raw queries with transactional row locks), MySQL 8 InnoDB, bcryptjs, @fastify/jwt.
- **Frontend:** React 18, Vite 5, Material-UI (v5 Dark Theme), Formik + Yup, Axios.
- **Database & Hosting:** Aiven MySQL 8 (InnoDB triggers & views), Render (Dockerized web service).
- **Testing:** Vitest (pure unit tests for working hours + integration tests).

---

## Local Development Setup

### Option 1: Docker Compose (Quickest)

```bash
git clone https://github.com/Aswathsankar/frontdesk-support.git
cd frontdesk-support

docker-compose up --build
```
Open http://localhost:3000 in your browser.

---

### Option 2: Running with Local Node & MySQL

```bash
# 1. Backend setup
cd backend
npm install

# Create backend/.env:
DATABASE_URL=mysql://<user>:<password>@<host>:<port>/<dbname>
JWT_SECRET=any-random-32-character-secret-string
PORT=3000
NODE_ENV=development

# 2. Database migrations and initial seed
npm run migrate
npm run seed

# 3. Build the frontend
cd ../frontend
npm install
npm run build

# 4. Start the server
cd ../backend
npm start
```
Open http://localhost:3000 in your browser.

---

## Running Automated Tests

```bash
cd backend

# Pure unit tests (working-hours calculations & SLA engine - runs instantly without DB)
npx vitest run tests/workingHours.test.js tests/sla.test.js

# Full test suite (requires running MySQL instance)
npm test
```

---

## What I Didn't Finish & Why (Assessment Note)

Given the ~8-hour target allocation, I focused my time heavily on getting the core domain rules right: accurate working-hours mathematics, rock-solid concurrency control (atomic claims), database-level security (views & immutability triggers), and an intuitive UI for both agents and customers.

Here are the features I consciously deferred and the reasoning behind each:

1. **WebSockets / Server-Sent Events (SSE):**
   - *Why deferred:* Building a WebSocket layer with pub/sub (Redis) to push ticket changes in real time would have consumed substantial time without improving core business logic. Instead, I implemented reactive REST polling, optimistic state updates, and an explicit refresh action.
2. **File & Screenshot Attachments on Tickets:**
   - *Why deferred:* Secure file uploads require an S3-compatible object store, presigned URLs, file type validation, and virus scanning. Keeping tickets text-based kept the project self-contained and reproducible locally with a single `docker-compose up` command.
3. **Database-Level Role Separation (Restricted App User):**
   - *Why deferred:* MySQL `TRUNCATE` operations can bypass row-level triggers. In production, this is guarded by creating a restricted DB role without `DROP`/`TRUNCATE` grants. On a managed free-tier database with a single administrative user (`avnadmin`), I relied on application-level enforcement and documented the constraint in `NOTES.md`.
