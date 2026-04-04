# Agent Change Tracker (AGENT.md)

This document is the authoritative ledger of all modifications, architectural decisions, business rule changes, and feature implementations across all AI pair programming sessions for the Checkpoint platform.

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

- `POST /api/loans` — rejects loan if `principal > member_total_contributions × 0.80`
- `POST /api/contributions` — auto-calculates fine `(amount × 0.15 × months_late)` and creates fine record
- `GET /api/contributions/fine-preview` — new endpoint: returns fine preview before recording
- `GET /api/loans/rules` — new endpoint: returns current constitution rules as JSON
- `welfare_events` — new collection added to MongoDB schema
- `POST /api/summary/welfare` — create welfare event
- `PATCH /api/summary/welfare/:id` — approve welfare event; auto-creates transaction record

#### Frontend Changes

- **Loans view** — constitution rules banner; live loan preview in issue modal (shows received amount, 12% interest, 6-month deadline); 80% cap indicator per member in dropdown; penalty column for overdue loans; overdue rows highlighted red.
- **Contributions view** — fine rule banner; live fine preview as date is entered; auto-fine notification on save.
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
  - `POST /api/mailer/broadcast-credentials` — creates missing user accounts and emails login credentials to all members.
- **Frontend buttons**: "⬇ CSV", "⬇ PDF", "✉ Email to Club" on Overview; "⬇ CSV", "🔔 Broadcast Reminders" on Contributions.

### Member Email Addresses

- `email` field added to Member schema (non-breaking, `default: null`).
- PATCH `/api/members/:id` updated to accept `email` field.
- All 9 members with emails patched from the TIN Registration CSV (`kidunejoseph91@gmail.com` used as a test email during development; production emails set from CSV data).

---

## Version 1.4.0
**Date:** April 2026
**Status:** ✅ Live — Production Deployment & Auth Upgrade

### Production Deployment (Vercel — zero additional cost)

- **`vercel.json`** at repo root: configures build command (`cd frontend && npm install && npm run build`), output directory (`frontend/dist`), SPA rewrites (`/*` → `/index.html`), and API routing (`/api/*` → serverless function).
- **`api/index.js`** at repo root: Vercel serverless function entry point — exports the Express app (`require('../backend/server')`).
- **`backend/server.js`**: only calls `app.listen()` when `process.env.VERCEL !== '1'`; exports `app` for serverless.
- **`backend/db/mongoose.js`**: connection cached in `global._mongooseCache` so warm Vercel function invocations reuse the existing MongoDB connection instead of reconnecting on every request.
- **CORS**: dynamic origin check — allows `localhost:5173` in dev, all `*.vercel.app` origins and `VERCEL=1` env passthrough in production.
- **Root `package.json`**: backend dependencies listed at repo root so Vercel can install them for the serverless function.

### Authentication Upgrade

- **Email-based login**: `POST /api/auth/login` accepts email address (looks up Member by email → finds linked User) or username as fallback (admin).
- **`email` field on User schema**: added for direct `User.findOne({ $or: [{ email }, { username }] })` without needing a Member join.
- **`POST /api/auth/set-email`**: admin-only endpoint to set a user's email field (used for initial setup of the admin account).
- **`POST /api/auth/broadcast-credentials`** (via mailer route): creates user accounts for all members and emails them their email + `checkpoint2025` default password.
- **Login page**: field changed from "Username" to "Email address"; credentials hint removed; `type="text"` to allow username fallback for admin.

### Bug Fixes

- **`mongoose-sequence` replaced** with a custom counter-based auto-increment (`getNextId` + `addAutoIncrement` in `models.js`) — `mongoose-sequence` was incompatible with Mongoose v9 in the Vercel serverless environment, causing "next is not a function" errors on any `document.save()` call.
- **All `document.save()` calls** in auth routes replaced with `Model.updateOne()` to bypass Mongoose pre-save hooks.
- **MongoDB Atlas Network Access**: `0.0.0.0/0` required for Vercel (dynamic IPs); fixed IP whitelisting causes connection timeouts.

---

## Architecture Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| Mar 2026 | LowDB for v1.0 | Zero-config local persistence for rapid MVP |
| Apr 2026 | Migrate to MongoDB Atlas | Multi-tenant SaaS readiness, cloud persistence, race-condition safety |
| Apr 2026 | Keep 5% rate on historical loans | Accuracy — loans were issued under prior rules; changing retroactively would distort records |
| Apr 2026 | Auto-create fine on late contribution save | Reduces treasurer manual steps; ensures fine records are never missed |
| Apr 2026 | 80% cap enforced server-side | Prevent client-side bypass; cap validation lives in `loans.js` route, not frontend |
| Apr 2026 | Welfare fund as separate collection | Clean separation from fines; different approval workflow and fixed amount |
| Apr 2026 | Gmail SMTP over SendGrid/SES | No additional account or API key needed; club already has Gmail; App Password is sufficient for current volume |
| Apr 2026 | Vercel serverless for backend | Zero additional hosting cost; frontend and API share one deployment; MongoDB Atlas handles persistence |
| Apr 2026 | Replace mongoose-sequence with custom counter | mongoose-sequence incompatible with Mongoose v9 + Vercel serverless — caused "next is not a function" on every save(); custom `getNextId()` using `findByIdAndUpdate + $inc` is simpler and fully compatible |
| Apr 2026 | Email-based login (not username) | Members know their email, not a system-assigned username; reduces friction at onboarding; admin username kept as fallback |
| Apr 2026 | Broadcast reminders target previous month | Contributions are paid at end-of-month with a 5th-of-next-month deadline — so "current outstanding period" is always the prior calendar month |

---

## Constitution Reference

**Document:** Katiba ya Kikundi cha Checkpoint Investors Club  
**Registration:** Manispaa ya Morogoro — Ref: CP/DED/MMC/023/001  
**Date Ratified:** February 26, 2023  
**Address:** NHC Building, 4th Floor, Plot No. 2/D, Old DSM Road, P.O. Box 149, Morogoro, Tanzania  
**Languages:** Kiswahili and English  
**Applicable Articles for Platform Logic:** Art. 4.2 (Fines), Art. 4.6 (Member Removal), Art. 8.2 (Loans, Welfare), Art. 6.3 (Leadership Terms)