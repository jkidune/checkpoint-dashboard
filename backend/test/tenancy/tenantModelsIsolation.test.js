// Phase 2 core principle: two organizations must be able to have
// completely independent records — same member.id, same username, same
// fiscal_year — without collisions, and without either side ever being
// able to see the other's data. This file proves that with two REAL
// logical tenant databases on one disposable in-memory MongoDB server, not
// mocks.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

let alpha; // tenant models bundle for org_alpha / tenant_alpha
let beta; // tenant models bundle for org_beta / tenant_beta
let getTenantModels;
let getControlConnection;

before(async () => {
  await startMemoryMongo({ dbName: 'checkpoint_legacy_test' });

  const { createOrganization } = require('../../tenancy/organizationRegistry');
  ({ getTenantModels } = require('../../tenancy/tenantModels'));
  ({ getControlConnection } = require('../../tenancy/controlDb'));

  await createOrganization({
    organization_id: 'org_alpha',
    name: 'Alpha Investment Club',
    slug: 'alpha-club',
    database_name: 'tenant_alpha',
  });
  await createOrganization({
    organization_id: 'org_beta',
    name: 'Beta Investment Club',
    slug: 'beta-club',
    database_name: 'tenant_beta',
  });

  alpha = await getTenantModels({ organization_id: 'org_alpha' });
  beta = await getTenantModels({ organization_id: 'org_beta' });
}, { timeout: 60000 });

after(async () => {
  await stopMemoryMongo();
});

// 1 & 2: correct connection per tenant.
test('1. Tenant A (alpha) Member model connection.name == tenant_alpha', () => {
  assert.equal(alpha.Member.db.name, 'tenant_alpha');
});

test('2. Tenant B (beta) Member model connection.name == tenant_beta', () => {
  assert.equal(beta.Member.db.name, 'tenant_beta');
});

// 3 & 4: cross-tenant write/read isolation.
test('3. A member written by Tenant A cannot be queried by Tenant B', async () => {
  await alpha.Member.create({ name: 'Only In Alpha' });
  const seenFromBeta = await beta.Member.findOne({ name: 'Only In Alpha' });
  assert.equal(seenFromBeta, null);
});

test('4. A member written by Tenant B cannot be queried by Tenant A', async () => {
  await beta.Member.create({ name: 'Only In Beta' });
  const seenFromAlpha = await alpha.Member.findOne({ name: 'Only In Beta' });
  assert.equal(seenFromAlpha, null);
});

// 5-10: independent uniqueness across tenants for the SAME value.
//
// Resets each tenant's own member_id counter document (not just the
// Member collection — deleting documents alone never rewinds a counter,
// by design) so this test is self-contained regardless of what earlier
// tests in this file already created.
test('5 & 11. both tenants can independently allocate member.id = 1, unaffected by the other tenant', async () => {
  await alpha.Member.deleteMany({});
  await beta.Member.deleteMany({});
  await alpha.Counter.deleteOne({ _id: 'member_id' });
  await beta.Counter.deleteOne({ _id: 'member_id' });

  const a1 = await alpha.Member.create({ name: 'Fresh Alpha One' });
  const a2 = await alpha.Member.create({ name: 'Fresh Alpha Two' });
  assert.equal(a1.id, 1);
  assert.equal(a2.id, 2);

  // The core of the invariant: even though alpha's counter is now well
  // past 1, beta's first-ever member in its own fresh counter must still
  // be exactly 1 — proving the two counters never shared state.
  const b1 = await beta.Member.create({ name: 'Fresh Beta One' });
  assert.equal(b1.id, 1);
});

test('6. both tenants can independently use the same username', async () => {
  await alpha.User.init();
  await beta.User.init();
  await alpha.User.create({ username: 'joseph', password_hash: 'x' });
  await beta.User.create({ username: 'joseph', password_hash: 'y' }); // must not throw
  const a = await alpha.User.findOne({ username: 'joseph' }).lean();
  const b = await beta.User.findOne({ username: 'joseph' }).lean();
  assert.equal(a.password_hash, 'x');
  assert.equal(b.password_hash, 'y');
});

test('7. both tenants can independently use FyRules.fiscal_year = 2026', async () => {
  await alpha.FyRules.init();
  await beta.FyRules.init();
  await alpha.FyRules.create({ fiscal_year: 2026, contribution_amount: 75000 });
  await beta.FyRules.create({ fiscal_year: 2026, contribution_amount: 50000 }); // must not throw
});

test('8. both tenants can independently use the same Investment.reconciliation_key', async () => {
  await alpha.Investment.init();
  await beta.Investment.init();
  await alpha.Investment.create({ provider: 'iTrust', amount: 100000, reconciliation_key: 'shared-key-1' });
  await beta.Investment.create({ provider: 'iTrust', amount: 200000, reconciliation_key: 'shared-key-1' }); // must not throw
});

test('9. both tenants can independently use the same FormIntakeSubmission.source_id', async () => {
  await alpha.FormIntakeSubmission.init();
  await beta.FormIntakeSubmission.init();
  const payload = {
    source_id: 'shared-source-1',
    member_name: 'Someone',
    amount: 75000,
    payment_date: '2026-06-01',
    type: 'monthly',
  };
  await alpha.FormIntakeSubmission.create(payload);
  await beta.FormIntakeSubmission.create(payload); // must not throw
});

test('10. both tenants can independently use the same LoanRequestSubmission.source_id', async () => {
  await alpha.LoanRequestSubmission.init();
  await beta.LoanRequestSubmission.init();
  const payload = {
    source_id: 'shared-loan-source-1',
    member_name: 'Someone',
    amount_requested: 500000,
    requested_date: '2026-06-01',
  };
  await alpha.LoanRequestSubmission.create(payload);
  await beta.LoanRequestSubmission.create(payload); // must not throw
});

// 12-15: independent auto-counters for other collections.
test('12. Contribution counters are independent per tenant', async () => {
  await alpha.Contribution.deleteMany({});
  await beta.Contribution.deleteMany({});
  const mk = (m, y) => ({ member_id: 1, amount: 75000, month: m, year: y });

  const a1 = await alpha.Contribution.create(mk(1, 2026));
  const a2 = await alpha.Contribution.create(mk(2, 2026));
  const b1 = await beta.Contribution.create(mk(1, 2026));

  assert.equal(a1.id, 1);
  assert.equal(a2.id, 2);
  assert.equal(b1.id, 1);
});

test('13. Loan counters are independent per tenant', async () => {
  await alpha.Loan.deleteMany({});
  await beta.Loan.deleteMany({});

  const a1 = await alpha.Loan.create({ member_id: 1, principal: 100000 });
  const a2 = await alpha.Loan.create({ member_id: 1, principal: 200000 });
  const b1 = await beta.Loan.create({ member_id: 1, principal: 300000 });

  assert.equal(a1.id, 1);
  assert.equal(a2.id, 2);
  assert.equal(b1.id, 1);
});

// NOTE (discovered by this test suite, not introduced by it):
// notificationSchema and navUpdateSchema, unlike every other core schema,
// never declared their own `id: { type: Number, ... }` field — not before
// Phase 2, and unchanged here. Every Mongoose document already has a
// built-in `id` virtual (getter-only, returns `_id.toHexString()`), and
// `_id` is assigned client-side as soon as the document is constructed —
// i.e. before any pre('save') hook runs. So the addAutoIncrement hook's
// guard, `this.id === undefined || this.id === null`, is never true for
// these two models: the virtual already returns a non-null hex string, the
// guard short-circuits, and `getNextId('notification_id')` /
// `getNextId('nav_update_id')` are never actually called. No
// auto_counters document for either name is ever created, by either
// tenant. This is a pre-existing production quirk (same schema, same
// hook, same behavior with or without Phase 2's connection binding) —
// fixing the schema is out of scope for this phase; see "known risks" in
// docs/multitenancy-architecture.md. What these tests actually verify is
// that this dead code path stays equally inert in both tenants, and that
// documents are still isolated per tenant regardless.
test('14. Notification documents are isolated per tenant (and the dormant counter stays dormant in both)', async () => {
  await alpha.Counter.deleteOne({ _id: 'notification_id' });
  await beta.Counter.deleteOne({ _id: 'notification_id' });
  const mk = (message) => ({ member_id: 1, type: 'custom', message });

  await alpha.Notification.create(mk('alpha-only-notification'));
  await beta.Notification.create(mk('beta-only-notification'));

  const seenFromBeta = await beta.Notification.findOne({ message: 'alpha-only-notification' });
  const seenFromAlpha = await alpha.Notification.findOne({ message: 'beta-only-notification' });
  assert.equal(seenFromBeta, null);
  assert.equal(seenFromAlpha, null);

  // The auto-increment hook never fires for this schema (see note above),
  // in either tenant — confirming there is no shared/global counter
  // silently being touched behind the scenes.
  assert.equal(await alpha.Counter.findById('notification_id').lean(), null);
  assert.equal(await beta.Counter.findById('notification_id').lean(), null);
});

test('15. NavUpdate documents are isolated per tenant (and the dormant counter stays dormant in both)', async () => {
  await alpha.Counter.deleteOne({ _id: 'nav_update_id' });
  await beta.Counter.deleteOne({ _id: 'nav_update_id' });
  const mk = (source) => ({ provider: 'iTrust', asset_class: 'money_market', unit_cost: 1000, effective_date: '2026-06-01', source });

  await alpha.NavUpdate.create(mk('alpha-only-nav-update'));
  await beta.NavUpdate.create(mk('beta-only-nav-update'));

  const seenFromBeta = await beta.NavUpdate.findOne({ source: 'alpha-only-nav-update' });
  const seenFromAlpha = await alpha.NavUpdate.findOne({ source: 'beta-only-nav-update' });
  assert.equal(seenFromBeta, null);
  assert.equal(seenFromAlpha, null);

  assert.equal(await alpha.Counter.findById('nav_update_id').lean(), null);
  assert.equal(await beta.Counter.findById('nav_update_id').lean(), null);
});

// 16-19: auxiliary record isolation.
test('16. PasswordResetToken records are isolated per tenant', async () => {
  await alpha.PasswordResetToken.init();
  await beta.PasswordResetToken.init();
  await alpha.PasswordResetToken.create({
    user_id: 1,
    token_hash: 'alpha-only-token',
    expires_at: new Date(Date.now() + 60000),
  });
  const seenFromBeta = await beta.PasswordResetToken.findOne({ token_hash: 'alpha-only-token' });
  assert.equal(seenFromBeta, null);
});

test('17. CommunicationLog records are isolated per tenant', async () => {
  await alpha.CommunicationLog.create({
    recipient_email: 'alpha-only@example.com',
    type: 'admin_test',
    status: 'sent',
  });
  const seenFromBeta = await beta.CommunicationLog.findOne({ recipient_email: 'alpha-only@example.com' });
  assert.equal(seenFromBeta, null);
});

test('18. AdminNotificationState records are isolated per tenant', async () => {
  await alpha.AdminNotificationState.create({
    key: 'alpha-only-key',
    admin_key: 'admin',
    source: 'fine',
    source_id: '1',
  });
  const seenFromBeta = await beta.AdminNotificationState.findOne({ key: 'alpha-only-key' });
  assert.equal(seenFromBeta, null);
});

test('19. Reconciliation records (ReconciliationRun) are isolated per tenant', async () => {
  await alpha.ReconciliationRun.create({
    run_key: 'alpha-only-run',
    source_hash: 'x',
    schema_version: '1',
    source_generated_on: '2026-06-01',
    reporting_cutoff: {},
    backup: {},
  });
  const seenFromBeta = await beta.ReconciliationRun.findOne({ run_key: 'alpha-only-run' });
  assert.equal(seenFromBeta, null);
});

// 20-22: control-plane isolation.
test('20. Control Organization records are not visible from either tenant DB', async () => {
  const alphaCollections = (await alpha.Member.db.db.listCollections().toArray()).map((c) => c.name);
  const betaCollections = (await beta.Member.db.db.listCollections().toArray()).map((c) => c.name);
  assert.ok(!alphaCollections.includes('organizations'));
  assert.ok(!betaCollections.includes('organizations'));
});

test('21. Tenant databases contain no organizations collection created by tenant-model binding', async () => {
  // Redundant with #20 by design — this asserts it specifically as a
  // consequence of *binding tenant models*, not merely of never having
  // touched the control DB from this connection.
  const alphaCollectionNames = (await alpha.Member.db.db.listCollections({ name: 'organizations' }).toArray());
  const betaCollectionNames = (await beta.Member.db.db.listCollections({ name: 'organizations' }).toArray());
  assert.equal(alphaCollectionNames.length, 0);
  assert.equal(betaCollectionNames.length, 0);
});

test('22. Control DB does not contain tenant financial collections merely because tenant models were constructed', async () => {
  const controlConnection = await getControlConnection();
  const controlCollectionNames = (await controlConnection.db.listCollections().toArray()).map((c) => c.name);
  for (const tenantOnlyCollection of ['members', 'contributions', 'loans', 'fines', 'transactions']) {
    assert.ok(
      !controlCollectionNames.includes(tenantOnlyCollection),
      `control DB should not contain "${tenantOnlyCollection}"`
    );
  }
});

// 23-25: model/connection instance identity.
test('23. repeated getTenantModels() calls reuse the correct (same) model instances', async () => {
  const alphaAgain = await getTenantModels({ organization_id: 'org_alpha' });
  assert.equal(alphaAgain.Member, alpha.Member);
  assert.equal(alphaAgain.FyRules, alpha.FyRules);
  assert.equal(alphaAgain.getNextId, alpha.getNextId);
});

test('24. Tenant A model instance !== Tenant B model instance', () => {
  assert.notEqual(alpha.Member, beta.Member);
});

test('25. Tenant A connection !== Tenant B connection', () => {
  assert.notEqual(alpha.Member.db, beta.Member.db);
});

// getNextId compatibility: tenant code must never accidentally end up with
// the global/default getNextId.
test('tenant getNextId is not the default/legacy compatibility getNextId', () => {
  const { getNextId: defaultGetNextId } = require('../../db/models');
  assert.notEqual(alpha.getNextId, defaultGetNextId);
  assert.notEqual(beta.getNextId, defaultGetNextId);
  assert.notEqual(alpha.getNextId, beta.getNextId);
});

test("tenant Counter model is distinct per tenant and distinct from the default Counter", () => {
  const { Counter: defaultCounter } = require('../../db/models');
  assert.notEqual(alpha.Counter, defaultCounter);
  assert.notEqual(beta.Counter, defaultCounter);
  assert.notEqual(alpha.Counter, beta.Counter);
  assert.equal(alpha.Counter.db.name, 'tenant_alpha');
  assert.equal(beta.Counter.db.name, 'tenant_beta');
});
