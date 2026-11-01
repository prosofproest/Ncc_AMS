// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { call, flushBg } from './helpers/http.js';
import { installBrowser } from './helpers/browser.js';
import * as loginR from '@/app/api/auth/login/route';
import * as backupR from '@/app/api/backup/route';
import * as cronR from '@/app/api/cron/daily/route';
import { generateBackupWorkbook } from '@/lib/backup';
import { summariesDue } from '@/lib/summary';
import { saveSettings } from '@/lib/settings';

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

    // Populate cadets
    await db.collection('users').doc('cadet1').set({
      role: 'cadet', username: 'cadet1', name: 'Cadet Alpha', regNo: 'KA/26/1001',
      year: 1, type: 'SD', email: 'cadet1@example.com', phone: '9876543210', cycle: 1,
      isActive: true, discharged: false, stats,
    });
    await db.collection('users').doc('cadet2').set({
      role: 'cadet', username: 'cadet2', name: 'Cadet Bravo', regNo: 'KA/26/1002',
      year: 2, type: 'SW', email: 'cadet2@example.com', phone: '9876543211', cycle: 1,
      isActive: true, discharged: false, stats,
    });

    // Populate sessions
    await db.collection('sessions').doc('session_1').set({
      date: '2026-10-20', activityType: 'Parade', activityDescription: 'Morning Drill',
      groupLabel: 'Year 1 & 2', years: [1, 2], present: 2, absent: 0, total: 2, pct: 100,
      markedByName: 'Cadet Marker', createdAt: '2026-10-20T06:00:00Z', cycle: 1,
    });

    // Populate attendance records
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
    expect(adminRes.headers.get('content-disposition')).toMatch(/attachment; filename="NCC-AMS-backup-\d{4}-\d{2}-\d{2}\.xlsx"/);
  });

  it('workbook contains no sensitive fields and row counts match fake database', async () => {
    const adminRes = await call(backupR.GET, { cookie: adminCookie });
    expect(adminRes.status).toBe(200);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(adminRes.buffer);

    // Verify sheet names
    const sheetNames = wb.worksheets.map(s => s.name);
    expect(sheetNames).toContain('Cadets');
    expect(sheetNames).toContain('Accounts');
    expect(sheetNames).toContain('Sessions');
    expect(sheetNames).toContain('Attendance');
    expect(sheetNames).toContain('Benefits');
    expect(sheetNames).toContain('Settings');
    expect(sheetNames).toContain('Audit log');

    // Sensitive field checks: no field named passwordHash, codeHash, otp, tokenVersion, lockedUntil
    const sensitiveRegex = /passwordHash|codeHash|otp|tokenVersion|lockedUntil/i;
    wb.eachSheet(sheet => {
      // Check column headers
      const row1 = sheet.getRow(1);
      row1.eachCell(cell => {
        expect(String(cell.value)).not.toMatch(sensitiveRegex);
      });

      // Check all cell contents in sheet
      sheet.eachRow((row, rowNumber) => {
        row.eachCell(cell => {
          const val = typeof cell.value === 'object' && cell.value !== null ? JSON.stringify(cell.value) : String(cell.value ?? '');
          expect(val).not.toMatch(sensitiveRegex);
        });
      });
    });

    // Verify row counts (excluding header row)
    const cadetsSheet = wb.getWorksheet('Cadets');
    expect(cadetsSheet.rowCount - 1).toBe(2); // cadet1, cadet2

    const accountsSheet = wb.getWorksheet('Accounts');
    expect(accountsSheet.rowCount - 1).toBe(3); // admin, sir, marker

    const sessionsSheet = wb.getWorksheet('Sessions');
    expect(sessionsSheet.rowCount - 1).toBe(1); // session_1

    const attendanceSheet = wb.getWorksheet('Attendance');
    expect(attendanceSheet.rowCount - 1).toBe(2); // att_1, att_2

    const benefitsSheet = wb.getWorksheet('Benefits');
    expect(benefitsSheet.rowCount - 1).toBe(1); // ben_1

    // Verify audit log has the backup-download entry
    const auditLogs = db.all('audit_log').map(d => d.data);
    const backupAudit = auditLogs.find(a => a.type === 'backup-download');
    expect(backupAudit).toBeDefined();
    expect(backupAudit.by).toBe('admin');
  });

  it('returns 429 when called a second time within a minute', async () => {
    // First call succeeds
    const firstRes = await call(backupR.GET, { cookie: adminCookie });
    expect(firstRes.status).toBe(200);

    // Immediate second call triggers rate limit (429)
    const secondRes = await call(backupR.GET, { cookie: adminCookie });
    expect(secondRes.status).toBe(429);
    expect(secondRes.headers.get('retry-after')).toBeDefined();
  });

  it('Sunday cron sends exactly one mail with attachment to backupEmail only', async () => {
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
    expect(backupMail.attachments?.length).toBe(1);
    expect(backupMail.attachments[0].filename).toContain('backup_2026-10-25.xlsx');

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
});
