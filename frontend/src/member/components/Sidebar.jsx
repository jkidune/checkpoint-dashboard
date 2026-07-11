import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Wallet, Banknote, Users, ArrowLeftRight, Receipt, TrendingUp,
  Bell, HelpCircle, Settings, LogOut, ChevronRight,
} from 'lucide-react';

const GROUPS = [
  {
    label: 'General',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/contributions', icon: Wallet, label: 'Contributions' },
      { to: '/loans', icon: Banknote, label: 'Loans' },
      { to: '/members', icon: Users, label: 'Members' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
      { to: '/expenses', icon: Receipt, label: 'Expenses' },
      { to: '/investments', icon: TrendingUp, label: 'Investments' },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/notifications', icon: Bell, label: "Notification's" },
      { to: '/help', icon: HelpCircle, label: 'Help center' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

export default function MemberSidebar({ user, onLogout, open, onClose }) {
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 190 }}
        />
      )}
      <aside className={`m-sidebar${open ? ' open' : ''}`}>
        <div className="m-sidebar-logo">
          <div className="m-sidebar-logo-mark">C</div>
          <span className="m-sidebar-logo-text">Checkpoint</span>
          <ChevronRight size={14} color="var(--m-accent-blue)" style={{ marginLeft: 'auto' }} />
        </div>

        <nav style={{ flex: 1, overflowY: 'auto' }}>
          {GROUPS.map((group) => (
            <div key={group.label}>
              <div className="m-sidebar-group-label">{group.label}</div>
              <div className="m-sidebar-nav">
                {group.items.map(({ to, icon: Icon, label, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={onClose}
                    className={({ isActive }) => `m-sidebar-item${isActive ? ' active' : ''}`}
                  >
                    <Icon size={16} strokeWidth={2} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="m-sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div className="m-avatar">{(user?.name || user?.username || '?').charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--m-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.name || user?.username}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--m-text-muted)' }}>Member</div>
              </div>
            </div>
            <button className="m-icon-btn" style={{ width: 30, height: 30 }} onClick={onLogout} title="Logout">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
