const express = require('express');
const router = express.Router();
const { Contribution, Member, Transaction, Fine } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

function getMonthsLate(month, year, paid_date) {
  let dY = year;
  let dM = month + 1;
  if (dM > 12) { dM = 1; dY++; }
  
  const deadline = new Date(`${dY}-${String(dM).padStart(2, '0')}-05T00:00:00Z`);
  const paid = new Date(`${paid_date}T12:00:00Z`); // use midday to avoid timezone edge cases
  
  if (paid <= deadline) return 0;
  
  let diff = (paid.getUTCFullYear() - deadline.getUTCFullYear()) * 12;
  diff -= deadline.getUTCMonth();
  diff += paid.getUTCMonth();
  
  if (paid.getUTCDate() > 5) {
    diff++;
  }
  
  return diff <= 0 && paid > deadline ? 1 : diff;
}

router.get('/fine-preview', authenticate, requireAdmin, (req, res) => {
  const { amount, month, year, paid_date } = req.query;
  if (!amount || !month || !year || !paid_date) return res.json({ penalty: 0, reason: null });
  
  const m = parseInt(month);
  const y = parseInt(year);
  const p = parseInt(amount);

  if (y < 2026) return res.json({ penalty: 0, reason: null });

  const monthsLate = getMonthsLate(m, y, paid_date);
  if (monthsLate > 0) {
    const penalty = Math.round(p * 0.15 * monthsLate);
    return res.json({ penalty, months_late: monthsLate, reason: `Late contribution ${m}/${y} (${monthsLate} months)` });
  }

  res.json({ penalty: 0, reason: null });
});

router.get('/', authenticate, async (req, res) => {
  const { year, month, member_id } = req.query;
  const filter = {};
  if (year) filter.year = parseInt(year);
  if (month) filter.month = parseInt(month);
  if (member_id) filter.member_id = parseInt(member_id);

  let list = await Contribution.find(filter).lean();
  const members = await Member.find().lean();
  
  list = list.map(c => ({ 
    ...c, 
    member_name: (members.find(m => m.id === c.member_id)||{}).name || '?' 
  }));
  res.json(list.sort((a,b) => b.year - a.year || b.month - a.month));
});

router.get('/grid/:year', authenticate, async (req, res) => {
  const year = parseInt(req.params.year);
  const members = await Member.find({ status: 'active' }).lean();
  members.sort((a,b) => a.name.localeCompare(b.name));
  
  const contribs = await Contribution.find({ year }).lean();

  const grid = members.map(m => {
    const months = {};
    for (let i = 1; i <= 12; i++) {
      const c = contribs.find(c => c.member_id === m.id && c.month === i);
      months[i] = c ? { amount: c.amount, status: c.status, id: c.id } : null;
    }
    return {
      member_id: m.id,
      member_name: m.name,
      role: m.role,
      months,
      total: contribs.filter(c => c.member_id === m.id).reduce((s,c) => s+c.amount, 0),
    };
  });

  const monthlyTotals = {};
  for (let i = 1; i <= 12; i++) {
    monthlyTotals[i] = contribs.filter(c => c.month === i).reduce((s,c) => s+c.amount, 0);
  }

  res.json({ grid, monthlyTotals, year });
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { member_id, amount, month, year, status, paid_date, mpesa_ref, notes } = req.body;
  if (!member_id || !amount || !month || !year) return res.status(400).json({ error: 'member_id, amount, month, year required' });

  const mYear = parseInt(year);
  const mMonth = parseInt(month);
  const mAmount = parseInt(amount);
  const pDate = paid_date || new Date().toISOString().split('T')[0];

  // Check duplicate
  const exists = await Contribution.findOne({ 
    member_id: parseInt(member_id), 
    month: mMonth, 
    year: mYear 
  });
  if (exists) return res.status(409).json({ error: 'Contribution already recorded for this month/year' });

  // Handle new FY2026 Katiba Fine Rule
  if (mYear >= 2026 && status === 'paid') {
      const monthsLate = getMonthsLate(mMonth, mYear, pDate);
      if (monthsLate > 0) {
          const fineAmount = Math.round(mAmount * 0.15 * monthsLate);
          const fine = new Fine({
              member_id: parseInt(member_id),
              amount: fineAmount,
              reason: `Late contribution ${mMonth}/${mYear} (${monthsLate} months)`,
              year: mYear,
              status: 'unpaid',
          });
          await fine.save();
      }
  }

  const contrib = new Contribution({
    member_id: parseInt(member_id), 
    amount: mAmount,
    month: mMonth, 
    year: mYear, 
    status: status || 'paid',
    paid_date: pDate, 
    mpesa_ref: mpesa_ref || null,
    notes: notes || null
  });
  await contrib.save();

  // Log transaction
  const member = await Member.findOne({ id: parseInt(member_id) });
  const tx = new Transaction({
    member_id: parseInt(member_id), 
    amount: mAmount,
    type: 'contribution', 
    description: `Monthly contribution - ${member ? member.name : ''}`,
    reference: mpesa_ref || null, 
    transaction_date: pDate
  });
  await tx.save();

  res.status(201).json(contrib);
});

router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { amount, status, paid_date, mpesa_ref, notes } = req.body;
  const updates = {};
  if (amount !== undefined)   updates.amount = parseInt(amount);
  if (status)                 updates.status = status;
  if (paid_date)              updates.paid_date = paid_date;
  if (mpesa_ref !== undefined) updates.mpesa_ref = mpesa_ref;
  if (notes !== undefined)    updates.notes = notes;
  
  const updated = await Contribution.findOneAndUpdate({ id }, { $set: updates }, { new: true }).lean();
  res.json(updated);
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  await Contribution.findOneAndDelete({ id });
  res.json({ success: true });
});

module.exports = router;
