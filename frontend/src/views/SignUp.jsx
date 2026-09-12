import { useState } from 'react';
import { auth } from '../api';
import '../member/theme.css';
import AuthLayout, { AuthAlert, AuthField, PasswordField } from '../components/AuthLayout';

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
    <AuthLayout title="Activate your account" subtitle="Match your club record, then choose secure details for your workspace." footer={<><span>Already activated?</span> <button type="button" onClick={onSwitchToLogin}>Sign in</button></>}>
          <form onSubmit={submit} className="m-auth-form">
            <AuthField id="activation-identity" label="Registered email or phone" type="text" placeholder="member@example.com or 07…" value={form.email_or_phone} onChange={(event) => setForm({ ...form, email_or_phone: event.target.value })} autoComplete="email" hint="Use the contact detail recorded by your group administrator." required />
            <AuthField id="activation-username" label="Choose username" type="text" placeholder="Your username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" required />
            <PasswordField id="activation-password" label="Choose password" placeholder="At least 8 characters" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" minLength={8} hint="Your password stays private and is never sent by email." required />
            <label className="m-auth-checkbox">
              <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
              <span>I accept the member portal terms and conditions</span>
            </label>
            {error ? <AuthAlert>{error}</AuthAlert> : null}
            <button type="submit" className="m-btn m-btn-primary m-auth-submit" disabled={loading}>
              {loading ? 'Activating…' : 'Activate account'}
            </button>
          </form>
    </AuthLayout>
  );
}
