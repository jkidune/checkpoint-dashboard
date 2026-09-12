import { useState } from 'react';
import { auth } from '../api';
import '../member/theme.css';
import AuthLayout, { AuthAlert, AuthField, PasswordField } from '../components/AuthLayout';

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
    <AuthLayout title="Welcome back" subtitle="Sign in to continue to your Checkpoint workspace." footer={<><span>New to Checkpoint?</span> <button type="button" onClick={onSwitchToSignup}>Activate your member account</button></>}>
          <form onSubmit={submit} className="m-auth-form">
            <AuthField id="login-identity" label="Email or username" type="text" placeholder="member@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="username" required />
            <PasswordField id="login-password" label="Password" placeholder="Enter your password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="current-password" required />
            <button type="button" className="m-auth-text-action m-auth-forgot-action" onClick={onForgotPassword}>Forgot password?</button>
            {error ? <AuthAlert>{error}</AuthAlert> : null}
            <button type="submit" className="m-btn m-btn-primary m-auth-submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="m-auth-admin-note">Membership is managed by your group administrator.</p>
    </AuthLayout>
  );
}
