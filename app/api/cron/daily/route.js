export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { db, Collections, snapToArr } from '@/lib/firebase';
import { getSettings } from '@/lib/settings';
import { getAllUsers } from '@/lib/users';
import { cycleSessions } from '@/lib/attendance';
import { rebuildCycle } from '@/lib/sheets';
import { importFromSheet } from '@/lib/import';
import { logEvent, pruneEvents } from '@/lib/events';
import { summariesDue, runWeekly, runMonthly } from '@/lib/summary';
import { todayIST } from '@/lib/time';

// Nightly (11 PM IST): import roster edits from the sheet, then rebuild every report tab from the
// database so the sheet can never drift. Also cleans old logs / expired OTP challenges.
export async function GET(request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const t0 = Date.now();
  const out = {};
  try {
    out.import = await importFromSheet().catch(e => ({ success: false, error: e.message }));
    const settings = await getSettings({ fresh: true });
    const [users, sessions, recSnap, benSnap] = await Promise.all([
      getAllUsers({ fresh: true }), cycleSessions(settings.currentCycle),
      db.collection(Collections.ATTENDANCE).where('cycle', '==', settings.currentCycle).get(),
      db.collection(Collections.BENEFITS).where('cycle', '==', settings.currentCycle).get(),
    ]);
    out.rebuild = await rebuildCycle({ users, sessions, records: snapToArr(recSnap), benefits: snapToArr(benSnap), thresholdPct: settings.thresholdPct });
    out.pruned = await pruneEvents(14);
    // The one scheduled job also sends the Monday weekly digest and the monthly summary on the 1st
    const today = todayIST(), due = summariesDue(today); out.summaries = [];
    if (due.weekly) { const r = await runWeekly(today).catch(e => ({ success: false, error: e.message })); out.summaries.push({ weekly: r.skipped || r.error || 'sent' }); await logEvent({ type: 'cron:weekly', ok: r.success !== false, message: r.skipped || r.error || 'weekly digest sent' }); }
    if (due.monthly && settings.monthlyMailEnabled) { const r = await runMonthly(today).catch(e => ({ success: false, error: e.message })); out.summaries.push({ monthly: r.skipped || r.error || 'sent' }); await logEvent({ type: 'cron:monthly', ok: r.success !== false, message: r.skipped || r.error || 'monthly summary sent' }); }
    const old = await db.collection(Collections.OTP).where('expiresAt', '<', Date.now()).limit(400).get();
    if (!old.empty) { const b = db.batch(); old.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
    const ok = out.rebuild?.success !== false;
    await logEvent({ type: 'cron:nightly', ok, ms: Date.now() - t0, message: ok ? `rebuilt ${out.rebuild?.logRows ?? 0} rows` : out.rebuild?.error });
    return NextResponse.json({ success: ok, ...out });
  } catch (e) {
    await logEvent({ type: 'cron:nightly', ok: false, ms: Date.now() - t0, message: e.message });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
