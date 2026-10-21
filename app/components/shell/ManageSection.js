'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, hasPerm } from '@/app/components/user';
import PageHeader from './PageHeader';
import Overview from '@/app/components/manage/Overview';
import AttendancePanel from '@/app/components/manage/AttendancePanel';
import UsersPanel from '@/app/components/manage/UsersPanel';
import ReportsPanel from '@/app/components/manage/ReportsPanel';
import BenefitsPanel from '@/app/components/manage/BenefitsPanel';
import PromotePanel from '@/app/components/manage/PromotePanel';
import RolesPanel from '@/app/components/manage/RolesPanel';
import SettingsPanel from '@/app/components/manage/SettingsPanel';
import SheetsPanel from '@/app/components/manage/SheetsPanel';
import LogsPanel from '@/app/components/manage/LogsPanel';
import HealthPanel from '@/app/components/manage/HealthPanel';
import ApprovalsPanel from '@/app/components/manage/ApprovalsPanel';
import MarkAttendance from '@/app/components/MarkAttendance';

const ALIASES = {
  attendance: 'records',
  sheets: 'sheet',
  promote: 'promotion',
  logs: 'log',
};

const VALID_SECTIONS = [
  'overview',
  'approvals',
  'mark',
  'records',
  'people',
  'reports',
  'benefits',
  'sheet',
  'health',
  'settings',
  'promotion',
  'roles',
  'log',
];

export function canAccessSection(user, sec) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  switch (sec) {
    case 'overview':
    case 'records':
    case 'reports':
    case 'log':
      return hasPerm(user, 'canViewAllAttendance');
    case 'approvals':
      return hasPerm(user, 'canApproveAttendance');
    case 'mark':
      return hasPerm(user, 'canMarkAttendance');
    case 'people':
      return hasPerm(user, 'canManageUsers') || hasPerm(user, 'canViewAllAttendance');
    case 'benefits':
      return hasPerm(user, 'canViewAllAttendance') || hasPerm(user, 'canManageBenefits');
    case 'sheet':
      return hasPerm(user, 'canSyncSheets');
    case 'settings':
      return hasPerm(user, 'canManageSettings');
    case 'promotion':
      return hasPerm(user, 'canPromoteCadets');
    case 'health':
    case 'roles':
      return user.role === 'admin';
    default:
      return false;
  }
}

export default function ManageSection({ section: rawSection }) {
  const router = useRouter();
  const user = useUser();
  const base = user?.dashboardPath || (user?.role === 'cto' ? '/dashboard/cto' : '/dashboard/admin');
  const canApprove = (user?.role === 'admin' || user?.role === 'cto') && hasPerm(user, 'canApproveAttendance');

  const canonicalSection = useMemo(() => {
    const s = String(rawSection || '').toLowerCase();
    return ALIASES[s] || s;
  }, [rawSection]);

  const [activeSection, setActiveSection] = useState(canonicalSection);

  useEffect(() => {
    setActiveSection(canonicalSection);
  }, [canonicalSection]);

  const currentSection = activeSection;
  const isValid = VALID_SECTIONS.includes(currentSection);
  const isAllowed = canAccessSection(user, currentSection);

  useEffect(() => {
    if (!user) return;
    if (!isValid || !isAllowed) {
      router.replace(`${base}/overview`);
    }
  }, [user, isValid, isAllowed, base, router]);

  if (!user || !isValid || !isAllowed) {
    return null;
  }

  const goTab = (target) => {
    const norm = ALIASES[target] || target;
    setActiveSection(norm);
    router.push(`${base}/${norm}`);
  };

  const getSectionInfo = () => {
    switch (currentSection) {
      case 'overview':
        return {
          title: 'Overview',
          description: 'Attendance statistics and squadron activity summary',
        };
      case 'approvals':
        return {
          title: 'Approvals',
          description: 'Review and approve submitted parade attendance',
        };
      case 'mark':
        return {
          title: 'Mark attendance',
          description: 'Take live or historical parade attendance for cadets',
        };
      case 'records':
        return {
          title: 'Records',
          description: 'Past parade attendance sessions and cadet registers',
        };
      case 'people':
        return {
          title: hasPerm(user, 'canManageUsers') ? 'People' : 'Cadets',
          description: hasPerm(user, 'canManageUsers')
            ? 'Cadet roster, attendance markers and staff accounts'
            : 'Cadet roster and attendance profiles',
        };
      case 'reports':
        return {
          title: 'Reports',
          description: 'Download PDF and Excel reports for parades, cadets and unit summaries',
        };
      case 'benefits':
        return {
          title: 'Benefits',
          description: 'Grant parade attendance credits for camps and institutional duties',
        };
      case 'sheet':
        return {
          title: 'Google Sheet',
          description: 'Sync, inspect and repair connected Google Sheets tabs and roster data',
        };
      case 'health':
        return {
          title: 'System health',
          description: 'API response times, background workers and SMTP email service status',
        };
      case 'settings':
        return {
          title: 'Settings',
          description: 'Configure squadron settings, officer emails and absence alert thresholds',
        };
      case 'promotion':
        return {
          title: 'Promotion',
          description: 'Promote cadets to the next year, graduate seniors and reset the cycle',
        };
      case 'roles':
        return {
          title: 'Roles',
          description: 'Configure role permissions and access control',
        };
      case 'log':
        return {
          title: 'Change log',
          description: 'Audit history of attendance edits and administrative actions',
        };
      default:
        return { title: canonicalSection };
    }
  };

  const info = getSectionInfo();

  return (
    <>
      <PageHeader title={info.title} description={info.description} />
      {currentSection === 'overview' && <Overview goTab={goTab} />}
      {currentSection === 'approvals' && <ApprovalsPanel onChanged={() => {}} />}
      {currentSection === 'mark' && (
        <MarkAttendance
          goHistory={() => {
            const target = canApprove ? 'approvals' : 'records';
            setActiveSection(target);
            router.push(`${base}/${target}`);
          }}
          who="manager"
        />
      )}
      {currentSection === 'records' && <AttendancePanel />}
      {currentSection === 'people' && <UsersPanel readOnly={!hasPerm(user, 'canManageUsers')} />}
      {currentSection === 'reports' && <ReportsPanel />}
      {currentSection === 'benefits' && <BenefitsPanel />}
      {currentSection === 'sheet' && <SheetsPanel />}
      {currentSection === 'health' && <HealthPanel />}
      {currentSection === 'settings' && <SettingsPanel />}
      {currentSection === 'promotion' && <PromotePanel />}
      {currentSection === 'roles' && <RolesPanel />}
      {currentSection === 'log' && <LogsPanel />}
    </>
  );
}
