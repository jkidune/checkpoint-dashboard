const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

let registry;
let Organization;

before(async () => {
  await startMemoryMongo();
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

test('createOrganization + lookups round-trip', async () => {
  const created = await registry.createOrganization({
    organization_id: 'org_checkpoint_investors',
    name: 'Checkpoint Investors Club',
    slug: 'checkpoint-investors-club',
    database_name: 'checkpoint_legacy_test',
    legacy: true,
  });
  assert.equal(created.organization_id, 'org_checkpoint_investors');

  const byId = await registry.getOrganizationById('org_checkpoint_investors');
  assert.equal(byId.slug, 'checkpoint-investors-club');

  const bySlug = await registry.getOrganizationBySlug('checkpoint-investors-club');
  assert.equal(bySlug.organization_id, 'org_checkpoint_investors');

  const byDatabaseName = await registry.getOrganizationByDatabaseName('checkpoint_legacy_test');
  assert.equal(byDatabaseName.organization_id, 'org_checkpoint_investors');

  const active = await registry.listActiveOrganizations();
  assert.equal(active.length, 1);
  assert.equal(active[0].organization_id, 'org_checkpoint_investors');
});

test('lookups return null for unknown identifiers instead of throwing', async () => {
  assert.equal(await registry.getOrganizationById('org_does_not_exist'), null);
  assert.equal(await registry.getOrganizationBySlug('nope'), null);
  assert.equal(await registry.getOrganizationByDatabaseName('nope'), null);
});

test('listActiveOrganizations excludes non-active organizations', async () => {
  await registry.createOrganization({
    organization_id: 'org_suspended',
    name: 'Suspended Org',
    slug: 'suspended-org',
    database_name: 'tenant_suspended',
    status: 'suspended',
  });

  const active = await registry.listActiveOrganizations();
  assert.equal(active.length, 0);
});
