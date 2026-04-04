import { useState } from 'react';
import { SectionHeader, Modal, Avatar, ProgressBar, Loading, fmt, showToast, useApi } from '../components/UI';
import { members } from '../api';
import ImportCsvModal from '../components/ImportCsvModal';

const ROLE_COLORS = { chair:'var(--accent-amber)', secretary:'var(--accent-teal)', treasurer:'var(--accent-indigo)', member:'var(--text-muted)' };

function MemberDetail({ memberId, onClose, user }) {
  const { data, loading } = useApi(() => members.get(memberId));
  if (loading || !data) return <div className="loading"><div className="spinner"/></div>;

  return (
    <Modal title={data.name} onClose={onClose} maxWidth={600}>
      <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
          {[
            ['2025 Contributions', fmt(data.contributions_2025), 'var(--accent-blue)'],
            ['2024 Contributions', fmt(data.contributions_2024), 'var(--text-secondary)'],
            ['Active Loan', fmt(data.active_loan_amount), data.active_loan_amount>0?'var(--accent-red)':'var(--accent-teal)'],
          ].map(([l,v,c]) => (
            <div key={l} style={{ background:'var(--bg-input)', borderRadius:10, padding:'10px 12px' }}>
              <div style={{ color:'var(--text-muted)', fontSize:10, marginBottom:3 }}>{l}</div>
              <div style={{ color:c, fontWeight:700, fontSize:14 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* 2025 compliance */}
        <div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>FY2025 Contribution Compliance ({data.months_paid_2025}/10 months)</div>
          <ProgressBar value={data.months_paid_2025} max={10}/>
        </div>

        {/* Loans */}
        {data.loans?.length > 0 && (
          <div>
            <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', color:'var(--text-muted)', letterSpacing:'0.07em', marginBottom:8 }}>Loan History</div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {data.loans.map(l => (
                <div key={l.id} style={{ display:'flex', justifyContent:'space-between', background:'var(--bg-input)', borderRadius:8, padding:'8px 12px', alignItems:'center' }}>
                  <span style={{ color:'var(--text-secondary)', fontSize:12 }}>{l.loan_number} · {l.issued_date}</span>
                  <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                    <span style={{ color:'var(--accent-blue)', fontWeight:700, fontSize:12 }}>{fmt(l.principal)}</span>
                    <span className={`badge badge-${l.status}`}>{l.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fines */}
        {data.fines?.length > 0 && (
          <div>
            <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', color:'var(--text-muted)', letterSpacing:'0.07em', marginBottom:8 }}>Fines</div>
            {data.fines.map(f => (
              <div key={f.id} style={{ background:'var(--bg-input)', borderRadius:8, padding:'8px 12px', marginBottom:4 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ color:'var(--text-secondary)', fontSize:12 }}>{f.reason}</span>
                  <div style={{ display:'flex', gap:12, alignItems:'center', flexShrink:0, marginLeft:8 }}>
                    <span style={{ color:'var(--accent-red)', fontWeight:700, fontSize:12 }}>{fmt(f.amount)}</span>
                    <span className={`badge badge-${f.status}`}>{f.status}</span>
                  </div>
                </div>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:3, display:'flex', gap:12 }}>
                  <span>FY{f.year}</span>
                  {f.created_at && (
                    <span>Recorded {new Date(f.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</span>
                  )}
                  {f.status === 'paid' && f.paid_date && (
                    <span style={{ color:'var(--accent-teal)' }}>Paid {f.paid_date}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {data.unpaid_fines > 0 && (
          <div style={{ background:'#ef444415', border:'1px solid #ef444430', borderRadius:8, padding:'10px 14px', color:'var(--accent-red)', fontSize:12 }}>
            ⚠ Outstanding fines: {fmt(data.unpaid_fines)}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Members({ user }) {
  const isAdmin = user?.role === 'admin';
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ name:'', phone:'', role:'member', join_date:'' });
  const [saving, setSaving] = useState(false);

  const { data, loading, refetch } = useApi(() => members.list());

  const handleAdd = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await members.create(form);
      showToast('Member added!');
      setShowAdd(false);
      setForm({ name:'', phone:'', role:'member', join_date:'' });
      refetch();
    } catch(e) {
      showToast(e.response?.data?.error || 'Failed', 'error');
    } finally { setSaving(false); }
  };

  if (loading) return <Loading/>;
  const filtered = (data||[]).filter(m => m.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page">
      <SectionHeader
        title="Members"
        sub={`${filtered.length} of ${data?.length} members`}
        action={
          <div style={{ display:'flex', gap:10 }}>
            <input className="form-input" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ width:200 }}/>
            {isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)}>Import CSV</button>}
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Member</button>}
          </div>
        }/>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:14 }}>
        {filtered.map(m => {
          const compliance = Math.round((m.months_paid_2025 || 0) / 10 * 100);
          return (
            <div key={m.id} className="card" style={{ cursor:'pointer', transition:'border-color 0.2s' }}
              onClick={() => setDetailId(m.id)}
              onMouseEnter={e => e.currentTarget.style.borderColor='var(--accent-blue)'}
              onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
                <Avatar name={m.name} size={44}/>
                <div>
                  <div style={{ fontWeight:700, fontSize:14, fontFamily:'var(--font-display)' }}>{m.name}</div>
                  <div style={{ display:'flex', gap:6, marginTop:3 }}>
                    <span className={`badge badge-${m.role}`}>{m.role}</span>
                    {m.active_loans > 0 && <span style={{ fontSize:10, color:'var(--accent-red)' }}>● Active loan</span>}
                  </div>
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
                <div style={{ background:'var(--bg-input)', borderRadius:8, padding:'8px 10px' }}>
                  <div style={{ color:'var(--text-muted)', fontSize:10 }}>Max Loan Limit</div>
                  <div style={{ color:'var(--accent-blue)', fontWeight:700, fontSize:13 }}>{fmt(m.total_contributions * 0.8)}</div>
                </div>
                <div style={{ background:'var(--bg-input)', borderRadius:8, padding:'8px 10px' }}>
                  <div style={{ color:'var(--text-muted)', fontSize:10 }}>Cumulative Contribs</div>
                  <div style={{ color:'var(--text-primary)', fontWeight:700, fontSize:13 }}>{fmt(m.total_contributions)}</div>
                </div>
              </div>

              <div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-muted)', marginBottom:5 }}>
                  <span>2025 Compliance</span>
                  <span>{m.months_paid_2025}/10 months</span>
                </div>
                <ProgressBar value={m.months_paid_2025 || 0} max={10}/>
              </div>

              {m.unpaid_fines > 0 && (
                <div style={{ marginTop:10, color:'var(--accent-red)', fontSize:11 }}>
                  ⚠ Unpaid fines: {fmt(m.unpaid_fines)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {detailId && <MemberDetail memberId={detailId} onClose={() => setDetailId(null)} user={user}/>}
      
      {showImport && <ImportCsvModal type="members" onClose={() => setShowImport(false)} onComplete={refetch} />}

      {showAdd && (
        <Modal title="Add New Member" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleAdd} className="modal-form">
            <div className="form-group">
              <label>Full Name</label>
              <input className="form-input" required placeholder="e.g. John Doe" value={form.name}
                onChange={e => setForm({...form,name:e.target.value})}/>
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input className="form-input" placeholder="+255 7XX XXX XXX" value={form.phone}
                onChange={e => setForm({...form,phone:e.target.value})}/>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>Role</label>
                <select className="form-input" value={form.role} onChange={e => setForm({...form,role:e.target.value})}>
                  <option value="member">Member</option>
                  <option value="chair">Chair</option>
                  <option value="secretary">Secretary</option>
                  <option value="treasurer">Treasurer</option>
                </select>
              </div>
              <div className="form-group">
                <label>Join Date</label>
                <input className="form-input" type="date" value={form.join_date} onChange={e => setForm({...form,join_date:e.target.value})}/>
              </div>
            </div>
            <div style={{ background:'var(--bg-input)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--text-muted)' }}>
              Entry fee of <strong style={{ color:'var(--accent-blue)' }}>TZS 500,000</strong> will be recorded automatically based on FY2026 Rules.
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving?'Saving…':'Add Member'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
