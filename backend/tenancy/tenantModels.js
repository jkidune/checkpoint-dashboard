// Tenant-scoped model registry.
//
//   organization_id
//           -> organizationRegistry.getOrganizationById()   (Phase 1, trusted)
//           -> trusted Organization.database_name
//           -> getTenantConnection(organization)             (Phase 1, guarded)
//           -> getTenantModels(organization)                 (this file)
//
// getTenantModels() is the ONLY supported way to get a tenant's Mongoose
// models — it is also the ONLY thing this module exports. It never accepts
// a database name, a connection, or anything else directly — only an
// object carrying an organization_id, which getTenantConnection() (see
// ../tenancy/tenantConnection.js) re-resolves against the control-plane
// registry itself before opening any connection. There is no
// getTenantModels(databaseName), and there must never be one: that would
// let req.query.database / req.body.database / req.headers.* reach model
// selection, which is exactly what Phase 1 was built to prevent.
//
// getModelsForConnection(connection), below, does the actual binding work
// and takes a raw Connection with no organization check — it is
// deliberately kept module-private (not in module.exports) so the public
// contract of this module has no bypass around the trusted path above.
//
// Model binding reuses the EXACT same schema-definition sources as the
// default/legacy compatibility exports (../db/models.js,
// ../db/communicationModels.js, ../db/adminNotificationModels.js,
// ../db/formIntakeModels.js, ../db/loanRequestModels.js) — there is one
// canonical schema per model, bound to two different connections (default
// vs. a specific tenant's), never two divergent copies.
//
// No caching layer is added beyond what Mongoose's Connection already
// provides: `connection.models` caches registered models per connection,
// and ../tenancy/tenantConnection.js already caches connections per
// database_name. Calling getTenantModels() repeatedly for the same
// organization is cheap and always returns models bound to the same
// underlying connection.

const { getTenantConnection } = require('./tenantConnection');
const { bindCoreModels } = require('../db/models');
const { bindCommunicationModels } = require('../db/communicationModels');
const { bindAdminNotificationModels } = require('../db/adminNotificationModels');
const { bindFormIntakeModels } = require('../db/formIntakeModels');
const { bindLoanRequestModels } = require('../db/loanRequestModels');

/**
 * Binds every tenant-owned model (core + auxiliary) to the given
 * connection. Does not know or care whether that connection is the default
 * connection or a specific tenant's — it is purely a binder.
 *
 * NOT EXPORTED, on purpose. This function accepts a raw Mongoose
 * Connection with no organization check at all — that is exactly what
 * makes it useful as a private implementation detail of getTenantModels()
 * below, and exactly what makes it dangerous as a public API: exporting it
 * would let any caller that obtains a Connection (the control connection,
 * the default connection, or anything else) bind tenant financial models
 * to it directly, bypassing the trusted
 * organization_id -> organizationRegistry -> getTenantConnection() path
 * entirely. If a test needs to exercise binding in isolation, it should
 * call the lower-level per-domain binders directly (bindCoreModels,
 * bindCommunicationModels, bindAdminNotificationModels,
 * bindFormIntakeModels, bindLoanRequestModels — all already exported from
 * their respective db/*.js files for exactly that purpose) rather than
 * this function.
 *
 * IMPORTANT: this must never be called with the control connection
 * (../tenancy/controlDb.js). Organization is a control-plane model and is
 * deliberately not part of this bundle — see tenancy/controlModels.js.
 *
 * @param {import('mongoose').Connection} connection
 */
function getModelsForConnection(connection) {
  return {
    ...bindCoreModels(connection), // Member, Contribution, Loan, Repayment, Transaction, User, Fine,
    // WelfareEvent, FyRules, Expense, Investment, NavUpdate, Notification,
    // ReconciliationRun, AuditSourceRecord, getNextId, Counter
    ...bindCommunicationModels(connection), // CommunicationLog, PasswordResetToken
    ...bindAdminNotificationModels(connection), // AdminNotificationState
    ...bindFormIntakeModels(connection), // FormIntakeSubmission
    ...bindLoanRequestModels(connection), // LoanRequestSubmission
  };
}

/**
 * The tenant-aware entry point future request routing will use (not yet —
 * see docs/multitenancy-architecture.md, Phase 3). Always re-resolves the
 * organization through the trusted Phase 1 path; never trust a caller's
 * object to already carry a correct database_name (getTenantConnection
 * enforces this).
 *
 * @param {{ organization_id: string }} organization
 */
async function getTenantModels(organization) {
  const connection = await getTenantConnection(organization);
  return getModelsForConnection(connection);
}

// getModelsForConnection is intentionally NOT exported — see its own
// comment above. getTenantModels is the only supported way to obtain a
// tenant's models, and the export list here is what actually enforces
// that, not just the comment.
module.exports = { getTenantModels };
