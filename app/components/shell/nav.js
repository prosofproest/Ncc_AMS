import { hasPerm } from '@/app/components/user';

// Return groups of navigation items based on user permissions
export function navFor(user, needsMe = 0) {
  if (!user) return [];
  const role = user.role;
  const can = perm => hasPerm(user, perm);
  const base = user.dashboardPath || (role === 'admin' ? '/dashboard/admin' : role === 'cto' ? '/dashboard/cto' : role === 'marker' ? '/dashboard/marker' : '/dashboard/cadet');

  // Cadet: My attendance, Leaderboard, Calendar
  if (role === 'cadet') {
    return [
      {
        title: 'Cadet',
        items: [
          { id: 'cadet', label: 'My attendance', icon: 'user', href: '/dashboard/cadet', primary: true },
          { id: 'leaderboard', label: 'Leaderboard', icon: 'trophy', href: '/dashboard/leaderboard', primary: true },
          { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/dashboard/calendar', primary: true },
        ],
      },
    ];
  }

  // Attendance marker (only marks attendance)
  if (role === 'marker' || (!can('canViewAllAttendance') && !can('canManageUsers') && can('canMarkAttendance'))) {
    return [
      {
        title: 'Attendance',
        items: [
          { id: 'mark', label: 'Mark attendance', icon: 'check-circle', href: `${base}/mark`, primary: true },
          { id: 'history', label: 'History & status', icon: 'history', href: `${base}/history`, primary: true },
        ],
      },
    ];
  }

  // Admin / CTO / Custom management roles
  const attendanceItems = [
    can('canViewAllAttendance') && { id: 'overview', label: 'Overview', icon: 'home', href: `${base}/overview`, primary: true },
    can('canApproveAttendance') && { id: 'approvals', label: 'Approvals', icon: 'clipboard-check', href: `${base}/approvals`, badge: needsMe > 0 ? needsMe : null, primary: true },
    can('canMarkAttendance') && { id: 'mark', label: 'Mark attendance', icon: 'check-circle', href: `${base}/mark`, primary: true },
    can('canViewAllAttendance') && { id: 'records', label: 'Records', icon: 'list', href: `${base}/records`, primary: true },
    role === 'admin' && { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/dashboard/calendar' },
  ].filter(Boolean);

  const peopleItems = [
    (can('canManageUsers') || can('canViewAllAttendance')) && {
      id: 'people',
      label: can('canManageUsers') ? 'People' : 'Cadets',
      icon: 'users',
      href: `${base}/people`,
    },
    can('canViewAllAttendance') && { id: 'reports', label: 'Reports', icon: 'file-text', href: `${base}/reports` },
    (can('canViewAllAttendance') || can('canManageBenefits')) && { id: 'benefits', label: 'Benefits', icon: 'award', href: `${base}/benefits` },
  ].filter(Boolean);

  const systemItems = [
    can('canSyncSheets') && { id: 'sheet', label: 'Google Sheet', icon: 'table', href: `${base}/sheet` },
    can('canManageSettings') && { id: 'settings', label: 'Settings', icon: 'settings', href: `${base}/settings` },
    can('canPromoteCadets') && { id: 'promotion', label: 'Promotion', icon: 'graduation-cap', href: `${base}/promotion` },
    role === 'admin' && { id: 'roles', label: 'Roles', icon: 'shield', href: `${base}/roles` },
    role === 'admin' && { id: 'health', label: 'System health', icon: 'activity', href: `${base}/health` },
    can('canViewAllAttendance') && { id: 'log', label: 'Change log', icon: 'history', href: `${base}/log` },
  ].filter(Boolean);

  const groups = [];
  if (attendanceItems.length) groups.push({ title: 'Attendance', items: attendanceItems });
  if (peopleItems.length) groups.push({ title: 'People and reports', items: peopleItems });
  if (systemItems.length) groups.push({ title: 'System', items: systemItems });
  return groups;
}

export function isItemActive(pathname, href) {
  if (!pathname || !href) return false;
  if (pathname === href) return true;
  if (href === '/dashboard/cadet' || href === '/dashboard/leaderboard' || href === '/dashboard/calendar') {
    return pathname === href;
  }
  return pathname.startsWith(href);
}
