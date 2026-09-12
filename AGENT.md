# Agent Change Tracker (AGENT.md)

This document is the authoritative ledger of all modifications, architectural decisions, business rule changes, and feature implementations across all AI pair programming sessions for the Checkpoint platform.

> **Current production baseline (12 September 2026):** Checkpoint is deployed on **Vercel** as a combined React/Vite frontend and Express/Vercel Functions API, backed by MongoDB Atlas. Automatic contribution fines use the **missing-month-only** rule documented in Version 1.6.0 below. Older Cloudflare/Railway and date-based fine entries are retained as historical records and are superseded for current production operation.

---

## Version 1.0.0
**Date:** March/April 2026  
**Status:** ✅ Live — MVP Core Functionalities

- Initial deployment of Checkpoint Dashboard.
- Member, Loan, Contribution, and Transaction trackers.
- LowDB for local storage persistence.
- JWT authentication with role-based access (Admin / Member).
- Business rules at time of build:
  - Loan interest: 5% flat
  - Repayment period: 4 months
  - Late fine: TZS 3,500 flat per month
  - Entry fee: TZS 100,000 (all members)

---

## Version 1.1.0
**Date:** April 2026  
**Status:** ✅ Live — Scale & Architecture Upgrades

- **Database Migration**: Transitioned from LowDB (flat JSON file) to **MongoDB Atlas** for multi-tenant SaaS capabilities, race-condition safety, and cloud persistence.
- **ID Preservation**: Legacy IDs preserved using `mongoose-sequence` during migration.
- **CSV Bulk Import**: Dynamic bulk-import for Admins — Members, Contributions, Loans via CSV upload.
  - System maps CSV columns to entity schemas.
  - Generates downloadable CSV templates per collection.
- **Stack confirmed:** React + Vite (frontend) · Node.js + Express (backend) · MongoDB Atlas (database).

---

## Version 1.2.0
**Date:** April 2026  
**Status:** ✅ Implemented — Constitution Rules Applied (FY2026)

### Business Logic Overhaul — Checkpoint Investors Club Constitution

All five core financial rules have been updated to match the **ratified club constitution** (Katiba ya Kikundi cha Checkpoint Investors Club, February 26, 2023). These rules are effective from **FY2026 (March 1, 2026)** onward.

#### Rules Changed

| Rule | Previous Value | New Value (Constitution) | Applies From |
|---|---|---|---|
| Loan Interest Rate | 5% flat | **12% flat** (deducted upfront) | FY2026 |
| Loan Repayment Period | 4 months | **6 months** | FY2026 |
| Late Contribution Fine | TZS 3,500 flat/month | **15% of contribution amount/month** | FY2026 |
| Maximum Loan Amount | Unlimited | **80% of member's total contributions** | FY2026 |
| New Member Entry Fee | TZS 100,000 | **TZS 500,000** (founding members retain TZS 100,000) | Immediate |

#### Rules Added (New — from Constitution)

| Rule | Value | Source |
|---|---|---|
| Overdue Penalty (month 7+) | +10% of original principal per month | Enforcement decision |
| Welfare Fund | TZS 50,000 per qualifying event (death, wedding, birth, illness) | Constitution Art. 8.2d |
| Minimum Loans Obligation | Each member must take at least 1 loan per fiscal year | Constitution Art. 4.5 |
| Leadership Tenure | 2-year terms, max 2 consecutive terms | Constitution Art. 6.3 |
| Member Removal Trigger | 4 consecutive months of missed contributions | Constitution Art. 4.6 |

#### System Enforcement (Backend)

Historical April 2026 behavior recorded here is superseded where noted by Version 1.6.0.

- `POST /api/loans` — rejects loan if `principal > member_total_contributions × 0.80`
- `POST /api/contributions` — historically auto-calculated a fine from contribution timing; **superseded in Version 1.6.0 by missing-month-only automation**.
- `GET /api/contributions/fine-preview` — historical fine-preview endpoint; date-based fine creation is disabled in Version 1.6.0.
- `GET /api/loans/rules` — returns current constitution rules as JSON.
- `welfare_events` — collection added to MongoDB schema.
- `POST /api/summary/welfare` — create welfare event.
- `PATCH /api/summary/welfare/:id` — approve welfare event; auto-creates transaction record.

#### Frontend Changes

- **Loans view** — constitution rules banner; live loan preview in issue modal (shows received amount, 12% interest, 6-month deadline); 80% cap indicator per member in dropdown; penalty column for overdue loans; overdue rows highlighted red.
- **Contributions view** — historical fine-preview behavior was added in April; date-based fine eligibility is superseded by Version 1.6.0.
- **Members view** — `max_loan_eligible` field displayed per member card (80% of contributions).

#### Historical Data Note

Loans seeded from FY2024 and FY2025 retain their original 5% interest rate as they were issued under prior operating rules. All new loans issued from the platform use 12%.

---

## Version 1.3.0
**Date:** April 2026
**Status:** ✅ Live — Data Export & Communications Engine

### Data Export

- **Summary PDF** (`exportSummaryPDF`): Branded jsPDF document built in `frontend/src/utils/exporter.js`. Includes KPI stat boxes, Capital Structure table, Active Loans table, and a branded footer. Downloaded via single-click button in Overview.
- **Summary CSV** (`exportSummaryCSV`): RFC 4180 compliant group financials CSV.
- **Contributions CSV** (`exportContributionsCSV`): Full monthly matrix grid per fiscal year.
- All export buttons are admin-only and surfaced inline in each view header.

### Email Communications Engine

- **`backend/utils/mailer.js`**: nodemailer Gmail SMTP transport. Falls back to console mock mode when `SMTP_USER`/`SMTP_PASS` env vars are absent. Branded HTML email layout matches dashboard UI — gradient header, info tables, amber warning boxes, dark footer.
- **Three email types**:
  - `sendDeadlineReminder` — unpaid contribution reminder (period = previous month, deadline = 5th of current month).
  - `sendFinancialReport` — club financial statement as a PDF attachment.
  - `sendWelcome` — new member onboarding with login credentials and portal link.
- **`backend/routes/mailer.js`** — three admin-only endpoints:
  - `POST /api/mailer/broadcast-reminders` — emails all members with unpaid contributions for the previous month.
  - `POST /api/mailer/broadcast-statement` — generates and emails the PDF summary to all members.
  - `POST /api/mailer/broadcast-credentials` — creates user accounts and emails login credentials to members.
- **Frontend buttons**: "⬇ CSV", "⬇ PDF", "✉ Email to Club" on Overview; "⬇ CSV", "🔔 Broadcast Reminders" on Contributions.

### Member Email Addresses

- `email` field added to Member schema (non-breaking, `default: null`).
- PATCH `/api/members/:id` updated to accept `email` field.
- Member email addresses populated from the club registration data during setup.

---

## Version 1.4.0
**Date:** April 2026
**Status:** ✅ Live — Production Deployment & Auth Upgrade

### Production Deployment (Vercel — zero additional cost)

- **`vercel.json`** at repo root: configures build command (`cd frontend && npm install && npm run build`), output directory (`frontend/dist`), SPA rewrites and API routing to the serverless function.
- **`api/index.js`** at repo root: Vercel serverless function entry point — exports the Express app (`require('../backend/server')`).
- **`backend/server.js`**: only calls `app.listen()` when `process.env.VERCEL !== '1'`; exports `app` for serverless.
- **`backend/db/mongoose.js`**: connection cached so warm Vercel function invocations reuse the MongoDB connection.
- **CORS**: dynamic origin handling supports local development and deployed origins.
- **Root `package.json`**: backend dependencies listed at repo root so Vercel can install them for the serverless function.

### Authentication Upgrade

- **Email-based login**: `POST /api/auth/login` accepts email address or username fallback for admin.
- **`email` field on User schema**: added for direct account lookup.
- **`POST /api/auth/set-email`**: admin-only endpoint to set a user's email field.
- Member account invitation/credential workflows use the mailer routes.
- **Login page**: field changed from "Username" to "Email address" while retaining admin username fallback.

### Bug Fixes

- **`mongoose-sequence` replaced** with a custom counter-based auto-increment (`getNextId` + `addAutoIncrement` in `models.js`) for compatibility with Mongoose v9 and serverless execution.
- Auth writes adjusted to avoid incompatible save-hook behavior.
- MongoDB Atlas network access configured for the deployed runtime.

---

## Version 1.5.0 Planning / Handoff
**Date:** June 26, 2026
**Status:** 🕘 Historical deployment snapshot — Cloudflare frontend + Railway API (superseded by Version 1.6.0)

### Historical Situation

At this point in June 2026:

- The replacement frontend was live at `https://checkpoint-investmentclub.pages.dev`.
- The Express API was live at `https://backend-production-3d964.up.railway.app`.
- MongoDB Atlas remained the production database.
- The project was cloned locally from `https://github.com/jkidune/checkpoint-dashboard.git` into `C:\Users\HP PAVILION 15\Documents\Checkpoint 2\checkpoint-dashboard`.
- Local frontend and backend were started successfully during the session:
  - Frontend: `http://127.0.0.1:5173`
  - Backend API: `http://127.0.0.1:3001/api/health`
- Local MongoDB Atlas connection was configured through `backend/.env`.
- `backend/.env` is ignored by Git and should remain uncommitted.

### Local Development Notes

Backend:

```bash
cd backend
npm install
node server.js
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Important: the backend is not run through Vite. Vite is only the React frontend dev server. The backend is an Express API and runs with `node server.js` / `npm run dev` from the `backend` folder.

### Historical Cloudflare/Railway Hosting Decision

The June 2026 short-term plan was:

| Layer | Short-Term Plan |
|---|---|
| Frontend | Cloudflare Pages |
| Backend | Railway |
| Database | MongoDB Atlas |
| Email | Nodemailer + Gmail SMTP |

Related compatibility work included support for `VITE_API_BASE_URL`, Cloudflare Pages SPA redirects and CORS allowances for `*.pages.dev`.

This architecture is retained in the repository for historical compatibility but is not the active production architecture as of 12 September 2026.

### Google Form Issue and Intake Direction

The June 2026 handoff identified an issue where form labels could map incorrectly to monthly contribution versus loan repayment. Subsequent work evolved this into the staged Form Intake verification and allocation workflow documented in `docs/form-intake-verification.md`.

### Product Roadmap Discussed

The product direction remains to evolve Checkpoint from a club dashboard into a SaaS product for VICOBA/investment clubs, including stronger auditability, communications, member self-service and multi-tenancy.

---

## Version 1.6.0
**Date:** 12 September 2026  
**Status:** ✅ Live — Vercel Production + Missing-Month Fine Policy + Reconciliation Complete

### Current Production Architecture

- Production is deployed from GitHub `main` to the Vercel project `checkpoint-dashboard` under the `Checkpoint Investment Club` team.
- Frontend: React/Vite production build on Vercel.
- API: Express application running through Vercel Functions via `api/index.js`.
- Database: MongoDB Atlas.
- Email: Nodemailer + Gmail SMTP.
- Scheduled automatic contribution-fine scan: Vercel Cron → `/api/cron/automatic-fines`.
- The previous Cloudflare Pages + Railway setup is historical and is not the active production path.

### Corrected Automatic Fine Policy

Automatic fines from FY2026/2027 onward follow the **missing-contribution-month-only** rule:

1. The contribution deadline must have passed.
2. The member must owe the contribution period, including the member join-period guard.
3. If **any contribution record exists** for that member/month, no automatic fine is created.
4. Full and partial contribution records both suppress automatic fine creation.
5. Stored `paid_date` is deliberately ignored for automatic fine eligibility.
6. If an existing fine already exists for the same member/month — paid, unpaid or manual — no duplicate is created.
7. Only a completely missing contribution month creates one automatic fine.
8. The fine remains one-time per month and does not compound.

The constitutional fine rate remains 15% of the monthly contribution. With the current TZS 75,000 contribution, the monthly fine is TZS 11,250.

### Legacy Date-Based Fine Trigger Disabled

- Legacy `paid_date > deadline` automatic fine behavior is disabled globally.
- Manual contribution posting no longer creates a fine merely because the stored payment date is late.
- Form Intake posting no longer assesses a new fine from the contribution payment date.
- Form Intake may still allocate cash to **existing** unpaid fines as part of a verified receipt allocation.

### Reconciliation Tooling

Maintenance scripts added to `backend/package.json`:

```bash
npm run fines:reconcile
npm run fines:reconcile:apply
```

The default command is a dry run. The apply command is intended only after review. Paid erroneous fines are never silently deleted because associated cash may already have affected the ledger.

### Production Reconciliation — 12 September 2026

A production audit of automatic fines produced the following result:

| Measure | Result |
|---|---:|
| Automatic fines scanned | 33 |
| Confirmed erroneous date-based fines | 14 |
| Unpaid erroneous fines safely removed | 14 |
| Paid erroneous fines requiring manual reconciliation | 0 |
| Legitimate missing-month fines retained | 19 |
| Total erroneous unpaid amount removed | TZS 157,500 |

The 14 removed fines were all unpaid and were supported by contribution evidence showing that the old date-based automation had incorrectly fined periods with contribution records.

The cleanup was executed through a one-time exact-ID production operation. Temporary maintenance endpoints used for the dry run and exact cleanup were removed immediately afterward. The final Vercel production deployment was verified `READY`, and the removed cleanup route returned HTTP 404.

### Supporting Documentation

- `docs/production-state-2026-09-12.md` — current production architecture, fine policy and reconciliation record.
- `docs/form-intake-verification.md` — staged intake and allocation workflow aligned with the missing-month fine policy.
- `README.md` — current deployment and operational overview.

---

## Version 1.7.0
**Date:** 12 September 2026

**Status:** 🛠️ Prepared locally — Production Brand Integration

- Imported the approved Checkpoint logo, icon, outline and abstract background artwork into `frontend/public/brand/`; the external design folder remains development input only.
- Replaced temporary letter-mark branding in the admin navigation, member navigation, mobile header and design-system samples with the supplied SVG mark.
- Added the full Checkpoint logo to sign-in, account activation, forgot-password and reset-password screens.
- Added SVG/PNG favicons, Apple touch icon, PWA icons and a web app manifest.
- Added Open Graph and X/Twitter metadata plus a 1200 × 630 branded social-preview image for `app.checkpoint.cc.cd`.
- Added four production-local abstract backgrounds and applied the primary background to the authentication experience.
- Rebuilt sign-in, account activation, forgot-password and reset-password around one responsive `AuthLayout`, using the approved split-screen composition and Checkpoint proposition from the PR19/Figma direction.
- Added one reusable ambient-gradient treatment, accessible password visibility controls, explicit form labels and autocomplete metadata, live status/error regions, keyboard focus states and reduced-motion behavior.
- Added dedicated tablet, mobile and short-screen layouts without changing authentication endpoints, validation rules or financial/backend behavior.
- Replaced the generic session-restoration text screen with a reusable branded Checkpoint preloader using the official packaged icon, a restrained halo animation and a coordinated 260ms exit transition.
- Scoped the branded preloader to initial boot/session restoration only; page skeletons, inline loaders and button loading states remain unchanged.

---

## Architecture Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| Mar 2026 | LowDB for v1.0 | Zero-config local persistence for rapid MVP |
| Apr 2026 | Migrate to MongoDB Atlas | Multi-tenant SaaS readiness, cloud persistence, race-condition safety |
| Apr 2026 | Keep 5% rate on historical loans | Accuracy — loans were issued under prior rules; changing retroactively would distort records |
| Apr 2026 | Auto-create fine on late contribution save | Historical implementation; superseded 12 Sep 2026 by missing-month-only fine automation |
| Apr 2026 | 80% cap enforced server-side | Prevent client-side bypass; cap validation lives in backend logic |
| Apr 2026 | Welfare fund as separate collection | Clean separation from fines; different approval workflow and fixed amount |
| Apr 2026 | Gmail SMTP over SendGrid/SES | No additional account or API key needed; club already has Gmail; App Password is sufficient for current volume |
| Apr 2026 | Vercel serverless for backend | Frontend and API can share one deployment while MongoDB Atlas handles persistence |
| Apr 2026 | Replace mongoose-sequence with custom counter | Compatibility and reliability with Mongoose v9 and serverless execution |
| Apr 2026 | Email-based login (not username) | Members know their email; admin username retained as fallback |
| Apr 2026 | Broadcast reminders target previous month | Contributions are paid at end-of-month with a 5th-of-next-month deadline |
| Jun 2026 | Cloudflare Pages + Railway split hosting | Historical fallback deployment while Vercel was unavailable at that stage |
| 12 Sep 2026 | Vercel restored as active production stack | Verified live Vercel deployment from GitHub `main`; Railway deployment is inactive |
| 12 Sep 2026 | Fine only a completely missing contribution month | Prevent false fines caused by delayed entry/reconciliation and stored `paid_date`; any contribution record suppresses automatic fine creation |
| 12 Sep 2026 | Preserve paid erroneous fines for manual reconciliation | Deleting a paid fine could corrupt cash/ledger history; only confirmed unpaid erroneous fines are safe for automated removal |

---

## Constitution Reference

**Document:** Katiba ya Kikundi cha Checkpoint Investors Club  
**Registration:** Manispaa ya Morogoro — Ref: CP/DED/MMC/023/001  
**Date Ratified:** February 26, 2023  
**Address:** NHC Building, 4th Floor, Plot No. 2/D, Old DSM Road, P.O. Box 149, Morogoro, Tanzania  
**Languages:** Kiswahili and English  
**Applicable Articles for Platform Logic:** Art. 4.2 (Fines), Art. 4.6 (Member Removal), Art. 8.2 (Loans, Welfare), Art. 6.3 (Leadership Terms)
