// All dates in this app are plain 'YYYY-MM-DD' strings in Indian Standard Time.
const IST_OFFSET_MIN = 330;

export function istNow() {
  const d = new Date(Date.now() + IST_OFFSET_MIN * 60000);
  return d;
}
export function todayIST() {
  return istNow().toISOString().slice(0, 10);
}
export function monthKeyOf(dateStr) {            // '2026-10-13' -> 'm202610'
  return 'm' + dateStr.slice(0, 4) + dateStr.slice(5, 7);
}
export function monthLabelOf(key) {              // 'm202610' -> 'Oct 2026'
  const y = key.slice(1, 5), m = parseInt(key.slice(5, 7), 10);
  return `${MONTHS[m - 1]} ${y}`;
}
export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FULL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export function fmtDate(s) {                      // '2026-10-13' -> '13 Oct 2026'
  if (!isValidDate(s)) return s || '';
  return `${parseInt(s.slice(8, 10), 10)} ${MONTHS[parseInt(s.slice(5, 7), 10) - 1]} ${s.slice(0, 4)}`;
}
export function fmtDateLong(s) {                  // 'Tuesday, 13 October 2026'
  if (!isValidDate(s)) return s || '';
  const d = new Date(s + 'T00:00:00Z');
  return `${DAYS[d.getUTCDay()]}, ${parseInt(s.slice(8, 10), 10)} ${FULL_MONTHS[parseInt(s.slice(5, 7), 10) - 1]} ${s.slice(0, 4)}`;
}
export function fmtMonthLong(ym) {                // '2026-10' -> 'October 2026'
  return `${FULL_MONTHS[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`;
}
export function fmtTimeIST(iso) {                 // ISO -> '14:32'
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60000);
  return d.toISOString().slice(11, 16);
}
export function fmtDateTimeIST(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60000);
  const s = d.toISOString();
  return `${fmtDate(s.slice(0, 10))}, ${s.slice(11, 16)} IST`;
}
export function academicLabel(dateStr = todayIST()) { // '2026-27' (June->May academic year)
  const y = parseInt(dateStr.slice(0, 4), 10), m = parseInt(dateStr.slice(5, 7), 10);
  const start = m >= 6 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}
export function prevMonthKey(dateStr = todayIST()) { // '2026-10-13' -> '2026-09'
  let y = parseInt(dateStr.slice(0, 4), 10), m = parseInt(dateStr.slice(5, 7), 10) - 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
