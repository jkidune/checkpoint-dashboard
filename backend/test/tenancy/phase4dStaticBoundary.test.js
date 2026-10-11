// Static proof (no server, no DB) that the Phase 4D migrated files no
// longer import the default/legacy model registry, never touch mongoose
// directly, and that the live route handlers use req.tenantModels +
// model-explicit service entry points rather than the legacy default-bound
// wrappers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRoute(file) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'routes', file), 'utf8');
}

function readService(file) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'services', file), 'utf8');
}

const FORBIDDEN_MONGOOSE_PATTERNS = [
  /mongoose\.connection/,
  /mongoose\.model\(/,
  /mongoose\.models\b/,
];

// ─── loans.js and loanActivationHotfix.js: NO default model import ────────────

for (const file of ['loans.js', 'loanActivationHotfix.js']) {
  test(`${file} does not import the default/legacy model registry`, () => {
    const source = readRoute(file);
    assert.doesNotMatch(source, /require\(['"]\.\.\/db\/models['"]\)/, `${file} must not import ../db/models`);
  });

  test(`${file} does not import loanRequestModels directly`, () => {
    const source = readRoute(file);
    assert.doesNotMatch(source, /require\(['"]\.\.\/db\/loanRequestModels['"]\)/, `${file} must not import loanRequestModels directly`);
  });

  test(`${file} does not touch mongoose directly`, () => {
    const source = readRoute(file);
    for (const pattern of FORBIDDEN_MONGOOSE_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${file} matched forbidden pattern ${pattern}`);
    }
  });

  test(`${file} reads its models from req.tenantModels`, () => {
    const source = readRoute(file);
    assert.match(source, /req\.tenantModels/, `${file} should read from req.tenantModels`);
  });

  test(`${file} does not call the legacy default-bound getRulesForFY(fy)`, () => {
    const source = readRoute(file);
    assert.doesNotMatch(source, /getRulesForFY\(/, `${file} must not call getRulesForFY() — use getRulesForFYWithModel instead`);
  });

  test(`${file} does not call the legacy default-bound computeMemberLoanEligibility(memberId, fy)`, () => {
    const source = readRoute(file);
    // computeMemberLoanEligibilityWithModels is the allowed one; the legacy two-arg form is not
    assert.doesNotMatch(source, /computeMemberLoanEligibility\((?!models)/, `${file} must not call the legacy two-argument computeMemberLoanEligibility`);
  });
}

// ─── loans.js: enrichLoan must be model-explicit ─────────────────────────────

test('loans.js enrichLoan is model-explicit (takes models as first argument)', () => {
  const source = readRoute('loans.js');
  assert.match(source, /async function enrichLoan\(models, loan/, 'enrichLoan must take (models, loan, ...) signature');
});

// ─── loanActivationHotfix.js: assessmentForLoan must be model-explicit ────────

test('loanActivationHotfix.js assessmentForLoan is model-explicit (takes models as first argument)', () => {
  const source = readRoute('loanActivationHotfix.js');
  assert.match(source, /async function assessmentForLoan\(models, loan/, 'assessmentForLoan must take (models, loan, ...) signature');
});

test('loanActivationHotfix.js calls assessLoanApprovalWithModels, not assessLoanApproval', () => {
  const source = readRoute('loanActivationHotfix.js');
  assert.match(source, /assessLoanApprovalWithModels\(/, 'must call assessLoanApprovalWithModels');
  assert.doesNotMatch(source, /(?<![A-Za-z])assessLoanApproval\((?!WithModels)/, 'must not call legacy assessLoanApproval()');
});

// ─── loanRequests.js: NO default model imports ────────────────────────────────

test('loanRequests.js does not import the default/legacy model registry', () => {
  const source = readRoute('loanRequests.js');
  assert.doesNotMatch(source, /require\(['"]\.\.\/db\/models['"]\)/, 'loanRequests.js must not import ../db/models');
});

test('loanRequests.js does not import loanRequestModels directly', () => {
  const source = readRoute('loanRequests.js');
  assert.doesNotMatch(source, /require\(['"]\.\.\/db\/loanRequestModels['"]\)/, 'loanRequests.js must not import loanRequestModels directly');
});

test('loanRequests.js does not touch mongoose directly', () => {
  const source = readRoute('loanRequests.js');
  for (const pattern of FORBIDDEN_MONGOOSE_PATTERNS) {
    assert.doesNotMatch(source, pattern, `loanRequests.js matched forbidden pattern ${pattern}`);
  }
});

test('loanRequests.js public POST resolves tenant via resolveApprovedRuntimeTenant, not from request', () => {
  const source = readRoute('loanRequests.js');
  assert.match(source, /resolveApprovedRuntimeTenant\(\)/, 'public POST must call resolveApprovedRuntimeTenant()');
});

test('loanRequests.js authenticated routes use req.tenantModels', () => {
  const source = readRoute('loanRequests.js');
  assert.match(source, /req\.tenantModels/, 'authenticated routes must use req.tenantModels');
});

test('loanRequests.js matchMember is model-explicit', () => {
  const source = readRoute('loanRequests.js');
  assert.match(source, /async function matchMember\(models, memberName\)/, 'matchMember must take (models, memberName) signature');
});

test('loanRequests.js enrichRequest is model-explicit', () => {
  const source = readRoute('loanRequests.js');
  assert.match(source, /async function enrichRequest\(models, request\)/, 'enrichRequest must take (models, request) signature');
});

test('loanRequests.js buildRequestAssessment is model-explicit', () => {
  const source = readRoute('loanRequests.js');
  assert.match(source, /async function buildRequestAssessment\(models, request\)/, 'buildRequestAssessment must take (models, request) signature');
});

test('loanRequests.js calls assessLoanApprovalWithModels, not assessLoanApproval', () => {
  const source = readRoute('loanRequests.js');
  assert.match(source, /assessLoanApprovalWithModels\(/, 'must call assessLoanApprovalWithModels');
  assert.doesNotMatch(source, /(?<![A-Za-z])assessLoanApproval\((?!WithModels)/, 'must not call legacy assessLoanApproval()');
});

test('loanRequests.js does not call the legacy computeMemberLoanEligibility(memberId, fy)', () => {
  const source = readRoute('loanRequests.js');
  assert.doesNotMatch(source, /computeMemberLoanEligibility\((?!models)/, 'must not call legacy two-argument computeMemberLoanEligibility');
});

// ─── loanApprovalAssessment.js service: exports both entry points ─────────────

test('loanApprovalAssessment.js exports assessLoanApprovalWithModels (tenant-explicit entry point)', () => {
  const source = readService('loanApprovalAssessment.js');
  assert.match(source, /assessLoanApprovalWithModels/, 'must define assessLoanApprovalWithModels');
  assert.match(source, /module\.exports/, 'must export');
  assert.match(source, /assessLoanApprovalWithModels/, 'assessLoanApprovalWithModels must be exported');
});

test('loanApprovalAssessment.js retains assessLoanApproval legacy wrapper (for callers outside the 4 migrated files)', () => {
  const source = readService('loanApprovalAssessment.js');
  assert.match(source, /assessLoanApproval\b/, 'legacy wrapper must still exist');
  // The legacy wrapper must still use the default/legacy model imports
  assert.match(source, /require\(['"]\.\.\/db\/models['"]\)/, 'legacy wrapper requires default models');
});

test('loanApprovalAssessment.js buildContributionClearanceWithModels is model-explicit', () => {
  const source = readService('loanApprovalAssessment.js');
  assert.match(source, /async function buildContributionClearanceWithModels\(models,/, 'model-explicit variant must exist');
});

test('loanApprovalAssessment.js assessLoanApprovalWithModels uses getRulesForFYWithModel, not getRulesForFY', () => {
  const source = readService('loanApprovalAssessment.js');
  // Find the assessLoanApprovalWithModels function body (it comes before the legacy wrapper)
  const withModelsStart = source.indexOf('async function assessLoanApprovalWithModels(');
  const legacyStart = source.indexOf('async function assessLoanApproval(');
  const withModelsBody = source.slice(withModelsStart, legacyStart);
  assert.match(withModelsBody, /getRulesForFYWithModel\(/, 'assessLoanApprovalWithModels must use getRulesForFYWithModel');
  assert.doesNotMatch(withModelsBody, /getRulesForFY\(fy\)/, 'assessLoanApprovalWithModels must not call legacy getRulesForFY(fy)');
});

test('loanApprovalAssessment.js assessLoanApprovalWithModels uses computeMemberLoanEligibilityWithModels', () => {
  const source = readService('loanApprovalAssessment.js');
  const withModelsStart = source.indexOf('async function assessLoanApprovalWithModels(');
  const legacyStart = source.indexOf('async function assessLoanApproval(');
  const withModelsBody = source.slice(withModelsStart, legacyStart);
  assert.match(withModelsBody, /computeMemberLoanEligibilityWithModels\(/, 'must use computeMemberLoanEligibilityWithModels');
});
