// Dedicated test file (its own process, per node:test's default behavior)
// because CONTROL_DB_NAME is resolved once at module-load time in
// tenancy/controlDb.js — this file needs to set the environment variable
// to intentionally collide with the tenant database name BEFORE anything
// in the tenancy module is first required.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

const SHARED_DB_NAME = 'checkpoint_shared_test';

let bootstrap;
let Member;

before(async () => {
  // Intentional misconfiguration under test: the control DB and the legacy
  // tenant database are the same logical database.
  process.env.CONTROL_DB_NAME = SHARED_DB_NAME;
  await startMemoryMongo({ dbName: SHARED_DB_NAME });

  bootstrap = require('../../scripts/bootstrap-legacy-organization');

  const connectDB = require('../../db/mongoose');
  await connectDB();
  ({ Member } = require('../../db/models'));

  // Seed one existing tenant record so we can prove it's untouched.
  await Member.create({ name: 'Existing Member' });
}, { timeout: 60000 });

after(async () => {
  await stopMemoryMongo();
});

test('dry run aborts when CONTROL_DB_NAME equals the tenant database', async () => {
  const result = await bootstrap.run({ apply: false });

  assert.equal(result.status, 'aborted');
  assert.ok(result.conflicts.some((c) => c.includes('CONTROL_DB_NAME must be different')));
});

test('--apply also aborts when CONTROL_DB_NAME equals the tenant database', async () => {
  const result = await bootstrap.run({ apply: true });

  assert.equal(result.status, 'aborted');
  assert.ok(result.conflicts.some((c) => c.includes('CONTROL_DB_NAME must be different')));
});

test('zero Organization documents are created in the shared database', async () => {
  await bootstrap.run({ apply: true });

  const { getControlConnection } = require('../../tenancy/controlDb');
  const { getControlModels } = require('../../tenancy/controlModels');
  const connection = await getControlConnection();
  const { Organization } = getControlModels(connection);

  assert.equal(await Organization.countDocuments(), 0);
});

test('existing tenant collections are untouched', async () => {
  await bootstrap.run({ apply: true });

  assert.equal(await Member.countDocuments(), 1);
  const only = await Member.findOne().lean();
  assert.equal(only.name, 'Existing Member');
});
