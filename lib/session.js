import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { createToken, setTokenCookie, getTokenFromRequest, verifyToken } from '@/lib/auth';
import { getRolePermissions, getDashboardPath, can } from '@/lib/permissions';

// Build the JWT for a user (with live permissions) and attach the cookie.
export async function issueSession(user, extra = {}) {
  const permissions   = await getRolePermissions(db, Collections, user.role, user);
  const dashboardPath = getDashboardPath(user.role, permissions);
  const token = await createToken({
    id:           user.id,
    regNo:        user.regNo    || '',
    name:         user.name,
    role:         user.role,
    username:     user.username || '',
    tokenVersion: user.tokenVersion || 0,
    dashboardPath,
    permissions,
  });
  const response = NextResponse.json({
    success: true,
    role: user.role,
    dashboardPath,
    mustChangePassword: !!user.mustChangePassword,
    ...extra,
  });
  return setTokenCookie(response, token);
}

// Authenticate an API request. Returns { payload } or { error: NextResponse }.
//   opts.perm  -> required permission     opts.roles -> allowed built-in roles
export async function authenticate(request, opts = {}) {
  const token   = getTokenFromRequest(request);
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (opts.roles && !opts.roles.includes(payload.role) && !(opts.perm && can(payload, opts.perm)))
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  if (opts.perm && !opts.roles && !can(payload, opts.perm))
    return { error: NextResponse.json({ error: 'You do not have permission for this action.' }, { status: 403 }) };
  return { payload };
}

export function clientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
