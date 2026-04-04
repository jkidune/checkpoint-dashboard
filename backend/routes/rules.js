const express = require('express');
const router = express.Router();
const { FyRules } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─── Default rules per FY (fallback if no DB record exists) ──────────────────
const DEFAULTS = {
  2024: {
    contribution_amount:     50000,
    late_fine_enabled:       false,
    late_fine_rate:          0.15,
    loan_interest_rate:      0.05,
    loan_max_ratio:          null,
    loan_repayment_months:   null,
    overdue_penalty_enabled: false,
    overdue_penalty_rate:    0.10,
    entry_fee:               500000,
  },
  2025: {
    contribution_amount:     75000,
    late_fine_enabled:       false,
    late_fine_rate:          0.15,
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
    late_fine_rate:          0.15,
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
  const doc = await FyRules.findOne({ fiscal_year: fy }).lean();
  if (doc) return doc;
  // Return hardcoded defaults so the app works even before the admin sets rules
  return {
    fiscal_year: fy,
    ...(DEFAULTS[fy] || DEFAULTS[2026]),  // use latest known defaults for unknown FYs
  };
}

module.exports.getRulesForFY = getRulesForFY;

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
      late_fine_rate,
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
          late_fine_rate:          Number(late_fine_rate),
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

module.exports.router = router;
