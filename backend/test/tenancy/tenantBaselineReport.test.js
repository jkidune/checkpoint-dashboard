const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

let baselineReport;
let Member;
let Contribution;
let Fine;

before(async () => {
  await startMemoryMongo({ dbName: 'checkpoint_legacy_test' });

  const connectDB = require('../../db/mongoose');
  await connectDB();

  ({ Member, Contribution, Fine } = require('../../db/models'));
  baselineReport = require('../../scripts/tenant-baseline-report');

  await Member.create([
    { name: 'Member One' },
    { name: 'Member Two' },
  ]);
  await Contribution.create([
    { member_id: 1, amount: 75000, month: 6, year: 2027 },
    { member_id: 2, amount: 75000, month: 6, year: 2027 },
  ]);
  await Fine.create([
    { member_id: 1, amount: 11250, reason: 'missing month', year: 2027, status: 'unpaid' },
    { member_id: 2, amount: 11250, reason: 'missing month', year: 2027, status: 'paid' },
  ]);
}, { timeout: 60000 });

after(async () => {
  await stopMemoryMongo();
});

test('reports accurate counts and sums from seeded data', async () => {
  const report = await baselineReport.run();

  assert.equal(report.database, 'checkpoint_legacy_test');
  assert.equal(report.members.count, 2);
  assert.equal(report.contributions.count, 2);
  assert.equal(report.contributions.total_amount, 150000);
  assert.equal(report.fines.count, 2);
  assert.equal(report.fines.unpaid_count, 1);
  assert.equal(report.fines.paid_count, 1);
  assert.equal(report.fines.total_amount, 22500);
  assert.match(report.note, /not a claim of accounting equivalence/);
});

test('performs no writes: counts are identical before and after running twice', async () => {
  const before1 = await Promise.all([Member.countDocuments(), Contribution.countDocuments(), Fine.countDocuments()]);

  await baselineReport.run();
  await baselineReport.run();

  const after1 = await Promise.all([Member.countDocuments(), Contribution.countDocuments(), Fine.countDocuments()]);

  assert.deepEqual(after1, before1);
});
