import { useMemo, useState } from 'react';
import { Mail, UserCheck, UserPlus, AlertTriangle, RefreshCw, Send } from 'lucide-react';
import { members, communications } from '../api';
import { useApi, showToast } from '../components/UI';

function statusMeta(member) {
  const status = member.account?.status || (member.email ? 'not_activated' : 'missing_email');
  if (status === 'active') return { label: 'Active account', badge: 'active' };
  if (status === 'missing_email') return { label: 'Missing email', badge: 'pending' };
  return { label: 'Not activated', badge: 'info' };
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CM';
}

export default function MemberAccounts() {
  const { data: membersData, loading, refetch } = useApi(() => members.list());
  const { data: comms, loading: commsLoading, refetch: refetchComms } = useApi(() => communications.status());
  const [sendingId, setSendingId] = useState(null);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (membersData || []).filter((member) => {
      if (!needle) return true;
      return [member.name, member.email, member.phone, member.account?.username]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [membersData, query]);

  const summary = useMemo(() => {
    const list = membersData || [];
    return {
      active: list.filter((member) => member.account?.status === 'active').length,
      pending: list.filter((member) => member.account?.status === 'not_activated').length,
      missing: list.filter((member) => member.account?.status === 'missing_email').length,
    };
  }, [membersData]);

  const sendInvitation = async (member) => {
    setSendingId(member.id);
    try {
      const response = await communications.sendInvitation(member.id);
      showToast(response.data?.mocked ? 'Invitation prepared in mock email mode.' : `Invitation sent to ${member.email}`);
      refetchComms();
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to send invitation', 'error');
    } finally {
      setSendingId(null);
    }
  };

  if (loading) return <div className="admin-page-container"><div className="admin-table-card" style={{ padding: 32, color: 'var(--admin-muted)' }}>Loading member accounts…</div></div>;

  return (
    <div className="admin-page-container">
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Member Accounts</h1>
          <p>Manage portal activation and communications without changing member financial records.</p>
        </div>
        <button type="button" className="admin-btn-secondary" onClick={() => { refetch(); refetchComms(); }}><RefreshCw size={14} /> Refresh</button>
      </header>

      <section className="admin-stats-grid">
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Active accounts</span><UserCheck size={15} /></div><strong>{summary.active}</strong><span className="stat-sub">Members already using the portal</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Not activated</span><UserPlus size={15} /></div><strong>{summary.pending}</strong><span className="stat-sub">Ready for an invitation</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Missing email</span><AlertTriangle size={15} /></div><strong>{summary.missing}</strong><span className="stat-sub">Update these member records first</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Email service</span><Mail size={15} /></div><strong style={{ fontSize: 18 }}>{comms?.configured ? 'Configured' : 'Mock mode'}</strong><span className="stat-sub">{comms?.provider || 'Not configured'}</span></div>
      </section>

      <div className="admin-table-card">
        <div style={{ padding: 16, borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><strong style={{ fontSize: 14 }}>Portal access</strong><div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>Invitations never contain passwords. Members activate against their existing member email or phone.</div></div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members…" className="admin-search-input" style={{ width: 250, paddingLeft: 12 }} />
        </div>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>Member</th><th>Email</th><th>Account</th><th>Username</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
            <tbody>
              {rows.map((member) => {
                const meta = statusMeta(member);
                const canInvite = member.account?.status === 'not_activated' && !!member.email;
                return (
                  <tr key={member.id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><div className="admin-avatar">{initials(member.name)}</div><div><strong>{member.name}</strong><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Member #{member.id}</div></div></div></td>
                    <td>{member.email || <span style={{ color: 'var(--admin-muted)' }}>No email</span>}</td>
                    <td><span className={`admin-badge is-${meta.badge}`}>{meta.label}</span></td>
                    <td>{member.account?.username || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {canInvite ? <button type="button" className="admin-btn-secondary" onClick={() => sendInvitation(member)} disabled={sendingId === member.id}><Send size={13} /> {sendingId === member.id ? 'Sending…' : 'Send invitation'}</button>
                        : member.account?.status === 'active' ? <span style={{ fontSize: 11, color: 'var(--admin-green)', fontWeight: 650 }}>Activated</span>
                          : <span style={{ fontSize: 11, color: 'var(--admin-muted)' }}>Add email in Members first</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-table-card">
        <div style={{ padding: 16, borderBottom: '1px solid var(--admin-border)' }}><strong style={{ fontSize: 14 }}>Recent communications</strong><div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>Invitation, reminder and password-recovery delivery attempts are logged here.</div></div>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>Date</th><th>Recipient</th><th>Type</th><th>Status</th><th>Period</th></tr></thead>
            <tbody>
              {(comms?.recent || []).slice(0, 20).map((log) => (
                <tr key={log._id}>
                  <td>{log.created_at ? new Date(log.created_at).toLocaleString('en-GB') : '—'}</td>
                  <td>{log.recipient_email}</td>
                  <td style={{ textTransform: 'capitalize' }}>{String(log.type || '').replaceAll('_', ' ')}</td>
                  <td><span className={`admin-badge is-${log.status === 'sent' ? 'active' : log.status === 'failed' ? 'overdue' : 'neutral'}`}>{log.status}</span></td>
                  <td>{log.period_key || '—'}</td>
                </tr>
              ))}
              {!commsLoading && !(comms?.recent || []).length && <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--admin-muted)', padding: 28 }}>No communications logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
