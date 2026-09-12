# Checkpoint Investment Management Platform

Checkpoint is a cloud-based platform designed to digitize, automate, and professionalize the financial management of VICOBA (Village Community Banks) and community investment clubs across East Africa.

**Current production platform:** Vercel  
**Production project:** `checkpoint-dashboard` under the `Checkpoint Investment Club` Vercel team  
**Architecture:** Vercel frontend + Vercel Functions API + MongoDB Atlas

> Historical note: the project previously used Cloudflare Pages with a Railway API. That deployment remains part of the project history, but it is not the active production path as of 12 September 2026.

---

## 🚀 Local Development

This repository contains two main directories: `backend` (Node.js/Express API) and `frontend` (React + Vite).

### Prerequisites
- Node.js v18+
- npm

### 1. Backend

Create `backend/.env`:

```env
PORT=3001
MONGO_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/?appName=checkpoint
JWT_SECRET=your-long-random-secret
SMTP_USER=yourclub@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
FORM_SECRET=your-form-secret
```

> `SMTP_PASS` must be a Gmail App Password, not the account password.

```bash
cd backend
npm install
node server.js
```

API runs at `http://localhost:3001`. The frontend Vite dev server proxies `/api` requests there during local development.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:5173`.

---

## ☁️ Production Deployment

Checkpoint is deployed from GitHub to **Vercel**. The React/Vite frontend and Express API are delivered from the same Vercel project.

### Production Architecture

| Layer | Service |
|---|---|
| Frontend | **Vercel** — React/Vite production build |
| API | **Vercel Functions** — Express app via `api/index.js` |
| Database | **MongoDB Atlas** |
| Authentication | JWT + bcryptjs |
| Email | **Gmail SMTP** via Nodemailer |
| Scheduled automatic fines | **Vercel Cron** → `/api/cron/automatic-fines` |

Key deployment files:

- `vercel.json` — frontend build, routing and scheduled cron configuration.
- `api/index.js` — Vercel serverless entry point exporting the Express application.
- `backend/server.js` — shared Express app; starts a long-running server only outside Vercel.
- `backend/db/mongoose.js` — MongoDB connection handling for the serverless environment.

### Production Environment Variables

Configure required secrets and environment-specific values in Vercel rather than committing them to Git:

| Key | Purpose |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | **Required — no built-in fallback.** JWT signing/verification secret. If this variable is absent, the API intentionally refuses to start rather than fall back to a predictable value — see "Authentication" below. |
| `SMTP_USER` | Club Gmail account |
| `SMTP_PASS` | Gmail App Password |
| `FORM_SECRET` | Shared secret used by the Google Apps Script intake |
| `CRON_SECRET` | Optional protection for cron/manual automation calls |
| `CORS_ORIGIN` | Additional allowed origins when required |
| `CONTROL_DB_NAME` | *(multi-tenancy foundation, dormant)* Logical database name for SaaS-level metadata (organization registry). Defaults to `checkpoint_control`. Reuses the existing Atlas connection — no second cluster. Not required for the current application to boot; see [docs/multitenancy-architecture.md](./docs/multitenancy-architecture.md). |
| `LEGACY_TENANT_DB_NAME` | *(multi-tenancy foundation, optional)* Asserts the expected database name for the existing club's data. If set and it disagrees with what `MONGO_URI` actually connects to, tenancy tooling fails safely instead of guessing. |
| `ALLOW_LEGACY_ORGLESS_TOKENS` | *(Phase 3 auth, temporary)* Defaults to enabled. Controls whether JWTs issued before `organization_id` existed on the payload are still accepted (mapped to the sole Phase 3 runtime organization). Set to `false` to require every token to carry `organization_id`. See [docs/multitenancy-architecture.md](./docs/multitenancy-architecture.md), Section 15 — should be disabled in a later phase once a full token TTL (7 days) has passed since Phase 3 deployed. |

### Deploy

Production is connected to the GitHub `main` branch through the Vercel Git integration:

```bash
git push origin main
```

A successful `main` deployment should show `READY` in the Vercel project.

---

## 💰 Automatic Contribution Fines

From FY2026/2027 onward, the fine amount is a **one-time 15% of the monthly contribution** for each qualifying missed month. With the current TZS 75,000 monthly contribution, this is TZS 11,250.

Automatic fines use a **missing-month-only** rule:

- the deadline must have passed;
- the member must owe that contribution period;
- if **any contribution record exists** for the member/month, no automatic fine is created;
- `paid_date` is ignored when deciding automatic fine eligibility;
- partial contribution records also suppress automatic fine creation;
- an existing paid or unpaid fine for the same period prevents a duplicate;
- a fine is created only when the contribution month is completely missing.

Manual contribution entry and Form Intake posting do **not** create a fine merely because a stored payment date is later than the deadline.

For the full policy and the 12 September 2026 reconciliation record, see **[docs/production-state-2026-09-12.md](./docs/production-state-2026-09-12.md)**.

### Fine reconciliation commands

Dry run:

```bash
cd backend
npm run fines:reconcile
```

Apply reviewed cleanup:

```bash
npm run fines:reconcile:apply
```

Paid erroneous fines must be handled through financial reconciliation rather than silent deletion.

---

## 🔐 Authentication

Members log in with their **email address** and password. The admin account may use the `admin` username as a fallback.

Since Phase 3, the issued JWT also carries `organization_id`, and every authenticated request resolves through the trusted control-plane registry before reaching a route — see [Multi-Tenancy](#-multi-tenancy) and `docs/multitenancy-architecture.md` (Section 15) for the full mechanics. Tokens are signed and verified with `HS256` only.

**`JWT_SECRET` is required, with no built-in fallback.** The application intentionally fails to start if it's missing, rather than falling back to a hardcoded value — this repository is public, so a hardcoded fallback secret would let anyone forge tokens (including admin role and `organization_id` claims, which Phase 3 treats as trusted tenant identity once a token verifies). There is no `NODE_ENV=test` special case in application code either: tests must set their own `JWT_SECRET` before the auth module loads.

---

## 📖 Documentation

- **[PRD.md](./PRD.md)** — Product Requirements Document: vision, constitution rules and feature specifications.
- **[AGENT.md](./AGENT.md)** — AI pair-programming changelog and architecture decisions.
- **[docs/form-intake-verification.md](./docs/form-intake-verification.md)** — Form Intake verification and allocation workflow.
- **[docs/production-state-2026-09-12.md](./docs/production-state-2026-09-12.md)** — Current deployment architecture, automatic-fine policy and reconciliation record.
- **[docs/multitenancy-architecture.md](./docs/multitenancy-architecture.md)** — Multi-tenant architecture: shared Atlas cluster + control DB + database-per-organization, migration phases, and tenant-isolation principles.

---

## 🏢 Multi-Tenancy

The control-plane and tenant-model foundation lives under `backend/tenancy/` (Phases 1–2). **Authentication is now organization-aware** (Phase 3): JWTs carry `organization_id`, and `authenticate` attaches `req.tenant`/`req.tenantModels`. Existing (non-auth) financial routes still query the default/legacy models directly and haven't changed — this is safe today only because exactly one runtime organization (`org_checkpoint_investors`) is permitted, enforced by `backend/tenancy/runtimeOrganization.js`. See [docs/multitenancy-architecture.md](./docs/multitenancy-architecture.md) for the full architecture, the Phase 3 runtime tenancy boundary, and remaining migration phases.

```bash
cd backend
npm run tenancy:baseline          # read-only counts/sums fingerprint of the current database
npm run tenancy:bootstrap         # dry run: register the existing club as the first organization
npm run tenancy:bootstrap:apply   # writes the one registry document (control DB only)
```

`tenancy:bootstrap` defaults to a dry run and never touches existing financial collections; only `--apply` writes, and only to the new control database.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, CSS Variables |
| Backend | Node.js, Express 4 |
| Database | MongoDB Atlas (Mongoose 9) |
| Auth | JWT, bcryptjs |
| Email | Nodemailer + Gmail SMTP |
| PDF Export | jsPDF + jspdf-autotable |
| CSV Export | RFC 4180 compliant (vanilla JS) |
| Production Hosting | Vercel |
| DB Hosting | MongoDB Atlas |
