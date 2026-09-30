import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Home, SearchX } from 'lucide-react';

const THEMES = {
  admin: {
    page: '#fafafa',
    card: '#ffffff',
    border: '#e4e4e7',
    text: '#18181b',
    muted: '#71717a',
    accent: '#2563eb',
    accentSoft: '#eff6ff',
    secondary: '#f4f4f5',
  },
  member: {
    page: 'var(--m-bg, #f8fafc)',
    card: 'var(--m-surface, #ffffff)',
    border: 'var(--m-border, #e2e8f0)',
    text: 'var(--m-text-primary, #0f172a)',
    muted: 'var(--m-text-muted, #64748b)',
    accent: 'var(--m-accent, #2563eb)',
    accentSoft: 'rgba(37, 99, 235, 0.08)',
    secondary: 'var(--m-surface-soft, #f8fafc)',
  },
  public: {
    page: '#f8fafc',
    card: '#ffffff',
    border: '#e2e8f0',
    text: '#0f172a',
    muted: '#64748b',
    accent: '#2563eb',
    accentSoft: '#eff6ff',
    secondary: '#f8fafc',
  },
};

export default function NotFound({ variant = 'admin' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = THEMES[variant] || THEMES.admin;
  const isPublic = variant === 'public';

  return (
    <div
      style={{
        minHeight: isPublic ? '100vh' : 'min(720px, calc(100vh - 140px))',
        display: 'grid',
        placeItems: 'center',
        padding: isPublic ? '32px 20px' : '40px 24px',
        background: theme.page,
      }}
    >
      <section
        aria-labelledby="not-found-title"
        style={{
          width: 'min(680px, 100%)',
          border: `1px solid ${theme.border}`,
          borderRadius: 24,
          background: theme.card,
          boxShadow: '0 18px 50px rgba(15, 23, 42, 0.08)',
          padding: 'clamp(28px, 5vw, 52px)',
          textAlign: 'center',
        }}
      >
        {isPublic && (
          <div style={{ marginBottom: 28, fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em', color: theme.text }}>
            Checkpoint
            <span style={{ color: theme.accent }}>.</span>
          </div>
        )}

        <div
          style={{
            width: 58,
            height: 58,
            margin: '0 auto 22px',
            borderRadius: 18,
            display: 'grid',
            placeItems: 'center',
            color: theme.accent,
            background: theme.accentSoft,
            border: `1px solid ${theme.border}`,
          }}
        >
          <SearchX size={27} strokeWidth={1.9} />
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 28,
            padding: '0 11px',
            marginBottom: 16,
            borderRadius: 999,
            background: theme.secondary,
            color: theme.muted,
            border: `1px solid ${theme.border}`,
            fontSize: 12,
            fontWeight: 750,
            letterSpacing: '0.08em',
          }}
        >
          404 · PAGE NOT FOUND
        </div>

        <h1
          id="not-found-title"
          style={{
            margin: 0,
            color: theme.text,
            fontSize: 'clamp(30px, 5vw, 44px)',
            lineHeight: 1.08,
            letterSpacing: '-0.04em',
          }}
        >
          This page is off the record.
        </h1>

        <p
          style={{
            maxWidth: 520,
            margin: '16px auto 0',
            color: theme.muted,
            fontSize: 15,
            lineHeight: 1.65,
          }}
        >
          The address may be incorrect, the page may have moved, or you may have followed an outdated link.
        </p>

        <div
          style={{
            margin: '22px auto 0',
            maxWidth: 520,
            padding: '11px 14px',
            borderRadius: 12,
            background: theme.secondary,
            border: `1px solid ${theme.border}`,
            color: theme.muted,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 12,
            overflowWrap: 'anywhere',
          }}
        >
          {location.pathname}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'center',
            marginTop: 28,
          }}
        >
          <Link
            to="/"
            style={{
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '0 18px',
              borderRadius: 10,
              background: theme.accent,
              color: '#fff',
              fontSize: 13,
              fontWeight: 750,
              textDecoration: 'none',
              boxShadow: '0 8px 18px rgba(37, 99, 235, 0.2)',
            }}
          >
            <Home size={16} />
            {isPublic ? 'Go to sign in' : 'Back to dashboard'}
          </Link>

          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '0 18px',
              borderRadius: 10,
              border: `1px solid ${theme.border}`,
              background: theme.card,
              color: theme.text,
              fontSize: 13,
              fontWeight: 750,
              cursor: 'pointer',
            }}
          >
            <ArrowLeft size={16} />
            Go back
          </button>
        </div>

        <p style={{ margin: '22px 0 0', color: theme.muted, fontSize: 12.5 }}>
          If you believe this page should exist, return to a known section and try again.
        </p>
      </section>
    </div>
  );
}
