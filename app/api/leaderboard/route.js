export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/session';
import { getAllUsers } from '@/lib/users';
import { readStats } from '@/lib/stats';

// Built from the live per-cadet counters — no scan of attendance records.
export async function GET(request) {
  const { error } = await authenticate(request);
  if (error) return error;
  const year = parseInt(new URL(request.url).searchParams.get('year') || '', 10) || null;
  const users = await getAllUsers();
  const board = users
    .filter(u => u.role === 'cadet' && u.isActive && !u.discharged && (!year || u.year === year))
    .map(u => { const st = readStats(u); return { id: u.id, name: u.name, regNo: u.regNo || '', year: u.year, type: u.type || 'SD', total: st.total, present: st.present, benefit: st.benefit, pct: st.pct === null ? 0 : Math.round(st.pct) }; })
    .filter(c => c.total >= 3)
    .sort((a, b) => b.pct - a.pct || b.present - a.present || a.name.localeCompare(b.name))
    .slice(0, 20);
  return NextResponse.json({ leaderboard: board });
}
