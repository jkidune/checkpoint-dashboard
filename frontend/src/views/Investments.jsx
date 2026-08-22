import { useState } from 'react';
import {
  TrendingUp,
  LineChart as ChartIcon,
  ShieldCheck,
  Target,
  Plus,
  X,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowUpRight,
  Loader2,
  Sparkles,
  Zap,
  Shield,
  Activity,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { investments as investmentsApi } from '../api';
import { fmt, fmtShort, showToast, useApi, ChartTooltip } from '../components/UI';

const PROJECTIONS = [
  { year: '2025', capital: 15540000, interest: 965000 },
  { year: '2026', capital: 24540000, interest: 1500000 },
  { year: '2027', capital: 36040000, interest: 2400000 },
  { year: '2028', capital: 51040000, interest: 3600000 },
  { year: '2029', capital: 70040000, interest: 5200000 },
  { year: '2030', capital: 94040000, interest: 7500000 },
];

export const ROADMAP = [
  {
    phase: 'Phase 1 — Foundation',
    period: '2025–2026',
    status: 'In Progress',
    tone: 'blue',
    items: [
      'Consistent TZS 75K monthly contributions per member',
      '20–25% allocation to money-market instruments',
      'Late penalty increase: TZS 2,500 → TZS 5,000 / 15%',
      'Merchandise fundraising initiative (branded T-shirts)',
      'Formalise Investment Plan documentation',
    ],
  },
  {
    phase: 'Phase 2 — Growth',
    period: '2027–2029',
    status: 'Planned',
    tone: 'teal',
    items: [
      'Membership expansion from 10 → 15 members',
      'Non-member lending programme with collateral',
      'Treasury bills and government bonds allocation',
      'Contribution target increase to TZS 100K/member/month',
      'External capital mobilisation partnerships',
    ],
  },
  {
    phase: 'Phase 3 — Legacy',
    period: '2030–2035',
    status: 'Vision',
    tone: 'indigo',
    items: [
      'Strategic real estate acquisition (urban/peri-urban)',
      'Diversified investment portfolio management',
      'Institutional credibility and formal registration',
      'Agribusiness investment linkages',
      'Long-term sustainability & legacy building',
    ],
  },
];

const SWOT = [
  {
    type: 'Strengths',
    tone: 'green',
    icon: Zap,
    items: [
      'Strong internal capital base and cash flow',
      '5+ years disciplined operating track record',
      'Multiple income pathways (Interest + Fines)',
      'High-trust collective governance',
    ],
  },
  {
    type: 'Weaknesses',
    tone: 'amber',
    icon: Activity,
    items: [
      'Limited institutional experience in capital markets',
      'Modest capital relative to large projects',
      'Reliance on voluntary compliance',
      'Concentration risk in member lending',
    ],
  },
  {
    type: 'Opportunities',
    tone: 'blue',
    icon: TrendingUp,
    items: [
      'Growing local credit and micro-lending demand',
      'Regulated money-market & unit trust platforms',
      'Peri-urban real estate appreciation potential',
      'Agribusiness & enterprise linkages',
    ],
  },
  {
    type: 'Threats',
    tone: 'red',
    icon: Shield,
    items: [
      'Non-member default and recovery risk',
      'Inflationary and regulatory headwinds',
      'Liquidity lockup from illiquid assets',
      'Governance strain with membership scaling',
    ],
  },
];

// ── Record NAV Modal ───────────────────────────────────────────────────────
function RecordNavModal({ onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    provider: '',
    asset_class: 'Money Market',
    unit_cost: '',
    effective_date: new Date().toISOString().split('T')[0],
    source: '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await investmentsApi.recordNav({
        ...form,
        unit_cost: parseFloat(form.unit_cost),
      });
      showToast('NAV update recorded successfully!');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to record NAV update', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal-panel">
        <div className="admin-modal-header">
          <div>
            <h3>Record NAV Valuation Update</h3>
            <p style={{ color: 'var(--admin-muted)', fontSize: 12, marginTop: 2 }}>
              Log a verified asset valuation or unit price update.
            </p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="admin-form-group">
            <label>Investment Provider</label>
            <input
              placeholder="e.g. UTT AMIS, Sanlam, Bank M-Koba"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              required
            />
          </div>

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label>Asset Class</label>
              <select
                value={form.asset_class}
                onChange={(e) => setForm({ ...form, asset_class: e.target.value })}
                required
              >
                <option value="Money Market">Money Market Fund</option>
                <option value="Unit Trust">Unit Trust / Mutual Fund</option>
                <option value="Fixed Deposit">Fixed Deposit</option>
                <option value="Treasury Bonds">Treasury Bonds</option>
                <option value="Equities">Equities</option>
              </select>
            </div>
            <div className="admin-form-group">
              <label>Unit NAV Cost (TZS)</label>
              <input
                type="number"
                step="0.0001"
                placeholder="e.g. 154.25"
                value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label>Effective Date</label>
              <input
                type="date"
                value={form.effective_date}
                onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
                required
              />
            </div>
            <div className="admin-form-group">
              <label>Verification Source</label>
              <input
                placeholder="e.g. Monthly Statement"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              />
            </div>
          </div>

          <div className="admin-modal-actions">
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="admin-btn-primary"
              disabled={saving}
            >
              {saving ? 'Recording…' : 'Record Valuation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Investments Component ─────────────────────────────────────────────
export default function Investments() {
  const [showNavModal, setShowNavModal] = useState(false);
  const { data: investmentsList, loading, refetch } = useApi(() => investmentsApi.list());

  return (
    <div className="admin-page-container">
      {/* ── Header ── */}
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Investments & Strategy</h1>
          <p>Portfolio projections, asset valuation tracking, and 10-year growth roadmap.</p>
        </div>

        <div className="admin-header-actions">
          <button
            type="button"
            className="admin-btn-primary"
            onClick={() => setShowNavModal(true)}
          >
            <Plus size={15} /> Record NAV update
          </button>
        </div>
      </header>

      {/* ── Metrics Summary Rail ── */}
      <section className="admin-stats-grid">
        <div className="admin-stat-card is-primary">
          <div className="admin-stat-top">
            <span>2026 Target Capital</span>
            <TrendingUp size={16} color="var(--admin-blue)" />
          </div>
          <strong>TZS 24.54M</strong>
          <span className="stat-sub">Group capital & retained profits</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>2030 Vision Target</span>
            <Target size={16} color="var(--admin-teal)" />
          </div>
          <strong style={{ color: 'var(--admin-teal)' }}>TZS 94.04M</strong>
          <span className="stat-sub">10-year compounding horizon</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Annual Growth Pace</span>
            <ChartIcon size={16} color="var(--admin-green)" />
          </div>
          <strong style={{ color: 'var(--admin-green)' }}>+35% YoY</strong>
          <span className="stat-sub">Projected capital accumulation</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Strategy Horizon</span>
            <ShieldCheck size={16} color="var(--admin-indigo)" />
          </div>
          <strong style={{ color: 'var(--admin-indigo)' }}>Phase 1</strong>
          <span className="stat-sub">Foundation (2025–2026)</span>
        </div>
      </section>

      {/* ── Growth Trajectory Chart Card ── */}
      <div style={{ background: '#ffffff', border: '1px solid var(--admin-border)', borderRadius: 16, padding: 22, boxShadow: '0 1px 2px rgba(24,24,27,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--admin-text)' }}>
              10-Year Capital Trajectory (2025 – 2030)
            </h3>
            <p style={{ fontSize: 12, color: 'var(--admin-muted)', marginTop: 2 }}>
              Projected core capital vs. cumulative interest compounding.
            </p>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={PROJECTIONS} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorCapital" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorInterest" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0f766e" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#0f766e" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} width={50} />
            <Tooltip content={<ChartTooltip formatter={(v) => `TZS ${Number(v).toLocaleString()}`} />} />
            <Area
              type="monotone"
              dataKey="capital"
              name="Total Capital"
              stroke="#2563eb"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorCapital)"
            />
            <Area
              type="monotone"
              dataKey="interest"
              name="Annual Interest"
              stroke="#0f766e"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorInterest)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Strategic Roadmap ── */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--admin-text)', marginBottom: 14 }}>
          Strategic Expansion Roadmap
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {ROADMAP.map((r) => (
            <div
              key={r.phase}
              style={{
                background: '#ffffff',
                border: '1px solid var(--admin-border)',
                borderRadius: 14,
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 1px 2px rgba(24,24,27,0.03)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className={`admin-badge is-${r.tone}`}>{r.status}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--admin-muted)' }}>{r.period}</span>
                </div>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--admin-text)', marginBottom: 12 }}>
                  {r.phase}
                </h4>
                <ul style={{ paddingLeft: 16, fontSize: 12, color: 'var(--admin-muted)', lineHeight: 1.6 }}>
                  {r.items.map((item, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SWOT Matrix ── */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--admin-text)', marginBottom: 14 }}>
          Strategic Evaluation Matrix (SWOT)
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {SWOT.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.type}
                style={{
                  background: '#ffffff',
                  border: '1px solid var(--admin-border)',
                  borderRadius: 14,
                  padding: 18,
                  boxShadow: '0 1px 2px rgba(24,24,27,0.03)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: `var(--admin-${s.tone}-soft)`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: `var(--admin-${s.tone})`,
                    }}
                  >
                    <Icon size={15} />
                  </div>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--admin-text)' }}>
                    {s.type}
                  </h4>
                </div>
                <ul style={{ paddingLeft: 16, fontSize: 12, color: 'var(--admin-muted)', lineHeight: 1.6 }}>
                  {s.items.map((item, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Record NAV Modal ── */}
      {showNavModal && (
        <RecordNavModal
          onClose={() => setShowNavModal(false)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}
