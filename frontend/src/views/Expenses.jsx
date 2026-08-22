import { useState, useMemo } from 'react';
import {
  Receipt,
  Plus,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  Edit2,
  Trash2,
  Calendar,
  Layers,
  DollarSign,
  Tag,
  Loader2,
  ShieldCheck,
  MoreHorizontal,
} from 'lucide-react';
import { expenses as expensesApi } from '../api';
import { fmt, fmtShort, showToast, useApi } from '../components/UI';

const CATEGORIES = ['AGM', 'Registration', 'Admin', 'Supplies', 'Loan Override', 'Welfare', 'Other'];

const CATEGORY_TONES = {
  AGM: 'indigo',
  Registration: 'blue',
  Admin: 'teal',
  Supplies: 'amber',
  'Loan Override': 'red',
  Welfare: 'green',
  Other: 'neutral',
};

function getFiscalYear(dateStr) {
  if (!dateStr) return 2026;
  const [y, m] = dateStr.split('-').map(Number);
  return m >= 3 ? y : y - 1;
}

const EMPTY_FORM = {
  category: 'AGM',
  description: '',
  amount: '',
  expense_date: new Date().toISOString().split('T')[0],
  fiscal_year: '',
  reference: '',
  approved_by: '',
  notes: '',
};

// ── Record / Edit Expense Modal ────────────────────────────────────────────
function ExpenseModal({ expense, onClose, onComplete }) {
  const isEditing = Boolean(expense);
  const [form, setForm] = useState(
    expense
      ? {
          category: expense.category,
          description: expense.description,
          amount: String(expense.amount),
          expense_date: expense.expense_date,
          fiscal_year: String(expense.fiscal_year),
          reference: expense.reference || '',
          approved_by: expense.approved_by || '',
          notes: expense.notes || '',
        }
      : { ...EMPTY_FORM, expense_date: new Date().toISOString().split('T')[0] }
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount || parseInt(form.amount, 10) <= 0) {
      return showToast('Please enter a valid expense amount', 'error');
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: parseInt(form.amount, 10),
        fiscal_year: form.fiscal_year ? parseInt(form.fiscal_year, 10) : getFiscalYear(form.expense_date),
      };

      if (isEditing) {
        await expensesApi.update(expense.id, payload);
        showToast('Expense updated successfully!');
      } else {
        await expensesApi.create(payload);
        showToast('Expense recorded successfully!');
      }
      onComplete();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save expense', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal-panel">
        <div className="admin-modal-header">
          <div>
            <h3>{isEditing ? 'Edit Expense Record' : 'Record New Expense'}</h3>
            <p style={{ color: 'var(--admin-muted)', fontSize: 12, marginTop: 2 }}>
              {isEditing ? 'Modify details for this club expenditure.' : 'Log an authorized club operating expenditure.'}
            </p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label>Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                required
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="admin-form-group">
              <label>Amount (TZS)</label>
              <input
                type="number"
                placeholder="e.g. 50000"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                min="100"
                step="500"
              />
            </div>
          </div>

          <div className="admin-form-group">
            <label>Description / Purpose</label>
            <input
              placeholder="e.g. Annual General Meeting venue booking..."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
            />
          </div>

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label>Expense Date</label>
              <input
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                required
              />
            </div>

            <div className="admin-form-group">
              <label>Fiscal Year (Optional)</label>
              <select
                value={form.fiscal_year}
                onChange={(e) => setForm({ ...form, fiscal_year: e.target.value })}
              >
                <option value="">Auto from Date</option>
                <option value="2026">FY2026</option>
                <option value="2025">FY2025</option>
                <option value="2024">FY2024</option>
              </select>
            </div>
          </div>

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label>Receipt / M-Pesa Ref</label>
              <input
                placeholder="e.g. REC-2026-01"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </div>

            <div className="admin-form-group">
              <label>Approved By</label>
              <input
                placeholder="e.g. Treasurer / Committee"
                value={form.approved_by}
                onChange={(e) => setForm({ ...form, approved_by: e.target.value })}
              />
            </div>
          </div>

          <div className="admin-form-group">
            <label>Notes (Optional)</label>
            <textarea
              placeholder="Additional expenditure context…"
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
              {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Record Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete Confirmation Dialog ─────────────────────────────────────────────
function DeleteConfirmModal({ expense, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await expensesApi.remove(expense.id);
      showToast('Expense deleted');
      onDeleted();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete expense', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal-panel" style={{ maxWidth: 440 }}>
        <div className="admin-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                background: 'var(--admin-red-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--admin-red)',
              }}
            >
              <AlertTriangle size={18} />
            </div>
            <div>
              <h3>Delete Expense?</h3>
              <p style={{ color: 'var(--admin-muted)', fontSize: 12 }}>
                This action will remove the record permanently.
              </p>
            </div>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--admin-text)', lineHeight: 1.5, marginBottom: 16 }}>
          Are you sure you want to delete <strong>{expense.description}</strong> ({fmt(expense.amount)})?
        </p>

        <div className="admin-modal-actions">
          <button
            type="button"
            className="admin-btn-secondary"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-btn-danger"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete Record'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Expenses Component ────────────────────────────────────────────────
export default function Expenses({ user }) {
  const isAdmin = user?.role === 'admin';
  const [fyFilter, setFyFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [modalExpense, setModalExpense] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deletingExpense, setDeletingExpense] = useState(null);

  const { data: rawExpenses, loading, error, refetch } = useApi(
    () => expensesApi.list(fyFilter !== 'all' ? { fiscal_year: fyFilter } : {}),
    [fyFilter]
  );

  const list = useMemo(() => {
    const raw = rawExpenses || [];
    return raw.filter((e) => {
      const matchesCat = catFilter === 'all' || e.category === catFilter;
      if (!matchesCat) return false;

      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;

      return (
        (e.description || '').toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q) ||
        (e.reference || '').toLowerCase().includes(q) ||
        (e.approved_by || '').toLowerCase().includes(q)
      );
    });
  }, [rawExpenses, catFilter, searchQuery]);

  const totalAmount = list.reduce((s, e) => s + (e.amount || 0), 0);
  const allList = rawExpenses || [];
  const topCategory = useMemo(() => {
    if (!allList.length) return '—';
    const counts = allList.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + (e.amount || 0);
      return acc;
    }, {});
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0] ? sorted[0][0] : '—';
  }, [allList]);

  return (
    <div className="admin-page-container">
      {/* ── Header ── */}
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Expense Register</h1>
          <p>Track approved operating expenditures, AGM costs, supplies, and overrides.</p>
        </div>

        <div className="admin-header-actions">
          <select
            className="admin-select"
            value={fyFilter}
            onChange={(e) => setFyFilter(e.target.value)}
            aria-label="Filter by Fiscal Year"
          >
            <option value="all">All Fiscal Years</option>
            <option value="2026">FY2026</option>
            <option value="2025">FY2025</option>
            <option value="2024">FY2024</option>
          </select>

          {isAdmin && (
            <button
              type="button"
              className="admin-btn-primary"
              onClick={() => {
                setModalExpense(null);
                setShowAddModal(true);
              }}
            >
              <Plus size={15} /> Record expense
            </button>
          )}
        </div>
      </header>

      {/* ── Summary Metrics Rail ── */}
      <section className="admin-stats-grid">
        <div className="admin-stat-card is-primary">
          <div className="admin-stat-top">
            <span>Total Expenditure</span>
            <Receipt size={16} color="var(--admin-red)" />
          </div>
          <strong style={{ color: 'var(--admin-red)' }}>{fmt(totalAmount)}</strong>
          <span className="stat-sub">Across {list.length} expense entries</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Top Category</span>
            <Tag size={16} color="var(--admin-indigo)" />
          </div>
          <strong style={{ color: 'var(--admin-indigo)' }}>{topCategory}</strong>
          <span className="stat-sub">Highest cumulative spend</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Total Entries</span>
            <Calendar size={16} color="var(--admin-blue)" />
          </div>
          <strong>{list.length}</strong>
          <span className="stat-sub">Logged financial events</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Selected Period</span>
            <ShieldCheck size={16} color="var(--admin-teal)" />
          </div>
          <strong style={{ color: 'var(--admin-teal)' }}>
            {fyFilter === 'all' ? 'All Time' : `FY${fyFilter}`}
          </strong>
          <span className="stat-sub">Active scope filter</span>
        </div>
      </section>

      {/* ── Toolbar: Search & Category Filter Tabs ── */}
      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search description, reference, or approver…"
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
          <button
            type="button"
            className={`admin-filter-tab ${catFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCatFilter('all')}
          >
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`admin-filter-tab ${catFilter === c ? 'active' : ''}`}
              onClick={() => setCatFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* ── Expense Register Table ── */}
      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ minWidth: 120 }}>Date</th>
                <th>Category</th>
                <th style={{ minWidth: 220 }}>Description</th>
                <th>FY</th>
                <th>Reference</th>
                <th>Approved By</th>
                <th className="is-numeric">Amount</th>
                {isAdmin && <th style={{ textAlign: 'right' }}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--admin-muted)' }}>
                    <Loader2 size={20} className="animate-spin" style={{ display: 'inline', marginRight: 8 }} />
                    Loading expenses register…
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 48, color: 'var(--admin-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <CheckCircle2 size={24} color="var(--admin-faint)" />
                      <strong>No expenses recorded for the selected filter.</strong>
                    </div>
                  </td>
                </tr>
              ) : (
                list.map((e) => {
                  const tone = CATEGORY_TONES[e.category] || 'neutral';
                  return (
                    <tr key={e.id}>
                      <td style={{ color: 'var(--admin-muted)', fontSize: 12 }}>{e.expense_date}</td>
                      <td>
                        <span className={`admin-badge is-${tone}`}>{e.category}</span>
                      </td>
                      <td>
                        <strong style={{ color: 'var(--admin-text)' }}>{e.description}</strong>
                        {e.notes && <div style={{ fontSize: 11, color: 'var(--admin-muted)', marginTop: 2 }}>{e.notes}</div>}
                      </td>
                      <td>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--admin-muted)' }}>FY{e.fiscal_year}</span>
                      </td>
                      <td style={{ color: 'var(--admin-blue)', fontSize: 12, fontWeight: 600 }}>{e.reference || '—'}</td>
                      <td style={{ color: 'var(--admin-muted)', fontSize: 12 }}>{e.approved_by || '—'}</td>
                      <td className="is-numeric" style={{ color: 'var(--admin-red)', fontWeight: 700 }}>
                        {fmt(e.amount)}
                      </td>
                      {isAdmin && (
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            <button
                              type="button"
                              className="admin-btn-secondary"
                              style={{ minHeight: 28, padding: '0 8px', fontSize: 11 }}
                              onClick={() => {
                                setModalExpense(e);
                                setShowAddModal(true);
                              }}
                              title="Edit expense"
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              type="button"
                              className="admin-btn-secondary"
                              style={{ minHeight: 28, padding: '0 8px', fontSize: 11, color: 'var(--admin-red)' }}
                              onClick={() => setDeletingExpense(e)}
                              title="Delete expense"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr style={{ background: '#fafafa', borderTop: '2px solid var(--admin-border)' }}>
                  <td colSpan={6} style={{ padding: 14, fontWeight: 700, color: 'var(--admin-text)' }}>
                    TOTAL EXPENSES
                  </td>
                  <td className="is-numeric" style={{ padding: 14, color: 'var(--admin-red)', fontWeight: 800, fontSize: 14 }}>
                    {fmt(totalAmount)}
                  </td>
                  {isAdmin && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Add / Edit Expense Modal ── */}
      {showAddModal && (
        <ExpenseModal
          expense={modalExpense}
          onClose={() => {
            setShowAddModal(false);
            setModalExpense(null);
          }}
          onComplete={refetch}
        />
      )}

      {/* ── Delete Confirm Modal ── */}
      {deletingExpense && (
        <DeleteConfirmModal
          expense={deletingExpense}
          onClose={() => setDeletingExpense(null)}
          onDeleted={refetch}
        />
      )}
    </div>
  );
}
