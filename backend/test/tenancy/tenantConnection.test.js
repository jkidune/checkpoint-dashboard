const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

let getTenantConnection;

before(async () => {
  await startMemoryMongo();
  ({ getTenantConnection } = require('../../tenancy/tenantConnection'));
}, { timeout: 60000 });

after(async () => {
  await stopMemoryMongo();
});

test('selects the database named on a resolved organization record', async () => {
  const connection = await getTenantConnection({
    organization_id: 'org_test_alpha',
    database_name: 'tenant_alpha_db',
  });
  assert.equal(connection.name, 'tenant_alpha_db');
});

test('returns the same cached connection for repeated calls with the same database_name', async () => {
  const first = await getTenantConnection({ organization_id: 'org_test_alpha', database_name: 'tenant_alpha_db' });
  const second = await getTenantConnection({ organization_id: 'org_test_alpha', database_name: 'tenant_alpha_db' });
  assert.equal(first, second);
});

test('rejects a bare string instead of a resolved organization record', async () => {
  // This is the exact misuse the module guards against: req.query.database
  // (a raw string) must never reach useDb() directly.
  await assert.rejects(() => getTenantConnection('tenant_alpha_db'), /resolved Organization record/);
});

test('rejects an object with a missing database_name', async () => {
  await assert.rejects(
    () => getTenantConnection({ organization_id: 'org_test_alpha' }),
    /missing or unsafe database_name/
  );
});

test('rejects an unsafe database_name (defense in depth)', async () => {
  await assert.rejects(
    () => getTenantConnection({ organization_id: 'org_test_alpha', database_name: '../etc/passwd' }),
    /missing or unsafe database_name/
  );
});
