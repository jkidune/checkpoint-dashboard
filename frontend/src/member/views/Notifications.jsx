import { useState } from 'react';
import { Bell, BellOff, CheckCircle2, ChevronDown, ChevronUp, MailOpen } from 'lucide-react';
import { SectionHeader, Card, Loading, useApi } from '../components/Primitives';
import { notifications as notificationsApi } from '../../api';

const NOTIF_LABELS = {
  contribution_due: 'Contribution due',
  loan_due: 'Loan overdue',
  fine_issued: 'Fine issued',
  fine_overdue: 'Fine overdue',
  custom: 'Notice',
};

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return value;
  }
}

export default function MemberNotificationsPage() {
  const { data, loading, refetch } = useApi(() => notificationsApi.list());
  const [expandedId, setExpandedId] = useState(null);
  const [working, setWorking] = useState(false);
  const list = data || [];
  const unreadCount = list.filter((item) => !item.read).length;

  const handleMarkRead = async (id) => {
    try {
      await notificationsApi.markRead(id);
      await refetch();
    } catch {
      // Keep visible as unread if the request fails.
    }
  };

  const handleView = async (notification) => {
    setExpandedId((current) => current === notification.id ? null : notification.id);
    if (!notification.read) await handleMarkRead(notification.id);
  };

  const handleMarkAll = async () => {
    if (!unreadCount || working) return;
    setWorking(true);
    try {
      await notificationsApi.markAllRead();
      await refetch();
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="m-page">
      <SectionHeader
        title="Notifications"
        sub="Contribution reminders, loan notices, fines and messages from the club"
        action={unreadCount > 0 ? (
          <button type="button" className="m-btn-secondary" onClick={handleMarkAll} disabled={working}>
            <MailOpen size={14} /> {working ? 'Updating…' : `Mark all read (${unreadCount})`}
          </button>
        ) : null}
      />

      {loading ? <Loading /> : list.length === 0 ? (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--m-text-muted)', fontSize: 13.5 }}>
            <BellOff size={16} /> You're all caught up — no notifications.
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((n) => {
            const expanded = expandedId === n.id;
            return (
              <Card
                key={n.id}
                style={{
                  borderColor: n.read ? 'var(--m-border)' : 'var(--m-accent-blue)',
                  background: n.read ? '#fff' : 'var(--m-accent-blue-bg)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
                    <Bell size={16} color={n.read ? 'var(--m-text-muted)' : 'var(--m-accent-blue)'} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: n.read ? 'var(--m-text-muted)' : 'var(--m-accent-blue)', marginBottom: 3 }}>
                        {NOTIF_LABELS[n.type] || n.type}{n.due_date ? ` · due ${n.due_date}` : ''}
                      </div>
                      <div style={{ fontSize: 13.5, color: 'var(--m-text-primary)', lineHeight: 1.55 }}>
                        {expanded ? n.message : `${String(n.message || '').slice(0, 150)}${String(n.message || '').length > 150 ? '…' : ''}`}
                      </div>
                      {expanded && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--m-border)', fontSize: 11.5, color: 'var(--m-text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          <span>Received {formatDate(n.created_at)}</span>
                          {n.created_by && <span>From {n.created_by}</span>}
                          <span>{n.read ? 'Read' : 'Unread'}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {!n.read && (
                      <button type="button" className="m-btn-secondary" style={{ minHeight: 30, padding: '5px 9px', fontSize: 11 }} onClick={() => handleMarkRead(n.id)}>
                        Mark read
                      </button>
                    )}
                    <button type="button" className="m-btn-secondary" style={{ minHeight: 30, padding: '5px 9px', fontSize: 11 }} onClick={() => handleView(n)}>
                      {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {expanded ? 'Close' : 'View'}
                    </button>
                    {n.read && !expanded && <CheckCircle2 size={16} color="var(--m-accent-green)" />}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
