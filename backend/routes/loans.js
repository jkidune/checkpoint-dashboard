const express = require('express');
const router = express.Router();
const { Loan, Repayment, Member, Transaction, Contribution, Expense, AuditLog, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getRulesForFY } = require('./rules');

function getMonthsDiff(d1, d2) {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  let months = (date2.getFullYear() - date1.getFullYear()) * 12;
  months -= date1.getMonth();
  months += date2.getMonth();
  return months <= 0 ? 0 : months;
}

// FY starts March, ends February of the following year.
function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

// ─── GET /rules ───────────────────────────────────────────────────────────────
// Returns the rules for the current FY (used by the frontend Loans form).
router.get('/rules', authenticate, async (req, res) => {
  const now = new Date();
  const currentFY = getFiscalYear(now.getMonth() + 1, now.getFullYear());
  const rules = await getRulesForFY(currentFY);
  res.json({
    fiscal_year:          currentFY,
    interest_rate:        rules.loan_interest_rate,
    max_loan_ratio:       rules.loan_max_ratio,
    repayment_months:     rules.loan_repayment_months,
    overdue_penalty_rate: rules.overdue_penalty_rate,
  });
});

// ─── enrichLoan ───────────────────────────────────────────────────────────────
// Attaches computed fields (total_repaid, penalty, total_owed, balance) to a loan.
async function enrichLoan(loan, rulesCache = {}) {
  const repayments  = await Repayment.find({ loan_id: loan.id, status: { $ne: 'voided' } }).lean();
  const total_repaid = repayments.reduce((s, r) => s + r.amount, 0);
  const member      = await Member.findOne({ id: loan.member_id }).lean();

  const fy = loan.fiscal_year;
  const rules = rulesCache[fy] || await getRulesForFY(fy);
  rulesCache[fy] = rules;

  let penalty = 0;
  const months_active = getMonthsDiff(loan.issued_date, new Date());
  const repayment_months = rules.loan_repayment_months;

  if (rules.overdue_penalty_enabled && loan.status !== 'paid' && repayment_months && months_active > repayment_months) {
    penalty = Math.round(loan.principal * rules.overdue_penalty_rate * (months_active - repayment_months));
  }

  const excluded = ['cancelled', 'voided', 'not_disbursed'].includes(loan.status) || loan.disbursed === false;
  const total_owed = excluded ? 0 : loan.principal + penalty;
  const balance    = Math.max(0, total_owed - total_repaid);
  return { ...loan, member_name: member ? member.name : '?', total_repaid, penalty, total_owed, balance, rules };
}

// ─── GET / ────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { fiscal_year, status, member_id } = req.query;
  const query = {};
  if (fiscal_year) query.fiscal_year = parseInt(fiscal_year);
  if (status)      query.status      = status;
  else query.status = { $nin: ['cancelled', 'voided', 'not_disbursed'] };
  if (member_id)   query.member_id   = parseInt(member_id);

  const list = await Loan.find(query).lean();
  const rulesCache = {};
  const enriched = await Promise.all(list.map(l => enrichLoan(l, rulesCache)));
  res.json(enriched.sort((a, b) => b.issued_date.localeCompare(a.issued_date)));
});

// Monthly repayment matrix. Repayments remain the only source of repayment totals.
router.get('/repayment-matrix', authenticate, async (req, res) => {
  const fiscalYear = parseInt(req.query.fiscal_year);
  if (!fiscalYear) return res.status(400).json({ error: 'fiscal_year required' });

  const repayments = await Repayment.find({ fiscal_year: fiscalYear, status: { $ne: 'voided' } }).lean();
  const loanIds = [...new Set(repayments.map(r => r.loan_id))];
  const [loanList, memberList] = await Promise.all([
    Loan.find({ id: { $in: loanIds } }).lean(),
    Member.find().lean(),
  ]);
  const memberMap = new Map(memberList.map(m => [m.id, m.name]));
  const rows = loanList.map(loan => {
    const loanRepayments = repayments.filter(r => r.loan_id === loan.id);
    const months = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, 0]));
    for (const repayment of loanRepayments) {
      const month = repayment.repayment_month || Number(String(repayment.repayment_date || '').slice(5, 7));
      if (month >= 1 && month <= 12) months[month] += repayment.amount;
    }
    const total_repaid = loanRepayments.reduce((sum, repayment) => sum + repayment.amount, 0);
    return {
      loan_id: loan.id,
      loan_number: loan.loan_number,
      member_id: loan.member_id,
      member_name: memberMap.get(loan.member_id) || '?',
      principal: loan.principal,
      interest_amount: loan.interest_amount,
      months,
      total_repaid,
      remaining_principal: Math.max(0, loan.principal - total_repaid),
      status: loan.status,
      due_date: loan.due_date,
    };
  });
  res.json({ fiscal_year: fiscalYear, rows });
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const id   = parseInt(req.params.id);
  const loan = await Loan.findOne({ id }).lean();
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  const repayments = await Repayment.find({ loan_id: id, status: { $ne: 'voided' } }).lean();
  repayments.sort((a, b) => a.repayment_date.localeCompare(b.repayment_date));
  const enriched = await enrichLoan(loan);
  res.json({ ...enriched, repayments });
});

// ─── POST / ───────────────────────────────────────────────────────────────────
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { member_id, principal, issued_date, due_date, notes, override_limit, override_reason } = req.body;
  if (!member_id || !principal || !issued_date)
    return res.status(400).json({ error: 'member_id, principal, issued_date required' });

  const mid = parseInt(member_id);
  const p   = parseInt(principal);

  // Derive FY from the actual issued date
  const issued = new Date(issued_date);
  const fy     = getFiscalYear(issued.getUTCMonth() + 1, issued.getUTCFullYear());
  const rules  = await getRulesForFY(fy);

  // Enforce max loan ratio — but allow admin override with documented reason
  let overrideAmount = 0;
  if (rules.loan_max_ratio) {
    const memberContribs = await Contribution.find({ member_id: mid }).lean();
    const totalContribs  = memberContribs.reduce((s, c) => s + c.amount, 0);
    const maxEligible    = Math.round(totalContribs * rules.loan_max_ratio);
    if (p > maxEligible) {
      if (!override_limit) {
        return res.status(400).json({
          error: `Principal (TZS ${p.toLocaleString()}) exceeds the ${Math.round(rules.loan_max_ratio * 100)}% contribution limit (TZS ${maxEligible.toLocaleString()})`,
          max_eligible: maxEligible,
          requires_override: true,
        });
      }
      // Admin approved override — record the excess amount for expense tracking
      overrideAmount = p - maxEligible;
    }
  }

  const existingCount  = await Loan.countDocuments({ member_id: mid, fiscal_year: fy });
  const loan_number    = `Loan ${existingCount + 1}`;
  const interest_rate  = rules.loan_interest_rate;
  const interest_amount = Math.round(p * interest_rate);

  let calculated_due_date = due_date;
  if (!calculated_due_date && rules.loan_repayment_months) {
    const dDate = new Date(issued_date);
    dDate.setMonth(dDate.getMonth() + rules.loan_repayment_months);
    calculated_due_date = dDate.toISOString().split('T')[0];
  }

  const loan = await Loan.create({
    id:               await getNextId('loan_id'),
    member_id:        mid,
    loan_number,
    principal:        p,
    interest_rate,
    interest_amount,
    amount_deposited: p - interest_amount,
    issued_date,
    due_date:         calculated_due_date || null,
    status:           'active',
    fiscal_year:      fy,
    notes:            notes || null,
  });

  const member = await Member.findOne({ id: mid }).lean();
  await Transaction.create({
    id:               await getNextId('transaction_id'),
    member_id:        mid,
    amount:           p,
    type:             'loan_disbursement',
    description:      `Loan disbursed — ${member ? member.name : ''} (${loan_number}, FY${fy})`,
    transaction_date: issued_date,
    fiscal_year:      fy,
    debit:            p,
    cash_impact:      -(p - interest_amount),
    loan_impact:      p,
    approval_status:  'approved',
    created_by:       req.user.username,
    audit_note:       'Loan principal is tracked separately from the net cash disbursed after upfront interest.',
  });

  // If limit was overridden, log the excess as an expense for full accountability
  if (override_limit && overrideAmount > 0) {
    await Expense.create({
      id:           await getNextId('expense_id'),
      category:     'Loan Override',
      description:  `Loan limit override — ${member ? member.name : `Member #${mid}`} (${loan_number})`,
      amount:       overrideAmount,
      expense_date: issued_date,
      fiscal_year:  fy,
      loan_id:      loan.id,
      member_id:    mid,
      cash_effect:  false,
      status:       'control_only',
      notes:        override_reason || 'Admin override approved',
    });
  }

  res.status(201).json({ ...loan, override_logged: override_limit && overrideAmount > 0 });
});

// ─── POST /:id/repayments ─────────────────────────────────────────────────────
router.post('/:id/repayments', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { amount, repayment_date, repayment_month, reference_number, payment_source, mpesa_ref, notes } = req.body;
  if (!amount || !repayment_date)
    return res.status(400).json({ error: 'amount and repayment_date required' });

  const loan = await Loan.findOne({ id }).lean();
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  const repayment = await Repayment.create({
    id:             await getNextId('repayment_id'),
    loan_id:        id,
    member_id:      loan.member_id,
    fiscal_year:    getFiscalYear(Number(repayment_date.slice(5, 7)), Number(repayment_date.slice(0, 4))),
    repayment_month: repayment_month ? parseInt(repayment_month) : Number(repayment_date.slice(5, 7)),
    amount:         parseInt(amount),
    repayment_date,
    reference_number: reference_number || mpesa_ref || null,
    payment_source: payment_source || 'manual',
    mpesa_ref:      mpesa_ref || null,
    notes:          notes || null,
  });

  const allReps     = await Repayment.find({ loan_id: id, status: { $ne: 'voided' } }).lean();
  const totalRepaid = allReps.reduce((s, r) => s + r.amount, 0);

  const rules        = await getRulesForFY(loan.fiscal_year);
  const months_active = getMonthsDiff(loan.issued_date, new Date());
  let penalty = 0;
  if (rules.overdue_penalty_enabled && rules.loan_repayment_months && months_active > rules.loan_repayment_months) {
    penalty = Math.round(loan.principal * rules.overdue_penalty_rate * (months_active - rules.loan_repayment_months));
  }

  if (totalRepaid >= loan.principal + penalty) {
    await Loan.findOneAndUpdate({ id }, { $set: { status: 'paid' } });
  }

  await Transaction.create({
    id:               await getNextId('transaction_id'),
    member_id:        loan.member_id,
    amount:           parseInt(amount),
    type:             'loan_repayment',
    description:      `Loan repayment — ${loan.loan_number}`,
    reference:        mpesa_ref || null,
    transaction_date: repayment_date,
    fiscal_year:      getFiscalYear(Number(repayment_date.slice(5, 7)), Number(repayment_date.slice(0, 4))),
    credit:           parseInt(amount),
    cash_impact:      parseInt(amount),
    loan_impact:      -parseInt(amount),
    created_by:       req.user.username,
  });

  res.status(201).json(repayment);
});

// ─── PATCH /:id ───────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { status, due_date, notes, reason } = req.body;
  const original = await Loan.findOne({ id }).lean();
  if (!original) return res.status(404).json({ error: 'Loan not found' });
  const excludedStatuses = ['cancelled', 'voided', 'not_disbursed'];
  if (status && excludedStatuses.includes(status) && !reason) {
    return res.status(400).json({ error: 'reason is required when cancelling or voiding a loan' });
  }
  const updates = {};
  if (status)   updates.status   = status;
  if (due_date) updates.due_date = due_date;
  if (notes)    updates.notes    = notes;
  if (status && excludedStatuses.includes(status)) {
    updates.disbursed = false;
    updates.cancellation_reason = reason;
    updates.cancelled_at = new Date();
  }

  await Loan.findOneAndUpdate({ id }, { $set: updates });
  const updatedLoan = await Loan.findOne({ id }).lean();
  if (status || due_date || notes) {
    await AuditLog.create({
      record_type: 'loan',
      record_id: id,
      action: status && excludedStatuses.includes(status) ? 'cancel' : 'update',
      old_value: original,
      new_value: updatedLoan,
      reason: reason || 'Administrative correction',
      user: req.user.username,
    });
  }
  res.json(await enrichLoan(updatedLoan));
});

module.exports = router;
