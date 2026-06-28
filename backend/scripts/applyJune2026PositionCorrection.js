require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const connectDB = require('../db/mongoose');
const {
  Member, Loan, Transaction, Expense, Investment, ReconciliationRun, AuditLog, getNextId,
} = require('../db/models');

const input = process.argv[2];
if (!input) throw new Error('Reconciliation JSON path required');
const source = JSON.parse(fs.readFileSync(input, 'utf8'));
const action = source.system_update_actions.find(item => item.action === 'create_or_update_investment');
Object.assign(action, {
  transaction_date: '2026-06-19',
  receipt_reference: '0619H6M2K',
  note: 'Selcom transfer to I GROWTH COLLECTIONS ACCOUNT - NBC (047188000078), first investment for Checkpoint Investment Club. Receipt shows TZS 1,900 charges; not separately posted because confirmed M-Koba cash already reconciles to TZS 1,513,000.',
});

const runKey = `${source.schema_version}:${source.reporting_cutoff}`;
const sourceHash = crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');

(async () => {
  await connectDB();
  const session = await mongoose.startSession();
  const result = {
    position_only: true,
    investment_recorded: false,
    samwel_loan_marked_not_disbursed: false,
    linked_disbursement_voided: false,
    loan_override_marked_non_cash: false,
    repayment_allocations_deferred: Object.values(source.loan_repayment_allocations).flat().length,
  };

  try {
    await session.withTransaction(async () => {
      const samwel = await Member.findOne({ name: /Samwel Lembele/i }).session(session).lean();
      if (!samwel) throw new Error('Samwel Lembele member record not found');
      const loan = await Loan.findOne({ member_id: samwel.id, fiscal_year: 2026, principal: 1380000 }).session(session).lean();
      if (!loan) throw new Error('Samwel Lembele TZS 1,380,000 Y3 loan not found');
      const loanUpdates = {
        status: 'not_disbursed', disbursed: false,
        cancellation_reason: 'Loan proposal did not go through; no matching group transfer exists.',
        cancelled_at: new Date(),
      };
      await Loan.updateOne({ _id: loan._id }, { $set: loanUpdates }, { session });
      await AuditLog.create([{
        record_type: 'loan', record_id: loan.id, action: 'not_disbursed', old_value: loan,
        new_value: { ...loan, ...loanUpdates }, reason: loanUpdates.cancellation_reason,
        user: 'admin', reconciliation_run: runKey,
      }], { session });
      result.samwel_loan_marked_not_disbursed = true;

      const disbursement = await Transaction.findOne({
        member_id: samwel.id, type: 'loan_disbursement', amount: 1380000,
      }).session(session).lean();
      if (disbursement) {
        const updates = { status: 'voided', cash_impact: 0, loan_impact: 0,
          audit_note: loanUpdates.cancellation_reason, last_edited_by: 'admin' };
        await Transaction.updateOne({ _id: disbursement._id }, { $set: updates }, { session });
        await AuditLog.create([{
          record_type: 'transaction', record_id: disbursement.id, action: 'void', old_value: disbursement,
          new_value: { ...disbursement, ...updates }, reason: loanUpdates.cancellation_reason,
          user: 'admin', reconciliation_run: runKey,
        }], { session });
        result.linked_disbursement_voided = true;
      }

      const investmentValues = {
        provider: 'I GROWTH COLLECTIONS ACCOUNT - NBC',
        investment_name: 'Itrust financial-market investment', asset_class: 'financial_market',
        amount: 5000000, carrying_value: 5000000, transaction_date: '2026-06-19',
        reference: '0619H6M2K', cash_impact: -5000000, status: 'active',
        verification_status: 'transfer receipt verified; provider statement pending',
        action_required: action.note, reconciliation_key: `recon:${runKey}:investment:0619H6M2K`,
        source: 'Selcom receipt and June 2026 reconciliation', updated_at: new Date(),
      };
      const existingInvestment = await Investment.findOne({
        $or: [{ amount: 5000000 }, { reference: '0619H6M2K' }, { reference: 'DFI4V1FTU9' }],
      }).session(session).lean();
      let investment;
      if (existingInvestment) {
        investment = await Investment.findByIdAndUpdate(existingInvestment._id, { $set: investmentValues }, { new: true, session }).lean();
      } else {
        const [created] = await Investment.create([{ ...investmentValues, created_at: new Date() }], { session });
        investment = created.toObject();
      }
      await AuditLog.create([{
        record_type: 'investment', record_id: investment._id.toString(), action: existingInvestment ? 'reconcile' : 'create',
        old_value: existingInvestment, new_value: investment,
        reason: 'Record the TZS 5,000,000 transfer as an investment asset separate from M-Koba cash.',
        user: 'admin', reconciliation_run: runKey,
      }], { session });
      result.investment_recorded = true;

      let investmentTx = await Transaction.findOne({
        type: 'investment_transfer', amount: 5000000,
      }).session(session).lean();
      const investmentTxValues = {
        member_id: null, amount: 5000000, type: 'investment_transfer',
        description: 'First investment for Checkpoint Investment Club - I GROWTH COLLECTIONS ACCOUNT / NBC',
        reference: '0619H6M2K', transaction_date: '2026-06-19', fiscal_year: 2026,
        debit: 5000000, credit: 0, cash_impact: -5000000, loan_impact: 0,
        investment_impact: 5000000, approval_status: 'approved', status: 'posted',
        audit_note: 'Investment asset at cost; not an expense. Receipt charges noted but not separately posted.',
        reconciliation_key: `recon:${runKey}:ledger:investment:0619H6M2K`, last_edited_by: 'admin',
      };
      if (investmentTx) await Transaction.updateOne({ _id: investmentTx._id }, { $set: investmentTxValues }, { session });
      else await Transaction.create([{ id: await getNextId('transaction_id'), ...investmentTxValues, created_by: 'admin' }], { session });

      const override = await Expense.findOne({ category: 'Loan Override', amount: 420000 }).session(session).lean();
      if (override) {
        await Expense.updateOne({ _id: override._id }, { $set: {
          cash_effect: false, status: 'control_only',
          notes: 'Eligibility/control exception only; excluded from cash expenses and M-Koba balance.',
        } }, { session });
        result.loan_override_marked_non_cash = true;
      }

      await ReconciliationRun.findOneAndUpdate({ run_key: runKey }, {
        $set: {
          source_hash: sourceHash, schema_version: source.schema_version,
          source_generated_on: source.reporting_cutoff, reporting_cutoff: source.reporting_cutoff,
          status: 'applied', result,
          source_summary: { cash_reconciliation: source.cash_reconciliation, financial_position: source.financial_position },
          flags: [
            ...(source.data_quality_flags || []),
            { type: 'position_only_application', scope: 'June 2026 correction', detail: 'Investment, cash, Samwel non-disbursement and non-cash override applied. Historical repayment allocations remain deferred.' },
          ],
          applied_by: 'admin', applied_at: new Date(),
        },
      }, { upsert: true, returnDocument: 'after', session });
    });
    console.log(JSON.stringify({ run_key: runKey, result }, null, 2));
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
