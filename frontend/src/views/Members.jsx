import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users,
  UserPlus,
  Upload,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  Phone,
  Calendar,
  Layers,
  Banknote,
  DollarSign,
  ShieldAlert,
  Loader2,
  Edit2,
  Clock,
  MoreHorizontal,
} from 'lucide-react';
import { members, summary } from '../api';
import ImportCsvModal from '../components/ImportCsvModal';
import { fmt, fmtShort, showToast, useApi, ProgressBar } from '../components/UI';

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'CM';
}

// ── Member Detail Slide-over Sheet ─────────────────────────────────────────
function MemberDetailDrawer({ memberId, onClose, user, onRefresh, onOpenEdit }) {
  const isAdmin = user?.role === 'admin';
  const { data, loading, refetch } = useApi(() => members.get(memberId), [memberId]);

  const [payingFineId, setPayingFineId] = useState(null);
  const [finePayDate, setFinePayDate] = useState(new Date().toISOString().split('T')[0]);
  const [finePayRef, setFinePayRef] = useState('');
  const [markingPaid, setMarkingPaid] = useState(false);

  const handleMarkFinePaid = async (fineId, fineAmount) => {
    if (!finePayDate) return showToast('Please select a payment date', 'error');
    setMarkingPaid(true);
    try {
      await summary.updateFine(fineId, {
        status: 'paid',
        paid_date: finePayDate,
        ...(finePayRef ? { mpesa_ref: finePayRef } : {}),
      });
      showToast(`Fine of ${fmt(fineAmount)} marked as paid ✓`);
      setPayingFineId(null);
      refetch();
      if (onRefresh) onRefresh();
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to update fine', 'error');
    } finally {
      setMarkingPaid(false);
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

  const unpaidFines = (data.fines || []).filter((f) => f.status === 'unpaid');
  const unpaidFinesTotal = unpaidFines.reduce((s, f) => s + (f.amount || 0), 0);

  return (
    <>
      <div className="admin-drawer-overlay" onClick={onClose} />
      <aside className="admin-drawer-panel">
        <div className="admin-drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="admin-avatar" style={{ width: 44, height: 44, fontSize: 15 }}>
              {initials(data.name)}
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--admin-text)' }}>
                {data.name}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span className={`admin-badge is-${data.status === 'active' ? 'active' : 'neutral'}`}>
                  {data.status}
                </span>
                <span className="admin-badge is-info">{data.office}</span>
                <span style={{ color: 'var(--admin-muted)', fontSize: 11 }}>Member #{data.id}</span>
              </div>
            </div>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="admin-drawer-content">
          {/* Contact & Membership Metadata */}
          <div style={{ background: '#fafafa', border: '1px solid var(--admin-border)', borderRadius: 12, padding: 14, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--admin-border)' }}>
              <span style={{ color: 'var(--admin-muted)' }}>Phone Number</span>
              <strong>{data.phone || '—'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
              <span style={{ color: 'var(--admin-muted)' }}>Joined Club</span>
              <strong>{data.join_date || '—'}</strong>
            </div>
          </div>

          {/* Key Financial Totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <div style={{ background: '#fafafa', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--admin-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                FY2025 Contrib
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--admin-blue)', marginTop: 2 }}>
                {fmt(data.contributions_2025)}
              </div>
            </div>
            <div style={{ background: '#fafafa', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--admin-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Active Loan
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: data.active_loan_amount > 0 ? 'var(--admin-red)' : 'var(--admin-green)', marginTop: 2 }}>
                {fmt(data.active_loan_amount || 0)}
              </div>
            </div>
            <div style={{ background: '#fafafa', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--admin-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Unpaid Fines
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: unpaidFinesTotal > 0 ? 'var(--admin-red)' : 'var(--admin-green)', marginTop: 2 }}>
                {fmt(unpaidFinesTotal)}
              </div>
            </div>
          </div>

          {/* Contribution Compliance Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--admin-muted)', fontWeight: 600 }}>FY2025 Contribution Compliance</span>
              <span style={{ fontWeight: 700, color: 'var(--admin-text)' }}>{data.months_paid_2025 || 0} / 12 months</span>
            </div>
            <ProgressBar value={data.months_paid_2025 || 0} max={12} />
          </div>

          {/* Loan History Section */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--admin-muted)', marginBottom: 8 }}>
              Loan History ({data.loans?.length || 0})
            </div>

            {data.loans?.length ? (
              <div style={{ border: '1px solid var(--admin-border)', borderRadius: 10, overflow: 'hidden' }}>
                {data.loans.map((l, idx) => (
                  <div
                    key={l.id || idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 12px',
                      borderBottom: idx < data.loans.length - 1 ? '1px solid var(--admin-border)' : 'none',
                      background: '#ffffff',
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <strong style={{ color: 'var(--admin-text)' }}>{l.loan_number}</strong>
                      <span style={{ color: 'var(--admin-muted)', marginLeft: 8 }}>{l.issued_date}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, color: 'var(--admin-blue)' }}>{fmt(l.principal)}</span>
                      <span className={`admin-badge is-${l.status === 'active' ? 'pending' : l.status === 'paid' ? 'paid' : 'overdue'}`}>
                        {l.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 14, textAlign: 'center', background: '#fafafa', border: '1px dashed var(--admin-border)', borderRadius: 10, color: 'var(--admin-muted)', fontSize: 12 }}>
                No historical loans recorded.
              </div>
            )}
          </div>

          {/* Fines Section */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--admin-muted)', marginBottom: 8 }}>
              Fines & Penalties ({data.fines?.length || 0})
            </div>

            {data.fines?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.fines.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      background: '#fafafa',
                      border: '1px solid var(--admin-border)',
                      borderRadius: 10,
                      padding: 12,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ color: 'var(--admin-text)', fontWeight: 500, flex: 1 }}>{f.reason}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong style={{ color: f.status === 'paid' ? 'var(--admin-green)' : 'var(--admin-red)' }}>
                          {fmt(f.amount)}
                        </strong>
                        <span className={`admin-badge is-${f.status === 'paid' ? 'paid' : 'overdue'}`}>
                          {f.status}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, color: 'var(--admin-muted)', fontSize: 11 }}>
                      <span>FY{f.year}</span>
                      {f.status === 'unpaid' && isAdmin && (
                        <button
                          type="button"
                          className="admin-btn-secondary"
                          style={{ minHeight: 26, padding: '0 8px', fontSize: 11 }}
                          onClick={() => setPayingFineId(payingFineId === f.id ? null : f.id)}
                        >
                          {payingFineId === f.id ? 'Cancel' : 'Mark Paid'}
                        </button>
                      )}
                    </div>

                    {payingFineId === f.id && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--admin-border)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <input
                            type="date"
                            value={finePayDate}
                            onChange={(e) => setFinePayDate(e.target.value)}
                            style={{ padding: 6, fontSize: 12 }}
                          />
                          <input
                            placeholder="M-Pesa Ref (optional)"
                            value={finePayRef}
                            onChange={(e) => setFinePayRef(e.target.value)}
                            style={{ padding: 6, fontSize: 12 }}
                          />
                        </div>
                        <button
                          type="button"
                          className="admin-btn-primary"
                          style={{ width: '100%', minHeight: 30, fontSize: 12 }}
                          onClick={() => handleMarkFinePaid(f.id, f.amount)}
                          disabled={markingPaid}
                        >
                          {markingPaid ? 'Saving…' : 'Confirm Fine Payment'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 14, textAlign: 'center', background: '#fafafa', border: '1px dashed var(--admin-border)', borderRadius: 10, color: 'var(--admin-muted)', fontSize: 12 }}>
                No fines on record.
              </div>
            )}
          </div>
        </div>

        <div className="admin-drawer-footer">
          {isAdmin && (
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={() => {
                onClose();
                onOpenEdit(data);
              }}
            >
              <Edit2 size={14} /> Edit Member
            </button>
          )}
          <button type="button" className="admin-btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}

// ── Add Member Modal ───────────────────────────────────────────────────────
function AddMemberModal({ onClose, onComplete }) {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    office: 'member',
    status: 'active',
    join_date: new Date().toISOString().split('T')[0],
    entry_fee: '100000',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await members.create({
        ...form,
        entry_fee: parseInt(form.entry_fee || 0, 10),
      });
      showToast('Member created successfully!');
      onComplete();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to create member', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal-panel">
        <div className="admin-modal-header">
          <div>
            <h3>Add New Member</h3>
            <p style={{ color: 'var(--admin-muted)', fontSize: 12, marginTop: 2 }}>
              Enroll a new member into the club roster.
            </p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="admin-form-group">
            <label>Full Name</label>
            <input
              placeholder="e.g. Amani Mwangi"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label>Phone Number</label>
              <input
                placeholder="e.g. 0712345678"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                required
              />
            </div>
            <div className="admin-form-group">
              <label>Club Office</label>
              <select
                value={form.office}
                onChange={(e) => setForm({ ...form, office: e.target.value })}
              >
                <option value="member">Member</option>
                <option value="chair">Chairperson</option>
                <option value="secretary">Secretary</option>
                <option value="treasurer">Treasurer</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
          </div>

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label>Join Date</label>
              <input
                type="date"
                value={form.join_date}
                onChange={(e) => setForm({ ...form, join_date: e.target.value })}
                required
              />
            </div>
            <div className="admin-form-group">
              <label>Entry Fee (TZS)</label>
              <input
                type="number"
                value={form.entry_fee}
                onChange={(e) => setForm({ ...form, entry_fee: e.target.value })}
                required
                min="0"
                step="1000"
              />
            </div>
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
              {saving ? 'Creating…' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Member Modal ──────────────────────────────────────────────────────
function EditMemberModal({ member, onClose, onComplete }) {
  const [form, setForm] = useState({
    name: member?.name || '',
    phone: member?.phone || '',
    office: member?.office || 'member',
    status: member?.status || 'active',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await members.update(member.id, form);
      showToast('Member profile updated!');
      onComplete();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update member', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal-panel">
        <div className="admin-modal-header">
          <div>
            <h3>Edit Member Profile</h3>
            <p style={{ color: 'var(--admin-muted)', fontSize: 12, marginTop: 2 }}>
              Update details for {member?.name}.
            </p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="admin-form-group">
            <label>Full Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label>Phone Number</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                required
              />
            </div>
            <div className="admin-form-group">
              <label>Club Office</label>
              <select
                value={form.office}
                onChange={(e) => setForm({ ...form, office: e.target.value })}
              >
                <option value="member">Member</option>
                <option value="chair">Chairperson</option>
                <option value="secretary">Secretary</option>
                <option value="treasurer">Treasurer</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
          </div>

          <div className="admin-form-group">
            <label>Membership Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
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
              {saving ? 'Updating…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Members Component ─────────────────────────────────────────────────
export default function Members({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = user?.role === 'admin';
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState(searchParams.get('filter') || 'all');
  const [selectedMemberId, setSelectedMemberId] = useState(
    searchParams.get('member') ? parseInt(searchParams.get('member'), 10) : null
  );
  const [editingMember, setEditingMember] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const { data: membersList, loading, error, refetch } = useApi(() => members.list());

  useEffect(() => {
    const memberParam = searchParams.get('member');
    if (memberParam) {
      setSelectedMemberId(parseInt(memberParam, 10));
    }
    const filterParam = searchParams.get('filter');
    if (filterParam) {
      setRoleFilter(filterParam);
    }
  }, [searchParams]);

  const handleCloseDrawer = () => {
    setSelectedMemberId(null);
    if (searchParams.has('member')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('member');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const handleOpenMember = (id) => {
    setSelectedMemberId(id);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('member', id);
    setSearchParams(nextParams);
  };

  const list = useMemo(() => {
    const raw = membersList || [];
    return raw.filter((m) => {
      const matchesSearch =
        !searchQuery.trim() ||
        (m.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.phone || '').includes(searchQuery);

      if (!matchesSearch) return false;

      if (roleFilter === 'all') return true;
      if (roleFilter === 'active') return m.status === 'active';
      if (roleFilter === 'inactive') return m.status === 'inactive';
      if (roleFilter === 'attention') {
        return (m.active_loan_amount > 0) || (m.unpaid_fines_count > 0) || ((m.months_paid_2025 || 0) < 12);
      }
      return m.office === roleFilter;
    });
  }, [membersList, searchQuery, roleFilter]);

  const activeCount = (membersList || []).filter((m) => m.status === 'active').length;
  const totalContributions = (membersList || []).reduce((s, m) => s + (m.total_contributions || 0), 0);
  const activeBorrowers = (membersList || []).filter((m) => (m.active_loan_amount || 0) > 0).length;

  return (
    <div className="admin-page-container">
      {/* ── Header ── */}
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Member Directory</h1>
          <p>Manage membership roster, officer appointments, and individual accounts.</p>
        </div>

        <div className="admin-header-actions">
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
              <UserPlus size={15} /> Add member
            </button>
          )}
        </div>
      </header>

      {/* ── Summary Rail ── */}
      <section className="admin-stats-grid">
        <div className="admin-stat-card is-primary">
          <div className="admin-stat-top">
            <span>Total Active Roster</span>
            <Users size={16} color="var(--admin-blue)" />
          </div>
          <strong>{activeCount}</strong>
          <span className="stat-sub">Across {(membersList || []).length} registered accounts</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Total Member Equity</span>
            <CheckCircle2 size={16} color="var(--admin-green)" />
          </div>
          <strong style={{ color: 'var(--admin-green)' }}>{fmt(totalContributions)}</strong>
          <span className="stat-sub">All-time member contributions</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Active Borrowers</span>
            <Banknote size={16} color="var(--admin-amber)" />
          </div>
          <strong style={{ color: 'var(--admin-amber)' }}>{activeBorrowers}</strong>
          <span className="stat-sub">Members with active loans</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Governance & Roles</span>
            <Clock size={16} color="var(--admin-teal)" />
          </div>
          <strong style={{ color: 'var(--admin-teal)' }}>
            {(membersList || []).filter((m) => m.office !== 'member').length} Officers
          </strong>
          <span className="stat-sub">Executive committee members</span>
        </div>
      </section>

      {/* ── Toolbar: Search & Role Filters ── */}
      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search member name or phone…"
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
          {['all', 'attention', 'active', 'chair', 'secretary', 'treasurer', 'member'].map((r) => (
            <button
              key={r}
              type="button"
              className={`admin-filter-tab ${roleFilter === r ? 'active' : ''}`}
              onClick={() => {
                setRoleFilter(r);
                if (searchParams.has('filter')) {
                  const nextParams = new URLSearchParams(searchParams);
                  nextParams.delete('filter');
                  setSearchParams(nextParams, { replace: true });
                }
              }}
              style={{ textTransform: 'capitalize' }}
            >
              {r === 'attention' ? '⚠ Attention' : r}
            </button>
          ))}
        </div>
      </div>

      {/* ── Member Roster Table ── */}
      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Member</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Joined</th>
                <th className="is-numeric">FY2025 Contrib</th>
                <th className="is-numeric">Active Loan</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--admin-muted)' }}>
                    <Loader2 size={20} className="animate-spin" style={{ display: 'inline', marginRight: 8 }} />
                    Loading member directory…
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 48, color: 'var(--admin-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <CheckCircle2 size={24} color="var(--admin-faint)" />
                      <strong>No members found matching your search.</strong>
                    </div>
                  </td>
                </tr>
              ) : (
                list.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => handleOpenMember(m.id)}
                    title={`Click to view ${m.name}'s complete profile`}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="admin-avatar">{initials(m.name)}</div>
                        <div>
                          <strong style={{ color: 'var(--admin-text)' }}>{m.name}</strong>
                          <div style={{ fontSize: 11, color: 'var(--admin-muted)' }}>ID #{m.id}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--admin-muted)', fontSize: 12 }}>{m.phone || '—'}</td>
                    <td>
                      <span className="admin-badge is-info">{m.office}</span>
                    </td>
                    <td style={{ color: 'var(--admin-muted)', fontSize: 12 }}>{m.join_date || '—'}</td>
                    <td className="is-numeric" style={{ color: 'var(--admin-blue)' }}>
                      {fmt(m.contributions_2025 || 0)}
                    </td>
                    <td className="is-numeric" style={{ color: (m.active_loan_amount || 0) > 0 ? 'var(--admin-red)' : 'var(--admin-green)' }}>
                      {fmt(m.active_loan_amount || 0)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`admin-badge is-${m.status === 'active' ? 'active' : 'neutral'}`}>
                        {m.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="admin-btn-secondary"
                        style={{ minHeight: 30, padding: '0 10px', fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenMember(m.id);
                        }}
                      >
                        Profile
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Member Profile Drawer ── */}
      {selectedMemberId && (
        <MemberDetailDrawer
          memberId={selectedMemberId}
          onClose={handleCloseDrawer}
          user={user}
          onRefresh={refetch}
          onOpenEdit={(memberData) => setEditingMember(memberData)}
        />
      )}

      {/* ── Add Member Modal ── */}
      {showAddModal && (
        <AddMemberModal
          onClose={() => setShowAddModal(false)}
          onComplete={refetch}
        />
      )}

      {/* ── Edit Member Modal ── */}
      {editingMember && (
        <EditMemberModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onComplete={refetch}
        />
      )}

      {/* ── Import CSV Modal ── */}
      {showImportModal && (
        <ImportCsvModal
          type="members"
          onClose={() => setShowImportModal(false)}
          onComplete={refetch}
        />
      )}
    </div>
  );
}
