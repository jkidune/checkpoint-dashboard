const { before, after, test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4eTestApp, stopPhase4eTestApp } = require('./helpers/phase4eTestApp');
const { getJson, postJson, patchJson } = require('./helpers/httpJson');

let app;
let defaultReportModels;
let seededQuarterContribution;
let versionOne;
let versionTwo;

const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);

before(async () => {
  app = await startPhase4eTestApp();
  defaultReportModels = require('../../db/reportModels');

  await Promise.all([
    app.alpha.QuarterlyReport.init(),
    app.alpha.QuarterlyReportVersion.init(),
    app.beta.QuarterlyReport.init(),
    app.beta.QuarterlyReportVersion.init(),
    defaultReportModels.QuarterlyReport.init(),
    defaultReportModels.QuarterlyReportVersion.init(),
  ]);

  seededQuarterContribution = await app.alpha.Contribution.create({
    id: await app.alpha.getNextId('contribution_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 75000,
    month: 6,
    year: app.FY,
    status: 'paid',
    paid_date: `${app.FY}-06-05`,
    notes: 'Quarterly report fixture',
  });
  await app.alpha.Contribution.create({
    id: await app.alpha.getNextId('contribution_id'),
    member_id: app.fx.alpha.members.two.id,
    amount: 33000,
    month: 6,
    year: app.FY,
    status: 'paid',
    paid_date: `${app.FY}-09-15`,
    notes: 'June due paid after the Q2 report cutoff — must stay out of the frozen August snapshot',
  });
  await app.alpha.Contribution.create({
    id: await app.alpha.getNextId('contribution_id'),
    member_id: app.fx.alpha.members.two.id,
    amount: 99000,
    month: 8,
    year: app.FY,
    status: 'unpaid',
    paid_date: `${app.FY}-08-20`,
    notes: 'Unpaid UI-supported row — must never count as a receipt',
  });

  // Simulate a contribution that was partially received before Q2 ended, then
  // topped up through bulk-payment after the cutoff. The production bulk flow
  // stores the cumulative amount/latest paid_date on Contribution and a dated,
  // period-tagged Transaction for the top-up.
  await app.alpha.Contribution.create({
    id: await app.alpha.getNextId('contribution_id'),
    member_id: app.fx.alpha.members.two.id,
    amount: 75000,
    month: 7,
    year: app.FY,
    status: 'paid',
    paid_date: `${app.FY}-09-15`,
    notes: 'Cumulative row after later top-up',
  });
  await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.fx.alpha.members.two.id,
    amount: 25000,
    type: 'contribution',
    description: `Monthly contribution — ${app.fx.alpha.members.two.name} (7/${app.FY}, FY${app.FY}) [bulk]`,
    transaction_date: `${app.FY}-09-15`,
  });

  await app.alpha.Fine.updateOne(
    { id: app.fx.alpha.fines.paidPre.id },
    { $set: { created_at: new Date(`${app.FY}-08-10T08:00:00Z`) } },
  );

  await defaultReportModels.QuarterlyReport.create({
    id: 1,
    report_key: `FY${app.FY}-Q2`,
    report_number: 'DEFAULT-SENTINEL-REPORT',
    fiscal_year: app.FY,
    quarter: 2,
    period_start: `${app.FY}-06-01`,
    period_end: `${app.FY}-08-31`,
    source_cutoff: `${app.FY}-08-31`,
    status: 'draft',
    current_version: 99,
    generated_by: 'default-sentinel',
  });
  await app.beta.QuarterlyReport.create({
    id: 1,
    report_key: `FY${app.FY}-Q2`,
    report_number: 'BETA-SENTINEL-REPORT',
    fiscal_year: app.FY,
    quarter: 2,
    period_start: `${app.FY}-06-01`,
    period_end: `${app.FY}-08-31`,
    source_cutoff: `${app.FY}-08-31`,
    status: 'draft',
    current_version: 77,
    generated_by: 'beta-sentinel',
  });
}, { timeout: 120000 });

after(async () => {
  await stopPhase4eTestApp();
});

test('report routes fail closed for unauthenticated, member and disabled-tenant callers', async () => {
  const unauth = await getJson(app.baseUrl, '/api/reports/quarterly');
  assert.equal(unauth.status, 401);

  const member = await postJson(
    app.baseUrl,
    '/api/reports/quarterly/generate',
    { fiscal_year: app.FY, quarter: 2 },
    app.tokens.member1,
  );
  assert.equal(member.status, 403);

  const beta = await postJson(
    app.baseUrl,
    '/api/reports/quarterly/generate',
    { fiscal_year: app.FY, quarter: 2 },
    app.tokens.betaAdmin,
  );
  assert.equal(beta.status, 403);

  assert.equal(await app.alpha.QuarterlyReport.countDocuments(), 0);
  assert.equal(await defaultReportModels.QuarterlyReport.countDocuments(), 1);
  assert.equal(await app.beta.QuarterlyReport.countDocuments(), 1);
});

test('POST /api/reports/quarterly/generate creates a frozen alpha-only Q2 snapshot', async () => {
  const response = await postJson(
    app.baseUrl,
    '/api/reports/quarterly/generate',
    { fiscal_year: app.FY, quarter: 2 },
    app.tokens.admin,
  );
  assert.equal(response.status, 201);
  const { report, version } = response.body;
  versionOne = response.body;

  assert.equal(report.report_key, `FY${app.FY}-Q2`);
  assert.equal(report.current_version, 1);
  assert.equal(report.status, 'draft');
  assert.match(report.report_number, new RegExp(`^QR-FY${app.FY}-Q2-`));
  assert.equal(version.version_number, 1);
  assert.equal(version.status, 'draft');
  assert.equal(version.pdf_template_version, 'quarterly-v1');
  assert.equal(typeof version.source_snapshot_hash, 'string');
  assert.equal(version.source_snapshot_hash.length, 64);

  const snapshot = version.financial_snapshot;
  assert.equal(snapshot.schema_version, 'checkpoint-quarterly-report-v1');
  assert.equal(snapshot.organization.name, 'Checkpoint Investors Club');
  assert.equal(snapshot.report_basis.period_start, `${app.FY}-06-01`);
  assert.equal(snapshot.report_basis.period_end, `${app.FY}-08-31`);
  assert.equal(snapshot.contributions.quarter_received, 125000, 'Q2 includes the 75k normal receipt plus the 50k partial installment that existed before cutoff');
  assert.equal(snapshot.contributions.monthly.find((row) => row.month === 6).amount, 75000);
  assert.equal(snapshot.contributions.monthly.find((row) => row.month === 7).amount, 50000, 'later 25k top-up must not erase the earlier 50k installment');
  assert.ok(snapshot.contributions.ytd_arrears >= 33000, 'late-post-cutoff receipt must remain outstanding in the Q2 historical position');
  assert.equal(snapshot.loans.repayments_received, 150000, 'June + July alpha repayments only');
  assert.equal(snapshot.fines.paid_quarter, 7000, 'historical paid fine is placed by paid_date when no contribution period exists');

  assert.deepEqual(
    snapshot.investments.holdings.map((holding) => holding.provider),
    ['Alpha Money Market'],
    'September/current-date investments must not leak into an August cut-off report',
  );
  assert.equal(snapshot.investments.current_value, 200000);
  assert.equal(snapshot.cash_position.source, 'calculated', 'the seeded reconciliation is dated after the Q2 report end');
  assert.ok(snapshot.controls.flags.some((item) => item.type === 'reconciliation'));

  const loanNumbers = snapshot.loans.portfolio.map((loan) => loan.loan_number);
  assert.ok(loanNumbers.includes('Loan 1'));
  assert.ok(loanNumbers.includes('Loan 2'));
  assert.ok(loanNumbers.includes('Loan 0'), 'a currently-paid loan remains historically outstanding when no repayment was recorded by the August cut-off');
  assert.ok(!loanNumbers.includes('Loan 3'), 'September loan must not appear in an August cut-off report');

  assert.equal(await app.alpha.QuarterlyReport.countDocuments(), 1);
  assert.equal(await app.alpha.QuarterlyReportVersion.countDocuments(), 1);
  assert.equal(await defaultReportModels.QuarterlyReport.countDocuments(), 1, 'default sentinel only');
  assert.equal(await app.beta.QuarterlyReport.countDocuments(), 1, 'beta sentinel only');
});

test('GET report archive and detail return tenant_alpha report, never default/beta sentinels', async () => {
  const list = await getJson(app.baseUrl, '/api/reports/quarterly', app.tokens.admin);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].report_number, versionOne.report.report_number);
  assert.notEqual(list.body[0].report_number, 'DEFAULT-SENTINEL-REPORT');
  assert.notEqual(list.body[0].report_number, 'BETA-SENTINEL-REPORT');

  const detail = await getJson(app.baseUrl, `/api/reports/quarterly/${versionOne.report.id}`, app.tokens.admin);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.version.version_number, 1);
  assert.equal(detail.body.version.source_snapshot_hash, versionOne.version.source_snapshot_hash);
});

test('narrative is editable without changing the frozen financial snapshot/hash', async () => {
  const beforeSnapshot = JSON.parse(JSON.stringify(versionOne.version.financial_snapshot));
  const response = await patchJson(
    app.baseUrl,
    `/api/reports/quarterly/${versionOne.report.id}/versions/1/narrative`,
    {
      executive_summary: 'Treasurer reviewed this draft.',
      management_notes: 'Narrative only; no financial number changed.',
    },
    app.tokens.admin,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.version.narrative.executive_summary, 'Treasurer reviewed this draft.');
  assert.equal(response.body.version.narrative.management_notes, 'Narrative only; no financial number changed.');
  assert.equal(response.body.version.source_snapshot_hash, versionOne.version.source_snapshot_hash);
  assert.deepEqual(response.body.version.financial_snapshot, beforeSnapshot);

  await app.alpha.QuarterlyReportVersion.updateOne(
    { _id: versionOne.version._id },
    {
      $set: {
        financial_snapshot: { tampered: true },
        source_snapshot_hash: 'tampered-hash',
        version_number: 999,
      },
    },
  );
  const persisted = await app.alpha.QuarterlyReportVersion.findById(versionOne.version._id).lean();
  assert.deepEqual(persisted.financial_snapshot, beforeSnapshot, 'schema immutability must protect the frozen snapshot');
  assert.equal(persisted.source_snapshot_hash, versionOne.version.source_snapshot_hash);
  assert.equal(persisted.version_number, 1);
});

test('regeneration creates version 2 while version 1 remains frozen and addressable', async () => {
  await app.alpha.Contribution.create({
    id: await app.alpha.getNextId('contribution_id'),
    member_id: app.fx.alpha.members.two.id,
    amount: 75000,
    month: 7,
    year: app.FY,
    status: 'paid',
    paid_date: `${app.FY}-07-05`,
    notes: 'Source correction added after version 1',
  });

  const response = await postJson(
    app.baseUrl,
    '/api/reports/quarterly/generate',
    { fiscal_year: app.FY, quarter: 2 },
    app.tokens.admin,
  );
  assert.equal(response.status, 200);
  versionTwo = response.body;
  assert.equal(versionTwo.report.id, versionOne.report.id);
  assert.equal(versionTwo.report.current_version, 2);
  assert.equal(versionTwo.version.version_number, 2);
  assert.equal(versionTwo.version.financial_snapshot.contributions.quarter_received, 200000);
  assert.notEqual(versionTwo.version.source_snapshot_hash, versionOne.version.source_snapshot_hash);

  const old = await getJson(
    app.baseUrl,
    `/api/reports/quarterly/${versionOne.report.id}/versions/1`,
    app.tokens.admin,
  );
  assert.equal(old.status, 200);
  assert.equal(old.body.version.financial_snapshot.contributions.quarter_received, 125000);
  assert.equal(old.body.version.source_snapshot_hash, versionOne.version.source_snapshot_hash);

  const newDetail = await getJson(app.baseUrl, `/api/reports/quarterly/${versionOne.report.id}`, app.tokens.admin);
  assert.equal(newDetail.status, 200);
  assert.equal(newDetail.body.version.version_number, 2);
  assert.equal(newDetail.body.version.financial_snapshot.contributions.quarter_received, 200000);
});

test('old report versions become narrative-immutable after regeneration', async () => {
  const response = await patchJson(
    app.baseUrl,
    `/api/reports/quarterly/${versionOne.report.id}/versions/1/narrative`,
    { executive_summary: 'Should not be accepted' },
    app.tokens.admin,
  );
  assert.equal(response.status, 409);
});

test('invalid and not-yet-ended fiscal quarters are rejected before any report write', async () => {
  const count = await app.alpha.QuarterlyReportVersion.countDocuments();
  const invalid = await postJson(
    app.baseUrl,
    '/api/reports/quarterly/generate',
    { fiscal_year: app.FY, quarter: 5 },
    app.tokens.admin,
  );
  assert.equal(invalid.status, 400);

  const future = await postJson(
    app.baseUrl,
    '/api/reports/quarterly/generate',
    { fiscal_year: 2099, quarter: 1 },
    app.tokens.admin,
  );
  assert.equal(future.status, 400);
  assert.match(future.body.error, /period has ended/i);
  assert.equal(await app.alpha.QuarterlyReportVersion.countDocuments(), count);
});

test('report writes never touch the default or beta report collections', async () => {
  assert.equal(await defaultReportModels.QuarterlyReport.countDocuments(), 1);
  assert.equal((await defaultReportModels.QuarterlyReport.findOne().lean()).current_version, 99);
  assert.equal(await defaultReportModels.QuarterlyReportVersion.countDocuments(), 0);

  assert.equal(await app.beta.QuarterlyReport.countDocuments(), 1);
  assert.equal((await app.beta.QuarterlyReport.findOne().lean()).current_version, 77);
  assert.equal(await app.beta.QuarterlyReportVersion.countDocuments(), 0);

  assert.equal(await app.alpha.QuarterlyReport.countDocuments(), 1);
  assert.equal(await app.alpha.QuarterlyReportVersion.countDocuments(), 2);
  assert.ok(seededQuarterContribution.id > 0);
});


test('report runtime boundary uses authenticated tenant models and never request-selected/default models', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routeSource = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'reports.js'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'quarterlyReportSnapshot.js'), 'utf8');

  assert.doesNotMatch(routeSource, /require\(['"]\.\.\/db\/models['"]\)/);
  assert.doesNotMatch(routeSource, /require\(['"]mongoose['"]\)/);
  assert.doesNotMatch(serviceSource, /require\(['"]\.\.\/db\/models['"]\)/);
  assert.match(routeSource, /req\.tenantModels/);
  assert.doesNotMatch(routeSource, /req\.(body|query|headers)[^\n]*(organization_id|database_name|tenant_id)/);
});


test('historical snapshot dates fines by assessment creation, not the contribution month', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const lateFine = await app.alpha.Fine.create({
    id: await app.alpha.getNextId('fine_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 12345,
    reason: 'May fine assessed after Q1 ended',
    year: app.FY,
    contribution_month: 5,
    contribution_year: app.FY,
    status: 'unpaid',
    created_at: new Date(`${app.FY}-06-06T08:00:00Z`),
  });

  const snapshot = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY,
    quarter: 1,
    organization_name: 'Checkpoint Investors Club',
  });

  assert.equal(snapshot.fines.assessed_quarter, 0, 'June 6 fine must not exist in a Q1 report ending May 31');
  assert.equal(
    snapshot.fines.outstanding_at_period_end,
    0,
    'fine assessed after the cutoff must not be backdated into period-end outstanding fines',
  );

  await app.alpha.Fine.deleteOne({ _id: lateFine._id });
});

test('reconciled cash bridge ignores unpaid contribution transactions and preserves real installment deltas', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');

  const q1Contribution = await app.alpha.Contribution.create({
    id: await app.alpha.getNextId('contribution_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 40000,
    month: 5,
    year: app.FY,
    status: 'partial',
    paid_date: `${app.FY}-05-20`,
  });
  const unpaid = await app.alpha.Contribution.create({
    id: await app.alpha.getNextId('contribution_id'),
    member_id: app.fx.alpha.members.two.id,
    amount: 50000,
    month: 5,
    year: app.FY,
    status: 'unpaid',
    paid_date: `${app.FY}-05-25`,
  });
  await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 40000,
    type: 'contribution',
    description: 'Q1 real partial receipt',
    transaction_date: `${app.FY}-05-20`,
  });
  const unpaidTx = await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.fx.alpha.members.two.id,
    amount: 50000,
    type: 'contribution',
    description: 'UI unpaid contribution transaction',
    transaction_date: `${app.FY}-05-25`,
  });
  const recon = await app.alpha.ReconciliationRun.create({
    run_key: `quarterly-q1-cash-${app.FY}`,
    source_hash: `quarterly-q1-cash-hash-${app.FY}`,
    schema_version: 'checkpoint-reconciliation-v1',
    source_generated_on: `${app.FY}-05-01T00:00:00Z`,
    reporting_cutoff: { Y3_loans: `${app.FY}-05-01`, contributions: `${app.FY}-05-01` },
    source_summary: { current_mkoba_cash_tzs: 100000 },
    backup: {},
    result: {},
    status: 'applied',
    applied_at: new Date(`${app.FY}-05-01T08:00:00Z`),
  });

  const snapshot = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY,
    quarter: 1,
    organization_name: 'Checkpoint Investors Club',
  });

  assert.equal(snapshot.cash_position.source, 'reconciled_plus_ledger_movements');
  assert.equal(snapshot.cash_position.contributions_received, 40000, 'unpaid transaction must not enter reconciled cash');
  assert.equal(snapshot.cash_position.closing_balance, 140000);

  await Promise.all([
    app.alpha.Contribution.deleteOne({ _id: q1Contribution._id }),
    app.alpha.Contribution.deleteOne({ _id: unpaid._id }),
    app.alpha.Transaction.deleteMany({ _id: { $in: [unpaidTx._id] } }),
    app.alpha.ReconciliationRun.deleteOne({ _id: recon._id }),
  ]);
});

test('loan activated after quarter end is excluded even when issued_date was backdated into the quarter', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const loan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: app.fx.alpha.members.one.id,
    loan_number: 'Late Activated Quarterly Loan',
    principal: 300000,
    interest_rate: 0.1,
    interest_amount: 30000,
    amount_deposited: 270000,
    issued_date: `${app.FY}-05-15`,
    status: 'active',
    fiscal_year: app.FY,
    disbursed: true,
  });
  const disbursement = await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 270000,
    type: 'loan_disbursement',
    description: `Loan disbursed — Alpha One (${loan.loan_number}, FY${app.FY})`,
    transaction_date: `${app.FY}-05-15`,
    created_at: new Date(`${app.FY}-06-10T08:00:00Z`),
  });

  const snapshot = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY,
    quarter: 1,
    organization_name: 'Checkpoint Investors Club',
  });

  assert.ok(!snapshot.loans.portfolio.some((item) => item.loan_number === loan.loan_number));
  assert.equal(
    snapshot.loans.issued_count,
    0,
    'loan activated/recorded after May 31 must not be added retroactively to Q1',
  );

  await Promise.all([
    app.alpha.Loan.deleteOne({ _id: loan._id }),
    app.alpha.Transaction.deleteOne({ _id: disbursement._id }),
  ]);
});
