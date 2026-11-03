import ExcelJS from 'exceljs';
import { db as defaultDb, Collections, snapToArr } from '@/lib/firebase';
import { getSettings as fetchSettings } from '@/lib/settings';
import { todayIST, fmtDate, fmtDateTimeIST } from '@/lib/time';
import { personOrder, groupLabel, normStatus } from '@/lib/groups';
import { readStats } from '@/lib/stats';
import { buildTablePdf } from '@/lib/pdf';
import { UNIT } from '@/lib/brand';

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

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDayMonth(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const month = parseInt(parts[1], 10);
  return `${day} ${MONTH_NAMES[month - 1] || ''}`;
}

/**
 * Builds an ExcelJS Workbook with:
 * 1. Summary (top metadata, Year 1-3 stats table with Totals row)
 * 2. Year 1 (one column per session, Present/Absent/Benefit/Parades/Attendance %/Remark)
 * 3. Year 2 (same)
 * 4. Year 3 (same)
 * 5. Left unit (graduated, discharged, deactivated cadets)
 * 6. Cadets (raw sheet without Rank column, with cycleLabel)
 * 7. Accounts (admin, CTO, marker accounts: name, role, email, active, username)
 * 8. Sessions (all sessions)
 * 9. Attendance (all cycles, capped at 60,000 rows)
 * 10. Benefits (all benefits)
 * 11. Settings (non-secret keys only)
 * 12. Audit log (latest 2000 sanitized)
 * 13. Notes (if capped)
 */
export async function generateBackupWorkbook({ db = defaultDb, settings = null } = {}) {
  const currentSettings = settings || (await fetchSettings({ fresh: true }));
  const currentCycle = currentSettings.currentCycle || 1;
  const cycleLabel = currentSettings.cycleLabel || String(currentCycle);
  const requiredPct = currentSettings.thresholdPct ?? 75;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NCC AMS';
  workbook.created = new Date();

  // Load all raw data
  const [allUsersSnap, allSessionsSnap, allAttendanceSnap, benefitsSnap] = await Promise.all([
    db.collection(Collections.USERS).get(),
    db.collection(Collections.SESSIONS).get(),
    db.collection(Collections.ATTENDANCE).get(),
    db.collection(Collections.BENEFITS).get(),
  ]);

  const allUsers = snapToArr(allUsersSnap);
  const allCadets = allUsers.filter(u => u.role === 'cadet');
  const activeCadets = allCadets.filter(u => u.isActive !== false && !u.discharged);
  const leftCadets = allCadets.filter(u => !u.isActive || u.discharged).sort(personOrder);

  const allSessions = snapToArr(allSessionsSnap);
  allSessions.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  // Current cycle sessions sorted in ascending date order for the Year sheets
  const cycleSessions = allSessions
    .filter(s => (s.cycle || 1) === currentCycle)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  const isSessionsCapped = cycleSessions.length > 400;
  const sessionCols = isSessionsCapped ? cycleSessions.slice(0, 400) : cycleSessions;

  const allAttendance = snapToArr(allAttendanceSnap);
  const cycleAttendance = allAttendance.filter(a => (a.cycle || 1) === currentCycle);

  // Map for fast attendance lookup: `${sessionId}:${cadetId}` and `${sessionId}:${cadetRegNo}`
  const attMap = new Map();
  for (const a of cycleAttendance) {
    if (a.sessionId) {
      if (a.cadetId) attMap.set(`${a.sessionId}:${a.cadetId}`, a);
      if (a.cadetRegNo) attMap.set(`${a.sessionId}:${a.cadetRegNo}`, a);
    }
  }

  // Pre-calculate per-cadet session counts in current cycle
  const cadetStatsMap = new Map();
  for (const c of activeCadets) {
    let present = 0;
    let absent = 0;
    for (const s of sessionCols) {
      const rec = attMap.get(`${s.id}:${c.id}`) || (c.regNo ? attMap.get(`${s.id}:${c.regNo}`) : null);
      if (rec) {
        const st = normStatus(rec.status);
        if (st === 'Present') present++;
        else absent++;
      }
    }
    const benefit = Math.max(0, c.benefit || 0);
    const parades = present + absent;
    const credited = Math.min(parades, present + benefit);
    const pct = parades > 0 ? Math.round((credited / parades) * 1000) / 10 : 0;
    const belowRequired = pct < requiredPct;
    cadetStatsMap.set(c.id, { present, absent, benefit, parades, pct, belowRequired });
  }

  // Calculate year stats for Summary sheet and email body
  const yearStats = [1, 2, 3].map(y => {
    const yCadets = activeCadets.filter(c => c.year === y);
    let parades = 0;
    let present = 0;
    let absent = 0;
    let belowRequired = 0;

    for (const c of yCadets) {
      const st = cadetStatsMap.get(c.id) || { present: 0, absent: 0, benefit: 0, parades: 0, pct: 0, belowRequired: true };
      parades += st.parades;
      present += st.present;
      absent += st.absent;
      if (st.belowRequired) belowRequired++;
    }

    const avgPct = parades > 0 ? Math.round((present / parades) * 1000) / 10 : 0;
    return {
      year: y,
      cadets: yCadets.length,
      parades,
      present,
      absent,
      avgPct,
      belowRequired,
      requiredPct,
    };
  });

  const totalCadets = yearStats.reduce((n, y) => n + y.cadets, 0);
  const totalParades = yearStats.reduce((n, y) => n + y.parades, 0);
  const totalPresent = yearStats.reduce((n, y) => n + y.present, 0);
  const totalAbsent = yearStats.reduce((n, y) => n + y.absent, 0);
  const totalBelowReq = yearStats.reduce((n, y) => n + y.belowRequired, 0);
  const overallAvg = totalParades > 0 ? Math.round((totalPresent / totalParades) * 1000) / 10 : 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Summary sheet
  // ═══════════════════════════════════════════════════════════════════════════
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { width: 14 }, // Year
    { width: 12 }, // Cadets
    { width: 12 }, // Parades
    { width: 12 }, // Present
    { width: 12 }, // Absent
    { width: 14 }, // Average %
    { width: 16 }, // Below required
    { width: 14 }, // Required %
  ];

  summarySheet.addRow(['NCC AIRWING - FLIGHT-B']).font = { bold: true, size: 14 };
  summarySheet.addRow(['6 KAR AIR SQN NCC']).font = { bold: true, size: 11 };
  summarySheet.addRow([`Cycle ${cycleLabel}`]).font = { bold: true };
  summarySheet.addRow([`Generated ${fmtDateTimeIST(new Date().toISOString())}`]).font = { italic: true };
  summarySheet.addRow([]); // Blank spacer

  const sumHdrRow = summarySheet.addRow(['Year', 'Cadets', 'Parades', 'Present', 'Absent', 'Average %', 'Below required', 'Required %']);
  sumHdrRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sumHdrRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A5B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  sumHdrRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

  for (const ys of yearStats) {
    const row = summarySheet.addRow([
      `Year ${ys.year}`,
      ys.cadets,
      ys.parades,
      ys.present,
      ys.absent,
      `${ys.avgPct}%`,
      ys.belowRequired,
      `${requiredPct}%`,
    ]);
    row.eachCell((cell, colNumber) => {
      cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'left' : 'center' };
    });
  }

  const totalsRow = summarySheet.addRow([
    'Total',
    totalCadets,
    totalParades,
    totalPresent,
    totalAbsent,
    `${overallAvg}%`,
    totalBelowReq,
    `${requiredPct}%`,
  ]);
  totalsRow.font = { bold: true };
  totalsRow.eachCell((cell, colNumber) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F7FC' } };
    cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'left' : 'center' };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2, 3, 4. Year 1, Year 2, Year 3 sheets
  // ═══════════════════════════════════════════════════════════════════════════
  for (const y of [1, 2, 3]) {
    const sheetName = `Year ${y}`;
    const ws = workbook.addWorksheet(sheetName);
    const yCadets = activeCadets.filter(c => c.year === y).sort(personOrder);

    // Build header columns
    const columns = [
      { header: 'Sl.', key: 'sl', width: 6 },
      { header: 'Reg No.', key: 'regNo', width: 22 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Type', key: 'type', width: 8 },
    ];

    for (let i = 0; i < sessionCols.length; i++) {
      const s = sessionCols[i];
      columns.push({
        header: fmtDayMonth(s.date) || s.date,
        key: `sess_${i}`,
        width: 5,
      });
    }

    columns.push(
      { header: 'Present', key: 'present', width: 11 },
      { header: 'Absent', key: 'absent', width: 11 },
      { header: 'Benefit', key: 'benefit', width: 11 },
      { header: 'Parades', key: 'parades', width: 11 },
      { header: 'Attendance %', key: 'pct', width: 11 },
      { header: 'Remark', key: 'remark', width: 11 }
    );

    ws.columns = columns;

    // Format header row (Row 1)
    const headerRow = ws.getRow(1);
    headerRow.height = 70;
    headerRow.font = { bold: true };

    // Format fixed first 4 columns header
    for (let c = 1; c <= 4; c++) {
      const cell = headerRow.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A5B' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }

    // Format session date headers (rotated 90 degrees with note)
    for (let i = 0; i < sessionCols.length; i++) {
      const s = sessionCols[i];
      const cell = headerRow.getCell(5 + i);
      cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
      cell.font = { bold: true, size: 9 };
      const group = s.groupLabel || groupLabel(s.years) || 'All';
      const act = s.activityDescription ? `${s.activityType} - ${s.activityDescription}` : s.activityType;
      cell.note = `${act}\nGroup: ${group}\nMarked by: ${s.markedByName || '-'}`;
    }

    // Format summary columns header
    for (let c = 5 + sessionCols.length; c <= 10 + sessionCols.length; c++) {
      const cell = headerRow.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A5B' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }

    // Freeze header row and first 4 columns
    ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }];

    // Populate cadet rows
    for (let idx = 0; idx < yCadets.length; idx++) {
      const cadet = yCadets[idx];
      const st = cadetStatsMap.get(cadet.id) || { present: 0, absent: 0, benefit: 0, parades: 0, pct: 0, belowRequired: true };
      const remark = st.pct < requiredPct ? `BELOW ${requiredPct}%` : '';

      const rowValues = {
        sl: idx + 1,
        regNo: String(cadet.regNo || ''),
        name: cadet.name || '',
        type: cadet.type || 'SD',
        present: st.present,
        absent: st.absent,
        benefit: st.benefit,
        parades: st.parades,
        pct: `${st.pct}%`,
        remark,
      };

      for (let i = 0; i < sessionCols.length; i++) {
        const s = sessionCols[i];
        const rec = attMap.get(`${s.id}:${cadet.id}`) || (cadet.regNo ? attMap.get(`${s.id}:${cadet.regNo}`) : null);
        if (rec) {
          rowValues[`sess_${i}`] = normStatus(rec.status) === 'Present' ? 'P' : 'A';
        } else {
          rowValues[`sess_${i}`] = '';
        }
      }

      const row = ws.addRow(rowValues);
      row.height = 20;

      // Force Reg No. to be stored as plain text
      const regCell = row.getCell(2);
      regCell.numFmt = '@';
      regCell.value = String(cadet.regNo || '');

      // Center Sl., Reg No., Type
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell(3).alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };

      // Style session cells (P -> green font, A -> light red fill with note)
      for (let i = 0; i < sessionCols.length; i++) {
        const s = sessionCols[i];
        const rec = attMap.get(`${s.id}:${cadet.id}`) || (cadet.regNo ? attMap.get(`${s.id}:${cadet.regNo}`) : null);
        const cell = row.getCell(5 + i);
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (rec) {
          const isPresent = normStatus(rec.status) === 'Present';
          if (isPresent) {
            cell.font = { color: { argb: 'FF15803D' }, bold: true };
          } else {
            cell.font = { color: { argb: 'FFB42318' }, bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEA' } };
            cell.note = rec.reason || rec.remarks || 'Absent';
          }
        }
      }

      // Style summary columns
      for (let c = 5 + sessionCols.length; c <= 10 + sessionCols.length; c++) {
        const cell = row.getCell(c);
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }

      if (remark) {
        const remCell = row.getCell(10 + sessionCols.length);
        remCell.font = { color: { argb: 'FFB42318' }, bold: true };
      }
    }

    // Auto-filter covering all data columns
    const totalCols = 10 + sessionCols.length;
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, ws.rowCount), column: totalCols },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Left unit sheet (graduated, discharged, deactivated cadets)
  // ═══════════════════════════════════════════════════════════════════════════
  const leftSheet = workbook.addWorksheet('Left unit');
  leftSheet.columns = [
    { header: 'Reg No.', key: 'regNo', width: 22 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Last year', key: 'year', width: 12 },
    { header: 'Type', key: 'type', width: 8 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Parades', key: 'total', width: 11 },
    { header: 'Present', key: 'present', width: 11 },
    { header: 'Absent', key: 'absent', width: 11 },
    { header: 'Attendance %', key: 'pct', width: 14 },
  ];
  leftSheet.getRow(1).font = { bold: true };

  for (const c of leftCadets) {
    const s = c.stats || {};
    const status = c.discharged ? 'Discharged' : c.graduatedAt || c.year === 3 ? 'Graduated' : 'Removed';
    leftSheet.addRow({
      regNo: c.regNo || '',
      name: c.name || '',
      year: c.year ?? '',
      type: c.type || 'SD',
      status,
      total: s.total ?? 0,
      present: s.present ?? 0,
      absent: s.absent ?? 0,
      pct: readStats(c).pct ?? 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Cadets (raw sheet without Rank column, filled cycleLabel)
  // ═══════════════════════════════════════════════════════════════════════════
  const cadetsSheet = workbook.addWorksheet('Cadets');
  cadetsSheet.columns = [
    { header: 'ID', key: 'id', width: 22 },
    { header: 'Reg No.', key: 'regNo', width: 16 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Year', key: 'year', width: 8 },
    { header: 'Type', key: 'type', width: 8 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Cycle', key: 'cycle', width: 14 },
    { header: 'Active', key: 'isActive', width: 10 },
    { header: 'Discharged', key: 'discharged', width: 12 },
    { header: 'Total Parades', key: 'total', width: 14 },
    { header: 'Present', key: 'present', width: 10 },
    { header: 'Absent', key: 'absent', width: 10 },
    { header: 'Benefit', key: 'benefit', width: 10 },
    { header: 'Attendance %', key: 'pct', width: 14 },
  ];
  cadetsSheet.getRow(1).font = { bold: true };

  for (const c of allCadets) {
    const s = c.stats || {};
    cadetsSheet.addRow({
      id: c.id,
      regNo: c.regNo || '',
      name: c.name || '',
      year: c.year ?? '',
      type: c.type || '',
      email: c.email || '',
      phone: c.phone || '',
      cycle: cycleLabel,
      isActive: c.isActive !== false,
      discharged: c.discharged === true,
      total: s.total ?? 0,
      present: s.present ?? 0,
      absent: s.absent ?? 0,
      benefit: c.benefit ?? 0,
      pct: s.pct ?? (s.total ? Math.round(((s.present || 0) + (c.benefit || 0)) / s.total * 1000) / 10 : 0),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Accounts sheet (non-cadet accounts)
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Sessions sheet
  // ═══════════════════════════════════════════════════════════════════════════
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

  for (const s of allSessions) {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Attendance sheet (capped at 60,000)
  // ═══════════════════════════════════════════════════════════════════════════
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

  const isAttendanceCapped = allAttendance.length > 60000;
  const attendanceRows = isAttendanceCapped ? allAttendance.slice(0, 60000) : allAttendance;

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

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. Benefits sheet
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. Settings sheet (non-secret keys only)
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. Audit log sheet (latest 2000)
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. Notes sheet (if Attendance or Session columns were capped)
  // ═══════════════════════════════════════════════════════════════════════════
  const isCapped = isAttendanceCapped || isSessionsCapped;
  if (isCapped) {
    const notesSheet = workbook.addWorksheet('Notes');
    notesSheet.columns = [{ header: 'Note', key: 'note', width: 80 }];
    notesSheet.getRow(1).font = { bold: true };
    if (isAttendanceCapped) {
      notesSheet.addRow({
        note: 'Attendance sheet is capped at 60,000 rows. Older records were omitted to maintain spreadsheet stability and performance.',
      });
    }
    if (isSessionsCapped) {
      notesSheet.addRow({
        note: 'Date columns on Year sheets capped at 400 sessions.',
      });
    }
  }

  return {
    workbook,
    rowCounts: {
      cadets: allCadets.length,
      accounts: nonCadets.length,
      sessions: allSessions.length,
      attendance: attendanceRows.length,
      benefits: benefits.length,
      auditLogs: auditEntries.length,
    },
    yearStats,
    isCapped,
  };
}

/**
 * Builds structured data for Year-wise PDF report.
 */
export async function buildYearwiseBackupReport({ db = defaultDb, settings = null } = {}) {
  const currentSettings = settings || (await fetchSettings({ fresh: true }));
  const currentCycle = currentSettings.currentCycle || 1;
  const cycleLabel = currentSettings.cycleLabel || String(currentCycle);
  const requiredPct = currentSettings.thresholdPct ?? 75;

  const [allUsersSnap, allSessionsSnap, allAttendanceSnap] = await Promise.all([
    db.collection(Collections.USERS).get(),
    db.collection(Collections.SESSIONS).get(),
    db.collection(Collections.ATTENDANCE).get(),
  ]);

  const allUsers = snapToArr(allUsersSnap);
  const activeCadets = allUsers.filter(u => u.role === 'cadet' && u.isActive !== false && !u.discharged);
  const allSessions = snapToArr(allSessionsSnap);
  const cycleSessions = allSessions
    .filter(s => (s.cycle || 1) === currentCycle)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  const allAttendance = snapToArr(allAttendanceSnap);
  const cycleAttendance = allAttendance.filter(a => (a.cycle || 1) === currentCycle);

  const attMap = new Map();
  for (const a of cycleAttendance) {
    if (a.sessionId) {
      if (a.cadetId) attMap.set(`${a.sessionId}:${a.cadetId}`, a);
      if (a.cadetRegNo) attMap.set(`${a.sessionId}:${a.cadetRegNo}`, a);
    }
  }

  // Pre-calculate per-cadet statistics
  const cadetStats = [];
  for (const c of activeCadets) {
    let present = 0;
    let absent = 0;
    for (const s of cycleSessions) {
      const rec = attMap.get(`${s.id}:${c.id}`) || (c.regNo ? attMap.get(`${s.id}:${c.regNo}`) : null);
      if (rec) {
        if (normStatus(rec.status) === 'Present') present++;
        else absent++;
      }
    }
    const benefit = Math.max(0, c.benefit || 0);
    const parades = present + absent;
    const credited = Math.min(parades, present + benefit);
    const pct = parades > 0 ? Math.round((credited / parades) * 1000) / 10 : 0;
    cadetStats.push({
      ...c,
      present,
      absent,
      benefit,
      parades,
      pct,
    });
  }

  const sections = [];
  let totalAllParades = 0;
  let totalAllPresent = 0;
  let totalBelowReq = 0;

  for (const y of [1, 2, 3]) {
    const yCadets = cadetStats.filter(c => c.year === y).sort(personOrder);
    const yParades = yCadets.reduce((n, c) => n + c.parades, 0);
    const yPresent = yCadets.reduce((n, c) => n + c.present, 0);
    const yAvg = yParades > 0 ? Math.round((yPresent / yParades) * 1000) / 10 : 0;

    totalAllParades += yParades;
    totalAllPresent += yPresent;
    totalBelowReq += yCadets.filter(c => c.pct < requiredPct).length;

    const rows = yCadets.map((c, i) => {
      const isLow = c.pct < requiredPct;
      return {
        sl: i + 1,
        regNo: c.regNo || '-',
        name: c.name || '-',
        type: c.type || 'SD',
        parades: c.parades,
        present: c.present,
        absent: c.absent,
        benefit: c.benefit,
        pct: `${c.pct}%`,
        _bg: isLow ? '#FDECEA' : undefined,
        _colors: { pct: isLow ? '#B42318' : '#15803D' },
        _bold: { pct: true },
      };
    });

    sections.push({
      title: `Year ${y} - ${yCadets.length} cadets - average ${yAvg}%`,
      cols: [
        { key: 'sl', label: 'Sl', w: 26, align: 'center' },
        { key: 'regNo', label: 'Reg No.', w: 105 },
        { key: 'name', label: 'Name', w: 140 },
        { key: 'type', label: 'Type', w: 38, align: 'center' },
        { key: 'parades', label: 'Parades', w: 42, align: 'center' },
        { key: 'present', label: 'Present', w: 42, align: 'center' },
        { key: 'absent', label: 'Absent', w: 42, align: 'center' },
        { key: 'benefit', label: 'Benefit', w: 42, align: 'center' },
        { key: 'pct', label: 'Attendance %', w: 46, align: 'center' },
      ],
      rows,
      empty: `No active cadets in Year ${y}`,
    });
  }

  // Final section: Parades held in this cycle
  const paradeRows = cycleSessions.map(s => {
    const pctVal = s.pct ?? (s.total ? Math.round((s.present / s.total) * 1000) / 10 : 0);
    return {
      date: fmtDate(s.date),
      activity: s.activityDescription ? `${s.activityType} - ${s.activityDescription}` : s.activityType,
      group: s.groupLabel || groupLabel(s.years) || 'All',
      strength: s.total ?? 0,
      present: s.present ?? 0,
      pct: `${pctVal}%`,
      _colors: { pct: pctVal >= requiredPct ? '#15803D' : '#B42318' },
    };
  });

  sections.push({
    title: 'Parades held in this cycle',
    cols: [
      { key: 'date', label: 'Date', w: 68 },
      { key: 'activity', label: 'Activity', w: 175 },
      { key: 'group', label: 'Group', w: 90 },
      { key: 'strength', label: 'Strength', w: 60, align: 'center' },
      { key: 'present', label: 'Present', w: 60, align: 'center' },
      { key: 'pct', label: 'Attendance %', w: 70, align: 'center' },
    ],
    rows: paradeRows,
    empty: 'No parades recorded in this cycle',
  });

  const overallAvg = totalAllParades > 0 ? Math.round((totalAllPresent / totalAllParades) * 1000) / 10 : 0;

  return {
    title: 'Year-wise attendance backup',
    subtitle: `Cycle ${cycleLabel}`,
    info: [
      ['Unit', `${UNIT.wing} ${UNIT.flight}`],
      ['Squadron', UNIT.squadron],
      ['Cycle', cycleLabel],
      ['Required percentage', `${requiredPct}%`],
      ['Generated time', fmtDateTimeIST(new Date().toISOString())],
    ],
    tiles: [
      ['Cadets', activeCadets.length, '#0B2A5B', '#E8EEF9'],
      ['Parades', cycleSessions.length, '#0A84FF', '#F4F7FC'],
      ['Average', `${overallAvg}%`, overallAvg >= requiredPct ? '#15803D' : '#B42318', overallAvg >= requiredPct ? '#E8F6EC' : '#FDECEA'],
      ['Below required', totalBelowReq, totalBelowReq > 0 ? '#B42318' : '#15803D', totalBelowReq > 0 ? '#FDECEA' : '#E8F6EC'],
    ],
    sections,
    signatures: false,
  };
}

/**
 * Builds Year-wise backup PDF buffer using buildTablePdf.
 */
export async function buildYearwiseBackupPdf({ db = defaultDb, settings = null, report = null } = {}) {
  const rep = report || (await buildYearwiseBackupReport({ db, settings }));
  return buildTablePdf(rep);
}

/**
 * Builds binary buffer for PDF download/attachment.
 */
export async function buildBackupPdfBuffer({ db = defaultDb, settings = null, date = todayIST() } = {}) {
  const report = await buildYearwiseBackupReport({ db, settings });
  const buffer = await buildYearwiseBackupPdf({ db, settings, report });
  const filename = `NCC-AMS-Yearwise-Backup_${date}.pdf`;
  return {
    buffer,
    filename,
    report,
  };
}

/**
 * Builds the binary Excel buffer for download or attachment.
 */
export async function buildBackupBuffer({ db = defaultDb, settings = null, date = todayIST() } = {}) {
  const { workbook, rowCounts, isCapped, yearStats } = await generateBackupWorkbook({ db, settings });
  const rawBuffer = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(rawBuffer);
  const filename = `NCC-AMS-Yearwise-Backup_${date}.xlsx`;

  return {
    buffer,
    filename,
    rowCounts,
    isCapped,
    yearStats,
  };
}
