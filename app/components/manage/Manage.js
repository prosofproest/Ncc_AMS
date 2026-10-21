'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { TabNav } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import { useUser, hasPerm } from '@/app/components/user';
import Overview from './Overview';
import AttendancePanel from './AttendancePanel';
import UsersPanel from './UsersPanel';
import ReportsPanel from './ReportsPanel';
import BenefitsPanel from './BenefitsPanel';
import PromotePanel from './PromotePanel';
import RolesPanel from './RolesPanel';
import SettingsPanel from './SettingsPanel';
import SheetsPanel from './SheetsPanel';
import LogsPanel from './LogsPanel';
import HealthPanel from './HealthPanel';
import ApprovalsPanel from './ApprovalsPanel';
import MarkAttendance from '@/app/components/MarkAttendance';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { useUI } from '@/app/components/ui';

// One dashboard for the Admin and for Sir (CTO). Each person only sees the tabs their role allows.
export default function Manage() {
  const user = useUser(); const { toast } = useUI();
  const canApprove = (user.role === 'admin' || user.role === 'cto') && hasPerm(user, 'canApproveAttendance');
  // Live counter: a cheap count query every 6 s (only while the tab is visible)
  const { data: counts, refresh: refreshCounts } = useRealtimeData(canApprove ? '/api/approvals?summary=1' : null, 6000);
  const needsMe = counts?.needsMe || 0;
  const lastNeeds = useRef(null);
  useEffect(() => {
    if (!counts) return;
    if (lastNeeds.current !== null && counts.needsMe > lastNeeds.current) toast(`${counts.needsMe - lastNeeds.current} new attendance submission${counts.needsMe - lastNeeds.current > 1 ? 's' : ''} waiting for your approval`, 'info', 7000);
    lastNeeds.current = counts.needsMe;
  }, [counts, toast]);
  const tabs = useMemo(() => {
    const view = hasPerm(user, 'canViewAllAttendance'), manage = hasPerm(user, 'canManageUsers');
    return [
      view && { id: 'overview', label: 'Overview', short: 'Home', icon: 'home' },
      canApprove && { id: 'approvals', label: 'Approvals', short: 'Approve', icon: 'clipboard-check', badge: needsMe },
      hasPerm(user, 'canMarkAttendance') && { id: 'mark', label: 'Mark attendance', short: 'Mark', icon: 'check-circle' },
      view && { id: 'attendance', label: 'Attendance', short: 'Records', icon: 'list' },
      (manage || view) && { id: 'people', label: manage ? 'People' : 'Cadets', short: manage ? 'People' : 'Cadets', icon: 'users' },
      view && { id: 'reports', label: 'Reports', short: 'Reports', icon: 'file-text' },
      (view || hasPerm(user, 'canManageBenefits')) && { id: 'benefits', label: 'Benefits', icon: 'award' },
      hasPerm(user, 'canSyncSheets') && { id: 'sheets', label: 'Google Sheet', short: 'Sheet', icon: 'table' },
      user.role === 'admin' && { id: 'health', label: 'System health', short: 'Health', icon: 'activity' },
      hasPerm(user, 'canManageSettings') && { id: 'settings', label: 'Settings', icon: 'settings' },
      hasPerm(user, 'canPromoteCadets') && { id: 'promote', label: 'Promotion', icon: 'graduation-cap' },
      user.role === 'admin' && { id: 'roles', label: 'Roles', icon: 'shield' },
      view && { id: 'logs', label: 'Change log', icon: 'history' },
    ].filter(Boolean);
  }, [user, canApprove, needsMe]);

  const [tab, setTab] = useState(null);
  useEffect(() => { const saved = sessionStorage.getItem('ncc_tab'); setTab(tabs.some(t => t.id === saved) ? saved : tabs[0]?.id); }, [tabs]);
  const change = id => { setTab(id); try { sessionStorage.setItem('ncc_tab', id); } catch {} };
  if (!tab) return null;
  const cur = tabs.find(t => t.id === tab);

  return (
    <>
      <div className="row between wrap mb">
        <div><div className="eyebrow">{user.role === 'admin' ? 'Administrator' : 'Care Taker Officer'}</div><h1 className="title">{cur.label}</h1></div>
        <TabNav tabs={tabs} active={tab} onChange={change} />
      </div>
      {canApprove && needsMe > 0 && tab !== 'approvals' && (
        <div className="banner warn mb" style={{ cursor: 'pointer' }} onClick={() => change('approvals')}>
          <Icon name="clock" size={16} /> {needsMe} attendance submission{needsMe > 1 ? 's are' : ' is'} waiting for your approval.
          <span className="btn btn-sm btn-primary right">Review</span>
        </div>
      )}
      {tab === 'overview' && <Overview goTab={change} />}
      {tab === 'approvals' && <ApprovalsPanel onChanged={refreshCounts} />}
      {tab === 'mark' && <MarkAttendance goHistory={() => change(canApprove ? 'approvals' : 'attendance')} who="manager" />}
      {tab === 'attendance' && <AttendancePanel />}
      {tab === 'people' && <UsersPanel readOnly={!hasPerm(user, 'canManageUsers')} />}
      {tab === 'reports' && <ReportsPanel />}
      {tab === 'benefits' && <BenefitsPanel />}
      {tab === 'sheets' && <SheetsPanel />}
      {tab === 'health' && <HealthPanel />}
      {tab === 'settings' && <SettingsPanel />}
      {tab === 'promote' && <PromotePanel />}
      {tab === 'roles' && <RolesPanel />}
      {tab === 'logs' && <LogsPanel />}
    </>
  );
}
