const express = require('express');
const router = express.Router();
const { Contribution, Member, Transaction, Fine, Loan, Repayment } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getRulesForFY, calculateFine } = require('./rules');

// ─── Fiscal Year helpers ──────────────────────────────────────────────────────
function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

// ─── Late-payment calculation ─────────────────────────────────────────────────
// Returns how many full months past the 5th-of-next-month deadline the payment was.
function getMonthsLate(month, year, paid_date) {
  let dY = year;
  let dM = month + 1;
  if (dM > 12) { dM = 1; dY++; }

  const deadline = new Date(`${dY}-${String(dM).padStart(2, '0')}-05T00:00:00Z`);
  const paid     = new Date(`${paid_date}T12:00:00Z`);

  if (paid <= deadline) return 0;

  let diff = (paid.getUTCFullYear() - deadline.getUTCFullYear()) * 12;
  diff -= deadline.getUTCMonth();
  diff += paid.getUTCMonth();
  if (paid.getUTCDate() > 5) diff++;

  return diff <= 0 ? 1 : diff;
}

// ─── GET /fine-preview ────────────────────────────────────────────────────────
router.get('/fine-preview', authenticate, requireAdmin, async (req, res) => {
  const { amount, month, year, paid_date } = req.query;
  if (!amount || !month || !year || !paid_date) return res.json({ penalty: 0, reason: null });

  const m   = parseInt(month);
  const y   = parseInt(year);
  const p   = parseInt(amount);
  const fy  = getFiscalYear(m, y);

  const rules = await getRulesForFY(fy);
  if (!rules.late_fine_enabled) return res.json({ penalty: 0, reason: null });

  const monthsLate = getMonthsLate(m, y, paid_date);
  if (monthsLate > 0) {
    const fineCalc = calculateFine(rules, p, monthsLate, m, y, fy);
    if (fineCalc) {
      return res.json({
        penalty: fineCalc.amount,
        months_late: monthsLate,
        rate: rules.late_fine_rate,
        fine_type: rules.late_fine_type || 'percentage',
        reason: fineCalc.reason,
      });
    }
  }

  res.json({ penalty: 0, reason: null });
});

// ─── GET / ────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { year, month, member_id } = req.query;
  const filter = {};
  if (year)      filter.year      = parseInt(year);
  if (month)     filter.month     = parseInt(month);
  if (member_id) filter.member_id = parseInt(member_id);

  let list = await Contribution.find(filter).lean();
  const membersList = await Member.find().lean();

  list = list.map(c => ({
    ...c,
    member_name: (membersList.find(m => m.id === c.member_id) || {}).name || '?',
    fiscal_year: getFiscalYear(c.month, c.year),
  }));
  res.json(list.sort((a, b) => b.year - a.year || b.month - a.month));
});

// ─── GET /grid/:fy ───────────────────────────────────────────────────────────
router.get('/grid/:year', authenticate, async (req, res) => {
  const fy = parseInt(req.params.year);

  const membersList = await Member.find({ status: 'active' }).lean();
  membersList.sort((a, b) => a.name.localeCompare(b.name));

  const contribs = await Contribution.find({
    $or: [
      { year: fy,     month: { $gte: 3 } },
      { year: fy + 1, month: { $lte: 2 } },
    ],
  }).lean();

  const grid = membersList.map(m => {
    const months = {};
    for (const mo of FY_MONTHS) {
      const yr = mo >= 3 ? fy : fy + 1;
      const c  = contribs.find(c => c.member_id === m.id && c.month === mo && c.year === yr);
      months[mo] = c ? { amount: c.amount, status: c.status, id: c.id } : null;
    }
    const total = contribs
      .filter(c => c.member_id === m.id)
      .reduce((s, c) => s + c.amount, 0);
    return { member_id: m.id, member_name: m.name, role: m.role, months, total };
  });

  const monthlyTotals = {};
  for (const mo of FY_MONTHS) {
    const yr = mo >= 3 ? fy : fy + 1;
    monthlyTotals[mo] = contribs
      .filter(c => c.month === mo && c.year === yr)
      .reduce((s, c) => s + c.amount, 0);
  }

  // Also send the rules for this FY so the frontend can show the correct target
  const rules = await getRulesForFY(fy);

  res.json({ grid, monthlyTotals, year: fy, fyMonths: FY_MONTHS, rules });
});

// ─── POST / ───────────────────────────────────────────────────────────────────
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { member_id, amount, month, year, status, paid_date, mpesa_ref, notes } = req.body;
  if (!member_id || !amount || !month || !year)
    return res.status(400).json({ error: 'member_id, amount, month, year required' });

  const mMonth  = parseInt(month);
  const mYear   = parseInt(year);
  const mAmount = parseInt(amount);
  const pDate   = paid_date || new Date().toISOString().split('T')[0];
  const fy      = getFiscalYear(mMonth, mYear);

  const exists = await Contribution.findOne({ member_id: parseInt(member_id), month: mMonth, year: mYear });
  if (exists) return res.status(409).json({ error: 'Contribution already recorded for this month/year' });

  const { getNextId } = require('../db/models');
  const rules = await getRulesForFY(fy);

  // Auto-generate fine if late fine is enabled for this FY
  if (rules.late_fine_enabled && status === 'paid') {
    const monthsLate = getMonthsLate(mMonth, mYear, pDate);
    if (monthsLate > 0) {
      const fineCalc = calculateFine(rules, mAmount, monthsLate, mMonth, mYear, fy);
      if (fineCalc) {
        await Fine.create({
          id:                 await getNextId('fine_id'),
          member_id:          parseInt(member_id),
          amount:             fineCalc.amount,
          reason:             fineCalc.reason,
          year:               fy,
          contribution_month: mMonth,
          contribution_year:  mYear,
          status:             'unpaid',
        });
      }
    }
  }

  const contrib = await Contribution.create({
    id:        await getNextId('contribution_id'),
    member_id: parseInt(member_id),
    amount:    mAmount,
    month:     mMonth,
    year:      mYear,
    status:    status || 'paid',
    paid_date: pDate,
    mpesa_ref: mpesa_ref || null,
    notes:     notes || null,
  });

  const member = await Member.findOne({ id: parseInt(member_id) }).lean();
  await Transaction.create({
    id:               await getNextId('transaction_id'),
    member_id:        parseInt(member_id),
    amount:           mAmount,
    type:             'contribution',
    description:      `Monthly contribution — ${member ? member.name : ''} (FY${fy})`,
    reference:        mpesa_ref || null,
    transaction_date: pDate,
  });

  res.status(201).json({ ...contrib, fiscal_year: fy });
});

// ─── PATCH /:id ───────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { amount, status, paid_date, mpesa_ref, notes } = req.body;
  const updates = {};
  if (amount    !== undefined) updates.amount    = parseInt(amount);
  if (status)                  updates.status    = status;
  if (paid_date)               updates.paid_date = paid_date;
  if (mpesa_ref !== undefined) updates.mpesa_ref = mpesa_ref;
  if (notes     !== undefined) updates.notes     = notes;

  const updated = await Contribution.findOneAndUpdate({ id }, { $set: updates }, { returnDocument: 'after' }).lean();
  res.json(updated);
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  await Contribution.findOneAndDelete({ id: parseInt(req.params.id) });
  res.json({ success: true });
});

// ─── GET /bulk-payment-preview ────────────────────────────────────────────────
// Preview how a lump sum payment would be allocated for a member:
//   1) Fill unpaid months (oldest first) at contribution_amount per month
//   2) Calculate fines for each late month
//   3) Remaining → pay off unpaid fines (oldest first)
//   4) Remaining → active loan repayment
//   5) Remaining → partial contribution for next unpaid month (if no fines/loan)
router.get('/bulk-payment-preview', authenticate, requireAdmin, async (req, res) => {
  try {
    const { member_id, total_amount, paid_date } = req.query;
    if (!member_id || !total_amount) {
      return res.status(400).json({ error: 'member_id and total_amount required' });
    }

    const memberId   = parseInt(member_id);
    const totalAmount = parseInt(total_amount);
    const pDate      = paid_date || new Date().toISOString().split('T')[0];

    const allocation = await computeBulkAllocation(memberId, totalAmount, pDate);
    res.json(allocation);
  } catch (err) {
    console.error('bulk-payment-preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /bulk-payment ──────────────────────────────────────────────────────
// Execute a bulk/lump sum payment. Creates contribution records, fine records,
// marks fines as paid, and creates loan repayment — all in one transaction.
router.post('/bulk-payment', authenticate, requireAdmin, async (req, res) => {
  try {
    const { member_id, total_amount, paid_date, mpesa_ref, notes } = req.body;
    if (!member_id || !total_amount) {
      return res.status(400).json({ error: 'member_id and total_amount required' });
    }

    const memberId    = parseInt(member_id);
    const totalAmount = parseInt(total_amount);
    const pDate       = paid_date || new Date().toISOString().split('T')[0];

    const allocation = await computeBulkAllocation(memberId, totalAmount, pDate);
    const { getNextId } = require('../db/models');
    const member = await Member.findOne({ id: memberId }).lean();
    const memberName = member ? member.name : '?';

    const created = {
      contributions: [],
      fines_generated: [],
      fines_paid: [],
      loan_repayment: null,
      partial_contribution: null,
    };

    // 1) Create full-month contributions
    for (const c of allocation.contributions) {
      const contrib = await Contribution.create({
        id:        await getNextId('contribution_id'),
        member_id: memberId,
        amount:    c.amount,
        month:     c.month,
        year:      c.year,
        status:    'paid',
        paid_date: pDate,
        mpesa_ref: mpesa_ref || null,
        notes:     notes ? `${notes} (bulk payment)` : 'Bulk payment',
      });
      created.contributions.push(contrib);

      // Transaction record
      await Transaction.create({
        id:               await getNextId('transaction_id'),
        member_id:        memberId,
        amount:           c.amount,
        type:             'contribution',
        description:      `Monthly contribution — ${memberName} (FY${c.fy}) [bulk]`,
        reference:        mpesa_ref || null,
        transaction_date: pDate,
      });

      // Create the auto-fine if late
      if (c.fine) {
        const fine = await Fine.create({
          id:                 await getNextId('fine_id'),
          member_id:          memberId,
          amount:             c.fine.amount,
          reason:             c.fine.reason,
          year:               c.fy,
          contribution_month: c.month,
          contribution_year:  c.year,
          status:             'unpaid',
        });
        created.fines_generated.push(fine);
      }
    }

    // 2) Create partial contribution if applicable
    if (allocation.partial_contribution) {
      const pc = allocation.partial_contribution;
      const contrib = await Contribution.create({
        id:        await getNextId('contribution_id'),
        member_id: memberId,
        amount:    pc.amount,
        month:     pc.month,
        year:      pc.year,
        status:    'partial',
        paid_date: pDate,
        mpesa_ref: mpesa_ref || null,
        notes:     notes ? `${notes} (partial — bulk payment)` : 'Partial — bulk payment',
      });
      created.partial_contribution = contrib;

      await Transaction.create({
        id:               await getNextId('transaction_id'),
        member_id:        memberId,
        amount:           pc.amount,
        type:             'contribution',
        description:      `Partial contribution — ${memberName} (FY${pc.fy}) [bulk]`,
        reference:        mpesa_ref || null,
        transaction_date: pDate,
      });
    }

    // 3) Pay off fines with remainder
    for (const fp of allocation.fines_paid) {
      await Fine.findOneAndUpdate(
        { id: fp.fine_id },
        { $set: { status: 'paid', paid_date: pDate } }
      );
      created.fines_paid.push(fp);

      await Transaction.create({
        id:               await getNextId('transaction_id'),
        member_id:        memberId,
        amount:           fp.amount_applied,
        type:             'fine_payment',
        description:      `Fine payment — ${memberName} [bulk]`,
        reference:        mpesa_ref || null,
        transaction_date: pDate,
      });
    }

    // 4) Loan repayment with remainder
    if (allocation.loan_repayment) {
      const lr = allocation.loan_repayment;
      const repayment = await Repayment.create({
        id:             await getNextId('repayment_id'),
        loan_id:        lr.loan_id,
        amount:         lr.amount,
        repayment_date: pDate,
        mpesa_ref:      mpesa_ref || null,
        notes:          'From bulk payment remainder',
      });
      created.loan_repayment = repayment;

      await Transaction.create({
        id:               await getNextId('transaction_id'),
        member_id:        memberId,
        amount:           lr.amount,
        type:             'loan_repayment',
        description:      `Loan repayment — ${memberName} (Loan #${lr.loan_id}) [bulk]`,
        reference:        mpesa_ref || null,
        transaction_date: pDate,
      });
    }

    res.status(201).json({
      ok: true,
      allocation,
      created,
      message: `Bulk payment of TZS ${totalAmount.toLocaleString()} processed for ${memberName}.`,
    });
  } catch (err) {
    console.error('bulk-payment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk allocation computation (shared by preview and execute) ──────────────
async function computeBulkAllocation(memberId, totalAmount, paidDate) {
  // Get member's existing contributions
  const existingContribs = await Contribution.find({ member_id: memberId }).lean();

  // Determine unpaid months across FY2025 and FY2026 (up to current month)
  const today = new Date(paidDate + 'T12:00:00Z');
  const currentMonth = today.getUTCMonth() + 1; // 1-based
  const currentYear  = today.getUTCFullYear();

  // Build list of all months that should have contributions (FY2025 Mar 2025 → current)
  const unpaidMonths = [];

  // FY2025: Mar 2025 → Feb 2026
  for (const mo of FY_MONTHS) {
    const yr = mo >= 3 ? 2025 : 2026;
    // Don't go past current month
    if (yr > currentYear || (yr === currentYear && mo > currentMonth)) continue;
    const existing = existingContribs.find(c => c.member_id === memberId && c.month === mo && c.year === yr && c.status === 'paid');
    if (!existing) {
      unpaidMonths.push({ month: mo, year: yr, fy: getFiscalYear(mo, yr) });
    }
  }

  // FY2026: Mar 2026 → current (but only months whose deadline has passed or is this month)
  if (currentYear >= 2026) {
    for (const mo of FY_MONTHS) {
      const yr = mo >= 3 ? 2026 : 2027;
      if (yr > currentYear || (yr === currentYear && mo > currentMonth)) continue;
      // Skip months already in the FY2025 list (Feb 2026 etc.)
      if (yr === 2026 && mo <= 2) continue;
      const existing = existingContribs.find(c => c.member_id === memberId && c.month === mo && c.year === yr && c.status === 'paid');
      if (!existing) {
        unpaidMonths.push({ month: mo, year: yr, fy: getFiscalYear(mo, yr) });
      }
    }
  }

  // Sort oldest first
  unpaidMonths.sort((a, b) => a.year - b.year || a.month - b.month);

  // Get unpaid fines
  const unpaidFines = await Fine.find({ member_id: memberId, status: 'unpaid' }).lean();
  unpaidFines.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

  // Get active loan
  const activeLoan = await Loan.find({ member_id: memberId, status: 'active' }).lean();
  let activeLoanInfo = null;
  if (activeLoan.length > 0) {
    const loan = activeLoan[0];
    const repayments = await Repayment.find({ loan_id: loan.id }).lean();
    const totalRepaid = repayments.reduce((s, r) => s + r.amount, 0);
    const outstanding = loan.principal - totalRepaid;
    if (outstanding > 0) {
      activeLoanInfo = { loan_id: loan.id, loan_number: loan.loan_number, outstanding };
    }
  }

  // ─── Allocation Logic ─────────────────────────────────────────────────
  let remaining = totalAmount;
  const contributions = [];
  const finesGenerated = [];
  const finesPaid = [];
  let partialContribution = null;
  let loanRepayment = null;

  // Step 1: Allocate to full months
  for (const um of unpaidMonths) {
    const rules = await getRulesForFY(um.fy);
    const contribAmount = rules.contribution_amount || 75000;

    if (remaining < contribAmount) break; // Not enough for a full month

    remaining -= contribAmount;

    // Calculate fine for this late month
    const monthsLate = getMonthsLate(um.month, um.year, paidDate);
    let fineInfo = null;
    if (monthsLate > 0) {
      fineInfo = calculateFine(rules, contribAmount, monthsLate, um.month, um.year, um.fy);
    }

    contributions.push({
      month: um.month,
      year: um.year,
      fy: um.fy,
      amount: contribAmount,
      months_late: monthsLate,
      fine: fineInfo,
    });

    if (fineInfo) {
      finesGenerated.push(fineInfo);
    }
  }

  // Calculate total new fines
  const totalNewFines = finesGenerated.reduce((s, f) => s + f.amount, 0);
  // Total all unpaid fines (existing + new)
  const totalExistingFines = unpaidFines.reduce((s, f) => s + f.amount, 0);
  const totalAllFines = totalNewFines + totalExistingFines;

  // Step 2: Check if member has any fines or loan debt
  const hasDebts = totalAllFines > 0 || activeLoanInfo;

  if (remaining > 0 && hasDebts) {
    // Pay new fines first (generated from these contributions)
    // These are recorded as new fine records, so they add to unpaid
    // Then pay existing fines
    // Then loan

    // Pay fines (new + existing together)
    const allFinesForPayment = [
      ...finesGenerated.map((f, i) => ({ ...f, _isNew: true, _index: i })),
      ...unpaidFines.map(f => ({ ...f, _isNew: false })),
    ];

    for (const f of allFinesForPayment) {
      if (remaining <= 0) break;
      const payAmount = Math.min(remaining, f.amount);
      remaining -= payAmount;

      finesPaid.push({
        fine_id: f._isNew ? null : f.id, // null = will be set after creation
        amount_applied: payAmount,
        reason: f.reason,
        _isNew: f._isNew,
        _newIndex: f._isNew ? f._index : undefined,
      });
    }

    // Pay loan
    if (remaining > 0 && activeLoanInfo) {
      const loanPayment = Math.min(remaining, activeLoanInfo.outstanding);
      remaining -= loanPayment;
      loanRepayment = {
        loan_id: activeLoanInfo.loan_id,
        loan_number: activeLoanInfo.loan_number,
        amount: loanPayment,
        outstanding_before: activeLoanInfo.outstanding,
        outstanding_after: activeLoanInfo.outstanding - loanPayment,
      };
    }
  }

  // Step 3: Remaining → partial contribution (if no debts, or after debts)
  if (remaining > 0 && unpaidMonths.length > contributions.length) {
    const nextUnpaid = unpaidMonths[contributions.length];
    partialContribution = {
      month: nextUnpaid.month,
      year: nextUnpaid.year,
      fy: nextUnpaid.fy,
      amount: remaining,
    };
    remaining = 0;
  }

  // Member info
  const member = await Member.findOne({ id: memberId }).lean();

  return {
    member_id: memberId,
    member_name: member ? member.name : '?',
    total_amount: totalAmount,
    paid_date: paidDate,
    contributions,
    fines_generated: finesGenerated,
    fines_paid: finesPaid,
    loan_repayment: loanRepayment,
    partial_contribution: partialContribution,
    unallocated_remainder: remaining,
    summary: {
      months_covered: contributions.length,
      contribution_total: contributions.reduce((s, c) => s + c.amount, 0),
      fines_total: finesGenerated.reduce((s, f) => s + f.amount, 0),
      fines_paid_total: finesPaid.reduce((s, f) => s + f.amount_applied, 0),
      loan_repayment_total: loanRepayment ? loanRepayment.amount : 0,
      partial_total: partialContribution ? partialContribution.amount : 0,
      existing_unpaid_fines: totalExistingFines,
      active_loan_outstanding: activeLoanInfo ? activeLoanInfo.outstanding : 0,
    },
  };
}

module.exports = router;
