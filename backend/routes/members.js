const express = require('express');
const router = express.Router();
const { Member, Contribution, Loan, Repayment, Fine, getNextId } = require('../db/models');
const { authenticate, requireAdmin, requireSelfOrAdmin } = require('../middleware/auth');

// ─── enrichMember ───────────────────────────────────────────────────────────
// Full financial shape for one member (used by GET /me, GET /:id, and the
// caller's own row in GET / for a member token).
async function enrichMember(m, { contributions, loans, repayments, fines }) {
  const mContribs   = contributions.filter(c => c.member_id === m.id);
  const mLoans      = loans.filter(l => l.member_id === m.id);
  const activeLoans = mLoans.filter(l => l.status === 'active');
  const mFines      = fines.filter(f => f.member_id === m.id && f.status === 'unpaid');

  const activeAmount = activeLoans.reduce((s, l) => {
    const paid = repayments.filter(r => r.loan_id === l.id).reduce((a, r) => a + r.amount, 0);
    return s + (l.principal - paid);
  }, 0);

  return {
    ...m,
    contributions_2025:  mContribs.filter(c => c.year === 2025).reduce((s, c) => s + c.amount, 0),
    contributions_2024:  mContribs.filter(c => c.year === 2024).reduce((s, c) => s + c.amount, 0),
    total_contributions: mContribs.reduce((s, c) => s + c.amount, 0),
    active_loans:        activeLoans.length,
    active_loan_amount:  activeAmount,
    unpaid_fines:        mFines.reduce((s, f) => s + f.amount, 0),
    months_paid_2025:    mContribs.filter(c => c.year === 2025 && c.month >= 3 && c.status === 'paid').length,
  };
}

// ─── GET / ────────────────────────────────────────────────────────────────────
// Admins get the full financial shape for every member.
// Members get a trimmed {id,name,office,status} shape for everyone else's row —
// no loan flag, no contribution/compliance figures on other members — and the
// full shape for their own row (avoids a redundant round-trip; the same data is
// also available via GET /me).
router.get('/', authenticate, async (req, res) => {
  const members       = await Member.find().lean();
  const contributions = await Contribution.find().lean();
  const loans         = await Loan.find().lean();
  const repayments    = await Repayment.find().lean();
  const fines         = await Fine.find().lean();

  const isAdmin = req.user.role === 'admin';
  const ctx = { contributions, loans, repayments, fines };

  const result = await Promise.all(members.map(async m => {
    if (isAdmin || m.id === req.user.member_id) {
      return enrichMember(m, ctx);
    }
    return { id: m.id, name: m.name, office: m.office, status: m.status };
  }));

  res.json(result.sort((a, b) => a.name.localeCompare(b.name)));
});

// ─── GET /me ──────────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  if (req.user.member_id == null) return res.status(404).json({ error: 'This account has no linked member record' });

  const id = req.user.member_id;
  const member = await Member.findOne({ id }).lean();
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const contributions = await Contribution.find({ member_id: id }).lean();
  contributions.sort((a, b) => b.year - a.year || b.month - a.month);

  const allLoans   = await Loan.find({ member_id: id }).lean();
  const repayments = await Repayment.find().lean();
  const loans = allLoans.map(l => ({
    ...l,
    total_repaid: repayments.filter(r => r.loan_id === l.id).reduce((s, r) => s + r.amount, 0),
  })).sort((a, b) => b.issued_date.localeCompare(a.issued_date));

  const fines        = await Fine.find({ member_id: id }).lean();
  const unpaid_fines = fines.filter(f => f.status === 'unpaid').reduce((s, f) => s + f.amount, 0);
  const months_paid_2025   = contributions.filter(c => c.year === 2025 && c.month >= 3 && c.status === 'paid').length;
  const contributions_2025 = contributions.filter(c => c.year === 2025).reduce((s, c) => s + c.amount, 0);
  const contributions_2024 = contributions.filter(c => c.year === 2024).reduce((s, c) => s + c.amount, 0);
  const active_loan_amount = loans.filter(l => l.status === 'active').reduce((s, l) => s + (l.principal - l.total_repaid), 0);

  res.json({ ...member, contributions, loans, fines, unpaid_fines, months_paid_2025, contributions_2025, contributions_2024, active_loan_amount });
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, requireSelfOrAdmin(req => parseInt(req.params.id)), async (req, res) => {
  const id = parseInt(req.params.id);
  const member = await Member.findOne({ id }).lean();
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const contributions = await Contribution.find({ member_id: id }).lean();
  contributions.sort((a, b) => b.year - a.year || b.month - a.month);

  const allLoans   = await Loan.find({ member_id: id }).lean();
  const repayments = await Repayment.find().lean();
  const loans = allLoans.map(l => ({
    ...l,
    total_repaid: repayments.filter(r => r.loan_id === l.id).reduce((s, r) => s + r.amount, 0),
  })).sort((a, b) => b.issued_date.localeCompare(a.issued_date));

  const fines         = await Fine.find({ member_id: id }).lean();
  const unpaid_fines  = fines.filter(f => f.status === 'unpaid').reduce((s, f) => s + f.amount, 0);
  const months_paid_2025    = contributions.filter(c => c.year === 2025 && c.month >= 3 && c.status === 'paid').length;
  const contributions_2025  = contributions.filter(c => c.year === 2025).reduce((s, c) => s + c.amount, 0);
  const contributions_2024  = contributions.filter(c => c.year === 2024).reduce((s, c) => s + c.amount, 0);
  const active_loan_amount  = loans.filter(l => l.status === 'active').reduce((s, l) => s + (l.principal - l.total_repaid), 0);

  res.json({ ...member, contributions, loans, fines, unpaid_fines, months_paid_2025, contributions_2025, contributions_2024, active_loan_amount });
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { name, phone, office, join_date } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const member = await Member.create({
    id:       await getNextId('member_id'),
    name,
    phone:    phone || null,
    office:   office || 'member',
    status:   'active',
    entry_fee: 500000,
    join_date: join_date || new Date().toISOString().split('T')[0],
  });
  res.status(201).json(member);
});

router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, phone, email, office, status } = req.body;

  const updates = {};
  if (name)              updates.name   = name;
  if (phone)             updates.phone  = phone;
  if (email !== undefined) updates.email = email;
  if (office)            updates.office = office;
  if (status)            updates.status = status;

  const member = await Member.findOneAndUpdate({ id }, { $set: updates }, { new: true }).lean();
  res.json(member);
});

module.exports = router;
