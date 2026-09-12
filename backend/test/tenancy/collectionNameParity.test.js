// Phase 2 must not accidentally rename any collection via a model-name or
// pluralization difference introduced during the schema-factory refactor.
// This pins down the exact collection name every tenant-owned model
// produces, matching what backend/db/models.js and the auxiliary model
// files produced before Phase 2.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

// key -> [modelName, collectionName], as produced by the default/legacy
// compatibility exports (../../db/*.js).
const EXPECTED = {
  Counter: ['Counter', 'auto_counters'],
  Member: ['Member', 'members'],
  Contribution: ['Contribution', 'contributions'],
  Loan: ['Loan', 'loans'],
  Repayment: ['LoanRepayment', 'loanrepayments'],
  Transaction: ['Transaction', 'transactions'],
  User: ['User', 'users'],
  Fine: ['Fine', 'fines'],
  WelfareEvent: ['WelfareEvent', 'welfareevents'],
  FyRules: ['FyRules', 'fyrules'],
  Expense: ['Expense', 'expenses'],
  Investment: ['Investment', 'investments'],
  NavUpdate: ['NavUpdate', 'navupdates'],
  Notification: ['Notification', 'notifications'],
  ReconciliationRun: ['ReconciliationRun', 'reconciliationruns'],
  AuditSourceRecord: ['AuditSourceRecord', 'auditsourcerecords'],
  CommunicationLog: ['CommunicationLog', 'communicationlogs'],
  PasswordResetToken: ['PasswordResetToken', 'passwordresettokens'],
  AdminNotificationState: ['AdminNotificationState', 'adminnotificationstates'],
  FormIntakeSubmission: ['FormIntakeSubmission', 'formintakesubmissions'],
  LoanRequestSubmission: ['LoanRequestSubmission', 'loanrequestsubmissions'],
};

let allModels;

before(async () => {
  await startMemoryMongo({ dbName: 'checkpoint_legacy_test' });

  allModels = {
    ...require('../../db/models'),
    ...require('../../db/communicationModels'),
    ...require('../../db/adminNotificationModels'),
    ...require('../../db/formIntakeModels'),
    ...require('../../db/loanRequestModels'),
  };
}, { timeout: 60000 });

after(async () => {
  await stopMemoryMongo();
});

for (const [exportKey, [expectedModelName, expectedCollectionName]] of Object.entries(EXPECTED)) {
  test(`${exportKey} preserves model name "${expectedModelName}" and collection "${expectedCollectionName}"`, () => {
    const model = allModels[exportKey];
    assert.ok(model, `expected an export named "${exportKey}"`);
    assert.equal(model.modelName, expectedModelName);
    assert.equal(model.collection.collectionName, expectedCollectionName);
  });
}

test('no unexpected extra tenant-owned exports appeared', () => {
  const modelExports = Object.keys(allModels).filter(
    (k) => allModels[k] && allModels[k].modelName
  );
  assert.deepEqual(modelExports.sort(), Object.keys(EXPECTED).sort());
});
