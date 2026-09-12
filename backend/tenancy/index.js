// Public surface of the tenancy module.
//
// Phase 1 (control plane) and Phase 2 (tenant-scoped model registry) are
// merged and dormant — nothing in backend/server.js or the existing routes
// depended on them. Phase 3 (this phase) activates organization identity at
// the authentication/request boundary (backend/middleware/auth.js and
// backend/routes/auth.js), but ONLY for the single approved runtime
// organization — see runtimeOrganization.js. See
// docs/multitenancy-architecture.md for the full picture.

const { getControlConnection, CONTROL_DB_NAME } = require('./controlDb');
const { getControlModels, ORGANIZATION_STATUSES } = require('./controlModels');
const { resolveLegacyTenantDatabaseName } = require('./legacyTenant');
const { getTenantConnection } = require('./tenantConnection');
// tenantModels.js exports only getTenantModels, on purpose — see that
// file's header comment. Do not add getModelsForConnection here even if a
// future change re-exposes it there; the public tenancy API must not offer
// any way to bind tenant models to an arbitrary Connection.
const { getTenantModels } = require('./tenantModels');
const { PHASE_3_RUNTIME_ORGANIZATION_ID, isRuntimeOrganizationAllowed } = require('./runtimeOrganization');
const { resolveRuntimeTenant, resolveApprovedRuntimeTenant, TenantResolutionError } = require('./resolveRuntimeTenant');
const organizationRegistry = require('./organizationRegistry');

module.exports = {
  getControlConnection,
  CONTROL_DB_NAME,
  getControlModels,
  ORGANIZATION_STATUSES,
  resolveLegacyTenantDatabaseName,
  getTenantConnection,
  getTenantModels,
  PHASE_3_RUNTIME_ORGANIZATION_ID,
  isRuntimeOrganizationAllowed,
  resolveRuntimeTenant,
  resolveApprovedRuntimeTenant,
  TenantResolutionError,
  ...organizationRegistry,
};
