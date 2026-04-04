const express = require('express');
const router = express.Router();
const { Contribution, Member, Transaction, Fine } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─── Fiscal Year helpers ──────────────────────────────────────────────────────
// FY starts in March and ends in February of the following calendar year.
//   FY2025 = March 2025 – February 2026  (old rules: no late-payment fine)
//   FY2026 = March 2026 – February 2027  (new Katiba: 15% fine/month late)
function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

// Months in fiscal-year display order (Mar → Feb)
const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

// ─── Late-payment helper ──────────────────────────────────────────────────────
// Returns how many months past the 5th-of-next-month deadline the payment was.
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
router.get('/fine-preview', authenticate, requireAdmin, (req, res) => {
  const { amount, month, year, paid_date } = req.query;
  if (!amount || !month || !year || !paid_date) return res.json({ penalty: 0, reason: null });

  const m  = parseInt(month);
  const y  = parseInt(year);
  const p  = parseInt(amount);
  const fy = getFiscalYear(m, y);

  // Fine only applies from FY2026 onwards (new Katiba)
  if (fy < 2026) return res.json({ penalty: 0, reason: null });

  const monthsLate = getMonthsLate(m, y, paid_date);
  if (monthsLate > 0) {
    const penalty = Math.round(p * 0.15 * monthsLate);
    return res.json({ penalty, months_late: monthsLate, reason: `Late contribution ${m}/${y} (${monthsLate} months)` });
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
// :fy is the Fiscal Year (e.g. 2025 = March 2025 – February 2026)
router.get('/grid/:year', authenticate, async (req, res) => {
  const fy = parseInt(req.params.year);

  const membersList = await Member.find({ status: 'active' }).lean();
  membersList.sort((a, b) => a.name.localeCompare(b.name));

  // Fetch all contributions that belong to this FY
  const contribs = await Contribution.find({
    $or: [
      { year: fy,     month: { $gte: 3 } },  // Mar–Dec of FY year
      { year: fy + 1, month: { $lte: 2 } },  // Jan–Feb of FY year + 1
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

  res.json({ grid, monthlyTotals, year: fy, fyMonths: FY_MONTHS });
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

  // Check duplicate
  const exists = await Contribution.findOne({ member_id: parseInt(member_id), month: mMonth, year: mYear });
  if (exists) return res.status(409).json({ error: 'Contribution already recorded for this month/year' });

  const { getNextId } = require('../db/models');

  // FY2026+ Katiba fine: 15% per month late
  if (fy >= 2026 && status === 'paid') {
    const monthsLate = getMonthsLate(mMonth, mYear, pDate);
    if (monthsLate > 0) {
      const fineAmount = Math.round(mAmount * 0.15 * monthsLate);
      await Fine.create({
        id:        await getNextId('fine_id'),
        member_id: parseInt(member_id),
        amount:    fineAmount,
        reason:    `Late contribution ${mMonth}/${mYear} (${monthsLate} months, FY${fy})`,
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
    description:      `Monthly contribution - ${member ? member.name : ''} (FY${fy})`,
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
