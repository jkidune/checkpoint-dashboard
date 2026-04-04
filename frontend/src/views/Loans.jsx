import { useState, useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { SectionHeader, Modal, StatCard, Loading, fmt, showToast, useApi, ChartTooltip, fmtShort, ProgressBar } from '../components/UI';
import { loans, members } from '../api';
import ImportCsvModal from '../components/ImportCsvModal';

function LoanDetail({ loanId, onClose }) {
  const { data, loading, refetch } = useApi(() => loans.get(loanId));
  const [form, setForm] = useState({ amount:'', repayment_date:'', mpesa_ref:'', notes:'' });
  const [saving, setSaving] = useState(false);

  const addRepayment = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await loans.addRepayment(loanId, { ...form, amount: parseInt(form.amount) });
      showToast('Repayment recorded!');
      setForm({ amount:'', repayment_date:'', mpesa_ref:'', notes:'' });
      refetch();
    } catch(e) {
      showToast(e.response?.data?.error || 'Failed', 'error');
    } finally { setSaving(false); }
  };

  if (loading || !data) return <div className="loading"><div className="spinner"/></div>;

  return (
    <Modal title={`${data.member_name} · ${data.loan_number}`} onClose={onClose} maxWidth={560}>
      <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 }}>
          {[
            ['Principal', fmt(data.principal), 'var(--accent-blue)'],
            [`Interest (${(data.interest_rate * 100).toFixed(0)}%)`, fmt(data.interest_amount), 'var(--accent-amber)'],
            ['Overdue Penalty', fmt(data.penalty || 0), data.penalty > 0 ? 'var(--accent-red)' : 'var(--text-muted)'],
            ['Balance', fmt(data.balance), data.balance>0?'var(--accent-red)':'var(--accent-teal)'],
          ].map(([l,v,c]) => (
            <div key={l} style={{ background:'var(--bg-input)', borderRadius:10, padding:'10px 12px' }}>
              <div style={{ color:'var(--text-muted)', fontSize:10, marginBottom:3 }}>{l}</div>
              <div style={{ color:c, fontWeight:700, fontSize:14 }}>{v}</div>
            </div>
          ))}
        </div>
        <ProgressBar value={data.total_repaid} max={data.total_owed}/>

        <div>
          <div style={{ color:'var(--text-secondary)', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>Repayment History</div>
          {data.repayments?.length ? (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {data.repayments.map(r => (
                <div key={r.id} style={{ display:'flex', justifyContent:'space-between', background:'var(--bg-input)', borderRadius:8, padding:'8px 12px' }}>
                  <span style={{ color:'var(--text-muted)', fontSize:12 }}>{r.repayment_date}</span>
                  <span style={{ color:'var(--accent-teal)', fontWeight:700, fontSize:12 }}>{fmt(r.amount)}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ color:'var(--text-muted)', fontSize:12 }}>No repayments yet.</p>}
        </div>

        {data.status === 'active' && (
          <form onSubmit={addRepayment}>
            <div style={{ color:'var(--text-secondary)', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>Record Repayment</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
              <div className="form-group">
                <label>Amount (TZS)</label>
                <input className="form-input" type="number" required value={form.amount}
                  onChange={e => setForm({...form,amount:e.target.value})} placeholder="Amount"/>
              </div>
              <div className="form-group">
                <label>Date</label>
                <input className="form-input" type="date" required value={form.repayment_date}
                  onChange={e => setForm({...form,repayment_date:e.target.value})}/>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom:12 }}>
              <label>MPesa Ref (optional)</label>
              <input className="form-input" value={form.mpesa_ref} onChange={e => setForm({...form,mpesa_ref:e.target.value})} placeholder="QAB123XYZ"/>
            </div>
            <button type="submit" className="btn btn-success" disabled={saving} style={{ width:'100%', justifyContent:'center' }}>
              {saving?'Saving…':'Record Repayment'}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}

export default function Loans({ user }) {
  const isAdmin = user?.role === 'admin';
  const [filter, setFilter] = useState('all');
  const [fiscalYear, setFiscalYear] = useState(2026);
  const [detailId, setDetailId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ member_id:'', principal:'', issued_date:'', due_date:'', fiscal_year:'2026', notes:'' });
  const [saving, setSaving] = useState(false);

  const params = { fiscal_year: fiscalYear, ...(filter!=='all' ? { status:filter } : {}) };
  const { data: loanList, loading, refetch } = useApi(() => loans.list(params), [filter, fiscalYear]);
  const { data: membersData } = useApi(() => members.list());

  const handleAddLoan = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await loans.create({ ...form, principal: parseInt(form.principal), fiscal_year: parseInt(form.fiscal_year) });
      showToast('Loan created!');
      setShowAdd(false);
      setForm({ member_id:'', principal:'', issued_date:'', due_date:'', fiscal_year:String(fiscalYear), notes:'' });
      refetch();
    } catch(e) {
      showToast(e.response?.data?.error || 'Failed', 'error');
    } finally { setSaving(false); }
  };

  if (loading) return <Loading/>;
  const list = loanList || [];

  const totalPrincipal = list.reduce((s,l) => s+l.principal, 0);
  const totalRepaid    = list.reduce((s,l) => s+(l.total_repaid||0), 0);
  const totalBalance   = list.reduce((s,l) => s+(l.balance||0), 0);

  const byMember = Object.values(list.reduce((acc, l) => {
    if (!acc[l.member_id]) acc[l.member_id] = { name: l.member_name.split(' ')[0], total: 0 };
    acc[l.member_id].total += l.principal;
    return acc;
  }, {})).sort((a,b) => b.total-a.total);

  // Live issue validation
  const selMember = (membersData||[]).find(m => String(m.id) === form.member_id);
  const maxEligible = selMember ? Math.round((selMember.total_contributions||0) * 0.8) : 0;
  const reqPrincipal = parseInt(form.principal||0);
  const isFY2026Issue = parseInt(form.fiscal_year||2026) >= 2026;
  const iRate = isFY2026Issue ? 0.12 : 0.05;
  const iAmount = Math.round(reqPrincipal * iRate);
  const isExceeding = selMember && isFY2026Issue && reqPrincipal > maxEligible;

  return (
    <div className="page">
      <SectionHeader title="Loans" sub={`FY${fiscalYear} · ${list.length} loans`}
        action={
          <div style={{ display:'flex', gap:10 }}>
            <div className="tabs">
              {[2024,2025,2026].map(y => <button key={y} className={`tab ${fiscalYear===y?'active':''}`} onClick={() => setFiscalYear(y)}>{y}</button>)}
            </div>
            {isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)}>Import CSV</button>}
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ New Loan</button>}
          </div>
        }/>

      {fiscalYear >= 2026 && (
        <div style={{ background:'var(--bg-card)', borderLeft:'4px solid var(--accent-indigo)', padding:'10px 14px', borderRadius:'0 8px 8px 0', marginBottom:20, fontSize:12 }}>
          <strong style={{ color:'var(--text-primary)' }}>FY2026 Constitution Rules In Effect:</strong> 12% upfront interest, 6-Month repayment boundary, maximum loan eligibility capped at 80% of total member contributions, 10% monthly overdue penalty.
        </div>
      )}

      <div className="stats-grid">
        <StatCard icon="💸" label="Total Issued" value={fmt(totalPrincipal)} accent="var(--accent-indigo)"/>
        <StatCard icon="✅" label="Total Repaid" value={fmt(totalRepaid)} accent="var(--accent-teal)"/>
        <StatCard icon="⏳" label="Outstanding" value={fmt(totalBalance)} subColor="var(--accent-red)" accent="var(--accent-red)"/>
        <StatCard icon="📊" label="Interest Earned" value={fmt(list.reduce((s,l)=>s+l.interest_amount,0))} accent="var(--accent-amber)"/>
      </div>

      <div style={{ display:'flex', gap:8 }}>
        {['all','active','paid','overdue'].map(f => (
          <button key={f} className={`tab ${filter===f?'active':''}`} onClick={() => setFilter(f)} style={{ textTransform:'capitalize' }}>{f}</button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>{['Member','Loan #','Principal','Interest','Deposited','Issued','Repaid','Penalty','Balance','Status',''].map(h=><th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {list.map(l => (
              <tr key={l.id} style={{ background: l.penalty > 0 ? '#ef444405' : 'transparent' }}>
                <td><strong>{l.member_name}</strong></td>
                <td style={{ color:'var(--text-muted)' }}>{l.loan_number}</td>
                <td style={{ color:'var(--accent-blue)', fontWeight:700 }}>{fmt(l.principal)}</td>
                <td style={{ color:'var(--accent-amber)' }}>{fmt(l.interest_amount)}</td>
                <td>{fmt(l.amount_deposited)}</td>
                <td style={{ color:'var(--text-muted)', fontSize:12 }}>{l.issued_date}</td>
                <td style={{ color:'var(--accent-teal)' }}>{fmt(l.total_repaid)}</td>
                <td style={{ color: l.penalty>0?'var(--accent-red)':'var(--text-muted)', fontWeight: l.penalty>0?700:400 }}>{fmt(l.penalty||0)}</td>
                <td style={{ color: l.balance>0?'var(--accent-red)':'var(--accent-teal)', fontWeight:700 }}>
                  {fmt(l.balance > 0 ? l.balance : 0)}
                </td>
                <td>
                  {l.penalty > 0 && l.status !== 'paid' ? 
                    <span className="badge badge-red">overdue</span> : 
                    <span className={`badge badge-${l.status}`}>{l.status}</span>}
                </td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDetailId(l.id)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="chart-card">
        <div className="chart-title">Loans by Member (FY{fiscalYear})</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={byMember} barSize={22}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="name" tick={{ fill:'var(--text-muted)', fontSize:11 }} axisLine={false}/>
            <YAxis tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickFormatter={fmtShort}/>
            <Tooltip content={<ChartTooltip formatter={v => `TZS ${v.toLocaleString()}`}/>}/>
            <Bar dataKey="total" name="Total Loans" fill="var(--accent-blue)" radius={[4,4,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {detailId && <LoanDetail loanId={detailId} onClose={() => setDetailId(null)}/>}
      {showImport && <ImportCsvModal type="loans" onClose={() => setShowImport(false)} onComplete={refetch} />}
      {showAdd && (
        <Modal title="Issue New Loan" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleAddLoan} className="modal-form">
            <div className="form-group">
              <label>Member</label>
              <select className="form-input" value={form.member_id} onChange={e => setForm({...form,member_id:e.target.value})} required>
                <option value="">Select member…</option>
                {(membersData||[]).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {selMember && isFY2026Issue && (
                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
                  Maximum Eligibility: <strong style={{ color:'var(--accent-teal)' }}>{fmt(maxEligible)}</strong> (80% of {fmt(selMember.total_contributions||0)})
                </div>
              )}
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>Principal (TZS)</label>
                <input className="form-input" type="number" placeholder="e.g. 1000000" value={form.principal}
                  onChange={e => setForm({...form,principal:e.target.value})} required/>
                {isExceeding && (
                  <div style={{ color:'var(--accent-red)', fontSize:10, marginTop:4 }}>⚠ Exceeds maximum 80% borrowing limit.</div>
                )}
              </div>
              <div className="form-group">
                <label>Fiscal Year</label>
                <select className="form-input" value={form.fiscal_year} onChange={e => setForm({...form,fiscal_year:e.target.value})}>
                  {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            
            {form.principal && (
              <div style={{ background:'var(--bg-input)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--text-muted)', borderLeft: isFY2026Issue?'3px solid var(--accent-amber)':'none' }}>
                <div style={{ marginBottom:4 }}>
                  Interest ({isFY2026Issue?'12%':'5%'}): <strong style={{ color:'var(--accent-amber)' }}>{fmt(iAmount)}</strong>
                </div>
                <div>
                  Deposited to Member: <strong style={{ color:'var(--accent-teal)' }}>{fmt(reqPrincipal - iAmount)}</strong>
                </div>
              </div>
            )}
            
            <div className="grid-2">
              <div className="form-group">
                <label>Issue Date</label>
                <input className="form-input" type="date" value={form.issued_date} onChange={e => setForm({...form,issued_date:e.target.value})} required/>
              </div>
              <div className="form-group">
                <label>Due Date (optional)</label>
                <input className="form-input" type="date" value={form.due_date} onChange={e => setForm({...form,due_date:e.target.value})} disabled={isFY2026Issue}/>
                {isFY2026Issue && <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>Auto-calculated to exactly 6 months.</div>}
              </div>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input className="form-input" value={form.notes} onChange={e => setForm({...form,notes:e.target.value})} placeholder="Optional…"/>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || isExceeding}>{saving?'Saving…':'Issue Loan'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
