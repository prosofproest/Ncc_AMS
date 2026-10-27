import ManageSection from '@/app/components/shell/ManageSection';

export const dynamicParams = true;

export const CTO_SECTIONS = [
  'overview',
  'approvals',
  'mark',
  'records',
  'people',
  'reports',
  'benefits',
  'sheet',
  'health',
  'settings',
  'promotion',
  'roles',
  'log',
  'attendance',
  'sheets',
  'promote',
  'logs',
];

export function generateStaticParams() {
  return CTO_SECTIONS.map((section) => ({ section }));
}

export default function CtoSectionPage({ params }) {
  return <ManageSection section={params?.section} />;
}
