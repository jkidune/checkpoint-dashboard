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

## Planned — Version 1.3.0
**Status:** 🔲 In Design

### Feature: Comprehensive Data Export

- **Loans Report**: Export active/paid/overdue loans to CSV and formatted PDF.
- **Contributions Report**: Monthly matrix per fiscal year — CSV and PDF.
- **General Summary Report**: Group financial health snapshot — branded PDF.
- **Individual Member Statement**: Personal contributions, loans, fines, balance — PDF.
- Single-click download from Loans, Contributions, Members, and Summary views.
- PRD documented in `PRD.md` Section 5.2.

---

## Planned — Version 1.4.0
**Status:** 🔲 In Design

### Feature: Automated Email Reporting

- Monthly automated email to each member — personal statement (contributions, loans, fines, current balance).
- Admin-triggered "Send Group Summary" — broadcasts group KPIs to all members via email.
- PDF attachment option per email.
- Email provider: SendGrid or AWS SES (TBD).
- Future extension: SMS via mobile money gateway.
- PRD documented in `PRD.md` Section 5.3.

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

---

## Constitution Reference

**Document:** Katiba ya Kikundi cha Checkpoint Investors Club  
**Registration:** Manispaa ya Morogoro — Ref: CP/DED/MMC/023/001  
**Date Ratified:** February 26, 2023  
**Address:** NHC Building, 4th Floor, Plot No. 2/D, Old DSM Road, P.O. Box 149, Morogoro, Tanzania  
**Languages:** Kiswahili and English  
**Applicable Articles for Platform Logic:** Art. 4.2 (Fines), Art. 4.6 (Member Removal), Art. 8.2 (Loans, Welfare), Art. 6.3 (Leadership Terms)