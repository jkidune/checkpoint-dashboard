const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  Counter, Member, Contribution, Loan, Repayment,
  Transaction, User, Fine, WelfareEvent, AuditLog,
} = require('../db/models');

// ─── GET /api/admin/users ────────────────────────────────────────────────────
// Admin-only access register. Password hashes are never returned.
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  const [users, members] = await Promise.all([
    User.find().select('id member_id username email role status name created_at').sort({ id: 1 }).lean(),
    Member.find().select('id name').lean(),
  ]);
  const memberNames = new Map(members.map((member) => [member.id, member.name]));
  res.json(users.map((user) => ({
    ...user,
    status: user.status || 'active',
    display_name: memberNames.get(user.member_id) || user.name || user.username,
  })));
});

// ─── PATCH /api/admin/users/:id ──────────────────────────────────────────────
router.patch('/users/:id', authenticate, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const original = await User.findOne({ id }).lean();
  if (!original) return res.status(404).json({ error: 'User not found' });

  const role = req.body.role ?? original.role;
  const status = req.body.status ?? original.status ?? 'active';
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Role must be admin or member' });
  if (!['active', 'disabled'].includes(status)) return res.status(400).json({ error: 'Status must be active or disabled' });
  if (id === req.user.id && (role !== 'admin' || status !== 'active')) {
    return res.status(400).json({ error: 'You cannot remove or disable your own admin access' });
  }

  if (original.role === 'admin' && original.status !== 'disabled' && (role !== 'admin' || status === 'disabled')) {
    const otherAdmins = await User.countDocuments({ id: { $ne: id }, role: 'admin', status: { $ne: 'disabled' } });
    if (otherAdmins === 0) return res.status(400).json({ error: 'At least one active administrator is required' });
  }

  const updated = await User.findOneAndUpdate(
    { id },
    { $set: { role, status } },
    { new: true }
  ).select('id member_id username email role status name created_at').lean();

  await AuditLog.create({
    record_type: 'user_access', record_id: id, action: 'update',
    old_value: { role: original.role, status: original.status || 'active' },
    new_value: { role: updated.role, status: updated.status },
    reason: req.body.reason || 'Access updated in Admin Controls', user: req.user.username,
  });
  res.json(updated);
});

// ─── POST /api/admin/sync-counters ───────────────────────────────────────────
// One-time fix: sets each counter to the current max id in its collection.
// Run once after migrating away from mongoose-sequence.
router.post('/sync-counters', authenticate, requireAdmin, async (req, res) => {
  try {
    const targets = [
      { model: Member,       counter: 'member_id' },
      { model: Contribution, counter: 'contribution_id' },
      { model: Loan,         counter: 'loan_id' },
      { model: Repayment,    counter: 'repayment_id' },
      { model: Transaction,  counter: 'transaction_id' },
      { model: User,         counter: 'user_id' },
      { model: Fine,         counter: 'fine_id' },
      { model: WelfareEvent, counter: 'welfare_id' },
    ];

    const result = {};
    for (const { model, counter } of targets) {
      const doc = await model.findOne({}).sort({ id: -1 }).select('id').lean();
      const maxId = doc?.id || 0;
      await Counter.findByIdAndUpdate(
        counter,
        { $set: { seq: maxId } },
        { upsert: true }
      );
      result[counter] = maxId;
    }

    res.json({ ok: true, counters: result });
  } catch (err) {
    console.error('sync-counters error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
