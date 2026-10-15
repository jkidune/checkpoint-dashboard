// Static proof (no server, no database) of the Phase 4F-A tenancy boundary.
//
// The four migrated files - routes/admin.js, routes/communications.js,
// routes/import.js, routes/mailer.js - must reach tenant data ONLY through
// req.tenantModels (or a `models` argument derived from it): no default/legacy
// model registry, no default CommunicationLog, no mongoose / default
// connection, no fallback of any kind, no request-selected database or model,
// and no use of the default-bound getRulesForFY(fy) wrapper. These checks are
// textual by design; the behavioural proof lives in the HTTP tests.
//
// Source is scanned with comments removed and string/template-literal CONTENTS
// blanked, so a word in a comment or an error message can neither satisfy nor
// violate a rule.
//
// NEGATIVE CONTROLS: every rule below is a pure function of the source text.
// The "negative controls" section feeds deliberately regressed in-memory copies
// of the real sources (a scratch copy - the working tree is never modified)
// through the SAME rule table and requires the expected rules to fire, so a
// rule that silently stopped detecting its regression fails here.

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

const FILES = ['admin.js', 'communications.js', 'import.js', 'mailer.js'];
const SOURCES = Object.fromEntries(FILES.map((f) => [f, read('routes', f)]));

const ALLOWED_REQUIRES = {
  'admin.js': ['../middleware/auth', 'express'],
  'communications.js': ['../middleware/auth', '../services/fyRules', '../utils/memberMailer', 'express'],
  'import.js': ['../middleware/auth', 'csv-parse/sync', 'express', 'multer'],
  'mailer.js': ['../middleware/auth', '../utils/mailer', 'bcryptjs', 'express'],
};

// Handlers that read the database: each captures `const models = req.tenantModels;` exactly once.
const EXPECTED_CAPTURES = { 'admin.js': 3, 'communications.js': 7, 'import.js': 1, 'mailer.js': 3 };

// Every model / counter helper a route could (wrongly) import and use as a bare global.
const MODEL_IDENTIFIERS = [
  'Member', 'Contribution', 'Loan', 'Repayment', 'Transaction', 'User', 'Fine', 'WelfareEvent', 'FyRules',
  'Expense', 'Investment', 'NavUpdate', 'Notification', 'ReconciliationRun', 'AuditSourceRecord', 'Counter',
  'getNextId', 'FormIntakeSubmission', 'LoanRequestSubmission', 'CommunicationLog', 'PasswordResetToken',
  'AdminNotificationState', 'QuarterlyReport', 'QuarterlyReportVersion',
];

const countMatches = (source, regex) => (source.match(regex) || []).length;
const requiresOf = (noComments) => [...noComments.matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)].map((m) => m[2]).sort();

// ─── the rule table ─────────────────────────────────────────────────────────
//
// Each rule: { id, files, check({ file, code, nc }) -> null | 'message' }.
//   code = comments removed AND string contents blanked
//   nc   = comments removed, strings intact

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const RULES = [
  // ── generic: every one of the four files ──
  {
    id: 'imports-allowlist',
    files: FILES,
    check: ({ file, nc }) => (same(requiresOf(nc), ALLOWED_REQUIRES[file]) ? null : `requires [${requiresOf(nc)}], allowed [${ALLOWED_REQUIRES[file]}]`),
  },
  {
    id: 'no-default-registry-import',
    files: FILES,
    check: ({ nc }) => {
      if (/require\(\s*['"][^'"]*db\/(models|loanRequestModels|communicationModels|adminNotificationModels|formIntakeModels|reportModels|mongoose|tenantSchemas|counter)['"]\s*\)/.test(nc)) return 'imports a db/* model module';
      if (/require\(\s*['"]\.\.?\/(\.\.\/)?routes\/rules['"]\s*\)|require\(\s*['"]\.\/rules['"]\s*\)/.test(nc)) return 'imports the default-bound routes/rules.js';
      return null;
    },
  },
  {
    id: 'no-default-communication-log',
    files: FILES,
    check: ({ nc }) => (/communicationModels/.test(nc) ? 'references db/communicationModels (the default CommunicationLog)' : null),
  },
  {
    id: 'no-legacy-getRulesForFY',
    files: FILES,
    check: ({ code }) => (/\bgetRulesForFY\b/.test(code) ? 'uses the default-bound getRulesForFY(fy) wrapper' : null),
  },
  {
    id: 'no-mongoose-or-default-connection',
    files: FILES,
    check: ({ code }) => {
      for (const [re, why] of [
        [/\bmongoose\b/, 'mongoose'], [/\.connection\b/, '.connection'], [/\.model\s*\(/, '.model('], [/\.models\b/, '.models'], [/\bstartSession\b/, 'startSession'],
      ]) if (re.test(code)) return `direct ${why} usage`;
      return null;
    },
  },
  {
    id: 'native-collection-only-via-tenant-member',
    files: FILES,
    check: ({ file, code }) => {
      // admin.js uses the RAW collection of the tenant Member model (models.Member.collection) twice; nothing else may.
      const all = countMatches(code, /\.collection\b/g);
      const tenant = countMatches(code, /\bmodels\.Member\.collection\b/g);
      if (all !== tenant) return `${all - tenant} .collection access(es) not on models.Member`;
      if (tenant !== (file === 'admin.js' ? 2 : 0)) return `${tenant} models.Member.collection use(s)`;
      if (/\.collection\s*\(/.test(code)) return 'connection.collection(...) call';
      if (/\.db\b/.test(code)) return 'uses .db (a raw database handle)';
      return null;
    },
  },
  {
    id: 'no-bare-model-or-counter-identifiers',
    files: FILES,
    check: ({ code }) => {
      for (const name of MODEL_IDENTIFIERS) {
        if (new RegExp(`(?<![.\\w$])${name}(?![\\w$])(?!\\s*:)`).test(code)) return `${name} is used as a bare identifier`;
      }
      return null;
    },
  },
  {
    id: 'no-fallback-from-tenant-models',
    files: FILES,
    check: ({ code }) => {
      for (const [re, why] of [
        [/\bmodels\s*\?\./, 'optional chaining on models'],
        [/\btenantModels\s*(\?\?|\|\||\?)/, 'tenantModels with a default/ternary'],
        [/(\?\?|\|\|)\s*(req\.)?tenantModels\b/, 'a fallback TO tenantModels'],
        [/(\?\?|\|\|)\s*(require\s*\(|models\b)/, 'a fallback to a require() or another models bundle'],
        [/\bmodels\s*(\?\?|\|\|)/, 'models || something'],
        [/\bdefaultModels\b|\blegacyModels\b/, 'a default/legacy models bundle'],
      ]) if (re.test(code)) return why;
      return null;
    },
  },
  {
    id: 'tenant-models-captured-exactly-once-per-db-handler',
    files: FILES,
    check: ({ file, code }) => {
      const expected = EXPECTED_CAPTURES[file];
      if (countMatches(code, /\bconst models = req\.tenantModels;/g) !== expected) return `expected ${expected} "const models = req.tenantModels;" captures`;
      if (countMatches(code, /\breq\.tenantModels\b/g) !== expected) return 'req.tenantModels is read somewhere other than the capture statement';
      if (countMatches(code, /\b(?:const|let|var)\s+models\b/g) !== expected) return 'models is declared more than once per handler / not as const';
      if (countMatches(code, /(?<![.\w$])models\s*=(?!=)/g) !== expected) return 'models is reassigned';
      return null;
    },
  },
  {
    id: 'no-request-selected-database-or-model',
    files: FILES,
    check: ({ code, nc }) => {
      for (const [re, why] of [
        [/\borganization_id\b/, 'organization_id'], [/\bdatabase_name\b/, 'database_name'], [/\btenant_?id\b/i, 'tenant id'],
        [/\breq\.headers\b/, 'req.headers'], [/\breq\.header\s*\(/, 'req.header('],
        [/\buseDb\b/, 'useDb'], [/\bgetTenant(Connection|Models)\b/, 'getTenantConnection/getTenantModels'],
        [/\bresolve(Approved)?RuntimeTenant\b/, 'resolveRuntimeTenant'], [/\bgetOrganization\w*/, 'getOrganization*'],
        [/\bmodels\s*\[/, 'dynamic models[...] selection'], [/\btenantModels\s*\[/, 'dynamic tenantModels[...] selection'],
        [/\[\s*req\./, 'a property keyed by a request value'],
      ]) if (re.test(code)) return `request-derived selection: ${why}`;
      // req.get() may only ever read the host (used to build the portal URL).
      for (const m of nc.matchAll(/\breq\.get\s*\(\s*([^)]*)\)/g)) {
        if (!/^['"]host['"]$/.test(m[1].trim())) return `req.get(${m[1]}) reads a request header`;
      }
      return null;
    },
  },

  // ── admin.js ──
  {
    id: 'admin-counters-and-members-come-from-tenant-models',
    files: ['admin.js'],
    check: ({ code, nc }) => {
      for (const [model, counter] of [
        ['Member', 'member_id'], ['Contribution', 'contribution_id'], ['Loan', 'loan_id'], ['Repayment', 'repayment_id'],
        ['Transaction', 'transaction_id'], ['User', 'user_id'], ['Fine', 'fine_id'], ['WelfareEvent', 'welfare_id'],
      ]) {
        if (!new RegExp(`\\{\\s*model:\\s*models\\.${model},\\s*counter:\\s*'${counter}'\\s*\\}`).test(nc)) return `sync target ${model}/${counter} must use models.${model}`;
      }
      if (countMatches(code, /\bmodels\.Counter\.findByIdAndUpdate\(/g) !== 1) return 'the counter write must go through models.Counter';
      if (countMatches(code, /\bmodels\.Member\.collection\.find\(/g) !== 1) return 'migrate-member-office must read models.Member.collection';
      if (countMatches(code, /\bmodels\.Member\.collection\.bulkWrite\(/g) !== 1) return 'migrate-member-office must write models.Member.collection';
      if (!/models\.Member\.find\(\)\.lean\(\)/.test(code) || !/models\.User\.find\(\)\.select\(/.test(code)) return 'roster-audit must read models.Member / models.User';
      return null;
    },
  },

  // ── communications.js ──
  {
    id: 'communications-helpers-are-model-explicit',
    files: ['communications.js'],
    check: ({ code, nc }) => {
      if (!/async function contributionRecipients\(models, month, year\)/.test(code)) return 'contributionRecipients must take (models, month, year)';
      if (!/async function logCommunication\(models, \{/.test(code)) return 'logCommunication must take (models, {...})';
      for (const [name, expected] of [['contributionRecipients', 2], ['logCommunication', 10]]) {
        // Only the head of each call (its first argument) is inspected: logCommunication's second argument is an
        // object literal that may contain parentheses of its own.
        const heads = [...code.matchAll(new RegExp(`(?<![\\w.$])(?<!function )${name}\\(\\s*([\\w.]*)`, 'g'))].map((m) => m[1]);
        if (heads.length !== expected) return `${name} is called ${heads.length} time(s), expected ${expected}`;
        if (!heads.every((h) => h === 'models')) return `a ${name}(...) call does not pass models first`;
      }
      if (countMatches(nc, /getRulesForFYWithModel\(models\.FyRules,\s*fy\)/g) !== 2) return 'both FY-rule lookups must be getRulesForFYWithModel(models.FyRules, fy)';
      if (countMatches(nc, /models\.getNextId\('notification_id'\)/g) !== 3) return 'all three notification ids must come from models.getNextId';
      if (!/models\.CommunicationLog\.create\(/.test(code) || !/models\.CommunicationLog\.find\(\)/.test(code)) return 'CommunicationLog reads/writes must use models.CommunicationLog';
      return null;
    },
  },
  {
    id: 'communications-duplicate-protection-reads-tenant-log',
    files: ['communications.js'],
    check: ({ nc }) => (
      /const alreadySent = await models\.CommunicationLog\.findOne\(\{ member_id: member\.id, type: 'contribution_reminder', period_key: periodKey, status: \{ \$in: \['sent', 'mocked'\] \} \}\)\.lean\(\);/.test(nc)
        ? null : 'the duplicate-reminder lookup must be models.CommunicationLog.findOne({... period_key, status in sent/mocked})'
    ),
  },

  // ── import.js ──
  {
    id: 'import-ids-come-from-tenant-counters',
    files: ['import.js'],
    check: ({ code, nc }) => {
      if (countMatches(code, /\.insertMany\(/g) !== 5) return 'expected exactly five insertMany calls';
      // Ids are reserved in BULK: no per-row getNextId (one counter round trip per record) anywhere in the route.
      if (/\bgetNextId\b/.test(code)) return 'getNextId (one counter round trip per row) is used; ids must be reserved in bulk with reserveIdRange';
      if (countMatches(code, /\breserveIdRange\(/g) !== 6) return 'expected the reserveIdRange definition and exactly five calls';
      // Each insertMany is preceded by ONE reservation sized to the batch (<array>.length) from the matching literal
      // counter, followed by a local, in-order assignment of the returned range.
      const reservations = [...nc.matchAll(/const (\w+) = await reserveIdRange\(models, '(\w+)', (\w+)\.length\);\s*\3\.forEach\(\((\w+), index\) => \{ \4\.id = \1\[index\]; \}\);\s*await models\.(\w+)\.insertMany\(\3\);/g)]
        .map((m) => [m[3], m[2], m[5]]);
      const expected = [
        ['inserts', 'member_id', 'Member'],
        ['inserts', 'contribution_id', 'Contribution'],
        ['txInserts', 'transaction_id', 'Transaction'],
        ['inserts', 'loan_id', 'Loan'],
        ['txInserts', 'transaction_id', 'Transaction'],
      ];
      return same(reservations, expected) ? null : `every insertMany must be preceded by ONE bulk reservation from the matching tenant counter, assigned in order; found ${JSON.stringify(reservations)}`;
    },
  },
  {
    id: 'import-reserveIdRange-is-one-tenant-increment',
    files: ['import.js'],
    check: ({ code, nc }) => {
      const signature = 'async function reserveIdRange(models, counterName, count) {';
      const start = code.indexOf(signature);
      if (start < 0) return 'reserveIdRange(models, counterName, count) must exist and take the tenant bundle as its first argument';
      const body = code.slice(start, code.indexOf('\n}\n', start));
      const ncStart = nc.indexOf(signature);
      const bodyNc = nc.slice(ncStart, nc.indexOf('\n}\n', ncStart));
      if (!/const IMPORT_COUNTERS = new Set\(\['member_id', 'contribution_id', 'loan_id', 'transaction_id'\]\);/.test(nc)) return 'the counters an import may draw from must be the fixed allow-list';
      if (!/IMPORT_COUNTERS\.has\(counterName\)/.test(body)) return 'the counter name must be checked against the allow-list';
      if (!/Number\.isSafeInteger\(count\)/.test(body)) return 'count must be validated as a non-negative integer';
      const zeroGuardAt = body.indexOf('count === 0');
      const writeAt = body.indexOf('models.Counter.findByIdAndUpdate(');
      if (zeroGuardAt < 0 || writeAt < 0 || zeroGuardAt > writeAt) return 'count === 0 must return (empty range, no counter write) before any counter write';
      if (countMatches(body, /\bmodels\.Counter\b/g) !== 1) return 'the tenant Counter must be reached exactly once (models.Counter)';
      if (countMatches(bodyNc, /\{ \$inc: \{ seq: count \} \}/g) !== 1) return 'the reservation must be ONE atomic $inc of the whole count';
      if (!/\{ returnDocument: 'after', upsert: true \}/.test(bodyNc)) return 'must keep getNextId\'s returnDocument / upsert (seed) semantics';
      if (/\b(for|while|do)\b|\.map\(\s*async|\.forEach\(/.test(body)) return 'the reservation must not loop over counter writes';
      // The returned block is exactly the ids this increment reserved: (seq after the $inc) - count + 1 .. seq, ascending.
      if (!/const first = counter\.seq - count \+ 1;/.test(body)) return 'the range must start at (the counter after the $inc) - count + 1';
      if (!/return Array\.from\(\{ length: count \}, \(_, index\) => first \+ index\);/.test(body)) return 'the range must be the contiguous ascending block first .. first + count - 1';
      if (/\b(req|require|mongoose|getNextId|defaultModels|legacyModels)\b/.test(body)) return 'the helper may only use the tenant bundle it is given';
      return null;
    },
  },

  // ── mailer.js ──
  {
    id: 'mailer-members-contributions-users-and-ids-come-from-tenant-models',
    files: ['mailer.js'],
    check: ({ code, nc }) => {
      if (countMatches(code, /\bmodels\.Member\.find\(/g) !== 3) return 'three member reads (reminders, statement broadcast, credentials) must use models.Member';
      if (countMatches(code, /\bmodels\.Contribution\.find\(/g) !== 1) return 'the paid-contribution read must use models.Contribution';
      if (countMatches(code, /\bmodels\.User\.(findOne|create|updateOne)\(/g) !== 3) return 'user reads/writes must use models.User';
      if (countMatches(nc, /models\.getNextId\('user_id'\)/g) !== 1) return 'the new account id must come from models.getNextId(\'user_id\')';
      return null;
    },
  },
];

function violations(file, source) {
  const ctx = { file, code: codeOnly(source), nc: withoutComments(source) };
  const out = {};
  for (const rule of RULES) {
    if (!rule.files.includes(file)) continue;
    const message = rule.check(ctx);
    if (message) out[rule.id] = message;
  }
  return out;
}

// ─── the rules, applied to the real sources ─────────────────────────────────

for (const rule of RULES) {
  for (const file of rule.files) {
    test(`${file}: ${rule.id}`, () => {
      const ctx = { file, code: codeOnly(SOURCES[file]), nc: withoutComments(SOURCES[file]) };
      assert.equal(rule.check(ctx), null);
    });
  }
}

for (const file of FILES) {
  test(`${file}: reads tenant data from req.tenantModels`, () => {
    assert.match(codeOnly(SOURCES[file]), /req\.tenantModels/);
  });
}

// ─── the tenant bundle really provides everything the routes read from it ───

test('every models.<name> the four routes use is bound by the tenant model binders (so a missing model cannot be papered over by a default one)', async () => {
  const mongoose = require('mongoose');
  const { bindCoreModels } = require('../../db/models');
  const { bindCommunicationModels } = require('../../db/communicationModels');
  // An unconnected Connection: model registration needs no database. These are the same two binders
  // tenancy/tenantModels.js composes into every tenant's bundle (CommunicationLog is among them).
  const connection = mongoose.createConnection();
  try {
    const bundle = { ...bindCoreModels(connection), ...bindCommunicationModels(connection) };
    const used = new Set();
    for (const file of FILES) for (const m of codeOnly(SOURCES[file]).matchAll(/\bmodels\.(\w+)/g)) used.add(m[1]);
    assert.ok(used.size >= 12, `expected the routes to use many models, found ${[...used]}`);
    for (const name of used) assert.ok(name in bundle, `models.${name} is used by a migrated route but is not part of the tenant bundle`);
    assert.equal(typeof bundle.getNextId, 'function');
    for (const required of ['CommunicationLog', 'Notification', 'FyRules', 'Counter', 'User', 'Member', 'getNextId']) assert.ok(used.has(required), `${required} is expected to be used by the migrated routes`);
  } finally {
    await connection.close();
  }
});

// ─── server.js: mount order and the retired credential endpoint ─────────────

const serverChecks = (source) => {
  const server = withoutComments(source);
  const out = {};
  const at = (needle) => server.indexOf(needle);
  const adminAt = at("app.use('/api/admin', require('./routes/admin'));");
  const importAt = at("app.use('/api/import', require('./routes/import'));");
  const commAt = at("app.use('/api/communications', require('./routes/communications'));");
  const retiredAt = at("app.post('/api/mailer/broadcast-credentials'");
  const mailerAt = at("app.use('/api/mailer', require('./routes/mailer'));");
  if ([adminAt, importAt, commAt, retiredAt, mailerAt].some((i) => i < 0)) out.mounts = 'one of the four mounts / the retired handler is missing';
  else if (!(adminAt < importAt && importAt < commAt)) out.order = 'admin, import and communications must stay mounted in this order';
  else if (!(retiredAt < mailerAt)) out.retiredPrecedence = 'the retired /broadcast-credentials handler must be registered BEFORE the mailer router';
  if (retiredAt >= 0) {
    const block = server.slice(retiredAt, server.indexOf('});', retiredAt) + 3);
    if (!/res\.status\(410\)\.json\(\{ error: 'Credential broadcast has been retired\. Use member account invitations instead\.' \}\);/.test(block)) out.retiredBody = 'the retired handler must answer 410 with the unchanged message';
    if (/authenticate|requireAdmin/.test(block)) out.retiredAuth = 'the retired handler must stay unauthenticated, exactly as before';
  }
  return out;
};

test('server.js: admin, import, communications and mailer are mounted in the unchanged order and the retired /broadcast-credentials 410 handler still precedes the mailer router', () => {
  assert.deepEqual(serverChecks(read('server.js')), {});
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

test('only server.js requires the four routers; each exports its router (import.js also its model-explicit reserveIdRange helper, which takes the tenant bundle as an argument)', () => {
  const requirers = [];
  for (const file of walk(BACKEND)) {
    const nc = withoutComments(fs.readFileSync(file, 'utf8'));
    const relative = path.relative(BACKEND, file);
    const siblingOfRoutes = relative.startsWith(`routes${path.sep}`) && /require\(\s*['"]\.\/(admin|communications|import|mailer)['"]\s*\)/.test(nc);
    if (siblingOfRoutes || /require\(\s*['"]\.\.?\/(\.\.\/)?routes\/(admin|communications|import|mailer)['"]\s*\)/.test(nc)) {
      requirers.push(path.relative(BACKEND, file));
    }
  }
  assert.deepEqual(requirers, ['server.js']);
  const EXTRA_EXPORTS = { 'import.js': ['reserveIdRange'] };
  for (const file of FILES) {
    const code = codeOnly(SOURCES[file]);
    assert.equal(countMatches(code, /module\.exports\s*=/g), 1, `${file}: a single primary export`);
    assert.match(code, /module\.exports = router;/);
    assert.deepEqual([...code.matchAll(/module\.exports\.(\w+)\s*=/g)].map((m) => m[1]), EXTRA_EXPORTS[file] || [], `${file}: no helper besides the documented ones may be exported`);
  }
});

test('the legacy getRulesForFY wrapper stays for its remaining (out-of-scope) callers, and none of the four migrated files calls it', () => {
  // communications.js was the last Phase 4F-A caller; the wrapper itself must stay for the unmigrated Phase 4F-B /
  // Form Intake / cron callers.
  assert.match(codeOnly(read('routes', 'rules.js')), /module\.exports\.getRulesForFY = getRulesForFY;/);
  const callers = walk(BACKEND)
    .filter((file) => /\bgetRulesForFY\b/.test(codeOnly(fs.readFileSync(file, 'utf8'))))
    .map((file) => path.relative(BACKEND, file));
  for (const file of FILES) assert.ok(!callers.includes(path.join('routes', file)), `routes/${file} must not call getRulesForFY`);
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

// ─── NEGATIVE CONTROLS: deliberate regressions on scratch (in-memory) copies ─
//
// Each control regresses a copy of a real source and requires the named rule(s)
// to fire. The unregressed source must stay clean (asserted first), and a
// mutation whose target text has vanished fails loudly rather than passing
// vacuously.

function replaceFirst(source, from, to) {
  const index = source.indexOf(from);
  assert.ok(index >= 0, `negative control target not found: ${from}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
}
function replaceLast(source, from, to) {
  const index = source.lastIndexOf(from);
  assert.ok(index >= 0, `negative control target not found: ${from}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
}

const CONTROLS = [
  // default registry / models
  ['admin.js', 'a default model import is added', (s) => `const { Member } = require('../db/models');\n${s}`, ['imports-allowlist', 'no-default-registry-import']],
  ['admin.js', 'roster-audit reads a bare (default-bound) Member', (s) => replaceFirst(s, 'models.Member.find().lean()', 'Member.find().lean()'), ['no-bare-model-or-counter-identifiers', 'admin-counters-and-members-come-from-tenant-models']],
  ['admin.js', 'a sync-counters target reads a bare Contribution', (s) => replaceFirst(s, 'model: models.Contribution,', 'model: Contribution,'), ['no-bare-model-or-counter-identifiers', 'admin-counters-and-members-come-from-tenant-models']],
  ['admin.js', 'sync-counters writes the counter through a bare Counter', (s) => replaceFirst(s, 'await models.Counter.findByIdAndUpdate(', 'await Counter.findByIdAndUpdate('), ['no-bare-model-or-counter-identifiers', 'admin-counters-and-members-come-from-tenant-models']],
  ['admin.js', 'the raw collection is reached through a raw db handle', (s) => replaceFirst(s, 'models.Member.collection.find(', "models.Member.db.collection('members').find("), ['native-collection-only-via-tenant-member', 'admin-counters-and-members-come-from-tenant-models']],
  ['admin.js', 'a handler falls back to the default registry', (s) => replaceFirst(s, 'const models = req.tenantModels;', "const models = req.tenantModels || require('../db/models');"), ['no-fallback-from-tenant-models', 'imports-allowlist', 'tenant-models-captured-exactly-once-per-db-handler']],
  ['admin.js', 'a handler stops capturing the tenant models', (s) => replaceLast(s, 'const models = req.tenantModels;', 'const models = null;'), ['tenant-models-captured-exactly-once-per-db-handler']],
  // mongoose / connection
  ['mailer.js', 'mongoose is imported', (s) => replaceFirst(s, 'const bcrypt = require(\'bcryptjs\');', "const bcrypt = require('bcryptjs');\nconst mongoose = require('mongoose');"), ['imports-allowlist']],
  ['mailer.js', 'a model is fetched from the default mongoose registry', (s) => replaceFirst(s, 'await models.User.create(', "await mongoose.model('User').create("), ['no-mongoose-or-default-connection', 'mailer-members-contributions-users-and-ids-come-from-tenant-models']],
  ['mailer.js', 'the default connection is used', (s) => replaceFirst(s, 'await models.Member.find({ status: \'active\' });\n\n    // Members who', 'await require(\'mongoose\').connection.collection(\'members\').find({ status: \'active\' }).toArray();\n\n    // Members who'), ['no-mongoose-or-default-connection', 'imports-allowlist']],
  ['mailer.js', 'the new account id comes from a bare getNextId', (s) => replaceFirst(s, 'await models.getNextId(\'user_id\')', 'await getNextId(\'user_id\')'), ['no-bare-model-or-counter-identifiers', 'mailer-members-contributions-users-and-ids-come-from-tenant-models']],
  ['mailer.js', 'optional chaining hides a missing tenant bundle', (s) => replaceFirst(s, 'await models.Member.find({ status: \'active\', email', 'await models?.Member.find({ status: \'active\', email'), ['no-fallback-from-tenant-models', 'mailer-members-contributions-users-and-ids-come-from-tenant-models']],
  // communications: default CommunicationLog, legacy rules, closure helpers
  ['communications.js', 'the default CommunicationLog is imported', (s) => `const { CommunicationLog } = require('../db/communicationModels');\n${s}`, ['imports-allowlist', 'no-default-registry-import', 'no-default-communication-log']],
  ['communications.js', 'the duplicate-reminder lookup reads a bare (default) CommunicationLog', (s) => replaceFirst(s, 'await models.CommunicationLog.findOne(', 'await CommunicationLog.findOne('), ['no-bare-model-or-counter-identifiers', 'communications-duplicate-protection-reads-tenant-log']],
  ['communications.js', 'the legacy default-bound getRulesForFY(fy) wrapper is used again', (s) => replaceFirst(replaceFirst(s, "const { getRulesForFYWithModel } = require('../services/fyRules');", "const { getRulesForFY } = require('./rules');"), 'await getRulesForFYWithModel(models.FyRules, fy);\n  const monthlyTarget', 'await getRulesForFY(fy);\n  const monthlyTarget'), ['no-legacy-getRulesForFY', 'no-default-registry-import', 'imports-allowlist', 'communications-helpers-are-model-explicit']],
  ['communications.js', 'logCommunication reverts to a closure over a default model', (s) => replaceFirst(replaceFirst(s, 'async function logCommunication(models, {', 'async function logCommunication({'), 'return models.CommunicationLog.create({', 'return CommunicationLog.create({'), ['communications-helpers-are-model-explicit', 'no-bare-model-or-counter-identifiers']],
  ['communications.js', 'one logCommunication call stops passing the models', (s) => replaceFirst(s, 'await logCommunication(models, {', 'await logCommunication({'), ['communications-helpers-are-model-explicit']],
  ['communications.js', 'one contributionRecipients call stops passing the models', (s) => replaceLast(s, 'await contributionRecipients(models, month, year)', 'await contributionRecipients(month, year)'), ['communications-helpers-are-model-explicit']],
  ['communications.js', 'a notification id comes from a bare (default) getNextId', (s) => replaceFirst(s, 'await models.getNextId(\'notification_id\')', 'await getNextId(\'notification_id\')'), ['no-bare-model-or-counter-identifiers', 'communications-helpers-are-model-explicit']],
  // import: ids are reserved in BULK from the tenant's counters (one atomic $inc per counter and range)
  ['import.js', 'the member ids are no longer reserved before insertMany', (s) => replaceFirst(s, "      const memberIds = await reserveIdRange(models, 'member_id', inserts.length);\n      inserts.forEach((insert, index) => { insert.id = memberIds[index]; });\n", ''), ['import-ids-come-from-tenant-counters']],
  ['import.js', 'the loan-disbursement transactions lose their tenant ids', (s) => replaceLast(s, "      const loanTransactionIds = await reserveIdRange(models, 'transaction_id', txInserts.length);\n      txInserts.forEach((txInsert, index) => { txInsert.id = loanTransactionIds[index]; });\n", ''), ['import-ids-come-from-tenant-counters']],
  ['import.js', 'REGRESSION: the member ids go back to one getNextId round trip per row', (s) => replaceFirst(s, "      const memberIds = await reserveIdRange(models, 'member_id', inserts.length);\n      inserts.forEach((insert, index) => { insert.id = memberIds[index]; });\n", "      for (const insert of inserts) insert.id = await models.getNextId('member_id');\n"), ['import-ids-come-from-tenant-counters']],
  ['import.js', 'REGRESSION: ALL five id allocations revert to the pre-fix per-row getNextId loops', (s) => s.replace(/      const (\w+) = await reserveIdRange\(models, '(\w+)', (\w+)\.length\);\n      \3\.forEach\(\((\w+), index\) => \{ \4\.id = \1\[index\]; \}\);\n/g, (m, ids, counter, array, item) => `      for (const ${item} of ${array}) ${item}.id = await models.getNextId('${counter}');\n`), ['import-ids-come-from-tenant-counters']],
  ['import.js', 'a reservation is not sized to the batch (reserves one id for many rows)', (s) => replaceFirst(s, "reserveIdRange(models, 'member_id', inserts.length)", "reserveIdRange(models, 'member_id', 1)"), ['import-ids-come-from-tenant-counters']],
  ['import.js', 'the contribution transactions draw from the wrong counter', (s) => replaceFirst(s, "reserveIdRange(models, 'transaction_id', txInserts.length)", "reserveIdRange(models, 'loan_id', txInserts.length)"), ['import-ids-come-from-tenant-counters']],
  ['import.js', 'the reserved range is assigned out of CSV order (reversed)', (s) => replaceFirst(s, 'insert.id = memberIds[index];', 'insert.id = memberIds[inserts.length - 1 - index];'), ['import-ids-come-from-tenant-counters']],
  ['import.js', 'the counter name is derived from the request', (s) => replaceFirst(s, "reserveIdRange(models, 'member_id', inserts.length)", "reserveIdRange(models, req.params.type + '_id', inserts.length)"), ['import-ids-come-from-tenant-counters']],
  ['import.js', 'loans are inserted through a bare Loan model', (s) => replaceFirst(s, 'await models.Loan.insertMany(inserts);', 'await Loan.insertMany(inserts);'), ['no-bare-model-or-counter-identifiers', 'import-ids-come-from-tenant-counters']],
  ['import.js', 'REGRESSION: the helper does one counter update per id (a loop of $inc by 1)', (s) => replaceFirst(s, "  const counter = await models.Counter.findByIdAndUpdate(\n    counterName,\n    { $inc: { seq: count } },\n    { returnDocument: 'after', upsert: true }\n  );\n  const first = counter.seq - count + 1;\n  return Array.from({ length: count }, (_, index) => first + index);\n", "  const ids = [];\n  for (let index = 0; index < count; index += 1) {\n    const counter = await models.Counter.findByIdAndUpdate(counterName, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });\n    ids.push(counter.seq);\n  }\n  return ids;\n"), ['import-reserveIdRange-is-one-tenant-increment']],
  ['import.js', 'the reserved range starts one id too low (overlaps the previous block)', (s) => replaceFirst(s, 'const first = counter.seq - count + 1;', 'const first = counter.seq - count;'), ['import-reserveIdRange-is-one-tenant-increment']],
  ['import.js', 'the reserved range starts one id too high (skips an id)', (s) => replaceFirst(s, 'const first = counter.seq - count + 1;', 'const first = counter.seq - count + 2;'), ['import-reserveIdRange-is-one-tenant-increment']],
  ['import.js', 'the reserved range is returned in reverse order', (s) => replaceFirst(s, 'Array.from({ length: count }, (_, index) => first + index)', 'Array.from({ length: count }, (_, index) => first + (count - 1 - index))'), ['import-reserveIdRange-is-one-tenant-increment']],
  ['import.js', 'the helper increments by one instead of by the whole count', (s) => replaceFirst(s, '{ $inc: { seq: count } }', '{ $inc: { seq: 1 } }'), ['import-reserveIdRange-is-one-tenant-increment']],
  ['import.js', 'the helper loses its count === 0 short-circuit', (s) => replaceFirst(s, '  if (count === 0) return [];\n', ''), ['import-reserveIdRange-is-one-tenant-increment']],
  ['import.js', 'the helper stops checking the counter name against the allow-list', (s) => replaceFirst(s, "  if (!IMPORT_COUNTERS.has(counterName)) throw new Error(`reserveIdRange: unsupported counter \"${counterName}\"`);\n", ''), ['import-reserveIdRange-is-one-tenant-increment']],
  ['import.js', 'the helper stops validating count', (s) => replaceFirst(s, "  if (!Number.isSafeInteger(count) || count < 0) throw new Error('reserveIdRange: count must be a non-negative integer');\n", ''), ['import-reserveIdRange-is-one-tenant-increment']],
  ['import.js', 'the allow-list is widened to another counter', (s) => replaceFirst(s, "'loan_id', 'transaction_id']);", "'loan_id', 'transaction_id', 'fine_id']);"), ['import-reserveIdRange-is-one-tenant-increment']],
  ['import.js', 'the helper reaches a default Counter through require', (s) => replaceFirst(s, 'await models.Counter.findByIdAndUpdate(', "await require('../db/models').Counter.findByIdAndUpdate("), ['import-reserveIdRange-is-one-tenant-increment', 'imports-allowlist', 'no-default-registry-import']],
  ['import.js', 'the helper falls back to a default Counter when the bundle has none', (s) => replaceFirst(s, 'await models.Counter.findByIdAndUpdate(', "await (models.Counter || require('../db/models').Counter).findByIdAndUpdate("), ['no-fallback-from-tenant-models', 'import-reserveIdRange-is-one-tenant-increment', 'imports-allowlist']],
  // request-selected database / tenant / model
  ['import.js', 'the database is chosen from a request header', (s) => replaceFirst(s, 'const models = req.tenantModels;', "const models = req.tenantModels;\n    const picked = req.headers['x-tenant-id'];"), ['no-request-selected-database-or-model']],
  ['import.js', 'the organization is chosen from the request body', (s) => replaceFirst(s, 'const models = req.tenantModels;', 'const models = req.tenantModels;\n    const org = req.body.organization_id;'), ['no-request-selected-database-or-model']],
  ['communications.js', 'a model is chosen by a request value', (s) => replaceFirst(s, 'const models = req.tenantModels;', 'const models = req.tenantModels;\n  const Picked = models[req.query.model];'), ['no-request-selected-database-or-model']],
  ['communications.js', 'a tenant connection is opened by name', (s) => replaceFirst(s, 'const models = req.tenantModels;', 'const models = req.tenantModels;\n  const picked = connection.useDb(req.query.database_name);'), ['no-request-selected-database-or-model']],
  ['mailer.js', 'another request header is read', (s) => replaceFirst(s, 'const models = req.tenantModels;', "const models = req.tenantModels;\n    const picked = req.get('x-database-name');"), ['no-request-selected-database-or-model']],
];

for (const [file, description, mutate, expectedRules] of CONTROLS) {
  test(`negative control (${file}): ${description} -> ${expectedRules.join(' + ')} must fire`, () => {
    assert.deepEqual(violations(file, SOURCES[file]), {}, 'the real source must be clean before it is regressed');
    const mutated = mutate(SOURCES[file]);
    assert.notEqual(mutated, SOURCES[file], 'the mutation must change the source');
    const fired = violations(file, mutated);
    for (const rule of expectedRules) assert.ok(rule in fired, `rule "${rule}" did not fire; fired: ${JSON.stringify(Object.keys(fired))}`);
  });
}

test('negative controls (server.js): a moved retired handler, a missing mount, a changed message and an authenticated retired handler are all detected', () => {
  const real = read('server.js');
  assert.deepEqual(serverChecks(real), {});

  // the retired handler moved AFTER the mailer router
  const retiredBlock = real.slice(real.indexOf("app.post('/api/mailer/broadcast-credentials'"), real.indexOf("app.use('/api/mailer', require('./routes/mailer'));"));
  const mailerMount = "app.use('/api/mailer', require('./routes/mailer'));";
  const moved = replaceFirst(replaceFirst(real, retiredBlock, ''), mailerMount, `${mailerMount}\n${retiredBlock}`);
  assert.ok('retiredPrecedence' in serverChecks(moved));

  // a mount removed
  assert.ok('mounts' in serverChecks(replaceFirst(real, "app.use('/api/import', require('./routes/import'));", '')));
  // import mounted before admin
  const reordered = replaceFirst(replaceFirst(real, "app.use('/api/admin', require('./routes/admin'));", ''), "app.use('/api/import', require('./routes/import'));", "app.use('/api/import', require('./routes/import'));\napp.use('/api/admin', require('./routes/admin'));");
  assert.ok('order' in serverChecks(reordered));
  // changed 410 message / added authentication
  assert.ok('retiredBody' in serverChecks(replaceFirst(real, 'Credential broadcast has been retired.', 'Credential broadcast is available.')));
  assert.ok('retiredAuth' in serverChecks(replaceFirst(real, "app.post('/api/mailer/broadcast-credentials', (req, res) => {", "app.post('/api/mailer/broadcast-credentials', authenticate, (req, res) => {")));
});

test('negative controls: every rule is exercised by at least one control (no rule is untested)', () => {
  const covered = new Set(CONTROLS.flatMap(([, , , rules]) => rules));
  for (const rule of RULES) assert.ok(covered.has(rule.id), `no negative control exercises rule "${rule.id}"`);
});
