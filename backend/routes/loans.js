const express = require('express');
const router = express.Router();
const { Loan, Repayment, Member, Transaction, Contribution, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

function getMonthsDiff(d1, d2) {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  let months = (date2.getFullYear() - date1.getFullYear()) * 12;
  months -= date1.getMonth();
  months += date2.getMonth();
  return months <= 0 ? 0 : months;
}

router.get('/rules', authenticate, (req, res) => {
  res.json({ interest_rate: 0.12, max_loan_ratio: 0.80, repayment_months: 6, overdue_penalty_rate: 0.10 });
});

async function enrichLoan(loan) {
  const repayments = await Repayment.find({ loan_id: loan.id }).lean();
  const total_repaid = repayments.reduce((s, r) => s + r.amount, 0);
  const member = await Member.findOne({ id: loan.member_id }).lean();

  let penalty = 0;
  const months_active = getMonthsDiff(loan.issued_date, new Date());
  if (loan.status !== 'paid' && loan.fiscal_year >= 2026 && months_active > 6) {
    penalty = Math.round(loan.principal * 0.10 * (months_active - 6));
  }

  const total_owed = loan.principal + penalty;
  const balance = Math.max(0, total_owed - total_repaid);
  return { ...loan, member_name: member ? member.name : '?', total_repaid, penalty, total_owed, balance };
}

router.get('/', authenticate, async (req, res) => {
  const { fiscal_year, status, member_id } = req.query;
  const query = {};
  if (fiscal_year) query.fiscal_year = parseInt(fiscal_year);
  if (status)      query.status = status;
  if (member_id)   query.member_id = parseInt(member_id);

  const list = await Loan.find(query).lean();
  const enriched = await Promise.all(list.map(enrichLoan));
  res.json(enriched.sort((a, b) => b.issued_date.localeCompare(a.issued_date)));
});

router.get('/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id);
  const loan = await Loan.findOne({ id }).lean();
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  const repayments = await Repayment.find({ loan_id: id }).lean();
  repayments.sort((a, b) => a.repayment_date.localeCompare(b.repayment_date));
  const enriched = await enrichLoan(loan);
  res.json({ ...enriched, repayments });
});

// FY starts March, ends February of the following year.
function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { member_id, principal, issued_date, due_date, notes } = req.body;
  if (!member_id || !principal || !issued_date)
    return res.status(400).json({ error: 'member_id, principal, issued_date required' });

  const mid = parseInt(member_id);
  const p   = parseInt(principal);

  // Derive FY from the actual issued date — never trust a client-supplied fiscal_year
  const issued  = new Date(issued_date);
  const fy      = getFiscalYear(issued.getUTCMonth() + 1, issued.getUTCFullYear());

  if (fy >= 2026) {
    const memberContribs = await Contribution.find({ member_id: mid }).lean();
    const totalContribs = memberContribs.reduce((s, c) => s + c.amount, 0);
    const maxEligible = totalContribs * 0.8;
    if (p > maxEligible)
      return res.status(400).json({ error: `Requested principal (TZS ${p}) exceeds 80% contribution limit (TZS ${maxEligible})` });
  }

  const existingCount = await Loan.countDocuments({ member_id: mid, fiscal_year: fy });
  const loan_number = `Loan ${existingCount + 1}`;
  const interest_rate   = fy >= 2026 ? 0.12 : 0.05;
  const interest_amount = Math.round(p * interest_rate);

  let calculated_due_date = due_date;
  if (!calculated_due_date && fy >= 2026) {
    const dDate = new Date(issued_date);
    dDate.setMonth(dDate.getMonth() + 6);
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
    description:      `Loan disbursed - ${member ? member.name : ''} (${loan_number})`,
    transaction_date: issued_date,
  });

  res.status(201).json(loan);
});

router.post('/:id/repayments', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { amount, repayment_date, mpesa_ref, notes } = req.body;
  if (!amount || !repayment_date)
    return res.status(400).json({ error: 'amount and repayment_date required' });

  const loan = await Loan.findOne({ id }).lean();
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  const repayment = await Repayment.create({
    id:              await getNextId('repayment_id'),
    loan_id:         id,
    amount:          parseInt(amount),
    repayment_date,
    mpesa_ref:       mpesa_ref || null,
    notes:           notes || null,
  });

  const allReps = await Repayment.find({ loan_id: id }).lean();
  const totalRepaid = allReps.reduce((s, r) => s + r.amount, 0);

  let penalty = 0;
  const months_active = getMonthsDiff(loan.issued_date, new Date());
  if (loan.fiscal_year >= 2026 && months_active > 6) {
    penalty = Math.round(loan.principal * 0.10 * (months_active - 6));
  }
  if (totalRepaid >= loan.principal + penalty) {
    await Loan.findOneAndUpdate({ id }, { $set: { status: 'paid' } });
  }

  await Transaction.create({
    id:               await getNextId('transaction_id'),
    member_id:        loan.member_id,
    amount:           parseInt(amount),
    type:             'loan_repayment',
    description:      `Loan repayment - ${loan.loan_number}`,
    reference:        mpesa_ref || null,
    transaction_date: repayment_date,
  });

  res.status(201).json(repayment);
});

router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { status, due_date, notes } = req.body;
  const updates = {};
  if (status)   updates.status = status;
  if (due_date) updates.due_date = due_date;
  if (notes)    updates.notes = notes;

  await Loan.findOneAndUpdate({ id }, { $set: updates });
  const updatedLoan = await Loan.findOne({ id }).lean();
  res.json(await enrichLoan(updatedLoan));
});

module.exports = router;
