import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { StatCard, SectionHeader, ChartTooltip, ProgressBar, fmt, fmtShort, Loading, useApi, showToast } from '../components/UI';
import { members, summary, investments as investmentsApi, notifications as notificationsApi } from '../api';
import { ROADMAP } from './Investments';
import { Landmark, Users, Wallet, PiggyBank, AlertTriangle, Bell, BellOff, CheckCircle2 } from 'lucide-react';

const NOTIF_LABELS = {
  contribution_due: 'Contribution due',
  loan_due:         'Loan overdue',
  fine_issued:      'Fine issued',
  fine_overdue:     'Fine overdue',
  custom:           'Notice',
};

function NotificationsPanel() {
  const { data, loading, refetch } = useApi(() => notificationsApi.list());
  const list = data || [];

  const handleMarkRead = async (id) => {
    try {
      await notificationsApi.markRead(id);
      refetch();
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to update notification', 'error');
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Bell size={15} color="var(--accent-blue)" />
        <div style={{ fontWeight: 800, fontSize: 13 }}>Notifications</div>
      </div>
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12, padding: '10px 0' }}>
          <BellOff size={14} /> No notifications
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map(n => (
            <div key={n.id} onClick={() => !n.read && handleMarkRead(n.id)} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10,
              background: n.read ? 'var(--bg-input)' : 'rgba(14, 165, 233, 0.08)',
              border: n.read ? '1px solid transparent' : '1px solid #0ea5e955',
              borderRadius: 8, padding: '10px 12px', cursor: n.read ? 'default' : 'pointer',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: n.read ? 'var(--text-muted)' : 'var(--accent-blue)', marginBottom: 2 }}>
                  {NOTIF_LABELS[n.type] || n.type}{n.due_date ? ` · due ${n.due_date}` : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.message}</div>
              </div>
              {n.read
                ? <CheckCircle2 size={14} color="var(--accent-teal)" style={{ flexShrink: 0 }} />
                : <span style={{ fontSize: 10, color: 'var(--accent-blue)', flexShrink: 0, whiteSpace: 'nowrap' }}>Mark read</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InvestmentGrowthChart() {
  const { data, loading } = useApi(() => investmentsApi.growth());
  const series = data || [];

  if (loading) return <Loading />;
  if (series.length === 0) return null;

  return (
    <>
      <SectionHeader title="Investment Growth" sub="Club money-market positions, valued at latest NAV" />
      <div className="grid-2">
        {series.map(s => (
          <div key={s.asset_class} className="chart-card">
            <div className="chart-title">{s.asset_class}</div>
            <div className="chart-sub">Portfolio value over time</div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={s.points}>
                <defs>
                  <linearGradient id={`growth-${s.asset_class}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickFormatter={fmtShort} />
                <Tooltip content={<ChartTooltip formatter={v => `TZS ${v.toLocaleString()}`} />} />
                <Area type="monotone" dataKey="portfolio_value" name="Portfolio Value" stroke="#14b8a6" strokeWidth={2.5} fill={`url(#growth-${s.asset_class})`} />
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {s.points.slice(-4).reverse().map(p => (
                <div key={p.date} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{p.date}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>Unit cost {p.unit_cost}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function MemberDashboard({ user }) {
  const { data: me, loading: meLoading } = useApi(() => members.me());
  const { data: snapshot, loading: snapshotLoading } = useApi(() => summary.snapshot());

  if (meLoading || snapshotLoading) return <Loading />;
  if (!me) return null;

  const activeLoans = (me.loans || []).filter(l => l.status === 'active');

  return (
    <div className="page">
      <SectionHeader title={`Welcome, ${me.name.split(' ')[0]}`} sub="Your Checkpoint membership at a glance" />

      {/* Group at a glance */}
      {snapshot && (
        <>
          <SectionHeader title="Group at a Glance" sub="Club-wide aggregates" />
          <div className="stats-grid">
            <StatCard icon={<PiggyBank size={22} color="var(--accent-green)" />} label="Cash at Bank" value={fmt(snapshot.cash_at_bank)} accent="var(--accent-green)" />
            <StatCard icon={<Landmark size={22} color="var(--accent-red)" />} label="Loans Outstanding" value={fmt(snapshot.total_loans_outstanding)} accent="var(--accent-red)" />
            <StatCard icon={<Wallet size={22} color="var(--accent-indigo)" />} label={`FY${snapshot.fiscal_year} Contributions`} value={fmt(snapshot.contributions_this_fy)} accent="var(--accent-indigo)" />
            <StatCard icon={<Users size={22} color="var(--accent-teal)" />} label="Active Members" value={snapshot.active_members} accent="var(--accent-teal)" />
          </div>
        </>
      )}

      {/* My finances */}
      <SectionHeader title="My Finances" />
      <div className="grid-2">
        <div className="card">
          <div style={{ fontWeight: 800, marginBottom: 10 }}>My Contributions</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>2025</div>
              <div style={{ color: 'var(--accent-blue)', fontWeight: 700, fontSize: 14 }}>{fmt(me.contributions_2025)}</div>
            </div>
            <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>2024</div>
              <div style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: 14 }}>{fmt(me.contributions_2024)}</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            FY2025 Compliance ({me.months_paid_2025}/10 months)
          </div>
          <ProgressBar value={me.months_paid_2025 || 0} max={10} />
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.07em', margin: '16px 0 8px' }}>
            Recent History
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
            {(me.contributions || []).slice(0, 8).map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-input)', borderRadius: 8, padding: '7px 10px' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.month}/{c.year}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-teal)' }}>{fmt(c.amount)}</span>
                <span className={`badge badge-${c.status}`}>{c.status}</span>
              </div>
            ))}
            {(me.contributions || []).length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No contributions recorded yet.</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div style={{ fontWeight: 800, marginBottom: 10 }}>My Active Loan{activeLoans.length === 1 ? '' : 's'}</div>
            {activeLoans.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No active loans.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activeLoans.map(l => (
                  <div key={l.id} style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.loan_number}</span>
                      <span className="badge badge-active">Active</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Balance</span>
                      <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>{fmt(l.principal - l.total_repaid)}</span>
                    </div>
                    {l.due_date && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 2 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Due</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{l.due_date}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ fontWeight: 800, marginBottom: 10 }}>My Fines</div>
            {me.unpaid_fines > 0 ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#ef444415', border: '1px solid #ef444430',
                borderRadius: 8, padding: '10px 14px', color: 'var(--accent-red)', fontSize: 12,
              }}>
                <AlertTriangle size={14} />
                Outstanding fines: <strong>{fmt(me.unpaid_fines)}</strong>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No unpaid fines. Nice work.</div>
            )}
          </div>

          <NotificationsPanel />
        </div>
      </div>

      <InvestmentGrowthChart />

      {/* Roadmap (static, shared with the admin Investments view) */}
      <SectionHeader title="Investment Roadmap" sub="Phased approach to structured growth" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {ROADMAP.map(r => (
          <div key={r.phase} className="card" style={{ borderTop: `3px solid ${r.color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ color: r.color, fontWeight: 800, fontSize: 13, fontFamily: 'var(--font-display)' }}>{r.phase}</div>
              <span style={{ background: `${r.color}20`, color: r.color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>{r.status}</span>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 14 }}>{r.period}</div>
            {r.items.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: r.color, marginTop: 6, flexShrink: 0 }} />
                <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{item}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
