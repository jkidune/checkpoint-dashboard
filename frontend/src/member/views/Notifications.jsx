import { Bell, BellOff, CheckCircle2 } from 'lucide-react';
import { SectionHeader, Card, Loading, useApi } from '../components/Primitives';
import { notifications as notificationsApi } from '../../api';

const NOTIF_LABELS = {
  contribution_due: 'Contribution due',
  loan_due: 'Loan overdue',
  fine_issued: 'Fine issued',
  fine_overdue: 'Fine overdue',
  custom: 'Notice',
};

export default function MemberNotificationsPage() {
  const { data, loading, refetch } = useApi(() => notificationsApi.list());
  const list = data || [];

  const handleMarkRead = async (id) => {
    try {
      await notificationsApi.markRead(id);
      refetch();
    } catch {
      // no-op — refetch will just show the item as still unread
    }
  };

  return (
    <div className="m-page">
      <SectionHeader title="Notifications" sub="Contribution and loan reminders, fine alerts" />

      {loading ? <Loading /> : list.length === 0 ? (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--m-text-muted)', fontSize: 13.5 }}>
            <BellOff size={16} /> You're all caught up — no notifications.
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((n) => (
            <Card
              key={n.id}
              style={{
                cursor: n.read ? 'default' : 'pointer',
                borderColor: n.read ? 'var(--m-border)' : 'var(--m-accent-blue)',
                background: n.read ? '#fff' : 'var(--m-accent-blue-bg)',
              }}
            >
              <div onClick={() => !n.read && handleMarkRead(n.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Bell size={16} color={n.read ? 'var(--m-text-muted)' : 'var(--m-accent-blue)'} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: n.read ? 'var(--m-text-muted)' : 'var(--m-accent-blue)', marginBottom: 3 }}>
                      {NOTIF_LABELS[n.type] || n.type}{n.due_date ? ` · due ${n.due_date}` : ''}
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--m-text-primary)' }}>{n.message}</div>
                  </div>
                </div>
                {n.read
                  ? <CheckCircle2 size={16} color="var(--m-accent-green)" style={{ flexShrink: 0 }} />
                  : <span style={{ fontSize: 11, color: 'var(--m-accent-blue)', flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 700 }}>Mark read</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
