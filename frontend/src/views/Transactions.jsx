import { useState } from 'react';
import { SectionHeader, Loading, fmt, useApi } from '../components/UI';
import { transactions } from '../api';
import { format } from 'date-fns';

const TYPE_COLORS = {
  contribution:      { color:'var(--accent-teal)', icon:'💰', label:'Contribution' },
  loan_repayment:    { color:'var(--accent-blue)', icon:'✅', label:'Loan Repayment' },
  loan_disbursement: { color:'var(--accent-red)',  icon:'📤', label:'Loan Disbursed' },
  group_transfer:    { color:'var(--accent-amber)', icon:'↔️', label:'Group Transfer' },
  fine_payment:      { color:'var(--accent-indigo)',icon:'⚠️', label:'Fine Payment' },
  other:             { color:'var(--text-muted)',  icon:'📝', label:'Other' },
};

export default function Transactions() {
  const [filterType, setFilterType] = useState('all');
  const [page, setPage] = useState(0);
  const LIMIT = 30;

  const params = { limit: LIMIT, offset: page * LIMIT, ...(filterType !== 'all' ? { type: filterType } : {}) };
  const { data, loading } = useApi(() => transactions.list(params), [filterType, page]);

  if (loading) return <Loading/>;
  const list = data?.transactions || [];
  const total = data?.total || 0;

  return (
    <div className="page">
      <SectionHeader title="Transaction Ledger" sub={`${total} total transactions`}/>

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {['all','contribution','loan_repayment','loan_disbursement','group_transfer'].map(t => {
          const info = TYPE_COLORS[t] || {};
          return (
            <button key={t} onClick={() => { setFilterType(t); setPage(0); }}
              style={{
                padding:'7px 14px', borderRadius:8, border:'none', cursor:'pointer', fontSize:12, fontWeight:600,
                background: filterType===t ? (info.color||'var(--accent-blue)') : 'var(--bg-card)',
                color: filterType===t ? '#fff' : 'var(--text-muted)',
                transition:'all 0.2s',
              }}>
              {info.icon || '📊'} {info.label || 'All'}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{['Date & Time','Member','Type','Description','Amount'].map(h=><th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {list.map(tx => {
              const info = TYPE_COLORS[tx.type] || TYPE_COLORS.other;
              const isDebit = tx.type === 'loan_disbursement';
              return (
                <tr key={tx.id}>
                  <td style={{ color:'var(--text-muted)', fontSize:12, whiteSpace:'nowrap' }}>
                    {tx.transaction_date}
                  </td>
                  <td style={{ fontWeight:600 }}>{tx.member_name || '—'}</td>
                  <td>
                    <span style={{
                      background:`${info.color}20`, color:info.color,
                      padding:'3px 8px', borderRadius:20, fontSize:11, fontWeight:700,
                    }}>{info.icon} {info.label}</span>
                  </td>
                  <td style={{ color:'var(--text-muted)', fontSize:12, maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {tx.description || '—'}
                  </td>
                  <td style={{ fontWeight:700, textAlign:'right', color: isDebit?'var(--accent-red)':'var(--accent-teal)' }}>
                    {isDebit ? '−' : '+'} {fmt(tx.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && (
          <div className="empty-state">
            <div className="icon">📭</div>
            <p>No transactions found</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div style={{ display:'flex', justifyContent:'center', gap:10, alignItems:'center' }}>
          <button className="btn btn-secondary btn-sm" disabled={page===0} onClick={() => setPage(p=>p-1)}>← Prev</button>
          <span style={{ color:'var(--text-muted)', fontSize:12 }}>{page+1} / {Math.ceil(total/LIMIT)}</span>
          <button className="btn btn-secondary btn-sm" disabled={(page+1)*LIMIT>=total} onClick={() => setPage(p=>p+1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
