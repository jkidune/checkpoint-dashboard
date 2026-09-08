import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  Banknote,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Receipt,
  Search,
  Settings as SettingsIcon,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import api from '../api';
import { showToast } from './UI';
import '../notification-panel.css';

const ROUTE_LABELS = {
  '/': 'Overview',
  '/contributions': 'Contributions',
  '/loans': 'Loan Register',
  '/loan-requests': 'Loan Requests',
  '/members': 'Member Directory',
  '/member-accounts': 'Member Accounts',
  '/form-intake': 'Form Intake',
  '/transactions': 'Transaction Ledger',
  '/investments': 'Investments & Strategy',
  '/expenses': 'Expense Register',
  '/settings': 'Constitution & Settings',
};

const COMMAND_LINKS = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, category: 'Dashboard' },
  { path: '/contributions', label: 'Contributions Matrix', icon: Wallet, category: 'Financials' },
  { path: '/loans', label: 'Loan Register & Servicing', icon: Banknote, category: 'Financials' },
  { path: '/form-intake', label: 'Form Intake & Verification', icon: Receipt, category: 'Auditing' },
  { path: '/members', label: 'Member Directory', icon: Users, category: 'Roster' },
  { path: '/transactions', label: 'Transaction Ledger', icon: ArrowLeftRight, category: 'Auditing' },
  { path: '/investments', label: 'Investments & Roadmap', icon: TrendingUp, category: 'Portfolio' },
  { path: '/expenses', label: 'Expense Register', icon: Receipt, category: 'Financials' },
  { path: '/settings', label: 'Constitution & Rules', icon: SettingsIcon, category: 'Settings' },
];

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'AD';
}

function relativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function AdminAvatar({ user, src, size = 32, className = '' }) {
  const [imgError, setImgError] = useState(false);
  const text = initials(user?.name || user?.username || 'Admin');
  if (src && !imgError) {
    return <img src={src} alt={user?.name || 'User'} onError={() => setImgError(true)} className={className} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '1px solid #e4e4e7', flexShrink: 0 }} />;
  }
  return (
    <div className={className} style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,#f4f4f5,#e4e4e7)', border: '1px solid #d4d4d8', color: '#27272a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.36), fontWeight: 750, flexShrink: 0 }}>
      {text}
    </div>
  );
}

export default function AdminTopNavbar({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [bellOpen, setBellOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [notificationTab, setNotificationTab] = useState('all');
  const [feed, setFeed] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [feedLoading, setFeedLoading] = useState(false);

  const bellRef = useRef(null);
  const profileRef = useRef(null);
  const searchInputRef = useRef(null);
  const loadedOnceRef = useRef(false);
  const knownUnreadRef = useRef(new Set());

  const loadFeed = async ({ announce = false } = {}) => {
    setFeedLoading(true);
    try {
      const response = await api.get('/notifications/admin-feed', { params: { filter: 'all' } });
      const items = response.data?.items || [];
      const nextUnread = new Set(items.filter((item) => !item.read).map((item) => item.key));
      if (announce && loadedOnceRef.current) {
        const newItems = items.filter((item) => !item.read && !knownUnreadRef.current.has(item.key));
        const payment = newItems.find((item) => item.source === 'form_intake');
        if (payment) showToast(`New payment submission: ${payment.title}. Open Notifications to review it.`);
        else if (newItems.length) showToast(`${newItems.length} new Checkpoint notification${newItems.length === 1 ? '' : 's'}.`);
      }
      knownUnreadRef.current = nextUnread;
      loadedOnceRef.current = true;
      setFeed(items);
      setUnreadCount(Number(response.data?.unread_count || 0));
    } catch (_) {
      // Keep the shell usable if the notification endpoint is temporarily unavailable.
    } finally {
      setFeedLoading(false);
    }
  };

  useEffect(() => {
    loadFeed();
    const timer = window.setInterval(() => loadFeed({ announce: true }), 20000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    loadFeed();
  }, [location.pathname]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearchModalOpen((previous) => !previous);
      }
      if (event.key === 'Escape') {
        setSearchModalOpen(false);
        setBellOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (bellRef.current && !bellRef.current.contains(event.target)) setBellOpen(false);
      if (profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchModalOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [searchModalOpen]);

  const visibleFeed = useMemo(() => notificationTab === 'unread' ? feed.filter((item) => !item.read) : feed, [feed, notificationTab]);
  const filteredCommands = COMMAND_LINKS.filter((command) => command.label.toLowerCase().includes(commandQuery.toLowerCase()) || command.category.toLowerCase().includes(commandQuery.toLowerCase()));

  const markReadAndOpen = async (item) => {
    if (!item.read) {
      setFeed((current) => current.map((row) => row.key === item.key ? { ...row, read: true } : row));
      setUnreadCount((current) => Math.max(0, current - 1));
      knownUnreadRef.current.delete(item.key);
      api.patch(`/notifications/admin-feed/${item.source}/${item.id}/read`).catch(() => loadFeed());
    }
    setBellOpen(false);
    navigate(item.route || '/');
  };

  const markAllRead = async () => {
    if (!unreadCount) return;
    const before = feed;
    setFeed((current) => current.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
    knownUnreadRef.current.clear();
    try {
      await api.patch('/notifications/admin-feed/read-all');
    } catch (error) {
      setFeed(before);
      loadFeed();
      showToast(error.response?.data?.error || 'Could not mark notifications as read', 'error');
    }
  };

  const currentPageLabel = ROUTE_LABELS[location.pathname] || 'Dashboard';

  return (
    <>
      <header className="admin-topbar">
        <div className="admin-topbar-left"><span className="admin-breadcrumb-root" onClick={() => navigate('/')}>Checkpoint</span><ChevronRight size={14} className="admin-breadcrumb-separator" /><span className="admin-breadcrumb-current">{currentPageLabel}</span></div>
        <div className="admin-topbar-center"><button type="button" className="admin-global-search-btn" onClick={() => setSearchModalOpen(true)} aria-label="Search members, loans, records (Cmd+K)"><Search size={14} className="search-icon" /><span className="search-placeholder">Search members, loans, transactions…</span><kbd className="search-kbd">⌘K</kbd></button></div>
        <div className="admin-topbar-right">
          <div className="admin-popover-anchor" ref={bellRef}>
            <button type="button" className={`admin-nav-icon-btn${unreadCount ? ' has-unread' : ''}`} onClick={(event) => { event.stopPropagation(); setBellOpen((previous) => !previous); setProfileOpen(false); if (!bellOpen) loadFeed(); }} title={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`} aria-expanded={bellOpen}><Bell size={17} />{unreadCount > 0 && <span className="admin-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
            {bellOpen && (
              <div className="checkpoint-notification-panel" onClick={(event) => event.stopPropagation()}>
                <div className="checkpoint-notification-head"><h3>Notifications</h3><button type="button" className="checkpoint-mark-read" onClick={markAllRead} disabled={!unreadCount}>Mark all as read</button></div>
                <div className="checkpoint-notification-tabs"><button type="button" className={`checkpoint-notification-tab${notificationTab === 'all' ? ' active' : ''}`} onClick={() => setNotificationTab('all')}>All Notifications</button><button type="button" className={`checkpoint-notification-tab${notificationTab === 'unread' ? ' active' : ''}`} onClick={() => setNotificationTab('unread')}>Unread ({unreadCount})</button></div>
                <div className="checkpoint-notification-list">
                  {feedLoading && feed.length === 0 ? <div className="checkpoint-notification-empty">Loading notifications…</div> : visibleFeed.length === 0 ? <div className="checkpoint-notification-empty">{notificationTab === 'unread' ? 'You are all caught up.' : 'No notifications yet.'}</div> : visibleFeed.map((item) => { const Icon = item.source === 'form_intake' ? CircleDollarSign : Receipt; return <button type="button" key={item.key} className={`checkpoint-notification-item${item.read ? '' : ' unread'}`} onClick={() => markReadAndOpen(item)}><span className={`checkpoint-notification-icon ${item.tone || ''}`}><Icon size={15} /></span><span className="checkpoint-notification-copy"><span className="checkpoint-notification-title-row"><strong>{item.title}</strong>{!item.read && <span className="checkpoint-unread-dot" />}</span><span className="checkpoint-notification-message">{item.message}</span>{item.detail && <span className="checkpoint-notification-detail">{item.detail}</span>}</span><span className="checkpoint-notification-time">{relativeTime(item.created_at)}</span></button>; })}
                </div>
                <div className="checkpoint-notification-footer"><span>Live admin inbox</span><span>Refreshes every 20 sec</span></div>
              </div>
            )}
          </div>
          <div className="admin-popover-anchor" ref={profileRef}>
            <button type="button" className="admin-profile-btn" onClick={(event) => { event.stopPropagation(); setProfileOpen((previous) => !previous); setBellOpen(false); }} aria-expanded={profileOpen}><AdminAvatar user={user} size={30} /><div className="admin-profile-meta"><span className="admin-profile-name">{user?.name || user?.username || 'Admin'}</span><span className="admin-profile-role">Administrator</span></div><ChevronDown size={12} style={{ color: '#a1a1aa', flexShrink: 0 }} /></button>
            {profileOpen && <div className="admin-popover-dropdown is-profile" onClick={(event) => event.stopPropagation()}><div className="admin-profile-dropdown-header"><AdminAvatar user={user} size={38} /><div><div style={{ fontWeight: 700, fontSize: 13, color: 'var(--admin-text)' }}>{user?.name || user?.username || 'Administrator'}</div><div style={{ fontSize: 11, color: 'var(--admin-muted)' }}>{user?.role || 'Admin'} · Checkpoint</div></div></div><div className="admin-dropdown-menu-list"><button type="button" onClick={() => { setProfileOpen(false); navigate('/settings'); }}><SettingsIcon size={14} /><span>Account settings</span></button><button type="button" onClick={() => { setProfileOpen(false); navigate('/members'); }}><Users size={14} /><span>Member Directory</span></button><button type="button" onClick={() => { setProfileOpen(false); navigate('/transactions'); }}><ArrowLeftRight size={14} /><span>Financial Ledger</span></button><button type="button" onClick={() => setProfileOpen(false)} style={{ color: 'var(--admin-muted)' }}><HelpCircle size={14} /><span>Help & support</span></button></div><div className="admin-dropdown-menu-divider" /><div className="admin-dropdown-menu-list"><button type="button" className="is-danger" onClick={() => { setProfileOpen(false); onLogout(); }}><LogOut size={14} /><span>Log out</span></button></div></div>}
          </div>
        </div>
      </header>
      {searchModalOpen && <div className="admin-palette-backdrop" onClick={() => setSearchModalOpen(false)}><div className="admin-palette-panel" onClick={(event) => event.stopPropagation()}><div className="admin-palette-search-bar"><Search size={18} color="var(--admin-muted)" /><input ref={searchInputRef} type="text" placeholder="Jump to page, member or tool…" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} /><kbd className="search-kbd" onClick={() => setSearchModalOpen(false)}>ESC</kbd></div><div className="admin-palette-results"><div className="admin-palette-group-title">Navigation & Quick Jump</div>{filteredCommands.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--admin-muted)', fontSize: 13 }}>No matching destinations found.</div> : filteredCommands.map((command) => { const Icon = command.icon; return <div key={command.path} className="admin-palette-item" onClick={() => { setSearchModalOpen(false); navigate(command.path); }}><div className="admin-palette-item-icon"><Icon size={16} /></div><div style={{ flex: 1 }}><strong>{command.label}</strong><span style={{ fontSize: 11, color: 'var(--admin-muted)', marginLeft: 8 }}>{command.category}</span></div><span className="admin-palette-jump-hint">Jump ↵</span></div>; })}</div><div className="admin-palette-footer"><span>Use <strong>↑↓</strong> to navigate</span><span><strong>ESC</strong> to close</span></div></div></div>}
    </>
  );
}
