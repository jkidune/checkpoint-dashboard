import { useState } from 'react';
import { auth } from '../api';
import '../member/theme.css';

export default function SignUp({ onLogin, onSwitchToLogin }) {
  const [form, setForm] = useState({ email_or_phone: '', username: '', password: '' });
  const [acceptedTerms, setAcceptedTerms] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!acceptedTerms) {
      setError('Please accept the terms and conditions to continue.');
      return;
    }
    setLoading(true);
    try {
      const res = await auth.signup(form);
      localStorage.setItem('cp_token', res.data.token);
      onLogin(res.data.user);
    } catch (e) {
      setError(e.response?.data?.error || 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="theme-member">
      <div className="m-auth-shell">
        <div className="m-auth-card">
          <div className="m-auth-title">Create an Account</div>
          <div className="m-auth-sub">Create account to continue</div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="m-form-group">
              <label>Email or phone:</label>
              <input
                className="m-form-input"
                type="text"
                placeholder="johndoe@gmail.com or 0700000000"
                value={form.email_or_phone}
                onChange={(e) => setForm({ ...form, email_or_phone: e.target.value })}
                autoComplete="email"
                required
              />
              <div style={{ fontSize: 12, color: 'var(--m-text-muted)' }}>
                Must match the email or phone your treasurer has on file for you.
              </div>
            </div>

            <div className="m-form-group">
              <label>Username</label>
              <input
                className="m-form-input"
                type="text"
                placeholder="username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoComplete="username"
                required
              />
            </div>

            <div className="m-form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>Password</label>
                <span
                  title="Contact your treasurer to reset your password"
                  style={{ fontSize: 13, color: '#cbd5e1', cursor: 'not-allowed' }}
                >
                  Forget Password?
                </span>
              </div>
              <input
                className="m-form-input"
                type="password"
                placeholder="At least 6 characters"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--m-text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
              I accept terms and conditions
            </label>

            {error && (
              <div style={{ color: 'var(--m-accent-red)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>⚠</span> {error}
              </div>
            )}

            <button type="submit" className="m-btn m-btn-primary" disabled={loading} style={{ width: '100%', padding: '13px 18px', fontSize: 15 }}>
              {loading ? 'Creating account…' : 'Sign Up'}
            </button>
          </form>

          <div className="m-auth-footer">
            Already have an account?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); onSwitchToLogin(); }}>Login</a>
          </div>
        </div>
      </div>
    </div>
  );
}
