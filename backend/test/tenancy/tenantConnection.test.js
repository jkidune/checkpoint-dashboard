const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

let getTenantConnection;
let registry;
let Organization;

before(async () => {
  await startMemoryMongo();
  ({ getTenantConnection } = require('../../tenancy/tenantConnection'));
  registry = require('../../tenancy/organizationRegistry');
  Organization = await registry.getOrganizationModel();
  await Organization.init();
}, { timeout: 60000 });

beforeEach(async () => {
  await Organization.deleteMany({});
});

after(async () => {
  await stopMemoryMongo();
});

async function registerOrg(overrides = {}) {
  return registry.createOrganization({
    organization_id: 'org_test_alpha',
    name: 'Test Alpha Club',
    slug: 'test-alpha-club',
    database_name: 'tenant_alpha_db',
    ...overrides,
  });
}

test('a registered organization resolves successfully, by organization_id alone', async () => {
  await registerOrg();

  const connection = await getTenantConnection({ organization_id: 'org_test_alpha' });
  assert.equal(connection.name, 'tenant_alpha_db');
});

test('the caller-supplied database_name is accepted when it agrees with the registry', async () => {
  await registerOrg();

  const connection = await getTenantConnection({
    organization_id: 'org_test_alpha',
    database_name: 'tenant_alpha_db',
  });
  assert.equal(connection.name, 'tenant_alpha_db');
});

test('returns the same cached connection for repeated calls to the same organization', async () => {
  await registerOrg();

  const first = await getTenantConnection({ organization_id: 'org_test_alpha' });
  const second = await getTenantConnection({ organization_id: 'org_test_alpha' });
  assert.equal(first, second);
});

test('an unknown organization_id is rejected', async () => {
  // Nothing registered at all.
  await assert.rejects(
    () => getTenantConnection({ organization_id: 'org_does_not_exist' }),
    /No registered organization found/
  );
});

test('a forged object carrying a valid-looking but unregistered database_name is rejected', async () => {
  // No organization is registered — the object below is entirely made up,
  // but its database_name is syntactically indistinguishable from a real
  // one. It must still be rejected because organization_id never resolves.
  await assert.rejects(
    () =>
      getTenantConnection({
        organization_id: 'org_never_registered',
        database_name: 'some_other_tenant_financial_db',
      }),
    /No registered organization found/
  );
});

test('a forged object using a REAL organization_id but a different database_name is rejected', async () => {
  await registerOrg(); // org_test_alpha -> tenant_alpha_db

  // This is the exact attack this fix closes: a real, resolvable
  // organization_id paired with someone else's database_name.
  await assert.rejects(
    () =>
      getTenantConnection({
        organization_id: 'org_test_alpha',
        database_name: 'someone_elses_tenant_db',
      }),
    /does not match the control-plane registry/
  );
});

test('only the database_name stored in the trusted registry can ever be opened', async () => {
  await registerOrg();

  // Update the registry record directly (simulating the trusted source of
  // truth changing) and confirm the connection follows the registry, never
  // a value the caller supplies.
  await Organization.updateOne({ organization_id: 'org_test_alpha' }, { database_name: 'tenant_alpha_db_v2' });

  const connection = await getTenantConnection({ organization_id: 'org_test_alpha' });
  assert.equal(connection.name, 'tenant_alpha_db_v2');

  // The old value is no longer honored even if a caller still has it cached
  // in an object somewhere.
  await assert.rejects(
    () => getTenantConnection({ organization_id: 'org_test_alpha', database_name: 'tenant_alpha_db' }),
    /does not match the control-plane registry/
  );
});

test('a bare string is rejected (never reaches the trust boundary)', async () => {
  await registerOrg();
  await assert.rejects(() => getTenantConnection('tenant_alpha_db'), /requires an object with an organization_id/);
});

test('an object with no organization_id is rejected', async () => {
  await assert.rejects(
    () => getTenantConnection({ database_name: 'tenant_alpha_db' }),
    /requires organization\.organization_id/
  );
});
