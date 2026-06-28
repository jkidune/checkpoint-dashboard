const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  Counter, Member, Contribution, Loan, Repayment, Transaction, Expense, Investment,
  ReconciliationRun, AuditLog,
} = require('../db/models');

const SCHEMA_VERSION = '2026.06.reconciled-v2';
const FY_BY_LABEL = { Y1: 2024, Y2: 2025, Y3: 2026 };
const CURRENT_NAME_OVERRIDES = new Map(Object.entries({
  'ansgar thomas kabutelana': 'Ansgar Kabutelana',
  'elias prosper wakara': 'Elias Wakara',
  'emmanuel giddamis': 'Emmanuel Gidamis',
  'gibson gosbert mulokozi': 'Gibson Mulokozi',
  'jakob shauri daniel': 'Jakob Daniel',
  'william george mattao': 'William Mattao',
}));

function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function context(source) {
  if (
    source?.schema_version !== SCHEMA_VERSION
    || !source.reporting_cutoff
    || !source.cash_reconciliation
    || !source.financial_position
    || !Array.isArray(source.current_loans)
    || !source.loan_repayment_allocations
  ) throw new Error('Unsupported or incomplete June 2026 reconciliation v2 file');
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');
  return { sourceHash, runKey: `${source.schema_version}:${source.reporting_cutoff}` };
}

async function snapshot() {
  const [members, contributions, loans, repayments, transactions, expenses, investments] = await Promise.all([
    Member.find().lean(), Contribution.find().lean(), Loan.find().lean(), Repayment.find().lean(),
    Transaction.find().lean(), Expense.find().lean(), Investment.find().lean(),
  ]);
  return { members, contributions, loans, repayments, transactions, expenses, investments };
}

function memberMap(members) {
  const mapped = new Map();
  for (const member of members) {
    const normalized = normalize(member.name);
    mapped.set(normalized, member);
    const canonical = CURRENT_NAME_OVERRIDES.get(normalized);
    if (canonical) mapped.set(normalize(canonical), member);
  }
  return mapped;
}

function addMonths(dateText, months) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function repaymentRows(source) {
  return Object.entries(source.loan_repayment_allocations).flatMap(([yearLabel, rows]) =>
    rows.map((row, index) => ({ ...row, yearLabel, sourceIndex: index }))
  );
}

async function previewV2(source) {
  const { sourceHash, runKey } = context(source);
  const current = await snapshot();
  const members = memberMap(current.members);
  const missingMembers = source.member_financial_status
    .filter(item => !members.has(normalize(item.member))).map(item => item.member);
  const contributionDifferences = source.member_financial_status.flatMap(item => {
    const member = members.get(normalize(item.member));
    const currentTotal = member
      ? current.contributions.filter(row => row.member_id === member.id && row.status !== 'reconciled_void')
        .reduce((sum, row) => sum + row.amount, 0)
      : 0;
    return currentTotal === item.contributions.total ? [] : [{
      member: item.member, current_tzs: currentTotal, source_tzs: item.contributions.total,
    }];
  });
  const samwel = members.get(normalize('Samwel Lembele'));
  const samwelLoan = samwel && current.loans.find(loan =>
    loan.member_id === samwel.id && loan.fiscal_year === 2026 && loan.principal === 1380000
  );
  const investmentAction = source.system_update_actions.find(a => a.action === 'create_or_update_investment');
  const currentInvestment = investmentAction && current.investments.find(item =>
    item.reference === investmentAction.receipt_reference || item.amount === investmentAction.amount_tzs
  );

  return {
    run_key: runKey,
    source_hash: sourceHash,
    already_applied: Boolean(await ReconciliationRun.exists({ run_key: runKey, status: 'applied' })),
    current: {
      members: current.members.length, loans: current.loans.length, repayments: current.repayments.length,
      expenses: current.expenses.length, investments: current.investments.length,
    },
    proposed: {
      missing_members: missingMembers,
      contribution_total_differences: contributionDifferences,
      repayment_allocations: repaymentRows(source).length,
      current_loans: source.current_loans.length,
      cancel_samwel_loan: Boolean(samwelLoan && !['cancelled', 'voided', 'not_disbursed'].includes(samwelLoan.status)),
      samwel_loan_found: Boolean(samwelLoan),
      investment_upsert_required: !currentInvestment
        || currentInvestment.amount !== investmentAction?.amount_tzs
        || currentInvestment.reference !== investmentAction?.receipt_reference,
      expense_and_control_items: source.expenses_and_welfare.length,
    },
    blocked_from_posting: source.data_quality_flags || [],
  };
}

async function nextId(counterName, session) {
  const counter = await Counter.findByIdAndUpdate(
    counterName, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session }
  );
  return counter.seq;
}

async function audit({ recordType, recordId, action, oldValue, newValue, reason, user, runKey, session }) {
  await AuditLog.create([{
    record_type: recordType, record_id: recordId, action, old_value: oldValue, new_value: newValue,
    reason, user, reconciliation_run: runKey,
  }], { session });
}

async function upsertLedgerEntry(values, runKey, user, session) {
  let entry = await Transaction.findOne({ reconciliation_key: values.reconciliation_key }).session(session).lean();
  if (!entry && values.reference) {
    entry = await Transaction.findOne({
      reference: values.reference, type: values.type, amount: values.amount,
    }).session(session).lean();
  }
  if (!entry) {
    entry = await Transaction.findOne({
      member_id: values.member_id ?? null,
      transaction_date: values.transaction_date,
      type: values.type,
      amount: values.amount,
      status: { $ne: 'voided' },
    }).session(session).lean();
  }
  if (entry) {
    await Transaction.updateOne({ _id: entry._id }, { $set: values }, { session });
    return { ...entry, ...values };
  }
  const [created] = await Transaction.create([{
    id: await nextId('transaction_id', session), ...values, created_by: user,
  }], { session });
  return created.toObject();
}

async function findLoanForAllocation({ allocation, members, currentLoanMap, session }) {
  const member = members.get(normalize(allocation.member));
  if (!member) return null;
  const currentKey = `${normalize(allocation.member)}:${normalize(allocation.loan_no)}`;
  const sourceLoan = currentLoanMap.get(currentKey);
  if (sourceLoan) {
    return Loan.findOne({
      member_id: member.id, loan_number: sourceLoan.loan_no, issued_date: sourceLoan.issue_date,
    }).session(session).lean();
  }
  const candidates = await Loan.find({
    member_id: member.id,
    loan_number: allocation.loan_no,
    status: { $nin: ['cancelled', 'voided', 'not_disbursed'] },
  }).sort({ issued_date: 1 }).session(session).lean();
  if (!candidates.length) return null;
  const sameFiscalYear = candidates.filter(loan => loan.fiscal_year === FY_BY_LABEL[allocation.yearLabel]);
  const pool = sameFiscalYear.length ? sameFiscalYear : candidates;
  if (allocation.yearLabel === 'Y1') return pool[0];
  const eligible = pool.filter(loan => !loan.issued_date || loan.issued_date <= allocation.payment_date);
  return (eligible.length ? eligible : pool)[(eligible.length ? eligible : pool).length - 1];
}

async function applyV2(source, user) {
  const { sourceHash, runKey } = context(source);
  const prior = await ReconciliationRun.findOne({ run_key: runKey }).lean();
  if (prior?.status === 'applied') return { idempotent: true, run_key: runKey, result: prior.result };
  if (prior && prior.source_hash !== sourceHash) throw Object.assign(new Error('Run key exists with a different source hash'), { statusCode: 409 });

  const backup = prior?.backup || await snapshot();
  await ReconciliationRun.findOneAndUpdate({ run_key: runKey }, {
    $setOnInsert: {
      run_key: runKey, source_hash: sourceHash, schema_version: source.schema_version,
      source_generated_on: source.reporting_cutoff, reporting_cutoff: source.reporting_cutoff,
      backup, created_at: new Date(),
    },
    $set: {
      status: 'applying', applied_by: user,
      source_summary: { cash_reconciliation: source.cash_reconciliation, financial_position: source.financial_position },
      flags: source.data_quality_flags || [],
    },
  }, { upsert: true, returnDocument: 'after' });

  const result = {
    loans_upserted: 0, loans_cancelled: 0, repayment_allocations_upserted: 0,
    repayment_allocations_unmatched: 0, investments_upserted: 0, expenses_upserted: 0,
    prior_reconciliation_adjustments_voided: 0, ledger_entries_upserted: 0,
    contribution_total_differences: [], balance_checks: [],
  };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const currentMembers = await Member.find().session(session).lean();
      const members = memberMap(currentMembers);
      const missing = source.member_financial_status.filter(item => !members.has(normalize(item.member)));
      if (missing.length) throw new Error(`Members missing from production: ${missing.map(item => item.member).join(', ')}`);

      for (const item of source.member_financial_status) {
        const member = members.get(normalize(item.member));
        const actual = await Contribution.find({ member_id: member.id, status: { $ne: 'reconciled_void' } })
          .session(session).lean();
        const actualTotal = actual.reduce((sum, row) => sum + row.amount, 0);
        if (actualTotal !== item.contributions.total) result.contribution_total_differences.push({
          member: item.member, current_tzs: actualTotal, source_tzs: item.contributions.total,
          note: 'Monthly contribution detail is not present in v2 JSON; difference flagged without overwriting records.',
        });
      }

      const currentLoanMap = new Map();
      for (const sourceLoan of source.current_loans) {
        const member = members.get(normalize(sourceLoan.member));
        const fiscalYear = sourceLoan.origin.startsWith('New Y3') ? 2026 : 2025;
        let loan = await Loan.findOne({
          member_id: member.id, issued_date: sourceLoan.issue_date, principal: sourceLoan.original_principal_tzs,
        }).session(session).lean();
        const values = {
          member_id: member.id, loan_number: sourceLoan.loan_no,
          principal: sourceLoan.original_principal_tzs, interest_rate: sourceLoan.interest_rate,
          interest_amount: sourceLoan.interest_tzs, amount_deposited: sourceLoan.net_disbursed_tzs,
          issued_date: sourceLoan.issue_date,
          due_date: fiscalYear === 2026 ? addMonths(sourceLoan.issue_date, 6) : loan?.due_date || null,
          status: 'active', fiscal_year: fiscalYear, disbursed: true,
          reconciliation_key: `recon:${runKey}:loan:${normalize(sourceLoan.member)}:${normalize(sourceLoan.loan_no)}`,
          notes: sourceLoan.notes,
        };
        if (loan) await Loan.updateOne({ _id: loan._id }, { $set: values }, { session });
        else {
          const [created] = await Loan.create([{ id: await nextId('loan_id', session), ...values }], { session });
          loan = created.toObject();
        }
        currentLoanMap.set(`${normalize(sourceLoan.member)}:${normalize(sourceLoan.loan_no)}`, { ...sourceLoan, id: loan.id });
        result.loans_upserted += 1;
      }

      const cancelAction = source.system_update_actions.find(action => action.action === 'remove_or_archive_undisbursed_loan');
      if (cancelAction) {
        const member = members.get(normalize(cancelAction.member));
        const loan = await Loan.findOne({
          member_id: member.id, fiscal_year: FY_BY_LABEL[cancelAction.fiscal_year], principal: cancelAction.principal_tzs,
        }).session(session).lean();
        if (loan) {
          const loanUpdates = {
            status: cancelAction.required_status, disbursed: false,
            cancellation_reason: cancelAction.reason, cancelled_at: new Date(),
          };
          const newValue = { ...loan, ...loanUpdates };
          await Loan.updateOne({ _id: loan._id }, { $set: loanUpdates }, { session });
          await audit({ recordType: 'loan', recordId: loan.id, action: 'not_disbursed', oldValue: loan,
            newValue, reason: cancelAction.reason, user, runKey, session });
          const disbursement = await Transaction.findOne({
            member_id: member.id, type: 'loan_disbursement', amount: cancelAction.principal_tzs,
          }).session(session).lean();
          if (disbursement) {
            const transactionUpdates = { status: 'voided', cash_impact: 0, loan_impact: 0,
              audit_note: cancelAction.reason, last_edited_by: user };
            const voided = { ...disbursement, ...transactionUpdates };
            await Transaction.updateOne({ _id: disbursement._id }, { $set: transactionUpdates }, { session });
            await audit({ recordType: 'transaction', recordId: disbursement.id, action: 'void', oldValue: disbursement,
              newValue: voided, reason: cancelAction.reason, user, runKey, session });
          }
          result.loans_cancelled += 1;
        } else {
          await audit({ recordType: 'loan', recordId: `${cancelAction.member}:${cancelAction.loan_no}`,
            action: 'confirmed_not_disbursed', oldValue: null, newValue: cancelAction,
            reason: cancelAction.reason, user, runKey, session });
        }
      }

      const cleanedLoanAdjustments = new Set();
      for (const allocation of repaymentRows(source)) {
        const loan = await findLoanForAllocation({ allocation, members, currentLoanMap, session });
        if (!loan) { result.repayment_allocations_unmatched += 1; continue; }
        if (!cleanedLoanAdjustments.has(loan.id)) {
          const priorAdjustments = await Repayment.find({
            loan_id: loan.id,
            status: { $ne: 'voided' },
            $or: [
              { mpesa_ref: /^recon:checkpoint-reconciliation-v1:/ },
              { notes: /signed adjustment to source repayment total/i },
            ],
          }).session(session).lean();
          for (const priorAdjustment of priorAdjustments) {
            const repaymentUpdates = { status: 'voided', notes: `${priorAdjustment.notes || ''} | Superseded by itemised June 2026 v2 repayment allocations.` };
            const voided = { ...priorAdjustment, ...repaymentUpdates };
            await Repayment.updateOne({ _id: priorAdjustment._id }, { $set: repaymentUpdates }, { session });
            await audit({
              recordType: 'loan_repayment', recordId: priorAdjustment.id, action: 'void_aggregate_adjustment',
              oldValue: priorAdjustment, newValue: voided,
              reason: 'Replaced by traceable itemised repayment records from reconciliation v2.',
              user, runKey, session,
            });
            result.prior_reconciliation_adjustments_voided += 1;
          }
          cleanedLoanAdjustments.add(loan.id);
        }
        const member = members.get(normalize(allocation.member));
        const key = `recon:${runKey}:repayment:${allocation.yearLabel}:${allocation.sourceIndex}`;
        const values = {
          loan_id: loan.id, member_id: member.id, amount: allocation.amount_tzs,
          repayment_date: allocation.payment_date, fiscal_year: FY_BY_LABEL[allocation.yearLabel],
          repayment_month: Number(allocation.payment_date.slice(5, 7)),
          reference_number: allocation.evidence || null, payment_source: allocation.source || null,
          mpesa_ref: /^[A-Z0-9]{8,}$/.test(allocation.evidence || '') ? allocation.evidence : null,
          status: 'posted', reconciliation_key: key,
          notes: `${allocation.status}; reporting bucket: ${allocation.reporting_bucket}`,
        };
        let repayment = await Repayment.findOne({ reconciliation_key: key }).session(session).lean();
        if (!repayment) repayment = await Repayment.findOne({
          loan_id: loan.id, repayment_date: allocation.payment_date, amount: allocation.amount_tzs,
        }).session(session).lean();
        if (repayment) await Repayment.updateOne({ _id: repayment._id }, { $set: values }, { session });
        else await Repayment.create([{ id: await nextId('repayment_id', session), ...values }], { session });
        await upsertLedgerEntry({
          member_id: member.id, amount: allocation.amount_tzs, type: 'loan_repayment',
          description: `Loan repayment - ${allocation.member} (${allocation.loan_no})`,
          reference: allocation.evidence || null, transaction_date: allocation.payment_date,
          fiscal_year: FY_BY_LABEL[allocation.yearLabel], credit: allocation.amount_tzs,
          cash_impact: allocation.amount_tzs, loan_impact: -allocation.amount_tzs,
          approval_status: 'approved', status: 'posted', audit_note: allocation.status,
          reconciliation_key: `recon:${runKey}:ledger:repayment:${allocation.yearLabel}:${allocation.sourceIndex}`,
        }, runKey, user, session);
        result.repayment_allocations_upserted += 1;
        result.ledger_entries_upserted += 1;
      }
      if (result.repayment_allocations_unmatched > 0) {
        throw new Error(`${result.repayment_allocations_unmatched} repayment allocations could not be matched to a loan; reconciliation was not applied.`);
      }

      const investmentAction = source.system_update_actions.find(action => action.action === 'create_or_update_investment');
      if (investmentAction) {
        const key = `recon:${runKey}:investment:${investmentAction.receipt_reference}`;
        await Investment.findOneAndUpdate(
          { $or: [{ reconciliation_key: key }, { reference: investmentAction.receipt_reference }] },
          { $set: {
            provider: 'Itrust financial market', investment_name: investmentAction.investment_name,
            asset_class: 'financial_market', amount: investmentAction.amount_tzs,
            carrying_value: investmentAction.amount_tzs, transaction_date: investmentAction.transaction_date,
            reference: investmentAction.receipt_reference, cash_impact: -investmentAction.amount_tzs,
            status: 'active', verification_status: 'provider statement pending',
            action_required: investmentAction.note, reconciliation_key: key,
            source: 'Checkpoint June 2026 reconciliation v2', updated_at: new Date(),
          }, $setOnInsert: { created_at: new Date() } },
          { upsert: true, returnDocument: 'after', session }
        );
        await upsertLedgerEntry({
          member_id: null, amount: investmentAction.amount_tzs, type: 'investment_transfer',
          description: investmentAction.investment_name, reference: investmentAction.receipt_reference,
          transaction_date: investmentAction.transaction_date, fiscal_year: 2026,
          debit: investmentAction.amount_tzs, cash_impact: -investmentAction.amount_tzs,
          investment_impact: investmentAction.amount_tzs, approval_status: 'approved', status: 'posted',
          audit_note: 'Investment asset at cost; not an expense.',
          reconciliation_key: `recon:${runKey}:ledger:investment:${investmentAction.receipt_reference}`,
        }, runKey, user, session);
        result.investments_upserted += 1;
        result.ledger_entries_upserted += 1;
      }

      for (const [index, item] of source.expenses_and_welfare.entries()) {
        const key = `recon:${runKey}:expense:${index}`;
        let expense = item.reference
          ? await Expense.findOne({ reference: item.reference }).session(session).lean()
          : await Expense.findOne({ category: item.category, amount: item.amount_tzs, expense_date: item.date }).session(session).lean();
        const values = {
          category: item.category, description: item.description, amount: item.amount_tzs,
          expense_date: item.date, fiscal_year: 2026, reference: item.reference || null,
          cash_effect: item.cash_effect, status: item.cash_effect ? 'approved' : 'control_only',
          reconciliation_key: key,
          notes: item.cash_effect ? 'Reconciled cash item.' : 'Non-cash governance/control exception.',
        };
        if (expense) await Expense.updateOne({ _id: expense._id }, { $set: values }, { session });
        else await Expense.create([{ id: await nextId('expense_id', session), ...values }], { session });
        await upsertLedgerEntry({
          member_id: null, amount: item.amount_tzs,
          type: item.category === 'Welfare' ? 'welfare_payment' : (item.cash_effect ? 'group_expense' : 'control_exception'),
          description: item.description, reference: item.reference || null, transaction_date: item.date,
          fiscal_year: 2026, debit: item.cash_effect ? item.amount_tzs : 0,
          cash_impact: item.cash_effect ? -item.amount_tzs : 0,
          approval_status: item.cash_effect ? 'approved' : 'control_only', status: 'posted',
          audit_note: item.cash_effect ? null : 'Non-cash control item; excluded from cash and expense totals.',
          reconciliation_key: `recon:${runKey}:ledger:expense:${index}`,
        }, runKey, user, session);
        result.expenses_upserted += 1;
        result.ledger_entries_upserted += 1;
      }

      for (const sourceLoan of source.current_loans) {
        const mapped = currentLoanMap.get(`${normalize(sourceLoan.member)}:${normalize(sourceLoan.loan_no)}`);
        const total = await Repayment.find({ loan_id: mapped.id, status: { $ne: 'voided' } }).session(session).lean();
        const totalRepaid = total.reduce((sum, row) => sum + row.amount, 0);
        result.balance_checks.push({
          member: sourceLoan.member, loan_no: sourceLoan.loan_no,
          calculated_balance_tzs: sourceLoan.original_principal_tzs - totalRepaid,
          expected_balance_tzs: sourceLoan.current_balance_tzs,
          status: sourceLoan.original_principal_tzs - totalRepaid === sourceLoan.current_balance_tzs ? 'ok' : 'review',
        });
      }
      const failedBalances = result.balance_checks.filter(check => check.status !== 'ok');
      if (failedBalances.length) {
        throw new Error(`Loan repayment checks failed for: ${failedBalances.map(check => `${check.member} ${check.loan_no}`).join(', ')}`);
      }
    });

    await ReconciliationRun.updateOne({ run_key: runKey }, {
      $set: { status: 'applied', result, applied_at: new Date() },
    });
    return { idempotent: false, run_key: runKey, source_hash: sourceHash, result };
  } catch (error) {
    await ReconciliationRun.updateOne({ run_key: runKey }, {
      $set: { status: 'failed', result: { ...result, error: error.message } },
    });
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { SCHEMA_VERSION, previewV2, applyV2 };
