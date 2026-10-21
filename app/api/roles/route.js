export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';
import { DEFAULT_PERMISSIONS, PERMISSION_LABELS } from '@/lib/permissions';

const BUILTIN_ROLES = ['admin', 'cto', 'marker', 'cadet'];
const KEYS = Object.keys(PERMISSION_LABELS);
const cleanPerms = (p = {}) => Object.fromEntries(KEYS.map(k => [k, p[k] === true]));

export async function GET(request) {
  const token   = getTokenFromRequest(request);
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== 'admin')
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 });

  const snap  = await db.collection(Collections.ROLE_CONFIG).get();
  const saved = {};
  snap.docs.forEach(d => { saved[d.id] = d.data(); });

  const roles = {};
  for (const [role, defaults] of Object.entries(DEFAULT_PERMISSIONS)) {
    roles[role] = { ...defaults, ...(saved[role] || {}), isBuiltin: true };
  }
  for (const [roleId, data] of Object.entries(saved)) {
    if (!BUILTIN_ROLES.includes(roleId)) {
      roles[roleId] = { ...data, isBuiltin: false };
    }
  }
  return NextResponse.json({ roles, permissionLabels: PERMISSION_LABELS });
}

export async function PUT(request) {
  const token   = getTokenFromRequest(request);
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== 'admin')
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { role, label } = body;
  if (!role || !body.permissions)
    return NextResponse.json({ error: 'role and permissions required.' }, { status: 400 });
  const permissions = cleanPerms(body.permissions);

  // Admin always keeps full access — safety lock
  if (role === 'admin') {
    Object.keys(DEFAULT_PERMISSIONS.admin).forEach(k => { permissions[k] = true; });
  }

  await db.collection(Collections.ROLE_CONFIG).doc(role).set(
    { ...permissions, label: String(label || role).slice(0, 40) },
    { merge: true }
  );

  // ── Force re-login for all users with this role ───────────────────────────
  // Their JWT has stale permissions baked in. Bumping tokenVersion means
  // /api/me detects the mismatch and clears their cookie on next page load.
  try {
    const usersSnap = await db.collection(Collections.USERS).where('role', '==', role).get();
    if (!usersSnap.empty) {
      const batch      = db.batch();
      const newVersion = Date.now();
      usersSnap.docs.forEach(doc => batch.update(doc.ref, { tokenVersion: newVersion }));
      await batch.commit();
      console.log(`[ROLES] Bumped tokenVersion for ${usersSnap.size} users with role '${role}'`);
    }
  } catch (e) {
    console.error('[ROLES] Failed to bump tokenVersion:', e.message);
    // Don't fail the save — permissions are already written to Firestore
  }

  return NextResponse.json({ success: true });
}

export async function POST(request) {
  const token   = getTokenFromRequest(request);
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== 'admin')
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 });

  const { roleId, label, permissions } = await request.json();
  if (!roleId || !label)
    return NextResponse.json({ error: 'roleId and label required.' }, { status: 400 });
  if (BUILTIN_ROLES.includes(roleId.toLowerCase()))
    return NextResponse.json({ error: 'Cannot override built-in role names.' }, { status: 400 });

  const clean = roleId.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!clean) return NextResponse.json({ error: 'Invalid roleId.' }, { status: 400 });

  await db.collection(Collections.ROLE_CONFIG).doc(clean).set({
    label: String(label).slice(0, 40), isBuiltin: false,
    ...cleanPerms(permissions),
  });
  return NextResponse.json({ success: true, roleId: clean });
}

export async function DELETE(request) {
  const token   = getTokenFromRequest(request);
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== 'admin')
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 });

  const { roleId } = await request.json();
  if (BUILTIN_ROLES.includes(roleId))
    return NextResponse.json({ error: 'Cannot delete built-in roles.' }, { status: 400 });

  await db.collection(Collections.ROLE_CONFIG).doc(roleId).delete();
  return NextResponse.json({ success: true });
}