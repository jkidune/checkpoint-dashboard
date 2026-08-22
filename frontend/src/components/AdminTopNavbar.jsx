import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search,
  Bell,
  ChevronRight,
  ChevronDown,
  LogOut,
  Settings as SettingsIcon,
  Users,
  Banknote,
  Wallet,
  ArrowLeftRight,
  TrendingUp,
  Receipt,
  CheckCircle2,
  HelpCircle,
  X,
  LayoutDashboard,
  Shield,
  Command,
} from 'lucide-react';
import { notifications as notificationsApi } from '../api';

const ROUTE_LABELS = {
  '/': 'Overview',
  '/contributions': 'Contributions',
  '/loans': 'Loan Register',
  '/members': 'Member Directory',
  '/transactions': 'Transaction Ledger',
  '/investments': 'Investments & Strategy',
  '/expenses': 'Expense Register',
  '/settings': 'Constitution & Settings',
};

const COMMAND_LINKS = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, category: 'Dashboard' },
  { path: '/contributions', label: 'Contributions Matrix', icon: Wallet, category: 'Financials' },
  { path: '/loans', label: 'Loan Register & Servicing', icon: Banknote, category: 'Financials' },
  { path: '/members', label: 'Member Directory', icon: Users, category: 'Roster' },
  { path: '/transactions', label: 'Transaction Ledger', icon: ArrowLeftRight, category: 'Auditing' },
  { path: '/investments', label: 'Investments & Roadmap', icon: TrendingUp, category: 'Portfolio' },
  { path: '/expenses', label: 'Expense Register', icon: Receipt, category: 'Financials' },
  { path: '/settings', label: 'Constitution & Rules', icon: SettingsIcon, category: 'Settings' },
];

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'AD';
}

export function AdminAvatar({ user, src, size = 32, className = '' }) {
  const [imgError, setImgError] = useState(false);
  const text = initials(user?.name || user?.username || 'Admin');

  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={user?.name || 'User'}
        onError={() => setImgError(true)}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '1px solid #e4e4e7',
          flexShrink: 0,
        }}
        className={className}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #f4f4f5 0%, #e4e4e7 100%)',
        border: '1px solid #d4d4d8',
        color: '#27272a',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.36),
        fontWeight: 750,
        letterSpacing: '-0.02em',
        flexShrink: 0,
      }}
      className={className}
    >
      {text}
    </div>
  );
}

export default function AdminTopNavbar({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [attentionItems, setAttentionItems] = useState([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  const bellRef = useRef(null);
  const profileRef = useRef(null);
  const searchInputRef = useRef(null);

  // Fetch operational attention items for admin notification bell
  useEffect(() => {
    notificationsApi
      .attention()
      .then((res) => setAttentionItems(res.data || []))
      .catch(() => setAttentionItems([]));
  }, [location.pathname]);

  // Global ⌘K shortcut listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setSearchModalOpen(false);
        setBellOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // Auto focus search input when palette opens
  useEffect(() => {
    if (searchModalOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [searchModalOpen]);

  const currentPageLabel = ROUTE_LABELS[location.pathname] || 'Dashboard';
  const unreadCount = attentionItems.length;

  const filteredCommands = COMMAND_LINKS.filter((c) =>
    c.label.toLowerCase().includes(commandQuery.toLowerCase()) ||
    c.category.toLowerCase().includes(commandQuery.toLowerCase())
  );

  return (
    <>
      <header className="admin-topbar">
        {/* Left: Quiet Breadcrumb */}
        <div className="admin-topbar-left">
          <span className="admin-breadcrumb-root" onClick={() => navigate('/')}>
            Checkpoint
          </span>
          <ChevronRight size={14} className="admin-breadcrumb-separator" />
          <span className="admin-breadcrumb-current">{currentPageLabel}</span>
        </div>

        {/* Center: Global Search Bar Trigger */}
        <div className="admin-topbar-center">
          <button
            type="button"
            className="admin-global-search-btn"
            onClick={() => setSearchModalOpen(true)}
            aria-label="Search members, loans, records (Cmd+K)"
          >
            <Search size={14} className="search-icon" />
            <span className="search-placeholder">Search members, loans, transactions…</span>
            <kbd className="search-kbd">⌘K</kbd>
          </button>
        </div>

        {/* Right: Notification Bell & Profile Dropdown */}
        <div className="admin-topbar-right">
          {/* Notification Bell */}
          <div className="admin-popover-anchor" ref={bellRef}>
            <button
              type="button"
              className="admin-nav-icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                setBellOpen((prev) => !prev);
                setProfileOpen(false);
              }}
              title="Operational notifications"
              aria-expanded={bellOpen}
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="admin-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>

            {bellOpen && (
              <div className="admin-popover-dropdown is-notifications" onClick={(e) => e.stopPropagation()}>
                <div className="admin-popover-header">
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--admin-text)' }}>
                    Operational Attention
                  </div>
                  <span className="admin-badge is-partial" style={{ fontSize: 10 }}>
                    {unreadCount} pending
                  </span>
                </div>

                <div className="admin-notifications-list">
                  {attentionItems.length === 0 ? (
                    <div className="admin-notification-empty">
                      <CheckCircle2 size={20} color="var(--admin-green)" />
                      <span>All members and accounts in good standing</span>
                    </div>
                  ) : (
                    attentionItems.slice(0, 5).map((item) => (
                      <div
                        key={item.member_id}
                        className="admin-notification-item"
                        onClick={() => {
                          setBellOpen(false);
                          navigate(`/members?member=${item.member_id}`);
                        }}
                      >
                        <div className="admin-avatar" style={{ width: 28, height: 28, fontSize: 10 }}>
                          {initials(item.name)}
                        </div>
                        <div className="admin-notification-content">
                          <strong>{item.name}</strong>
                          <span>
                            {(item.issues || []).map((i) => i.type.replace('_', ' ')).join(' · ')}
                          </span>
                        </div>
                        <ChevronRight size={14} color="var(--admin-muted)" />
                      </div>
                    ))
                  )}
                </div>

                <div className="admin-popover-footer">
                  <button
                    type="button"
                    className="admin-popover-link-btn"
                    onClick={() => {
                      setBellOpen(false);
                      navigate('/members?filter=attention');
                    }}
                  >
                    View all attention items →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Profile Dropdown */}
          <div className="admin-popover-anchor" ref={profileRef}>
            <button
              type="button"
              className="admin-profile-btn"
              onClick={(e) => {
                e.stopPropagation();
                setProfileOpen((prev) => !prev);
                setBellOpen(false);
              }}
              aria-expanded={profileOpen}
            >
              <AdminAvatar user={user} size={30} />
              <div className="admin-profile-meta">
                <span className="admin-profile-name">{user?.name || user?.username || 'Admin'}</span>
                <span className="admin-profile-role">Administrator</span>
              </div>
              <ChevronDown size={12} style={{ color: '#a1a1aa', flexShrink: 0 }} />
            </button>

            {profileOpen && (
              <div className="admin-popover-dropdown is-profile" onClick={(e) => e.stopPropagation()}>
                <div className="admin-profile-dropdown-header">
                  <AdminAvatar user={user} size={38} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--admin-text)' }}>
                      {user?.name || user?.username || 'Administrator'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--admin-muted)', textTransform: 'capitalize' }}>
                      {user?.role || 'Admin'} · Checkpoint
                    </div>
                  </div>
                </div>

                <div className="admin-dropdown-menu-list">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      navigate('/settings');
                    }}
                  >
                    <SettingsIcon size={14} />
                    <span>Account settings</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      navigate('/members');
                    }}
                  >
                    <Users size={14} />
                    <span>Member Directory</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      navigate('/transactions');
                    }}
                  >
                    <ArrowLeftRight size={14} />
                    <span>Financial Ledger</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setProfileOpen(false)}
                    style={{ color: 'var(--admin-muted)' }}
                  >
                    <HelpCircle size={14} />
                    <span>Help &amp; support</span>
                  </button>
                </div>

                <div className="admin-dropdown-menu-divider" />

                <div className="admin-dropdown-menu-list">
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => {
                      setProfileOpen(false);
                      onLogout();
                    }}
                  >
                    <LogOut size={14} />
                    <span>Log out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Command / Search Palette Modal ── */}
      {searchModalOpen && (
        <div className="admin-palette-backdrop" onClick={() => setSearchModalOpen(false)}>
          <div className="admin-palette-panel" onClick={(e) => e.stopPropagation()}>
            <div className="admin-palette-search-bar">
              <Search size={18} color="var(--admin-muted)" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Jump to page, member or tool… (Type to search)"
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
              />
              <kbd className="search-kbd" onClick={() => setSearchModalOpen(false)}>
                ESC
              </kbd>
            </div>

            <div className="admin-palette-results">
              <div className="admin-palette-group-title">Navigation & Quick Jump</div>
              {filteredCommands.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--admin-muted)', fontSize: 13 }}>
                  No matching destinations found.
                </div>
              ) : (
                filteredCommands.map((cmd) => {
                  const Icon = cmd.icon;
                  return (
                    <div
                      key={cmd.path}
                      className="admin-palette-item"
                      onClick={() => {
                        setSearchModalOpen(false);
                        navigate(cmd.path);
                      }}
                    >
                      <div className="admin-palette-item-icon">
                        <Icon size={16} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <strong>{cmd.label}</strong>
                        <span style={{ fontSize: 11, color: 'var(--admin-muted)', marginLeft: 8 }}>
                          {cmd.category}
                        </span>
                      </div>
                      <span className="admin-palette-jump-hint">Jump ↵</span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="admin-palette-footer">
              <span>Use <strong>↑↓</strong> to navigate</span>
              <span><strong>ESC</strong> to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
