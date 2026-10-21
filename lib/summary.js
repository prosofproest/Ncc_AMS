import { db, Collections, snapToArr } from '@/lib/firebase';
import { getSettings } from '@/lib/settings';
import { getAllUsers } from '@/lib/users';
import { readStats } from '@/lib/stats';
import { buildReport, renderPdf } from '@/lib/reports';
import { sendPeriodSummary } from '@/lib/email';
import { fmtDate, fmtMonthLong, prevMonthKey } from '@/lib/time';

// Build + send the weekly / monthly summary mail for [from, to]
export async function runPeriodSummary({ kind, from, to, label, fileTag }) {
  const settings = await getSettings({ fresh: true });
  const sessions = snapToArr(await db.collection(Collections.SESSIONS).where('cycle', '==', settings.currentCycle).get())
    .filter(s => s.date >= from && s.date <= to);
  if (!sessions.length) return { success: true, skipped: 'no parades in this period' };
  const present = sessions.reduce((n, s) => n + s.present, 0), total = sessions.reduce((n, s) => n + s.total, 0);
  const users = await getAllUsers({ fresh: true });
  const cadets = users.filter(u => u.isActive && !u.discharged && u.role === 'cadet')
    .map(u => ({ name: u.name, regNo: u.regNo, year: u.year, pct: readStats(u).pct }));
  let pdf = null;
  try { pdf = await renderPdf(await buildReport('range', { from, to }, null)); } catch (e) { console.error('[SUMMARY] pdf failed:', e.message); }
  return sendPeriodSummary({
    settings, kind, label, fileTag, pdf,
    stats: { sessions: sessions.length, avg: total ? Math.round(present / total * 1000) / 10 : 0, cadets },
  });
}

// Which summaries are due on this IST date? (the single nightly cron decides)
export function summariesDue(todayStr) {
  const d = new Date(todayStr + 'T00:00:00Z');
  return { weekly: d.getUTCDay() === 1, monthly: d.getUTCDate() === 1 };       // Monday -> last week · 1st -> last month
}
// The previous Monday–Sunday relative to a date
export function weekRange(todayStr) {
  const t = new Date(todayStr + 'T00:00:00Z');
  const dow = (t.getUTCDay() + 6) % 7;                                          // Monday = 0
  const end = new Date(t.getTime() - (dow + 1) * 86400000), start = new Date(end.getTime() - 6 * 86400000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
export async function runWeekly(todayStr) {
  const { from, to } = weekRange(todayStr);
  return runPeriodSummary({ kind: 'Weekly', from, to, label: `${fmtDate(from)} – ${fmtDate(to)}`, fileTag: from });
}
export async function runMonthly(todayStr, month) {
  const ym = month || prevMonthKey(todayStr);
  return runPeriodSummary({ kind: 'Monthly', from: `${ym}-01`, to: `${ym}-31`, label: fmtMonthLong(ym), fileTag: ym });
}
