// Shared permission defaults and utilities used by login + API routes

export const DEFAULT_PERMISSIONS = {
  admin:  { canMarkAttendance:true,  canViewAllAttendance:true,  canDeleteAttendance:true,  canEditAttendance:true,  canManageUsers:true,  canSyncSheets:true,  canPromoteCadets:true,  canManageBenefits:true,  canManageSettings:true,  canApproveAttendance:true  },
  cto:    { canMarkAttendance:true,  canViewAllAttendance:true,  canDeleteAttendance:false, canEditAttendance:false, canManageUsers:false, canSyncSheets:false, canPromoteCadets:false, canManageBenefits:true,  canManageSettings:false, canApproveAttendance:true  },
  marker: { canMarkAttendance:true,  canViewAllAttendance:false, canDeleteAttendance:false, canEditAttendance:false, canManageUsers:false, canSyncSheets:false, canPromoteCadets:false, canManageBenefits:false, canManageSettings:false, canApproveAttendance:false },
  cadet:  { canMarkAttendance:false, canViewAllAttendance:false, canDeleteAttendance:false, canEditAttendance:false, canManageUsers:false, canSyncSheets:false, canPromoteCadets:false, canManageBenefits:false, canManageSettings:false, canApproveAttendance:false },
};

export const PERMISSION_LABELS = {
  canMarkAttendance:    'Mark Attendance',
  canViewAllAttendance: 'View All Attendance & Reports',
  canEditAttendance:    'Edit Submitted Attendance',
  canDeleteAttendance:  'Delete Attendance Records',
  canManageUsers:       'Manage Users (Add/Edit/Deactivate)',
  canSyncSheets:        'Sync Google Sheets',
  canPromoteCadets:     'Promote Cadets (Year Promotion)',
  canManageBenefits:    'Manage Attendance Benefits',
  canManageSettings:    'Manage System Settings',
  canApproveAttendance: 'Approve Submitted Attendance',
};

// Does this logged-in user hold this permission?
// Admin always does. Otherwise the permissions baked into the JWT at login win,
// falling back to the built-in defaults for the role.
export function can(payload, permission) {
  if (!payload) return false;
  if (payload.role === 'admin') return true;
  if (payload.permissions && permission in payload.permissions) return payload.permissions[permission] === true;
  return DEFAULT_PERMISSIONS[payload.role]?.[permission] === true;
}

// Decide which dashboard a role should land on based on permissions
export function getDashboardPath(roleOrUser, perms = {}) {
  const role = typeof roleOrUser === 'object' && roleOrUser !== null ? roleOrUser.role : roleOrUser;
  const mergedPerms = typeof roleOrUser === 'object' && roleOrUser !== null
    ? { ...(roleOrUser.permissions || {}), ...perms }
    : perms;
  if (role === 'admin')  return '/dashboard/admin';
  if (role === 'cto')    return '/dashboard/cto';
  if (role === 'marker') return '/dashboard/marker';
  if (role === 'cadet')  return '/dashboard/cadet';
  // Custom roles — route by highest capability
  if (mergedPerms.canManageUsers)       return '/dashboard/admin';
  if (mergedPerms.canViewAllAttendance) return '/dashboard/cto';
  if (mergedPerms.canMarkAttendance)    return '/dashboard/marker';
  return '/dashboard/cadet';
}

// Fetch merged permissions for a role (defaults + Firestore overrides)
export async function getRolePermissions(db, Collections, role, user = null) {
  const defaults = DEFAULT_PERMISSIONS[role] ?? DEFAULT_PERMISSIONS.cadet;
  try {
    const doc = await db.collection(Collections.ROLE_CONFIG).doc(role).get();
    let merged = { ...defaults };
    if (doc.exists) {
      const data = doc.data();
      const { label, isBuiltin, ...permFields } = data;       // strip non-permission fields
      merged = { ...defaults, ...permFields };
    }
    if (role === 'admin') for (const k of Object.keys(DEFAULT_PERMISSIONS.admin)) merged[k] = true;
    // Admin and Sir (CTO) must always be able to take attendance and approve submissions
    if (role === 'cto') { merged.canMarkAttendance = true; merged.canApproveAttendance = true; }
    return merged;
  } catch {
    return { ...defaults };
  }
}
