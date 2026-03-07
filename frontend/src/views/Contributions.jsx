import { useState } from 'react';
import { SectionHeader, Modal, Loading, fmt, showToast, useApi } from '../components/UI';
import { contributions, members } from '../api';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TARGET_2024 = 50000;
const TARGET_2025 = 75000;
const TARGET_2026 = 75000;

function ContribCell({ data, year }) {
  if (!data) return <div style={{ color:'var(--text-muted)', fontSize:12, textAlign:'center' }}>—</div>;
  const target = year === 2024 ? TARGET_2024 : (year === 2025 ? TARGET_2025 : TARGET_2026);
  const color = data.amount >= target ? 'var(--accent-teal)' : data.amount > 0 ? 'var(--accent-amber)' : 'var(--accent-red)';
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ color, fontWeight:700, fontSize:12 }}>{(data.amount/1000).toFixed(0)}K</div>
    </div>
  );
}

export default function Contributions({ user }) {
  const isAdmin = user?.role === 'admin';
  const [year, setYear] = useState(2026);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ member_id:'', amount:'', month:'', year: String(year), status:'paid', paid_date:'', mpesa_ref:'', notes:'' });
  const [saving, setSaving] = useState(false);

  const { data: gridData, loading, refetch } = useApi(() => contributions.grid(year), [year]);
  const { data: membersData } = useApi(() => members.list());

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await contributions.create({ ...form, amount: parseInt(form.amount), month: parseInt(form.month), year: parseInt(form.year) });
      showToast('Contribution recorded!');
      setShowAdd(false);
      setForm({ member_id:'', amount:'', month:'', year: String(year), status:'paid', paid_date:'', mpesa_ref:'', notes:'' });
      refetch();
    } catch(e) {
      showToast(e.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading/>;
  if (!gridData) return null;

  const { grid, monthlyTotals } = gridData;
  const totalPaid = grid.reduce((s,m) => s+m.total, 0);
  const target2025Total = 10 * 75000 * 10; // 10 members, 10 months (Mar-Dec), 75K
  const target2026Total = 10 * 75000 * 12; // 10 members, 12 months, 75K

  return (
    <div className="page">
      {/* Header */}
      <SectionHeader
        title="Contributions"
        sub={`FY${year} · ${fmt(totalPaid)} collected`}
        action={
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <div className="tabs">
              {[2024,2025,2026].map(y => (
                <button key={y} className={`tab ${year===y?'active':''}`} onClick={() => setYear(y)}>{y}</button>
              ))}
            </div>
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add</button>}
          </div>
        }
      />

      {/* Stats */}
      <div className="stats-grid" style={{ gridTemplateColumns:'repeat(4,1fr)' }}>
        <div className="card">
          <div style={{ color:'var(--text-muted)', fontSize:11, fontWeight:600, textTransform:'uppercase' }}>Total Collected</div>
          <div style={{ color:'var(--accent-blue)', fontWeight:800, fontSize:20, fontFamily:'var(--font-display)' }}>{fmt(totalPaid)}</div>
        </div>
        <div className="card">
          <div style={{ color:'var(--text-muted)', fontSize:11, fontWeight:600, textTransform:'uppercase' }}>Monthly Target</div>
          <div style={{ color:'var(--text-primary)', fontWeight:800, fontSize:20, fontFamily:'var(--font-display)' }}>{fmt(year>=2025?750000:550000)}</div>
        </div>
        <div className="card">
          <div style={{ color:'var(--text-muted)', fontSize:11, fontWeight:600, textTransform:'uppercase' }}>Rate/Member</div>
          <div style={{ color:'var(--accent-teal)', fontWeight:800, fontSize:20, fontFamily:'var(--font-display)' }}>TZS {year>=2025?'75K':'50K'}/mo</div>
        </div>
        <div className="card">
          <div style={{ color:'var(--text-muted)', fontSize:11, fontWeight:600, textTransform:'uppercase' }}>Compliance</div>
          <div style={{ color:'var(--accent-amber)', fontWeight:800, fontSize:20, fontFamily:'var(--font-display)' }}>
            {year===2025 ? `${Math.round(totalPaid/target2025Total*100)}%` : (year===2026 ? `${Math.round(totalPaid/target2026Total*100)}%` : '100%')}
          </div>
        </div>
      </div>

      {/* Grid table */}
      <div className="card" style={{ padding:0, overflow:'auto' }}>
        <table style={{ minWidth:900 }}>
          <thead>
            <tr>
              <th style={{ width:160 }}>Member</th>
              {MONTHS.map((m, i) => <th key={i} style={{ textAlign:'center', width:70 }}>{m}</th>)}
              <th style={{ textAlign:'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.map(row => (
              <tr key={row.member_id}>
                <td>
                  <div style={{ fontWeight:600 }}>{row.member_name.split(' ')[0]}</div>
                  <span className={`badge badge-${row.role}`}>{row.role}</span>
                </td>
                {Array.from({length:12},(_,i) => (
                  <td key={i}><ContribCell data={row.months[i+1]} year={year}/></td>
                ))}
                <td style={{ textAlign:'right', color:'var(--accent-blue)', fontWeight:700 }}>
                  {fmt(row.total)}
                </td>
              </tr>
            ))}
            {/* Totals row */}
            <tr style={{ borderTop:'2px solid var(--border)', background:'var(--bg-surface)' }}>
              <td style={{ fontWeight:700, color:'var(--text-secondary)' }}>TOTAL</td>
              {Array.from({length:12},(_,i) => (
                <td key={i} style={{ textAlign:'center', color:'var(--accent-teal)', fontWeight:700, fontSize:12 }}>
                  {monthlyTotals[i+1] ? `${(monthlyTotals[i+1]/1000).toFixed(0)}K` : '—'}
                </td>
              ))}
              <td style={{ textAlign:'right', color:'var(--accent-blue)', fontWeight:800 }}>{fmt(totalPaid)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Add modal */}
      {showAdd && (
        <Modal title="Record Contribution" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleAdd} className="modal-form">
            <div className="form-group">
              <label>Member</label>
              <select className="form-input" value={form.member_id} onChange={e => setForm({...form,member_id:e.target.value})} required>
                <option value="">Select member…</option>
                {(membersData||[]).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>Month</label>
                <select className="form-input" value={form.month} onChange={e => setForm({...form,month:e.target.value})} required>
                  <option value="">Select…</option>
                  {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Year</label>
                <select className="form-input" value={form.year} onChange={e => setForm({...form,year:e.target.value})}>
                  <option value="2024">2024</option>
                  <option value="2025">2025</option>
                  <option value="2026">2026</option>
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>Amount (TZS)</label>
                <input className="form-input" type="number" placeholder="75000" value={form.amount}
                  onChange={e => setForm({...form,amount:e.target.value})} required/>
              </div>
              <div className="form-group">
                <label>Status</label>
                <select className="form-input" value={form.status} onChange={e => setForm({...form,status:e.target.value})}>
                  <option value="paid">Paid</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="partial">Partial</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>MPesa Reference</label>
              <input className="form-input" placeholder="e.g. QAB123XYZ" value={form.mpesa_ref}
                onChange={e => setForm({...form,mpesa_ref:e.target.value})}/>
            </div>
            <div className="form-group">
              <label>Payment Date</label>
              <input className="form-input" type="date" value={form.paid_date}
                onChange={e => setForm({...form,paid_date:e.target.value})}/>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input className="form-input" placeholder="Optional notes…" value={form.notes}
                onChange={e => setForm({...form,notes:e.target.value})}/>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving?'Saving…':'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
