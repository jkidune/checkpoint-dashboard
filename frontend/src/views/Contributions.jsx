import { useState, useEffect } from 'react';
import { SectionHeader, Modal, Loading, fmt, showToast, useApi } from '../components/UI';
import { contributions, members, mailer } from '../api';
import { exportContributionsCSV } from '../utils/exporter';
import ImportCsvModal from '../components/ImportCsvModal';
import { Download, Bell, Layers, Plus, Upload } from 'lucide-react';

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

function BulkPaymentModal({ onClose, membersData, onComplete }) {
  const [form, setForm] = useState({
    member_id: '',
    total_amount: '',
    paid_date: new Date().toISOString().split('T')[0],
    mpesa_ref: '',
    notes: '',
  });
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (form.member_id && form.total_amount && parseInt(form.total_amount) >= 1000) {
      setLoadingPreview(true);
      contributions.bulkPaymentPreview(form)
        .then(res => setPreview(res.data))
        .catch(() => setPreview(null))
        .finally(() => setLoadingPreview(false));
    } else {
      setPreview(null);
    }
  }, [form.member_id, form.total_amount, form.paid_date]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!preview || saving) return;
    setSaving(true);
    try {
      await contributions.bulkPayment({
        ...form,
        total_amount: parseInt(form.total_amount),
      });
      showToast('Bulk payment processed successfully!');
      onComplete();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to process bulk payment', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Bulk / Lump-Sum Payment" onClose={onClose} maxWidth={550}>
      <form onSubmit={handleSubmit} className="modal-form">
        <div className="form-group">
          <label>Member</label>
          <select className="form-input" value={form.member_id} onChange={e => setForm({...form, member_id: e.target.value})} required>
            <option value="">Select member…</option>
            {(membersData || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label>Total Payment Amount (TZS)</label>
            <input className="form-input" type="number" placeholder="225000" value={form.total_amount}
              onChange={e => setForm({...form, total_amount: e.target.value})} required/>
          </div>
          <div className="form-group">
            <label>Payment Date</label>
            <input className="form-input" type="date" value={form.paid_date}
              onChange={e => setForm({...form, paid_date: e.target.value})} required/>
          </div>
        </div>

        {loadingPreview && <div style={{ textAlign:'center', padding:20, color:'var(--text-muted)', fontSize:12 }}>Calculating allocation…</div>}

        {preview && (
          <div style={{ background:'var(--bg-input)', borderRadius:12, padding:16, marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', color:'var(--text-muted)', letterSpacing:1, marginBottom:12 }}>
              Allocation Breakdown
            </div>
            
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {/* Contributions */}
              {preview.contributions.length > 0 && (
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                    <span style={{ color:'var(--text-secondary)' }}>Monthly Contributions ({preview.contributions.length})</span>
                    <span style={{ fontWeight:700, color:'var(--accent-teal)' }}>{fmt(preview.summary.contribution_total)}</span>
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                    {preview.contributions.map((c, i) => (
                      <span key={i} style={{ fontSize:10, background:'var(--bg-card)', padding:'2px 6px', borderRadius:4, color:'var(--text-muted)', border:'1px solid var(--border)' }}>
                        {MONTHS[c.month-1]} {c.year}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Fines */}
              {preview.summary.fines_paid_total > 0 && (
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, paddingTop:8, borderTop:'1px solid var(--border)' }}>
                  <span style={{ color:'var(--text-secondary)' }}>Fines Repayment</span>
                  <span style={{ fontWeight:700, color:'var(--accent-amber)' }}>{fmt(preview.summary.fines_paid_total)}</span>
                </div>
              )}

              {/* Loan */}
              {preview.loan_repayment && (
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, paddingTop:8, borderTop:'1px solid var(--border)' }}>
                  <span style={{ color:'var(--text-secondary)' }}>Loan Repayment</span>
                  <span style={{ fontWeight:700, color:'var(--accent-blue)' }}>{fmt(preview.loan_repayment.amount)}</span>
                </div>
              )}

              {/* Partial contribution / Remainder */}
              {preview.partial_contribution && (
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, paddingTop:8, borderTop:'1px solid var(--border)' }}>
                  <span style={{ color:'var(--text-secondary)' }}>Partial Contrib ({MONTHS[preview.partial_contribution.month-1]} {preview.partial_contribution.year})</span>
                  <span style={{ fontWeight:700, color:'var(--accent-indigo)' }}>{fmt(preview.partial_contribution.amount)}</span>
                </div>
              )}

              <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, fontWeight:800, color:'var(--text-primary)', paddingTop:10, borderTop:'2px solid var(--border)', marginTop:4 }}>
                <span>TOTAL ALLOCATED</span>
                <span>{fmt(parseInt(form.total_amount))}</span>
              </div>
            </div>

            {preview.summary.fines_total > 0 && (
              <div style={{ marginTop:14, fontSize:11, color:'var(--accent-red)', background:'#ef444410', padding:'8px 10px', borderRadius:6, border:'1px solid #ef444420' }}>
                ⚠ Late penalties of <strong>{fmt(preview.summary.fines_total)}</strong> generated from these months.
              </div>
            )}
          </div>
        )}

        <div className="grid-2">
          <div className="form-group">
            <label>MPesa Reference</label>
            <input className="form-input" placeholder="e.g. QAB123XYZ" value={form.mpesa_ref}
              onChange={e => setForm({...form, mpesa_ref: e.target.value})}/>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <input className="form-input" placeholder="Lump sum for..." value={form.notes}
              onChange={e => setForm({...form, notes: e.target.value})}/>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !preview}>
            {saving ? 'Processing…' : 'Confirm Bulk Payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Contributions({ user }) {
  const isAdmin = user?.role === 'admin';
  const [fy, setFy] = useState(2025);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ member_id:'', amount:'', month:'', year: '2025', status:'paid', paid_date:'', mpesa_ref:'', notes:'' });
  const [saving, setSaving] = useState(false);
  const [fineInfo, setFineInfo] = useState(null);
  const [broadcasting, setBroadcasting] = useState(false);

  const { data: gridData, loading, refetch } = useApi(() => contributions.grid(fy), [fy]);
  const { data: membersData } = useApi(() => members.list());

  // Fine Preview: only trigger correctly based on rules
  useEffect(() => {
    if (form.amount && form.month && form.year && form.paid_date && form.status === 'paid') {
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
            <button className="btn btn-secondary btn-sm" onClick={handleExportCSV} title="Download contribution grid as CSV"
              style={{ display:'flex', alignItems:'center', gap:5 }}>
              <Download size={12}/> CSV
            </button>
            {isAdmin && (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)}
                style={{ display:'flex', alignItems:'center', gap:5 }}>
                <Upload size={12}/> Import
              </button>
            )}
            {isAdmin && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleBroadcastReminders}
                disabled={broadcasting}
                title="Email payment reminders to all members who haven't paid this month"
                style={{ borderColor:'var(--accent-amber)', color:'var(--accent-amber)', display:'flex', alignItems:'center', gap:5 }}
              >
                <Bell size={12}/> {broadcasting ? 'Sending…' : 'Reminders'}
              </button>
            )}
            {isAdmin && (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowBulk(true)}
                style={{ borderColor:'var(--accent-teal)', color:'var(--accent-teal)', display:'flex', alignItems:'center', gap:5 }}>
                <Layers size={12}/> Bulk Payment
              </button>
            )}
            {isAdmin && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}
                style={{ display:'flex', alignItems:'center', gap:5 }}>
                <Plus size={12}/> Add
              </button>
            )}
          </div>
        }
      />

      {(fy === 2025 || isFY2026) && (
        <div style={{ background:'var(--bg-card)', borderLeft:`4px solid ${isFY2026 ? 'var(--accent-red)' : 'var(--accent-amber)'}`, padding:'10px 14px', borderRadius:'0 8px 8px 0', marginBottom:20, fontSize:12 }}>
          <strong style={{ color:'var(--text-primary)' }}>Constitution Rule ({fy}):</strong> 
          {isFY2026 
            ? ' Late contributions (after the 5th) compound 15% penalty per month.' 
            : ' Late contributions (after the 5th) incur a flat TZS 3,500 fine per month.'}
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
                ⚠ <strong>Late Penalty:</strong> {fineInfo.reason}.
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

      {showBulk && <BulkPaymentModal onClose={() => setShowBulk(false)} membersData={membersData} onComplete={refetch} />}
      {showImport && <ImportCsvModal type="contributions" onClose={() => setShowImport(false)} onComplete={refetch} />}
    </div>
  );
}
