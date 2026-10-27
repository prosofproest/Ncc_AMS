export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { getTokenFromRequest, verifyToken, clearTokenCookie, hashTabId } from '@/lib/auth';

function logout(body) { return clearTokenCookie(NextResponse.json(body, { status: 401 })); }

export async function GET(request) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ user: null }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return logout({ error: 'Session expired. Please sign in again.', code: 'EXPIRED', user: null });

  const tabId = request.headers.get('x-tab-id');
  if (!tabId || hashTabId(tabId) !== payload.tid) {
    return clearTokenCookie(NextResponse.json({
      error: 'This sign-in belongs to another tab. Please sign in again.',
      code: 'TAB',
    }, { status: 401 }));
  }

  const expiresAt = payload.exp ? payload.exp * 1000 : null;
  const serverNow = Date.now();

  try {
    const doc = await db.collection(Collections.USERS).doc(payload.id).get();
    if (!doc.exists) return logout({ user: null, forceLogout: true });
    const u = doc.data();
    if (!u.isActive) return logout({ user: null, forceLogout: true });
    if ((u.tokenVersion || 0) !== (payload.tokenVersion || 0)) return logout({ user: null, forceLogout: true });
    return NextResponse.json({
      user: {
        id: payload.id, name: u.name, role: u.role, regNo: u.regNo || payload.regNo || '',
        permissions: payload.permissions || {}, dashboardPath: payload.dashboardPath || null,
        mustChangePassword: !!u.mustChangePassword,
      },
      expiresAt,
      serverNow,
    });
  } catch (err) {
    console.error('[ME] Firestore check failed:', err.message);
    return NextResponse.json({
      user: { id: payload.id, name: payload.name, role: payload.role, regNo: payload.regNo, permissions: payload.permissions || {} },
      expiresAt,
      serverNow,
    });
  }
}
