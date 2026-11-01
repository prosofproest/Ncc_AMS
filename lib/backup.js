import ExcelJS from 'exceljs';
import { db as defaultDb, Collections, snapToArr } from '@/lib/firebase';
import { getSettings as fetchSettings } from '@/lib/settings';
import { todayIST } from '@/lib/time';

const SENSITIVE_KEYS = new Set([
  'passwordHash',
  'codeHash',
  'otp',
  'otpData',
  'tokenVersion',
  'lockedUntil',
  'failedLogins',
  'privateKey',
  'clientEmail',
  'cronSecret',
  'jwtSecret',
  'emailPass',
]);

const NON_SECRET_SETTINGS_KEYS = [
  'sirEmail',
  'backupEmail',
  'weeklyBackupMailEnabled',
  'absenceMailEnabled',
  'changeMailEnabled',
  'monthlyMailEnabled',
  'notifyAdminOnReturn',
  'notifyCtoOnAdminApproval',
  'thresholdPct',
  'currentCycle',
  'cycleLabel',
  'cycleStartedAt',
  'lastSheetImportAt',
  'requirePhotos',
  'absentReasons',
];

/**
 * Builds an ExcelJS Workbook with:
 * - Cadets (every cadet, all cycles, with stats, NO passwordHash)
 * - Accounts (admin, CTO, marker accounts: name, role, e-mail, active; no hashes, no tokens)
 * - Sessions (all sessions)
 * - Attendance (all cycles, capped at 60,000 rows)
 * - Benefits (all benefits)
 * - Settings (non-secret keys only)
 * - Audit log (latest 2000)
 * - Notes (if Attendance is capped at 60,000 rows)
 */
export async function generateBackupWorkbook({ db = defaultDb, settings = null } = {}) {
  const currentSettings = settings || (await fetchSettings({ fresh: true }));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NCC AMS';
  workbook.created = new Date();

  // 1. Cadets sheet
  const cadetsSheet = workbook.addWorksheet('Cadets');
  cadetsSheet.columns = [
    { header: 'ID', key: 'id', width: 22 },
    { header: 'Reg No.', key: 'regNo', width: 16 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Rank', key: 'rank', width: 10 },
    { header: 'Year', key: 'year', width: 8 },
    { header: 'Type', key: 'type', width: 8 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Cycle', key: 'cycle', width: 8 },
    { header: 'Active', key: 'isActive', width: 10 },
    { header: 'Discharged', key: 'discharged', width: 12 },
    { header: 'Total Parades', key: 'total', width: 14 },
    { header: 'Present', key: 'present', width: 10 },
    { header: 'Absent', key: 'absent', width: 10 },
    { header: 'Benefit', key: 'benefit', width: 10 },
    { header: 'Attendance %', key: 'pct', width: 14 },
  ];
  cadetsSheet.getRow(1).font = { bold: true };

  const allUsersSnap = await db.collection(Collections.USERS).get();
  const allUsers = snapToArr(allUsersSnap);
  const cadets = allUsers.filter(u => u.role === 'cadet');

  for (const c of cadets) {
    const s = c.stats || {};
    cadetsSheet.addRow({
      id: c.id,
      regNo: c.regNo || '',
      name: c.name || '',
      rank: c.rank || '',
      year: c.year ?? '',
      type: c.type || '',
      email: c.email || '',
      phone: c.phone || '',
      cycle: c.cycle ?? '',
      isActive: c.isActive !== false,
      discharged: c.discharged === true,
      total: s.total ?? 0,
      present: s.present ?? 0,
      absent: s.absent ?? 0,
      benefit: c.benefit ?? 0,
      pct: s.pct ?? (s.total ? Math.round(((s.present || 0) + (c.benefit || 0)) / s.total * 1000) / 10 : 0),
    });
  }

  // 2. Accounts sheet (non-cadet accounts)
  const accountsSheet = workbook.addWorksheet('Accounts');
  accountsSheet.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Role', key: 'role', width: 14 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Active', key: 'isActive', width: 10 },
    { header: 'Username', key: 'username', width: 18 },
  ];
  accountsSheet.getRow(1).font = { bold: true };

  const nonCadets = allUsers.filter(u => u.role !== 'cadet');
  for (const u of nonCadets) {
    accountsSheet.addRow({
      name: u.name || u.id,
      role: u.role || '',
      email: u.email || '',
      isActive: u.isActive !== false,
      username: u.username || u.id,
    });
  }

  // 3. Sessions sheet
  const sessionsSheet = workbook.addWorksheet('Sessions');
  sessionsSheet.columns = [
    { header: 'Session ID', key: 'id', width: 24 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Activity Type', key: 'activityType', width: 18 },
    { header: 'Description', key: 'activityDescription', width: 26 },
    { header: 'Group', key: 'groupLabel', width: 16 },
    { header: 'Years', key: 'years', width: 12 },
    { header: 'Present', key: 'present', width: 10 },
    { header: 'Absent', key: 'absent', width: 10 },
    { header: 'Total', key: 'total', width: 10 },
    { header: 'Attendance %', key: 'pct', width: 14 },
    { header: 'Marked By', key: 'markedByName', width: 20 },
    { header: 'Lat', key: 'geoLat', width: 12 },
    { header: 'Lng', key: 'geoLng', width: 12 },
    { header: 'Photos Count', key: 'photosCount', width: 14 },
    { header: 'Created At', key: 'createdAt', width: 24 },
  ];
  sessionsSheet.getRow(1).font = { bold: true };

  const sessionsSnap = await db.collection(Collections.SESSIONS).get();
  const sessions = snapToArr(sessionsSnap);
  sessions.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  for (const s of sessions) {
    sessionsSheet.addRow({
      id: s.id,
      date: s.date || '',
      activityType: s.activityType || '',
      activityDescription: s.activityDescription || '',
      groupLabel: s.groupLabel || '',
      years: Array.isArray(s.years) ? s.years.join(', ') : (s.years || ''),
      present: s.present ?? 0,
      absent: s.absent ?? 0,
      total: s.total ?? 0,
      pct: s.pct ?? 0,
      markedByName: s.markedByName || '',
      geoLat: s.geoLat ?? '',
      geoLng: s.geoLng ?? '',
      photosCount: Array.isArray(s.photoUrls) ? s.photoUrls.length : 0,
      createdAt: s.createdAt || '',
    });
  }

  // 4. Attendance sheet (capped at 60,000)
  const attendanceSheet = workbook.addWorksheet('Attendance');
  attendanceSheet.columns = [
    { header: 'Session ID', key: 'sessionId', width: 24 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Reg No.', key: 'cadetRegNo', width: 16 },
    { header: 'Cadet Name', key: 'cadetName', width: 24 },
    { header: 'Year', key: 'cadetYear', width: 8 },
    { header: 'Type', key: 'cadetType', width: 8 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Reason', key: 'reason', width: 22 },
    { header: 'Cycle', key: 'cycle', width: 8 },
    { header: 'Marked At', key: 'createdAt', width: 24 },
  ];
  attendanceSheet.getRow(1).font = { bold: true };

  const attendanceSnap = await db.collection(Collections.ATTENDANCE).get();
  const allAttendance = snapToArr(attendanceSnap);
  const isCapped = allAttendance.length > 60000;
  const attendanceRows = isCapped ? allAttendance.slice(0, 60000) : allAttendance;

  for (const a of attendanceRows) {
    attendanceSheet.addRow({
      sessionId: a.sessionId || '',
      date: a.date || '',
      cadetRegNo: a.cadetRegNo || '',
      cadetName: a.cadetName || '',
      cadetYear: a.cadetYear ?? '',
      cadetType: a.cadetType || '',
      status: a.status || '',
      reason: a.reason || a.remarks || '',
      cycle: a.cycle ?? '',
      createdAt: a.createdAt || '',
    });
  }

  // 5. Benefits sheet
  const benefitsSheet = workbook.addWorksheet('Benefits');
  benefitsSheet.columns = [
    { header: 'Benefit ID', key: 'id', width: 22 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Reg No.', key: 'cadetRegNo', width: 16 },
    { header: 'Cadet Name', key: 'cadetName', width: 24 },
    { header: 'Benefit Count', key: 'hours', width: 14 },
    { header: 'Reason', key: 'reason', width: 24 },
    { header: 'Added By', key: 'byName', width: 20 },
    { header: 'Created At', key: 'createdAt', width: 24 },
  ];
  benefitsSheet.getRow(1).font = { bold: true };

  const benefitsSnap = await db.collection(Collections.BENEFITS).get();
  const benefits = snapToArr(benefitsSnap);
  for (const b of benefits) {
    benefitsSheet.addRow({
      id: b.id,
      date: b.date || '',
      cadetRegNo: b.cadetRegNo || '',
      cadetName: b.cadetName || '',
      hours: b.hours ?? b.count ?? 1,
      reason: b.reason || '',
      byName: b.byName || '',
      createdAt: b.at || b.createdAt || '',
    });
  }

  // 6. Settings sheet (non-secret keys only)
  const settingsSheet = workbook.addWorksheet('Settings');
  settingsSheet.columns = [
    { header: 'Setting', key: 'key', width: 30 },
    { header: 'Value', key: 'value', width: 50 },
  ];
  settingsSheet.getRow(1).font = { bold: true };

  for (const k of NON_SECRET_SETTINGS_KEYS) {
    if (currentSettings[k] !== undefined) {
      const val = currentSettings[k];
      settingsSheet.addRow({
        key: k,
        value: Array.isArray(val) ? val.join(', ') : String(val ?? ''),
      });
    }
  }

  // 7. Audit log sheet (latest 2000)
  const auditSheet = workbook.addWorksheet('Audit log');
  auditSheet.columns = [
    { header: 'Timestamp', key: 'at', width: 24 },
    { header: 'Type', key: 'type', width: 18 },
    { header: 'User ID', key: 'by', width: 20 },
    { header: 'User Name', key: 'byName', width: 22 },
    { header: 'Note', key: 'note', width: 32 },
    { header: 'Details', key: 'details', width: 44 },
  ];
  auditSheet.getRow(1).font = { bold: true };

  let auditEntries = [];
  try {
    const auditSnap = await db.collection(Collections.AUDIT_LOG).orderBy('at', 'desc').limit(2000).get();
    auditEntries = snapToArr(auditSnap);
  } catch {
    const fallbackSnap = await db.collection(Collections.AUDIT_LOG).get();
    auditEntries = snapToArr(fallbackSnap)
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, 2000);
  }

  for (const a of auditEntries) {
    // Sanitize any changes or payload to ensure no sensitive fields leak into audit export
    let details = '';
    if (a.changes) {
      const sanitizedChanges = a.changes.filter(c => !SENSITIVE_KEYS.has(c.name));
      details = JSON.stringify(sanitizedChanges);
    } else if (a.note || a.reason) {
      details = a.note || a.reason;
    }

    auditSheet.addRow({
      at: a.at || '',
      type: a.type || '',
      by: a.by || a.userId || '',
      byName: a.byName || '',
      note: a.note || '',
      details,
    });
  }

  // 8. Notes sheet (if Attendance sheet was capped at 60,000 rows)
  if (isCapped) {
    const notesSheet = workbook.addWorksheet('Notes');
    notesSheet.columns = [
      { header: 'Note', key: 'note', width: 80 },
    ];
    notesSheet.getRow(1).font = { bold: true };
    notesSheet.addRow({
      note: 'Attendance sheet is capped at 60,000 rows. Older records were omitted to maintain spreadsheet stability and performance.',
    });
  }

  return {
    workbook,
    rowCounts: {
      cadets: cadets.length,
      accounts: nonCadets.length,
      sessions: sessions.length,
      attendance: attendanceRows.length,
      benefits: benefits.length,
      auditLogs: auditEntries.length,
    },
    isCapped,
  };
}

/**
 * Builds the binary Excel buffer for download or attachment.
 */
export async function buildBackupBuffer({ db = defaultDb, settings = null, date = todayIST() } = {}) {
  const { workbook, rowCounts, isCapped } = await generateBackupWorkbook({ db, settings });
  const rawBuffer = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(rawBuffer);
  const filename = `NCC-AMS-backup-${date}.xlsx`;

  return {
    buffer,
    filename,
    rowCounts,
    isCapped,
  };
}
