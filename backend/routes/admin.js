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

// ─── POST /api/admin/migrate-member-office ───────────────────────────────────
// One-time backfill for the Member.role -> Member.office rename. Existing
// production documents still have the old `role` field; this copies it into
// `office` for any member missing that field. Uses the raw MongoDB collection
// (not the Mongoose model) so it can read/write `role` even though it's no
// longer declared in the schema. Additive only — never touches or removes the
// old `role` field. Idempotent: only matches documents still missing `office`,
// so re-running it after a successful backfill reports 0 updates. Safe to
// remove this route once confirmed run in production.
router.post('/migrate-member-office', authenticate, requireAdmin, async (req, res) => {
  try {
    const toMigrate = await Member.collection.find({
      $and: [
        { $or: [{ office: { $exists: false } }, { office: null }] },
        { role: { $exists: true, $ne: null } },
      ],
    }).project({ id: 1, name: 1, role: 1 }).toArray();

    if (toMigrate.length === 0) {
      return res.json({ ok: true, matched: 0, updated: 0, members: [] });
    }

    const bulkOps = toMigrate.map((m) => ({
      updateOne: {
        filter: { _id: m._id },
        update: { $set: { office: m.role } },
      },
    }));

    const result = await Member.collection.bulkWrite(bulkOps);

    res.json({
      ok: true,
      matched: toMigrate.length,
      updated: result.modifiedCount,
      members: toMigrate.length <= 50
        ? toMigrate.map((m) => ({ id: m.id, name: m.name, office: m.role }))
        : undefined,
    });
  } catch (err) {
    console.error('migrate-member-office error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
