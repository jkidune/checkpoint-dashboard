const { before, after, test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4eTestApp, stopPhase4eTestApp } = require('./helpers/phase4eTestApp');
const { getJson, postJson, patchJson } = require('./helpers/httpJson');
const { getRulesForFYWithModel } = require('../../services/fyRules');

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
  const realTx = await app.alpha.Transaction.create({
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
  assert.equal(
    snapshot.cash_position.closing_balance,
    snapshot.cash_position.reconciled_balance
      + snapshot.cash_position.total_inflows
      - snapshot.cash_position.total_outflows,
    'closing cash must follow the reconciled cash bridge after excluding the unpaid contribution',
  );

  await Promise.all([
    app.alpha.Contribution.deleteOne({ _id: q1Contribution._id }),
    app.alpha.Contribution.deleteOne({ _id: unpaid._id }),
    app.alpha.Transaction.deleteMany({ _id: { $in: [realTx._id, unpaidTx._id] } }),
    app.alpha.ReconciliationRun.deleteOne({ _id: recon._id }),
  ]);
});

test('loan activated after quarter end is excluded even when issued_date was backdated into the quarter', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const baseline = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY,
    quarter: 1,
    organization_name: 'Checkpoint Investors Club',
  });

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
    baseline.loans.issued_count,
    'loan activated/recorded after May 31 must not change Q1 issued-loan count',
  );

  await Promise.all([
    app.alpha.Loan.deleteOne({ _id: loan._id }),
    app.alpha.Transaction.deleteOne({ _id: disbursement._id }),
  ]);
});


test('loan disbursement matching includes fiscal year so repeated loan numbers cannot collide', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');

  const oldLoan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: app.fx.alpha.members.one.id,
    loan_number: 'Loan Repeat',
    principal: 111000,
    interest_rate: 0.1,
    interest_amount: 11100,
    amount_deposited: 99900,
    issued_date: `${app.FY - 1}-04-01`,
    status: 'active',
    fiscal_year: app.FY - 1,
    disbursed: true,
  });
  const oldTx = await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 99900,
    type: 'loan_disbursement',
    description: `Loan disbursed — Alpha Active One (Loan Repeat, FY${app.FY - 1})`,
    transaction_date: `${app.FY - 1}-04-01`,
    created_at: new Date(`${app.FY - 1}-04-01T08:00:00Z`),
  });

  const newLoan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: app.fx.alpha.members.one.id,
    loan_number: 'Loan Repeat',
    principal: 222000,
    interest_rate: 0.1,
    interest_amount: 22200,
    amount_deposited: 199800,
    issued_date: `${app.FY}-05-20`,
    status: 'active',
    fiscal_year: app.FY,
    disbursed: true,
  });
  const newTx = await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 199800,
    type: 'loan_disbursement',
    description: `Loan disbursed — Alpha Active One (Loan Repeat, FY${app.FY})`,
    transaction_date: `${app.FY}-05-20`,
    created_at: new Date(`${app.FY}-06-10T08:00:00Z`),
  });

  const q1 = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY,
    quarter: 1,
    organization_name: 'Checkpoint Investors Club',
  });

  assert.ok(
    !q1.loans.portfolio.some((item) => item.loan_id === newLoan.id),
    'current-FY Loan Repeat must not inherit the prior-FY Loan Repeat disbursement date',
  );

  await Promise.all([
    app.alpha.Loan.deleteMany({ _id: { $in: [oldLoan._id, newLoan._id] } }),
    app.alpha.Transaction.deleteMany({ _id: { $in: [oldTx._id, newTx._id] } }),
  ]);
});

test('loan cancellation writes cancelled_at and historical reports retain the loan before that timestamp', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');

  const loan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: app.fx.alpha.members.two.id,
    loan_number: 'Cancellation Timestamp Loan',
    principal: 123000,
    interest_rate: 0.1,
    interest_amount: 12300,
    amount_deposited: 110700,
    issued_date: `${app.FY}-07-01`,
    status: 'active',
    fiscal_year: app.FY,
    disbursed: true,
  });
  const tx = await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.fx.alpha.members.two.id,
    amount: 110700,
    type: 'loan_disbursement',
    description: `Loan disbursed — Alpha Active Two (${loan.loan_number}, FY${app.FY})`,
    transaction_date: `${app.FY}-07-01`,
    created_at: new Date(`${app.FY}-07-01T08:00:00Z`),
  });

  const cancelled = await patchJson(
    app.baseUrl,
    `/api/loans/${loan.id}`,
    { status: 'cancelled' },
    app.tokens.admin,
  );
  assert.equal(cancelled.status, 200);

  const persisted = await app.alpha.Loan.findOne({ id: loan.id }).lean();
  assert.ok(persisted.cancelled_at, 'cancellation must persist an effective timestamp');

  const q2 = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY,
    quarter: 2,
    organization_name: 'Checkpoint Investors Club',
  });
  assert.ok(
    q2.loans.portfolio.some((item) => item.loan_id === loan.id),
    'loan cancelled after Q2 cutoff must remain visible in the historical Q2 snapshot',
  );

  await Promise.all([
    app.alpha.Loan.deleteOne({ _id: loan._id }),
    app.alpha.Transaction.deleteOne({ _id: tx._id }),
  ]);
});

test('post-reconciliation member entry fee is included in reconciled cash inflows', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');

  const member = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Post Recon Member',
    status: 'active',
    office: 'member',
    entry_fee: 500000,
    join_date: `${app.FY}-05-10`,
  });
  const recon = await app.alpha.ReconciliationRun.create({
    run_key: `quarterly-entry-fee-${app.FY}`,
    source_hash: `quarterly-entry-fee-hash-${app.FY}`,
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

  assert.equal(snapshot.cash_position.entry_fees_received, 500000);
  assert.equal(
    snapshot.cash_position.closing_balance,
    snapshot.cash_position.reconciled_balance
      + snapshot.cash_position.total_inflows
      - snapshot.cash_position.total_outflows,
  );

  await Promise.all([
    app.alpha.Member.deleteOne({ _id: member._id }),
    app.alpha.ReconciliationRun.deleteOne({ _id: recon._id }),
  ]);
});


test('legacy loan without loan number/FY falls back to issued_date instead of matching arbitrary member disbursement', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');

  const legacyLoan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: app.fx.alpha.members.one.id,
    loan_number: null,
    principal: 88000,
    interest_rate: 0,
    interest_amount: 0,
    amount_deposited: 88000,
    issued_date: `${app.FY}-09-05`,
    status: 'active',
    fiscal_year: null,
    disbursed: true,
  });

  const q2 = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY,
    quarter: 2,
    organization_name: 'Checkpoint Investors Club',
  });

  assert.ok(
    !q2.loans.portfolio.some((item) => item.loan_id === legacyLoan.id),
    'legacy September loan must not inherit an older member disbursement and leak into Q2',
  );

  await app.alpha.Loan.deleteOne({ _id: legacyLoan._id });
});

test('cancelled loans are terminal and cannot be reactivated with a stale cancellation timestamp', async () => {
  const loan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: app.fx.alpha.members.one.id,
    loan_number: 'Terminal Cancellation Loan',
    principal: 50000,
    interest_rate: 0,
    interest_amount: 0,
    amount_deposited: 50000,
    issued_date: `${app.FY}-07-01`,
    status: 'active',
    fiscal_year: app.FY,
    disbursed: true,
  });

  const cancelled = await patchJson(
    app.baseUrl,
    `/api/loans/${loan.id}`,
    { status: 'cancelled' },
    app.tokens.admin,
  );
  assert.equal(cancelled.status, 200);

  const reactivate = await patchJson(
    app.baseUrl,
    `/api/loans/${loan.id}`,
    { status: 'active' },
    app.tokens.admin,
  );
  assert.equal(reactivate.status, 409);
  assert.match(reactivate.body.error, /terminal/i);

  const persisted = await app.alpha.Loan.findOne({ id: loan.id }).lean();
  assert.equal(persisted.status, 'cancelled');
  assert.ok(persisted.cancelled_at);

  await app.alpha.Loan.deleteOne({ _id: loan._id });
});

test('same-day post-reconciliation contribution, entry fee and loan disbursement preserve timestamp ordering', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const reconDate = `${app.FY}-05-15`;
  const appliedAt = new Date(`${app.FY}-05-15T10:00:00Z`);

  const recon = await app.alpha.ReconciliationRun.create({
    run_key: `quarterly-same-day-order-${app.FY}`,
    source_hash: `quarterly-same-day-order-hash-${app.FY}`,
    schema_version: 'checkpoint-reconciliation-v1',
    source_generated_on: `${app.FY}-05-15T09:00:00Z`,
    reporting_cutoff: { Y3_loans: reconDate, contributions: reconDate },
    source_summary: { current_mkoba_cash_tzs: 250000 },
    backup: {},
    result: {},
    status: 'applied',
    applied_at: appliedAt,
    created_at: appliedAt,
  });

  const baseline = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY,
    quarter: 1,
    organization_name: 'Checkpoint Investors Club',
  });

  const contribution = await app.alpha.Contribution.create({
    id: await app.alpha.getNextId('contribution_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 25000,
    month: 5,
    year: app.FY,
    status: 'partial',
    paid_date: reconDate,
    created_at: new Date(`${app.FY}-05-15T11:00:00Z`),
  });
  const contributionTx = await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 25000,
    type: 'contribution',
    description: 'Same-day post-reconciliation contribution',
    transaction_date: reconDate,
    created_at: new Date(`${app.FY}-05-15T11:00:00Z`),
  });

  const member = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Same Day Joiner',
    office: 'member',
    status: 'active',
    entry_fee: 500000,
    join_date: reconDate,
    created_at: new Date(`${app.FY}-05-15T11:05:00Z`),
  });

  const loan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: app.fx.alpha.members.two.id,
    loan_number: 'Same Day Recon Loan',
    principal: 100000,
    interest_rate: 0,
    interest_amount: 0,
    amount_deposited: 100000,
    issued_date: reconDate,
    status: 'active',
    fiscal_year: app.FY,
    disbursed: true,
  });
  const loanTx = await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.fx.alpha.members.two.id,
    amount: 100000,
    type: 'loan_disbursement',
    description: `Loan disbursed — Alpha Active Two (${loan.loan_number}, FY${app.FY})`,
    transaction_date: reconDate,
    created_at: new Date(`${app.FY}-05-15T11:10:00Z`),
  });

  const snapshot = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY,
    quarter: 1,
    organization_name: 'Checkpoint Investors Club',
  });

  assert.equal(
    snapshot.cash_position.contributions_received - baseline.cash_position.contributions_received,
    25000,
    'same-day contribution entered after reconciliation must be an inflow',
  );
  assert.equal(
    snapshot.cash_position.entry_fees_received - baseline.cash_position.entry_fees_received,
    500000,
    'same-day member entry fee recorded after reconciliation must be an inflow',
  );
  assert.equal(
    snapshot.cash_position.loan_disbursements - baseline.cash_position.loan_disbursements,
    100000,
    'same-day loan disbursed after reconciliation must be an outflow',
  );

  await Promise.all([
    app.alpha.Contribution.deleteOne({ _id: contribution._id }),
    app.alpha.Transaction.deleteOne({ _id: contributionTx._id }),
    app.alpha.Member.deleteOne({ _id: member._id }),
    app.alpha.Loan.deleteOne({ _id: loan._id }),
    app.alpha.Transaction.deleteOne({ _id: loanTx._id }),
    app.alpha.ReconciliationRun.deleteOne({ _id: recon._id }),
  ]);
});


// ─── Loan activation write path: full loan identity ──────────────────────────
//
// PATCH /api/loans/:id (pending -> active) is served by
// routes/loanActivationHotfix.js, which server.js mounts BEFORE routes/loans.js.
// Before it records the cash-out it re-runs the live approval assessment against
// "now" (contribution arrears, unpaid fines, other loan balances, borrowing
// limit), so these tests must not lean on the calendar or on the shared members:
//   - "Alpha Active One" can never clear that gate, whatever the date: it has an
//     unpaid fine and an active loan with an outstanding balance;
//   - a member who is merely paid up to the current month clears it today and
//     stops clearing it the day the next contribution deadline passes.
// Every test below therefore creates its own member who is paid for ALL twelve
// contribution periods of the loan's fiscal year (so no period can be in arrears
// on any date), with no fines and no other loans. The approval gate itself is
// untouched: a negative control proves it still blocks, and an assessment sweep
// proves the fixture clears it on every deadline date of the year.

// The twelve periods the approval assessment checks: March..December of the
// fiscal year, then January and February of the next calendar year.
function fiscalYearPeriods(fiscalYear) {
  return [
    ...Array.from({ length: 10 }, (_, index) => ({ month: index + 3, year: fiscalYear })),
    { month: 1, year: fiscalYear + 1 },
    { month: 2, year: fiscalYear + 1 },
  ];
}

async function createApprovalReadyMember(name, fiscalYear = app.FY) {
  const rules = await getRulesForFYWithModel(app.alpha.FyRules, fiscalYear);
  const member = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name,
    status: 'active',
    office: 'member',
    entry_fee: 100000,
    join_date: `${fiscalYear - 1}-01-01`,
  });
  for (const { month, year } of fiscalYearPeriods(fiscalYear)) {
    await app.alpha.Contribution.create({
      id: await app.alpha.getNextId('contribution_id'),
      member_id: member.id,
      amount: Number(rules.contribution_amount),
      month,
      year,
      status: 'paid',
      paid_date: `${year}-${String(month).padStart(2, '0')}-05`,
    });
  }
  return member.toObject();
}

async function createPendingLoan(member, fields = {}) {
  return app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: member.id,
    loan_number: 'Loan 1',
    principal: 100000,
    interest_rate: 0,
    interest_amount: 0,
    amount_deposited: 100000,
    issued_date: `${app.FY}-07-15`,
    status: 'pending',
    fiscal_year: app.FY,
    disbursed: false,
    ...fields,
  });
}

async function createDisbursementTx(member, loanNumber, fiscalYear, amount, transactionDate) {
  return app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: member.id,
    amount,
    type: 'loan_disbursement',
    description: `Loan disbursed — ${member.name} (${loanNumber}, FY${fiscalYear})`,
    transaction_date: transactionDate,
  });
}

const activateLoan = (loan) => patchJson(app.baseUrl, `/api/loans/${loan.id}`, { status: 'active' }, app.tokens.admin);
const disbursementsOf = (member) => app.alpha.Transaction.find({ member_id: member.id, type: 'loan_disbursement' }).sort({ id: 1 }).lean();
const plain = (value) => JSON.parse(JSON.stringify(value));

// Everything these tests create hangs off a member created inside the test.
async function removeActivationFixtures(memberIds) {
  await Promise.all([
    app.alpha.Transaction.deleteMany({ member_id: { $in: memberIds } }),
    app.alpha.Loan.deleteMany({ member_id: { $in: memberIds } }),
    app.alpha.Contribution.deleteMany({ member_id: { $in: memberIds } }),
    app.alpha.Fine.deleteMany({ member_id: { $in: memberIds } }),
    app.alpha.Member.deleteMany({ id: { $in: memberIds } }),
  ]);
}

test('activation write path matches disbursement by full loan identity including fiscal year', async () => {
  const member = await createApprovalReadyMember('Activation Identity Member');
  const priorFy = app.FY - 1;
  try {
    // Last fiscal year this member took a "Loan 1", repaid it, and its cash-out
    // is on the books. Loan numbers restart every fiscal year, so ...
    await app.alpha.Loan.create({
      id: await app.alpha.getNextId('loan_id'),
      member_id: member.id,
      loan_number: 'Loan 1',
      principal: 90000,
      interest_rate: 0,
      interest_amount: 0,
      amount_deposited: 90000,
      issued_date: `${priorFy}-04-01`,
      status: 'paid',
      fiscal_year: priorFy,
      disbursed: true,
    });
    const prior = await createDisbursementTx(member, 'Loan 1', priorFy, 90000, `${priorFy}-04-01`);
    const priorBefore = plain(await app.alpha.Transaction.findOne({ _id: prior._id }).lean());

    // ... this fiscal year's request is numbered "Loan 1" again.
    const pending = await createPendingLoan(member);

    const response = await activateLoan(pending);
    assert.equal(response.status, 200, `activation must clear the live approval gate: ${JSON.stringify(response.body)}`);
    assert.equal(
      response.body.approval_assessment?.eligible,
      true,
      'served by the activation hotfix (mounted before loans.js), which attaches its approval assessment',
    );
    assert.equal(response.body.status, 'active');
    assert.equal(response.body.disbursed, true);

    const persisted = await app.alpha.Loan.findOne({ id: pending.id }).lean();
    assert.equal(persisted.status, 'active');
    assert.equal(persisted.disbursed, true);

    const transactions = await disbursementsOf(member);
    assert.equal(transactions.length, 2, 'prior-FY Loan 1 must not suppress the current-FY activation transaction');
    const [priorAfter, current] = transactions;
    assert.deepEqual(plain(priorAfter), priorBefore, 'the prior-FY transaction must be left untouched');
    assert.equal(current.member_id, member.id);
    assert.equal(current.type, 'loan_disbursement');
    assert.equal(current.amount, 100000);
    assert.equal(current.transaction_date, `${app.FY}-07-15`);
    assert.equal(
      current.description,
      `Loan disbursed — ${member.name} (Loan 1, FY${app.FY})`,
      'the current-FY transaction carries the full loan identity: (loan_number, FY<fiscal_year>)',
    );
  } finally {
    await removeActivationFixtures([member.id]);
  }
});

test('activation still enforces the live approval gate for an otherwise identical member (negative control)', async () => {
  const member = await createApprovalReadyMember('Activation Gate Control Member');
  try {
    await app.alpha.Fine.create({
      id: await app.alpha.getNextId('fine_id'),
      member_id: member.id,
      amount: 3500,
      reason: 'Activation gate control fine',
      year: app.FY,
      status: 'unpaid',
    });
    const pending = await createPendingLoan(member);

    const response = await activateLoan(pending);
    assert.equal(response.status, 409);
    assert.equal(response.body.approval_blocked, true);
    assert.deepEqual(
      response.body.assessment.blockers.map((blocker) => blocker.code),
      ['unpaid_fines'],
      'the fixture clears every other check, so the unpaid fine is the only blocker',
    );
    assert.equal((await app.alpha.Loan.findOne({ id: pending.id }).lean()).status, 'pending');
    assert.equal((await disbursementsOf(member)).length, 0, 'a blocked activation records no cash-out');
  } finally {
    await removeActivationFixtures([member.id]);
  }
});

test('approval-ready fixture member clears the live assessment on every contribution deadline of its fiscal year', async () => {
  const { assessLoanApprovalWithModels } = require('../../services/loanApprovalAssessment');
  const { getContributionDeadline } = require('../../services/contributionFinePolicy');
  const member = await createApprovalReadyMember('Activation Clock Sweep Member');
  try {
    // The assessment accepts its own "as of" date, so the whole calendar can be
    // swept without touching the clock: the day before and the day after each
    // period's deadline, the start of the fiscal year, and a date long after it.
    const DAY = 24 * 60 * 60 * 1000;
    const assessmentDates = [
      new Date(`${app.FY}-03-01T12:00:00Z`),
      ...fiscalYearPeriods(app.FY).flatMap(({ month, year }) => {
        const deadline = getContributionDeadline(month, year);
        return [new Date(deadline.getTime() - DAY), new Date(deadline.getTime() + DAY)];
      }),
      new Date(`${app.FY + 3}-01-01T12:00:00Z`),
    ];

    let mostPeriodsDue = 0;
    for (const assessmentDate of assessmentDates) {
      const assessment = await assessLoanApprovalWithModels(app.alpha, {
        memberId: member.id,
        principal: 100000,
        loanDate: `${app.FY}-07-15`,
        fiscalYear: app.FY,
        assessmentDate,
      });
      assert.equal(
        assessment.eligible,
        true,
        `blocked as of ${assessmentDate.toISOString()}: ${JSON.stringify(assessment.blockers)}`,
      );
      assert.equal(assessment.contribution_clearance.arrears_total, 0);
      mostPeriodsDue = Math.max(mostPeriodsDue, assessment.contribution_clearance.periods_due);
    }
    assert.equal(mostPeriodsDue, 12, 'the sweep must reach a date on which every contribution period is due');
  } finally {
    await removeActivationFixtures([member.id]);
  }
});

test('activation records no second disbursement when this loan\'s own full-identity transaction already exists', async () => {
  const member = await createApprovalReadyMember('Activation Duplicate Guard Member');
  const priorFy = app.FY - 1;
  try {
    await createDisbursementTx(member, 'Loan 1', priorFy, 90000, `${priorFy}-04-01`);
    // Left behind by an earlier, interrupted activation of this very loan.
    await createDisbursementTx(member, 'Loan 1', app.FY, 100000, `${app.FY}-07-15`);
    const before = plain(await disbursementsOf(member));
    assert.equal(before.length, 2);

    const pending = await createPendingLoan(member);
    const response = await activateLoan(pending);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.status, 'active');
    assert.equal(response.body.disbursed, true);

    assert.deepEqual(plain(await disbursementsOf(member)), before, 'the same loan identity is a duplicate: nothing is added or changed');
  } finally {
    await removeActivationFixtures([member.id]);
  }
});

test('activation does not mistake another member\'s disbursement with the same loan number and fiscal year for this loan\'s own', async () => {
  const member = await createApprovalReadyMember('Activation Own Member');
  const other = await createApprovalReadyMember('Activation Other Member');
  try {
    // Every member's first loan of a fiscal year is "Loan 1": an identical
    // (loan_number, FY) marker on someone else's transaction is a different loan.
    await createDisbursementTx(other, 'Loan 1', app.FY, 88000, `${app.FY}-04-01`);
    const otherBefore = plain(await disbursementsOf(other));

    const pending = await createPendingLoan(member);
    const response = await activateLoan(pending);
    assert.equal(response.status, 200, JSON.stringify(response.body));

    const own = await disbursementsOf(member);
    assert.equal(own.length, 1, 'this member\'s own cash-out must be recorded');
    assert.equal(own[0].description, `Loan disbursed — ${member.name} (Loan 1, FY${app.FY})`);
    assert.deepEqual(plain(await disbursementsOf(other)), otherBefore, 'the other member\'s disbursement is left untouched');
  } finally {
    await removeActivationFixtures([member.id, other.id]);
  }
});

// A legacy loan row can lack a loan number and/or a fiscal year. It then has no
// identity to match on, so no existing disbursement may be taken for its own: the
// cash-out is recorded rather than hidden behind an unrelated transaction.
const INCOMPLETE_LOAN_IDENTITIES = [
  { label: 'no loan number', fields: { loan_number: null }, reference: (loan) => `(Loan #${loan.id})` },
  { label: 'no fiscal year', fields: { fiscal_year: null }, reference: () => '(Loan 1)' },
  { label: 'neither loan number nor fiscal year', fields: { loan_number: null, fiscal_year: null }, reference: (loan) => `(Loan #${loan.id})` },
];

for (const { label, fields, reference } of INCOMPLETE_LOAN_IDENTITIES) {
  test(`activating a legacy loan with ${label} is never matched to another disbursement of the member`, async () => {
    const member = await createApprovalReadyMember('Activation Legacy Member');
    try {
      await createDisbursementTx(member, 'Loan 1', app.FY - 1, 90000, `${app.FY - 1}-04-01`);
      await createDisbursementTx(member, 'Loan 1', app.FY, 80000, `${app.FY}-04-01`);
      await app.alpha.Transaction.create({
        id: await app.alpha.getNextId('transaction_id'),
        member_id: member.id,
        amount: 70000,
        type: 'loan_disbursement',
        description: 'Imported loan disbursement',
        transaction_date: `${app.FY}-05-01`,
      });
      const before = plain(await disbursementsOf(member));
      assert.equal(before.length, 3);

      const pending = await createPendingLoan(member, fields);
      const response = await activateLoan(pending);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.status, 'active');
      assert.equal(response.body.disbursed, true);

      const after = plain(await disbursementsOf(member));
      assert.equal(after.length, 4, 'the legacy loan\'s own cash-out must be recorded');
      assert.deepEqual(after.slice(0, 3), before, 'the existing disbursements are left untouched');
      const recorded = after[3];
      assert.equal(recorded.amount, 100000);
      assert.equal(recorded.transaction_date, `${app.FY}-07-15`);
      assert.equal(recorded.description, `Loan disbursed — ${member.name} ${reference(pending)}`);
      assert.doesNotMatch(recorded.description, /undefined|null/);
    } finally {
      await removeActivationFixtures([member.id]);
    }
  });
}

// The marker is matched as exact text, not as a pattern or a prefix.
const EXACT_MARKER_CASES = [
  {
    label: '"Loan 1" is not hidden by "Loan 12", which merely starts the same way',
    loanNumber: 'Loan 1',
    recordedLoanNumber: 'Loan 12',
    duplicate: false,
  },
  {
    label: 'a loan number written in regex syntax ("Loan (1+1)") does not match "Loan 11"',
    loanNumber: 'Loan (1+1)',
    recordedLoanNumber: 'Loan 11',
    duplicate: false,
  },
  {
    label: 'a loan number written in regex syntax ("Loan (1+1)") still finds its own recorded disbursement',
    loanNumber: 'Loan (1+1)',
    recordedLoanNumber: 'Loan (1+1)',
    duplicate: true,
  },
];

for (const { label, loanNumber, recordedLoanNumber, duplicate } of EXACT_MARKER_CASES) {
  test(`activation matches the loan marker as exact text: ${label}`, async () => {
    const member = await createApprovalReadyMember('Activation Exact Match Member');
    try {
      await createDisbursementTx(member, recordedLoanNumber, app.FY, 77000, `${app.FY}-04-01`);
      const before = plain(await disbursementsOf(member));

      const pending = await createPendingLoan(member, { loan_number: loanNumber });
      const response = await activateLoan(pending);
      assert.equal(response.status, 200, JSON.stringify(response.body));

      const after = plain(await disbursementsOf(member));
      assert.deepEqual(after.slice(0, before.length), before, 'the recorded disbursement is left untouched');
      if (duplicate) {
        assert.equal(after.length, before.length, 'the loan\'s own disbursement is already recorded: no second one');
      } else {
        assert.equal(after.length, before.length + 1, 'a different loan\'s disbursement must not hide this cash-out');
        assert.equal(after.at(-1).description, `Loan disbursed — ${member.name} (${loanNumber}, FY${app.FY})`);
      }
    } finally {
      await removeActivationFixtures([member.id]);
    }
  });
}

test('activation identity lookup stays inside the tenant: matching default/beta disbursements cannot suppress alpha and nothing leaks', async () => {
  const member = await createApprovalReadyMember('Activation Isolation Member');
  const description = `Loan disbursed — ${member.name} (Loan 1, FY${app.FY})`;
  const poison = {
    member_id: member.id,
    amount: 100000,
    type: 'loan_disbursement',
    description,
    transaction_date: `${app.FY}-07-15`,
  };
  let defaultPoison;
  let betaPoison;
  try {
    // Same member id, same full-identity marker, in the other two databases.
    defaultPoison = await app.defaultModels.Transaction.create({ id: 9101, ...poison });
    betaPoison = await app.beta.Transaction.create({ id: 9102, ...poison });
    const pending = await createPendingLoan(member);
    const before = await app.baseline();

    const response = await activateLoan(pending);
    assert.equal(response.status, 200, JSON.stringify(response.body));

    const alphaTransactions = await disbursementsOf(member);
    assert.equal(alphaTransactions.length, 1, 'alpha records its own cash-out');
    assert.equal(alphaTransactions[0].description, description);
    assert.equal(alphaTransactions[0].id, await app.alphaCounter('transaction_id'), 'the id comes from alpha\'s own sequence');
    await app.assertIsolation(before, 'loan activation');
  } finally {
    await Promise.all([
      defaultPoison && app.defaultModels.Transaction.deleteOne({ _id: defaultPoison._id }),
      betaPoison && app.beta.Transaction.deleteOne({ _id: betaPoison._id }),
    ]);
    await removeActivationFixtures([member.id]);
  }
});

test('disbursed loan cannot be moved back to pending', async () => {
  const loan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: app.fx.alpha.members.two.id,
    loan_number: 'No Pending Rollback',
    principal: 70000,
    interest_rate: 0,
    interest_amount: 0,
    amount_deposited: 70000,
    issued_date: `${app.FY}-07-10`,
    status: 'active',
    fiscal_year: app.FY,
    disbursed: true,
  });
  const response = await patchJson(app.baseUrl, `/api/loans/${loan.id}`, { status: 'pending' }, app.tokens.admin);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /cannot be moved back to pending/i);
  await app.alpha.Loan.deleteOne({ _id: loan._id });
});

test('post-reconciliation welfare payout is subtracted from closing cash', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const recon = await app.alpha.ReconciliationRun.create({
    run_key: `quarterly-welfare-${app.FY}`,
    source_hash: `quarterly-welfare-hash-${app.FY}`,
    schema_version: 'checkpoint-reconciliation-v1',
    source_generated_on: `${app.FY}-05-01T00:00:00Z`,
    reporting_cutoff: { Y3_loans: `${app.FY}-05-01`, contributions: `${app.FY}-05-01` },
    source_summary: { current_mkoba_cash_tzs: 300000 },
    backup: {},
    result: {},
    status: 'applied',
    applied_at: new Date(`${app.FY}-05-01T08:00:00Z`),
  });
  const before = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  const welfare = await app.alpha.WelfareEvent.create({
    id: await app.alpha.getNextId('welfare_id'),
    member_id: app.fx.alpha.members.one.id,
    event_type: 'Audit welfare payout',
    amount: 50000,
    status: 'approved',
    approved_date: `${app.FY}-05-20`,
    created_at: new Date(`${app.FY}-05-20T08:00:00Z`),
  });
  const after = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  assert.equal(after.cash_position.welfare_paid - before.cash_position.welfare_paid, 50000);
  assert.equal(after.cash_position.closing_balance, before.cash_position.closing_balance - 50000);
  await Promise.all([
    app.alpha.WelfareEvent.deleteOne({ _id: welfare._id }),
    app.alpha.ReconciliationRun.deleteOne({ _id: recon._id }),
  ]);
});


test('member without join_date uses created_at and cannot leak into an earlier quarter', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const baseline = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  const member = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Future No Join Date',
    status: 'active',
    office: 'member',
    entry_fee: 500000,
    created_at: new Date(`${app.FY}-06-10T08:00:00Z`),
  });
  const after = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  assert.equal(after.headline.active_members, baseline.headline.active_members);
  assert.equal(after.financial_position.entry_fees, baseline.financial_position.entry_fees);
  await app.alpha.Member.deleteOne({ _id: member._id });
});

test('repayment source row updates reconciled cash even without a mirrored transaction', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const recon = await app.alpha.ReconciliationRun.create({
    run_key: `quarterly-repayment-source-${app.FY}`,
    source_hash: `quarterly-repayment-source-hash-${app.FY}`,
    schema_version: 'checkpoint-reconciliation-v1',
    source_generated_on: `${app.FY}-05-01T00:00:00Z`,
    reporting_cutoff: { Y3_loans: `${app.FY}-05-01`, contributions: `${app.FY}-05-01` },
    source_summary: { current_mkoba_cash_tzs: 200000 },
    backup: {},
    result: {},
    status: 'applied',
    applied_at: new Date(`${app.FY}-05-01T08:00:00Z`),
  });
  const before = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  const repayment = await app.alpha.Repayment.create({
    id: await app.alpha.getNextId('repayment_id'),
    loan_id: app.fx.alpha.loans.l1.id,
    amount: 12345,
    repayment_date: `${app.FY}-05-20`,
    created_at: new Date(`${app.FY}-05-20T08:00:00Z`),
  });
  const after = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  assert.equal(after.cash_position.loan_repayments_received - before.cash_position.loan_repayments_received, 12345);
  assert.equal(after.cash_position.closing_balance, before.cash_position.closing_balance + 12345);
  await Promise.all([
    app.alpha.Repayment.deleteOne({ _id: repayment._id }),
    app.alpha.ReconciliationRun.deleteOne({ _id: recon._id }),
  ]);
});

test('real disbursement evidence preserves a legacy loan even if its current status is pending', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const loan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: app.fx.alpha.members.one.id,
    loan_number: 'Legacy Pending But Disbursed',
    principal: 90000,
    interest_rate: 0,
    interest_amount: 0,
    amount_deposited: 90000,
    issued_date: `${app.FY}-04-10`,
    status: 'pending',
    fiscal_year: app.FY,
    disbursed: false,
  });
  const tx = await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 90000,
    type: 'loan_disbursement',
    description: `Loan disbursed — Alpha Active One (${loan.loan_number}, FY${app.FY})`,
    transaction_date: `${app.FY}-04-10`,
    created_at: new Date(`${app.FY}-04-10T08:00:00Z`),
  });
  const snapshot = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  assert.ok(snapshot.loans.portfolio.some((item) => item.loan_id === loan.id));
  await Promise.all([
    app.alpha.Loan.deleteOne({ _id: loan._id }),
    app.alpha.Transaction.deleteOne({ _id: tx._id }),
  ]);
});


test('reconciliation-backed investment uses source cutoff rather than later import timestamp', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const runKey = `quarterly-historical-investment-${app.FY}`;
  const run = await app.alpha.ReconciliationRun.create({
    run_key: runKey,
    source_hash: `quarterly-historical-investment-hash-${app.FY}`,
    schema_version: 'checkpoint-reconciliation-v1',
    source_generated_on: `${app.FY}-05-31T00:00:00Z`,
    reporting_cutoff: { Y3_loans: `${app.FY}-05-31`, contributions: `${app.FY}-05-31` },
    source_summary: { current_mkoba_cash_tzs: 100000 },
    backup: {},
    result: {},
    status: 'applied',
    applied_at: new Date(`${app.FY}-06-10T08:00:00Z`),
  });
  const investment = await app.alpha.Investment.create({
    provider: 'Historical Reconciled Fund',
    amount: 321000,
    status: 'active',
    source: 'Checkpoint System Reconciliation',
    reconciliation_key: `recon:${runKey}:investment:historical-reconciled-fund`,
    created_at: new Date(`${app.FY}-06-10T08:00:00Z`),
  });

  const snapshot = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  assert.ok(snapshot.investments.holdings.some((item) => item.provider === 'Historical Reconciled Fund'));
  assert.equal(snapshot.investments.quarter_transfers, 0, 'reconciliation holding is not a new quarter cash transfer');

  await Promise.all([
    app.alpha.Investment.deleteOne({ _id: investment._id }),
    app.alpha.ReconciliationRun.deleteOne({ _id: run._id }),
  ]);
});

test('reconciliation-backed paid fine uses source paid_date instead of later import created_at', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const baseline = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  const fine = await app.alpha.Fine.create({
    id: await app.alpha.getNextId('fine_id'),
    member_id: app.fx.alpha.members.one.id,
    amount: 17000,
    reason: 'Historical reconciliation fine',
    year: app.FY,
    status: 'paid',
    paid_date: `${app.FY}-05-31`,
    reconciliation_key: `recon:audit-fine-${app.FY}:paid:1`,
    created_at: new Date(`${app.FY}-06-10T08:00:00Z`),
  });
  const after = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  assert.equal(after.financial_position.paid_fines - baseline.financial_position.paid_fines, 17000);
  await app.alpha.Fine.deleteOne({ _id: fine._id });
});


test('explicit zero entry fee remains zero in the report', async () => {
  const { buildQuarterlyReportSnapshot } = require('../../services/quarterlyReportSnapshot');
  const baseline = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  const member = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Waived Entry Fee Member',
    status: 'active',
    office: 'member',
    entry_fee: 0,
    join_date: `${app.FY}-04-15`,
  });
  const after = await buildQuarterlyReportSnapshot(app.alpha, {
    fiscal_year: app.FY, quarter: 1, organization_name: 'Checkpoint Investors Club',
  });
  assert.equal(after.financial_position.entry_fees, baseline.financial_position.entry_fees);
  await app.alpha.Member.deleteOne({ _id: member._id });
});
