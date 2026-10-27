export const dynamic = 'force-dynamic';
export const maxDuration = 30;
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { generateOtp, hashOtp, maskEmail, hashTabId } from '@/lib/auth';
import { cleanEmail } from '@/lib/settings';
import { sendOtpEmail } from '@/lib/email';

const COOLDOWN_MS = 30_000, MAX_RESENDS = 4, OTP_MIN = 5;

export async function POST(request) {
  try {
    const { challengeId, tabId } = await request.json().catch(() => ({}));
    const id = String(challengeId || '');
    if (!/^[a-f0-9]{32}$/.test(id)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    const ref = db.collection(Collections.OTP).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Session expired. Please sign in again.', restart: true }, { status: 400 });
    const ch = snap.data();
    if (ch.tabHash && (!tabId || hashTabId(String(tabId)) !== ch.tabHash)) {
      return NextResponse.json({ error: 'Sign in again in the same tab', restart: true }, { status: 401 });
    }
    const wait = ch.lastSentAt + COOLDOWN_MS - Date.now();
    if (wait > 0) return NextResponse.json({ error: `Please wait ${Math.ceil(wait / 1000)}s before requesting another code.` }, { status: 429 });
    if ((ch.resends || 0) >= MAX_RESENDS) return NextResponse.json({ error: 'Too many resend requests. Please sign in again.', restart: true }, { status: 429 });

    const us = await db.collection(Collections.USERS).doc(ch.userId).get();
    const email = us.exists ? cleanEmail(us.data().email) : '';
    if (!email) return NextResponse.json({ error: 'No email on this account.' }, { status: 400 });

    const code = generateOtp();
    await ref.update({ codeHash: hashOtp(id, code), attempts: 0, resends: (ch.resends || 0) + 1, lastSentAt: Date.now(), expiresAt: Date.now() + OTP_MIN * 60000 });
    const sent = await sendOtpEmail({ to: email, name: us.data().name, code, minutes: OTP_MIN });
    if (!sent.success) return NextResponse.json({ error: 'Could not send the email. Try again shortly.' }, { status: 502 });
    return NextResponse.json({ success: true, emailHint: maskEmail(email), expiresInSec: OTP_MIN * 60 });
  } catch (err) {
    console.error('OTP resend error:', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
