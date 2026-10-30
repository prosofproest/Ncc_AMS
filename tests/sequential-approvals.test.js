// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { installBrowser, jar } from './helpers/browser.js';
import { flushBg } from './helpers/http.js';
import { todayIST } from '@/lib/time';
import { deriveStage } from '@/lib/approvals';
import { saveSettings } from '@/lib/settings';

const stableRouter = vi.hoisted(() => ({}));
vi.mock('next/navigation', () => {
  return {
    useRouter: () => stableRouter,
    usePathname: () => '/dashboard/admin/approvals',
    useSearchParams: () => new URLSearchParams(''),
    redirect: () => {}
  };
});

const db = globalThis.__db, TODAY = todayIST();
const sheets = globalThis.__sheets;
const api = async (url, method = 'GET', body, cookie = jar.cookie) => {
  if (cookie) jar.cookie = cookie;
  const r = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, json };
};

const signIn = async (id, pw) => {
  jar.cookie = '';
  sessionStorage.clear();
  const r = await api('/api/auth/login', 'POST', { identifier: id, password: pw });
  expect(r.status).toBe(200);
  return jar.cookie;
};

let adminCookie, ctoCookie, markerCookie;

beforeAll(async () => {
  installBrowser();
  const stats = { total: 0, present: 0, absent: 0, months: {} };
  const mk = (id, d) => db.collection('users').doc(id).set({ isActive: true, discharged: false, stats, benefit: 0, mustChangePassword: false, otpRequired: false, ...d });
  await mk('admin_seq', { name: 'Admin Officer', role: 'admin', username: 'admin_seq', passwordHash: await bcrypt.hash('Admin@123', 4), email: 'admin@seq.in' });
  await mk('cto_seq', { name: 'Lt. Sir', role: 'cto', username: 'sir_seq', passwordHash: await bcrypt.hash('Sir@12345', 4), email: 'sir@seq.in' });
  await mk('marker_seq', { name: 'Sgt Marker', role: 'marker', username: 'marker_seq', passwordHash: await bcrypt.hash('Marker@123', 4), email: 'marker@seq.in' });
  await db.collection('settings').doc('main').set({
    sirEmail: 'sir@seq.in',
    backupEmail: 'backup@seq.in',
    notifyAdminOnReturn: true,
    notifyCtoOnAdminApproval: false
  });
  for (const [i, name] of ['Cadet Alpha', 'Cadet Bravo'].entries()) {
    await mk('cadet_seq_' + i, { name, role: 'cadet', year: 1, type: 'SD', email: `cadet${i}@seq.in`, regNo: `KAR/NCC/1/90${i}`, passwordHash: await bcrypt.hash('x', 4) });
  }

  adminCookie = await signIn('admin_seq', 'Admin@123');
  ctoCookie = await signIn('sir_seq', 'Sir@12345');
  markerCookie = await signIn('marker_seq', 'Marker@123');
});

describe('Sequential Approvals & State Machine', () => {
  it('deriveStage works for explicit and legacy records', () => {
    expect(deriveStage({ stage: 'cto' })).toBe('cto');
    expect(deriveStage({ stage: 'admin' })).toBe('admin');
    expect(deriveStage({})).toBe('admin');
    expect(deriveStage({ approvals: { admin: { by: 'a' } } })).toBe('cto');
  });

  it('marker submission starts at stage admin; CTO cannot approve first; Admin advances to cto; CTO returns to Admin', async () => {
    globalThis.__mail.length = 0;
    const pastDate = '2026-08-10';
    // 1. Marker submits
    const sub = await api('/api/attendance', 'POST', {
      date: pastDate,
      activity_type: 'Parade',
      activity_description: 'Drill',
      years: [1],
      records: [
        { cadet_id: 'cadet_seq_0', status: 'Present' },
        { cadet_id: 'cadet_seq_1', status: 'Absent', reason: 'Sick / Medical' }
      ]
    }, markerCookie);
    expect(sub.status).toBe(200);
    const id = sub.json.sessionId;

    const pend = (await db.collection('pending_sessions').doc(id).get()).data();
    expect(pend.stage).toBe('admin');
    expect(pend.waitingFor).toEqual(['admin']);
    expect(pend.approvals).toEqual({});

    // 2. CTO tries to approve before Admin -> 409 Conflict
    const ctoApproveFirst = await api('/api/approvals', 'POST', { id, action: 'approve' }, ctoCookie);
    expect(ctoApproveFirst.status).toBe(409);
    expect(ctoApproveFirst.json.error).toMatch(/Administrator must approve first|with the Administrator now/);

    // 3. Admin approves -> advances to stage 'cto'
    const adminApprove = await api('/api/approvals', 'POST', { id, action: 'approve' }, adminCookie);
    expect(adminApprove.status).toBe(200);
    expect(adminApprove.json.final).toBe(false);

    const pendAfterAdmin = (await db.collection('pending_sessions').doc(id).get()).data();
    expect(pendAfterAdmin.stage).toBe('cto');
    expect(pendAfterAdmin.waitingFor).toEqual(['cto']);
    expect(pendAfterAdmin.approvals.admin).toBeTruthy();
    expect(pendAfterAdmin.approvals.admin.byName).toBe('Admin Officer');

    // Admin tries to approve again -> 409
    const adminApproveAgain = await api('/api/approvals', 'POST', { id, action: 'approve' }, adminCookie);
    expect(adminApproveAgain.status).toBe(409);
    expect(adminApproveAgain.json.error).toMatch(/with the CTO now/);

    // 4. CTO returns to Administrator
    const ctoReturn = await api('/api/approvals', 'POST', { id, action: 'reject', reason: 'Please verify medical certificate' }, ctoCookie);
    expect(ctoReturn.status).toBe(200);
    expect(ctoReturn.json.success).toBe(true);

    await flushBg();

    const pendAfterReturn = (await db.collection('pending_sessions').doc(id).get()).data();
    expect(pendAfterReturn.stage).toBe('admin');
    expect(pendAfterReturn.waitingFor).toEqual(['admin']);
    expect(pendAfterReturn.approvals).toEqual({});
    expect(pendAfterReturn.returnedByCto).toMatchObject({
      byName: 'Lt. Sir',
      reason: 'Please verify medical certificate'
    });
    expect(pendAfterReturn.history.some(h => h.action === 'returned' && h.role === 'cto')).toBe(true);

    // Verify Admin was notified by email
    const returnMail = globalThis.__mail.find(m => /Returned by CTO/.test(m.subject));
    expect(returnMail).toBeTruthy();
    expect(returnMail.subject).toContain('[NCC AIRWING FLIGHT-B] Returned by CTO - 10 Aug 2026 Parade Year 1');
    expect(returnMail.html).toContain('Please verify medical certificate');

    // Verify Google Sheets change log has "Returned to Administrator"
    const changeLog = sheets.tab('Change Log')?.rows || [];
    const returnRow = changeLog.find(r => r[1] === 'Returned to Administrator');
    expect(returnRow).toBeTruthy();
    expect(returnRow[6]).toBe('With CTO');
    expect(returnRow[7]).toBe('With Administrator');
    expect(returnRow[8]).toContain('Please verify medical certificate');

    // 5. Admin edits the pending roll
    const editRes = await api('/api/approvals', 'PUT', {
      id,
      note: 'Cadet Alpha was late',
      changes: [{ cadet_id: 'cadet_seq_0', status: 'Absent', reason: 'Late arrival' }]
    }, adminCookie);
    expect(editRes.status).toBe(200);

    const pendAfterEdit = (await db.collection('pending_sessions').doc(id).get()).data();
    expect(pendAfterEdit.stage).toBe('admin');
    expect(pendAfterEdit.approvals).toEqual({});
    expect(pendAfterEdit.history.some(h => h.action === 'edited' && h.role === 'admin')).toBe(true);

    // 6. Admin approves -> returnedByCto is cleared, moves to history, advances to stage 'cto'
    const adminReApprove = await api('/api/approvals', 'POST', { id, action: 'approve' }, adminCookie);
    expect(adminReApprove.status).toBe(200);

    const pendAfterReApprove = (await db.collection('pending_sessions').doc(id).get()).data();
    expect(pendAfterReApprove.stage).toBe('cto');
    expect(pendAfterReApprove.returnedByCto).toBeNull();
    expect(pendAfterReApprove.history.some(h => h.action === 'approved' && h.role === 'admin')).toBe(true);

    // 7. CTO approves and finalises
    const ctoFinal = await api('/api/approvals', 'POST', { id, action: 'approve' }, ctoCookie);
    expect(ctoFinal.status).toBe(200);
    expect(ctoFinal.json.final).toBe(true);

    await flushBg();

    expect((await db.collection('pending_sessions').doc(id).get()).exists).toBe(false);
    expect(db.all('attendance').filter(a => a.data.sessionId === id).length).toBe(2);
  });

  it('email settings: notifyAdminOnReturn=false skips Admin return email; notifyCtoOnAdminApproval=true sends CTO email', async () => {
    globalThis.__mail.length = 0;
    await saveSettings({
      notifyAdminOnReturn: false,
      notifyCtoOnAdminApproval: true
    });

    const date = '2026-08-11';
    const sub = await api('/api/attendance', 'POST', {
      date,
      activity_type: 'Parade',
      activity_description: 'Drill',
      years: [1],
      records: [{ cadet_id: 'cadet_seq_0', status: 'Present' }]
    }, markerCookie);
    const id = sub.json.sessionId;

    // Admin approves -> should notify CTO because notifyCtoOnAdminApproval is true
    await api('/api/approvals', 'POST', { id, action: 'approve' }, adminCookie);
    await flushBg();

    const ctoMail = globalThis.__mail.find(m => /Awaiting CTO approval/.test(m.subject));
    expect(ctoMail).toBeTruthy();
    expect(ctoMail.subject).toContain('[NCC AIRWING FLIGHT-B] Awaiting CTO approval - 11 Aug 2026 Parade Year 1');

    // CTO returns -> should NOT notify Admin because notifyAdminOnReturn is false
    globalThis.__mail.length = 0;
    await api('/api/approvals', 'POST', { id, action: 'reject', reason: 'Check' }, ctoCookie);
    await flushBg();

    const returnMail = globalThis.__mail.find(m => /Returned by CTO/.test(m.subject));
    expect(returnMail).toBeUndefined();

    // Reset settings back
    await saveSettings({
      notifyAdminOnReturn: true,
      notifyCtoOnAdminApproval: false
    });
  });

  it('staff submissions: Admin submission starts at cto; CTO submission starts at admin', async () => {
    const dAdmin = '2026-08-12';
    const subAdmin = await api('/api/attendance', 'POST', {
      date: dAdmin,
      activity_type: 'Parade',
      activity_description: 'Staff',
      years: [1],
      records: [{ cadet_id: 'cadet_seq_0', status: 'Present' }]
    }, adminCookie);
    expect(subAdmin.status).toBe(200);
    const docAdmin = (await db.collection('pending_sessions').doc(subAdmin.json.sessionId).get()).data();
    expect(docAdmin.stage).toBe('cto');
    expect(docAdmin.waitingFor).toEqual(['cto']);
    expect(docAdmin.approvals.admin.byName).toBe('Admin Officer');

    const dCto = '2026-08-13';
    const subCto = await api('/api/attendance', 'POST', {
      date: dCto,
      activity_type: 'Parade',
      activity_description: 'Staff',
      years: [1],
      records: [{ cadet_id: 'cadet_seq_0', status: 'Present' }]
    }, ctoCookie);
    expect(subCto.status).toBe(200);
    const docCto = (await db.collection('pending_sessions').doc(subCto.json.sessionId).get()).data();
    expect(docCto.stage).toBe('admin');
    expect(docCto.waitingFor).toEqual(['admin']);
    expect(docCto.approvals.cto.byName).toBe('Lt. Sir');
  });

  it('Google Sheet change log records Rejected on Admin reject', async () => {
    const dRej = '2026-08-14';
    const sub = await api('/api/attendance', 'POST', {
      date: dRej,
      activity_type: 'Parade',
      activity_description: 'Test',
      years: [1],
      records: [{ cadet_id: 'cadet_seq_0', status: 'Present' }]
    }, markerCookie);
    const id = sub.json.sessionId;

    await api('/api/approvals', 'POST', { id, action: 'reject', reason: 'Invalid date selection' }, adminCookie);
    await flushBg();

    const changeLog = sheets.tab('Change Log')?.rows || [];
    const rejRow = changeLog.find(r => r[1] === 'Rejected' && r[8] === 'Invalid date selection');
    expect(rejRow).toBeTruthy();
    expect(rejRow[6]).toBe('With Administrator');
    expect(rejRow[7]).toBe('Rejected');
  });
});
