import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'ncc_token';

function secretKey() {
  const s = process.env.JWT_SECRET?.trim();
  if (s && s.length >= 16) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === 'production') return null;                 // misconfigured → nobody gets in
  return new TextEncoder().encode('dev-only-secret-change-me-1234567890'); // must match lib/auth.js
}

// Built-in roles always map to their own dashboard
const BUILTIN_PATHS = {
  admin: '/dashboard/admin',
  cadet: '/dashboard/cadet',
  cto: '/dashboard/cto',
  marker: '/dashboard/marker',
};

// Per-IP limiter. A whole squadron can share one Wi-Fi address, so limits are generous;
// the real brute-force protection is the per-account lockout + OTP attempt limits on the server.
const hits = new Map();
function limited(key, max, windowMs = 60_000) {
  const now = Date.now();
  const d = hits.get(key) || { n: 0, t: now };
  if (now - d.t > windowMs) { d.n = 0; d.t = now; }
  d.n++; hits.set(key, d);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > windowMs) hits.delete(k);
  return d.n > max;
}

const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self)',
};
const withSec = res => { Object.entries(SEC).forEach(([k, v]) => res.headers.set(k, v)); return res; };

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
    if (limited(`${ip}|${pathname.startsWith('/api/auth') ? 'auth' : 'api'}`, pathname.startsWith('/api/auth') ? 40 : 900))
      return withSec(NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429, headers: { 'Retry-After': '60' } }));
  }

  // Public: login screens, auth endpoints, latency ping, cron (protected by CRON_SECRET inside), static assets
  if (pathname === '/login' || pathname === '/change-password' || pathname.startsWith('/api/auth') ||
      pathname === '/api/ping' || pathname.startsWith('/api/cron') ||
      pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname === '/sw.js' || pathname === '/manifest.json' || pathname.startsWith('/icon'))
    return withSec(NextResponse.next());

  if (pathname === '/') return NextResponse.redirect(new URL('/login', request.url));

  const unauth = () => pathname.startsWith('/api/')
    ? withSec(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    : NextResponse.redirect(new URL('/login', request.url));

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const key = secretKey();
  if (!token || !key) return unauth();

  try {
    const { payload } = await jwtVerify(token, key);
    if (pathname.startsWith('/dashboard/')) {
      const SHARED = ['/dashboard/leaderboard', '/dashboard/calendar', '/dashboard/help'];   // open to every signed-in role
      if (!SHARED.some(p => pathname.startsWith(p))) {
        let allowedPrefixes = [];
        if (payload.role === 'cadet') {
          allowedPrefixes = ['/dashboard/cadet'];
        } else if (BUILTIN_PATHS[payload.role]) {
          allowedPrefixes = [BUILTIN_PATHS[payload.role]];
        } else if (payload.dashboardPath) {
          allowedPrefixes = [payload.dashboardPath];
        } else {
          allowedPrefixes = ['/dashboard/cadet'];
        }
        if (!allowedPrefixes.some(p => pathname.startsWith(p))) {
          const fallback = payload.dashboardPath || allowedPrefixes[0] || '/dashboard/cadet';
          return NextResponse.redirect(new URL(fallback, request.url));
        }
      }
    }
    return withSec(NextResponse.next());
  } catch {
    const res = pathname.startsWith('/api/') ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) : NextResponse.redirect(new URL('/login', request.url));
    res.headers.set('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return res;
  }
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'] };
