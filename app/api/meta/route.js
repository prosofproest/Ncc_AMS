export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { ACTIVITIES } from '@/lib/attendance';
import { UNIT } from '@/lib/brand';

export async function GET(request) {
  const { error } = await authenticate(request);
  if (error) return error;
  const s = await getSettings();
  return NextResponse.json({ reasons: s.absentReasons, threshold: s.thresholdPct, cycleLabel: s.cycleLabel, currentCycle: s.currentCycle, activities: ACTIVITIES, unit: UNIT, requirePhotos: s.requirePhotos !== false });
}
