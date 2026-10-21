export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { db, Collections, commitInChunks } from '@/lib/firebase';
import { authenticate } from '@/lib/session';
import { getAllUsers, invalidateUsers } from '@/lib/users';
import { getSettings, saveSettings } from '@/lib/settings';
import { emptyStats } from '@/lib/stats';
import { academicLabel, todayIST } from '@/lib/time';
import { runInBackground } from '@/lib/bg';
import { timed } from '@/lib/events';
import { sendChangeLog } from '@/lib/email';
import * as sheets from '@/lib/sheets';
import { pendingCount } from '@/lib/approvals';

export async function POST(request) {
  const { payload, error } = await authenticate(request, { perm: 'canPromoteCadets' });
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const settings = await getSettings({ fresh: true });
  const users = await getAllUsers({ fresh: true });
  const cadets = users.filter(u => u.role === 'cadet' && u.isActive && !u.discharged);
  const y1 = cadets.filter(c => c.year === 1), y2 = cadets.filter(c => c.year === 2), y3 = cadets.filter(c => c.year === 3);

  const summary = {
    promoted_to_year2: y1.length, promoted_to_year3: y2.length, graduated: y3.length,
    currentCycle: settings.currentCycle, cycleLabel: settings.cycleLabel, dryRun: body.dryRun === true,
  };
  summary.pendingApprovals = await pendingCount();
  if (body.dryRun === true) return NextResponse.json(summary);
  if (summary.pendingApprovals > 0)
    return NextResponse.json({ error: `${summary.pendingApprovals} attendance submission(s) are still waiting for approval. Approve or reject them first, then promote.` }, { status: 409 });

  // Guards against a double click / two admins promoting at once
  if (body.expectedCycle !== settings.currentCycle)
    return NextResponse.json({ error: 'The cycle changed — someone already promoted, or the preview is old. Reload and preview again.' }, { status: 409 });

  const now = new Date().toISOString();
  let newLabel = academicLabel(todayIST());
  if (newLabel === settings.cycleLabel) newLabel = `${newLabel} (cycle ${settings.currentCycle + 1})`;
  const newCycle = settings.currentCycle + 1;

  const ops = [];
  const fresh = { stats: emptyStats(), benefit: 0, lastAttendanceDate: null, updatedAt: now };
  users.filter(u => u.role === 'cadet' && !u.discharged).forEach(u => {
    const ref = db.collection(Collections.USERS).doc(u.id);
    if (u.isActive) {
      if (u.year === 1) ops.push(b => b.update(ref, { ...fresh, year: 2, promotedAt: now }));
      else if (u.year === 2) ops.push(b => b.update(ref, { ...fresh, year: 3, promotedAt: now }));
      else if (u.year === 3) ops.push(b => b.update(ref, { ...fresh, isActive: false, graduatedAt: now, tokenVersion: Date.now() }));
    }
  });
  ops.push(b => b.set(db.collection(Collections.AUDIT_LOG).doc(), {
    type: 'promotion', by: payload.id, byName: payload.name, at: now, note: `Cycle ${settings.cycleLabel} closed -> ${newLabel}`,
    changes: [{ name: 'Year 1 -> 2', from: '', to: String(y1.length) }, { name: 'Year 2 -> 3', from: '', to: String(y2.length) }, { name: 'Year 3 -> graduated', from: '', to: String(y3.length) }],
  }));
  await commitInChunks(ops, 400);
  await saveSettings({ currentCycle: newCycle, cycleLabel: newLabel, cycleStartedAt: now });
  invalidateUsers();

  runInBackground(async () => {
    await timed('sheets:promotion', async () => {
      const a = await sheets.archiveCycleTabs(settings.cycleLabel);
      if (!a.success) return a;
      const all = await getAllUsers({ fresh: true });
      const w = await sheets.writeRosterFull(all);
      if (!w.success) return w;
      await sheets.writeSummaries(all, { thresholdPct: settings.thresholdPct });
      await sheets.writeBenefits([]);
      await sheets.appendChangeLog([{ at: now, action: 'Promotion', by: payload.name, name: `${settings.cycleLabel} -> ${newLabel}`, from: '', to: `Y1->2: ${y1.length}, Y2->3: ${y2.length}, graduated: ${y3.length}` }]);
      return { success: true };
    }, () => 'old cycle archived, new sheets created');
    await sendChangeLog({ settings, kind: 'edit', byName: payload.name, changes: [
      { name: 'Year 1 -> Year 2', from: '', to: `${y1.length} cadets` }, { name: 'Year 2 -> Year 3', from: '', to: `${y2.length} cadets` },
      { name: 'Year 3 -> Graduated', from: '', to: `${y3.length} cadets` }], note: `Promotion done. Attendance restarted from 0 for ${newLabel}; ${settings.cycleLabel} sheets archived.` });
  });
  return NextResponse.json({ ...summary, dryRun: false, newCycle, newLabel });
}
