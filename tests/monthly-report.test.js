import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import bcrypt from 'bcryptjs';
import { call, flushBg } from './helpers/http.js';
import { buildReport, renderXlsx } from '@/lib/reports';
import * as repR from '@/app/api/reports/route';
import * as loginR from '@/app/api/auth/login/route';
import * as monthlyR from '@/app/api/cron/monthly/route';

const db = globalThis.__db;

describe('PART B: Monthly Report as One Worksheet', () => {
  let adminCookie;

  beforeAll(async () => {
    const pw = await bcrypt.hash('Admin@123', 4);
    await db.collection('users').doc('admin_rep').set({
      name: 'Admin Reports',
      role: 'admin',
      username: 'adminrep',
      passwordHash: pw,
      email: 'adminrep@test.in',
      isActive: true,
      permissions: { canViewAllAttendance: true }
    });
    const loginRes = await call(loginR.POST, { method: 'POST', body: { identifier: 'adminrep', password: 'Admin@123' } });
    adminCookie = loginRes.cookie;

    await db.collection('settings').doc('main').set({
      currentCycle: 1,
      unitName: '6 KAR AIR SQN NCC',
      squadronName: 'FLIGHT-B',
      thresholdPct: 75,
      sirEmail: 'sir@test.in',
      backupEmail: 'backup@test.in'
    });

    // Seed cadets: Year 1 (SD and SW) and Year 3 (SD) - Year 2 empty
    await db.collection('users').doc('cad_b_y1_sw').set({ id: 'cad_b_y1_sw', name: 'Bhavana SW', regNo: 'REG/102', year: 1, type: 'SW', role: 'cadet', isActive: true });
    await db.collection('users').doc('cad_b_y1_sd').set({ id: 'cad_b_y1_sd', name: 'Aakash SD', regNo: 'REG/101', year: 1, type: 'SD', role: 'cadet', isActive: true });
    await db.collection('users').doc('cad_b_y3_sd').set({ id: 'cad_b_y3_sd', name: 'Chetan SD', regNo: 'REG/301', year: 3, type: 'SD', role: 'cadet', isActive: true });

    // Seed parades for Oct 2026: earlier (Oct 10) and later (Oct 20)
    await db.collection('sessions').doc('sess_oct_20').set({
      id: 'sess_oct_20',
      date: '2026-10-20',
      cycle: 1,
      activityType: 'Parade',
      groupLabel: 'Year 1 & 3',
      years: [1, 3],
      total: 3, present: 2, absent: 1,
      markedByName: 'Marker One',
      createdAt: '2026-10-20T13:12:00.000Z',
      approvedAt: '2026-10-20T14:00:00.000Z'
    });

    await db.collection('sessions').doc('sess_oct_10').set({
      id: 'sess_oct_10',
      date: '2026-10-10',
      cycle: 1,
      activityType: 'Drill',
      groupLabel: 'Year 1',
      years: [1],
      total: 2, present: 2, absent: 0,
      markedByName: 'Marker Two',
      createdAt: '2026-10-10T12:00:00.000Z',
      approvedAt: '2026-10-10T13:00:00.000Z'
    });

    // Attendance records
    // Oct 10: Aakash Present, Bhavana Present
    await db.collection('attendance').doc('2026-10-10_cad_b_y1_sd').set({ sessionId: 'sess_oct_10', cadetId: 'cad_b_y1_sd', cadetName: 'Aakash SD', cadetRegNo: 'REG/101', cadetYear: 1, cadetType: 'SD', status: 'Present', reason: '', cycle: 1, date: '2026-10-10' });
    await db.collection('attendance').doc('2026-10-10_cad_b_y1_sw').set({ sessionId: 'sess_oct_10', cadetId: 'cad_b_y1_sw', cadetName: 'Bhavana SW', cadetRegNo: 'REG/102', cadetYear: 1, cadetType: 'SW', status: 'Present', reason: '', cycle: 1, date: '2026-10-10' });

    // Oct 20: Aakash Absent (Medical), Bhavana Present, Chetan Present
    await db.collection('attendance').doc('2026-10-20_cad_b_y1_sd').set({ sessionId: 'sess_oct_20', cadetId: 'cad_b_y1_sd', cadetName: 'Aakash SD', cadetRegNo: 'REG/101', cadetYear: 1, cadetType: 'SD', status: 'Absent', reason: 'Medical fever', cycle: 1, date: '2026-10-20' });
    await db.collection('attendance').doc('2026-10-20_cad_b_y1_sw').set({ sessionId: 'sess_oct_20', cadetId: 'cad_b_y1_sw', cadetName: 'Bhavana SW', cadetRegNo: 'REG/102', cadetYear: 1, cadetType: 'SW', status: 'Present', reason: '', cycle: 1, date: '2026-10-20' });
    await db.collection('attendance').doc('2026-10-20_cad_b_y3_sd').set({ sessionId: 'sess_oct_20', cadetId: 'cad_b_y3_sd', cadetName: 'Chetan SD', cadetRegNo: 'REG/301', cadetYear: 3, cadetType: 'SD', status: 'Present', reason: '', cycle: 1, date: '2026-10-20' });
  });

  it('workbook has exactly one worksheet named "Monthly"', async () => {
    const res = await call(repR.GET, { cookie: adminCookie, url: '/api/reports?type=month&month=2026-10&format=xlsx' });
    expect(res.status).toBe(200);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buffer);
    expect(wb.worksheets.length).toBe(1);
    expect(wb.worksheets[0].name).toBe('Monthly');
  });

  it('sheet layout: title rows, compact table, year blocks (skipping empty years), frozen columns', async () => {
    const res = await call(repR.GET, { cookie: adminCookie, url: '/api/reports?type=month&month=2026-10&format=xlsx' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet('Monthly');

    // Title rows check
    expect(ws.getCell('A1').value).toContain('NCC AIRWING FLIGHT-B');
    expect(ws.getCell('A2').value).toContain('6 KAR AIR SQN NCC');
    expect(ws.getCell('A3').value).toContain('Monthly attendance report');
    expect(ws.views[0]?.xSplit).toBe(4); // frozen first 4 columns

    // Compact summary table contains Year 1 and Year 3, but skips Year 2
    let foundY1Summary = false, foundY3Summary = false, foundY2Summary = false;
    ws.eachRow(row => {
      const val = row.getCell(1).value;
      if (val === 'Year 1') foundY1Summary = true;
      if (val === 'Year 3') foundY3Summary = true;
      if (val === 'Year 2') foundY2Summary = true;
    });
    expect(foundY1Summary).toBe(true);
    expect(foundY3Summary).toBe(true);
    expect(foundY2Summary).toBe(false);

    // Block headings check
    let foundY1Block = false, foundY3Block = false, foundY2Block = false;
    ws.eachRow(row => {
      const val = String(row.getCell(1).value || '');
      if (val.startsWith('Year 1 -')) foundY1Block = true;
      if (val.startsWith('Year 3 -')) foundY3Block = true;
      if (val.startsWith('Year 2 -')) foundY2Block = true;
    });
    expect(foundY1Block).toBe(true);
    expect(foundY3Block).toBe(true);
    expect(foundY2Block).toBe(false);
  });

  it('date columns are sorted ascending, and the Submitted row directly under headers matches createdAt', async () => {
    const rep = await buildReport('month', { month: '2026-10' });
    const buf = await renderXlsx(rep);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Monthly');

    // Find the Year 1 table header row: "Sl.", "Reg No.", "Name", "Type", date columns...
    let headerRowIdx = -1;
    ws.eachRow((row, rowNum) => {
      if (row.getCell(1).value === 'Sl.' && row.getCell(2).value === 'Reg No.') {
        headerRowIdx = rowNum;
      }
    });
    expect(headerRowIdx).toBeGreaterThan(0);

    const headerRow = ws.getRow(headerRowIdx);
    const subRow = ws.getRow(headerRowIdx + 1);

    // Col 5 should be earlier date (10 Oct), Col 6 should be later date (20 Oct)
    expect(headerRow.getCell(5).value).toMatch(/10 Oct/);
    expect(headerRow.getCell(6).value).toMatch(/20 Oct/);

    // Submitted row label and times
    expect(subRow.getCell(4).value).toBe('Submitted');
    expect(subRow.getCell(5).value).toMatch(/10 Oct 17:30/); // 12:00 UTC = 17:30 IST
    expect(subRow.getCell(6).value).toMatch(/20 Oct 18:42/); // 13:12 UTC = 18:42 IST

    // Date header cell notes holding activity, group, and marked-by
    expect(headerRow.getCell(5).note).toContain('Drill');
    expect(headerRow.getCell(5).note).toContain('Marker Two');
    expect(headerRow.getCell(6).note).toContain('Parade');
    expect(headerRow.getCell(6).note).toContain('Marker One');
  });

  it('P/A cells, absentee formatting and cell note, remark for below required %, and totals', async () => {
    const rep = await buildReport('month', { month: '2026-10' });
    const buf = await renderXlsx(rep);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Monthly');

    // Find row for Aakash SD (Year 1 SD): Present on 10 Oct, Absent on 20 Oct (50% -> BELOW 75%)
    let aakashRow = null, bhavanaRow = null;
    ws.eachRow(row => {
      if (row.getCell(3).value === 'Aakash SD') aakashRow = row;
      if (row.getCell(3).value === 'Bhavana SW') bhavanaRow = row;
    });

    expect(aakashRow).toBeTruthy();
    expect(bhavanaRow).toBeTruthy();

    // Reg No as text
    expect(String(aakashRow.getCell(2).value)).toBe('REG/101');

    // Aakash: Col 5 = P, Col 6 = A (with reason note and light red fill)
    expect(aakashRow.getCell(5).value).toBe('P');
    expect(aakashRow.getCell(6).value).toBe('A');
    expect(aakashRow.getCell(6).note).toBe('Medical fever');
    expect(aakashRow.getCell(6).fill?.fgColor?.argb).toBe('FFFDECEA');

    // Summary columns for Aakash: Present=1, Absent=1, Parades=2, Attendance %=50%, Remark=BELOW 75%
    expect(aakashRow.getCell(7).value).toBe(1);
    expect(aakashRow.getCell(8).value).toBe(1);
    expect(aakashRow.getCell(9).value).toBe(2);
    expect(aakashRow.getCell(10).value).toBe('50%');
    expect(aakashRow.getCell(11).value).toBe('BELOW 75%');

    // Bhavana: Present=2, Absent=0, Parades=2, Attendance %=100%, Remark=''
    expect(bhavanaRow.getCell(5).value).toBe('P');
    expect(bhavanaRow.getCell(6).value).toBe('P');
    expect(bhavanaRow.getCell(7).value).toBe(2);
    expect(bhavanaRow.getCell(8).value).toBe(0);
    expect(bhavanaRow.getCell(10).value).toBe('100%');
    expect(bhavanaRow.getCell(11).value).toBe('');
  });

  it('empty months give a clear error', async () => {
    const res = await call(repR.GET, { cookie: adminCookie, url: '/api/reports?type=month&month=2021-01&format=xlsx' });
    expect(res.json.error).toMatch(/No attendance recorded for/);
  });

  it('monthly cron summary attaches both NCC-AMS-Monthly-<YYYY-MM>.xlsx and the PDF', async () => {
    globalThis.__mail.length = 0;
    const res = await monthlyR.GET(new Request('http://localhost/api/cron/monthly?month=2026-10', { headers: { authorization: 'Bearer cron-secret' } }));
    expect((await res.json()).success).not.toBe(false);

    const m = globalThis.__mail.find(x => /Monthly Attendance Summary/.test(x.subject));
    expect(m).toBeTruthy();
    expect(m.attachments.length).toBe(2);
    expect(m.attachments.some(a => a.filename.endsWith('.xlsx') && a.filename.includes('2026-10'))).toBe(true);
    expect(m.attachments.some(a => a.filename.endsWith('.pdf'))).toBe(true);
  });
});
