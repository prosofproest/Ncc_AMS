export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { db, Collections, snapToArr } from '@/lib/firebase';
import { authenticate } from '@/lib/session';
import { runInBackground } from '@/lib/bg';
import { approve, reject, editPending, approverSide, approvalCounts, listByState, summaryOf } from '@/lib/approvals';
import { afterFinalApproval } from '@/lib/approvals';
import { auditEntry } from '@/lib/attendance';

// GET  /api/approvals?summary=1           -> { pending, needsMe }        (polled; admin + CTO)
// GET  /api/approvals?state=pending|rejected -> list without rosters     (admin + CTO)
// GET  /api/approvals?id=<id>             -> one submission with roster  (admin + CTO, or the person who submitted it)
// GET  /api/approvals?mine=1              -> my own pending / rejected   (any marker)
export async function GET(request) {
  const { payload, error } = await authenticate(request);
  if (error) return error;
  const sp = new URL(request.url).searchParams;
  const side = approverSide(payload);

  if (sp.get('mine')) {
    const snap = await db.collection(Collections.PENDING).where('markedBy', '==', payload.id).get();
    const list = snapToArr(snap).filter(p => ['pending', 'committing', 'rejected'].includes(p.state))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30).map(p => summaryOf(p, null));
    return NextResponse.json({ submissions: list });
  }
  if (sp.get('id')) {
    const snap = await db.collection(Collections.PENDING).doc(sp.get('id')).get();
    if (!snap.exists) return NextResponse.json({ error: 'Not found (it may have been approved already).' }, { status: 404 });
    const p = { id: snap.id, ...snap.data() };
    if (!side && p.markedBy !== payload.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ submission: { ...summaryOf(p, side), records: p.records } });
  }
  if (!side) return NextResponse.json({ error: 'Only the Admin and the CTO can review submissions.' }, { status: 403 });
  if (sp.get('summary')) return NextResponse.json({ ...(await approvalCounts(side)), side });
  const state = sp.get('state') === 'rejected' ? 'rejected' : 'pending';
  const list = (await listByState(state)).slice(0, 100).map(p => summaryOf(p, side));
  return NextResponse.json({ submissions: list, side });
}

// POST { id, action: 'approve' | 'reject', reason? }
export async function POST(request) {
  const { payload, error } = await authenticate(request, { perm: 'canApproveAttendance' });
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'id required.' }, { status: 400 });

  if (body.action === 'reject') {
    const r = await reject(id, payload, body.reason);
    return NextResponse.json(r.ok ? { success: true } : { error: r.error }, { status: r.status });
  }
  if (body.action !== 'approve') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });

  const r = await approve(id, payload);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  if (r.final) {
    runInBackground(() => afterFinalApproval({ session: r.session, records: r.records }));      // sheet + mails, after the response
    return NextResponse.json({ success: true, final: true, sessionId: r.session.id, present: r.session.present, absent: r.session.absent });
  }
  return NextResponse.json({ success: true, final: false, waitingFor: r.waitingFor });
}

// PUT { id, changes: [{cadet_id, status, reason}], note }  — correct a pending roll before approving
export async function PUT(request) {
  const { payload, error } = await authenticate(request, { perm: 'canApproveAttendance' });
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const r = await editPending(String(body.id || ''), payload, Array.isArray(body.changes) ? body.changes : [], body.note);
  return NextResponse.json(r.ok ? { success: true, changed: r.changed } : { error: r.error }, { status: r.status });
}

// DELETE /api/approvals?id=<id> or body: { id } — Administrator deletes a rejected/resubmitted submission
export async function DELETE(request) {
  const { payload, error } = await authenticate(request);
  if (error) return error;
  if (payload.role !== 'admin') {
    return NextResponse.json({ error: 'Only the Administrator can delete rejected submissions.' }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  let id = sp.get('id');
  if (!id) {
    const body = await request.json().catch(() => ({}));
    id = body.id;
  }
  if (!id) return NextResponse.json({ error: 'id required.' }, { status: 400 });

  const ref = db.collection(Collections.PENDING).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const data = snap.data();
  if (data.state !== 'rejected' && data.state !== 'resubmitted') {
    return NextResponse.json({ error: 'Only rejected or resubmitted submissions can be deleted.' }, { status: 409 });
  }

  await ref.delete();

  await db.collection(Collections.AUDIT_LOG).add(auditEntry({
    type: 'delete-rejected',
    payload,
    session: { id, date: data.date, activityType: data.activityType, groupLabel: data.groupLabel },
    note: `Deleted rejected submission: ${data.date} ${data.activityType || ''} (${data.groupLabel || ''})`,
  }));

  return NextResponse.json({ success: true, id });
}

