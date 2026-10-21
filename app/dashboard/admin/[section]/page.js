'use client';
import ManageSection from '@/app/components/shell/ManageSection';

export default function AdminSectionPage({ params }) {
  return <ManageSection section={params?.section} />;
}
