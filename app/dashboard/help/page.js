'use client';
import PageHeader from '@/app/components/shell/PageHeader';
import { useUser } from '@/app/components/user';

const GUIDES = {
  marker: {
    title: 'Attendance Marker Guide',
    steps: [
      'Sign in with e-mail and the code.',
      'Open Mark attendance.',
      'Pick the date and activity.',
      'Choose the years.',
      'Mark P or A and choose a reason for every absent cadet.',
      'Add a parade photo and allow location.',
      'Submit.',
      'Follow the status in History.',
      'If rejected press Correct and resubmit; you are signed out after 30 minutes.',
    ],
  },
  admin: {
    title: 'Administrator Guide',
    steps: [
      'Approvals shows items with you.',
      'Review the roll.',
      'Edit and Save edits if needed.',
      'Approve sends it to the CTO.',
      'Reject and send to marker needs a reason.',
      'Items returned by the CTO arrive with a banner.',
      'People creates accounts (marker, cadet, CTO).',
      'Google Sheet tab for setup and import.',
      'Promotion once a year; System health for problems; Settings for e-mails and reasons.',
    ],
  },
  cto: {
    title: 'Care Taker Officer (CTO) Guide',
    steps: [
      'Approvals shows items the Administrator has approved.',
      'Review the roll and parade details.',
      'Approve saves and e-mails the parade report.',
      'Return to Administrator needs a reason.',
      'Records shows verified nominal rolls and attendance.',
      'Reports for downloads.',
    ],
  },
  cadet: {
    title: 'Cadet Guide',
    steps: [
      'My attendance shows your percentage.',
      'The required percentage is set by the unit.',
      'Review your present and absent parade sessions.',
      'Track attendance credits and bonus benefits.',
      'Leaderboard shows unit attendance rankings.',
      'Calendar.',
    ],
  },
};

export default function HelpPage() {
  const user = useUser();
  const role = user?.role || 'cadet';
  const guide = GUIDES[role] || GUIDES.cadet;

  return (
    <div className="stack">
      <PageHeader
        title="Help"
        description="System guide and usage instructions"
      />
      <div className="card col" style={{ gap: 16 }}>
        <h2 className="h2">{guide.title}</h2>
        <ol style={{ margin: '0 0 16px 20px', padding: 0, lineHeight: 1.8 }}>
          {guide.steps.map((step, idx) => (
            <li key={idx} style={{ marginBottom: 8, fontSize: 14 }}>
              {step}
            </li>
          ))}
        </ol>
        <p className="muted small" style={{ margin: 0, borderTop: '1px solid var(--border-subtle, #eee)', paddingTop: 12 }}>
          Questions? Contact the Administrator.
        </p>
      </div>
    </div>
  );
}
