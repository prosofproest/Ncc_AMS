import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { call, flushBg } from './helpers/http.js';
import { todayIST } from '@/lib/time';
import * as loginR from '@/app/api/auth/login/route';
import * as attR from '@/app/api/attendance/route';
import * as syncR from '@/app/api/sync/route';
import * as repR from '@/app/api/reports/route';
import * as apprR from '@/app/api/approvals/route';

const db = globalThis.__db, sheets = globalThis.__sheets, TODAY = todayIST();
const N = 300;

describe('a large unit (300 cadets, 3 years)', () => {
  let marker;
  beforeAll(async () => {
    const pw = await bcrypt.hash('Marker@123', 4);
    await db.collection('users').doc('m1').set({ name: 'Marker', role: 'marker', email: 'marker@test.in', username: 'mk', passwordHash: pw, isActive: true, otpRequired: false });
    await db.collection('settings').doc('main').set({ sirEmail: 'sir@test.in', backupEmail: 'b@test.in' });
    for (let i = 0; i < N; i++) await db.collection('users').doc('c' + i).set({ name: `Cadet ${String(i).padStart(3, '0')}`, regNo: `R${i}`, role: 'cadet', year: (i % 3) + 1, type: i % 5 ? 'SD' : 'SW', email: i % 2 ? `c${i}@t.in` : '', isActive: true, discharged: false, stats: { total: 0, present: 0, absent: 0, months: {} }, benefit: 0 });
    await db.collection('users').doc('adm0').set({ name: 'Adm', role: 'admin', username: 'adm', passwordHash: await bcrypt.hash('Admin@123', 4), isActive: true, otpRequired: false });
    await db.collection('users').doc('cto0').set({ name: 'Sir', role: 'cto', username: 'sir', passwordHash: await bcrypt.hash('Sir@12345', 4), isActive: true, otpRequired: false });
    marker = (await call(loginR.POST, { method: 'POST', body: { identifier: 'mk', password: 'Marker@123' } })).cookie;
  });

  it('marks 300 cadets in one go: single response is fast and no Firestore batch exceeds 500 ops', async () => {
    const records = Array.from({ length: N }, (_, i) => ({ cadet_id: 'c' + i, status: i % 6 === 1 ? 'Absent' : 'Present', reason: i % 6 === 1 ? 'Sick / Medical' : '' }));
    const t0 = Date.now();
    const r = await call(attR.POST, { method: 'POST', cookie: marker, body: { date: TODAY, activity_type: 'Camp', activity_description: 'Annual camp', years: [1, 2, 3], geo_lat: 1, geo_lng: 2, photo_urls: ['https://res.cloudinary.com/x/image/upload/a.jpg'], records } });
    const ms = Date.now() - t0;
    expect(r.status).toBe(200); expect(r.json).toMatchObject({ count: 300, pending: true, present: 250, absent: 50 });
    expect(ms).toBeLessThan(1500);
    console.log(`  submit response for 300 cadets: ${ms} ms`);
    // approve: Admin then CTO — the CTO's click is the one that writes 300 records
    const admin = (await call(loginR.POST, { method: 'POST', body: { identifier: 'adm', password: 'Admin@123' } })).cookie;
    const cto = (await call(loginR.POST, { method: 'POST', body: { identifier: 'sir', password: 'Sir@12345' } })).cookie;
    const t1 = Date.now(); const a1 = await call(apprR.POST, { method: 'POST', cookie: admin, body: { id: r.json.sessionId, action: 'approve' } }); const adminMs = Date.now() - t1;
    const t2 = Date.now(); const a2 = await call(apprR.POST, { method: 'POST', cookie: cto, body: { id: r.json.sessionId, action: 'approve' } }); const ctoMs = Date.now() - t2;
    expect(a1.json.final).toBe(false); expect(a2.json.final).toBe(true);
    console.log(`  admin approve: ${adminMs} ms · CTO approve + commit of 300 records: ${ctoMs} ms (before background work)`);
    expect(adminMs).toBeLessThan(800); expect(ctoMs).toBeLessThan(2500);
    const t3 = Date.now(); await flushBg(); console.log(`  background (sheet + 1 parade mail with PDF + 50 absence mails): ${Date.now() - t3} ms`);
    expect(globalThis.__bgErrors.length).toBe(0);
    const parade = globalThis.__mail.find(m => /Parade Report/.test(m.subject));
    expect(parade.subject).toContain('All Years'); expect(parade.attachments[0].content.length).toBeGreaterThan(8000);
    require('fs').writeFileSync('/tmp/parade-300.pdf', parade.attachments[0].content);
    expect(globalThis.__mail.filter(m => /Absence notice/.test(m.subject)).length).toBe(50);   // every absentee (index%6==1 → odd → has an email)
    expect(sheets.tab('Attendance Log').rows.length - 1).toBe(300);
  });

  it('two simultaneous submissions for the same cadets: exactly one wins, counters are not doubled', async () => {
    const mk = d => call(attR.POST, { method: 'POST', cookie: marker, body: { date: d, activity_type: 'Parade', years: [1], geo_lat: 1, geo_lng: 2, photo_urls: [], records: Array.from({ length: 5 }, (_, i) => ({ cadet_id: 'c' + i * 3, status: 'Present' })) } });
    const y = new Date(TODAY + 'T00:00:00Z'); y.setUTCDate(y.getUTCDate() - 1); const d = y.toISOString().slice(0, 10);
    const results = await Promise.all([mk(d), mk(d), mk(d)]);
    const statuses = results.map(r => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);                                              // only one submission is accepted; the rest see "waiting for approval"
    expect(db.all('pending_sessions').filter(p => p.data.date === d).length).toBe(1);
    const id = results.find(r => r.status === 200).json.sessionId;
    const admin = (await call(loginR.POST, { method: 'POST', body: { identifier: 'adm', password: 'Admin@123' } })).cookie, cto = (await call(loginR.POST, { method: 'POST', body: { identifier: 'sir', password: 'Sir@12345' } })).cookie;
    await Promise.all([call(apprR.POST, { method: 'POST', cookie: admin, body: { id, action: 'approve' } }), call(apprR.POST, { method: 'POST', cookie: cto, body: { id, action: 'approve' } })]);
    await flushBg();
    expect(db.docs.get('users/c0').stats.total).toBe(2);                                    // camp + this one, not 4 or 5
    expect(db.all('attendance').filter(a => a.data.date === d).length).toBe(5);
  });

  it('rebuild + full-unit report handle 300 rows', async () => {
    const admin = await bcrypt.hash('x', 4);
    await db.collection('users').doc('adm').set({ name: 'Adm', role: 'admin', username: 'adm', passwordHash: await bcrypt.hash('Admin@123', 4), isActive: true, otpRequired: false });
    const ac = (await call(loginR.POST, { method: 'POST', body: { identifier: 'adm', password: 'Admin@123' } })).cookie;
    const rb = await call(syncR.POST, { method: 'POST', cookie: ac, body: { action: 'rebuild' } });
    expect(rb.json.success).toBe(true);
    const rep = await call(repR.GET, { cookie: ac, url: '/api/reports?type=summary&format=pdf' });
    expect(rep.status).toBe(200); require('fs').writeFileSync('/tmp/summary-300.pdf', rep.buffer);
    const x = await call(repR.GET, { cookie: ac, url: `/api/reports?type=month&month=${TODAY.slice(0, 7)}&format=xlsx` });
    expect(x.status).toBe(200);
  });
});
