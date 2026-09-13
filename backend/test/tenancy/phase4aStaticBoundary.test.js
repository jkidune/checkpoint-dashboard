// Static proof (no server, no DB) that the three Phase 4A route files no
// longer import the default/legacy model registry, and never touch
// mongoose directly. This is a source-text check on purpose: it protects
// against a future edit reintroducing `require('../db/models')` even
// without a test that would otherwise exercise the resulting bug.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATED_FILES = ['members.js', 'transactions.js', 'expenses.js'];

const FORBIDDEN_PATTERNS = [
  /require\(['"]\.\.\/db\/models['"]\)/,
  /require\(['"]\.\.\/db\/communicationModels['"]\)/,
  /require\(['"]\.\.\/db\/formIntakeModels['"]\)/,
  /require\(['"]\.\.\/db\/adminNotificationModels['"]\)/,
  /require\(['"]\.\.\/db\/loanRequestModels['"]\)/,
  /mongoose\.connection/,
  /mongoose\.model\(/,
  /mongoose\.models\b/,
];

for (const file of MIGRATED_FILES) {
  test(`${file} does not import the default/legacy model registry or touch mongoose directly`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', file), 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${file} matched forbidden pattern ${pattern}`);
    }
  });

  test(`${file} reads its models from req.tenantModels`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', file), 'utf8');
    assert.match(source, /req\.tenantModels/, `${file} should destructure/read from req.tenantModels`);
  });
}
