export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { authenticate } from '@/lib/session';
import { hashPassword } from '@/lib/auth';
import { getAllUsers, invalidateUsers } from '@/lib/users';
import { cleanEmail } from '@/lib/settings';
import { cleanText } from '@/lib/attendance';
import { runInBackground } from '@/lib/bg';
import { timed } from '@/lib/events';
import { refreshSheetSummaries } from '@/lib/sheetjobs';
import * as sheets from '@/lib/sheets';
import { normalizeRegNo } from '@/lib/keys.mjs';

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

async function afterChange() {
  const users = await getAllUsers({ fresh: true });
  const r = await sheets.writeInactiveTabs(users);
  if (!r.success) return r;
  return refreshSheetSummaries();
}

export async function PUT(request, { params }) {
  const { payload, error } = await authenticate(request, { perm: 'canManageUsers' });
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const ref = db.collection(Collections.USERS).doc(params.id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  const cur = snap.data();
  const users = await getAllUsers({ fresh: true });
  const upd = { updatedAt: new Date().toISOString() };
  const targetRole = body.role !== undefined ? body.role : cur.role;
  const isTargetStaff = targetRole !== 'cadet';

  if (body.name !== undefined) { const n = cleanText(body.name, 80); if (!n) return NextResponse.json({ error: 'Name is required.' }, { status: 400 }); upd.name = n; }
  if (body.reg_no !== undefined) {
    const r = normalizeRegNo(body.reg_no);
    if (r && users.some(u => u.role === 'cadet' && normalizeRegNo(u.regNo) === r && u.id !== params.id)) {
      return NextResponse.json({ error: 'Regimental Number already exists.' }, { status: 400 });
    }
    upd.regNo = r || null;
  }
  if (body.username !== undefined) {
    const un = String(body.username || '').trim().toLowerCase();
    if (un && !USERNAME_RE.test(un)) return NextResponse.json({ error: 'Username may only use letters, numbers, . _ - (3-40 chars).' }, { status: 400 });
    if (isTargetStaff && un && users.some(u => u.role !== 'cadet' && u.id !== params.id && String(u.username || '').trim().toLowerCase() === un)) {
      return NextResponse.json({ error: 'Username already exists on another staff account.' }, { status: 400 });
    }
    if (un && users.some(u => String(u.username || '').trim().toLowerCase() === un && u.id !== params.id)) return NextResponse.json({ error: 'Username already exists.' }, { status: 400 });
    upd.username = un || null;
  }

  if ((targetRole === 'admin' || targetRole === 'cto')) {
    const targetEmail = body.email !== undefined ? cleanEmail(body.email) : cleanEmail(cur.email);
    if (!targetEmail) return NextResponse.json({ error: 'An Administrator or CTO account requires an email address.' }, { status: 400 });
  }

  if (body.email !== undefined) {
    const e = cleanEmail(body.email);
    if (body.email && !e) return NextResponse.json({ error: 'That email address is not valid.' }, { status: 400 });
    if (isTargetStaff && e && users.some(u => u.role !== 'cadet' && u.id !== params.id && String(u.email || '').trim().toLowerCase() === e.toLowerCase())) {
      return NextResponse.json({ error: 'That email address is already in use by another staff account.' }, { status: 400 });
    }
    upd.email = e;
    if ((cur.role === 'marker' || cur.role === 'cto') && cur.username === cur.email?.toLowerCase()) {
      upd.username = e.toLowerCase();
    }
  }

  if (isTargetStaff) {
    const checkUn = body.username !== undefined ? String(body.username || '').trim().toLowerCase() : String(cur.username || '').trim().toLowerCase();
    if (checkUn && users.some(u => u.role !== 'cadet' && u.id !== params.id && String(u.username || '').trim().toLowerCase() === checkUn)) {
      return NextResponse.json({ error: 'That username is already in use by another staff account.' }, { status: 400 });
    }
    const checkEm = upd.email !== undefined ? upd.email : cleanEmail(cur.email);
    if (checkEm && users.some(u => u.role !== 'cadet' && u.id !== params.id && String(u.email || '').trim().toLowerCase() === checkEm.toLowerCase())) {
      return NextResponse.json({ error: 'That email address is already in use by another staff account.' }, { status: 400 });
    }
  }
  if (body.phone !== undefined) upd.phone = cleanText(body.phone, 20);
  if (body.year !== undefined) upd.year = Math.min(3, Math.max(1, parseInt(body.year, 10) || 1));
  if (body.type !== undefined) upd.type = body.type === 'SW' ? 'SW' : 'SD';
  if (body.is_active !== undefined) upd.isActive = !!body.is_active;
  if (body.must_change_password !== undefined) upd.mustChangePassword = !!body.must_change_password;
  if (body.otp_required !== undefined) {
    upd.otpRequired = body.otp_required === true;
    const mail = upd.email !== undefined ? upd.email : cur.email;
    if (upd.otpRequired && !mail && isTargetStaff && targetRole !== 'admin')
      return NextResponse.json({ error: 'Add an email address first — it is needed to send the OTP.' }, { status: 400 });
  }
  if (body.password) {
    if (String(body.password).length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    upd.passwordHash = await hashPassword(String(body.password));
    upd.failedLogins = 0; upd.lockedUntil = null;
    upd.tokenVersion = Date.now();                       // sign the person out everywhere
  }
  if (body.role !== undefined && body.role !== cur.role) {
    if (params.id === payload.id) return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 });
    upd.role = body.role; upd.tokenVersion = Date.now();
  }

  if (body.unlock === true) { upd.failedLogins = 0; upd.lockedUntil = null; }
  if (upd.isActive === false) upd.tokenVersion = Date.now();

  // Roll back a discharge
  if (body.discharged === false || body.rollback === true) {
    upd.discharged = false; upd.dischargedAt = null; upd.status = 'active'; upd.isActive = true;
    if (body.year === undefined && cur.dischargedFromYear) upd.year = cur.dischargedFromYear;
  }

  await ref.update(upd);
  invalidateUsers();
  runInBackground(() => timed('sheets:roster', afterChange, () => 'roster updated in sheet'));
  return NextResponse.json({ success: true });
}

export async function DELETE(request, { params }) {
  const { payload, error } = await authenticate(request, { perm: 'canManageUsers' });
  if (error) return error;
  const sp = new URL(request.url).searchParams;
  const body = await request.json().catch(() => ({}));
  const action = body.action || sp.get('action') || 'discharge';
  const ref = db.collection(Collections.USERS).doc(params.id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  const cur = snap.data();

  if (action === 'delete') {
    if (payload.role !== 'admin') {
      return NextResponse.json({ error: 'Only administrators can delete accounts.' }, { status: 403 });
    }
    if (params.id === payload.id) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 409 });
    }
    if (cur.role === 'cadet') {
      const hasStats = (cur.stats?.total || 0) > 0;
      const attSnap = await db.collection(Collections.ATTENDANCE).where('cadetId', '==', params.id).limit(1).get();
      if (hasStats || !attSnap.empty) {
        return NextResponse.json({ error: 'This cadet has attendance history. Discharge instead.' }, { status: 409 });
      }
      await ref.delete();
      await db.collection(Collections.AUDIT_LOG).add({
        type: 'cadet-delete',
        by: payload.id,
        byName: payload.name,
        targetId: params.id,
        targetName: cur.name || '',
        targetRole: 'cadet',
        at: new Date().toISOString(),
        note: `Deleted cadet ${cur.name} (${cur.regNo || 'no Reg No'})`,
      }).catch(err => console.error('[CADET:DELETE:AUDIT]', err.message));
      invalidateUsers();
      runInBackground(() => timed('sheets:roster', afterChange, () => 'cadet deleted, roster refreshed in sheet'));
      return NextResponse.json({ success: true, deleted: true });
    }
    if (cur.role === 'admin') {
      const allUsersSnap = await db.collection(Collections.USERS).get();
      const activeAdmins = allUsersSnap.docs.filter(d => {
        const u = d.data();
        return u.role === 'admin' && u.isActive !== false && !u.discharged;
      });
      if (activeAdmins.length <= 1) {
        return NextResponse.json({ error: 'Cannot delete the last active administrator.' }, { status: 409 });
      }
    }
    await ref.delete();
    await db.collection(Collections.AUDIT_LOG).add({
      type: 'account-delete',
      by: payload.id,
      byName: payload.name,
      targetId: params.id,
      targetName: cur.name || '',
      targetRole: cur.role || '',
      at: new Date().toISOString(),
      note: `Deleted account for ${cur.name} (${cur.role})`,
    }).catch(err => console.error('[ACCOUNT:DELETE:AUDIT]', err.message));
    invalidateUsers();
    return NextResponse.json({ success: true, deleted: true });
  }

  if (params.id === payload.id) return NextResponse.json({ error: 'You cannot discharge yourself.' }, { status: 400 });
  const now = new Date().toISOString();
  await ref.update({
    isActive: false, updatedAt: now, tokenVersion: Date.now(),
    discharged: action === 'discharge', dischargedAt: action === 'discharge' ? now : null,
    dischargedFromYear: cur.year ?? null, status: action === 'discharge' ? 'discharged' : 'inactive',
  });
  invalidateUsers();
  runInBackground(() => timed('sheets:roster', afterChange, () => 'discharge updated in sheet'));
  return NextResponse.json({ success: true });
}
