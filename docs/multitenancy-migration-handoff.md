# Checkpoint Multi-Tenancy Migration — Handoff

**Written:** 14 September 2026 — **last updated 15 October 2026** (Phase 4D and Phase 4E COMPLETE / MERGED; Phase 4F-A IMPLEMENTED / PR OPEN / NOT MERGED)
**Purpose:** Let another developer or agent resume this migration without relying on prior chat history. This is a snapshot, not a replacement for [`docs/multitenancy-architecture.md`](./multitenancy-architecture.md) (the durable architecture reference) or [`docs/tenant-route-migration.md`](./tenant-route-migration.md) (the full route-by-route inventory) — read those for detail; read this for "where things stand and what to do next."

---

## 1. Architecture

One shared MongoDB Atlas cluster, plus:

- **`checkpoint_control`** — a small control database holding the `Organization` registry (organization_id → database_name, slug, active flag, etc.). Nothing financial lives here.
- **One logical MongoDB database per organization** (database-per-tenant / silo model), addressed via `organization_id → getOrganizationById() (trusted registry) → getTenantConnection() → getTenantModels()`. There is no code path that accepts a caller-supplied database name.

This was chosen over shared-document (`organization_id` field on every record) tenancy because of pre-existing hotfix-route fragility and the financial stakes of the data — see `docs/multitenancy-architecture.md` Section 3 for the full rationale.

## 2. Completed phases

| Phase | Scope | PR | Status |
|---|---|---|---|
| 1 | Control-plane foundation (`Organization` model, registry, guarded tenant-connection selector, legacy bootstrap) | #22 | Merged, production-verified |
| 2 | Tenant-scoped model registry (every tenant model bindable to any connection; connection-local counters; no public raw-connection binding) | #23 | Merged, production-verified |
| 3 | Organization-aware authentication (JWT carries `organization_id`; `authenticate` attaches `req.user`/`req.tenant`/`req.tenantModels`) | #24 | Merged, production-verified |
| 4A | `members.js`, `transactions.js`, `expenses.js` migrated to `req.tenantModels` | #25 | Merged, production-healthy |
| 4B | Member loan eligibility route + tenant-explicit service entry point + tenant-explicit FY-rules resolver (`services/fyRules.js`) | #26 | Merged, production-healthy |
| 4C | Rules + contributions stack migrated to `req.tenantModels` | #27 | **COMPLETE / MERGED** — see Section 6 |
| 4D | Loan domain migrated to `req.tenantModels` (`loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, `services/loanApprovalAssessment.js`) | [#32](https://github.com/jkidune/checkpoint-dashboard/pull/32) | **COMPLETE / MERGED** — see Section 12 |
| 4E | Reporting, investment-valuation and reconciliation stack migrated to `req.tenantModels` (`investments.js`, `summary.js`, `fineCashHotfix.js`, `reconciliation.js`) | [#33](https://github.com/jkidune/checkpoint-dashboard/pull/33) | **COMPLETE / MERGED** — see Section 13 |
| 4F-A | Admin, CSV import, communications and mailer migrated to `req.tenantModels` (`admin.js`, `import.js`, `communications.js`, `mailer.js`) | open (branch `phase4f-a-admin-import-comms-tenancy`) | **IMPLEMENTED / PR OPEN / NOT MERGED** — see Section 14 |

### Merge SHAs

- Phase 4A: `bdb977a1431cb99e56b0cfb91330970dcd70c160`
- Phase 4B: `6e955422dac2d9ff961b7e769a154fac278b620c`
- Phase 4C: `54591173ddf219d4db33a96c4071b784ac195267`
- Phase 4D: `de0921270db55af7fc96b669abf9c0b4767f8c7f`
- Phase 4E: `5a1e019a9483c3adfec721fcea1c3a209651c4d6` (PR [#33](https://github.com/jkidune/checkpoint-dashboard/pull/33))
- Phase 4F-A: **not merged — no merge SHA.**

## 3. Current production safety posture

- Existing Checkpoint Investors Club financial data has **not** moved, been copied, or been re-keyed at any point in this migration. It lives in its original database; the tenant connection for `org_checkpoint_investors` resolves to that same physical database today.
- No production Atlas access has occurred during Phase 4A–4F-A development or testing — all isolation testing uses `mongodb-memory-server` (disposable, in-memory; Phase 4E uses a disposable `MongoMemoryReplSet` because reconciliation uses MongoDB transactions).
- No production data has been modified as part of this migration work (including Phase 4E: no reconciliation, fine, welfare or NAV write has ever been run against production).
- Production deployments through Phase 4B are healthy: root and `/api/health` return 200, login/dashboard/`/api/auth/me` work, `organization_id` resolves to `org_checkpoint_investors`, and `database_name` is never exposed to the client.
- No second production organization has been created or activated.

## 4. Current runtime restriction

**Single-runtime-tenant restriction is still in force.** `backend/tenancy/runtimeOrganization.js` hardcodes:

```js
const PHASE_3_RUNTIME_ORGANIZATION_ID = 'org_checkpoint_investors';
```

Only this organization can authenticate at runtime, regardless of what else is registered in the control-plane `Organization` collection. `org_beta` exists only inside disposable test databases for isolation testing — it has never been created in `checkpoint_control` and must not be activated in production. This restriction must not be weakened until Phase 5 (Section 11).

Existing stable organization on record:

- `organization_id`: `org_checkpoint_investors`
- `name`: Checkpoint Investors Club
- `slug`: checkpoint-investors-club
- runtime status: active (the only active one)

Legacy orgless-token compatibility (`ALLOW_LEGACY_ORGLESS_TOKENS`, default enabled) also remains in force — it lets pre-Phase-3 JWTs keep working without forcing a logout, and should only be retired once a full token TTL has passed since Phase 3 shipped.

## 5. Phase 4C — PR, branch, merge

- **PR:** [#27](https://github.com/jkidune/checkpoint-dashboard/pull/27) — "Phase 4C: Migrate rules and contributions stack to tenant models"
- **Branch:** `phase4c-rules-contributions-tenancy`
- **Head at time of original handoff:** `c6f6017fe1e89536586a02fc9493e5ef5749e6b2`
- **State:** MERGED — merge SHA `54591173ddf219d4db33a96c4071b784ac195267`
- **Test count at merge:** 235/235 passing (187 prior + 48 Phase 4C tests).
- **Closeout PR:** A follow-up PR (`phase4c-closeout-test-hardening`) was opened after merge to close the two remaining test-hardening gaps described in the original Section 7. Both gaps are now closed — see updated Section 7 below.

## 6. What Phase 4C already implemented

Four files migrated from the default/legacy Mongoose connection to `req.tenantModels`, with no fallback:

- **`backend/routes/rules.js`** — live routes `GET /`, `GET /:fy`, `PUT /:fy`, `DELETE /:fy` now resolve `req.tenantModels.FyRules` via `getRulesForFYWithModel()` (from `services/fyRules.js`, introduced in Phase 4B). Its `getRulesForFY(fy)` export is **retained, unchanged**, as a temporary default-bound compatibility API — still required by `loans.js` and `services/loanApprovalAssessment.js` (neither migrated). `buildFinesForFY` became model-explicit: `buildFinesForFY(models, fy, rules)`.
- **`backend/routes/rulesHotfix.js`** — the **live** path for `POST /api/rules/:fy/scan-fines` and `/:fy/recalculate-fines` (mounted before `rules.js` in `server.js`). Fully tenant-scoped; `buildFineCandidates` became model-explicit.
- **`backend/routes/contributions.js`** — all 8 routes (including its own bulk-payment preview/execute) fully tenant-scoped; `computeBulkAllocation` became model-explicit.
- **`backend/routes/contributionsHotfix.js`** — the **live** path for `POST /api/contributions`, `GET /fine-preview`, `GET /bulk-payment-preview`, `POST /bulk-payment` (mounted before `contributions.js`). Fully tenant-scoped; `getExistingFine` and `computeBulkAllocation` both became model-explicit.

`server.js`'s mount order (hotfix before base router, for both `/api/rules` and `/api/contributions`) is byte-for-byte unchanged and was proven unchanged through real HTTP behavior in tests, not inferred from source. No schema, `server.js`, auth, or loan-domain file was touched.

## 7. Phase 4C test-hardening gaps — CLOSED (superseded by closeout PR)

> **These two gaps were identified during human review of PR #27 and were recorded in the original handoff. They are now closed by the follow-up closeout PR (`phase4c-closeout-test-hardening`). The description below is preserved for historical context.**

Two test-hardening gaps were identified during human review of PR #27. Both stem from the same root cause: `services/contributionFinePolicy.js`'s `isContributionLate()` is intentionally deprecated and always returns `false` (see that file's own comment). Because of this, the original tests for two hotfix branches never actually forced the code paths they claimed to prove.

**GAP 1 — fine-preview mount precedence (CLOSED)**
The original test for `GET /api/contributions/fine-preview` did not force the "late" branch, so either handler could have returned `{ penalty: 0, reason: null }`. The closeout PR adds `backend/test/tenancy/phase4cForcedLate.test.js`, which overrides `finePolicy.isContributionLate = () => true` at the top level of the test file (before `server.js` loads), forcing `contributionsHotfix.js`'s destructured `isContributionLate` to be `() => true` for the entire test process. With no existing fine for the period, the fine-preview handler now reaches the `calculateOneTimeFine` branch and returns `one_time: true` — the definitively hotfix-only field that `routes/contributions.js` never includes. `backend/services/contributionFinePolicy.js` is not modified.

**GAP 2 — duplicate-fine suppression branch (CLOSED)**
The original POST-contribution duplicate-fine test pre-seeded a fine, but because `isContributionLate()` always returned `false`, `getExistingFine()` was never reached. The closeout PR's forced-late test seeds a Fine in `tenant_alpha` for a specific period, then POSTs a contribution for that same period. With `isContributionLate()` forced true, the hotfix handler enters `getExistingFine()`, finds the seeded fine, suppresses duplicate creation, and returns `fine_created: null`. The test asserts: alpha Fine count for the period unchanged, alpha `fine_id` counter unchanged, existing Fine record unchanged, default DB Fine count unchanged, default DB `fine_id` counter unchanged, and `tenant_beta` Fine count unchanged.

**Constraint satisfied:** `backend/services/contributionFinePolicy.js` was not modified. The forced-late mechanism is confined to the test process via the module-object property override pattern.

## 8. Known deferred policy issue (pre-existing, not introduced by Phase 4C, not fixed)

`rulesHotfix.js`'s `recalculate-fines` selects existing auto-fines to correct via:

```js
reason: /^Late contribution/
```

but its sibling `scan-fines` (via `services/contributionFinePolicy.js`'s `calculateOneTimeFine`) always generates fines whose reason starts with `"Missing contribution ..."` — never `"Late contribution ..."`. A fine that `scan-fines` itself created can therefore never be found and corrected by `recalculate-fines`'s own query.

This predates the tenancy migration (both functions exist unchanged in shape, just relocated to read from `req.tenantModels`) and was deliberately **not fixed** — Phase 4C's mandate is a tenancy dependency-injection migration, not a fine-policy redesign. It is flagged here for a later, dedicated policy/financial-maintenance review, separate from any tenancy phase.

## 9. Remaining migration roadmap (Phase 4F–4H)

High-level, not yet scoped in detail:

- **Phase 4D — Loan domain: COMPLETE / MERGED** (PR #32). See Section 12.
- **Phase 4E — Financial reporting: COMPLETE / MERGED (PR #33).** `summary.js`, `fineCashHotfix.js`, `investments.js`, `reconciliation.js` and their shared valuation helper. See Section 13. `routes/rules.js`'s `getRulesForFY(fy)` legacy wrapper (and the legacy wrappers in `services/memberLoanEligibility.js` / `services/loanApprovalAssessment.js`) are **still needed** by the remaining default-bound files — `formIntake.js`, `formIntakeAdmin.js`, `memberAutomation.js`, `jobs/deadlineScan.js`, `services/automaticFineIssuance.js`, `services/automaticMissingFineIssuance.js` — so they are not removal candidates yet.
- **Phase 4F-A — Admin / import / communications / mailer: IMPLEMENTED / PR OPEN / NOT MERGED.** `admin.js`, `import.js`, `communications.js`, `mailer.js`. See Section 14.
- **Phase 4F-B — Notifications and automation: NOT STARTED.** `notifications.js`, `memberAutomation.js`, `automaticFineCron.js`, `jobs/deadlineScan.js`, `services/automaticMissingFineIssuance.js` (and `services/automaticFineIssuance.js`). The cron/background pieces share the "which tenant does a cron run apply to" question with Phase 4H.
- **Phase 4G — Public workflows: NOT STARTED.** Form Intake, public forms, public loan-request flows. These have no authenticated tenant header today and need their own tenant-resolution design before migration is even possible.
- **Phase 4H — Background execution: NOT STARTED.** automatic fine cron, member reminders, deadline scan, other scheduled/background financial processes. Same "which tenant does this cron run apply to" question as Phase 4G, for non-request-triggered code.

## 10. Phase 5 activation gate

**Phase 5 — second-tenant activation / end-to-end validation** should only begin once every route/service/public flow/cron above is tenant-safe (i.e., Phase 4D through 4H are complete, merged, and production-verified). Phase 5 should include, in order:

1. Controlled second-tenant provisioning (a real `org_beta`-equivalent, created deliberately, not as a test artifact).
2. Second-tenant login.
3. Independent financial records for that tenant.
4. Cross-tenant isolation validation against production-shaped data.
5. Public-flow isolation validation (Form Intake, loan requests).
6. Cron/background isolation validation.
7. End-to-end acceptance testing across both tenants concurrently.
8. **Only then**, consideration of relaxing the hardcoded `org_checkpoint_investors` runtime restriction in `backend/tenancy/runtimeOrganization.js`.

Do not skip ahead to step 8 to "test" multi-tenancy — the restriction is the safety net that makes every phase before it low-risk, and it stays in force until every step above is done.

## 11. Explicit DO NOT list

- Do **not** move, copy, or re-key the existing Checkpoint Investors Club's financial records.
- Do **not** perform a production database migration of any kind.
- Do **not** activate a second production tenant/organization yet.
- Do **not** allow client-controlled database/tenant selection (`req.body.organization_id`, `req.query.organization_id`, `x-organization-id`, `x-tenant-id`, `database_name`, `slug`, `workspace`, or any equivalent) to influence model selection anywhere.
- Do **not** implement a fallback from `req.tenantModels` to the default/legacy model registry, in any migrated route.
- Do **not** change `server.js`'s hotfix mount order (hotfix routers must stay mounted before their base-router siblings).
- Do **not** use production Atlas for development or isolation testing — always `mongodb-memory-server`.
- Do **not** weaken or remove the single-runtime-tenant guard (`PHASE_3_RUNTIME_ORGANIZATION_ID` in `backend/tenancy/runtimeOrganization.js`).
- `org_beta` is test/control-plane context only — it must not be created in production `checkpoint_control` or enabled at runtime.
- Do **not** disable `ALLOW_LEGACY_ORGLESS_TOKENS` yet — retire it only after a full token TTL has passed since Phase 3 shipped.
- Do **not** silently fix financial-policy inconsistencies (like the one in Section 8) inside a tenancy-migration PR. Document and defer them.

---

## 12. Phase 4D — Loan domain (COMPLETE / MERGED)

**PR:** [#32](https://github.com/jkidune/checkpoint-dashboard/pull/32). **Merge SHA:** `de0921270db55af7fc96b669abf9c0b4767f8c7f`. **Merged:** 2026-10-11.

Four files migrated, 73 new tests, all 310 tests passing (237 baseline + 73 Phase 4D):

- **`backend/routes/loans.js`** — fully tenant-scoped. `enrichLoan(loan, rulesCache)` → `enrichLoan(models, loan, rulesCache)`. FY rules via `getRulesForFYWithModel(req.tenantModels.FyRules, fy)`; eligibility via `computeMemberLoanEligibilityWithModels(req.tenantModels, memberId, fy)`; counters via `req.tenantModels.getNextId(...)`. No `require('../db/models')` remains.
- **`backend/routes/loanActivationHotfix.js`** — fully tenant-scoped. `assessmentForLoan(loan, overrides)` → `assessmentForLoan(models, loan, overrides)`. Assessment via `assessLoanApprovalWithModels(req.tenantModels, {...})`. No `require('../db/models')` remains.
- **`backend/routes/loanRequests.js`** — fully tenant-scoped for authenticated routes; public `POST /` resolves tenant server-side via `resolveApprovedRuntimeTenant()`, ignoring any `organization_id` in body/query/headers. `matchMember`, `enrichRequest`, `buildRequestAssessment` all became model-explicit. No `require('../db/models')` remains.
- **`backend/services/loanApprovalAssessment.js`** — dual entry point: `assessLoanApprovalWithModels(models, options)` (new, tenant-explicit) and `assessLoanApproval({...})` (legacy wrapper, retained for callers outside the 4 migrated files). `buildContributionClearanceWithModels(models, ...)` is the model-explicit helper used by the new entry point.

`server.js` mount order (`loanActivationHotfix` before `loans`) is unchanged and proven correct via real HTTP behavior in `phase4dLoanActivation.test.js`.

Test files added: `phase4dTestApp.js` (helper), `phase4dLoans.test.js` (25 tests), `phase4dLoanActivation.test.js` (5 tests), `phase4dLoanRequests.test.js` (9 tests), `phase4dStaticBoundary.test.js` (26 static checks).

## 13. Phase 4E — Reporting, investments and reconciliation (COMPLETE / MERGED)

**Branch:** `phase4e-reporting-reconciliation-tenancy`. **Base:** `main` at `4df6b96` (Phase 4D COMPLETE / MERGED — PR [#32](https://github.com/jkidune/checkpoint-dashboard/pull/32), merge SHA `de0921270db55af7fc96b669abf9c0b4767f8c7f`). **State:** **COMPLETE / MERGED** — PR [#33](https://github.com/jkidune/checkpoint-dashboard/pull/33), merge SHA `5a1e019a9483c3adfec721fcea1c3a209651c4d6`; production deployment healthy, fail-closed checks passed. **Phase 4F has not started.** Quarterly Reports have not been started.

Four files migrated to `req.tenantModels`, with no fallback (each is `MIGRATED — Phase 4E` in `docs/tenant-route-migration.md`):

- **`backend/routes/investments.js`** — all four routes tenant-scoped. `valuateInvestments()` → `valuateInvestmentsWithModels(models)` (the no-arg function was **removed**; its only callers were `investments.js` and `summary.js`); `latestNav(models, provider, asset_class, asOf)`. `POST /nav` allocates `nav_update_id` from the tenant's counter.
- **`backend/routes/summary.js`** — `computeSummary(models)`; per-loan FY rules via `getRulesForFYWithModel(models.FyRules, fy)`; investments via `valuateInvestmentsWithModels(models)`; fines/welfare CRUD via `req.tenantModels` with tenant-local `fine_id` / `welfare_id`.
- **`backend/routes/fineCashHotfix.js`** — `syncPaidFineReceipts(models)` (exported); `models` captured before `res.on('finish')`; GET `/` and `/snapshot` repair through `req.tenantModels` before the summary is computed. Mount order (hotfix before summary) **unchanged** — proven by behaviour in `phase4eFineCash.test.js`.
- **`backend/routes/reconciliation.js`** — no `mongoose`, no `../db/models`. `syncCounter(models, Model, counterName, session)`, `nextId(models, counterName, session)`, `currentSnapshot(models)`, `preview(models, source)`. **The apply transaction's session comes from the tenant connection** (`models.ReconciliationRun.db.startSession()`), so the session, the counter sync/allocation inside the transaction and every document write are the tenant's.

Production commits on the branch, in order: `fb6a112` (investments), `7334ec9` (summary + fine cash hotfix), `4c0b1b6` (reconciliation), then `848ee16`, a behaviour-neutral one-line fix restoring the escaped `\u0300-\u036f` regex range in `normalizeName` that `4c0b1b6` had accidentally rewritten as invisible literal combining characters (byte-identical to `main` again; guarded by a regression test in `phase4eReconciliation.test.js`). No schema, `server.js`, auth or `tenancy/*` file changed — `server.js`, `middleware/auth.js`, `routes/auth.js`, `tenancy/runtimeOrganization.js`, `tenancy/tenantConnection.js`, `tenancy/tenantModels.js` and `db/tenantSchemas.js` have zero diff against `main`.

**Tests: 402/402 passing under `npm test`** (310 baseline — 303 test cases plus the 7 helper modules `node --test` also counts — plus 91 new test cases and 1 new helper module). The Phase 4E HTTP tests run on a disposable `MongoMemoryReplSet` (transactions need a replica set) through a Phase-4E-specific helper; the shared `helpers/memoryMongo.js` is untouched. Files: `helpers/phase4eTestApp.js`, `phase4eInvestments.test.js` (11), `phase4eSummary.test.js` (18), `phase4eFineCash.test.js` (9), `phase4eReconciliation.test.js` (17), `phase4eStaticBoundary.test.js` (36). The default database is poisoned with colliding-id sentinels (counters 5000+) for every Phase 4E model and, with `tenant_beta`, is deep-compared before/after every mutating operation. Reconciliation rollback is proven with real transactions: three failing sources (an early rule, a late rule after contributions/loans/repayments/fines were written, and the final bulk write after the investment upsert) each leave every `tenant_alpha` collection **and counter** exactly as it was. 65 deliberate regressions run against a scratch copy were all detected (details in `docs/multitenancy-architecture.md` Section 22).

**Deferred technical debt — five known pre-existing behaviours found while testing (identical on `main`, documented, not fixed — see `docs/multitenancy-architecture.md` Section 22 for detail):** `NavUpdate` has no numeric `id` field (the allocated `nav_update_id` is consumed but not stored; needs a schema change); an already-`applied` reconciliation `run_key` returns `idempotent: true` without comparing source hashes (the 409 only fires for non-applied prior runs); a failed apply reports pre-rollback tallies; `/apply` with a structurally valid file that has no `club` object never answers (unhandled rejection under Express 4); `GET /api/summary` runs the idempotent receipt repair for any authenticated caller before `requireAdmin` returns 403.

**Still true after Phase 4E:** the single-runtime-tenant restriction (`org_checkpoint_investors` only) is in force and was not touched; `org_beta` is rejected (403) on every Phase 4E route; no production Atlas access and no production data modification occurred; the application is **not** fully multi-tenant. Phase 4F+ routes (`admin.js`, `notifications.js`, `communications.js`, `import.js`, `mailer.js`, the Form Intake stack, `automaticFineCron.js`, `memberAutomation.js`, `jobs/deadlineScan.js`, `services/automaticFineIssuance.js`, `services/automaticMissingFineIssuance.js`) remain default-bound.

## 14. Phase 4F-A — Admin, import, communications and mailer (IMPLEMENTED / PR OPEN / NOT MERGED)

**Branch:** `phase4f-a-admin-import-comms-tenancy`. **Base:** `main` at `8aabe1c` (Quarterly Reports PR 1 merged; Phase 4E COMPLETE / MERGED). **State: IMPLEMENTED / PR OPEN / NOT MERGED — do not merge without the owner's decision; Codex review requested on the PR.** Phase 4F-B has not started. Quarterly Reports are not part of this work.

Four files migrated to `req.tenantModels`, with no fallback (each is `MIGRATED — Phase 4F-A` in `docs/tenant-route-migration.md`; `docs/multitenancy-architecture.md` Section 23 has the detail):

- **`backend/routes/admin.js`** — `sync-counters` rewrites the request tenant's own counters from the request tenant's collections; `migrate-member-office` uses `models.Member.collection`; `roster-audit` reads the tenant `Member` / `User` only.
- **`backend/routes/communications.js`** — all models, including `CommunicationLog`, from `req.tenantModels`; `contributionRecipients(models, month, year)` / `logCommunication(models, {…})` are model-explicit; FY rules via `getRulesForFYWithModel(models.FyRules, fy)` (no legacy `getRulesForFY`); duplicate-reminder protection reads the tenant's log.
- **`backend/routes/import.js`** — `Member` / `Contribution` / `Loan` / `Transaction` from `req.tenantModels`; numeric ids (including the generated transactions') reserved **in bulk** from the same tenant's counters — one atomic `$inc` per counter range via the model-explicit `reserveIdRange(models, counterName, count)`, then assigned in CSV order (not one counter update per row; counter state identical to N sequential `getNextId` calls). **Flagged behaviour change:** the pre-migration route never assigned ids (`insertMany` skips the `pre('save')` hook), so on `main` multi-row imports fail with `E11000 … { id: null }`; the migrated route works. Details in architecture doc Section 23.
- **`backend/routes/mailer.js`** — `Member` / `Contribution` / `User` and `getNextId('user_id')` from `req.tenantModels`; templates and SMTP / mock behaviour untouched.

`server.js` is **unchanged**: the retired `POST /api/mailer/broadcast-credentials` 410 handler still precedes the mailer router (proven over real HTTP), so that handler of the mailer router stays unreachable; it was migrated anyway and is proven by mounting the real router on a bare Express app inside the test only. `server.js`, `middleware/auth.js`, `routes/auth.js`, `tenancy/runtimeOrganization.js`, `tenancy/tenantConnection.js`, `tenancy/tenantModels.js` and `db/tenantSchemas.js` have zero diff against `main` (`CommunicationLog` was already in the tenant bundle).

**Tests:** `npm test` runs **608 tests** on the branch (435 on `main`: 434 pass + 1 pre-existing failure; plus 172 new Phase 4F-A test cases and 1 new helper module, which `node --test` also counts): 607 pass, 1 fails — the pre-existing `quarterlyReports.test.js` failure noted below. On the PR's first head, one of two full runs also saw an intermittent failure of a Phase 4E reconciliation rollback test that passes 5/5 in isolation (its transaction starts five `syncCounter` calls concurrently on one session, which appears to be a pre-existing race that heavy parallel load exposes; unrelated, not fixed here); it did not recur on the bulk-id-reservation fix. New files: `helpers/phase4fATestApp.js` (replica-set helper; shared `memoryMongo.js` untouched), `phase4fAAdmin.test.js` (11), `phase4fACommunications.test.js` (26), `phase4fAImport.test.js` (20), `phase4fAMailer.test.js` (13), `phase4fAStaticBoundary.test.js` (102). The default database and `tenant_beta` are snapshotted (every non-empty collection, counters included) and deep-compared after every call, SMTP is forced into mock mode with `nodemailer.createTransport` replaced by a throwing function, the import's bulk id reservation is measured with a counter-operation recorder (one `$inc` per range, however many rows), and **114 deliberate regressions on scratch copies were all detected — by the HTTP tests alone and by the static-boundary file alone** (details: architecture doc Section 23).

**Known pre-existing behaviours (identical on `main`, documented, not fixed):** the `Notification` schema has no numeric `id` field (the drawn `notification_id` is consumed but dropped by strict mode; notifications are identified by `_id`); `broadcast-reminders` uses a fixed `75000` amount due; `monthly-statement` loads all repayments and filters in memory; and `main` (at `8aabe1c`) has one failing test unrelated to this work — `quarterlyReports.test.js`, "activation write path matches disbursement by full loan identity including fiscal year" (its loan-activation `PATCH` answers 409 from the live approval assessment; it appears to be calendar-dependent; it fails identically with and without Phase 4F-A and was not investigated further or fixed here).

**Still true:** the single-runtime-tenant restriction (`org_checkpoint_investors` only) is in force and untouched; `org_beta` is rejected (403) on every Phase 4F-A route that authenticates; no production Atlas access, no production data modification, no real email and no real credentials were used; the application is **not** fully multi-tenant. Phase 4F-B, the Form Intake stack and the cron/background jobs remain default-bound.

## NEXT ACTION WHEN WORK RESUMES

**Phase 4E production verification (13 October 2026):** the merge commit's Vercel deployment succeeded; `GET /` returned 200 and `GET /api/health` returned `status: ok`; unauthenticated `GET /api/investments`, `/api/summary`, `/api/reconciliation/latest` and `/api/reconciliation/status` each returned 401 (fail-closed). Authenticated smoke and runtime-log inspection were **not run** (no authorized production credentials or Vercel log access in the verifying environment). No production mutation was performed. `org_beta` remains disabled, the single-runtime-tenant restriction remains active, the application is **not** fully multi-tenant, and Quarterly Reports implementation has **not** started. The remaining roadmap now starts at Phase 4F.

**Phase 4F-A status (15 October 2026):** implemented on branch `phase4f-a-admin-import-comms-tenancy`, PR **open and NOT merged**, Codex review requested. Nothing in production changed.

Phase 4D is **COMPLETE / MERGED** (PR [#32](https://github.com/jkidune/checkpoint-dashboard/pull/32), merge SHA `de0921270db55af7fc96b669abf9c0b4767f8c7f`). Phase 4E is **COMPLETE / MERGED** (PR [#33](https://github.com/jkidune/checkpoint-dashboard/pull/33), merge SHA `5a1e019a9483c3adfec721fcea1c3a209651c4d6`).

1. Phase 4E is merged; no further Phase 4E action is required.
2. **Phase 4F-A is awaiting review / merge by the owner.** Do not merge it on your own initiative; address Codex / owner review comments on the branch if any arrive.
3. Do **not** begin Phase 4F-B (`notifications.js`, `memberAutomation.js`, `automaticFineCron.js`, `jobs/deadlineScan.js`, `services/automaticMissingFineIssuance.js`) until the owner explicitly asks for it. Do not start Quarterly Reports as part of the tenancy work.
4. When Phase 4F-B begins, start from a fresh branch off the updated `main` (after 4F-A is merged), reuse the Phase 4E / 4F-A isolation pattern (poisoned default database with colliding ids, whole-database snapshots of default and `tenant_beta`, real HTTP, forced mock mail, negative controls), and keep `backend/server.js` mount order unchanged.
