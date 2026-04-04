import { useState, useEffect } from 'react';
import { SectionHeader, Loading, showToast } from '../components/UI';
import { rules as rulesApi } from '../api';

const FIELD_META = [
  // Contributions section
  { key: 'contribution_amount',     label: 'Monthly Contribution (TZS)',  type: 'number', section: 'Contributions', hint: 'Amount each member must pay per month' },
  { key: 'late_fine_enabled',       label: 'Late Fine Enabled',           type: 'toggle', section: 'Contributions', hint: 'Automatically charge a fine for late payments' },
  { key: 'late_fine_type',          label: 'Late Fine Type',              type: 'select', section: 'Contributions', hint: 'Flat amount or percentage of contribution', depends: 'late_fine_enabled', options: [{label:'Flat Amount', value:'flat'}, {label:'Percentage', value:'percentage'}] },
  { key: 'late_fine_rate',          label: 'Late Fine Rate',              type: 'percent', section: 'Contributions', hint: 'Fine per month late (e.g. 0.15 = 15% of contribution amount)', depends: 'late_fine_type', dependsValue: 'percentage' },
  { key: 'late_fine_flat_amount',   label: 'Flat Fine Amount (TZS)',      type: 'number', section: 'Contributions', hint: 'Flat TZS amount charged once per late month', depends: 'late_fine_type', dependsValue: 'flat' },
  // Loans section
  { key: 'loan_interest_rate',      label: 'Loan Interest Rate',          type: 'percent', section: 'Loans', hint: 'Flat interest on loan principal (e.g. 0.12 = 12%)' },
  { key: 'loan_max_ratio',          label: 'Max Loan / Contributions',    type: 'percent_nullable', section: 'Loans', hint: 'Cap on loan size as % of member\'s total contributions. Leave blank for no cap.' },
  { key: 'loan_repayment_months',   label: 'Repayment Period (months)',   type: 'number_nullable', section: 'Loans', hint: 'Number of months to repay. Leave blank for no fixed term.' },
  { key: 'overdue_penalty_enabled', label: 'Overdue Penalty Enabled',     type: 'toggle', section: 'Loans', hint: 'Charge extra penalty on loans past the repayment period' },
  { key: 'overdue_penalty_rate',    label: 'Overdue Penalty Rate',        type: 'percent', section: 'Loans', hint: 'Penalty per overdue month (e.g. 0.10 = 10% of principal)', depends: 'overdue_penalty_enabled' },
  // Membership section
  { key: 'entry_fee',               label: 'Entry Fee (TZS)',             type: 'number', section: 'Membership', hint: 'One-time fee for new members' },
];

const SECTIONS = ['Contributions', 'Loans', 'Membership'];

function pct(v) { return v != null ? `${Math.round(v * 100)}%` : '—'; }
function fmt(v)  { return v != null ? `TZS ${Number(v).toLocaleString()}` : '—'; }

function RuleField({ meta, value, onChange, disabled }) {
  const { key, label, type, hint, options } = meta;

  if (type === 'toggle') {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 0', borderBottom:'1px solid var(--border)' }}>
        <div>
          <div style={{ fontWeight:600, fontSize:13 }}>{label}</div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{hint}</div>
        </div>
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor: disabled ? 'not-allowed' : 'pointer' }}>
          <div
            onClick={() => !disabled && onChange(key, !value)}
            style={{
              width:40, height:22, borderRadius:11,
              background: value ? 'var(--accent-teal)' : 'var(--border)',
              position:'relative', transition:'background 0.2s',
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            <div style={{
              width:18, height:18, borderRadius:'50%', background:'white',
              position:'absolute', top:2, left: value ? 20 : 2, transition:'left 0.2s',
            }}/>
          </div>
          <span style={{ fontSize:12, color: value ? 'var(--accent-teal)' : 'var(--text-muted)' }}>
            {value ? 'On' : 'Off'}
          </span>
        </label>
      </div>
    );
  }

  if (type === 'select') {
    return (
      <div style={{ padding:'12px 0', borderBottom:'1px solid var(--border)' }}>
        <div style={{ fontWeight:600, fontSize:13 }}>{label}</div>
        <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2, marginBottom:8 }}>{hint}</div>
        <select
          className="form-input"
          value={value || ''}
          disabled={disabled}
          onChange={e => onChange(key, e.target.value)}
          style={{ maxWidth:200 }}
        >
          {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </div>
    );
  }

  const isPercent = type === 'percent' || type === 'percent_nullable';
  const isNullable = type === 'number_nullable' || type === 'percent_nullable';
  const displayVal = isPercent
    ? (value != null ? Math.round(value * 100) : '')
    : (value != null ? value : '');

  return (
    <div style={{ padding:'12px 0', borderBottom:'1px solid var(--border)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
        <div>
          <div style={{ fontWeight:600, fontSize:13 }}>{label}</div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{hint}</div>
        </div>
        {isNullable && (
          <label style={{ fontSize:11, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
            <input
              type="checkbox"
              checked={value === null || value === ''}
              onChange={e => onChange(key, e.target.checked ? null : (isPercent ? 0.1 : 6))}
              disabled={disabled}
            />
            No limit
          </label>
        )}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <input
          className="form-input"
          type="number"
          step={isPercent ? 1 : 1}
          min={0}
          value={displayVal}
          disabled={disabled || (isNullable && (value === null || value === ''))}
          onChange={e => {
            const raw = e.target.value === '' ? null : Number(e.target.value);
            onChange(key, isPercent && raw !== null ? raw / 100 : raw);
          }}
          style={{ maxWidth:140, opacity: (isNullable && (value === null || value === '')) ? 0.4 : 1 }}
        />
        {isPercent && value !== null && <span style={{ color:'var(--text-muted)', fontSize:13 }}>%</span>}
        {!isPercent && (key === 'contribution_amount' || key === 'late_fine_flat_amount') && <span style={{ color:'var(--text-muted)', fontSize:13 }}>TZS</span>}
        {!isPercent && key === 'entry_fee' && <span style={{ color:'var(--text-muted)', fontSize:13 }}>TZS</span>}
        {!isPercent && key === 'loan_repayment_months' && value !== null && <span style={{ color:'var(--text-muted)', fontSize:13 }}>months</span>}
      </div>
    </div>
  );
}

function FYCard({ fyData, onSaved }) {
  const fy = fyData.fiscal_year;
  const [editing, setEditing]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form,      setForm]      = useState({});
  const [resetting, setResetting] = useState(false);
  const [scanning,  setScanning]  = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [scanResult, setScanResult] = useState(null);

  const startEdit = () => {
    setForm({ ...fyData });
    setEditing(true);
  };

  const handleChange = (key, val) => {
    const next = { ...form, [key]: val };
    // Defaults when switching type
    if (key === 'late_fine_type') {
      if (val === 'flat' && !next.late_fine_flat_amount) next.late_fine_flat_amount = 3500;
      if (val === 'percentage' && !next.late_fine_rate) next.late_fine_rate = 0.15;
    }
    setForm(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await rulesApi.save(fy, form);
      showToast(`FY${fy} rules saved!`);
      setEditing(false);
      onSaved();
    } catch(e) {
      showToast(e.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(`Reset FY${fy} rules back to defaults?`)) return;
    setResetting(true);
    try {
      await rulesApi.reset(fy);
      showToast(`FY${fy} reset to defaults`);
      setEditing(false);
      onSaved();
    } catch(e) {
      showToast(e.response?.data?.error || 'Failed to reset', 'error');
    } finally {
      setResetting(false);
    }
  };

  const handleScanFines = async () => {
    const rules = editing ? form : fyData;
    if (!rules.late_fine_enabled) {
      return showToast(`Enable "Late Fine" for FY${fy} and save first, then scan.`, 'error');
    }
    if (!window.confirm(`Scan all FY${fy} paid contributions for late payments and auto-generate any missing fines?\n\nThis is safe to run multiple times — it will never double-charge.`)) return;
    setScanning(true);
    setScanResult(null);
    try {
      const res = await rulesApi.scanFines(fy);
      setScanResult(res.data);
      showToast(res.data.message);
    } catch(e) {
      showToast(e.response?.data?.error || 'Scan failed', 'error');
    } finally {
      setScanning(false);
    }
  };

  const handleRecalculateFines = async () => {
    if (!window.confirm(`THIS WILL DELETE ALL EXISTING LATE FINES FOR FY${fy} AND RE-GENERATE THEM using current rules.\n\nUse this to fix wrongly calculated fines. Continue?`)) return;
    setRecalculating(true);
    setScanResult(null);
    try {
      const res = await rulesApi.recalculateFines(fy);
      setScanResult(res.data);
      showToast(res.data.message);
    } catch(e) {
      showToast(e.response?.data?.error || 'Recalculation failed', 'error');
    } finally {
      setRecalculating(false);
    }
  };

  const displayData = editing ? form : fyData;

  return (
    <div className="card" style={{ marginBottom:20 }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{
            background:'var(--accent-blue)', color:'white', fontWeight:800,
            fontSize:13, borderRadius:8, padding:'4px 12px', fontFamily:'var(--font-display)',
          }}>
            FY{fy}
          </div>
          <div style={{ fontSize:12, color:'var(--text-muted)' }}>
            Mar {fy} – Feb {fy + 1}
          </div>
          {fyData._fromDB && (
            <span style={{ fontSize:10, background:'var(--accent-teal)20', color:'var(--accent-teal)', borderRadius:4, padding:'2px 6px' }}>
              Custom
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {/* Scan fines — always visible when late fines are enabled */}
          {fyData.late_fine_enabled && !editing && (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleScanFines}
                disabled={scanning || recalculating}
                title="Retroactively scan all paid contributions for this FY and generate missing late fines"
                style={{ borderColor:'var(--accent-amber)', color:'var(--accent-amber)' }}
              >
                {scanning ? 'Scanning…' : '🔍 Scan'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRecalculateFines}
                disabled={scanning || recalculating}
                title="Delete and re-generate all late fines for this FY"
                style={{ borderColor:'var(--accent-red)', color:'var(--accent-red)' }}
              >
                {recalculating ? 'Recalculating…' : '🔄 Recalculate'}
              </button>
            </>
          )}
          {editing ? (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
              {fyData._fromDB && (
                <button className="btn btn-secondary btn-sm" onClick={handleReset} disabled={resetting}
                  style={{ borderColor:'var(--accent-red)', color:'var(--accent-red)' }}>
                  {resetting ? 'Resetting…' : 'Reset to Default'}
                </button>
              )}
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save FY' + fy}
              </button>
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={startEdit}>✏ Edit</button>
          )}
        </div>
      </div>

      {/* Scan result banner */}
      {scanResult && (
        <div style={{
          background: (scanResult.generated > 0 || scanResult.deleted > 0) ? '#f59e0b15' : 'var(--bg-input)',
          border: `1px solid ${(scanResult.generated > 0 || scanResult.deleted > 0) ? 'var(--accent-amber)' : 'var(--border)'}`,
          borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:12,
        }}>
          <div style={{ fontWeight:700, marginBottom:4, color: (scanResult.generated > 0 || scanResult.deleted > 0) ? 'var(--accent-amber)' : 'var(--text-secondary)' }}>
            { (scanResult.generated > 0 || scanResult.deleted > 0) ? '⚠ Update Complete' : '✅ All Clear'}
          </div>
          <div style={{ color:'var(--text-secondary)' }}>{scanResult.message}</div>
          {scanResult.details?.length > 0 && (
            <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:6 }}>
              {scanResult.details.map((d, i) => (
                <span key={i} style={{ background:'var(--bg-card)', borderRadius:4, padding:'2px 8px', fontSize:11, color:'var(--text-primary)' }}>
                  Member #{d.member_id} · {d.month}/{d.year} · TZS {d.fine.toLocaleString()}
                </span>
              ))}
            </div>
          )}
          <button style={{ marginTop:8, fontSize:11, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer', padding:0 }}
            onClick={() => setScanResult(null)}>Dismiss</button>
        </div>
      )}

      {/* Fields grouped by section */}
      {SECTIONS.map(section => (
        <div key={section} style={{ marginBottom: editing ? 20 : 12 }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', color:'var(--text-muted)', letterSpacing:1, marginBottom:4 }}>
            {section}
          </div>
          {editing ? (
            FIELD_META
              .filter(f => f.section === section)
              .filter(f => {
                if (!f.depends) return true;
                const parentVal = displayData[f.depends];
                if (f.dependsValue !== undefined) return parentVal === f.dependsValue;
                return !!parentVal;
              })
              .map(meta => (
                <RuleField
                  key={meta.key}
                  meta={meta}
                  value={displayData[meta.key]}
                  onChange={handleChange}
                  disabled={false}
                />
              ))
          ) : (
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {FIELD_META
                .filter(f => f.section === section)
                .filter(f => {
                  if (!f.depends) return true;
                  const parentVal = displayData[f.depends];
                  if (f.dependsValue !== undefined) return parentVal === f.dependsValue;
                  return !!parentVal;
                })
                .map(meta => {
                  const val = displayData[meta.key];
                  if (meta.type === 'toggle') {
                    return (
                      <div key={meta.key} style={{
                        background:'var(--bg-input)', borderRadius:8, padding:'8px 12px',
                        display:'flex', alignItems:'center', gap:6,
                      }}>
                        <span style={{ width:8, height:8, borderRadius:'50%', background: val ? 'var(--accent-teal)' : 'var(--border)', display:'inline-block' }}/>
                        <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{meta.label}</span>
                        <span style={{ fontSize:12, fontWeight:700, color: val ? 'var(--accent-teal)' : 'var(--text-muted)' }}>{val ? 'On' : 'Off'}</span>
                      </div>
                    );
                  }
                  if (meta.type === 'select') {
                    const label = meta.options.find(o => o.value === val)?.label || val;
                    return (
                      <div key={meta.key} style={{ background:'var(--bg-input)', borderRadius:8, padding:'8px 12px' }}>
                        <div style={{ fontSize:10, color:'var(--text-muted)' }}>{meta.label}</div>
                        <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>{label}</div>
                      </div>
                    );
                  }
                  const display = meta.type.includes('percent')
                    ? (val !== null && val !== undefined ? pct(val) : '—')
                    : (val !== null && val !== undefined ? (meta.key.includes('fee') || meta.key.includes('amount') ? fmt(val) : (val + (meta.key.includes('months') ? ' mo' : ''))) : '—');
                  return (
                    <div key={meta.key} style={{ background:'var(--bg-input)', borderRadius:8, padding:'8px 12px' }}>
                      <div style={{ fontSize:10, color:'var(--text-muted)' }}>{meta.label}</div>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>{display}</div>
                    </div>
                  );
                })
              }
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Settings({ user }) {
  const isAdmin = user?.role === 'admin';
  const [allRules, setAllRules] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showNew,  setShowNew]  = useState(false);
  const [newFY,    setNewFY]    = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await rulesApi.list();
      setAllRules(res.data);
    } catch(e) {
      showToast('Failed to load rules', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAddFY = async () => {
    const fy = parseInt(newFY);
    if (!fy || fy < 2024 || fy > 2050) return showToast('Enter a valid fiscal year (e.g. 2027)', 'error');
    if (allRules.find(r => r.fiscal_year === fy)) return showToast(`FY${fy} already exists`, 'error');
    // Copy from most recent FY as starting point
    const latest = [...allRules].sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
    try {
      await rulesApi.save(fy, { ...latest, fiscal_year: fy });
      showToast(`FY${fy} created — edit the rules as needed`);
      setNewFY('');
      setShowNew(false);
      load();
    } catch(e) {
      showToast(e.response?.data?.error || 'Failed to create', 'error');
    }
  };

  if (!isAdmin) {
    return (
      <div className="page">
        <SectionHeader title="Settings" sub="Admin access required"/>
        <div className="card" style={{ color:'var(--text-muted)', textAlign:'center', padding:40 }}>
          Only admins can view and edit constitution rules.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <SectionHeader
        title="Settings"
        sub="Constitution rules per Fiscal Year — changes take effect immediately"
        action={
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {showNew ? (
              <>
                <input
                  className="form-input"
                  type="number"
                  placeholder="e.g. 2027"
                  value={newFY}
                  onChange={e => setNewFY(e.target.value)}
                  style={{ width:110 }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleAddFY}>Add FY</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowNew(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowNew(true)}>+ New Fiscal Year</button>
            )}
          </div>
        }
      />

      <div style={{ background:'var(--bg-card)', borderLeft:'4px solid var(--accent-indigo)', padding:'10px 14px', borderRadius:'0 8px 8px 0', marginBottom:24, fontSize:12 }}>
        <strong>How this works:</strong> Each Fiscal Year (March–February) has its own set of rules. The backend reads these rules live — no redeployment needed. When a new FY starts, click <strong>+ New Fiscal Year</strong>, and it will pre-fill from the previous year's rules so you only change what's different.
      </div>

      {loading ? <Loading/> : (
        [...allRules]
          .sort((a, b) => b.fiscal_year - a.fiscal_year)
          .map(r => (
            <FYCard key={r.fiscal_year} fyData={r} onSaved={load}/>
          ))
      )}
    </div>
  );
}
