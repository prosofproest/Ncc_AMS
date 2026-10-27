import MarkerSection from '@/app/components/shell/MarkerSection';

export const dynamicParams = true;

export const MARKER_SECTIONS = ['mark', 'history'];

export function generateStaticParams() {
  return MARKER_SECTIONS.map((section) => ({ section }));
}

export default function MarkerSectionPage({ params }) {
  return <MarkerSection section={params?.section} />;
}
