export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { getSettings } from '@/lib/settings';
import { runMonthly } from '@/lib/summary';
import { logEvent } from '@/lib/events';
import { todayIST } from '@/lib/time';

// Manual trigger (the nightly job already sends this on the 1st). ?month=YYYY-MM picks a month.
export async function GET(request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const settings = await getSettings({ fresh: true });
  if (!settings.monthlyMailEnabled) return NextResponse.json({ success: true, skipped: 'monthly mail turned off' });
  const month = new URL(request.url).searchParams.get('month') || undefined;
  const out = await runMonthly(todayIST(), month);
  await logEvent({ type: 'cron:monthly', ok: out.success !== false, message: out.skipped || out.error || 'monthly summary sent' });
  return NextResponse.json(out);
}
