const express = require('express');
const router = express.Router();
const { Member, Contribution, Loan, Repayment, Fine, Transaction, FormSubmissionLog } = require('../db/models');
const { getRulesForFY } = require('./rules');

const MONTH_MAP = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const TYPE_ALIASES = new Map([
  ['monthly', 'monthly'], ['monthly contribution', 'monthly'], ['mchango wa mwezi', 'monthly'],
  ['loan repayment', 'loan_repayment'], ['loan return', 'loan_repayment'],
  ['rejesho la deni', 'loan_repayment'], ['rejesho la mkopo', 'loan_repayment'],
  ['fine', 'fine'], ['fine payment', 'fine'],
  ['entry fee', 'entry_fee'], ['ada ya kujiunga', 'entry_fee'],
  ['welfare', 'welfare'], ['welfare contribution', 'welfare'], ['mchango wa ustawi', 'welfare'],
  ['other', 'other_approved'], ['other approved payment', 'other_approved'],
]);

function normalizeType(value) {
  return TYPE_ALIASES.get(String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')) || null;
}

async function finalizeLog(log, status, createdRecords = [], error = null) {
  if (!log) return;
  await FormSubmissionLog.updateOne({ _id: log._id }, {
    $set: { validation_status: status, created_records: createdRecords, error },
  });
}

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
  let submissionLog;
  try {
    const { memberName, amount, date, type, months = [], mpesaRef, notes, loanId, loanNumber } = req.body;
    const normalizedType = normalizeType(type);
    submissionLog = await FormSubmissionLog.create({
      raw_payload: req.body, raw_type: type || null, normalized_type: normalizedType,
      validation_status: 'received', reference: mpesaRef || null,
    });

    if (!memberName || !amount || !date || !type) {
      await finalizeLog(submissionLog, 'rejected', [], 'memberName, amount, date, and type are required');
      return res.status(400).json({ error: 'memberName, amount, date, and type are required' });
    }
    if (!normalizedType) {
      await finalizeLog(submissionLog, 'rejected', [], `Unknown type: ${type}`);
      return res.status(400).json({ error: `Unknown type: "${type}"` });
    }

    // ── Look up member ────────────────────────────────────────────────────────
    let member = await Member.findOne({ name: new RegExp(`^${memberName.trim()}$`, 'i') });

    // Fuzzy fallback: if exact match fails, find the member whose name shares
    // the most words with the submitted name (handles shortened/reordered names)
    if (!member) {
      const allMembers = await Member.find({ status: 'active' });
      const queryWords = memberName.toLowerCase().split(/\s+/);
      let bestScore = 0, bestMatch = null;
      for (const m of allMembers) {
        const dbWords = m.name.toLowerCase().split(/\s+/);
        const shared  = queryWords.filter(w => dbWords.some(d => d.startsWith(w) || w.startsWith(d)));
        if (shared.length > bestScore) { bestScore = shared.length; bestMatch = m; }
      }
      if (bestScore >= 2) member = bestMatch;
    }

    if (!member) {
      await finalizeLog(submissionLog, 'rejected', [], `Member not found: ${memberName}`);
      return res.status(404).json({ error: `Member not found: "${memberName}"` });
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      await finalizeLog(submissionLog, 'rejected', [], 'Date must be valid');
      return res.status(400).json({ error: 'Date must be valid' });
    }
    const dateStr = parsedDate.toISOString().split('T')[0];
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      await finalizeLog(submissionLog, 'rejected', [], 'Amount must be positive and date must be valid');
      return res.status(400).json({ error: 'Amount must be positive and date must be valid' });
    }

    if (mpesaRef) {
      const duplicate = await Transaction.findOne({ reference: mpesaRef, type: normalizedType === 'monthly' ? 'contribution' : normalizedType, amount: numAmount, status: { $ne: 'voided' } }).lean();
      if (duplicate) {
        await finalizeLog(submissionLog, 'duplicate', [{ type: 'transaction', id: duplicate.id }], 'Duplicate reference/type/amount');
        return res.status(409).json({ error: 'Duplicate payment reference for the same payment type and amount', transaction_id: duplicate.id });
      }
    }

    // ── Route by type ─────────────────────────────────────────────────────────
    if (normalizedType === 'monthly') {
      return await handleMonthly({ member, numAmount, dateStr, months, mpesaRef, notes, submissionLog, res });
    }
    if (normalizedType === 'loan_repayment') {
      return await handleRepayment({ member, numAmount, dateStr, mpesaRef, notes, loanId, loanNumber, submissionLog, res });
    }
    if (normalizedType === 'fine') {
      return await handleFine({ member, numAmount, dateStr, mpesaRef, notes, submissionLog, res });
    }
    return await handleOtherApproved({ member, numAmount, dateStr, mpesaRef, notes, type: normalizedType, submissionLog, res });

  } catch (err) {
    console.error('[forms/contribution]', err);
    await finalizeLog(submissionLog, 'error', [], err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Monthly contribution ───────────────────────────────────────────────────────
async function handleMonthly({ member, numAmount, dateStr, months, mpesaRef, notes, submissionLog, res }) {
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

    // Never merge or overwrite a prior payment automatically.
    const existing = await Contribution.findOne({ member_id: member.id, month: monthNum, year });
    if (existing) {
      results.push({ month: monthName, year, status: 'duplicate_period', id: existing.id, reason: 'Existing contribution retained; no automatic merge or overwrite.' });
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

  const posted = results.filter(item => item.status === 'created');
  await finalizeLog(submissionLog, posted.length ? (posted.length === results.length ? 'posted' : 'posted_with_review') : 'duplicate', posted.map(item => ({ type: 'contribution', id: item.id })));
  return res.json({ success: true, type: 'monthly', member: member.name, results });
}

// ── Loan repayment ────────────────────────────────────────────────────────────
async function handleRepayment({ member, numAmount, dateStr, mpesaRef, notes, loanId, loanNumber, submissionLog, res }) {
  const activeQuery = { member_id: member.id, status: { $in: ['active', 'overdue'] }, disbursed: { $ne: false } };
  if (loanId) activeQuery.id = Number(loanId);
  if (loanNumber) activeQuery.loan_number = loanNumber;
  const activeLoans = await Loan.find(activeQuery).sort({ created_at: -1 });
  if (!loanId && !loanNumber && activeLoans.length > 1) {
    await finalizeLog(submissionLog, 'rejected', [], 'Loan reference required because member has multiple active loans');
    return res.status(400).json({ error: 'loanId or loanNumber is required when a member has multiple active loans' });
  }
  const loan = activeLoans[0];
  if (!loan) {
    await finalizeLog(submissionLog, 'rejected', [], `No active loan found for ${member.name}`);
    return res.status(404).json({ error: `No active loan found for ${member.name}` });
  }

  const repayment = new Repayment({
    loan_id:        loan.id,
    member_id:      member.id,
    amount:         numAmount,
    repayment_date: dateStr,
    fiscal_year:    getFiscalYear(Number(dateStr.slice(5, 7)), Number(dateStr.slice(0, 4))),
    repayment_month: Number(dateStr.slice(5, 7)),
    reference_number: mpesaRef || null,
    payment_source: 'google_form',
    mpesa_ref:      mpesaRef || null,
    notes:          notes || null,
  });
  await repayment.save();

  // Check if loan is now fully repaid
  const allRepayments = await Repayment.find({ loan_id: loan.id, status: { $ne: 'voided' } });
  const totalPaid = allRepayments.reduce((sum, r) => sum + r.amount, 0);
  const totalOwed = loan.principal;
  if (totalPaid >= totalOwed) {
    loan.status = 'paid';
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
    fiscal_year:      getFiscalYear(Number(dateStr.slice(5, 7)), Number(dateStr.slice(0, 4))),
    credit:           numAmount,
    cash_impact:      numAmount,
    loan_impact:      -numAmount,
    created_by:       'google_form',
  }).save();

  await finalizeLog(submissionLog, 'posted', [{ type: 'loan_repayment', id: repayment.id, loan_id: loan.id }]);

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
async function handleFine({ member, numAmount, dateStr, mpesaRef, notes, submissionLog, res }) {
  // Find oldest unpaid fine for this member
  const fine = await Fine.findOne(
    { member_id: member.id, status: 'unpaid' },
    null,
    { sort: { created_at: 1 } }
  );
  if (!fine) {
    await finalizeLog(submissionLog, 'rejected', [], `No unpaid fine found for ${member.name}`);
    return res.status(404).json({ error: `No unpaid fine found for ${member.name}` });
  }
  if (numAmount !== fine.amount) {
    await finalizeLog(submissionLog, 'rejected', [], `Fine payment must match outstanding fine of TZS ${fine.amount}`);
    return res.status(400).json({ error: `Fine payment must match the outstanding fine amount (TZS ${fine.amount.toLocaleString()})` });
  }

  fine.status    = 'paid';
  fine.paid_date = dateStr;
  await fine.save();

  // Log transaction
  await new Transaction({
    member_id:        member.id,
    amount:           numAmount,
    type:             'fine_payment',
    description:      `Fine payment (via form)`,
    reference:        mpesaRef || null,
    transaction_date: dateStr,
    credit:           numAmount,
    cash_impact:      numAmount,
    created_by:       'google_form',
  }).save();

  await finalizeLog(submissionLog, 'posted', [{ type: 'fine', id: fine.id }]);

  return res.json({
    success: true,
    type: 'fine',
    member: member.name,
    fine_id: fine.id,
    amount: fine.amount,
  });
}

async function handleOtherApproved({ member, numAmount, dateStr, mpesaRef, notes, type, submissionLog, res }) {
  const transactionType = type === 'entry_fee' ? 'entry_fee' : type === 'welfare' ? 'welfare_contribution' : 'other_approved_payment';
  const transaction = await new Transaction({
    member_id: member.id, amount: numAmount, type: transactionType,
    description: notes || `${transactionType.replace(/_/g, ' ')} (via form)`,
    reference: mpesaRef || null, transaction_date: dateStr,
    fiscal_year: getFiscalYear(Number(dateStr.slice(5, 7)), Number(dateStr.slice(0, 4))),
    credit: numAmount, cash_impact: numAmount, approval_status: 'pending_review',
    created_by: 'google_form', audit_note: 'Requires treasurer approval before inclusion in reporting.',
  }).save();
  await finalizeLog(submissionLog, 'pending_review', [{ type: transactionType, id: transaction.id }]);
  return res.json({ success: true, type, member: member.name, transaction_id: transaction.id, status: 'pending_review' });
}

module.exports = router;
