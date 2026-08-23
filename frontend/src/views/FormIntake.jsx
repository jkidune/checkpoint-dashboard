import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, RefreshCw, XCircle } from 'lucide-react';
import { formIntake } from '../api';
import { useApi, showToast, fmt } from '../components/UI';

function badge(status) {
  if (status === 'accepted') return 'active';
  if (status === 'rejected') return 'overdue';
  return 'pending';
}

function typeLabel(type) {
  return ({ monthly: 'Monthly contribution', loan_repayment: 'Loan repayment', fine: 'Fine payment' }[type] || type);
}

export default function FormIntake() {
  const [filter, setFilter] = useState('pending');
  const { data, loading, refetch } = useApi(() => formIntake.list({ status: filter }), [filter]);
  const [workingId, setWorkingId] = useState(null);

  const rows = data || [];
  const summary = useMemo(() => ({
    total: rows.length,
    duplicates: rows.filter((row) => row.duplicate_reference).length,
    unmatched: rows.filter((row) => row.match_status !== 'matched').length,
  }), [rows]);

  const review = async (row, status) => {
    const note = status === 'rejected' ? window.prompt('Reason for rejection (optional):', '') : '';
    setWorkingId(row._id);
    try {
      await formIntake.review(row._id, { status, note: note || null });
      showToast(status === 'accepted' ? 'Submission marked accepted for posting review.' : 'Submission rejected.');
      refetch();
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to update submission', 'error');
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="admin-page-container">
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Form Intake</h1>
          <p>Review Google Form submissions before they affect contributions, loans, fines or transactions.</p>
        </div>
        <button type="button" className="admin-btn-secondary" onClick={refetch}><RefreshCw size={14} /> Refresh</button>
      </header>

      <section className="admin-stats-grid">
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Visible submissions</span><Inbox size={15} /></div><strong>{summary.total}</strong><span className="stat-sub">Current filter: {filter}</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Duplicate references</span><AlertTriangle size={15} /></div><strong>{summary.duplicates}</strong><span className="stat-sub">Must be reviewed before posting</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Member match issues</span><AlertTriangle size={15} /></div><strong>{summary.unmatched}</strong><span className="stat-sub">Ambiguous or unmatched names</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Posting mode</span><CheckCircle2 size={15} /></div><strong style={{ fontSize: 18 }}>Review only</strong><span className="stat-sub">Acceptance does not post money yet</span></div>
      </section>

      <div className="admin-table-card">
        <div style={{ padding: 16, borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontSize: 14 }}>Incoming submissions</strong>
            <div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>A submission can be accepted or rejected here, but financial posting remains a separate controlled step.</div>
          </div>
          <select value={filter} onChange={(event) => setFilter(event.target.value)} style={{ minHeight: 36, borderRadius: 8, border: '1px solid var(--admin-border)', background: '#fff', padding: '0 10px' }}>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr><th>Submitted</th><th>Member</th><th>Type</th><th>Amount</th><th>Allocation</th><th>Reference</th><th>Review</th><th style={{ textAlign: 'right' }}>Action</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id}>
                  <td><strong>{row.payment_date}</strong><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>{row.created_at ? new Date(row.created_at).toLocaleString('en-GB') : ''}</div></td>
                  <td>
                    <strong>{row.member_name}</strong>
                    <div style={{ marginTop: 3 }}><span className={`admin-badge is-${row.match_status === 'matched' ? 'active' : 'pending'}`}>{row.match_status}{row.matched_member_id ? ` · #${row.matched_member_id}` : ''}</span></div>
                  </td>
                  <td>{typeLabel(row.type)}</td>
                  <td><strong>{fmt(row.amount)}</strong></td>
                  <td>{row.type === 'monthly' ? (row.months || []).join(', ') || 'No month selected' : '—'}</td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{row.mpesa_ref || '—'}</span>
                    {row.duplicate_reference && <div style={{ marginTop: 4 }}><span className="admin-badge is-overdue">Possible duplicate</span></div>}
                  </td>
                  <td><span className={`admin-badge is-${badge(row.review_status)}`}>{row.review_status}</span>{row.review_note && <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', marginTop: 4 }}>{row.review_note}</div>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {row.review_status === 'pending' ? (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="admin-btn-secondary" disabled={workingId === row._id || row.duplicate_reference || row.match_status !== 'matched'} onClick={() => review(row, 'accepted')}><CheckCircle2 size={13} /> Accept</button>
                        <button type="button" className="admin-btn-secondary" disabled={workingId === row._id} onClick={() => review(row, 'rejected')}><XCircle size={13} /> Reject</button>
                      </div>
                    ) : (
                      <button type="button" className="admin-btn-secondary" disabled={workingId === row._id} onClick={() => review(row, 'pending')}>Return to review</button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan="8" style={{ textAlign: 'center', color: 'var(--admin-muted)', padding: 32 }}>No {filter === 'all' ? '' : filter} form submissions.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
