// PDF reports (pdfkit). Built-in Helvetica only -> plain ASCII text, no emoji or tick glyphs.
import { UNIT } from '@/lib/brand';
import { fmtDateLong, fmtDate, fmtDateTimeIST } from '@/lib/time';
import { personOrder, summarize, byYear, yearTag, normStatus } from '@/lib/groups';

const NAVY = '#0B2A5B', BLUE = '#0A84FF', GOLD = '#B8860B', INK = '#1B2433', DIM = '#667085', LINE = '#D9E0EC';
const GREEN = '#15803D', RED = '#B42318', SOFT = '#F4F7FC', REDSOFT = '#FDECEA', GREENSOFT = '#E8F6EC';
const M = 36, PW = 595.28, PH = 841.89, CW = PW - M * 2;

export function ascii(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, '');
}
const clip = (doc, s, w) => {
  let t = ascii(s);
  while (t.length > 1 && doc.widthOfString(t) > w) t = t.slice(0, -1);
  return t === ascii(s) ? t : t.slice(0, -1) + '.';
};

async function newDoc(meta = {}) {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: ascii(meta.title || 'Report'), Author: `${UNIT.wing} ${UNIT.flight}`, Creator: 'NCC AMS' } });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((res, rej) => { doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej); });
  return { doc, done };
}

function banner(doc, title, subtitle) {
  doc.save();
  doc.rect(0, 0, PW, 104).fill(NAVY);
  doc.rect(0, 104, PW, 3).fill(GOLD);
  doc.fillColor('#E8C766').font('Helvetica-Bold').fontSize(9).text(ascii(`${UNIT.greeting.toUpperCase()}`), M, 20, { width: CW, align: 'center', characterSpacing: 4 });
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(19).text(ascii(`${UNIT.wing} - ${UNIT.flight}`), M, 34, { width: CW, align: 'center', characterSpacing: 1.5 });
  doc.fillColor('#BBD2FF').font('Helvetica-Bold').fontSize(11).text(ascii(UNIT.squadron), M, 58, { width: CW, align: 'center', characterSpacing: 2 });
  doc.fillColor('#FFFFFF').font('Helvetica').fontSize(10).text(ascii(title), M, 78, { width: CW, align: 'center', characterSpacing: 1.2 });
  doc.restore();
  doc.y = 122;
  if (subtitle) {
    doc.fillColor(DIM).font('Helvetica').fontSize(9).text(ascii(subtitle), M, 114, { width: CW, align: 'center' });
    doc.y = 130;
  }
}

function infoGrid(doc, items) {
  const y0 = doc.y + 4, colW = CW / 2, rowH = 29;
  const rows = Math.ceil(items.length / 2);
  doc.roundedRect(M, y0, CW, rows * rowH + 12, 8).fill(SOFT);
  items.forEach(([k, v], i) => {
    const x = M + 12 + (i % 2) * colW, y = y0 + 8 + Math.floor(i / 2) * rowH;
    doc.fillColor(DIM).font('Helvetica-Bold').fontSize(7).text(ascii(k).toUpperCase(), x, y, { width: colW - 20, characterSpacing: 0.8 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(clip(doc, v, colW - 24), x, y + 9, { width: colW - 20 });
  });
  doc.y = y0 + rows * rowH + 18;
}

function tiles(doc, list) {
  const gap = 8, w = (CW - gap * (list.length - 1)) / list.length, y = doc.y, h = 52;
  list.forEach(([label, value, color, bg], i) => {
    const x = M + i * (w + gap);
    doc.roundedRect(x, y, w, h, 8).fill(bg);
    doc.fillColor(color).font('Helvetica-Bold').fontSize(21).text(ascii(String(value)), x, y + 9, { width: w, align: 'center' });
    doc.fillColor(DIM).font('Helvetica-Bold').fontSize(7).text(ascii(label).toUpperCase(), x, y + 37, { width: w, align: 'center', characterSpacing: 1 });
  });
  doc.y = y + h + 14;
}

function sectionTitle(doc, text) {
  if (doc.y > PH - 120) doc.addPage();
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text(ascii(text).toUpperCase(), M, doc.y, { characterSpacing: 1.3 });
  const y = doc.y + 3;
  doc.moveTo(M, y).lineTo(M + 38, y).lineWidth(2).strokeColor(GOLD).stroke();
  doc.y = y + 8;
}

// Generic table with repeating header and automatic pagination.
function table(doc, cols, rows, opts = {}) {
  const rowH = opts.rowH || 18;
  const header = () => {
    const y = doc.y;
    doc.rect(M, y, CW, 20).fill(NAVY);
    let x = M;
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);
    for (const c of cols) { doc.text(ascii(c.label).toUpperCase(), x + 5, y + 6.5, { width: c.w - 8, align: c.align || 'left', characterSpacing: 0.6 }); x += c.w; }
    doc.y = y + 20;
  };
  if (doc.y > PH - 90) doc.addPage();
  header();
  rows.forEach((r, i) => {
    if (doc.y > PH - 64) { doc.addPage(); doc.y = M; header(); }
    const y = doc.y;
    const bg = r._bg || (i % 2 ? '#FFFFFF' : '#FAFBFD');
    doc.rect(M, y, CW, rowH).fill(bg);
    doc.moveTo(M, y + rowH).lineTo(M + CW, y + rowH).lineWidth(0.4).strokeColor(LINE).stroke();
    let x = M;
    for (const c of cols) {
      const raw = r[c.key];
      const color = r._colors?.[c.key] || INK;
      doc.fillColor(color).font(r._bold?.[c.key] ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      doc.text(clip(doc, raw, c.w - 10), x + 5, y + 5.2, { width: c.w - 8, align: c.align || 'left', lineBreak: false });
      x += c.w;
    }
    doc.y = y + rowH;
  });
  if (!rows.length && opts.empty) {
    const y = doc.y;
    doc.rect(M, y, CW, 26).fill(GREENSOFT);
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(10).text(ascii(opts.empty), M, y + 8, { width: CW, align: 'center' });
    doc.y = y + 26;
  }
  doc.y += 12;
}

function finish(doc, footerLeft) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;           // allow writing in the footer band without spawning a new page
    doc.save();
    doc.rect(M, PH - 38, CW, 0.6).fill(LINE);
    doc.fillColor(DIM).font('Helvetica').fontSize(7.5);
    doc.text(ascii(footerLeft), M, PH - 30, { width: CW - 80, align: 'left', lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, M, PH - 30, { width: CW, align: 'right', lineBreak: false });
    doc.restore();
  }
  doc.end();
}

// Signature lines: cols = [{ title, name, sub }]  (name is typed under the line, like a printed form)
function signatureBlock(doc, cols) {
  if (doc.y > PH - 130) doc.addPage();
  const y = doc.y + 34, gap = 22, w = (CW - gap * (cols.length - 1)) / cols.length;
  cols.forEach((c, i) => {
    const x = M + i * (w + gap);
    doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.7).strokeColor(INK).stroke();
    doc.fillColor(DIM).font('Helvetica-Bold').fontSize(7).text(ascii(c.title).toUpperCase(), x, y + 5, { width: w, characterSpacing: 0.8 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(clip(doc, c.name || '', w), x, y + 15, { width: w, lineBreak: false });
    if (c.sub) doc.fillColor(DIM).font('Helvetica').fontSize(7.5).text(clip(doc, c.sub, w), x, y + 27, { width: w, lineBreak: false });
  });
  doc.y = y + 44;
}

const genStamp = () => `Prepared by AMS  |  ${fmtDateTimeIST(new Date().toISOString())}  |  ${UNIT.wing} ${UNIT.flight}  |  ${UNIT.squadron}`;
const typeTag = r => (r.cadetType || r.type || 'SD');

// ── PARADE / SESSION REPORT ───────────────────────────────────────────────────
export async function buildParadeReportPdf({ session, records, threshold = 75 }) {
  const { doc, done } = await newDoc({ title: `Parade Report ${session.date}` });
  const recs  = [...records].map(r => ({ ...r, status: normStatus(r.status) })).sort(personOrder);
  const sum   = summarize(recs);
  const label = session.activityDescription ? `${session.activityType} - ${session.activityDescription}` : session.activityType;

  banner(doc, 'PARADE ATTENDANCE REPORT');
  infoGrid(doc, [
    ['Date', fmtDateLong(session.date)],
    ['Activity', label],
    ['Group', session.groupLabel || 'All'],
    ['Marked by', session.markedByName || '-'],
    ['Submitted', fmtDateTimeIST(session.createdAt || session.updatedAt)],
    ['Location', session.geoLat && session.geoLng ? `${Number(session.geoLat).toFixed(5)}, ${Number(session.geoLng).toFixed(5)}` : (session.isHistorical ? 'Historical entry' : 'Not recorded')],
  ]);
  tiles(doc, [
    ['Strength', sum.total, NAVY, '#E8EEF9'],
    ['Present', sum.present, GREEN, GREENSOFT],
    ['Absent', sum.absent, RED, REDSOFT],
    ['Attendance', `${sum.pct}%`, sum.pct >= threshold ? GREEN : RED, sum.pct >= threshold ? GREENSOFT : REDSOFT],
  ]);

  const yr = byYear(recs);
  if (yr.length > 1) {
    sectionTitle(doc, 'Year-wise strength');
    table(doc, [
      { key: 'label', label: 'Group', w: 170 }, { key: 'total', label: 'Strength', w: 85, align: 'center' },
      { key: 'present', label: 'Present', w: 85, align: 'center' }, { key: 'absent', label: 'Absent', w: 85, align: 'center' },
      { key: 'pct', label: 'Attendance', w: CW - 425, align: 'center' },
    ], yr.map(y => ({ ...y, pct: `${y.pct}%`, _colors: { absent: y.absent ? RED : INK, pct: y.pct >= threshold ? GREEN : RED }, _bold: { pct: true } })), { rowH: 20 });
  }

  const absentees = recs.filter(r => r.status === 'Absent');
  sectionTitle(doc, `Absentees (${absentees.length})`);
  table(doc, [
    { key: 'sl', label: 'Sl', w: 28, align: 'center' }, { key: 'reg', label: 'Reg No.', w: 112 },
    { key: 'name', label: 'Name', w: 150 }, { key: 'yr', label: 'Yr', w: 30, align: 'center' },
    { key: 'type', label: 'Type', w: 40, align: 'center' }, { key: 'reason', label: 'Reason', w: CW - 360 },
  ], absentees.map((r, i) => ({
    sl: i + 1, reg: r.cadetRegNo || 'No Reg No.', name: r.cadetName, yr: yearTag(r), type: typeTag(r), reason: r.reason || r.remarks || 'Not specified',
    _bg: '#FFF7F6', _colors: { reason: RED },
  })), { empty: 'FULL ATTENDANCE - ALL CADETS PRESENT' });

  sectionTitle(doc, 'Nominal roll - all cadets');
  table(doc, [
    { key: 'sl', label: 'Sl', w: 28, align: 'center' }, { key: 'reg', label: 'Reg No.', w: 112 },
    { key: 'name', label: 'Name', w: 150 }, { key: 'yr', label: 'Yr', w: 30, align: 'center' },
    { key: 'type', label: 'Type', w: 40, align: 'center' }, { key: 'status', label: 'Status', w: 56, align: 'center' },
    { key: 'reason', label: 'Reason', w: CW - 416 },
  ], recs.map((r, i) => ({
    sl: i + 1, reg: r.cadetRegNo || 'No Reg No.', name: r.cadetName, yr: yearTag(r), type: typeTag(r),
    status: r.status === 'Present' ? 'PRESENT' : 'ABSENT', reason: r.status === 'Absent' ? (r.reason || r.remarks || 'Not specified') : '-',
    _bg: r.status === 'Absent' ? '#FFF7F6' : undefined,
    _colors: { status: r.status === 'Present' ? GREEN : RED }, _bold: { status: true },
  })));

  const ap = session.approvals || {};
  const when = a => (a ? fmtDateTimeIST(a.at) : 'Awaiting approval');
  signatureBlock(doc, [
    { title: 'Marked by', name: session.markedByName || 'Cadet', sub: fmtDateTimeIST(session.createdAt) },
    { title: 'Approved - Admin', name: ap.admin?.byName || '', sub: when(ap.admin) },
    { title: 'Approved - CTO', name: ap.cto?.byName || '', sub: when(ap.cto) },
  ]);
  finish(doc, genStamp());
  return done;
}

// ── GENERIC TABULAR REPORT (month / range / cadet / year / absentees / benefits) ──
// report = { title, subtitle, info:[[k,v]], tiles:[[label,value,color,bg]], sections:[{ title, cols, rows, empty }] }
export async function buildTablePdf(report) {
  const { doc, done } = await newDoc({ title: report.title });
  banner(doc, report.title.toUpperCase(), report.subtitle);
  if (report.info?.length) infoGrid(doc, report.info);
  if (report.tiles?.length) tiles(doc, report.tiles);
  for (const s of report.sections || []) {
    if (s.title) sectionTitle(doc, s.title);
    table(doc, s.cols, s.rows, { empty: s.empty, rowH: s.rowH });
  }
  if (report.signatures !== false) signatureBlock(doc, [{ title: 'Prepared by', name: 'AMS' }, { title: 'Verified by', name: 'Care Taker Officer', sub: UNIT.flight }]);
  finish(doc, genStamp());
  return done;
}
export { fmtDate };
