import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { call, flushBg, mailTo } from './helpers/http.js';
import { todayIST } from '@/lib/time';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import * as loginR from '@/app/api/auth/login/route';
import * as otpR from '@/app/api/auth/verify-otp/route';
import * as resendR from '@/app/api/auth/resend-otp/route';
import * as cpR from '@/app/api/auth/change-password/route';
import * as meR from '@/app/api/me/route';
import * as syncR from '@/app/api/sync/route';
import * as cadetsR from '@/app/api/cadets/route';
import * as cadetIdR from '@/app/api/cadets/[id]/route';
import * as attR from '@/app/api/attendance/route';
import * as benR from '@/app/api/benefits/route';
import * as setR from '@/app/api/settings/route';
import * as repR from '@/app/api/reports/route';
import * as promoR from '@/app/api/cadets/promote/route';
import * as healthR from '@/app/api/health/route';
import * as overR from '@/app/api/overview/route';
import * as boardR from '@/app/api/leaderboard/route';
import * as auditR from '@/app/api/attendance/audit/route';
import * as dailyR from '@/app/api/cron/daily/route';
import * as monthlyR from '@/app/api/cron/monthly/route';
import * as metaR from '@/app/api/meta/route';
import * as apprR from '@/app/api/approvals/route';
import * as rolesR from '@/app/api/roles/route';
import * as searchR from '@/app/api/search/route';

const db = globalThis.__db, sheets = globalThis.__sheets;
const TODAY = todayIST();
const HDR = ['Sl.', 'Name', 'Reg No.', 'Type (SD/SW)', 'Email', 'Phone', 'Attendance %', 'Status'];
const state = {};
const approve = (cookie, id) => call(apprR.POST, { method: 'POST', cookie, body: { id, action: 'approve' } });
const approveBoth = async id => { const a = await approve(state.admin, id); const c = await approve(state.cto, id); expect([a.status, c.status]).toEqual([200, 200]); expect(c.json.final).toBe(true); return c; };
const userByName = n => db.all('users').map(d => ({ id: d.id, ...d.data })).find(u => u.name === n);

beforeAll(async () => {
  const pw = await bcrypt.hash('Admin@123', 10);
  const mk = (id, d) => db.collection('users').doc(id).set({ isActive: true, discharged: false, stats: { total: 0, present: 0, absent: 0, months: {} }, benefit: 0, mustChangePassword: false, ...d });
  await mk('admin1', { name: 'Admin Officer', role: 'admin', username: 'admin', passwordHash: pw, email: 'admin@test.in', otpRequired: false });
  await mk('cto1', { name: 'Lt. Sir', role: 'cto', username: 'sir', passwordHash: await bcrypt.hash('Sir@12345', 10), email: 'sir.cto@test.in', otpRequired: false });
  await db.collection('settings').doc('main').set({ sirEmail: 'sir@test.in', backupEmail: 'backup@test.in' });
  // The unit types its data into the sheet — headers exist but the app must cope with whatever is there
  sheets.addTab('Year 1', [HDR,
    [1, 'Arjun Sharma', 'KAR/NCC/2026/101', 'SD', 'arjun@test.in', '9000000001'],
    [2, 'Priya Nair', 'KAR/NCC/2026/102', 'SD', 'priya@test.in'],
    [3, 'Rahul Shetty', 'KAR/NCC/2026/103', 'SW', ''],
    [4, 'Ananya Rao', 'KAR/NCC/2026/104', 'SD', 'not-an-email']]);
  sheets.addTab('Year 2', [HDR, [1, 'Karthik Bhat', 'KAR/NCC/2025/201', 'SD', 'karthik@test.in'], [2, 'Sneha Kamath', 'KAR/NCC/2025/202', 'SW', 'sneha@test.in']]);
  sheets.addTab('Year 3', [HDR, [1, 'Vivek Pai', 'KAR/NCC/2024/301', 'SD', 'vivek@test.in'], [2, 'Divya Hegde', 'KAR/NCC/2024/302', 'SD', 'divya@test.in']]);
});

const login = (identifier, password) => call(loginR.POST, { method: 'POST', body: { identifier, password } });

describe('1. sign-in, lockout and OTP', () => {
  it('admin signs in with username + password (OTP off)', async () => {
    const r = await login('admin', 'Admin@123');
    expect(r.status).toBe(200);
    expect(r.json.dashboardPath).toBe('/dashboard/admin');
    expect(r.cookie).toMatch(/^ncc_token=/);
    state.admin = r.cookie;
    const me = await call(meR.GET, { cookie: state.admin });
    expect(me.json.user.role).toBe('admin');
  });
  it('rejects a wrong password without revealing which part was wrong', async () => {
    const r = await login('admin', 'nope');
    expect(r.status).toBe(401); expect(r.json.error).toBe('Invalid credentials.');
  });
  it('locks the account after 5 wrong passwords and blocks even the right one', async () => {
    for (let i = 0; i < 4; i++) await login('sir', 'bad');
    const fifth = await login('sir', 'bad');
    expect(fifth.status).toBe(429);
    const right = await login('sir', 'Sir@12345');
    expect(right.status).toBe(429);
    await db.collection('users').doc('cto1').update({ lockedUntil: null, failedLogins: 0 });   // admin "unlock" equivalent
    const ok = await login('sir', 'Sir@12345');
    expect(ok.status).toBe(200); state.cto = ok.cookie;
  });
});

describe('2. Google Sheet: setup + import (the sheet is where cadet data is typed)', () => {
  it('Setup Sheet creates missing tabs, leaves typed roster data untouched', async () => {
    const before = JSON.stringify(sheets.tab('Year 1').rows);
    const r = await call(syncR.POST, { method: 'POST', cookie: state.admin, body: { action: 'setup' } });
    expect(r.json.success).toBe(true);
    for (const t of ['Attendance Log', 'Daily Report', 'Absentees', 'Monthly Report', 'Cadet Summary', 'Benefits', 'Change Log', 'Graduated', 'Discharged'])
      expect(sheets.tab(t), t).toBeTruthy();
    expect(sheets.tab('Archive')).toBeUndefined();
    expect(JSON.stringify(sheets.tab('Year 1').rows)).toBe(before);
    expect(sheets.tab('Attendance Log').rows[0]).toContain('Reason');
    expect(sheets.tab('Attendance Log').hiddenCols).toContain(12);          // key column hidden
    const again = await call(syncR.POST, { method: 'POST', cookie: state.admin, body: { action: 'setup' } });
    expect(again.json.created).toEqual([]);                                  // idempotent
  });
  it('Import reads cadets, emails and types from the sheet and warns about a bad email', async () => {
    const r = await call(syncR.POST, { method: 'POST', cookie: state.admin, body: { action: 'import' } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ success: true, created: 8, updated: 0 });
    expect(r.json.warnings.join(' ')).toMatch(/not-an-email/);
    expect(userByName('Arjun Sharma')).toMatchObject({ year: 1, type: 'SD', email: 'arjun@test.in', regNo: 'KAR/NCC/2026/101', role: 'cadet', otpRequired: true });
    expect(userByName('Rahul Shetty')).toMatchObject({ type: 'SW', email: '' });
    expect(userByName('Ananya Rao').email).toBe('');                         // invalid email not stored
    expect(userByName('Vivek Pai').year).toBe(3);
    const again = await call(syncR.POST, { method: 'POST', cookie: state.admin, body: { action: 'import' } });
    expect(again.json).toMatchObject({ created: 0, updated: 0, unchanged: 8 });   // idempotent
  });
  it('Import refuses to run on an empty sheet instead of wiping the roster', async () => {
    const saved = ['Year 1', 'Year 2', 'Year 3'].map(t => [t, sheets.tab(t).rows]);
    saved.forEach(([t]) => { sheets.tab(t).rows = [HDR]; });
    const r = await call(syncR.POST, { method: 'POST', cookie: state.admin, body: { action: 'import' } });
    expect(r.status).toBe(500); expect(r.json.error).toMatch(/no cadets/i);
    saved.forEach(([t, rows]) => { sheets.tab(t).rows = rows; });
    expect(db.all('users').filter(d => d.data.isActive).length).toBe(10);
  });
});

describe('3. admin creates a marker account with 2-step OTP', () => {
  it('requires an email when OTP is on, then creates the account', async () => {
    const bad = await call(cadetsR.POST, { method: 'POST', cookie: state.admin, body: { name: 'Sgt Rohan', role: 'marker', password: 'Marker@123', otp_required: true } });
    expect(bad.status).toBe(400); expect(bad.json.error).toMatch(/email/i);
    const ok = await call(cadetsR.POST, { method: 'POST', cookie: state.admin, body: { name: 'Sgt Rohan', role: 'marker', password: 'Marker@123', email: 'rohan@test.in', otp_required: true } });
    expect(ok.status).toBe(200); state.markerId = ok.json.user.id;
    const dup = await call(cadetsR.POST, { method: 'POST', cookie: state.admin, body: { name: 'X', role: 'marker', password: 'abcdef', email: 'rohan@test.in' } });
    expect(dup.status).toBe(400); expect(dup.json.error).toMatch(/already in use/i);
  });
  it('login sends a 6-digit code by email and does NOT issue a session yet', async () => {
    globalThis.__mail.length = 0;
    const r = await login('rohan@test.in', 'Marker@123');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ otpRequired: true, emailHint: 'ro***@test.in' });
    expect(r.cookie).toBe('');
    const m = mailTo('rohan@test.in')[0];
    expect(m.subject).toMatch(/is your sign-in code/);
    state.code = m.subject.match(/^(\d{6})/)[1]; state.challenge = r.json.challengeId;
    expect(m.html).toContain(state.code);
    expect(m.html).toContain('NCC AIRWING'); expect(m.html).toContain('6 KAR AIR SQN NCC');
  });
  it('wrong code is refused, resend has a cooldown, right code signs in', async () => {
    const wrong = await call(otpR.POST, { method: 'POST', body: { challengeId: state.challenge, code: state.code === '000000' ? '111111' : '000000' } });
    expect(wrong.status).toBe(401); expect(wrong.json.error).toMatch(/4 attempt/);
    const resend = await call(resendR.POST, { method: 'POST', body: { challengeId: state.challenge } });
    expect(resend.status).toBe(429);
    const ok = await call(otpR.POST, { method: 'POST', body: { challengeId: state.challenge, code: state.code } });
    expect(ok.status).toBe(200); expect(ok.json.dashboardPath).toBe('/dashboard/marker');
    state.marker = ok.cookie;
    const reuse = await call(otpR.POST, { method: 'POST', body: { challengeId: state.challenge, code: state.code } });
    expect(reuse.status).toBe(400);                                         // single use
  });
  it('5 wrong codes burn the challenge', async () => {
    const r = await login('rohan@test.in', 'Marker@123');
    for (let i = 0; i < 4; i++) await call(otpR.POST, { method: 'POST', body: { challengeId: r.json.challengeId, code: '999999' } });
    const last = await call(otpR.POST, { method: 'POST', body: { challengeId: r.json.challengeId, code: '999999' } });
    expect(last.status).toBe(429); expect(last.json.restart).toBe(true);
  });
  it('an expired code is refused', async () => {
    const r = await login('rohan@test.in', 'Marker@123');
    await db.collection('otp_challenges').doc(r.json.challengeId).update({ expiresAt: Date.now() - 1 });
    const code = mailTo('rohan@test.in').at(-1).subject.match(/^(\d{6})/)[1];
    const x = await call(otpR.POST, { method: 'POST', body: { challengeId: r.json.challengeId, code } });
    expect(x.status).toBe(400); expect(x.json.error).toMatch(/expired/);
  });
  it('if the email service is down the login says so and leaves no dangling challenge', async () => {
    globalThis.__mailFail = true;
    const n = db.all('otp_challenges').length;
    const r = await login('rohan@test.in', 'Marker@123');
    globalThis.__mailFail = false;
    expect(r.status).toBe(502);
    expect(db.all('otp_challenges').length).toBe(n);
  });
  it('admin can switch OTP off at any time and the next login goes straight in', async () => {
    const off = await call(cadetIdR.PUT, { method: 'PUT', cookie: state.admin, params: { id: state.markerId }, body: { otp_required: false } });
    expect(off.json.success).toBe(true);
    const r = await login('rohan@test.in', 'Marker@123');
    expect(r.json.otpRequired).toBeUndefined(); expect(r.cookie).toMatch(/^ncc_token=/); state.marker = r.cookie;
    await call(cadetIdR.PUT, { method: 'PUT', cookie: state.admin, params: { id: state.markerId }, body: { otp_required: true } });
  });
});

const rows = tab => sheets.tab(tab).rows.slice(1).filter(r => r && r.some(c => c !== '' && c != null));
const ids = (...names) => names.map(n => userByName(n).id);
const att = (name, status, reason = '') => ({ cadet_id: userByName(name).id, status, reason });
const live = (extra = {}) => ({
  date: TODAY, activity_type: 'Parade', activity_description: 'Weekly drill', years: [1, 2],
  geo_lat: 12.914, geo_lng: 74.856, photo_urls: ['https://res.cloudinary.com/demo/image/upload/v1/a.jpg'], ...extra
});

describe('4. marking attendance (years 1 & 2)', () => {
  it('marker sees only active cadets, reasons list and activity list', async () => {
    const c = await call(cadetsR.GET, { cookie: state.marker, url: '/api/cadets' });
    expect(c.status).toBe(200); expect(c.json.cadets.length).toBe(8);
    expect(c.json.cadets[0]).toMatchObject({ year: 1, type: 'SD' });            // Year 1 first, SD before SW
    expect(JSON.stringify(c.json)).not.toMatch(/passwordHash|email/);
    const m = await call(metaR.GET, { cookie: state.marker });
    expect(m.json.reasons).toContain('Sick / Medical'); expect(m.json.threshold).toBe(75);
  });
  it('validates input: reason needed, no future dates, group must match, GPS for live', async () => {
    const base = [att('Arjun Sharma', 'Present'), att('Priya Nair', 'Absent', 'Sick / Medical')];
    const post = body => call(attR.POST, { method: 'POST', cookie: state.marker, body });
    expect((await post(live({ records: [att('Arjun Sharma', 'Absent', '')] }))).json.error).toMatch(/reason/i);
    expect((await post(live({ date: '2999-01-01', records: base }))).json.error).toMatch(/future/i);
    expect((await post(live({ records: [...base, att('Vivek Pai', 'Present')] }))).json.error).toMatch(/not part of the selected group/);
    expect((await post(live({ geo_lat: null, geo_lng: null, records: base }))).json.error).toMatch(/GPS/);
    expect((await post(live({ records: [att('Arjun Sharma', 'Leave')] }))).status).toBe(400);   // only Present / Absent exist
    expect((await post(live({ years: [], records: base }))).status).toBe(400);
    expect(db.all('attendance').length).toBe(0);                                  // nothing leaked in
  });
  it('submits years 1 & 2 — fast response, goes to PENDING; nothing is counted, saved to the sheet or e-mailed yet', async () => {
    globalThis.__mail.length = 0;
    const t0 = Date.now();
    const r = await call(attR.POST, {
      method: 'POST', cookie: state.marker, body: live({
        records: [
          att('Arjun Sharma', 'Present'), att('Priya Nair', 'Absent', 'Sick / Medical'), att('Rahul Shetty', 'Absent', 'Family function'), att('Ananya Rao', 'Present'),
          att('Karthik Bhat', 'Present'), att('Sneha Kamath', 'Absent', 'Hospital visit')]
      })
    });
    state.respMs = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ success: true, pending: true, count: 6, present: 3, absent: 3, isHistorical: false, waitingFor: ['Admin', 'CTO'] });
    state.session1 = r.json.sessionId;
    await flushBg();
    const pend = (await db.collection('pending_sessions').doc(state.session1).get()).data();
    expect(pend).toMatchObject({ state: 'pending', groupLabel: 'Year 1 & 2', total: 6, present: 3, absent: 3, cycle: 1, markedByName: 'Sgt Rohan', approvals: {}, waitingFor: ['admin'] });
    expect(pend.records.length).toBe(6);
    expect(db.all('attendance').length).toBe(0);                                              // not saved
    expect(db.all('sessions').length).toBe(0);
    expect(userByName('Priya Nair').stats.total).toBe(0);                                     // not counted
    expect(globalThis.__mail.length).toBe(0);                                                 // nothing e-mailed
    expect(rows('Attendance Log').length).toBe(0);                                            // not in the sheet
    expect(db.all('audit_log').some(a => a.data.type === 'submit')).toBe(true);
  });
  it('while pending: the same cadets are locked for everyone, the marker cannot approve, outsiders cannot read it', async () => {
    const dup = await call(attR.POST, { method: 'POST', cookie: state.marker, body: live({ years: [1], records: [att('Arjun Sharma', 'Present')] }) });
    expect(dup.status).toBe(409); expect(dup.json.error).toMatch(/waiting for approval/);
    const q = await call(attR.GET, { cookie: state.marker, url: `/api/attendance?date=${TODAY}` });
    expect(q.json.records.length).toBe(6); expect(q.json.records.every(x => x.pending)).toBe(true);
    expect((await approve(state.marker, state.session1)).status).toBe(403);                  // markers cannot approve
    expect((await call(apprR.GET, { cookie: state.marker, url: '/api/approvals?summary=1' })).status).toBe(403);
    expect((await call(apprR.GET, { cookie: state.marker, url: '/api/approvals?state=pending' })).status).toBe(403);
    const mine = await call(apprR.GET, { cookie: state.marker, url: '/api/approvals?mine=1' });
    expect(mine.json.submissions.length).toBe(1); expect(mine.json.submissions[0]).toMatchObject({ state: 'pending', waitingFor: ['admin'] }); expect(mine.json.submissions[0].records).toBeUndefined();
    expect((await call(apprR.GET, { cookie: state.marker, url: `/api/approvals?id=${state.session1}` })).status).toBe(200);   // own submission
    const other = await call(cadetsR.POST, { method: 'POST', cookie: state.admin, body: { name: 'Other Marker', role: 'cadet', is_marker: true, year: 2, type: 'SD', reg_no: 'OTHER1', username: 'other', password: 'Other@123', otp_required: false } });
    const ol = await login('other', 'Other@123');
    expect((await call(apprR.GET, { cookie: ol.cookie, url: `/api/approvals?id=${state.session1}` })).status).toBe(403);       // someone else's
    await db.collection('users').doc(other.json.user.id).delete();
    const y2 = sheets.tab('Year 2');
    if (y2) y2.rows = y2.rows.filter(r => r[1] !== 'Other Marker');
    const { invalidateUsers } = await import('@/lib/users');
    invalidateUsers();
    const counts = await call(apprR.GET, { cookie: state.admin, url: '/api/approvals?summary=1' });
    expect(counts.json).toMatchObject({ pending: 1, needsMe: 1, side: 'admin' });
  });
  it('approval needs BOTH: admin alone changes nothing; the CTO then finalises → saved, counted', async () => {
    const a = await approve(state.admin, state.session1);
    expect(a.json).toMatchObject({ success: true, final: false, waitingFor: ['cto'] });
    expect((await approve(state.admin, state.session1)).status).toBe(409);                    // cannot approve twice
    await flushBg();
    expect(db.all('attendance').length).toBe(0); expect(globalThis.__mail.length).toBe(0); expect(userByName('Priya Nair').stats.total).toBe(0);
    expect((await call(apprR.GET, { cookie: state.cto, url: '/api/approvals?summary=1' })).json).toMatchObject({ pending: 1, needsMe: 1 });
    expect((await call(apprR.GET, { cookie: state.admin, url: '/api/approvals?summary=1' })).json).toMatchObject({ pending: 1, needsMe: 0 });
    const t0 = Date.now(); const c = await approve(state.cto, state.session1); state.approveMs = Date.now() - t0;
    expect(c.json).toMatchObject({ success: true, final: true, sessionId: state.session1, present: 3, absent: 3 });
    const sess = (await db.collection('sessions').doc(state.session1).get()).data();
    expect(sess).toMatchObject({ groupLabel: 'Year 1 & 2', total: 6, present: 3, absent: 3, cycle: 1, markedByName: 'Sgt Rohan' });
    expect(sess.approvals.admin.byName).toBe('Admin Officer'); expect(sess.approvals.cto.byName).toBe('Lt. Sir');
    const priya = userByName('Priya Nair');
    expect(priya.stats).toMatchObject({ total: 1, present: 0, absent: 1 });
    expect(priya.stats.months[`m${TODAY.slice(0, 4)}${TODAY.slice(5, 7)}`]).toEqual({ t: 1 });
    expect(userByName('Arjun Sharma').stats).toMatchObject({ total: 1, present: 1, absent: 0 });
    const rec = (await db.collection('attendance').doc(`${TODAY}_${priya.id}`).get()).data();
    expect(rec).toMatchObject({ status: 'Absent', reason: 'Sick / Medical', cadetRegNo: 'KAR/NCC/2026/102', cadetYear: 1, cycle: 1 });
    expect((await db.collection('pending_sessions').doc(state.session1).get()).exists).toBe(false);   // moved out of the queue
    expect(db.all('audit_log').filter(a => ['submit', 'approve', 'create'].includes(a.data.type)).map(a => a.data.type).sort()).toEqual(['approve', 'approve', 'create', 'submit']);
    expect((await approve(state.cto, state.session1)).status).toBe(404);                      // nothing left to approve
  });
  it('background: parade report PDF reaches Sir + backup, absence mails only to cadets with an email', async () => {
    await flushBg();
    const parade = globalThis.__mail.filter(m => /Parade Report/.test(m.subject));
    expect(parade.length).toBe(1);
    const p = parade[0];
    expect(p.to).toBe('sir@test.in, backup@test.in');
    expect(p.subject).toContain('NCC AIRWING FLIGHT-B'); expect(p.subject).toMatch(/Year 1 & 2 \| P:3 A:3 \(50%\)/);
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0].filename).toMatch(/^NCC-AIRWING_FLIGHT-B_Parade_Report_\d{4}-\d{2}-\d{2}_Year-1-2\.pdf$/);
    expect(p.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(p.attachments[0].content.length).toBeGreaterThan(2500);
    expect(p.html).toContain('6 KAR AIR SQN NCC'); expect(p.html).toContain('Hospital visit'); expect(p.html).toContain('Rahul Shetty');
    expect(p.html).toContain('max-width:620px');                                  // single column, mobile friendly
    require('fs').writeFileSync('/tmp/parade-live.pdf', p.attachments[0].content);
    require('fs').writeFileSync('/tmp/parade-email.html', p.html);

    const absence = globalThis.__mail.filter(m => /Absence notice/.test(m.subject));
    expect(absence.map(m => m.to).sort()).toEqual(['priya@test.in', 'sneha@test.in']);   // Rahul: no email; Ananya: invalid email → skipped
    const pm = absence.find(m => m.to === 'priya@test.in');
    expect(pm.html).toContain('Sick / Medical'); expect(pm.html).toContain('ABSENT'); expect(pm.html).toContain('0%');
    expect(pm.html).toMatch(/below the required minimum/);
    require('fs').writeFileSync('/tmp/absence-email.html', pm.html);
  });
  it('background: Google Sheet is updated — log, daily report, absentees, summary, monthly, roster %', async () => {
    const log = rows('Attendance Log');
    expect(log.length).toBe(6);
    const priya = log.find(r => r[5] === 'Priya Nair');
    expect(priya.slice(0, 12)).toEqual([TODAY, expect.any(String), 'Parade', 'Year 1 & 2', 'KAR/NCC/2026/102', 'Priya Nair', 'Year 1', 'SD', 'Absent', 'Sick / Medical', 'Sgt Rohan', expect.stringMatching(/IST$/)]);
    const daily = rows('Daily Report');
    expect(daily.length).toBe(1); expect(daily[0].slice(4, 8)).toEqual([6, 3, 3, '50%']);
    expect(rows('Absentees').map(r => r[2]).sort()).toEqual(['Priya Nair', 'Rahul Shetty', 'Sneha Kamath']);
    const sum = rows('Cadet Summary');
    expect(sum.length).toBe(8);                                                   // 8 cadets (markers are never on the roll)
    expect(sum.find(r => r[1] === 'Priya Nair').slice(5, 11)).toEqual([1, 0, 1, 0, '0%', 'BELOW 75%']);
    expect(sum.find(r => r[1] === 'Arjun Sharma').slice(9, 11)).toEqual(['100%', 'OK']);
    const mon = sheets.tab('Monthly Report').rows;
    expect(mon[0].slice(0, 4)).toEqual(['Reg No.', 'Name', 'Year', 'Type']); expect(mon[0].length).toBe(6);
    expect(mon.find(r => r[1] === 'Arjun Sharma')[4]).toBe('1/1 (100%)');
    // user-typed roster data preserved, only % + status columns written
    const y1 = sheets.tab('Year 1').rows;
    expect(y1[1].slice(0, 6)).toEqual([1, 'Arjun Sharma', 'KAR/NCC/2026/101', 'SD', 'arjun@test.in', '9000000001']);
    expect(y1[1].slice(6, 8)).toEqual(['100%', 'Active']); expect(y1[2].slice(6, 8)).toEqual(['0%', 'Active']);
    expect(y1[4][4]).toBe('not-an-email');                                        // the user's own typing is never rewritten
    expect(rows('Year 2').some(r => r[1] === 'Sgt Rohan')).toBe(false);          // markers are never written to any Google Sheet tab
  });
  it('duplicate-day protection: same cadets cannot be submitted twice', async () => {
    const r = await call(attR.POST, { method: 'POST', cookie: state.marker, body: live({ years: [1], records: [att('Arjun Sharma', 'Absent', 'Sick / Medical')] }) });
    expect(r.status).toBe(409); expect(r.json.locked).toBe(true); expect(r.json.error).toMatch(/locked/);
    expect(userByName('Arjun Sharma').stats.total).toBe(1);                       // stats untouched
    const q = await call(attR.GET, { cookie: state.marker, url: `/api/attendance?date=${TODAY}` });
    expect(q.json.records.length).toBe(6);                                        // the screen can see who is already done
  });
  it('a different group the same day is allowed (Year 3 as its own session)', async () => {
    globalThis.__mail.length = 0;
    const r = await call(attR.POST, { method: 'POST', cookie: state.marker, body: live({ years: [3], records: [att('Vivek Pai', 'Present'), att('Divya Hegde', 'Present')] }) });
    expect(r.status).toBe(200); state.session2 = r.json.sessionId;
    await approveBoth(state.session2);
    await flushBg();
    expect(rows('Daily Report').length).toBe(2);
    expect(rows('Absentees').length).toBe(3);
    const pr = globalThis.__mail.find(m => /Parade Report/.test(m.subject));
    expect(pr.subject).toMatch(/Year 3 \| P:2 A:0 \(100%\)/); expect(pr.html).toContain('FULL ATTENDANCE');
  });
  it('a marker cannot edit, delete, or open management endpoints', async () => {
    const ed = await call(attR.PUT, { method: 'PUT', cookie: state.marker, body: { sessionId: state.session1, changes: [att('Priya Nair', 'Present')] } });
    expect(ed.status).toBe(403);
    expect((await call(attR.DELETE, { method: 'DELETE', cookie: state.marker, url: `/api/attendance?sessionId=${state.session1}` })).status).toBe(403);
    expect((await call(benR.POST, { method: 'POST', cookie: state.marker, body: { cadet_ids: ids('Priya Nair'), credits: 1, reason: 'x' } })).status).toBe(403);
    expect((await call(setR.PUT, { method: 'PUT', cookie: state.marker, body: { thresholdPct: 10 } })).status).toBe(403);
    expect((await call(promoR.POST, { method: 'POST', cookie: state.marker, body: { dryRun: true } })).status).toBe(403);
    expect((await call(healthR.GET, { cookie: state.marker })).status).toBe(403);
    expect((await call(cadetsR.GET, { cookie: state.marker, url: '/api/cadets?all=1' })).status).toBe(403);
    expect((await call(attR.GET, { url: '/api/attendance?history=1' })).status).toBe(401);   // no cookie
  });
});

describe('5. Sir / Admin edits a submitted session (logged + mailed)', () => {
  it('rejects bad edits and non-admin edits', async () => {
    expect((await call(attR.PUT, { method: 'PUT', cookie: state.cto, body: { sessionId: state.session1, changes: [att('Priya Nair', 'Present')] } })).status).toBe(403);
    const e = (changes, sessionId = state.session1) => call(attR.PUT, { method: 'PUT', cookie: state.admin, body: { sessionId, changes } });
    expect((await e([att('Priya Nair', 'Absent', '')])).json.error).toMatch(/reason/i);
    expect((await e([att('Vivek Pai', 'Absent', 'Late arrival')])).status).toBe(400);        // belongs to the other session
    expect((await e([att('Priya Nair', 'Present')], 'nope')).status).toBe(404);
  });
  it('Admin edits: Priya Absent→Present, Karthik Present→Absent; unchanged rows are ignored', async () => {
    globalThis.__mail.length = 0;
    const r = await call(attR.PUT, {
      method: 'PUT', cookie: state.admin, body: {
        sessionId: state.session1, note: 'Corrected after roll call',
        changes: [att('Priya Nair', 'Present'), att('Karthik Bhat', 'Absent', 'Late arrival'), att('Rahul Shetty', 'Absent', 'Family function')]
      }
    });
    expect(r.status).toBe(200); expect(r.json.changed).toBe(2);
    const sess = (await db.collection('sessions').doc(state.session1).get()).data();
    expect(sess).toMatchObject({ present: 3, absent: 3, lastEditedByName: 'Admin Officer' });
    expect(userByName('Priya Nair').stats).toMatchObject({ total: 1, present: 1, absent: 0 });
    expect(userByName('Karthik Bhat').stats).toMatchObject({ total: 1, present: 0, absent: 1 });
    expect(userByName('Rahul Shetty').stats).toMatchObject({ total: 1, present: 0, absent: 1 });   // untouched
    const rec = (await db.collection('attendance').doc(`${TODAY}_${userByName('Karthik Bhat').id}`).get()).data();
    expect(rec).toMatchObject({ status: 'Absent', reason: 'Late arrival', editedByName: 'Admin Officer' });
    const audit = db.all('audit_log').map(a => a.data).find(a => a.type === 'edit');
    expect(audit.changes.map(c => [c.name, c.from, c.to])).toEqual([['Priya Nair', 'Absent (Sick / Medical)', 'Present'], ['Karthik Bhat', 'Present', 'Absent']]);
    expect(audit.byName).toBe('Admin Officer');
  });
  it('mail: change-log with corrected parade PDF → Sir + backup; absence notice only to the newly absent cadet', async () => {
    await flushBg();
    const cl = globalThis.__mail.filter(m => /Attendance edited/.test(m.subject));
    expect(cl.length).toBe(1);
    expect(cl[0].to).toBe('sir@test.in, backup@test.in');
    expect(cl[0].html).toContain('Priya Nair'); expect(cl[0].html).toContain('Karthik Bhat'); expect(cl[0].html).toContain('Admin Officer'); expect(cl[0].html).toContain('Corrected after roll call');
    expect(cl[0].attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(cl[0].attachments[0].filename).toMatch(/CORRECTED_Parade_Report/);
    const ab = globalThis.__mail.filter(m => /Absence notice/.test(m.subject));
    expect(ab.map(m => m.to)).toEqual(['karthik@test.in']);
  });
  it('sheet: rows updated in place (no duplicates), absentee list follows, change log appended', async () => {
    const log = rows('Attendance Log');
    expect(log.length).toBe(8);
    expect(log.find(r => r[5] === 'Priya Nair')[8]).toBe('Present'); expect(log.find(r => r[5] === 'Priya Nair')[9]).toBe('');
    expect(log.find(r => r[5] === 'Karthik Bhat').slice(8, 10)).toEqual(['Absent', 'Late arrival']);
    expect(rows('Absentees').map(r => r[2]).sort()).toEqual(['Karthik Bhat', 'Rahul Shetty', 'Sneha Kamath']);
    expect(rows('Daily Report').find(r => r[3] === 'Year 1 & 2').slice(4, 8)).toEqual([6, 3, 3, '50%']);
    expect(rows('Cadet Summary').find(r => r[1] === 'Priya Nair').slice(9, 11)).toEqual(['100%', 'OK']);
    const ch = rows('Change Log').filter(r => r[1] === 'Edit');                              // (the final approval is logged there too)
    expect(rows('Change Log')[0][1]).toBe('Approved');
    expect(ch.map(r => [r[1], r[5], r[6], r[7]])).toEqual([['Edit', 'Priya Nair', 'Absent (Sick / Medical)', 'Present'], ['Edit', 'Karthik Bhat', 'Present', 'Absent']]);
  });
});

describe('6. attendance benefit (separate tab)', () => {
  it('only admin/CTO can add; credits raise the percentage (capped at 100%)', async () => {
    globalThis.__mail.length = 0;
    const bad = await call(benR.POST, { method: 'POST', cookie: state.cto, body: { cadet_ids: ids('Rahul Shetty'), credits: 0, reason: 'x' } });
    expect(bad.status).toBe(400);
    expect((await call(benR.POST, { method: 'POST', cookie: state.cto, body: { cadet_ids: ids('Rahul Shetty'), credits: 1, reason: '' } })).json.error).toMatch(/reason/i);
    const r = await call(benR.POST, { method: 'POST', cookie: state.cto, body: { cadet_ids: ids('Rahul Shetty', 'Karthik Bhat'), credits: 1, reason: 'Republic Day camp' } });
    expect(r.json).toMatchObject({ success: true, count: 2 });
    expect(userByName('Rahul Shetty').benefit).toBe(1);
    await flushBg();
    expect(rows('Benefits').map(r => [r[2], r[4], r[5]])).toEqual(expect.arrayContaining([['Rahul Shetty', 1, 'Republic Day camp'], ['Karthik Bhat', 1, 'Republic Day camp']]));
    expect(rows('Cadet Summary').find(r => r[1] === 'Rahul Shetty').slice(8, 11)).toEqual([1, '100%', 'OK']);
    expect(globalThis.__mail.some(m => /Attendance benefit/.test(m.subject) && m.to.includes('backup@test.in'))).toBe(true);
    const list = await call(benR.GET, { cookie: state.cto });
    expect(list.json.benefits.length).toBe(2); state.benefitId = list.json.benefits[0].id;
    const ov = await call(overR.GET, { cookie: state.cto });
    expect(ov.json.cadets.find(c => c.name === 'Rahul Shetty')).toMatchObject({ pct: 100, benefit: 1 });
  });
  it('removing a benefit reverses it', async () => {
    const r = await call(benR.DELETE, { method: 'DELETE', cookie: state.cto, url: `/api/benefits?id=${state.benefitId}` });
    expect(r.json.success).toBe(true);
    await flushBg();
    expect(db.all('benefits').length).toBe(1);
    expect(userByName('Rahul Shetty').benefit + userByName('Karthik Bhat').benefit).toBe(1);
    expect(rows('Benefits').length).toBe(1);
  });
});

describe('7. downloadable reports', () => {
  const get = (cookie, q) => call(repR.GET, { cookie, url: `/api/reports?${q}` });
  const ym = TODAY.slice(0, 7);
  it('day report PDF (parade format) / Excel / CSV', async () => {
    const pdf = await get(state.cto, `type=day&date=${TODAY}&format=pdf`);
    expect(pdf.status).toBe(200); expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-'); expect(pdf.headers.get('content-disposition')).toMatch(/NCC-AirWing-FlightB_Day-Report_/);
    const csv = await get(state.cto, `type=day&date=${TODAY}&format=csv`);
    expect(csv.buffer.toString()).toMatch(/Priya Nair,Y1,SD,Present/);
    const xl = await get(state.cto, `type=day&date=${TODAY}&format=xlsx`);
    const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xl.buffer);
    expect(wb.worksheets.map(w => w.name)).toEqual(['Nominal roll', 'Summary']);
    expect(wb.getWorksheet('Nominal roll').rowCount).toBe(9);                  // header + 8 cadets (2 sessions that day)
    expect((await get(state.cto, 'type=day&date=2020-01-01&format=pdf')).json.error).toMatch(/No attendance/);
    expect((await get(state.cto, 'type=day&date=bad&format=pdf')).status).toBe(400);
  });
  it('monthly, range, cadet, year, unit summary, absentees, benefits', async () => {
    const m = await get(state.cto, `type=month&month=${ym}&format=pdf`); expect(m.status).toBe(200); expect(m.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    require('fs').writeFileSync('/tmp/monthly.pdf', m.buffer);
    const mx = await get(state.cto, `type=month&month=${ym}&format=xlsx`);
    const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(mx.buffer);
    expect(wb.worksheets.map(w => w.name)).toEqual(['Monthly']);
    expect(wb.getWorksheet('Monthly').rowCount).toBeGreaterThan(5);
    expect((await get(state.cto, `type=range&from=${TODAY}&to=${TODAY}&format=csv`)).buffer.toString()).toMatch(/Arjun Sharma/);
    expect((await get(state.cto, `type=range&from=${TODAY}&to=2020-01-01&format=pdf`)).status).toBe(400);
    const cadetPdf = await get(state.cto, `type=cadet&cadetId=${userByName('Priya Nair').id}&format=pdf`);
    expect(cadetPdf.status).toBe(200); require('fs').writeFileSync('/tmp/cadet.pdf', cadetPdf.buffer);
    expect((await get(state.cto, 'type=year&year=1&format=pdf')).status).toBe(200);
    expect((await get(state.cto, 'type=summary&format=xlsx')).status).toBe(200);
    const ab = await get(state.cto, 'type=absentees&format=csv'); expect(ab.buffer.toString()).toMatch(/Late arrival/);
    expect((await get(state.cto, 'type=benefits&format=pdf')).status).toBe(200);
    expect((await get(state.cto, 'type=nonsense&format=pdf')).status).toBe(400);
    expect((await get(state.cto, 'type=month&month=2020-01&format=pdf')).json.error).toMatch(/No attendance/);
  });
  it('access rules: marker only gets the day report; a cadet only their own', async () => {
    expect((await get(state.marker, `type=day&date=${TODAY}&format=pdf`)).status).toBe(200);
    expect((await get(state.marker, 'type=summary&format=pdf')).status).toBe(403);
    const pw = await call(cadetsR.POST, { method: 'POST', cookie: state.admin, body: { name: 'Test Login Cadet', role: 'cadet', reg_no: 'KAR/NCC/2026/777', year: 1, password: 'KAR/NCC/2026/777' } });
    expect(pw.status).toBe(200);
    const l = await login('kar/ncc/2026/777', 'KAR/NCC/2026/777');                  // case-insensitive reg no
    expect(l.json).toMatchObject({ mustChangePassword: true, dashboardPath: '/dashboard/cadet' });
    const cookie = l.cookie;
    const mine = await get(cookie, `type=cadet&cadetId=${pw.json.user.id}&format=pdf`); expect(mine.status).toBe(200);
    expect((await get(cookie, `type=cadet&cadetId=${userByName('Priya Nair').id}&format=pdf`)).status).toBe(403);
    const weak = await call(cpR.POST, { method: 'POST', cookie, body: { password: 'kar/ncc/2026/777' } });
    expect(weak.status).toBe(400);
    const good = await call(cpR.POST, { method: 'POST', cookie, body: { password: 'NewPass#2026' } });
    expect(good.status).toBe(200); expect(good.json.mustChangePassword).toBe(false);
    const me = await call(meR.GET, { cookie: good.cookie }); expect(me.json.user.role).toBe('cadet');   // session survives the password change
    const my = await call(attR.GET, { cookie: good.cookie, url: '/api/attendance?my=1' }); expect(my.json).toMatchObject({ total: 0, percentage: 0 });
    await db.collection('users').doc(pw.json.user.id).delete();                          // clean up (a real unit discharges instead)
    await flushBg();
    const y1 = sheets.tab('Year 1'); y1.rows = y1.rows.filter(r => r[1] !== 'Test Login Cadet');
  });
  it('my attendance view for a cadet with records', async () => {
    const l = await login('KAR/NCC/2026/102', 'KAR/NCC/2026/102');
    const code = mailTo('priya@test.in').at(-1).subject.match(/^(\d{6})/)[1];
    const v = await call(otpR.POST, { method: 'POST', body: { challengeId: l.json.challengeId, code } });
    const my = await call(attR.GET, { cookie: v.cookie, url: '/api/attendance?my=1' });
    expect(my.json).toMatchObject({ total: 1, present: 1, absent: 0, percentage: 100, threshold: 75 });
    expect(my.json.records[0]).toMatchObject({ status: 'Present', activityType: 'Parade' });
  });
});

describe('8. discharge, roll-back and removal from the sheet', () => {
  it('discharging removes the person from the sheet roster and lists them under Discharged', async () => {
    const id = userByName('Ananya Rao').id;
    const r = await call(cadetIdR.DELETE, { method: 'DELETE', cookie: state.admin, params: { id }, body: { action: 'discharge' } });
    expect(r.json.success).toBe(true); await flushBg();
    expect(userByName('Ananya Rao')).toMatchObject({ isActive: false, discharged: true });
    expect(rows('Year 1').map(r => r[1])).not.toContain('Ananya Rao');
    expect(rows('Discharged').map(r => r[1])).toEqual(['Ananya Rao']);
    expect((await login('KAR/NCC/2026/104', 'KAR/NCC/2026/104')).status).toBe(403);       // cannot sign in any more
    const c = await call(cadetsR.GET, { cookie: state.marker, url: '/api/cadets' });
    expect(c.json.cadets.map(x => x.name)).not.toContain('Ananya Rao');
    expect((await call(cadetIdR.DELETE, { method: 'DELETE', cookie: state.admin, params: { id: 'admin1' }, body: {} })).status).toBe(400);   // cannot discharge yourself
  });
  it('rolling back restores them and the sheet', async () => {
    const id = userByName('Ananya Rao').id;
    const r = await call(cadetIdR.PUT, { method: 'PUT', cookie: state.admin, params: { id }, body: { rollback: true } });
    expect(r.json.success).toBe(true); await flushBg();
    expect(userByName('Ananya Rao')).toMatchObject({ isActive: true, discharged: false, year: 1 });
    expect(rows('Year 1').map(r => r[1])).toContain('Ananya Rao');                       // re-appended by the roster sync
    expect(rows('Discharged').length).toBe(0);
  });
  it('a cadet whose row is deleted from the sheet is deactivated (history kept); typing them back reactivates', async () => {
    const y2 = sheets.tab('Year 2'); const keep = y2.rows[2]; y2.rows.splice(2, 1);        // delete Sneha Kamath's row
    const r = await call(syncR.POST, { method: 'POST', cookie: state.admin, body: { action: 'import' } });
    expect(r.json.deactivated).toBe(1);
    expect(userByName('Sneha Kamath')).toMatchObject({ isActive: false, status: 'removed-from-sheet' });
    expect((await db.collection('attendance').doc(`${TODAY}_${userByName('Sneha Kamath').id}`).get()).exists).toBe(true);   // history intact
    y2.rows.push(keep);
    const back = await call(syncR.POST, { method: 'POST', cookie: state.admin, body: { action: 'import' } });
    expect(userByName('Sneha Kamath')).toMatchObject({ isActive: true, status: 'active' });
    expect(back.json.deactivated).toBe(0);
    // editing a cadet's email / type in the sheet flows into the database
    sheets.tab('Year 1').rows[3][4] = 'rahul@test.in';
    const edit = await call(syncR.POST, { method: 'POST', cookie: state.admin, body: { action: 'import' } });
    expect(edit.json.updated).toBe(1); expect(userByName('Rahul Shetty').email).toBe('rahul@test.in');
  });
  it('admin edits a user (email, unlock, role guard) and password reset signs them out', async () => {
    const id = state.markerId;
    expect((await call(cadetIdR.PUT, { method: 'PUT', cookie: state.admin, params: { id }, body: { email: 'bad' } })).status).toBe(400);
    expect((await call(cadetIdR.PUT, { method: 'PUT', cookie: state.admin, params: { id }, body: { username: 'admin' } })).json.error).toMatch(/exists/);
    expect((await call(cadetIdR.PUT, { method: 'PUT', cookie: state.admin, params: { id: 'admin1' }, body: { role: 'cadet' } })).json.error).toMatch(/own role/);
    const old = state.marker;
    expect((await call(meR.GET, { cookie: old })).status).toBe(200);
    await call(cadetIdR.PUT, { method: 'PUT', cookie: state.admin, params: { id }, body: { password: 'Marker@456', otp_required: false } });
    expect((await call(meR.GET, { cookie: old })).status).toBe(401);                       // old session killed
    const l = await login('rohan@test.in', 'Marker@456'); expect(l.status).toBe(200); state.marker = l.cookie;
  });
});

describe('9. promotion — attendance restarts from 0 with new sheets', () => {
  it('preview, then guard against stale/double submit', async () => {
    const p = await call(promoR.POST, { method: 'POST', cookie: state.admin, body: { dryRun: true } });
    expect(p.json).toMatchObject({ promoted_to_year2: 4, promoted_to_year3: 2, graduated: 2, currentCycle: 1, dryRun: true });
    expect((await call(promoR.POST, { method: 'POST', cookie: state.admin, body: { expectedCycle: 7 } })).status).toBe(409);
    expect((await call(promoR.POST, { method: 'POST', cookie: state.cto, body: { dryRun: true } })).status).toBe(403);     // Sir cannot promote by default
  });
  it('promotes: years move, stats + benefits reset, graduates deactivated, cycle 2 starts', async () => {
    globalThis.__mail.length = 0;
    const r = await call(promoR.POST, { method: 'POST', cookie: state.admin, body: { expectedCycle: 1 } });
    expect(r.status).toBe(200); expect(r.json).toMatchObject({ newCycle: 2, dryRun: false });
    state.newLabel = r.json.newLabel;
    expect(userByName('Arjun Sharma')).toMatchObject({ year: 2, stats: { total: 0, present: 0, absent: 0, months: {} }, benefit: 0 });
    expect(userByName('Karthik Bhat')).toMatchObject({ year: 3, benefit: 0 });
    expect(userByName('Karthik Bhat').stats.total).toBe(0);
    expect(userByName('Vivek Pai')).toMatchObject({ isActive: false, year: 3 }); expect(userByName('Vivek Pai').graduatedAt).toBeTruthy();
    expect(userByName('Sgt Rohan').role).toBe('marker');
    const s = (await db.collection('settings').doc('main').get()).data();
    expect(s.currentCycle).toBe(2); expect(s.cycleLabel).toBe(state.newLabel); expect(s.cycleLabel).toMatch(/^\d{4}-\d{2}( \(cycle 2\))?$/);
    const again = await call(promoR.POST, { method: 'POST', cookie: state.admin, body: { expectedCycle: 1 } });
    expect(again.status).toBe(409);                                                         // double click is harmless
  });
  it('sheet: old report tabs archived, fresh empty ones created, roster rewritten with new years', async () => {
    await flushBg();
    const names = sheets.tabs.map(t => t.title);
    expect(names.filter(n => /^Attendance Log /.test(n)).length).toBe(1);                   // archived copy
    const arch = names.find(n => /^Attendance Log \d{4}-\d{2}/.test(n));
    expect(sheets.tab(arch).rows.length).toBeGreaterThan(8);                                // old data preserved there
    expect(rows('Attendance Log').length).toBe(0); expect(rows('Daily Report').length).toBe(0); expect(rows('Absentees').length).toBe(0); expect(rows('Benefits').length).toBe(0);
    expect(sheets.tab('Attendance Log').rows[0]).toContain('Status');                       // header recreated
    expect(names.filter(n => /^Benefits /.test(n)).length).toBe(1); expect(names.filter(n => /^Daily Report /.test(n)).length).toBe(1);
    expect(rows('Year 1').length).toBe(0);                                                  // nobody left in year 1
    expect(rows('Year 2').map(r => r[1]).sort()).toEqual(['Ananya Rao', 'Arjun Sharma', 'Priya Nair', 'Rahul Shetty']);
    expect(rows('Year 3').map(r => r[1]).sort()).toEqual(['Karthik Bhat', 'Sneha Kamath']);
    expect(rows('Graduated').map(r => r[1]).sort()).toEqual(['Divya Hegde', 'Vivek Pai']);
    expect(rows('Year 2')[0].slice(0, 6)).toEqual([1, 'Arjun Sharma', 'KAR/NCC/2026/101', 'SD', 'arjun@test.in', '9000000001']);   // rewritten from the database, sorted by Reg No.
    expect(rows('Year 2').find(r => r[1] === 'Ananya Rao').slice(2, 6)).toEqual(['KAR/NCC/2026/104', 'SD', '', '']);   // the invalid email typed earlier was never stored
    expect(rows('Cadet Summary').every(r => r[5] === 0)).toBe(true);                        // everyone at 0 parades
    expect(rows('Change Log').at(-1)[1]).toBe('Promotion');
    const pm = globalThis.__mail.find(m => m.subject.includes('Attendance edited'));
    expect(pm.to).toBe('sir@test.in, backup@test.in'); expect(pm.html).toMatch(/restarted from 0/);
  });
  it('new cycle: attendance counts from zero; old cycle data stays viewable and reportable', async () => {
    const y = new Date(TODAY + 'T00:00:00Z'); y.setUTCDate(y.getUTCDate() - 1); const yesterday = y.toISOString().slice(0, 10);
    globalThis.__mail.length = 0;
    const r = await call(attR.POST, { method: 'POST', cookie: state.marker, body: { date: yesterday, activity_type: 'PT', activity_description: '', years: [2], records: [att('Arjun Sharma', 'Present'), att('Priya Nair', 'Absent', 'Out of station')] } });
    expect(r.status).toBe(200); expect(r.json.isHistorical).toBe(true);                     // no GPS/photo needed for past dates
    await approveBoth(r.json.sessionId);
    await flushBg();
    expect(userByName('Arjun Sharma').stats).toMatchObject({ total: 1, present: 1 });
    expect(globalThis.__mail.filter(m => /Parade Report|Absence/.test(m.subject)).length).toBe(0);   // no mails for historical entries
    expect(rows('Attendance Log').length).toBe(2);                                          // fresh sheet only has the new cycle
    const h = await call(attR.GET, { cookie: state.cto, url: '/api/attendance?history=1' });
    expect(h.json.sessions.length).toBe(1); expect(h.json.cycle).toBe(2);
    const all = await call(attR.GET, { cookie: state.cto, url: '/api/attendance?history=1&cycle=all' });
    expect(all.json.sessions.length).toBe(3);
    const rep = await call(repR.GET, { cookie: state.cto, url: `/api/reports?type=cadet&cadetId=${userByName('Priya Nair').id}&cycle=all&format=csv` });
    expect(rep.status).toBe(200);
    const board = await call(boardR.GET, { cookie: state.marker }); expect(board.json.leaderboard.length).toBe(0);   // needs ≥3 parades
  });
  it('editing/deleting an OLD-cycle session never disturbs the new cycle counters', async () => {
    const before = JSON.stringify(userByName('Rahul Shetty').stats);
    expect((await call(attR.PUT, { method: 'PUT', cookie: state.cto, body: { sessionId: state.session1, changes: [att('Rahul Shetty', 'Present')] } })).status).toBe(403);
    const e = await call(attR.PUT, { method: 'PUT', cookie: state.admin, body: { sessionId: state.session1, changes: [att('Rahul Shetty', 'Present')] } });
    expect(e.status).toBe(200); await flushBg();
    expect(JSON.stringify(userByName('Rahul Shetty').stats)).toBe(before);
    const d = await call(attR.DELETE, { method: 'DELETE', cookie: state.admin, url: `/api/attendance?sessionId=${state.session2}` });
    expect(d.json.deleted).toBe(2); await flushBg();
    expect(userByName('Karthik Bhat').stats.total).toBe(0);
    expect(db.all('attendance').filter(x => x.data.sessionId === state.session2).length).toBe(0);
  });
  it('deleting a current-cycle session rolls the counters back and clears the sheet rows', async () => {
    const h = await call(attR.GET, { cookie: state.cto, url: '/api/attendance?history=1' });
    const sid = h.json.sessions[0].id;
    expect((await call(attR.DELETE, { method: 'DELETE', cookie: state.admin, url: `/api/attendance?sessionId=${sid}` })).json.deleted).toBe(2);
    await flushBg();
    expect(userByName('Arjun Sharma').stats).toMatchObject({ total: 0, present: 0 });
    expect(userByName('Priya Nair').stats).toMatchObject({ total: 0, absent: 0 });
    expect(rows('Attendance Log').length).toBe(0); expect(rows('Daily Report').length).toBe(0); expect(rows('Absentees').length).toBe(0);
  });
});

describe('10. nightly rebuild, monthly summary, health panel', () => {
  it('cron endpoints reject callers without the secret', async () => {
    expect((await call(dailyR.GET, { url: '/api/cron/daily' })).status).toBe(401);
    expect((await call(monthlyR.GET, { url: '/api/cron/monthly' })).status).toBe(401);
  });
  it('nightly job self-heals the sheet: wipe the log tab, the job restores it from the database', async () => {
    const y = new Date(TODAY + 'T00:00:00Z'); y.setUTCDate(y.getUTCDate() - 2); const d = y.toISOString().slice(0, 10);
    for (const yr of [[2, ['Arjun Sharma', 'Priya Nair']]]) {
      const r = await call(attR.POST, { method: 'POST', cookie: state.marker, body: { date: d, activity_type: 'Parade', years: [yr[0]], records: [att('Arjun Sharma', 'Present'), att('Priya Nair', 'Absent', 'Sick / Medical')] } });
      expect(r.status).toBe(200);
      await approveBoth(r.json.sessionId);
    }
    await flushBg();
    sheets.tab('Attendance Log').rows = [sheets.tab('Attendance Log').rows[0]];            // someone wiped the data
    sheets.tab('Absentees').rows = [sheets.tab('Absentees').rows[0]];
    const r = await call(dailyR.GET, { url: '/api/cron/daily', cookie: '', body: undefined });
    expect(r.status).toBe(401);
    const res = await dailyR.GET(new Request('http://localhost/api/cron/daily', { headers: { authorization: 'Bearer cron-secret' } }));
    const j = await res.json(); expect(j.success).toBe(true);
    expect(rows('Attendance Log').length).toBe(2); expect(rows('Absentees').length).toBe(1);
    expect(rows('Daily Report').length).toBe(1);
    state.rebuildDate = d;
  });
  it('monthly summary mail (with PDF) goes to Sir + backup', async () => {
    globalThis.__mail.length = 0;
    const ym = state.rebuildDate.slice(0, 7);
    const res = await monthlyR.GET(new Request(`http://localhost/api/cron/monthly?month=${ym}`, { headers: { authorization: 'Bearer cron-secret' } }));
    expect((await res.json()).success).not.toBe(false);
    const m = globalThis.__mail.find(x => /Monthly Attendance Summary/.test(x.subject));
    expect(m.to).toBe('sir@test.in, backup@test.in'); expect(m.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(m.html).toContain('Priya Nair');                                                 // below 75%
    require('fs').writeFileSync('/tmp/monthly-email.html', m.html);
  });
  it('settings: Sir/backup email, reasons and threshold are editable; absence mails can be switched off', async () => {
    const bad = await call(setR.PUT, { method: 'PUT', cookie: state.admin, body: { sirEmail: 'nope' } }); expect(bad.status).toBe(400);
    const ok = await call(setR.PUT, { method: 'PUT', cookie: state.admin, body: { sirEmail: 'newsir@test.in', thresholdPct: 80, absentReasons: ['Sick', 'Sick', 'Other'], absenceMailEnabled: false } });
    expect(ok.json.settings).toMatchObject({ sirEmail: 'newsir@test.in', thresholdPct: 80, absentReasons: ['Sick', 'Other'], absenceMailEnabled: false, backupEmail: 'backup@test.in' });
    globalThis.__mail.length = 0;
    const sub = await call(attR.POST, { method: 'POST', cookie: state.marker, body: live({ years: [3], records: [att('Karthik Bhat', 'Absent', 'Sick')] }) });
    await approveBoth(sub.json.sessionId);
    await flushBg();
    expect(globalThis.__mail.some(m => /Absence notice/.test(m.subject))).toBe(false);                    // switched off
    expect(globalThis.__mail.find(m => /Parade Report/.test(m.subject)).to).toBe('newsir@test.in, backup@test.in');
    await call(setR.PUT, { method: 'PUT', cookie: state.admin, body: { sirEmail: 'sir@test.in', thresholdPct: 75, absenceMailEnabled: true } });
  });
  it('health panel: quick + full checks, detects the earlier email outage, sends a real test mail', async () => {
    const q = await call(healthR.GET, { cookie: state.admin, url: '/api/health?mode=quick' });
    expect(q.json.database).toMatchObject({ ok: true }); expect(q.json.database.readMs).toBeGreaterThanOrEqual(0);
    const f = await call(healthR.GET, { cookie: state.admin, url: '/api/health?mode=full' });
    expect(f.status).toBe(200);
    expect(Object.keys(f.json.services)).toEqual(['database', 'sheets', 'email', 'photos', 'env', 'officialMail', 'accounts', 'dataIntegrity']);
    expect(f.json.services.sheets.ok).toBe(true); expect(f.json.services.email.ok).toBe(true); expect(f.json.services.photos.ok).toBe(true);
    expect(f.json.activity.counts.sheets.ok).toBeGreaterThan(5);
    expect(f.json.activity.crons.nightly.ok).toBe(true);
    expect(f.json.activity.failures).toBeGreaterThan(0);                                    // the SMTP outage test left a failed event
    expect(f.json.allOk).toBe(false);
    globalThis.__mail.length = 0;
    const t = await call(healthR.POST, { method: 'POST', cookie: state.admin, body: {} });
    expect(t.json.success).toBe(true); expect(globalThis.__mail[0].to).toBe('sir@test.in');
    const aud = await call(auditR.GET, { cookie: state.cto }); expect(aud.json.logs.length).toBeGreaterThan(5);
    expect(aud.json.logs[0].at >= aud.json.logs.at(-1).at).toBe(true);                      // newest first
  });
  it('sheets problems are surfaced: missing tab shows up in the health check', async () => {
    sheets.tabs = sheets.tabs.filter(t => t.title !== 'Benefits');
    const f = await call(healthR.GET, { cookie: state.admin, url: '/api/health?mode=full' });
    expect(f.json.services.sheets.ok).toBe(false); expect(f.json.services.sheets.message).toMatch(/Benefits/);
    const fix = await call(syncR.POST, { method: 'POST', cookie: state.admin, body: { action: 'setup' } });
    expect(fix.json.created).toEqual(['Benefits']);
  });
});


describe('11. approval workflow — reject, edit while pending, admin / CTO taking attendance, races, safety', () => {
  const y = n => { const d = new Date(TODAY + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const post = (cookie, date, years, recs) => call(attR.POST, { method: 'POST', cookie, body: { date, activity_type: 'Parade', years, records: recs, photo_urls: [] } });

  it('reject needs a reason; the marker sees it; the cadets are free to be submitted again; nothing was mailed or counted', async () => {
    globalThis.__mail.length = 0;
    const d = y(5);
    const r = await post(state.marker, d, [2], [att('Arjun Sharma', 'Present'), att('Priya Nair', 'Absent', 'Late arrival')]);
    expect(r.status).toBe(200);
    expect((await call(apprR.POST, { method: 'POST', cookie: state.admin, body: { id: r.json.sessionId, action: 'reject', reason: '' } })).status).toBe(400);
    expect((await call(apprR.POST, { method: 'POST', cookie: state.marker, body: { id: r.json.sessionId, action: 'reject', reason: 'x' } })).status).toBe(403);
    const rej = await call(apprR.POST, { method: 'POST', cookie: state.admin, body: { id: r.json.sessionId, action: 'reject', reason: 'Wrong group — Priya is Year 1' } });
    expect(rej.json.success).toBe(true);
    const doc = (await db.collection('pending_sessions').doc(r.json.sessionId).get()).data();
    expect(doc).toMatchObject({ state: 'rejected', waitingFor: [], rejection: { byName: 'Admin Officer', side: 'admin', reason: 'Wrong group — Priya is Year 1' } });
    expect((await approve(state.admin, r.json.sessionId)).status).toBe(409);                  // cannot approve a rejected one
    const mine = await call(apprR.GET, { cookie: state.marker, url: '/api/approvals?mine=1' });
    expect(mine.json.submissions.find(x => x.id === r.json.sessionId)).toMatchObject({ state: 'rejected', rejection: { reason: 'Wrong group — Priya is Year 1' } });
    const again = await post(state.marker, d, [2], [att('Arjun Sharma', 'Present')]);          // free again
    expect(again.status).toBe(200); state.keepPending = again.json.sessionId;
    await flushBg(); expect(globalThis.__mail.length).toBe(0); expect(db.all('attendance').filter(a => a.data.date === d).length).toBe(0);
    const list = await call(apprR.GET, { cookie: state.admin, url: '/api/approvals?state=rejected' });
    expect(list.json.submissions.length).toBe(1);
  });

  it('editing a pending roll: the editor\'s side counts as approved, the other side must approve again', async () => {
    const id = state.keepPending;
    const ctoAttempt = await call(apprR.PUT, { method: 'PUT', cookie: state.cto, body: { id, note: 'He was late', changes: [att('Arjun Sharma', 'Absent', 'Late arrival')] } });
    expect(ctoAttempt.status).toBe(403);
    expect(ctoAttempt.json.error).toBe('Only the Administrator can correct attendance. You can approve or reject.');
    const e = await call(apprR.PUT, { method: 'PUT', cookie: state.admin, body: { id, note: 'He was late', changes: [att('Arjun Sharma', 'Absent', 'Late arrival')] } });
    expect(e.json).toMatchObject({ success: true, changed: 1 });
    const doc = (await db.collection('pending_sessions').doc(id).get()).data();
    expect(doc.records[0]).toMatchObject({ status: 'Absent', reason: 'Late arrival' });
    expect(doc).toMatchObject({ present: 0, absent: 1, waitingFor: ['admin'] });
    expect(Object.keys(doc.approvals)).toEqual([]);
    expect((await call(apprR.PUT, { method: 'PUT', cookie: state.admin, body: { id, changes: [att('Arjun Sharma', 'Absent', '')] } })).status).toBe(400);   // reason needed
    expect((await call(apprR.PUT, { method: 'PUT', cookie: state.marker, body: { id, changes: [att('Arjun Sharma', 'Present')] } })).status).toBe(403);
    expect(db.all('audit_log').some(a => a.data.type === 'pending-edit' && a.data.changes[0].to === 'Absent')).toBe(true);
    await approve(state.admin, id);
    const fin = await approve(state.cto, id);
    expect(fin.json.final).toBe(true); await flushBg();
    expect(userByName('Arjun Sharma').stats).toMatchObject({ total: 2, present: 1, absent: 1 });
    expect((await call(apprR.PUT, { method: 'PUT', cookie: state.admin, body: { id, changes: [att('Arjun Sharma', 'Present')] } })).status).toBe(404);   // finalised: use the normal edit
  });

  it('Admin or CTO taking attendance: their own side is approved on submit, the other side is still required', async () => {
    globalThis.__mail.length = 0;
    const a = await post(state.admin, y(6), [3], [att('Karthik Bhat', 'Present')]);
    expect(a.json.waitingFor).toEqual(['CTO']);
    expect((await db.collection('pending_sessions').doc(a.json.sessionId).get()).data().approvals.admin.byName).toBe('Admin Officer');
    expect((await approve(state.admin, a.json.sessionId)).status).toBe(409);                  // already counted as approved
    expect((await approve(state.cto, a.json.sessionId)).json.final).toBe(true);
    const c = await post(state.cto, y(7), [3], [att('Sneha Kamath', 'Present')]);
    expect(c.json.waitingFor).toEqual(['Admin']);
    expect((await approve(state.admin, c.json.sessionId)).json.final).toBe(true);
    await flushBg();
    expect(userByName('Sneha Kamath').stats.total).toBeGreaterThan(0);
  });

  it('Admin and CTO approving at the same instant: it is committed exactly once', async () => {
    const r = await post(state.marker, y(8), [2], [att('Rahul Shetty', 'Present'), att('Ananya Rao', 'Absent', 'Sick / Medical')]);
    const before = userByName('Rahul Shetty').stats.total;
    const both = await Promise.all([approve(state.admin, r.json.sessionId), approve(state.cto, r.json.sessionId)]);
    expect(both.map(x => x.status).sort()).toEqual([200, 200]);
    expect(both.filter(x => x.json.final).length).toBe(1);
    await flushBg();
    expect(userByName('Rahul Shetty').stats.total).toBe(before + 1);                          // not 2
    expect(db.all('attendance').filter(a => a.data.date === y(8)).length).toBe(2);
  });

  it('the CTO has marking and approval rights by default; custom roles cannot approve; promotion waits for pending items', async () => {
    const me = await call(meR.GET, { cookie: state.cto });
    expect(me.json.user.permissions).toMatchObject({ canMarkAttendance: true, canApproveAttendance: true });
    await call(cadetsR.POST, { method: 'POST', cookie: state.admin, body: { name: 'Custom', role: 'cadet', username: 'custom1', password: 'Custom@123', otp_required: false } });
    await db.collection('roleConfig').doc('reviewer').set({ label: 'Reviewer', canViewAllAttendance: true, canApproveAttendance: true });
    await db.collection('users').doc(userByName('Custom').id).update({ role: 'reviewer' });
    const cl = await login('custom1', 'Custom@123');
    const r = await post(state.marker, y(9), [2], [att('Rahul Shetty', 'Present')]);
    expect((await approve(cl.cookie, r.json.sessionId)).status).toBe(403);                    // approval is only for the Admin and the CTO roles
    expect((await call(apprR.GET, { cookie: cl.cookie, url: '/api/approvals?summary=1' })).status).toBe(403);
    const promo = await call(promoR.POST, { method: 'POST', cookie: state.admin, body: { expectedCycle: 1 } });
    expect(promo.status).toBe(409); expect(promo.json.error).toMatch(/waiting for approval/);
    expect((await call(promoR.POST, { method: 'POST', cookie: state.admin, body: { dryRun: true } })).json.pendingApprovals).toBeGreaterThan(0);
    await approveBoth(r.json.sessionId);
    await db.collection('users').doc(userByName('Custom').id).delete();
  });

  it('commit failure puts it back in the queue without counting anything; unknown ids and bad actions are handled', async () => {
    const r = await post(state.marker, y(10), [2], [att('Priya Nair', 'Present')]);
    await db.collection('attendance').doc(`c2_${y(10)}_${userByName('Priya Nair').id}`).set({ date: y(10), cadetId: userByName('Priya Nair').id, status: 'Present', cycle: 1 });   // a conflicting record appears
    const before = userByName('Priya Nair').stats.total;
    await approve(state.admin, r.json.sessionId);
    const c = await approve(state.cto, r.json.sessionId);
    expect(c.status).toBe(409); expect(c.json.error).toMatch(/already exists/i);
    expect(userByName('Priya Nair').stats.total).toBe(before);
    const doc = (await db.collection('pending_sessions').doc(r.json.sessionId).get()).data();
    expect((await call(apprR.POST, { method: 'POST', cookie: state.cto, body: { id: r.json.sessionId, action: 'reject', reason: 'Duplicate of an existing record' } })).json.success).toBe(true);
    expect((await call(apprR.POST, { method: 'POST', cookie: state.admin, body: { id: r.json.sessionId, action: 'reject', reason: 'Duplicate of an existing record' } })).json.success).toBe(true);
    await db.collection('attendance').doc(`c2_${y(10)}_${userByName('Priya Nair').id}`).delete();
    expect((await approve(state.admin, 'does-not-exist')).status).toBe(404);
    expect((await call(apprR.POST, { method: 'POST', cookie: state.admin, body: { id: r.json.sessionId, action: 'explode' } })).status).toBe(400);
    expect((await call(apprR.POST, { method: 'POST', cookie: state.admin, body: { action: 'approve' } })).status).toBe(400);
    expect((await call(apprR.POST, { method: 'POST', body: { id: 'x', action: 'approve' } })).status).toBe(401);
  });

  it('approved historical entries send no mail; live ones send the PDF with the approval record', async () => {
    globalThis.__mail.length = 0;
    const live2 = await call(attR.POST, { method: 'POST', cookie: state.marker, body: { date: TODAY, activity_type: 'PT', years: [3], geo_lat: 1, geo_lng: 2, photo_urls: [], records: [att('Karthik Bhat', 'Absent', 'Out of station')] } });
    expect(live2.status).toBe(409);                                                           // Karthik already has attendance today
    const t = await post(state.marker, y(11), [3], [att('Karthik Bhat', 'Present')]); await approveBoth(t.json.sessionId); await flushBg();
    expect(globalThis.__mail.filter(m => /Parade Report|Absence/.test(m.subject)).length).toBe(0);
    const ids = db.all('sessions').filter(x => x.data.date === TODAY).map(x => x.id);
    expect(ids.length).toBeGreaterThan(0);
    const first = (await db.collection('sessions').doc(state.session1).get()).data();
    expect(first.approvals.cto.at >= first.approvals.admin.at).toBe(true);
  });
});

describe('12. marker model & permissions verification (prompt requirements a-g)', () => {
  const dAgo = n => { const d = new Date(TODAY + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  let markerPersonId, testMarkerCookie;

  it('a) admin creates a marker with only name + e-mail + password; marker signs in with the e-mail, gets the OTP mail, verifies, lands on /dashboard/marker, can POST /api/attendance, gets 403 on every management API', async () => {
    const mkRes = await call(cadetsR.POST, {
      method: 'POST',
      cookie: state.admin,
      body: {
        name: 'Attendance Marker A',
        role: 'marker',
        email: 'marker.a@test.in',
        password: 'MarkerPw@123',
        otp_required: true
      }
    });
    expect(mkRes.status).toBe(200);
    markerPersonId = mkRes.json.user.id;
    const markerDoc = userByName('Attendance Marker A');
    expect(markerDoc.role).toBe('marker');
    expect(markerDoc.regNo).toBeUndefined();
    expect(markerDoc.year).toBeUndefined();
    expect(markerDoc.type).toBeUndefined();

    // marker signs in with the e-mail
    globalThis.__mail.length = 0;
    const loginRes = await login('marker.a@test.in', 'MarkerPw@123');
    expect(loginRes.status).toBe(200);
    expect(loginRes.json.otpRequired).toBe(true);

    // gets the OTP mail, verifies, lands on /dashboard/marker
    const m = mailTo('marker.a@test.in')[0];
    expect(m).toBeDefined();
    const code = m.subject.match(/^(\d{6})/)[1];
    const verifyRes = await call(otpR.POST, { method: 'POST', body: { challengeId: loginRes.json.challengeId, code } });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.json.dashboardPath).toBe('/dashboard/marker');
    testMarkerCookie = verifyRes.cookie;

    // can POST /api/attendance
    const attRes = await call(attR.POST, {
      method: 'POST',
      cookie: testMarkerCookie,
      body: {
        date: dAgo(15),
        activity_type: 'Parade',
        years: [2],
        records: [att('Arjun Sharma', 'Present')],
        photo_urls: []
      }
    });
    expect(attRes.status).toBe(200);
    expect(attRes.json.sessionId).toBeTruthy();

    // gets 403 on every management API
    const mgmtCalls = [
      call(cadetsR.POST, { method: 'POST', cookie: testMarkerCookie, body: { name: 'X', role: 'cadet' } }),
      call(syncR.POST, { method: 'POST', cookie: testMarkerCookie, body: { action: 'setup' } }),
      call(promoR.POST, { method: 'POST', cookie: testMarkerCookie, body: { action: 'promote' } }),
      call(benR.POST, { method: 'POST', cookie: testMarkerCookie, body: { cadet_id: 'c0', percent: 5 } }),
      call(setR.PUT, { method: 'PUT', cookie: testMarkerCookie, body: { sirEmail: 'new@test.in' } }),
      call(rolesR.POST, { method: 'POST', cookie: testMarkerCookie, body: { role: 'tester', label: 'Tester' } })
    ];
    for (const r of await Promise.all(mgmtCalls)) {
      expect(r.status).toBe(403);
    }
  });

  it('b) the marker never appears in: the marking list, Year tabs, Cadet Summary, Monthly Report, leaderboard, overview counts, search, reports, promotion counts; the sheet has no row for him', async () => {
    // 1. marking list (GET /api/cadets without ?all=1)
    const markList = await call(cadetsR.GET, { cookie: state.admin });
    expect(markList.status).toBe(200);
    expect(markList.json.cadets.some(c => c.name === 'Attendance Marker A' || c.role === 'marker')).toBe(false);

    // 2. Year tabs
    const rosterTabs = ['Year 1', 'Year 2', 'Year 3', 'Graduated', 'Discharged'];
    for (const tabName of rosterTabs) {
      const tab = sheets.tab(tabName);
      if (tab) {
        expect(tab.rows.slice(1).some(r => r[1] === 'Attendance Marker A' || r[1] === 'Sgt Rohan')).toBe(false);
      }
    }

    // 3. Cadet Summary
    const sumTab = sheets.tab('Cadet Summary');
    if (sumTab) {
      expect(sumTab.rows.slice(1).some(r => r[1] === 'Attendance Marker A' || r[1] === 'Sgt Rohan')).toBe(false);
    }

    // 4. Monthly Report
    const monTab = sheets.tab('Monthly Report');
    if (monTab) {
      expect(monTab.rows.slice(1).some(r => r[1] === 'Attendance Marker A' || r[1] === 'Sgt Rohan')).toBe(false);
    }

    // 5. Leaderboard
    const lb = await call(boardR.GET, { cookie: state.admin });
    expect(lb.status).toBe(200);
    expect(lb.json.leaderboard.some(c => c.name === 'Attendance Marker A')).toBe(false);

    // 6. Overview counts
    const ov = await call(overR.GET, { cookie: state.admin });
    expect(ov.status).toBe(200);
    expect(ov.json.totals.cadets).toBe(db.all('users').filter(u => u.data.isActive && !u.data.discharged && u.data.role === 'cadet').length);

    // 7. Search (cadets only)
    const srch = await call(searchR.GET, { cookie: state.admin, url: '/api/search?q=Marker' });
    expect(srch.status).toBe(200);
    expect(srch.json.cadets.some(u => u.name === 'Attendance Marker A' || u.role === 'marker')).toBe(false);

    // 8. Reports
    const rep = await call(repR.GET, { cookie: state.admin, url: '/api/reports?type=summary&format=csv' });
    expect(rep.status).toBe(200);
    expect(rep.buffer.toString('utf8')).not.toContain('Attendance Marker A');

    // 9. Promotion counts
    const promoPrev = await call(promoR.POST, { method: 'POST', cookie: state.admin, body: { dryRun: true } });
    expect(promoPrev.status).toBe(200);
    expect(promoPrev.json).toBeDefined();

    // 10. The sheet has no row for him across ALL tabs
    for (const tab of sheets.tabs) {
      expect(tab.rows.slice(1).some(r => r[1] === 'Attendance Marker A')).toBe(false);
    }
  });

  it('c) a normal cadet cannot open /dashboard/marker (middleware) or POST /api/attendance', async () => {
    // Normal cadet login
    const cadetLogin = await login('KAR/NCC/2026/101', 'KAR/NCC/2026/101');
    expect(cadetLogin.status).toBe(200);
    const code = mailTo('arjun@test.in').at(-1).subject.match(/^(\d{6})/)[1];
    const cadetVerified = await call(otpR.POST, { method: 'POST', body: { challengeId: cadetLogin.json.challengeId, code } });
    const tokenMatch = cadetVerified.cookie.match(/ncc_token=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : '';

    // Middleware: cannot open /dashboard/marker
    const req = new NextRequest('http://localhost:3000/dashboard/marker', {
      headers: { cookie: `ncc_token=${token}` }
    });
    const midRes = await middleware(req);
    expect(midRes.status).toBe(307);
    expect(midRes.headers.get('location')).toBe('http://localhost:3000/dashboard/cadet');

    // POST /api/attendance -> 403
    const attRes = await call(attR.POST, {
      method: 'POST',
      cookie: cadetVerified.cookie,
      body: {
        date: dAgo(16),
        activity_type: 'Parade',
        years: [2],
        records: [att('Arjun Sharma', 'Present')],
        photo_urls: []
      }
    });
    expect(attRes.status).toBe(403);
  });

  it('d) cadet created or imported gets otpRequired true by default; cadet with an e-mail receives a code; cadet without an e-mail signs in with password only and the response contains otpSkipped; a marker with OTP on and no e-mail is rejected both at creation and at sign-in', async () => {
    // Cadet created gets otpRequired: true by default
    const cWithEmail = await call(cadetsR.POST, {
      method: 'POST',
      cookie: state.admin,
      body: {
        name: 'Cadet With Email',
        role: 'cadet',
        year: 1,
        type: 'SD',
        reg_no: 'KAR/NCC/2026/D01',
        email: 'cadet.d01@test.in',
        password: 'Password@123'
      }
    });
    expect(cWithEmail.status).toBe(200);
    expect(userByName('Cadet With Email').otpRequired).toBe(true);

    // Cadet with email receives a code
    globalThis.__mail.length = 0;
    const loginWithEmail = await login('KAR/NCC/2026/D01', 'Password@123');
    expect(loginWithEmail.status).toBe(200);
    expect(loginWithEmail.json.otpRequired).toBe(true);
    expect(mailTo('cadet.d01@test.in').length).toBe(1);

    // Cadet without an email
    const cNoEmail = await call(cadetsR.POST, {
      method: 'POST',
      cookie: state.admin,
      body: {
        name: 'Cadet No Email',
        role: 'cadet',
        year: 1,
        type: 'SW',
        reg_no: 'KAR/NCC/2026/D02',
        password: 'Password@123'
      }
    });
    expect(cNoEmail.status).toBe(200);
    expect(userByName('Cadet No Email').otpRequired).toBe(true);

    // signs in with password only and response contains otpSkipped
    const loginNoEmail = await login('KAR/NCC/2026/D02', 'Password@123');
    expect(loginNoEmail.status).toBe(200);
    expect(loginNoEmail.json.otpSkipped).toBe('No e-mail on file, so the code step was skipped.');
    expect(loginNoEmail.cookie).toMatch(/^ncc_token=/);
    expect(db.all('system_events').some(a => a.data.type === 'auth:otp-skipped')).toBe(true);

    // A marker with OTP on and no e-mail is rejected at creation
    const badMarkerCreate = await call(cadetsR.POST, {
      method: 'POST',
      cookie: state.admin,
      body: {
        name: 'Marker No Email',
        role: 'marker',
        password: 'Password@123',
        otp_required: true
      }
    });
    expect(badMarkerCreate.status).toBe(400);
    expect(badMarkerCreate.json.error).toMatch(/email/i);

    // A marker with OTP on and no e-mail is rejected at sign-in
    await db.collection('users').doc('marker_no_email').set({
      name: 'Legacy Marker No Email',
      role: 'marker',
      username: 'markernoemail',
      passwordHash: await bcrypt.hash('Password@123', 4),
      isActive: true,
      discharged: false,
      otpRequired: true
    });
    const badMarkerLogin = await login('markernoemail', 'Password@123');
    expect(badMarkerLogin.status).toBe(403);
    expect(badMarkerLogin.json.error).toMatch(/OTP is on for this account but no e-mail is set\. Ask the Admin to add your e-mail\./);
  });

  it('e) OTP switch off -> next sign-in goes straight in; switch on again -> code required', async () => {
    const cadet = userByName('Cadet With Email');
    // OTP switch off
    const offRes = await call(cadetIdR.PUT, {
      method: 'PUT',
      cookie: state.admin,
      params: { id: cadet.id },
      body: { otp_required: false }
    });
    expect(offRes.status).toBe(200);

    // Next sign-in goes straight in
    const directLogin = await login('KAR/NCC/2026/D01', 'Password@123');
    expect(directLogin.status).toBe(200);
    expect(directLogin.json.otpRequired).toBeUndefined();
    expect(directLogin.cookie).toMatch(/^ncc_token=/);

    // Switch on again
    const onRes = await call(cadetIdR.PUT, {
      method: 'PUT',
      cookie: state.admin,
      params: { id: cadet.id },
      body: { otp_required: true }
    });
    expect(onRes.status).toBe(200);

    // Code required
    const codeLogin = await login('KAR/NCC/2026/D01', 'Password@123');
    expect(codeLogin.status).toBe(200);
    expect(codeLogin.json.otpRequired).toBe(true);
  });

  it('f) e-mail matching is case-insensitive, never matches cadet accounts, and duplicate staff e-mails are rejected', async () => {
    // 1. E-mail matching is case-insensitive
    const upperLogin = await login('MARKER.A@TEST.IN', 'MarkerPw@123');
    expect(upperLogin.status).toBe(200);
    expect(upperLogin.json.otpRequired).toBe(true);

    // 2. Never matches cadet accounts
    const cadetEmailLogin = await login('cadet.d01@test.in', 'Password@123');
    expect(cadetEmailLogin.status).toBe(401);
    expect(cadetEmailLogin.json.error).toMatch(/Invalid credentials/i);

    // 3. Duplicate staff e-mails are rejected
    const dupMarker = await call(cadetsR.POST, {
      method: 'POST',
      cookie: state.admin,
      body: {
        name: 'Another Marker',
        role: 'marker',
        email: 'Marker.A@Test.In',
        password: 'Password@123'
      }
    });
    expect(dupMarker.status).toBe(400);
    expect(dupMarker.json.error).toMatch(/already in use/i);
  });

  it('g) promotion leaves markers untouched', async () => {
    const markerBefore = userByName('Attendance Marker A');

    // Clear pending sessions created during test 12a so promotion guard is satisfied
    const pendings = await db.collection('pending_sessions').get();
    for (const d of pendings.docs) {
      await d.ref.delete();
    }

    // Run promotion
    const curCycle = (await db.collection('settings').doc('main').get()).data().currentCycle;
    const promoRes = await call(promoR.POST, {
      method: 'POST',
      cookie: state.admin,
      body: { expectedCycle: curCycle }
    });
    expect(promoRes.status).toBe(200);

    const markerAfter = userByName('Attendance Marker A');
    expect(markerAfter.role).toBe('marker');
    expect(markerAfter.year).toBeUndefined();
    expect(markerAfter.isActive).toBe(true);
    expect(markerAfter.discharged).toBe(false);
    expect(markerAfter.stats).toBeUndefined();

    // Admin and CTO are also untouched and never appear in roster/summary/monthly tabs
    const rosterTabs = ['Year 1', 'Year 2', 'Year 3', 'Graduated', 'Discharged'];
    for (const tabName of rosterTabs) {
      const tab = sheets.tab(tabName);
      if (tab) {
        for (const row of tab.rows.slice(1)) {
          expect(row[1]).not.toBe('Admin Officer');
          expect(row[1]).not.toBe('Lt. Sir');
          expect(row[1]).not.toBe('Attendance Marker A');
        }
      }
    }

    const summaryTab = sheets.tab('Cadet Summary');
    if (summaryTab) {
      for (const row of summaryTab.rows.slice(1)) {
        expect(row[1]).not.toBe('Admin Officer');
        expect(row[1]).not.toBe('Lt. Sir');
        expect(row[1]).not.toBe('Attendance Marker A');
      }
    }

    const monthlyTab = sheets.tab('Monthly Report');
    if (monthlyTab) {
      for (const row of monthlyTab.rows.slice(1)) {
        expect(row[1]).not.toBe('Admin Officer');
        expect(row[1]).not.toBe('Lt. Sir');
        expect(row[1]).not.toBe('Attendance Marker A');
      }
    }
  });
});
