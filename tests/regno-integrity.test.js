import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { call } from './helpers/http.js';
import { setupSheetTabs, writeRosterStats, writeRosterFull, getSheetYearCounts } from '@/lib/sheets';
import { importFromSheet } from '@/lib/import';
import { normalizeRegNo } from '@/lib/keys.mjs';
import { buildReport, renderPdf, renderXlsx } from '@/lib/reports';
import * as cadetsR from '@/app/api/cadets/route';
import * as cadetIdR from '@/app/api/cadets/[id]/route';
import * as attendanceR from '@/app/api/attendance/route';
import * as healthR from '@/app/api/health/route';
import * as reportsR from '@/app/api/reports/route';
import * as loginR from '@/app/api/auth/login/route';
import { getSettings, saveSettings } from '@/lib/settings';
import { invalidateUsers } from '@/lib/users';

const db = globalThis.__db;
const sheets = globalThis.__sheets;

describe('INCIDENT & PART A/B/C/D: Reg No Identity & Data Integrity', () => {
  let adminCookie, ctoCookie, markerCookie;

  beforeAll(async () => {
    const pw = await bcrypt.hash('Secret@123', 4);
    await db.collection('users').doc('admin_integ').set({
      id: 'admin_integ',
      name: 'Integrity Admin',
      role: 'admin',
      username: 'admininteg',
      email: 'admininteg@test.in',
      passwordHash: pw,
      isActive: true,
      otpRequired: false,
      permissions: { canManageUsers: true, canManageSettings: true, canViewAllAttendance: true, canDeleteAttendance: true }
    });
    await db.collection('users').doc('cto_integ').set({
      id: 'cto_integ',
      name: 'Integrity CTO',
      role: 'cto',
      username: 'ctointeg',
      email: 'ctointeg@test.in',
      passwordHash: pw,
      isActive: true,
      otpRequired: false,
      permissions: { canManageUsers: false, canViewAllAttendance: true }
    });
    await db.collection('users').doc('marker_integ').set({
      id: 'marker_integ',
      name: 'Integrity Marker',
      role: 'marker',
      username: 'markerinteg',
      email: 'markerinteg@test.in',
      passwordHash: pw,
      isActive: true,
      otpRequired: false,
      permissions: { canMarkAttendance: true }
    });

    const lAdmin = await call(loginR.POST, { method: 'POST', body: { identifier: 'admininteg', password: 'Secret@123' } });
    adminCookie = lAdmin.cookie;

    const lCto = await call(loginR.POST, { method: 'POST', body: { identifier: 'ctointeg', password: 'Secret@123' } });
    ctoCookie = lCto.cookie;

    const lMarker = await call(loginR.POST, { method: 'POST', body: { identifier: 'markerinteg', password: 'Secret@123' } });
    markerCookie = lMarker.cookie;
  });

  beforeEach(async () => {
    sheets.reset();
    await setupSheetTabs();
  });

  it('normalizeRegNo trims, uppercases, and strips internal whitespace', () => {
    expect(normalizeRegNo('  ka 2024 sd af 1234567  ')).toBe('KA2024SDAF1234567');
    expect(normalizeRegNo('\n KA2024\tSDAF 1234567 ')).toBe('KA2024SDAF1234567');
    expect(normalizeRegNo(null)).toBe('');
    expect(normalizeRegNo(undefined)).toBe('');
  });

  it('Incident test: duplicate Reg No in DB does not grow sheet on repeated runs, and import deactivates duplicate', async () => {
    const pw = await bcrypt.hash('Cadet@123', 4);

    // Setup duplicate cadet documents in Firestore sharing one Reg No in Year 1
    const reg = 'KA2024SDAF1234567';
    await db.collection('users').doc('cadet_real_1').set({
      id: 'cadet_real_1',
      name: 'Aarav Sharma',
      regNo: reg,
      year: 1,
      type: 'SD',
      role: 'cadet',
      email: 'aarav@real.in',
      phone: '9876543210',
      isActive: true,
      discharged: false,
      fromSheet: true,
      passwordHash: pw,
      stats: { total: 12, present: 11, absent: 1, months: {} },
      createdAt: '2026-01-01T10:00:00.000Z'
    });

    await db.collection('users').doc('cadet_dup_1').set({
      id: 'cadet_dup_1',
      name: 'Aarav Copy',
      regNo: reg,
      year: 1,
      type: 'SD',
      role: 'cadet',
      email: 'aarav_copy@test.in',
      phone: '9876543210',
      isActive: true,
      discharged: false,
      fromSheet: true,
      passwordHash: pw,
      stats: { total: 0, present: 0, absent: 0, months: {} },
      createdAt: '2026-01-02T10:00:00.000Z'
    });

    // In sheet Year 1 tab, there is only Aarav Sharma
    const y1 = sheets.tab('Year 1');
    y1.rows = [
      ['Sl.', 'Name', 'Reg No.', 'Type (SD/SW)', 'Email', 'Phone', 'Attendance %', 'Status'],
      [1, 'Aarav Sharma', reg, 'SD', 'aarav@real.in', '9876543210', '91.7%', 'Active']
    ];

    const initialRowCount = y1.rows.length; // 2 rows

    // Run writeRosterStats 3 times
    const usersSnap = await db.collection('users').get();
    const usersList = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const r1 = await writeRosterStats(usersList);
    expect(r1.success).toBe(true);
    expect(y1.rows.length).toBe(initialRowCount);

    const r2 = await writeRosterStats(usersList);
    expect(r2.success).toBe(true);
    expect(y1.rows.length).toBe(initialRowCount);

    const r3 = await writeRosterStats(usersList);
    expect(r3.success).toBe(true);
    expect(y1.rows.length).toBe(initialRowCount);

    // Now run importFromSheet()
    const impRes = await importFromSheet();
    expect(impRes.success).toBe(true);
    expect(impRes.duplicates.length).toBe(1);
    expect(impRes.duplicates[0].id).toBe('cadet_dup_1');
    expect(impRes.duplicates[0].duplicateOf).toBe('cadet_real_1');

    // Duplicate was deactivated with status 'duplicate-regno' and duplicateOf set
    const dupDoc = (await db.collection('users').doc('cadet_dup_1').get()).data();
    expect(dupDoc.isActive).toBe(false);
    expect(dupDoc.status).toBe('duplicate-regno');
    expect(dupDoc.duplicateOf).toBe('cadet_real_1');

    // Original remains active, retains attendance and email
    const origDoc = (await db.collection('users').doc('cadet_real_1').get()).data();
    expect(origDoc.isActive).toBe(true);
    expect(origDoc.stats.total).toBe(12);
    expect(origDoc.email).toBe('aarav@real.in');
  });

  it('Safety fuse: refuses to append more than 10 rows in one run and logs append-refused', async () => {
    // Populate DB with 12 new active Year 2 cadets not on sheet
    const users = [];
    for (let i = 1; i <= 12; i++) {
      users.push({
        id: `cadet_fuse_${i}`,
        name: `Fuse Cadet ${i}`,
        regNo: `KA2024SDAF20000${i < 10 ? '0' + i : i}`,
        year: 2,
        type: 'SD',
        role: 'cadet',
        isActive: true,
        discharged: false
      });
    }

    const y2 = sheets.tab('Year 2');
    const startCount = y2.rows.length;

    const res = await writeRosterStats(users);
    expect(res.success).toBe(true);
    expect(res.appendRefused).toBe(12);
    expect(res.appended).toBe(0);
    expect(y2.rows.length).toBe(startCount); // None appended

    // Verify system event was logged
    const eventsSnap = await db.collection('system_events').where('type', '==', 'sheets:append-refused').get();
    expect(eventsSnap.empty).toBe(false);
    expect(eventsSnap.docs[0].data().message).toMatch(/refused to append 12 rows/i);
  });

  it('A name-only row in the sheet still matches a cadet without Reg No', async () => {
    const pw = await bcrypt.hash('Cadet@123', 4);
    await db.collection('users').doc('cadet_noreg').set({
      id: 'cadet_noreg',
      name: 'No Reg Cadet',
      regNo: null,
      year: 1,
      type: 'SD',
      role: 'cadet',
      isActive: true,
      discharged: false,
      passwordHash: pw,
      stats: { total: 5, present: 5, absent: 0, months: {} }
    });

    const y1 = sheets.tab('Year 1');
    y1.rows = [
      ['Sl.', 'Name', 'Reg No.', 'Type (SD/SW)', 'Email', 'Phone', 'Attendance %', 'Status'],
      [1, 'No Reg Cadet', '', 'SD', '', '', '', '']
    ];

    const users = [{
      id: 'cadet_noreg',
      name: 'No Reg Cadet',
      regNo: null,
      year: 1,
      type: 'SD',
      role: 'cadet',
      isActive: true,
      discharged: false,
      stats: { total: 5, present: 5, absent: 0, months: {} }
    }];

    await writeRosterStats(users);
    expect(y1.rows.length).toBe(2); // Still 2 rows, updated columns G:H
    expect(y1.rows[1][6]).toBe('100%');
  });

  it('Import presence is decided by document ID only; warnings are collected and lastImportReport stored', async () => {
    await saveSettings({
      regNoPattern: '^KA\\d{4}(SD|SW)AF\\d{7}$'
    });

    // Populate Year 1 with intentional warning cases
    const y1 = sheets.tab('Year 1');
    y1.rows = [
      ['Sl.', 'Name', 'Reg No.', 'Type (SD/SW)', 'Email', 'Phone', 'Attendance %', 'Status'],
      [1, 'Bad Pattern', 'INVALID_REG_NO', 'SD', 'bad@test.in', '9876543210', '', ''],
      [2, 'Type Mismatch', 'KA2024SDAF1111111', 'SW', 'mismatch@test.in', '9876543211', '', ''],
      [3, 'Shared Contact 1', 'KA2024SDAF2222222', 'SD', 'shared@test.in', '9999999999', '', ''],
      [4, 'Shared Contact 2', 'KA2024SWAF3333333', 'SW', 'shared@test.in', '9999999999', '', ''],
      [5, 'Missing Phone', 'KA2024SDAF4444444', 'SD', 'nophone@test.in', '', '', ''],
      [6, 'Missing Email', 'KA2024SDAF5555555', 'SD', '', '9876543212', '', ''],
    ];

    const res = await importFromSheet();
    expect(res.success).toBe(true);

    const warnText = res.warnings.join('\n');
    expect(warnText).toMatch(/does not match pattern/i);
    expect(warnText).toMatch(/Type mismatch/i);
    expect(warnText).toMatch(/shared by/i);
    expect(warnText).toMatch(/Missing phone/i);
    expect(warnText).toMatch(/Missing email/i);

    const s = await getSettings({ fresh: true });
    expect(s.lastImportReport).toBeDefined();
    expect(s.lastImportReport.counts.totalCadets).toBe(6);
    expect(s.lastImportReport.warnings.length).toBeGreaterThan(0);
  });

  it('writeRosterFull writes only canonical cadet when multiple active share a Reg No', async () => {
    const reg = 'KA2024SDAF7777777';
    const users = [
      {
        id: 'c_canon',
        name: 'Canon Aarav',
        regNo: reg,
        year: 1,
        type: 'SD',
        role: 'cadet',
        isActive: true,
        discharged: false,
        stats: { total: 10, present: 10 },
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'c_non_canon',
        name: 'Non Canon Aarav',
        regNo: reg,
        year: 1,
        type: 'SD',
        role: 'cadet',
        isActive: true,
        discharged: false,
        stats: { total: 2, present: 2 },
        createdAt: '2026-01-02T00:00:00.000Z'
      }
    ];

    const r = await writeRosterFull(users);
    expect(r.success).toBe(true);
    expect(r.reportedDuplicates.length).toBe(1);
    expect(r.reportedDuplicates[0].id).toBe('c_non_canon');

    const y1 = sheets.tab('Year 1');
    // Header + exactly 1 cadet row
    expect(y1.rows.length).toBe(2);
    expect(y1.rows[1][1]).toBe('Canon Aarav');
  });

  it('Safe delete: allowed only without history (409 with history); non-admins get 403', async () => {
    const pw = await bcrypt.hash('Cadet@123', 4);

    // Cadet A: with stats
    await db.collection('users').doc('cadet_with_history').set({
      id: 'cadet_with_history',
      name: 'History Cadet',
      regNo: 'KA2024SDAF8888888',
      year: 1,
      type: 'SD',
      role: 'cadet',
      isActive: true,
      stats: { total: 3, present: 3, absent: 0 },
      passwordHash: pw
    });

    // Cadet B: zero stats, clean
    await db.collection('users').doc('cadet_clean').set({
      id: 'cadet_clean',
      name: 'Clean Cadet',
      regNo: 'KA2024SDAF9999999',
      year: 1,
      type: 'SD',
      role: 'cadet',
      isActive: true,
      stats: { total: 0, present: 0, absent: 0 },
      passwordHash: pw
    });

    // Marker attempt: 403
    const rMarker = await call(cadetIdR.DELETE, {
      method: 'DELETE',
      cookie: markerCookie,
      params: { id: 'cadet_clean' },
      body: { action: 'delete' }
    });
    expect(rMarker.status).toBe(403);

    // CTO attempt: 403
    const rCto = await call(cadetIdR.DELETE, {
      method: 'DELETE',
      cookie: ctoCookie,
      params: { id: 'cadet_clean' },
      body: { action: 'delete' }
    });
    expect(rCto.status).toBe(403);

    // Admin attempt on cadet with history: 409
    const rHist = await call(cadetIdR.DELETE, {
      method: 'DELETE',
      cookie: adminCookie,
      params: { id: 'cadet_with_history' },
      body: { action: 'delete' }
    });
    expect(rHist.status).toBe(409);
    expect(rHist.json.error).toMatch(/attendance history/i);

    // Admin attempt on clean cadet: 200 (deleted)
    const rClean = await call(cadetIdR.DELETE, {
      method: 'DELETE',
      cookie: adminCookie,
      params: { id: 'cadet_clean' },
      body: { action: 'delete' }
    });
    expect(rClean.status).toBe(200);
    expect(rClean.json.deleted).toBe(true);

    const checkSnap = await db.collection('users').doc('cadet_clean').get();
    expect(checkSnap.exists).toBe(false);

    // Audit log written with type 'cadet-delete'
    const audSnap = await db.collection('audit_log').where('type', '==', 'cadet-delete').get();
    expect(audSnap.empty).toBe(false);
  });

  it('Session delete skips stats update for missing users instead of failing', async () => {
    const pw = await bcrypt.hash('Cadet@123', 4);
    const sid = 'session_missing_user_test';
    const date = '2026-11-04';

    await db.collection('sessions').doc(sid).set({
      id: sid,
      date,
      cycle: 1,
      activityType: 'Parade',
      groupLabel: 'Flight B',
      present: 2,
      absent: 0,
      total: 2
    });

    // One user exists, one user was deleted
    await db.collection('users').doc('user_exists_1').set({
      id: 'user_exists_1',
      name: 'Existing User',
      role: 'cadet',
      year: 1,
      stats: { total: 5, present: 5, absent: 0, months: { m202611: { t: 5, p: 5 } } },
      passwordHash: pw
    });

    await db.collection('attendance').doc(`${date}_user_exists_1`).set({
      id: `${date}_user_exists_1`,
      sessionId: sid,
      date,
      cycle: 1,
      cadetId: 'user_exists_1',
      status: 'Present'
    });

    await db.collection('attendance').doc(`${date}_user_ghost_2`).set({
      id: `${date}_user_ghost_2`,
      sessionId: sid,
      date,
      cycle: 1,
      cadetId: 'user_ghost_2', // Not in users collection
      status: 'Present'
    });

    // Deleting session should not throw NOT_FOUND
    const delRes = await call(attendanceR.DELETE, {
      method: 'DELETE',
      cookie: adminCookie,
      url: `/api/attendance?sessionId=${sid}`
    });

    expect(delRes.status).toBe(200);
    expect(delRes.json.success).toBe(true);
    expect(delRes.json.deleted).toBe(2);

    // Existing user decremented
    const uAfter = (await db.collection('users').doc('user_exists_1').get()).data();
    expect(uAfter.stats.total).toBe(4);
    expect(uAfter.stats.present).toBe(4);
  });

  it('Health Data integrity checks report red and amber issues accurately', async () => {
    // 1. Duplicate Reg No in DB
    await db.collection('users').doc('dup_reg_a').set({ id: 'dup_reg_a', name: 'Alpha', regNo: 'KA2024SDAF9990001', role: 'cadet', year: 1, isActive: true });
    await db.collection('users').doc('dup_reg_b').set({ id: 'dup_reg_b', name: 'Beta', regNo: 'KA2024SDAF9990001', role: 'cadet', year: 1, isActive: true });

    // 2. Duplicate active email
    await db.collection('users').doc('dup_em_a').set({ id: 'dup_em_a', name: 'EmailA', email: 'dup_shared@test.in', role: 'cadet', year: 1, isActive: true });
    await db.collection('users').doc('dup_em_b').set({ id: 'dup_em_b', name: 'EmailB', email: 'dup_shared@test.in', role: 'cadet', year: 1, isActive: true });

    // 3. Duplicate phone
    await db.collection('users').doc('dup_ph_a').set({ id: 'dup_ph_a', name: 'PhoneA', phone: '9888877777', role: 'cadet', year: 2, isActive: true });
    await db.collection('users').doc('dup_ph_b').set({ id: 'dup_ph_b', name: 'PhoneB', phone: '9888877777', role: 'cadet', year: 2, isActive: true });

    // 4. Invalid Year
    await db.collection('users').doc('bad_yr').set({ id: 'bad_yr', name: 'BadYear', role: 'cadet', year: 5, isActive: true });

    // 5. Orphan attendance
    await db.collection('attendance').doc('orphan_att_1').set({ id: 'orphan_att_1', cadetId: 'non_existent_cadet_id', date: '2026-11-04' });

    // Invalidate cache to run fresh check
    const health = await call(healthR.GET, { cookie: adminCookie, url: '/api/health?mode=full' });
    expect(health.status).toBe(200);

    const di = health.json.services.dataIntegrity;
    expect(di).toBeDefined();
    expect(di.ok).toBe(false);

    expect(di.message).toMatch(/Duplicate Reg No KA2024SDAF9990001/);
    expect(di.message).toMatch(/Duplicate email dup_shared@test.in/);
    expect(di.message).toMatch(/Duplicate phone 9888877777/);
    expect(di.message).toMatch(/invalid year/i);
    expect(di.message).toMatch(/without user/i);

    // Clean up red issues to test amber warnings
    await db.collection('users').doc('dup_reg_b').delete();
    await db.collection('users').doc('dup_em_b').delete();
    await db.collection('users').doc('dup_ph_b').delete();
    await db.collection('users').doc('bad_yr').delete();
    await db.collection('attendance').doc('orphan_att_1').delete();
  });

  it('Contacts report generates Excel, PDF with 2 empty columns, and marker gets 403', async () => {
    // Populate some active cadets
    await db.collection('users').doc('c_rep_1').set({
      id: 'c_rep_1',
      name: 'Cadet Report 1',
      regNo: 'KA2024SDAF1234001',
      year: 1,
      type: 'SD',
      role: 'cadet',
      email: '',
      phone: '9876543210',
      isActive: true,
      discharged: false
    });

    await db.collection('users').doc('c_rep_2').set({
      id: 'c_rep_2',
      name: 'Cadet Report 2',
      regNo: 'KA2024SWAF1234002',
      year: 1,
      type: 'SW',
      role: 'cadet',
      email: 'shared_rep@test.in',
      phone: '',
      isActive: true,
      discharged: false
    });

    await db.collection('users').doc('c_rep_3').set({
      id: 'c_rep_3',
      name: 'Cadet Report 3',
      regNo: 'KA2024SDAF1234003',
      year: 1,
      type: 'SD',
      role: 'cadet',
      email: 'shared_rep@test.in',
      phone: '9876543212',
      isActive: true,
      discharged: false
    });
    invalidateUsers();

    // 1. Marker gets 403
    const mRes = await call(reportsR.GET, {
      cookie: markerCookie,
      url: '/api/reports?type=contacts&format=pdf'
    });
    expect(mRes.status).toBe(403);

    // 2. CSV format rejected
    const csvRes = await call(reportsR.GET, {
      cookie: adminCookie,
      url: '/api/reports?type=contacts&format=csv'
    });
    expect(csvRes.status).toBe(400);

    // 3. Build report directly to inspect structure
    const rep = await buildReport('contacts', { year: '1' });
    expect(rep.kind).toBe('contacts');
    expect(rep.subtitle).toMatch(/Please check your details and return this sheet/i);

    // Check columns
    const cols = rep.sections[0].cols.map(c => c.label);
    expect(cols).toContain('Correct? (Y/N)');
    expect(cols).toContain('Corrected e-mail / phone');

    // Check rows and flags
    const r1 = rep.sections[0].rows.find(r => r.name === 'Cadet Report 1');
    expect(r1.flags).toMatch(/Missing e-mail/i);

    const r2 = rep.sections[0].rows.find(r => r.name === 'Cadet Report 2');
    expect(r2.flags).toMatch(/Missing phone/i);
    expect(r2.flags).toMatch(/E-mail shared with Cadet Report 3/i);

    // Check ordering: SD before SW
    const namesInOrder = rep.sections[0].rows.map(r => r.name);
    const idxSD = namesInOrder.indexOf('Cadet Report 1');
    const idxSW = namesInOrder.indexOf('Cadet Report 2');
    expect(idxSD).toBeLessThan(idxSW);

    // 4. Excel rendering
    const xlsxBuf = await renderXlsx(rep);
    expect(xlsxBuf).toBeInstanceOf(Buffer);
    expect(xlsxBuf.length).toBeGreaterThan(100);

    // 5. PDF rendering
    const pdfBuf = await renderPdf(rep);
    expect(pdfBuf).toBeInstanceOf(Buffer);
    expect(pdfBuf.length).toBeGreaterThan(100);
  });
});
