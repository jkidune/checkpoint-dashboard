// Resolves which database holds the pre-existing, not-yet-migrated
// Checkpoint Investors Club data ("Tenant #1").
//
// The name is never guessed and never hardcoded. It is read from the
// database the application's own MONGO_URI connection actually resolved
// to at runtime. An optional LEGACY_TENANT_DB_NAME env var can assert what
// that name is expected to be — if it disagrees with reality, this throws
// rather than silently registering the wrong database as the legacy
// tenant.

/**
 * @param {import('mongoose').Connection} connection An already-established
 *   Mongoose connection (e.g. `(await connectDB()).connection`).
 */
function resolveLegacyTenantDatabaseName(connection) {
  const connectedName = connection && (connection.name || (connection.db && connection.db.databaseName));
  const explicitName = process.env.LEGACY_TENANT_DB_NAME;

  if (!connectedName) {
    throw new Error(
      'Unable to determine the connected database name from the current Mongoose connection. ' +
      'Is the application actually connected (has connectDB() resolved)?'
    );
  }

  if (explicitName && explicitName !== connectedName) {
    throw new Error(
      `LEGACY_TENANT_DB_NAME ("${explicitName}") does not match the database the current MONGO_URI ` +
      `connection actually resolved to ("${connectedName}"). Refusing to guess which one is correct — ` +
      'fix the mismatch (or unset LEGACY_TENANT_DB_NAME) before continuing.'
    );
  }

  return connectedName;
}

module.exports = { resolveLegacyTenantDatabaseName };
