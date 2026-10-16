const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

const notifications = read('routes/notifications.js');
const deadlineScan = read('jobs/deadlineScan.js');
const automaticFines = read('services/automaticMissingFineIssuance.js');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

const deadlineExplicit = section(
  deadlineScan,
  'async function runDeadlineScanWithModels',
  '// Temporary compatibility wrapper',
);
const fineExplicit = section(
  automaticFines,
  'async function runAutomaticFineIssuanceWithModels',
  '// Temporary compatibility wrapper',
);

test('Phase 4F-B1 notifications route has no default-bound model imports', () => {
  for (const forbidden of [
    "../db/models",
    "../db/formIntakeModels",
    "../db/adminNotificationModels",
    "../db/communicationModels",
    'mongoose',
  ]) {
    assert.equal(notifications.includes(forbidden), false, `notifications.js must not reference ${forbidden}`);
  }
});

test('Phase 4F-B1 notifications route does not resolve or select a tenant itself', () => {
  for (const forbidden of [
    'getTenantModels',
    'getTenantConnection',
    'resolveRuntimeTenant',
    'resolveApprovedRuntimeTenant',
    'database_name',
    'useDb(',
  ]) {
    assert.equal(notifications.includes(forbidden), false, `notifications.js must not contain ${forbidden}`);
  }
});

test('Phase 4F-B1 notification reads and writes are tenant-model explicit', () => {
  for (const required of [
    'models.Notification.find(',
    'models.Notification.create(',
    'models.Notification.updateMany(',
    'models.FormIntakeSubmission.find(',
    'models.Member.find(',
    'models.AdminNotificationState.find(',
    'models.AdminNotificationState.bulkWrite(',
    'models.AdminNotificationState.findOneAndUpdate(',
    "models.getNextId('notification_id')",
  ]) {
    assert.ok(notifications.includes(required), `notifications.js must contain ${required}`);
  }
});

test('Phase 4F-B1 manual scan passes the authenticated tenant bundle', () => {
  assert.ok(
    notifications.includes('runDeadlineScanWithModels(req.tenantModels)'),
    '/notifications/scan must call the model-explicit scan with req.tenantModels',
  );
  assert.equal(
    /\brunDeadlineScan\s*\(\s*\)/.test(notifications),
    false,
    '/notifications/scan must never call the default-bound compatibility wrapper',
  );
});

test('Phase 4F-B1 deadline scan explicit path never reaches legacyModels', () => {
  assert.equal(/\blegacyModels\b/.test(deadlineExplicit), false);
  assert.equal(/\brunDeadlineScan\s*\(/.test(deadlineExplicit), false);
  assert.equal(/\brunAutomaticFineIssuance\s*\(/.test(deadlineExplicit), false);
  assert.equal(/\bgetRulesForFY\s*\(/.test(deadlineExplicit), false);
});

test('Phase 4F-B1 deadline scan explicit path uses supplied models for every database domain', () => {
  for (const required of [
    'models.FyRules',
    'models.Member.find(',
    'models.Contribution.find(',
    'models.Loan.find(',
    'models.Fine.find(',
    'models.Notification.findOne(',
    'models.Notification.create(',
    "models.getNextId('notification_id')",
    'runAutomaticFineIssuanceWithModels(models,',
  ]) {
    assert.ok(deadlineScan.includes(required), `deadlineScan.js must contain ${required}`);
  }
});

test('Phase 4F-B1 deadline scan keeps only a narrow B2 compatibility wrapper', () => {
  assert.match(
    deadlineScan,
    /async function runDeadlineScan\(options = \{\}\) \{\s*return runDeadlineScanWithModels\(legacyModels, options\);\s*\}/,
  );
  assert.match(
    deadlineScan,
    /cron\.schedule\('0 6 \* \* \*', \(\) => \{\s*runDeadlineScan\(\)\.catch/,
  );
});

test('Phase 4F-B1 automatic fine explicit path never reaches legacyModels', () => {
  assert.equal(/\blegacyModels\b/.test(fineExplicit), false);
  assert.equal(/\bgetRulesForFY\s*\(/.test(fineExplicit), false);
  assert.equal(/(?<!\.)\b(?:Member|Contribution|Loan|Repayment|Fine|Notification|CommunicationLog)\./.test(fineExplicit), false);
  assert.equal(/(?<!\.)\bgetNextId\s*\(/.test(fineExplicit), false);
});

test('Phase 4F-B1 automatic fine explicit path uses supplied models', () => {
  for (const required of [
    'models.Member.find(',
    'models.Contribution.find(',
    'models.Loan.find(',
    'models.Repayment.find(',
    'models.Fine.find(',
    'models.Fine.create(',
    'models.Notification.findOne(',
    'models.Notification.create(',
    'models.CommunicationLog.findOne(',
    'models.CommunicationLog.create(',
    'getRulesForFYWithModel(models.FyRules,',
    "models.getNextId('fine_id')",
    "models.getNextId('notification_id')",
  ]) {
    assert.ok(automaticFines.includes(required), `automaticMissingFineIssuance.js must contain ${required}`);
  }
});

test('Phase 4F-B1 automatic fine compatibility wrapper is isolated for B2', () => {
  assert.match(
    automaticFines,
    /async function runAutomaticFineIssuance\(options = \{\}\) \{\s*return runAutomaticFineIssuanceWithModels\(legacyModels, options\);\s*\}/,
  );
  assert.ok(automaticFines.includes('runAutomaticFineIssuanceWithModels,'));
});

test('Phase 4F-B1 model-explicit paths accept model bundles, not database selectors', () => {
  const combined = deadlineExplicit + '\n' + fineExplicit;
  for (const forbidden of [
    'database_name',
    'organization_id',
    'getTenantModels',
    'getTenantConnection',
    'resolveRuntimeTenant',
    'resolveApprovedRuntimeTenant',
    'useDb(',
  ]) {
    assert.equal(combined.includes(forbidden), false, `explicit automation path must not contain ${forbidden}`);
  }
});

test('Phase 4F-B1 does not move B2 cron authorization into the authenticated notification route', () => {
  assert.equal(notifications.includes('CRON_SECRET'), false);
  assert.equal(notifications.includes("req.get('authorization')"), false);
});
