const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  Counter, Member, Contribution, Loan, Repayment,
  Transaction, User, Fine, WelfareEvent,
} = require('../db/models');

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
