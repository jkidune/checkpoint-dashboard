// Proves the public tenancy API has no bypass around the trusted
// organization_id -> organizationRegistry -> getTenantConnection() path:
// getModelsForConnection (which accepts a raw Connection with no
// organization check at all) must not be reachable from either
// tenancy/tenantModels.js's or tenancy/index.js's public exports, even
// though it exists internally as tenantModels.js's implementation detail.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

before(async () => {
  await startMemoryMongo();

  const { createOrganization } = require('../../tenancy/organizationRegistry');
  await createOrganization({
    organization_id: 'org_alpha',
    name: 'Alpha',
    slug: 'alpha-club',
    database_name: 'tenant_alpha',
  });
}, { timeout: 60000 });

after(async () => {
  await stopMemoryMongo();
});

test('1. tenancy/tenantModels exports getTenantModels', () => {
  const tenantModels = require('../../tenancy/tenantModels');
  assert.equal(typeof tenantModels.getTenantModels, 'function');
});

test('2. tenancy/tenantModels does NOT export getModelsForConnection', () => {
  const tenantModels = require('../../tenancy/tenantModels');
  assert.equal(tenantModels.getModelsForConnection, undefined);
  assert.deepEqual(Object.keys(tenantModels), ['getTenantModels']);
});

test('3. tenancy/index does NOT export getModelsForConnection', () => {
  const tenancy = require('../../tenancy');
  assert.equal(tenancy.getModelsForConnection, undefined);
  assert.equal(typeof tenancy.getTenantModels, 'function');
});

test('4. the normal trusted path still works: getTenantModels({ organization_id })', async () => {
  const { getTenantModels } = require('../../tenancy/tenantModels');
  const models = await getTenantModels({ organization_id: 'org_alpha' });
  assert.equal(models.Member.db.name, 'tenant_alpha');
});

test('5. an unknown organization still fails', async () => {
  const { getTenantModels } = require('../../tenancy/tenantModels');
  await assert.rejects(
    () => getTenantModels({ organization_id: 'org_does_not_exist' }),
    /No registered organization found/
  );
});

test('6. a raw Connection cannot be used to obtain tenant models through the public API', async () => {
  const { getTenantModels } = require('../../tenancy/tenantModels');
  const connectDB = require('../../db/mongoose');
  const baseConnection = await connectDB();

  // Whatever shape of "just give me a connection" a caller might try, the
  // public entry point only understands { organization_id }. A Connection
  // object has no organization_id property, so this must be rejected the
  // same way any other malformed input is — never silently accepted as a
  // target to bind models onto.
  await assert.rejects(
    () => getTenantModels(baseConnection.connection),
    /requires organization\.organization_id/
  );

  // Also confirm there is no alternate named export anywhere on the public
  // surfaces that accepts a Connection directly.
  const tenantModels = require('../../tenancy/tenantModels');
  const tenancy = require('../../tenancy');
  for (const publicApi of [tenantModels, tenancy]) {
    for (const value of Object.values(publicApi)) {
      if (typeof value === 'function') {
        assert.notEqual(value.name, 'getModelsForConnection');
      }
    }
  }
});
