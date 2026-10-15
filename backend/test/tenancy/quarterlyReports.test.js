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
  assert.equal(snapshot.contributions.quarter_received, 75000, 'June dues paid after Aug 31 must not count as Q2 receipts');
  assert.equal(snapshot.contributions.monthly.find((row) => row.month === 6).amount, 75000);
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
  assert.equal(versionTwo.version.financial_snapshot.contributions.quarter_received, 150000);
  assert.notEqual(versionTwo.version.source_snapshot_hash, versionOne.version.source_snapshot_hash);

  const old = await getJson(
    app.baseUrl,
    `/api/reports/quarterly/${versionOne.report.id}/versions/1`,
    app.tokens.admin,
  );
  assert.equal(old.status, 200);
  assert.equal(old.body.version.financial_snapshot.contributions.quarter_received, 75000);
  assert.equal(old.body.version.source_snapshot_hash, versionOne.version.source_snapshot_hash);

  const newDetail = await getJson(app.baseUrl, `/api/reports/quarterly/${versionOne.report.id}`, app.tokens.admin);
  assert.equal(newDetail.status, 200);
  assert.equal(newDetail.body.version.version_number, 2);
  assert.equal(newDetail.body.version.financial_snapshot.contributions.quarter_received, 150000);
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

test('invalid fiscal quarter requests are rejected before any report write', async () => {
  const count = await app.alpha.QuarterlyReportVersion.countDocuments();
  const response = await postJson(
    app.baseUrl,
    '/api/reports/quarterly/generate',
    { fiscal_year: app.FY, quarter: 5 },
    app.tokens.admin,
  );
  assert.equal(response.status, 400);
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
