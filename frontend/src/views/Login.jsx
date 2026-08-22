import { useState } from 'react';
import { auth } from '../api';
import '../member/theme.css';

export default function Login({ onLogin, onSwitchToSignup, onForgotPassword }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await auth.login(form);
      localStorage.setItem('cp_token', response.data.token);
      onLogin(response.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="theme-member">
      <div className="m-auth-shell">
        <div className="m-auth-card">
          <div className="m-auth-title">Sign in to Checkpoint</div>
          <div className="m-auth-sub">Use your email or username to access your member account.</div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="m-form-group">
              <label>Email or username</label>
              <input className="m-form-input" type="text" placeholder="member@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="username" required />
            </div>

            <div className="m-form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <label>Password</label>
                <button type="button" onClick={onForgotPassword} style={{ border: 0, background: 'transparent', padding: 0, color: 'var(--m-accent-blue)', fontSize: 12.5, fontWeight: 650, cursor: 'pointer' }}>
                  Forgot password?
                </button>
              </div>
              <input className="m-form-input" type="password" placeholder="••••••••" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="current-password" required />
            </div>

            {error && <div style={{ color: 'var(--m-accent-red)', fontSize: 13 }}>⚠ {error}</div>}

            <button type="submit" className="m-btn m-btn-primary" disabled={loading} style={{ width: '100%', padding: '13px 18px', fontSize: 15 }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="m-auth-footer">
            Need to activate your account?{' '}
            <a href="#" onClick={(event) => { event.preventDefault(); onSwitchToSignup(); }}>Create account</a>
          </div>
        </div>
      </div>
    </div>
  );
}
