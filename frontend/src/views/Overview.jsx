import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { StatCard, SectionHeader, ChartTooltip, fmt, fmtShort, Loading, useApi } from '../components/UI';
import { summary } from '../api';

const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PIE_COLORS = ['#0ea5e9','#14b8a6','#6366f1','#f59e0b'];

export default function Overview() {
  const { data, loading } = useApi(() => summary.get());

  if (loading) return <Loading/>;
  if (!data) return null;

  const { equity, liabilities, active_members, active_loans, monthly_stats, interest_by_member } = data;

  const monthlyChart = (monthly_stats || []).map(m => ({
    month: MONTHS[m.month],
    '2025': m.contributions_2025 || 0,
    '2024': m.contributions_2024 || 0,
  }));

  const memberInterest = (interest_by_member || []).map(m => ({
    name: m.name.split(' ')[0],
    '2025': m.interest_2025 || 0,
    '2024': m.interest_2024 || 0,
  }));

  const pieData = [
    { name: 'Contributions', value: equity.member_contributions },
    { name: 'Entry Fees',    value: equity.entry_fees },
    { name: 'Net Profit',    value: equity.net_profit },
    { name: 'Cash',          value: data.cash_at_bank },
  ];

  const activeLoansTotal = (data.active_loan_list || []).reduce((s, l) => s + l.principal, 0);

  return (
    <div className="page">
      {/* KPI row */}
      <div className="stats-grid">
        <StatCard icon="🏦" label="Total Equity" value={fmt(equity.total)}
          sub="Group capital + contributions + profit" accent="var(--accent-blue)"/>
        <StatCard icon="👥" label="Active Members" value={active_members}
          sub="10 founding members" accent="var(--accent-teal)"/>
        <StatCard icon="💰" label="Total Contributions"
          value={fmt(equity.member_contributions)} sub="FY2024 + FY2025" accent="var(--accent-indigo)"/>
        <StatCard icon="📈" label="Net Profit" value={fmt(equity.net_profit)}
          sub="Interest + paid fines" accent="var(--accent-amber)"/>
        <StatCard icon="🏧" label="Cash at Bank" value={fmt(data.cash_at_bank)}
          sub="M-Koba Account" accent="var(--accent-green)"/>
        <StatCard icon="⚠️" label="Loans in Circulation" value={fmt(liabilities.in_circulation)}
          sub={`${active_loans} active loans`} subColor="var(--accent-red)" accent="var(--accent-red)"/>
      </div>

      {/* Charts row 1 */}
      <div className="grid-2">
        <div className="chart-card">
          <div className="chart-title">Monthly Contributions: 2024 vs 2025</div>
          <div className="chart-sub">Comparison of member contribution trends</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={monthlyChart}>
              <defs>
                <linearGradient id="g25" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="g24" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1e3a5f" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#1e3a5f" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
              <XAxis dataKey="month" tick={{ fill:'var(--text-muted)', fontSize:11 }} axisLine={false}/>
              <YAxis tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickFormatter={fmtShort}/>
              <Tooltip content={<ChartTooltip formatter={v => `TZS ${v.toLocaleString()}`}/>}/>
              <Legend wrapperStyle={{ color:'var(--text-muted)', fontSize:11 }}/>
              <Area type="monotone" dataKey="2024" stroke="#1e3a5f" strokeWidth={2} fill="url(#g24)"/>
              <Area type="monotone" dataKey="2025" stroke="#0ea5e9" strokeWidth={2.5} fill="url(#g25)"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <div className="chart-title">Capital Structure</div>
          <div className="chart-sub">Equity breakdown TZS {(equity.total/1e6).toFixed(2)}M</div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" strokeWidth={0}>
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]}/>)}
              </Pie>
              <Tooltip formatter={v => `TZS ${v.toLocaleString()}`}/>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:4 }}>
            {pieData.map((p, i) => (
              <div key={p.name} style={{ display:'flex', justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ width:8, height:8, borderRadius:2, background:PIE_COLORS[i] }}/>
                  <span style={{ color:'var(--text-secondary)', fontSize:11 }}>{p.name}</span>
                </div>
                <span style={{ color:'var(--text-primary)', fontSize:11, fontWeight:700 }}>{fmtShort(p.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Interest by member */}
      <div className="chart-card">
        <div className="chart-title">Interest Generated by Member: 2024 vs 2025</div>
        <div className="chart-sub">5% interest on all loans issued</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={memberInterest} barSize={14}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="name" tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false}/>
            <YAxis tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickFormatter={fmtShort}/>
            <Tooltip content={<ChartTooltip formatter={v => `TZS ${v.toLocaleString()}`}/>}/>
            <Legend wrapperStyle={{ color:'var(--text-muted)', fontSize:11 }}/>
            <Bar dataKey="2024" fill="var(--border)" radius={[4,4,0,0]}/>
            <Bar dataKey="2025" fill="var(--accent-teal)" radius={[4,4,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Active loans summary */}
      <div>
        <SectionHeader title="Active Loans" sub={`${active_loans} loans · TZS ${(activeLoansTotal/1e6).toFixed(2)}M outstanding`}/>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{['Member','Loan #','Principal','Interest','Issued','Balance','Status'].map(h =>
                <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {(data.active_loan_list || []).map(l => (
                <tr key={l.id}>
                  <td><strong>{l.member_name}</strong></td>
                  <td style={{ color:'var(--text-muted)' }}>{l.loan_number}</td>
                  <td style={{ color:'var(--accent-blue)', fontWeight:700 }}>{fmt(l.principal)}</td>
                  <td style={{ color:'var(--accent-amber)' }}>{fmt(l.interest_amount)}</td>
                  <td style={{ color:'var(--text-muted)' }}>{l.issued_date}</td>
                  <td style={{ color:'var(--accent-red)', fontWeight:700 }}>{fmt(l.balance)}</td>
                  <td><span className="badge badge-active">Active</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
