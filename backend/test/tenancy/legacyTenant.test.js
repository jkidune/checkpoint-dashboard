const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { resolveLegacyTenantDatabaseName } = require('../../tenancy/legacyTenant');

const ORIGINAL_ENV = process.env.LEGACY_TENANT_DB_NAME;

beforeEach(() => {
  delete process.env.LEGACY_TENANT_DB_NAME;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.LEGACY_TENANT_DB_NAME;
  else process.env.LEGACY_TENANT_DB_NAME = ORIGINAL_ENV;
});

test('returns the connected database name when no override is set', () => {
  const name = resolveLegacyTenantDatabaseName({ name: 'checkpoint_prod' });
  assert.equal(name, 'checkpoint_prod');
});

test('returns the connected database name when the override agrees', () => {
  process.env.LEGACY_TENANT_DB_NAME = 'checkpoint_prod';
  const name = resolveLegacyTenantDatabaseName({ name: 'checkpoint_prod' });
  assert.equal(name, 'checkpoint_prod');
});

test('fails safely when the override disagrees with the actual connection', () => {
  process.env.LEGACY_TENANT_DB_NAME = 'some_other_db';
  assert.throws(
    () => resolveLegacyTenantDatabaseName({ name: 'checkpoint_prod' }),
    /does not match/
  );
});

test('throws if the connection has no resolvable database name', () => {
  assert.throws(() => resolveLegacyTenantDatabaseName({}), /Unable to determine/);
});

test('falls back to connection.db.databaseName when connection.name is absent', () => {
  const name = resolveLegacyTenantDatabaseName({ db: { databaseName: 'checkpoint_prod' } });
  assert.equal(name, 'checkpoint_prod');
});
