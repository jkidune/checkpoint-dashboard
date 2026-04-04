import { useState, useEffect } from 'react';
import { SectionHeader, Modal, Loading, fmt, showToast, useApi } from '../components/UI';
import { contributions, members, mailer } from '../api';
import { exportContributionsCSV } from '../utils/exporter';
import ImportCsvModal from '../components/ImportCsvModal';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TARGET_2024 = 50000;
const TARGET_2025 = 75000;

function ContribCell({ data, year }) {
  if (!data) return <div style={{ color:'var(--text-muted)', fontSize:12, textAlign:'center' }}>—</div>;
  const target = year === 2024 ? TARGET_2024 : TARGET_2025;
  const color = data.amount >= target ? 'var(--accent-teal)' : data.amount > 0 ? 'var(--accent-amber)' : 'var(--accent-red)';
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ color, fontWeight:700, fontSize:12 }}>{(data.amount/1000).toFixed(0)}K</div>
    </div>
  );
}

export default function Contributions({ user }) {
  const isAdmin = user?.role === 'admin';
  const [year, setYear] = useState(2025);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ member_id:'', amount:'', month:'', year: String(year), status:'paid', paid_date:'', mpesa_ref:'', notes:'' });
  const [saving, setSaving] = useState(false);
  const [fineInfo, setFineInfo] = useState(null);
  const [broadcasting, setBroadcasting] = useState(false);

  const { data: gridData, loading, refetch } = useApi(() => contributions.grid(year), [year]);
  const { data: membersData } = useApi(() => members.list());

  // Fine Preview Effect
  useEffect(() => {
    if (form.amount && form.month && form.year && form.paid_date && form.status === 'paid' && parseInt(form.year) >= 2026) {
      contributions.finePreview(form)
        .then(res => setFineInfo(res.data.penalty > 0 ? res.data : null))
        .catch(() => setFineInfo(null));
    } else {
      setFineInfo(null);
    }
  }, [form.amount, form.month, form.year, form.paid_date, form.status]);

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

  const handleBroadcastReminders = async () => {
    setBroadcasting(true);
    try {
      const now = new Date();
      // Contributions are due at end-of-month; deadline is the 5th of the FOLLOWING month.
      // So the "outstanding" period is always the PREVIOUS calendar month.
      const prevMonth = now.getMonth(); // getMonth() is 0-based, so Jan=0 → prevMonth=0 means Dec of prev year
      const reminderMonth = prevMonth === 0 ? 12 : prevMonth;
      const reminderYear  = prevMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();

      const res = await mailer.broadcastReminders({
        month: reminderMonth,
        year:  reminderYear,
      });
      const { sent, skipped, failed, mock_mode } = res.data;
      const mockNote = mock_mode ? ' (mock — check backend logs)' : '';
      showToast(`${res.data.message}${mockNote}`);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to broadcast reminders', 'error');
    } finally {
      setBroadcasting(false);
    }
  };

  const handleExportCSV = () => {
    try {
      exportContributionsCSV(gridData, year);
      showToast('Contributions CSV downloaded!');
    } catch (e) {
      showToast('Failed to export CSV', 'error');
    }
  };

  if (loading) return <Loading/>;
  if (!gridData) return null;

  const { grid, monthlyTotals } = gridData;
  const totalPaid = grid.reduce((s,m) => s+m.total, 0);
  const target2025Total = 10 * 75000 * 10; 

  const isFY2026 = year >= 2026;

  return (
    <div className="page">
      <SectionHeader
        title="Contributions"
        sub={`FY${year} · ${fmt(totalPaid)} collected`}
        action={
          <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
            <div className="tabs">
              {[2024,2025,2026].map(y => (
                <button key={y} className={`tab ${year===y?'active':''}`} onClick={() => setYear(y)}>{y}</button>
              ))}
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleExportCSV}
              title="Download contribution grid as CSV"
            >
              ⬇ CSV
            </button>
            {isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)}>Import CSV</button>}
            {isAdmin && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleBroadcastReminders}
                disabled={broadcasting}
                title="Email payment reminders to all members who haven't paid this month"
                style={{ borderColor:'var(--accent-amber)', color:'var(--accent-amber)' }}
              >
                {broadcasting ? 'Sending…' : '🔔 Broadcast Reminders'}
              </button>
            )}
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add</button>}
          </div>
        }
      />

      {isFY2026 && (
        <div style={{ background:'var(--bg-card)', borderLeft:'4px solid var(--accent-red)', padding:'10px 14px', borderRadius:'0 8px 8px 0', marginBottom:20, fontSize:12 }}>
          <strong style={{ color:'var(--text-primary)' }}>FY2026 Constitution Rule:</strong> Late contributions (paid after the 5th of the following month) automatically compound a <strong>15% penalty per month</strong>.
        </div>
      )}

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
            {year>=2025 ? `${Math.round(totalPaid/target2025Total*100)}%` : '100%'}
          </div>
        </div>
      </div>

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
              <label>Payment Date</label>
              <input className="form-input" type="date" value={form.paid_date}
                onChange={e => setForm({...form,paid_date:e.target.value})}/>
            </div>
            
            {fineInfo && (
              <div style={{ background:'#ef444415', border:'1px solid #ef444430', borderRadius:8, padding:'10px', color:'var(--accent-red)', fontSize:12, marginBottom:16 }}>
                ⚠ <strong>Late Penalty:</strong> Based on the payment date, a fine of <strong>{fmt(fineInfo.penalty)}</strong> ({fineInfo.months_late} months late at 15%) will be automatically generated upon saving.
              </div>
            )}

            <div className="form-group">
              <label>MPesa Reference</label>
              <input className="form-input" placeholder="e.g. QAB123XYZ" value={form.mpesa_ref}
                onChange={e => setForm({...form,mpesa_ref:e.target.value})}/>
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

      {showImport && <ImportCsvModal type="contributions" onClose={() => setShowImport(false)} onComplete={refetch} />}
    </div>
  );
}
