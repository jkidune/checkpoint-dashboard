import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Clock3, FileText, RefreshCw, XCircle,
  ArrowRight, X, ShieldCheck, Calculator, Phone, Landmark, BadgeCheck,
} from 'lucide-react';
import { loanRequests } from '../api';
import { fmt, showToast, useApi } from '../components/UI';

function badge(status) {
  if (status === 'accepted' || status === 'converted') return 'active';
  if (status === 'rejected') return 'overdue';
  return 'pending';
}

function yesNo(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '—';
}

function DataRow({ label, value, strong = false, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--admin-border)', fontSize: 12 }}>
      <span style={{ color: 'var(--admin-muted)' }}>{label}</span>
      <span style={{ fontWeight: strong ? 700 : 600, color: tone || 'var(--admin-text)', textAlign: 'right' }}>{value ?? '—'}</span>
    </div>
  );
}

function RequestReviewModal({ row, working, onClose, onReview, onConvert, onOpenLoan }) {
  if (!row) return null;
  const eligibility = row.eligibility;
  const hardBlockers = [];
  if (row.match_status !== 'matched') hardBlockers.push('Member match must be resolved before approval.');
  if (row.exceeds_eligibility) hardBlockers.push('Requested principal exceeds the FY borrowing limit.');
  if (row.committee_approved === false) hardBlockers.push('The Form says the executive committee has not approved this request.');
  if (row.oath_accepted === false) hardBlockers.push('The applicant did not accept the repayment oath.');
  const canAccept = hardBlockers.length === 0;

  return (
    <div className="admin-modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="admin-modal-panel" style={{ maxWidth: 820 }}>
        <div className="admin-modal-header">
          <div>
            <div className="admin-eyebrow">Loan request review</div>
            <h3 style={{ marginTop: 2 }}>{row.member_name}</h3>
            <p style={{ color: 'var(--admin-muted)', fontSize: 12, marginTop: 3 }}>
              {fmt(row.amount_requested)} requested · FY{row.fiscal_year || '—'} · {row.requested_date}
            </p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
          <section style={{ border: '1px solid var(--admin-border)', borderRadius: 12, padding: 14, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, fontWeight: 700, fontSize: 13 }}>
              <FileText size={14} /> Google Form submission
            </div>
            <DataRow label="Applicant" value={row.member_name} strong />
            <DataRow label="Requested principal" value={fmt(row.amount_requested)} strong />
            <DataRow label="Submitted interest" value={row.submitted_interest_amount == null ? '—' : fmt(row.submitted_interest_amount)} />
            <DataRow label="Repayment months" value={row.requested_term_months ?? '—'} />
            <DataRow label="Monthly repayment" value={row.submitted_monthly_repayment == null ? '—' : fmt(row.submitted_monthly_repayment)} />
            <DataRow label="Has another debt" value={yesNo(row.has_other_debt)} />
            <DataRow label="Last loan month" value={row.last_loan_month || '—'} />
            <DataRow label="Last loan amount" value={row.last_loan_amount == null ? '—' : fmt(row.last_loan_amount)} />
            <DataRow label="Previous repayment completed" value={row.repayments_completed_by || '—'} />
            <DataRow label="Committee approved" value={yesNo(row.committee_approved)} tone={row.committee_approved === false ? 'var(--admin-red)' : undefined} />
            <DataRow label="Disbursement phone" value={row.disbursement_phone || '—'} />
            <DataRow label="Repayment oath" value={yesNo(row.oath_accepted)} tone={row.oath_accepted === false ? 'var(--admin-red)' : undefined} />
          </section>

          <section style={{ border: '1px solid var(--admin-border)', borderRadius: 12, padding: 14, background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, fontWeight: 700, fontSize: 13 }}>
              <Calculator size={14} /> Checkpoint calculation
            </div>
            {eligibility ? (
              <>
                <DataRow label="Contributions" value={fmt(eligibility.total_contributions)} />
                <DataRow label="Historical loan interest" value={fmt(eligibility.total_loan_interest)} />
                <DataRow label="Paid fines" value={fmt(eligibility.paid_fines)} />
                <DataRow label="Member net worth" value={fmt(eligibility.net_worth)} strong />
                <DataRow label={`FY${eligibility.fiscal_year} borrowing ratio`} value={eligibility.loan_max_ratio == null ? 'No cap' : `${Math.round(eligibility.loan_max_ratio * 100)}%`} />
                <DataRow label="Maximum eligible loan" value={eligibility.max_eligible == null ? 'No cap' : fmt(eligibility.max_eligible)} strong />
                <DataRow label={`FY${eligibility.fiscal_year} interest rate`} value={`${((eligibility.interest_rate || 0) * 100).toFixed(0)}%`} />
                <DataRow label="Expected interest" value={row.expected_interest_amount == null ? '—' : fmt(row.expected_interest_amount)} strong />
                <DataRow label="FY repayment term" value={eligibility.repayment_months ? `${eligibility.repayment_months} months` : 'No fixed term'} />
                <DataRow label="Active/overdue loans" value={row.active_loan_count ?? '—'} />
              </>
            ) : (
              <div style={{ padding: '20px 0', color: 'var(--admin-muted)', fontSize: 12 }}>Eligibility could not be calculated.</div>
            )}

            {row.submitted_interest_matches_rule === true && (
              <div style={{ marginTop: 12, padding: 10, borderRadius: 9, background: '#ecfdf5', border: '1px solid #bbf7d0', color: '#166534', fontSize: 11.5, fontWeight: 650 }}>
                <BadgeCheck size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} /> Submitted interest matches the FY rule.
              </div>
            )}
            {row.submitted_interest_matches_rule === false && (
              <div style={{ marginTop: 12, padding: 10, borderRadius: 9, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 11.5 }}>
                <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} /> Form interest differs from Checkpoint. Checkpoint's FY calculation will remain authoritative.
              </div>
            )}
          </section>
        </div>

        {(hardBlockers.length > 0 || (row.review_warnings || []).length > 0) && (
          <section style={{ marginTop: 14, border: '1px solid #fed7aa', borderRadius: 10, background: '#fff7ed', padding: 12 }}>
            <div style={{ fontWeight: 700, color: '#9a3412', fontSize: 12, marginBottom: 5 }}>Review flags</div>
            {[...hardBlockers, ...(row.review_warnings || []).filter((warning) => !hardBlockers.includes(warning))].map((warning) => (
              <div key={warning} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: '#7c2d12', marginTop: 4 }}>
                <AlertTriangle size={13} style={{ marginTop: 2, flexShrink: 0 }} /> {warning}
              </div>
            ))}
          </section>
        )}

        <section style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: 12, borderRadius: 10, background: '#f4f4f5', border: '1px solid var(--admin-border)' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--admin-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Current status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
              <span className={`admin-badge is-${badge(row.review_status)}`}>{row.review_status}</span>
              {row.linked_loan_id && <span style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>Linked Loan #{row.linked_loan_id}</span>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {row.review_status === 'pending' && (
              <>
                <button type="button" className="admin-btn-secondary" disabled={working} onClick={() => onReview(row, 'rejected')}><XCircle size={13} /> Reject</button>
                <button type="button" className="admin-btn-primary" disabled={working || !canAccept} onClick={() => onReview(row, 'accepted')}><ShieldCheck size={13} /> Accept & continue</button>
              </>
            )}
            {row.review_status === 'accepted' && (
              <>
                <button type="button" className="admin-btn-secondary" disabled={working} onClick={() => onReview(row, 'pending')}>Return to pending</button>
                <button type="button" className="admin-btn-primary" disabled={working || row.exceeds_eligibility} onClick={() => onConvert(row)}><ArrowRight size={13} /> Create pending loan</button>
              </>
            )}
            {row.review_status === 'converted' && row.linked_loan_id && (
              <button type="button" className="admin-btn-primary" onClick={() => onOpenLoan(row.linked_loan_id)}><Landmark size={13} /> Open pending loan</button>
            )}
            {row.review_status === 'rejected' && (
              <button type="button" className="admin-btn-secondary" disabled={working} onClick={() => onReview(row, 'pending')}>Return to pending</button>
            )}
          </div>
        </section>

        {row.disbursement_phone && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--admin-muted)' }}>
            <Phone size={13} /> Requested disbursement destination: <strong style={{ color: 'var(--admin-text)' }}>{row.disbursement_phone}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoanRequests() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('pending');
  const [workingId, setWorkingId] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
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
      const response = await loanRequests.review(row._id, { status, note: note || null });
      const updated = response.data;
      setSelectedRequest(updated);
      if (status === 'accepted') {
        setFilter('accepted');
        showToast('Request accepted. Review is still open — create the pending loan when ready.');
      } else if (status === 'rejected') {
        showToast('Loan request rejected.');
      } else {
        setFilter('pending');
        showToast('Loan request returned to pending review.');
      }
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
      const loan = response.data?.loan;
      setSelectedRequest((current) => ({ ...current, review_status: 'converted', linked_loan_id: loan?.id || current?.linked_loan_id }));
      setFilter('converted');
      showToast(`Pending ${loan?.loan_number || 'loan'} created. It has not been disbursed.`);
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
            <div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>Open a request to review the Form details, eligibility and FY calculations before accepting it.</div>
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
            <thead><tr><th>Date</th><th>Member</th><th className="is-numeric">Requested</th><th>FY rule / eligibility</th><th>Review flags</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const eligibility = row.eligibility;
                return (
                  <tr key={row._id} onClick={() => setSelectedRequest(row)} style={{ cursor: 'pointer' }}>
                    <td><strong>{row.requested_date}</strong><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>FY{row.fiscal_year || '—'}</div></td>
                    <td>
                      <strong>{row.member_name}</strong>
                      <div style={{ marginTop: 3 }}><span className={`admin-badge is-${row.match_status === 'matched' ? 'active' : 'pending'}`}>{row.match_status}{row.matched_member_id ? ` · #${row.matched_member_id}` : ''}</span></div>
                    </td>
                    <td className="is-numeric"><strong>{fmt(row.amount_requested)}</strong></td>
                    <td style={{ minWidth: 250 }}>
                      {eligibility ? (
                        <div style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                          <div>Net worth <strong>{fmt(eligibility.net_worth)}</strong> · Max {eligibility.loan_max_ratio == null ? '—' : `${Math.round(eligibility.loan_max_ratio * 100)}%`} <strong>{eligibility.max_eligible == null ? 'No cap' : fmt(eligibility.max_eligible)}</strong></div>
                          <div style={{ color: 'var(--admin-muted)' }}>FY interest {((eligibility.interest_rate || 0) * 100).toFixed(0)}% · Expected {row.expected_interest_amount == null ? '—' : fmt(row.expected_interest_amount)}</div>
                        </div>
                      ) : <span style={{ color: 'var(--admin-muted)' }}>Eligibility unavailable</span>}
                    </td>
                    <td>
                      {(row.review_warnings || []).length > 0 || row.exceeds_eligibility ? (
                        <span className="admin-badge is-overdue"><AlertTriangle size={11} /> {(row.review_warnings || []).length + (row.exceeds_eligibility ? 1 : 0)} flag(s)</span>
                      ) : (
                        <span style={{ color: 'var(--admin-green)', fontSize: 11.5, fontWeight: 650 }}><CheckCircle2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Ready to review</span>
                      )}
                    </td>
                    <td><span className={`admin-badge is-${badge(row.review_status)}`}>{row.review_status}</span>{row.linked_loan_id && <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', marginTop: 3 }}>Loan #{row.linked_loan_id}</div>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="admin-btn-secondary" onClick={(event) => { event.stopPropagation(); setSelectedRequest(row); }}>
                        <FileText size={13} /> Review
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--admin-muted)', padding: 32 }}>No {filter === 'all' ? '' : filter} loan requests.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRequest && (
        <RequestReviewModal
          row={selectedRequest}
          working={workingId === selectedRequest._id}
          onClose={() => setSelectedRequest(null)}
          onReview={review}
          onConvert={convert}
          onOpenLoan={(loanId) => navigate(`/loans?loan=${loanId}`)}
        />
      )}
    </div>
  );
}
