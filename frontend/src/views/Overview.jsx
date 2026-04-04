import { useState, useMemo, useEffect } from 'react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { StatCard, SectionHeader, ChartTooltip, fmt, fmtShort, Loading, useApi, showToast } from '../components/UI';
import { summary, mailer, admin } from '../api';
import { exportSummaryCSV, exportSummaryPDF, getSummaryPDFBase64 } from '../utils/exporter';

const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PIE_COLORS = ['#0ea5e9','#14b8a6','#6366f1','#f59e0b'];
const YEAR_COLORS = ['#0ea5e9','#1e3a5f','#14b8a6','#f59e0b','#6366f1', '#ec4899'];

export default function Overview({ user }) {
  const { data, loading } = useApi(() => summary.get());
  const [selectedYears, setSelectedYears] = useState([]);
  const [emailing, setEmailing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (data && selectedYears.length === 0) {
      const allC = (data.monthly_stats || []).flatMap(m => Object.keys(m).filter(k => k.startsWith('contributions_')).map(k => parseInt(k.replace('contributions_', ''))));
      const cYears = [...new Set(allC)];
      const lYears = data.availableLoanYears || [];
      const allY = [...new Set([...cYears, ...lYears])].sort();
      setSelectedYears(allY);
    }
  }, [data]);

  if (loading) return <Loading/>;
  if (!data) return null;

  const { equity, liabilities, active_members, active_loans, monthly_stats, interest_by_member, availableLoanYears } = data;

  const contribYears = [...new Set(
    (monthly_stats || []).flatMap(m => Object.keys(m).filter(k => k.startsWith('contributions_')).map(k => parseInt(k.replace('contributions_', ''))))
  )].sort().filter(y => selectedYears.includes(y));

  const currentY = new Date().getFullYear();
  const currentM = new Date().getMonth() + 1;

  const monthlyChart = (monthly_stats || []).map(m => {
    const obj = { month: MONTHS[m.month] };
    contribYears.forEach(y => { 
      const val = m[`contributions_${y}`];
      // Do not chart zeros for months that haven't happened yet
      if (y > currentY || (y === currentY && m.month > currentM)) {
        obj[y] = null;
      } else {
        obj[y] = val || 0; 
      }
    });
    return obj;
  });

  const activeLoanYears = (availableLoanYears || []).filter(y => selectedYears.includes(y));

  const memberInterest = (interest_by_member || []).map(m => {
    const obj = { name: m.name.split(' ')[0] };
    activeLoanYears.forEach(y => { obj[y] = m[`interest_${y}`] || 0; });
    return obj;
  });

  const pieData = [
    { name: 'Contributions', value: equity.member_contributions },
    { name: 'Entry Fees',    value: equity.entry_fees },
    { name: 'Net Profit',    value: Math.max(0, equity.net_profit) },
    { name: 'Cash',          value: Math.max(0, data.cash_at_bank) },
  ];

  const toggleYear = (y) => {
    if (selectedYears.includes(y)) setSelectedYears(selectedYears.filter(sy => sy !== y));
    else setSelectedYears([...selectedYears, y].sort());
  };

  const handleExportCSV = () => {
    try {
      exportSummaryCSV(data);
      showToast('CSV downloaded!');
    } catch (e) {
      showToast('Failed to export CSV', 'error');
    }
  };

  const handleExportPDF = () => {
    try {
      exportSummaryPDF(data);
      showToast('PDF downloaded!');
    } catch (e) {
      showToast('Failed to export PDF', 'error');
    }
  };

  const handleEmailSummary = async () => {
    setEmailing(true);
    try {
      const { base64, filename } = getSummaryPDFBase64(data);
      const res = await mailer.broadcastStatement({ base64_pdf: base64, filename });
      const { sent, skipped, mock_mode } = res.data;
      const mockNote = mock_mode ? ' (mock — check backend logs)' : '';
      showToast(`Statement dispatched to ${sent} member${sent !== 1 ? 's' : ''}${skipped ? `, ${skipped} skipped (no email)` : ''}${mockNote}`);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to send emails', 'error');
    } finally {
      setEmailing(false);
    }
  };

  const handleSyncCounters = async () => {
    setSyncing(true);
    try {
      const res = await admin.syncCounters();
      setSyncDone(true);
      showToast('Counters synced! All IDs are now aligned with the database.');
      console.log('Sync result:', res.data.counters);
    } catch (e) {
      showToast(e.response?.data?.error || 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const allBackendYears = [...new Set([
    ...((monthly_stats || []).flatMap(m => Object.keys(m).filter(k => k.startsWith('contributions_')).map(k => parseInt(k.replace('contributions_', ''))))),
    ...(availableLoanYears || [])
  ])].sort();

  const activeLoansTotal = (data.active_loan_list || []).reduce((s, l) => s + l.principal, 0);

  return (
    <div className="page">
      <SectionHeader
        title="Overview"
        sub="Financial standing & analytics"
        action={
          <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
            {/* Year toggles */}
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontSize:12, color:'var(--text-muted)' }}>Compare:</span>
              {allBackendYears.map(y => (
                <label key={y} style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, cursor:'pointer' }}>
                  <input type="checkbox" checked={selectedYears.includes(y)} onChange={() => toggleYear(y)}/>
                  FY{y}
                </label>
              ))}
            </div>

            {/* Export actions */}
            <div style={{ display:'flex', gap:6, alignItems:'center', borderLeft:'1px solid var(--border)', paddingLeft:10 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleExportCSV}
                title="Export financial summary as CSV"
              >
                ⬇ CSV
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleExportPDF}
                title="Export branded PDF statement"
              >
                ⬇ PDF
              </button>
              {isAdmin && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleEmailSummary}
                  disabled={emailing}
                  title="Email PDF statement to all club members"
                >
                  {emailing ? 'Sending…' : '✉ Email to Club'}
                </button>
              )}
              {isAdmin && !syncDone && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleSyncCounters}
                  disabled={syncing}
                  title="One-time fix: sync auto-increment counters with actual DB data"
                  style={{ borderColor: 'var(--accent-amber)', color: 'var(--accent-amber)' }}
                >
                  {syncing ? 'Syncing…' : '⚙ Sync IDs'}
                </button>
              )}
            </div>
          </div>
        }
      />

      {/* KPI row */}
      <div className="stats-grid">
        <StatCard icon="🏦" label="Total Equity" value={fmt(equity.total)}
          sub="Group capital + contributions + profit" accent="var(--accent-blue)"/>
        <StatCard icon="👥" label="Active Members" value={active_members}
          sub="Compliant tracking" accent="var(--accent-teal)"/>
        <StatCard icon="💰" label="Total Contributions"
          value={fmt(equity.member_contributions)} sub="Cumulative total" accent="var(--accent-indigo)"/>
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
          <div className="chart-title">Monthly Contributions</div>
          <div className="chart-sub">Year-over-Year comparison</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={monthlyChart}>
              <defs>
                {contribYears.map((year, i) => (
                  <linearGradient key={year} id={`color${year}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={YEAR_COLORS[i % YEAR_COLORS.length]} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={YEAR_COLORS[i % YEAR_COLORS.length]} stopOpacity={0}/>
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
              <XAxis dataKey="month" tick={{ fill:'var(--text-muted)', fontSize:11 }} axisLine={false}/>
              <YAxis tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickFormatter={fmtShort}/>
              <Tooltip content={<ChartTooltip formatter={v => `TZS ${v.toLocaleString()}`}/>}/>
              <Legend wrapperStyle={{ color:'var(--text-muted)', fontSize:11 }}/>
              {contribYears.map((year, i) => (
                <Area key={year} type="monotone" dataKey={year} name={`FY${year}`} stroke={YEAR_COLORS[i % YEAR_COLORS.length]} strokeWidth={2.5} fill={`url(#color${year})`}/>
              ))}
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
        <div className="chart-title">Interest Generated by Member</div>
        <div className="chart-sub">Cumulative interest segmented by year</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={memberInterest} barSize={14}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="name" tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false}/>
            <YAxis tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickFormatter={fmtShort}/>
            <Tooltip content={<ChartTooltip formatter={v => `TZS ${v.toLocaleString()}`}/>}/>
            <Legend wrapperStyle={{ color:'var(--text-muted)', fontSize:11 }}/>
            {activeLoanYears.map((year, i) => (
              <Bar key={year} dataKey={year} name={`FY${year}`} fill={YEAR_COLORS[i % YEAR_COLORS.length]} radius={[4,4,0,0]}/>
            ))}
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
