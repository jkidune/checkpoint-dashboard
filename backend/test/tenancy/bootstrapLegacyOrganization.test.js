const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

let bootstrap;
let Organization;

before(async () => {
  await startMemoryMongo({ dbName: 'checkpoint_legacy_test' });
  bootstrap = require('../../scripts/bootstrap-legacy-organization');
  const { getOrganizationModel } = require('../../tenancy/organizationRegistry');
  Organization = await getOrganizationModel();
  await Organization.init();
}, { timeout: 60000 });

beforeEach(async () => {
  await Organization.deleteMany({});
});

after(async () => {
  await stopMemoryMongo();
});

test('dry run performs zero writes', async () => {
  const result = await bootstrap.run({ apply: false });

  assert.equal(result.mode, 'dry_run');
  assert.equal(result.status, 'would_create');
  assert.equal(result.tenantDatabaseName, 'checkpoint_legacy_test');
  assert.equal(await Organization.countDocuments(), 0);
});

test('--apply creates exactly one organization', async () => {
  const result = await bootstrap.run({ apply: true });

  assert.equal(result.status, 'created');
  assert.equal(result.organization.organization_id, bootstrap.LEGACY_ORGANIZATION.organization_id);
  assert.equal(result.organization.database_name, 'checkpoint_legacy_test');
  assert.equal(result.organization.legacy, true);
  assert.equal(await Organization.countDocuments(), 1);
});

test('re-running bootstrap is idempotent (no duplicate created)', async () => {
  await bootstrap.run({ apply: true });
  const second = await bootstrap.run({ apply: true });

  assert.equal(second.status, 'already_registered');
  assert.equal(await Organization.countDocuments(), 1);
});

test('dry run after apply also reports already_registered without writing', async () => {
  await bootstrap.run({ apply: true });
  const dryRun = await bootstrap.run({ apply: false });

  assert.equal(dryRun.status, 'already_registered');
  assert.equal(await Organization.countDocuments(), 1);
});

test('a conflicting organization/database mapping aborts safely', async () => {
  // Same organization_id as LEGACY_ORGANIZATION, but pointing at a
  // different database — an inconsistent state the script must never try
  // to silently "fix".
  await Organization.create({
    organization_id: bootstrap.LEGACY_ORGANIZATION.organization_id,
    name: 'Somehow Already Registered Differently',
    slug: 'some-other-slug',
    database_name: 'some_other_database',
  });

  const result = await bootstrap.run({ apply: true });

  assert.equal(result.status, 'aborted');
  assert.ok(result.conflicts.length > 0);
  // Still exactly the one (pre-existing, conflicting) document — nothing new created.
  assert.equal(await Organization.countDocuments(), 1);
});
