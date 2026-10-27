export const dynamic = 'force-dynamic';
export const maxDuration = 30;
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { hashOtp, safeEqual, hashTabId } from '@/lib/auth';
import { issueSession } from '@/lib/session';

const MAX_TRIES = 5;

export async function POST(request) {
  try {
    const { challengeId, code, tabId } = await request.json().catch(() => ({}));
    const id = String(challengeId || ''), c = String(code || '').trim();
    if (!/^[a-f0-9]{32}$/.test(id) || !/^\d{6}$/.test(c))
      return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 });

    const ref  = db.collection(Collections.OTP).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'This code is no longer valid. Please sign in again.', restart: true }, { status: 400 });
    const ch = snap.data();
    if (ch.expiresAt < Date.now()) {
      await ref.delete().catch(() => {});
      return NextResponse.json({ error: 'The code expired. Please sign in again.', restart: true }, { status: 400 });
    }

    if (!tabId || hashTabId(String(tabId)) !== ch.tabHash) {
      return NextResponse.json({ error: 'Sign in again in the same tab' }, { status: 401 });
    }
    if (!safeEqual(hashOtp(id, c), ch.codeHash)) {
      const attempts = (ch.attempts || 0) + 1;
      if (attempts >= MAX_TRIES) {
        await ref.delete().catch(() => {});
        return NextResponse.json({ error: 'Too many wrong codes. Please sign in again.', restart: true }, { status: 429 });
      }
      await ref.update({ attempts });
      return NextResponse.json({ error: `Wrong code. ${MAX_TRIES - attempts} attempt(s) left.` }, { status: 401 });
    }

    await ref.delete();                                   // single use
    const userRef = db.collection(Collections.USERS).doc(ch.userId);
    const us = await userRef.get();
    if (!us.exists || !us.data().isActive) return NextResponse.json({ error: 'Account unavailable.' }, { status: 403 });
    await userRef.update({ lastLoginAt: new Date().toISOString() });
    return await issueSession({ id: us.id, ...us.data() }, { tabId: String(tabId) });
  } catch (err) {
    console.error('OTP verify error:', err);
    return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 });
  }
}
