const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');

// Phase 4F-A: this route no longer imports the default/legacy model
// registry. Every database read/write below comes from req.tenantModels,
// established by `authenticate` from the verified JWT's organization_id.
// There is no fallback to a default/global model set — if authenticate
// succeeded, req.tenantModels is expected to exist, and a missing bundle
// throws (property access on undefined) rather than quietly using another
// database. Counters are tenant-local too: sync-counters rewrites the
// `auto_counters` collection of the request's own tenant database only.

// ─── POST /api/admin/sync-counters ───────────────────────────────────────────
// One-time fix: sets each counter to the current max id in its collection.
// Run once after migrating away from mongoose-sequence.
router.post('/sync-counters', authenticate, requireAdmin, async (req, res) => {
  try {
    const models = req.tenantModels;
    const targets = [
      { model: models.Member,       counter: 'member_id' },
      { model: models.Contribution, counter: 'contribution_id' },
      { model: models.Loan,         counter: 'loan_id' },
      { model: models.Repayment,    counter: 'repayment_id' },
      { model: models.Transaction,  counter: 'transaction_id' },
      { model: models.User,         counter: 'user_id' },
      { model: models.Fine,         counter: 'fine_id' },
      { model: models.WelfareEvent, counter: 'welfare_id' },
    ];

    const result = {};
    for (const { model, counter } of targets) {
      const doc = await model.findOne({}).sort({ id: -1 }).select('id').lean();
      const maxId = doc?.id || 0;
      await models.Counter.findByIdAndUpdate(
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
// longer declared in the schema. The raw collection is the one behind the
// request tenant's own Member model (models.Member.collection), so the
// backfill only ever reads and writes that tenant's database. Additive only —
// never touches or removes the old `role` field. Idempotent: only matches
// documents still missing `office`, so re-running it after a successful
// backfill reports 0 updates. Safe to remove this route once confirmed run in
// production.
router.post('/migrate-member-office', authenticate, requireAdmin, async (req, res) => {
  try {
    const models = req.tenantModels;
    const toMigrate = await models.Member.collection.find({
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

    const result = await models.Member.collection.bulkWrite(bulkOps);

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

// ─── GET /api/admin/roster-audit ─────────────────────────────────────────────
// Read-only diagnostic: for every Member, reports whether a linked User
// account exists and whether email/phone are populated. Never returns
// password_hash or any other User credential field. Note: the User schema
// has no status/active-disabled field today, so "has_user" is the only
// account-coverage signal available — there is no way to distinguish an
// active vs. disabled account at the data level yet.
router.get('/roster-audit', authenticate, requireAdmin, async (req, res) => {
  try {
    const models = req.tenantModels;
    const members = await models.Member.find().lean();
    const users = await models.User.find().select('id member_id username role').lean();
    const usersByMemberId = new Map(users.filter(u => u.member_id != null).map(u => [u.member_id, u]));

    const result = members.map(m => {
      const user = usersByMemberId.get(m.id);
      return {
        id: m.id,
        name: m.name,
        status: m.status,
        office: m.office || null,
        email: m.email || null,
        phone: m.phone || null,
        has_user: !!user,
        user_username: user ? user.username : null,
        user_role: user ? user.role : null,
      };
    });

    res.json(result.sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) {
    console.error('roster-audit error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
