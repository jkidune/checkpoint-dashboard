import { useState, useMemo } from 'react';
import {
  Banknote,
  CheckCircle2,
  AlertTriangle,
  Clock,
  TrendingUp,
  Plus,
  MoreHorizontal,
  Upload,
  Search,
  X,
  Calendar,
  Layers,
  ArrowRight,
  Info,
  ShieldAlert,
  Loader2,
  DollarSign,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { loans, members } from '../api';
import ImportCsvModal from '../components/ImportCsvModal';
import { fmt, fmtShort, showToast, useApi, ProgressBar, ChartTooltip } from '../components/UI';

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'LM';
}

function loanOutstanding(loan = {}) {
  const principal = Number(loan.principal || 0);
  const totalRepaid = Number(loan.total_repaid || 0);
  const balance = loan.balance ?? (principal - totalRepaid);
  return Math.max(0, Number(balance || 0));
}

// ── Loan Detail Slide-over Sheet ───────────────────────────────────────────
function LoanDetailDrawer({ loanId, onClose, onRefresh }) {
  const { data, loading, refetch } = useApi(() => loans.get(loanId), [loanId]);
  const [form, setForm] = useState({
    amount: '',
    repayment_date: new Date().toISOString().split('T')[0],
    mpesa_ref: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleAddRepayment = async (e) => {
    e.preventDefault();
    if (!form.amount || parseInt(form.amount, 10) <= 0) {
      return showToast('Please enter a valid amount', 'error');
    }
    setSaving(true);
    try {
      await loans.addRepayment(loanId, {
        ...form,
        amount: parseInt(form.amount, 10),
      });
      showToast('Repayment recorded successfully!');
      setForm({
        amount: '',
        repayment_date: new Date().toISOString().split('T')[0],
        mpesa_ref: '',
        notes: '',
      });
      refetch();
      if (onRefresh) onRefresh();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to record repayment', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) {
    return (
      <>
        <div className="admin-drawer-overlay" onClick={onClose} />
        <aside className="admin-drawer-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={24} className="animate-spin" color="var(--admin-blue)" />
        </aside>
      </>
    );
  }

  const principal = Number(data.principal || 0);
  const interest = Number(data.interest_amount || 0);
  const penalty = Number(data.penalty || 0);
  const totalOwed = data.total_owed || (principal + penalty);
  const totalRepaid = Number(data.total_repaid || 0);
  const balance = loanOutstanding(data);
  const progressPct = totalOwed > 0 ? Math.min(100, Math.round((totalRepaid / totalOwed) * 100)) : 0;

  return (
    <>
      <div className="admin-drawer-overlay" onClick={onClose} />
      <aside className="admin-drawer-panel">
        <div className="admin-drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="admin-avatar" style={{ width: 40, height: 40, fontSize: 13 }}>
              {initials(data.member_name)}
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--admin-text)' }}>
                {data.member_name}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span className="admin-badge is-info">{data.loan_number || 'Loan'}</span>
                <span className={`admin-badge is-${data.status === 'active' ? 'pending' : data.status === 'paid' ? 'paid' : 'overdue'}`}>
                  {data.status}
                </span>
              </div>
            </div>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="admin-drawer-content">
          {/* 4 Summary Mini Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <div style={{ background: '#fafafa', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--admin-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Principal
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--admin-blue)', marginTop: 2 }}>
                {fmt(principal)}
              </div>
            </div>
            <div style={{ background: '#fafafa', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--admin-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Interest ({((data.interest_rate || 0) * 100).toFixed(0)}%)
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--admin-amber)', marginTop: 2 }}>
                {fmt(interest)}
              </div>
            </div>
            <div style={{ background: '#fafafa', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--admin-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Overdue Penalty
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: penalty > 0 ? 'var(--admin-red)' : 'var(--admin-muted)', marginTop: 2 }}>
                {fmt(penalty)}
              </div>
            </div>
            <div style={{ background: '#fafafa', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--admin-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Outstanding
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: balance > 0 ? 'var(--admin-red)' : 'var(--admin-green)', marginTop: 2 }}>
                {fmt(balance)}
              </div>
            </div>
          </div>

          {/* Repayment Progress */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--admin-muted)', fontWeight: 600 }}>Repayment Progress</span>
              <span style={{ fontWeight: 700, color: 'var(--admin-text)' }}>{progressPct}% ({fmt(totalRepaid)})</span>
            </div>
            <ProgressBar value={totalRepaid} max={totalOwed} color={balance === 0 ? 'var(--admin-green)' : 'var(--admin-blue)'} />
          </div>

          {/* Dates & Term info */}
          <div style={{ background: '#fafafa', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 12, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--admin-border)' }}>
              <span style={{ color: 'var(--admin-muted)' }}>Issued Date</span>
              <strong>{data.issued_date || '—'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6 }}>
              <span style={{ color: 'var(--admin-muted)' }}>Due Date</span>
              <strong style={{ color: penalty > 0 ? 'var(--admin-red)' : 'inherit' }}>{data.due_date || '—'}</strong>
            </div>
          </div>

          {/* Repayment History */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--admin-muted)', marginBottom: 8 }}>
              Repayment History ({data.repayments?.length || 0})
            </div>

            {data.repayments?.length ? (
              <div style={{ border: '1px solid var(--admin-border)', borderRadius: 10, overflow: 'hidden' }}>
                {data.repayments.map((r, idx) => (
                  <div
                    key={r.id || idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 12px',
                      borderBottom: idx < data.repayments.length - 1 ? '1px solid var(--admin-border)' : 'none',
                      background: '#ffffff',
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <strong style={{ color: 'var(--admin-text)' }}>{fmt(r.amount)}</strong>
                      {r.mpesa_ref && <span style={{ color: 'var(--admin-muted)', marginLeft: 8 }}>({r.mpesa_ref})</span>}
                    </div>
                    <span style={{ color: 'var(--admin-muted)' }}>{r.repayment_date}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', background: '#fafafa', border: '1px dashed var(--admin-border)', borderRadius: 10, color: 'var(--admin-muted)', fontSize: 12 }}>
                No repayments recorded yet for this loan.
              </div>
            )}
          </div>

          {/* Record Repayment Form (if active) */}
          {data.status === 'active' && (
            <form onSubmit={handleAddRepayment} style={{ borderTop: '1px solid var(--admin-border)', paddingTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--admin-text)', marginBottom: 12 }}>
                Record Repayment
              </div>
              <div className="admin-form-grid-2">
                <div className="admin-form-group">
                  <label>Amount (TZS)</label>
                  <input
                    type="number"
                    placeholder="e.g. 200000"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    required
                    min="1000"
                    step="1000"
                  />
                </div>
                <div className="admin-form-group">
                  <label>Payment Date</label>
                  <input
                    type="date"
                    value={form.repayment_date}
                    onChange={(e) => setForm({ ...form, repayment_date: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="admin-form-group">
                <label>M-Pesa Reference (Optional)</label>
                <input
                  placeholder="e.g. QAB123XYZ"
                  value={form.mpesa_ref}
                  onChange={(e) => setForm({ ...form, mpesa_ref: e.target.value })}
                />
              </div>
              <button
                type="submit"
                className="admin-btn-primary"
                style={{ width: '100%', marginTop: 6 }}
                disabled={saving}
              >
                {saving ? 'Recording…' : 'Record Repayment'}
              </button>
            </form>
          )}
        </div>
      </aside>
    </>
  );
}

// ── Issue New Loan Modal ───────────────────────────────────────────────────
function IssueLoanModal({ onClose, membersData, onComplete, defaultFy }) {
  const [form, setForm] = useState({
    member_id: '',
    principal: '',
    issued_date: new Date().toISOString().split('T')[0],
    due_date: '',
    fiscal_year: String(defaultFy || 2026),
    notes: '',
  });
  const [overrideLimit, setOverrideLimit] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);

  const selMember = (membersData || []).find((m) => String(m.id) === form.member_id);
  const maxEligible = selMember ? Math.round((selMember.total_contributions || 0) * 0.8) : 0;
  const reqPrincipal = parseInt(form.principal || 0, 10);
  const isFY2026 = parseInt(form.fiscal_year || 2026, 10) >= 2026;
  const isExceeding = selMember && isFY2026 && reqPrincipal > maxEligible;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isExceeding && !overrideLimit) {
      return showToast('Loan exceeds the 80% borrowing limit. Check override to proceed.', 'error');
    }
    if (isExceeding && overrideLimit && !overrideReason.trim()) {
      return showToast('Please state a reason for overriding the loan limit.', 'error');
    }
    setSaving(true);
    try {
      await loans.create({
        ...form,
        principal: parseInt(form.principal, 10),
        fiscal_year: parseInt(form.fiscal_year, 10),
        override_limit: overrideLimit,
        override_reason: overrideReason || undefined,
      });
      showToast(overrideLimit ? 'Loan issued with limit override.' : 'Loan issued successfully!');
      onComplete();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to issue loan', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal-panel">
        <div className="admin-modal-header">
          <div>
            <h3>Issue New Loan</h3>
            <p style={{ color: 'var(--admin-muted)', fontSize: 12, marginTop: 2 }}>
              Create a loan for an active member under FY{form.fiscal_year} rules.
            </p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="admin-form-group">
            <label>Borrower (Member)</label>
            <select
              value={form.member_id}
              onChange={(e) => setForm({ ...form, member_id: e.target.value })}
              required
            >
              <option value="">Select member…</option>
              {(membersData || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.office})
                </option>
              ))}
            </select>
            {selMember && (
              <div style={{ fontSize: 11, color: 'var(--admin-muted)', marginTop: 4 }}>
                Total contributions: <strong>{fmt(selMember.total_contributions || 0)}</strong> · Max 80% limit: <strong style={{ color: 'var(--admin-teal)' }}>{fmt(maxEligible)}</strong>
              </div>
            )}
          </div>

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label>Principal Amount (TZS)</label>
              <input
                type="number"
                placeholder="e.g. 1000000"
                value={form.principal}
                onChange={(e) => setForm({ ...form, principal: e.target.value })}
                required
                min="1000"
                step="1000"
              />
            </div>
            <div className="admin-form-group">
              <label>Fiscal Year</label>
              <select
                value={form.fiscal_year}
                onChange={(e) => setForm({ ...form, fiscal_year: e.target.value })}
                required
              >
                <option value="2026">FY2026 (12% upfront)</option>
                <option value="2025">FY2025 (5%)</option>
                <option value="2024">FY2024</option>
              </select>
            </div>
          </div>

          {isExceeding && (
            <div
              style={{
                background: 'var(--admin-red-soft)',
                border: '1px solid #fecaca',
                borderRadius: 10,
                padding: '12px',
                marginBottom: 14,
                fontSize: 12,
              }}
            >
              <div style={{ color: 'var(--admin-red)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <AlertTriangle size={15} /> Exceeds 80% Borrowing Limit
              </div>
              <p style={{ color: 'var(--admin-text)', marginBottom: 8 }}>
                Requested {fmt(reqPrincipal)} exceeds {selMember?.name}&apos;s eligible limit of {fmt(maxEligible)}.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={overrideLimit}
                  onChange={(e) => setOverrideLimit(e.target.checked)}
                />
                <span>Approve with limit override</span>
              </label>
              {overrideLimit && (
                <div style={{ marginTop: 8 }}>
                  <input
                    className="admin-form-group"
                    placeholder="Reason for limit override (required)"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    style={{ width: '100%', fontSize: 12, padding: '7px 10px' }}
                    required
                  />
                </div>
              )}
            </div>
          )}

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label>Issued Date</label>
              <input
                type="date"
                value={form.issued_date}
                onChange={(e) => setForm({ ...form, issued_date: e.target.value })}
                required
              />
            </div>
            <div className="admin-form-group">
              <label>Due Date (Optional)</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
          </div>

          <div className="admin-form-group">
            <label>Notes (Optional)</label>
            <textarea
              placeholder="e.g. Approved at committee meeting..."
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div className="admin-modal-actions">
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="admin-btn-primary"
              disabled={saving}
            >
              {saving ? 'Issuing…' : 'Issue Loan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Loans Component ───────────────────────────────────────────────────
export default function Loans({ user }) {
  const isAdmin = user?.role === 'admin';
  const [filter, setFilter] = useState('all');
  const [fiscalYear, setFiscalYear] = useState(2026);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLoanId, setSelectedLoanId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const params = { fiscal_year: fiscalYear, ...(filter !== 'all' ? { status: filter } : {}) };
  const { data: loanList, loading, error, refetch } = useApi(() => loans.list(params), [filter, fiscalYear]);
  const { data: membersData } = useApi(() => members.list());

  const list = useMemo(() => {
    const raw = loanList || [];
    if (!searchQuery.trim()) return raw;
    const q = searchQuery.toLowerCase();
    return raw.filter((l) =>
      (l.member_name || '').toLowerCase().includes(q) ||
      (l.loan_number || '').toLowerCase().includes(q)
    );
  }, [loanList, searchQuery]);

  const totalPrincipal = (loanList || []).reduce((s, l) => s + (l.principal || 0), 0);
  const totalRepaid = (loanList || []).reduce((s, l) => s + (l.total_repaid || 0), 0);
  const totalBalance = (loanList || []).reduce((s, l) => s + (l.balance || 0), 0);
  const totalInterest = (loanList || []).reduce((s, l) => s + (l.interest_amount || 0), 0);

  const byMember = useMemo(() => {
    const grouped = (loanList || []).reduce((acc, l) => {
      if (!acc[l.member_id]) acc[l.member_id] = { name: (l.member_name || 'Member').split(' ')[0], total: 0 };
      acc[l.member_id].total += l.principal || 0;
      return acc;
    }, {});
    return Object.values(grouped).sort((a, b) => b.total - a.total);
  }, [loanList]);

  const isFY2026 = fiscalYear >= 2026;

  return (
    <div className="admin-page-container">
      {/* ── Header ── */}
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Loan Register</h1>
          <p>Manage member loans, repayments, balances, and overdue servicing.</p>
        </div>

        <div className="admin-header-actions">
          <select
            className="admin-select"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(parseInt(e.target.value, 10))}
            aria-label="Fiscal Year"
          >
            <option value="2026">FY2026</option>
            <option value="2025">FY2025</option>
            <option value="2024">FY2024</option>
          </select>

          {isAdmin && (
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={() => setShowImportModal(true)}
            >
              <Upload size={14} /> Import CSV
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              className="admin-btn-primary"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={15} /> Issue loan
            </button>
          )}
        </div>
      </header>

      {/* ── Contextual FY Rule Alert ── */}
      {isFY2026 && (
        <div className="admin-rule-notice is-accent">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={16} color="var(--admin-indigo)" />
            <div>
              <strong>FY2026 Constitution Loan Rules:</strong>{' '}
              <span>12% upfront interest · 6-Month repayment term · Maximum loan eligibility capped at 80% of total member contributions · 10% monthly overdue penalty.</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Metrics Summary Rail ── */}
      <section className="admin-stats-grid">
        <div className="admin-stat-card is-primary">
          <div className="admin-stat-top">
            <span>Total Issued</span>
            <Banknote size={16} color="var(--admin-blue)" />
          </div>
          <strong>{fmt(totalPrincipal)}</strong>
          <span className="stat-sub">Across {(loanList || []).length} loans in FY{fiscalYear}</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Total Repaid</span>
            <CheckCircle2 size={16} color="var(--admin-green)" />
          </div>
          <strong style={{ color: 'var(--admin-green)' }}>{fmt(totalRepaid)}</strong>
          <span className="stat-sub">{totalPrincipal > 0 ? `${Math.round((totalRepaid / totalPrincipal) * 100)}% recovered` : '—'}</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Outstanding Balance</span>
            <Clock size={16} color="var(--admin-red)" />
          </div>
          <strong style={{ color: totalBalance > 0 ? 'var(--admin-red)' : 'var(--admin-green)' }}>
            {fmt(totalBalance)}
          </strong>
          <span className="stat-sub">Principal in active circulation</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Interest Earned</span>
            <TrendingUp size={16} color="var(--admin-amber)" />
          </div>
          <strong style={{ color: 'var(--admin-amber)' }}>{fmt(totalInterest)}</strong>
          <span className="stat-sub">Club income generated</span>
        </div>
      </section>

      {/* ── Toolbar: Search & Filters ── */}
      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search borrower or loan #…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 0, color: 'var(--admin-muted)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="admin-filter-tabs">
          {['all', 'active', 'paid', 'overdue'].map((f) => (
            <button
              key={f}
              type="button"
              className={`admin-filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
              style={{ textTransform: 'capitalize' }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* ── Loan Register Table ── */}
      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Borrower</th>
                <th>Loan #</th>
                <th className="is-numeric">Principal</th>
                <th className="is-numeric">Interest</th>
                <th className="is-numeric">Deposited</th>
                <th>Issued</th>
                <th className="is-numeric">Repaid</th>
                <th className="is-numeric">Penalty</th>
                <th className="is-numeric">Balance</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 40, color: 'var(--admin-muted)' }}>
                    <Loader2 size={20} className="animate-spin" style={{ display: 'inline', marginRight: 8 }} />
                    Loading loan records…
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 48, color: 'var(--admin-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <CheckCircle2 size={24} color="var(--admin-faint)" />
                      <strong>No loan records found for the selected criteria.</strong>
                    </div>
                  </td>
                </tr>
              ) : (
                list.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setSelectedLoanId(l.id)}
                    style={{ background: l.penalty > 0 ? 'var(--admin-red-soft)' : undefined }}
                    title="Click to view loan details and repayment history"
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="admin-avatar">{initials(l.member_name)}</div>
                        <strong style={{ color: 'var(--admin-text)' }}>{l.member_name}</strong>
                      </div>
                    </td>
                    <td style={{ color: 'var(--admin-muted)', fontWeight: 600 }}>{l.loan_number}</td>
                    <td className="is-numeric" style={{ color: 'var(--admin-blue)' }}>{fmt(l.principal)}</td>
                    <td className="is-numeric" style={{ color: 'var(--admin-amber)' }}>{fmt(l.interest_amount)}</td>
                    <td className="is-numeric" style={{ color: 'var(--admin-muted)' }}>{fmt(l.amount_deposited)}</td>
                    <td style={{ color: 'var(--admin-muted)', fontSize: 12 }}>{l.issued_date || '—'}</td>
                    <td className="is-numeric" style={{ color: 'var(--admin-green)' }}>{fmt(l.total_repaid)}</td>
                    <td className="is-numeric" style={{ color: l.penalty > 0 ? 'var(--admin-red)' : 'var(--admin-muted)' }}>
                      {fmt(l.penalty || 0)}
                    </td>
                    <td className="is-numeric" style={{ color: l.balance > 0 ? 'var(--admin-red)' : 'var(--admin-green)', fontWeight: 700 }}>
                      {fmt(l.balance > 0 ? l.balance : 0)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`admin-badge is-${l.penalty > 0 && l.status !== 'paid' ? 'overdue' : l.status}`}>
                        {l.penalty > 0 && l.status !== 'paid' ? 'Overdue' : l.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="admin-btn-secondary"
                        style={{ minHeight: 30, padding: '0 10px', fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLoanId(l.id);
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Summary Chart by Member ── */}
      {byMember.length > 0 && (
        <div style={{ background: '#ffffff', border: '1px solid var(--admin-border)', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(24,24,27,0.03)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--admin-text)', marginBottom: 14 }}>
            Loans Volume by Member · FY{fiscalYear}
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={byMember} barSize={20} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} />
              <Tooltip content={<ChartTooltip formatter={(v) => `TZS ${Number(v).toLocaleString()}`} />} />
              <Bar dataKey="total" name="Total Borrowed" fill="var(--admin-blue)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Slide-over Detail Drawer ── */}
      {selectedLoanId && (
        <LoanDetailDrawer
          loanId={selectedLoanId}
          onClose={() => setSelectedLoanId(null)}
          onRefresh={refetch}
        />
      )}

      {/* ── Issue Loan Modal ── */}
      {showAddModal && (
        <IssueLoanModal
          onClose={() => setShowAddModal(false)}
          membersData={membersData}
          onComplete={refetch}
          defaultFy={fiscalYear}
        />
      )}

      {/* ── Import CSV Modal ── */}
      {showImportModal && (
        <ImportCsvModal
          type="loans"
          onClose={() => setShowImportModal(false)}
          onComplete={refetch}
        />
      )}
    </div>
  );
}
