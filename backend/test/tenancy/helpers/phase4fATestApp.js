// Shared helper for the Phase 4F-A (admin, import, communications, mailer)
// tenant-isolation tests.
//
// Same approach as helpers/phase4eTestApp.js: ONE disposable one-node
// MongoMemoryReplSet holding four logical databases, the real Express app
// (server.js), the real `authenticate` middleware, the real control-plane
// registry and real HTTP. The shared helpers/memoryMongo.js is deliberately
// NOT modified or reused here.
//
//   checkpoint_control_test  - the control plane (organization registry).
//   checkpoint_legacy_unused - the "default/legacy" connection (MONGO_URI
//                              points here). Poisoned with SENTINEL records
//                              for every model the four routes can touch.
//                              Sentinel numeric ids deliberately COLLIDE with
//                              tenant_alpha's ids, each collection also holds
//                              a default-only record with the highest id
//                              (4000+), and counters sit at 5000+, so any
//                              accidental default-bound read or write is
//                              unmistakable.
//   tenant_alpha             - org_checkpoint_investors (the only runtime
//                              tenant). Holds the real, deterministic data.
//   tenant_beta              - org_beta (registered, never runtime-enabled).
//                              Must never be touched. Counters at 7000+.
//
// SAFETY (nothing here can reach production Atlas, send real email or use
// real credentials):
//   * MONGO_URI is set to the replica set's own 127.0.0.1 URI BEFORE
//     server.js is loaded (server.js calls dotenv, which never overrides a
//     variable that is already set) and is asserted local before and after.
//   * Every SMTP-related variable is set (to an empty string) BEFORE any
//     module that reads it loads, so the local, git-ignored backend/.env -
//     which dotenv would otherwise pick up - can never configure a real
//     transport. Both mail utilities must report isConfigured === false.
//   * nodemailer.createTransport is replaced with a function that throws, so
//     even a misconfiguration could not open a real SMTP transport: it would
//     fail loudly while server.js loads.
//   * The mail utilities are wrapped (NOT replaced) with call recorders that
//     delegate to the real, mock-mode implementation. The routes under test
//     still run unchanged; the recorders only let a test see which member the
//     mail boundary was called for and with what figures - the evidence that
//     those figures were read from tenant_alpha - and optionally inject a
//     delivery failure to exercise the routes' catch branches.

const http = require('node:http');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const TEST_JWT_SECRET = 'phase4fa-test-jwt-secret';
const ALPHA_ORG = 'org_checkpoint_investors';
const BETA_ORG = 'org_beta';
const DEFAULT_DB_NAME = 'checkpoint_legacy_unused';
const PORTAL_URL = 'https://portal.phase4fa.test';

// Counters. Default: 5000+, one distinct value each so a counter-name mix-up
// cannot hide. Beta: 7000+.
const DEFAULT_COUNTERS = {
  member_id: 5001,
  contribution_id: 5002,
  loan_id: 5003,
  repayment_id: 5004,
  transaction_id: 5005,
  user_id: 5006,
  fine_id: 5007,
  welfare_id: 5008,
  notification_id: 5009,
  expense_id: 5010,
  nav_update_id: 5011,
};
const BETA_COUNTERS = {
  member_id: 7001,
  contribution_id: 7002,
  loan_id: 7003,
  repayment_id: 7004,
  transaction_id: 7005,
  user_id: 7006,
  fine_id: 7007,
  welfare_id: 7008,
  notification_id: 7009,
  expense_id: 7010,
  nav_update_id: 7011,
};

// Highest numeric id in each default-DB / beta collection (the poison that
// proves sync-counters never read a default/beta collection).
const DEFAULT_MAX_IDS = {
  member_id: 4000, contribution_id: 4001, loan_id: 4002, repayment_id: 4003,
  transaction_id: 4004, user_id: 4005, fine_id: 4006, welfare_id: 4007,
};
const BETA_MAX_IDS = {
  member_id: 6000, contribution_id: 6001, loan_id: 6002, repayment_id: 6003,
  transaction_id: 6004, user_id: 6005, fine_id: 6006, welfare_id: 6007,
};

// Fixed, clock-independent reminder periods used by the communications /
// mailer tests (FY starts in March: June 2026 -> FY2026, Feb 2026 -> FY2025).
const PERIOD = { month: 6, year: 2026, fy: 2026, periodKey: 'contribution:2026-06', dueDate: '2026-07-05', label: 'June 2026' };
const PERIOD_FY2025 = { month: 2, year: 2026, fy: 2025, dueDate: '2026-03-05', label: 'February 2026' };

// Alpha's FY rules. Distinct from services/fyRules.js DEFAULTS (50000 / 75000),
// from the default-DB sentinel rules (1) and from beta's rules (33333).
const ALPHA_RULES = { 2026: 60000, 2025: 45000 };

let replSet;
let server;
let isolatedServers = [];
let mailGuardInstalled = false;
let mailSpy;

function assertLocalDisposableUri(uri) {
  assert.ok(typeof uri === 'string' && uri.startsWith('mongodb://'), `unexpected MONGO_URI scheme: ${String(uri).slice(0, 20)}`);
  const { hostname } = new URL(uri);
  assert.ok(
    hostname === '127.0.0.1' || hostname === 'localhost',
    `refusing to run: MONGO_URI host "${hostname}" is not the local disposable replica set`
  );
  assert.ok(!/mongodb\.net|mongodb\+srv/i.test(uri), 'refusing to run: MONGO_URI looks like Atlas');
}

// ─── mail safety ─────────────────────────────────────────────────────────────

// Must run before ANY module that reads SMTP settings is loaded. Exported so a
// test that loads route modules without booting the database can reuse it.
function forceMockMailEnvironment() {
  process.env.SMTP_USER = '';
  process.env.SMTP_PASS = '';
  process.env.SMTP_FROM = '';
  process.env.SMTP_HOST = '';
  process.env.SMTP_PORT = '';
  process.env.SMTP_SECURE = '';
  process.env.PORTAL_URL = PORTAL_URL;
  process.env.WEB_ORIGIN = '';

  if (!mailGuardInstalled) {
    const nodemailer = require('nodemailer');
    nodemailer.createTransport = function guardedCreateTransport() {
      throw new Error('Phase 4F-A tests must never create a real SMTP transport (mock mode only).');
    };
    mailGuardInstalled = true;
  }
}

// Wraps every send function of the two mail utilities with a recorder that
// delegates to the real implementation (which, with no SMTP configured, only
// logs and returns { mocked: true }). Installed BEFORE server.js loads so the
// route modules destructure the wrapped functions.
function installMailSpies() {
  if (mailSpy) return mailSpy;
  const memberMailer = require('../../../utils/memberMailer');
  const mailer = require('../../../utils/mailer');
  assert.equal(memberMailer.isConfigured, false, 'utils/memberMailer.js must be in mock mode');
  assert.equal(mailer.isConfigured, false, 'utils/mailer.js must be in mock mode');

  const calls = [];
  const pendingFailures = new Map(); // function name -> [Error, ...]

  function wrap(moduleExports, moduleLabel, names) {
    for (const name of names) {
      const real = moduleExports[name];
      assert.equal(typeof real, 'function', `${moduleLabel}.${name} must exist`);
      moduleExports[name] = async function recordedMailCall(...args) {
        const queued = pendingFailures.get(name);
        const failure = queued && queued.length ? queued.shift() : null;
        calls.push({ name, module: moduleLabel, args, injectedFailure: failure ? failure.message : null });
        if (failure) throw failure;
        const info = await real(...args);
        assert.equal(info && info.mocked, true, `${moduleLabel}.${name} must run in mock mode`);
        return info;
      };
    }
  }

  wrap(memberMailer, 'memberMailer', [
    'sendTestEmail', 'sendAccountInvitation', 'sendContributionReminder', 'sendMemberMessage', 'sendMonthlyStatement',
  ]);
  wrap(mailer, 'mailer', ['sendDeadlineReminder', 'sendFinancialReport', 'sendWelcome', 'sendAdminStatusReport']);

  mailSpy = {
    calls,
    callsOf: (name) => calls.filter((c) => c.name === name),
    reset: () => { calls.length = 0; pendingFailures.clear(); },
    failNext: (name, error) => {
      if (!pendingFailures.has(name)) pendingFailures.set(name, []);
      pendingFailures.get(name).push(error instanceof Error ? error : new Error(String(error)));
    },
  };
  return mailSpy;
}

// ─── database snapshots ──────────────────────────────────────────────────────

// Full, deterministic, JSON-normalised dump of EVERY non-empty collection in a
// native Db (counters included). Whole-database on purpose: a route that wrote
// to a collection the model list does not mention would still be caught.
async function snapshotDatabase(nativeDb) {
  const out = {};
  const collections = await nativeDb.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    const docs = await nativeDb.collection(name).find({}).toArray();
    if (docs.length === 0) continue;
    docs.sort((a, b) => String(a._id).localeCompare(String(b._id)));
    out[name] = JSON.parse(JSON.stringify(docs));
  }
  return out;
}

function changedCollections(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names]
    .filter((name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]))
    .sort();
}

// ─── direct handler invocation (no tenant models) ───────────────────────────

function findRouteHandler(router, method, routePath) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method.toLowerCase()]);
  assert.ok(layer, `router has no ${method.toUpperCase()} ${routePath} route`);
  const handlers = layer.route.stack.map((s) => s.handle);
  return handlers[handlers.length - 1]; // the real handler - after authenticate / requireAdmin / multer
}

// Calls a route's real handler exactly as Express would after `authenticate`,
// but WITHOUT req.tenantModels. A handler with any fallback to a default model
// registry would succeed here (the default database is poisoned and connected);
// a correctly migrated one must throw or answer 5xx.
async function callHandlerWithoutTenantModels(router, method, routePath, reqOverrides = {}) {
  const handler = findRouteHandler(router, method, routePath);
  const req = {
    method: method.toUpperCase(),
    params: {},
    query: {},
    body: {},
    headers: {},
    protocol: 'http',
    get: () => 'localhost',
    user: { id: 1, username: 'alpha_admin', role: 'admin', name: 'Alpha Admin', organization_id: ALPHA_ORG },
    ...reqOverrides,
  };
  assert.equal(req.tenantModels, undefined, 'the request must not carry tenant models');
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  try {
    await handler(req, res, () => {});
    return { threw: false, status: res.statusCode, body: res.body };
  } catch (error) {
    return { threw: true, error };
  }
}

// Runs `fn` with console.error captured instead of printed, so the logs of a
// route that is EXPECTED to fail (and that logs loudly when it does) do not
// bury the test report. Returns whatever was logged so a test can also assert
// that the failure really was reported.
async function withCapturedConsoleError(fn) {
  const original = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.map((a) => (a && a.stack) || String(a)).join(' ')); };
  try {
    const result = await fn();
    return { result, logged };
  } finally {
    console.error = original;
  }
}

// The names a migrated route reads from the tenant bundle (`models.<name>`).
const TENANT_BUNDLE_NAMES = new Set([
  'Member', 'Contribution', 'Loan', 'Repayment', 'Transaction', 'User', 'Fine', 'WelfareEvent', 'FyRules',
  'Notification', 'Counter', 'CommunicationLog', 'getNextId',
]);

// Asserts that a handler invoked WITHOUT req.tenantModels failed for the RIGHT reason: it threw (or answered
// 5xx) because reading a member of the tenant bundle (`models.<Name>`) from `undefined` failed - not because a
// partial fallback to some default registry happened to break later on (a fallback to the default models would
// have read `models.Member` fine and failed, if at all, on a different property).
// `logged` is whatever the handler wrote to console.error (several handlers catch, log and answer 500).
function assertFailedBecauseTenantModelsAreMissing(outcome, logged, label) {
  assert.ok(outcome.threw === true || outcome.status >= 500, `${label}: answered ${outcome.status} instead of failing`);
  const texts = [outcome.threw ? String(outcome.error && outcome.error.message) : String(outcome.body && outcome.body.error), ...(logged || [])];
  let readName = null;
  for (const text of texts) {
    const match = /Cannot read properties of undefined \(reading '(\w+)'\)/.exec(text);
    if (match) { readName = match[1]; break; }
  }
  assert.ok(readName && TENANT_BUNDLE_NAMES.has(readName), `${label}: expected a failed read of models.<bundle member> from undefined, got: ${texts.join(' | ').slice(0, 300)}`);
}

// ─── multipart upload (CSV import) ───────────────────────────────────────────

async function uploadCsv(baseUrl, type, csv, { token, fieldName = 'file', filename = 'import.csv', fields = {}, query = '', headers = {} } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (csv !== null) form.append(fieldName, new Blob([csv], { type: 'text/csv' }), filename);
  const res = await fetch(`${baseUrl}/api/import/${type}${query}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: form,
  });
  let body = null;
  try { body = await res.json(); } catch { /* no JSON body */ }
  return { status: res.status, body };
}

// Raw JSON request with arbitrary extra headers (the shared httpJson helper
// has no header parameter).
async function requestWithHeaders(baseUrl, method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* no JSON body */ }
  return { status: res.status, body: parsed };
}

// ─── app bootstrap ───────────────────────────────────────────────────────────

async function startPhase4fATestApp() {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.FORM_SECRET = 'phase4fa-test-form-secret';
  process.env.CRON_SECRET = 'phase4fa-test-cron-secret';
  process.env.CONTROL_DB_NAME = 'checkpoint_control_test';
  forceMockMailEnvironment();

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 60000 }],
  });
  await replSet.waitUntilRunning();

  const mongoUri = replSet.getUri(DEFAULT_DB_NAME);
  assertLocalDisposableUri(mongoUri);
  process.env.MONGO_URI = mongoUri;

  // Both mail utilities load here (still before server.js) and are wrapped.
  const mail = installMailSpies();

  const mongoose = require('mongoose');
  const { createOrganization } = require('../../../tenancy/organizationRegistry');
  const { getTenantModels } = require('../../../tenancy/tenantModels');

  await createOrganization({
    organization_id: ALPHA_ORG,
    name: 'Checkpoint Investors Club',
    slug: 'checkpoint-investors-club',
    database_name: 'tenant_alpha',
    legacy: true,
  });
  await createOrganization({
    organization_id: BETA_ORG,
    name: 'Beta Investment Club',
    slug: 'beta-club',
    database_name: 'tenant_beta',
  });

  const alpha = await getTenantModels({ organization_id: ALPHA_ORG });
  const beta = await getTenantModels({ organization_id: BETA_ORG });
  // Test-only: the default/legacy registry, used here ONLY to poison and to
  // snapshot the default database. (The static boundary test is what forbids
  // the migrated routes from importing it.)
  const defaultModels = { ...require('../../../db/models'), ...require('../../../db/communicationModels') };

  // Build every collection and index up front so no lazily-created index
  // can race a test (or appear mid-test as a "change").
  const isModel = (v) => v && typeof v.init === 'function' && v.modelName;
  for (const bundle of [alpha, beta, defaultModels]) {
    await Promise.all(Object.values(bundle).filter(isModel).map((Model) => Model.init()));
  }

  const nativeDbs = {
    default: mongoose.connection.db,
    alpha: alpha.Member.db.db,
    beta: beta.Member.db.db,
  };
  assert.equal(nativeDbs.default.databaseName, DEFAULT_DB_NAME);
  assert.equal(nativeDbs.alpha.databaseName, 'tenant_alpha');
  assert.equal(nativeDbs.beta.databaseName, 'tenant_beta');

  const fx = { alpha: {}, default: {}, beta: {} };

  // ═══ tenant_alpha: the one real runtime tenant ═══════════════════════════
  const mk = async (Model, counterName, data) => Model.create({ id: await alpha.getNextId(counterName), ...data });

  await alpha.FyRules.create({ fiscal_year: 2026, contribution_amount: ALPHA_RULES[2026] });
  await alpha.FyRules.create({ fiscal_year: 2025, contribution_amount: ALPHA_RULES[2025] });

  const m1 = await mk(alpha.Member, 'member_id', { name: 'Alpha Active One', email: 'one@alpha.test', phone: '+255700000001', office: 'chairperson', status: 'active', join_date: '2024-01-01' });
  const m2 = await mk(alpha.Member, 'member_id', { name: 'Alpha Active Two', email: 'two@alpha.test', status: 'active', join_date: '2024-01-01' });
  const m3 = await mk(alpha.Member, 'member_id', { name: 'Alpha Active Three', email: null, status: 'active', join_date: '2024-01-01' }); // no email
  const m4 = await mk(alpha.Member, 'member_id', { name: 'Alpha Former Four', email: 'four@alpha.test', status: 'former', join_date: '2024-01-01' });
  const m5 = await mk(alpha.Member, 'member_id', { name: 'Alpha Active Five', email: 'five@alpha.test', status: 'active', join_date: '2024-01-01' });
  fx.alpha.members = { one: m1.toObject(), two: m2.toObject(), three: m3.toObject(), former: m4.toObject(), five: m5.toObject() };

  // Users: an admin with no member, and one member account (u1 has NO email, so
  // broadcast-credentials exercises its "patch the missing email" branch).
  const adminUser = await mk(alpha.User, 'user_id', { username: 'alpha_admin', email: null, password_hash: 'ALPHA-NOT-A-REAL-HASH', role: 'admin', name: 'Alpha Admin', member_id: null });
  const u1 = await mk(alpha.User, 'user_id', { username: 'alpha_user_one', email: null, password_hash: 'ALPHA-NOT-A-REAL-HASH', role: 'member', name: m1.name, member_id: m1.id });
  fx.alpha.users = { admin: adminUser.toObject(), one: u1.toObject() };

  // FY2026 period (June 2026): m1 part-paid (20000 of 60000), m5 paid in full,
  // m2 and m3 nothing. FY2025 period (Feb 2026): m1 part-paid (15000 of 45000).
  const contribution = (member, month, year, amount, props = {}) => mk(alpha.Contribution, 'contribution_id', {
    member_id: member.id, amount, month, year, status: 'paid', paid_date: `${year}-${String(month).padStart(2, '0')}-05`, ...props,
  });
  fx.alpha.contributions = {
    juneOne: (await contribution(m1, 6, 2026, 20000)).toObject(),
    juneFive: (await contribution(m5, 6, 2026, 60000)).toObject(),
    febOne: (await contribution(m1, 2, 2026, 15000)).toObject(),
  };

  const loan = (member, n, props) => mk(alpha.Loan, 'loan_id', { member_id: member.id, loan_number: `Alpha Loan ${n}`, disbursed: true, ...props });
  fx.alpha.loans = {
    active: (await loan(m1, 1, { principal: 300000, interest_rate: 0.05, interest_amount: 15000, amount_deposited: 285000, issued_date: '2026-03-01', status: 'active', fiscal_year: 2026 })).toObject(),
    paid: (await loan(m1, 2, { principal: 100000, interest_rate: 0.05, interest_amount: 5000, amount_deposited: 95000, issued_date: '2025-04-01', status: 'paid', fiscal_year: 2025 })).toObject(),
  };
  const repay = (l, amount, date) => mk(alpha.Repayment, 'repayment_id', { loan_id: l.id, amount, repayment_date: date });
  fx.alpha.repayments = {
    activeEarlier: (await repay(fx.alpha.loans.active, 100000, '2026-04-10')).toObject(),
    activeJune: (await repay(fx.alpha.loans.active, 50000, '2026-06-10')).toObject(),
    paidLoan: (await repay(fx.alpha.loans.paid, 100000, '2025-09-10')).toObject(),
  };

  const fine = (member, props) => mk(alpha.Fine, 'fine_id', { member_id: member.id, year: 2026, ...props });
  fx.alpha.fines = {
    oneUnpaid: (await fine(m1, { amount: 3500, reason: 'Alpha unpaid fine', status: 'unpaid' })).toObject(),
    onePaid: (await fine(m1, { amount: 7000, reason: 'Alpha paid fine', status: 'paid', paid_date: '2026-05-10' })).toObject(),
    twoUnpaid: (await fine(m2, { amount: 9100, reason: 'Alpha unpaid fine (other member)', status: 'unpaid' })).toObject(),
  };

  const tx = (props) => mk(alpha.Transaction, 'transaction_id', props);
  fx.alpha.transactions = {
    juneContribution: (await tx({ member_id: m1.id, amount: 20000, type: 'contribution', description: 'Alpha June contribution', transaction_date: '2026-06-05' })).toObject(),
    juneRepayment: (await tx({ member_id: m1.id, amount: 50000, type: 'loan_repayment', description: 'Alpha June repayment', transaction_date: '2026-06-10' })).toObject(),
    aprilRepayment: (await tx({ member_id: m1.id, amount: 100000, type: 'loan_repayment', description: 'Alpha April repayment', transaction_date: '2026-04-10' })).toObject(),
    otherMember: (await tx({ member_id: m2.id, amount: 11111, type: 'contribution', description: 'Alpha other-member transaction', transaction_date: '2026-06-06' })).toObject(),
  };

  fx.alpha.notifications = {
    seededOne: (await mk(alpha.Notification, 'notification_id', { member_id: m1.id, type: 'custom', message: 'Alpha seeded notification', read: false, created_by: 'alpha_admin' })).toObject(),
  };

  // Communication history. Explicit, old created_at values keep the seeded rows
  // below every row a test creates, so /status ordering is deterministic.
  const log = (props) => alpha.CommunicationLog.create(props);
  fx.alpha.logs = {
    invitation: (await log({ member_id: m1.id, recipient_email: 'one@alpha.test', type: 'account_invitation', period_key: 'activation', subject: 'ALPHA seeded invitation log', status: 'sent', created_by: 'alpha_admin', sent_at: new Date('2026-05-01T10:00:00Z'), created_at: new Date('2026-05-01T10:00:00Z') })).toObject(),
    statement: (await log({ member_id: m2.id, recipient_email: 'two@alpha.test', type: 'statement', period_key: 'statement:2026-05', subject: 'ALPHA seeded statement log', status: 'mocked', created_by: 'alpha_admin', sent_at: new Date('2026-05-02T10:00:00Z'), created_at: new Date('2026-05-02T10:00:00Z') })).toObject(),
    maySeededReminder: (await log({ member_id: m1.id, recipient_email: 'one@alpha.test', type: 'contribution_reminder', period_key: 'contribution:2026-05', subject: 'ALPHA seeded May reminder log', status: 'mocked', created_by: 'alpha_admin', sent_at: new Date('2026-05-03T10:00:00Z'), created_at: new Date('2026-05-03T10:00:00Z') })).toObject(),
  };

  // ═══ default/legacy DB: sentinels with COLLIDING numeric ids ═════════════
  const D = defaultModels;
  const sentinelEmail = (n) => `default-sentinel-${n}@sentinel.invalid`;
  await D.Member.create([
    ...[1, 2, 3, 4, 5].map((id) => ({ id, name: `DEFAULT SENTINEL MEMBER ${id}`, email: sentinelEmail(id), status: 'active', office: 'DEFAULT SENTINEL OFFICE', entry_fee: 8888888 })),
    { id: DEFAULT_MAX_IDS.member_id, name: 'DEFAULT SENTINEL MEMBER (default-only, highest id)', email: sentinelEmail(4000), status: 'active' },
  ]);
  // Default users: member_ids 2 and 3 collide with alpha members that have NO alpha user.
  await D.User.create([
    { id: 1, username: 'DEFAULT_SENTINEL_USER_2', email: 'default-user-2@sentinel.invalid', password_hash: 'DEFAULT-SENTINEL-HASH', role: 'admin', name: 'DEFAULT SENTINEL USER', member_id: 2 },
    { id: 2, username: 'DEFAULT_SENTINEL_USER_3', email: 'default-user-3@sentinel.invalid', password_hash: 'DEFAULT-SENTINEL-HASH', role: 'admin', name: 'DEFAULT SENTINEL USER', member_id: 3 },
    { id: DEFAULT_MAX_IDS.user_id, username: 'DEFAULT_SENTINEL_USER_HIGH', password_hash: 'DEFAULT-SENTINEL-HASH', role: 'member', member_id: null },
  ]);
  // Default contributions for the SAME period as alpha's reminders, large enough
  // that a default-bound "paid" calculation would excuse every member.
  await D.Contribution.create([
    ...[1, 2, 3, 5].map((memberId, index) => ({ id: index + 1, member_id: memberId, amount: 9999999, month: PERIOD.month, year: PERIOD.year, status: 'paid', paid_date: '2026-06-05' })),
    { id: DEFAULT_MAX_IDS.contribution_id, member_id: 1, amount: 9999999, month: 1, year: 2020, status: 'paid' },
  ]);
  await D.Loan.create([
    { id: 1, member_id: 1, loan_number: 'DEFAULT SENTINEL LOAN', principal: 99999999, interest_amount: 9999999, amount_deposited: 99999999, issued_date: '2026-03-01', status: 'active', fiscal_year: 2026 },
    { id: DEFAULT_MAX_IDS.loan_id, member_id: 1, loan_number: 'DEFAULT SENTINEL LOAN (highest id)', principal: 1, status: 'paid', fiscal_year: 2026 },
  ]);
  await D.Repayment.create([
    { id: 1, loan_id: 1, amount: 88888888, repayment_date: '2026-06-10' },
    { id: DEFAULT_MAX_IDS.repayment_id, loan_id: 1, amount: 1, repayment_date: '2020-01-10' },
  ]);
  await D.Fine.create([
    { id: 1, member_id: 1, amount: 8888888, reason: 'DEFAULT SENTINEL FINE', year: 2026, status: 'unpaid' },
    { id: DEFAULT_MAX_IDS.fine_id, member_id: 1, amount: 1, reason: 'DEFAULT SENTINEL FINE (highest id)', year: 2026, status: 'paid' },
  ]);
  await D.WelfareEvent.create([
    { id: 1, member_id: 1, event_type: 'sentinel', amount: 6666666, status: 'approved' },
    { id: DEFAULT_MAX_IDS.welfare_id, member_id: 1, event_type: 'sentinel (highest id)', amount: 1, status: 'approved' },
  ]);
  await D.Transaction.create([
    { id: 1, member_id: 1, amount: 9999999, type: 'contribution', description: 'DEFAULT SENTINEL TX', transaction_date: '2026-06-20' },
    { id: DEFAULT_MAX_IDS.transaction_id, member_id: 1, amount: 1, type: 'contribution', description: 'DEFAULT SENTINEL TX (highest id)', transaction_date: '2020-01-01' },
  ]);
  // Default FY rules: contribution_amount 1 for the periods alpha overrides, and
  // for FY2027 where ALPHA HAS NO RECORD (so the correct answer is the
  // services/fyRules.js DEFAULTS fallback - never this sentinel).
  for (const fiscal_year of [2025, 2026, 2027]) {
    await D.FyRules.create({ fiscal_year, contribution_amount: 1 });
  }
  // Default notification carrying EXACTLY the stable message alpha's June
  // reminder would write for member 1 - if the duplicate-notification check
  // read the default DB, alpha's notification would not be created.
  await D.Notification.create([
    { id: 1, member_id: 1, type: 'contribution_due', message: 'Your June 2026 contribution has TZS 40,000 outstanding. Due 2026-07-05.', due_date: PERIOD.dueDate, read: false, created_by: 'DEFAULT SENTINEL' },
    { id: 2, member_id: 2, type: 'contribution_due', message: 'Your June 2026 contribution has TZS 60,000 outstanding. Due 2026-07-05.', due_date: PERIOD.dueDate, read: false, created_by: 'DEFAULT SENTINEL' },
  ]);
  // Default reminder logs for the SAME member ids and the SAME period key as
  // alpha's June reminders - they must not suppress alpha's sends.
  await D.CommunicationLog.create([
    { member_id: 1, recipient_email: sentinelEmail(1), type: 'contribution_reminder', period_key: PERIOD.periodKey, subject: 'DEFAULT SENTINEL reminder log', status: 'sent', created_by: 'DEFAULT SENTINEL', sent_at: new Date('2026-06-20T00:00:00Z') },
    { member_id: 2, recipient_email: sentinelEmail(2), type: 'contribution_reminder', period_key: PERIOD.periodKey, subject: 'DEFAULT SENTINEL reminder log', status: 'mocked', created_by: 'DEFAULT SENTINEL', sent_at: new Date('2026-06-20T00:00:00Z') },
    { member_id: 1, recipient_email: sentinelEmail(1), type: 'admin_test', period_key: 'test:sentinel', subject: 'DEFAULT SENTINEL status log (newest)', status: 'mocked', created_by: 'DEFAULT SENTINEL', sent_at: new Date('2099-01-01T00:00:00Z'), created_at: new Date('2099-01-01T00:00:00Z') },
  ]);
  for (const [name, value] of Object.entries(DEFAULT_COUNTERS)) {
    await D.Counter.findByIdAndUpdate(name, { $set: { seq: value } }, { upsert: true });
  }

  // ═══ tenant_beta: must stay untouched ════════════════════════════════════
  await beta.Member.create([
    { id: 1, name: 'BETA SENTINEL MEMBER 1', email: 'beta-sentinel-1@sentinel.invalid', status: 'active' },
    { id: 2, name: 'BETA SENTINEL MEMBER 2', email: 'beta-sentinel-2@sentinel.invalid', status: 'active' },
    { id: BETA_MAX_IDS.member_id, name: 'BETA SENTINEL MEMBER (highest id)', status: 'active' },
  ]);
  await beta.User.create([
    { id: 1, username: 'BETA_SENTINEL_USER_1', password_hash: 'BETA-SENTINEL-HASH', role: 'admin', member_id: 1 },
    { id: BETA_MAX_IDS.user_id, username: 'BETA_SENTINEL_USER_HIGH', password_hash: 'BETA-SENTINEL-HASH', role: 'member', member_id: null },
  ]);
  await beta.Contribution.create([
    { id: 1, member_id: 1, amount: 424242, month: PERIOD.month, year: PERIOD.year, status: 'paid' },
    { id: BETA_MAX_IDS.contribution_id, member_id: 2, amount: 1, month: 1, year: 2020, status: 'paid' },
  ]);
  await beta.Loan.create([
    { id: 1, member_id: 1, loan_number: 'BETA SENTINEL LOAN', principal: 424242, status: 'active', fiscal_year: 2026 },
    { id: BETA_MAX_IDS.loan_id, member_id: 1, loan_number: 'BETA SENTINEL LOAN (highest id)', principal: 1, status: 'paid', fiscal_year: 2026 },
  ]);
  await beta.Repayment.create([{ id: 1, loan_id: 1, amount: 4242 }, { id: BETA_MAX_IDS.repayment_id, loan_id: 1, amount: 1 }]);
  await beta.Fine.create([
    { id: 1, member_id: 1, amount: 4242, reason: 'BETA SENTINEL FINE', year: 2026, status: 'unpaid' },
    { id: BETA_MAX_IDS.fine_id, member_id: 1, amount: 1, reason: 'BETA SENTINEL FINE (highest id)', year: 2026, status: 'paid' },
  ]);
  await beta.WelfareEvent.create([{ id: 1, member_id: 1, event_type: 'beta', amount: 4242 }, { id: BETA_MAX_IDS.welfare_id, member_id: 1, event_type: 'beta (highest id)', amount: 1 }]);
  await beta.Transaction.create([
    { id: 1, member_id: 1, amount: 4242, type: 'contribution', description: 'BETA SENTINEL TX', transaction_date: '2026-06-20' },
    { id: BETA_MAX_IDS.transaction_id, member_id: 1, amount: 1, type: 'contribution', description: 'BETA SENTINEL TX (highest id)', transaction_date: '2020-01-01' },
  ]);
  await beta.FyRules.create({ fiscal_year: 2026, contribution_amount: 33333 });
  await beta.Notification.create({ id: 1, member_id: 1, type: 'custom', message: 'BETA SENTINEL NOTIFICATION', read: false, created_by: 'beta' });
  await beta.CommunicationLog.create({ member_id: 1, recipient_email: 'beta-sentinel-1@sentinel.invalid', type: 'contribution_reminder', period_key: PERIOD.periodKey, subject: 'BETA SENTINEL reminder log', status: 'sent', created_by: 'beta', sent_at: new Date('2026-06-20T00:00:00Z') });
  for (const [name, value] of Object.entries(BETA_COUNTERS)) {
    await beta.Counter.findByIdAndUpdate(name, { $set: { seq: value } }, { upsert: true });
  }

  // ═══ the real server ═════════════════════════════════════════════════════
  process.env.VERCEL = '1'; // server.js: do not listen / start the deadline cron
  const app = require('../../../server');
  // dotenv (called inside server.js) must NOT have replaced the disposable URI,
  // and the mail environment must still be in mock mode.
  assert.equal(process.env.MONGO_URI, mongoUri, 'MONGO_URI was overridden after loading server.js');
  assertLocalDisposableUri(process.env.MONGO_URI);
  assert.ok(['127.0.0.1', 'localhost'].includes(mongoose.connection.host), `default connection host is "${mongoose.connection.host}"`);
  assert.equal(mongoose.connection.name, DEFAULT_DB_NAME);
  assert.equal(process.env.SMTP_USER, '', 'SMTP_USER was overridden after loading server.js');
  assert.equal(process.env.SMTP_PASS, '', 'SMTP_PASS was overridden after loading server.js');
  assert.equal(require('../../../utils/memberMailer').isConfigured, false);
  assert.equal(require('../../../utils/mailer').isConfigured, false);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  function signToken(overrides = {}) {
    return jwt.sign(
      {
        id: 1, username: 'alpha_admin', role: 'admin', member_id: null, name: 'Alpha Admin',
        organization_id: ALPHA_ORG, ...overrides,
      },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
  }
  // A pre-Phase-3 token: valid signature, NO organization_id claim.
  const orglessPayload = { id: 1, username: 'alpha_admin', role: 'admin', member_id: null, name: 'Alpha Admin' };
  const tokens = {
    admin: signToken(),
    member1: signToken({ id: 11, username: 'alpha_member_one', role: 'member', member_id: m1.id, name: m1.name }),
    // A registered but never-runtime-activated organization.
    betaAdmin: signToken({ username: 'beta_admin', organization_id: BETA_ORG }),
    unknownOrgAdmin: signToken({ username: 'ghost_admin', organization_id: 'org_does_not_exist' }),
    orglessAdmin: jwt.sign(orglessPayload, TEST_JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' }),
  };

  const counter = (models) => async (name) => (await models.Counter.findById(name).lean())?.seq ?? null;

  async function snapshots() {
    return {
      default: await snapshotDatabase(nativeDbs.default),
      alpha: await snapshotDatabase(nativeDbs.alpha),
      beta: await snapshotDatabase(nativeDbs.beta),
    };
  }
  const baseline = snapshots;

  // The default/legacy database and tenant_beta must be deep-equal to `before`.
  async function assertIsolation(before, label = 'isolation') {
    const defaultNow = await snapshotDatabase(nativeDbs.default);
    const betaNow = await snapshotDatabase(nativeDbs.beta);
    const defaultChanged = changedCollections(before.default, defaultNow);
    const betaChanged = changedCollections(before.beta, betaNow);
    assert.deepEqual(defaultChanged, [], `${label}: default/legacy DB collection(s) changed: ${defaultChanged.join(', ')}`);
    assert.deepEqual(betaChanged, [], `${label}: tenant_beta collection(s) changed: ${betaChanged.join(', ')}`);
    assert.deepStrictEqual(defaultNow, before.default, `${label}: default/legacy DB changed`);
    assert.deepStrictEqual(betaNow, before.beta, `${label}: tenant_beta changed`);
  }

  // Names of the tenant_alpha collections whose contents differ from `before`.
  async function changedAlpha(before) {
    return changedCollections(before.alpha, await snapshotDatabase(nativeDbs.alpha));
  }

  // Records every operation Mongoose issues against an `auto_counters` collection - on tenant_alpha, tenant_beta and
  // the default connection - through the connections' own 'operation-start' events. Nothing is patched or mocked:
  // it only observes, so it cannot weaken any isolation or behaviour check. Each entry is
  // { db: 'alpha' | 'beta' | 'default', method, filter, update, options } (JSON-normalised copies), e.g. one
  // `findOneAndUpdate` with update { $inc: { seq: 40 } } for a 40-row import - and 40 entries with { $inc: { seq: 1 } }
  // for 40 sequential getNextId() calls. Call stop() when done.
  function recordCounterOperations() {
    const counterCollection = alpha.Counter.collection.name;
    const connections = { alpha: alpha.Counter.db, beta: beta.Counter.db, default: mongoose.connection };
    const ops = [];
    const attached = Object.entries(connections).map(([db, connection]) => {
      const listener = (event) => {
        if (event.collectionName !== counterCollection) return;
        const [filter, update, options] = JSON.parse(JSON.stringify(event.params || []));
        ops.push({ db, method: event.method, filter, update, options });
      };
      connection.on('operation-start', listener);
      return [connection, listener];
    });
    return {
      ops,
      stop() { for (const [connection, listener] of attached) connection.off('operation-start', listener); },
    };
  }

  const collections = {
    counters: alpha.Counter.collection.name,
    members: alpha.Member.collection.name,
    users: alpha.User.collection.name,
    contributions: alpha.Contribution.collection.name,
    loans: alpha.Loan.collection.name,
    repayments: alpha.Repayment.collection.name,
    transactions: alpha.Transaction.collection.name,
    fines: alpha.Fine.collection.name,
    welfare: alpha.WelfareEvent.collection.name,
    notifications: alpha.Notification.collection.name,
    logs: alpha.CommunicationLog.collection.name,
    fyRules: alpha.FyRules.collection.name,
  };

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    mongoose,
    getTenantModels,
    alpha,
    beta,
    defaultModels,
    fx,
    mail,
    PERIOD,
    PERIOD_FY2025,
    ALPHA_RULES,
    DEFAULT_COUNTERS,
    BETA_COUNTERS,
    DEFAULT_MAX_IDS,
    BETA_MAX_IDS,
    PORTAL_URL,
    collections,
    tokens,
    signToken,
    alphaCounter: counter(alpha),
    defaultCounter: counter(defaultModels),
    betaCounter: counter(beta),
    snapshots,
    baseline,
    assertIsolation,
    changedAlpha,
    recordCounterOperations,
    nativeDbs,
  };
}

// Mounts a REAL router module (real middleware, real tenant resolution) on a
// bare Express app - used only for code that server.js shadows (the retired
// /api/mailer/broadcast-credentials handler) so its tenant behaviour can still
// be proven. Returns the base URL; closed by stopPhase4fATestApp().
async function mountRouterInIsolation(mountPath, router) {
  const express = require('express');
  const isolated = express();
  isolated.use(express.json({ limit: '1mb' }));
  isolated.use(mountPath, router);
  const isolatedServer = http.createServer(isolated);
  await new Promise((resolve) => isolatedServer.listen(0, '127.0.0.1', resolve));
  isolatedServers.push(isolatedServer);
  return `http://127.0.0.1:${isolatedServer.address().port}`;
}

async function stopPhase4fATestApp() {
  for (const s of [server, ...isolatedServers]) {
    if (!s) continue;
    s.closeAllConnections?.();
    await new Promise((resolve) => s.close(resolve));
  }
  server = undefined;
  isolatedServers = [];
  const mongoose = require('mongoose');
  await mongoose.disconnect().catch(() => {});
  if (replSet) {
    await replSet.stop();
    replSet = undefined;
  }
}

module.exports = {
  startPhase4fATestApp,
  stopPhase4fATestApp,
  mountRouterInIsolation,
  forceMockMailEnvironment,
  snapshotDatabase,
  changedCollections,
  callHandlerWithoutTenantModels,
  findRouteHandler,
  withCapturedConsoleError,
  assertFailedBecauseTenantModelsAreMissing,
  uploadCsv,
  requestWithHeaders,
  TEST_JWT_SECRET,
  ALPHA_ORG,
  BETA_ORG,
  PERIOD,
  PERIOD_FY2025,
  ALPHA_RULES,
};
