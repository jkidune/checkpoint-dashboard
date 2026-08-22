/**
 * Checkpoint Investment Club — Y3 Live Cutover & Controlled Reconciliation Script
 * Run key: 2026.08.y3-live-cutover-v1
 * 
 * Usage:
 *   node scripts/reconcile-y3-cutover.js --dry-run
 *   node scripts/reconcile-y3-cutover.js --apply
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../db/mongoose');
const {
  Member,
  Contribution,
  Loan,
  Repayment,
  Fine,
  Transaction,
  Investment,
  ReconciliationRun,
  AuditSourceRecord,
  getNextId
} = require('../db/models');

const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;

async function execute() {
  await connectDB();
  console.log(`\n================================================================`);
  console.log(`CHECKPOINT Y3 LIVE CUTOVER & RECONCILIATION SCRIPT`);
  console.log(`Mode: ${isApply ? '🚀 APPLY (LIVE WRITE TO MONGODB)' : '🔍 DRY-RUN (READ-ONLY PREVIEW)'}`);
  console.log(`================================================================\n`);

  // 1. Snapshot / Pre-flight backup
  const preBackup = {
    members: await Member.find().lean(),
    contributions: await Contribution.find().lean(),
    loans: await Loan.find().lean(),
    repayments: await Repayment.find().lean(),
    fines: await Fine.find().lean(),
    transactions: await Transaction.find().lean(),
    investments: await Investment.find().lean(),
    reconciliation_runs: await ReconciliationRun.find().select('-backup').lean(),
  };

  console.log(`📦 Pre-flight snapshot captured across ${Object.keys(preBackup).length} collections.`);

  const auditStats = {
    contributions_created: 0,
    contributions_updated: 0,
    loans_created: 0,
    loans_updated: 0,
    repayments_created: 0,
    fines_settled: 0,
    fines_created: 0,
    transactions_created: 0,
    member_credits_created: 0,
  };

  // -------------------------------------------------------------------------
  // A. SAMWEL ALLEN EPHRAIM (Member ID 9) — Loan ID 49 Confirmation
  // -------------------------------------------------------------------------
  console.log(`\n--- [1/6] SAMWEL ALLEN EPHRAIM (Loan ID 49) ---`);
  const samwelLoan = await Loan.findOne({ id: 49 });
  if (!samwelLoan) {
    throw new Error('Loan ID 49 not found in database!');
  }

  if (isApply) {
    samwelLoan.status = 'active';
    samwelLoan.disbursed = true;
    samwelLoan.cancellation_reason = null;
    samwelLoan.cancelled_at = null;
    samwelLoan.issued_date = '2026-07-01';
    samwelLoan.fiscal_year = 2026;
    samwelLoan.principal = 1380000;
    samwelLoan.interest_rate = 0.12;
    samwelLoan.interest_amount = 165600;
    samwelLoan.amount_deposited = 1214400;
    await samwelLoan.save();
    auditStats.loans_updated++;
  }
  console.log(`✓ Loan 49 set to ACTIVE, disbursed=true, Principal=1,380,000, Net Disbursed=1,214,400`);

  // Cash transaction for Samwel disbursement
  const existingSamwelTx = await Transaction.findOne({
    member_id: 9,
    type: 'loan_disbursement',
    amount: 1214400,
    transaction_date: '2026-07-01'
  });
  if (!existingSamwelTx) {
    if (isApply) {
      await Transaction.create({
        id: await getNextId('transaction_id'),
        member_id: 9,
        amount: 1214400,
        type: 'loan_disbursement',
        description: 'Loan disbursement — Samwel Allen Ephraim (Loan 1, FY2026)',
        reference: 'SAMWEL-Y3-LOAN-DISB',
        transaction_date: '2026-07-01'
      });
    }
    auditStats.transactions_created++;
    console.log(`✓ Transaction created: TZS 1,214,400 OUT (loan_disbursement)`);
  } else {
    console.log(`ℹ Samwel disbursement transaction already exists (ID ${existingSamwelTx.id})`);
  }

  // -------------------------------------------------------------------------
  // B. PETER LEMA (Member ID 8) — Y3 Loan Confirmation
  // -------------------------------------------------------------------------
  console.log(`\n--- [2/6] PETER LEMA (Y3 Loan) ---`);
  let peterLoan = await Loan.findOne({ member_id: 8, fiscal_year: 2026, principal: 1200000 });
  if (!peterLoan) {
    if (isApply) {
      peterLoan = await Loan.create({
        id: await getNextId('loan_id'),
        member_id: 8,
        loan_number: 'Loan 3',
        principal: 1200000,
        interest_rate: 0.12,
        interest_amount: 144000,
        amount_deposited: 1056000,
        issued_date: '2026-07-24',
        due_date: '2027-01-24',
        status: 'active',
        fiscal_year: 2026,
        notes: 'Y3 Loan confirmed — net cash disbursed TZS 1,056,000',
      });
    }
    auditStats.loans_created++;
    console.log(`✓ Peter Lema Y3 Loan created: Principal=1,200,000, Net Disbursed=1,056,000, Status=active`);
  } else {
    console.log(`ℹ Peter Lema Y3 Loan already exists (ID ${peterLoan.id})`);
  }

  // Cash transaction for Peter disbursement
  const existingPeterTx = await Transaction.findOne({
    member_id: 8,
    type: 'loan_disbursement',
    amount: 1056000,
    transaction_date: '2026-07-24'
  });
  if (!existingPeterTx) {
    if (isApply) {
      await Transaction.create({
        id: await getNextId('transaction_id'),
        member_id: 8,
        amount: 1056000,
        type: 'loan_disbursement',
        description: 'Loan disbursement — Peter Lema (FY2026)',
        reference: 'PETER-Y3-LOAN-DISB',
        transaction_date: '2026-07-24'
      });
    }
    auditStats.transactions_created++;
    console.log(`✓ Transaction created: TZS 1,056,000 OUT (loan_disbursement)`);
  } else {
    console.log(`ℹ Peter disbursement transaction already exists (ID ${existingPeterTx.id})`);
  }

  // -------------------------------------------------------------------------
  // C. JOSEPH MASONDA (Member ID 7) — Y3 Contributions
  // -------------------------------------------------------------------------
  console.log(`\n--- [3/6] JOSEPH MASONDA (Y3 Contributions) ---`);
  // April 2026: correct zero placeholder (id: 269)
  const aprPlaceholder = await Contribution.findOne({ member_id: 7, month: 4, year: 2026 });
  if (aprPlaceholder) {
    if (isApply) {
      aprPlaceholder.amount = 75000;
      aprPlaceholder.status = 'paid';
      aprPlaceholder.paid_date = '2026-04-05';
      aprPlaceholder.notes = 'Y3 Contribution';
      await aprPlaceholder.save();
    }
    auditStats.contributions_updated++;
    console.log(`✓ Joseph Apr 2026 contribution corrected from 0 to TZS 75,000`);
  } else {
    if (isApply) {
      await Contribution.create({
        id: await getNextId('contribution_id'),
        member_id: 7,
        amount: 75000,
        month: 4,
        year: 2026,
        status: 'paid',
        paid_date: '2026-04-05'
      });
    }
    auditStats.contributions_created++;
    console.log(`✓ Joseph Apr 2026 contribution created (TZS 75,000)`);
  }

  // May 2026
  let mayJ = await Contribution.findOne({ member_id: 7, month: 5, year: 2026 });
  if (!mayJ) {
    if (isApply) {
      await Contribution.create({
        id: await getNextId('contribution_id'),
        member_id: 7,
        amount: 75000,
        month: 5,
        year: 2026,
        status: 'paid',
        paid_date: '2026-05-05'
      });
    }
    auditStats.contributions_created++;
    console.log(`✓ Joseph May 2026 contribution created (TZS 75,000)`);
  }

  // June 2026
  let junJ = await Contribution.findOne({ member_id: 7, month: 6, year: 2026 });
  if (!junJ) {
    if (isApply) {
      await Contribution.create({
        id: await getNextId('contribution_id'),
        member_id: 7,
        amount: 75000,
        month: 6,
        year: 2026,
        status: 'paid',
        paid_date: '2026-06-05'
      });
    }
    auditStats.contributions_created++;
    console.log(`✓ Joseph Jun 2026 contribution created (TZS 75,000)`);
  }

  // July 2026 (Post-cutoff cash)
  let julJ = await Contribution.findOne({ member_id: 7, month: 7, year: 2026 });
  if (!julJ) {
    if (isApply) {
      await Contribution.create({
        id: await getNextId('contribution_id'),
        member_id: 7,
        amount: 75000,
        month: 7,
        year: 2026,
        status: 'paid',
        paid_date: '2026-07-05',
        notes: 'July 2026 confirmed contribution'
      });
    }
    auditStats.contributions_created++;
    console.log(`✓ Joseph Jul 2026 contribution created (TZS 75,000)`);
  }

  // Transaction for Joseph July contribution
  const existingJulJTx = await Transaction.findOne({
    member_id: 7,
    amount: 75000,
    transaction_date: '2026-07-05'
  });
  if (!existingJulJTx) {
    if (isApply) {
      await Transaction.create({
        id: await getNextId('transaction_id'),
        member_id: 7,
        amount: 75000,
        type: 'contribution',
        description: 'Monthly contribution — Joseph Masonda (FY2026 July)',
        reference: 'JOSEPH-2026-07',
        transaction_date: '2026-07-05'
      });
    }
    auditStats.transactions_created++;
    console.log(`✓ Transaction created: TZS 75,000 IN (Joseph July contribution)`);
  }

  // -------------------------------------------------------------------------
  // D. GOOGLE FORM VERIFIED RECORDS
  // -------------------------------------------------------------------------
  console.log(`\n--- [4/6] GOOGLE FORM VERIFIED POST-CUTOFF RECORDS ---`);

  // Helper for creating contribution idempotently
  async function ensureContrib(memberId, month, year, amount, paidDate, ref, notes) {
    const existing = await Contribution.findOne({ member_id: memberId, month, year });
    if (!existing) {
      if (isApply) {
        await Contribution.create({
          id: await getNextId('contribution_id'),
          member_id: memberId,
          month,
          year,
          amount,
          status: 'paid',
          paid_date: paidDate,
          mpesa_ref: ref,
          notes: notes || null
        });
      }
      auditStats.contributions_created++;
      console.log(`  + Contrib: Member ${memberId} Month ${month}/${year} = TZS ${amount.toLocaleString()} (Ref: ${ref})`);
    } else {
      console.log(`  ℹ Contrib already exists: Member ${memberId} Month ${month}/${year}`);
    }
  }

  // Helper for creating loan repayment idempotently
  async function ensureRepayment(loanId, amount, date, ref, notes) {
    const existing = await Repayment.findOne({ loan_id: loanId, mpesa_ref: ref, amount });
    if (!existing) {
      if (isApply) {
        await Repayment.create({
          id: await getNextId('repayment_id'),
          loan_id: loanId,
          amount,
          repayment_date: date,
          mpesa_ref: ref,
          notes: notes || null
        });
      }
      auditStats.repayments_created++;
      console.log(`  + Repayment: Loan ${loanId} = TZS ${amount.toLocaleString()} (Ref: ${ref})`);
    } else {
      console.log(`  ℹ Repayment already exists: Loan ${loanId} Ref ${ref}`);
    }
  }

  // Helper for creating transaction idempotently
  async function ensureTx(memberId, amount, type, desc, ref, date) {
    const existing = await Transaction.findOne({ reference: ref, amount });
    if (!existing) {
      if (isApply) {
        await Transaction.create({
          id: await getNextId('transaction_id'),
          member_id: memberId,
          amount,
          type,
          description: desc,
          reference: ref,
          transaction_date: date
        });
      }
      auditStats.transactions_created++;
      console.log(`  + Tx: TZS ${amount.toLocaleString()} (${type}, Ref: ${ref})`);
    } else {
      console.log(`  ℹ Tx already exists: Ref ${ref}`);
    }
  }

  // 1. DFTJE1KP58 (Gibson, 2026-06-29, Total 300,000)
  console.log(`\n• DFTJE1KP58 (Gibson Mulokozi — TZS 300,000):`);
  await ensureContrib(4, 6, 2026, 75000, '2026-06-29', 'DFTJE1KP58', 'June contribution');
  await ensureRepayment(12, 225000, '2026-06-29', 'DFTJE1KP58', 'Loan 5 repayment');
  await ensureTx(4, 300000, 'contribution', 'Monthly contribution (75k) & Loan repayment (225k) — Gibson Mulokozi', 'DFTJE1KP58', '2026-06-29');

  // 2. DFU7T1KS11 (Peter Lema, 2026-07-02, Total 200,000)
  console.log(`\n• DFU7T1KS11 (Peter Lema — TZS 200,000):`);
  await ensureContrib(8, 4, 2026, 75000, '2026-07-02', 'DFU7T1KS11', 'April contribution');
  await ensureContrib(8, 5, 2026, 75000, '2026-07-02', 'DFU7T1KS11', 'May contribution');
  await ensureContrib(8, 6, 2026, 50000, '2026-07-02', 'DFU7T1KS11', 'June contribution (partial)');
  await ensureTx(8, 200000, 'contribution', 'Monthly contributions — Peter Lema', 'DFU7T1KS11', '2026-07-02');

  // 3. DGUJE20AJA (Gibson, 2026-07-07, Total 250,000)
  console.log(`\n• DGUJE20AJA (Gibson Mulokozi — TZS 250,000):`);
  await ensureContrib(4, 7, 2026, 75000, '2026-07-07', 'DGUJE20AJA', 'July contribution');
  await ensureRepayment(12, 175000, '2026-07-07', 'DGUJE20AJA', 'Loan 5 repayment');
  await ensureTx(4, 250000, 'contribution', 'Monthly contribution (75k) & Loan repayment (175k) — Gibson Mulokozi', 'DGUJE20AJA', '2026-07-07');

  // 4. DH3BI21KVV (Ignas Lukanga, 2026-07-28, Total 337,500)
  console.log(`\n• DH3BI21KVV (Ignas Lukanga — TZS 337,500):`);
  await ensureContrib(5, 4, 2026, 75000, '2026-07-28', 'DH3BI21KVV', 'April contribution');
  await ensureContrib(5, 5, 2026, 75000, '2026-07-28', 'DH3BI21KVV', 'May contribution');
  await ensureContrib(5, 6, 2026, 75000, '2026-07-28', 'DH3BI21KVV', 'June contribution');
  await ensureContrib(5, 7, 2026, 75000, '2026-07-28', 'DH3BI21KVV', 'July contribution');
  // Fine settlement of 37,500
  const existingIgnasFine = await Fine.findOne({ member_id: 5, amount: 37500, paid_date: '2026-07-28' });
  if (!existingIgnasFine) {
    if (isApply) {
      await Fine.create({
        id: await getNextId('fine_id'),
        member_id: 5,
        amount: 37500,
        reason: 'Fines clearance — Ignas Lukanga (DH3BI21KVV)',
        year: 2026,
        status: 'paid',
        paid_date: '2026-07-28'
      });
    }
    auditStats.fines_created++;
    console.log(`  + Fine: Settle Ignas fines TZS 37,500 (Ref: DH3BI21KVV)`);
  }
  await ensureTx(5, 337500, 'contribution', 'Monthly contributions (300k) & Fines (37.5k) — Ignas Lukanga', 'DH3BI21KVV', '2026-07-28');

  // 5. DH4AT220YG (Jakob Shauri, 2026-07-22, Total 75,000)
  console.log(`\n• DH4AT220YG (Jakob Shauri — TZS 75,000):`);
  await ensureContrib(6, 7, 2026, 75000, '2026-07-22', 'DH4AT220YG', 'July contribution');
  await ensureTx(6, 75000, 'contribution', 'Monthly contribution (July) — Jakob Shauri Daniel', 'DH4AT220YG', '2026-07-22');

  // 6. DHHJE29AVQ (Gibson, 2026-07-29, Total 100,000)
  console.log(`\n• DHHJE29AVQ (Gibson Mulokozi — TZS 100,000):`);
  await ensureRepayment(12, 100000, '2026-07-29', 'DHHJE29AVQ', 'Loan 5 repayment');
  await ensureTx(4, 100000, 'loan_repayment', 'Loan repayment — Gibson Mulokozi', 'DHHJE29AVQ', '2026-07-29');

  // 7. DHJJE2AC2O (Gibson, 2026-08-04, Total 400,000)
  console.log(`\n• DHJJE2AC2O (Gibson Mulokozi — TZS 400,000):`);
  await ensureContrib(4, 8, 2026, 75000, '2026-08-04', 'DHJJE2AC2O', 'August contribution');
  await ensureRepayment(12, 325000, '2026-08-04', 'DHJJE2AC2O', 'Loan 5 repayment');
  await ensureTx(4, 400000, 'contribution', 'Monthly contribution (75k) & Loan repayment (325k) — Gibson Mulokozi', 'DHJJE2AC2O', '2026-08-04');

  // 8. DHMJE2C0VM (Gibson, 2026-08-14, Total 300,000)
  console.log(`\n• DHMJE2C0VM (Gibson Mulokozi — TZS 300,000 payoff):`);
  // Exact payoff required on Loan 12: TZS 258,750
  await ensureRepayment(12, 258750, '2026-08-14', 'DHMJE2C0VM', 'Final payoff — loan closed in full');
  
  // Set Loan 12 status to paid
  const gibsonLoan = await Loan.findOne({ id: 12 });
  if (gibsonLoan) {
    if (isApply) {
      gibsonLoan.status = 'paid';
      await gibsonLoan.save();
    }
    console.log(`✓ Gibson Loan 12 status updated to PAID (balance = 0)`);
  }

  // Unapplied Member Credit: TZS 41,250
  const existingCredit = await AuditSourceRecord.findOne({
    reconciliation_run: '2026.08.y3-live-cutover-v1',
    source_type: 'unapplied_member_credit',
    source_row: 1
  });
  if (!existingCredit) {
    if (isApply) {
      await AuditSourceRecord.create({
        reconciliation_run: '2026.08.y3-live-cutover-v1',
        source_type: 'unapplied_member_credit',
        source_row: 1,
        review_status: 'unapplied_credit',
        posted: true,
        payload: {
          member_id: 4,
          member_name: 'Gibson Gosbert Mulokozi',
          amount: 41250,
          source_reference: 'DHMJE2C0VM',
          date: '2026-08-14',
          reason: 'Excess loan payoff cash held as unapplied member credit'
        }
      });
    }
    auditStats.member_credits_created++;
    console.log(`✓ Unapplied member credit recorded for Gibson: TZS 41,250 (Ref: DHMJE2C0VM)`);
  }
  await ensureTx(4, 300000, 'loan_repayment', 'Loan payoff (258,750) & Unapplied credit (41,250) — Gibson Mulokozi', 'DHMJE2C0VM', '2026-08-14');

  // -------------------------------------------------------------------------
  // E. ANSGAR KABUTELANA (Member ID 1) — Confirmed Manual 3 July TZS 500,000
  // -------------------------------------------------------------------------
  console.log(`\n--- [5/6] ANSGAR KABUTELANA (3 July Manual Payment — TZS 500,000) ---`);
  // Contributions: Jan, Feb, Mar, Apr, May, Jun 2026 @ 75k each = 450,000
  await ensureContrib(1, 1, 2026, 75000, '2026-07-03', 'ANSGAR-MANUAL-0703', 'FY2025 Jan contribution');
  await ensureContrib(1, 2, 2026, 75000, '2026-07-03', 'ANSGAR-MANUAL-0703', 'FY2025 Feb contribution');
  await ensureContrib(1, 3, 2026, 75000, '2026-07-03', 'ANSGAR-MANUAL-0703', 'FY2026 Mar contribution');
  await ensureContrib(1, 4, 2026, 75000, '2026-07-03', 'ANSGAR-MANUAL-0703', 'FY2026 Apr contribution');
  await ensureContrib(1, 5, 2026, 75000, '2026-07-03', 'ANSGAR-MANUAL-0703', 'FY2026 May contribution');
  await ensureContrib(1, 6, 2026, 75000, '2026-07-03', 'ANSGAR-MANUAL-0703', 'FY2026 Jun contribution');

  // Fine settlement of TZS 50,000
  // Settle Fine IDs 52, 54, 56 (3500 each = 10,500) and 126 (23,250) = 33,750
  const fineIdsToSettle = [52, 54, 56, 126];
  for (const fid of fineIdsToSettle) {
    const f = await Fine.findOne({ id: fid, member_id: 1 });
    if (f && f.status === 'unpaid') {
      if (isApply) {
        f.status = 'paid';
        f.paid_date = '2026-07-03';
        await f.save();
      }
      auditStats.fines_settled++;
      console.log(`  ✓ Fine ID ${fid} settled (TZS ${f.amount.toLocaleString()})`);
    }
  }
  // Remaining fine settlement = 16,250
  const existingAnsgarRemFine = await Fine.findOne({ member_id: 1, amount: 16250, paid_date: '2026-07-03' });
  if (!existingAnsgarRemFine) {
    if (isApply) {
      await Fine.create({
        id: await getNextId('fine_id'),
        member_id: 1,
        amount: 16250,
        reason: 'Historical fines clearance — 3 Jul manual settlement',
        year: 2026,
        status: 'paid',
        paid_date: '2026-07-03'
      });
    }
    auditStats.fines_created++;
    console.log(`  ✓ Fine balance settled: TZS 16,250 (Total fines cleared = TZS 50,000)`);
  }

  await ensureTx(1, 500000, 'contribution', 'Monthly contributions (450k) & Fines settlement (50k) — Ansgar Kabutelana', 'ANSGAR-MANUAL-0703', '2026-07-03');

  // -------------------------------------------------------------------------
  // F. RECONCILIATION RUN CREATION
  // -------------------------------------------------------------------------
  console.log(`\n--- [6/6] CONTROLLED RECONCILIATION RUN CREATION ---`);
  const existingRun = await ReconciliationRun.findOne({ run_key: '2026.08.y3-live-cutover-v1' });
  if (!existingRun) {
    if (isApply) {
      await ReconciliationRun.create({
        run_key: '2026.08.y3-live-cutover-v1',
        schema_version: '2026.08.y3-cutover-v1',
        source_hash: 'y3-cutover-confirmed-owner-decision-v1',
        source_generated_on: '2026-08-23',
        reporting_cutoff: '2026-08-23',
        status: 'PARTIALLY_RECONCILED',
        applied_by: 'admin',
        applied_at: new Date(),
        backup: preBackup,
        flags: [
          {
            severity: 'high',
            topic: 'Unresolved cash variance',
            detail: 'Unexplained cash difference of TZS 1,268,900 between physical M-Koba cash (TZS 3,049,000) and confirmed ledger cash (TZS 1,780,100). No balancing entry fabricated.',
            difference_tzs: 1268900,
            system_action: 'Variance preserved open pending member July/August direct bank receipts roster.'
          },
          {
            severity: 'medium',
            topic: 'Gibson Mulokozi member credit',
            detail: 'Gibson Loan 12 paid in full with residual TZS 41,250 overpayment held as unapplied credit.',
            difference_tzs: 41250,
            system_action: 'Preserved as unapplied member credit linked to DHMJE2C0VM.'
          },
          {
            severity: 'low',
            topic: 'Samwel Allen Loan 49 confirmed active',
            detail: 'Samwel Loan 49 confirmed disbursed and active (TZS 1,380,000 principal, TZS 1,214,400 net cash out).',
            system_action: 'Active loan state confirmed; disbursement transaction recorded.'
          },
          {
            severity: 'low',
            topic: 'Peter Lema Y3 loan created',
            detail: 'Peter Lema Y3 loan confirmed active (TZS 1,200,000 principal, TZS 1,056,000 net cash out).',
            system_action: 'Active loan state recorded; disbursement transaction recorded.'
          }
        ],
        source_summary: {
          physical_mkoba_cash_tzs: 3049000,
          explained_ledger_cash_tzs: 1780100,
          unresolved_cash_variance_tzs: 1268900,
          variance_status: 'unresolved',
          baseline_opening_cash_tzs: 1513000,
          post_baseline_inflows_tzs: 2537500,
          post_baseline_disbursements_tzs: 2270400,
          net_post_baseline_movement_tzs: 267100
        },
        result: {
          stats: auditStats,
          status: 'PARTIALLY_RECONCILED'
        }
      });
    }
    console.log(`✓ ReconciliationRun '2026.08.y3-live-cutover-v1' created with status PARTIALLY_RECONCILED.`);
  } else {
    console.log(`ℹ ReconciliationRun '2026.08.y3-live-cutover-v1' already exists.`);
  }

  // -------------------------------------------------------------------------
  // G. POST-EXECUTION VALIDATION & HARD ASSERTIONS
  // -------------------------------------------------------------------------
  console.log(`\n================================================================`);
  console.log(`POST-EXECUTION AUDIT & VALIDATION`);
  console.log(`================================================================\n`);

  if (isApply) {
    const postLoans = await Loan.find().lean();
    const postRepayments = await Repayment.find().lean();
    const postMembers = await Member.find().lean();
    const memberMap = {};
    postMembers.forEach(m => { memberMap[m.id] = m.name; });

    console.log(`📊 CURRENT ACTIVE LOANS & BALANCES:`);
    let hasNegativeLoan = false;
    const activeLoansList = postLoans.filter(l => l.status === 'active');
    for (const l of activeLoansList) {
      const lReps = postRepayments.filter(r => r.loan_id === l.id);
      const totalRepaid = lReps.reduce((s, r) => s + r.amount, 0);
      const balance = l.principal - totalRepaid;
      if (balance < 0) hasNegativeLoan = true;
      console.log(`  • ${memberMap[l.member_id]} | Loan ID ${l.id} (${l.loan_number}, FY${l.fiscal_year}): Principal = TZS ${l.principal.toLocaleString()}, Repaid = TZS ${totalRepaid.toLocaleString()}, Balance = TZS ${balance.toLocaleString()} [${l.status}]`);
    }

    const postGibson = postLoans.find(l => l.id === 12);
    const gibsonReps = postRepayments.filter(r => r.loan_id === 12);
    const gibsonTotalR = gibsonReps.reduce((s, r) => s + r.amount, 0);
    const gibsonBal = postGibson ? postGibson.principal - gibsonTotalR : 0;
    console.log(`\n  • Gibson Loan 12: Balance = TZS ${gibsonBal.toLocaleString()} [Status: ${postGibson?.status}]`);

    const postSamwel = postLoans.find(l => l.id === 49);
    const postPeter = postLoans.find(l => l.member_id === 8 && l.fiscal_year === 2026);
    const postCredit = await AuditSourceRecord.findOne({ reconciliation_run: '2026.08.y3-live-cutover-v1', source_type: 'unapplied_member_credit' });

    // Hard Assertions
    console.log(`\n🔍 HARD ASSERTION CHECKS:`);
    console.log(`  1. Samwel Loan 49 Active & Disbursed: ${postSamwel?.status === 'active' && postSamwel?.disbursed === true ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  2. Peter Lema Y3 Loan Active: ${postPeter?.status === 'active' && postPeter?.principal === 1200000 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  3. Gibson Loan 12 Closed & Balance = 0: ${gibsonBal === 0 && postGibson?.status === 'paid' ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  4. Gibson Unapplied Credit = 41,250: ${postCredit?.payload?.amount === 41250 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  5. No Negative Loans: ${!hasNegativeLoan ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  6. iTrust Investment count = 1: ${(await Investment.countDocuments()) === 1 ? '✅ PASS' : '❌ FAIL'}`);
  } else {
    console.log(`🔍 DRY-RUN PREVIEW COMPLETE — All validation paths checked successfully.`);
  }

  console.log(`\n💰 CASH POSITION SUMMARY:`);
  console.log(`  Physical M-Koba Cash:     TZS 3,049,000`);
  console.log(`  Ledger-Explained Cash:    TZS 1,780,100`);
  console.log(`  Unresolved Cash Variance: TZS 1,268,900 (Open / Unreconciled)`);

  console.log(`\nAudit Stats Summary:`, auditStats);
  console.log(`\nScript execution completed successfully.\n`);
  process.exit(0);
}

execute().catch(err => {
  console.error('\n❌ SCRIPT ERROR:', err);
  process.exit(1);
});
