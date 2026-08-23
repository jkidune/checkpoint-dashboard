import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, FileText, RefreshCw, XCircle, ArrowRight } from 'lucide-react';
import { loanRequests } from '../api';
import { fmt, showToast, useApi } from '../components/UI';

function badge(status) {
  if (status === 'accepted' || status === 'converted') return 'active';
  if (status === 'rejected') return 'overdue';
  return 'pending';
}

export default function LoanRequests() {
  const [filter, setFilter] = useState('pending');
  const [workingId, setWorkingId] = useState(null);
  const { data, loading, refetch } = useApi(() => loanRequests.list({ status: filter }), [filter]);
  const rows = data || [];

  const summary = useMemo(() => ({
    total: rows.length,
    overLimit: rows.filter((row) => row.exceeds_eligibility).length,
    unmatched: rows.filter((row) => row.match_status !== 'matched').length,
    accepted: rows.filter((row) => row.review_status === 'accepted').length,
  }), [rows]);

  const review = async (row, status) => {
    const note = status === 'rejected' ? window.prompt('Reason for rejection (optional):', '') : '';
    setWorkingId(row._id);
    try {
      await loanRequests.review(row._id, { status, note: note || null });
      showToast(status === 'accepted' ? 'Loan request accepted for loan preparation.' : status === 'rejected' ? 'Loan request rejected.' : 'Loan request returned to review.');
      await refetch();
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to update loan request', 'error');
    } finally {
      setWorkingId(null);
    }
  };

  const convert = async (row) => {
    if (!window.confirm(`Create a pending loan for ${row.member_name} for ${fmt(row.amount_requested)}? No money will be disbursed yet.`)) return;
    setWorkingId(row._id);
    try {
      const response = await loanRequests.convert(row._id);
      showToast(`Pending ${response.data?.loan?.loan_number || 'loan'} created. Open Loans to review and activate when approved for disbursement.`);
      await refetch();
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to create pending loan', 'error');
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="admin-page-container">
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Loan Requests</h1>
          <p>Review Google Form loan requests against the member net-worth and FY loan rules before creating a loan.</p>
        </div>
        <button type="button" className="admin-btn-secondary" onClick={refetch}><RefreshCw size={14} /> Refresh</button>
      </header>

      <section className="admin-stats-grid">
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Visible requests</span><FileText size={15} /></div><strong>{summary.total}</strong><span className="stat-sub">Current filter: {filter}</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Over FY limit</span><AlertTriangle size={15} /></div><strong>{summary.overLimit}</strong><span className="stat-sub">Need correction or manual override</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Match issues</span><AlertTriangle size={15} /></div><strong>{summary.unmatched}</strong><span className="stat-sub">Ambiguous or unmatched members</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Accepted</span><CheckCircle2 size={15} /></div><strong>{summary.accepted}</strong><span className="stat-sub">Ready to create pending loan</span></div>
      </section>

      <div className="admin-table-card">
        <div style={{ padding: 16, borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontSize: 14 }}>Incoming loan applications</strong>
            <div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>Acceptance does not disburse money. It only allows a pending loan record to be prepared.</div>
          </div>
          <select value={filter} onChange={(event) => setFilter(event.target.value)} style={{ minHeight: 36, borderRadius: 8, border: '1px solid var(--admin-border)', background: '#fff', padding: '0 10px' }}>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="converted">Converted</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>Date</th><th>Member</th><th className="is-numeric">Requested</th><th>FY rule / eligibility</th><th>Purpose</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const eligibility = row.eligibility;
                const canAccept = row.match_status === 'matched' && !row.exceeds_eligibility;
                return (
                  <tr key={row._id}>
                    <td><strong>{row.requested_date}</strong><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>FY{row.fiscal_year || '—'}</div></td>
                    <td>
                      <strong>{row.member_name}</strong>
                      <div style={{ marginTop: 3 }}><span className={`admin-badge is-${row.match_status === 'matched' ? 'active' : 'pending'}`}>{row.match_status}{row.matched_member_id ? ` · #${row.matched_member_id}` : ''}</span></div>
                    </td>
                    <td className="is-numeric"><strong>{fmt(row.amount_requested)}</strong></td>
                    <td style={{ minWidth: 260 }}>
                      {eligibility ? (
                        <div style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                          <div>Net worth <strong>{fmt(eligibility.net_worth)}</strong> · Max {Math.round((eligibility.loan_max_ratio || 0) * 100)}% <strong>{eligibility.max_eligible == null ? 'No cap' : fmt(eligibility.max_eligible)}</strong></div>
                          <div style={{ color: 'var(--admin-muted)' }}>Contributions {fmt(eligibility.total_contributions)} + Interest {fmt(eligibility.total_loan_interest)} + Paid fines {fmt(eligibility.paid_fines)}</div>
                          <div style={{ color: 'var(--admin-muted)' }}>FY{eligibility.fiscal_year} interest rate: {((eligibility.interest_rate || 0) * 100).toFixed(0)}%</div>
                          {row.exceeds_eligibility && <div style={{ marginTop: 3 }}><span className="admin-badge is-overdue">Exceeds eligibility</span></div>}
                        </div>
                      ) : <span style={{ color: 'var(--admin-muted)' }}>Eligibility unavailable</span>}
                    </td>
                    <td>{row.purpose || row.notes || '—'}</td>
                    <td><span className={`admin-badge is-${badge(row.review_status)}`}>{row.review_status}</span>{row.linked_loan_id && <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', marginTop: 3 }}>Loan #{row.linked_loan_id}</div>}</td>
                    <td style={{ textAlign: 'right' }}>
                      {row.review_status === 'pending' && (
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button type="button" className="admin-btn-secondary" disabled={workingId === row._id || !canAccept} onClick={() => review(row, 'accepted')}><CheckCircle2 size={13} /> Accept</button>
                          <button type="button" className="admin-btn-secondary" disabled={workingId === row._id} onClick={() => review(row, 'rejected')}><XCircle size={13} /> Reject</button>
                        </div>
                      )}
                      {row.review_status === 'accepted' && (
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button type="button" className="admin-btn-primary" disabled={workingId === row._id || row.exceeds_eligibility} onClick={() => convert(row)}><ArrowRight size={13} /> Create pending loan</button>
                          <button type="button" className="admin-btn-secondary" disabled={workingId === row._id} onClick={() => review(row, 'pending')}>Return</button>
                        </div>
                      )}
                      {row.review_status === 'converted' && <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', color: 'var(--admin-green)', fontSize: 11.5, fontWeight: 700 }}><CheckCircle2 size={14} /> Pending loan created</span>}
                      {row.review_status === 'rejected' && <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', color: 'var(--admin-muted)', fontSize: 11.5 }}><Clock3 size={13} /> Closed</span>}
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--admin-muted)', padding: 32 }}>No {filter === 'all' ? '' : filter} loan requests.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
