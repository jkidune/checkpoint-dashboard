const express = require('express');
const router = express.Router();
const { Member, Contribution, Loan, LoanRepayment, Fine, Transaction } = require('../db/models');
const { getRulesForFY } = require('./rules');

const MONTH_MAP = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Return the fiscal year that a given month/year belongs to (Mar–Feb cycle)
function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

// Middleware: validate shared secret from X-Form-Secret header
function formAuth(req, res, next) {
  const secret = process.env.FORM_SECRET;
  if (!secret) return res.status(500).json({ error: 'FORM_SECRET not configured on server' });
  if (req.headers['x-form-secret'] !== secret) {
    return res.status(401).json({ error: 'Invalid form secret' });
  }
  next();
}

/**
 * POST /api/forms/contribution
 *
 * Accepts submissions from the Google Form (via Apps Script).
 * Handles three types: monthly contribution, loan repayment, fine payment.
 *
 * Body:
 *   memberName  – exact name as it appears in the DB
 *   amount      – number (TZS)
 *   date        – ISO date string (YYYY-MM-DD)
 *   type        – "monthly" | "loan_repayment" | "fine"
 *   months      – array of month names (only for type=monthly)
 *   mpesaRef    – M-Pesa transaction reference
 *   notes       – optional free-text
 */
router.post('/contribution', formAuth, async (req, res) => {
  try {
    const { memberName, amount, date, type, months = [], mpesaRef, notes } = req.body;

    if (!memberName || !amount || !date || !type) {
      return res.status(400).json({ error: 'memberName, amount, date, and type are required' });
    }

    // ── Look up member ────────────────────────────────────────────────────────
    const member = await Member.findOne({ name: new RegExp(`^${memberName.trim()}$`, 'i') });
    if (!member) {
      return res.status(404).json({ error: `Member not found: "${memberName}"` });
    }

    const parsedDate = new Date(date);
    const dateStr = parsedDate.toISOString().split('T')[0];
    const numAmount = Number(amount);

    // ── Route by type ─────────────────────────────────────────────────────────
    if (type === 'monthly') {
      return await handleMonthly({ member, numAmount, dateStr, months, mpesaRef, notes, res });
    }
    if (type === 'loan_repayment') {
      return await handleLoanRepayment({ member, numAmount, dateStr, mpesaRef, notes, res });
    }
    if (type === 'fine') {
      return await handleFine({ member, numAmount, dateStr, mpesaRef, notes, res });
    }

    return res.status(400).json({ error: `Unknown type: "${type}". Use monthly, loan_repayment, or fine.` });

  } catch (err) {
    console.error('[forms/contribution]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Monthly contribution ───────────────────────────────────────────────────────
async function handleMonthly({ member, numAmount, dateStr, months, mpesaRef, notes, res }) {
  if (!months || months.length === 0) {
    return res.status(400).json({ error: 'At least one month is required for monthly contributions' });
  }

  const payDate = new Date(dateStr);
  const results = [];

  for (const monthName of months) {
    const monthNum = MONTH_MAP[monthName.trim().toLowerCase()];
    if (!monthNum) {
      results.push({ month: monthName, status: 'error', reason: 'Unrecognised month name' });
      continue;
    }

    // Infer year: if the month is in the future relative to pay date, it's the prior year
    let year = payDate.getFullYear();
    if (monthNum > payDate.getMonth() + 1) year -= 1;

    // Upsert: update if exists, create if not
    const existing = await Contribution.findOne({ member_id: member.id, month: monthNum, year });
    if (existing) {
      existing.status   = 'paid';
      existing.amount   = numAmount;
      existing.paid_date = dateStr;
      existing.mpesa_ref = mpesaRef || existing.mpesa_ref;
      existing.notes     = notes || existing.notes;
      await existing.save();
      results.push({ month: monthName, year, status: 'updated', id: existing.id });
    } else {
      const contrib = new Contribution({
        member_id:  member.id,
        amount:     numAmount,
        month:      monthNum,
        year,
        status:     'paid',
        paid_date:  dateStr,
        mpesa_ref:  mpesaRef || null,
        notes:      notes || null,
      });
      await contrib.save();

      // Log transaction
      await new Transaction({
        member_id:        member.id,
        amount:           numAmount,
        type:             'contribution',
        description:      `Monthly contribution – ${monthName} ${year} (via form)`,
        reference:        mpesaRef || null,
        transaction_date: dateStr,
      }).save();

      results.push({ month: monthName, year, status: 'created', id: contrib.id });
    }
  }

  return res.json({ success: true, type: 'monthly', member: member.name, results });
}

// ── Loan repayment ────────────────────────────────────────────────────────────
async function handleLoanRepayment({ member, numAmount, dateStr, mpesaRef, notes, res }) {
  // Find the most recent active/overdue loan for this member
  const loan = await Loan.findOne(
    { member_id: member.id, status: { $in: ['active', 'overdue'] } },
    null,
    { sort: { created_at: -1 } }
  );
  if (!loan) {
    return res.status(404).json({ error: `No active loan found for ${member.name}` });
  }

  const repayment = new LoanRepayment({
    loan_id:        loan.id,
    amount:         numAmount,
    repayment_date: dateStr,
    mpesa_ref:      mpesaRef || null,
    notes:          notes || null,
  });
  await repayment.save();

  // Check if loan is now fully repaid
  const allRepayments = await LoanRepayment.find({ loan_id: loan.id });
  const totalPaid = allRepayments.reduce((sum, r) => sum + r.amount, 0);
  const totalOwed = loan.principal + loan.interest_amount;
  if (totalPaid >= totalOwed) {
    loan.status = 'repaid';
    await loan.save();
  }

  // Log transaction
  await new Transaction({
    member_id:        member.id,
    amount:           numAmount,
    type:             'loan_repayment',
    description:      `Loan repayment – Loan #${loan.id} (via form)`,
    reference:        mpesaRef || null,
    transaction_date: dateStr,
  }).save();

  return res.json({
    success: true,
    type: 'loan_repayment',
    member: member.name,
    loan_id: loan.id,
    repayment_id: repayment.id,
    total_paid: totalPaid,
    loan_status: loan.status,
  });
}

// ── Fine payment ──────────────────────────────────────────────────────────────
async function handleFine({ member, numAmount, dateStr, mpesaRef, notes, res }) {
  // Find oldest unpaid fine for this member
  const fine = await Fine.findOne(
    { member_id: member.id, status: 'unpaid' },
    null,
    { sort: { created_at: 1 } }
  );
  if (!fine) {
    return res.status(404).json({ error: `No unpaid fine found for ${member.name}` });
  }

  fine.status   = 'paid';
  fine.paid_date = dateStr;
  if (notes) fine.notes = notes;
  await fine.save();

  // Log transaction
  await new Transaction({
    member_id:        member.id,
    amount:           numAmount,
    type:             'fine_payment',
    description:      `Fine payment (via form)`,
    reference:        mpesaRef || null,
    transaction_date: dateStr,
  }).save();

  return res.json({
    success: true,
    type: 'fine',
    member: member.name,
    fine_id: fine.id,
    amount: fine.amount,
  });
}

module.exports = router;
