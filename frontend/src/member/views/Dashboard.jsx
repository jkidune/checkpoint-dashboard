import { useState, useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Sigma, Wallet2, Landmark, ShieldAlert, Sparkles, Download, Eye } from 'lucide-react';
import { SectionHeader, StatCard, StatusPill, Card, Table, Loading, useApi, fmt, fmtShort } from '../components/Primitives';
import { members, summary, loans as loansApi } from '../../api';
import { exportMemberStatementCSV, exportMemberStatementPDF } from '../../utils/exporter';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

function MTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid var(--m-border)', borderRadius: 10, padding: '10px 14px', boxShadow: 'var(--m-shadow-md)' }}>
      <div style={{ fontSize: 11, color: 'var(--m-text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--m-accent-blue)' }}>{fmt(payload[0].value)}</div>
    </div>
  );
}

export default function MemberDashboardPage({ user }) {
  const { data: me, loading: meLoading } = useApi(() => members.me());
  const { data: snapshot, loading: snapshotLoading } = useApi(() => summary.snapshot());
  const { data: myLoans, loading: loansLoading } = useApi(() => loansApi.list());
  const [filter, setFilter] = useState('all');

  const loading = meLoading || snapshotLoading || loansLoading;

  const derived = useMemo(() => {
    if (!me) return null;
    const now = new Date();
    const currentFY = getFiscalYear(now.getMonth() + 1, now.getFullYear());
    const contributionsThisFY = (me.contributions || [])
      .filter((c) => getFiscalYear(c.month, c.year) === currentFY)
      .reduce((s, c) => s + c.amount, 0);

    const activeLoans = (myLoans || []).filter((l) => l.status === 'active');
    const activeLoanBalance = activeLoans.reduce((s, l) => s + (l.balance ?? (l.principal - l.total_repaid)), 0);

    const currentYear = now.getFullYear();
    const monthlyChart = MONTHS.map((label, i) => {
      const m = i + 1;
      const total = (me.contributions || [])
        .filter((c) => c.year === currentYear && c.month === m)
        .reduce((s, c) => s + c.amount, 0);
      return { month: label, value: total };
    });
    const nonZero = monthlyChart.filter((m) => m.value > 0);
    const average = nonZero.length ? Math.round(nonZero.reduce((s, m) => s + m.value, 0) / nonZero.length) : 0;
    let trendPct = null;
    if (nonZero.length >= 2) {
      const last = nonZero[nonZero.length - 1].value;
      const prev = nonZero[nonZero.length - 2].value;
      trendPct = prev ? Math.round(((last - prev) / prev) * 100) : null;
    }

    return { currentFY, contributionsThisFY, activeLoans, activeLoanBalance, monthlyChart, average, trendPct };
  }, [me, myLoans]);

  const feed = useMemo(() => {
    if (!me) return [];
    const rows = [];
    (me.contributions || []).forEach((c) => rows.push({
      key: `c-${c.id}`, id: `CN-${c.id}`, item: 'Contribution', date: c.paid_date, amount: c.amount, status: c.status, group: 'contributions',
    }));
    (myLoans || []).forEach((l) => rows.push({
      key: `l-${l.id}`, id: `LN-${l.id}`, item: 'Loan', date: l.issued_date, amount: l.principal, status: l.status, group: 'loans',
    }));
    (me.fines || []).forEach((f) => rows.push({
      key: `f-${f.id}`, id: `FN-${f.id}`, item: 'Fine', date: f.paid_date || f.created_at?.slice(0, 10), amount: f.amount, status: f.status, group: 'fines',
    }));
    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [me, myLoans]);

  const filteredFeed = filter === 'all' ? feed : feed.filter((r) => r.group === filter);

  const handleExport = () => {
    if (!me || !derived) return;
    exportMemberStatementCSV({
      memberName: me.name,
      contributionsTotal: derived.contributionsThisFY,
      activeLoanBalance: derived.activeLoanBalance,
      unpaidFines: me.unpaid_fines || 0,
      groupCashAtBank: snapshot?.cash_at_bank || 0,
      contributions: me.contributions || [],
    });
  };

  const handleDownloadReport = () => {
    if (!me || !derived) return;
    exportMemberStatementPDF({
      memberName: me.name,
      contributionsTotal: derived.contributionsThisFY,
      activeLoanBalance: derived.activeLoanBalance,
      unpaidFines: me.unpaid_fines || 0,
      groupCashAtBank: snapshot?.cash_at_bank || 0,
      contributions: me.contributions || [],
    });
  };

  if (loading) return <Loading />;
  if (!me) return null;

  return (
    <div className="m-page">
      {/* Quarterly report banner */}
      <div style={{
        background: 'linear-gradient(90deg, #1d4ed8, #2563eb 60%, #3b82f6)',
        borderRadius: 16, padding: '18px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', color: '#fff',
      }}>
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.18)',
            borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, marginBottom: 8,
          }}>
            <Sparkles size={12} /> Quarterly report is here
          </div>
          <div style={{ fontSize: 14, opacity: 0.92 }}>Full quarterly report — see your contributions, loans, and group investments</div>
        </div>
        <button className="m-btn" style={{ background: '#fff', color: 'var(--m-accent-blue)' }} onClick={handleDownloadReport}>
          Download Now <Download size={14} />
        </button>
      </div>

      <SectionHeader
        title={`Welcome, ${me.name} 👋`}
        sub="Manage your contributions, loans and see the group investments all in one place"
        action={
          <>
            <div className="m-btn m-btn-secondary" style={{ cursor: 'default' }}>
              {new Date(new Date().setMonth(new Date().getMonth() - 1)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              {' – '}
              {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
            <button className="m-btn m-btn-primary" onClick={handleExport}>Export <Download size={13} /></button>
          </>
        }
      />

      {/* Stat cards */}
      <div className="m-stats-grid">
        <StatCard
          icon={<Sigma size={17} />} iconBg="var(--m-accent-blue-bg)" iconColor="var(--m-accent-blue)"
          label="Group Cash at Bank" value={fmt(snapshot?.cash_at_bank)} help
        />
        <StatCard
          icon={<Wallet2 size={17} />} iconBg="var(--m-accent-green-bg)" iconColor="var(--m-accent-green)"
          label={`My Total Contribution (FY${derived?.currentFY})`} value={fmt(derived?.contributionsThisFY)} help
        />
        <StatCard
          icon={<Landmark size={17} />} iconBg="var(--m-accent-amber-bg)" iconColor="var(--m-accent-amber)"
          label="My Active Loan Balance" value={fmt(derived?.activeLoanBalance)} help
        />
        <StatCard
          icon={<ShieldAlert size={17} />} iconBg="var(--m-accent-red-bg)" iconColor="var(--m-accent-red)"
          label="My Unpaid Fines" value={fmt(me.unpaid_fines)} help
        />
      </div>

      <div className="m-grid-2">
        {/* Overview chart */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--m-font-display)' }}>Overview</div>
            <div className="m-btn m-btn-secondary m-btn-sm" style={{ cursor: 'default' }}>This Year</div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--m-text-muted)', marginTop: 12 }}>Average per month</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
            <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--m-font-display)' }}>{fmt(derived?.average)}</div>
            {derived?.trendPct !== null && derived?.trendPct !== undefined && (
              <span className={`m-stat-trend ${derived.trendPct >= 0 ? 'up' : 'down'}`}>{derived.trendPct >= 0 ? '+' : ''}{derived.trendPct}%</span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={derived?.monthlyChart} margin={{ top: 16, left: -20 }}>
              <defs>
                <linearGradient id="mDashArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: 'var(--m-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--m-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} />
              <Tooltip content={<MTooltip />} />
              <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2.5} fill="url(#mDashArea)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* All transactions */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--m-font-display)' }}>My Activity</div>
            <div className="m-btn m-btn-secondary m-btn-sm" style={{ cursor: 'default' }}><Eye size={12} /> View all</div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['all', 'All'], ['contributions', 'Contributions'], ['loans', 'Loans'], ['fines', 'Fines']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className="m-btn m-btn-sm"
                style={{
                  background: filter === key ? 'var(--m-accent-blue-bg)' : 'transparent',
                  color: filter === key ? 'var(--m-accent-blue)' : 'var(--m-text-muted)',
                  border: '1px solid ' + (filter === key ? 'var(--m-accent-blue-bg)' : 'var(--m-border)'),
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 280, overflowY: 'auto' }}>
            {filteredFeed.slice(0, 12).map((r) => (
              <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 4px', borderBottom: '1px solid var(--m-border)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.item} <span style={{ color: 'var(--m-text-muted)', fontWeight: 400 }}>· {r.id}</span></div>
                  <div style={{ fontSize: 11, color: 'var(--m-text-muted)' }}>{r.date || '—'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(r.amount)}</span>
                  <StatusPill status={r.status} />
                </div>
              </div>
            ))}
            {filteredFeed.length === 0 && <div style={{ color: 'var(--m-text-muted)', fontSize: 12.5, padding: '20px 0', textAlign: 'center' }}>No activity yet.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
