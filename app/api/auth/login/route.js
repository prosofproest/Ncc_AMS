export const dynamic = 'force-dynamic';
export const maxDuration = 30;
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { verifyPassword, generateOtp, hashOtp, randomId, maskEmail, hashTabId } from '@/lib/auth';
import { issueSession } from '@/lib/session';
import { findUserByIdentifier } from '@/lib/users';
import { cleanEmail } from '@/lib/settings';
import { sendOtpEmail } from '@/lib/email';
import { logEvent } from '@/lib/events';

const MAX_FAILS = 5, LOCK_MIN = 15, OTP_MIN = 5;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const tabId = typeof body.tabId === 'string' ? body.tabId.trim() : '';
    if (!tabId) return NextResponse.json({ error: 'tabId is required' }, { status: 400 });

    const identifier = String(body.identifier || body.username || body.reg_no || '').trim();
    const password   = String(body.password || '');
    if (!identifier || !password) return NextResponse.json({ error: 'Enter your username / regimental number and password.' }, { status: 400 });
    if (identifier.length > 100 || password.length > 200) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

    const user = await findUserByIdentifier(identifier);
    if (!user) return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });

    if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
      const mins = Math.ceil((Date.parse(user.lockedUntil) - Date.now()) / 60000);
      return NextResponse.json({ error: `Too many wrong attempts. Account locked — try again in ${mins} min.` }, { status: 429 });
    }
    if (!user.isActive) return NextResponse.json({ error: 'Account inactive. Contact Admin.' }, { status: 403 });

    const ref   = db.collection(Collections.USERS).doc(user.id);
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const fails = (user.failedLogins || 0) + 1;
      if (fails >= MAX_FAILS) {
        await ref.update({ failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MIN * 60000).toISOString() });
        return NextResponse.json({ error: `Too many wrong attempts. Account locked for ${LOCK_MIN} minutes.` }, { status: 429 });
      }
      await ref.update({ failedLogins: fails });
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    // ── Two-step verification (per-account switch, set by admin) ───────────────
    const email = cleanEmail(user.email);
    if (user.otpRequired === true) {
      if (!email) {
        if (user.role === 'admin') {            // never lock the administrator out
          await ref.update({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date().toISOString() });
          return await issueSession(user, { tabId, otpSkipped: 'The admin account has no email set, so the OTP step was skipped.' });
        }
        if (user.role === 'cadet') {
          await ref.update({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date().toISOString() });
          await logEvent({ type: 'auth:otp-skipped', ok: true, message: `OTP skipped for cadet ${user.regNo || user.name}: no email on file`, meta: { userId: user.id } }).catch(() => {});
          return await issueSession(user, { tabId, otpSkipped: 'No e-mail on file, so the code step was skipped.' });
        }
        return NextResponse.json({ error: 'OTP is on for this account but no e-mail is set. Ask the Admin to add your e-mail.' }, { status: 403 });
      }
      const challengeId = randomId(16), code = generateOtp();
      await db.collection(Collections.OTP).doc(challengeId).set({
        userId: user.id, codeHash: hashOtp(challengeId, code), tabHash: hashTabId(tabId), attempts: 0, resends: 0,
        expiresAt: Date.now() + OTP_MIN * 60000, lastSentAt: Date.now(), createdAt: new Date().toISOString(),
      });
      const sent = await sendOtpEmail({ to: email, name: user.name, code, minutes: OTP_MIN });
      if (!sent.success) {
        await db.collection(Collections.OTP).doc(challengeId).delete().catch(() => {});
        return NextResponse.json({ error: 'Could not send the verification email. Try again, or tell the Admin (email service problem).' }, { status: 502 });
      }
      await ref.update({ failedLogins: 0, lockedUntil: null });
      return NextResponse.json({ otpRequired: true, challengeId, emailHint: maskEmail(email), expiresInSec: OTP_MIN * 60 });
    }

    await ref.update({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date().toISOString() });
    return await issueSession(user, { tabId });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 });
  }
}
