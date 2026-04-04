import { useState } from 'react';
import { auth } from '../api';

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await auth.login(form);
      localStorage.setItem('cp_token', res.data.token);
      onLogin(res.data.user);
    } catch (e) {
      setError(e.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)',
      backgroundImage: 'radial-gradient(circle at 20% 50%, #0ea5e908 0%, transparent 50%), radial-gradient(circle at 80% 20%, #14b8a608 0%, transparent 50%)',
    }}>
      <div style={{ width: '100%', maxWidth: 380, padding: '0 20px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg, #0ea5e9, #14b8a6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 900, color: '#fff', fontSize: 26, fontFamily: 'var(--font-display)',
            margin: '0 auto 16px',
          }}>C</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>
            Checkpoint
          </h1>
          <p style={{ color: 'var(--accent-blue)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Investment Club · Member Portal
          </p>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              <div className="form-group">
                <label>Email address</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                  required
                />
              </div>

              <div className="form-group">
                <label>Password</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  autoComplete="current-password"
                  required
                />
              </div>

              {error && (
                <div style={{ color: 'var(--accent-red)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>⚠</span> {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>

            </div>
          </div>
        </form>

        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, marginTop: 24 }}>
          Use the email address associated with your membership.
        </p>

      </div>
    </div>
  );
}
