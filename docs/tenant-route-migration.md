# Checkpoint Tenant Route Migration Matrix

Companion to [docs/multitenancy-architecture.md](./multitenancy-architecture.md). This is planning/tracking documentation — being listed here does not migrate a file. Only the routes explicitly marked `MIGRATED — Phase 4A` had code changed in that phase.

Built from a full-repository inventory pass (searched `backend/routes/`, `backend/services/`, `backend/jobs/`, `backend/utils/` for `require('../db/models')`, the four auxiliary model modules, `mongoose.model`/`mongoose.models`/`mongoose.connection`, `.collection(`, `getNextId`, and `Counter`). No direct `mongoose.model`/`mongoose.models`/`mongoose.connection` calls exist outside `backend/db/*.js` and `backend/tenancy/*.js` — every route/service/job goes through the model-registry files, which is exactly what makes this migration tractable one file at a time.

## Status categories

| Category | Meaning |
|---|---|
| `MIGRATED — Phase 3 auth` | Already reads/writes exclusively via `req.tenantModels` (or resolves its own runtime tenant server-side), from Phase 3. |
| `MIGRATED — Phase 4A` | Migrated to `req.tenantModels` in this PR. |
| `PENDING — protected ordinary route` | Authenticated, single-domain, not yet migrated. |
| `PENDING — protected complex/reporting route` | Authenticated, cross-domain aggregation/reporting/admin-tooling, not yet migrated. |
| `PENDING — hotfix-stacked financial route` | Mounted alongside (or is) a `*Hotfix.js` layer patching the same path; needs coordinated migration with its hotfix sibling. |
| `PENDING — public/Form Intake route` | Google Form intake / legacy form endpoints; no tenant header, tenant resolution not yet designed for this path. |
| `PENDING — cron/background job` | Triggered by Vercel Cron or a `setInterval`-style in-process job, not by an authenticated request. |
| `PENDING — service/helper dependency` | Not a route; a shared function/service other pending routes call into. |
| `N/A` | No tenant-data model access (pure computation or email transport only). |

## Migration matrix

| File | Route/service/job | Auth | Models used | Current DB binding | Migration complexity | Batch | Status |
|---|---|---|---|---|---|---|---|
| `routes/members.js` | `/api/members/*` | `authenticate`, `requireAdmin`, `requireSelfOrAdmin` | Member, Contribution, Loan, Repayment, Fine, User, `getNextId` | `req.tenantModels` | Medium (shared `loadContext`/`enrichMember` helpers) | 4A | **MIGRATED — Phase 4A** |
| `routes/transactions.js` | `/api/transactions/*` | `authenticate`, `requireAdmin` | Transaction, Member, `getNextId` | `req.tenantModels` | Low | 4A | **MIGRATED — Phase 4A** |
| `routes/expenses.js` | `/api/expenses/*` | `authenticate`, `requireAdmin` | Expense, `getNextId` | `req.tenantModels` | Low | 4A | **MIGRATED — Phase 4A** |
| `routes/auth.js` | `/api/auth/*` | (issues auth) | User, Member, PasswordResetToken, CommunicationLog, `getNextId` | `req.tenantModels` / server-resolved runtime tenant | — | 3 | **MIGRATED — Phase 3 auth** |
| `routes/admin.js` | `/api/admin/*` (sync-counters, migrate-member-office, roster-audit) | `authenticate`, `requireAdmin` | Counter, Member, Contribution, Loan, Repayment, Transaction, User, Fine, WelfareEvent | default/legacy | Medium–High (direct `Counter` manipulation) | future | PENDING — protected complex/reporting route |
| `routes/investments.js` | `/api/investments/*` | `authenticate`, `requireAdmin` | Investment, NavUpdate, + `db/models` | default/legacy | High — exports `valuateInvestments`, shared with `summary.js` | future (coordinated with summary/reporting) | PENDING — protected complex/reporting route |
| `routes/summary.js` | `/api/summary/*` | `authenticate`, `requireAdmin` | broad cross-model aggregation | default/legacy | High | future (coordinated with investments) | PENDING — protected complex/reporting route |
| `routes/reconciliation.js` | `/api/reconciliation/*` | `authenticate`, `requireAdmin` | ReconciliationRun, AuditSourceRecord, Counter, + core models | default/legacy | High | future | PENDING — protected complex/reporting route |
| `routes/import.js` | `/api/import/*` | `authenticate`, `requireAdmin` | bulk import across core models | default/legacy | Medium | future | PENDING — protected complex/reporting route |
| `routes/mailer.js` | `/api/mailer/*` | `authenticate`, `requireAdmin` | User, Member, CommunicationLog (via services) | default/legacy | Medium | future | PENDING — protected complex/reporting route |
| `routes/rules.js` | `/api/rules/*` | `authenticate`, `requireAdmin` | FyRules | default/legacy | Medium — mounted alongside `rulesHotfix.js` on the same path | future | PENDING — hotfix-stacked financial route |
| `routes/rulesHotfix.js` | `/api/rules/*` (mounted first) | `authenticate`, `requireAdmin` | FyRules | default/legacy | Medium | future | PENDING — hotfix-stacked financial route |
| `routes/contributions.js` | `/api/contributions/*` | `authenticate`, `requireAdmin` | Contribution, Fine, Transaction, `getNextId` | default/legacy | High | future | PENDING — hotfix-stacked financial route |
| `routes/contributionsHotfix.js` | `/api/contributions/*` (mounted first) | `authenticate`, `requireAdmin` | Contribution, Fine, Transaction, Repayment, `getNextId` | default/legacy | High | future | PENDING — hotfix-stacked financial route |
| `routes/loans.js` | `/api/loans/*` | `authenticate`, `requireAdmin`, `requireSelfOrAdmin` | Loan, Repayment, Member, `getNextId` | default/legacy | High | future | PENDING — hotfix-stacked financial route |
| `routes/loanActivationHotfix.js` | `/api/loans/*` (mounted first) | `authenticate`, `requireAdmin` | Loan, `getNextId` | default/legacy | Medium | future | PENDING — hotfix-stacked financial route |
| `routes/fineCashHotfix.js` | `/api/summary/*` (mounted first) | `authenticate`, `requireAdmin` | Fine, Transaction | default/legacy | Medium | future | PENDING — hotfix-stacked financial route |
| `routes/notifications.js` | `/api/notifications/*` | `authenticate`, `requireAdmin`, `requireSelfOrAdmin` | Notification, Member, FormIntakeSubmission, AdminNotificationState | default/legacy | High — combines 4 model sources + `deadlineScan` + email side effects | future (own coordinated batch) | PENDING — protected complex/reporting route |
| `routes/communications.js` | `/api/communications/*` | `authenticate`, `requireAdmin` | Member, User, Contribution, Notification, Loan, Repayment, Fine, Transaction, CommunicationLog, `getNextId` | default/legacy | High | future | PENDING — protected complex/reporting route |
| `routes/memberLoanEligibility.js` | `/api/member/loan-eligibility` | `authenticate` | (via `services/memberLoanEligibility.js`) | default/legacy | Medium — service dependency must move with it | future | PENDING — protected ordinary route |
| `routes/formIntake.js` | `/api/forms/intake` | `authenticate`, `requireAdmin` (admin verification endpoints) + public submission | FormIntakeSubmission, + core models on posting | default/legacy | High | future | PENDING — public/Form Intake route |
| `routes/formIntakeAdmin.js` | `/api/forms/intake` (mounted first) | `authenticate`, `requireAdmin` | FormIntakeSubmission, + core models | default/legacy | High | future | PENDING — public/Form Intake route |
| `routes/formIntakeAllocationGuard.js` | `/api/forms/intake` (mounted first) | guard layer | none directly | default/legacy | Low | future | PENDING — public/Form Intake route |
| `routes/forms.js` | `/api/forms/*` (legacy) | none (secret-protected) | core models | default/legacy | Medium | future | PENDING — public/Form Intake route |
| `routes/loanRequests.js` | `/api/forms/loan-request` | `authenticate`, `requireAdmin` (admin side) + public submission | LoanRequestSubmission, + core models | default/legacy | High | future | PENDING — public/Form Intake route |
| `routes/automaticFineCron.js` | `/api/cron/automatic-fines` | cron secret | (via `services/automaticFineIssuance.js`, `automaticMissingFineIssuance.js`) | default/legacy | High — must resolve which tenant(s) a cron sweep applies to | future | PENDING — cron/background job |
| `routes/memberAutomation.js` | `/api/cron/member-reminders` | cron secret | Member, CommunicationLog, `getNextId` | default/legacy | High | future | PENDING — cron/background job |
| `jobs/deadlineScan.js` | in-process interval job | n/a | core models | default/legacy | High — same "which tenant" question as the cron routes | future | PENDING — cron/background job |
| `services/automaticFineIssuance.js` | fine issuance logic | n/a | Fine, Contribution, FyRules, CommunicationLog | default/legacy | High | future | PENDING — service/helper dependency |
| `services/automaticMissingFineIssuance.js` | missing-month fine scan | n/a | Fine, Contribution, FyRules, CommunicationLog | default/legacy | High | future | PENDING — service/helper dependency |
| `services/loanApprovalAssessment.js` | loan approval eligibility calc | n/a | Loan, Contribution, FyRules | default/legacy | Medium | future | PENDING — service/helper dependency |
| `services/memberLoanEligibility.js` | member-facing eligibility calc | n/a | Loan, Contribution, FyRules | default/legacy | Medium | future | PENDING — service/helper dependency |
| `services/contributionFinePolicy.js` | pure fine-policy calculation | n/a | none | n/a | — | — | N/A — pure helper, no DB access |
| `utils/formIntakeAlertEmail.js` | admin alert email composer | n/a | core models (read-only, for alert content) | default/legacy | Low | future | PENDING — service/helper dependency |
| `utils/mailer.js`, `utils/memberMailer.js`, `utils/notifyByEmail.js` | email transport | n/a | none | n/a | — | — | N/A — pure email transport, no DB access |

**Explicitly deferred by name, per Phase 4A instructions** (not migrated, not touched): `admin.js`, `notifications.js`, `communications.js`, `investments.js`, `summary.js`, `rules.js`, `rulesHotfix.js`, `contributions.js`, `contributionsHotfix.js`, `loans.js`, `loanActivationHotfix.js`, `fineCashHotfix.js`, `reconciliation.js`, `import.js`, `mailer.js`, `formIntake.js`, `formIntakeAdmin.js`, `formIntakeAllocationGuard.js`, `forms.js`, `loanRequests.js`, `automaticFineCron.js`, `memberAutomation.js`, `deadlineScan.js`, `memberLoanEligibility.js`, and its service dependency.

## Out of scope for this matrix

One-off maintenance scripts (`backend/scripts/*.js` — `initCounters.js`, `migrateToMongo.js`, `reconcile-y3-cutover.js`, `reconcile-automatic-fines.js`, `tenant-baseline-report.js`) are not part of the live request-serving application and are not tracked here; they connect directly via their own `mongoose.connect()` calls and are run manually, not per-tenant.

## Summary by category

- **MIGRATED — Phase 3 auth:** 1 (`routes/auth.js`)
- **MIGRATED — Phase 4A:** 3 (`routes/members.js`, `routes/transactions.js`, `routes/expenses.js`)
- **PENDING — protected ordinary route:** 1
- **PENDING — protected complex/reporting route:** 8
- **PENDING — hotfix-stacked financial route:** 7
- **PENDING — public/Form Intake route:** 5
- **PENDING — cron/background job:** 3
- **PENDING — service/helper dependency:** 5
- **N/A (no DB access):** 4

The application is **not** fully multi-tenant after Phase 4A. Only `members`, `transactions`, and `expenses` read/write through `req.tenantModels`; every other route above still queries the default/legacy connection directly. This remains safe only because of the Phase 3 single-runtime-tenant restriction (`org_checkpoint_investors` is the only enabled runtime organization, and its tenant connection resolves to the same physical database the default connection already uses) — see `docs/multitenancy-architecture.md`.
