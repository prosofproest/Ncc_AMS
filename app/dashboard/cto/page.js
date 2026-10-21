import { redirect } from 'next/navigation';

export default function CtoIndexPage() {
  redirect('/dashboard/cto/overview');
}
