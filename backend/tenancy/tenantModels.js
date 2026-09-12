// Tenant-scoped model registry.
//
//   organization_id
//           -> organizationRegistry.getOrganizationById()   (Phase 1, trusted)
//           -> trusted Organization.database_name
//           -> getTenantConnection(organization)             (Phase 1, guarded)
//           -> getTenantModels(organization)                 (this file)
//
// getTenantModels() is the ONLY supported way to get a tenant's Mongoose
// models. It never accepts a database name, a connection, or anything else
// directly — only an object carrying an organization_id, which
// getTenantConnection() (see ../tenancy/tenantConnection.js) re-resolves
// against the control-plane registry itself before opening any connection.
// There is no getTenantModels(databaseName), and there must never be one:
// that would let req.query.database / req.body.database / req.headers.*
// reach model selection, which is exactly what Phase 1 was built to
// prevent.
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

module.exports = { getTenantModels, getModelsForConnection };
