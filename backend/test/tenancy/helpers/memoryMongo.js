// Shared test helper: boots an in-memory MongoDB instance and points the
// application's existing connection machinery at it, so tenancy tests
// exercise the real backend/db/mongoose.js -> backend/tenancy/* code path
// without ever touching the real MongoDB Atlas cluster.
//
// node --test runs each test file in its own process, so per-file globals
// (the connection caches in db/mongoose.js, tenancy/controlDb.js and
// tenancy/tenantConnection.js) start fresh for every file automatically.

const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

/**
 * @param {{ dbName?: string }} [options] Database name the "legacy tenant"
 *   connection should resolve to (mirrors what a real MONGO_URI would
 *   point at in production).
 */
async function startMemoryMongo({ dbName = 'checkpoint_legacy_test' } = {}) {
  // Starting a real mongod binary can take longer than mongodb-memory-server's
  // 10s default launch timeout the first time it runs in an environment, so
  // this is generous on purpose.
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  process.env.MONGO_URI = mongod.getUri(dbName);
  process.env.CONTROL_DB_NAME = process.env.CONTROL_DB_NAME || 'checkpoint_control_test';
  return { uri: process.env.MONGO_URI, dbName };
}

async function stopMemoryMongo() {
  const mongoose = require('mongoose');
  await mongoose.disconnect().catch(() => {});
  if (mongod) {
    await mongod.stop();
    mongod = undefined;
  }
}

module.exports = { startMemoryMongo, stopMemoryMongo };
