# Checkpoint Tenant Route Migration Matrix

> ## Phase 4D Complete / MERGED; Phase 4E Implemented (PR open, NOT merged) — October 2026
>
> - Phase 4D (PR [#32](https://github.com/jkidune/checkpoint-dashboard/pull/32), merge SHA `de0921270db55af7fc96b669abf9c0b4767f8c7f`) is **COMPLETE / MERGED** into `main`. The rows below marked `MIGRATED — Phase 4D` are live on `main`.
> - **Phase 4E is IMPLEMENTED / PR OPEN / NOT MERGED** (branch `phase4e-reporting-reconciliation-tenancy`, based on `main` at `4df6b96`). The rows below marked `MIGRATED — Phase 4E` describe that open PR; they are **not** on `main` until it is reviewed and merged.
> - **Phase 4F has not started.**
>
> Full context: [`docs/multitenancy-migration-handoff.md`](./multitenancy-migration-handoff.md).

Companion to [docs/multitenancy-architecture.md](./multitenancy-architecture.md). This is planning/tracking documentation — being listed here does not migrate a file. Only the routes explicitly marked `MIGRATED — Phase 4A`, `MIGRATED — Phase 4B`, `MIGRATED — Phase 4C`, `MIGRATED — Phase 4D`, or `MIGRATED — Phase 4E` had code changed in that phase.

Built from a full-repository inventory pass (searched `backend/routes/`, `backend/services/`, `backend/jobs/`, `backend/utils/` for `require('../db/models')`, the four auxiliary model modules, `mongoose.model`/`mongoose.models`/`mongoose.connection`, `.collection(`, `getNextId`, and `Counter`). No direct `mongoose.model`/`mongoose.models`/`mongoose.connection` calls exist outside `backend/db/*.js` and `backend/tenancy/*.js` — every route/service/job goes through the model-registry files, which is exactly what makes this migration tractable one file at a time.

## Status categories

| Category | Meaning |
|---|---|
| `MIGRATED — Phase 3 auth` | Already reads/writes exclusively via `req.tenantModels` (or resolves its own runtime tenant server-side), from Phase 3. |
| `MIGRATED — Phase 4A` | Migrated to `req.tenantModels` in Phase 4A (members/transactions/expenses). |
| `MIGRATED — Phase 4B` | Migrated to `req.tenantModels` in Phase 4B (member loan eligibility). |
| `MIGRATED — Phase 4C` | Migrated to `req.tenantModels` in Phase 4C (rules + contributions stack). |
| `MIGRATED — Phase 4D` | Migrated to `req.tenantModels` in Phase 4D (loan domain). Merged (PR #32). |
| `MIGRATED — Phase 4E` | Migrated to `req.tenantModels` in Phase 4E (reporting, investment valuation, fine cash hotfix, reconciliation). **Implemented; PR open, NOT merged.** |
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
| `routes/investments.js` | `/api/investments/*` | `authenticate`, `requireAdmin` | Investment, NavUpdate, `getNextId` | `req.tenantModels` | High — its valuation helper is shared with `summary.js` (now the model-explicit `valuateInvestmentsWithModels(models)`; the no-arg `valuateInvestments()` was removed) | 4E | **MIGRATED — Phase 4E** |
| `routes/summary.js` | `/api/summary/*` | `authenticate`, `requireAdmin` | broad cross-model aggregation (Member, Contribution, Loan, Repayment, Fine, WelfareEvent, Expense, Transaction, ReconciliationRun, FyRules, Investment, NavUpdate), `getNextId` | `req.tenantModels` | High | 4E | **MIGRATED — Phase 4E** |
| `routes/reconciliation.js` | `/api/reconciliation/*` | `authenticate`, `requireAdmin` | ReconciliationRun, AuditSourceRecord, Counter, Member, Contribution, Loan, Repayment, Fine, Transaction, Expense, Investment | `req.tenantModels`; the apply transaction's session comes from `models.ReconciliationRun.db.startSession()` (tenant connection) | High — multi-document MongoDB transaction | 4E | **MIGRATED — Phase 4E** |
| `routes/import.js` | `/api/import/*` | `authenticate`, `requireAdmin` | bulk import across core models | default/legacy | Medium | future | PENDING — protected complex/reporting route |
| `routes/mailer.js` | `/api/mailer/*` | `authenticate`, `requireAdmin` | User, Member, CommunicationLog (via services) | default/legacy | Medium | future | PENDING — protected complex/reporting route |
| `routes/rules.js` | `/api/rules/*` | `authenticate`, `requireAdmin` | FyRules (tenant); default FyRules only inside the legacy `getRulesForFY(fy)` wrapper | `req.tenantModels` for live routes; default/legacy for the legacy wrapper | Medium — mounted alongside `rulesHotfix.js` on the same path | 4C | **MIGRATED — Phase 4C (live routes only; legacy wrapper retained)** |
| `routes/rulesHotfix.js` | `/api/rules/*` (mounted first) | `authenticate`, `requireAdmin` | FyRules, Fine, Member, Contribution, `getNextId` | `req.tenantModels` | Medium | 4C | **MIGRATED — Phase 4C** |
| `routes/contributions.js` | `/api/contributions/*` | `authenticate`, `requireAdmin` | Contribution, Fine, Transaction, Loan, Repayment, Member, `getNextId`, FyRules via tenant resolver | `req.tenantModels` | High | 4C | **MIGRATED — Phase 4C** |
| `routes/contributionsHotfix.js` | `/api/contributions/*` (mounted first) | `authenticate`, `requireAdmin` | Contribution, Fine, Transaction, Repayment, Loan, Member, `getNextId`, FyRules via tenant resolver | `req.tenantModels` | High | 4C | **MIGRATED — Phase 4C** |
| `routes/loans.js` | `/api/loans/*` | `authenticate`, `requireAdmin`, `requireSelfOrAdmin` | Loan, Repayment, Member, Transaction, Expense, FyRules, `getNextId` | `req.tenantModels` | High | 4D | **MIGRATED — Phase 4D** |
| `routes/loanActivationHotfix.js` | `/api/loans/*` (mounted first) | `authenticate`, `requireAdmin` | Loan, Member, Transaction, `getNextId` | `req.tenantModels` | Medium | 4D | **MIGRATED — Phase 4D** |
| `routes/fineCashHotfix.js` | `/api/summary/*` (mounted first) | `authenticate`, `requireAdmin` | Fine, Transaction, ReconciliationRun, `getNextId` | `req.tenantModels` (captured before `res.on('finish')`) | Medium | 4E | **MIGRATED — Phase 4E** |
| `routes/notifications.js` | `/api/notifications/*` | `authenticate`, `requireAdmin`, `requireSelfOrAdmin` | Notification, Member, FormIntakeSubmission, AdminNotificationState | default/legacy | High — combines 4 model sources + `deadlineScan` + email side effects | future (own coordinated batch) | PENDING — protected complex/reporting route |
| `routes/communications.js` | `/api/communications/*` | `authenticate`, `requireAdmin` | Member, User, Contribution, Notification, Loan, Repayment, Fine, Transaction, CommunicationLog, `getNextId` | default/legacy | High | future | PENDING — protected complex/reporting route |
| `routes/memberLoanEligibility.js` | `/api/member/loan-eligibility` | `authenticate` | (via `services/memberLoanEligibility.js`'s tenant-explicit entry point) | `req.tenantModels` | Low (once the service supported a model-explicit entry point) | 4B | **MIGRATED — Phase 4B** |
| `routes/formIntake.js` | `/api/forms/intake` | `authenticate`, `requireAdmin` (admin verification endpoints) + public submission | FormIntakeSubmission, + core models on posting | default/legacy | High | future | PENDING — public/Form Intake route |
| `routes/formIntakeAdmin.js` | `/api/forms/intake` (mounted first) | `authenticate`, `requireAdmin` | FormIntakeSubmission, + core models | default/legacy | High | future | PENDING — public/Form Intake route |
| `routes/formIntakeAllocationGuard.js` | `/api/forms/intake` (mounted first) | guard layer | none directly | default/legacy | Low | future | PENDING — public/Form Intake route |
| `routes/forms.js` | `/api/forms/*` (legacy) | none (secret-protected) | core models | default/legacy | Medium | future | PENDING — public/Form Intake route |
| `routes/loanRequests.js` | `/api/forms/loan-request` | `authenticate`, `requireAdmin` (admin side) + public submission (server-side tenant resolution) | LoanRequestSubmission, Member, Loan, `getNextId` | `req.tenantModels` (authenticated routes); `resolveApprovedRuntimeTenant()` (public POST) | High | 4D | **MIGRATED — Phase 4D** |
| `routes/automaticFineCron.js` | `/api/cron/automatic-fines` | cron secret | (via `services/automaticFineIssuance.js`, `automaticMissingFineIssuance.js`) | default/legacy | High — must resolve which tenant(s) a cron sweep applies to | future | PENDING — cron/background job |
| `routes/memberAutomation.js` | `/api/cron/member-reminders` | cron secret | Member, CommunicationLog, `getNextId` | default/legacy | High | future | PENDING — cron/background job |
| `jobs/deadlineScan.js` | in-process interval job | n/a | core models | default/legacy | High — same "which tenant" question as the cron routes | future | PENDING — cron/background job |
| `services/automaticFineIssuance.js` | fine issuance logic | n/a | Fine, Contribution, FyRules, CommunicationLog | default/legacy | High | future | PENDING — service/helper dependency |
| `services/automaticMissingFineIssuance.js` | missing-month fine scan | n/a | Fine, Contribution, FyRules, CommunicationLog | default/legacy | High | future | PENDING — service/helper dependency |
| `services/loanApprovalAssessment.js` | loan approval eligibility calc | n/a | Loan, Contribution, FyRules, Fine, Member | both — see note below | Medium | 4D | **MIGRATED — Phase 4D (dual entry point)** |
| `services/memberLoanEligibility.js` | member-facing eligibility calc | n/a | Member, Loan, Contribution, Fine, FyRules | both — see note below | Medium | 4B | **MIGRATED — Phase 4B (dual entry point)** |
| `services/fyRules.js` | FY rules DEFAULTS + default/DB merge resolution | n/a | FyRules (caller-supplied) | model-agnostic (caller supplies the model) | — | 4B (new) | N/A — pure resolver, no connection of its own |
| `services/contributionFinePolicy.js` | pure fine-policy calculation | n/a | none | n/a | — | — | N/A — pure helper, no DB access |
| `utils/formIntakeAlertEmail.js` | admin alert email composer | n/a | core models (read-only, for alert content) | default/legacy | Low | future | PENDING — service/helper dependency |
| `utils/mailer.js`, `utils/memberMailer.js`, `utils/notifyByEmail.js` | email transport | n/a | none | n/a | — | — | N/A — pure email transport, no DB access |

**Explicitly deferred by name, per Phase 4A instructions** (not migrated, not touched): `admin.js`, `notifications.js`, `communications.js`, `investments.js`, `summary.js`, `loans.js`, `loanActivationHotfix.js`, `fineCashHotfix.js`, `reconciliation.js`, `import.js`, `mailer.js`, `formIntake.js`, `formIntakeAdmin.js`, `formIntakeAllocationGuard.js`, `forms.js`, `loanRequests.js`, `automaticFineCron.js`, `memberAutomation.js`, `deadlineScan.js`. As of Phase 4C, `rules.js`, `rulesHotfix.js`, `contributions.js`, and `contributionsHotfix.js` have moved from this deferred list to MIGRATED. As of Phase 4D, `loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, and `services/loanApprovalAssessment.js` have also moved to MIGRATED (PR #32, merged). As of Phase 4E (branch `phase4e-reporting-reconciliation-tenancy`, PR open, not merged), `investments.js`, `summary.js`, `fineCashHotfix.js`, and `reconciliation.js` have moved to MIGRATED as well.

**Phase 4B note on `services/memberLoanEligibility.js`:** the eligibility service exports two entry points — `computeMemberLoanEligibilityWithModels(models, memberId, fiscalYear)` (tenant-explicit, used exclusively by the migrated route) and `computeMemberLoanEligibility(memberId, fiscalYear)` (the original default/legacy-bound function, retained as a compatibility shim). As of Phase 4D, `services/loanApprovalAssessment.js` now calls `computeMemberLoanEligibilityWithModels`, so `computeMemberLoanEligibility` is now a shim for callers outside the loan domain only; it can be removed in a future cleanup once all remaining callers are identified and migrated.

**Phase 4E note on `investments.js` / `summary.js`:** the two files were migrated together because they share the valuation helper. `investments.js` now exports `valuateInvestmentsWithModels(models)` (and its `latestNav(models, provider, asset_class, asOf)` helper is model-explicit); the legacy no-arg `valuateInvestments()` was **removed** — its only two callers were these two files — so no default-bound valuation entry point remains anywhere in the backend. `summary.js` computes everything through `computeSummary(models)`, resolves per-loan FY rules with `getRulesForFYWithModel(models.FyRules, fy)` (never the default-bound `getRulesForFY(fy)`), and values investments via `valuateInvestmentsWithModels(models)`, so the summary's investment total, the cash bridge's "investment transfers" and `GET /api/investments` all read the same tenant. Fines and welfare CRUD use `req.tenantModels` and tenant-local `fine_id` / `welfare_id` counters.

**Phase 4E note on `fineCashHotfix.js`:** `server.js`'s mount order (`fineCashHotfix` before `summary`) is **unchanged** and was proven through real HTTP behaviour — a `PATCH /api/summary/fines/:id {status:'paid'}` with no `paid_date` is saved *with* a `paid_date`, which only the hotfix middleware can have injected. `syncPaidFineReceipts(models)` is model-explicit and exported; the asynchronous post-response receipt creation uses a `models` constant captured before `res.on('finish')`. `GET /api/summary` and `GET /api/summary/snapshot` repair eligible missing receipts through the request's tenant models before computing.

**Phase 4E note on `reconciliation.js`:** `mongoose` and `../db/models` are no longer imported. `POST /apply` runs a MongoDB multi-document transaction on a session created from the **tenant connection** (`models.ReconciliationRun.db.startSession()`), with `syncCounter(models, Model, counterName, session)` / `nextId(models, counterName, session)` allocating from the tenant's own counters inside the transaction. Transactions require a replica set, so the Phase 4E apply/rollback tests run on a disposable `MongoMemoryReplSet` (see `backend/test/tenancy/helpers/phase4eTestApp.js`).

**Phase 4E note on the legacy `getRulesForFY(fy)` wrapper:** it is **still required** and is *not* yet a removal candidate. After Phase 4E the remaining default-bound callers are `routes/communications.js`, `routes/formIntake.js`, `routes/formIntakeAdmin.js`, `routes/memberAutomation.js`, `jobs/deadlineScan.js`, `services/automaticFineIssuance.js`, `services/automaticMissingFineIssuance.js`, and the retained legacy wrappers inside `services/loanApprovalAssessment.js` and `services/memberLoanEligibility.js` — all Phase 4F+ work.

**Phase 4D note on `services/loanApprovalAssessment.js`:** the assessment service now exports two entry points built on a single shared `buildAssessmentResult({...})` helper — `assessLoanApprovalWithModels(models, options)` (tenant-explicit, called exclusively by `loanActivationHotfix.js` and `loanRequests.js`) and `assessLoanApproval({...})` (the original default/legacy-bound compatibility wrapper, retained for any callers outside the 4 migrated files). The legacy `getRulesForFY(fy)` compatibility wrapper in `routes/rules.js` is still in place, but the Phase 4D migrated callers no longer use it. Once Phase 4E and beyond migrate the remaining callers, the legacy wrapper can be removed.

**Phase 4D note on `routes/loanRequests.js`:** the public `POST /api/forms/loan-request` endpoint does **not** read any tenant identity from the request — no `req.body.organization_id`, `req.query.organization_id`, or any header. It resolves its tenant exclusively server-side via `resolveApprovedRuntimeTenant()`, which hardcodes `org_checkpoint_investors`. Authenticated admin routes use `req.tenantModels` as normal.

**Phase 4C note on `routes/rules.js`, `routes/rulesHotfix.js`, `routes/contributions.js`, and `routes/contributionsHotfix.js`:**

- `routes/rules.js`'s live HTTP route handlers (`GET /`, `GET /:fy`, `PUT /:fy`, `DELETE /:fy`) now read/write `req.tenantModels.FyRules` exclusively, via `getRulesForFYWithModel(req.tenantModels.FyRules, fy)` from `services/fyRules.js` (introduced in Phase 4B). Its `getRulesForFY(fy)` export is **retained, unchanged, as a temporary default-bound compatibility API** — still required by `loans.js` and `services/loanApprovalAssessment.js`, neither of which is migrated yet. `rules.js`'s own (shadowed) `/:fy/scan-fines` and `/:fy/recalculate-fines` handlers were migrated too, purely so there's no hidden default-bound fallback if `server.js`'s mount order ever changes — they are not the live path.
- `routes/rulesHotfix.js` (the live path for `POST /api/rules/:fy/scan-fines` and `/:fy/recalculate-fines`, mounted before `rules.js`) is now fully tenant-scoped: every model comes from `req.tenantModels`, and FY rules resolve via `getRulesForFYWithModel`, never the legacy wrapper.
- `routes/contributions.js` is fully tenant-scoped, including its own (partially shadowed) `computeBulkAllocation()`.
- `routes/contributionsHotfix.js` (the live path for `POST /api/contributions`, `GET /fine-preview`, `GET /bulk-payment-preview`, and `POST /bulk-payment`, mounted before `contributions.js`) is fully tenant-scoped. Bulk contribution allocation is tenant-scoped across Contribution, Fine, Loan, Repayment, Member, and Transaction, with FY rules resolved per-period via `getRulesForFYWithModel(models.FyRules, fy)`.
- `server.js`'s mount order (`rulesHotfix` before `rules.router`; `contributionsHotfix` before `contributions`) is unchanged, and was proven unchanged via real HTTP behavior (not inferred from source) in `backend/test/tenancy/phase4cContributions.test.js`.
- **Known pre-existing inconsistency, discovered during Phase 4C testing, not fixed:** `rulesHotfix.js`'s `recalculate-fines` selects existing auto-fines to correct via `reason: /^Late contribution/`, but its own sibling `scan-fines` (via `services/contributionFinePolicy.js`'s `calculateOneTimeFine`) always generates fines whose reason starts with `"Missing contribution ..."`, never `"Late contribution ..."`. This means a fine that `scan-fines` itself created can never be found and corrected by `recalculate-fines`'s own query — a policy inconsistency between the two handlers that predates this migration. Per the "do not reconcile fine-policy differences" instruction for this phase, it is documented here, not fixed.
- The automatic fine cron (`automaticFineCron.js`, `services/automaticFineIssuance.js`, `services/automaticMissingFineIssuance.js`) is **not** migrated and remains default-bound — it is a separate, not-yet-designed tenant-resolution problem (cron requests aren't authenticated per-tenant requests).
- The loan domain (`loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, `services/loanApprovalAssessment.js`) is **not** migrated and remains entirely default-bound.

## Out of scope for this matrix

One-off maintenance scripts (`backend/scripts/*.js` — `initCounters.js`, `migrateToMongo.js`, `reconcile-y3-cutover.js`, `reconcile-automatic-fines.js`, `tenant-baseline-report.js`) are not part of the live request-serving application and are not tracked here; they connect directly via their own `mongoose.connect()` calls and are run manually, not per-tenant.

## Summary by category

- **MIGRATED — Phase 3 auth:** 1 (`routes/auth.js`)
- **MIGRATED — Phase 4A:** 3 (`routes/members.js`, `routes/transactions.js`, `routes/expenses.js`)
- **MIGRATED — Phase 4B:** 2 (`routes/memberLoanEligibility.js`, `services/memberLoanEligibility.js`'s tenant-explicit entry point)
- **MIGRATED — Phase 4C:** 4 (`routes/rules.js` [live routes only], `routes/rulesHotfix.js`, `routes/contributions.js`, `routes/contributionsHotfix.js`)
- **MIGRATED — Phase 4D:** 4 (`routes/loans.js`, `routes/loanActivationHotfix.js`, `routes/loanRequests.js`, `services/loanApprovalAssessment.js` [dual entry point]) — PR #32, merged
- **MIGRATED — Phase 4E:** 4 (`routes/investments.js`, `routes/summary.js`, `routes/fineCashHotfix.js`, `routes/reconciliation.js`) — branch `phase4e-reporting-reconciliation-tenancy`, **PR open, NOT merged**
- **PENDING — protected ordinary route:** 0
- **PENDING — protected complex/reporting route:** 5 (`admin.js`, `import.js`, `mailer.js`, `notifications.js`, `communications.js`)
- **PENDING — hotfix-stacked financial route:** 0
- **PENDING — public/Form Intake route:** 4 (`formIntake.js`, `formIntakeAdmin.js`, `formIntakeAllocationGuard.js`, `forms.js`)
- **PENDING — cron/background job:** 3
- **PENDING — service/helper dependency:** 3
- **N/A (no DB access):** 5 (includes the new `services/fyRules.js` pure resolver)

The application is **not** fully multi-tenant after Phase 4E. `members`, `transactions`, `expenses`, member-facing loan eligibility, the entire rules + contributions stack (including bulk payment allocation), the entire loan domain (`loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, `services/loanApprovalAssessment.js`), and — on the open Phase 4E branch — the reporting, investment and reconciliation stack (`investments.js`, `summary.js`, `fineCashHotfix.js`, `reconciliation.js`) read through `req.tenantModels` (or server-side `resolveApprovedRuntimeTenant()` for the public loan-request POST); every other route above still queries the default/legacy connection directly. This remains safe only because of the Phase 3 single-runtime-tenant restriction (`org_checkpoint_investors` is the only enabled runtime organization, and its tenant connection resolves to the same physical database the default connection already uses) — see `docs/multitenancy-architecture.md`.

**Phase 4F and later work remains default-bound** (Phase 4F has **not** started): `admin.js`, `notifications.js`, `communications.js`, `import.js`, `mailer.js`, the Form Intake stack (`formIntake.js`, `formIntakeAdmin.js`, `formIntakeAllocationGuard.js`, `forms.js`), and the cron/background jobs (`automaticFineCron.js`, `memberAutomation.js`, `jobs/deadlineScan.js`, `services/automaticFineIssuance.js`, `services/automaticMissingFineIssuance.js`).
