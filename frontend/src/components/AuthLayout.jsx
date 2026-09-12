import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import BrandLogo from './BrandLogo';

export function AuthAmbientGradient() {
  return (
    <div className="m-auth-ambient" aria-hidden="true">
      <span className="m-auth-ambient-field is-sky" />
      <span className="m-auth-ambient-field is-lavender" />
      <span className="m-auth-ambient-field is-indigo" />
      <span className="m-auth-ambient-screen" />
    </div>
  );
}

export default function AuthLayout({ title, subtitle, children, footer, titleId = 'auth-title' }) {
  return (
    <div className="theme-member">
      <main className="m-auth-shell">
        <section className="m-auth-brand-panel" aria-label="Checkpoint">
          <AuthAmbientGradient />
          <div className="m-auth-brand-content">
            <BrandLogo className="m-auth-brand-logo" />
            <div className="m-auth-brand-copy">
              <p className="m-auth-brand-kicker">Financial management for groups</p>
              <h2>Run your group’s<br />finances with clarity.</h2>
              <p>Contributions, loans, investments and member records — organised in one shared system.</p>
            </div>
            <p className="m-auth-brand-phrase">People. Payments. Progress.</p>
          </div>
        </section>

        <section className="m-auth-stage">
          <div className="m-auth-card" aria-labelledby={titleId}>
            <div className="m-auth-card-header">
              <p className="m-auth-card-kicker">Checkpoint workspace</p>
              <h1 id={titleId} className="m-auth-title">{title}</h1>
              <p className="m-auth-sub">{subtitle}</p>
            </div>
            {children}
            {footer ? <div className="m-auth-footer">{footer}</div> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

export function AuthField({ id, label, hint, error, className = '', ...inputProps }) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`m-auth-field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="m-auth-input" aria-describedby={describedBy} aria-invalid={error ? 'true' : undefined} {...inputProps} />
      {hint ? <p id={`${id}-hint`} className="m-auth-field-hint">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="m-auth-field-error">{error}</p> : null}
    </div>
  );
}

export function PasswordField({ id, label, hint, error, ...inputProps }) {
  const [visible, setVisible] = useState(false);
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div className="m-auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="m-auth-password-control">
        <input id={id} className="m-auth-input" type={visible ? 'text' : 'password'} aria-describedby={describedBy} aria-invalid={error ? 'true' : undefined} {...inputProps} />
        <button type="button" className="m-auth-password-toggle" onClick={() => setVisible((value) => !value)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint ? <p id={`${id}-hint`} className="m-auth-field-hint">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="m-auth-field-error">{error}</p> : null}
    </div>
  );
}

export function AuthAlert({ children, tone = 'error' }) {
  return <div className={`m-auth-alert is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}
