// Control-plane database access.
//
// Checkpoint's future multi-tenant architecture is:
//
//   ONE MongoDB Atlas cluster
//     + ONE small shared "control" database  (SaaS-level metadata)
//     + ONE logical database per organization/group (financial records)
//
// This module hands out the control database *without* opening a second
// physical connection to Atlas. It reuses the single authenticated
// connection the application already establishes in ../db/mongoose.js and
// switches database context onto it with Mongoose's `Connection#useDb()`.
//
// It never disconnects, replaces, or otherwise interferes with the existing
// application connection or its models. If this module is never imported,
// nothing about current application behavior changes.

const connectDB = require('../db/mongoose');

const DEFAULT_CONTROL_DB_NAME = 'checkpoint_control';

// MongoDB database names cannot contain these characters. This only guards
// against a misconfigured environment variable — it is not a security
// boundary (see tenantConnection.js for that).
const SAFE_DB_NAME_PATTERN = /^[^/\\. "$*<>:|?\x00]{1,63}$/;

function resolveControlDbName() {
  const raw = process.env.CONTROL_DB_NAME || DEFAULT_CONTROL_DB_NAME;
  const name = raw.trim();

  if (!name || !SAFE_DB_NAME_PATTERN.test(name)) {
    throw new Error(
      `CONTROL_DB_NAME ("${raw}") is not a valid MongoDB database name. ` +
      'Set CONTROL_DB_NAME to a simple name such as "checkpoint_control".'
    );
  }

  return name;
}

const CONTROL_DB_NAME = resolveControlDbName();

// Cached per warm instance, same reasoning as the pattern already used in
// ../db/mongoose.js: on Vercel a warm serverless invocation should reuse the
// same logical connection instead of re-deriving it on every request.
function getCache() {
  if (!global._controlDbCache) {
    global._controlDbCache = null;
  }
  return global._controlDbCache;
}

/**
 * Returns the control-plane Mongoose Connection, establishing (or reusing)
 * the application's base Atlas connection first. Safe to call from the
 * Express app, a one-off CLI script, or a test — it always defers to the
 * same underlying connectDB() used everywhere else.
 */
async function getControlConnection() {
  const cached = getCache();
  if (cached) return cached;

  // Reuses (or lazily creates) the single authenticated Atlas connection the
  // rest of the application already depends on. This never opens a second
  // connection, points at a different cluster, or uses different
  // credentials — it is the exact same connection as backend/db/mongoose.js.
  const baseConnection = await connectDB();

  // `useCache: true` means repeated calls with the same database name return
  // the same underlying Connection object instead of creating a new one.
  // That matters across warm Vercel invocations and avoids re-registering
  // models (OverwriteModelError) on every request.
  const controlConnection = baseConnection.connection.useDb(CONTROL_DB_NAME, { useCache: true });

  global._controlDbCache = controlConnection;
  return controlConnection;
}

module.exports = { getControlConnection, CONTROL_DB_NAME };
