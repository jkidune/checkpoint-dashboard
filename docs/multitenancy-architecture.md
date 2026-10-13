# Checkpoint Multi-Tenant Architecture

> ## Phase 4D Complete / MERGED; Phase 4E Implemented (PR open, NOT merged) — October 2026
>
> Full context: [`docs/multitenancy-migration-handoff.md`](./multitenancy-migration-handoff.md).
>
> - Phase 4C (PR [#27](https://github.com/jkidune/checkpoint-dashboard/pull/27), merge SHA `54591173ddf219d4db33a96c4071b784ac195267`) is **COMPLETE / MERGED**.
> - Phase 4D (PR [#32](https://github.com/jkidune/checkpoint-dashboard/pull/32), merge SHA `de0921270db55af7fc96b669abf9c0b4767f8c7f`) is **COMPLETE / MERGED** into `main`. The loan domain (`loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, `services/loanApprovalAssessment.js`) is now live on `main`.
> - **Phase 4E is IMPLEMENTED / PR OPEN / NOT MERGED** (branch `phase4e-reporting-reconciliation-tenancy`, based on `main` at `4df6b96`). It migrates the reporting, investment-valuation and reconciliation stack — `routes/investments.js`, `routes/summary.js`, `routes/fineCashHotfix.js`, `routes/reconciliation.js` — to `req.tenantModels`. See [Phase 4E migration status](#22-phase-4e-migration-status). **Phase 4F has not started.**
> - The single-runtime-tenant restriction (`org_checkpoint_investors` only) is **still in force** and must not be weakened. Only `org_checkpoint_investors` is runtime-enabled.
> - The existing Checkpoint Investors Club's financial records have **not** moved, been copied, or been re-keyed at any point in this migration.
> - No production Atlas access, no production data modification, and no second-tenant production activation have occurred.

**Status:**

- **Phase 1 — control plane: complete.** Control database, `Organization` model, registry, guarded tenant-connection selector, legacy bootstrap tooling, baseline reporting. Checkpoint Investors Club is registered as Tenant #1.
- **Phase 2 — tenant-scoped model registry: complete.** Every tenant-owned Mongoose model can be bound to a specific tenant's connection through a guarded registry, with no schema duplicated between the default/legacy path and the tenant path.
- **Phase 3 — organization-aware authentication and request context: complete.** Organization identity is active at the auth/request boundary — the JWT carries `organization_id`, `authenticate` resolves and attaches `req.tenant`/`req.tenantModels`, and the auth routes themselves are tenant-model aware. **Checkpoint Investors Club remains the only runtime-permitted organization** — see [Phase 3 runtime tenancy boundary](#15-phase-3-runtime-tenancy-boundary) and [Phase 3 scope](#phase-3-scope-and-what-is-not-here-yet).
- **Phase 4 — route-by-route tenant model migration: Phase 4D merged; Phase 4E implemented (PR open, not merged).** `backend/routes/members.js`, `transactions.js`, `expenses.js` (Phase 4A), `backend/routes/memberLoanEligibility.js` (Phase 4B), the entire rules + contributions stack (Phase 4C, merged PR #27, SHA `54591173ddf219d4db33a96c4071b784ac195267`), the entire loan domain — `backend/routes/loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, `services/loanApprovalAssessment.js` (Phase 4D, merged PR #32, SHA `de0921270db55af7fc96b669abf9c0b4767f8c7f`) — and, on the open Phase 4E branch (`phase4e-reporting-reconciliation-tenancy`), the reporting, investment and reconciliation stack — `backend/routes/investments.js`, `summary.js`, `fineCashHotfix.js`, `reconciliation.js` — read/write exclusively through `req.tenantModels` or `resolveApprovedRuntimeTenant()` (for the public loan-request POST endpoint), with zero fallback to the default/legacy model registry. The admin/operational stack (`admin.js`, `notifications.js`, `communications.js`, `import.js`, `mailer.js`), the Form Intake stack, and the cron/background jobs are still default-bound (Phase 4F onward, not started) — see [Phase 4A migration status](#18-phase-4a-migration-status), [Phase 4B migration status](#19-phase-4b-migration-status), [Phase 4C migration status](#20-phase-4c-migration-status), [Phase 4D migration status](#21-phase-4d-migration-status), [Phase 4E migration status](#22-phase-4e-migration-status), and the full inventory in `docs/tenant-route-migration.md`. **The application is not fully multi-tenant** — the single-runtime-tenant restriction from Phase 3 still applies and remains load-bearing. Only `org_checkpoint_investors` is runtime-enabled.

This document uses Phase numbers, not GitHub PR numbers, as the durable reference — PR numbers are assigned by GitHub per submission and are not a stable way to talk about the architecture.

## 1. Why Checkpoint is moving to multi-tenancy

Checkpoint currently runs as a single hardcoded organization's books: one Express app, one MongoDB database, no concept of "which club" a request belongs to anywhere in the code. That was the right starting point for one investment club, but it does not extend to a second club without real architectural changes — every financial model, every route, and the authentication payload all assume exactly one tenant's data lives in the database.

Turning Checkpoint into a real SaaS product — onboarding additional investment clubs, VICOBA groups, and associations without hand-rolling a new deployment per customer — requires a deliberate tenancy model, introduced carefully because the data involved is real money: contributions, loans, fines, and reconciled balances.

## 2. Selected architecture: shared Atlas cluster + control DB + DB-per-organization

```
MongoDB Atlas Cluster
│
├── checkpoint_control                        (control database)
│   ├── organizations
│   ├── (future) identities
│   ├── (future) memberships
│   └── (future) invitations
│
├── <existing Checkpoint Investors Club DB>    (Tenant #1 — legacy, untouched)
│   ├── members
│   ├── contributions
│   ├── loans
│   ├── fines
│   ├── expenses
│   ├── investments
│   └── ... all current collections, unchanged
│
├── <future organization A database>
├── <future organization B database>
└── ...
```

One Atlas cluster hosts everything. No new cluster, no new credentials, no new infrastructure to provision per tenant — a **new logical database** on the same cluster. Each organization's financial collections live in their own database; a small shared `checkpoint_control` database holds SaaS-level metadata (organization registry, and later identity/membership/invitations) about all of them.

## 3. Why shared-document (`organization_id` on every record) tenancy was not selected first

The alternative standard approach is a single shared database where every document in every collection carries an `organization_id`, and every query filters by it. That was considered and set aside **for this codebase, at this stage**, for concrete reasons:

- Checkpoint's financial logic already carries real fragility: `backend/server.js` mounts several accumulated "hotfix" route files (`rulesHotfix`, `contributionsHotfix`, `loanActivationHotfix`, `fineCashHotfix`) layered in front of the canonical routes, and a real production incident was reconciled as recently as 12 September 2026 (see `docs/production-state-2026-09-12.md`). Retrofitting an `organization_id` filter into roughly 27 route files' worth of financial-query logic, correctly, in every place, is exactly the kind of change that fragile logic makes riskier, not safer.
- A single missed filter in a shared-document model is a **cross-tenant financial data leak** — one club's loan ledger or member balances becoming visible through another club's session. For a system whose entire job is being the trusted record of other people's money, that failure mode is unacceptable.
- Database-per-organization gets strong isolation "for free" from MongoDB itself: a connection scoped to one tenant's database structurally cannot see another tenant's collections, regardless of whether every single query remembered to filter correctly.
- It also means this migration does **not** require touching the existing financial models' query logic in this phase (or even the next one) to get the isolation guarantee in place — the tenancy foundation can be built and proven correct independently of that larger, riskier refactor.

The tradeoff is real and worth naming: database-per-tenant needs a provisioning step (new database + seeded configuration per signup) and a tenant-resolution layer that a shared-document model wouldn't need. That is considered the better tradeoff here.

## 4. Existing Checkpoint Investors Club is Tenant #1

The existing club is not being migrated, copied, re-keyed, or rewritten. It becomes the first organization in the control-plane registry **in place** — a single registry document that says "this organization's data lives in the database the app already uses today."

Reserved identity:

| Field | Value |
|---|---|
| `organization_id` | `org_checkpoint_investors` |
| `name` | Checkpoint Investors Club |
| `slug` | `checkpoint-investors-club` |
| `database_name` | *(the database the current `MONGO_URI` connection actually resolves to — never guessed, never hardcoded)* |
| `legacy` | `true` |
| `status` | `active` |

## 5. Existing financial data remains in place

No document in any existing collection (`members`, `contributions`, `loans`, `fines`, `expenses`, `investments`, `transactions`, `users`, `fy_rules`, `reconciliation_run`, `audit_source_record`, and so on) is moved, copied, re-keyed, or modified by any Phase 1 or Phase 2 tooling. The legacy tenant database is treated as immutable through both phases. The only production write either phase can make is a single document in the new control database, and only when a human explicitly runs the Phase 1 bootstrap script with `--apply`.

## 6. Control-plane responsibilities

The control database (`checkpoint_control` by default) is intentionally small. It owns:

- The **organization registry**: identity, slug, which physical database an organization's data lives in, status (`active` / `suspended` / `provisioning` / `archived`), and minimal metadata (country, currency, timezone).
- In a future phase: user identity and organization membership (who belongs to which organization, with what role), and invitations for onboarding new members/organizations.

The control plane explicitly does **not** own tenant-level financial configuration. Contribution amount, loan interest rate, entry fee, and similar constitution rules stay in each tenant's own `FyRules` collection, inside that tenant's database — those are per-organization business rules, not SaaS metadata.

## 7. Tenant database responsibilities

Each organization's database owns exactly what the current single database owns today. As of Phase 2, that's a formal, inventoried list rather than an implicit assumption — see [Section 14, tenant-owned model inventory](#14-tenant-owned-model-inventory). Nothing about the shape of that data changes in Phase 1 or Phase 2.

## 8. Auth model (activated in Phase 3)

Through Phase 2, the JWT carried only `id`, `username`, `role`, `member_id`, `name`, and no request was routed to a specific tenant connection. **Phase 3 activates this**: the JWT now also carries `organization_id`, and `authenticate` (`backend/middleware/auth.js`) resolves that claim into a tenant context on every authenticated request. See [Section 15](#15-phase-3-runtime-tenancy-boundary) for the full mechanics, the runtime allowlist, and why this is safe today with exactly one organization enabled.

`User` and `PasswordResetToken` remain tenant-owned in Phase 3 — authentication identities have not moved into `checkpoint_control`. A future phase (shared/global identity, real multi-organization membership) will revisit this; Phase 3 deliberately keeps today's "one user row per tenant, tenant-owned" model and just adds organization context around it.

## 9. Future organization provisioning

Not implemented yet. `backend/scripts/bootstrap-legacy-organization.js` is a one-time, human-run tool for registering the existing club — it is not a signup flow. `POST /api/auth/signup` (Phase 3) activates an account for a Member already present in the one approved organization — it is not organization signup either. A real provisioning flow (self-serve or admin-driven creation of a *new* organization, including creating its database and seeding default `FyRules`, and — critically — actually enabling it as a runtime tenant, see Section 15) is future work that will build on the `organizationRegistry` module from Phase 1 and the `getTenantModels()` registry from Phase 2.

## 10. Tenant-isolation security principles

> **Financial records belonging to one organization must never be queryable through another organization's tenant database context.**

> **Tenant database names must always be resolved from trusted control-plane records, never directly from user-supplied input.**

> **The control database must never be the same logical MongoDB database as any tenant database.**

Concretely, the only supported path to a tenant's data is:

```
organization_id
        │
        ▼
control-plane registry lookup          (organizationRegistry.getOrganizationById)
        │
        ▼
trusted Organization.database_name
        │
        ▼
getTenantConnection(...)               (backend/tenancy/tenantConnection.js)
```

`getTenantConnection()` **re-resolves the organization against the control-plane registry itself** on every call — it does not trust the shape of whatever object it was handed. A raw string (e.g. `req.query.database`) is rejected outright, an unknown `organization_id` is rejected, and if the caller's object also carries a `database_name` that disagrees with what the registry has on file, that is treated as a forgery attempt and rejected. JavaScript object identity or shape is never accepted as proof that a value actually came from the registry — only an actual registry lookup is. There is no generic "connect to whatever database name you give me" endpoint or helper anywhere in the codebase, and Phase 1 does not add one.

Separately, `backend/scripts/bootstrap-legacy-organization.js` enforces `CONTROL_DB_NAME !== tenantDatabaseName` before it touches the control database at all (not even a read), in both dry-run and `--apply`. A misconfiguration like `CONTROL_DB_NAME=test` alongside a legacy tenant database also named `test` would otherwise place the Organization registry inside the existing financial database — the bootstrap aborts safely instead, with zero writes.

The Organization model itself is only ever registered against the control database connection (`backend/tenancy/controlModels.js`), never against the application's default/tenant connection — so it is structurally impossible for tenant-side code to accidentally read or write organization registry data, and impossible for the control plane to accidentally expose a tenant's financial collections.

**Phase 2 extends this same principle to model binding.** `getTenantModels(organization)` (`backend/tenancy/tenantModels.js`) takes only an object carrying an `organization_id`; there is no `getTenantModels(databaseName)`, and there must never be one. It calls `getTenantConnection()` internally, so it inherits the exact same re-resolution-against-the-registry guarantee described above — a caller cannot hand it a forged `database_name` and have that trusted. `req.query.database`, `req.body.database`, and `req.headers['x-database']` (or anything shaped like them) have no path to model selection anywhere in this codebase.

## 11. Tenant model binding flow

Phase 2's binding pipeline, for every tenant-owned model:

```
SCHEMA DEFINITION                    (e.g. db/tenantSchemas.js, one canonical source)
        │
        ▼
MODEL BINDER                         (e.g. db/models.js: bindCoreModels(connection))
        │
        ▼
SPECIFIC MONGOOSE CONNECTION         (mongoose.connection, OR one tenant's connection)
```

Concretely:

```
organization_id
        │
        ▼
organizationRegistry.getOrganizationById()      (Phase 1, trusted)
        │
        ▼
trusted Organization.database_name
        │
        ▼
getTenantConnection(organization)                (Phase 1, guarded — see Section 10)
        │
        ▼
getTenantModels(organization)                    (Phase 2, this section)
        │
        ▼
{ Member, Contribution, Loan, ..., getNextId }   bound to that tenant's connection
```

Model registration itself uses `connection.models.X || connection.model('X', schema)` everywhere — never an additional independent cache. `connection.models` is Mongoose's own per-connection model cache, and `backend/tenancy/tenantConnection.js` already caches connections per `database_name` (from Phase 1). Together those two existing caches are sufficient: calling `getTenantModels()` repeatedly for the same organization is cheap and always returns the same underlying model instances, with no unbounded cache added anywhere in Phase 2.

## 12. Connection-local auto-increment counters

Before Phase 2, `getNextId()` and the `Counter` model it used were registered once, implicitly, against the default Mongoose connection (`mongoose.model('Counter', ...)`). That design cannot survive multi-tenancy unchanged: if two organizations shared one Counter collection, their auto-incrementing IDs would collide or interleave (Tenant A's `member_id` counter would keep advancing based on Tenant B's inserts).

`backend/db/counter.js` fixes this structurally:

- `getCounterModel(connection)` registers (or reuses) the `Counter` model — collection name `auto_counters`, unchanged — **on whatever connection is passed in**. There is no default; every caller must supply a connection.
- `createGetNextId(connection)` returns a `getNextId(name)` function whose `Counter` documents live in that same connection's database. It's cached per connection (a `WeakMap` keyed by the `Connection` object — bounded, garbage-collected with the connection, never an ever-growing plain map), so repeated calls for the same connection return the identical function.
- `addAutoIncrement(schema, counterName, getNextId)` attaches the same pre-save hook as before, except `getNextId` is now always passed in explicitly rather than closed over a fixed default.

The default/legacy compatibility path calls `createGetNextId(mongoose.connection)` — byte-for-byte the same behavior as before Phase 2. The tenant path calls `createGetNextId(tenantConnection)` for each tenant's own connection. **A tenant's `auto_counters` collection lives inside that tenant's own database, full stop** — there is no code path left that can reach a global/shared Counter for a tenant-aware call.

**Known pre-existing quirk (not introduced by Phase 2):** `Notification` and `NavUpdate`, unlike every other core schema, never declared their own `id: { type: Number, ... }` field. Mongoose gives every document a built-in `id` virtual (getter-only, returns `_id.toHexString()`), and `_id` is already set by the time a pre-save hook runs — so the `addAutoIncrement` guard (`this.id === undefined || this.id === null`) is never true for these two models, `getNextId()` is never actually called for them, and their `.id` field has always just been the Mongo ObjectId's hex string, not a sequential number. This is identical before and after Phase 2 (same schema, same hook) — it is a latent bug in the pre-Phase-2 codebase, not a regression, and fixing the schema is out of scope here (see [Phase 2 scope](#phase-2-scope-and-what-is-not-here-yet) — no schema evolution in this phase). It's called out explicitly so it isn't mistaken for something Phase 2 broke.

## 13. Compatibility model strategy

Every tenant-owned model's fields, defaults, required flags, enums, and indexes are defined in exactly ONE place:

- Core models (`Member`, `Contribution`, `Loan`, `Repayment`, `Transaction`, `User`, `Fine`, `WelfareEvent`, `FyRules`, `Expense`, `Investment`, `NavUpdate`, `Notification`, `ReconciliationRun`, `AuditSourceRecord`): `backend/db/tenantSchemas.js`, via `createCoreTenantSchemas({ getNextId })`.
- Each auxiliary model group keeps its own local schema factory in its existing file (`backend/db/communicationModels.js`, `backend/db/adminNotificationModels.js`, `backend/db/formIntakeModels.js`, `backend/db/loanRequestModels.js`) — no separate copy exists anywhere else.

Each of those files also exports a `bindXModels(connection)` function (`bindCoreModels`, `bindCommunicationModels`, `bindAdminNotificationModels`, `bindFormIntakeModels`, `bindLoanRequestModels`). Two things consume the exact same binder:

- **The default/legacy compatibility exports.** Each file calls its own `bindXModels(mongoose.connection)` once at module load and exports the result under the same names as before Phase 2 (plus the new `bindXModels` export, which is additive). `require('../db/models')` and friends behave identically to before — same model names, same collection names, same `getNextId` behavior, same indexes. **No existing route needed to change for this phase.**
- **The tenant model registry.** `backend/tenancy/tenantModels.js`'s `getModelsForConnection(connection)` calls all five `bindXModels(connection)` functions against a specific tenant's connection instead.

There is no schema drift possible between the two paths, because there is only one schema-definition call site per model — the only variable is which `connection` a binder is invoked with.

## 14. Tenant-owned model inventory

All of these are bound to a tenant's own database (default connection for the legacy tenant today; a tenant connection via `getTenantModels()` once a phase activates that path). **None of them may ever gain an `organization_id` field** — isolation comes from which physical database they live in, not from a field on the documents.

| Model | Export | Source file | Collection |
|---|---|---|---|
| Member | `Member` | `db/tenantSchemas.js` (bound in `db/models.js`) | `members` |
| Contribution | `Contribution` | same | `contributions` |
| Loan | `Loan` | same | `loans` |
| LoanRepayment | `Repayment` | same | `loanrepayments` |
| Transaction | `Transaction` | same | `transactions` |
| User | `User` | same | `users` |
| Fine | `Fine` | same | `fines` |
| WelfareEvent | `WelfareEvent` | same | `welfareevents` |
| FyRules | `FyRules` | same | `fyrules` |
| Expense | `Expense` | same | `expenses` |
| Investment | `Investment` | same | `investments` |
| NavUpdate | `NavUpdate` | same | `navupdates` |
| Notification | `Notification` | same | `notifications` |
| ReconciliationRun | `ReconciliationRun` | same | `reconciliationruns` |
| AuditSourceRecord | `AuditSourceRecord` | same | `auditsourcerecords` |
| Counter | `Counter` | `db/counter.js` | `auto_counters` |
| CommunicationLog | `CommunicationLog` | `db/communicationModels.js` | `communicationlogs` |
| PasswordResetToken | `PasswordResetToken` | `db/communicationModels.js` | `passwordresettokens` |
| AdminNotificationState | `AdminNotificationState` | `db/adminNotificationModels.js` | `adminnotificationstates` |
| FormIntakeSubmission | `FormIntakeSubmission` | `db/formIntakeModels.js` | `formintakesubmissions` |
| LoanRequestSubmission | `LoanRequestSubmission` | `db/loanRequestModels.js` | `loanrequestsubmissions` |

**Control-plane only** (never tenant-owned, never bound via `getTenantModels()`): `Organization` (`backend/tenancy/controlModels.js`, database `checkpoint_control`).

## 15. Phase 3 runtime tenancy boundary

> **A registered Organization is NOT necessarily an enabled runtime tenant. Control-plane registration != runtime activation.**
>
> **Until every financial route uses `req.tenantModels`, no second runtime tenant may be enabled.**

Phase 3 activates organization identity at the authentication/request boundary, but strictly for one organization:

```
authenticated identity (JWT)
        │
        ▼
organization_id                          (from the verified token only — never req.body/query/headers)
        │
        ▼
Phase 3 runtime allowlist                (backend/tenancy/runtimeOrganization.js — a fixed constant, org_checkpoint_investors)
        │
        ▼
trusted Organization registry lookup     (Phase 1)
        │
        ▼
organization.status === 'active'
        │
        ▼
getTenantModels({ organization_id })     (Phase 2)
        │
        ▼
req.tenant, req.tenantModels
```

### Why exactly one runtime organization

Existing financial routes (contributions, loans, fines, transactions, investments, etc.) still import the default/legacy models directly — Phase 2 made that *possible* to change, but did not change it. That is only safe because, today, the default connection's database and `org_checkpoint_investors`'s tenant connection resolve to the exact same physical database. If a second organization were activated before those routes migrate to `req.tenantModels`, an authenticated request for that second organization would still have its financial routes querying the *first* organization's data — a real cross-tenant data exposure, not a hypothetical one. `backend/tenancy/runtimeOrganization.js` enforces this with a hardcoded constant (`PHASE_3_RUNTIME_ORGANIZATION_ID = 'org_checkpoint_investors'`), never read from an environment variable, database flag, or request — so simply adding a second `Organization` document to `checkpoint_control` does not, by itself, activate anything.

### JWT payload

Before Phase 3: `{ id, username, role, member_id, name }`. After: `{ id, username, role, member_id, name, organization_id }`. `organization_id` is the tenant's stable identity (safe to hand to the client) — `database_name` is never put in a JWT, URL, header, frontend state, or API response anywhere in this codebase.

### JWT signing secret and algorithm

`JWT_SECRET` has no built-in fallback. `backend/middleware/auth.js` throws at load time if it's unset — a missing secret fails the application closed rather than falling back to a hardcoded value, which this Phase 3 boundary specifically cannot tolerate: a predictable secret would let anyone forge `role: "admin"` or `organization_id: "org_checkpoint_investors"` claims, and a verified token's `organization_id` is exactly what this whole section treats as trusted. Signing (`routes/auth.js`) and verification (`middleware/auth.js`) both pin the algorithm explicitly to `HS256`, so a token cannot be forged by switching algorithms (e.g. `alg: "none"`). Tests set their own `JWT_SECRET` before the auth module loads — there is no `NODE_ENV=test` fallback in application code.

### `authenticate` middleware behavior

After verifying the JWT signature/expiry (401 on failure), `authenticate` (`backend/middleware/auth.js`) reads `organization_id` from the **verified token payload only**. It is never read from `req.body`, `req.query`, or any request header — there is no code path from `req.body.organization_id`, `req.query.organization_id`, `x-organization-id`, or `x-tenant-id` to tenant selection anywhere in this codebase. It then resolves that `organization_id` through `backend/tenancy/resolveRuntimeTenant.js` and attaches:

- `req.user` — the verified token payload (unchanged shape, now includes `organization_id`).
- `req.tenant` — `{ organization_id, name, slug, status }`. **Never `database_name`.**
- `req.tenantModels` — the Phase 2 tenant model bundle for that organization.

Existing protected routes that already use `authenticate` receive `req.tenant`/`req.tenantModels` automatically, with zero code changes — they simply don't use them yet (see "Why exactly one runtime organization" above for why that's safe today).

### Error behavior (fail-closed)

| Condition | Status |
|---|---|
| Missing / invalid / expired JWT | 401 |
| Token's `organization_id` isn't the Phase 3 approved one (whether it's a real different organization or doesn't exist at all — both are simply "not permitted", which also avoids leaking which organization_ids exist) | 403 |
| The approved organization exists but `status` isn't `active` (`suspended` / `archived` / `provisioning`) | 403 |
| The approved organization_id is missing from the registry, or the control plane / tenant connection can't be reached | 503 |

No condition ever falls back to a different tenant or to the default database "because tenant resolution failed" — every failure is a hard stop with one of the statuses above.

### Legacy orgless token compatibility

Tokens issued before Phase 3 don't carry `organization_id`. Rather than invalidating every existing 7-day session on deploy, a verified token with no `organization_id` claim is temporarily treated as belonging to `org_checkpoint_investors` — controlled by `ALLOW_LEGACY_ORGLESS_TOKENS` (default: enabled; set to `false` to disable). This fallback applies **only** when the token's signature verifies and it simply predates the claim — a token with an explicit, different `organization_id` is rejected on its own merits and never falls back to the approved organization. **This is temporary migration compatibility**: once at least one full token TTL (7 days) has elapsed after this phase's deployment, `ALLOW_LEGACY_ORGLESS_TOKENS` should be turned off (or this fallback removed entirely) in a later phase, since every token in circulation will by then already carry `organization_id`.

### Auth routes are now tenant-model aware

`login`, `signup`, `forgot-password`, and `reset-password` have no JWT yet, so they explicitly resolve the one approved runtime organization server-side (`resolveApprovedRuntimeTenant()`) and use its `tenantModels.User` / `.Member` / `.PasswordResetToken` / `.CommunicationLog` / `.getNextId` — never the default/legacy imports, and never anything derived from client input. `change-password`, `set-email`, and `me` (authenticated) use `req.tenantModels`, already resolved by `authenticate`. No auth route queries the global `require('../db/models')` User/Member/etc. anymore.

Password reset stays tenant-owned and single-tenant-scoped in Phase 3: because only one runtime organization exists, reset-token lookup resolves against that one tenant server-side — there is no cross-tenant token search, and there must not be one added later without a real shared-identity redesign.

### Public / non-authenticated workflows stay legacy-only

Google Form Intake, loan-request intake, the automatic-fines cron, the member-reminder cron, the legacy `/api/forms` endpoint, and `/api/health` are **not** tenant-enabled in Phase 3. They continue operating exactly as before, against the default/legacy connection, with no tenant header and no inference of tenant from submitted member name/email/phone. Tenant-enabling them is later work, alongside the route-by-route financial migration.

## 16. Migration phases

1. **Phase 1 — Control plane (complete).** Control database, `Organization` model, registry module, guarded tenant-connection selector, legacy bootstrap tooling, baseline reporting. Zero behavior change to the running application.
2. **Phase 2 — Tenant-scoped model registry (complete).** Every tenant-owned model (Section 14) can be bound to any tenant's connection via `getTenantModels()`, with connection-local auto-increment counters and zero schema drift from the default/legacy path. Zero behavior change to the running application — no route imports changed, no request depended on the control plane or tenant connections yet.
3. **Phase 3 — Organization-aware authentication and request context (complete).** Organization identity activated at the auth boundary: JWT `organization_id`, `authenticate` resolving and attaching `req.tenant`/`req.tenantModels`, auth routes (`login`/`signup`/`change-password`/`forgot-password`/`reset-password`/`set-email`/`me`) using tenant models. Restricted to exactly one runtime organization by a hardcoded allowlist — see Section 15. Existing protected (non-auth) routes receive `req.tenant`/`req.tenantModels` automatically but do not use them yet; their query behavior is unchanged.
4. **Phase 4 — Route-by-route tenant model migration (in progress).** Migrating existing routes, one controlled batch at a time, from the default/legacy model imports to `req.tenantModels`.
   - **Phase 4A (complete):** `members.js`, `transactions.js`, `expenses.js` — see Section 18.
   - **Phase 4B (complete):** `memberLoanEligibility.js` (route + a new tenant-explicit entry point on its service), plus a model-explicit FY rules resolver (`services/fyRules.js`) extracted so that entry point can resolve `FyRules` from `req.tenantModels` — see Section 19. The service's original default-bound function is retained unchanged for `loanApprovalAssessment.js`, which is not migrated.
   - **Phase 4C (complete, merged):** the entire rules + contributions stack — `rules.js`'s live HTTP routes, `rulesHotfix.js`, `contributions.js`, `contributionsHotfix.js` — see Section 20. `rules.js`'s `getRulesForFY(fy)` export is retained unchanged as a temporary default-bound compatibility API.
   - **Phase 4D (complete, merged — PR #32, merge SHA `de0921270db55af7fc96b669abf9c0b4767f8c7f`):** the loan domain — `loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, `services/loanApprovalAssessment.js` — see Section 21. `assessLoanApproval({...})` legacy wrapper retained for callers outside the 4 migrated files.
   - **Phase 4E (implemented, PR open, NOT merged):** the reporting, investment-valuation and reconciliation stack — `investments.js`, `summary.js`, `fineCashHotfix.js`, `reconciliation.js` — see Section 22. The reconciliation transaction's session is created from the tenant connection. `routes/rules.js`'s `getRulesForFY(fy)` legacy wrapper is **still needed** by the remaining default-bound Phase 4F+ files and is not yet a removal candidate.
   - **Future batches (Phase 4F onward — NOT started):** the operational/admin stack (`import.js`, `mailer.js`, `admin.js`, `notifications.js`, `communications.js`), the Form Intake stack (`formIntake.js`, `formIntakeAdmin.js`, `formIntakeAllocationGuard.js`, `forms.js`), the automatic fine cron and its services, the member-reminder cron and deadline scan, real self-serve organization provisioning. Only once every route is migrated is it safe to raise the Phase 3 runtime allowlist beyond one organization — see `docs/tenant-route-migration.md` for the full batch plan.

Each phase should re-run `npm run tenancy:baseline` before and after and diff the two reports as a first-pass operational sanity check — understanding, per the caveat in that tool's own output, that matching counts/sums is a useful signal, not proof of accounting equivalence.

## 17. Rollback principle

Every phase is designed to be reversible without touching the legacy tenant's financial data:

- Neither Phase 1 nor Phase 2 introduced a new runtime dependency for the existing application — if the control database was unreachable, current production endpoints were unaffected, because nothing called into `backend/tenancy/*` yet. Reverting either phase was a no-op for production behavior.
- The Phase 1 legacy bootstrap script only ever writes one document, to one collection, in the new control database. Rolling it back is deleting that one document — it never touches, and cannot touch, the legacy tenant's own collections.
- Phase 2 added no new collections and performed no writes of its own; it only added code paths that construct model bindings. Reverting it removes those code paths and nothing else.
- **Phase 3 is the first phase where the control plane becomes a real runtime dependency**: every authenticated request now reads the `Organization` registry. If the control database is unreachable, authenticated requests fail with 503 (fail-closed, per Section 15's error table) rather than falling back to a permissive default — this is intentional, but it does mean control-plane availability now matters for login/authenticated traffic, which it did not in Phase 1/2. Reverting Phase 3 (reverting `backend/middleware/auth.js` and `backend/routes/auth.js` to their pre-Phase-3 versions) removes that dependency again; it changes no financial data.
- The `ALLOW_LEGACY_ORGLESS_TOKENS` compatibility fallback is itself a rollback safety net — it exists so that Phase 3 can deploy without forcibly invalidating existing sessions. It should be retired in a later phase once a full token TTL has passed.
- Phase 4A adds no new collections and performs no writes of its own; it only changes which connection three route files' existing queries run against. Reverting it (restoring `members.js`/`transactions.js`/`expenses.js` to their pre-Phase-4A versions) is safe and changes no financial data — the underlying `tenant_alpha`/default-connection data is identical either way, since they're the same physical database today.
- Phase 4B adds no new collections and performs no writes of its own either; it changes which connection one route's read-only calculation runs against, and adds a second, purely additive entry point to an existing service (the original `computeMemberLoanEligibility` function is untouched). Reverting it (restoring `routes/memberLoanEligibility.js`, `services/memberLoanEligibility.js`, and `routes/rules.js` to their pre-Phase-4B versions, and removing `services/fyRules.js`) is safe and changes no financial data, for the same reason as Phase 4A.
- Phase 4C adds no new collections either; it changes which connection four route files' existing queries run against, and adds no new write paths beyond what those routes already performed. `routes/rules.js`'s `getRulesForFY(fy)` and `calculateFine(...)` exports are untouched in behavior. Reverting it (restoring `rules.js`, `rulesHotfix.js`, `contributions.js`, and `contributionsHotfix.js` to their pre-Phase-4C versions) is safe and changes no financial data, for the same reason as Phase 4A/4B.
- Phase 4D adds no new collections either; it changes which connection four files' existing queries run against, and adds `assessLoanApprovalWithModels` as an additional entry point to `loanApprovalAssessment.js` (the legacy `assessLoanApproval` wrapper is retained). Reverting it (restoring `loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, and the added function to their pre-Phase-4D versions) is safe and changes no financial data.
- Phase 4E adds no new collections and no new write paths either; it changes which connection four files' existing queries, writes, counters and (for reconciliation apply) the existing MongoDB transaction run against, and replaces the no-arg `valuateInvestments()` with the model-explicit `valuateInvestmentsWithModels(models)` (its only two callers were migrated in the same phase). Reverting it (restoring `investments.js`, `summary.js`, `fineCashHotfix.js`, and `reconciliation.js` to their pre-Phase-4E versions) is safe and changes no financial data, for the same reason as Phase 4A–4D — `tenant_alpha` and the default connection are the same physical database today.

## 18. Phase 4A migration status

Three route files now read/write exclusively through `req.tenantModels`, with **no fallback** to the default/legacy model registry:

- `backend/routes/members.js` — `GET /`, `GET /me`, `GET /:id`, `POST /`, `PATCH /:id`. The `loadContext()` helper, which previously closed over module-level default models, now takes an explicit `{ Contribution, Loan, Repayment, Fine, User }` argument built from `req.tenantModels` inside each handler — it can no longer accidentally read a different tenant's (or the default connection's) data.
- `backend/routes/transactions.js` — `GET /`, `POST /`.
- `backend/routes/expenses.js` — `GET /`, `GET /categories`, `POST /`, `PATCH /:id`, `DELETE /:id`.

All three: `Model.create()`/auto-increment calls use `req.tenantModels.getNextId(...)`, never a default/global counter; no route reads tenant identity from `req.body`/`req.query`/any header (`organization_id`, `x-organization-id`, `x-tenant-id`, `database_name`, `workspace`, `slug` are all ignored — tenant context comes only from what `authenticate` already attached).

**Everything else is still default-bound.** No other route, service, job, or utility changed in Phase 4A — see the full inventory and category breakdown in `docs/tenant-route-migration.md`. The application is **not** fully multi-tenant after this batch; it remains safe only because of the Phase 3 single-runtime-tenant restriction (Section 15) — every other route's default-connection queries still resolve to the same physical database as `org_checkpoint_investors`'s tenant connection.

Explicitly **not** touched in Phase 4A, by design (each needs a dedicated, coordinated batch): `investments.js` (its `valuateInvestments` export is shared with `summary.js` — migrating one without the other would split one calculation across two data sources), `notifications.js` (combines four model sources plus `deadlineScan` plus email side effects), the four hotfix stacks (`rulesHotfix`, `contributionsHotfix`, `loanActivationHotfix`, `fineCashHotfix` — consolidation happens alongside their domain's migration, not before), and every public/cron workflow (Form Intake, loan-request intake, the automatic-fines cron, the member-reminder cron — none of these have a tenant-resolution design yet, since they aren't authenticated requests).

## 19. Phase 4B migration status

One route and one dual-entry-point service now read exclusively through `req.tenantModels` for the member-facing loan eligibility path, with **no fallback** to the default/legacy model registry:

- `backend/routes/memberLoanEligibility.js` — `GET /` (`/api/member/loan-eligibility`) now calls `computeMemberLoanEligibilityWithModels(req.tenantModels, req.user.member_id, fiscalYear)` instead of the previous default-bound `computeMemberLoanEligibility(...)`. Response shape, status codes (missing-member-record 404, member-not-found 404), and `fiscal_year` query behavior are all unchanged.
- `backend/services/memberLoanEligibility.js` now exports two entry points built on a single shared shaping function (`buildEligibilityResult`), so the calculation and response shape are guaranteed identical between them:
  - `computeMemberLoanEligibilityWithModels(models, memberId, fiscalYear)` — tenant-explicit. Every database read (`Member`, `Contribution`, `Loan`, `Fine`, `FyRules`) comes from the caller-supplied `models` object. There is no fallback: an incomplete or invalid `models` bundle throws rather than silently resolving against the default connection.
  - `computeMemberLoanEligibility(memberId, fiscalYear)` — the original function, retained **unchanged** in behavior as the legacy/default-bound compatibility entry point. `backend/services/loanApprovalAssessment.js` (not migrated in this phase) continues to import and call it with its existing signature, with zero code changes required on its side.
- `backend/services/fyRules.js` (new) — extracted the FY `DEFAULTS` table and default/DB-record merge semantics out of `backend/routes/rules.js` into a model-agnostic `getRulesForFYWithModel(FyRules, fy)` (and a `getRulesForFYWithModels(models, fy)` convenience wrapper). `backend/routes/rules.js`'s `getRulesForFY(fy)` — at the time of Phase 4B, the compatibility entry point used by `contributions.js`, `loans.js`, `rulesHotfix.js`, and `loanApprovalAssessment.js` — now simply delegates to `getRulesForFYWithModel(FyRules, fy)` using the default/legacy `FyRules` model. This is a relocation of existing logic, not a behavior change: the FY 2024/2025/2026 defaults and the "defaults spread first, DB record overrides" merge order are byte-for-byte identical to before. (As of Phase 4C, `contributions.js` and `rulesHotfix.js` no longer call this legacy wrapper — see Section 20 — leaving `loans.js` and `loanApprovalAssessment.js` as its only remaining callers.)

**Everything else is still default-bound**, including the rest of the loan domain: `loans.js`, `loanRequests.js`, and `loanApprovalAssessment.js` all remain on the default/legacy connection. No other route, service, job, or utility changed in Phase 4B — see the full inventory and category breakdown in `docs/tenant-route-migration.md`. The application is **not** fully multi-tenant after this batch; it remains safe only because of the Phase 3 single-runtime-tenant restriction (Section 15).

## 20. Phase 4C migration status

**Status: implemented and human-reviewed; PR [#27](https://github.com/jkidune/checkpoint-dashboard/pull/27) is NOT merged.** Two test-hardening gaps were identified during review (no production-code defect) and must be closed before merge — see [`docs/multitenancy-migration-handoff.md`](./multitenancy-migration-handoff.md) for the exact outstanding items and resume instructions.

The entire rules + contributions stack now reads/writes exclusively through `req.tenantModels` on its live request paths, with **no fallback** to the default/legacy model registry:

- `backend/routes/rules.js` — `GET /`, `GET /:fy`, `PUT /:fy`, and `DELETE /:fy` now resolve `req.tenantModels.FyRules` directly, using `getRulesForFYWithModel(req.tenantModels.FyRules, fy)` for `GET /:fy`. The `DEFAULTS` table, the "defaults spread first, DB record overrides" merge order, `_fromDB` behavior, response fields, and status codes are all unchanged. Its `getRulesForFY(fy)` export is **retained, unchanged, as a temporary default-bound compatibility API** — required by `loans.js` and `services/loanApprovalAssessment.js`, neither of which is migrated. `buildFinesForFY(fy, rules)` became `buildFinesForFY(models, fy, rules)`, and this file's own `/:fy/scan-fines`/`/:fy/recalculate-fines` handlers were migrated too even though they're shadowed at runtime by `rulesHotfix.js` — so there is no hidden default-bound fallback if `server.js`'s mount order ever changes.
- `backend/routes/rulesHotfix.js` — the **live** path for `POST /api/rules/:fy/scan-fines` and `/:fy/recalculate-fines` (mounted before `rules.js`). Every model (`Contribution`, `Fine`, `Member`, `getNextId`, `FyRules`) now comes from `req.tenantModels`, and FY rules resolve via `getRulesForFYWithModel`, never the legacy wrapper. `buildFineCandidates(fy, rules)` became `buildFineCandidates(models, fy, rules)`. Behavior unchanged: one fine max per contribution month, paid historical fines remain immutable in recalculate, unpaid auto fines may be corrected.
- `backend/routes/contributions.js` — `GET /`, `GET /grid/:year`, `GET /fine-preview`, `POST /`, `PATCH /:id`, `DELETE /:id`, `GET /bulk-payment-preview`, and `POST /bulk-payment` all resolve every model from `req.tenantModels`. `computeBulkAllocation(memberId, totalAmount, paidDate)` became `computeBulkAllocation(models, memberId, totalAmount, paidDate)`.
- `backend/routes/contributionsHotfix.js` — the **live** path for `POST /api/contributions`, `GET /fine-preview`, `GET /bulk-payment-preview`, and `POST /bulk-payment` (mounted before `contributions.js`). `getExistingFine(memberId, month, year)` became `getExistingFine(models, memberId, month, year)`, and `computeBulkAllocation` was migrated the same way as in `contributions.js`. The bulk allocation algorithm and its safety properties are preserved exactly: contributions allocated oldest-first, a fine is marked paid only when the remainder can settle it in full (`blocked_by_partial_fine`, never a partial-fine balance recorded), then loan repayment, then a partial next contribution.
- `server.js`'s mount order — `rulesHotfix` before `rules.router`; `contributionsHotfix` before `contributions` — is byte-for-byte unchanged, and was proven unchanged through real HTTP behavior (response-shape fields unique to each handler), not inferred from source.

**Known pre-existing policy inconsistency, discovered during Phase 4C testing, not fixed:** `rulesHotfix.js`'s `recalculate-fines` selects existing auto-fines to correct via `reason: /^Late contribution/`, but its sibling `scan-fines` (via `services/contributionFinePolicy.js`'s `calculateOneTimeFine`) always generates fines whose reason starts with `"Missing contribution ..."` — never `"Late contribution ..."`. A fine `scan-fines` itself created can therefore never be found and corrected by `recalculate-fines`'s own query. This predates the migration and is documented, not fixed, per the "do not reconcile fine-policy differences" instruction for this phase.

**Everything else is still default-bound**, including the loan domain (`loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, `services/loanApprovalAssessment.js`) and the automatic fine cron (`automaticFineCron.js`, `services/automaticFineIssuance.js`, `services/automaticMissingFineIssuance.js`). No other route, service, job, or utility changed in Phase 4C — see the full inventory and category breakdown in `docs/tenant-route-migration.md`. The application is **not** fully multi-tenant after this batch; it remains safe only because of the Phase 3 single-runtime-tenant restriction (Section 15).

## Phase 1 scope and what was not in it

Phase 1 was foundation only. It deliberately did **not**:

- Change request routing, login/signup behavior, or JWT contents.
- Touch the financial models in `backend/db/models.js` or any of their calculations.
- Add `organization_id` to any existing collection.
- Modify existing indexes, `FyRules` uniqueness, reconciliation records, fines, transactions, or balances.
- Add tenant-resolution middleware to `backend/server.js`.
- Consolidate the existing hotfix routes.
- Write anything to production beyond the one Tenant #1 registry document, applied only after explicit human review.

## Phase 2 scope and what is not here yet

Phase 2 is architectural extraction/binding, not schema evolution, and not request-level tenancy. It deliberately does **not**:

- Switch any existing HTTP route to the tenant model registry. Every route still uses its existing `require('../db/models')`-style imports, completely unchanged.
- Change `backend/server.js`, JWT payloads, `authenticate`/`requireAdmin` middleware, login, signup, `req.user`, the frontend auth flow, or any URL structure.
- Add `req.tenant`, a workspace/organization selector, or any other request-level tenancy concept.
- Redesign any schema: field names, defaults, required flags, enums, unique/compound/sparse/TTL indexes, collection names, model names, timestamp behavior, pre-save hooks, and existing ID semantics (including the `Notification`/`NavUpdate` quirk noted in Section 12) are all preserved exactly.
- Move `User` or `PasswordResetToken` into `checkpoint_control` — both remain tenant-owned.
- Change Form Intake / loan-request Google Form routing, intake authentication, or mailing behavior.
- Consolidate the existing hotfix routes.
- Touch the real Atlas production database in any way — all Phase 2 development and testing ran against `mongodb-memory-server` (a disposable in-memory MongoDB), never `test` or `checkpoint_control`.

Those all remain deliberately out of scope until Phase 3.

## Phase 3 scope and what is not here yet

Phase 3 activates organization identity at the authentication/request boundary, for exactly one organization. It deliberately does **not**:

- Onboard a second real organization, or activate more than `org_checkpoint_investors` as a runtime tenant — enforced in code by a hardcoded constant (`backend/tenancy/runtimeOrganization.js`), not by convention. Adding a second `Organization` document to `checkpoint_control` does not, by itself, change this.
- Add a workspace/organization switcher, organization creation flow, or any club-selection UI. The frontend's existing login flow is unchanged.
- Migrate any existing (non-auth) protected route's data-access from the default/legacy models to `req.tenantModels` — they receive `req.tenant`/`req.tenantModels` automatically once authenticated, but keep querying the default connection directly, which is safe only because of the single-runtime-tenant restriction above.
- Tenant-enable Google Form Intake, loan-request intake, the automatic-fines cron, the member-reminder cron, the legacy `/api/forms` endpoint, or `/api/health` — all continue operating as the existing legacy organization's workflows, with no tenant header and no inference of tenant from submitted member details.
- Change `backend/server.js` (no change was needed — tenant context enters through `authenticate` and the auth routes, not through global request middleware).
- Consolidate the existing hotfix routes (`rulesHotfix`, `contributionsHotfix`, `loanActivationHotfix`, `fineCashHotfix`) — that happens alongside each domain's future route migration, not here.
- Redesign `requireAdmin` / `requireSelfOrAdmin` semantics — both still operate on `req.user.role` / `req.user.member_id` exactly as before; organization identity was simply added alongside.
- Move `User` or `PasswordResetToken` into `checkpoint_control`.
- Change passwords, password hashes, or token expiry (`7d`, unchanged).
- Expose `database_name` anywhere — not in the JWT, not in `/api/auth/me`, not in the public user object returned by login/signup, not in `req.tenant`.
- Touch the real Atlas production database in any way during development or testing — all Phase 3 development and testing ran against `mongodb-memory-server`, with a locally-registered `org_beta` used only inside that disposable test database, never in `checkpoint_control` or `test`.

Those all remain deliberately out of scope until the route-by-route tenant model migration phase.

## Phase 4A scope and what is not here yet

Phase 4A migrates exactly three route files to `req.tenantModels` — `members.js`, `transactions.js`, `expenses.js`. It deliberately does **not**:

- Migrate any other route, service, job, or utility. See `docs/tenant-route-migration.md` for the complete inventory and per-file status.
- Migrate `investments.js` or `summary.js` (deliberately coordinated together in a future batch, since `investments.js` exports `valuateInvestments`, shared with summary reporting).
- Migrate `notifications.js` (combines Notification/Member/FormIntakeSubmission/AdminNotificationState/`deadlineScan`/email side effects — its own coordinated batch).
- Consolidate or otherwise touch the hotfix stacks (`rulesHotfix`, `contributionsHotfix`, `loanActivationHotfix`, `fineCashHotfix`) or change `server.js`'s route-mounting order.
- Tenant-enable Form Intake, loan-request intake, the automatic-fines cron, or the member-reminder cron.
- Change `backend/server.js`, `backend/middleware/auth.js`, `backend/routes/auth.js`, JWT structure, `JWT_SECRET` handling, the HS256 restriction, or legacy orgless-token compatibility — Phase 3 is complete; Phase 4A only consumes its output (`req.tenantModels`).
- Change any schema, redesign any business logic (fiscal-year calculation, loan-balance math, contribution totals, member permissions, expense categories, transaction semantics), rename any response field, or change any status code beyond what's needed to preserve existing behavior.
- Activate `org_beta`, or any second organization, in production. The Phase 3 single-runtime-tenant allowlist (`org_checkpoint_investors` only) is unchanged.
- Touch the real Atlas production database in any way during development or testing — all Phase 4A development and testing ran against `mongodb-memory-server`; `org_beta` and the poisoned default-DB sentinel records exist only inside that disposable test database.

**Known pre-existing item, not introduced or fixed in this phase:** `members.js`'s `PATCH /:id` still uses Mongoose's deprecated `{ new: true }` option on `findOneAndUpdate` (logs a deprecation warning) rather than `{ returnDocument: 'after' }`, which `expenses.js`'s equivalent route already uses — an inconsistency that predates Phase 4A. Preserved as-is per the "no behavior refactor" rule for this migration; worth fixing in a future, unrelated cleanup.

Those all remain deliberately out of scope until the next Phase 4 batch.

## Phase 4B scope and what is not here yet

Phase 4B migrates exactly one route (`memberLoanEligibility.js`) and adds one tenant-explicit entry point to its service, plus the minimum shared FY-rules extraction needed to support it. It deliberately does **not**:

- Migrate `services/loanApprovalAssessment.js`, which still imports and calls the original `computeMemberLoanEligibility(memberId, fiscalYear)` with no code change — preserving its exact current call contract was a hard constraint for this batch.
- Migrate `loans.js`, `loanRequests.js`, `loanActivationHotfix.js`, `contributions.js`, `contributionsHotfix.js`, `rulesHotfix.js`, `summary.js`, `fineCashHotfix.js`, `investments.js`, `notifications.js`, `communications.js`, `reconciliation.js`, any Form Intake route, any cron/background job, or `admin.js`.
- Migrate `routes/rules.js` itself (`/api/rules/*`) to `req.tenantModels`, or change `rulesHotfix.js`'s behavior in any way. `getRulesForFY(fy)`'s default-bound behavior, and every existing caller's use of it, is unchanged.
- Change the FY `DEFAULTS` table (2024/2025/2026 values) or the "defaults first, DB record overrides" merge semantics — that logic moved to `services/fyRules.js` verbatim, not redesigned.
- Change any eligibility formula: total contributions, realized-loan-interest treatment (pending/cancelled loans still excluded; historical loans without `disbursed` still counted), paid-fines treatment, net worth, `loan_max_ratio`/`max_eligible` math, interest rate, repayment months, overdue-penalty fields, or the HTTP response shape/status codes.
- Change `backend/server.js`, `backend/middleware/auth.js`, `backend/routes/auth.js`, JWT structure, `JWT_SECRET` handling, the HS256 restriction, or legacy orgless-token compatibility.
- Activate `org_beta`, or any second organization, in production. The Phase 3 single-runtime-tenant allowlist (`org_checkpoint_investors` only) is unchanged.
- Touch the real Atlas production database in any way during development or testing — all Phase 4B development and testing ran against `mongodb-memory-server`; `org_beta` and the poisoned default-DB sentinel records (financial data **and** an FyRules override) exist only inside that disposable test database.

Those all remain deliberately out of scope until the next Phase 4 batch — most notably, the loan domain (`loans.js`, `loanRequests.js`, `loanApprovalAssessment.js`) is still entirely default-bound and will need its own coordinated migration.

## Phase 4C scope and what is not here yet

Phase 4C migrates exactly four files — `rules.js`'s live HTTP routes, `rulesHotfix.js`, `contributions.js`, `contributionsHotfix.js` — plus the minimum model-explicit refactor of their shared helpers (`buildFinesForFY`, `buildFineCandidates`, `computeBulkAllocation`, `getExistingFine`). It deliberately does **not**:

- Migrate `loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, or `services/loanApprovalAssessment.js` — the loan domain remains entirely default-bound and needs its own coordinated migration. `routes/rules.js`'s `getRulesForFY(fy)` remains a default-bound compatibility API specifically to avoid touching these files.
- Migrate `summary.js`, `fineCashHotfix.js`, `investments.js`, `notifications.js`, `communications.js`, `reconciliation.js`, `import.js`, `mailer.js`, `admin.js`, any Form Intake route, or any cron/background job (`automaticFineCron.js`, `memberAutomation.js`, `deadlineScan.js`, `services/automaticFineIssuance.js`, `services/automaticMissingFineIssuance.js`).
- Consolidate `rulesHotfix.js` into `rules.js`, or `contributionsHotfix.js` into `contributions.js` — both hotfix/base pairs remain separate files, and `server.js`'s mount order (hotfix first) is unchanged.
- Change the FY `DEFAULTS` table, the defaults-first merge order, `_fromDB` behavior, or any FY policy value.
- Change any fine-policy or loan-policy formula: one-fine-per-contribution-month, the paid-fine-immutability rule in recalculate, the bulk-payment allocation order (contributions oldest-first → fines → loan repayment → partial contribution), or the partial-fine safety rule (a fine is marked paid only when the remainder can settle it in full — `blocked_by_partial_fine`, never a partial balance).
- Reconcile the discovered pre-existing inconsistency between `scan-fines`'s "Missing contribution ..." fine-reason prefix and `recalculate-fines`'s "Late contribution ..." selection filter — documented in Section 20, not fixed.
- Change `backend/server.js`, `backend/middleware/auth.js`, `backend/routes/auth.js`, JWT structure, `JWT_SECRET` handling, the HS256 restriction, or legacy orgless-token compatibility.
- Activate `org_beta`, or any second organization, in production. The Phase 3 single-runtime-tenant allowlist (`org_checkpoint_investors` only) is unchanged.
- Touch the real Atlas production database in any way during development or testing — all Phase 4C development and testing ran against `mongodb-memory-server`; the poisoned default-DB sentinel records (across Member, Contribution, Fine, Transaction, Loan, Repayment, FyRules, and Counter) and `org_beta` exist only inside that disposable test database.

Those all remain deliberately out of scope — the loan domain was migrated in Phase 4D (see Section 21).

## 21. Phase 4D migration status

**Status: COMPLETE / MERGED — PR [#32](https://github.com/jkidune/checkpoint-dashboard/pull/32), merge SHA `de0921270db55af7fc96b669abf9c0b4767f8c7f` (originally developed on branch `phase4d-loan-domain-tenancy`).**

The entire loan domain now reads/writes exclusively through `req.tenantModels` (authenticated routes) or `resolveApprovedRuntimeTenant()` (the public POST endpoint in `loanRequests.js`), with **no fallback** to the default/legacy model registry:

- `backend/routes/loans.js` — all routes (`GET /`, `GET /rules`, `GET /eligibility/:memberId`, `GET /:id`, `POST /`, `POST /:id/repayments`, `PATCH /:id`, `GET /:id/approval-assessment`) now resolve every model — `Loan`, `Repayment`, `Member`, `Transaction`, `Expense`, `FyRules`, `getNextId` — from `req.tenantModels`. `enrichLoan(loan, rulesCache)` became `enrichLoan(models, loan, rulesCache)`. FY rules resolve via `getRulesForFYWithModel(req.tenantModels.FyRules, fy)` (from `services/fyRules.js`); member eligibility via `computeMemberLoanEligibilityWithModels(req.tenantModels, memberId, fy)`. No default model import remains.
- `backend/routes/loanActivationHotfix.js` — the **live** path for `PATCH /api/loans/:id` when `body.status === 'active'` and the loan is pending (mounted before `loans.js` in `server.js`). Every model (`Loan`, `Member`, `Transaction`, `getNextId`) comes from `req.tenantModels`. Assessment via `assessLoanApprovalWithModels(req.tenantModels, {...})`. `assessmentForLoan(loan, overrides)` became `assessmentForLoan(models, loan, overrides)`. No default model import remains.
- `backend/routes/loanRequests.js` — all authenticated admin routes (`GET /`, `GET /workbench`, `PATCH /:id`, `POST /:id/accept`, `POST /:id/convert`) use `req.tenantModels`. The public `POST /` uses `resolveApprovedRuntimeTenant()` server-side, completely ignoring any `organization_id` in body, query, or headers. `matchMember(memberName)` became `matchMember(models, memberName)`, `enrichRequest(request)` became `enrichRequest(models, request)`, and `buildRequestAssessment(request)` became `buildRequestAssessment(models, request)`. Calls `assessLoanApprovalWithModels(models, {...})`, never the legacy wrapper.
- `backend/services/loanApprovalAssessment.js` — now exports two entry points built on a shared `buildAssessmentResult({...})` helper: `assessLoanApprovalWithModels(models, options)` (tenant-explicit, used by `loanActivationHotfix.js` and `loanRequests.js`) and `assessLoanApproval({...})` (original default/legacy-bound compatibility wrapper, retained for any callers outside the 4 migrated files). `buildContributionClearance(member, fiscalYear, asOfDate)` became `buildContributionClearanceWithModels(models, member, fiscalYear, asOfDate)`.

`server.js`'s mount order (`loanActivationHotfix` before `loans`) is byte-for-byte unchanged and was proven unchanged through real HTTP behavior (hotfix response shape includes `approval_assessment`; `loans.js` does not) in `backend/test/tenancy/phase4dLoanActivation.test.js`.

**4D test suite at merge: 310/310 passing under `npm test` (237 baseline + 73 Phase 4D; this earlier line previously read 302 and predated the final Phase 4D hardening).**

Test files:
- `backend/test/tenancy/helpers/phase4dTestApp.js` — test app helper; two logical tenants (`org_checkpoint_investors`/`tenant_alpha` and `org_beta`/`tenant_beta`) plus a poisoned default DB with `DEFAULT_DB_COUNTER_POISON = 5000` sentinel records across every loan-domain model.
- `backend/test/tenancy/phase4dLoans.test.js` — 25 isolation tests for `loans.js` (reads, enrichment, creation, override expense, repayments, PATCH, approval assessment).
- `backend/test/tenancy/phase4dLoanActivation.test.js` — 5 isolation tests for `loanActivationHotfix.js` (mount precedence, blocked activation, successful activation, default-DB poison isolation, duplicate suppression).
- `backend/test/tenancy/phase4dLoanRequests.test.js` — 9 isolation tests for `loanRequests.js` (public POST tenant isolation, member matching, duplicate detection, admin list/workbench, review/acceptance, conversion, E2E flow).
- `backend/test/tenancy/phase4dStaticBoundary.test.js` — 26 static (no server/DB) assertions that all 4 migrated files are free of default-model imports and use the model-explicit function signatures.

**At the end of Phase 4D everything else was still default-bound** — `fineCashHotfix.js`, the reporting/admin stack, Form Intake, and the automatic fine cron (Phase 4E has since migrated `fineCashHotfix.js`, `summary.js`, `investments.js` and `reconciliation.js` — see Section 22). No other route, service, job, or utility changed in Phase 4D — see the full inventory in `docs/tenant-route-migration.md`. The application is **not** fully multi-tenant after this batch; it remains safe only because of the Phase 3 single-runtime-tenant restriction (Section 15).

## Phase 4D scope and what is not here yet

Phase 4D migrates exactly four files — `loans.js`, `loanActivationHotfix.js`, `loanRequests.js`, `services/loanApprovalAssessment.js` — plus the minimum model-explicit refactor of their shared helpers. It deliberately does **not**:

- Migrate `fineCashHotfix.js`, `summary.js`, `investments.js`, `notifications.js`, `communications.js`, `reconciliation.js`, `import.js`, `mailer.js`, `admin.js`, any Form Intake route (`formIntake.js`, `formIntakeAdmin.js`, `formIntakeAllocationGuard.js`, `forms.js`), or any cron/background job (`automaticFineCron.js`, `memberAutomation.js`, `deadlineScan.js`, `services/automaticFineIssuance.js`, `services/automaticMissingFineIssuance.js`).
- Consolidate `loanActivationHotfix.js` into `loans.js` — both remain separate files, and `server.js`'s mount order (hotfix first) is unchanged.
- Remove the legacy `assessLoanApproval({...})` wrapper from `loanApprovalAssessment.js` — it is retained for any callers outside the 4 migrated files.
- Remove `routes/rules.js`'s `getRulesForFY(fy)` legacy wrapper — though the 4 migrated files no longer use it, it is left in place to avoid breaking any other callers not yet audited.
- Change any loan calculation formula: disbursement logic, repayment totals, overdue penalty calculation, `loan_max_ratio`/`max_eligible` math, interest rate, repayment months, contribution clearance logic, or the HTTP response shapes/status codes.
- Change `backend/server.js`, `backend/middleware/auth.js`, `backend/routes/auth.js`, JWT structure, `JWT_SECRET` handling, the HS256 restriction, or legacy orgless-token compatibility.
- Activate `org_beta`, or any second organization, in production. The Phase 3 single-runtime-tenant allowlist (`org_checkpoint_investors` only) is unchanged.
- Touch the real Atlas production database in any way during development or testing — all Phase 4D development and testing ran against `mongodb-memory-server`; `org_beta` and the poisoned default-DB sentinel records exist only inside that disposable test database.

Those all remain deliberately out of scope until the next Phase 4 batch (Phase 4E — financial reporting).

## 22. Phase 4E migration status

**Status: IMPLEMENTED — PR open against `main`, NOT MERGED.** Branch `phase4e-reporting-reconciliation-tenancy`; base is `main` at `4df6b96` (Phase 4D **COMPLETE / MERGED** — PR [#32](https://github.com/jkidune/checkpoint-dashboard/pull/32), merge SHA `de0921270db55af7fc96b669abf9c0b4767f8c7f`). **Phase 4F has not started.**

The reporting, investment-valuation and reconciliation stack now reads/writes exclusively through `req.tenantModels`, with **no fallback** to the default/legacy model registry. The four routes are `MIGRATED — Phase 4E`:

- `backend/routes/investments.js` — `GET /`, `POST /nav`, `GET /nav-history` and `GET /growth` use `req.tenantModels.Investment` / `NavUpdate`. The shared valuation helper is now **model-explicit**: `valuateInvestmentsWithModels(models)`, built on `latestNav(models, provider, asset_class, asOf)`. The legacy no-argument `valuateInvestments()` was **removed** (its only two callers, `investments.js` and `summary.js`, migrated together), so no default-bound valuation entry point remains in the backend. `POST /nav` draws `nav_update_id` from the tenant's own counter (`req.tenantModels.getNextId`).
- `backend/routes/summary.js` — `computeSummary(models)` computes equity, liabilities, cash position, interest, contribution and loan breakdowns and the latest reconciliation from one tenant's models. Per-loan overdue penalties resolve FY rules with `getRulesForFYWithModel(models.FyRules, fy)` (from `services/fyRules.js`, introduced in Phase 4B) — never the default-bound `getRulesForFY(fy)` wrapper — and investments are valued with `valuateInvestmentsWithModels(models)`, so the summary's investment total, the cash bridge's "investment transfers" and `GET /api/investments` all read the same tenant. The fines and welfare CRUD routes use `req.tenantModels` with tenant-local `fine_id` / `welfare_id` counters.
- `backend/routes/fineCashHotfix.js` — `syncPaidFineReceipts(models)` is model-explicit (and exported). The hotfix is still mounted **before** `summary.js` in `server.js` — the mount order is byte-for-byte unchanged and proven by behaviour: a `PATCH /api/summary/fines/:id {status:'paid'}` with no `paid_date` is saved with one, which only the hotfix's `ensurePaidDate` middleware can have injected. The POST/PATCH post-response callback uses a `models` constant **captured before** `res.on('finish')`, so the asynchronous receipt creation targets the tenant that handled the request. `GET /api/summary` and `GET /api/summary/snapshot` repair eligible missing receipts through the request's tenant models *before* the summary is computed. Receipt `transaction_id`s come from the tenant's counter.
- `backend/routes/reconciliation.js` — no longer imports `mongoose` or `../db/models`. Its helpers are model-explicit: `syncCounter(models, Model, counterName, session)`, `nextId(models, counterName, session)`, `currentSnapshot(models)`, `preview(models, source)`. `POST /preview`, `POST /apply`, `GET /latest` and `GET /status` read and write only `req.tenantModels`.

**Reconciliation transaction design.** `POST /apply` runs one MongoDB multi-document transaction. Its session is created from the **tenant connection**: `const session = await models.ReconciliationRun.db.startSession()` — never `mongoose.startSession()`, which would be the default connection's session. Every model in `req.tenantModels` is bound to that one connection object, so the session, the counter synchronisation and allocation (`models.Counter`, i.e. the tenant database's own `auto_counters`) and every document write (`Member`, `Contribution`, `Loan`, `Repayment`, `Fine`, `Investment`, `AuditSourceRecord`) are the tenant's by construction. As before, the `ReconciliationRun` bookkeeping document (`applying` → `applied` / `failed`) is written outside the transaction, so a failed apply stays recorded while its data writes — **including every counter movement made inside the transaction** — roll back. `/apply` captures `const models = req.tenantModels` once at the top of the handler.

Note on today's topology: tenant connections are created by `backend/tenancy/tenantConnection.js` with Mongoose `useDb()` on the single application connection (the same base connection every tenant-facing module uses), so they currently share one underlying `MongoClient`, and a session obtained from a tenant `Model.db` is the same kind of object as one from `mongoose.connection`. Obtaining the session from the tenant connection is what keeps the design correct if tenant connections ever stop sharing a client, and the tests pin it: during an apply the tenant connection's `startSession` is observed once and the default connection's `startSession` is observed zero times.

**Tenant-local counters.** `getNextId` and `Counter` are connection-scoped (Section 12). Every id these routes allocate — `fine_id`, `welfare_id`, `transaction_id`, `nav_update_id`, and the reconciliation's `member_id`, `contribution_id`, `loan_id`, `repayment_id`, `fine_id` — comes from the request's tenant database.

**What did not change:** accounting formulas, schemas, indexes, HTTP response shapes and status codes. `backend/server.js`, `backend/middleware/auth.js`, `backend/routes/auth.js`, `backend/tenancy/runtimeOrganization.js`, `backend/tenancy/tenantConnection.js`, `backend/tenancy/tenantModels.js` and `backend/db/tenantSchemas.js` have **zero diff** against `main`. The single-runtime-tenant allowlist is unchanged (`org_checkpoint_investors` only); `org_beta` exists only in disposable test databases and is rejected (403) on every Phase 4E route.

**Phase 4E test suite.** 91 new tests plus one new helper module; `npm test` is **402/402 passing** (the 310 baseline is 303 test cases plus the 7 helper modules `node --test` also counts; Phase 4E adds 91 test cases plus 1 helper module). Run on a disposable one-node `MongoMemoryReplSet` holding four logical databases — `checkpoint_control_test`, `checkpoint_legacy_unused` (the default connection, poisoned with sentinels for `Member`, `Contribution`, `Loan`, `Repayment`, `Fine`, `WelfareEvent`, `Transaction`, `Expense`, `Investment`, `NavUpdate`, `FyRules`, `ReconciliationRun`, `AuditSourceRecord` and `Counter`, with numeric ids that **collide** with the tenant's and counters at 5000+), `tenant_alpha` (`org_checkpoint_investors`) and `tenant_beta` (`org_beta`) — through the real Express app, real `authenticate`, real tenant resolution and real HTTP; no migrated route is mocked. The default database and `tenant_beta` are snapshotted (every document and every counter) before and deep-compared after every mutating operation.

- `backend/test/tenancy/helpers/phase4eTestApp.js` — replica-set helper (the shared `memoryMongo.js` is untouched); refuses to run unless `MONGO_URI` is a local disposable URI.
- `backend/test/tenancy/phase4eInvestments.test.js` (11) — list/valuation (at NAV, at cost, no-NAV fallback despite a default NAV), `nav-history`, `growth`, `POST /nav` writes to alpha only and consumes alpha's `nav_update_id`.
- `backend/test/tenancy/phase4eSummary.test.js` (18) — exact alpha-only equity/liabilities/cash-position/penalty figures, snapshot, fines CRUD (including PATCH/DELETE on ids that collide with default sentinels, and 404 on default-only ids), welfare, member filtering, auth semantics, `org_beta` rejection.
- `backend/test/tenancy/phase4eFineCash.test.js` (9) — hotfix precedence proven by behaviour, post-response receipt creation (polled), default-DB receipt cannot suppress alpha's, an existing alpha receipt prevents a duplicate, GET-time repair before computing, default Fines/Transactions/ReconciliationRuns cannot influence the repair.
- `backend/test/tenancy/phase4eReconciliation.test.js` (17) — same-connection proof, replica-set sanity, preview poison (same `run_key` applied in the default DB), full apply (every model written to alpha with sequential alpha ids, default/beta untouched), idempotency, `409` hash conflict, three rollback scenarios (an early existing rule; a late existing rule after contributions/loans/repayments/fines were written; the final bulk write after the investment upsert) each leaving every alpha collection **and counter** unchanged, `latest` / `status`.
- `backend/test/tenancy/phase4eStaticBoundary.test.js` (36) — comment/string-aware static checks: exact import allow-lists (no `../db/models`, no `mongoose`, no `../routes/rules`), no bare model identifiers, no fallback patterns, model-explicit signatures, models captured before `res.on('finish')`, a single tenant-bound `startSession`, no remaining `valuateInvestments()` caller, `server.js` mount order, the single-runtime-tenant constant.

The tests were also validated by negative controls on a scratch copy (never the working tree): 65 deliberate regressions — each of the four production files reverted to its pre-migration default-bound version; individual model, counter and session accesses swapped to the default database/connection (including every model read in `computeSummary`, every write inside the reconciliation transaction, the counter helpers and `mongoose.startSession()`); a non-transactional apply; a removed snapshot repair; a swapped `server.js` mount order; and corrupted name normalization — were each detected by at least one failing test (65/65 killed, 0 survived).

**Known pre-existing behaviours observed while testing (identical on `main`; documented, deliberately not fixed in a tenancy migration):**

- `NavUpdate` has no numeric `id` field. `POST /api/investments/nav` consumes a `nav_update_id` from the tenant's counter, but Mongoose strict mode drops the value, so the document is identified only by its ObjectId `_id` (and the auto-increment `pre('save')` hook never fires because the `id` virtual is never undefined). Fixing it needs a schema change, which is out of scope.
- `POST /api/reconciliation/apply` returns the stored result as `idempotent: true` for any `run_key` whose prior run is `applied`, without comparing source hashes; the `409` hash-conflict only occurs when the prior run exists in another state (e.g. `failed`).
- A failed apply's HTTP body and stored `result` report the in-memory tallies (e.g. `members_created: 1`) even though the transaction rolled back and the database holds nothing. Cosmetic.
- `POST /api/reconciliation/apply` with a structurally valid file that has no `club` object throws a `TypeError` (`source.club.reporting_cutoff` is read before the handler's `try`), so under Express 4 the request is never answered (unhandled promise rejection). Admin-only; that line is unchanged from `main`.
- `GET /api/summary` runs the fine-receipt repair for any authenticated caller before `requireAdmin` rejects a non-admin with 403, so a member's request can trigger the (idempotent) repair write. The repair is tenant-scoped and creates only a missing receipt.

**Everything else is still default-bound** — the Phase 4F-and-later routes: `admin.js`, `notifications.js`, `communications.js`, `import.js`, `mailer.js`, the Form Intake stack (`formIntake.js`, `formIntakeAdmin.js`, `formIntakeAllocationGuard.js`, `forms.js`), the cron/background stack (`automaticFineCron.js`, `memberAutomation.js`, `jobs/deadlineScan.js`, `services/automaticFineIssuance.js`, `services/automaticMissingFineIssuance.js`), and the retained legacy wrappers. No other route, service, job or utility changed in Phase 4E — see the full inventory in `docs/tenant-route-migration.md`. The application is **not** fully multi-tenant after this batch; it remains safe only because of the Phase 3 single-runtime-tenant restriction (Section 15).

## Phase 4E scope and what is not here yet

Phase 4E migrates exactly four files — `investments.js`, `summary.js`, `fineCashHotfix.js`, `reconciliation.js` — plus the minimum model-explicit refactor of their helpers. It deliberately does **not**:

- Start Phase 4F, or migrate `admin.js`, `notifications.js`, `communications.js`, `import.js`, `mailer.js`, any Form Intake route (`formIntake.js`, `formIntakeAdmin.js`, `formIntakeAllocationGuard.js`, `forms.js`), or any cron/background job (`automaticFineCron.js`, `memberAutomation.js`, `deadlineScan.js`, `services/automaticFineIssuance.js`, `services/automaticMissingFineIssuance.js`).
- Implement Quarterly Reports or any new reporting feature.
- Change any accounting formula: equity, liabilities, cash-position bridge, overdue-penalty calculation, NAV valuation, receipt matching, reconciliation matching/adjustment rules, or the HTTP response shapes/status codes.
- Change any schema or index (`backend/db/tenantSchemas.js` is untouched).
- Consolidate `fineCashHotfix.js` into `summary.js` — both remain separate files and `server.js`'s mount order (hotfix first) is unchanged.
- Remove `routes/rules.js`'s `getRulesForFY(fy)` legacy wrapper — Phase 4F+ files still call it.
- Change `backend/server.js`, `backend/middleware/auth.js`, `backend/routes/auth.js`, `backend/tenancy/*`, JWT structure, `JWT_SECRET` handling, the HS256 restriction, or legacy orgless-token compatibility.
- Activate `org_beta`, or any second organization, in production. The Phase 3 single-runtime-tenant allowlist (`org_checkpoint_investors` only) is unchanged and remains load-bearing.
- Touch the real Atlas production database or modify production data in any way during development or testing — all Phase 4E development and testing ran against disposable `mongodb-memory-server` instances; `org_beta` and the poisoned default-database sentinels exist only inside those.

Those all remain deliberately out of scope until the next Phase 4 batch (Phase 4F — operational/admin), which has not been started.
