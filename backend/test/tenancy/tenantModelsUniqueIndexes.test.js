// Dedicated unique-index coverage: within ONE tenant, duplicates must still
// be rejected exactly as before Phase 2 (indexes were not weakened or
// removed). Across TWO tenants, the same value must be allowed, because
// tenant isolation comes from separate databases, not from the indexes
// themselves.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

let alpha;
let beta;

before(async () => {
  await startMemoryMongo({ dbName: 'checkpoint_legacy_test' });

  const { createOrganization } = require('../../tenancy/organizationRegistry');
  const { getTenantModels } = require('../../tenancy/tenantModels');

  await createOrganization({
    organization_id: 'org_alpha',
    name: 'Alpha',
    slug: 'alpha-club',
    database_name: 'tenant_alpha',
  });
  await createOrganization({
    organization_id: 'org_beta',
    name: 'Beta',
    slug: 'beta-club',
    database_name: 'tenant_beta',
  });

  alpha = await getTenantModels({ organization_id: 'org_alpha' });
  beta = await getTenantModels({ organization_id: 'org_beta' });

  // Ensure every unique index under test has finished building before any
  // duplicate-key assertions run.
  await Promise.all([
    alpha.User.init(), beta.User.init(),
    alpha.FyRules.init(), beta.FyRules.init(),
    alpha.Investment.init(), beta.Investment.init(),
    alpha.ReconciliationRun.init(), beta.ReconciliationRun.init(),
    alpha.FormIntakeSubmission.init(), beta.FormIntakeSubmission.init(),
    alpha.LoanRequestSubmission.init(), beta.LoanRequestSubmission.init(),
    alpha.AdminNotificationState.init(), beta.AdminNotificationState.init(),
  ]);
}, { timeout: 60000 });

after(async () => {
  await stopMemoryMongo();
});

function isDuplicateKeyError(err) {
  return err.code === 11000;
}

// --- User.username ---------------------------------------------------------
test('User.username: duplicate rejected within one tenant', async () => {
  await alpha.User.create({ username: 'unique_test_user', password_hash: 'x' });
  await assert.rejects(
    () => alpha.User.create({ username: 'unique_test_user', password_hash: 'y' }),
    isDuplicateKeyError
  );
});

test('User.username: same value allowed across two tenants', async () => {
  await alpha.User.create({ username: 'cross_tenant_user', password_hash: 'x' });
  await beta.User.create({ username: 'cross_tenant_user', password_hash: 'y' }); // must not throw
});

// --- FyRules.fiscal_year -----------------------------------------------------
test('FyRules.fiscal_year: duplicate rejected within one tenant', async () => {
  await alpha.FyRules.create({ fiscal_year: 2031 });
  await assert.rejects(() => alpha.FyRules.create({ fiscal_year: 2031 }), isDuplicateKeyError);
});

test('FyRules.fiscal_year: same value allowed across two tenants', async () => {
  await alpha.FyRules.create({ fiscal_year: 2032 });
  await beta.FyRules.create({ fiscal_year: 2032 }); // must not throw
});

// --- Investment.reconciliation_key ------------------------------------------
test('Investment.reconciliation_key: duplicate rejected within one tenant', async () => {
  await alpha.Investment.create({ provider: 'iTrust', amount: 1000, reconciliation_key: 'dup-key-alpha' });
  await assert.rejects(
    () => alpha.Investment.create({ provider: 'iTrust', amount: 2000, reconciliation_key: 'dup-key-alpha' }),
    isDuplicateKeyError
  );
});

test('Investment.reconciliation_key: same value allowed across two tenants', async () => {
  await alpha.Investment.create({ provider: 'iTrust', amount: 1000, reconciliation_key: 'cross-key' });
  await beta.Investment.create({ provider: 'iTrust', amount: 2000, reconciliation_key: 'cross-key' }); // must not throw
});

// --- ReconciliationRun.run_key ----------------------------------------------
function reconciliationRunPayload(runKey) {
  return {
    run_key: runKey,
    source_hash: 'x',
    schema_version: '1',
    source_generated_on: '2026-06-01',
    reporting_cutoff: {},
    backup: {},
  };
}

test('ReconciliationRun.run_key: duplicate rejected within one tenant', async () => {
  await alpha.ReconciliationRun.create(reconciliationRunPayload('dup-run-alpha'));
  await assert.rejects(
    () => alpha.ReconciliationRun.create(reconciliationRunPayload('dup-run-alpha')),
    isDuplicateKeyError
  );
});

test('ReconciliationRun.run_key: same value allowed across two tenants', async () => {
  await alpha.ReconciliationRun.create(reconciliationRunPayload('cross-run'));
  await beta.ReconciliationRun.create(reconciliationRunPayload('cross-run')); // must not throw
});

// --- FormIntakeSubmission.source_id -----------------------------------------
function formIntakePayload(sourceId) {
  return {
    source_id: sourceId,
    member_name: 'Someone',
    amount: 75000,
    payment_date: '2026-06-01',
    type: 'monthly',
  };
}

test('FormIntakeSubmission.source_id: duplicate rejected within one tenant', async () => {
  await alpha.FormIntakeSubmission.create(formIntakePayload('dup-intake-alpha'));
  await assert.rejects(
    () => alpha.FormIntakeSubmission.create(formIntakePayload('dup-intake-alpha')),
    isDuplicateKeyError
  );
});

test('FormIntakeSubmission.source_id: same value allowed across two tenants', async () => {
  await alpha.FormIntakeSubmission.create(formIntakePayload('cross-intake'));
  await beta.FormIntakeSubmission.create(formIntakePayload('cross-intake')); // must not throw
});

// --- LoanRequestSubmission.source_id -----------------------------------------
function loanRequestPayload(sourceId) {
  return {
    source_id: sourceId,
    member_name: 'Someone',
    amount_requested: 500000,
    requested_date: '2026-06-01',
  };
}

test('LoanRequestSubmission.source_id: duplicate rejected within one tenant', async () => {
  await alpha.LoanRequestSubmission.create(loanRequestPayload('dup-loanreq-alpha'));
  await assert.rejects(
    () => alpha.LoanRequestSubmission.create(loanRequestPayload('dup-loanreq-alpha')),
    isDuplicateKeyError
  );
});

test('LoanRequestSubmission.source_id: same value allowed across two tenants', async () => {
  await alpha.LoanRequestSubmission.create(loanRequestPayload('cross-loanreq'));
  await beta.LoanRequestSubmission.create(loanRequestPayload('cross-loanreq')); // must not throw
});

// --- AdminNotificationState.key ----------------------------------------------
test('AdminNotificationState.key: duplicate rejected within one tenant', async () => {
  await alpha.AdminNotificationState.create({
    key: 'dup-admin-key-alpha',
    admin_key: 'admin',
    source: 'fine',
    source_id: '1',
  });
  await assert.rejects(
    () =>
      alpha.AdminNotificationState.create({
        key: 'dup-admin-key-alpha',
        admin_key: 'admin',
        source: 'fine',
        source_id: '2',
      }),
    isDuplicateKeyError
  );
});

test('AdminNotificationState.key: same value allowed across two tenants', async () => {
  await alpha.AdminNotificationState.create({
    key: 'cross-admin-key',
    admin_key: 'admin',
    source: 'fine',
    source_id: '1',
  });
  await beta.AdminNotificationState.create({
    key: 'cross-admin-key',
    admin_key: 'admin',
    source: 'fine',
    source_id: '1',
  }); // must not throw
});
