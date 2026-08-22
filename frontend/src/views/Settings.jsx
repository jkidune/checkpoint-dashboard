import { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Shield,
  Save,
  RotateCcw,
  Pencil,
  ScanLine,
  RefreshCw,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Info,
  Layers,
  Banknote,
  Users,
  Wallet,
  Loader2,
  Lock,
} from 'lucide-react';
import { rules as rulesApi, mailer } from '../api';
import { fmt, showToast, useApi } from '../components/UI';

const FIELD_META = [
  // Contributions section
  {
    key: 'contribution_amount',
    label: 'Monthly Contribution Target (TZS)',
    type: 'number',
    section: 'Contributions',
    hint: 'Mandatory amount each active member must contribute each fiscal month.',
  },
  {
    key: 'late_fine_enabled',
    label: 'Late Penalty Automation',
    type: 'toggle',
    section: 'Contributions',
    hint: 'Automatically generate fine records for contributions received after the 5th.',
  },
  {
    key: 'late_fine_type',
    label: 'Late Penalty Calculation Mode',
    type: 'select',
    section: 'Contributions',
    hint: 'Compound percentage rate or flat TZS penalty.',
    depends: 'late_fine_enabled',
    options: [
      { label: 'Percentage Rate (Compound)', value: 'percentage' },
      { label: 'Flat Amount per Month', value: 'flat' },
    ],
  },
  {
    key: 'late_fine_rate',
    label: 'Late Fine Percentage Rate',
    type: 'percent',
    section: 'Contributions',
    hint: 'Penalty per month late (e.g. 0.15 = 15% compound).',
    depends: 'late_fine_type',
    dependsValue: 'percentage',
  },
  {
    key: 'late_fine_flat_amount',
    label: 'Flat Fine Amount (TZS)',
    type: 'number',
    section: 'Contributions',
    hint: 'Fixed fee charged once per late month (e.g. TZS 3,500).',
    depends: 'late_fine_type',
    dependsValue: 'flat',
  },

  // Loans section
  {
    key: 'loan_interest_rate',
    label: 'Loan Interest Rate',
    type: 'percent',
    section: 'Loans',
    hint: 'Upfront / flat interest rate deducted on loan principal (e.g. 0.12 = 12%).',
  },
  {
    key: 'loan_max_ratio',
    label: 'Max Loan / Contribution Ratio',
    type: 'percent_nullable',
    section: 'Loans',
    hint: 'Borrowing cap as % of member total contributions (e.g. 0.80 = 80%). Leave empty for no cap.',
  },
  {
    key: 'loan_repayment_months',
    label: 'Repayment Term (Months)',
    type: 'number_nullable',
    section: 'Loans',
    hint: 'Maximum repayment duration in months (e.g. 6 months). Leave empty for indefinite.',
  },
  {
    key: 'overdue_penalty_enabled',
    label: 'Overdue Loan Penalty Enabled',
    type: 'toggle',
    section: 'Loans',
    hint: 'Charge recurring penalty for active loans past their due date.',
  },
  {
    key: 'overdue_penalty_rate',
    label: 'Overdue Loan Penalty Rate',
    type: 'percent',
    section: 'Loans',
    hint: 'Penalty rate per month overdue (e.g. 0.10 = 10% of principal).',
    depends: 'overdue_penalty_enabled',
  },

  // Membership section
  {
    key: 'entry_fee',
    label: 'New Member Entry Fee (TZS)',
    type: 'number',
    section: 'Membership',
    hint: 'One-time onboarding fee recorded into club equity upon member registration.',
  },
];

const SECTIONS = [
  { id: 'Contributions', label: 'Contribution Rules', icon: Wallet },
  { id: 'Loans', label: 'Loan Policy & Terms', icon: Banknote },
  { id: 'Membership', label: 'Membership & Governance', icon: Users },
];

function RuleFieldControl({ meta, value, onChange, disabled }) {
  const { key, label, type, hint, options } = meta;

  if (type === 'toggle') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 0',
          borderBottom: '1px solid var(--admin-border)',
        }}
      >
        <div>
          <strong style={{ fontSize: 13, color: 'var(--admin-text)' }}>{label}</strong>
          <div style={{ fontSize: 12, color: 'var(--admin-muted)', marginTop: 2 }}>{hint}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(key, !value)}
            style={{
              width: 42,
              height: 24,
              borderRadius: 999,
              background: value ? 'var(--admin-teal)' : '#e4e4e7',
              border: 0,
              padding: 2,
              cursor: disabled ? 'not-allowed' : 'pointer',
              position: 'relative',
              transition: 'background 0.2s',
              opacity: disabled ? 0.7 : 1,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#ffffff',
                transform: value ? 'translateX(18px)' : 'translateX(0)',
                transition: 'transform 0.2s',
                boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
              }}
            />
          </button>
          <span style={{ fontSize: 12, fontWeight: 700, color: value ? 'var(--admin-teal)' : 'var(--admin-muted)', minWidth: 26 }}>
            {value ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>
    );
  }

  if (type === 'select') {
    return (
      <div style={{ padding: '14px 0', borderBottom: '1px solid var(--admin-border)' }}>
        <strong style={{ fontSize: 13, color: 'var(--admin-text)' }}>{label}</strong>
        <div style={{ fontSize: 12, color: 'var(--admin-muted)', marginTop: 2, marginBottom: 8 }}>{hint}</div>
        <select
          value={value || ''}
          disabled={disabled}
          onChange={(e) => onChange(key, e.target.value)}
          className="admin-select"
          style={{ maxWidth: 280 }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const isPercent = type === 'percent' || type === 'percent_nullable';
  const isNullable = type === 'number_nullable' || type === 'percent_nullable';
  const displayVal = isPercent
    ? value != null
      ? Math.round(value * 100)
      : ''
    : value != null
    ? value
    : '';

  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid var(--admin-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <strong style={{ fontSize: 13, color: 'var(--admin-text)' }}>{label}</strong>
          <div style={{ fontSize: 12, color: 'var(--admin-muted)', marginTop: 2 }}>{hint}</div>
        </div>
        {isNullable && (
          <label style={{ fontSize: 11, color: 'var(--admin-muted)', display: 'flex', alignItems: 'center', gap: 6, cursor: disabled ? 'not-allowed' : 'pointer' }}>
            <input
              type="checkbox"
              checked={value === null || value === ''}
              onChange={(e) => onChange(key, e.target.checked ? null : isPercent ? 0.8 : 6)}
              disabled={disabled}
            />
            <span>No limit / Uncapped</span>
          </label>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 260 }}>
        <input
          type="number"
          step={isPercent ? '1' : '1000'}
          value={displayVal}
          disabled={disabled || (isNullable && (value === null || value === ''))}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(key, isNullable ? null : 0);
            const num = parseFloat(raw);
            onChange(key, isPercent ? num / 100 : num);
          }}
          style={{
            border: '1px solid var(--admin-border)',
            background: disabled ? '#fafafa' : '#ffffff',
            color: 'var(--admin-text)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 600,
            width: '100%',
            outline: 'none',
          }}
        />
        {isPercent && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--admin-muted)' }}>%</span>}
        {!isPercent && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--admin-muted)' }}>TZS</span>}
      </div>
    </div>
  );
}

// ── Main Settings Component ────────────────────────────────────────────────
export default function Settings({ user }) {
  const isAdmin = user?.role === 'admin';
  const [selectedFy, setSelectedFy] = useState(2026);
  const [editing, setEditing] = useState(false);
  const [formState, setFormState] = useState({});
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [broadcastingCreds, setBroadcastingCreds] = useState(false);

  const { data: rawRules, loading, error, refetch } = useApi(() => rulesApi.get(selectedFy), [selectedFy]);

  useEffect(() => {
    if (rawRules) {
      setFormState(rawRules);
      setEditing(false);
    }
  }, [rawRules]);

  const handleFieldChange = (key, val) => {
    setFormState((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await rulesApi.save(selectedFy, formState);
      showToast(`FY${selectedFy} rules updated successfully!`);
      setEditing(false);
      refetch();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(`Reset all FY${selectedFy} constitution rules back to system defaults?`)) return;
    setSaving(true);
    try {
      await rulesApi.reset(selectedFy);
      showToast(`FY${selectedFy} rules reset to defaults.`);
      setEditing(false);
      refetch();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to reset rules', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleScanFines = async () => {
    setScanning(true);
    try {
      const res = await rulesApi.scanFines(selectedFy);
      showToast(res.data?.message || 'Fine scan completed!');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to scan fines', 'error');
    } finally {
      setScanning(false);
    }
  };

  const handleRecalculateFines = async () => {
    if (!window.confirm(`Recalculate fines for FY${selectedFy}? This will align all unpaid fine amounts with current rules.`)) return;
    setRecalculating(true);
    try {
      const res = await rulesApi.recalculateFines(selectedFy);
      showToast(res.data?.message || 'Fines recalculated successfully!');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to recalculate fines', 'error');
    } finally {
      setRecalculating(false);
    }
  };

  const handleBroadcastCredentials = async () => {
    if (!window.confirm('Dispatch login credential notifications to all active members?')) return;
    setBroadcastingCreds(true);
    try {
      const res = await mailer.broadcastCredentials();
      showToast(res.data?.message || 'Credentials dispatched!');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to broadcast credentials', 'error');
    } finally {
      setBroadcastingCreds(false);
    }
  };

  return (
    <div className="admin-page-container">
      {/* ── Header ── */}
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Constitution & Settings</h1>
          <p>Configure fiscal-year policies, penalty algorithms, and loan boundaries.</p>
        </div>

        <div className="admin-header-actions">
          <select
            className="admin-select"
            value={selectedFy}
            onChange={(e) => setSelectedFy(parseInt(e.target.value, 10))}
            aria-label="Fiscal Year"
          >
            <option value="2026">FY2026 Rules</option>
            <option value="2025">FY2025 Rules</option>
            <option value="2024">FY2024 Rules</option>
          </select>

          {isAdmin && !editing && (
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={() => setEditing(true)}
            >
              <Pencil size={14} /> Edit rules
            </button>
          )}

          {isAdmin && editing && (
            <>
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={() => {
                  setFormState(rawRules || {});
                  setEditing(false);
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : <><Save size={14} /> Save Changes</>}
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Rule Metadata Summary ── */}
      <section className="admin-stats-grid">
        <div className="admin-stat-card is-primary">
          <div className="admin-stat-top">
            <span>Fiscal Year In Effect</span>
            <Shield size={16} color="var(--admin-blue)" />
          </div>
          <strong>FY{selectedFy}</strong>
          <span className="stat-sub">March {selectedFy} – February {selectedFy + 1}</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Contribution Target</span>
            <Wallet size={16} color="var(--admin-teal)" />
          </div>
          <strong style={{ color: 'var(--admin-teal)' }}>
            {fmt(formState?.contribution_amount || 75000)}
          </strong>
          <span className="stat-sub">per active member / month</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Loan Interest Terms</span>
            <Banknote size={16} color="var(--admin-amber)" />
          </div>
          <strong style={{ color: 'var(--admin-amber)' }}>
            {Math.round((formState?.loan_interest_rate || 0.12) * 100)}% Upfront
          </strong>
          <span className="stat-sub">{formState?.loan_repayment_months || 6} months term</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Penalty Engine</span>
            <AlertTriangle size={16} color="var(--admin-red)" />
          </div>
          <strong style={{ color: formState?.late_fine_enabled ? 'var(--admin-red)' : 'var(--admin-muted)' }}>
            {formState?.late_fine_enabled ? (formState?.late_fine_type === 'percentage' ? `${Math.round((formState?.late_fine_rate || 0.15) * 100)}% Rate` : fmt(formState?.late_fine_flat_amount)) : 'Disabled'}
          </strong>
          <span className="stat-sub">Late contribution handling</span>
        </div>
      </section>

      {/* ── Rules Configuration Sections ── */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-muted)' }}>
          <Loader2 size={24} className="animate-spin" style={{ display: 'inline', marginRight: 8 }} />
          Loading FY{selectedFy} constitution settings…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const fields = FIELD_META.filter((f) => f.section === sec.id);

            return (
              <div
                key={sec.id}
                style={{
                  background: '#ffffff',
                  border: '1px solid var(--admin-border)',
                  borderRadius: 16,
                  padding: 22,
                  boxShadow: '0 1px 2px rgba(24,24,27,0.03)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: 'var(--admin-blue-soft)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--admin-blue)',
                    }}
                  >
                    <Icon size={16} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--admin-text)' }}>
                      {sec.label}
                    </h3>
                  </div>
                </div>

                <div>
                  {fields.map((meta) => {
                    // Check dependency conditions
                    if (meta.depends) {
                      const depVal = formState[meta.depends];
                      if (meta.dependsValue && depVal !== meta.dependsValue) return null;
                      if (!meta.dependsValue && !depVal) return null;
                    }

                    return (
                      <RuleFieldControl
                        key={meta.key}
                        meta={meta}
                        value={formState[meta.key]}
                        disabled={!editing}
                        onChange={handleFieldChange}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Maintenance & Operational Tasks ── */}
      {isAdmin && (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid var(--admin-border)',
            borderRadius: 16,
            padding: 22,
            boxShadow: '0 1px 2px rgba(24,24,27,0.03)',
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--admin-text)', marginBottom: 4 }}>
            Maintenance & Auditing Tools
          </h3>
          <p style={{ fontSize: 12, color: 'var(--admin-muted)', marginBottom: 16 }}>
            Run system-wide scans, recalculate historical penalty amounts, or manage member credentials.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={handleScanFines}
              disabled={scanning}
            >
              <ScanLine size={14} /> {scanning ? 'Scanning…' : `Scan FY${selectedFy} Overdue Fines`}
            </button>

            <button
              type="button"
              className="admin-btn-secondary"
              onClick={handleRecalculateFines}
              disabled={recalculating}
            >
              <RefreshCw size={14} /> {recalculating ? 'Recalculating…' : `Recalculate FY${selectedFy} Fines`}
            </button>

            <button
              type="button"
              className="admin-btn-secondary"
              onClick={handleBroadcastCredentials}
              disabled={broadcastingCreds}
            >
              <Mail size={14} /> {broadcastingCreds ? 'Sending…' : 'Broadcast Member Credentials'}
            </button>

            <button
              type="button"
              className="admin-btn-secondary"
              style={{ color: 'var(--admin-red)' }}
              onClick={handleReset}
              disabled={saving}
            >
              <RotateCcw size={14} /> Reset FY{selectedFy} to Defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
