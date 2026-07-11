import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { SectionHeader, StatCard, Card, Loading, useApi, fmt, fmtShort } from '../components/Primitives';
import { investments as investmentsApi } from '../../api';

function MTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid var(--m-border)', borderRadius: 10, padding: '10px 14px', boxShadow: 'var(--m-shadow-md)' }}>
      <div style={{ fontSize: 11, color: 'var(--m-text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--m-accent-blue)' }}>{fmt(payload[0].value)}</div>
    </div>
  );
}

export default function MemberInvestmentsPage() {
  const { data, loading } = useApi(() => investmentsApi.growth());

  if (loading) return <Loading />;
  const series = data || [];
  const latestTotal = series.reduce((s, asset) => s + (asset.points.at(-1)?.portfolio_value || 0), 0);

  return (
    <div className="m-page">
      <SectionHeader title="Group Investments" sub="Money-market positions, valued at latest NAV — no ledger or evidence detail" />

      <div className="m-stats-grid">
        <StatCard icon={<TrendingUp size={17} />} iconBg="var(--m-accent-green-bg)" iconColor="var(--m-accent-green)" label="Total Portfolio Value" value={fmt(latestTotal)} />
      </div>

      {series.length === 0 ? (
        <Card><div style={{ color: 'var(--m-text-muted)', fontSize: 13 }}>No NAV history recorded yet.</div></Card>
      ) : (
        <div className="m-grid-2">
          {series.map((s) => (
            <Card key={s.asset_class}>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--m-font-display)' }}>{s.asset_class}</div>
              <div style={{ fontSize: 12.5, color: 'var(--m-text-muted)', marginBottom: 8 }}>Portfolio value over time</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={s.points}>
                  <defs>
                    <linearGradient id={`m-growth-${s.asset_class}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--m-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--m-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} />
                  <Tooltip content={<MTooltip />} />
                  <Area type="monotone" dataKey="portfolio_value" stroke="#16a34a" strokeWidth={2.5} fill={`url(#m-growth-${s.asset_class})`} />
                </AreaChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                {s.points.slice(-4).reverse().map((p) => (
                  <div key={p.date} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                    <span style={{ color: 'var(--m-text-muted)' }}>{p.date}</span>
                    <span style={{ color: 'var(--m-text-secondary)' }}>Unit cost {p.unit_cost}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
