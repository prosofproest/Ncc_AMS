export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db, Collections, snapToArr } from '@/lib/firebase';
import { authenticate } from '@/lib/session';
import { can } from '@/lib/permissions';

export async function GET(request) {
  const { payload, error } = await authenticate(request);
  if (error) return error;
  if (!(can(payload, 'canViewAllAttendance') || can(payload, 'canEditAttendance')))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const snap = await db.collection(Collections.AUDIT_LOG).orderBy('at', 'desc').limit(150).get();
  return NextResponse.json({ logs: snapToArr(snap) });
}
