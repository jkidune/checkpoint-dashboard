import { HelpCircle, Phone, Mail } from 'lucide-react';
import { SectionHeader, Card } from '../components/Primitives';

export default function MemberHelpPage() {
  return (
    <div className="m-page">
      <SectionHeader title="Help Center" sub="Questions about your account or the club? Reach out." />
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <HelpCircle size={18} color="var(--m-accent-blue)" />
          <div style={{ fontWeight: 800, fontSize: 15 }}>Frequently asked</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>How do I update my contribution record?</div>
            <div style={{ fontSize: 13, color: 'var(--m-text-secondary)' }}>Contributions are recorded by the treasurer once a payment clears. Contact them if a payment you made isn't showing up.</div>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>How do I reset my password?</div>
            <div style={{ fontSize: 13, color: 'var(--m-text-secondary)' }}>Password resets aren't self-service yet — contact your treasurer to have it reset for you.</div>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>Why can't I see other members' contribution or loan details?</div>
            <div style={{ fontSize: 13, color: 'var(--m-text-secondary)' }}>Member financial detail is private to each member — you can see your own figures plus the group's aggregate totals on the Dashboard.</div>
          </div>
        </div>
      </Card>
      <Card>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Contact your treasurer</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--m-text-secondary)' }}>
            <Mail size={15} /> treasurer@checkpoint.club
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--m-text-secondary)' }}>
            <Phone size={15} /> Contact number on file with the club
          </div>
        </div>
      </Card>
    </div>
  );
}
