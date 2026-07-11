const express = require('express');
const router = express.Router();
const { Investment, NavUpdate, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─── latestNav ────────────────────────────────────────────────────────────────
// Latest NAV reading for a provider+asset_class as of (on or before) `asOf`.
async function latestNav(provider, asset_class, asOf) {
  const readings = await NavUpdate.find({ provider, asset_class }).lean();
  const eligible = readings.filter(r => r.effective_date <= asOf);
  if (eligible.length === 0) return null;
  return eligible.sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
}

// ─── valuateInvestments ─────────────────────────────────────────────────────
// Current value is computed from the latest NAV for unit-based holdings;
// older/manual entries without unit data fall back to carrying_value (here,
// the stored `amount`) — flagged via `valuation` so callers can show "at cost"
// vs "at NAV". Shared with backend/routes/summary.js so the snapshot's
// aggregate investment total uses the same math as the admin investments list.
async function valuateInvestments() {
  const investments = await Investment.find().sort({ created_at: -1 }).lean();
  const today = new Date().toISOString().split('T')[0];

  return Promise.all(investments.map(async inv => {
    if (inv.units_purchased != null && inv.asset_class) {
      const nav = await latestNav(inv.provider, inv.asset_class, today);
      if (nav) {
        return {
          ...inv,
          current_value: inv.units_purchased * nav.unit_cost,
          valuation: 'at_nav',
          latest_unit_cost: nav.unit_cost,
          nav_effective_date: nav.effective_date,
        };
      }
    }
    return { ...inv, current_value: inv.amount, valuation: 'at_cost' };
  }));
}

// ─── GET / ────────────────────────────────────────────────────────────────────
router.get('/', authenticate, requireAdmin, async (req, res) => {
  res.json(await valuateInvestments());
});

// ─── POST /nav ────────────────────────────────────────────────────────────────
// Admin records a new monthly NAV reading for a provider/asset_class.
router.post('/nav', authenticate, requireAdmin, async (req, res) => {
  const { provider, asset_class, unit_cost, effective_date, source } = req.body;
  if (!provider || !asset_class || !unit_cost || !effective_date) {
    return res.status(400).json({ error: 'provider, asset_class, unit_cost, effective_date required' });
  }

  const nav = await NavUpdate.create({
    id:             await getNextId('nav_update_id'),
    provider,
    asset_class,
    unit_cost:      parseFloat(unit_cost),
    effective_date,
    source:         source || null,
    recorded_by:    req.user.name || req.user.username,
  });
  res.status(201).json(nav);
});

// ─── GET /nav-history ─────────────────────────────────────────────────────────
router.get('/nav-history', authenticate, requireAdmin, async (req, res) => {
  const { provider, asset_class } = req.query;
  const query = {};
  if (provider)    query.provider = provider;
  if (asset_class) query.asset_class = asset_class;

  const history = await NavUpdate.find(query).lean();
  history.sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  res.json(history);
});

// ─── GET /growth ──────────────────────────────────────────────────────────────
// Member-facing: NAV history and resulting portfolio value per asset_class.
// No transaction reference, evidence, or provider-route fields — just the
// public-facing growth series that powers the member dashboard chart.
router.get('/growth', authenticate, async (req, res) => {
  const investments = await Investment.find({ units_purchased: { $ne: null }, asset_class: { $ne: null } }).lean();
  const navHistory   = await NavUpdate.find().lean();

  const assetClasses = [...new Set(investments.map(i => i.asset_class))];

  const series = assetClasses.map(asset_class => {
    const readings = navHistory
      .filter(n => n.asset_class === asset_class)
      .sort((a, b) => a.effective_date.localeCompare(b.effective_date));

    const totalUnits = investments
      .filter(i => i.asset_class === asset_class)
      .reduce((s, i) => s + i.units_purchased, 0);

    const points = readings.map(r => ({
      date: r.effective_date,
      unit_cost: r.unit_cost,
      portfolio_value: totalUnits * r.unit_cost,
    }));

    return { asset_class, points };
  });

  res.json(series);
});

module.exports = router;
module.exports.valuateInvestments = valuateInvestments;
