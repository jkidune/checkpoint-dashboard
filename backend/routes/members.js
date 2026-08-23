const express = require('express');
const router = express.Router();
const { Member, Contribution, Loan, Repayment, Fine, User, getNextId } = require('../db/models');
const { authenticate, requireAdmin, requireSelfOrAdmin } = require('../middleware/auth');

function getFiscalYear(month, year) {
  return Number(month) >= 3 ? Number(year) : Number(year) - 1;
}

function currentFiscalYear() {
  const now = new Date();
  return getFiscalYear(now.getMonth() + 1, now.getFullYear());
}

function accountShape(user, member) {
  if (!member.email) {
    return { status: 'missing_email', active: false, username: user?.username || null };
  }
  if (!user) {
    return { status: 'not_activated', active: false, username: null };
  }
  return { status: 'active', active: true, username: user.username, user_id: user.id };
}

async function enrichMember(m, { contributions, loans, repayments, fines, users }) {
  const mContribs = contributions.filter((c) => c.member_id === m.id);
  const mLoans = loans.filter((l) => l.member_id === m.id);
  const activeLoans = mLoans.filter((l) => l.status === 'active');
  const mFines = fines.filter((f) => f.member_id === m.id);
  const fy = currentFiscalYear();
  const currentFYContribs = mContribs.filter((c) => getFiscalYear(c.month, c.year) === fy);
  const user = users.find((u) => u.member_id === m.id);

  const enrichedLoans = mLoans.map((loan) => {
    const loanRepayments = repayments.filter((r) => r.loan_id === loan.id);
    const totalRepaid = loanRepayments.reduce((sum, repayment) => sum + Number(repayment.amount || 0), 0);
    return {
      ...loan,
      total_repaid: totalRepaid,
      balance: Math.max(0, Number(loan.principal || 0) - totalRepaid),
      repayments: loanRepayments.sort((a, b) => String(b.repayment_date || '').localeCompare(String(a.repayment_date || ''))),
    };
  });

  const activeAmount = enrichedLoans
    .filter((loan) => loan.status === 'active')
    .reduce((sum, loan) => sum + Number(loan.balance || 0), 0);

  return {
    ...m,
    current_fiscal_year: fy,
    current_fy_contributions: currentFYContribs.reduce((sum, c) => sum + Number(c.amount || 0), 0),
    current_fy_months_paid: currentFYContribs.filter((c) => c.status === 'paid').length,
    total_contributions: mContribs.reduce((sum, c) => sum + Number(c.amount || 0), 0),
    active_loans: activeLoans.length,
    active_loan_amount: activeAmount,
    unpaid_fines: mFines.filter((f) => f.status === 'unpaid').reduce((sum, f) => sum + Number(f.amount || 0), 0),
    account: accountShape(user, m),
    contributions: mContribs,
    loans: enrichedLoans.sort((a, b) => String(b.issued_date || '').localeCompare(String(a.issued_date || ''))),
    fines: mFines.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
  };
}

async function loadContext() {
  const [contributions, loans, repayments, fines, users] = await Promise.all([
    Contribution.find().lean(),
    Loan.find().lean(),
    Repayment.find().lean(),
    Fine.find().lean(),
    User.find().select('id member_id username role email').lean(),
  ]);
  return { contributions, loans, repayments, fines, users };
}

router.get('/', authenticate, async (req, res) => {
  const members = await Member.find().lean();
  const ctx = await loadContext();
  const isAdmin = req.user.role === 'admin';

  const result = await Promise.all(members.map(async (member) => {
    if (isAdmin || member.id === req.user.member_id) return enrichMember(member, ctx);
    return { id: member.id, name: member.name, office: member.office, status: member.status };
  }));

  res.json(result.sort((a, b) => a.name.localeCompare(b.name)));
});

router.get('/me', authenticate, async (req, res) => {
  if (req.user.member_id == null) return res.status(404).json({ error: 'This account has no linked member record' });

  const member = await Member.findOne({ id: req.user.member_id }).lean();
  if (!member) return res.status(404).json({ error: 'Member not found' });

  res.json(await enrichMember(member, await loadContext()));
});

router.get('/:id', authenticate, requireSelfOrAdmin((req) => parseInt(req.params.id, 10)), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const member = await Member.findOne({ id }).lean();
  if (!member) return res.status(404).json({ error: 'Member not found' });

  res.json(await enrichMember(member, await loadContext()));
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { name, phone, email, office, join_date } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const member = await Member.create({
    id: await getNextId('member_id'),
    name,
    email: email ? String(email).trim().toLowerCase() : null,
    phone: phone || null,
    office: office || 'member',
    status: 'active',
    entry_fee: 500000,
    join_date: join_date || new Date().toISOString().split('T')[0],
  });
  res.status(201).json(member);
});

router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, phone, email, office, status } = req.body;

  const updates = {};
  if (name) updates.name = name;
  if (phone !== undefined) updates.phone = phone || null;
  if (email !== undefined) updates.email = email ? String(email).trim().toLowerCase() : null;
  if (office) updates.office = office;
  if (status) updates.status = status;

  const member = await Member.findOneAndUpdate({ id }, { $set: updates }, { new: true }).lean();
  if (!member) return res.status(404).json({ error: 'Member not found' });

  // Keep an existing linked login email synchronized with the canonical member email.
  if (email !== undefined) {
    await User.updateOne(
      { member_id: id },
      { $set: { email: email ? String(email).trim().toLowerCase() : null } },
    );
  }

  res.json(await enrichMember(member, await loadContext()));
});

module.exports = router;
