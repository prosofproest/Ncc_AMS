'use client';
import ManageSection from '@/app/components/shell/ManageSection';

export default function CtoSectionPage({ params }) {
  return <ManageSection section={params?.section} />;
}
