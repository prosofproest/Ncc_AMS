import ManageSection from '@/app/components/shell/ManageSection';

export const dynamicParams = true;

export const ADMIN_SECTIONS = [
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
  return ADMIN_SECTIONS.map((section) => ({ section }));
}

export default function AdminSectionPage({ params }) {
  return <ManageSection section={params?.section} />;
}
