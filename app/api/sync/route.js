export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { db, Collections, snapToArr } from '@/lib/firebase';
import { authenticate } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { getAllUsers } from '@/lib/users';
import { cycleSessions } from '@/lib/attendance';
import { importFromSheet } from '@/lib/import';
import { timed } from '@/lib/events';
import * as sheets from '@/lib/sheets';

// POST /api/sync { action: 'setup' | 'import' | 'rebuild' | 'push-roster' }
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const action = body.action;
  const perm = action === 'import' || action === 'push-roster' ? 'canManageUsers' : 'canSyncSheets';
  const { error } = await authenticate(request, { perm });
  if (error) return error;

  if (action === 'setup') return NextResponse.json(await timed('sheets:setup', () => sheets.setupSheetTabs(), r => r.message));
  if (action === 'import') {
    const r = await timed('sheets:import', () => importFromSheet(), r => `created ${r.created}, updated ${r.updated}, deactivated ${r.deactivated}`);
    return NextResponse.json(r, { status: r.success === false ? 500 : 200 });
  }
  if (action === 'push-roster') {
    const r = await timed('sheets:push-roster', async () => sheets.writeRosterFull(await getAllUsers({ fresh: true })), () => 'roster rewritten');
    return NextResponse.json(r, { status: r.success === false ? 500 : 200 });
  }
  if (action === 'rebuild') {
    const r = await timed('sheets:rebuild', async () => {
      const settings = await getSettings({ fresh: true });
      const [users, sessions, recSnap, benSnap] = await Promise.all([
        getAllUsers({ fresh: true }), cycleSessions(settings.currentCycle),
        db.collection(Collections.ATTENDANCE).where('cycle', '==', settings.currentCycle).get(),
        db.collection(Collections.BENEFITS).where('cycle', '==', settings.currentCycle).get(),
      ]);
      return sheets.rebuildCycle({ users, sessions, records: snapToArr(recSnap), benefits: snapToArr(benSnap), thresholdPct: settings.thresholdPct });
    }, r => `rebuilt ${r.logRows} rows / ${r.sessions} sessions`);
    return NextResponse.json({ ...r, message: r.success ? `Rebuilt ${r.logRows} attendance rows and ${r.sessions} parades.` : undefined }, { status: r.success === false ? 500 : 200 });
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
