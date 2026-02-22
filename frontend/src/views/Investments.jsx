import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { StatCard, SectionHeader, ChartTooltip, fmtShort, fmt } from '../components/UI';

const PROJECTIONS = [
  { year:'2025', capital:15540000,  interest:965000  },
  { year:'2026', capital:24540000,  interest:1500000 },
  { year:'2027', capital:36040000,  interest:2400000 },
  { year:'2028', capital:51040000,  interest:3600000 },
  { year:'2029', capital:70040000,  interest:5200000 },
  { year:'2030', capital:94040000,  interest:7500000 },
];

const ROADMAP = [
  {
    phase:'Phase 1 — Foundation',
    period:'2025–2026',
    color:'var(--accent-blue)',
    status:'In Progress',
    items:[
      'Consistent TZS 75K monthly contributions per member',
      '20–25% allocation to money-market instruments',
      'Late penalty increase: TZS 2,500 → TZS 5,000',
      'Merchandise fundraising initiative (branded T-shirts)',
      'Formalise Investment Plan documentation',
    ],
  },
  {
    phase:'Phase 2 — Growth',
    period:'2027–2029',
    color:'var(--accent-teal)',
    status:'Planned',
    items:[
      'Membership expansion from 10 → 15 members',
      'Non-member lending programme with collateral',
      'Treasury bills and government bonds allocation',
      'Contribution target increase to TZS 100K/member/month',
      'External capital mobilisation partnerships',
    ],
  },
  {
    phase:'Phase 3 — Legacy',
    period:'2030–2035',
    color:'var(--accent-indigo)',
    status:'Vision',
    items:[
      'Strategic real estate acquisition (urban/peri-urban)',
      'Diversified investment portfolio management',
      'Institutional credibility and formal registration',
      'Agribusiness investment linkages',
      'Long-term sustainability & legacy building',
    ],
  },
];

const SWOT = [
  { type:'Strengths',     color:'var(--accent-teal)',  icon:'💪', items:['Strong internal capital base','5+ years disciplined operation','Multiple income pathways','Trust-based collective governance'] },
  { type:'Weaknesses',    color:'var(--accent-amber)', icon:'⚠️', items:['Limited institutional experience','Modest capital vs. ambitions','Voluntary compliance reliance','Concentration risk in lending'] },
  { type:'Opportunities', color:'var(--accent-blue)',  icon:'🚀', items:['Growing local credit demand','Regulated investment platforms','Real estate appreciation potential','Agribusiness & enterprise linkages'] },
  { type:'Threats',       color:'var(--accent-red)',   icon:'🛡',  items:['Non-member credit risk','Market & regulatory changes','Liquidity from illiquid assets','Governance strain with growth'] },
];

export default function Investments() {
  return (
    <div className="page">
      <SectionHeader title="Investment Strategy 2025–2035" sub="Strategic roadmap and financial projections"/>

      {/* KPIs */}
      <div className="stats-grid">
        <StatCard icon="🎯" label="2026 Target" value="TZS 9M" sub="Annual contributions goal" accent="var(--accent-blue)"/>
        <StatCard icon="🏦" label="2030 Projection" value="TZS 94M" sub="Capital base target" accent="var(--accent-indigo)"/>
        <StatCard icon="👥" label="Target Members" value="15" sub="Expand from current 10" accent="var(--accent-teal)"/>
        <StatCard icon="📊" label="Interest Rate" value="5%" sub="Flat rate on all loans" accent="var(--accent-amber)"/>
      </div>

      {/* Projection chart */}
      <div className="chart-card">
        <div className="chart-title">Capital Growth Projection 2025–2030</div>
        <div className="chart-sub">Based on contribution targets and investment returns</div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={PROJECTIONS}>
            <defs>
              <linearGradient id="capG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="intG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
            <XAxis dataKey="year" tick={{ fill:'var(--text-muted)', fontSize:11 }} axisLine={false}/>
            <YAxis tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickFormatter={fmtShort}/>
            <Tooltip content={<ChartTooltip formatter={v => `TZS ${v.toLocaleString()}`}/>}/>
            <Area type="monotone" dataKey="capital" name="Capital Base" stroke="#6366f1" strokeWidth={2.5} fill="url(#capG)"/>
            <Area type="monotone" dataKey="interest" name="Annual Interest" stroke="#14b8a6" strokeWidth={2} fill="url(#intG)"/>
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Roadmap */}
      <SectionHeader title="Investment Roadmap" sub="Phased approach to structured growth"/>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))', gap:14 }}>
        {ROADMAP.map(r => (
          <div key={r.phase} className="card" style={{ borderTop:`3px solid ${r.color}` }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <div style={{ color:r.color, fontWeight:800, fontSize:13, fontFamily:'var(--font-display)' }}>{r.phase}</div>
              <span style={{ background:`${r.color}20`, color:r.color, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20 }}>{r.status}</span>
            </div>
            <div style={{ color:'var(--text-muted)', fontSize:11, marginBottom:14 }}>{r.period}</div>
            {r.items.map((item, i) => (
              <div key={i} style={{ display:'flex', gap:8, marginBottom:8, alignItems:'flex-start' }}>
                <div style={{ width:5, height:5, borderRadius:'50%', background:r.color, marginTop:6, flexShrink:0 }}/>
                <span style={{ color:'var(--text-secondary)', fontSize:12 }}>{item}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* SWOT */}
      <SectionHeader title="SWOT Analysis" sub="Internal and external strategic factors"/>
      <div className="grid-2">
        {SWOT.map(s => (
          <div key={s.type} className="card" style={{ borderLeft:`3px solid ${s.color}` }}>
            <div style={{ color:s.color, fontWeight:800, fontSize:13, marginBottom:12 }}>{s.icon} {s.type}</div>
            {s.items.map((item, i) => (
              <div key={i} style={{ display:'flex', gap:8, marginBottom:7, alignItems:'flex-start' }}>
                <div style={{ width:4, height:4, borderRadius:'50%', background:s.color, marginTop:7, flexShrink:0 }}/>
                <span style={{ color:'var(--text-secondary)', fontSize:12 }}>{item}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Risk matrix */}
      <div>
        <SectionHeader title="Risk Register" sub="Key risks and mitigation measures"/>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{['Risk','Category','Likelihood','Impact','Mitigation'].map(h=><th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[
                ['Loan defaults by members','Credit','Medium','High','Strict appraisal, guarantorship, repayment schedules, reserve fund'],
                ['Delayed contributions','Liquidity','Medium','High','Enforce penalties, monthly monitoring, minimum cash buffer'],
                ['Poor investment returns','Investment','Low','Medium','Collective approval, due diligence, low-risk instruments only'],
                ['Governance disputes','Governance','Low','High','Strict bylaws adherence, documented decisions, participatory leadership'],
                ['Inaccurate records','Operational','Low','Medium','Clear records, internal reviews, assigned financial tracking roles'],
              ].map(([r,cat,like,imp,mit],i) => (
                <tr key={i}>
                  <td style={{ fontWeight:600 }}>{r}</td>
                  <td><span className={`badge badge-${cat==='Credit'?'overdue':cat==='Liquidity'?'active':'member'}`}>{cat}</span></td>
                  <td style={{ color:like==='High'?'var(--accent-red)':like==='Medium'?'var(--accent-amber)':'var(--accent-teal)' }}>{like}</td>
                  <td style={{ color:imp==='High'?'var(--accent-red)':'var(--accent-amber)' }}>{imp}</td>
                  <td style={{ color:'var(--text-muted)', fontSize:12 }}>{mit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
