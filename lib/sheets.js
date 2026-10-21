// Google Sheets integration.
//  • Roster tabs (Year 1-3) are typed by the user — the app only reads them and
//    writes the two auto columns (Attendance %, Status). Headers are created by the app.
//  • Report tabs (Attendance Log, Daily Report, Absentees, Monthly Report, Cadet Summary,
//    Benefits, Change Log) belong to the app and are updated incrementally after each action.
//  • On promotion the report tabs are archived (renamed) and fresh ones created -> attendance
//    restarts from zero in a new sheet.
import { sheets as sheetsApi, auth as googleAuth } from '@googleapis/sheets';
import { cleanKey, cleanEnv, sheetId } from '@/lib/keys.mjs';
import { fmtDateLong, fmtDateTimeIST, monthLabelOf } from '@/lib/time';
import { readStats, monthlyStats } from '@/lib/stats';
import { personOrder, normStatus } from '@/lib/groups';
import { cleanEmail } from '@/lib/settings';

export const TABS = {
  y1: 'Year 1', y2: 'Year 2', y3: 'Year 3', graduated: 'Graduated', discharged: 'Discharged',
  log: 'Attendance Log', daily: 'Daily Report', absent: 'Absentees', monthly: 'Monthly Report',
  summary: 'Cadet Summary', benefits: 'Benefits', changes: 'Change Log',
};
export const ROSTER_TABS = [TABS.y1, TABS.y2, TABS.y3];
const REPORT_TABS = [TABS.log, TABS.daily, TABS.absent, TABS.monthly, TABS.summary, TABS.benefits];

const ROSTER_COLUMNS = [
  { header: 'Sl.', width_px: 50, align: 'CENTER', wrap: false, hidden: false },
  { header: 'Name', width_px: 220, align: 'LEFT', wrap: false, hidden: false },
  { header: 'Reg No.', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
  { header: 'Type (SD/SW)', width_px: 90, align: 'LEFT', wrap: false, hidden: false },
  { header: 'Email', width_px: 260, align: 'LEFT', wrap: false, hidden: false },
  { header: 'Phone', width_px: 130, align: 'LEFT', wrap: false, hidden: false },
  { header: 'Attendance %', width_px: 120, align: 'CENTER', wrap: false, hidden: false },
  { header: 'Status', width_px: 110, align: 'LEFT', wrap: false, hidden: false },
];

export const TAB_LAYOUT = {
  [TABS.y1]: ROSTER_COLUMNS,
  [TABS.y2]: ROSTER_COLUMNS,
  [TABS.y3]: ROSTER_COLUMNS,
  [TABS.graduated]: ROSTER_COLUMNS,
  [TABS.discharged]: ROSTER_COLUMNS,
  [TABS.log]: [
    { header: 'Date', width_px: 100, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Day', width_px: 100, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Activity', width_px: 150, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Group', width_px: 150, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Reg No.', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Name', width_px: 220, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Year', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Type', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Status', width_px: 90, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Reason', width_px: 240, align: 'LEFT', wrap: true, hidden: false },
    { header: 'Marked By', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Updated (IST)', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Key', width_px: 50, align: 'LEFT', wrap: false, hidden: true },
  ],
  [TABS.daily]: [
    { header: 'Date', width_px: 100, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Day', width_px: 100, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Activity', width_px: 260, align: 'LEFT', wrap: true, hidden: false },
    { header: 'Group', width_px: 150, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Strength', width_px: 80, align: 'CENTER', wrap: false, hidden: false },
    { header: 'Present', width_px: 80, align: 'CENTER', wrap: false, hidden: false },
    { header: 'Absent', width_px: 80, align: 'CENTER', wrap: false, hidden: false },
    { header: 'Attendance %', width_px: 110, align: 'CENTER', wrap: false, hidden: false },
    { header: 'Marked By', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Submitted (IST)', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Key', width_px: 50, align: 'LEFT', wrap: false, hidden: true },
  ],
  [TABS.absent]: [
    { header: 'Date', width_px: 100, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Reg No.', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Name', width_px: 220, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Year', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Type', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Reason', width_px: 260, align: 'LEFT', wrap: true, hidden: false },
    { header: 'Marked By', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Key', width_px: 50, align: 'LEFT', wrap: false, hidden: true },
  ],
  [TABS.summary]: [
    { header: 'Reg No.', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Name', width_px: 220, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Year', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Type', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Email', width_px: 260, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Parades', width_px: 80, align: 'CENTER', wrap: false, hidden: false },
    { header: 'Present', width_px: 80, align: 'CENTER', wrap: false, hidden: false },
    { header: 'Absent', width_px: 80, align: 'CENTER', wrap: false, hidden: false },
    { header: 'Benefit', width_px: 80, align: 'CENTER', wrap: false, hidden: false },
    { header: 'Attendance %', width_px: 110, align: 'CENTER', wrap: false, hidden: false },
    { header: 'Remark', width_px: 130, align: 'LEFT', wrap: false, hidden: false },
  ],
  [TABS.benefits]: [
    { header: 'Date', width_px: 100, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Reg No.', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Name', width_px: 220, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Year', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Credits', width_px: 80, align: 'CENTER', wrap: false, hidden: false },
    { header: 'Reason', width_px: 260, align: 'LEFT', wrap: true, hidden: false },
    { header: 'Added By', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Key', width_px: 50, align: 'LEFT', wrap: false, hidden: true },
  ],
  [TABS.changes]: [
    { header: 'Time (IST)', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Action', width_px: 100, align: 'LEFT', wrap: false, hidden: false },
    { header: 'By', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Parade Date', width_px: 100, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Reg No.', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Cadet', width_px: 220, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Before', width_px: 220, align: 'LEFT', wrap: true, hidden: false },
    { header: 'After', width_px: 160, align: 'LEFT', wrap: true, hidden: false },
    { header: 'Reason / Note', width_px: 260, align: 'LEFT', wrap: true, hidden: false },
  ],
  [TABS.monthly]: [
    { header: 'Reg No.', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Name', width_px: 220, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Year', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Type', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
    { header: 'Overall %', width_px: 100, align: 'CENTER', wrap: false, hidden: false },
  ],
};

export function getTabLayout(title, { months = [] } = {}) {
  if (title === TABS.monthly && months && months.length) {
    return [
      { header: 'Reg No.', width_px: 170, align: 'LEFT', wrap: false, hidden: false },
      { header: 'Name', width_px: 220, align: 'LEFT', wrap: false, hidden: false },
      { header: 'Year', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
      { header: 'Type', width_px: 80, align: 'LEFT', wrap: false, hidden: false },
      ...months.map(m => ({ header: m, width_px: 120, align: 'CENTER', wrap: false, hidden: false })),
      { header: 'Overall %', width_px: 100, align: 'CENTER', wrap: false, hidden: false },
    ];
  }
  return TAB_LAYOUT[title] || [];
}

const ROSTER_HDR = TAB_LAYOUT[TABS.y1].map(c => c.header);
const LOG_HDR     = TAB_LAYOUT[TABS.log].map(c => c.header);
const DAILY_HDR   = TAB_LAYOUT[TABS.daily].map(c => c.header);
const ABSENT_HDR  = TAB_LAYOUT[TABS.absent].map(c => c.header);
const SUMMARY_HDR = TAB_LAYOUT[TABS.summary].map(c => c.header);
const BENEFIT_HDR = TAB_LAYOUT[TABS.benefits].map(c => c.header);
const CHANGE_HDR  = TAB_LAYOUT[TABS.changes].map(c => c.header);

const HEADERS = Object.fromEntries(Object.entries(TAB_LAYOUT).map(([k, cols]) => [k, cols.map(c => c.header)]));
const KEY_COL = Object.fromEntries(
  Object.entries(TAB_LAYOUT).flatMap(([k, cols]) => {
    const idx = cols.findIndex(c => c.hidden);
    return idx >= 0 ? [[k, idx]] : [];
  })
);

const NAVY = { red: 0.043, green: 0.165, blue: 0.357 }, WHITE = { red: 1, green: 1, blue: 1 };
const col = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const q = name => `'${name.replace(/'/g, "''")}'`;
const dayName = d => fmtDateLong(d).split(',')[0];

export function sheetsConfigured() {
  return !!(process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}
let client = null, clientKey = '';
function api() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL + process.env.GOOGLE_PRIVATE_KEY;
  if (client && key === clientKey) return client;
  const auth = new googleAuth.GoogleAuth({
    credentials: { client_email: cleanEnv(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL), private_key: cleanKey(process.env.GOOGLE_PRIVATE_KEY) },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  client = sheetsApi({ version: 'v4', auth });
  clientKey = key;
  return client;
}
const SID = () => sheetId(process.env.GOOGLE_SHEET_ID);

// Serialise sheet work inside one server instance so appends never interleave.
let chain = Promise.resolve();
export function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}
async function guarded(fn) {
  if (!sheetsConfigured()) return { success: false, error: 'Google Sheets env vars not set (GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY)' };
  try { return await enqueue(fn); }
  catch (err) { console.error('[SHEETS]', err.message); return { success: false, error: err.message }; }
}

// ── tab plumbing ───────────────────────────────────────────────────────────────
async function listTabs(s) {
  const m = await s.spreadsheets.get({
    spreadsheetId: SID(),
    fields: 'sheets(properties(title,sheetId,index,gridProperties),basicFilter,conditionalFormats)',
  });
  return m.data.sheets.map(x => ({
    title: x.properties.title,
    sheetId: x.properties.sheetId,
    index: x.properties.index,
    gridProperties: x.properties.gridProperties,
    basicFilter: x.basicFilter,
    conditionalFormats: x.conditionalFormats || [],
  }));
}
async function batch(s, requests) {
  for (let i = 0; i < requests.length; i += 90)
    await s.spreadsheets.batchUpdate({ spreadsheetId: SID(), requestBody: { requests: requests.slice(i, i + 90) } });
}

const FILTER_TABS = new Set([
  TABS.log, TABS.daily, TABS.absent, TABS.summary, TABS.benefits, TABS.changes,
]);

const isTextNumberCol = h => {
  const norm = String(h || '').trim();
  return norm === 'Reg No.' || norm === 'Date' || norm === 'Parade Date';
};

export async function formatTab(s, tabInput, options = {}) {
  let tab = tabInput;
  if (typeof tabInput === 'string') {
    const tabs = options.tabs || await listTabs(s);
    tab = tabs.find(t => t.title === tabInput);
    if (!tab) return;
  }
  const title = tab.title;
  const sheetId = tab.sheetId;
  const cols = options.cols || getTabLayout(title, options);
  if (!cols || !cols.length) return;

  const reqs = [];

  // 1. Column widths and hidden status
  cols.forEach((c, i) => {
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: c.width_px, hiddenByUser: !!c.hidden },
        fields: 'pixelSize,hiddenByUser',
      },
    });
  });

  // 2. Header row height 36 + styling (navy background, white bold, vertical middle, wrap on)
  reqs.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 36 },
      fields: 'pixelSize',
    },
  });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols.length },
      cell: {
        userEnteredFormat: {
          backgroundColor: NAVY,
          textFormat: { bold: true, foregroundColor: WHITE },
          horizontalAlignment: 'LEFT',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    },
  });

  // 3. Data rows: vertical middle; wrapStrategy WRAP for wrap columns and CLIP for all others;
  // Reg No. and date columns use text number format; numeric columns center, text columns left;
  // do not set fixed data-row heights (let Sheets auto-fit)
  cols.forEach((c, i) => {
    const isText = isTextNumberCol(c.header);
    const format = {
      verticalAlignment: 'MIDDLE',
      horizontalAlignment: c.align,
      wrapStrategy: c.wrap ? 'WRAP' : 'CLIP',
    };
    if (isText) format.numberFormat = { type: 'TEXT' };

    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: format },
        fields: isText
          ? 'userEnteredFormat(verticalAlignment,horizontalAlignment,wrapStrategy,numberFormat)'
          : 'userEnteredFormat(verticalAlignment,horizontalAlignment,wrapStrategy)',
      },
    });
  });

  // 4. Freeze header row; freeze first 2 columns on Cadet Summary and Monthly Report
  const freeze2Cols = title === TABS.summary || title === TABS.monthly;
  reqs.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: {
          frozenRowCount: 1,
          frozenColumnCount: freeze2Cols ? 2 : 0,
        },
      },
      fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
    },
  });

  // 5. Basic filter on header row for Attendance Log, Daily Report, Absentees, Cadet Summary, Benefits, Change Log
  // (remove any old filter first)
  if (tab.basicFilter) {
    reqs.push({ clearBasicFilter: { sheetId } });
  }
  if (FILTER_TABS.has(title)) {
    reqs.push({
      setBasicFilter: {
        filter: {
          range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: cols.length },
        },
      },
    });
  }

  // 6. Conditional formatting: delete ALL existing rules on the tab first, then add current ones
  const existingRulesCount = tab.conditionalFormats ? tab.conditionalFormats.length : 0;
  for (let i = existingRulesCount - 1; i >= 0; i--) {
    reqs.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }

  if (title === TABS.log) {
    const st = cols.findIndex(c => c.header === 'Status');
    const stCol = col(st >= 0 ? st : 8);
    reqs.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols.length }],
          booleanRule: {
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$${stCol}2="Absent"` }] },
            format: { backgroundColor: { red: 0.99, green: 0.92, blue: 0.91 } },
          },
        },
      },
    });
  } else if (title === TABS.summary) {
    const rem = cols.findIndex(c => c.header === 'Remark');
    const remCol = col(rem >= 0 ? rem : 10);
    reqs.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols.length }],
          booleanRule: {
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=LEFT($${remCol}2,5)="BELOW"` }] },
            format: { backgroundColor: { red: 0.99, green: 0.92, blue: 0.91 } },
          },
        },
      },
    });
  }

  // ONE batchUpdate per tab
  await s.spreadsheets.batchUpdate({ spreadsheetId: SID(), requestBody: { requests: reqs } });

  // Update in-memory metadata on tab object
  tab.basicFilter = FILTER_TABS.has(title) ? { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: cols.length } } : null;
  if (title === TABS.log || title === TABS.summary) {
    tab.conditionalFormats = [{ sheetId }];
  } else {
    tab.conditionalFormats = [];
  }
}

// Make sure a tab exists with its header row + formatting. Never touches existing data rows.
async function ensureTab(s, title, tabsCache, options = {}) {
  const tabs = tabsCache || await listTabs(s);
  let tab = tabs.find(t => t.title === title);
  const hdr = HEADERS[title];
  if (!tab) {
    const res = await s.spreadsheets.batchUpdate({ spreadsheetId: SID(), requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
    const p = res.data.replies[0].addSheet.properties;
    tab = { title: p.title, sheetId: p.sheetId, index: p.index, created: true, conditionalFormats: [], basicFilter: null };
    tabs.push(tab);
  }
  if (hdr) {
    const first = await s.spreadsheets.values.get({ spreadsheetId: SID(), range: `${q(title)}!A1:A1` }).catch(() => ({ data: {} }));
    if (!first.data.values?.[0]?.[0]) {
      await s.spreadsheets.values.update({ spreadsheetId: SID(), range: `${q(title)}!A1`, valueInputOption: 'RAW', requestBody: { values: [hdr] } });
      await formatTab(s, tab, options);
      tab._formatted = true;
    }
  }
  return tab;
}

export async function setupSheetTabs() {
  return guarded(async () => {
    const s = api(); const tabs = await listTabs(s); const created = [];
    for (const t of [...ROSTER_TABS, TABS.graduated, TABS.discharged, ...REPORT_TABS, TABS.changes]) {
      const had = tabs.some(x => x.title === t);
      const tab = await ensureTab(s, t, tabs);
      if (!had) created.push(t);
      if (!tab._formatted) {
        await formatTab(s, tab);
      }
    }
    return { success: true, created, message: created.length ? `Created: ${created.join(', ')}` : 'All tabs already exist — headers verified.' };
  });
}

// ── READ roster from sheet ─────────────────────────────────────────────────────
const norm = v => String(v ?? '').trim();
function mapHeader(row) {
  const m = {};
  row.forEach((c, i) => {
    const h = norm(c).toLowerCase();
    if (h === 'name' || h === 'cadet name') m.name = i;
    else if (h.startsWith('reg')) m.reg = i;
    else if (h.startsWith('type')) m.type = i;
    else if (h.startsWith('email') || h.startsWith('e-mail')) m.email = i;
    else if (h.startsWith('phone') || h.startsWith('mobile')) m.phone = i;
  });
  return m;
}

export async function readCadetsFromSheet() {
  return guarded(async () => {
    const s = api();
    const res = await s.spreadsheets.values.batchGet({ spreadsheetId: SID(), ranges: ROSTER_TABS.map(t => `${q(t)}!A:H`) }).catch(() => null);
    if (!res) return { success: false, error: 'Could not read the sheet. Run "Setup Sheet" first and check it is shared with the service account.' };
    const cadets = [], warnings = [];
    res.data.valueRanges.forEach((vr, idx) => {
      const tab = ROSTER_TABS[idx];
      const rows = vr.values || [];
      let map = { name: 1, reg: 2, type: 3, email: 4, phone: 5 };   // sensible default if headers were deleted
      let legacyType = 'SD';
      rows.forEach((row, i) => {
        const first = norm(row[0]);
        if (first.startsWith('──') || first.startsWith('--')) { legacyType = /SW/.test(first) ? 'SW' : 'SD'; return; }
        const asHdr = mapHeader(row);
        if (asHdr.name !== undefined && asHdr.reg !== undefined) { map = { ...asHdr }; return; }
        const name = norm(row[map.name]);
        if (!name || /^\(?example/i.test(name) || /^no (sd|sw) cadets$/i.test(name)) return;
        const regNo = norm(row[map.reg]).toUpperCase().replace(/^\(no reg no\.?\)$/i, '');
        const emailRaw = map.email !== undefined ? norm(row[map.email]) : '';
        const email = cleanEmail(emailRaw);
        if (emailRaw && !email) warnings.push(`${tab} row ${i + 1}: "${emailRaw}" is not a valid email (${name})`);
        const phone = map.phone !== undefined ? norm(row[map.phone]).slice(0, 20) : '';
        const tRaw = map.type !== undefined ? norm(row[map.type]).toUpperCase() : '';
        const type = tRaw === 'SW' || tRaw === 'SD' ? tRaw : legacyType;
        cadets.push({ name, regNo: regNo || null, year: parseInt(tab.slice(-1), 10), type, email, phone, role: 'cadet' });
      });
    });
    return { success: true, cadets, warnings };
  });
}

// ── WRITE roster (stats columns only, or full rewrite) ─────────────────────────
function rosterRow(i, u) {
  const st = readStats(u);
  return [i + 1, u.name, u.regNo || '', u.type || 'SD', u.email || '', u.phone || '',
    st.pct === null ? 'No data' : `${st.pct}%`, u.discharged ? 'Discharged' : u.isActive ? 'Active' : 'Inactive'];
}
const sortU = list => [...list].sort((a, b) => personOrder({ ...a, cadetYear: a.year, cadetType: a.type, cadetRegNo: a.regNo, cadetName: a.name }, { ...b, cadetYear: b.year, cadetType: b.type, cadetRegNo: b.regNo, cadetName: b.name }));

// Routine update: touch ONLY columns G:H, append DB-only people at the bottom, and remove rows of
// people who are no longer active (discharged / graduated / deactivated) so the roster stays clean.
export async function writeRosterStats(users) {
  return guarded(async () => {
    const s = api(); const tabs = await listTabs(s);
    const all = users.filter(u => u.role === 'cadet');
    for (const tab of ROSTER_TABS) {
      const meta = await ensureTab(s, tab, tabs);
      const mine = all.filter(u => (u.year === parseInt(tab.slice(-1), 10)) || !u.isActive);
      const res = await s.spreadsheets.values.get({ spreadsheetId: SID(), range: `${q(tab)}!A:H` });
      const rows = res.data.values || [];
      let map = { name: 1, reg: 2 };
      const seen = new Set(), out = [], dropRows = [];
      rows.forEach((row, i) => {
        const h = mapHeader(row);
        if (h.name !== undefined && h.reg !== undefined) { map = h; out.push([row[6] ?? '', row[7] ?? '']); return; }
        const name = norm(row[map.name]);
        const reg = norm(row[map.reg]).toUpperCase();
        const u = name && mine.find(x => (reg && x.regNo === reg) || (!reg && x.name === name));
        if (u && (!u.isActive || u.discharged)) { dropRows.push(i + 1); out.push([row[6] ?? '', row[7] ?? '']); seen.add(u.id); return; }
        if (u) { seen.add(u.id); const r = rosterRow(0, u); out.push([r[6], r[7]]); }
        else out.push([row[6] ?? '', row[7] ?? '']);
      });
      if (out.length > 1)
        await s.spreadsheets.values.update({ spreadsheetId: SID(), range: `${q(tab)}!G1:H${out.length}`, valueInputOption: 'RAW', requestBody: { values: out } });
      const live = mine.filter(u => u.isActive && !u.discharged);
      const missing = sortU(live.filter(u => !seen.has(u.id)));
      if (missing.length) {
        const start = Math.max(rows.length, 1);               // first empty row is start + 1
        await s.spreadsheets.values.update({ spreadsheetId: SID(), range: `${q(tab)}!A${start + 1}`, valueInputOption: 'RAW',
          requestBody: { values: missing.map((u, i) => rosterRow(start - 1 + i, u)) } });
      }
      if (dropRows.length)
        await batch(s, dropRows.sort((a, b) => b - a).map(r => ({ deleteDimension: { range: { sheetId: meta.sheetId, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })));
    }
    return { success: true };
  });
}

// Graduated / Discharged tabs belong to the app and are rewritten whole.
export async function writeInactiveTabs(users) {
  return guarded(async () => {
    const s = api(); const tabs = await listTabs(s);
    const put = async (tab, list) => {
      const meta = await ensureTab(s, tab, tabs);
      await s.spreadsheets.values.clear({ spreadsheetId: SID(), range: `${q(tab)}!A2:H` });
      const rows = sortU(list).map((u, i) => rosterRow(i, u));
      if (rows.length) await s.spreadsheets.values.update({ spreadsheetId: SID(), range: `${q(tab)}!A2`, valueInputOption: 'RAW', requestBody: { values: rows } });
      await formatTab(s, meta);
      return meta;
    };
    await put(TABS.graduated, users.filter(u => u.role === 'cadet' && !u.isActive && !u.discharged && u.graduatedAt));
    await put(TABS.discharged, users.filter(u => u.role === 'cadet' && u.discharged));
    return { success: true };
  });
}

// Full rewrite of rosters from the database (used after promotion / manual "Push to Sheet").
// Replaces the whole tab, which also converts the older sectioned SD/SW layout.
export async function writeRosterFull(users) {
  return guarded(async () => {
    const s = api(); const tabs = await listTabs(s);
    const put = async (tab, list) => {
      const meta = await ensureTab(s, tab, tabs);
      await s.spreadsheets.values.clear({ spreadsheetId: SID(), range: `${q(tab)}!A:H` });
      const rows = sortU(list).map((u, i) => rosterRow(i, u));
      await s.spreadsheets.values.update({ spreadsheetId: SID(), range: `${q(tab)}!A1`, valueInputOption: 'RAW', requestBody: { values: [ROSTER_HDR, ...rows] } });
      await formatTab(s, meta);
    };
    const act = users.filter(u => u.role === 'cadet' && u.isActive && !u.discharged);
    for (const y of [1, 2, 3]) await put(`Year ${y}`, act.filter(u => u.year === y));
    await put(TABS.graduated, users.filter(u => u.role === 'cadet' && !u.isActive && !u.discharged && u.graduatedAt));
    await put(TABS.discharged, users.filter(u => u.role === 'cadet' && u.discharged));
    return { success: true };
  });
}

// ── keyed upsert helper ────────────────────────────────────────────────────────
async function upsertKeyed(s, tab, items, deleteKeys = [], tabs) {
  const meta = await ensureTab(s, tab, tabs);
  const kc = KEY_COL[tab], kl = col(kc), width = HEADERS[tab].length;
  const res = await s.spreadsheets.values.get({ spreadsheetId: SID(), range: `${q(tab)}!${kl}:${kl}` });
  const keys = new Map();
  (res.data.values || []).forEach((r, i) => { if (i > 0 && r[0]) keys.set(String(r[0]), i + 1); });
  const updates = [], appends = [], rowsToDelete = [];
  for (const it of items) {
    const row = it.row.slice(0, width - 1).concat([it.key]);
    if (keys.has(it.key)) updates.push({ range: `${q(tab)}!A${keys.get(it.key)}:${col(width - 1)}${keys.get(it.key)}`, values: [row] });
    else appends.push(row);
  }
  for (const k of deleteKeys) if (keys.has(k)) rowsToDelete.push(keys.get(k));
  if (updates.length) await s.spreadsheets.values.batchUpdate({ spreadsheetId: SID(), requestBody: { valueInputOption: 'RAW', data: updates } });
  if (rowsToDelete.length) {
    const reqs = [...new Set(rowsToDelete)].sort((a, b) => b - a).map(r => ({ deleteDimension: { range: { sheetId: meta.sheetId, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } }));
    await batch(s, reqs);
  }
  if (appends.length) await s.spreadsheets.values.append({ spreadsheetId: SID(), range: `${q(tab)}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: appends } });
  return { updated: updates.length, appended: appends.length, deleted: rowsToDelete.length };
}

const logRow = (r, session) => [r.date, dayName(r.date), r.activityType || session?.activityType || '', session?.groupLabel || '', r.cadetRegNo || '', r.cadetName || '',
  `Year ${r.cadetYear}`, r.cadetType || 'SD', normStatus(r.status),
  normStatus(r.status) === 'Absent' ? (r.reason || r.remarks || 'Not specified') : '', r.markedByName || '', fmtDateTimeIST(r.updatedAt || r.createdAt)];
const dailyRow = s => [s.date, dayName(s.date), s.activityDescription ? `${s.activityType} — ${s.activityDescription}` : s.activityType, s.groupLabel,
  s.total, s.present, s.absent, s.total ? `${Math.round(s.present / s.total * 1000) / 10}%` : '', s.markedByName || '', fmtDateTimeIST(s.updatedAt || s.createdAt)];
const absentRow = r => [r.date, r.cadetRegNo || '', r.cadetName || '', `Year ${r.cadetYear}`, r.cadetType || 'SD',
  r.reason || r.remarks || 'Not specified', r.markedByName || ''];

// Incremental update after a submit / edit.
export async function syncSession({ session, records }) {
  return guarded(async () => {
    const s = api(); const tabs = await listTabs(s);
    const recs = records.map(r => ({ ...r, status: normStatus(r.status) }));
    await upsertKeyed(s, TABS.log, recs.map(r => ({ key: `${r.date}|${r.cadetId}`, row: logRow(r, session) })), [], tabs);
    await upsertKeyed(s, TABS.daily, [{ key: session.id, row: dailyRow(session) }], [], tabs);
    await upsertKeyed(s, TABS.absent,
      recs.filter(r => r.status === 'Absent').map(r => ({ key: `${r.date}|${r.cadetId}`, row: absentRow(r) })),
      recs.filter(r => r.status === 'Present').map(r => `${r.date}|${r.cadetId}`), tabs);
    return { success: true };
  });
}

export async function removeSession({ session, records }) {
  return guarded(async () => {
    const s = api(); const tabs = await listTabs(s);
    const keys = records.map(r => `${r.date}|${r.cadetId}`);
    await upsertKeyed(s, TABS.log, [], keys, tabs);
    await upsertKeyed(s, TABS.absent, [], keys, tabs);
    await upsertKeyed(s, TABS.daily, [], [session.id], tabs);
    return { success: true };
  });
}

const monthCols = users => [...new Set(users.flatMap(u => monthlyStats(u).map(m => m.key)))].sort();

// Monthly report + cadet summary — recomputed from per-cadet counters (no attendance scan).
export async function writeSummaries(users, { thresholdPct = 75 } = {}) {
  return guarded(async () => {
    const s = api(); const tabs = await listTabs(s);
    const people = sortU(users.filter(u => u.role === 'cadet' && u.isActive && !u.discharged));
    // Cadet Summary
    const sumTab = await ensureTab(s, TABS.summary, tabs);
    const sumRows = people.map(u => {
      const st = readStats(u);
      return [u.regNo || '', u.name, `Year ${u.year}`, u.type || 'SD', u.email || '',
        st.total, st.present, st.absent, st.benefit, st.pct === null ? 'No data' : `${st.pct}%`,
        st.pct === null ? '' : st.pct < thresholdPct ? `BELOW ${thresholdPct}%` : 'OK'];
    });
    await s.spreadsheets.values.clear({ spreadsheetId: SID(), range: `${q(TABS.summary)}!A2:K` });
    if (sumRows.length) await s.spreadsheets.values.update({ spreadsheetId: SID(), range: `${q(TABS.summary)}!A2`, valueInputOption: 'RAW', requestBody: { values: sumRows } });
    await formatTab(s, sumTab);
    // Monthly Report (header depends on months present, so it is rewritten entirely)
    const mcols = monthCols(people);
    const monthLabels = mcols.map(monthLabelOf);
    const hdr = ['Reg No.', 'Name', 'Year', 'Type', ...monthLabels, 'Overall %'];
    const monthly = await ensureTab(s, TABS.monthly, tabs);
    await s.spreadsheets.values.clear({ spreadsheetId: SID(), range: `${q(TABS.monthly)}!A:Z` });
    const rows = people.map(u => {
      const ms = Object.fromEntries(monthlyStats(u).map(m => [m.key, m]));
      const st = readStats(u);
      return [u.regNo || '', u.name, `Year ${u.year}`, u.type || 'SD',
        ...mcols.map(k => ms[k] ? `${ms[k].present}/${ms[k].total} (${ms[k].total ? Math.round(ms[k].present / ms[k].total * 100) : 0}%)` : '—'),
        st.pct === null ? 'No data' : `${st.pct}%`];
    });
    await s.spreadsheets.values.update({ spreadsheetId: SID(), range: `${q(TABS.monthly)}!A1`, valueInputOption: 'RAW', requestBody: { values: [hdr, ...rows] } });
    await formatTab(s, monthly, { months: monthLabels });
    return { success: true };
  });
}

export async function writeBenefits(benefits) {
  return guarded(async () => {
    const s = api(); const tabs = await listTabs(s);
    const benTab = await ensureTab(s, TABS.benefits, tabs);
    await s.spreadsheets.values.clear({ spreadsheetId: SID(), range: `${q(TABS.benefits)}!A2:H` });
    const rows = [...benefits].sort((a, b) => String(b.date).localeCompare(String(a.date))).map(b =>
      [b.date, b.cadetRegNo || '', b.cadetName || '', `Year ${b.cadetYear || 1}`, b.credits, b.reason || '', b.addedByName || '', b.id]);
    if (rows.length) await s.spreadsheets.values.update({ spreadsheetId: SID(), range: `${q(TABS.benefits)}!A2`, valueInputOption: 'RAW', requestBody: { values: rows } });
    await formatTab(s, benTab);
    return { success: true };
  });
}

export async function appendChangeLog(entries) {
  return guarded(async () => {
    const s = api(); const tabs = await listTabs(s);
    await ensureTab(s, TABS.changes, tabs);
    const rows = entries.map(e => [fmtDateTimeIST(e.at), e.action, e.by, e.date || '', e.regNo || '', e.name || '', e.from ?? '', e.to ?? '', e.reason || '']);
    if (rows.length) await s.spreadsheets.values.append({ spreadsheetId: SID(), range: `${q(TABS.changes)}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: rows } });
    return { success: true };
  });
}

// Full rebuild of the current cycle from the database (nightly self-heal + manual resync).
export async function rebuildCycle({ users, sessions, records, benefits, thresholdPct }) {
  const r1 = await guarded(async () => {
    const s = api(); const tabs = await listTabs(s);
    const sessById = Object.fromEntries(sessions.map(x => [x.id, x]));
    const logTab = await ensureTab(s, TABS.log, tabs);
    const dailyTab = await ensureTab(s, TABS.daily, tabs);
    const absentTab = await ensureTab(s, TABS.absent, tabs);
    const ordered = [...records].sort((a, b) => a.date.localeCompare(b.date) || personOrder(a, b));
    const logRows = ordered.map(r => logRow(r, sessById[r.sessionId]).concat([`${r.date}|${r.cadetId}`]));
    const dailyRows = [...sessions].sort((a, b) => a.date.localeCompare(b.date)).map(x => dailyRow(x).concat([x.id]));
    const absRows = ordered.filter(r => normStatus(r.status) === 'Absent').map(r => absentRow(r).concat([`${r.date}|${r.cadetId}`]));
    const put = async (tab, rows, width) => {
      await s.spreadsheets.values.clear({ spreadsheetId: SID(), range: `${q(tab)}!A2:${col(width - 1)}` });
      for (let i = 0; i < rows.length; i += 4000)
        await s.spreadsheets.values.update({ spreadsheetId: SID(), range: `${q(tab)}!A${2 + i}`, valueInputOption: 'RAW', requestBody: { values: rows.slice(i, i + 4000) } });
    };
    await put(TABS.log, logRows, LOG_HDR.length);
    await put(TABS.daily, dailyRows, DAILY_HDR.length);
    await put(TABS.absent, absRows, ABSENT_HDR.length);
    await formatTab(s, logTab);
    await formatTab(s, dailyTab);
    await formatTab(s, absentTab);
    return { success: true, logRows: logRows.length, sessions: dailyRows.length };
  });
  if (!r1.success) return r1;
  const r2 = await writeSummaries(users, { thresholdPct }); if (!r2.success) return r2;
  const r3 = await writeBenefits(benefits); if (!r3.success) return r3;
  const r4 = await writeRosterStats(users); if (!r4.success) return r4;
  return { success: true, ...r1 };
}

// Promotion: archive this cycle's report tabs (rename) and create fresh ones.
export async function archiveCycleTabs(oldLabel) {
  return guarded(async () => {
    const s = api(); const tabs = await listTabs(s);
    const taken = new Set(tabs.map(t => t.title));
    const reqs = [], renamed = [];
    for (const name of REPORT_TABS) {
      const t = tabs.find(x => x.title === name); if (!t) continue;
      let nn = `${name} ${oldLabel}`.slice(0, 95), n = 2;
      while (taken.has(nn)) nn = `${name} ${oldLabel} (${n++})`.slice(0, 95);
      taken.add(nn); renamed.push(`${name} -> ${nn}`);
      reqs.push({ updateSheetProperties: { properties: { sheetId: t.sheetId, title: nn, tabColorStyle: { rgbColor: { red: 0.6, green: 0.62, blue: 0.67 } } }, fields: 'title,tabColorStyle' } });
    }
    if (reqs.length) await batch(s, reqs);
    const fresh = await listTabs(s);
    for (const name of REPORT_TABS) {
      const tab = await ensureTab(s, name, fresh);
      await formatTab(s, tab);
    }
    return { success: true, renamed };
  });
}

// For the admin health panel
export async function pingSheets() {
  if (!sheetsConfigured()) return { ok: false, message: 'Google Sheets env vars not set' };
  const t0 = Date.now();
  try {
    const tabs = await listTabs(api());
    const need = [...ROSTER_TABS, ...REPORT_TABS];
    const missing = need.filter(n => !tabs.some(t => t.title === n));
    return { ok: missing.length === 0, ms: Date.now() - t0, message: missing.length ? `Connected, but tabs missing: ${missing.join(', ')} — press "Setup Sheet"` : `Connected — ${tabs.length} tabs, all required tabs present`, missing };
  } catch (e) { return { ok: false, ms: Date.now() - t0, message: e.message }; }
}
