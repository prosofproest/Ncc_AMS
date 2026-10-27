export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { db, Collections, snapToArr, commitInChunks } from '@/lib/firebase';
import { authenticate } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';
import { getUsersByIds, getAllUsers, invalidateUsers } from '@/lib/users';
import { statIncrements, statChange } from '@/lib/stats';
import { todayIST, isValidDate } from '@/lib/time';
import { normStatus, summarize, groupLabel } from '@/lib/groups';
import { ACTIVITIES, REASON_MAX, cleanText, parseYears, sessionRecords, cycleSessions, sessionDoc, auditEntry, recId } from '@/lib/attendance';
import { runInBackground } from '@/lib/bg';
import { timed } from '@/lib/events';
import { sendParadeReport, sendAbsenceNotices, sendChangeLog } from '@/lib/email';
import * as sheets from '@/lib/sheets';
import { refreshSheetSummaries } from '@/lib/sheetjobs';
import { pendingCoverage, createPending, approverSide, SIDE_LABEL } from '@/lib/approvals';

// ── READ ───────────────────────────────────────────────────────────────────────
export async function GET(request) {
  const { payload, error } = await authenticate(request);
  if (error) return error;
  const sp = new URL(request.url).searchParams;
  const settings = await getSettings();

  // A cadet's own record
  if (sp.get('my')) {
    const snap = await db.collection(Collections.ATTENDANCE).where('cadetId', '==', payload.id).get();
    let records = snapToArr(snap);
    if (sp.get('cycle') !== 'all') records = records.filter(r => (r.cycle || 1) === settings.currentCycle);
    records.sort((a, b) => b.date.localeCompare(a.date));
    const u = (await db.collection(Collections.USERS).doc(payload.id).get()).data() || {};
    const s = u.stats || {}, benefit = u.benefit || 0;
    const total = s.total || 0, present = s.present || 0;
    const pct = total ? Math.min(100, Math.round((Math.min(total, present + benefit) / total) * 1000) / 10) : 0;
    return NextResponse.json({
      records: records.map(r => ({ id: r.id, date: r.date, activityType: r.activityType, activityDescription: r.activityDescription, status: normStatus(r.status), reason: r.reason || r.remarks || '' })),
      percentage: pct, total, present, absent: s.absent || 0, benefit, threshold: settings.thresholdPct, cycleLabel: settings.cycleLabel,
    });
  }

  const viewer = can(payload, 'canMarkAttendance') || can(payload, 'canViewAllAttendance') || can(payload, 'canEditAttendance');
  if (!viewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Who already has attendance on a date — saved OR waiting for approval (used by the marking screen)
  if (sp.get('date')) {
    const date = sp.get('date');
    if (!isValidDate(date)) return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
    const [snap, pend] = await Promise.all([db.collection(Collections.ATTENDANCE).where('date', '==', date).get(), pendingCoverage(date)]);
    const records = snapToArr(snap).filter(r => (r.cycle || 1) === settings.currentCycle)
      .map(r => ({ cadetId: r.cadetId, status: normStatus(r.status), reason: r.reason || r.remarks || '', sessionId: r.sessionId || null, markedByName: r.markedByName || '', pending: false }));
    for (const [cadetId, v] of pend) if (!records.some(r => r.cadetId === cadetId)) records.push({ cadetId, status: v.status, reason: '', sessionId: v.sessionId, markedByName: v.markedByName, pending: true });
    return NextResponse.json({ records });
  }

  // Records of one session
  if (sp.get('sessionId')) {
    const sess = await db.collection(Collections.SESSIONS).doc(sp.get('sessionId')).get();
    if (!sess.exists) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
    const records = (await sessionRecords(sess.id)).map(r => ({ ...r, status: normStatus(r.status) }));
    return NextResponse.json({ session: { id: sess.id, ...sess.data() }, records });
  }

  // Sessions list (history, calendar, reports)
  if (sp.get('history') || sp.get('all')) {
    const cyc = sp.get('cycle');
    let sessions;
    if (cyc === 'all') sessions = snapToArr(await db.collection(Collections.SESSIONS).get()).sort((a, b) => b.date.localeCompare(a.date));
    else sessions = await cycleSessions(cyc ? parseInt(cyc, 10) : settings.currentCycle);
    return NextResponse.json({ sessions, cycle: settings.currentCycle, cycleLabel: settings.cycleLabel });
  }
  return NextResponse.json({ sessions: [] });
}

// ── CREATE (mark attendance) ───────────────────────────────────────────────────
export async function POST(request) {
  const { payload, error } = await authenticate(request, { perm: 'canMarkAttendance' });
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const date = body.date;
  const activity = body.activity_type, description = cleanText(body.activity_description, 120);
  const years = parseYears(body.years);
  const input = Array.isArray(body.records) ? body.records : [];

  if (!isValidDate(date)) return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
  if (date > todayIST()) return NextResponse.json({ error: 'Attendance cannot be marked for a future date.' }, { status: 400 });
  if (!ACTIVITIES.includes(activity)) return NextResponse.json({ error: 'Choose a valid activity.' }, { status: 400 });
  if (activity === 'Others' && !description) return NextResponse.json({ error: '"Others" activity needs a description.' }, { status: 400 });
  if (!years.length) return NextResponse.json({ error: 'Select at least one year group.' }, { status: 400 });
  if (!input.length || input.length > 400) return NextResponse.json({ error: 'No cadets to mark.' }, { status: 400 });

  const isHistorical = date < todayIST();                     // decided by the server, not the client
  const geoLat = Number.isFinite(+body.geo_lat) && body.geo_lat !== null ? +body.geo_lat : null;
  const geoLng = Number.isFinite(+body.geo_lng) && body.geo_lng !== null ? +body.geo_lng : null;
  if (!isHistorical && (!geoLat || !geoLng)) return NextResponse.json({ error: 'GPS location is required for live attendance.' }, { status: 400 });

  const ids = input.map(r => String(r.cadet_id || ''));
  if (new Set(ids).size !== ids.length) return NextResponse.json({ error: 'Duplicate cadet in the list.' }, { status: 400 });

  const [settings, users] = await Promise.all([getSettings(), getUsersByIds(ids)]);

  // Validate every row against the real user records
  const rows = [];
  for (const r of input) {
    const u = users[r.cadet_id];
    if (!u || !u.isActive || u.discharged) return NextResponse.json({ error: 'A selected cadet is not active any more. Refresh the page.' }, { status: 400 });
    if (u.role !== 'cadet' || !years.includes(u.year))
      return NextResponse.json({ error: `${u.name} is not part of the selected group.` }, { status: 400 });
    const status = r.status === 'Present' ? 'Present' : r.status === 'Absent' ? 'Absent' : null;
    if (!status) return NextResponse.json({ error: `Invalid status for ${u.name}.` }, { status: 400 });
    const reason = status === 'Absent' ? cleanText(r.reason, REASON_MAX) : '';
    if (status === 'Absent' && !reason) return NextResponse.json({ error: `Select a reason for ${u.name} (absent).` }, { status: 400 });
    rows.push({ u, status, reason });
  }

  const resubmitOf = body.resubmit_of ? String(body.resubmit_of) : null;
  let previousRejection = null;
  if (resubmitOf) {
    const oldSnap = await db.collection(Collections.PENDING).doc(resubmitOf).get();
    if (!oldSnap.exists) return NextResponse.json({ error: 'Rejected submission not found.' }, { status: 400 });
    const oldDoc = oldSnap.data();
    if (oldDoc.markedBy !== payload.id) return NextResponse.json({ error: 'You can only resubmit attendance that was marked by you.' }, { status: 403 });
    if (oldDoc.state === 'resubmitted') return NextResponse.json({ error: 'This submission has already been resubmitted.' }, { status: 400 });
    if (oldDoc.state !== 'rejected') return NextResponse.json({ error: 'Only rejected submissions can be resubmitted.' }, { status: 400 });
    if (oldDoc.rejection) {
      previousRejection = {
        byName: oldDoc.rejection.byName || '',
        side: oldDoc.rejection.side || '',
        reason: oldDoc.rejection.reason || '',
        at: oldDoc.rejection.at || '',
      };
    }
  }

  // Duplicate-day protection: attendance is locked once submitted — saved or still waiting for approval
  const attRefs = rows.map(x => db.collection(Collections.ATTENDANCE).doc(recId(date, x.u.id, settings.currentCycle)));
  const [existing, pend] = await Promise.all([db.getAll(...attRefs).then(l => l.filter(s => s.exists)), pendingCoverage(date)]);
  const pendingHits = rows.filter(x => pend.has(x.u.id));
  if (existing.length || pendingHits.length) {
    const by = existing[0]?.data().markedByName || pend.get(pendingHits[0]?.u.id)?.markedByName || 'another user';
    const n = existing.length + pendingHits.length;
    return NextResponse.json({
      error: pendingHits.length && !existing.length
        ? `Attendance for ${n} of these cadets on ${date} was already submitted by ${by} and is waiting for approval. It is locked.`
        : `Attendance for ${n} of these cadets is already submitted for ${date} (by ${by}). It is locked — ask the Admin or CTO to edit it.`,
      locked: true, existing: n,
    }, { status: 409 });
  }

  const photoUrls = (Array.isArray(body.photo_urls) ? body.photo_urls : []).filter(u => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 8);
  const photosRequired = settings.requirePhotos !== false;
  const sub = await createPending({ payload, date, cycle: settings.currentCycle, activity, description, years, rows, photoUrls, geoLat, geoLng, isHistorical, groupLabel: groupLabel(years), photosRequired, resubmitOf, previousRejection });

  if (sub.conflictError) return NextResponse.json({ error: sub.conflictError }, { status: 400 });
  if (sub.conflict) return NextResponse.json({ error: `Attendance for ${sub.count} of these cadets on ${date} was just submitted by someone else and is waiting for approval. It is locked.`, locked: true, existing: sub.count }, { status: 409 });

  if (resubmitOf) {
    const now = new Date().toISOString();
    runInBackground(async () => {
      await timed('sheets:resubmit', async () => {
        return sheets.appendChangeLog([{
          at: now,
          action: 'Resubmitted',
          by: payload.name,
          date,
          name: `${activity} - ${groupLabel(years)}`,
          from: 'Rejected',
          to: 'Pending',
          reason: '',
        }]);
      }, () => `${activity} - ${groupLabel(years)}`);
    });
  }

  // Nothing is counted, saved to the sheet or e-mailed yet — that happens when BOTH Admin and CTO approve.
  const side = approverSide(payload);
  return NextResponse.json({
    success: true, pending: true, sessionId: sub.id, count: rows.length, present: sub.present, absent: sub.absent, isHistorical,
    waitingFor: ['admin', 'cto'].filter(x => x !== side).map(x => SIDE_LABEL[x]),
  });
}

// ── EDIT (admin / CTO) ─────────────────────────────────────────────────────────
export async function PUT(request) {
  const { payload, error } = await authenticate(request, { perm: 'canEditAttendance' });
  if (error) return error;
  const body = await request.json().catch(() => null);
  const sessionId = String(body?.sessionId || '');
  const changesIn = Array.isArray(body?.changes) ? body.changes : [];
  if (!sessionId || !changesIn.length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });

  const sessSnap = await db.collection(Collections.SESSIONS).doc(sessionId).get();
  if (!sessSnap.exists) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  const session = { id: sessSnap.id, ...sessSnap.data() };
  const settings = await getSettings();

  const recSnaps = await db.getAll(...changesIn.map(c => db.collection(Collections.ATTENDANCE).doc(recId(session.date, String(c.cadet_id), session.cycle || 1))));
  const diffs = [];
  for (let i = 0; i < changesIn.length; i++) {
    const c = changesIn[i], snap = recSnaps[i];
    if (!snap.exists || snap.data().sessionId !== sessionId) return NextResponse.json({ error: 'A record does not belong to this session.' }, { status: 400 });
    const old = snap.data();
    const status = c.status === 'Present' ? 'Present' : c.status === 'Absent' ? 'Absent' : null;
    if (!status) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    const reason = status === 'Absent' ? cleanText(c.reason, REASON_MAX) : '';
    if (status === 'Absent' && !reason) return NextResponse.json({ error: `Select a reason for ${old.cadetName}.` }, { status: 400 });
    const oldStatus = normStatus(old.status), oldReason = old.reason || old.remarks || '';
    if (oldStatus === status && oldReason === reason) continue;
    diffs.push({ id: snap.id, old, oldStatus, oldReason, status, reason });
  }
  if (!diffs.length) return NextResponse.json({ success: true, changed: 0 });

  const now = new Date().toISOString();
  const sameCycle = (session.cycle || 1) === settings.currentCycle;      // counters were reset by promotion otherwise
  let dPresent = 0;
  const ops = [];
  for (const d of diffs) {
    ops.push(b => b.update(db.collection(Collections.ATTENDANCE).doc(d.id), { status: d.status, reason: d.reason, remarks: '', updatedAt: now, editedBy: payload.id, editedByName: payload.name }));
    if (d.status !== d.oldStatus) {
      dPresent += d.status === 'Present' ? 1 : -1;
      const upd = statChange(session.date, d.oldStatus, d.status);
      if (upd && sameCycle) ops.push(b => b.update(db.collection(Collections.USERS).doc(d.old.cadetId), upd));
    }
  }
  const newSession = { ...session, present: session.present + dPresent, absent: session.absent - dPresent, updatedAt: now, lastEditedByName: payload.name };
  ops.push(b => b.update(db.collection(Collections.SESSIONS).doc(sessionId), { present: newSession.present, absent: newSession.absent, updatedAt: now, lastEditedBy: payload.id, lastEditedByName: payload.name }));
  const changes = diffs.map(d => ({ cadetId: d.old.cadetId, name: d.old.cadetName, regNo: d.old.cadetRegNo || '',
    from: d.oldStatus === 'Absent' ? `Absent (${d.oldReason || 'no reason'})` : 'Present', to: d.status === 'Absent' ? `Absent` : 'Present', reason: d.reason }));
  ops.push(b => b.set(db.collection(Collections.AUDIT_LOG).doc(), auditEntry({ type: 'edit', payload, session: newSession, changes, note: body.note ? cleanText(body.note, 200) : '' })));
  await commitInChunks(ops, 400);
  invalidateUsers();

  runInBackground(async () => {
    const all = await sessionRecords(sessionId);
    const users = await getUsersByIds(diffs.map(d => d.old.cadetId));
    await Promise.allSettled([
      timed('sheets:edit', async () => {
        // Sessions of an archived (promoted-away) cycle live in frozen archive tabs — never write them into the live tabs
        if (sameCycle) { const r1 = await sheets.syncSession({ session: newSession, records: all }); if (!r1.success) return r1; }
        const lg = await sheets.appendChangeLog(changes.map(c => ({ at: now, action: 'Edit', by: payload.name, date: session.date, regNo: c.regNo, name: c.name, from: c.from, to: c.to, reason: c.reason || body.note || '' })));
        if (!lg.success || !sameCycle) return lg;
        return refreshSheetSummaries();
      }, () => `${diffs.length} change(s)`),
      timed('mail:changelog', () => sendChangeLog({ settings, kind: 'edit', byName: payload.name, date: session.date, activity: session.activityType, group: session.groupLabel, changes, note: body.note ? cleanText(body.note, 200) : '',
        reportSession: newSession, reportRecords: all }), () => 'edit log sent to Sir + backup'),
      (async () => {
        if (session.isHistorical) return;
        const newlyAbsent = diffs.filter(d => d.status === 'Absent' && d.oldStatus !== 'Absent').map(d => ({ ...d.old, status: 'Absent', reason: d.reason }));
        if (newlyAbsent.length) await sendAbsenceNotices({ session: newSession, absentRecords: newlyAbsent, usersById: users, settings });
      })(),
    ]);
  });
  return NextResponse.json({ success: true, changed: diffs.length, session: newSession });
}

// ── DELETE a session (admin) ───────────────────────────────────────────────────
export async function DELETE(request) {
  const { payload, error } = await authenticate(request, { perm: 'canDeleteAttendance' });
  if (error) return error;
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'sessionId required.' }, { status: 400 });
  const sessSnap = await db.collection(Collections.SESSIONS).doc(sessionId).get();
  if (!sessSnap.exists) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  const session = { id: sessSnap.id, ...sessSnap.data() };
  const settings = await getSettings();
  const records = await sessionRecords(sessionId);
  const sameCycle = (session.cycle || 1) === settings.currentCycle;

  const ops = [];
  for (const r of records) {
    ops.push(b => b.delete(db.collection(Collections.ATTENDANCE).doc(r.id)));
    if (sameCycle) ops.push(b => b.update(db.collection(Collections.USERS).doc(r.cadetId), statIncrements(session.date, normStatus(r.status), -1)));
  }
  ops.push(b => b.delete(db.collection(Collections.SESSIONS).doc(sessionId)));
  const changes = [{ name: `${records.length} cadet records`, regNo: '', from: `${session.present} present / ${session.absent} absent`, to: 'Deleted', reason: '' }];
  ops.push(b => b.set(db.collection(Collections.AUDIT_LOG).doc(), auditEntry({ type: 'delete', payload, session, changes, note: 'Session deleted' })));
  await commitInChunks(ops, 400);
  invalidateUsers();

  runInBackground(async () => {
    await Promise.allSettled([
      timed('sheets:delete', async () => {
        if (sameCycle) { const r = await sheets.removeSession({ session, records }); if (!r.success) return r; }
        const lg = await sheets.appendChangeLog([{ at: new Date().toISOString(), action: 'Delete', by: payload.name, date: session.date, name: `${session.activityType} · ${session.groupLabel}`, from: `${session.present}P / ${session.absent}A`, to: 'Deleted' }]);
        if (!lg.success || !sameCycle) return lg;
        return refreshSheetSummaries();
      }, () => 'session removed from sheet'),
      timed('mail:changelog', () => sendChangeLog({ settings, kind: 'delete', byName: payload.name, date: session.date, activity: session.activityType, group: session.groupLabel, changes }), () => 'delete log sent'),
    ]);
  });
  return NextResponse.json({ success: true, deleted: records.length });
}
