// Static proof (no server, no DB) that the Phase 4B migrated route no
// longer imports the default/legacy model registry, invokes the
// tenant-explicit service entry point (not the legacy compatibility
// wrapper), and that the tenant-explicit service function's own
// implementation never references the module-level default Member /
// Contribution / Loan / Fine bindings.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'routes', 'memberLoanEligibility.js'),
  'utf8'
);
const serviceSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'services', 'memberLoanEligibility.js'),
  'utf8'
);

test('routes/memberLoanEligibility.js does not import the default/legacy model registry or touch mongoose directly', () => {
  assert.doesNotMatch(routeSource, /require\(['"]\.\.\/db\/models['"]\)/);
  assert.doesNotMatch(routeSource, /mongoose\.connection/);
  assert.doesNotMatch(routeSource, /mongoose\.model\(/);
  assert.doesNotMatch(routeSource, /mongoose\.models\b/);
});

test('routes/memberLoanEligibility.js reads its models from req.tenantModels', () => {
  assert.match(routeSource, /req\.tenantModels/);
});

test('routes/memberLoanEligibility.js calls the tenant-explicit service entry point, not the legacy compatibility wrapper', () => {
  assert.match(routeSource, /computeMemberLoanEligibilityWithModels\(/);
  // The legacy name is a substring of the tenant-explicit name, so a plain
  // "does it appear" check would be a false negative. Assert instead that
  // every occurrence of computeMemberLoanEligibility in this file is
  // immediately followed by "WithModels(" — i.e. the bare legacy function
  // is never referenced on its own.
  const calls = routeSource.match(/computeMemberLoanEligibility(?!WithModels)\(/g);
  assert.equal(calls, null, `route must not call the legacy computeMemberLoanEligibility() directly: found ${calls}`);
});

test('services/memberLoanEligibility.js still exports both the legacy and tenant-explicit entry points', () => {
  assert.match(serviceSource, /computeMemberLoanEligibility\b/);
  assert.match(serviceSource, /computeMemberLoanEligibilityWithModels\b/);
});

test('the tenant-explicit function body does not reference the module-level default Member/Contribution/Loan/Fine bindings', () => {
  const start = serviceSource.indexOf('async function computeMemberLoanEligibilityWithModels');
  assert.ok(start !== -1, 'computeMemberLoanEligibilityWithModels not found');
  const nextFunctionOrExports = serviceSource.indexOf('\nmodule.exports', start);
  const body = serviceSource.slice(start, nextFunctionOrExports === -1 ? undefined : nextFunctionOrExports);

  // The module-level default models are bound to the bare identifiers
  // Member/Contribution/Loan/Fine (from require('../db/models')). Inside
  // this function they must only ever appear as part of the renamed
  // destructured locals (TenantMember, TenantContribution, ...), never as
  // a bare identifier used directly (e.g. `Member.findOne`).
  for (const name of ['Member', 'Contribution', 'Loan', 'Fine']) {
    const bareUsage = new RegExp(`(?<![A-Za-z])${name}\\.(?:findOne|find)\\(`);
    assert.doesNotMatch(
      body,
      bareUsage,
      `computeMemberLoanEligibilityWithModels must not call the bare/default ${name} model directly`
    );
  }
});
