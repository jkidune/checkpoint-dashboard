import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Inbox,
  Loader2,
  PencilLine,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import api, { formIntake } from '../api';
import { useApi, showToast, fmt } from '../components/UI';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function typeLabel(type) {
  return ({
    monthly: 'Monthly contribution',
    loan_repayment: 'Loan repayment',
    fine: 'Fine payment',
  }[type] || type || '—');
}

function allocationLabel(item) {
  if (item.kind === 'contribution') return `Contribution · ${MONTH_NAMES[item.month]} ${item.year}`;
  if (item.kind === 'late_fine') return `Late fine · ${MONTH_NAMES[item.month]} ${item.year}`;
  if (item.kind === 'fine') return `Fine #${item.fine_id}`;
  if (item.kind === 'loan_repayment') return `Loan repayment · Loan #${item.loan_id}`;
  return item.kind;
}

function allocationKey(item) {
  if (item.kind === 'contribution' || item.kind === 'late_fine') {
    return `${item.kind}:${item.year}-${item.month}`;
  }
  if (item.kind === 'fine') return `fine:${item.fine_id}`;
  if (item.kind === 'loan_repayment') return `loan:${item.loan_id}`;
  return JSON.stringify(item);
}

function statusBadge(row) {
  if (row.review_status === 'posted') return 'active';
  if (row.review_status === 'rejected') return 'overdue';
  if (row.review_status === 'needs_review') return 'partial';
  return 'pending';
}

function BlockReason({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: '#991b1b', fontSize: 10.5, lineHeight: 1.45, marginTop: 3 }}>
      <AlertTriangle size={11} style={{ marginTop: 1, flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}

function PaymentReviewModal({ row, onClose, onChanged }) {
  const [workbench, setWorkbench] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [edit, setEdit] = useState({
    member_id: '', mpesa_ref: '', amount: '', payment_date: '',
    type: 'monthly', months: '', notes: '', reason: '',
  });

  const loadWorkbench = async (resetAllocations = true) => {
    setLoading(true);
    try {
      const response = await api.get(`/forms/intake/${row._id}/workbench`);
      const data = response.data;
      setWorkbench(data);
      const submission = data.submission || row;
      setEdit({
        member_id: submission.matched_member_id || '',
        mpesa_ref: submission.mpesa_ref || '',
        amount: submission.amount || '',
        payment_date: submission.payment_date || '',
        type: submission.type || 'monthly',
        months: (submission.months || []).join(', '),
        notes: submission.notes || '',
        reason: '',
      });
      if (resetAllocations) setAllocations(data.suggested_allocations || []);
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to open payment review', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkbench(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row._id]);

  useEffect(() => {
    if (!workbench || loading) return undefined;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const response = await api.post(`/forms/intake/${row._id}/allocation-preview`, { allocations });
        setPreview(response.data);
      } catch (error) {
        setPreview(error.response?.data?.preview || {
          valid: false,
          blocking_errors: [error.response?.data?.error || 'Could not validate this allocation.'],
          warnings: [],
        });
      } finally {
        setPreviewing(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [allocations, workbench, loading, row._id]);

  const received = Number(workbench?.submission?.amount || row.amount || 0);
  const allocated = allocations.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const remaining = received - allocated;

  const hasAllocation = (candidate) => allocations.some((item) => {
    if (candidate.kind === 'contribution' || candidate.kind === 'late_fine') {
      return item.kind === candidate.kind && Number(item.month) === Number(candidate.month) && Number(item.year) === Number(candidate.year);
    }
    if (candidate.kind === 'fine') return item.kind === 'fine' && Number(item.fine_id) === Number(candidate.fine_id);
    if (candidate.kind === 'loan_repayment') return item.kind === 'loan_repayment' && Number(item.loan_id) === Number(candidate.loan_id);
    return false;
  });

  const hasContributionForPeriod = (month, year) => allocations.some((item) => (
    item.kind === 'contribution' && Number(item.month) === Number(month) && Number(item.year) === Number(year)
  ));

  const addAllocation = (item) => {
    if (hasAllocation(item)) return;
    setAllocations((current) => [...current, item]);
  };

  const updateAllocationAmount = (key, value) => {
    const amount = value === '' ? '' : Number(value);
    setAllocations((current) => current.map((item) => (
      allocationKey(item) === key ? { ...item, amount } : item
    )));
  };

  const removeAllocation = (key) => {
    setAllocations((current) => current.filter((item) => allocationKey(item) !== key));
  };

  const saveCorrections = async () => {
    setSaving(true);
    try {
      await api.patch(`/forms/intake/${row._id}/correct`, {
        member_id: edit.member_id || null,
        mpesa_ref: edit.mpesa_ref,
        amount: Number(edit.amount),
        payment_date: edit.payment_date,
        type: edit.type,
        months: edit.months.split(',').map((value) => value.trim()).filter(Boolean),
        notes: edit.notes,
        reason: edit.reason || 'Verified against payment description and evidence',
      });
      showToast('Payment details updated. Allocation options have been recalculated.');
      await loadWorkbench(true);
      onChanged();
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to save corrections', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmPost = async () => {
    if (!preview?.valid || posting) return;
    const confirmed = window.confirm(
      `Post ${fmt(received)} for ${workbench.submission.member_name} using the allocation shown? This will update live financial records.`,
    );
    if (!confirmed) return;

    setPosting(true);
    try {
      const response = await api.post(`/forms/intake/${row._id}/allocation-post`, { allocations });
      showToast(response.data?.already_posted ? 'This payment was already posted.' : 'Payment verified and posted successfully.');
      onChanged();
      onClose();
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to post payment';
      showToast(message, 'error');
      if (error.response?.data?.preview) setPreview(error.response.data.preview);
    } finally {
      setPosting(false);
    }
  };

  const submission = workbench?.submission;

  return (
    <div className="admin-modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="admin-modal-panel" style={{ maxWidth: 1040, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="admin-modal-header" style={{ position: 'sticky', top: 0, zIndex: 4, background: '#fff' }}>
          <div>
            <h3>Verify & allocate payment</h3>
            <p style={{ color: 'var(--admin-muted)', fontSize: 11.5, marginTop: 3 }}>
              The member’s form answer is evidence. Your verified allocation becomes the financial record.
            </p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {loading ? (
          <div style={{ minHeight: 360, display: 'grid', placeItems: 'center', color: 'var(--admin-muted)' }}>
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : workbench ? (
          <div style={{ padding: '0 20px 22px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
              <section className="admin-table-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <FileText size={16} />
                  <strong style={{ fontSize: 13 }}>Member’s original submission</strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 12px', fontSize: 12 }}>
                  <span style={{ color: 'var(--admin-muted)' }}>Member</span><strong>{submission.member_name}</strong>
                  <span style={{ color: 'var(--admin-muted)' }}>Amount received</span><strong>{fmt(submission.amount)}</strong>
                  <span style={{ color: 'var(--admin-muted)' }}>Claimed type</span><span>{typeLabel(submission.type)}</span>
                  <span style={{ color: 'var(--admin-muted)' }}>Claimed months</span><span>{(submission.months || []).join(', ') || '—'}</span>
                  <span style={{ color: 'var(--admin-muted)' }}>Payment date</span><span>{submission.payment_date}</span>
                  <span style={{ color: 'var(--admin-muted)' }}>Reference</span><span style={{ fontFamily: 'monospace' }}>{submission.mpesa_ref || '—'}</span>
                </div>
                <div style={{ marginTop: 14, padding: 12, background: '#fafafa', border: '1px solid var(--admin-border)', borderRadius: 9 }}>
                  <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--admin-muted)', fontWeight: 700, marginBottom: 5 }}>Member description / notes</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{submission.notes || 'No additional description was provided.'}</div>
                </div>
              </section>

              <section className="admin-table-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <PencilLine size={16} />
                  <strong style={{ fontSize: 13 }}>Admin verification</strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="admin-form-group" style={{ margin: 0 }}>
                    <label>Verified member</label>
                    <select value={edit.member_id} onChange={(e) => setEdit((v) => ({ ...v, member_id: e.target.value }))}>
                      <option value="">Choose member…</option>
                      {(workbench.members || []).map((member) => <option key={member.id} value={member.id}>#{member.id} · {member.name}</option>)}
                    </select>
                  </div>
                  <div className="admin-form-group" style={{ margin: 0 }}>
                    <label>Payment reference</label>
                    <input value={edit.mpesa_ref} onChange={(e) => setEdit((v) => ({ ...v, mpesa_ref: e.target.value.toUpperCase() }))} placeholder="M-Pesa / bank ref" />
                  </div>
                  <div className="admin-form-group" style={{ margin: 0 }}>
                    <label>Amount received</label>
                    <input type="number" value={edit.amount} onChange={(e) => setEdit((v) => ({ ...v, amount: e.target.value }))} />
                  </div>
                  <div className="admin-form-group" style={{ margin: 0 }}>
                    <label>Payment date</label>
                    <input type="date" value={edit.payment_date} onChange={(e) => setEdit((v) => ({ ...v, payment_date: e.target.value }))} />
                  </div>
                  <div className="admin-form-group" style={{ margin: 0 }}>
                    <label>Member’s claimed type</label>
                    <select value={edit.type} onChange={(e) => setEdit((v) => ({ ...v, type: e.target.value }))}>
                      <option value="monthly">Monthly contribution</option>
                      <option value="loan_repayment">Loan repayment</option>
                      <option value="fine">Fine payment</option>
                    </select>
                  </div>
                  <div className="admin-form-group" style={{ margin: 0 }}>
                    <label>Claimed months</label>
                    <input value={edit.months} onChange={(e) => setEdit((v) => ({ ...v, months: e.target.value }))} placeholder="March, April" />
                  </div>
                </div>
                <div className="admin-form-group" style={{ marginTop: 10, marginBottom: 0 }}>
                  <label>Notes / description</label>
                  <textarea rows="2" value={edit.notes} onChange={(e) => setEdit((v) => ({ ...v, notes: e.target.value }))} />
                </div>
                <div className="admin-form-group" style={{ marginTop: 10, marginBottom: 0 }}>
                  <label>Reason for correction (audit trail)</label>
                  <input value={edit.reason} onChange={(e) => setEdit((v) => ({ ...v, reason: e.target.value }))} placeholder="e.g. Confirmed from M-Pesa message and member description" />
                </div>
                <button type="button" className="admin-btn-secondary" style={{ marginTop: 12 }} onClick={saveCorrections} disabled={saving}>
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save verified details
                </button>
              </section>
            </div>

            {(workbench.duplicate_matches || []).length > 0 && (
              <div className="admin-rule-notice" style={{ marginTop: 14, borderColor: '#fecaca', background: '#fef2f2' }}>
                <AlertTriangle size={15} color="#dc2626" />
                <span style={{ color: '#991b1b' }}><strong>Duplicate reference detected.</strong> This receipt cannot be posted until the reference is corrected or the existing ledger record is investigated.</span>
              </div>
            )}

            <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(330px,.85fr)', gap: 14, alignItems: 'start' }}>
              <section className="admin-table-card">
                <div style={{ padding: 14, borderBottom: '1px solid var(--admin-border)' }}>
                  <strong style={{ fontSize: 13 }}>Available ledger obligations</strong>
                  <div style={{ fontSize: 11, color: 'var(--admin-muted)', marginTop: 3 }}>Add only what this cash receipt actually settles.</div>
                </div>

                <div style={{ padding: 14, borderBottom: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}><CircleDollarSign size={15} /><strong style={{ fontSize: 12 }}>Monthly contributions</strong></div>
                  <div style={{ display: 'grid', gap: 7 }}>
                    {(workbench.contribution_candidates || []).map((candidate) => {
                      const contribution = { kind: 'contribution', month: candidate.month, year: candidate.year, amount: candidate.amount_due };
                      const lateFine = { kind: 'late_fine', month: candidate.month, year: candidate.year, amount: candidate.assessed_late_fine };
                      return (
                        <div key={candidate.key} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', border: '1px solid var(--admin-border)', borderRadius: 9, padding: '9px 10px', background: candidate.selected_by_member ? '#eff6ff' : '#fff' }}>
                          <div>
                            <strong style={{ fontSize: 11.5 }}>{candidate.label}</strong>
                            <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', marginTop: 2 }}>Due {fmt(candidate.amount_due)} · already paid {fmt(candidate.existing_amount)}{candidate.selected_by_member ? ' · selected on form' : ''}</div>
                            {candidate.assessed_late_fine > 0 && <div style={{ fontSize: 10.5, color: '#b91c1c', marginTop: 2 }}>Late fine due if contribution is posted now: {fmt(candidate.assessed_late_fine)}</div>}
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {candidate.amount_due > 0 && <button type="button" className="admin-btn-secondary" disabled={hasAllocation(contribution)} onClick={() => addAllocation(contribution)}><Plus size={12} /> Contribution</button>}
                            {candidate.assessed_late_fine > 0 && <button type="button" className="admin-btn-secondary" disabled={!hasContributionForPeriod(candidate.month, candidate.year) || hasAllocation(lateFine)} title={!hasContributionForPeriod(candidate.month, candidate.year) ? 'Add this month’s contribution first' : 'Add late fine'} onClick={() => addAllocation(lateFine)}><Plus size={12} /> Late fine</button>}
                          </div>
                        </div>
                      );
                    })}
                    {(workbench.contribution_candidates || []).length === 0 && <span style={{ color: 'var(--admin-muted)', fontSize: 11.5 }}>No contribution arrears found.</span>}
                  </div>
                </div>

                <div style={{ padding: 14, borderBottom: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}><ReceiptText size={15} /><strong style={{ fontSize: 12 }}>Existing unpaid fines</strong></div>
                  <div style={{ display: 'grid', gap: 7 }}>
                    {(workbench.fine_candidates || []).map((fine) => {
                      const item = { kind: 'fine', fine_id: fine.id, amount: fine.amount };
                      return (
                        <div key={fine.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', border: '1px solid var(--admin-border)', borderRadius: 9, padding: '9px 10px' }}>
                          <div><strong style={{ fontSize: 11.5 }}>Fine #{fine.id} · {fmt(fine.amount)}</strong><div style={{ fontSize: 10.5, color: 'var(--admin-muted)', marginTop: 2 }}>{fine.period_label ? `${fine.period_label} · ` : ''}{fine.reason}</div></div>
                          <button type="button" className="admin-btn-secondary" disabled={hasAllocation(item)} onClick={() => addAllocation(item)}><Plus size={12} /> Add fine</button>
                        </div>
                      );
                    })}
                    {(workbench.fine_candidates || []).length === 0 && <span style={{ color: 'var(--admin-muted)', fontSize: 11.5 }}>No unpaid fines found.</span>}
                  </div>
                </div>

                <div style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}><Banknote size={15} /><strong style={{ fontSize: 12 }}>Outstanding loans</strong></div>
                  <div style={{ display: 'grid', gap: 7 }}>
                    {(workbench.loan_candidates || []).map((loan) => {
                      const item = { kind: 'loan_repayment', loan_id: loan.loan_id, amount: Math.min(Math.max(remaining, 0), loan.balance) || loan.balance };
                      return (
                        <div key={loan.loan_id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', border: '1px solid var(--admin-border)', borderRadius: 9, padding: '9px 10px' }}>
                          <div><strong style={{ fontSize: 11.5 }}>{loan.loan_number}</strong><div style={{ fontSize: 10.5, color: 'var(--admin-muted)', marginTop: 2 }}>Outstanding {fmt(loan.balance)}{loan.overdue_penalty > 0 ? ` · includes ${fmt(loan.overdue_penalty)} overdue penalty` : ''}</div></div>
                          <button type="button" className="admin-btn-secondary" disabled={hasAllocation(item)} onClick={() => addAllocation(item)}><Plus size={12} /> Repayment</button>
                        </div>
                      );
                    })}
                    {(workbench.loan_candidates || []).length === 0 && <span style={{ color: 'var(--admin-muted)', fontSize: 11.5 }}>No outstanding loan found.</span>}
                  </div>
                </div>
              </section>

              <section className="admin-table-card" style={{ position: 'sticky', top: 72 }}>
                <div style={{ padding: 14, borderBottom: '1px solid var(--admin-border)' }}>
                  <strong style={{ fontSize: 13 }}>Receipt allocation</strong>
                  <div style={{ fontSize: 11, color: 'var(--admin-muted)', marginTop: 3 }}>The total must reconcile exactly to the cash received.</div>
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 7, marginBottom: 12 }}>
                    <div style={{ padding: 9, border: '1px solid var(--admin-border)', borderRadius: 8 }}><div style={{ fontSize: 9.5, color: 'var(--admin-muted)', textTransform: 'uppercase' }}>Received</div><strong style={{ fontSize: 13 }}>{fmt(received)}</strong></div>
                    <div style={{ padding: 9, border: '1px solid var(--admin-border)', borderRadius: 8 }}><div style={{ fontSize: 9.5, color: 'var(--admin-muted)', textTransform: 'uppercase' }}>Allocated</div><strong style={{ fontSize: 13 }}>{fmt(allocated)}</strong></div>
                    <div style={{ padding: 9, border: `1px solid ${Math.abs(remaining) < 0.001 ? '#bbf7d0' : '#fecaca'}`, borderRadius: 8, background: Math.abs(remaining) < 0.001 ? '#f0fdf4' : '#fef2f2' }}><div style={{ fontSize: 9.5, color: 'var(--admin-muted)', textTransform: 'uppercase' }}>Remaining</div><strong style={{ fontSize: 13, color: Math.abs(remaining) < 0.001 ? '#166534' : '#b91c1c' }}>{fmt(remaining)}</strong></div>
                  </div>

                  <div style={{ display: 'grid', gap: 7 }}>
                    {allocations.map((item) => {
                      const key = allocationKey(item);
                      const fixed = item.kind === 'fine' || item.kind === 'late_fine';
                      return (
                        <div key={key} style={{ border: '1px solid var(--admin-border)', borderRadius: 9, padding: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                            <strong style={{ fontSize: 11.5 }}>{allocationLabel(item)}</strong>
                            <button type="button" className="admin-modal-close" style={{ width: 26, height: 26 }} onClick={() => removeAllocation(key)}><Trash2 size={13} /></button>
                          </div>
                          <div style={{ marginTop: 7 }}>
                            <label style={{ fontSize: 10, color: 'var(--admin-muted)', display: 'block', marginBottom: 4 }}>Amount allocated</label>
                            <input type="number" value={item.amount} disabled={fixed} onChange={(e) => updateAllocationAmount(key, e.target.value)} style={{ width: '100%', minHeight: 34, border: '1px solid var(--admin-border)', borderRadius: 7, padding: '0 9px', background: fixed ? '#fafafa' : '#fff' }} />
                          </div>
                        </div>
                      );
                    })}
                    {allocations.length === 0 && <div style={{ padding: 18, textAlign: 'center', border: '1px dashed var(--admin-border)', borderRadius: 9, color: 'var(--admin-muted)', fontSize: 11.5 }}>Add contribution months, fines or loan repayments from the left.</div>}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    {previewing && <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--admin-muted)', fontSize: 11 }}><Loader2 size={12} className="animate-spin" /> Checking allocation…</div>}
                    {(preview?.warnings || []).map((warning) => <div key={warning} className="admin-rule-notice" style={{ marginTop: 7 }}><AlertTriangle size={13} /><span>{warning}</span></div>)}
                    {(preview?.blocking_errors || []).map((error) => <div key={error} className="admin-rule-notice" style={{ marginTop: 7, borderColor: '#fecaca', background: '#fef2f2' }}><AlertTriangle size={13} color="#dc2626" /><span style={{ color: '#991b1b' }}>{error}</span></div>)}
                    {preview?.valid && !previewing && <div className="admin-rule-notice" style={{ marginTop: 8, borderColor: '#bbf7d0', background: '#f0fdf4' }}><ShieldCheck size={14} color="#15803d" /><span style={{ color: '#166534' }}>Allocation reconciles exactly. Ready to post.</span></div>}
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : null}

        <div className="admin-modal-actions" style={{ position: 'sticky', bottom: 0, background: '#fff', zIndex: 5 }}>
          <button type="button" className="admin-btn-secondary" onClick={onClose} disabled={posting}>Cancel</button>
          <button type="button" className="admin-btn-primary" onClick={confirmPost} disabled={posting || loading || previewing || !preview?.valid} title={!preview?.valid ? 'Resolve the allocation messages above before posting' : 'Post verified receipt'}>
            {posting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {posting ? 'Posting…' : 'Verify & Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FormIntakeV2() {
  const [filter, setFilter] = useState('pending');
  const { data, loading, refetch } = useApi(() => formIntake.list({ status: filter }), [filter]);
  const [reviewRow, setReviewRow] = useState(null);
  const [workingId, setWorkingId] = useState(null);

  const rows = data || [];
  const summary = useMemo(() => ({
    total: rows.length,
    duplicates: rows.filter((row) => row.duplicate_reference).length,
    matchIssues: rows.filter((row) => row.match_status !== 'matched').length,
    missingRefs: rows.filter((row) => !row.mpesa_ref).length,
  }), [rows]);

  const reject = async (row) => {
    const note = window.prompt('Reason for rejection (optional):', '');
    setWorkingId(row._id);
    try {
      await formIntake.review(row._id, { status: 'rejected', note: note || null });
      showToast('Submission rejected.');
      refetch();
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to reject submission', 'error');
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
          <p>Verify the evidence, correct the member’s claim where necessary, then allocate each receipt to the exact obligations it settles.</p>
        </div>
        <button type="button" className="admin-btn-secondary" onClick={refetch}><RefreshCw size={14} /> Refresh</button>
      </header>

      <section className="admin-stats-grid">
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Visible submissions</span><Inbox size={15} /></div><strong>{summary.total}</strong><span className="stat-sub">Current filter: {filter.replace('_', ' ')}</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Duplicate references</span><AlertTriangle size={15} /></div><strong>{summary.duplicates}</strong><span className="stat-sub">Investigate before posting</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Member match issues</span><AlertTriangle size={15} /></div><strong>{summary.matchIssues}</strong><span className="stat-sub">Can be corrected during review</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Missing references</span><ReceiptText size={15} /></div><strong>{summary.missingRefs}</strong><span className="stat-sub">Can be entered during verification</span></div>
      </section>

      <div className="admin-rule-notice" style={{ marginBottom: 14, borderColor: '#bfdbfe', background: '#eff6ff' }}>
        <ShieldCheck size={15} color="#2563eb" />
        <span><strong>New workflow:</strong> there is no silent grey Accept gate. Open any payment for review, fix the member/reference if needed, split the receipt across contributions, fines and loan repayments, and post only when the allocation equals the amount received.</span>
      </div>

      <div className="admin-table-card">
        <div style={{ padding: 16, borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontSize: 14 }}>Incoming payment submissions</strong>
            <div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>The form is a declaration by the member; the admin verification determines the authoritative posting.</div>
          </div>
          <select value={filter} onChange={(event) => setFilter(event.target.value)} style={{ minHeight: 36, borderRadius: 8, border: '1px solid var(--admin-border)', background: '#fff', padding: '0 10px' }}>
            <option value="pending">Pending</option>
            <option value="accepted">In verification</option>
            <option value="needs_review">Needs review</option>
            <option value="posted">Posted</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr><th>Date</th><th>Member</th><th>Member claim</th><th>Amount</th><th>Description</th><th>Reference</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id}>
                  <td><strong>{row.payment_date}</strong><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>{row.created_at ? new Date(row.created_at).toLocaleString('en-GB') : ''}</div></td>
                  <td>
                    <strong>{row.member_name}</strong>
                    <div style={{ marginTop: 3 }}><span className={`admin-badge is-${row.match_status === 'matched' ? 'active' : 'pending'}`}>{row.match_status}{row.matched_member_id ? ` · #${row.matched_member_id}` : ''}</span></div>
                    {row.match_status !== 'matched' && <BlockReason>Member match needs verification.</BlockReason>}
                  </td>
                  <td><strong style={{ fontSize: 11.5 }}>{typeLabel(row.type)}</strong><div style={{ fontSize: 10.5, color: 'var(--admin-muted)', marginTop: 3 }}>{row.type === 'monthly' ? (row.months || []).join(', ') || 'No month selected' : 'As selected on form'}</div></td>
                  <td><strong>{fmt(row.amount)}</strong></td>
                  <td style={{ maxWidth: 250 }}><div style={{ fontSize: 11.5, lineHeight: 1.5, whiteSpace: 'normal' }}>{row.notes || '—'}</div></td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{row.mpesa_ref || '—'}</span>
                    {row.duplicate_reference && <BlockReason>Reference already appears in the ledger.</BlockReason>}
                    {!row.mpesa_ref && <BlockReason>Reference is missing.</BlockReason>}
                  </td>
                  <td><span className={`admin-badge is-${statusBadge(row)}`}>{row.review_status.replace('_', ' ')}</span>{row.posting_error && row.review_status === 'needs_review' && <div style={{ fontSize: 10.5, color: '#b91c1c', marginTop: 4, maxWidth: 230 }}>{row.posting_error}</div>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {row.review_status === 'posted' ? (
                      <span style={{ color: 'var(--admin-green)', fontWeight: 650, fontSize: 11.5 }}>Posted {row.posted_at ? new Date(row.posted_at).toLocaleDateString('en-GB') : ''}</span>
                    ) : row.review_status === 'rejected' ? (
                      <span style={{ color: 'var(--admin-muted)', fontSize: 11.5 }}>Rejected</span>
                    ) : (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="admin-btn-primary" onClick={() => setReviewRow(row)}><ArrowRight size={13} /> Review & allocate</button>
                        <button type="button" className="admin-btn-secondary" disabled={workingId === row._id} onClick={() => reject(row)}><XCircle size={13} /> Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan="8" style={{ textAlign: 'center', color: 'var(--admin-muted)', padding: 32 }}>No {filter === 'all' ? '' : filter.replace('_', ' ')} form submissions.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {reviewRow && <PaymentReviewModal row={reviewRow} onClose={() => setReviewRow(null)} onChanged={() => { refetch(); }} />}
    </div>
  );
}
