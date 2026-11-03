export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/session';
import { db, Collections } from '@/lib/firebase';
import { buildBackupBuffer, buildBackupPdfBuffer } from '@/lib/backup';
import { todayIST } from '@/lib/time';

// In-memory rate limit: 1 download per minute per admin (shared by both formats)
const lastDownloadByAdmin = new Map();

export function _resetBackupRateLimiter() {
  lastDownloadByAdmin.clear();
}

export async function GET(request) {
  const { payload, error } = await authenticate(request, { perm: 'canManageSettings' });
  if (error) return error;

  // Administrator only
  if (payload.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden. Administrator only.' }, { status: 403 });
  }

  const adminId = payload.id;
  const now = Date.now();
  const last = lastDownloadByAdmin.get(adminId);
  if (last && now - last < 60_000) {
    const retryAfter = Math.ceil((60_000 - (now - last)) / 1000);
    return NextResponse.json(
      { error: 'One download per minute allowed. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      }
    );
  }
  lastDownloadByAdmin.set(adminId, now);

  const url = new URL(request.url);
  const format = (url.searchParams.get('format') || 'xlsx').toLowerCase();
  const date = todayIST();

  await db.collection(Collections.AUDIT_LOG).add({
    type: 'backup-download',
    format: format === 'pdf' ? 'pdf' : 'xlsx',
    by: payload.id,
    byName: payload.name || payload.username || 'Administrator',
    at: new Date().toISOString(),
  }).catch(err => console.error('[BACKUP:AUDIT]', err.message));

  if (format === 'pdf') {
    const { buffer, filename } = await buildBackupPdfBuffer({ date });
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  }

  const { buffer, filename } = await buildBackupBuffer({ date });
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
