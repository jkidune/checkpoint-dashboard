// Proves existing routes would behave identically after the Phase 2
// schema-factory extraction: the default/legacy compatibility exports from
// ../../db/models.js (and the auxiliary model files) still bind to the
// default Mongoose connection, still export the same shape, and
// auto-increment / unique indexes still behave exactly as before.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

let models;
let comm;
let admin;
let formIntake;
let loanReq;

before(async () => {
  await startMemoryMongo({ dbName: 'checkpoint_legacy_test' });
  const connectDB = require('../../db/mongoose');
  await connectDB();

  models = require('../../db/models');
  comm = require('../../db/communicationModels');
  admin = require('../../db/adminNotificationModels');
  formIntake = require('../../db/formIntakeModels');
  loanReq = require('../../db/loanRequestModels');
}, { timeout: 60000 });

after(async () => {
  await stopMemoryMongo();
});

test('all default exports are bound to the default Mongoose connection', () => {
  const allModels = [
    models.Member, models.Contribution, models.Loan, models.Repayment, models.Transaction,
    models.User, models.Fine, models.WelfareEvent, models.FyRules, models.Expense,
    models.Investment, models.NavUpdate, models.Notification, models.ReconciliationRun,
    models.AuditSourceRecord, models.Counter,
    comm.CommunicationLog, comm.PasswordResetToken,
    admin.AdminNotificationState,
    formIntake.FormIntakeSubmission,
    loanReq.LoanRequestSubmission,
  ];
  for (const model of allModels) {
    assert.equal(model.db, mongoose.connection, `${model.modelName} should be bound to mongoose.connection`);
  }
});

test('import shape from db/models.js is unchanged (plus the new bindCoreModels export)', () => {
  const expectedKeys = [
    'getNextId', 'Counter', 'Member', 'Contribution', 'Loan', 'Repayment', 'Transaction',
    'User', 'Fine', 'WelfareEvent', 'FyRules', 'Expense', 'Investment', 'NavUpdate',
    'Notification', 'ReconciliationRun', 'AuditSourceRecord',
    'bindCoreModels', // new in Phase 2, additive only
  ];
  assert.deepEqual(Object.keys(models).sort(), expectedKeys.sort());
});

test('auto-increment (getNextId) still works exactly as before', async () => {
  const first = await models.Member.create({ name: 'Compat Member One' });
  const second = await models.Member.create({ name: 'Compat Member Two' });
  assert.equal(typeof first.id, 'number');
  assert.equal(second.id, first.id + 1);
});

test('User.username unique index still rejects duplicates', async () => {
  await models.User.init();
  await models.User.create({ username: 'compat_user', password_hash: 'x' });
  await assert.rejects(
    () => models.User.create({ username: 'compat_user', password_hash: 'y' }),
    (err) => err.code === 11000
  );
});

test('FyRules.fiscal_year unique index still rejects duplicates', async () => {
  await models.FyRules.init();
  await models.FyRules.create({ fiscal_year: 2099 });
  await assert.rejects(
    () => models.FyRules.create({ fiscal_year: 2099 }),
    (err) => err.code === 11000
  );
});

test('PasswordResetToken.token_hash unique index still present', async () => {
  await comm.PasswordResetToken.init();
  await comm.PasswordResetToken.create({
    user_id: 1,
    token_hash: 'compat-hash',
    expires_at: new Date(Date.now() + 60000),
  });
  await assert.rejects(
    () =>
      comm.PasswordResetToken.create({
        user_id: 2,
        token_hash: 'compat-hash',
        expires_at: new Date(Date.now() + 60000),
      }),
    (err) => err.code === 11000
  );
});
