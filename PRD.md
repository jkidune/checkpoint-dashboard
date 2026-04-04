# Product Requirements Document (PRD)
## Checkpoint Investment Management Platform

---

**Document Type:** Product Requirements Document (PRD)  
**Version:** 2.0  
**Date:** April 2026  
**Status:** Active — FY2026 Rules Applied  
**Supersedes:** PRD v1.0 (March 2026)

---

## 1. Product Vision

Checkpoint is a cloud-based SaaS platform designed to digitize, automate, and professionalize the financial management of VICOBA (Village Community Banks) and community investment clubs across East Africa. It replaces manual spreadsheets, paper registers, and WhatsApp treasurer updates with a single transparent, automated, and professional digital system.

---

## 2. Target Audience

- Existing VICOBA or investment clubs migrating from Excel/Google Sheets.
- Treasurers or admin members comfortable with basic web/mobile apps.
- Scale: 10–50 members (Phase 1), up to 200 members (Phase 2).

---

## 3. Governing Rules — FY2026 (Effective March 1, 2026)

> These rules are drawn directly from the **Checkpoint Investors Club Constitution** (Katiba ya Kikundi cha Checkpoint Investors Club, ratified February 26, 2023, Morogoro) and are the authoritative source for all business logic in the platform.

### 3.1 Fiscal Year

| Parameter | Value |
|---|---|
| Fiscal Year Start | March 1 of each year |
| Fiscal Year End | February 28/29 of the following year |
| FY2026 Period | March 1, 2026 → February 28, 2027 |
| Year Label | The year the March start falls in (FY2026 = Mar 2026 – Feb 2027) |

### 3.2 Membership & Entry Fees

| Category | Amount | Notes |
|---|---|---|
| Founding Members Entry Fee | TZS 100,000 | One-time, non-refundable (10 founding members) |
| New Members Entry Fee | TZS 500,000 | One-time, non-refundable (Constitution Art. 4.3.2) |
| Minimum Age | 18 years | |
| Leadership Terms | 2 years per term, max 2 consecutive terms | |

### 3.3 Monthly Contributions

| Fiscal Year | Monthly Amount | Group Monthly Target | Annual per Member |
|---|---|---|---|
| FY2024 (Mar 2024 – Feb 2025) | TZS 50,000 | TZS 500,000 | TZS 600,000 |
| FY2025 (Mar 2025 – Feb 2026) | TZS 75,000 | TZS 750,000 | TZS 900,000 |
| FY2026 (Mar 2026 – Feb 2027) | TZS 75,000 | TZS 750,000 | TZS 900,000 |

> Contribution rates are reviewed and set at the start of each fiscal year by member vote.

### 3.4 Late Contribution Fines

| Parameter | Rule | Source |
|---|---|---|
| Payment Deadline | 5th of the month following the contribution month | Constitution Art. 4.2 |
| Fine Rate | **15% of the monthly contribution amount per month late** | Constitution Art. 4.2 |
| Fine Calculation | `Fine = contribution_amount × 0.15 × months_late` | |
| FY2026 Fine Per Month | TZS 11,250 (75,000 × 15%) | |
| Fine Accumulation | A new 15% fine is added every month the contribution remains unpaid | |
| Partial Payments | Fine continues until the **full** monthly amount is received | |
| Fine Revenue | 100% goes to group net profit (equity) | |

**Fine Examples (FY2026, contribution = TZS 75,000):**

| Months Late | Fine Formula | Total Fine |
|---|---|---|
| 0 (paid by 5th) | — | TZS 0 |
| 1 month | 75,000 × 15% × 1 | TZS 11,250 |
| 2 months | 75,000 × 15% × 2 | TZS 22,500 |
| 3 months | 75,000 × 15% × 3 | TZS 33,750 |
| 6 months | 75,000 × 15% × 6 | TZS 67,500 |
| 12 months | 75,000 × 15% × 12 | TZS 135,000 |

### 3.5 Loans

| Parameter | Rule | Source |
|---|---|---|
| Interest Rate | **12% flat on principal, deducted upfront** | Constitution Art. 8.2 |
| Amount Member Receives | `principal − (principal × 0.12)` | |
| Amount Member Must Repay | Full principal (interest already deducted) | |
| Repayment Period | **6 months from issue date** | Constitution Art. 8.2 |
| Maximum Loan Amount | **80% of member's total paid contributions** | Constitution Art. 8.2 |
| Minimum Loans per Year | At least 1 loan per member per fiscal year (member obligation) | Constitution Art. 4.5 |
| Multiple Loans | Permitted — tracked as Loan 1, Loan 2, etc. per fiscal year | |
| Repayment Style | Flexible installments within 6-month window | |
| Early Repayment | Encouraged — no penalty | |

### 3.6 Overdue Loan Penalties

| Month | Status | Penalty Added | Total Owed |
|---|---|---|---|
| Months 1–6 | Active | None | Principal |
| Month 7 | **OVERDUE** | +10% of original principal | Principal × 1.10 |
| Month 8 | Overdue | +10% of original principal | Principal × 1.20 |
| Month N (N > 6) | Overdue | +10% per month | Principal × (1 + (N−6) × 0.10) |

> **Formula:** `Total Owed = Principal + [(months_overdue − 6) × Principal × 0.10]`  
> The 10% penalty is calculated on the **original principal** each month — not compounded.

**Overdue Escalation Examples:**

| Loan | Month 7 | Month 9 | Month 12 |
|---|---|---|---|
| TZS 500,000 | 550,000 | 650,000 | 800,000 |
| TZS 1,000,000 | 1,100,000 | 1,300,000 | 1,600,000 |
| TZS 2,000,000 | 2,200,000 | 2,600,000 | 3,200,000 |

### 3.7 Welfare Fund

| Parameter | Rule | Source |
|---|---|---|
| Welfare Amount | **TZS 50,000 per qualifying event** (fixed) | Constitution Art. 8.2d |
| Qualifying Events | Death of member or immediate family, wedding, birth of child, medical emergency | |
| Approval | Must be approved by the Executive Committee | |
| Welfare Revenue | Deducted from group equity | |

### 3.8 Equity Formula

```
Total Equity = Entry Fees + Total Contributions + Net Profit − Welfare Paid

Net Profit   = Total Interest Earned + Total Fines Collected
```

### 3.9 Loan Maximum Calculation

```
max_loan_eligible = member_total_contributions × 0.80
```

A loan application is rejected by the system if `requested_amount > max_loan_eligible`.

---

## 4. Core Capabilities & Workflows

### 4.1 Member Management
- Role-based access control: **Admin** (Chair, Secretary, Treasurer) and **Member** (read-only).
- Member profiles: personal details, contact info, next of kin, employment, banking details.
- Entry fee tracking: founding members (TZS 100,000) vs. new members (TZS 500,000).
- Maximum loan eligibility displayed per member (80% of contributions).
- Welfare event history per member.

### 4.2 Contribution Tracking
- Monthly grid view: all members × 12 months, color-coded (green = paid, amber = partial, red = unpaid).
- Fine preview: calculates and displays the 15% fine before recording a late contribution.
- Fine auto-creation: when a late contribution is saved, a corresponding fine record is automatically created.
- Dynamic fiscal year tabs — auto-expands when FY2026 data exists.
- Contribution rates adjust per fiscal year.

### 4.3 Loan Management
- Loan issuance enforces: 12% interest, 80% cap validation, 6-month deadline calculation.
- Live loan preview in issue modal: shows principal, interest, amount received, repayment deadline.
- Repayment tracking with running balance.
- Auto-mark loan as "paid" when `total_repaid ≥ principal`.
- Overdue detection from month 7 with penalty display.
- Penalty accrual shown per overdue loan in the table.

### 4.4 Analytics & Dashboard
- Real-time KPIs: Total Equity, Loans in Circulation, Cash at Bank, Active Members.
- Monthly contribution chart (FY2024 vs FY2025 vs FY2026 comparison).
- Interest earned by member breakdown.
- Active loan list with overdue flags.
- Welfare fund summary.
- Constitution rules displayed as a reference panel.

### 4.5 Transaction Ledger
- Full audit trail of all financial events.
- Types: contribution, loan_disbursement, loan_repayment, fine_payment, welfare_payment, group_transfer.
- Paginated with filter by member, type, and date range.

---

## 5. Implemented Features

### 5.1 ✅ CSV Bulk Import (v1.1.0)
- Admin uploads CSV for Members, Contributions, or Loans.
- System maps CSV columns to MongoDB schema fields.
- Downloadable CSV templates generated per collection.

### 5.2 🔲 Data Export (Planned)
- **Loans Export**: Active, paid, overdue — CSV and PDF formats.
- **Contributions Export**: Monthly matrix per fiscal year — CSV and PDF.
- **Summary Report**: Group financial health snapshot — PDF with branding.
- **Individual Member Statement**: Personal contributions, loans, fines, balance — PDF.
- Single-click download from any view.

### 5.3 🔲 Automated Email Reporting (Planned)
- Monthly automated email to each member: personal statement (contributions, loans, fines, balance).
- Admin-triggered "Send Group Summary": emails all members the group KPIs.
- PDF attachment option.
- Future: SMS via mobile money gateway.

---

## 6. Technical Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, React Router, CSS Variables |
| Backend | Node.js, Express |
| Database | MongoDB Atlas (Mongoose) |
| Authentication | JWT (7-day expiry, bcryptjs hashing) |
| Hosting | Cloud (MongoDB Atlas) |
| CSV Processing | Dynamic mapping, template generation |
| Future: Email | SendGrid or AWS SES |
| Future: PDF | Puppeteer or pdfkit |
| Future: Payments | M-Pesa, Tigopesa, AirtelMoney |

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Dashboard load < 2 seconds |
| Security | JWT auth, bcrypt hashing, MongoDB Atlas encryption at rest |
| Multi-tenancy | Data isolation per group (tenant) |
| Platform | Responsive — desktop (admin), mobile (member read-only) |
| Backup | MongoDB Atlas automated backups |
| Availability | > 99.5% monthly uptime |

---

## 8. Future Scope (V3.0+)

- Mobile Money integration (M-Pesa, Tigopesa, AirtelMoney).
- Google Forms → automatic contribution updates via webhook.
- Native iOS and Android apps.
- AI financial insights and member risk scoring.
- Multi-group federation for umbrella VICOBA organisations.
- SMS notifications via mobile gateway.