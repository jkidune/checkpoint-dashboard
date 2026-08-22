// Narrow Vite source transform for the existing Contributions view.
// This keeps the current large operational page intact while correcting the
// Record Contribution workflow without replacing unrelated admin features.

function replaceRequired(source, oldValue, newValue, label) {
  if (!source.includes(oldValue)) {
    throw new Error(`[contribution-fix] Could not locate ${label}`)
  }
  return source.replace(oldValue, newValue)
}

const customSelectComponent = String.raw`
function ContributionSelect({ value, options, onChange, placeholder = 'Select…', ariaLabel }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value));

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className={\`contrib-custom-select \${open ? 'is-open' : ''}\`} ref={rootRef}>
      <button
        type="button"
        className="contrib-custom-select-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className={selected ? '' : 'is-placeholder'}>{selected?.label || placeholder}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="contrib-custom-select-menu" role="listbox">
          {options.map((option) => {
            const active = String(option.value) === String(value);
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={active}
                className={\`contrib-custom-select-option \${active ? 'is-selected' : ''}\`}
                onClick={() => {
                  onChange(String(option.value));
                  setOpen(false);
                }}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.meta && <small>{option.meta}</small>}
                </span>
                {active && <Check size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

`;

const recordContributionModal = String.raw`// ── Record Contribution Modal ──────────────────────────────────────────────
function RecordContributionModal({ onClose, membersData, onComplete, defaultMemberId, fy }) {
  const [selectedFY, setSelectedFY] = useState(fy);
  const [form, setForm] = useState({
    member_id: defaultMemberId ? String(defaultMemberId) : '',
    amount: String(fy <= 2024 ? TARGET_FY2024 : TARGET_FY2025_PLUS),
    month: '3',
    year: String(fyMonthYear(3, fy)),
    status: 'paid',
    paid_date: new Date().toISOString().split('T')[0],
    mpesa_ref: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [fineInfo, setFineInfo] = useState(null);

  const memberOptions = useMemo(
    () => (membersData || []).map((member) => ({
      value: String(member.id),
      label: member.name,
      meta: member.office || \`Member #\${member.id}\`,
    })),
    [membersData],
  );

  const fyOptions = [2026, 2025, 2024].map((year) => ({
    value: String(year),
    label: \`FY\${year}\`,
    meta: \`Mar \${year} – Feb \${year + 1}\`,
  }));

  const monthOptions = FY_MONTHS.map((month) => ({
    value: String(month),
    label: \`\${MONTHS[month]} \${fyMonthYear(month, selectedFY)}\`,
    meta: \`FY\${selectedFY}\`,
  }));

  const statusOptions = [
    { value: 'paid', label: 'Paid' },
    { value: 'partial', label: 'Partial' },
    { value: 'unpaid', label: 'Unpaid' },
  ];

  useEffect(() => {
    if (form.amount && form.month && form.year && form.paid_date && form.status === 'paid') {
      contributions
        .finePreview(form)
        .then((res) => setFineInfo(res.data?.penalty > 0 ? res.data : null))
        .catch(() => setFineInfo(null));
    } else {
      setFineInfo(null);
    }
  }, [form.amount, form.month, form.year, form.paid_date, form.status, form.member_id]);

  const handleFYChange = (nextValue) => {
    const nextFY = parseInt(nextValue, 10);
    const month = parseInt(form.month || '3', 10);
    setSelectedFY(nextFY);
    setForm((current) => ({
      ...current,
      year: String(fyMonthYear(month, nextFY)),
      amount: String(nextFY <= 2024 ? TARGET_FY2024 : TARGET_FY2025_PLUS),
    }));
  };

  const handleMonthChange = (nextValue) => {
    const month = parseInt(nextValue, 10);
    setForm((current) => ({
      ...current,
      month: nextValue,
      year: String(fyMonthYear(month, selectedFY)),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!form.member_id) {
      showToast('Select a member before recording the contribution', 'error');
      return;
    }

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

  return (
    <div className="contrib-modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="contrib-modal-panel is-record-contribution">
        <div className="contrib-record-header">
          <div className="contrib-record-heading">
            <div className="contrib-record-icon"><Wallet size={18} /></div>
            <div>
              <div className="contrib-record-kicker">Contribution entry</div>
              <h3>Record Contribution</h3>
              <p>Add one member payment to the correct fiscal period.</p>
            </div>
          </div>
          <button type="button" className="contrib-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="contrib-record-body">
          <div className="contrib-form-group">
            <label>Member</label>
            <ContributionSelect
              value={form.member_id}
              options={memberOptions}
              onChange={(value) => setForm((current) => ({ ...current, member_id: value }))}
              placeholder="Select member…"
              ariaLabel="Select member"
            />
          </div>

          <div className="contrib-period-card">
            <div className="contrib-period-card-copy">
              <span>Financial period</span>
              <strong>FY{selectedFY}</strong>
              <small>March {selectedFY} to February {selectedFY + 1}</small>
            </div>
            <div className="contrib-period-rule">Mar → Feb</div>
          </div>

          <div className="contrib-form-grid-2">
            <div className="contrib-form-group">
              <label>Financial Year</label>
              <ContributionSelect
                value={String(selectedFY)}
                options={fyOptions}
                onChange={handleFYChange}
                ariaLabel="Select financial year"
              />
            </div>
            <div className="contrib-form-group">
              <label>Contribution Month</label>
              <ContributionSelect
                value={form.month}
                options={monthOptions}
                onChange={handleMonthChange}
                ariaLabel="Select contribution month"
              />
            </div>
          </div>

          <div className="contrib-calendar-note">
            <Calendar size={14} />
            <span>
              This entry will be stored as <strong>{MONTHS[parseInt(form.month, 10)]} {form.year}</strong> under <strong>FY{selectedFY}</strong>.
            </span>
          </div>

          <div className="contrib-form-grid-2">
            <div className="contrib-form-group">
              <label>Amount (TZS)</label>
              <input
                type="number"
                placeholder="75000"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                required
                min="1"
                step="500"
              />
            </div>
            <div className="contrib-form-group">
              <label>Status</label>
              <ContributionSelect
                value={form.status}
                options={statusOptions}
                onChange={(value) => setForm((current) => ({ ...current, status: value }))}
                ariaLabel="Select payment status"
              />
            </div>
          </div>

          <div className="contrib-form-group">
            <label>Payment Date</label>
            <input
              type="date"
              value={form.paid_date}
              onChange={(event) => setForm({ ...form, paid_date: event.target.value })}
              required
            />
          </div>

          {fineInfo && (
            <div className="contrib-fine-notice">
              <div className="contrib-fine-icon"><ShieldAlert size={17} /></div>
              <div className="contrib-fine-copy">
                <strong>One-time late fine</strong>
                <span>{fineInfo.reason}</span>
              </div>
              <div className="contrib-fine-amount">{fmt(fineInfo.penalty)}</div>
            </div>
          )}

          <div className="contrib-form-group">
            <label>M-Pesa Reference</label>
            <input
              placeholder="e.g. QAB123XYZ"
              value={form.mpesa_ref}
              onChange={(event) => setForm({ ...form, mpesa_ref: event.target.value })}
            />
          </div>

          <div className="contrib-form-group">
            <label>Notes <span className="contrib-label-optional">Optional</span></label>
            <input
              placeholder="Add a short note…"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </div>

          <div className="contrib-modal-actions">
            <button type="button" className="contrib-btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="contrib-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Record Contribution'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

`;

export function checkpointContributionFix() {
  return {
    name: 'checkpoint-contribution-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/views/Contributions.jsx')) return null;

      let next = code;
      next = replaceRequired(
        next,
        "import { useState, useEffect, useMemo, useCallback } from 'react';",
        "import { useState, useEffect, useMemo, useCallback, useRef } from 'react';\nimport '../contribution-fix.css';",
        'React import',
      );
      next = replaceRequired(
        next,
        "  Save,\n} from 'lucide-react';",
        "  Save,\n  ChevronDown,\n  Check,\n} from 'lucide-react';",
        'Lucide imports',
      );

      const bulkMarker = '// ── Bulk / Lump-Sum Payment Modal';
      const bulkIndex = next.indexOf(bulkMarker);
      if (bulkIndex < 0) throw new Error('[contribution-fix] Bulk modal marker not found');
      next = next.slice(0, bulkIndex) + customSelectComponent + next.slice(bulkIndex);

      const recordMarker = '// ── Record Contribution Modal';
      const reminderMarker = '// ── Reminder Broadcast Confirmation Modal';
      const recordStart = next.indexOf(recordMarker);
      const recordEnd = next.indexOf(reminderMarker);
      if (recordStart < 0 || recordEnd < 0 || recordEnd <= recordStart) {
        throw new Error('[contribution-fix] Record contribution modal boundaries not found');
      }
      next = next.slice(0, recordStart) + recordContributionModal + next.slice(recordEnd);

      next = replaceRequired(
        next,
        '  const [fy, setFy] = useState(2025);',
        "  const [fy, setFy] = useState(() => {\n    const now = new Date();\n    return getFiscalYear(now.getMonth() + 1, now.getFullYear());\n  });",
        'default fiscal year',
      );
      next = replaceRequired(
        next,
        "? 'Late contributions (after the 5th) compound a 15% penalty per month.'",
        "? 'Each overdue contribution month receives one 15% fine. That month’s fine stays fixed; a new fine is created only when another contribution month becomes overdue.'",
        'FY2026 rule notice',
      );
      next = replaceRequired(
        next,
        'Deadline: 5th of every month',
        'Deadline: 5th of the following month',
        'deadline copy',
      );

      return { code: next, map: null };
    },
  };
}
