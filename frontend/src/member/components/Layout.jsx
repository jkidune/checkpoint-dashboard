import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Mail, Menu } from 'lucide-react';
import MemberSidebar from './Sidebar';
import { notifications as notificationsApi } from '../../api';
import '../theme.css';

function MailIcon({ user }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user?.member_id) return;
    notificationsApi.list({ member_id: user.member_id })
      .then((r) => setUnread((r.data || []).filter((n) => !n.read).length))
      .catch(() => {});
  }, [user]);

  return (
    <Link to="/notifications" className="m-icon-btn" title="Notifications">
      <Mail size={16} />
      {unread > 0 && <span className="m-badge-dot">{unread}</span>}
    </Link>
  );
}

export default function MemberLayout({ user, onLogout, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="theme-member">
      <div className="m-app-layout">
        <MemberSidebar user={user} onLogout={onLogout} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <main className="m-main">
          <div className="m-main-scroll">
            <div className="m-topbar">
              <button
                className="m-icon-btn m-hamburger"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
              >
                <Menu size={16} />
              </button>
              <div className="m-search">
                <Search size={15} />
                <span>Search anything</span>
              </div>
              <div className="m-topbar-actions">
                <MailIcon user={user} />
                <div className="m-avatar">{(user?.name || user?.username || '?').charAt(0).toUpperCase()}</div>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
