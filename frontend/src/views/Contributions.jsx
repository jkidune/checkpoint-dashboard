import { useState, useEffect } from 'react';
import { SectionHeader, Modal, Loading, fmt, showToast, useApi } from '../components/UI';
import { contributions, members, mailer } from '../api';
import { exportContributionsCSV } from '../utils/exporter';
import ImportCsvModal from '../components/ImportCsvModal';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Checkpoint FY: March of year Y → February of year Y+1
// Display columns in fiscal order (Mar first, then … Dec, Jan, Feb)
const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

// Which calendar year does a given FY month actually live in?
function fyMonthYear(mo, fy) { return mo >= 3 ? fy : fy + 1; }

// Derive fiscal year from a calendar month + year
function getFiscalYear(month, year) { return month >= 3 ? year : year - 1; }

const TARGET_FY2024 = 50000;
const TARGET_FY2025_PLUS = 75000;

function ContribCell({ data, fy }) {
  if (!data) return <div style={{ color:'var(--text-muted)', fontSize:12, textAlign:'center' }}>—</div>;
  const target = fy <= 2024 ? TARGET_FY2024 : TARGET_FY2025_PLUS;
  const color = data.amount >= target ? 'var(--accent-teal)' : data.amount > 0 ? 'var(--accent-amber)' : 'var(--accent-red)';
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ color, fontWeight:700, fontSize:12 }}>{(data.amount/1000).toFixed(0)}K</div>
    </div>
  );
}

export default function Contributions({ user }) {
  const isAdmin = user?.role === 'admin';
  const [fy, setFy] = useState(2025);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ member_id:'', amount:'', month:'', year: '2025', status:'paid', paid_date:'', mpesa_ref:'', notes:'' });
  const [saving, setSaving] = useState(false);
  const [fineInfo, setFineInfo] = useState(null);
  const [broadcasting, setBroadcasting] = useState(false);

  const { data: gridData, loading, refetch } = useApi(() => contributions.grid(fy), [fy]);
  const { data: membersData } = useApi(() => members.list());

  // Fine Preview: only trigger for FY2026+ (new Katiba)
  useEffect(() => {
    const m = parseInt(form.month);
    const y = parseInt(form.year);
    const formFY = m && y ? getFiscalYear(m, y) : 0;

    if (form.amount && form.month && form.year && form.paid_date && form.status === 'paid' && formFY >= 2026) {
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
      await contributions.create({
        ...form,
        amount: parseInt(form.amount),
        month:  parseInt(form.month),
        year:   parseInt(form.year),
      });
      showToast('Contribution recorded!');
      setShowAdd(false);
      setForm({ member_id:'', amount:'', month:'', year: String(fy), status:'paid', paid_date:'', mpesa_ref:'', notes:'' });
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
      const prevMonth = now.getMonth(); // 0-based
      const reminderMonth = prevMonth === 0 ? 12 : prevMonth;
      const reminderYear  = prevMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();

      const res = await mailer.broadcastReminders({ month: reminderMonth, year: reminderYear });
      const { mock_mode } = res.data;
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
      exportContributionsCSV(gridData, fy);
      showToast('Contributions CSV downloaded!');
    } catch (e) {
      showToast('Failed to export CSV', 'error');
    }
  };

  if (loading) return <Loading/>;
  if (!gridData) return null;

  const { grid, monthlyTotals } = gridData;
  const totalPaid = grid.reduce((s, m) => s + m.total, 0);
  const monthlyTarget = fy <= 2024 ? TARGET_FY2024 : TARGET_FY2025_PLUS;
  const target2025Total = grid.length * monthlyTarget * 12;
  const isFY2026 = fy >= 2026;

  return (
    <div className="page">
      <SectionHeader
        title="Contributions"
        sub={`FY${fy} (${MONTHS[2]} ${fy} – ${MONTHS[1]} ${fy + 1}) · ${fmt(totalPaid)} collected`}
        action={
          <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
            <div className="tabs">
              {[2024, 2025, 2026].map(y => (
                <button key={y} className={`tab ${fy === y ? 'active' : ''}`} onClick={() => setFy(y)}>FY{y}</button>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleExportCSV} title="Download contribution grid as CSV">
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
          <strong style={{ color:'var(--text-primary)' }}>FY2026 Constitution Rule:</strong> Late contributions (paid after the 5th of the following month) automatically compound a <strong>15% penalty per month</strong>. Applies to all contributions from March 2026 onwards.
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
          <div style={{ color:'var(--text-primary)', fontWeight:800, fontSize:20, fontFamily:'var(--font-display)' }}>{fmt(monthlyTarget * grid.length)}</div>
        </div>
        <div className="card">
          <div style={{ color:'var(--text-muted)', fontSize:11, fontWeight:600, textTransform:'uppercase' }}>Rate / Member</div>
          <div style={{ color:'var(--accent-teal)', fontWeight:800, fontSize:20, fontFamily:'var(--font-display)' }}>TZS {fy <= 2024 ? '50K' : '75K'}/mo</div>
        </div>
        <div className="card">
          <div style={{ color:'var(--text-muted)', fontSize:11, fontWeight:600, textTransform:'uppercase' }}>Compliance</div>
          <div style={{ color:'var(--accent-amber)', fontWeight:800, fontSize:20, fontFamily:'var(--font-display)' }}>
            {target2025Total > 0 ? `${Math.min(100, Math.round(totalPaid / target2025Total * 100))}%` : '—'}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding:0, overflow:'auto' }}>
        <table style={{ minWidth:980 }}>
          <thead>
            <tr>
              <th style={{ width:160 }}>Member</th>
              {FY_MONTHS.map((mo, idx) => {
                const yr = fyMonthYear(mo, fy);
                const isCrossYear = mo <= 2; // Jan & Feb belong to fy+1
                return (
                  <th key={mo} style={{
                    textAlign:'center', width:65,
                    borderLeft: idx === 10 ? '2px solid var(--accent-blue)' : undefined, // separator before Jan
                    color: isCrossYear ? 'var(--accent-blue)' : undefined,
                  }}>
                    {MONTHS[mo - 1]}
                    {isCrossYear && <div style={{ fontSize:9, color:'var(--accent-blue)', fontWeight:400 }}>{yr}</div>}
                  </th>
                );
              })}
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
                {FY_MONTHS.map((mo, idx) => (
                  <td key={mo} style={{ borderLeft: idx === 10 ? '2px solid var(--accent-blue)' : undefined }}>
                    <ContribCell data={row.months[mo]} fy={fy}/>
                  </td>
                ))}
                <td style={{ textAlign:'right', color:'var(--accent-blue)', fontWeight:700 }}>
                  {fmt(row.total)}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop:'2px solid var(--border)', background:'var(--bg-surface)' }}>
              <td style={{ fontWeight:700, color:'var(--text-secondary)' }}>TOTAL</td>
              {FY_MONTHS.map((mo, idx) => (
                <td key={mo} style={{ textAlign:'center', color:'var(--accent-teal)', fontWeight:700, fontSize:12, borderLeft: idx === 10 ? '2px solid var(--accent-blue)' : undefined }}>
                  {monthlyTotals[mo] ? `${(monthlyTotals[mo]/1000).toFixed(0)}K` : '—'}
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
              <select className="form-input" value={form.member_id} onChange={e => setForm({...form, member_id:e.target.value})} required>
                <option value="">Select member…</option>
                {(membersData||[]).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>Month</label>
                <select className="form-input" value={form.month} onChange={e => {
                  const mo = parseInt(e.target.value);
                  // Auto-correct the calendar year: Jan & Feb belong to fy+1
                  const autoYear = mo && mo <= 2 ? String(fy + 1) : String(fy);
                  setForm({...form, month: e.target.value, year: autoYear});
                }} required>
                  <option value="">Select…</option>
                  {FY_MONTHS.map(mo => (
                    <option key={mo} value={mo}>
                      {MONTHS[mo - 1]}{mo <= 2 ? ` (${fy + 1})` : ` (${fy})`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Calendar Year</label>
                <select className="form-input" value={form.year} onChange={e => setForm({...form, year:e.target.value})}>
                  <option value="2024">2024</option>
                  <option value="2025">2025</option>
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:-10, marginBottom:8 }}>
              FY = <strong>{form.month ? getFiscalYear(parseInt(form.month), parseInt(form.year)) : '—'}</strong>
              &nbsp;·&nbsp;{form.month && parseInt(form.month) <= 2 ? 'Jan & Feb belong to previous FY' : ''}
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>Amount (TZS)</label>
                <input className="form-input" type="number" placeholder="75000" value={form.amount}
                  onChange={e => setForm({...form, amount:e.target.value})} required/>
              </div>
              <div className="form-group">
                <label>Status</label>
                <select className="form-input" value={form.status} onChange={e => setForm({...form, status:e.target.value})}>
                  <option value="paid">Paid</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="partial">Partial</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Payment Date</label>
              <input className="form-input" type="date" value={form.paid_date}
                onChange={e => setForm({...form, paid_date:e.target.value})}/>
            </div>

            {fineInfo && (
              <div style={{ background:'#ef444415', border:'1px solid #ef444430', borderRadius:8, padding:'10px', color:'var(--accent-red)', fontSize:12, marginBottom:16 }}>
                ⚠ <strong>Late Penalty (FY2026 Katiba):</strong> A fine of <strong>{fmt(fineInfo.penalty)}</strong> ({fineInfo.months_late} month{fineInfo.months_late > 1 ? 's' : ''} late × 15%) will be auto-generated on save.
              </div>
            )}

            <div className="form-group">
              <label>MPesa Reference</label>
              <input className="form-input" placeholder="e.g. QAB123XYZ" value={form.mpesa_ref}
                onChange={e => setForm({...form, mpesa_ref:e.target.value})}/>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input className="form-input" placeholder="Optional notes…" value={form.notes}
                onChange={e => setForm({...form, notes:e.target.value})}/>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showImport && <ImportCsvModal type="contributions" onClose={() => setShowImport(false)} onComplete={refetch} />}
    </div>
  );
}
