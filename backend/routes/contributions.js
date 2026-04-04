const express = require('express');
const router = express.Router();
const { Contribution, Member, Transaction, Fine } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getRulesForFY } = require('./rules');

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
    const penalty = Math.round(p * rules.late_fine_rate * monthsLate);
    return res.json({
      penalty,
      months_late: monthsLate,
      rate: rules.late_fine_rate,
      reason: `Late contribution ${m}/${y} (${monthsLate} months × ${Math.round(rules.late_fine_rate * 100)}%)`,
    });
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
      const fineAmount = Math.round(mAmount * rules.late_fine_rate * monthsLate);
      await Fine.create({
        id:        await getNextId('fine_id'),
        member_id: parseInt(member_id),
        amount:    fineAmount,
        reason:    `Late contribution ${mMonth}/${mYear} — ${monthsLate} month(s) × ${Math.round(rules.late_fine_rate * 100)}% (FY${fy})`,
        year:      fy,
        status:    'unpaid',
      });
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

module.exports = router;
