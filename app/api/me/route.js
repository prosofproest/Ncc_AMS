export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { getTokenFromRequest, verifyToken, clearTokenCookie } from '@/lib/auth';

function logout(body) { return clearTokenCookie(NextResponse.json(body, { status: 401 })); }

export async function GET(request) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ user: null }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return logout({ user: null });

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
    });
  } catch (err) {
    console.error('[ME] Firestore check failed:', err.message);
    return NextResponse.json({ user: { id: payload.id, name: payload.name, role: payload.role, regNo: payload.regNo, permissions: payload.permissions || {} } });
  }
}
