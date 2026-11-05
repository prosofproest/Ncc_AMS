export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getAllUsers } from '@/lib/users';
import { getSettings } from '@/lib/settings';
import { cycleSessions } from '@/lib/attendance';
import { readStats } from '@/lib/stats';
import { normalizeRegNo } from '@/lib/keys.mjs';

export async function GET(request) {
  const { payload, error } = await authenticate(request);
  if (error) return error;
  if (!(can(payload, 'canMarkAttendance') || can(payload, 'canViewAllAttendance') || can(payload, 'canManageUsers')))
    return NextResponse.json({ cadets: [], sessions: [] });
  const q = new URL(request.url).searchParams.get('q')?.trim().toLowerCase();
  if (!q || q.length < 2) return NextResponse.json({ cadets: [], sessions: [] });

  const normQ = normalizeRegNo(q);
  const users = await getAllUsers();
  const cadets = users.filter(u => u.role === 'cadet' && (
    u.name?.toLowerCase().includes(q) ||
    u.regNo?.toLowerCase().includes(q) ||
    (normQ && normalizeRegNo(u.regNo).includes(normQ)) ||
    u.username?.toLowerCase().includes(q)
  ))
    .slice(0, 8).map(u => ({ id: u.id, name: u.name, regNo: u.regNo || '', role: u.role, year: u.year || null, type: u.type || null, isActive: u.isActive, discharged: u.discharged || false, pct: readStats(u).pct }));
  const settings = await getSettings();
  const sessions = (await cycleSessions(settings.currentCycle)).filter(s =>
    s.date.includes(q) || (s.activityType || '').toLowerCase().includes(q) || (s.activityDescription || '').toLowerCase().includes(q) || (s.groupLabel || '').toLowerCase().includes(q))
    .slice(0, 6).map(s => ({ id: s.id, date: s.date, activity: s.activityType, description: s.activityDescription, group: s.groupLabel, count: s.total, present: s.present }));
  return NextResponse.json({ cadets, sessions });
}
