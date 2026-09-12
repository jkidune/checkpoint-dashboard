// Public surface of the tenancy control-plane module.
//
// PR21 scope: this module is foundation only. Nothing in backend/server.js
// or the existing routes imports it yet, so requiring it (or not) has zero
// effect on current application behavior. It becomes an active runtime
// dependency only in a later PR.

const { getControlConnection, CONTROL_DB_NAME } = require('./controlDb');
const { getControlModels, ORGANIZATION_STATUSES } = require('./controlModels');
const { resolveLegacyTenantDatabaseName } = require('./legacyTenant');
const { getTenantConnection } = require('./tenantConnection');
const organizationRegistry = require('./organizationRegistry');

module.exports = {
  getControlConnection,
  CONTROL_DB_NAME,
  getControlModels,
  ORGANIZATION_STATUSES,
  resolveLegacyTenantDatabaseName,
  getTenantConnection,
  ...organizationRegistry,
};
