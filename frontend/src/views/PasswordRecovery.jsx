import { useState } from 'react';
import { auth } from '../api';
import '../member/theme.css';
import AuthLayout, { AuthAlert, AuthField, PasswordField } from '../components/AuthLayout';

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
    <AuthLayout title="Forgot your password?" subtitle="Enter your registered email and we’ll send you a secure reset link." footer={<button type="button" onClick={onBack}>Back to sign in</button>} titleId="forgot-password-title">
          <form onSubmit={submit} className="m-auth-form">
            <AuthField id="recovery-email" label="Email address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="member@example.com" />
            {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}
            <button type="submit" className="m-btn m-btn-primary m-auth-submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
          </form>
          <p className="m-auth-admin-note">For your security, we never confirm whether an email is registered.</p>
    </AuthLayout>
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
    <AuthLayout title="Create a new password" subtitle="Choose at least 8 characters. Make it memorable to you and difficult for others to guess." footer={success ? null : <button type="button" onClick={onComplete}>Back to sign in</button>} titleId="reset-password-title">
          {success ? (
            <>
              <AuthAlert tone="success">Your password has been updated. You can now sign in securely.</AuthAlert>
              <button type="button" className="m-btn m-btn-primary m-auth-submit m-auth-success-action" onClick={onComplete}>Sign in</button>
            </>
          ) : (
            <form onSubmit={submit} className="m-auth-form">
              <PasswordField id="new-password" label="New password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" hint="Use 8 or more characters." required />
              <PasswordField id="confirm-password" label="Confirm password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={8} autoComplete="new-password" required />
              {error ? <AuthAlert>{error}</AuthAlert> : null}
              <button type="submit" className="m-btn m-btn-primary m-auth-submit" disabled={loading}>{loading ? 'Updating…' : 'Update password'}</button>
            </form>
          )}
    </AuthLayout>
  );
}
