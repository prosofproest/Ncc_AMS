// Builds every downloadable report from the database, then renders it as PDF / Excel / CSV.
import { db, Collections, snapToArr } from '@/lib/firebase';
import { getSettings, cleanEmail } from '@/lib/settings';
import { getAllUsers } from '@/lib/users';
import { readStats } from '@/lib/stats';
import { personOrder, summarize, normStatus, yearTag } from '@/lib/groups';
import { fmtDate, fmtDateLong, fmtMonthLong, fmtDateTimeIST, isValidDate, todayIST } from '@/lib/time';
import { buildTablePdf, buildParadeReportPdf } from '@/lib/pdf';
import { UNIT } from '@/lib/brand';

const NAVY = '#0B2A5B', GREEN = '#15803D', RED = '#B42318', GREENBG = '#E8F6EC', REDBG = '#FDECEA', BLUEBG = '#E8EEF9';
const CW = 523;
const typeOf = r => (r.cadetType || r.type || 'SD');

async function loadRecords({ cycle, from, to, cadetId, date, allCycles }) {
  let recs;
  if (date) recs = snapToArr(await db.collection(Collections.ATTENDANCE).where('date', '==', date).get()).filter(r => (r.cycle || 1) === cycle);
  else if (cadetId) {
    recs = snapToArr(await db.collection(Collections.ATTENDANCE).where('cadetId', '==', cadetId).get());
    if (!allCycles) recs = recs.filter(r => (r.cycle || 1) === cycle);
  } else recs = snapToArr(await db.collection(Collections.ATTENDANCE).where('cycle', '==', cycle).get());
  if (from) recs = recs.filter(r => r.date >= from);
  if (to) recs = recs.filter(r => r.date <= to);
  return recs.map(r => ({ ...r, status: normStatus(r.status), reason: r.reason || r.remarks || '' }));
}
async function loadSessions(cycle, from, to) {
  let s = snapToArr(await db.collection(Collections.SESSIONS).where('cycle', '==', cycle).get());
  if (from) s = s.filter(x => x.date >= from);
  if (to) s = s.filter(x => x.date <= to);
  return s.sort((a, b) => a.date.localeCompare(b.date));
}

const pctCell = (p, th) => ({ text: p === null ? '-' : `${p}%`, color: p === null ? '#667085' : p >= th ? GREEN : RED });

// Per-cadet aggregation over a set of records
function perCadet(records, users) {
  const m = new Map();
  for (const r of records) {
    if (!m.has(r.cadetId)) m.set(r.cadetId, { cadetId: r.cadetId, cadetName: r.cadetName, cadetRegNo: r.cadetRegNo, cadetYear: r.cadetYear, cadetType: r.cadetType, cadetRole: r.cadetRole, total: 0, present: 0, absent: 0 });
    const c = m.get(r.cadetId); c.total++; r.status === 'Present' ? c.present++ : c.absent++;
  }
  return [...m.values()].sort(personOrder);
}

export async function buildReport(type, p, actor) {
  const settings = await getSettings();
  const th = settings.thresholdPct || 75;
  const cycle = p.cycle ? parseInt(p.cycle, 10) : settings.currentCycle;
  const stamp = ['Generated', fmtDateTimeIST(new Date().toISOString())];
  const unitInfo = [['Unit', `${UNIT.wing} ${UNIT.flight}`], ['Squadron', UNIT.squadron]];

  // ── a single day (all sessions that day) ──────────────────────────────────────
  if (type === 'day') {
    if (!isValidDate(p.date)) throw new Error('Choose a valid date.');
    const records = await loadRecords({ date: p.date, cycle });
    if (!records.length) throw new Error(`No attendance has been submitted for ${fmtDate(p.date)}.`);
    const sessions = snapToArr(await db.collection(Collections.SESSIONS).where('date', '==', p.date).get()).filter(x => (x.cycle || 1) === cycle);
    const one = sessions.length === 1 ? sessions[0] : {
      date: p.date, activityType: sessions.length ? [...new Set(sessions.map(s => s.activityType))].join(' + ') : 'Attendance',
      groupLabel: sessions.length > 1 ? 'All sessions of the day' : 'All', markedByName: [...new Set(sessions.map(s => s.markedByName))].join(', '),
      createdAt: sessions[0]?.createdAt, updatedAt: sessions.at(-1)?.updatedAt,
    };
    return { kind: 'parade', session: one, records, threshold: th, name: `Day-Report_${p.date}` };
  }

  // ── month / custom range ──────────────────────────────────────────────────────
  if (type === 'month' || type === 'range') {
    let from, to, label;
    if (type === 'month') {
      if (!/^\d{4}-\d{2}$/.test(p.month || '')) throw new Error('Choose a month.');
      from = `${p.month}-01`; to = `${p.month}-31`; label = fmtMonthLong(p.month);
    } else {
      if (!isValidDate(p.from) || !isValidDate(p.to) || p.from > p.to) throw new Error('Choose a valid date range.');
      from = p.from; to = p.to; label = `${fmtDate(from)} to ${fmtDate(to)}`;
    }
    const [records, sessions, users] = await Promise.all([loadRecords({ cycle, from, to }), loadSessions(cycle, from, to), getAllUsers()]);
    if (!records.length) throw new Error(`No attendance recorded for ${label}.`);
    const cad = perCadet(records, users);
    const sum = summarize(records);
    const rows = cad.map((c, i) => {
      const pct = c.total ? Math.round(c.present / c.total * 1000) / 10 : null;
      return { sl: i + 1, reg: c.cadetRegNo || '-', name: c.cadetName, yr: yearTag(c), type: typeOf(c), parades: c.total, present: c.present, absent: c.absent, pct: pct === null ? '-' : `${pct}%`,
        _colors: { absent: c.absent ? RED : '#1B2433', pct: pct !== null && pct < th ? RED : GREEN }, _bold: { pct: true }, _bg: pct !== null && pct < th ? '#FFF7F6' : undefined };
    });
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return {
      kind: type === 'month' ? 'month' : undefined,
      month: p.month,
      monthLabel: label,
      cycle,
      cycleLabel: settings.cycleLabel,
      threshold: th,
      records,
      sessions,
      users,
      cadets: cad,
      name: type === 'month' ? `Monthly-Report_${p.month}` : `Range-Report_${from}_to_${to}`,
      title: type === 'month' ? `Monthly Attendance Report - ${label}` : `Attendance Report - ${label}`, subtitle: `Cycle ${settings.cycleLabel}`,
      info: [...unitInfo, ['Period', label], ['Parades held', String(sessions.length)]],
      tiles: [['Parades', sessions.length, NAVY, BLUEBG], ['Records', sum.total, NAVY, BLUEBG], ['Present', sum.present, GREEN, GREENBG], ['Average', `${sum.pct}%`, sum.pct >= th ? GREEN : RED, sum.pct >= th ? GREENBG : REDBG]],
      sections: [
        { title: 'Parades held', cols: [{ key: 'date', label: 'Date', w: 82 }, { key: 'activity', label: 'Activity', w: 140 }, { key: 'group', label: 'Group', w: 110 }, { key: 'strength', label: 'Strength', w: 60, align: 'center' }, { key: 'present', label: 'Present', w: 60, align: 'center' }, { key: 'pct', label: '%', w: CW - 452, align: 'center' }],
          rows: sessions.map(s => ({ date: fmtDate(s.date), activity: s.activityDescription ? `${s.activityType} - ${s.activityDescription}` : s.activityType, group: s.groupLabel, strength: s.total, present: s.present, pct: `${s.total ? Math.round(s.present / s.total * 100) : 0}%` })), empty: 'No parades' },
        { title: 'Cadet-wise attendance', cols: [{ key: 'sl', label: 'Sl', w: 28, align: 'center' }, { key: 'reg', label: 'Reg No.', w: 108 }, { key: 'name', label: 'Name', w: 140 }, { key: 'yr', label: 'Yr', w: 28, align: 'center' }, { key: 'type', label: 'Type', w: 38, align: 'center' }, { key: 'parades', label: 'Total', w: 46, align: 'center' }, { key: 'present', label: 'Pres', w: 40, align: 'center' }, { key: 'absent', label: 'Abs', w: 40, align: 'center' }, { key: 'pct', label: '%', w: CW - 468, align: 'center' }], rows },
      ],
    };
  }

  // ── one cadet ──────────────────────────────────────────────────────────────────
  if (type === 'cadet') {
    const id = String(p.cadetId || '');
    if (!id) throw new Error('Choose a cadet.');
    const users = await getAllUsers();
    const u = users.find(x => x.id === id);
    if (!u) throw new Error('Cadet not found.');
    if (actor && actor.id !== id && !(actor.can('canViewAllAttendance'))) throw new Error('You can only download your own report.');
    const records = (await loadRecords({ cadetId: id, cycle, allCycles: p.cycle === 'all' })).sort((a, b) => a.date.localeCompare(b.date));
    const st = readStats(u), sum = summarize(records);
    const pct = p.cycle === 'all' ? sum.pct : st.pct;
    return {
      name: `Cadet-Report_${(u.regNo || u.name).replace(/[^A-Za-z0-9]+/g, '-')}`,
      title: 'Cadet Attendance Report', subtitle: u.name,
      info: [['Name', u.name], ['Reg No.', u.regNo || 'Not assigned'], ['Year / Type', `Year ${u.year} / ${u.type || 'SD'}`], ['Cycle', p.cycle === 'all' ? 'All cycles' : settings.cycleLabel], ['Email', u.email || '-'], stamp],
      tiles: [['Parades', sum.total, NAVY, BLUEBG], ['Present', sum.present, GREEN, GREENBG], ['Absent', sum.absent, RED, REDBG], ['Attendance', pct === null ? '-' : `${pct}%`, pct !== null && pct < th ? RED : GREEN, pct !== null && pct < th ? REDBG : GREENBG]],
      sections: [{ title: `Attendance record${st.benefit && p.cycle !== 'all' ? ` (benefit credits: ${st.benefit})` : ''}`, cols: [{ key: 'sl', label: 'Sl', w: 30, align: 'center' }, { key: 'date', label: 'Date', w: 88 }, { key: 'activity', label: 'Activity', w: 150 }, { key: 'status', label: 'Status', w: 70, align: 'center' }, { key: 'reason', label: 'Reason', w: CW - 338 }],
        rows: records.map((r, i) => ({ sl: i + 1, date: fmtDate(r.date), activity: r.activityDescription ? `${r.activityType} - ${r.activityDescription}` : r.activityType, status: r.status === 'Present' ? 'PRESENT' : 'ABSENT', reason: r.status === 'Absent' ? (r.reason || 'Not specified') : '-',
          _bg: r.status === 'Absent' ? '#FFF7F6' : undefined, _colors: { status: r.status === 'Present' ? GREEN : RED }, _bold: { status: true } })), empty: 'No records yet' }],
    };
  }

  // ── year-wise / full unit summary (from live counters; no scan) ────────────────
  if (type === 'year' || type === 'summary') {
    const users = await getAllUsers();
    const yr = type === 'year' ? parseInt(p.year, 10) : null;
    let list = users.filter(u => u.isActive && !u.discharged && u.role === 'cadet');
    if (yr) list = list.filter(u => u.role === 'cadet' && u.year === yr);
    list = list.map(u => ({ ...u, cadetYear: u.year, cadetType: u.type, cadetRegNo: u.regNo, cadetName: u.name, cadetRole: u.role })).sort(personOrder);
    const rows = list.map((u, i) => {
      const st = readStats(u);
      return { sl: i + 1, reg: u.regNo || '-', name: u.name, yr: yearTag(u), type: typeOf(u), parades: st.total, present: st.present, absent: st.absent, benefit: st.benefit, pct: st.pct === null ? '-' : `${st.pct}%`,
        _colors: { pct: st.pct !== null && st.pct < th ? RED : GREEN, absent: st.absent ? RED : '#1B2433' }, _bold: { pct: true }, _bg: st.pct !== null && st.pct < th ? '#FFF7F6' : undefined, _p: st.pct };
    });
    const low = rows.filter(r => r._p !== null && r._p < th).length;
    return {
      name: yr ? `Year-${yr}-Report` : 'Unit-Summary-Report',
      title: yr ? `Year ${yr} Attendance Summary` : 'Unit Attendance Summary', subtitle: `Cycle ${settings.cycleLabel}`,
      info: [...unitInfo, ['Cycle', settings.cycleLabel], ['Required attendance', `${th}%`]],
      tiles: [['Cadets', rows.length, NAVY, BLUEBG], [`Below ${th}%`, low, low ? RED : GREEN, low ? REDBG : GREENBG]],
      sections: [{ title: 'Cadet-wise attendance', cols: [{ key: 'sl', label: 'Sl', w: 28, align: 'center' }, { key: 'reg', label: 'Reg No.', w: 108 }, { key: 'name', label: 'Name', w: 140 }, { key: 'yr', label: 'Yr', w: 28, align: 'center' }, { key: 'type', label: 'Type', w: 38, align: 'center' }, { key: 'parades', label: 'Total', w: 46, align: 'center' }, { key: 'present', label: 'Pres', w: 36, align: 'center' }, { key: 'absent', label: 'Abs', w: 36, align: 'center' }, { key: 'benefit', label: 'Ben', w: 30, align: 'center' }, { key: 'pct', label: '%', w: CW - 490, align: 'center' }], rows }],
    };
  }

  // ── absentees list ─────────────────────────────────────────────────────────────
  if (type === 'absentees') {
    const from = p.from && isValidDate(p.from) ? p.from : null, to = p.to && isValidDate(p.to) ? p.to : null;
    const records = (await loadRecords({ cycle, from, to })).filter(r => r.status === 'Absent').sort((a, b) => b.date.localeCompare(a.date) || personOrder(a, b));
    const byReason = {}; records.forEach(r => { byReason[r.reason || 'Not specified'] = (byReason[r.reason || 'Not specified'] || 0) + 1; });
    return {
      name: 'Absentees-Report', title: 'Absentees Report', subtitle: from || to ? `${from ? fmtDate(from) : 'start'} to ${to ? fmtDate(to) : 'today'}` : `Cycle ${settings.cycleLabel}`,
      info: [...unitInfo, ['Total absences', String(records.length)]],
      tiles: [['Absences', records.length, RED, REDBG], ['Cadets affected', new Set(records.map(r => r.cadetId)).size, NAVY, BLUEBG]],
      sections: [
        { title: 'By reason', cols: [{ key: 'reason', label: 'Reason', w: 380 }, { key: 'count', label: 'Count', w: CW - 380, align: 'center' }], rows: Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })), empty: 'No absences' },
        { title: 'Absence list', cols: [{ key: 'date', label: 'Date', w: 80 }, { key: 'reg', label: 'Reg No.', w: 108 }, { key: 'name', label: 'Name', w: 140 }, { key: 'yr', label: 'Yr', w: 28, align: 'center' }, { key: 'reason', label: 'Reason', w: CW - 356 }],
          rows: records.map(r => ({ date: fmtDate(r.date), reg: r.cadetRegNo || '-', name: r.cadetName, yr: yearTag(r), reason: r.reason || 'Not specified', _colors: { reason: RED } })), empty: 'No absences recorded' },
      ],
    };
  }

  // ── benefits ───────────────────────────────────────────────────────────────────
  if (type === 'benefits') {
    const list = snapToArr(await db.collection(Collections.BENEFITS).where('cycle', '==', cycle).get()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return {
      name: 'Attendance-Benefits', title: 'Attendance Benefits', subtitle: `Cycle ${settings.cycleLabel}`,
      info: [...unitInfo, ['Entries', String(list.length)]], tiles: [['Entries', list.length, NAVY, BLUEBG], ['Credits given', list.reduce((n, b) => n + b.credits, 0), GREEN, GREENBG]],
      sections: [{ title: 'Benefit entries', cols: [{ key: 'date', label: 'Date', w: 80 }, { key: 'reg', label: 'Reg No.', w: 108 }, { key: 'name', label: 'Name', w: 130 }, { key: 'credits', label: 'Credits', w: 50, align: 'center' }, { key: 'reason', label: 'Reason', w: CW - 368 }],
        rows: list.map(b => ({ date: fmtDate(b.date), reg: b.cadetRegNo || '-', name: b.cadetName, credits: `+${b.credits}`, reason: b.reason })), empty: 'No benefits given' }],
    };
  }

  // ── contact details check ───────────────────────────────────────────────────────
  if (type === 'contacts') {
    const users = await getAllUsers();
    let list = users.filter(u => u.role === 'cadet' && u.isActive && !u.discharged);
    const yr = (p.year && p.year !== 'all') ? parseInt(p.year, 10) : null;
    if (yr) list = list.filter(u => u.year === yr);

    // Grouping by email and phone to find duplicates across active cadets
    const emailToNames = new Map();
    const phoneToNames = new Map();
    list.forEach(u => {
      const em = cleanEmail(u.email);
      if (em) {
        if (!emailToNames.has(em)) emailToNames.set(em, []);
        emailToNames.get(em).push(u.name);
      }
      const ph = String(u.phone || '').trim().replace(/\s+/g, '');
      if (ph) {
        if (!phoneToNames.has(ph)) phoneToNames.set(ph, []);
        phoneToNames.get(ph).push(u.name);
      }
    });

    list = list.map(u => ({ ...u, cadetYear: u.year, cadetType: u.type, cadetRegNo: u.regNo, cadetName: u.name, cadetRole: u.role })).sort(personOrder);

    const rows = list.map((u, i) => {
      const flags = [];
      const em = cleanEmail(u.email);
      if (!em) {
        if (u.email) flags.push('Invalid e-mail');
        else flags.push('Missing e-mail');
      } else if (emailToNames.get(em)?.length > 1) {
        const others = emailToNames.get(em).filter(n => n !== u.name);
        if (others.length) flags.push(`E-mail shared with ${others.join(', ')}`);
      }

      const ph = String(u.phone || '').trim().replace(/\s+/g, '');
      if (!ph) {
        flags.push('Missing phone');
      } else if (phoneToNames.get(ph)?.length > 1) {
        const others = phoneToNames.get(ph).filter(n => n !== u.name);
        if (others.length) flags.push(`Phone shared with ${others.join(', ')}`);
      }

      const flagText = flags.join('; ');
      return {
        sl: i + 1,
        reg: u.regNo || '-',
        name: u.name,
        yr: u.year,
        type: u.type || 'SD',
        email: u.email || '-',
        phone: u.phone || '-',
        flags: flagText || '',
        correct: '',
        corrected: '',
      };
    });

    return {
      kind: 'contacts',
      name: `Contact-Details-Check${yr ? `_Year-${yr}` : '_All-Years'}`,
      title: 'Contact Details Check',
      subtitle: 'Please check your details and return this sheet',
      info: [...unitInfo, ['Year', yr ? `Year ${yr}` : 'All Years'], ['Cadets', String(rows.length)], stamp],
      sections: [{
        title: 'Cadet Details',
        cols: [
          { key: 'sl', label: 'Sl', w: 24, align: 'center' },
          { key: 'reg', label: 'Reg No.', w: 80 },
          { key: 'name', label: 'Name', w: 85 },
          { key: 'type', label: 'Type', w: 28, align: 'center' },
          { key: 'email', label: 'E-mail', w: 95 },
          { key: 'phone', label: 'Phone', w: 65 },
          { key: 'flags', label: 'Flags', w: 65 },
          { key: 'correct', label: 'Correct? (Y/N)', w: 40, align: 'center' },
          { key: 'corrected', label: 'Corrected e-mail / phone', w: 141 },
        ],
        rows,
        empty: 'No cadets found',
      }],
      excelRows: rows.map(r => ({
        'Sl.': r.sl,
        'Reg No.': r.reg,
        'Name': r.name,
        'Type': r.type,
        'E-mail': r.email === '-' ? '' : r.email,
        'Phone': r.phone === '-' ? '' : r.phone,
        'Flags': r.flags,
      })),
    };
  }

  // ── import report ───────────────────────────────────────────────────────────────
  if (type === 'import-report') {
    const report = settings.lastImportReport;
    if (!report) throw new Error('No import report available.');
    const counts = report.counts || {};
    const warnings = report.warnings || [];
    return {
      kind: 'import-report',
      name: `Import-Report_${report.importedAt ? report.importedAt.slice(0, 10) : 'latest'}`,
      title: 'Import Report',
      counts,
      warnings,
      importedAt: report.importedAt,
    };
  }
  throw new Error('Unknown report type.');
}

// ── renderers ──────────────────────────────────────────────────────────────────
export async function renderPdf(report) {
  if (report.kind === 'parade') return buildParadeReportPdf({ session: report.session, records: report.records, threshold: report.threshold });
  return buildTablePdf(report);
}

export async function renderXlsx(report) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = `${UNIT.wing} ${UNIT.flight}`; wb.created = new Date();
  const style = ws => {
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A5B' } };
    h.alignment = { vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  if (report.kind === 'month') {
    const ws = wb.addWorksheet('Monthly');
    ws.views = [{ state: 'frozen', xSplit: 4 }];

    // Title rows
    ws.addRow([`${UNIT.wing} ${UNIT.flight}`]).font = { bold: true, size: 14, color: { argb: 'FF0B2A5B' } };
    ws.addRow([UNIT.squadron]).font = { bold: true, size: 12, color: { argb: 'FF475467' } };
    ws.addRow([`Monthly attendance report - ${report.monthLabel}`]).font = { bold: true, size: 12 };
    ws.addRow([`Cycle ${report.cycleLabel || report.cycle}`]).font = { size: 10, color: { argb: 'FF475467' } };
    ws.addRow([`Generated ${fmtDateTimeIST(new Date().toISOString())}`]).font = { italic: true, size: 9, color: { argb: 'FF667085' } };
    ws.addRow([]);

    // Compact table
    const ctHead = ws.addRow(['Year', 'Cadets', 'Parades', 'Average %', 'Below required']);
    ctHead.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ctHead.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A5B' } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ctHead.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

    for (const y of [1, 2, 3]) {
      const yCadets = report.cadets.filter(c => (c.cadetYear || c.year) === y);
      if (!yCadets.length) continue;
      const ySessions = report.sessions.filter(s => Array.isArray(s.years) ? s.years.includes(y) : true);
      const pres = yCadets.reduce((n, c) => n + c.present, 0);
      const tot = yCadets.reduce((n, c) => n + c.total, 0);
      const avg = tot > 0 ? Math.round((pres / tot) * 1000) / 10 : 0;
      const below = yCadets.filter(c => c.total > 0 && (Math.round((c.present / c.total) * 1000) / 10) < report.threshold).length;
      const r = ws.addRow([`Year ${y}`, yCadets.length, ySessions.length, `${avg}%`, below]);
      r.eachCell((c, colNum) => {
        c.alignment = { vertical: 'middle', horizontal: colNum === 1 ? 'left' : 'center' };
      });
    }
    ws.addRow([]);

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fmtSubmitted = iso => {
      if (!iso) return '';
      const d = new Date(new Date(iso).getTime() + 330 * 60000);
      const s = d.toISOString();
      const day = parseInt(s.slice(8, 10), 10);
      const mon = MONTHS[parseInt(s.slice(5, 7), 10) - 1];
      return `${day} ${mon} ${s.slice(11, 16)}`;
    };

    for (const y of [1, 2, 3]) {
      const yCadets = report.cadets.filter(c => (c.cadetYear || c.year) === y).sort(personOrder);
      if (!yCadets.length) continue;

      // Heading row
      const headingRow = ws.addRow([`Year ${y} - ${yCadets.length} cadets`]);
      headingRow.font = { bold: true, size: 12, color: { argb: 'FF0B2A5B' } };

      // Header row 1
      const paradeCols = report.sessions.map(s => {
        const d = parseInt(s.date.slice(8, 10), 10);
        const m = MONTHS[parseInt(s.date.slice(5, 7), 10) - 1];
        return `${d} ${m}`;
      });
      const h1Vals = ['Sl.', 'Reg No.', 'Name', 'Type', ...paradeCols, 'Present', 'Absent', 'Parades', 'Attendance %', 'Remark'];
      const h1Row = ws.addRow(h1Vals);
      h1Row.height = 65;

      for (let c = 1; c <= 4; c++) {
        const cell = h1Row.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A5B' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }

      for (let i = 0; i < report.sessions.length; i++) {
        const s = report.sessions[i];
        const cell = h1Row.getCell(5 + i);
        cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
        cell.font = { bold: true, size: 9, color: { argb: 'FF0B2A5B' } };
        const act = s.activityDescription ? `${s.activityType} - ${s.activityDescription}` : s.activityType;
        const grp = s.groupLabel || 'All';
        const mbr = s.markedByName || '-';
        cell.note = `${act}\nGroup: ${grp}\nMarked by: ${mbr}`;
      }

      const sumStart = 5 + report.sessions.length;
      for (let c = sumStart; c < sumStart + 5; c++) {
        const cell = h1Row.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A5B' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }

      // Header row 2 ("Submitted")
      const h2Vals = ['', '', '', 'Submitted'];
      for (const s of report.sessions) {
        h2Vals.push(fmtSubmitted(s.createdAt));
      }
      h2Vals.push('', '', '', '', '');
      const h2Row = ws.addRow(h2Vals);
      h2Row.font = { size: 8.5, italic: true };
      h2Row.alignment = { horizontal: 'center', vertical: 'middle' };
      h2Row.getCell(4).font = { bold: true, size: 8.5, italic: true };

      // Cadet rows
      const yCadetIds = new Set(yCadets.map(c => c.cadetId));
      yCadets.forEach((c, idx) => {
        let pres = 0, abs = 0;
        const pCells = [];
        for (const s of report.sessions) {
          const rec = report.records.find(r => (r.sessionId === s.id || r.date === s.date) && r.cadetId === c.cadetId);
          if (!rec) {
            pCells.push({ val: '', rec: null });
          } else if (rec.status === 'Present') {
            pres++;
            pCells.push({ val: 'P', rec });
          } else {
            abs++;
            pCells.push({ val: 'A', rec });
          }
        }
        const parades = pres + abs;
        const pct = parades > 0 ? Math.round((pres / parades) * 1000) / 10 : 0;
        const remark = (parades > 0 && pct < report.threshold) ? `BELOW ${report.threshold}%` : '';

        const row = ws.addRow([
          idx + 1,
          String(c.cadetRegNo || ''),
          c.cadetName,
          typeOf(c),
          ...pCells.map(p => p.val),
          pres,
          abs,
          parades,
          parades > 0 ? `${pct}%` : '0%',
          remark,
        ]);

        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(2).numFmt = '@';
        row.getCell(4).alignment = { horizontal: 'center' };

        pCells.forEach((p, pi) => {
          const cell = row.getCell(5 + pi);
          cell.alignment = { horizontal: 'center' };
          if (p.val === 'P') {
            cell.font = { bold: true, color: { argb: 'FF15803D' } };
          } else if (p.val === 'A') {
            cell.font = { bold: true, color: { argb: 'FFB42318' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEA' } };
            cell.note = p.rec?.reason || p.rec?.remarks || 'Absent';
          }
        });

        row.getCell(sumStart).alignment = { horizontal: 'center' };
        row.getCell(sumStart + 1).alignment = { horizontal: 'center' };
        row.getCell(sumStart + 2).alignment = { horizontal: 'center' };
        row.getCell(sumStart + 3).alignment = { horizontal: 'center' };
        if (remark) {
          row.getCell(sumStart + 4).font = { bold: true, color: { argb: 'FFB42318' } };
        }
      });

      // Block totals row
      const totVals = ['Total', '', '', ''];
      for (const s of report.sessions) {
        const pCount = report.records.filter(r => (r.sessionId === s.id || r.date === s.date) && yCadetIds.has(r.cadetId) && r.status === 'Present').length;
        totVals.push(pCount);
      }
      const bPres = yCadets.reduce((n, c) => n + c.present, 0);
      const bAbs = yCadets.reduce((n, c) => n + c.absent, 0);
      const bTot = bPres + bAbs;
      const bPct = bTot > 0 ? Math.round((bPres / bTot) * 1000) / 10 : 0;
      totVals.push(bPres, bAbs, bTot, bTot > 0 ? `${bPct}%` : '0%', '');

      const totRow = ws.addRow(totVals);
      totRow.font = { bold: true };
      totRow.eachCell((cell, colNum) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F7FC' } };
        if (colNum > 4) cell.alignment = { horizontal: 'center' };
      });

      ws.addRow([]);
    }

    ws.columns = [
      { width: 6 },
      { width: 18 },
      { width: 28 },
      { width: 8 },
      ...report.sessions.map(() => ({ width: 9 })),
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 14 },
      { width: 14 },
    ];
  } else if (report.kind === 'parade') {
    const recs = [...report.records].sort(personOrder);
    const ws = wb.addWorksheet('Nominal roll');
    ws.columns = [{ header: 'Sl', key: 'sl', width: 6 }, { header: 'Reg No.', key: 'reg', width: 22 }, { header: 'Name', key: 'name', width: 30 }, { header: 'Year', key: 'yr', width: 8 }, { header: 'Type', key: 'type', width: 8 }, { header: 'Status', key: 'status', width: 10 }, { header: 'Reason', key: 'reason', width: 30 }];
    recs.forEach((r, i) => { const row = ws.addRow({ sl: i + 1, reg: r.cadetRegNo || '', name: r.cadetName, yr: yearTag(r), type: typeOf(r), status: r.status, reason: r.status === 'Absent' ? r.reason : '' }); if (r.status === 'Absent') row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEA' } }; }); });
    style(ws);
    const sum = summarize(recs);
    const sm = wb.addWorksheet('Summary');
    [['Unit', `${UNIT.wing} ${UNIT.flight} - ${UNIT.squadron}`], ['Date', fmtDateLong(report.session.date)], ['Activity', report.session.activityType], ['Group', report.session.groupLabel || ''], ['Marked by', report.session.markedByName || ''], ['Strength', sum.total], ['Present', sum.present], ['Absent', sum.absent], ['Attendance %', sum.pct]].forEach(r => sm.addRow(r));
    sm.getColumn(1).font = { bold: true }; sm.getColumn(1).width = 16; sm.getColumn(2).width = 60;
  } else if (report.kind === 'contacts') {
    const ws = wb.addWorksheet('Contacts');
    const cols = ['Sl.', 'Reg No.', 'Name', 'Type', 'E-mail', 'Phone', 'Flags'];
    ws.addRow(cols);
    style(ws);
    (report.excelRows || []).forEach(r => {
      ws.addRow(cols.map(c => r[c] ?? ''));
    });
    ws.columns = [
      { width: 6 },
      { width: 22 },
      { width: 26 },
      { width: 8 },
      { width: 30 },
      { width: 16 },
      { width: 35 },
    ];
    ws.getColumn(2).numFmt = '@';
  } else if (report.kind === 'import-report') {
    const ws = wb.addWorksheet('Import Report');
    ws.addRow(['Sl.', 'Warning Message']);
    style(ws);
    (report.warnings || []).forEach((w, i) => {
      ws.addRow([i + 1, w]);
    });
    ws.columns = [{ width: 8 }, { width: 90 }];
  } else {
    const sm = wb.addWorksheet('Summary');
    sm.addRow([report.title]).font = { bold: true, size: 14 };
    if (report.subtitle) sm.addRow([report.subtitle]);
    sm.addRow([]);
    (report.info || []).forEach(([k, v]) => sm.addRow([k, v]));
    (report.tiles || []).forEach(([k, v]) => sm.addRow([k, v]));
    sm.getColumn(1).width = 26; sm.getColumn(2).width = 50; sm.getColumn(1).font = { bold: true };
    (report.sections || []).forEach((s, i) => {
      const ws = wb.addWorksheet((s.title || `Table ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28));
      ws.columns = s.cols.map(c => ({ header: c.label, key: c.key, width: Math.max(8, Math.round(c.w / 5.5)) }));
      s.rows.forEach(r => ws.addRow(Object.fromEntries(s.cols.map(c => [c.key, r[c.key]]))));
      style(ws);
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function renderCsv(report) {
  const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [];
  if (report.kind === 'parade') {
    lines.push(['Sl', 'Reg No.', 'Name', 'Year', 'Type', 'Status', 'Reason'].join(','));
    [...report.records].sort(personOrder).forEach((r, i) => lines.push([i + 1, r.cadetRegNo || '', r.cadetName, yearTag(r), typeOf(r), r.status, r.status === 'Absent' ? r.reason : ''].map(esc).join(',')));
  } else {
    (report.sections || []).forEach(s => {
      if (s.title) lines.push(esc(s.title));
      lines.push(s.cols.map(c => esc(c.label)).join(','));
      s.rows.forEach(r => lines.push(s.cols.map(c => esc(r[c.key])).join(',')));
      lines.push('');
    });
  }
  return '\uFEFF' + lines.join('\r\n');
}
