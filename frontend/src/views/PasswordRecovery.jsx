import { useState } from 'react';
import { auth } from '../api';
import '../member/theme.css';

export function ForgotPassword({ onBack }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await auth.forgotPassword({ email });
      setMessage(response.data?.message || 'If an account matches that email, a reset link will be sent.');
    } catch {
      setMessage('If an account matches that email, a reset link will be sent.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="theme-member">
      <div className="m-auth-shell">
        <div className="m-auth-card">
          <div className="m-auth-title">Reset your password</div>
          <div className="m-auth-sub">Enter the email registered with your Checkpoint account.</div>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="m-form-group">
              <label>Email address</label>
              <input className="m-form-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="member@example.com" />
            </div>
            {message && <div style={{ padding: 12, borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: 12.5, lineHeight: 1.5 }}>{message}</div>}
            <button type="submit" className="m-btn m-btn-primary" disabled={loading} style={{ width: '100%', padding: '13px 18px', fontSize: 15 }}>{loading ? 'Sending…' : 'Send reset link'}</button>
          </form>
          <div className="m-auth-footer"><a href="#" onClick={(event) => { event.preventDefault(); onBack(); }}>Back to sign in</a></div>
        </div>
      </div>
    </div>
  );
}

export function ResetPassword({ token, onComplete }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setLoading(true);
    try {
      await auth.resetPassword({ token, new_password: password });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to reset password. Please request a new link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="theme-member">
      <div className="m-auth-shell">
        <div className="m-auth-card">
          <div className="m-auth-title">Choose a new password</div>
          <div className="m-auth-sub">Use at least 8 characters and keep this password private.</div>
          {success ? (
            <>
              <div style={{ padding: 13, borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: 13, lineHeight: 1.5 }}>Your password has been updated. You can now sign in.</div>
              <button type="button" className="m-btn m-btn-primary" style={{ width: '100%', marginTop: 18, padding: '13px 18px' }} onClick={onComplete}>Sign in</button>
            </>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="m-form-group"><label>New password</label><input className="m-form-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></div>
              <div className="m-form-group"><label>Confirm password</label><input className="m-form-input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={8} autoComplete="new-password" required /></div>
              {error && <div style={{ color: 'var(--m-accent-red)', fontSize: 13 }}>⚠ {error}</div>}
              <button type="submit" className="m-btn m-btn-primary" disabled={loading} style={{ width: '100%', padding: '13px 18px', fontSize: 15 }}>{loading ? 'Updating…' : 'Update password'}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
