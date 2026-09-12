// Selects a tenant's logical database connection.
//
// SECURITY PRINCIPLE (enforced in code below, not just by convention):
//
//   organization_id
//           -> control-plane registry lookup (organizationRegistry.getOrganizationById)
//           -> trusted Organization.database_name
//           -> useDb()
//
//   NOT:
//
//   arbitrary object.database_name -> useDb()
//   req.query.database             -> useDb()
//
// getTenantConnection() takes an `organization_id` and ALWAYS re-resolves it
// against the control-plane registry itself. Any `database_name` the caller
// happens to pass alongside is never trusted directly — it is only ever
// used as a consistency check against what the registry actually has on
// file, and a mismatch is treated as a forgery attempt and rejected.
// JavaScript object identity/shape is deliberately not treated as proof
// that a value came from the registry, because a plain object literal can
// trivially imitate a registry record's shape.

const connectDB = require('../db/mongoose');
const { getOrganizationById } = require('./organizationRegistry');

// Defense in depth only (not the trust boundary): reject anything that
// could not possibly be a legitimate, already-provisioned database name,
// even if it somehow ended up stored against an organization record.
const SAFE_DB_NAME_PATTERN = /^[^/\\. "$*<>:|?\x00]{1,63}$/;

function getCache() {
  if (!global._tenantDbCache) {
    global._tenantDbCache = new Map();
  }
  return global._tenantDbCache;
}

/**
 * @param {{ organization_id: string, database_name?: string }} organization
 *   Must carry a real `organization_id`. Any `database_name` present on
 *   this object is advisory only — it is checked against, but never
 *   substituted for, the control-plane registry's own record. The normal
 *   caller pattern is to pass through whatever
 *   organizationRegistry.getOrganizationById()/getOrganizationBySlug()
 *   already returned, but this function does not rely on that having
 *   happened — it re-resolves independently every time.
 */
async function getTenantConnection(organization) {
  if (!organization || typeof organization !== 'object' || Array.isArray(organization)) {
    throw new Error(
      'getTenantConnection requires an object with an organization_id, not a raw string or request value.'
    );
  }

  const { organization_id: organizationId, database_name: suppliedDatabaseName } = organization;

  if (!organizationId || typeof organizationId !== 'string') {
    throw new Error('getTenantConnection requires organization.organization_id to resolve the tenant database.');
  }

  // The actual trust boundary: look the organization up ourselves rather
  // than believing anything the caller's object claims about it.
  const trustedOrganization = await getOrganizationById(organizationId);

  if (!trustedOrganization) {
    throw new Error(`No registered organization found for organization_id "${organizationId}".`);
  }

  const trustedDatabaseName = trustedOrganization.database_name;

  // If the caller's object also carried a database_name, it must agree
  // with the registry. A disagreement means either a forged/stale object
  // or a caller bug — either way this is refused rather than guessed at.
  if (
    suppliedDatabaseName !== undefined &&
    suppliedDatabaseName !== null &&
    suppliedDatabaseName !== trustedDatabaseName
  ) {
    throw new Error(
      `organization.database_name ("${suppliedDatabaseName}") does not match the control-plane registry's ` +
      `record for organization_id "${organizationId}" ("${trustedDatabaseName}"). Refusing to open a tenant ` +
      'connection using an unverified database name.'
    );
  }

  if (
    !trustedDatabaseName ||
    typeof trustedDatabaseName !== 'string' ||
    !SAFE_DB_NAME_PATTERN.test(trustedDatabaseName)
  ) {
    throw new Error(
      `Organization ${organizationId} has a missing or unsafe database_name in the registry; ` +
      'refusing to open a tenant connection.'
    );
  }

  const cache = getCache();
  if (cache.has(trustedDatabaseName)) {
    return cache.get(trustedDatabaseName);
  }

  // Same base connection every other tenant-facing module uses — never a
  // second physical connection, never different credentials.
  const baseConnection = await connectDB();
  const tenantConnection = baseConnection.connection.useDb(trustedDatabaseName, { useCache: true });

  cache.set(trustedDatabaseName, tenantConnection);
  return tenantConnection;
}

module.exports = { getTenantConnection };
