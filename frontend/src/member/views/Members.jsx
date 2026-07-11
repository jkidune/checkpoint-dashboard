import { Users } from 'lucide-react';
import { SectionHeader, StatCard, StatusPill, Card, Loading, useApi } from '../components/Primitives';
import { members as membersApi } from '../../api';

export default function MemberMembersPage({ user }) {
  const { data, loading } = useApi(() => membersApi.list());

  if (loading) return <Loading />;
  const list = data || [];

  return (
    <div className="m-page">
      <SectionHeader title="Members" sub={`${list.length} members in the club`} />

      <div className="m-stats-grid">
        <StatCard icon={<Users size={17} />} iconBg="var(--m-accent-blue-bg)" iconColor="var(--m-accent-blue)" label="Total Members" value={list.length} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
        {list.map((m) => {
          const isMe = m.id === user?.member_id;
          return (
            <Card key={m.id} style={isMe ? { borderColor: 'var(--m-accent-blue)', boxShadow: '0 0 0 2px var(--m-accent-blue-bg)' } : undefined}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="m-avatar">{m.name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.name}{isMe ? ' (You)' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <StatusPill status={m.office} color="blue" />
                    <StatusPill status={m.status} />
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
