import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  RefreshCw,
  XCircle,
  ArrowRight,
  Banknote,
  ReceiptText,
  X,
  Loader2,
} from 'lucide-react';
import { formIntake } from '../api';
import { useApi, showToast, fmt } from '../components/UI';

function badge(status) {
  if (status === 'accepted' || status === 'posted') return 'active';
  if (status === 'rejected') return 'overdue';
  return 'pending';
}

function typeLabel(type) {
  return ({ monthly: 'Monthly contribution', loan_repayment: 'Loan repayment', fine: 'Fine payment' }[type] || type);
}

function AllocationModal({ row, onClose, onPosted }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [selection, setSelection] = useState({ loan_id: '', fine_id: '' });

  const loadPreview = async (nextSelection = selection) => {
    setLoading(true);
    try {
      const response = await formIntake.preview(row._id, {
        loan_id: nextSelection.loan_id || null,
        fine_id: nextSelection.fine_id || null,
      });
      setPreview(response.data);
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to prepare allocation preview', 'error');
      setPreview(error.response?.data?.preview || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview({ loan_id: '', fine_id: '' });
    // The intake row does not change while this modal is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row._id]);

  const chooseLoan = (value) => {
    const next = { ...selection, loan_id: value };
    setSelection(next);
    loadPreview(next);
  };

  const chooseFine = (value) => {
    const next = { ...selection, fine_id: value };
    setSelection(next);
    loadPreview(next);
  };

  const confirmPost = async () => {
    if (!preview?.valid || posting) return;
    const confirmed = window.confirm(`Post ${fmt(row.amount)} for ${row.member_name} to the financial ledger? This will create/update live financial records.`);
    if (!confirmed) return;
    setPosting(true);
    try {
      const response = await formIntake.post(row._id, {
        loan_id: selection.loan_id || preview?.selected?.loan_id || null,
        fine_id: selection.fine_id || preview?.selected?.id || null,
      });
      showToast(response.data?.already_posted ? 'This intake was already posted.' : 'Payment posted successfully to the financial ledger.');
      onPosted();
      onClose();
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to post intake payment';
      showToast(message, 'error');
      if (error.response?.data?.preview) setPreview(error.response.data.preview);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="admin-modal-panel" style={{ maxWidth: 720 }}>
        <div className="admin-modal-header">
          <div>
            <h3>Review allocation</h3>
            <p style={{ color: 'var(--admin-muted)', fontSize: 12, marginTop: 3 }}>
              Nothing changes until you click Confirm & Post.
            </p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: '0 20px 18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, marginBottom: 16 }}>
            <div className="admin-stat-card" style={{ padding: 12 }}><span className="stat-sub">Member</span><strong style={{ fontSize: 13 }}>{row.member_name}</strong></div>
            <div className="admin-stat-card" style={{ padding: 12 }}><span className="stat-sub">Payment</span><strong style={{ fontSize: 14 }}>{fmt(row.amount)}</strong></div>
            <div className="admin-stat-card" style={{ padding: 12 }}><span className="stat-sub">Date</span><strong style={{ fontSize: 13 }}>{row.payment_date}</strong></div>
            <div className="admin-stat-card" style={{ padding: 12 }}><span className="stat-sub">Reference</span><strong style={{ fontSize: 11, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{row.mpesa_ref || '—'}</strong></div>
          </div>

          {loading ? (
            <div style={{ minHeight: 180, display: 'grid', placeItems: 'center', color: 'var(--admin-muted)' }}><Loader2 size={22} className="animate-spin" /></div>
          ) : preview ? (
            <>
              {preview.type === 'loan_repayment' && preview.candidates?.length > 1 && (
                <div className="admin-form-group">
                  <label>Apply repayment to loan</label>
                  <select value={selection.loan_id} onChange={(event) => chooseLoan(event.target.value)}>
                    <option value="">Choose loan…</option>
                    {preview.candidates.map((loan) => <option key={loan.loan_id} value={loan.loan_id}>{loan.loan_number} — {fmt(loan.balance)} outstanding</option>)}
                  </select>
                </div>
              )}

              {preview.type === 'fine' && preview.candidates?.length > 1 && (
                <div className="admin-form-group">
                  <label>Choose exact fine to settle</label>
                  <select value={selection.fine_id} onChange={(event) => chooseFine(event.target.value)}>
                    <option value="">Choose fine…</option>
                    {preview.candidates.map((fine) => <option key={fine.id} value={fine.id}>Fine #{fine.id} — {fmt(fine.amount)} — {fine.reason}</option>)}
                  </select>
                </div>
              )}

              {preview.type === 'monthly' && (
                <div className="admin-table-card" style={{ marginBottom: 14 }}>
                  <div style={{ padding: 12, borderBottom: '1px solid var(--admin-border)' }}><strong style={{ fontSize: 13 }}>Contribution allocation</strong></div>
                  <div className="admin-table-scroll">
                    <table className="admin-table">
                      <thead><tr><th>Month</th><th>Target</th><th>Already paid</th><th>Apply now</th><th>After posting</th><th>Late fine</th></tr></thead>
                      <tbody>
                        {(preview.allocations || []).map((item) => (
                          <tr key={`${item.year}-${item.month}`}>
                            <td><strong>{item.label}</strong><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>FY{item.fy}</div></td>
                            <td>{fmt(item.target)}</td>
                            <td>{fmt(item.existing_amount)}</td>
                            <td><strong>{fmt(item.amount_applied)}</strong></td>
                            <td>{fmt(item.amount_after)} <span className={`admin-badge is-${item.status_after === 'paid' ? 'active' : 'pending'}`}>{item.status_after}</span></td>
                            <td>{item.fine_to_create ? <span style={{ color: '#b91c1c', fontWeight: 650 }}>{fmt(item.fine_to_create.amount)}</span> : item.existing_fine_id ? 'Already assessed' : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: 12, borderTop: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span>Allocated <strong>{fmt(preview.amount_allocated)}</strong></span>
                    <span>Unallocated <strong style={{ color: preview.unallocated_remainder > 0 ? '#b91c1c' : 'var(--admin-green)' }}>{fmt(preview.unallocated_remainder)}</strong></span>
                  </div>
                </div>
              )}

              {preview.type === 'loan_repayment' && preview.selected && (
                <div className="admin-table-card" style={{ padding: 16, marginBottom: 14 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Banknote size={18} /><div><strong>{preview.selected.loan_number}</strong><div style={{ fontSize: 11, color: 'var(--admin-muted)', marginTop: 2 }}>Outstanding {fmt(preview.selected.balance)} → {fmt(preview.selected.balance_after)}</div></div></div>
                  <div style={{ marginTop: 12, fontSize: 13 }}>Repayment to post: <strong>{fmt(preview.selected.amount_applied)}</strong></div>
                </div>
              )}

              {preview.type === 'fine' && preview.selected && (
                <div className="admin-table-card" style={{ padding: 16, marginBottom: 14 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}><ReceiptText size={18} /><div><strong>Fine #{preview.selected.id} · {fmt(preview.selected.amount)}</strong><div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>{preview.selected.reason}</div></div></div>
                </div>
              )}

              {(preview.warnings || []).map((warning) => <div key={warning} className="admin-rule-notice" style={{ marginBottom: 8 }}><AlertTriangle size={14} /><span>{warning}</span></div>)}
              {(preview.blocking_errors || []).map((error) => <div key={error} className="admin-rule-notice" style={{ marginBottom: 8, borderColor: '#fecaca', background: '#fef2f2' }}><AlertTriangle size={14} color="#dc2626" /><span style={{ color: '#991b1b' }}>{error}</span></div>)}

              <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: '#fafafa', border: '1px solid var(--admin-border)', fontSize: 11.5, color: 'var(--admin-muted)', lineHeight: 1.6 }}>
                Posting is transactional and reference-protected. A successful confirmation updates the relevant contribution, repayment or fine record and creates one receipt transaction for this payment reference.
              </div>
            </>
          ) : null}
        </div>

        <div className="admin-modal-actions">
          <button type="button" className="admin-btn-secondary" onClick={onClose} disabled={posting}>Cancel</button>
          <button type="button" className="admin-btn-primary" onClick={confirmPost} disabled={posting || loading || !preview?.valid}>
            <ArrowRight size={14} /> {posting ? 'Posting…' : 'Confirm & Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FormIntake() {
  const [filter, setFilter] = useState('pending');
  const { data, loading, refetch } = useApi(() => formIntake.list({ status: filter }), [filter]);
  const [workingId, setWorkingId] = useState(null);
  const [allocationRow, setAllocationRow] = useState(null);

  const rows = data || [];
  const summary = useMemo(() => ({
    total: rows.length,
    duplicates: rows.filter((row) => row.duplicate_reference).length,
    unmatched: rows.filter((row) => row.match_status !== 'matched').length,
    posted: rows.filter((row) => row.posted || row.review_status === 'posted').length,
  }), [rows]);

  const review = async (row, status) => {
    const note = status === 'rejected' ? window.prompt('Reason for rejection (optional):', '') : '';
    setWorkingId(row._id);
    try {
      await formIntake.review(row._id, { status, note: note || null });
      showToast(status === 'accepted' ? 'Submission accepted. Review its allocation before posting.' : status === 'rejected' ? 'Submission rejected.' : 'Submission returned to review.');
      if (status === 'accepted') setFilter('accepted');
      else refetch();
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
          <p>Review, allocate and post Google Form payments into the authoritative financial ledger.</p>
        </div>
        <button type="button" className="admin-btn-secondary" onClick={refetch}><RefreshCw size={14} /> Refresh</button>
      </header>

      <section className="admin-stats-grid">
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Visible submissions</span><Inbox size={15} /></div><strong>{summary.total}</strong><span className="stat-sub">Current filter: {filter.replace('_', ' ')}</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Duplicate references</span><AlertTriangle size={15} /></div><strong>{summary.duplicates}</strong><span className="stat-sub">Blocked from posting</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Member match issues</span><AlertTriangle size={15} /></div><strong>{summary.unmatched}</strong><span className="stat-sub">Resolve before acceptance</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Posting mode</span><CheckCircle2 size={15} /></div><strong style={{ fontSize: 18 }}>Controlled</strong><span className="stat-sub">Accept → preview → confirm</span></div>
      </section>

      <div className="admin-table-card">
        <div style={{ padding: 16, borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontSize: 14 }}>Incoming submissions</strong>
            <div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>Accepted payments must pass allocation and duplicate checks before the final posting confirmation.</div>
          </div>
          <select value={filter} onChange={(event) => setFilter(event.target.value)} style={{ minHeight: 36, borderRadius: 8, border: '1px solid var(--admin-border)', background: '#fff', padding: '0 10px' }}>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="needs_review">Needs review</option>
            <option value="posted">Posted</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr><th>Submitted</th><th>Member</th><th>Type</th><th>Amount</th><th>Allocation</th><th>Reference</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th></tr>
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
                  <td>{row.type === 'monthly' ? (row.months || []).join(', ') || 'No month selected' : row.posting_result?.records?.repayment ? `Loan #${row.posting_result.records.repayment.loan_id}` : row.posting_result?.records?.fine_payment ? `Fine #${row.posting_result.records.fine_payment.id}` : '—'}</td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{row.mpesa_ref || '—'}</span>
                    {row.duplicate_reference && <div style={{ marginTop: 4 }}><span className="admin-badge is-overdue">Possible duplicate</span></div>}
                  </td>
                  <td>
                    <span className={`admin-badge is-${badge(row.review_status)}`}>{row.review_status.replace('_', ' ')}</span>
                    {row.posting_status === 'failed' && <div style={{ fontSize: 10.5, color: '#b91c1c', marginTop: 4 }}>{row.posting_error || 'Posting failed'}</div>}
                    {row.review_note && <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', marginTop: 4 }}>{row.review_note}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {row.review_status === 'pending' ? (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="admin-btn-secondary" disabled={workingId === row._id || row.duplicate_reference || row.match_status !== 'matched' || !row.mpesa_ref} onClick={() => review(row, 'accepted')}><CheckCircle2 size={13} /> Accept</button>
                        <button type="button" className="admin-btn-secondary" disabled={workingId === row._id} onClick={() => review(row, 'rejected')}><XCircle size={13} /> Reject</button>
                      </div>
                    ) : row.review_status === 'accepted' ? (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="admin-btn-primary" onClick={() => setAllocationRow(row)}><ArrowRight size={13} /> Review allocation</button>
                        <button type="button" className="admin-btn-secondary" disabled={workingId === row._id} onClick={() => review(row, 'pending')}>Return</button>
                      </div>
                    ) : row.review_status === 'needs_review' ? (
                      <button type="button" className="admin-btn-secondary" disabled={workingId === row._id} onClick={() => review(row, 'pending')}>Return to review</button>
                    ) : row.review_status === 'posted' ? (
                      <span style={{ color: 'var(--admin-green)', fontWeight: 650, fontSize: 11.5 }}>Posted {row.posted_at ? new Date(row.posted_at).toLocaleDateString('en-GB') : ''}</span>
                    ) : (
                      <button type="button" className="admin-btn-secondary" disabled={workingId === row._id} onClick={() => review(row, 'pending')}>Return to review</button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan="8" style={{ textAlign: 'center', color: 'var(--admin-muted)', padding: 32 }}>No {filter === 'all' ? '' : filter.replace('_', ' ')} form submissions.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {allocationRow && <AllocationModal row={allocationRow} onClose={() => setAllocationRow(null)} onPosted={() => { setFilter('posted'); refetch(); }} />}
    </div>
  );
}
