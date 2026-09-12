#!/usr/bin/env node
// Read-only fingerprint of the existing (currently single, pre-tenancy)
// database: counts and sums per collection. Meant to be run before and
// after later tenancy-migration PRs so the numbers can be diffed.
//
//   node scripts/tenant-baseline-report.js            (human-readable)
//   node scripts/tenant-baseline-report.js --json      (machine-readable)
//
// This script performs reads only. It never writes, updates, or deletes
// anything, and it does not touch the control database.
//
// IMPORTANT: matching counts/totals across two runs is a useful operational
// signal, not a substitute for real accounting reconciliation. It cannot,
// by itself, prove financial equivalence after a migration.

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../db/mongoose');
const {
  Member,
  Contribution,
  Loan,
  Repayment,
  Transaction,
  User,
  Fine,
  Expense,
  Investment,
  FyRules,
  ReconciliationRun,
  AuditSourceRecord,
} = require('../db/models');

async function countAndSum(Model, amountField) {
  const [result] = await Model.aggregate([
    { $group: { _id: null, count: { $sum: 1 }, total: { $sum: `$${amountField}` } } },
  ]);
  return { count: result?.count ?? 0, total: result?.total ?? 0 };
}

async function fineBreakdown() {
  const rows = await Fine.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } },
  ]);
  const byStatus = Object.fromEntries(rows.map((row) => [row._id, row]));
  return {
    count: rows.reduce((sum, row) => sum + row.count, 0),
    unpaid_count: byStatus.unpaid?.count ?? 0,
    paid_count: byStatus.paid?.count ?? 0,
    total_amount: rows.reduce((sum, row) => sum + row.total, 0),
  };
}

/**
 * Builds the baseline report object. Read-only — see the file header.
 */
async function run() {
  const baseConnection = await connectDB();
  const databaseName = baseConnection.connection.name;

  const [
    membersCount,
    contributions,
    loans,
    repayments,
    fines,
    transactions,
    expenses,
    investments,
    usersCount,
    fyRulesCount,
    reconciliationRunsCount,
    auditSourceRecordsCount,
  ] = await Promise.all([
    Member.countDocuments(),
    countAndSum(Contribution, 'amount'),
    countAndSum(Loan, 'principal'),
    countAndSum(Repayment, 'amount'),
    fineBreakdown(),
    countAndSum(Transaction, 'amount'),
    countAndSum(Expense, 'amount'),
    countAndSum(Investment, 'amount'),
    User.countDocuments(),
    FyRules.countDocuments(),
    ReconciliationRun.countDocuments(),
    AuditSourceRecord.countDocuments(),
  ]);

  return {
    generated_at: new Date().toISOString(),
    database: databaseName,
    note:
      'Operational migration baseline (counts and sums only). This is a fingerprint for later ' +
      'comparison, not a claim of accounting equivalence.',
    members: { count: membersCount },
    contributions: { count: contributions.count, total_amount: contributions.total },
    loans: { count: loans.count, total_principal: loans.total },
    repayments: { count: repayments.count, total_amount: repayments.total },
    fines,
    transactions: { count: transactions.count, total_amount: transactions.total },
    expenses: { count: expenses.count, total_amount: expenses.total },
    investments: { count: investments.count, total_recorded_amount: investments.total },
    users: { count: usersCount },
    fy_rules: { count: fyRulesCount },
    reconciliation_runs: { count: reconciliationRunsCount },
    audit_source_records: { count: auditSourceRecordsCount },
  };
}

function printHumanReadable(report) {
  console.log(`Tenant baseline report — ${report.generated_at}`);
  console.log(`Database: ${report.database}`);
  console.log('');
  console.log(report.note);
  console.log('');
  console.log(`Members               ${report.members.count}`);
  console.log(`Contributions         ${report.contributions.count}  (total ${report.contributions.total_amount})`);
  console.log(`Loans                 ${report.loans.count}  (total principal ${report.loans.total_principal})`);
  console.log(`Repayments            ${report.repayments.count}  (total ${report.repayments.total_amount})`);
  console.log(
    `Fines                 ${report.fines.count}  ` +
    `(unpaid ${report.fines.unpaid_count}, paid ${report.fines.paid_count}, total ${report.fines.total_amount})`
  );
  console.log(`Transactions          ${report.transactions.count}  (total ${report.transactions.total_amount})`);
  console.log(`Expenses              ${report.expenses.count}  (total ${report.expenses.total_amount})`);
  console.log(
    `Investments           ${report.investments.count}  (recorded total ${report.investments.total_recorded_amount})`
  );
  console.log(`Users                 ${report.users.count}`);
  console.log(`FY rules              ${report.fy_rules.count}`);
  console.log(`Reconciliation runs   ${report.reconciliation_runs.count}`);
  console.log(`Audit source records  ${report.audit_source_records.count}`);
}

async function main() {
  const jsonOutput = process.argv.includes('--json');
  const report = await run();

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReadable(report);
  }

  await mongoose.disconnect();
  process.exitCode = 0;
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('Baseline report failed:', err.message);
    try {
      await mongoose.disconnect();
    } catch {
      // already disconnected / never connected — nothing to clean up
    }
    process.exitCode = 1;
  });
}

module.exports = { run };
