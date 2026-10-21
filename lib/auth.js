import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const COOKIE_NAME  = 'ncc_token';
const TOKEN_EXPIRY = '7d';
const MAX_AGE      = 7 * 24 * 60 * 60;

function secretString() {
  const s = process.env.JWT_SECRET?.trim();
  if (s && s.length >= 16) return s;
  // Never run production with a guessable secret. During `next build` nothing signs tokens.
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build')
    throw new Error('JWT_SECRET is missing or too short (min 16 chars).');
  return 'dev-only-secret-change-me-1234567890';
}
const secretKey = () => new TextEncoder().encode(secretString());

export async function hashPassword(password) { return bcrypt.hash(password, 10); }
export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export async function createToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(secretKey());
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload;
  } catch { return null; }
}

export function getTokenFromRequest(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE_NAME) return v.join('=') || null;
  }
  return null;
}

const secureFlag = () => (process.env.NODE_ENV === 'production' ? '; Secure' : '');
export function setTokenCookie(response, token) {
  response.headers.set('Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secureFlag()}`);
  return response;
}
export function clearTokenCookie(response) {
  response.headers.set('Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`);
  return response;
}

// ── One-time passcodes ─────────────────────────────────────────────────────────
export function generateOtp() { return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); }
export function hashOtp(challengeId, code) {
  return crypto.createHmac('sha256', secretString()).update(`${challengeId}:${code}`).digest('hex');
}
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function randomId(bytes = 16) { return crypto.randomBytes(bytes).toString('hex'); }

export function maskEmail(email) {
  const [u, d] = String(email || '').split('@');
  if (!u || !d) return '';
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, u.length - 2)))}@${d}`;
}

export { COOKIE_NAME };
