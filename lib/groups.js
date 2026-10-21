// Pure helpers shared by server and client.

export function groupLabel(years = []) {
  const ys = [...new Set((years || []).map(Number))].filter(y => [1, 2, 3].includes(y)).sort();
  if (ys.length === 3) return 'All Years';
  if (ys.length === 2) return `Year ${ys[0]} & ${ys[1]}`;
  if (ys.length === 1) return `Year ${ys[0]}`;
  return 'No group';
}

// Stable order: Year 1 -> 3; SD before SW; then Reg No; then name.
export function personOrder(a, b) {
  const ya = a.cadetYear ?? a.year ?? 9, yb = b.cadetYear ?? b.year ?? 9;
  if (ya !== yb) return ya - yb;
  const ta = (a.cadetType ?? a.type) === 'SW' ? 1 : 0, tb = (b.cadetType ?? b.type) === 'SW' ? 1 : 0;
  if (ta !== tb) return ta - tb;
  const ra = a.cadetRegNo ?? a.regNo ?? '', rb = b.cadetRegNo ?? b.regNo ?? '';
  if (ra && rb) return ra.localeCompare(rb, undefined, { numeric: true });
  if (ra) return -1; if (rb) return 1;
  return (a.cadetName ?? a.name ?? '').localeCompare(b.cadetName ?? b.name ?? '');
}

export function yearTag(r) { return `Y${r?.cadetYear ?? r?.year ?? '?'}`; }

export function summarize(records) {
  const total   = records.length;
  const present = records.filter(r => r.status === 'Present').length;
  const absent  = total - present;
  return { total, present, absent, pct: total ? Math.round((present / total) * 1000) / 10 : 0 };
}

// Year-wise breakdown rows: Y1, Y2, Y3
export function byYear(records) {
  const rows = [];
  for (const y of [1, 2, 3]) {
    const rs = records.filter(r => (r.cadetYear ?? r.year) === y);
    if (rs.length) rows.push({ label: `Year ${y}`, ...summarize(rs) });
  }
  return rows;
}

export const STATUS = { PRESENT: 'Present', ABSENT: 'Absent' };
// Legacy records may carry "Leave" — it is treated as Absent everywhere now.
export function normStatus(s) { return s === 'Present' ? 'Present' : 'Absent'; }
