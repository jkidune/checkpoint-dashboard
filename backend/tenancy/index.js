// Public surface of the tenancy module.
//
// Phase 1 (control plane) + Phase 2 (tenant-scoped model registry) are both
// foundation only so far. Nothing in backend/server.js or the existing
// routes imports this module yet, so requiring it (or not) has zero effect
// on current application behavior. It becomes an active runtime dependency
// only in a later phase — see docs/multitenancy-architecture.md.

const { getControlConnection, CONTROL_DB_NAME } = require('./controlDb');
const { getControlModels, ORGANIZATION_STATUSES } = require('./controlModels');
const { resolveLegacyTenantDatabaseName } = require('./legacyTenant');
const { getTenantConnection } = require('./tenantConnection');
const { getTenantModels, getModelsForConnection } = require('./tenantModels');
const organizationRegistry = require('./organizationRegistry');

module.exports = {
  getControlConnection,
  CONTROL_DB_NAME,
  getControlModels,
  ORGANIZATION_STATUSES,
  resolveLegacyTenantDatabaseName,
  getTenantConnection,
  getTenantModels,
  getModelsForConnection,
  ...organizationRegistry,
};
