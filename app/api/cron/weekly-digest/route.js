export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { runWeekly } from '@/lib/summary';
import { logEvent } from '@/lib/events';
import { todayIST } from '@/lib/time';

// Manual trigger (the nightly job already sends this every Monday).
export async function GET(request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const out = await runWeekly(todayIST());
  await logEvent({ type: 'cron:weekly', ok: out.success !== false, message: out.skipped || out.error || 'weekly digest sent' });
  return NextResponse.json(out);
}
