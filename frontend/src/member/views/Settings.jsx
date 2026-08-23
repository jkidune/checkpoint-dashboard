import { useState } from 'react';
import { Lock, Mail, Phone, UserCircle2 } from 'lucide-react';
import { SectionHeader, Card, Loading, useApi } from '../components/Primitives';
import { auth, members } from '../../api';

export default function MemberSettingsPage({ user }) {
  const { data: me, loading } = useApi(() => members.me());
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setStatus(null);
    if (form.new_password.length < 8) return setStatus({ type: 'error', msg: 'New password must be at least 8 characters.' });
    if (form.new_password !== form.confirm) return setStatus({ type: 'error', msg: 'New passwords do not match.' });
    setSaving(true);
    try {
      await auth.changePassword({ current_password: form.current_password, new_password: form.new_password });
      setStatus({ type: 'success', msg: 'Password updated.' });
      setForm({ current_password: '', new_password: '', confirm: '' });
    } catch (error) {
      setStatus({ type: 'error', msg: error.response?.data?.error || 'Failed to update password.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="m-page">
      <SectionHeader title="Settings" sub="Your profile and account security" />

      <Card style={{ maxWidth: 620 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="m-avatar" style={{ width: 44, height: 44, fontSize: 16 }}>{(me?.name || user?.name || user?.username || '?').charAt(0).toUpperCase()}</div>
          <div><div style={{ fontWeight: 750, fontSize: 14 }}>{me?.name || user?.name || user?.username}</div><div style={{ fontSize: 11.5, color: 'var(--m-text-muted)' }}>Member #{me?.id || user?.member_id || '—'}</div></div>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11, border: '1px solid var(--m-border)', borderRadius: 10 }}><Mail size={14} color="var(--m-text-muted)" /><div><div style={{ fontSize: 10.5, color: 'var(--m-text-muted)' }}>Email</div><div style={{ fontSize: 12.5, fontWeight: 650 }}>{me?.email || 'Not on file'}</div></div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11, border: '1px solid var(--m-border)', borderRadius: 10 }}><Phone size={14} color="var(--m-text-muted)" /><div><div style={{ fontSize: 10.5, color: 'var(--m-text-muted)' }}>Phone</div><div style={{ fontSize: 12.5, fontWeight: 650 }}>{me?.phone || 'Not on file'}</div></div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11, border: '1px solid var(--m-border)', borderRadius: 10 }}><UserCircle2 size={14} color="var(--m-text-muted)" /><div><div style={{ fontSize: 10.5, color: 'var(--m-text-muted)' }}>Username</div><div style={{ fontSize: 12.5, fontWeight: 650 }}>{user?.username || me?.account?.username || '—'}</div></div></div>
        </div>
        <div style={{ marginTop: 14, fontSize: 11.5, lineHeight: 1.5, color: 'var(--m-text-muted)' }}>Contact details are maintained by the club administrator so your login identity and financial member record stay aligned.</div>
      </Card>

      <Card style={{ maxWidth: 620 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}><Lock size={16} color="var(--m-accent-blue)" /><div style={{ fontWeight: 800, fontSize: 15 }}>Change password</div></div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="m-form-group"><label>Current password</label><input className="m-form-input" type="password" required value={form.current_password} onChange={(event) => setForm({ ...form, current_password: event.target.value })} autoComplete="current-password" /></div>
          <div className="m-form-group"><label>New password</label><input className="m-form-input" type="password" required minLength={8} value={form.new_password} onChange={(event) => setForm({ ...form, new_password: event.target.value })} autoComplete="new-password" /></div>
          <div className="m-form-group"><label>Confirm new password</label><input className="m-form-input" type="password" required minLength={8} value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} autoComplete="new-password" /></div>
          {status && <div style={{ fontSize: 13, color: status.type === 'error' ? 'var(--m-accent-red)' : 'var(--m-accent-green)' }}>{status.msg}</div>}
          <button type="submit" className="m-btn m-btn-primary" disabled={saving} style={{ alignSelf: 'flex-start' }}>{saving ? 'Saving…' : 'Update password'}</button>
        </form>
      </Card>
    </div>
  );
}
