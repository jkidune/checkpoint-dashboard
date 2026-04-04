import { useState, useEffect } from 'react';
import { SectionHeader, Loading, showToast } from '../components/UI';
import { rules as rulesApi } from '../api';

const FIELD_META = [
  // Contributions section
  { key: 'contribution_amount',     label: 'Monthly Contribution (TZS)',  type: 'number', section: 'Contributions', hint: 'Amount each member must pay per month' },
  { key: 'late_fine_enabled',       label: 'Late Fine Enabled',           type: 'toggle', section: 'Contributions', hint: 'Automatically charge a fine for late payments' },
  { key: 'late_fine_rate',          label: 'Late Fine Rate',              type: 'percent', section: 'Contributions', hint: 'Fine per month late (e.g. 0.15 = 15% of contribution amount)', depends: 'late_fine_enabled' },
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
  const { key, label, type, hint } = meta;

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
        {!isPercent && key === 'contribution_amount' && <span style={{ color:'var(--text-muted)', fontSize:13 }}>TZS</span>}
        {!isPercent && key === 'entry_fee' && <span style={{ color:'var(--text-muted)', fontSize:13 }}>TZS</span>}
        {!isPercent && key === 'loan_repayment_months' && value !== null && <span style={{ color:'var(--text-muted)', fontSize:13 }}>months</span>}
      </div>
    </div>
  );
}

function FYCard({ fyData, onSaved }) {
  const fy = fyData.fiscal_year;
  const [editing, setEditing]   = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [form,    setForm]      = useState({});
  const [resetting, setResetting] = useState(false);

  const startEdit = () => {
    setForm({ ...fyData });
    setEditing(true);
  };

  const handleChange = (key, val) => setForm(f => ({ ...f, [key]: val }));

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
        <div style={{ display:'flex', gap:8 }}>
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

      {/* Fields grouped by section */}
      {SECTIONS.map(section => (
        <div key={section} style={{ marginBottom: editing ? 20 : 12 }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', color:'var(--text-muted)', letterSpacing:1, marginBottom:4 }}>
            {section}
          </div>
          {editing ? (
            FIELD_META
              .filter(f => f.section === section)
              .filter(f => !f.depends || displayData[f.depends])
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
