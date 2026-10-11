# Checkpoint Multi-Tenancy Migration — Handoff

**Written:** 14 September 2026
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

### Merge SHAs

- Phase 4A: `bdb977a1431cb99e56b0cfb91330970dcd70c160`
- Phase 4B: `6e955422dac2d9ff961b7e769a154fac278b620c`
- Phase 4C: `54591173ddf219d4db33a96c4071b784ac195267`
- Phase 4D: `de0921270db55af7fc96b669abf9c0b4767f8c7f`

## 3. Current production safety posture

- Existing Checkpoint Investors Club financial data has **not** moved, been copied, or been re-keyed at any point in this migration. It lives in its original database; the tenant connection for `org_checkpoint_investors` resolves to that same physical database today.
- No production Atlas access has occurred during Phase 4A/4B/4C development or testing — all isolation testing uses `mongodb-memory-server` (disposable, in-memory).
- No production data has been modified as part of this migration work.
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

## 9. Remaining migration roadmap (Phase 4D–4H)

High-level, not yet scoped in detail:

- **Phase 4D — Loan domain:** `loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, `services/loanApprovalAssessment.js`, and associated tenant-safe dependencies. This is what still keeps `routes/rules.js`'s `getRulesForFY(fy)` legacy wrapper and `services/memberLoanEligibility.js`'s `computeMemberLoanEligibility(...)` legacy wrapper alive — once this phase migrates those callers, the legacy wrappers become candidates for removal.
- **Phase 4E — Financial reporting:** `summary.js`, `fineCashHotfix.js`, `investments.js`, reconciliation and related dependencies as appropriate. (`investments.js` and `summary.js` share the `valuateInvestments` export and must migrate together.)
- **Phase 4F — Operational/admin:** notifications, communications, `admin.js`/`import.js`/`mailer.js` and related paths.
- **Phase 4G — Public workflows:** Form Intake, public forms, public loan-request flows. These have no authenticated tenant header today and need their own tenant-resolution design before migration is even possible.
- **Phase 4H — Background execution:** automatic fine cron, member reminders, deadline scan, other scheduled/background financial processes. Same "which tenant does this cron run apply to" question as Phase 4G, for non-request-triggered code.

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

## NEXT ACTION WHEN WORK RESUMES

Phase 4D is **COMPLETE / MERGED** (PR [#32](https://github.com/jkidune/checkpoint-dashboard/pull/32), merge SHA `de0921270db55af7fc96b669abf9c0b4767f8c7f`). Phase 4E may begin.

**Phase 4E (financial reporting):** Begin Phase 4E — `summary.js`, `fineCashHotfix.js`, `investments.js` (must migrate together since `investments.js` exports `valuateInvestments`, shared with summary reporting), and their associated services. `routes/rules.js`'s `getRulesForFY(fy)` legacy wrapper is no longer called by any loan-domain file; it is a candidate for removal in Phase 4E or a subsequent cleanup.
