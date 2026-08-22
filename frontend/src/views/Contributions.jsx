import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Wallet,
  Users,
  Target,
  TrendingUp,
  Plus,
  Layers,
  MoreHorizontal,
  Download,
  Upload,
  Bell,
  Search,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  ArrowRight,
  ShieldAlert,
  Loader2,
  Calendar,
  Pencil,
  Save,
} from 'lucide-react';
import { contributions, members, mailer } from '../api';
import { exportContributionsCSV } from '../utils/exporter';
import ImportCsvModal from '../components/ImportCsvModal';
import { fmt, fmtShort, showToast, useApi } from '../components/UI';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Checkpoint FY: March of year Y → February of year Y+1
// Display columns in fiscal order: Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec, Jan, Feb
const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

// Which calendar year does a given FY month live in?
function fyMonthYear(mo, fy) {
  return mo >= 3 ? fy : fy + 1;
}

// Derive fiscal year from a calendar month + year
function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

const TARGET_FY2024 = 50000;
const TARGET_FY2025_PLUS = 75000;

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'CM';
}

function ContribCell({ data, fy, onClick }) {
  if (!data || !data.amount) {
    return (
      <div
        className="contrib-cell-pill is-empty"
        onClick={onClick}
        title="No payment recorded"
      >
        —
      </div>
    );
  }

  const target = fy <= 2024 ? TARGET_FY2024 : TARGET_FY2025_PLUS;
  const isPaid = data.amount >= target;
  const isPartial = data.amount > 0 && data.amount < target;

  return (
    <div
      className={`contrib-cell-pill ${isPaid ? 'is-paid' : isPartial ? 'is-partial' : 'is-empty'}`}
      onClick={onClick}
      title={`${fmt(data.amount)} (${isPaid ? 'Paid in full' : 'Partial payment'})`}
    >
      {(data.amount / 1000).toFixed(0)}K
    </div>
  );
}

function ContributionsSkeleton() {
  return (
    <div className="admin-contributions-page">
      <div className="contrib-page-header">
        <div style={{ display: 'grid', gap: 8, width: '40%' }}>
          <div className="contrib-skeleton-row" style={{ height: 14, width: 120 }} />
          <div className="contrib-skeleton-row" style={{ height: 26, width: 220 }} />
          <div className="contrib-skeleton-row" style={{ height: 12, width: 280 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="contrib-skeleton-row" style={{ height: 38, width: 90, borderRadius: 10 }} />
          <div className="contrib-skeleton-row" style={{ height: 38, width: 120, borderRadius: 10 }} />
          <div className="contrib-skeleton-row" style={{ height: 38, width: 140, borderRadius: 10 }} />
        </div>
      </div>
      <div className="contrib-stats-grid">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="contrib-skeleton-card" />
        ))}
      </div>
      <div className="contrib-table-card" style={{ padding: 20 }}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="contrib-skeleton-row" />
        ))}
      </div>
    </div>
  );
}

// ── Bulk / Lump-Sum Payment Modal ──────────────────────────────────────────
function BulkPaymentModal({ onClose, membersData, onComplete, defaultMemberId }) {
  const [form, setForm] = useState({
    member_id: defaultMemberId ? String(defaultMemberId) : '',
    total_amount: '',
    paid_date: new Date().toISOString().split('T')[0],
    mpesa_ref: '',
    notes: '',
  });
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (form.member_id && form.total_amount && parseInt(form.total_amount, 10) >= 1000) {
      setLoadingPreview(true);
      contributions
        .bulkPaymentPreview(form)
        .then((res) => setPreview(res.data))
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
        member_id: parseInt(form.member_id, 10),
        total_amount: parseInt(form.total_amount, 10),
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
    <div className="contrib-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="contrib-modal-panel is-wide">
        <div className="contrib-modal-header">
          <div>
            <h3>Bulk / Lump-Sum Payment</h3>
            <p style={{ color: 'var(--contrib-muted)', fontSize: 12, marginTop: 2 }}>
              Allocate a lump sum automatically across unpaid months, fines, and loans.
            </p>
          </div>
          <button type="button" className="contrib-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="contrib-form-group">
            <label>Select Member</label>
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
          </div>

          <div className="contrib-form-grid-2">
            <div className="contrib-form-group">
              <label>Total Payment Amount (TZS)</label>
              <input
                type="number"
                placeholder="e.g. 225000"
                value={form.total_amount}
                onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
                required
                min="1000"
                step="1000"
              />
            </div>
            <div className="contrib-form-group">
              <label>Payment Date</label>
              <input
                type="date"
                value={form.paid_date}
                onChange={(e) => setForm({ ...form, paid_date: e.target.value })}
                required
              />
            </div>
          </div>

          {loadingPreview && (
            <div style={{ textAlign: 'center', padding: '16px', color: 'var(--contrib-muted)', fontSize: 12 }}>
              <Loader2 size={16} className="animate-spin" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
              Calculating allocation breakdown…
            </div>
          )}

          {preview && (
            <div className="contrib-alloc-preview">
              <div className="contrib-alloc-title">Allocation Breakdown Preview</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {preview.contributions && preview.contributions.length > 0 && (
                  <div>
                    <div className="contrib-alloc-row">
                      <span style={{ color: 'var(--contrib-muted)' }}>
                        Monthly Contributions ({preview.contributions.length} months)
                      </span>
                      <strong style={{ color: 'var(--contrib-teal)' }}>
                        {fmt(preview.summary.contribution_total)}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, marginBottom: 6 }}>
                      {preview.contributions.map((c, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            background: '#ffffff',
                            padding: '2px 7px',
                            borderRadius: 4,
                            border: '1px solid var(--contrib-border)',
                            color: 'var(--contrib-text)',
                          }}
                        >
                          {MONTHS[c.month]} {c.year}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {preview.summary?.fines_paid_total > 0 && (
                  <div className="contrib-alloc-row">
                    <span style={{ color: 'var(--contrib-muted)' }}>Fines Repayment</span>
                    <strong style={{ color: 'var(--contrib-amber)' }}>
                      {fmt(preview.summary.fines_paid_total)}
                    </strong>
                  </div>
                )}

                {preview.loan_repayment && (
                  <div className="contrib-alloc-row">
                    <span style={{ color: 'var(--contrib-muted)' }}>Loan Repayment</span>
                    <strong style={{ color: 'var(--contrib-blue)' }}>
                      {fmt(preview.loan_repayment.amount)}
                    </strong>
                  </div>
                )}

                {preview.partial_contribution && (
                  <div className="contrib-alloc-row">
                    <span style={{ color: 'var(--contrib-muted)' }}>
                      Partial Contribution ({MONTHS[preview.partial_contribution.month]} {preview.partial_contribution.year})
                    </span>
                    <strong style={{ color: 'var(--contrib-teal)' }}>
                      {fmt(preview.partial_contribution.amount)}
                    </strong>
                  </div>
                )}

                {preview.unallocated_remainder > 0 && (
                  <div className="contrib-alloc-row">
                    <span style={{ color: 'var(--contrib-muted)' }}>Unallocated Remainder</span>
                    <strong style={{ color: 'var(--contrib-text)' }}>
                      {fmt(preview.unallocated_remainder)}
                    </strong>
                  </div>
                )}

                <div className="contrib-alloc-row is-total">
                  <span>TOTAL ALLOCATED</span>
                  <span>{fmt(parseInt(form.total_amount, 10))}</span>
                </div>
              </div>

              {preview.summary?.fines_total > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 11,
                    color: 'var(--contrib-red)',
                    background: 'var(--contrib-red-soft)',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #fecaca',
                  }}
                >
                  ⚠ Late penalties of <strong>{fmt(preview.summary.fines_total)}</strong> generated from these months.
                </div>
              )}
            </div>
          )}

          <div className="contrib-form-grid-2">
            <div className="contrib-form-group">
              <label>M-Pesa Reference (Optional)</label>
              <input
                placeholder="e.g. QAB123XYZ"
                value={form.mpesa_ref}
                onChange={(e) => setForm({ ...form, mpesa_ref: e.target.value })}
              />
            </div>
            <div className="contrib-form-group">
              <label>Notes (Optional)</label>
              <input
                placeholder="e.g. Advance payment"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="contrib-modal-actions">
            <button
              type="button"
              className="contrib-btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="contrib-btn-primary"
              disabled={saving || !preview}
            >
              {saving ? 'Processing…' : 'Confirm Bulk Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Record Contribution Modal ──────────────────────────────────────────────
function RecordContributionModal({ onClose, membersData, onComplete, defaultMemberId, fy }) {
  const [form, setForm] = useState({
    member_id: defaultMemberId ? String(defaultMemberId) : '',
    amount: String(fy <= 2024 ? TARGET_FY2024 : TARGET_FY2025_PLUS),
    month: '3',
    year: String(fy),
    status: 'paid',
    paid_date: new Date().toISOString().split('T')[0],
    mpesa_ref: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [fineInfo, setFineInfo] = useState(null);

  // Auto fine preview call
  useEffect(() => {
    if (form.amount && form.month && form.year && form.paid_date && form.status === 'paid') {
      contributions
        .finePreview(form)
        .then((res) => setFineInfo(res.data?.penalty > 0 ? res.data : null))
        .catch(() => setFineInfo(null));
    } else {
      setFineInfo(null);
    }
  }, [form.amount, form.month, form.year, form.paid_date, form.status]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await contributions.create({
        ...form,
        member_id: parseInt(form.member_id, 10),
        amount: parseInt(form.amount, 10),
        month: parseInt(form.month, 10),
        year: parseInt(form.year, 10),
      });
      showToast('Contribution recorded successfully!');
      onComplete();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save contribution', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMonthChange = (e) => {
    const mo = parseInt(e.target.value, 10);
    // Jan (1) and Feb (2) in Checkpoint FY belong to calendar year FY + 1
    const autoYear = mo && mo <= 2 ? String(fy + 1) : String(fy);
    setForm({ ...form, month: e.target.value, year: autoYear });
  };

  return (
    <div className="contrib-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="contrib-modal-panel">
        <div className="contrib-modal-header">
          <div>
            <h3>Record Contribution</h3>
            <p style={{ color: 'var(--contrib-muted)', fontSize: 12, marginTop: 2 }}>
              Add a single monthly contribution entry for a member.
            </p>
          </div>
          <button type="button" className="contrib-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="contrib-form-group">
            <label>Member</label>
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
          </div>

          <div className="contrib-form-grid-2">
            <div className="contrib-form-group">
              <label>Month</label>
              <select value={form.month} onChange={handleMonthChange} required>
                <option value="">Select month…</option>
                {FY_MONTHS.map((mo) => (
                  <option key={mo} value={mo}>
                    {MONTHS[mo]} {mo <= 2 ? `(${fy + 1})` : `(${fy})`}
                  </option>
                ))}
              </select>
            </div>
            <div className="contrib-form-group">
              <label>Calendar Year</label>
              <select
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                required
              >
                <option value={String(fy)}>{fy}</option>
                <option value={String(fy + 1)}>{fy + 1}</option>
                <option value={String(fy - 1)}>{fy - 1}</option>
              </select>
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--contrib-muted)', marginTop: -6, marginBottom: 14 }}>
            Fiscal Year = <strong>FY{form.month ? getFiscalYear(parseInt(form.month, 10), parseInt(form.year, 10)) : '—'}</strong>
            {form.month && parseInt(form.month, 10) <= 2 ? ' · Jan & Feb belong to previous FY sequence' : ''}
          </div>

          <div className="contrib-form-grid-2">
            <div className="contrib-form-group">
              <label>Amount (TZS)</label>
              <input
                type="number"
                placeholder="75000"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                min="0"
                step="1000"
              />
            </div>
            <div className="contrib-form-group">
              <label>Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </div>
          </div>

          <div className="contrib-form-group">
            <label>Payment Date</label>
            <input
              type="date"
              value={form.paid_date}
              onChange={(e) => setForm({ ...form, paid_date: e.target.value })}
            />
          </div>

          {fineInfo && (
            <div
              style={{
                background: 'var(--contrib-red-soft)',
                border: '1px solid #fecaca',
                borderRadius: 8,
                padding: '10px 12px',
                color: 'var(--contrib-red)',
                fontSize: 12,
                marginBottom: 16,
              }}
            >
              ⚠ <strong>Late Penalty Notice:</strong> {fineInfo.reason} (Fine: {fmt(fineInfo.penalty)})
            </div>
          )}

          <div className="contrib-form-group">
            <label>M-Pesa Reference</label>
            <input
              placeholder="e.g. QAB123XYZ"
              value={form.mpesa_ref}
              onChange={(e) => setForm({ ...form, mpesa_ref: e.target.value })}
            />
          </div>

          <div className="contrib-form-group">
            <label>Notes (Optional)</label>
            <input
              placeholder="Optional notes…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div className="contrib-modal-actions">
            <button
              type="button"
              className="contrib-btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="contrib-btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Reminder Broadcast Confirmation Modal ──────────────────────────────────
function ReminderModal({ onClose, onConfirm, broadcasting }) {
  const now = new Date();
  const prevMonthIndex = now.getMonth(); // 0-based
  const reminderMonth = prevMonthIndex === 0 ? 12 : prevMonthIndex;
  const reminderYear = prevMonthIndex === 0 ? now.getFullYear() - 1 : now.getFullYear();

  return (
    <div className="contrib-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="contrib-modal-panel">
        <div className="contrib-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                background: 'var(--contrib-amber-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--contrib-amber)',
              }}
            >
              <Bell size={18} />
            </div>
            <div>
              <h3>Send Contribution Reminders</h3>
              <p style={{ color: 'var(--contrib-muted)', fontSize: 12 }}>
                High-impact communication to club members
              </p>
            </div>
          </div>
          <button type="button" className="contrib-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--contrib-text)', marginBottom: 16 }}>
          This action will dispatch email payment reminders to all active members who have not yet paid their contribution for{' '}
          <strong>
            {MONTHS[reminderMonth]} {reminderYear}
          </strong>
          .
        </div>

        <div
          style={{
            background: '#fafafa',
            border: '1px solid var(--contrib-border)',
            borderRadius: 10,
            padding: '12px 14px',
            fontSize: 12,
            color: 'var(--contrib-muted)',
            marginBottom: 20,
          }}
        >
          <strong style={{ color: 'var(--contrib-text)' }}>Recipient Scope:</strong> Active members with status <em>unpaid</em> or <em>missing</em> for {MONTHS[reminderMonth]} {reminderYear}.
        </div>

        <div className="contrib-modal-actions">
          <button
            type="button"
            className="contrib-btn-secondary"
            onClick={onClose}
            disabled={broadcasting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="contrib-btn-primary"
            style={{ background: 'var(--contrib-amber)', borderColor: 'var(--contrib-amber)' }}
            onClick={onConfirm}
            disabled={broadcasting}
          >
            {broadcasting ? 'Dispatching…' : 'Send Reminders'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Member Detail Slide-over Sheet ─────────────────────────────────────────
function MemberDetailDrawer({ memberRow, fy, onClose, onRecordPayment, onBulkPayment }) {
  const [editingCell, setEditingCell] = useState(null); // { mo, cellData }
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  const openEdit = (mo, cell) => {
    setEditingCell(mo);
    setEditForm({
      amount: cell?.amount ?? '',
      paid_date: cell?.paid_date || new Date().toISOString().split('T')[0],
      mpesa_ref: cell?.mpesa_ref || '',
      status: cell?.status || 'paid',
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    const cell = memberRow.months[editingCell];
    if (!cell?.id) return showToast('No contribution record to edit', 'error');
    setEditSaving(true);
    try {
      await contributions.update(cell.id, {
        amount: parseInt(editForm.amount, 10),
        paid_date: editForm.paid_date,
        mpesa_ref: editForm.mpesa_ref || null,
        status: editForm.status,
      });
      showToast('Contribution updated ✓');
      setEditingCell(null);
      // Trigger parent refetch by closing and re-opening if needed
      // For now we signal via a passed-in callback if available
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update contribution', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  if (!memberRow) return null;

  const target = fy <= 2024 ? TARGET_FY2024 : TARGET_FY2025_PLUS;
  const targetTotal = target * 12;
  const totalPaid = memberRow.total || 0;
  const compliance = targetTotal > 0 ? Math.min(100, Math.round((totalPaid / targetTotal) * 100)) : 0;

  const paidMonthsCount = FY_MONTHS.filter((mo) => {
    const cell = memberRow.months[mo];
    return cell && cell.amount >= target;
  }).length;

  const partialMonthsCount = FY_MONTHS.filter((mo) => {
    const cell = memberRow.months[mo];
    return cell && cell.amount > 0 && cell.amount < target;
  }).length;

  const missingMonthsCount = 12 - paidMonthsCount - partialMonthsCount;

  return (
    <>
      <div className="contrib-drawer-overlay" onClick={onClose} />
      <aside className="contrib-drawer-panel">
        <div className="contrib-drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="contrib-member-avatar" style={{ width: 42, height: 42, fontSize: 14 }}>
              {initials(memberRow.member_name)}
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--contrib-text)' }}>
                {memberRow.member_name}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <span className={`contrib-role-badge badge-${memberRow.office}`}>
                  {memberRow.office}
                </span>
                <span style={{ color: 'var(--contrib-muted)', fontSize: 12 }}>
                  Member #{memberRow.member_id}
                </span>
              </div>
            </div>
          </div>
          <button type="button" className="contrib-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="contrib-drawer-content">
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div
              style={{
                background: '#fafafa',
                border: '1px solid var(--contrib-border)',
                borderRadius: 12,
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--contrib-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Total Contributed
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--contrib-blue)', marginTop: 4 }}>
                {fmt(totalPaid)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--contrib-muted)', marginTop: 2 }}>
                Target: {fmt(targetTotal)}
              </div>
            </div>

            <div
              style={{
                background: '#fafafa',
                border: '1px solid var(--contrib-border)',
                borderRadius: 12,
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--contrib-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                FY Compliance
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: compliance >= 90 ? 'var(--contrib-green)' : compliance >= 50 ? 'var(--contrib-amber)' : 'var(--contrib-red)',
                  marginTop: 4,
                }}
              >
                {compliance}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--contrib-muted)', marginTop: 2 }}>
                {paidMonthsCount} of 12 months full
              </div>
            </div>
          </div>

          {/* Month by month break down */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--contrib-muted)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              FY{fy} Monthly Schedule (Mar – Feb)
            </div>

            <div
              style={{
                border: '1px solid var(--contrib-border)',
                borderRadius: 12,
                overflow: 'hidden',
                background: '#ffffff',
              }}
            >
              {FY_MONTHS.map((mo, idx) => {
                const yr = fyMonthYear(mo, fy);
                const cell = memberRow.months[mo];
                const isPaid = cell && cell.amount >= target;
                const isPartial = cell && cell.amount > 0 && cell.amount < target;
                const isEditing = editingCell === mo;

                return (
                  <div
                    key={mo}
                    style={{
                      borderBottom: idx < 11 ? '1px solid var(--contrib-border)' : 'none',
                      background: mo <= 2 ? '#fafafa' : '#ffffff',
                    }}
                  >
                    {/* Month Row */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Calendar size={14} color="var(--contrib-muted)" />
                        <div>
                          <strong style={{ fontSize: 13, color: 'var(--contrib-text)' }}>
                            {MONTHS[mo]} {yr}
                          </strong>
                          {mo <= 2 && (
                            <span style={{ fontSize: 10, color: 'var(--contrib-blue)', marginLeft: 6, fontWeight: 600 }}>
                              (FY{fy})
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {cell && cell.amount > 0 ? (
                          <div style={{ textAlign: 'right' }}>
                            <span
                              className={`contrib-cell-pill ${isPaid ? 'is-paid' : isPartial ? 'is-partial' : 'is-empty'}`}
                            >
                              {fmt(cell.amount)}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--contrib-faint)', fontSize: 12 }}>Unpaid</span>
                        )}
                        {/* Admin Edit Trigger */}
                        {cell?.id && (
                          <button
                            type="button"
                            onClick={() => isEditing ? setEditingCell(null) : openEdit(mo, cell)}
                            title="Edit this contribution"
                            style={{
                              background: isEditing ? 'var(--contrib-blue)' : 'transparent',
                              border: `1px solid ${isEditing ? 'var(--contrib-blue)' : 'var(--contrib-border)'}`,
                              borderRadius: 6,
                              padding: '3px 7px',
                              cursor: 'pointer',
                              color: isEditing ? '#fff' : 'var(--contrib-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            <Pencil size={10} />
                            {isEditing ? 'Close' : 'Edit'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline Edit Form */}
                    {isEditing && (
                      <form
                        onSubmit={handleSaveEdit}
                        style={{
                          padding: '10px 14px',
                          borderTop: '1px solid var(--contrib-border)',
                          background: '#f0f4ff',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--contrib-muted)', display: 'block', marginBottom: 3 }}>Amount (TZS)</label>
                            <input
                              type="number"
                              value={editForm.amount}
                              onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                              min="0"
                              step="1000"
                              style={{ padding: '5px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--contrib-border)', width: '100%' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--contrib-muted)', display: 'block', marginBottom: 3 }}>Payment Date</label>
                            <input
                              type="date"
                              value={editForm.paid_date}
                              onChange={(e) => setEditForm({ ...editForm, paid_date: e.target.value })}
                              style={{ padding: '5px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--contrib-border)', width: '100%' }}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--contrib-muted)', display: 'block', marginBottom: 3 }}>M-Pesa Ref</label>
                            <input
                              placeholder="Optional"
                              value={editForm.mpesa_ref}
                              onChange={(e) => setEditForm({ ...editForm, mpesa_ref: e.target.value })}
                              style={{ padding: '5px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--contrib-border)', width: '100%' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--contrib-muted)', display: 'block', marginBottom: 3 }}>Status</label>
                            <select
                              value={editForm.status}
                              onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                              style={{ padding: '5px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--contrib-border)', width: '100%' }}
                            >
                              <option value="paid">Paid</option>
                              <option value="partial">Partial</option>
                              <option value="unpaid">Unpaid</option>
                            </select>
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={editSaving}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            background: 'var(--contrib-blue)', color: '#fff', border: 'none',
                            borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          }}
                        >
                          <Save size={12} />
                          {editSaving ? 'Saving…' : 'Save Changes'}
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="contrib-drawer-footer">
          <button
            type="button"
            className="contrib-btn-secondary"
            onClick={() => {
              onClose();
              onBulkPayment(memberRow.member_id);
            }}
          >
            <Layers size={14} /> Bulk Payment
          </button>
          <button
            type="button"
            className="contrib-btn-primary"
            onClick={() => {
              onClose();
              onRecordPayment(memberRow.member_id);
            }}
          >
            <Plus size={14} /> Record Payment
          </button>
        </div>
      </aside>
    </>
  );
}

// ── Main Contributions Component ───────────────────────────────────────────
export default function Contributions({ user }) {
  const isAdmin = user?.role === 'admin';
  const [fy, setFy] = useState(2025);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterState, setFilterState] = useState('all'); // all, paid, partial, missing

  // Modals & Drawers
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedMemberRow, setSelectedMemberRow] = useState(null);
  const [prefilledMemberId, setPrefilledMemberId] = useState(null);

  const [broadcasting, setBroadcasting] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Fetch real data from existing API endpoints
  const { data: gridData, loading, error, refetch } = useApi(() => contributions.grid(fy), [fy]);
  const { data: membersData } = useApi(() => members.list());

  // Close more menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setMoreMenuOpen(false);
    if (moreMenuOpen) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [moreMenuOpen]);

  const handleExportCSV = () => {
    if (!gridData) return;
    try {
      exportContributionsCSV(gridData, fy);
      showToast('Contributions CSV downloaded!');
    } catch {
      showToast('Failed to export CSV', 'error');
    }
  };

  const handleBroadcastReminders = async () => {
    setBroadcasting(true);
    try {
      const now = new Date();
      const prevMonth = now.getMonth(); // 0-based
      const reminderMonth = prevMonth === 0 ? 12 : prevMonth;
      const reminderYear = prevMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();

      const res = await mailer.broadcastReminders({ month: reminderMonth, year: reminderYear });
      const { mock_mode } = res.data || {};
      const mockNote = mock_mode ? ' (mock mode active)' : '';
      showToast(`${res.data?.message || 'Reminders dispatched successfully'}${mockNote}`);
      setShowReminderModal(false);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to broadcast reminders', 'error');
    } finally {
      setBroadcasting(false);
    }
  };

  const openRecordForMember = (memberId) => {
    setPrefilledMemberId(memberId);
    setShowAddModal(true);
  };

  const openBulkForMember = (memberId) => {
    setPrefilledMemberId(memberId);
    setShowBulkModal(true);
  };

  // Filtered Grid computation
  const monthlyTarget = fy <= 2024 ? TARGET_FY2024 : TARGET_FY2025_PLUS;
  const targetFYTotalPerMember = monthlyTarget * 12;

  const filteredGrid = useMemo(() => {
    if (!gridData?.grid) return [];
    return gridData.grid.filter((row) => {
      // Search matching
      const matchesSearch =
        !searchQuery.trim() ||
        row.member_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(row.member_id).includes(searchQuery);

      if (!matchesSearch) return false;

      // Status filter
      if (filterState === 'all') return true;
      if (filterState === 'paid') return row.total >= targetFYTotalPerMember;
      if (filterState === 'partial') return row.total > 0 && row.total < targetFYTotalPerMember;
      if (filterState === 'missing') return row.total === 0;

      return true;
    });
  }, [gridData, searchQuery, filterState, targetFYTotalPerMember]);

  if (loading) return <ContributionsSkeleton />;

  if (error || !gridData) {
    return (
      <div className="admin-contributions-page">
        <div
          style={{
            background: '#ffffff',
            border: '1px dashed var(--contrib-border)',
            borderRadius: 16,
            padding: 40,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <AlertTriangle size={28} color="var(--contrib-red)" />
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>Unable to load contributions</h3>
          <p style={{ color: 'var(--contrib-muted)', fontSize: 13, maxWidth: 400 }}>
            {error || 'An unexpected error occurred while fetching contribution data.'}
          </p>
          <button type="button" className="contrib-btn-secondary" onClick={refetch}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { grid, monthlyTotals } = gridData;
  const totalPaid = grid.reduce((s, m) => s + (m.total || 0), 0);
  const targetTotal = grid.length * monthlyTarget * 12;
  const compliance = targetTotal > 0 ? Math.min(100, Math.round((totalPaid / targetTotal) * 100)) : 0;
  const isFY2026 = fy >= 2026;

  const fullyPaidCount = grid.filter((r) => r.total >= targetFYTotalPerMember).length;
  const partialCount = grid.filter((r) => r.total > 0 && r.total < targetFYTotalPerMember).length;
  const missingCount = grid.filter((r) => r.total === 0).length;

  return (
    <div className="admin-contributions-page">
      {/* ── Page Header ── */}
      <header className="contrib-page-header">
        <div>
          <div className="contrib-eyebrow">Checkpoint Investment Club</div>
          <h1>Contributions</h1>
          <p>
            Track and reconcile member payments across FY{fy} ({MONTHS[3]} {fy} – {MONTHS[2]} {fy + 1}).
          </p>
        </div>

        <div className="contrib-header-actions">
          {/* Fiscal Year Selector */}
          <select
            className="contrib-select"
            value={fy}
            onChange={(e) => setFy(parseInt(e.target.value, 10))}
            aria-label="Select Fiscal Year"
          >
            <option value="2026">FY2026</option>
            <option value="2025">FY2025</option>
            <option value="2024">FY2024</option>
          </select>

          {/* More Actions Dropdown */}
          <div className="contrib-actions-menu" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="contrib-btn-secondary"
              onClick={() => setMoreMenuOpen((v) => !v)}
              aria-expanded={moreMenuOpen}
            >
              <MoreHorizontal size={16} />
              <span>More</span>
            </button>

            {moreMenuOpen && (
              <div className="contrib-menu-popover">
                <button
                  type="button"
                  onClick={() => {
                    handleExportCSV();
                    setMoreMenuOpen(false);
                  }}
                >
                  <Download size={14} color="var(--contrib-blue)" /> Export CSV
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowImportModal(true);
                      setMoreMenuOpen(false);
                    }}
                  >
                    <Upload size={14} color="var(--contrib-teal)" /> Import CSV
                  </button>
                )}
                {isAdmin && (
                  <>
                    <hr />
                    <button
                      type="button"
                      onClick={() => {
                        setShowReminderModal(true);
                        setMoreMenuOpen(false);
                      }}
                      style={{ color: 'var(--contrib-amber)' }}
                    >
                      <Bell size={14} /> Send Reminders
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Bulk Payment CTA */}
          {isAdmin && (
            <button
              type="button"
              className="contrib-btn-secondary"
              onClick={() => {
                setPrefilledMemberId(null);
                setShowBulkModal(true);
              }}
            >
              <Layers size={15} color="var(--contrib-teal)" />
              <span>Bulk payment</span>
            </button>
          )}

          {/* Record Contribution CTA */}
          {isAdmin && (
            <button
              type="button"
              className="contrib-btn-primary"
              onClick={() => {
                setPrefilledMemberId(null);
                setShowAddModal(true);
              }}
            >
              <Plus size={15} />
              <span>Record contribution</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Contextual FY Rule Notice ── */}
      <div className={`contrib-rule-notice ${isFY2026 ? 'is-fy2026' : ''}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Info size={16} color={isFY2026 ? 'var(--contrib-red)' : 'var(--contrib-amber)'} />
          <div>
            <strong>Constitution Rule · FY{fy}:</strong>{' '}
            <span>
              {isFY2026
                ? 'Late contributions (after the 5th) compound a 15% penalty per month.'
                : fy === 2025
                ? 'Late contributions (after the 5th) incur a flat TZS 3,500 fine per month.'
                : 'Standard monthly contribution target of TZS 50,000 per member.'}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--contrib-muted)', fontWeight: 600 }}>
          Deadline: 5th of every month
        </div>
      </div>

      {/* ── Metrics Summary Rail ── */}
      <section className="contrib-stats-grid">
        <div className="contrib-stat-card is-primary">
          <div className="contrib-stat-top">
            <span>Total Collected</span>
            <Wallet size={16} color="var(--contrib-blue)" />
          </div>
          <strong>{fmt(totalPaid)}</strong>
          <span className="stat-sub">Across {grid.length} active club members</span>
        </div>

        <div className="contrib-stat-card">
          <div className="contrib-stat-top">
            <span>Active Members</span>
            <Users size={16} color="var(--contrib-teal)" />
          </div>
          <strong>{grid.length}</strong>
          <span className="stat-sub">{fullyPaidCount} fully on track</span>
        </div>

        <div className="contrib-stat-card">
          <div className="contrib-stat-top">
            <span>Monthly Target</span>
            <Target size={16} color="var(--contrib-green)" />
          </div>
          <strong>{fmt(monthlyTarget * grid.length)}</strong>
          <span className="stat-sub">TZS {fy <= 2024 ? '50K' : '75K'} / member / month</span>
        </div>

        <div className="contrib-stat-card">
          <div className="contrib-stat-top">
            <span>FY Target & Compliance</span>
            <TrendingUp size={16} color="var(--contrib-amber)" />
          </div>
          <strong>{compliance}%</strong>
          <span className="stat-sub">of expected {fmtShort(targetTotal)} target</span>
        </div>
      </section>

      {/* ── Search & Filter Toolbar ── */}
      <div className="contrib-toolbar">
        <div className="contrib-search-wrap">
          <Search size={15} />
          <input
            type="text"
            className="contrib-search-input"
            placeholder="Search member name or ID…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 0,
                color: 'var(--contrib-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="contrib-filter-tabs">
          <button
            type="button"
            className={`contrib-filter-tab ${filterState === 'all' ? 'active' : ''}`}
            onClick={() => setFilterState('all')}
          >
            All ({grid.length})
          </button>
          <button
            type="button"
            className={`contrib-filter-tab ${filterState === 'paid' ? 'active' : ''}`}
            onClick={() => setFilterState('paid')}
          >
            Fully Paid ({fullyPaidCount})
          </button>
          <button
            type="button"
            className={`contrib-filter-tab ${filterState === 'partial' ? 'active' : ''}`}
            onClick={() => setFilterState('partial')}
          >
            Partial ({partialCount})
          </button>
          <button
            type="button"
            className={`contrib-filter-tab ${filterState === 'missing' ? 'active' : ''}`}
            onClick={() => setFilterState('missing')}
          >
            Missing ({missingCount})
          </button>
        </div>
      </div>

      {/* ── Contribution Matrix Table ── */}
      <div className="contrib-table-card">
        <div className="contrib-table-scroll">
          <table className="contrib-matrix-table">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Member</th>
                {FY_MONTHS.map((mo, idx) => {
                  const yr = fyMonthYear(mo, fy);
                  const isCrossYear = mo <= 2;
                  return (
                    <th
                      key={mo}
                      className={`is-month ${idx === 10 ? 'is-split' : ''}`}
                      title={`${MONTHS[mo]} ${yr}`}
                    >
                      <div>{MONTHS[mo]}</div>
                      {isCrossYear && (
                        <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--contrib-blue)' }}>
                          {yr}
                        </div>
                      )}
                    </th>
                  );
                })}
                <th className="is-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredGrid.length === 0 ? (
                <tr>
                  <td colSpan={14} style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--contrib-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <CheckCircle2 size={24} color="var(--contrib-faint)" />
                      <strong>No matching contribution records found for FY{fy}.</strong>
                      {searchQuery && (
                        <button
                          type="button"
                          className="contrib-btn-secondary"
                          style={{ marginTop: 6 }}
                          onClick={() => {
                            setSearchQuery('');
                            setFilterState('all');
                          }}
                        >
                          Clear search filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredGrid.map((row) => (
                  <tr
                    key={row.member_id}
                    onClick={() => setSelectedMemberRow(row)}
                    title={`Click to view ${row.member_name} payment details`}
                  >
                    <td>
                      <div className="contrib-member-cell">
                        <div className="contrib-member-avatar">{initials(row.member_name)}</div>
                        <div className="contrib-member-info">
                          <strong>{row.member_name}</strong>
                          <span className={`contrib-role-badge badge-${row.office}`}>
                            {row.office}
                          </span>
                        </div>
                      </div>
                    </td>

                    {FY_MONTHS.map((mo, idx) => (
                      <td
                        key={mo}
                        className={`is-month ${idx === 10 ? 'is-split' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMemberRow(row);
                        }}
                      >
                        <ContribCell data={row.months[mo]} fy={fy} />
                      </td>
                    ))}

                    <td className="is-total">{fmt(row.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>TOTAL COLLECTED</td>
                {FY_MONTHS.map((mo, idx) => (
                  <td
                    key={mo}
                    className={`is-month ${idx === 10 ? 'is-split' : ''}`}
                    title={`Total for ${MONTHS[mo]}: ${fmt(monthlyTotals[mo] || 0)}`}
                  >
                    {monthlyTotals[mo] ? `${(monthlyTotals[mo] / 1000).toFixed(0)}K` : '—'}
                  </td>
                ))}
                <td className="is-total">{fmt(totalPaid)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Slide-over Member Detail Sheet ── */}
      {selectedMemberRow && (
        <MemberDetailDrawer
          memberRow={selectedMemberRow}
          fy={fy}
          onClose={() => setSelectedMemberRow(null)}
          onRecordPayment={openRecordForMember}
          onBulkPayment={openBulkForMember}
        />
      )}

      {/* ── Record Contribution Modal ── */}
      {showAddModal && (
        <RecordContributionModal
          onClose={() => setShowAddModal(false)}
          membersData={membersData}
          onComplete={refetch}
          defaultMemberId={prefilledMemberId}
          fy={fy}
        />
      )}

      {/* ── Bulk Payment Modal ── */}
      {showBulkModal && (
        <BulkPaymentModal
          onClose={() => setShowBulkModal(false)}
          membersData={membersData}
          onComplete={refetch}
          defaultMemberId={prefilledMemberId}
        />
      )}

      {/* ── Import CSV Modal ── */}
      {showImportModal && (
        <ImportCsvModal
          type="contributions"
          onClose={() => setShowImportModal(false)}
          onComplete={refetch}
        />
      )}

      {/* ── Reminder Broadcast Confirmation Modal ── */}
      {showReminderModal && (
        <ReminderModal
          onClose={() => setShowReminderModal(false)}
          onConfirm={handleBroadcastReminders}
          broadcasting={broadcasting}
        />
      )}
    </div>
  );
}
