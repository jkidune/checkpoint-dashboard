# Checkpoint Multi-Tenant Architecture

**Status:**

- **Phase 1 — control plane: complete.** Control database, `Organization` model, registry, guarded tenant-connection selector, legacy bootstrap tooling, baseline reporting. Checkpoint Investors Club is registered as Tenant #1.
- **Phase 2 — tenant-scoped model registry: complete.** Every tenant-owned Mongoose model can be bound to a specific tenant's connection through a guarded registry, with no schema duplicated between the default/legacy path and the tenant path.
- **Phase 3 — organization-aware authentication and request context: this phase.** Organization identity is now active at the auth/request boundary — the JWT carries `organization_id`, `authenticate` resolves and attaches `req.tenant`/`req.tenantModels`, and the auth routes themselves are tenant-model aware. **Checkpoint Investors Club remains the only runtime-permitted organization** — see [Phase 3 runtime tenancy boundary](#15-phase-3-runtime-tenancy-boundary) and [Phase 3 scope](#phase-3-scope-and-what-is-not-here-yet).
- **Future — route-by-route tenant model migration.** Not started. See [Migration phases](#16-migration-phases).

Financial route *query* behavior has not changed in any phase so far — only authentication has, in Phase 3. This document uses Phase numbers, not GitHub PR numbers, as the durable reference — PR numbers are assigned by GitHub per submission and are not a stable way to talk about the architecture.

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
4. **Route-by-route tenant model migration (future, not yet named/branched).** Migrate existing financial routes, one domain at a time, from the default/legacy model imports to `req.tenantModels`; consolidate each domain's hotfix routes (`rulesHotfix`, `contributionsHotfix`, `loanActivationHotfix`, `fineCashHotfix`) as part of migrating that domain; tenant-enable the public/cron workflows (Form Intake, loan-request intake, automatic-fines cron, member-reminder cron); real self-serve organization provisioning; only then is it safe to raise the Phase 3 runtime allowlist beyond one organization.

Each phase should re-run `npm run tenancy:baseline` before and after and diff the two reports as a first-pass operational sanity check — understanding, per the caveat in that tool's own output, that matching counts/sums is a useful signal, not proof of accounting equivalence.

## 17. Rollback principle

Every phase is designed to be reversible without touching the legacy tenant's financial data:

- Neither Phase 1 nor Phase 2 introduced a new runtime dependency for the existing application — if the control database was unreachable, current production endpoints were unaffected, because nothing called into `backend/tenancy/*` yet. Reverting either phase was a no-op for production behavior.
- The Phase 1 legacy bootstrap script only ever writes one document, to one collection, in the new control database. Rolling it back is deleting that one document — it never touches, and cannot touch, the legacy tenant's own collections.
- Phase 2 added no new collections and performed no writes of its own; it only added code paths that construct model bindings. Reverting it removes those code paths and nothing else.
- **Phase 3 is the first phase where the control plane becomes a real runtime dependency**: every authenticated request now reads the `Organization` registry. If the control database is unreachable, authenticated requests fail with 503 (fail-closed, per Section 15's error table) rather than falling back to a permissive default — this is intentional, but it does mean control-plane availability now matters for login/authenticated traffic, which it did not in Phase 1/2. Reverting Phase 3 (reverting `backend/middleware/auth.js` and `backend/routes/auth.js` to their pre-Phase-3 versions) removes that dependency again; it changes no financial data.
- The `ALLOW_LEGACY_ORGLESS_TOKENS` compatibility fallback is itself a rollback safety net — it exists so that Phase 3 can deploy without forcibly invalidating existing sessions. It should be retired in a later phase once a full token TTL has passed.

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
