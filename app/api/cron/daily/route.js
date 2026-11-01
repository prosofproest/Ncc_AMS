export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { db, Collections, snapToArr } from '@/lib/firebase';
import { getSettings, cleanEmail } from '@/lib/settings';
import { getAllUsers } from '@/lib/users';
import { cycleSessions } from '@/lib/attendance';
import { rebuildCycle } from '@/lib/sheets';
import { importFromSheet } from '@/lib/import';
import { logEvent, pruneEvents, timed } from '@/lib/events';
import { summariesDue, runWeekly, runMonthly } from '@/lib/summary';
import { todayIST, isValidDate } from '@/lib/time';
import { runInBackground } from '@/lib/bg';
import { buildBackupBuffer } from '@/lib/backup';
import { sendBackupEmail } from '@/lib/email';

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
    // The one scheduled job also sends the Monday weekly digest, the monthly summary on the 1st,
    // and the weekly data backup to settings.backupEmail on Sundays.
    const url = new URL(request.url);
    const injectedDate = url.searchParams.get('date');
    const today = (injectedDate && isValidDate(injectedDate)) ? injectedDate : todayIST();
    const due = summariesDue(today); out.summaries = [];
    if (due.weekly) { const r = await runWeekly(today).catch(e => ({ success: false, error: e.message })); out.summaries.push({ weekly: r.skipped || r.error || 'sent' }); await logEvent({ type: 'cron:weekly', ok: r.success !== false, message: r.skipped || r.error || 'weekly digest sent' }); }
    const isSunday = new Date(today + 'T00:00:00Z').getUTCDay() === 0;
    if (isSunday && settings.weeklyBackupMailEnabled !== false) {
      const backupTo = cleanEmail(settings.backupEmail);
      if (!backupTo) {
        await logEvent({ type: 'cron:backup', ok: false, message: 'Warning: backupEmail is empty. Skipping weekly backup.' });
        out.summaries.push({ backup: 'skipped: no backup email' });
      } else {
        const { buffer, rowCounts } = await buildBackupBuffer({ date: today });
        const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
        if (buffer.byteLength > MAX_BYTES) {
          await logEvent({ type: 'cron:backup', ok: false, message: 'Backup file size exceeds 20 MB limit. Not attached.' });
          out.summaries.push({ backup: 'failed: file > 20 MB' });
        } else {
          runInBackground(() => timed('mail:backup', async () => {
            return sendBackupEmail({
              to: backupTo,
              date: today,
              buffer,
              rowCounts,
            });
          }, () => `weekly backup sent to ${backupTo}`));
          out.summaries.push({ backup: 'sent' });
        }
      }
    }
    const old = await db.collection(Collections.OTP).where('expiresAt', '<', Date.now()).limit(400).get();
    if (!old.empty) { const b = db.batch(); old.docs.forEach(d => b.delete(d.ref)); await b.commit(); }

    // Delete rejected and resubmitted submissions older than 30 days
    const cutoff30d = new Date(Date.now() - 30 * 86400000).toISOString();
    const oldSubSnap = await db.collection(Collections.PENDING).where('createdAt', '<', cutoff30d).get();
    let removedOldSubmissions = 0;
    if (!oldSubSnap.empty) {
      const b = db.batch();
      oldSubSnap.docs.forEach(d => {
        const s = d.data()?.state;
        if (s === 'rejected' || s === 'resubmitted') {
          b.delete(d.ref);
          removedOldSubmissions++;
        }
      });
      if (removedOldSubmissions > 0) {
        await b.commit();
      }
    }
    out.removedOldSubmissions = removedOldSubmissions;

    const ok = out.rebuild?.success !== false;
    const msg = ok
      ? `rebuilt ${out.rebuild?.logRows ?? 0} rows${removedOldSubmissions > 0 ? `, removed ${removedOldSubmissions} old rejected/resubmitted` : ''}`
      : out.rebuild?.error;
    await logEvent({ type: 'cron:nightly', ok, ms: Date.now() - t0, message: msg });
    return NextResponse.json({ success: ok, ...out });
  } catch (e) {
    await logEvent({ type: 'cron:nightly', ok: false, ms: Date.now() - t0, message: e.message });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
