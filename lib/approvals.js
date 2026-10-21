// Two-person approval for submitted attendance.
//
//   marker submits  ->  `pending_sessions` document (nothing is counted, nothing is mailed)
//   Admin approves  ┐
//   CTO approves    ┘  -> only when BOTH have approved is it written to the real records, counted,
//                        pushed to the Google Sheet and mailed (parade report, absence notices).
//
// The side of an approver always comes from the signed-in role (never from the request), so one person
// can never approve for both sides. If an Admin or the CTO submits attendance themselves, their own side
// is recorded as approved automatically and only the other side is still needed.
import { db, Collections, snapToArr, commitInChunks } from '@/lib/firebase';
import { can } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';
import { getUsersByIds, invalidateUsers } from '@/lib/users';
import { statIncrements } from '@/lib/stats';
import { normStatus, summarize } from '@/lib/groups';
import { recId, sessionDoc, auditEntry, cleanText, REASON_MAX } from '@/lib/attendance';
import { sendParadeReport, sendAbsenceNotices } from '@/lib/email';
import { timed, logEvent } from '@/lib/events';
import * as sheets from '@/lib/sheets';
import { refreshSheetSummaries } from '@/lib/sheetjobs';

export const SIDES = ['admin', 'cto'];
export const SIDE_LABEL = { admin: 'Admin', cto: 'CTO' };
const COMMIT_STALE_MS = 120_000;

// Which approval does this person give? null = they cannot approve.
export function approverSide(payload) {
  return SIDES.includes(payload?.role) && can(payload, 'canApproveAttendance') ? payload.role : null;
}
export const stamp = payload => ({ by: payload.id, byName: payload.name, at: new Date().toISOString() });
const pendingRef = id => db.collection(Collections.PENDING).doc(id);
const otherSide = s => (s === 'admin' ? 'cto' : 'admin');
const waiting = approvals => SIDES.filter(s => !approvals?.[s]);   // kept on the document so counting needs no composite index

// What the list screens need (no roster, so it stays small and fast)
export function summaryOf(p, viewerSide = null) {
  const { records, ...rest } = p;
  const approvals = p.approvals || {};
  return {
    ...rest, approvals,
    waitingFor: SIDES.filter(s => !approvals[s]),
    needsMe: !!viewerSide && p.state === 'pending' && !approvals[viewerSide],
  };
}

// cadetId -> pending submission that already covers them on that date (blocks duplicates)
export async function pendingCoverage(date) {
  const snap = await db.collection(Collections.PENDING).where('date', '==', date).get();
  const map = new Map();
  for (const p of snapToArr(snap)) {
    if (!['pending', 'committing'].includes(p.state)) continue;
    for (const r of p.records || []) map.set(r.cadetId, { sessionId: p.id, markedByName: p.markedByName, status: normStatus(r.status) });
  }
  return map;
}

// ── create (called by the marking screen) ────────────────────────────────────
export async function createPending({ payload, date, cycle, activity, description, years, rows, photoUrls, geoLat, geoLng, isHistorical, groupLabel, photosRequired }) {
  const now = new Date().toISOString();
  const id = `${date}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const records = rows.map(({ u, status, reason }) => ({
    cadetId: u.id, cadetName: u.name, cadetRegNo: u.regNo || '', cadetYear: u.role === 'cadet' ? u.year : null,
    cadetType: u.role === 'cadet' ? (u.type || 'SD') : null, cadetRole: u.role, status, reason,
  }));
  const sum = summarize(records);
  const side = approverSide(payload);
  const doc = {
    date, cycle, activityType: activity, activityDescription: description, years, groupLabel,
    total: sum.total, present: sum.present, absent: sum.absent, photoUrls, geoLat, geoLng, isHistorical,
    ...(photosRequired !== undefined ? { photosRequired: photosRequired !== false } : {}),
    markedBy: payload.id, markedByName: payload.name, markerRole: payload.role,
    state: 'pending', approvals: side ? { [side]: stamp(payload) } : {}, records, createdAt: now, updatedAt: now,
  };
  doc.waitingFor = waiting(doc.approvals);
  // One lock document per date holds "cadet -> submission". The check and the write happen in ONE transaction,
  // so two people submitting the same cadets at the same instant cannot both succeed.
  const lockRef = db.collection(Collections.PENDING_LOCKS).doc(date);
  const attempt = ignore => db.runTransaction(async tx => {
    const lock = await tx.get(lockRef);
    const holders = (lock.exists && lock.data().holders) || {};
    const clash = records.filter(r => holders[r.cadetId] && !ignore.has(r.cadetId));
    if (clash.length) return { conflict: clash.map(r => r.cadetId) };
    tx.set(lockRef, { holders: { ...holders, ...Object.fromEntries(records.map(r => [r.cadetId, id])) } });
    tx.set(pendingRef(id), doc);
    tx.set(db.collection(Collections.AUDIT_LOG).doc(), auditEntry({ type: 'submit', payload, session: { id, date, activityType: activity, groupLabel },
      note: `${sum.present} present, ${sum.absent} absent — sent for approval${side ? ` (${SIDE_LABEL[side]} approved on submitting)` : ''}`,
      changes: records.filter(r => r.status === 'Absent').map(r => ({ cadetId: r.cadetId, name: r.cadetName, regNo: r.cadetRegNo, from: '—', to: 'Absent', reason: r.reason })) }));
    return { ok: true };
  });
  let res = await attempt(new Set());
  if (res.conflict) {
    // A lock whose submission no longer exists (rejected, approved or deleted) is stale — ignore it
    const live = await pendingCoverage(date);
    const stale = new Set(res.conflict.filter(c => !live.has(c)));
    if (stale.size === res.conflict.length) res = await attempt(stale);
  }
  if (res.conflict) return { conflict: true, count: res.conflict.length };
  return { id, ...doc };
}

// Free the cadets of a submission that is no longer pending (approved, rejected)
async function releaseLocks(date, sessionId) {
  const ref = db.collection(Collections.PENDING_LOCKS).doc(date);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const holders = Object.fromEntries(Object.entries(snap.data().holders || {}).filter(([, sid]) => sid !== sessionId));
    tx.set(ref, { holders });
  }).catch(e => console.error('[APPROVALS] could not release locks:', e.message));
}

// ── approve ──────────────────────────────────────────────────────────────────
export async function approve(id, payload) {
  const side = approverSide(payload);
  if (!side) return { status: 403, error: 'Only the Admin and the CTO can approve attendance.' };
  const now = new Date().toISOString();
  const res = await db.runTransaction(async tx => {
    const snap = await tx.get(pendingRef(id));
    if (!snap.exists) return { status: 404, error: 'This submission no longer exists (it may already be approved).' };
    const p = snap.data();
    if (p.state === 'rejected') return { status: 409, error: 'This submission was rejected.' };
    if (p.state === 'committing' && Date.now() - Date.parse(p.committingAt || 0) < COMMIT_STALE_MS) return { status: 409, error: 'It is being finalised right now — refresh in a moment.' };
    const have = p.approvals || {};
    const bothAlready = SIDES.every(s => have[s]);
    if (have[side] && !bothAlready) return { status: 409, error: `You already approved this. Waiting for the ${SIDE_LABEL[otherSide(side)]}.` };
    const approvals = bothAlready ? have : { ...have, [side]: stamp(payload) };
    const both = SIDES.every(s => approvals[s]);
    tx.update(pendingRef(id), { approvals, waitingFor: waiting(approvals), updatedAt: now, state: both ? 'committing' : 'pending', committingAt: both ? now : null });
    return { ok: true, both, p: { id, ...p, approvals } };
  });
  if (!res.ok) return res;

  const auditNote = `${SIDE_LABEL[side]} approved`;
  await db.collection(Collections.AUDIT_LOG).add(auditEntry({ type: 'approve', payload, session: { id, date: res.p.date, activityType: res.p.activityType, groupLabel: res.p.groupLabel }, note: auditNote }));
  if (!res.both) return { ok: true, final: false, status: 200, approvals: res.p.approvals, waitingFor: [otherSide(side)] };

  try {
    const done = await commitApproved(res.p);
    await releaseLocks(res.p.date, id);
    return { ok: true, final: true, status: 200, session: done.session, records: done.records, approvals: res.p.approvals };
  } catch (e) {
    // put it back so either approver can press Approve again; nothing was counted
    await pendingRef(id).update({ state: 'pending', committingAt: null, commitError: String(e.message).slice(0, 200), waitingFor: [] }).catch(() => {});
    const dup = e.code === 6 || /ALREADY_EXISTS/.test(e.message);
    return { status: dup ? 409 : 500, error: dup ? 'Attendance for some of these cadets already exists for that date. Reject this submission and ask the marker to resubmit.' : `Could not finalise: ${e.message}` };
  }
}

// Both approved -> write the real records, counters, session and audit entry in one go
async function commitApproved(p) {
  const settings = await getSettings({ fresh: true });
  if ((p.cycle || 1) !== settings.currentCycle) throw new Error('The attendance cycle changed after this was submitted. Reject it and resubmit.');
  const now = new Date().toISOString();
  const users = await getUsersByIds(p.records.map(r => r.cadetId));
  const records = p.records.map(r => ({
    id: recId(p.date, r.cadetId, p.cycle), date: p.date, sessionId: p.id, cycle: p.cycle, activityType: p.activityType, activityDescription: p.activityDescription,
    cadetId: r.cadetId, cadetName: r.cadetName, cadetRegNo: r.cadetRegNo, cadetYear: r.cadetYear, cadetType: r.cadetType, cadetRole: r.cadetRole,
    status: r.status, reason: r.reason || '', markedBy: p.markedBy, markedByName: p.markedByName, isHistorical: !!p.isHistorical, createdAt: p.createdAt, updatedAt: now,
  }));
  const session = {
    ...sessionDoc({ id: p.id, date: p.date, cycle: p.cycle, activity: p.activityType, description: p.activityDescription, years: p.years,
      recs: records, photoUrls: p.photoUrls, geoLat: p.geoLat, geoLng: p.geoLng, user: { id: p.markedBy, name: p.markedByName }, isHistorical: p.isHistorical, now: p.createdAt }),
    updatedAt: now, approvedAt: now, approvals: p.approvals,
    ...(p.photosRequired !== undefined ? { photosRequired: p.photosRequired !== false } : {}),
  };
  const ops = [];
  records.forEach(rec => {
    ops.push(b => b.create(db.collection(Collections.ATTENDANCE).doc(rec.id), (({ id, ...d }) => d)(rec)));      // create() fails if it exists -> never double counted
    if (users[rec.cadetId]) ops.push(b => b.update(db.collection(Collections.USERS).doc(rec.cadetId), { ...statIncrements(p.date, rec.status, 1), lastAttendanceDate: p.date }));
  });
  ops.push(b => b.set(db.collection(Collections.SESSIONS).doc(p.id), (({ id, ...d }) => d)(session)));
  ops.push(b => b.set(db.collection(Collections.AUDIT_LOG).doc(), auditEntry({ type: 'create',
    payload: { id: p.approvals.cto?.by || p.approvals.admin?.by, name: SIDES.map(s => `${p.approvals[s].byName} (${SIDE_LABEL[s]})`).join(' & ') },
    session, note: `Approved by ${SIDES.map(s => `${p.approvals[s].byName} (${SIDE_LABEL[s]})`).join(' and ')} — ${session.present} present, ${session.absent} absent`,
    changes: records.filter(r => r.status === 'Absent').map(r => ({ cadetId: r.cadetId, name: r.cadetName, regNo: r.cadetRegNo, from: '—', to: 'Absent', reason: r.reason })) })));
  ops.push(b => b.delete(pendingRef(p.id)));
  await commitInChunks(ops, 400);
  invalidateUsers();
  return { session, records, users };
}

// Slow work that must happen only AFTER final approval (never blocks the approver's click)
export async function afterFinalApproval({ session, records }) {
  const settings = await getSettings({ fresh: true });
  const tasks = [];
  tasks.push(timed('sheets:attendance', async () => {
    const r1 = await sheets.syncSession({ session, records });
    if (!r1.success) return r1;
    await sheets.appendChangeLog([{ at: session.approvedAt, action: 'Approved', by: Object.values(session.approvals).map(a => a.byName).join(' & '), date: session.date, name: `${session.activityType} · ${session.groupLabel}`, from: 'Pending', to: `${session.present}P / ${session.absent}A` }]);
    return refreshSheetSummaries();
  }, () => `${records.length} rows`));
  if (!session.isHistorical) {
    tasks.push(timed('mail:parade', () => sendParadeReport({ session, records, settings }), () => 'parade report sent to Sir + backup'));
    tasks.push((async () => {
      const absent = records.filter(r => r.status === 'Absent');
      const usersById = await getUsersByIds(absent.map(r => r.cadetId));     // fresh counters, including this absence
      const out = await sendAbsenceNotices({ session, absentRecords: absent, usersById, settings });
      await logEvent({ type: 'mail:absence', ok: !out.failed, message: `sent ${out.sent}, skipped (no email) ${out.skipped}, failed ${out.failed}${out.firstError ? ' — ' + out.firstError : ''}` });
    })());
  }
  await Promise.allSettled(tasks);
}

// ── reject ───────────────────────────────────────────────────────────────────
export async function reject(id, payload, reasonIn) {
  const side = approverSide(payload);
  if (!side) return { status: 403, error: 'Only the Admin and the CTO can reject attendance.' };
  const reason = cleanText(reasonIn, 200);
  if (!reason) return { status: 400, error: 'Write a short reason so the marker knows what to correct.' };
  const res = await db.runTransaction(async tx => {
    const snap = await tx.get(pendingRef(id));
    if (!snap.exists) return { status: 404, error: 'This submission no longer exists.' };
    const p = snap.data();
    if (p.state !== 'pending') return { status: 409, error: p.state === 'rejected' ? 'Already rejected.' : 'It is being finalised and cannot be rejected now.' };
    tx.update(pendingRef(id), { state: 'rejected', waitingFor: [], rejection: { ...stamp(payload), side, reason }, updatedAt: new Date().toISOString() });
    return { ok: true, p: { id, ...p } };
  });
  if (!res.ok) return res;
  await releaseLocks(res.p.date, id);
  await db.collection(Collections.AUDIT_LOG).add(auditEntry({ type: 'reject', payload, session: { id, date: res.p.date, activityType: res.p.activityType, groupLabel: res.p.groupLabel }, note: reason }));
  return { ok: true, status: 200 };
}

// ── edit while pending (Admin / CTO only) ────────────────────────────────────
// The editor has now reviewed the roll, so their side counts as approved; the other side must look again.
export async function editPending(id, payload, changesIn, noteIn) {
  const side = approverSide(payload);
  if (!side) return { status: 403, error: 'Only the Admin and the CTO can edit a pending submission.' };
  const now = new Date().toISOString();
  const changes = [];
  const res = await db.runTransaction(async tx => {
    const snap = await tx.get(pendingRef(id));
    if (!snap.exists) return { status: 404, error: 'This submission no longer exists.' };
    const p = snap.data();
    if (p.state !== 'pending') return { status: 409, error: 'It can no longer be edited (already finalised or rejected).' };
    const records = p.records.map(r => ({ ...r }));
    for (const c of changesIn) {
      const r = records.find(x => x.cadetId === String(c.cadet_id));
      if (!r) return { status: 400, error: 'A cadet in your changes is not part of this submission.' };
      const status = c.status === 'Present' ? 'Present' : c.status === 'Absent' ? 'Absent' : null;
      if (!status) return { status: 400, error: 'Invalid status.' };
      const reason = status === 'Absent' ? cleanText(c.reason, REASON_MAX) : '';
      if (status === 'Absent' && !reason) return { status: 400, error: `Select a reason for ${r.cadetName}.` };
      if (normStatus(r.status) === status && (r.reason || '') === reason) continue;
      changes.push({ cadetId: r.cadetId, name: r.cadetName, regNo: r.cadetRegNo, from: normStatus(r.status) === 'Absent' ? `Absent (${r.reason || 'no reason'})` : 'Present', to: status, reason });
      r.status = status; r.reason = reason;
    }
    if (!changes.length) return { ok: true, changed: 0 };
    const sum = summarize(records);
    tx.update(pendingRef(id), { records, total: sum.total, present: sum.present, absent: sum.absent, approvals: { [side]: stamp(payload) }, waitingFor: [otherSide(side)], updatedAt: now, lastEditedByName: payload.name });
    return { ok: true, changed: changes.length, p: { id, ...p } };
  });
  if (!res.ok) return res;
  if (res.changed) await db.collection(Collections.AUDIT_LOG).add(auditEntry({ type: 'pending-edit', payload, session: { id, date: res.p.date, activityType: res.p.activityType, groupLabel: res.p.groupLabel },
    changes, note: `${cleanText(noteIn, 200)}${noteIn ? ' · ' : ''}${SIDE_LABEL[side]} approval recorded; the ${SIDE_LABEL[otherSide(side)]} must approve again` }));
  return { ok: true, status: 200, changed: res.changed };
}

async function countOf(q) {
  try { return (await q.count().get()).data().count; } catch { return (await q.get()).size; }
}
// Cheap, polled every few seconds by the dashboards (aggregation queries — no documents are read)
export async function approvalCounts(side) {
  const col = db.collection(Collections.PENDING);
  const [pending, needsMe] = await Promise.all([
    countOf(col.where('state', '==', 'pending')),
    side ? countOf(col.where('waitingFor', 'array-contains', side)) : Promise.resolve(0),
  ]);
  return { pending, needsMe };
}
export const pendingCount = async () => (await approvalCounts(null)).pending;
export async function listByState(state) {
  const snap = await db.collection(Collections.PENDING).where('state', '==', state).get();
  return snapToArr(snap).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
}
