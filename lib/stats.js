// Per-cadet attendance counters live on the user document so that percentages
// never need a scan of the attendance collection.
//   stats: { total, present, absent, m202610: {t, p} ... }  (reset on promotion)
//   benefit: number of bonus attendance credits (reset on promotion)
import { FieldValue } from '@/lib/firebase';
import { monthKeyOf } from '@/lib/time';

export function emptyStats() {
  return { total: 0, present: 0, absent: 0, months: {} };
}

// Update payload for adding (sign=+1) or removing (sign=-1) one record.
export function statIncrements(date, status, sign = 1) {
  const mk = monthKeyOf(date);
  const inc = FieldValue.increment;
  const upd = {
    'stats.total':  inc(sign),
    [`stats.months.${mk}.t`]: inc(sign),
  };
  if (status === 'Present') {
    upd['stats.present'] = inc(sign);
    upd[`stats.months.${mk}.p`] = inc(sign);
  } else {
    upd['stats.absent'] = inc(sign);
  }
  return upd;
}

// Combine the "remove old" and "add new" for an edited record into one update.
export function statChange(date, oldStatus, newStatus) {
  if (oldStatus === newStatus) return null;
  const mk = monthKeyOf(date);
  const inc = FieldValue.increment;
  const upd = {};
  if (newStatus === 'Present') {
    upd['stats.present'] = inc(1); upd['stats.absent'] = inc(-1);
    upd[`stats.months.${mk}.p`] = inc(1);
  } else {
    upd['stats.present'] = inc(-1); upd['stats.absent'] = inc(1);
    upd[`stats.months.${mk}.p`] = inc(-1);
  }
  return upd;
}

export function readStats(user) {
  const s = user?.stats || {};
  const total   = s.total   || 0;
  const present = s.present || 0;
  const absent  = s.absent  || 0;
  const benefit = Math.max(0, user?.benefit || 0);
  const credited = Math.min(total, present + benefit);
  const pct = total > 0 ? Math.round((credited / total) * 1000) / 10 : null;
  return { total, present, absent, benefit, pct };
}

export function monthlyStats(user) {
  const out = [];
  const months = user?.stats?.months || {};
  for (const [k, v] of Object.entries(months)) {
    if (!/^m\d{6}$/.test(k)) continue;
    out.push({ key: k, ym: `${k.slice(1, 5)}-${k.slice(5, 7)}`, total: v.t || 0, present: v.p || 0 });
  }
  return out.sort((a, b) => a.ym.localeCompare(b.ym));
}
