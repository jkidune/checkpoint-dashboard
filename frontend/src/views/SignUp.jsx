import { useState } from 'react';
import { auth } from '../api';
import '../member/theme.css';

export default function SignUp({ onLogin, onSwitchToLogin }) {
  const [form, setForm] = useState({ email_or_phone: '', username: '', password: '' });
  const [acceptedTerms, setAcceptedTerms] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!acceptedTerms) return setError('Please accept the terms and conditions to continue.');
    setLoading(true);
    try {
      const response = await auth.signup(form);
      localStorage.setItem('cp_token', response.data.token);
      onLogin(response.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Account activation failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="theme-member">
      <div className="m-auth-shell">
        <div className="m-auth-card">
          <div className="m-auth-title">Activate your account</div>
          <div className="m-auth-sub">Match your existing club record, then choose your own login details.</div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="m-form-group">
              <label>Registered email or phone</label>
              <input className="m-form-input" type="text" placeholder="member@example.com or 07…" value={form.email_or_phone} onChange={(event) => setForm({ ...form, email_or_phone: event.target.value })} autoComplete="email" required />
              <div style={{ fontSize: 12, color: 'var(--m-text-muted)', lineHeight: 1.5 }}>This must match the email or phone already recorded by the club administrator.</div>
            </div>

            <div className="m-form-group">
              <label>Choose username</label>
              <input className="m-form-input" type="text" placeholder="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" required />
            </div>

            <div className="m-form-group">
              <label>Choose password</label>
              <input className="m-form-input" type="password" placeholder="At least 8 characters" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" minLength={8} required />
              <div style={{ fontSize: 12, color: 'var(--m-text-muted)' }}>Your password is chosen by you and is never emailed by Checkpoint.</div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--m-text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
              I accept the member portal terms and conditions
            </label>

            {error && <div style={{ color: 'var(--m-accent-red)', fontSize: 13 }}>⚠ {error}</div>}

            <button type="submit" className="m-btn m-btn-primary" disabled={loading} style={{ width: '100%', padding: '13px 18px', fontSize: 15 }}>
              {loading ? 'Activating…' : 'Activate account'}
            </button>
          </form>

          <div className="m-auth-footer">Already activated? <a href="#" onClick={(event) => { event.preventDefault(); onSwitchToLogin(); }}>Sign in</a></div>
        </div>
      </div>
    </div>
  );
}
