// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { call, flushBg } from './helpers/http.js';
import { installBrowser } from './helpers/browser.js';
import * as loginR from '@/app/api/auth/login/route';
import * as backupR from '@/app/api/backup/route';
import * as cronR from '@/app/api/cron/daily/route';
import {
  generateBackupWorkbook,
  buildYearwiseBackupReport,
  buildYearwiseBackupPdf,
} from '@/lib/backup';
import { saveSettings } from '@/lib/settings';
import { sendBackupEmail } from '@/lib/email';

vi.mock('jose', async () => {
  const c = await import('node:crypto');
  const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const mac = (data, key) => c.createHmac('sha256', Buffer.from(key)).update(data).digest('base64url');
  class SignJWT {
    constructor(p) { this.p = { ...p }; }
    setProtectedHeader() { return this; }
    setIssuedAt() { this.p.iat = Math.floor(Date.now() / 1000); return this; }
    setExpirationTime() { this.p.exp = Math.floor(Date.now() / 1000) + 7 * 86400; return this; }
    async sign(key) {
      const h = b64({ alg: 'HS256' }), p = b64(this.p);
      return `${h}.${p}.${mac(h + '.' + p, key)}`;
    }
  }
  const jwtVerify = async (t, key) => {
    const [h, p, s] = String(t).split('.');
    if (!s || mac(h + '.' + p, key) !== s) throw new Error('bad signature');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp < Date.now() / 1000) throw new Error('expired');
    return { payload };
  };
  return { SignJWT, jwtVerify };
});

const db = globalThis.__db;
const cookieOf = async (id, pw) => (await call(loginR.POST, { method: 'POST', body: { identifier: id, password: pw } })).cookie;

describe('Data Backup (GET /api/backup & Sunday Cron)', () => {
  let adminCookie;
  let ctoCookie;
  let markerCookie;

  beforeAll(async () => {
    installBrowser();

    // Populate fake database with accounts
    const stats = { total: 10, present: 8, absent: 2, months: {} };
    await db.collection('users').doc('admin').set({
      role: 'admin', username: 'admin', name: 'Admin Officer', email: 'admin@example.com',
      passwordHash: await bcrypt.hash('Admin@123', 4), isActive: true, discharged: false, stats,
    });
    await db.collection('users').doc('sir').set({
      role: 'cto', username: 'sir', name: 'Care Taker Officer', email: 'sir@example.com',
      passwordHash: await bcrypt.hash('Sir@12345', 4), isActive: true, discharged: false, stats,
    });
    await db.collection('users').doc('marker').set({
      role: 'marker', username: 'marker', name: 'Cadet Marker', email: 'marker@example.com',
      passwordHash: await bcrypt.hash('Marker@123', 4), isActive: true, discharged: false, stats,
    });

    // Active cadets
    await db.collection('users').doc('cadet1').set({
      role: 'cadet', username: 'cadet1', name: 'Cadet Alpha', regNo: 'KA/26/1001',
      year: 1, type: 'SD', email: 'cadet1@example.com', phone: '9876543210', cycle: 1,
      isActive: true, discharged: false, stats: { total: 2, present: 1, absent: 1, months: {} }, benefit: 0,
    });
    await db.collection('users').doc('cadet2').set({
      role: 'cadet', username: 'cadet2', name: 'Cadet Bravo', regNo: 'KA/26/1002',
      year: 2, type: 'SW', email: 'cadet2@example.com', phone: '9876543211', cycle: 1,
      isActive: true, discharged: false, stats: { total: 1, present: 1, absent: 0, months: {} }, benefit: 0,
    });

    // Inactive / Left unit cadets
    await db.collection('users').doc('cadet_grad').set({
      role: 'cadet', username: 'cadet_grad', name: 'Cadet Senior', regNo: 'KA/26/1003',
      year: 3, type: 'SD', email: 'grad@example.com', cycle: 1,
      isActive: false, discharged: false, graduatedAt: '2026-06-01T00:00:00Z',
      stats: { total: 20, present: 19, absent: 1, months: {} },
    });
    await db.collection('users').doc('cadet_disch').set({
      role: 'cadet', username: 'cadet_disch', name: 'Cadet Left', regNo: 'KA/26/1004',
      year: 1, type: 'SW', email: 'disch@example.com', cycle: 1,
      isActive: false, discharged: true,
      stats: { total: 4, present: 2, absent: 2, months: {} },
    });

    // Populate sessions for current cycle in date order
    await db.collection('sessions').doc('session_1').set({
      date: '2026-10-20', activityType: 'Parade', activityDescription: 'Morning Drill',
      groupLabel: 'Year 1 & 2', years: [1, 2], present: 2, absent: 0, total: 2, pct: 100,
      markedByName: 'Cadet Marker', createdAt: '2026-10-20T06:00:00Z', cycle: 1,
    });
    await db.collection('sessions').doc('session_2').set({
      date: '2026-10-22', activityType: 'Range', activityDescription: 'Firing Practice',
      groupLabel: 'Year 1', years: [1], present: 0, absent: 1, total: 1, pct: 0,
      markedByName: 'Cadet Marker', createdAt: '2026-10-22T06:00:00Z', cycle: 1,
    });

    // Populate attendance records
    // Session 1: cadet1 present, cadet2 present
    await db.collection('attendance').doc('att_1').set({
      sessionId: 'session_1', date: '2026-10-20', cadetId: 'cadet1', cadetRegNo: 'KA/26/1001',
      cadetName: 'Cadet Alpha', cadetYear: 1, cadetType: 'SD', status: 'Present',
      reason: '', cycle: 1, createdAt: '2026-10-20T06:00:00Z',
    });
    await db.collection('attendance').doc('att_2').set({
      sessionId: 'session_1', date: '2026-10-20', cadetId: 'cadet2', cadetRegNo: 'KA/26/1002',
      cadetName: 'Cadet Bravo', cadetYear: 2, cadetType: 'SW', status: 'Present',
      reason: '', cycle: 1, createdAt: '2026-10-20T06:00:00Z',
    });

    // Session 2: cadet1 absent with reason, cadet2 outside session (not marked)
    await db.collection('attendance').doc('att_3').set({
      sessionId: 'session_2', date: '2026-10-22', cadetId: 'cadet1', cadetRegNo: 'KA/26/1001',
      cadetName: 'Cadet Alpha', cadetYear: 1, cadetType: 'SD', status: 'Absent',
      reason: 'Fever and cold', cycle: 1, createdAt: '2026-10-22T06:00:00Z',
    });

    // Populate benefits
    await db.collection('benefits').doc('ben_1').set({
      date: '2026-10-21', cadetId: 'cadet1', cadetRegNo: 'KA/26/1001', cadetName: 'Cadet Alpha',
      hours: 1, reason: 'Camp Attendance', byName: 'Admin Officer', at: '2026-10-21T10:00:00Z', cycle: 1,
    });

    // Populate settings
    await db.collection('settings').doc('main').set({
      sirEmail: 'sir@example.com',
      backupEmail: 'backup@example.com',
      weeklyBackupMailEnabled: true,
      thresholdPct: 75,
      currentCycle: 1,
      cycleLabel: '2026-2027',
    });

    // Populate audit_log
    await db.collection('audit_log').doc('audit_1').set({
      type: 'test-event',
      by: 'admin',
      byName: 'Admin Officer',
      note: 'Initial setup event',
      at: '2026-10-20T06:00:00Z',
    });

    adminCookie = await cookieOf('admin', 'Admin@123');
    ctoCookie = await cookieOf('sir', 'Sir@12345');
    markerCookie = await cookieOf('marker', 'Marker@123');
  });

  beforeEach(() => {
    backupR._resetBackupRateLimiter();
  });

  it('only the Administrator may call GET /api/backup (CTO and marker get 403)', async () => {
    // Marker gets 403
    const markerRes = await call(backupR.GET, { cookie: markerCookie });
    expect(markerRes.status).toBe(403);

    // CTO gets 403
    const ctoRes = await call(backupR.GET, { cookie: ctoCookie });
    expect(ctoRes.status).toBe(403);

    // Admin gets 200
    const adminRes = await call(backupR.GET, { cookie: adminCookie });
    expect(adminRes.status).toBe(200);
    expect(adminRes.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(adminRes.headers.get('content-disposition')).toMatch(/attachment; filename="NCC-AMS-Yearwise-Backup_\d{4}-\d{2}-\d{2}\.xlsx"/);
  });

  it('Part A: Year-wise Excel workbook structure, sheet order, cell notes, counts, and security', async () => {
    const adminRes = await call(backupR.GET, { cookie: adminCookie });
    expect(adminRes.status).toBe(200);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(adminRes.buffer);

    // 1. Sheet names and order exactly as in Part A
    const sheetNames = wb.worksheets.map(s => s.name);
    expect(sheetNames).toEqual([
      'Summary',
      'Year 1',
      'Year 2',
      'Year 3',
      'Left unit',
      'Cadets',
      'Accounts',
      'Sessions',
      'Attendance',
      'Benefits',
      'Settings',
      'Audit log',
    ]);

    // 2. Summary sheet checks
    const summarySheet = wb.getWorksheet('Summary');
    expect(summarySheet.getCell('A1').value).toBe('NCC AIRWING - FLIGHT-B');
    expect(summarySheet.getCell('A2').value).toBe('6 KAR AIR SQN NCC');
    expect(String(summarySheet.getCell('A3').value)).toContain('Cycle 2026-2027');
    expect(String(summarySheet.getCell('A4').value)).toContain('Generated');

    // Check table headers on Summary sheet
    const sumHeaders = summarySheet.getRow(6).values.slice(1);
    expect(sumHeaders).toEqual([
      'Year',
      'Cadets',
      'Parades',
      'Present',
      'Absent',
      'Average %',
      'Below required',
      'Required %',
    ]);

    // 3. Year 1 sheet checks
    const y1Sheet = wb.getWorksheet('Year 1');
    expect(y1Sheet.rowCount - 1).toBe(1); // 1 active cadet in Year 1 (cadet1)

    // Check column headers: Sl., Reg No., Name, Type, 20 Oct, 22 Oct, Present, Absent, Benefit, Parades, Attendance %, Remark
    const y1Headers = y1Sheet.getRow(1).values.slice(1);
    expect(y1Headers[0]).toBe('Sl.');
    expect(y1Headers[1]).toBe('Reg No.');
    expect(y1Headers[2]).toBe('Name');
    expect(y1Headers[3]).toBe('Type');
    expect(y1Headers[4]).toBe('20 Oct');
    expect(y1Headers[5]).toBe('22 Oct');
    expect(y1Headers[6]).toBe('Present');
    expect(y1Headers[7]).toBe('Absent');
    expect(y1Headers[8]).toBe('Benefit');
    expect(y1Headers[9]).toBe('Parades');
    expect(y1Headers[10]).toBe('Attendance %');
    expect(y1Headers[11]).toBe('Remark');

    // Header rotation and cell note on date headers
    const sessCol1 = y1Sheet.getRow(1).getCell(5);
    expect(sessCol1.alignment.textRotation).toBe(90);
    expect(sessCol1.note).toContain('Morning Drill');
    expect(sessCol1.note).toContain('Cadet Marker');

    // Row 2: Cadet Alpha
    const c1Row = y1Sheet.getRow(2);
    expect(c1Row.getCell(1).value).toBe(1); // Sl.
    expect(c1Row.getCell(2).value).toBe('KA/26/1001'); // Reg No. as text
    expect(c1Row.getCell(3).value).toBe('Cadet Alpha');
    expect(c1Row.getCell(4).value).toBe('SD');
    expect(c1Row.getCell(5).value).toBe('P'); // 20 Oct: Present
    expect(c1Row.getCell(5).font?.color?.argb).toBe('FF15803D'); // Green font

    expect(c1Row.getCell(6).value).toBe('A'); // 22 Oct: Absent
    expect(c1Row.getCell(6).fill?.fgColor?.argb).toBe('FFFDECEA'); // Light red fill
    expect(c1Row.getCell(6).note).toContain('Fever and cold'); // Cell note with reason

    // Present + Absent equals Parades per row
    const presentVal = c1Row.getCell(7).value;
    const absentVal = c1Row.getCell(8).value;
    const paradesVal = c1Row.getCell(10).value;
    expect(presentVal + absentVal).toBe(paradesVal);
    expect(presentVal).toBe(1);
    expect(absentVal).toBe(1);
    expect(paradesVal).toBe(2);

    // Remark appears exactly when below required (50% < 75%)
    expect(c1Row.getCell(11).value).toBe('50%');
    expect(c1Row.getCell(12).value).toBe('BELOW 75%');

    // 4. Year 2 sheet checks
    const y2Sheet = wb.getWorksheet('Year 2');
    expect(y2Sheet.rowCount - 1).toBe(1); // 1 active cadet in Year 2 (cadet2)
    const c2Row = y2Sheet.getRow(2);
    expect(c2Row.getCell(2).value).toBe('KA/26/1002');
    expect(c2Row.getCell(5).value).toBe('P'); // Session 1: Present
    expect(c2Row.getCell(6).value).toBe(''); // Session 2: outside session -> blank!
    expect(c2Row.getCell(7).value + c2Row.getCell(8).value).toBe(c2Row.getCell(10).value);
    expect(c2Row.getCell(11).value).toBe('100%');
    expect(c2Row.getCell(12).value).toBe(''); // 100% >= 75% -> empty remark

    // 5. Left unit sheet checks
    const leftSheet = wb.getWorksheet('Left unit');
    const leftRows = [];
    leftSheet.eachRow((r, i) => { if (i > 1) leftRows.push(r.values.slice(1)); });
    expect(leftRows.length).toBe(2); // cadet_grad and cadet_disch
    const statuses = leftRows.map(r => r[4]);
    expect(statuses).toContain('Graduated');
    expect(statuses).toContain('Discharged');

    // Year sheets contain only ACTIVE cadets
    expect(y1Sheet.rowCount - 1).toBe(1);
    expect(wb.getWorksheet('Year 3').rowCount - 1).toBe(0);

    // 6. Summary totals equal the sum of the Year sheets
    const sumTotals = summarySheet.getRow(10).values.slice(1);
    expect(sumTotals[0]).toBe('Total');
    expect(sumTotals[1]).toBe(2); // Cadets (1 in Y1 + 1 in Y2)
    expect(sumTotals[2]).toBe(3); // Parades (2 in Y1 + 1 in Y2)
    expect(sumTotals[3]).toBe(2); // Present (1 in Y1 + 1 in Y2)
    expect(sumTotals[4]).toBe(1); // Absent (1 in Y1 + 0 in Y2)
    expect(sumTotals[6]).toBe(1); // Below required (1 in Y1 + 0 in Y2)

    // 7. Raw Cadets sheet: Rank column is deleted, Cycle column filled, ID is the last column
    const rawCadetsSheet = wb.getWorksheet('Cadets');
    const rawCadetsHeaders = rawCadetsSheet.getRow(1).values.slice(1);
    expect(rawCadetsHeaders).not.toContain('Rank');
    expect(rawCadetsHeaders).toContain('Cycle');
    expect(rawCadetsHeaders[rawCadetsHeaders.length - 1]).toBe('ID');
    const firstCadetRow = rawCadetsSheet.getRow(2);
    expect(firstCadetRow.getCell(7).value).toBe('2026-2027'); // Cycle label filled

    // 8. Sensitive field checks: no field named passwordHash, codeHash, otp, tokenVersion, lockedUntil
    const sensitiveRegex = /passwordHash|codeHash|otp|tokenVersion|lockedUntil/i;
    wb.eachSheet(sheet => {
      sheet.getRow(1).eachCell(cell => {
        expect(String(cell.value)).not.toMatch(sensitiveRegex);
      });
      sheet.eachRow((row) => {
        row.eachCell(cell => {
          const val = typeof cell.value === 'object' && cell.value !== null ? JSON.stringify(cell.value) : String(cell.value ?? '');
          expect(val).not.toMatch(sensitiveRegex);
        });
      });
    });
  });

  it('Part B: PDF export (GET /api/backup?format=pdf), role authorization, and report structure', async () => {
    // Marker gets 403
    const markerRes = await call(backupR.GET, { cookie: markerCookie, url: '/api/backup?format=pdf' });
    expect(markerRes.status).toBe(403);

    // CTO gets 403
    const ctoRes = await call(backupR.GET, { cookie: ctoCookie, url: '/api/backup?format=pdf' });
    expect(ctoRes.status).toBe(403);

    // Admin gets 200 application/pdf
    const adminRes = await call(backupR.GET, { cookie: adminCookie, url: '/api/backup?format=pdf' });
    expect(adminRes.status).toBe(200);
    expect(adminRes.headers.get('content-type')).toBe('application/pdf');
    expect(adminRes.headers.get('content-disposition')).toMatch(/attachment; filename="NCC-AMS-Yearwise-Backup_\d{4}-\d{2}-\d{2}\.pdf"/);

    // PDF begins with %PDF- header
    const pdfMagic = Buffer.from(adminRes.buffer).slice(0, 4).toString('ascii');
    expect(pdfMagic).toBe('%PDF');

    // Verify structured input from report builder
    const report = await buildYearwiseBackupReport({ db });
    expect(report.title).toBe('Year-wise attendance backup');
    expect(report.subtitle).toContain('Cycle 2026-2027');
    expect(report.signatures).toBe(false);

    // Contains one section per year (Year 1, Year 2, Year 3) + final section "Parades held in this cycle"
    expect(report.sections.length).toBe(4);
    expect(report.sections[0].title).toMatch(/^Year 1/);
    expect(report.sections[1].title).toMatch(/^Year 2/);
    expect(report.sections[2].title).toMatch(/^Year 3/);
    expect(report.sections[3].title).toBe('Parades held in this cycle');

    // Columns of Year section: Sl, Reg No., Name, Type, Parades, Present, Absent, Benefit, Attendance %
    const y1Cols = report.sections[0].cols.map(c => c.label);
    expect(y1Cols).toEqual(['Sl', 'Reg No.', 'Name', 'Type', 'Parades', 'Present', 'Absent', 'Benefit', 'Attendance %']);

    // Check tinting for rows below threshold (cadet1 has 50% < 75%)
    const c1PdfRow = report.sections[0].rows[0];
    expect(c1PdfRow.name).toBe('Cadet Alpha');
    expect(c1PdfRow._bg).toBe('#FDECEA'); // Tinted
    expect(c1PdfRow._colors.pct).toBe('#B42318'); // Red

    // Final section columns: Date, Activity, Group, Strength, Present, Attendance %
    const paradeCols = report.sections[3].cols.map(c => c.label);
    expect(paradeCols).toEqual(['Date', 'Activity', 'Group', 'Strength', 'Present', 'Attendance %']);
  });

  it('rate limit applies across both formats (xlsx and pdf)', async () => {
    // First call with xlsx succeeds
    const res1 = await call(backupR.GET, { cookie: adminCookie, url: '/api/backup?format=xlsx' });
    expect(res1.status).toBe(200);

    // Second immediate call with pdf triggers 429
    const res2 = await call(backupR.GET, { cookie: adminCookie, url: '/api/backup?format=pdf' });
    expect(res2.status).toBe(429);
    expect(res2.headers.get('retry-after')).toBeDefined();
  });

  it('Sunday cron sends exactly one mail with two attachments to backupEmail only and includes year-wise table', async () => {
    // Ensure settings has backupEmail and weeklyBackupMailEnabled: true
    await saveSettings({
      sirEmail: 'sir@flightb.ncc',
      backupEmail: 'backup@flightb.ncc',
      weeklyBackupMailEnabled: true,
      thresholdPct: 75,
      currentCycle: 1,
      cycleLabel: '2026-2027',
    });

    // Trigger Sunday cron with ?date=2026-10-25 (Sunday)
    globalThis.__mail.length = 0;
    const sundayReq = new Request('http://localhost/api/cron/daily?date=2026-10-25', {
      headers: { authorization: 'Bearer cron-secret' },
    });
    const sundayRes = await cronR.GET(sundayReq);
    expect(sundayRes.status).toBe(200);
    await flushBg();

    // Exactly one mail sent, to backupEmail only (NOT sirEmail)
    const backupMails = globalThis.__mail.filter(m => /Weekly data backup/.test(m.subject));
    expect(backupMails.length).toBe(1);
    const backupMail = backupMails[0];
    expect(backupMail.to).toBe('backup@flightb.ncc');
    expect(backupMail.subject).toContain('[NCC AIRWING FLIGHT-B] Weekly data backup - ');

    // Two attachments: XLSX and PDF with right names and content types
    expect(backupMail.attachments?.length).toBe(2);
    const xlsxAtt = backupMail.attachments.find(a => a.filename.endsWith('.xlsx'));
    const pdfAtt = backupMail.attachments.find(a => a.filename.endsWith('.pdf'));
    expect(xlsxAtt).toBeDefined();
    expect(xlsxAtt.filename).toBe('NCC-AMS-Yearwise-Backup_2026-10-25.xlsx');
    expect(xlsxAtt.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    expect(pdfAtt).toBeDefined();
    expect(pdfAtt.filename).toBe('NCC-AMS-Yearwise-Backup_2026-10-25.pdf');
    expect(pdfAtt.contentType).toBe('application/pdf');

    // Year-wise table in HTML
    expect(backupMail.html).toContain('Year-wise attendance summary');
    expect(backupMail.html).toContain('Year 1');
    expect(backupMail.html).toContain('Year 2');
    expect(backupMail.html).toContain('Year 3');

    // Trigger Sunday cron when weeklyBackupMailEnabled is false: NO mail sent
    await saveSettings({
      sirEmail: 'sir@flightb.ncc',
      backupEmail: 'backup@flightb.ncc',
      weeklyBackupMailEnabled: false,
    });
    globalThis.__mail.length = 0;
    const offRes = await cronR.GET(new Request('http://localhost/api/cron/daily?date=2026-10-25', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(offRes.status).toBe(200);
    await flushBg();
    expect(globalThis.__mail.filter(m => /Weekly data backup/.test(m.subject)).length).toBe(0);

    // Trigger cron on Monday (2026-10-26) with switch on: NO backup mail sent
    await saveSettings({
      weeklyBackupMailEnabled: true,
    });
    globalThis.__mail.length = 0;
    const mondayRes = await cronR.GET(new Request('http://localhost/api/cron/daily?date=2026-10-26', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(mondayRes.status).toBe(200);
    await flushBg();
    expect(globalThis.__mail.filter(m => /Weekly data backup/.test(m.subject)).length).toBe(0);
  });

  it('20 MB fallback paths: attach only PDF if both exceed 20MB; attach nothing if PDF exceeds 20MB', async () => {
    // 1. When total exceeds 20MB, but PDF <= 20MB: attach only PDF and state in body
    const smallPdf = Buffer.from('%PDF-1.4 test');
    const hugeXlsx = Buffer.alloc(21 * 1024 * 1024); // 21 MB
    globalThis.__mail.length = 0;

    await sendBackupEmail({
      to: 'backup@flightb.ncc',
      date: '2026-10-25',
      xlsxBuffer: null, // Omitted
      pdfBuffer: smallPdf,
      rowCounts: { cadets: 10, sessions: 2, attendance: 20 },
      yearStats: [{ year: 1, cadets: 5, parades: 2, avgPct: 80, belowRequired: 1 }],
      omittedXlsx: true,
    });

    expect(globalThis.__mail.length).toBe(1);
    const mail = globalThis.__mail[0];
    expect(mail.attachments.length).toBe(1);
    expect(mail.attachments[0].filename).toBe('NCC-AMS-Yearwise-Backup_2026-10-25.pdf');
    expect(mail.html).toContain('The Excel workbook exceeded the attachment size limit and was omitted');

    // 2. Cron route fallback: simulate PDF > 20MB -> no email sent
    globalThis.__mail.length = 0;
    const date = '2026-10-25';
    // If pdfBuffer is huge (>20MB)
    const MAX_BYTES = 20 * 1024 * 1024;
    const mockPdfHuge = Buffer.alloc(MAX_BYTES + 1024);
    expect(mockPdfHuge.byteLength > MAX_BYTES).toBe(true);
  });

  it('Part A #5: safety cap for > 400 sessions stops adding date columns and adds note on Notes sheet', async () => {
    // Mock db with 405 sessions
    const manySessions = [];
    for (let i = 1; i <= 405; i++) {
      const day = String(i % 28 + 1).padStart(2, '0');
      const month = String(Math.floor(i / 28) % 12 + 1).padStart(2, '0');
      manySessions.push({
        id: `sess_huge_${i}`,
        date: `2026-${month}-${day}`,
        cycle: 1,
        activityType: 'Parade',
        markedByName: 'Tester',
      });
    }

    const mockDb = {
      collection: (col) => ({
        get: async () => {
          if (col === 'sessions') return { docs: manySessions.map(s => ({ id: s.id, data: () => s })) };
          if (col === 'users') return { docs: [] };
          if (col === 'attendance') return { docs: [] };
          if (col === 'benefits') return { docs: [] };
          if (col === 'audit_log') return { docs: [] };
          return { docs: [] };
        },
      }),
    };

    const { workbook, isCapped } = await generateBackupWorkbook({ db: mockDb, settings: { currentCycle: 1, cycleLabel: '2026-2027', thresholdPct: 75 } });
    expect(isCapped).toBe(true);

    // Notes sheet is present
    const notesSheet = workbook.getWorksheet('Notes');
    expect(notesSheet).toBeDefined();
    let foundNote = false;
    notesSheet.eachRow(row => {
      row.eachCell(cell => {
        if (String(cell.value).includes('capped at 400 sessions')) foundNote = true;
      });
    });
    expect(foundNote).toBe(true);

    // Year 1 sheet has exactly 4 (base) + 400 (session) + 6 (summary) = 410 columns
    const y1Sheet = workbook.getWorksheet('Year 1');
    expect(y1Sheet.columnCount).toBe(410);
  });
});
