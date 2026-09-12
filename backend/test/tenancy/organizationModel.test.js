const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

let Organization;
let controlConnection;
let legacyConnection;

before(async () => {
  await startMemoryMongo();

  const { getControlConnection, CONTROL_DB_NAME } = require('../../tenancy/controlDb');
  const { getControlModels } = require('../../tenancy/controlModels');
  const connectDB = require('../../db/mongoose');

  controlConnection = await getControlConnection();
  assert.equal(controlConnection.name, CONTROL_DB_NAME);

  ({ Organization } = getControlModels(controlConnection));
  await Organization.init(); // wait for unique indexes to finish building

  // Also stand up the *legacy tenant* side: the same connection machinery
  // the real app uses, with the real financial models registered on it.
  const baseConnection = await connectDB();
  legacyConnection = baseConnection.connection;
  require('../../db/models'); // registers Member/Contribution/... on legacyConnection
}, { timeout: 60000 });

beforeEach(async () => {
  await Organization.deleteMany({});
});

after(async () => {
  await stopMemoryMongo();
});

function sampleOrg(overrides = {}) {
  return {
    organization_id: 'org_test_alpha',
    name: 'Test Alpha Club',
    slug: 'test-alpha-club',
    database_name: 'tenant_test_alpha',
    ...overrides,
  };
}

test('Organization model is registered against the control database', () => {
  assert.equal(Organization.db.name, controlConnection.name);
});

test('Organization model does not appear in the legacy tenant database, and vice versa', () => {
  assert.ok(!legacyConnection.modelNames().includes('Organization'));
  assert.ok(controlConnection.modelNames().includes('Organization'));

  // The reverse must also hold: none of the tenant's financial models leak
  // into the control database's model registry.
  for (const financialModel of ['Member', 'Contribution', 'Loan', 'Fine', 'Transaction']) {
    assert.ok(legacyConnection.modelNames().includes(financialModel), `expected ${financialModel} on legacy connection`);
    assert.ok(!controlConnection.modelNames().includes(financialModel), `${financialModel} leaked into control DB`);
  }
});

test('duplicate organization_id is rejected', async () => {
  await Organization.create(sampleOrg());

  await assert.rejects(
    () => Organization.create(sampleOrg({ slug: 'different-slug', database_name: 'tenant_different' })),
    (err) => err.code === 11000
  );
});

test('duplicate slug is rejected', async () => {
  await Organization.create(sampleOrg());

  await assert.rejects(
    () =>
      Organization.create(
        sampleOrg({ organization_id: 'org_test_beta', database_name: 'tenant_different' })
      ),
    (err) => err.code === 11000
  );
});

test('duplicate database_name is rejected', async () => {
  await Organization.create(sampleOrg());

  await assert.rejects(
    () =>
      Organization.create(
        sampleOrg({ organization_id: 'org_test_beta', slug: 'different-slug' })
      ),
    (err) => err.code === 11000
  );
});
