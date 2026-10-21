export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { authenticate } from '@/lib/session';
import { can } from '@/lib/permissions';
import { hashPassword } from '@/lib/auth';
import { getAllUsers, invalidateUsers, SAFE_FIELDS } from '@/lib/users';
import { readStats, emptyStats } from '@/lib/stats';
import { cleanEmail } from '@/lib/settings';
import { cleanText } from '@/lib/attendance';
import { personOrder } from '@/lib/groups';
import { runInBackground } from '@/lib/bg';
import { maybeAutoImport } from '@/lib/import';
import { timed } from '@/lib/events';
import { refreshSheetSummaries } from '@/lib/sheetjobs';

const order = (a, b) => personOrder({ ...a, cadetYear: a.year, cadetType: a.type, cadetRegNo: a.regNo, cadetName: a.name }, { ...b, cadetYear: b.year, cadetType: b.type, cadetRegNo: b.regNo, cadetName: b.name });

export async function GET(request) {
  const { payload, error } = await authenticate(request);
  if (error) return error;
  const sp = new URL(request.url).searchParams;

  // The roster in the sheet is the source of truth — pick up edits quietly (max once per 10 min)
  runInBackground(() => timed('sheets:auto-import', async () => {
    const r = await maybeAutoImport();
    return r || { success: true };
  }, () => 'roster refreshed from sheet'));

  const users = await getAllUsers();

  if (sp.get('all')) {
    if (!(can(payload, 'canManageUsers') || can(payload, 'canViewAllAttendance')))
      return NextResponse.json({ error: 'No permission.' }, { status: 403 });
    const list = [...users].sort((a, b) => a.name.localeCompare(b.name)).map(u => {
      const st = readStats(u);
      const isCadet = u.role === 'cadet';
      return {
        ...SAFE_FIELDS(u),
        pct: isCadet ? st.pct : null,
        present: isCadet ? st.present : 0,
        absent: isCadet ? st.absent : 0,
        total: isCadet ? st.total : 0,
        benefitCredits: isCadet ? st.benefit : 0,
        hasEmail: !!u.email
      };
    });
    return NextResponse.json({ cadets: list });
  }

  if (!(can(payload, 'canMarkAttendance') || can(payload, 'canViewAllAttendance') || can(payload, 'canManageBenefits') || can(payload, 'canEditAttendance')))
    return NextResponse.json({ error: 'No permission.' }, { status: 403 });
  const list = users
    .filter(u => u.isActive && !u.discharged && u.role === 'cadet')
    .sort(order)
    .map(u => ({ id: u.id, name: u.name, regNo: u.regNo || '', year: u.year || null, type: u.type || null, role: u.role }));
  return NextResponse.json({ cadets: list });
}

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

export async function POST(request) {
  const { payload, error } = await authenticate(request, { perm: 'canManageUsers' });
  if (error) return error;
  const body = await request.json().catch(() => ({}));

  const name = cleanText(body.name, 80);
  const role = String(body.role || 'cadet');
  const regNo = String(body.reg_no || '').trim().toUpperCase();
  const email = cleanEmail(body.email);
  const isCadet = role === 'cadet';
  const staff = !isCadet;
  const password = String(body.password || (isCadet ? regNo : ''));

  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (password.length < 6 || password.length > 100) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  if (body.email && !email) return NextResponse.json({ error: 'That email address is not valid.' }, { status: 400 });

  if (staff && !email) {
    return NextResponse.json({ error: 'Email address is required.' }, { status: 400 });
  }

  let username = String(body.username || '').trim().toLowerCase();
  if (role === 'marker' || role === 'cto' || (staff && !username)) {
    username = email ? email.toLowerCase() : '';
  }

  if (staff && username && !username.includes('@') && !USERNAME_RE.test(username)) {
    return NextResponse.json({ error: 'Username is required (3-40 letters, numbers, . _ -).' }, { status: 400 });
  }
  if (isCadet && username && !USERNAME_RE.test(username)) {
    return NextResponse.json({ error: 'Username may only use letters, numbers, . _ -' }, { status: 400 });
  }

  const users = await getAllUsers({ fresh: true });

  // Account e-mails must be unique among non-cadet accounts (clear error message if used)
  if (staff && email) {
    if (users.some(u => u.role !== 'cadet' && String(u.email || '').toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ error: 'That email address is already in use by another staff account.' }, { status: 400 });
    }
  }

  if (username && users.some(u => u.username === username)) {
    return NextResponse.json({ error: 'Username already exists.' }, { status: 400 });
  }
  if (regNo && users.some(u => u.regNo === regNo)) {
    return NextResponse.json({ error: 'Regimental Number already exists.' }, { status: 400 });
  }

  const otpRequired = body.otp_required === undefined ? true : body.otp_required === true;
  if (otpRequired && !email && staff && role !== 'admin') {
    return NextResponse.json({ error: 'Add an email address — it is needed to send the OTP.' }, { status: 400 });
  }

  const doc = {
    name, role, username: username || null,
    ...(isCadet ? {
      regNo: regNo || null,
      year: parseInt(body.year, 10) || 1,
      type: body.type === 'SW' ? 'SW' : 'SD',
      stats: emptyStats(),
      benefit: 0,
    } : {}),
    email: email || null, phone: cleanText(body.phone, 20),
    passwordHash: await hashPassword(password),
    mustChangePassword: body.must_change_password !== false,
    otpRequired, isActive: true, discharged: false,
    createdAt: new Date().toISOString(), createdBy: payload.id,
  };
  const ref = await db.collection(Collections.USERS).add(doc);
  invalidateUsers();
  if (isCadet) runInBackground(() => timed('sheets:roster', refreshSheetSummaries, () => 'new person added to sheet'));
  return NextResponse.json({ user: { id: ref.id } });
}
