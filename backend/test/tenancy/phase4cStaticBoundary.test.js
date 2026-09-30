// Static proof (no server, no DB) that the Phase 4C migrated files no
// longer import the default/legacy model registry (except rules.js's
// explicitly-named legacy compatibility wrapper), never touch mongoose
// directly, and that the live route handlers use req.tenantModels +
// getRulesForFYWithModel rather than the legacy getRulesForFY(fy) wrapper.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRoute(file) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'routes', file), 'utf8');
}

const FORBIDDEN_MONGOOSE_PATTERNS = [
  /mongoose\.connection/,
  /mongoose\.model\(/,
  /mongoose\.models\b/,
];

// ─── rulesHotfix.js, contributions.js, contributionsHotfix.js: NO default
// model import of any kind may remain. ──────────────────────────────────
for (const file of ['rulesHotfix.js', 'contributions.js', 'contributionsHotfix.js']) {
  test(`${file} does not import the default/legacy model registry`, () => {
    const source = readRoute(file);
    assert.doesNotMatch(source, /require\(['"]\.\.\/db\/models['"]\)/, `${file} must not import ../db/models at all`);
  });

  test(`${file} does not touch mongoose directly`, () => {
    const source = readRoute(file);
    for (const pattern of FORBIDDEN_MONGOOSE_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${file} matched forbidden pattern ${pattern}`);
    }
  });

  test(`${file} reads its models from req.tenantModels`, () => {
    const source = readRoute(file);
    assert.match(source, /req\.tenantModels/, `${file} should destructure/read from req.tenantModels`);
  });

  test(`${file} does not call the legacy default-bound getRulesForFY(fy)`, () => {
    const source = readRoute(file);
    assert.doesNotMatch(source, /getRulesForFY\(/, `${file} must resolve rules via getRulesForFYWithModel(...), not getRulesForFY(...)`);
    // contributions.js legitimately still imports the pure calculateFine()
    // helper from routes/rules.js (no DB binding) — that's allowed. What's
    // forbidden is importing the legacy getRulesForFY name alongside it.
    const rulesImportLine = source.match(/const \{[^}]*\} = require\(['"]\.\/rules['"]\);/);
    if (rulesImportLine) {
      assert.doesNotMatch(rulesImportLine[0], /getRulesForFY\b/, `${file} must not import the legacy getRulesForFY from ./rules`);
    }
  });
}

// ─── rules.js: the ONE allowed exception. May still import the default
// FyRules model, but ONLY for the explicitly-named getRulesForFY(fy)
// legacy wrapper — never from a live route handler. ──────────────────────
test('rules.js retains the default FyRules import solely for the legacy getRulesForFY(fy) wrapper', () => {
  const source = readRoute('rules.js');
  assert.match(source, /const \{ FyRules \} = require\(['"]\.\.\/db\/models['"]\);/);
  for (const pattern of FORBIDDEN_MONGOOSE_PATTERNS) {
    assert.doesNotMatch(source, pattern, `rules.js matched forbidden pattern ${pattern}`);
  }
});

test('rules.js live route handlers (GET /, GET /:fy, PUT /:fy, DELETE /:fy) use req.tenantModels, not the module-level default FyRules', () => {
  const source = readRoute('rules.js');

  const getAllStart = source.indexOf("router.get('/', authenticate");
  const getAllEnd = source.indexOf("router.get('/:fy'", getAllStart);
  const getAllBody = source.slice(getAllStart, getAllEnd);
  assert.match(getAllBody, /req\.tenantModels/);
  assert.doesNotMatch(getAllBody, /(?<![.\w])FyRules\.find\(/, 'GET / must not query the module-level default FyRules directly');

  const getOneStart = source.indexOf("router.get('/:fy'", getAllEnd);
  const getOneEnd = source.indexOf("router.put('/:fy'", getOneStart);
  const getOneBody = source.slice(getOneStart, getOneEnd);
  assert.match(getOneBody, /getRulesForFYWithModel\(req\.tenantModels\.FyRules/);
  assert.doesNotMatch(getOneBody, /getRulesForFY\(fy\)/);

  const putStart = source.indexOf("router.put('/:fy'", getOneEnd);
  const putEnd = source.indexOf("router.delete('/:fy'", putStart);
  const putBody = source.slice(putStart, putEnd);
  assert.match(putBody, /req\.tenantModels/);
  assert.doesNotMatch(putBody, /(?<![.\w])FyRules\.findOneAndUpdate\(/, 'PUT /:fy must not write to the module-level default FyRules directly');

  const deleteStart = source.indexOf("router.delete('/:fy'", putEnd);
  const deleteEnd = source.indexOf("// ─── Shared: months-late", deleteStart);
  const deleteBody = source.slice(deleteStart, deleteEnd === -1 ? undefined : deleteEnd);
  assert.match(deleteBody, /req\.tenantModels/);
  assert.doesNotMatch(deleteBody, /(?<![.\w])FyRules\.findOneAndDelete\(/, 'DELETE /:fy must not write to the module-level default FyRules directly');
});

test('rules.js exports getRulesForFY (legacy) and calculateFine (pure) unchanged in name', () => {
  const source = readRoute('rules.js');
  assert.match(source, /module\.exports\.getRulesForFY = getRulesForFY;/);
  assert.match(source, /module\.exports\.calculateFine = calculateFine;/);
});

test('rules.js\'s buildFinesForFY and rulesHotfix.js\'s buildFineCandidates are model-explicit (take a models argument, do not close over a bare Contribution/Fine/Member)', () => {
  for (const [file, fnName] of [['rules.js', 'buildFinesForFY'], ['rulesHotfix.js', 'buildFineCandidates']]) {
    const source = readRoute(file);
    const sig = new RegExp(`async function ${fnName}\\(models, fy, rules\\)`);
    assert.match(source, sig, `${file}'s ${fnName} must take an explicit (models, fy, rules) signature`);
  }
});

test('contributions.js\'s and contributionsHotfix.js\'s computeBulkAllocation are model-explicit', () => {
  for (const file of ['contributions.js', 'contributionsHotfix.js']) {
    const source = readRoute(file);
    assert.match(source, /async function computeBulkAllocation\(models, memberId, totalAmount, paidDate\)/);
  }
});

test('contributionsHotfix.js\'s getExistingFine is model-explicit', () => {
  const source = readRoute('contributionsHotfix.js');
  assert.match(source, /async function getExistingFine\(models, memberId, month, year\)/);
});
