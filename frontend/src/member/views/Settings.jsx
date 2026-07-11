import { useState } from 'react';
import { Lock } from 'lucide-react';
import { SectionHeader, Card } from '../components/Primitives';
import { auth } from '../../api';

export default function MemberSettingsPage({ user }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setStatus(null);
    if (form.new_password !== form.confirm) {
      setStatus({ type: 'error', msg: 'New passwords do not match.' });
      return;
    }
    setSaving(true);
    try {
      await auth.changePassword({ current_password: form.current_password, new_password: form.new_password });
      setStatus({ type: 'success', msg: 'Password updated.' });
      setForm({ current_password: '', new_password: '', confirm: '' });
    } catch (e) {
      setStatus({ type: 'error', msg: e.response?.data?.error || 'Failed to update password.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="m-page">
      <SectionHeader title="Settings" sub="Manage your account" />

      <Card style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div className="m-avatar" style={{ width: 44, height: 44, fontSize: 16 }}>
            {(user?.name || user?.username || '?').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{user?.name || user?.username}</div>
            <div style={{ fontSize: 12, color: 'var(--m-text-muted)' }}>Member</div>
          </div>
        </div>
      </Card>

      <Card style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Lock size={16} color="var(--m-accent-blue)" />
          <div style={{ fontWeight: 800, fontSize: 15 }}>Change Password</div>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="m-form-group">
            <label>Current password</label>
            <input
              className="m-form-input" type="password" required
              value={form.current_password}
              onChange={(e) => setForm({ ...form, current_password: e.target.value })}
            />
          </div>
          <div className="m-form-group">
            <label>New password</label>
            <input
              className="m-form-input" type="password" required minLength={6}
              value={form.new_password}
              onChange={(e) => setForm({ ...form, new_password: e.target.value })}
            />
          </div>
          <div className="m-form-group">
            <label>Confirm new password</label>
            <input
              className="m-form-input" type="password" required minLength={6}
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
          </div>
          {status && (
            <div style={{ fontSize: 13, color: status.type === 'error' ? 'var(--m-accent-red)' : 'var(--m-accent-green)' }}>
              {status.msg}
            </div>
          )}
          <button type="submit" className="m-btn m-btn-primary" disabled={saving} style={{ alignSelf: 'flex-start' }}>
            {saving ? 'Saving…' : 'Update Password'}
          </button>
        </form>
      </Card>
    </div>
  );
}
