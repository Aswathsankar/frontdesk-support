# Frontdesk — Assessment Submission Guide

**Candidate Assignment:** Support Ticket System ("Frontdesk")  
**Target Organization:** iNav Technologies  
**GitHub Repository:** [https://github.com/Aswathsankar/frontdesk-support](https://github.com/Aswathsankar/frontdesk-support)  
**Branch:** `main`

---

## 1. Project Verification Summary

| Component | Status | Verification Detail |
|---|---|---|
| **Database (Aiven MySQL 8)** | **LIVE** | 7 migration scripts executed; InnoDB triggers & views created. |
| **Seed Data** | **LIVE** | 9 agents, 16 Indian holidays, 15 edge-case tickets seeded in `defaultdb`. |
| **Working Hours Engine** | **PASS** | 49 unit tests passed: Mon–Fri 09:30–18:30 IST, holiday/weekend exclusion. |
| **Incident INC-0291** | **PASS** | Atomic claim `UPDATE ... WHERE assignee_id IS NULL` + 409 conflict handling. |
| **Incident INC-0304** | **PASS** | `customer_visible_messages` SQL VIEW + whitelist serialization. |
| **Incident INC-0318** | **PASS** | Append-only SHA-256 hash chains + MySQL triggers blocking UPDATE/DELETE. |
| **Frontend UI (React + Vite)** | **BUILT** | Production bundle compiled into `frontend/dist/`. Fastify serves SPA statically. |
| **Local End-to-End Test** | **PASS** | Server started, connected over TLS, `/health` and `/api/public/export.csv` tested. |
| **Git & GitHub** | **PUSHED**| All source code, migrations, tests, and documentation committed to `main`. |

---

## 2. Seeded Agent Credentials (for Reviewers)

All 9 agents share the demo password: `Demo@1234`

- `priya@arvo.dev`
- `rahul@arvo.dev`
- `anjali@arvo.dev`
- `karan@arvo.dev`
- `deepika@arvo.dev`
- `arjun@arvo.dev`
- `sneha@arvo.dev`
- `vikas@arvo.dev`
- `meera@arvo.dev`

---

## 3. Public Customer Portal (No Login Required)

- **Route:** `/customer`
- Reviewers can test the complete customer lifecycle without authentication:
  - Submit new tickets (returns UUID `customer_ref`)
  - Look up ticket status and review public response timelines
  - Reply as the customer (resumes paused SLA clocks)
  - Reopen resolved tickets (enforcing the 5-working-day window rule)

---

## 4. Key Documentation Files in the Repository

1. **[README.md](https://github.com/Aswathsankar/frontdesk-support/blob/main/README.md):** Full setup guide, architecture overview, feature list, and Docker commands.
2. **[NOTES.md](https://github.com/Aswathsankar/frontdesk-support/blob/main/NOTES.md):** Detailed analysis of business requirements, assumptions on priority changes mid-ticket, edge case handling, and honest disclosure of platform limits.
3. **[INTERVIEW.md](https://github.com/Aswathsankar/frontdesk-support/blob/main/INTERVIEW.md):** Deep-dive technical explanations tailored for the code review and system design interview round.

---

## 5. Render Deployment Instructions (5 Minutes)

To deploy live on Render's free tier:

1. Log into [Render Dashboard](https://dashboard.render.com).
2. Click **New +** $\rightarrow$ **Web Service**.
3. Select your GitHub repository: `Aswathsankar/frontdesk-support`.
4. Configure the service:
   - **Name:** `frontdesk-support`
   - **Region:** Singapore (or closest to India)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:**
     ```bash
     cd frontend && npm install && npm run build && cd ../backend && npm install
     ```
   - **Start Command:**
     ```bash
     cd backend && node src/server.js
     ```
5. Add **Environment Variables** in the Render settings panel:
   - `DATABASE_URL`: `mysql://avnadmin:<password>@mysql-10e72436-aswathmenon111-ad57.g.aivencloud.com:17525/defaultdb`
   - `DB_SSL_CA_CONTENT`: *(Copy and paste the full text of `aiven-ca.pem`)*
   - `JWT_SECRET`: `arvo-systems-secure-frontdesk-token-secret-32c`
   - `NODE_ENV`: `production`
   - `PORT`: `3000`
   - `FRONTEND_DIST`: `../../frontend/dist`
6. Click **Create Web Service**. Render will build and deploy the app at `https://frontdesk-support.onrender.com`.
