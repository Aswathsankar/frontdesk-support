# Frontdesk — Support Ticket Management System

**Frontdesk** is a production-ready support ticket system built for **Arvo Systems** as part of the hiring assessment at **iNav Technologies**.

It replaces an unversioned spreadsheet + WhatsApp workflow with strict SLA tracking, business-hours calculation (IST), atomic ticket claiming, cryptographic audit chains, and leak-proof internal notes.

---

## 🌟 Key Features

1. **Working-Hours SLA Engine (Asia/Kolkata):**
   - Business Hours: **09:30 – 18:30 IST**, Monday through Friday.
   - Weekends and registered Indian national holidays are completely excluded from SLA clocks.
   - Pure, injectable clock module with 100% test coverage.
2. **SLA Categories & Pause/Resume:**
   - **Urgent:** 120 working min first response; resolution by end of the same working day.
   - **Medium:** 270 working min first response; resolution in 3 working days (1,620 min).
   - **Low:** 540 working min first response; resolution in 5 working days (2,700 min).
   - `waiting_on_customer` status stops the SLA clock; customer reply resumes it automatically.
3. **Incident INC-0291 (Atomic Claiming):**
   - Atomic SQL `UPDATE ... WHERE assignee_id IS NULL`. Prevents race conditions with HTTP 409 Conflict.
4. **Incident INC-0304 (Internal Note Leak Prevention):**
   - Enforced at database level via `customer_visible_messages` SQL VIEW.
   - Customer API endpoints never query the raw `messages` table and use strict allowlist serialization.
5. **Incident INC-0318 (Cryptographic Audit Immutability):**
   - Append-only hash chain: $\text{hash}_n = \text{SHA-256}(\text{hash}_{n-1} + \text{canonicalJSON})$.
   - MySQL `BEFORE UPDATE` and `BEFORE DELETE` triggers reject any modifications with SQLSTATE `45000`.
   - Built-in audit verification endpoint (`GET /api/agent/audit/verify`).
6. **Auto-Close & Reopen Window:**
   - Tickets waiting on customers for 5 working days without a response are automatically closed.
   - Resolved tickets can only be reopened within 5 working days; subsequent requests are rejected with guidance to open a new ticket.
7. **Customer Simulator (No Login Required):**
   - A dedicated public portal at `/customer` allows reviewers to simulate customer ticket creation, UUID lookups, replies, and reopen flows.

---

## 🏗️ Technology Stack

- **Backend:** Node.js 20, Fastify 4, Sequelize 6 (models + raw SQL inside transactions), MySQL 8 (InnoDB), bcryptjs, @fastify/jwt.
- **Frontend:** React 18, Vite 5, Material UI (MUI v5 Dark Theme), Formik + Yup, Axios.
- **Infra & Testing:** Docker, Docker Compose, Vitest, GitHub Actions CI.
- **Database:** Hosted on Aiven MySQL (supports native InnoDB triggers and views).

---

## 🔑 Demo Agent Logins

All 9 agents are pre-seeded in the database:

| Agent Name | Email | Password |
|---|---|---|
| Aswath Menon (Lead) | `aswath@arvo.dev` | `Demo@1234` |
| Rahul Verma | `rahul@arvo.dev` | `Demo@1234` |
| Anjali Nair | `anjali@arvo.dev` | `Demo@1234` |
| Karan Patel | `karan@arvo.dev` | `Demo@1234` |
| Deepika Rao | `deepika@arvo.dev` | `Demo@1234` |
| Arjun Singh | `arjun@arvo.dev` | `Demo@1234` |
| Sneha Kulkarni | `sneha@arvo.dev` | `Demo@1234` |
| Vikas Gupta | `vikas@arvo.dev` | `Demo@1234` |
| Meera Iyer | `meera@arvo.dev` | `Demo@1234` |

---

## 🚀 Local Development Setup

### Option 1: Running with Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/Aswathsankar/frontdesk-support.git
cd frontdesk-support

# Run both MySQL 8 and the application
docker-compose up --build
```
Access the application at `http://localhost:3000`.

---

### Option 2: Running Locally with Node.js & Existing MySQL

```bash
# 1. Install backend dependencies
cd backend
npm install

# 2. Configure environment
# Create backend/.env:
DATABASE_URL=mysql://<user>:<password>@<host>:<port>/<dbname>
JWT_SECRET=your-random-32-character-secret
PORT=3000
NODE_ENV=development

# 3. Run database migrations & seeds
npm run migrate
npm run seed

# 4. Build the React frontend
cd ../frontend
npm install
npm run build

# 5. Start the backend server
cd ../backend
npm start
```
Open `http://localhost:3000` in your browser.

---

## 🧪 Running Tests

```bash
cd backend

# Run pure unit tests (working-hours math & SLA deadlines - no DB required)
npx vitest run tests/workingHours.test.js tests/sla.test.js

# Run integration tests (against configured MySQL instance)
npm test
```

---

## 🌐 Deploying to Render

1. Create a new **Web Service** on [Render](https://render.com).
2. Connect your repository: `Aswathsankar/frontdesk-support`.
3. Set the following options:
   - **Environment:** `Node`
   - **Build Command:** `cd frontend && npm install && npm run build && cd ../backend && npm install`
   - **Start Command:** `cd backend && node src/server.js`
4. Set Environment Variables in Render:
   - `DATABASE_URL`: `mysql://avnadmin:<password>@<aiven-host>:17525/defaultdb`
   - `DB_SSL_CA_CONTENT`: *[Paste the complete text of the Aiven CA Certificate]*
   - `JWT_SECRET`: *[A random 32-character string]*
   - `NODE_ENV`: `production`
   - `PORT`: `3000`
   - `FRONTEND_DIST`: `../../frontend/dist`

---

## 📂 Project Structure

```
frontdesk/
├── backend/
│   ├── certs/                 # TLS CA Certificates (git-ignored)
│   ├── src/
│   │   ├── config/            # Business hours & SLA constants, environment config
│   │   ├── db/
│   │   │   ├── migrations/    # Numbered SQL files (tables, views, immutability triggers)
│   │   │   ├── models/        # Sequelize models
│   │   │   ├── connection.js  # Sequelize connection factory with TLS & UTC enforcement
│   │   │   ├── runner.js      # Migration runner
│   │   │   └── seed.js        # 9 agents, 16 holidays, ~15 test tickets
│   │   ├── lib/
│   │   │   └── workingHours.js# Pure business-hours math (Asia/Kolkata)
│   │   ├── routes/
│   │   │   ├── auth.js        # Login, logout, current user (/api/auth)
│   │   │   ├── agentTickets.js# Claim, reply, notes, priority, resolve (/api/agent)
│   │   │   ├── publicTickets.js# Customer ticket create, reply, reopen, CSV (/api/public)
│   │   │   └── holidays.js    # Holiday management (/api/agent/holidays)
│   │   ├── services/
│   │   │   ├── auditService.js# Cryptographic hash chain & verification
│   │   │   ├── slaService.js  # Deadline calculations, pauses, breaches
│   │   │   └── ticketService.js# Core business logic & transaction handling
│   │   ├── app.js             # Fastify application builder
│   │   └── server.js          # HTTP server entrypoint
│   └── tests/                 # Vitest test suites
├── frontend/
│   ├── src/
│   │   ├── api/               # Axios API client instances (agent & public)
│   │   ├── pages/
│   │   │   ├── Login.jsx      # Agent authentication portal
│   │   │   ├── TicketList.jsx # Agent ticket dashboard with SLA countdowns & badges
│   │   │   ├── TicketDetail.jsx# Timeline view, public replies & team-only notes
│   │   │   └── CustomerSimulator.jsx # Public customer test simulator
│   │   ├── App.jsx            # Routing & Auth Context
│   │   └── main.jsx           # MUI theme provider & React root
├── docker-compose.yml         # Containerized local environment
├── Dockerfile                 # Multi-stage production build
├── .github/workflows/ci.yml   # GitHub Actions automated test & lint pipeline
├── NOTES.md                   # Documented assumptions & edge case handling
└── INTERVIEW.md               # Technical review & system design guide
```
