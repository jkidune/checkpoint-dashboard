import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { loanRequests } from '../api';
import { fmt, showToast, useApi } from '../components/UI';
import LoanApprovalAssessment from '../components/LoanApprovalAssessment';

function badge(status) {
  if (status === 'accepted' || status === 'converted') return 'active';
  if (status === 'rejected') return 'overdue';
  return 'pending';
}

function yesNo(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Not confirmed';
}

function DataRow({ label, value, strong = false, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--admin-border)', fontSize: 11.5 }}>
      <span style={{ color: 'var(--admin-muted)' }}>{label}</span>
      <span style={{ fontWeight: strong ? 700 : 600, color: tone || 'var(--admin-text)', textAlign: 'right', maxWidth: '62%' }}>{value ?? '—'}</span>
    </div>
  );
}

function RequestReviewModal({ row, onClose, onChanged, onOpenLoan }) {
  const [workbench, setWorkbench] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const loadWorkbench = async () => {
    setLoading(true);
    try {
      const response = await loanRequests.workbench(row._id);
      setWorkbench(response.data);
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to run loan approval checks', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadWorkbench(); }, [row._id]);

  const request = workbench?.request || row;
  const assessment = workbench?.assessment || null;
  const eligible = Boolean(assessment?.eligible && !(assessment?.blockers || []).length);

  const review = async (status) => {
    const note = status === 'rejected' ? window.prompt('Reason for rejection (optional):', '') : '';
    setWorking(true);
    try {
      await loanRequests.review(row._id, { status, note: note || null });
      if (status === 'accepted') showToast('Request accepted for the next stage. No loan has been approved or disbursed yet.');
      else if (status === 'rejected') showToast('Loan request rejected.');
      else showToast('Loan request returned to pending review.');
      await loadWorkbench();
      await onChanged();
    } catch (error) {
      if (error.response?.data?.assessment) {
        setWorkbench((current) => ({ ...(current || {}), assessment: error.response.data.assessment }));
      }
      showToast(error.response?.data?.error || 'Failed to update loan request', 'error');
    } finally {
      setWorking(false);
    }
  };

  const convert = async () => {
    const confirmed = window.confirm(
      `Create a pending loan for ${request.member_name} for ${fmt(request.amount_requested)}? This still does not disburse money.`,
    );
    if (!confirmed) return;
    setWorking(true);
    try {
      const response = await loanRequests.convert(row._id);
      const loan = response.data?.loan;
      showToast(`Pending ${loan?.loan_number || 'loan'} created. Final approval/disbursement is still required.`);
      await loadWorkbench();
      await onChanged();
    } catch (error) {
      if (error.response?.data?.assessment) {
        setWorkbench((current) => ({ ...(current || {}), assessment: error.response.data.assessment }));
      }
      showToast(error.response?.data?.error || 'Failed to create pending loan', 'error');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={(event) => event.target === event.currentTarget && !working && onClose()}>
      <div className="admin-modal-panel" style={{ maxWidth: 1060, maxHeight: '94vh', overflowY: 'auto' }}>
        <div className="admin-modal-header" style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff' }}>
          <div>
            <div className="admin-eyebrow">Loan request approval workbench</div>
            <h3 style={{ marginTop: 2 }}>{request.member_name}</h3>
            <p style={{ color: 'var(--admin-muted)', fontSize: 11.5, marginTop: 3 }}>
              {fmt(request.amount_requested)} requested · FY{request.fiscal_year || assessment?.fiscal_year || '—'} · {request.requested_date}
            </p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose} disabled={working}><X size={18} /></button>
        </div>

        <div style={{ padding: '0 18px 18px', display: 'grid', gap: 15 }}>
          <div style={{ padding: 11, borderRadius: 9, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', fontSize: 11.5, lineHeight: 1.5 }}>
            <strong>Approval sequence:</strong> first verify this Form request and the member’s live financial position. Accepting the request only moves it to the next stage. Creating a pending loan still does not move cash. Checkpoint will run the same live financial clearance again immediately before final activation/disbursement.
          </div>

          <section style={{ border: '1px solid var(--admin-border)', borderRadius: 11, padding: 13, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5, fontWeight: 700, fontSize: 12.5 }}>
              <FileText size={14} /> Member’s Google Form declaration
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0 24px' }}>
              <div>
                <DataRow label="Applicant" value={request.member_name} strong />
                <DataRow label="Member match" value={request.match_status === 'matched' ? `Matched to #${request.matched_member_id}` : request.match_status} tone={request.match_status === 'matched' ? '#166534' : '#b91c1c'} />
                <DataRow label="Requested principal" value={fmt(request.amount_requested)} strong />
                <DataRow label="Purpose" value={request.purpose || 'Not provided'} />
                <DataRow label="Requested term" value={request.requested_term_months == null ? 'Not provided' : `${request.requested_term_months} months`} />
                <DataRow label="Submitted interest" value={request.submitted_interest_amount == null ? 'Not provided' : fmt(request.submitted_interest_amount)} />
                <DataRow label="Submitted monthly repayment" value={request.submitted_monthly_repayment == null ? 'Not provided' : fmt(request.submitted_monthly_repayment)} />
              </div>
              <div>
                <DataRow label="Has another debt" value={yesNo(request.has_other_debt)} />
                <DataRow label="Last loan month" value={request.last_loan_month || 'Not provided'} />
                <DataRow label="Last loan amount" value={request.last_loan_amount == null ? 'Not provided' : fmt(request.last_loan_amount)} />
                <DataRow label="Previous repayment completed" value={request.repayments_completed_by || 'Not provided'} />
                <DataRow label="Committee approved" value={yesNo(request.committee_approved)} strong tone={request.committee_approved === true ? '#166534' : '#b91c1c'} />
                <DataRow label="Repayment oath accepted" value={yesNo(request.oath_accepted)} strong tone={request.oath_accepted === true ? '#166534' : '#b91c1c'} />
                <DataRow label="Disbursement phone/account" value={request.disbursement_phone || 'Not provided'} />
              </div>
            </div>
            {request.notes && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#fafafa', border: '1px solid var(--admin-border)', fontSize: 11.5, lineHeight: 1.5 }}>
                <strong>Applicant notes:</strong> {request.notes}
              </div>
            )}
          </section>

          <section style={{ border: '1px solid var(--admin-border)', borderRadius: 11, padding: 13, background: '#fff' }}>
            <LoanApprovalAssessment
              assessment={assessment}
              loading={loading}
              onRefresh={loadWorkbench}
              title="Form request clearance"
            />
          </section>

          <section style={{ border: '1px solid var(--admin-border)', borderRadius: 11, padding: 12, background: '#fafafa', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Application status</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                <span className={`admin-badge is-${badge(request.review_status)}`}>{request.review_status}</span>
                {request.linked_loan_id && <span style={{ fontSize: 11, color: 'var(--admin-muted)' }}>Pending Loan #{request.linked_loan_id}</span>}
              </div>
              <div style={{ marginTop: 5, fontSize: 10.5, color: eligible ? '#166534' : '#991b1b' }}>
                {eligible ? 'Live clearance is currently clean.' : 'Acceptance/creation is server-blocked until every red clearance item is resolved.'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {request.review_status === 'pending' && (
                <>
                  <button type="button" className="admin-btn-secondary" disabled={working} onClick={() => review('rejected')}><XCircle size={13} /> Reject</button>
                  <button type="button" className="admin-btn-primary" disabled={working || loading || !eligible} onClick={() => review('accepted')} title={!eligible ? 'Clear all blocking items first' : 'Accept this application for the next stage'}><ShieldCheck size={13} /> Accept request</button>
                </>
              )}
              {request.review_status === 'accepted' && (
                <>
                  <button type="button" className="admin-btn-secondary" disabled={working} onClick={() => review('pending')}>Return to pending</button>
                  <button type="button" className="admin-btn-primary" disabled={working || loading || !eligible} onClick={convert} title={!eligible ? 'The live checks must pass again before creating the loan' : 'Create a pending, not-yet-disbursed loan'}><ArrowRight size={13} /> Create pending loan</button>
                </>
              )}
              {request.review_status === 'converted' && request.linked_loan_id && (
                <button type="button" className="admin-btn-primary" onClick={() => onOpenLoan(request.linked_loan_id)}><Landmark size={13} /> Open pending loan</button>
              )}
              {request.review_status === 'rejected' && (
                <button type="button" className="admin-btn-secondary" disabled={working} onClick={() => review('pending')}>Return to pending</button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function LoanRequestsV2() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('pending');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const { data, loading, refetch } = useApi(() => loanRequests.list({ status: filter }), [filter]);
  const rows = data || [];

  const summary = useMemo(() => ({
    total: rows.length,
    overLimit: rows.filter((row) => row.exceeds_eligibility).length,
    unmatched: rows.filter((row) => row.match_status !== 'matched').length,
    accepted: rows.filter((row) => row.review_status === 'accepted').length,
  }), [rows]);

  return (
    <div className="admin-page-container">
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Loan Requests</h1>
          <p>Review each Form request against live membership, arrears, fines, existing loans and FY borrowing rules before it can move toward approval.</p>
        </div>
        <button type="button" className="admin-btn-secondary" onClick={refetch}><RefreshCw size={14} /> Refresh</button>
      </header>

      <section className="admin-stats-grid">
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Visible requests</span><FileText size={15} /></div><strong>{summary.total}</strong><span className="stat-sub">Current filter: {filter}</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Over borrowing limit</span><AlertTriangle size={15} /></div><strong>{summary.overLimit}</strong><span className="stat-sub">Hard blocker when reviewed</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Member match issues</span><AlertTriangle size={15} /></div><strong>{summary.unmatched}</strong><span className="stat-sub">Must be resolved first</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Accepted requests</span><CheckCircle2 size={15} /></div><strong>{summary.accepted}</strong><span className="stat-sub">Still not approved/disbursed</span></div>
      </section>

      <div style={{ marginBottom: 14, padding: 11, borderRadius: 9, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 11.5, color: '#1e3a8a' }}>
        <strong>Important:</strong> the table only summarizes the submitted request. Open <strong>Review</strong> to run the live clearance workbench. The backend repeats those checks when accepting, when creating the pending loan, and again before disbursement.
      </div>

      <div className="admin-table-card">
        <div style={{ padding: 16, borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontSize: 14 }}>Incoming loan applications</strong>
            <div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>Form data is evidence. Checkpoint’s live records and configured FY rules determine clearance.</div>
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
            <thead><tr><th>Date</th><th>Member</th><th className="is-numeric">Requested</th><th>Form / FY preview</th><th>Initial flags</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const eligibility = row.eligibility;
                const initialFlags = (row.review_warnings || []).length + (row.exceeds_eligibility ? 1 : 0) + (row.match_status !== 'matched' ? 1 : 0);
                return (
                  <tr key={row._id} onClick={() => setSelectedRequest(row)} style={{ cursor: 'pointer' }}>
                    <td><strong>{row.requested_date}</strong><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>FY{row.fiscal_year || '—'}</div></td>
                    <td><strong>{row.member_name}</strong><div style={{ marginTop: 3 }}><span className={`admin-badge is-${row.match_status === 'matched' ? 'active' : 'pending'}`}>{row.match_status}{row.matched_member_id ? ` · #${row.matched_member_id}` : ''}</span></div></td>
                    <td className="is-numeric"><strong>{fmt(row.amount_requested)}</strong></td>
                    <td style={{ minWidth: 250 }}>
                      {eligibility ? (
                        <div style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                          <div>Net worth <strong>{fmt(eligibility.net_worth)}</strong> · Ceiling <strong>{eligibility.max_eligible == null ? 'No cap' : fmt(eligibility.max_eligible)}</strong></div>
                          <div style={{ color: 'var(--admin-muted)' }}>Interest {((eligibility.interest_rate || 0) * 100).toFixed(0)}% · Expected {row.expected_interest_amount == null ? '—' : fmt(row.expected_interest_amount)}</div>
                        </div>
                      ) : <span style={{ color: 'var(--admin-muted)' }}>Open review for live calculation</span>}
                    </td>
                    <td>{initialFlags > 0 ? <span className="admin-badge is-overdue"><AlertTriangle size={11} /> {initialFlags} initial flag(s)</span> : <span style={{ color: 'var(--admin-muted)', fontSize: 11.5 }}><Clock3 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Run live checks</span>}</td>
                    <td><span className={`admin-badge is-${badge(row.review_status)}`}>{row.review_status}</span>{row.linked_loan_id && <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', marginTop: 3 }}>Loan #{row.linked_loan_id}</div>}</td>
                    <td style={{ textAlign: 'right' }}><button type="button" className="admin-btn-secondary" onClick={(event) => { event.stopPropagation(); setSelectedRequest(row); }}><FileText size={13} /> Review</button></td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--admin-muted)', padding: 32 }}>No {filter === 'all' ? '' : filter} loan requests.</td></tr>}
              {loading && rows.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--admin-muted)', padding: 32 }}><Loader2 size={18} className="animate-spin" /> Loading loan requests…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRequest && (
        <RequestReviewModal
          row={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onChanged={refetch}
          onOpenLoan={(loanId) => navigate(`/loans?loan=${loanId}`)}
        />
      )}
    </div>
  );
}
