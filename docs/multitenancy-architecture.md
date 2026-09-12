# Checkpoint Multi-Tenant Architecture

**Status:** Foundation only (PR21). No routing, auth, or financial-model behavior has changed. See [PR21 scope](#pr21-scope-and-what-is-not-here-yet) below for exactly what this PR does and does not do.

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
- It also means this migration does **not** require touching the existing financial models' query logic in this PR (or even the next one) to get the isolation guarantee in place — the tenancy foundation can be built and proven correct independently of that larger, riskier refactor.

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

No document in any existing collection (`members`, `contributions`, `loans`, `fines`, `expenses`, `investments`, `transactions`, `users`, `fy_rules`, `reconciliation_run`, `audit_source_record`, and so on) is moved, copied, re-keyed, or modified by this or any PR21 tooling. The legacy tenant database is treated as immutable during this phase. The only thing PR21 can write is a single document in the new control database, and only when a human explicitly runs the bootstrap script with `--apply`.

## 6. Control-plane responsibilities

The control database (`checkpoint_control` by default) is intentionally small. It owns:

- The **organization registry**: identity, slug, which physical database an organization's data lives in, status (`active` / `suspended` / `provisioning` / `archived`), and minimal metadata (country, currency, timezone).
- In future PRs: user identity and organization membership (who belongs to which organization, with what role), and invitations for onboarding new members/organizations.

The control plane explicitly does **not** own tenant-level financial configuration. Contribution amount, loan interest rate, entry fee, and similar constitution rules stay in each tenant's own `FyRules` collection, inside that tenant's database — those are per-organization business rules, not SaaS metadata.

## 7. Tenant database responsibilities

Each organization's database owns exactly what the current single database owns today: members, contributions, loans, repayments, fines, expenses, investments, transactions, users (in a future PR — see below), FY rules, and reconciliation/audit records. Nothing about the shape of that data changes in PR21.

## 8. Future auth model

Not implemented in PR21. Today's JWT carries `id`, `username`, `role`, `member_id`, `name` — that continues to work exactly as before. A future PR will extend the authenticated identity with an organization context (e.g. an `organization_id` claim resolved at login, once a user-to-organization membership concept exists in the control plane), and only then will requests start being routed to a specific tenant connection.

## 9. Future organization provisioning

Not implemented in PR21. `backend/scripts/bootstrap-legacy-organization.js` is a one-time, human-run tool for registering the existing club — it is not a signup flow. A real provisioning flow (self-serve or admin-driven creation of a *new* organization, including creating its database and seeding default `FyRules`) is future work that will build on the `organizationRegistry` module introduced here.

## 10. Tenant-isolation security principles

> **Financial records belonging to one organization must never be queryable through another organization's tenant database context.**

> **Tenant database names must always be resolved from trusted control-plane records, never directly from user-supplied input.**

Concretely, the only supported path to a tenant's data is:

```
authenticated organization identity
        │
        ▼
trusted Organization registry record   (backend/tenancy/organizationRegistry.js)
        │
        ▼
record.database_name
        │
        ▼
getTenantConnection(record)            (backend/tenancy/tenantConnection.js)
```

`getTenantConnection()` refuses anything that is not an already-resolved organization record — a raw string (e.g. `req.query.database`) is rejected outright. There is no generic "connect to whatever database name you give me" endpoint or helper anywhere in the codebase, and PR21 does not add one.

The Organization model itself is only ever registered against the control database connection (`backend/tenancy/controlModels.js`), never against the application's default/tenant connection — so it is structurally impossible for tenant-side code to accidentally read or write organization registry data, and impossible for the control plane to accidentally expose a tenant's financial collections.

## 11. Migration phases

1. **PR21 (this PR) — Foundation.** Control database, `Organization` model, registry module, guarded tenant-connection selector, legacy bootstrap tooling, baseline reporting. Zero behavior change to the running application.
2. **PR22 (future) — Financial model refactor.** Move `Member`, `Contribution`, `Loan`, `Fine`, `Transaction`, `Investment`, `Expense`, etc. onto tenant-scoped connections obtained via `getTenantConnection()`, still serving only the one legacy organization at first, verified against the baseline report from this PR.
3. **PR23+ (future) — Active tenancy.** Organization context added to authentication, tenant-resolution middleware wired into `backend/server.js`, real provisioning flow for new organizations, hotfix-route consolidation alongside the model refactor they patch.

Each phase should re-run `npm run tenancy:baseline` before and after and diff the two reports as a first-pass operational sanity check — understanding, per the caveat in that tool's own output, that matching counts/sums is a useful signal, not proof of accounting equivalence.

## 12. Rollback principle

Every phase is designed to be reversible without touching the legacy tenant's financial data:

- PR21 introduces no new runtime dependency for the existing application — if the control database is ever unreachable, current production endpoints are unaffected, because none of them call into `backend/tenancy/*` yet. Reverting this PR is a no-op for production behavior.
- The legacy bootstrap script only ever writes one document, to one collection, in the new control database. Rolling it back is deleting that one document — it never touches, and cannot touch, the legacy tenant's own collections.
- Later phases that do start depending on the control plane at runtime should preserve a documented fallback (e.g. defaulting to the legacy tenant's connection when no organization context is resolvable) until the control plane has been operated in production long enough to be trusted as a hard dependency.

## PR21 scope and what is not here yet

This PR is foundation only. It deliberately does **not**:

- Change request routing, login/signup behavior, or JWT contents.
- Touch the financial models in `backend/db/models.js` or any of their calculations.
- Add `organization_id` to any existing collection.
- Modify existing indexes, `FyRules` uniqueness, reconciliation records, fines, transactions, or balances.
- Add tenant-resolution middleware to `backend/server.js`.
- Consolidate the existing hotfix routes.
- Write anything to production. The bootstrap script defaults to a dry run; `--apply` was only exercised locally against a disposable in-memory database while building this PR, never against the real Atlas cluster.

Those all remain deliberately out of scope until the phases described above.
