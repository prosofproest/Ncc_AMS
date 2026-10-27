export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { getTokenFromRequest, verifyToken, hashPassword, hashTabId, clearTokenCookie } from '@/lib/auth';
import { issueSession } from '@/lib/session';

export async function POST(request) {
  try {
    const token = getTokenFromRequest(request);
    const payload = token ? await verifyToken(token) : null;
    if (!payload) return clearTokenCookie(NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }));

    const tabId = request.headers.get('x-tab-id');
    if (!tabId || hashTabId(tabId) !== payload.tid) {
      return clearTokenCookie(NextResponse.json({
        error: 'This sign-in belongs to another tab. Please sign in again.',
        code: 'TAB',
      }, { status: 401 }));
    }

    const { password } = await request.json().catch(() => ({}));
    if (!password || password.length < 6 || password.length > 100)
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });

    const ref  = db.collection(Collections.USERS).doc(payload.id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    const user = { id: snap.id, ...snap.data() };
    const p = password.toLowerCase();
    if (p === String(user.regNo || '').toLowerCase() || p === String(user.username || '').toLowerCase())
      return NextResponse.json({ error: 'Choose a password different from your Regimental Number / username.' }, { status: 400 });

    await ref.update({ passwordHash: await hashPassword(password), mustChangePassword: false, updatedAt: new Date().toISOString() });
    return await issueSession({ ...user, mustChangePassword: false }, { tabId });
  } catch (err) {
    console.error('change-password error:', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
