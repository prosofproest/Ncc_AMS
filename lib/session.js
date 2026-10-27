import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { createToken, setTokenCookie, clearTokenCookie, getTokenFromRequest, verifyToken, hashTabId } from '@/lib/auth';
import { getRolePermissions, getDashboardPath, can, DEFAULT_PERMISSIONS } from '@/lib/permissions';

export function sessionPolicy(user, permissions = {}) {
  const role = user?.role;
  const perms = { ...(DEFAULT_PERMISSIONS[role] || {}), ...(user?.permissions || {}), ...permissions };
  let isMarker = role === 'marker';
  if (!isMarker && role !== 'admin' && role !== 'cto' && role !== 'cadet') {
    // Custom role: only capability is canMarkAttendance
    const activePerms = Object.keys(perms).filter(k => perms[k] === true);
    if (activePerms.length === 1 && activePerms[0] === 'canMarkAttendance') {
      isMarker = true;
    }
  }
  const envMinutes = process.env.MARKER_SESSION_MINUTES ? Number(process.env.MARKER_SESSION_MINUTES) : 30;
  const markerLifetime = (Number.isFinite(envMinutes) && envMinutes > 0 ? envMinutes : 30) * 60;
  const lifetimeSec = isMarker ? markerLifetime : 8 * 3600;
  return { isMarker, lifetimeSec };
}

// Build the JWT for a user (with live permissions and tab binding) and attach the session cookie.
export async function issueSession(user, extra = {}) {
  const { tabId, ...restExtra } = extra;
  if (!tabId || typeof tabId !== 'string') {
    return NextResponse.json({ error: 'tabId is required' }, { status: 400 });
  }

  const permissions   = await getRolePermissions(db, Collections, user.role, user);
  const dashboardPath = getDashboardPath(user.role, permissions);
  const { lifetimeSec } = sessionPolicy(user, permissions);
  const tid = hashTabId(tabId);

  const token = await createToken({
    id:           user.id,
    regNo:        user.regNo    || '',
    name:         user.name,
    role:         user.role,
    username:     user.username || '',
    tokenVersion: user.tokenVersion || 0,
    dashboardPath,
    permissions,
    tid,
  }, lifetimeSec);

  const response = NextResponse.json({
    success: true,
    role: user.role,
    dashboardPath,
    mustChangePassword: !!user.mustChangePassword,
    ...restExtra,
  });
  return setTokenCookie(response, token);
}

// Authenticate an API request. Returns { payload } or { error: NextResponse }.
//   opts.perm  -> required permission     opts.roles -> allowed built-in roles
export async function authenticate(request, opts = {}) {
  const token   = getTokenFromRequest(request);
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return { error: clearTokenCookie(NextResponse.json({ error: 'Unauthorized' }, { status: 401 })) };

  const tabId = request.headers.get('x-tab-id');
  if (!tabId || hashTabId(tabId) !== payload.tid) {
    return {
      error: clearTokenCookie(NextResponse.json({
        error: 'This sign-in belongs to another tab. Please sign in again.',
        code: 'TAB',
      }, { status: 401 })),
    };
  }

  if (opts.roles && !opts.roles.includes(payload.role) && !(opts.perm && can(payload, opts.perm)))
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  if (opts.perm && !opts.roles && !can(payload, opts.perm))
    return { error: NextResponse.json({ error: 'You do not have permission for this action.' }, { status: 403 }) };
  return { payload };
}

export function clientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
