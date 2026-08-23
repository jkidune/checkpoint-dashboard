import { useMemo, useState } from 'react';
import { Mail, UserCheck, UserPlus, AlertTriangle, RefreshCw, Send, Pencil, MessageSquare, X } from 'lucide-react';
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

function Modal({ title, subtitle, onClose, children }) {
  return (
    <div className="admin-modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="admin-modal-panel">
        <div className="admin-modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle && <p style={{ color: 'var(--admin-muted)', fontSize: 12, marginTop: 3 }}>{subtitle}</p>}
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function MemberAccounts() {
  const { data: membersData, loading, refetch } = useApi(() => members.list());
  const { data: comms, loading: commsLoading, refetch: refetchComms } = useApi(() => communications.status());
  const [sendingId, setSendingId] = useState(null);
  const [query, setQuery] = useState('');
  const [emailMember, setEmailMember] = useState(null);
  const [emailValue, setEmailValue] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [messageMember, setMessageMember] = useState(null);
  const [messageForm, setMessageForm] = useState({ channel: 'in_app', type: 'custom', subject: '', message: '', due_date: '' });
  const [sendingMessage, setSendingMessage] = useState(false);

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

  const openEmail = (member) => {
    setEmailMember(member);
    setEmailValue(member.email || '');
  };

  const saveEmail = async (event) => {
    event.preventDefault();
    if (!emailMember) return;
    setSavingEmail(true);
    try {
      await members.update(emailMember.id, { email: emailValue.trim() || null });
      showToast(emailValue.trim() ? 'Member email updated.' : 'Member email removed.');
      setEmailMember(null);
      await refetch();
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to update email', 'error');
    } finally {
      setSavingEmail(false);
    }
  };

  const openMessage = (member) => {
    setMessageMember(member);
    setMessageForm({ channel: 'in_app', type: 'custom', subject: '', message: '', due_date: '' });
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!messageMember || !messageForm.message.trim()) return;
    if ((messageForm.channel === 'email' || messageForm.channel === 'both') && !messageMember.email) {
      showToast('Add an email address before sending by email.', 'error');
      return;
    }
    setSendingMessage(true);
    try {
      const response = await communications.sendMemberMessage(messageMember.id, {
        ...messageForm,
        subject: messageForm.subject.trim(),
        message: messageForm.message.trim(),
        due_date: messageForm.due_date || null,
      });
      const emailState = response.data?.email?.status;
      const detail = emailState === 'mocked' ? ' Email was prepared in mock mode.' : emailState === 'sent' ? ' Email sent.' : '';
      showToast(`Notification sent to ${messageMember.name}.${detail}`);
      setMessageMember(null);
      refetchComms();
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to send notification', 'error');
    } finally {
      setSendingMessage(false);
    }
  };

  if (loading) return <div className="admin-page-container"><div className="admin-table-card" style={{ padding: 32, color: 'var(--admin-muted)' }}>Loading member accounts…</div></div>;

  return (
    <div className="admin-page-container">
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Checkpoint Investment Club</div>
          <h1>Member Accounts</h1>
          <p>Manage portal access, member email addresses and individual communications.</p>
        </div>
        <button type="button" className="admin-btn-secondary" onClick={() => { refetch(); refetchComms(); }}><RefreshCw size={14} /> Refresh</button>
      </header>

      <section className="admin-stats-grid">
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Active accounts</span><UserCheck size={15} /></div><strong>{summary.active}</strong><span className="stat-sub">Members already using the portal</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Not activated</span><UserPlus size={15} /></div><strong>{summary.pending}</strong><span className="stat-sub">Ready for an invitation</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Missing email</span><AlertTriangle size={15} /></div><strong>{summary.missing}</strong><span className="stat-sub">Edit contact details here</span></div>
        <div className="admin-stat-card"><div className="admin-stat-top"><span>Email service</span><Mail size={15} /></div><strong style={{ fontSize: 18 }}>{comms?.configured ? 'Configured' : 'Mock mode'}</strong><span className="stat-sub">{comms?.provider || 'Not configured'}</span></div>
      </section>

      <div className="admin-table-card">
        <div style={{ padding: 16, borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><strong style={{ fontSize: 14 }}>Portal access & contact</strong><div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>Edit member email, send portal invitations or communicate directly with one member.</div></div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members…" className="admin-search-input" style={{ width: 250, paddingLeft: 12 }} />
        </div>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>Member</th><th>Email</th><th>Account</th><th>Username</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
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
                      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="admin-btn-secondary" onClick={() => openEmail(member)}><Pencil size={13} /> Email</button>
                        <button type="button" className="admin-btn-secondary" onClick={() => openMessage(member)}><MessageSquare size={13} /> Notify</button>
                        {canInvite && <button type="button" className="admin-btn-secondary" onClick={() => sendInvitation(member)} disabled={sendingId === member.id}><Send size={13} /> {sendingId === member.id ? 'Sending…' : 'Invite'}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-table-card">
        <div style={{ padding: 16, borderBottom: '1px solid var(--admin-border)' }}><strong style={{ fontSize: 14 }}>Recent communications</strong><div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginTop: 3 }}>Invitations, individual messages, reminders and password-recovery delivery attempts are logged here.</div></div>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>Date</th><th>Recipient</th><th>Type</th><th>Status</th><th>Context</th></tr></thead>
            <tbody>
              {(comms?.recent || []).slice(0, 20).map((log) => (
                <tr key={log._id}>
                  <td>{log.created_at ? new Date(log.created_at).toLocaleString('en-GB') : '—'}</td>
                  <td>{log.recipient_email}</td>
                  <td style={{ textTransform: 'capitalize' }}>{String(log.type || '').replaceAll('_', ' ')}</td>
                  <td><span className={`admin-badge is-${log.status === 'sent' ? 'active' : log.status === 'failed' ? 'overdue' : 'neutral'}`}>{log.status}</span></td>
                  <td>{log.subject || log.period_key || '—'}</td>
                </tr>
              ))}
              {!commsLoading && !(comms?.recent || []).length && <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--admin-muted)', padding: 28 }}>No communications logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {emailMember && (
        <Modal title="Edit member email" subtitle={`Update the contact and login email for ${emailMember.name}.`} onClose={() => setEmailMember(null)}>
          <form onSubmit={saveEmail}>
            <div className="admin-form-group">
              <label>Email address</label>
              <input type="email" value={emailValue} onChange={(event) => setEmailValue(event.target.value)} placeholder="member@example.com" autoFocus />
              <small style={{ color: 'var(--admin-muted)' }}>If this member has a portal account, its login email will be synchronized automatically.</small>
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn-secondary" onClick={() => setEmailMember(null)} disabled={savingEmail}>Cancel</button>
              <button type="submit" className="admin-btn-primary" disabled={savingEmail}>{savingEmail ? 'Saving…' : 'Save email'}</button>
            </div>
          </form>
        </Modal>
      )}

      {messageMember && (
        <Modal title="Send notification" subtitle={`Send a message to ${messageMember.name}.`} onClose={() => setMessageMember(null)}>
          <form onSubmit={sendMessage}>
            <div className="admin-form-grid-2">
              <div className="admin-form-group">
                <label>Channel</label>
                <select value={messageForm.channel} onChange={(event) => setMessageForm({ ...messageForm, channel: event.target.value })}>
                  <option value="in_app">In-app only</option>
                  <option value="email" disabled={!messageMember.email}>Email only</option>
                  <option value="both" disabled={!messageMember.email}>In-app + email</option>
                </select>
              </div>
              <div className="admin-form-group">
                <label>Type</label>
                <select value={messageForm.type} onChange={(event) => setMessageForm({ ...messageForm, type: event.target.value })}>
                  <option value="custom">General notice</option>
                  <option value="contribution_due">Contribution due</option>
                  <option value="loan_due">Loan due</option>
                  <option value="fine_issued">Fine issued</option>
                  <option value="fine_overdue">Fine overdue</option>
                </select>
              </div>
            </div>

            {(messageForm.channel === 'email' || messageForm.channel === 'both') && (
              <div className="admin-form-group">
                <label>Subject</label>
                <input value={messageForm.subject} onChange={(event) => setMessageForm({ ...messageForm, subject: event.target.value })} placeholder="Checkpoint notification" />
                <small style={{ color: 'var(--admin-muted)' }}>Email recipient: {messageMember.email || 'No email on file'}</small>
              </div>
            )}

            <div className="admin-form-group">
              <label>Message</label>
              <textarea rows="5" value={messageForm.message} onChange={(event) => setMessageForm({ ...messageForm, message: event.target.value })} placeholder="Write a clear member message…" required />
            </div>

            <div className="admin-form-group">
              <label>Due date <span style={{ color: 'var(--admin-muted)', fontWeight: 500 }}>Optional</span></label>
              <input type="date" value={messageForm.due_date} onChange={(event) => setMessageForm({ ...messageForm, due_date: event.target.value })} />
            </div>

            {!comms?.configured && (messageForm.channel === 'email' || messageForm.channel === 'both') && (
              <div className="admin-rule-notice"><span><strong>Email is in mock mode.</strong> The in-app notification can still be created, but no real email will leave the system until SMTP is configured.</span></div>
            )}

            <div className="admin-modal-actions">
              <button type="button" className="admin-btn-secondary" onClick={() => setMessageMember(null)} disabled={sendingMessage}>Cancel</button>
              <button type="submit" className="admin-btn-primary" disabled={sendingMessage || !messageForm.message.trim()}><Send size={14} /> {sendingMessage ? 'Sending…' : 'Send notification'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
