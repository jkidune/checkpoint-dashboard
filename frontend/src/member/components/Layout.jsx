import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, Menu } from 'lucide-react';
import MemberSidebar from './Sidebar';
import { notifications as notificationsApi } from '../../api';
import '../theme.css';

const PAGE_LABELS = {
  '/': 'Overview',
  '/contributions': 'Contributions',
  '/loans': 'Loans',
  '/transactions': 'Transactions',
  '/investments': 'Investments',
  '/notifications': 'Notifications',
  '/help': 'Help center',
  '/settings': 'Settings',
};

function NotificationButton({ user }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user?.member_id) return;
    notificationsApi.list({ member_id: user.member_id })
      .then((response) => setUnread((response.data || []).filter((notification) => !notification.read).length))
      .catch(() => {});
  }, [user]);

  return (
    <Link to="/notifications" className="m-icon-btn" title="Notifications">
      <Bell size={16} />
      {unread > 0 && <span className="m-badge-dot">{unread}</span>}
    </Link>
  );
}

export default function MemberLayout({ user, onLogout, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const page = PAGE_LABELS[location.pathname] || 'Member portal';

  return (
    <div className="theme-member">
      <div className="m-app-layout">
        <MemberSidebar user={user} onLogout={onLogout} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <main className="m-main">
          <div className="m-main-scroll">
            <div className="m-topbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <button className="m-icon-btn m-hamburger" onClick={() => setDrawerOpen(true)} aria-label="Open menu"><Menu size={16} /></button>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--m-text-muted)' }}>Checkpoint / Member</div>
                  <div style={{ fontSize: 13.5, fontWeight: 750, color: 'var(--m-text-primary)', marginTop: 1 }}>{page}</div>
                </div>
              </div>
              <div className="m-topbar-actions">
                <NotificationButton user={user} />
                <Link to="/settings" className="m-avatar" title="Account settings">{(user?.name || user?.username || '?').charAt(0).toUpperCase()}</Link>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
