const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─── latestNav ────────────────────────────────────────────────────────────────
// Latest NAV reading for a provider+asset_class as of (on or before) `asOf`.
async function latestNav(models, provider, asset_class, asOf) {
  const readings = await models.NavUpdate.find({ provider, asset_class }).lean();
  const eligible = readings.filter(r => r.effective_date <= asOf);
  if (eligible.length === 0) return null;
  return eligible.sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
}

// ─── valuateInvestmentsWithModels ────────────────────────────────────────────
// Current value is computed from the latest NAV for unit-based holdings;
// older/manual entries without unit data fall back to carrying_value (here,
// the stored `amount`) — flagged via `valuation` so callers can show "at cost"
// vs "at NAV". Shared with backend/routes/summary.js so the snapshot's
// aggregate investment total uses the same math as the admin investments list.
async function valuateInvestmentsWithModels(models, asOf = new Date().toISOString().split('T')[0]) {
  const allInvestments = await models.Investment.find().sort({ created_at: -1 }).lean();
  const investments = allInvestments.filter((investment) => {
    const created = investment.created_at ? new Date(investment.created_at) : null;
    return !created || Number.isNaN(created.getTime()) || created.toISOString().slice(0, 10) <= asOf;
  });

  return Promise.all(investments.map(async inv => {
    if (inv.units_purchased != null && inv.asset_class) {
      const nav = await latestNav(models, inv.provider, inv.asset_class, asOf);
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
  res.json(await valuateInvestmentsWithModels(req.tenantModels));
});

// ─── POST /nav ────────────────────────────────────────────────────────────────
// Admin records a new monthly NAV reading for a provider/asset_class.
router.post('/nav', authenticate, requireAdmin, async (req, res) => {
  const { provider, asset_class, unit_cost, effective_date, source } = req.body;
  if (!provider || !asset_class || !unit_cost || !effective_date) {
    return res.status(400).json({ error: 'provider, asset_class, unit_cost, effective_date required' });
  }

  const nav = await req.tenantModels.NavUpdate.create({
    id:             await req.tenantModels.getNextId('nav_update_id'),
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

  const history = await req.tenantModels.NavUpdate.find(query).lean();
  history.sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  res.json(history);
});

// ─── GET /growth ──────────────────────────────────────────────────────────────
// Member-facing: NAV history and resulting portfolio value per asset_class.
// No transaction reference, evidence, or provider-route fields — just the
// public-facing growth series that powers the member dashboard chart.
router.get('/growth', authenticate, async (req, res) => {
  const investments = await req.tenantModels.Investment.find({ units_purchased: { $ne: null }, asset_class: { $ne: null } }).lean();
  const navHistory   = await req.tenantModels.NavUpdate.find().lean();

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
module.exports.valuateInvestmentsWithModels = valuateInvestmentsWithModels;
