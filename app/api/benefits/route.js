export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db, Collections, snapToArr, commitInChunks, FieldValue } from '@/lib/firebase';
import { authenticate } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';
import { getUsersByIds, invalidateUsers } from '@/lib/users';
import { isValidDate, todayIST } from '@/lib/time';
import { cleanText } from '@/lib/attendance';
import { runInBackground } from '@/lib/bg';
import { timed } from '@/lib/events';
import { sendChangeLog } from '@/lib/email';
import { refreshSheetSummaries } from '@/lib/sheetjobs';
import * as sheets from '@/lib/sheets';

async function cycleBenefits(cycle) {
  const snap = await db.collection(Collections.BENEFITS).where('cycle', '==', cycle).get();
  return snapToArr(snap).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function GET(request) {
  const { payload, error } = await authenticate(request);
  if (error) return error;
  if (!(can(payload, 'canManageBenefits') || can(payload, 'canViewAllAttendance')))
    return NextResponse.json({ error: 'No permission.' }, { status: 403 });
  const settings = await getSettings();
  return NextResponse.json({ benefits: await cycleBenefits(settings.currentCycle), cycleLabel: settings.cycleLabel });
}

export async function POST(request) {
  const { payload, error } = await authenticate(request, { perm: 'canManageBenefits' });
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const ids = [...new Set((Array.isArray(body.cadet_ids) ? body.cadet_ids : []).map(String))].slice(0, 300);
  const credits = parseInt(body.credits, 10);
  const reason = cleanText(body.reason, 120);
  const date = body.date && isValidDate(body.date) ? body.date : todayIST();
  if (!ids.length) return NextResponse.json({ error: 'Select at least one cadet.' }, { status: 400 });
  if (!(credits >= 1 && credits <= 30)) return NextResponse.json({ error: 'Credits must be between 1 and 30.' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'A reason is required (e.g. "Republic Day camp").' }, { status: 400 });

  const [settings, users] = await Promise.all([getSettings(), getUsersByIds(ids)]);
  const targets = ids.map(i => users[i]).filter(u => u && u.isActive && !u.discharged);
  if (targets.length !== ids.length) return NextResponse.json({ error: 'Some selected people are not active.' }, { status: 400 });

  const now = new Date().toISOString();
  const ops = [], changes = [];
  for (const u of targets) {
    const ref = db.collection(Collections.BENEFITS).doc();
    ops.push(b => b.set(ref, { cycle: settings.currentCycle, date, cadetId: u.id, cadetName: u.name, cadetRegNo: u.regNo || '', cadetYear: u.year || null,
      credits, reason, addedBy: payload.id, addedByName: payload.name, createdAt: now }));
    ops.push(b => b.update(db.collection(Collections.USERS).doc(u.id), { benefit: FieldValue.increment(credits) }));
    changes.push({ name: u.name, regNo: u.regNo || '', from: '—', to: `+${credits} credit(s)`, reason });
  }
  ops.push(b => b.set(db.collection(Collections.AUDIT_LOG).doc(), { type: 'benefit', by: payload.id, byName: payload.name, at: now, date, note: reason, changes }));
  await commitInChunks(ops, 400);
  invalidateUsers();

  runInBackground(async () => {
    await Promise.allSettled([
      timed('sheets:benefit', async () => {
        const w = await sheets.writeBenefits(await cycleBenefits(settings.currentCycle));
        if (!w.success) return w;
        await sheets.appendChangeLog(changes.map(c => ({ at: now, action: 'Benefit', by: payload.name, date, regNo: c.regNo, name: c.name, from: c.from, to: c.to, reason })));
        return refreshSheetSummaries();
      }, () => `${targets.length} benefit(s)`),
      timed('mail:changelog', () => sendChangeLog({ settings, kind: 'benefit', byName: payload.name, date, changes, note: reason }), () => 'benefit log sent'),
    ]);
  });
  return NextResponse.json({ success: true, count: targets.length });
}

export async function DELETE(request) {
  const { payload, error } = await authenticate(request, { perm: 'canManageBenefits' });
  if (error) return error;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required.' }, { status: 400 });
  const ref = db.collection(Collections.BENEFITS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const bn = snap.data();
  const settings = await getSettings();
  const ops = [b => b.delete(ref)];
  if (bn.cycle === settings.currentCycle) {
    const uSnap = await db.collection(Collections.USERS).doc(bn.cadetId).get();
    if (uSnap.exists) {
      ops.push(b => b.update(db.collection(Collections.USERS).doc(bn.cadetId), { benefit: FieldValue.increment(-bn.credits) }));
    }
  }
  const changes = [{ name: bn.cadetName, regNo: bn.cadetRegNo, from: `+${bn.credits} credit(s)`, to: 'Removed', reason: bn.reason }];
  ops.push(b => b.set(db.collection(Collections.AUDIT_LOG).doc(), { type: 'benefit-remove', by: payload.id, byName: payload.name, at: new Date().toISOString(), date: bn.date, note: bn.reason, changes }));
  await commitInChunks(ops, 400);
  invalidateUsers();
  runInBackground(async () => {
    await Promise.allSettled([
      timed('sheets:benefit', async () => { const w = await sheets.writeBenefits(await cycleBenefits(settings.currentCycle)); if (!w.success) return w; return refreshSheetSummaries(); }),
      timed('mail:changelog', () => sendChangeLog({ settings, kind: 'benefit-remove', byName: payload.name, date: bn.date, changes })),
    ]);
  });
  return NextResponse.json({ success: true });
}
