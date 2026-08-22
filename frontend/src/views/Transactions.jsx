import { useState, useMemo } from 'react';
import {
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  X,
  CheckCircle2,
  Calendar,
  Layers,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  DollarSign,
  Wallet,
  Banknote,
  Receipt,
} from 'lucide-react';
import { transactions } from '../api';
import { fmt, fmtShort, showToast, useApi } from '../components/UI';

const TYPE_CONFIG = {
  contribution: {
    label: 'Contribution',
    tone: 'teal',
    isDebit: false,
    icon: Wallet,
  },
  loan_repayment: {
    label: 'Loan Repayment',
    tone: 'blue',
    isDebit: false,
    icon: Banknote,
  },
  loan_disbursement: {
    label: 'Loan Disbursed',
    tone: 'red',
    isDebit: true,
    icon: ArrowUpRight,
  },
  fine_payment: {
    label: 'Fine Payment',
    tone: 'amber',
    isDebit: false,
    icon: Receipt,
  },
  group_transfer: {
    label: 'Group Transfer',
    tone: 'indigo',
    isDebit: false,
    icon: ArrowLeftRight,
  },
  other: {
    label: 'Other',
    tone: 'neutral',
    isDebit: false,
    icon: FileText,
  },
};

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'TX';
}

// ── Transaction Detail Slide-over Sheet ────────────────────────────────────
function TransactionDetailDrawer({ tx, onClose }) {
  if (!tx) return null;
  const config = TYPE_CONFIG[tx.type] || TYPE_CONFIG.other;
  const isDebit = config.isDebit || tx.type === 'loan_disbursement';

  return (
    <>
      <div className="admin-drawer-overlay" onClick={onClose} />
      <aside className="admin-drawer-panel">
        <div className="admin-drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: isDebit ? 'var(--admin-red-soft)' : 'var(--admin-green-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isDebit ? 'var(--admin-red)' : 'var(--admin-green)',
              }}
            >
              {isDebit ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--admin-text)' }}>
                Transaction #{tx.id}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span className={`admin-badge is-${config.tone}`}>
                  {config.label}
                </span>
                <span style={{ color: 'var(--admin-muted)', fontSize: 12 }}>{tx.transaction_date}</span>
              </div>
            </div>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="admin-drawer-content">
          <div
            style={{
              background: '#fafafa',
              border: '1px solid var(--admin-border)',
              borderRadius: 14,
              padding: 18,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--admin-muted)', textTransform: 'uppercase' }}>
              Transaction Amount
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 750,
                color: isDebit ? 'var(--admin-red)' : 'var(--admin-green)',
                marginTop: 4,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {isDebit ? '−' : '+'} {fmt(tx.amount)}
            </div>
          </div>

          <div style={{ background: '#ffffff', border: '1px solid var(--admin-border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', fontSize: 13 }}>
              <span style={{ color: 'var(--admin-muted)' }}>Member</span>
              <strong style={{ color: 'var(--admin-text)' }}>{tx.member_name || '—'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', fontSize: 13 }}>
              <span style={{ color: 'var(--admin-muted)' }}>Transaction Type</span>
              <strong style={{ color: 'var(--admin-text)', textTransform: 'capitalize' }}>{tx.type?.replace('_', ' ')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', fontSize: 13 }}>
              <span style={{ color: 'var(--admin-muted)' }}>Payment Reference</span>
              <strong style={{ color: 'var(--admin-blue)' }}>{tx.reference || '—'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', fontSize: 13 }}>
              <span style={{ color: 'var(--admin-muted)' }}>Transaction Date</span>
              <strong>{tx.transaction_date || '—'}</strong>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--admin-muted)', marginBottom: 8 }}>
              Description
            </div>
            <div
              style={{
                background: '#fafafa',
                border: '1px solid var(--admin-border)',
                borderRadius: 10,
                padding: 14,
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--admin-text)',
              }}
            >
              {tx.description || 'No additional narrative provided.'}
            </div>
          </div>
        </div>

        <div className="admin-drawer-footer">
          <button type="button" className="admin-btn-primary" onClick={onClose}>
            Close Preview
          </button>
        </div>
      </aside>
    </>
  );
}

// ── Main Transactions Component ────────────────────────────────────────────
export default function Transactions() {
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selectedTx, setSelectedTx] = useState(null);
  const LIMIT = 30;

  const params = { limit: LIMIT, offset: page * LIMIT, ...(filterType !== 'all' ? { type: filterType } : {}) };
  const { data, loading, error, refetch } = useApi(() => transactions.list(params), [filterType, page]);

  const rawList = data?.transactions || [];
  const total = data?.total || 0;

  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return rawList;
    const q = searchQuery.toLowerCase();
    return rawList.filter((tx) =>
      (tx.member_name || '').toLowerCase().includes(q) ||
      (tx.description || '').toLowerCase().includes(q) ||
      (tx.reference || '').toLowerCase().includes(q)
    );
  }, [rawList, searchQuery]);

  const totalPages = Math.ceil(total / LIMIT) || 1;

  // Approximate metrics based on retrieved records
  const inflowTotal = rawList.filter((t) => t.type !== 'loan_disbursement').reduce((s, t) => s + (t.amount || 0), 0);
  const outflowTotal = rawList.filter((t) => t.type === 'loan_disbursement').reduce((s, t) => s + (t.amount || 0), 0);

  return (
    <div className="admin-page-container">
      {/* ── Header ── */}
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Transaction Ledger</h1>
          <p>Auditable financial activity records across contributions, loans, and fees.</p>
        </div>

        <div className="admin-header-actions">
          <div style={{ fontSize: 12, color: 'var(--admin-muted)', fontWeight: 600 }}>
            {total} total ledger entries
          </div>
        </div>
      </header>

      {/* ── Summary Metrics Rail ── */}
      <section className="admin-stats-grid">
        <div className="admin-stat-card is-primary">
          <div className="admin-stat-top">
            <span>Total Inflow (Page)</span>
            <ArrowDownLeft size={16} color="var(--admin-green)" />
          </div>
          <strong style={{ color: 'var(--admin-green)' }}>{fmt(inflowTotal)}</strong>
          <span className="stat-sub">Contributions & loan repayments</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Total Outflow (Page)</span>
            <ArrowUpRight size={16} color="var(--admin-red)" />
          </div>
          <strong style={{ color: 'var(--admin-red)' }}>{fmt(outflowTotal)}</strong>
          <span className="stat-sub">Loan disbursements to members</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Ledger Records</span>
            <FileText size={16} color="var(--admin-blue)" />
          </div>
          <strong style={{ color: 'var(--admin-blue)' }}>{total}</strong>
          <span className="stat-sub">All-time audited events</span>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span>Current Page</span>
            <Calendar size={16} color="var(--admin-teal)" />
          </div>
          <strong>Page {page + 1} of {totalPages}</strong>
          <span className="stat-sub">{LIMIT} entries per page view</span>
        </div>
      </section>

      {/* ── Toolbar: Search & Filter Tabs ── */}
      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search member, description or ref…"
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
          {['all', 'contribution', 'loan_repayment', 'loan_disbursement', 'fine_payment', 'group_transfer'].map((t) => (
            <button
              key={t}
              type="button"
              className={`admin-filter-tab ${filterType === t ? 'active' : ''}`}
              onClick={() => {
                setFilterType(t);
                setPage(0);
              }}
              style={{ textTransform: 'capitalize' }}
            >
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* ── Ledger Table ── */}
      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Date & Time</th>
                <th style={{ minWidth: 180 }}>Member</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Description</th>
                <th className="is-numeric">Amount</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--admin-muted)' }}>
                    <Loader2 size={20} className="animate-spin" style={{ display: 'inline', marginRight: 8 }} />
                    Loading transaction records…
                  </td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 48, color: 'var(--admin-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <CheckCircle2 size={24} color="var(--admin-faint)" />
                      <strong>No transaction entries found for the selected filter.</strong>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredList.map((tx) => {
                  const config = TYPE_CONFIG[tx.type] || TYPE_CONFIG.other;
                  const isDebit = config.isDebit || tx.type === 'loan_disbursement';
                  return (
                    <tr
                      key={tx.id}
                      onClick={() => setSelectedTx(tx)}
                      title="Click to view transaction details"
                    >
                      <td style={{ color: 'var(--admin-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {tx.transaction_date}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="admin-avatar" style={{ width: 28, height: 28, fontSize: 10 }}>
                            {initials(tx.member_name)}
                          </div>
                          <strong style={{ color: 'var(--admin-text)' }}>{tx.member_name || 'Club'}</strong>
                        </div>
                      </td>
                      <td>
                        <span className={`admin-badge is-${config.tone}`}>
                          {config.label}
                        </span>
                      </td>
                      <td style={{ color: 'var(--admin-blue)', fontSize: 12, fontWeight: 600 }}>
                        {tx.reference || '—'}
                      </td>
                      <td style={{ color: 'var(--admin-muted)', fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tx.description || '—'}
                      </td>
                      <td
                        className="is-numeric"
                        style={{
                          color: isDebit ? 'var(--admin-red)' : 'var(--admin-green)',
                          fontWeight: 700,
                        }}
                      >
                        {isDebit ? '−' : '+'} {fmt(tx.amount)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="admin-btn-secondary"
                          style={{ minHeight: 28, padding: '0 8px', fontSize: 11 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTx(tx);
                          }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination Controls ── */}
      {total > LIMIT && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px' }}>
          <div style={{ fontSize: 12, color: 'var(--admin-muted)' }}>
            Showing {page * LIMIT + 1} to {Math.min((page + 1) * LIMIT, total)} of {total} transactions
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="admin-btn-secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              style={{ minHeight: 32, padding: '0 12px' }}
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--admin-text)' }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              className="admin-btn-secondary"
              disabled={(page + 1) * LIMIT >= total}
              onClick={() => setPage((p) => p + 1)}
              style={{ minHeight: 32, padding: '0 12px' }}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Transaction Detail Drawer ── */}
      {selectedTx && (
        <TransactionDetailDrawer
          tx={selectedTx}
          onClose={() => setSelectedTx(null)}
        />
      )}
    </div>
  );
}
