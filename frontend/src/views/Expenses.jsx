import { useState } from 'react';
import { SectionHeader, Modal, Loading, fmt, showToast, useApi } from '../components/UI';
import { expenses as expensesApi } from '../api';

const CATEGORIES = ['AGM', 'Registration', 'Admin', 'Supplies', 'Loan Override', 'Welfare', 'Other'];

const CATEGORY_COLORS = {
  'AGM':           'var(--accent-indigo)',
  'Registration':  'var(--accent-blue)',
  'Admin':         'var(--accent-teal)',
  'Supplies':      'var(--accent-amber)',
  'Loan Override': 'var(--accent-red)',
  'Welfare':       '#ec4899',
  'Other':         'var(--text-muted)',
};

function getFiscalYear(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return m >= 3 ? y : y - 1;
}

const EMPTY_FORM = {
  category: 'AGM', description: '', amount: '', expense_date: '',
  fiscal_year: '', reference: '', approved_by: '', notes: '',
};

export default function Expenses({ user }) {
  const isAdmin = user?.role === 'admin';
  const [fyFilter, setFyFilter]   = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [showAdd, setShowAdd]     = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(null);

  const { data: list = [], loading, refetch } = useApi(
    () => expensesApi.list(fyFilter !== 'all' ? { fiscal_year: fyFilter } : {})
  , [fyFilter]);

  const filtered = catFilter === 'all' ? list : list.filter(e => e.category === catFilter);

  // Summary stats
  const totalAmount = filtered.reduce((s, e) => s + e.amount, 0);
  const byCat = CATEGORIES.map(cat => ({
    cat,
    total: filtered.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0),
    count: filtered.filter(e => e.category === cat).length,
  })).filter(c => c.count > 0);

  // All fiscal years present in data
  const fyYears = [...new Set(list.map(e => e.fiscal_year))].sort((a, b) => b - a);

  const openAdd = () => {
    const today = new Date().toISOString().split('T')[0];
    setForm({ ...EMPTY_FORM, expense_date: today });
    setEditing(null);
    setShowAdd(true);
  };

  const openEdit = (exp) => {
    setForm({
      category:     exp.category,
      description:  exp.description,
      amount:       String(exp.amount),
      expense_date: exp.expense_date,
      fiscal_year:  String(exp.fiscal_year),
      reference:    exp.reference || '',
      approved_by:  exp.approved_by || '',
      notes:        exp.notes || '',
    });
    setEditing(exp);
    setShowAdd(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: parseInt(form.amount),
        fiscal_year: form.fiscal_year ? parseInt(form.fiscal_year) : getFiscalYear(form.expense_date),
      };
      if (editing) {
        await expensesApi.update(editing.id, payload);
        showToast('Expense updated');
      } else {
        await expensesApi.create(payload);
        showToast('Expense recorded');
      }
      setShowAdd(false);
      setForm(EMPTY_FORM);
      setEditing(null);
      refetch();
    } catch(err) {
      showToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this expense record?')) return;
    setDeleting(id);
    try {
      await expensesApi.remove(id);
      showToast('Expense deleted');
      refetch();
    } catch(err) {
      showToast('Failed to delete', 'error');
    } finally {
      setDeleting(null);
    }
  };

  // Auto-set FY when date changes
  const handleDateChange = (val) => {
    const autoFY = val ? String(getFiscalYear(val)) : '';
    setForm(f => ({ ...f, expense_date: val, fiscal_year: autoFY }));
  };

  if (loading) return <Loading/>;

  return (
    <div className="page">
      <SectionHeader
        title="Expenses"
        sub="Group expenditures — deducted from overall capital"
        action={
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {/* FY filter */}
            <div className="tabs">
              <button className={`tab ${fyFilter==='all'?'active':''}`} onClick={() => setFyFilter('all')}>All</button>
              {fyYears.map(y => (
                <button key={y} className={`tab ${fyFilter===y?'active':''}`} onClick={() => setFyFilter(y)}>FY{y}</button>
              ))}
            </div>
            {isAdmin && (
              <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Expense</button>
            )}
          </div>
        }
      />

      {/* Summary stats */}
      <div className="stats-grid" style={{ gridTemplateColumns:'repeat(4,1fr)', marginBottom:20 }}>
        <div className="card">
          <div style={{ color:'var(--text-muted)', fontSize:11, fontWeight:600, textTransform:'uppercase' }}>Total Expenses</div>
          <div style={{ color:'var(--accent-red)', fontWeight:800, fontSize:20, fontFamily:'var(--font-display)' }}>{fmt(totalAmount)}</div>
          <div style={{ color:'var(--text-muted)', fontSize:11, marginTop:4 }}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {byCat.slice(0, 3).map(({ cat, total, count }) => (
          <div key={cat} className="card">
            <div style={{ color:'var(--text-muted)', fontSize:11, fontWeight:600, textTransform:'uppercase' }}>{cat}</div>
            <div style={{ color: CATEGORY_COLORS[cat], fontWeight:800, fontSize:18, fontFamily:'var(--font-display)' }}>{fmt(total)}</div>
            <div style={{ color:'var(--text-muted)', fontSize:11, marginTop:4 }}>{count} record{count !== 1 ? 's' : ''}</div>
          </div>
        ))}
      </div>

      {/* Category filter pills */}
      <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' }}>
        <button
          onClick={() => setCatFilter('all')}
          style={{
            padding:'4px 12px', borderRadius:20, fontSize:12, border:'1px solid var(--border)', cursor:'pointer',
            background: catFilter === 'all' ? 'var(--accent-blue)' : 'var(--bg-input)',
            color: catFilter === 'all' ? 'white' : 'var(--text-secondary)',
          }}
        >All Categories</button>
        {CATEGORIES.map(cat => {
          const count = list.filter(e => e.category === cat).length;
          if (count === 0) return null;
          return (
            <button
              key={cat}
              onClick={() => setCatFilter(cat === catFilter ? 'all' : cat)}
              style={{
                padding:'4px 12px', borderRadius:20, fontSize:12, cursor:'pointer',
                border: `1px solid ${catFilter === cat ? CATEGORY_COLORS[cat] : 'var(--border)'}`,
                background: catFilter === cat ? `${CATEGORY_COLORS[cat]}20` : 'var(--bg-input)',
                color: catFilter === cat ? CATEGORY_COLORS[cat] : 'var(--text-secondary)',
              }}
            >
              {cat} ({count})
            </button>
          );
        })}
      </div>

      {/* Expenses table */}
      <div className="card" style={{ padding:0, overflow:'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>
            No expenses recorded yet.{isAdmin ? ' Click "+ Add Expense" to get started.' : ''}
          </div>
        ) : (
          <table style={{ minWidth:780 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th style={{ textAlign:'center' }}>FY</th>
                <th>Reference</th>
                <th>Approved By</th>
                <th style={{ textAlign:'right' }}>Amount</th>
                {isAdmin && <th style={{ textAlign:'center', width:80 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(exp => (
                <tr key={exp.id}>
                  <td style={{ fontSize:12, color:'var(--text-secondary)', whiteSpace:'nowrap' }}>{exp.expense_date}</td>
                  <td>
                    <span style={{
                      background: `${CATEGORY_COLORS[exp.category]}20`,
                      color: CATEGORY_COLORS[exp.category],
                      borderRadius:4, padding:'2px 8px', fontSize:11, fontWeight:600,
                    }}>
                      {exp.category}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight:600, fontSize:13 }}>{exp.description}</div>
                    {exp.notes && <div style={{ fontSize:11, color:'var(--text-muted)' }}>{exp.notes}</div>}
                  </td>
                  <td style={{ textAlign:'center', fontSize:12, color:'var(--text-muted)' }}>FY{exp.fiscal_year}</td>
                  <td style={{ fontSize:12, color:'var(--text-muted)' }}>{exp.reference || '—'}</td>
                  <td style={{ fontSize:12, color:'var(--text-secondary)' }}>{exp.approved_by || '—'}</td>
                  <td style={{ textAlign:'right', color:'var(--accent-red)', fontWeight:700 }}>{fmt(exp.amount)}</td>
                  {isAdmin && (
                    <td style={{ textAlign:'center' }}>
                      <div style={{ display:'flex', gap:4, justifyContent:'center' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding:'2px 8px', fontSize:11 }}
                          onClick={() => openEdit(exp)}
                          disabled={exp.category === 'Loan Override'} // auto-generated records are read-only
                          title={exp.category === 'Loan Override' ? 'Auto-generated — edit via Loans' : 'Edit'}
                        >✏</button>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding:'2px 8px', fontSize:11, borderColor:'var(--accent-red)', color:'var(--accent-red)' }}
                          onClick={() => handleDelete(exp.id)}
                          disabled={deleting === exp.id}
                        >🗑</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop:'2px solid var(--border)', background:'var(--bg-surface)' }}>
                <td colSpan={isAdmin ? 6 : 6} style={{ fontWeight:700, color:'var(--text-secondary)', fontSize:12 }}>
                  TOTAL ({filtered.length} records)
                </td>
                <td style={{ textAlign:'right', color:'var(--accent-red)', fontWeight:800 }}>{fmt(totalAmount)}</td>
                {isAdmin && <td/>}
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showAdd && (
        <Modal title={editing ? 'Edit Expense' : 'Record Expense'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <form onSubmit={handleSave} className="modal-form">
            <div className="grid-2">
              <div className="form-group">
                <label>Category</label>
                <select className="form-input" value={form.category} onChange={e => setForm({...form, category:e.target.value})} required
                  disabled={editing?.category === 'Loan Override'}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Date</label>
                <input className="form-input" type="date" value={form.expense_date}
                  onChange={e => handleDateChange(e.target.value)} required/>
              </div>
            </div>

            <div className="form-group">
              <label>Description</label>
              <input className="form-input" placeholder="e.g. AGM 2026 – venue & refreshments"
                value={form.description} onChange={e => setForm({...form, description:e.target.value})} required/>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label>Amount (TZS)</label>
                <input className="form-input" type="number" min={1} placeholder="e.g. 150000"
                  value={form.amount} onChange={e => setForm({...form, amount:e.target.value})} required/>
              </div>
              <div className="form-group">
                <label>Fiscal Year</label>
                <input className="form-input" type="number" placeholder="Auto-detected"
                  value={form.fiscal_year} onChange={e => setForm({...form, fiscal_year:e.target.value})}/>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:3 }}>Auto-set from date. Override if needed.</div>
              </div>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label>Receipt / Reference</label>
                <input className="form-input" placeholder="e.g. REC-001 or MPesa ref"
                  value={form.reference} onChange={e => setForm({...form, reference:e.target.value})}/>
              </div>
              <div className="form-group">
                <label>Approved By</label>
                <input className="form-input" placeholder="e.g. Chairperson"
                  value={form.approved_by} onChange={e => setForm({...form, approved_by:e.target.value})}/>
              </div>
            </div>

            <div className="form-group">
              <label>Notes</label>
              <input className="form-input" placeholder="Optional additional details…"
                value={form.notes} onChange={e => setForm({...form, notes:e.target.value})}/>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Record Expense'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
