// Static proof (no server, no database) of the Phase 4E tenancy boundary.
//
// The four migrated files - routes/investments.js, routes/summary.js,
// routes/fineCashHotfix.js, routes/reconciliation.js - must reach tenant data
// ONLY through req.tenantModels (or a `models` argument derived from it): no
// default/legacy model registry, no mongoose, no fallback of any kind. These
// checks are textual by design; the behavioural proof lives in the HTTP tests.
//
// Source is scanned with comments removed and string/template-literal
// CONTENTS blanked, so a word in a comment or an error message can neither
// satisfy nor violate a rule.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BACKEND = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(BACKEND, ...parts), 'utf8');

// ─── tiny comment/string-aware scanner ──────────────────────────────────────

function scan(src, { keepStrings }) {
  let i = 0;
  let out = '';

  function copyString(quote) {
    out += quote;
    i += 1;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') { if (keepStrings) out += src[i]; i += 1; }
      if (keepStrings) out += src[i];
      i += 1;
    }
    out += quote;
    i += 1;
  }

  function copyTemplate() {
    out += '`';
    i += 1;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { if (keepStrings) out += src[i]; i += 1; if (keepStrings) out += src[i]; i += 1; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        code('}'); // the interpolated expression IS code
        out += '}';
        continue;
      }
      if (keepStrings) out += src[i];
      i += 1;
    }
    out += '`';
    i += 1;
  }

  function code(until) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      const next = src[i + 1];
      if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
      if (c === '/' && next === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
      if (c === '"' || c === "'") { copyString(c); continue; }
      if (c === '`') { copyTemplate(); continue; }
      if (until === '}') {
        if (c === '{') depth += 1;
        else if (c === '}') { if (depth === 0) { i += 1; return; } depth -= 1; }
      }
      out += c;
      i += 1;
    }
  }

  code();
  return out;
}

const codeOnly = (src) => scan(src, { keepStrings: false });        // comments + string contents removed
const withoutComments = (src) => scan(src, { keepStrings: true });  // comments removed, strings intact

const FILES = ['investments.js', 'summary.js', 'fineCashHotfix.js', 'reconciliation.js'];
const SOURCES = Object.fromEntries(FILES.map((f) => [f, read('routes', f)]));
const CODE = Object.fromEntries(FILES.map((f) => [f, codeOnly(SOURCES[f])]));
const NO_COMMENTS = Object.fromEntries(FILES.map((f) => [f, withoutComments(SOURCES[f])]));

const ALLOWED_REQUIRES = {
  'investments.js': ['../middleware/auth', 'express'],
  'summary.js': ['../middleware/auth', '../services/fyRules', './investments', 'express'],
  'fineCashHotfix.js': ['../middleware/auth', 'express'],
  'reconciliation.js': ['../middleware/auth', 'crypto', 'express'],
};

// Every model / counter helper a route could (wrongly) import and use as a bare global.
const MODEL_IDENTIFIERS = [
  'Member', 'Contribution', 'Loan', 'Repayment', 'Transaction', 'User', 'Fine', 'WelfareEvent', 'FyRules',
  'Expense', 'Investment', 'NavUpdate', 'Notification', 'ReconciliationRun', 'AuditSourceRecord', 'Counter',
  'getNextId', 'FormIntakeSubmission', 'LoanRequestSubmission', 'CommunicationLog', 'AdminNotificationState',
];

function requiresOf(file) {
  return [...NO_COMMENTS[file].matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)].map((m) => m[2]).sort();
}

const countMatches = (source, regex) => (source.match(regex) || []).length;

// ─── per-file boundary rules ────────────────────────────────────────────────

for (const file of FILES) {
  test(`${file}: imports exactly the allowed modules (no default model registry, no mongoose, no default-bound route/service)`, () => {
    assert.deepEqual(requiresOf(file), ALLOWED_REQUIRES[file]);
  });

  test(`${file}: does not import ../db/models or any auxiliary model module`, () => {
    assert.doesNotMatch(NO_COMMENTS[file], /require\(\s*['"][^'"]*db\/(models|loanRequestModels|communicationModels|adminNotificationModels|formIntakeModels|mongoose|tenantSchemas|counter)['"]\s*\)/);
    assert.doesNotMatch(NO_COMMENTS[file], /require\(\s*['"]\.\.?\/(\.\.\/)?routes\/rules['"]\s*\)|require\(\s*['"]\.\/rules['"]\s*\)/, 'must not import the default-bound routes/rules.js');
  });

  test(`${file}: has no direct mongoose usage (no connection, model(), models, or default-connection session)`, () => {
    const code = CODE[file];
    assert.doesNotMatch(code, /\bmongoose\b/);
    assert.doesNotMatch(code, /\.connection\b/);
    assert.doesNotMatch(code, /\.model\s*\(/);
    assert.doesNotMatch(code, /\.models\b/);
    assert.doesNotMatch(code, /\bmongoose\.startSession\b/);
    // The ONE allowed session source is a tenant Model's own connection.
    const withoutTenantSession = code.replace(/models\.ReconciliationRun\.db\.startSession\(\)/g, '');
    assert.doesNotMatch(withoutTenantSession, /startSession/, 'any other startSession is a default-connection session');
  });

  test(`${file}: never uses a model or counter helper as a bare identifier - every one is reached through models / req.tenantModels`, () => {
    const code = CODE[file];
    for (const name of MODEL_IDENTIFIERS) {
      const bare = new RegExp(`(?<![.\\w$])${name}(?![\\w$])(?!\\s*:)`, 'g');
      assert.doesNotMatch(code, bare, `${file} uses ${name} as a bare identifier`);
    }
  });

  test(`${file}: has no fallback from the tenant models to anything else`, () => {
    const code = CODE[file];
    assert.doesNotMatch(code, /\bmodels\s*\?\./, 'optional chaining on models');
    assert.doesNotMatch(code, /\btenantModels\s*(\?\?|\|\||\?)/, 'tenantModels with a default/ternary');
    assert.doesNotMatch(code, /(\?\?|\|\|)\s*(req\.)?tenantModels\b/, 'a fallback TO tenantModels');
    assert.doesNotMatch(code, /(\?\?|\|\|)\s*(require\s*\(|models\b)/, 'a fallback to a require() or another models bundle');
    assert.doesNotMatch(code, /\bmodels\s*(\?\?|\|\|)/, 'models || something');
    assert.doesNotMatch(code, /\bdefaultModels\b|\blegacyModels\b/);
  });

  test(`${file}: reads tenant data from req.tenantModels`, () => {
    assert.match(CODE[file], /req\.tenantModels/);
  });
}

// ─── investments.js ─────────────────────────────────────────────────────────

test('investments.js: valuation helpers are model-explicit and every route passes req.tenantModels', () => {
  const code = CODE['investments.js'];
  assert.match(code, /async function valuateInvestmentsWithModels\(models\)/);
  assert.match(code, /async function latestNav\(models, provider, asset_class, asOf\)/);
  assert.match(code, /module\.exports\.valuateInvestmentsWithModels\s*=\s*valuateInvestmentsWithModels/);
  assert.doesNotMatch(code, /module\.exports\.valuateInvestments\s*=/, 'the legacy no-arg valuateInvestments export must be gone');
  assert.match(code, /valuateInvestmentsWithModels\(req\.tenantModels\)/);
  // all four routes read through the tenant bundle
  assert.ok(countMatches(code, /req\.tenantModels\.(Investment|NavUpdate)/g) >= 3);
  assert.match(NO_COMMENTS['investments.js'], /req\.tenantModels\.getNextId\('nav_update_id'\)/);
  // every latestNav() call passes models first
  for (const call of code.matchAll(/latestNav\(([^)]*)\)/g)) {
    if (/^models,/.test(call[1])) continue;
    assert.match(call[0], /async function|^latestNav\(models,/, `latestNav call without models: ${call[0]}`);
  }
});

// ─── summary.js ─────────────────────────────────────────────────────────────

test('summary.js: computeSummary is model-explicit; investments and FY rules are resolved through the same tenant', () => {
  const code = CODE['summary.js'];
  assert.match(code, /async function computeSummary\(models\)/);
  assert.equal(countMatches(code, /computeSummary\(req\.tenantModels\)/g), 2, 'GET / and GET /snapshot');
  assert.equal(countMatches(code, /computeSummary\(/g), 3, 'one definition + two tenant-explicit calls');
  assert.match(code, /valuateInvestmentsWithModels\(models\)/);
  assert.match(NO_COMMENTS['summary.js'], /const\s*\{\s*valuateInvestmentsWithModels\s*\}\s*=\s*require\(\s*['"]\.\/investments['"]\s*\)/);
  assert.match(code, /getRulesForFYWithModel\(models\.FyRules,\s*fy\)/);
  assert.doesNotMatch(code, /\bgetRulesForFY\s*\(/, 'the default-bound getRulesForFY(fy) wrapper must not be used');
  assert.doesNotMatch(code, /valuateInvestments\s*\(/, 'the legacy no-arg valuateInvestments() must not be used');
  // fines + welfare CRUD
  assert.ok(countMatches(code, /req\.tenantModels\.(Fine|Member|WelfareEvent)/g) >= 6);
  assert.match(NO_COMMENTS['summary.js'], /req\.tenantModels\.getNextId\('fine_id'\)/);
  assert.match(NO_COMMENTS['summary.js'], /req\.tenantModels\.getNextId\('welfare_id'\)/);
});

// ─── fineCashHotfix.js ──────────────────────────────────────────────────────

test('fineCashHotfix.js: syncPaidFineReceipts is model-explicit, exported, and every caller passes tenant models', () => {
  const code = CODE['fineCashHotfix.js'];
  assert.match(code, /async function syncPaidFineReceipts\(models\)/);
  assert.match(code, /module\.exports\.syncPaidFineReceipts\s*=\s*syncPaidFineReceipts/);
  assert.equal(countMatches(code, /syncPaidFineReceipts\(req\.tenantModels\)/g), 2, 'GET / and GET /snapshot');
  assert.equal(countMatches(code, /(?<!function )syncPaidFineReceipts\(models\)/g), 1, 'the post-response callback uses the captured models');
  assert.equal(countMatches(code, /syncPaidFineReceipts\(/g), 4, 'definition + three tenant-explicit calls, nothing else');
  assert.match(NO_COMMENTS['fineCashHotfix.js'], /models\.getNextId\('transaction_id'\)/);
});

test('fineCashHotfix.js: tenant models are captured BEFORE res.on("finish") and the callback never reads req', () => {
  const code = NO_COMMENTS['fineCashHotfix.js'];
  const start = code.indexOf('function syncAfterSuccessfulResponse(req, res, next)');
  assert.ok(start >= 0, 'syncAfterSuccessfulResponse must exist');
  const body = code.slice(start, code.indexOf('\n}\n', start));

  const captureAt = body.search(/const models = req\.tenantModels;/);
  const finishAt = body.indexOf("res.on('finish'");
  assert.ok(captureAt >= 0, 'models must be captured into a local const');
  assert.ok(finishAt >= 0, "res.on('finish') must exist");
  assert.ok(captureAt < finishAt, 'capture must come BEFORE registering the finish callback');

  const callback = body.slice(finishAt, body.indexOf('next();', finishAt));
  assert.match(callback, /syncPaidFineReceipts\(models\)/);
  assert.doesNotMatch(callback, /\breq\b/, 'the post-response callback must not touch req');
});

test('fineCashHotfix.js: the hotfix routes are still defined (precedence over summary.js is proven by behaviour)', () => {
  const code = NO_COMMENTS['fineCashHotfix.js'];
  assert.match(code, /router\.post\('\/fines'/);
  assert.match(code, /router\.patch\('\/fines\/:id'/);
  assert.match(code, /router\.get\('\/snapshot'/);
  assert.match(code, /router\.get\('\/'/);
});

// ─── reconciliation.js ──────────────────────────────────────────────────────

test('reconciliation.js: helpers are model-explicit and the transaction session comes from the tenant connection', () => {
  const code = CODE['reconciliation.js'];
  assert.match(code, /async function syncCounter\(models, Model, counterName, session\)/);
  assert.match(code, /async function nextId\(models, counterName, session\)/);
  assert.match(code, /async function currentSnapshot\(models\)/);
  assert.match(code, /async function preview\(models, source\)/);
  assert.match(code, /preview\(req\.tenantModels, req\.body\)/);
  assert.match(code, /const models = req\.tenantModels;/);
  assert.equal(countMatches(code, /startSession/g), 1);
  assert.equal(countMatches(code, /const session = await models\.ReconciliationRun\.db\.startSession\(\);/g), 1);
  assert.doesNotMatch(NO_COMMENTS['reconciliation.js'], /require\(\s*['"]mongoose['"]\s*\)/, 'reconciliation.js must not import mongoose at all');
});

test('reconciliation.js: every syncCounter / nextId / currentSnapshot / preview call passes the tenant models first', () => {
  const code = CODE['reconciliation.js'];
  for (const name of ['syncCounter', 'nextId', 'currentSnapshot', 'preview']) {
    const calls = [...code.matchAll(new RegExp(`(?<![\\w.$])(?<!function )${name}\\(([^)]*)\\)`, 'g'))];
    assert.ok(calls.length > 0, `${name} must be called`);
    for (const call of calls) {
      assert.match(call[1], /^(models|req\.tenantModels)\b/, `${name}(${call[1]}) must receive the tenant models as its first argument`);
    }
  }
  // all five counters are synced and every one of the five id sequences is allocated through nextId(models, ...)
  const withStrings = NO_COMMENTS['reconciliation.js'];
  assert.equal(countMatches(withStrings, /syncCounter\(models, models\.\w+, '\w+_id', session\)/g), 5);
  for (const counter of ['member_id', 'contribution_id', 'loan_id', 'repayment_id', 'fine_id']) {
    assert.match(withStrings, new RegExp(`nextId\\(models, '${counter}', session\\)`));
  }
});

test('reconciliation.js: every write inside the transaction goes through a tenant model bound with the session', () => {
  const code = CODE['reconciliation.js'];
  // Model-level writes/reads inside the transaction always hang off `models.`
  assert.doesNotMatch(code, /(?<![.\w$])(Member|Contribution|Loan|Repayment|Fine|Investment|AuditSourceRecord|ReconciliationRun|Counter)\.(create|find|findOne|updateOne|findOneAndUpdate|findByIdAndUpdate|bulkWrite|exists)\b/);
  assert.ok(countMatches(code, /models\.(Member|Contribution|Loan|Repayment|Fine|Investment|AuditSourceRecord|Counter)\.[a-zA-Z]+\([^)]*[,{]\s*session\b|\.session\(session\)/g) >= 12);
  assert.match(code, /models\.AuditSourceRecord\.bulkWrite\(auditOperations, \{ session \}\)/);
});

// ─── whole-backend guards ───────────────────────────────────────────────────

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'test' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

test('no non-test backend source references the legacy no-arg valuateInvestments, and every valuateInvestmentsWithModels call receives models', () => {
  for (const file of walk(BACKEND)) {
    const code = codeOnly(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(BACKEND, file);
    assert.doesNotMatch(code, /\bvaluateInvestments\b/, `${rel} references the legacy valuateInvestments`);
    for (const call of code.matchAll(/valuateInvestmentsWithModels\(([^)]*)\)/g)) {
      const args = call[1].trim();
      if (args === 'models)' || args === '') {
        assert.notEqual(args, '', `${rel}: valuateInvestmentsWithModels() called without models`);
      }
    }
  }
  // the only callers outside the definition pass tenant models explicitly
  const callers = walk(BACKEND)
    .map((file) => ({ rel: path.relative(BACKEND, file), code: codeOnly(fs.readFileSync(file, 'utf8')) }))
    .filter(({ code }) => /valuateInvestmentsWithModels\(/.test(code));
  assert.deepEqual(callers.map((c) => c.rel).sort(), [path.join('routes', 'investments.js'), path.join('routes', 'summary.js')]);
});

test('server.js mount order is unchanged: fineCashHotfix is mounted before summary, and the four routes are mounted', () => {
  const server = withoutComments(read('server.js'));
  const hotfixAt = server.indexOf("app.use('/api/summary', require('./routes/fineCashHotfix'))");
  const summaryAt = server.indexOf("app.use('/api/summary', require('./routes/summary'))");
  assert.ok(hotfixAt >= 0 && summaryAt >= 0);
  assert.ok(hotfixAt < summaryAt, 'the hotfix router must be mounted before the base summary router');
  assert.ok(server.includes("app.use('/api/investments', require('./routes/investments'))"));
  assert.ok(server.includes("app.use('/api/reconciliation', require('./routes/reconciliation'))"));
});

test('the single-runtime-tenant restriction is intact: org_checkpoint_investors is the only allowed runtime organization', () => {
  const source = codeOnly(read('tenancy', 'runtimeOrganization.js'));
  assert.match(read('tenancy', 'runtimeOrganization.js'), /const PHASE_3_RUNTIME_ORGANIZATION_ID = 'org_checkpoint_investors';/);
  assert.match(source, /return organizationId === PHASE_3_RUNTIME_ORGANIZATION_ID;/);
  const { isRuntimeOrganizationAllowed } = require('../../tenancy/runtimeOrganization');
  assert.equal(isRuntimeOrganizationAllowed('org_checkpoint_investors'), true);
  assert.equal(isRuntimeOrganizationAllowed('org_beta'), false);
  assert.equal(isRuntimeOrganizationAllowed('org_anything_else'), false);
  assert.equal(isRuntimeOrganizationAllowed(undefined), false);
});

// ─── the scanner itself (so a scanner bug cannot silently weaken the rules) ──

test('scanner: ignores comments and string contents but keeps interpolated code', () => {
  const sample = [
    "const a = require('x'); // require('commented')",
    '/* const Fine = 1; */',
    "const msg = 'Fine total exceeds ' + `Fine ${models.Fine.find()} #${a}`;",
  ].join('\n');
  const code = codeOnly(sample);
  assert.doesNotMatch(code, /commented/);
  assert.doesNotMatch(code, /(?<![.\w$])Fine(?![\w$])/, 'bare Fine only appeared in comment/strings');
  assert.match(code, /models\.Fine\.find\(\)/, 'template interpolation is code and must be kept');
  assert.deepEqual([...withoutComments(sample).matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)].map((m) => m[2]), ['x']);
});
