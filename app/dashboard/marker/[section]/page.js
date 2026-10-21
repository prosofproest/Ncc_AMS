'use client';
import MarkerSection from '@/app/components/shell/MarkerSection';

export default function MarkerSectionPage({ params }) {
  return <MarkerSection section={params?.section} />;
}
