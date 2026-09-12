# Checkpoint Tenant Model Inventory

Companion reference to [docs/multitenancy-architecture.md](./multitenancy-architecture.md). Architectural only — no production data, counts, or totals.

Result of the full-codebase inventory pass done for Phase 2 (searched for `mongoose.model(`, `connection.model(`, `mongoose.models`, `new mongoose.Schema`, `Schema(`, `getNextId`, `Counter`, and every import from `backend/db/*`).

| Model | Ownership | Current source file | Bound via | Notes |
|---|---|---|---|---|
| Member | tenant | `db/tenantSchemas.js` | `db/models.js` → `bindCoreModels()` | |
| Contribution | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | |
| Loan | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | |
| LoanRepayment (export `Repayment`) | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | Export key and model/collection name intentionally differ (`Repayment` → `LoanRepayment` → `loanrepayments`); preserved exactly. |
| Transaction | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | |
| User | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | Stays tenant-owned through Phase 2 and the future auth phase's initial rollout — see architecture doc §8. |
| Fine | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | |
| WelfareEvent | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | |
| FyRules | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | Per-tenant financial configuration; deliberately never moves to the control plane. |
| Expense | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | |
| Investment | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | |
| NavUpdate | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | Auto-increment hook is a pre-existing dead code path — see architecture doc §12. |
| Notification | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | Same pre-existing dead auto-increment path as NavUpdate. |
| ReconciliationRun | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | |
| AuditSourceRecord | tenant | `db/tenantSchemas.js` | `bindCoreModels()` | Compound unique index (`reconciliation_run`, `source_type`, `source_row`) preserved. |
| Counter | tenant | `db/counter.js` | `bindCoreModels()` (via `getCounterModel`) | One per tenant database; never shared. Collection `auto_counters`, unchanged. |
| CommunicationLog | tenant | `db/communicationModels.js` | `bindCommunicationModels()` | |
| PasswordResetToken | tenant | `db/communicationModels.js` | `bindCommunicationModels()` | TTL index (`expires_at`, `expireAfterSeconds: 0`) preserved. Stays tenant-owned — see architecture doc §8. |
| AdminNotificationState | tenant | `db/adminNotificationModels.js` | `bindAdminNotificationModels()` | |
| FormIntakeSubmission | tenant | `db/formIntakeModels.js` | `bindFormIntakeModels()` | Financial workflow record; must never be shared across organizations. |
| LoanRequestSubmission | tenant | `db/loanRequestModels.js` | `bindLoanRequestModels()` | Financial workflow record; must never be shared across organizations. |
| Organization | **control** | `tenancy/controlModels.js` | `tenancy/controlDb.js` → `getControlConnection()` | Never bound via `getTenantModels()`. Lives only in `checkpoint_control`. |

## Non-Mongoose / out of scope

- `backend/db/database.js` — a `lowdb`-backed JSON file store (`backend/db/checkpoint.json`). Not required by `server.js` or any route; dead code, unrelated to the Mongoose/Atlas architecture. Left untouched.
- `backend/scripts/initCounters.js` — a standalone one-off migration script that manages its own `counters` collection (note: not `auto_counters`) directly via its own `mongoose.connect()`. Predates the current counter scheme and does not import from `db/models.js`. Left untouched; out of scope for Phase 2.

## Future tenant model registry entry point

`backend/tenancy/tenantModels.js`:

```js
async function getTenantModels(organization) {
  const connection = await getTenantConnection(organization); // Phase 1, guarded
  return getModelsForConnection(connection);                  // binds every row above
}
```

Never `getTenantModels(databaseName)`. Never a database name sourced from `req.query`, `req.body`, or `req.headers`.
