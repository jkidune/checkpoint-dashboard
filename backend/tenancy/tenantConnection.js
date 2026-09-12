// Selects a tenant's logical database connection.
//
// SECURITY PRINCIPLE (do not weaken this):
//
//   authenticated organization identity
//           -> trusted Organization registry record (organizationRegistry.js)
//           -> record.database_name
//           -> getTenantConnection(record)
//
//   NOT:
//
//   req.query.database -> useDb()
//
// This function only accepts an already-resolved Organization record — the
// kind returned by organizationRegistry.js — never a bare string, and never
// anything sourced directly from request input. That is what prevents one
// organization's financial data from ever becoming reachable through
// another organization's (or an attacker-supplied) database name.

const connectDB = require('../db/mongoose');

// Defense in depth only (not the trust boundary): reject anything that
// could not possibly be a legitimate, already-provisioned database name.
const SAFE_DB_NAME_PATTERN = /^[^/\\. "$*<>:|?\x00]{1,63}$/;

function getCache() {
  if (!global._tenantDbCache) {
    global._tenantDbCache = new Map();
  }
  return global._tenantDbCache;
}

/**
 * @param {{ organization_id?: string, database_name: string }} organization
 *   A record already loaded from organizationRegistry.js — e.g. the result
 *   of getOrganizationById()/getOrganizationBySlug(). Passing a plain
 *   string, or an object that didn't come from the registry, is rejected.
 */
async function getTenantConnection(organization) {
  if (!organization || typeof organization !== 'object' || Array.isArray(organization)) {
    throw new Error(
      'getTenantConnection requires a resolved Organization record (from organizationRegistry.js), ' +
      'not a raw string or request value.'
    );
  }

  const { database_name: databaseName, organization_id: organizationId } = organization;

  if (!databaseName || typeof databaseName !== 'string' || !SAFE_DB_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      `Organization ${organizationId || '(unknown)'} has a missing or unsafe database_name; ` +
      'refusing to open a tenant connection.'
    );
  }

  const cache = getCache();
  if (cache.has(databaseName)) {
    return cache.get(databaseName);
  }

  // Same base connection every other tenant-facing module uses — never a
  // second physical connection, never different credentials.
  const baseConnection = await connectDB();
  const tenantConnection = baseConnection.connection.useDb(databaseName, { useCache: true });

  cache.set(databaseName, tenantConnection);
  return tenantConnection;
}

module.exports = { getTenantConnection };
