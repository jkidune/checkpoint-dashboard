const express = require('express');
const router = express.Router();
const { FyRules } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─── Default rules per FY (fallback if no DB record exists) ──────────────────
const DEFAULTS = {
  2024: {
    contribution_amount:     50000,
    late_fine_enabled:       false,
    late_fine_type:          'flat',
    late_fine_rate:          0.15,
    late_fine_flat_amount:   3500,
    loan_interest_rate:      0.05,
    loan_max_ratio:          null,
    loan_repayment_months:   null,
    overdue_penalty_enabled: false,
    overdue_penalty_rate:    0.10,
    entry_fee:               500000,
  },
  2025: {
    contribution_amount:     75000,
    late_fine_enabled:       true,
    late_fine_type:          'flat',
    late_fine_rate:          0.15,
    late_fine_flat_amount:   3500,
    loan_interest_rate:      0.05,
    loan_max_ratio:          null,
    loan_repayment_months:   null,
    overdue_penalty_enabled: false,
    overdue_penalty_rate:    0.10,
    entry_fee:               500000,
  },
  2026: {
    contribution_amount:     75000,
    late_fine_enabled:       true,
    late_fine_type:          'percentage',
    late_fine_rate:          0.15,
    late_fine_flat_amount:   3500,
    loan_interest_rate:      0.12,
    loan_max_ratio:          0.80,
    loan_repayment_months:   6,
    overdue_penalty_enabled: true,
    overdue_penalty_rate:    0.10,
    entry_fee:               500000,
  },
};

// Exported helper — used by contributions.js and loans.js
async function getRulesForFY(fy) {
  const defaults = DEFAULTS[fy] || DEFAULTS[2026];
  const doc = await FyRules.findOne({ fiscal_year: fy }).lean();
  if (doc) {
    // CRITICAL: always spread defaults FIRST so that new fields (e.g. late_fine_type,
    // late_fine_flat_amount) are filled in for DB records saved before those fields
    // were added to the schema.  DB values take precedence where they exist.
    return { ...defaults, ...doc };
  }
  return { fiscal_year: fy, ...defaults };
}

// ─── Fine calculation helper (shared by contributions.js) ─────────────────────
// Returns { amount, reason } based on the FY rules.
// For 'flat' type: one-time flat fine regardless of how many months late.
// For 'percentage' type: rate × contribution × months_late.
function calculateFine(rules, contributionAmount, monthsLate, month, year, fy) {
  if (!rules.late_fine_enabled || monthsLate <= 0) return null;

  const type = rules.late_fine_type || 'percentage';

  if (type === 'flat') {
    return {
      amount: rules.late_fine_flat_amount || 3500,
      reason: `Late contribution ${month}/${year} — flat fine TZS ${(rules.late_fine_flat_amount || 3500).toLocaleString()} (FY${fy})`,
    };
  }

  // percentage type
  const fineAmount = Math.round(contributionAmount * rules.late_fine_rate * monthsLate);
  return {
    amount: fineAmount,
    reason: `Late contribution ${month}/${year} — ${monthsLate} month(s) × ${Math.round(rules.late_fine_rate * 100)}% (FY${fy})`,
  };
}

module.exports.getRulesForFY = getRulesForFY;
module.exports.calculateFine = calculateFine;

// ─── GET /api/rules ───────────────────────────────────────────────────────────
// Returns all FY rules, merging DB records with defaults for known FYs.
router.get('/', authenticate, async (req, res) => {
  try {
    const dbRules = await FyRules.find().lean();
    const dbByFY  = Object.fromEntries(dbRules.map(r => [r.fiscal_year, r]));

    const knownFYs = [...new Set([...Object.keys(DEFAULTS).map(Number), ...dbRules.map(r => r.fiscal_year)])].sort();

    const result = knownFYs.map(fy => ({
      ...(DEFAULTS[fy] || DEFAULTS[2026]),
      ...(dbByFY[fy] || {}),
      fiscal_year: fy,
      _fromDB: !!dbByFY[fy],
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/rules/:fy ───────────────────────────────────────────────────────
router.get('/:fy', authenticate, async (req, res) => {
  try {
    const fy   = parseInt(req.params.fy);
    const rules = await getRulesForFY(fy);
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/rules/:fy ───────────────────────────────────────────────────────
// Creates or fully replaces rules for a given FY. Admin only.
router.put('/:fy', authenticate, requireAdmin, async (req, res) => {
  try {
    const fy = parseInt(req.params.fy);
    const {
      contribution_amount,
      late_fine_enabled,
      late_fine_type,
      late_fine_rate,
      late_fine_flat_amount,
      loan_interest_rate,
      loan_max_ratio,
      loan_repayment_months,
      overdue_penalty_enabled,
      overdue_penalty_rate,
      entry_fee,
    } = req.body;

    const rules = await FyRules.findOneAndUpdate(
      { fiscal_year: fy },
      {
        $set: {
          fiscal_year: fy,
          contribution_amount:     Number(contribution_amount),
          late_fine_enabled:       Boolean(late_fine_enabled),
          late_fine_type:          late_fine_type || 'percentage',
          late_fine_rate:          Number(late_fine_rate),
          late_fine_flat_amount:   Number(late_fine_flat_amount) || 3500,
          loan_interest_rate:      Number(loan_interest_rate),
          loan_max_ratio:          loan_max_ratio !== null && loan_max_ratio !== '' ? Number(loan_max_ratio) : null,
          loan_repayment_months:   loan_repayment_months !== null && loan_repayment_months !== '' ? Number(loan_repayment_months) : null,
          overdue_penalty_enabled: Boolean(overdue_penalty_enabled),
          overdue_penalty_rate:    Number(overdue_penalty_rate),
          entry_fee:               Number(entry_fee),
          updated_at:              new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' }
    ).lean();

    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/rules/:fy ────────────────────────────────────────────────────
// Resets a FY back to defaults by removing the DB override.
router.delete('/:fy', authenticate, requireAdmin, async (req, res) => {
  try {
    const fy = parseInt(req.params.fy);
    await FyRules.findOneAndDelete({ fiscal_year: fy });
    res.json({ ok: true, message: `FY${fy} rules reset to defaults` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Shared: months-late calculator (from a paid_date) ───────────────────────
function getMonthsLate(month, year, paid_date) {
  let dY = year, dM = month + 1;
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

// ─── Shared: months-late from deadline to today (for missing contributions) ──
function getMonthsLateToday(month, year) {
  let dY = year, dM = month + 1;
  if (dM > 12) { dM = 1; dY++; }
  const deadline = new Date(`${dY}-${String(dM).padStart(2, '0')}-05T00:00:00Z`);
  const today    = new Date();
  if (today < deadline) return -1;  // deadline hasn't passed yet
  let diff = (today.getUTCFullYear() - deadline.getUTCFullYear()) * 12;
  diff -= deadline.getUTCMonth();
  diff += today.getUTCMonth();
  if (today.getUTCDate() > 5) diff++;
  return diff <= 0 ? 1 : diff;
}

const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

// ─── Core scan logic ──────────────────────────────────────────────────────────
// Scans TWO categories for a given FY and returns fines to generate:
//   A) Paid contributions that were paid after the deadline (paid late)
//   B) Active members with NO contribution at all for a month whose deadline passed
// This ensures members like Elias/William who never contributed also get fines.
async function buildFinesForFY(fy, rules) {
  const { Contribution, Fine, Member } = require('../db/models');

  const members = await Member.find({ status: 'active' }).lean();
  const contribs = await Contribution.find({
    $or: [
      { year: fy,     month: { $gte: 3 } },
      { year: fy + 1, month: { $lte: 2 } },
    ],
  }).lean();

  // Build a fast lookup: "memberId-month-year" → contribution
  const contribMap = {};
  for (const c of contribs) {
    contribMap[`${c.member_id}-${c.month}-${c.year}`] = c;
  }

  const toGenerate = [];  // { member_id, member_name, month, year, fy, monthsLate, fineCalc, type }

  for (const member of members) {
    for (const mo of FY_MONTHS) {
      const yr  = mo >= 3 ? fy : fy + 1;
      const key = `${member.id}-${mo}-${yr}`;
      const c   = contribMap[key];

      let monthsLate = 0;
      let type = null;

      if (c && c.status === 'paid' && c.paid_date) {
        // Category A: paid contribution — check if it was paid late
        monthsLate = getMonthsLate(mo, yr, c.paid_date);
        if (monthsLate > 0) type = 'paid_late';
      } else if (!c) {
        // Category B: no contribution at all — check if deadline has passed
        monthsLate = getMonthsLateToday(mo, yr);
        if (monthsLate > 0) type = 'missing';
      }

      if (!type) continue;

      // Skip if a fine already exists for this member + month/year
      const existingFine = await Fine.findOne({
        member_id: member.id,
        $or: [
          { contribution_month: mo, contribution_year: yr },
          { reason: new RegExp(`Late contribution ${mo}\\/${yr}`) },
        ],
      }).lean();
      if (existingFine) continue;

      const amount = c ? c.amount : rules.contribution_amount;
      const fineCalc = calculateFine(rules, amount, monthsLate, mo, yr, fy);
      if (!fineCalc) continue;

      toGenerate.push({ member_id: member.id, member_name: member.name, month: mo, year: yr, fy, monthsLate, fineCalc, type });
    }
  }

  return toGenerate;
}

// ─── POST /api/rules/:fy/scan-fines ──────────────────────────────────────────
// Retroactively scans for missing/late fines for this FY:
//   • Paid contributions that were paid late
//   • Active members with NO contribution for a past month (missing months)
// Safe to run multiple times — never double-charges.
router.post('/:fy/scan-fines', authenticate, requireAdmin, async (req, res) => {
  try {
    const fy    = parseInt(req.params.fy);
    const rules = await getRulesForFY(fy);

    if (!rules.late_fine_enabled) {
      return res.json({ ok: true, generated: 0, message: `Late fines not enabled for FY${fy} — enable in Settings first.` });
    }

    const { getNextId, Fine } = require('../db/models');
    const toGenerate = await buildFinesForFY(fy, rules);

    let generated = 0;
    const details = [];

    for (const item of toGenerate) {
      await Fine.create({
        id:                 await getNextId('fine_id'),
        member_id:          item.member_id,
        amount:             item.fineCalc.amount,
        reason:             item.fineCalc.reason,
        year:               item.fy,
        contribution_month: item.month,
        contribution_year:  item.year,
        status:             'unpaid',
      });
      generated++;
      details.push({
        member_id:   item.member_id,
        member_name: item.member_name,
        month:       item.month,
        year:        item.year,
        months_late: item.monthsLate,
        fine:        item.fineCalc.amount,
        type:        item.type,   // 'paid_late' or 'missing'
      });
    }

    const missingCount  = details.filter(d => d.type === 'missing').length;
    const paidLateCount = details.filter(d => d.type === 'paid_late').length;

    res.json({
      ok: true,
      generated,
      message: `Scan complete: ${generated} fine(s) generated (${paidLateCount} paid-late, ${missingCount} missing months).`,
      details,
    });
  } catch (err) {
    console.error('scan-fines error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/rules/:fy/recalculate-fines ───────────────────────────────────
// Deletes ALL auto-generated "Late contribution" fines for this FY then
// re-generates them fresh using the current rules.
// Covers BOTH paid-late contributions AND members with missing months.
router.post('/:fy/recalculate-fines', authenticate, requireAdmin, async (req, res) => {
  try {
    const fy    = parseInt(req.params.fy);
    const rules = await getRulesForFY(fy);

    const { Fine, getNextId } = require('../db/models');

    // 1) Delete all auto-generated late-contribution fines for this FY
    const deleteResult = await Fine.deleteMany({
      year:   fy,
      reason: /^Late contribution/,
    });
    const deleted = deleteResult.deletedCount || 0;

    if (!rules.late_fine_enabled) {
      return res.json({
        ok: true, deleted, generated: 0,
        message: `Deleted ${deleted} old fine(s). Late fines not enabled for FY${fy}.`,
      });
    }

    // 2) Re-generate fines for both paid-late AND missing months
    const toGenerate = await buildFinesForFY(fy, rules);

    let generated = 0;
    const details = [];

    for (const item of toGenerate) {
      await Fine.create({
        id:                 await getNextId('fine_id'),
        member_id:          item.member_id,
        amount:             item.fineCalc.amount,
        reason:             item.fineCalc.reason,
        year:               item.fy,
        contribution_month: item.month,
        contribution_year:  item.year,
        status:             'unpaid',
      });
      generated++;
      details.push({
        member_id:   item.member_id,
        member_name: item.member_name,
        month:       item.month,
        year:        item.year,
        months_late: item.monthsLate,
        fine:        item.fineCalc.amount,
        type:        item.type,
      });
    }

    const ruleLabel = rules.late_fine_type === 'flat'
      ? `flat TZS ${(rules.late_fine_flat_amount || 3500).toLocaleString()}`
      : `${Math.round(rules.late_fine_rate * 100)}% per month`;

    const missingCount  = details.filter(d => d.type === 'missing').length;
    const paidLateCount = details.filter(d => d.type === 'paid_late').length;

    res.json({
      ok: true,
      deleted,
      generated,
      message: `Recalculated FY${fy}: deleted ${deleted} old fine(s), generated ${generated} new fine(s) [${paidLateCount} paid-late + ${missingCount} missing months] using ${ruleLabel} rule.`,
      details,
    });
  } catch (err) {
    console.error('recalculate-fines error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports.router = router;
