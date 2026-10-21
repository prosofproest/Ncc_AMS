export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { getAllUsers } from '@/lib/users';
import { cycleSessions } from '@/lib/attendance';
import { readStats } from '@/lib/stats';

// One light call that powers the Sir / Admin overview: totals, cadet-wise %, recent parades.
export async function GET(request) {
  const { error } = await authenticate(request, { perm: 'canViewAllAttendance' });
  if (error) return error;
  const [settings, users] = await Promise.all([getSettings(), getAllUsers()]);
  const sessions = await cycleSessions(settings.currentCycle);
  const cadets = users.filter(u => u.isActive && !u.discharged && u.role === 'cadet').map(u => {
    const st = readStats(u);
    return { id: u.id, name: u.name, regNo: u.regNo || '', year: u.year || null, type: u.type || null, role: u.role, ...st };
  });
  const th = settings.thresholdPct;
  const tot = sessions.reduce((n, s) => n + s.total, 0), pres = sessions.reduce((n, s) => n + s.present, 0);
  const yearAvg = [1, 2, 3].map(y => {
    const l = cadets.filter(c => c.year === y && c.pct !== null);
    return { year: y, cadets: cadets.filter(c => c.year === y).length, avg: l.length ? Math.round(l.reduce((n, c) => n + c.pct, 0) / l.length * 10) / 10 : null };
  });
  return NextResponse.json({
    cycleLabel: settings.cycleLabel, threshold: th,
    totals: { cadets: cadets.length, sessions: sessions.length, avg: tot ? Math.round(pres / tot * 1000) / 10 : 0, below: cadets.filter(c => c.pct !== null && c.pct < th).length },
    yearAvg, cadets, sessions: sessions.slice(0, 120),
  });
}
