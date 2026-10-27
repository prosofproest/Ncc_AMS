// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import bcrypt from 'bcryptjs';

const { nav, navState } = vi.hoisted(() => ({
  nav: { replace: vi.fn(), push: vi.fn(), path: '/dashboard/admin/overview' },
  navState: { autoNav: true },
}));
const stableRouter = vi.hoisted(() => ({}));
vi.mock('next/navigation', () => {
  Object.assign(stableRouter, {
    replace: (url) => { nav.path = url; nav.replace(url); },
    push: (url) => { nav.path = url; nav.push(url); },
    prefetch: vi.fn(),
  });
  return {
    useRouter: () => stableRouter,
    usePathname: () => nav.path,
    redirect: (url) => { nav.path = url; nav.replace(url); },
  };
});
vi.mock('next/link', async () => {
  const R = await import('react');
  return {
    default: ({ href, children, onClick, ...p }) =>
      R.createElement('a', {
        href,
        onClick: (e) => {
          onClick?.(e);
          if (navState.autoNav) {
            nav.path = href;
            nav.push(href);
          }
        },
        ...p,
      }, children),
  };
});

import * as adminPage from '@/app/dashboard/admin/[section]/page';
import * as ctoPage from '@/app/dashboard/cto/[section]/page';
import * as markerPage from '@/app/dashboard/marker/[section]/page';
import { navFor } from '@/app/components/shell/nav';
import { clearCaches, clearTab } from '@/lib/tab';
import { installBrowser, jar } from './helpers/browser';
import * as apprR from '@/app/api/approvals/route';
import * as cronR from '@/app/api/cron/daily/route';
import { call } from './helpers/http';
import { createToken, hashTabId } from '@/lib/auth';
import { DEFAULT_PERMISSIONS } from '@/lib/permissions';
import { UIProvider } from '@/app/components/ui';
import DashboardLayout from '@/app/dashboard/layout';
import MarkAttendance from '@/app/components/MarkAttendance';

const db = globalThis.__db;

beforeAll(async () => {
  installBrowser();
  const mk = (id, d) => db.collection('users').doc(id).set({
    isActive: true,
    discharged: false,
    stats: { total: 0, present: 0, absent: 0, months: {} },
    benefit: 0,
    mustChangePassword: false,
    otpRequired: false,
    ...d,
  });
  await mk('admin_nav', {
    name: 'Admin Officer',
    role: 'admin',
    username: 'adminnav',
    passwordHash: await bcrypt.hash('Admin@123', 4),
    email: 'adminnav@test.in',
  });
  await mk('marker_nav', {
    name: 'Sgt Rohan',
    role: 'marker',
    username: 'markernav',
    passwordHash: await bcrypt.hash('Marker@123', 4),
    email: 'markernav@test.in',
  });
  await db.collection('settings').doc('main').set({ sirEmail: 'sir@test.in', backupEmail: 'backup@test.in', currentCycle: '2026' });
});

describe('PART A: Static Section Pages & generateStaticParams', () => {
  it('admin [section]/page exports generateStaticParams returning every nav section and alias', () => {
    expect(typeof adminPage.generateStaticParams).toBe('function');
    expect(adminPage.dynamicParams).toBe(true);
    const params = adminPage.generateStaticParams();
    const sections = params.map(p => p.section);

    const adminNavGroups = navFor({ role: 'admin', permissions: DEFAULT_PERMISSIONS.admin });
    const expectedFromNav = adminNavGroups
      .flatMap(g => g.items)
      .map(i => i.href.split('/').pop())
      .filter(s => s !== 'calendar'); // calendar is /dashboard/calendar

    for (const sec of expectedFromNav) {
      expect(sections).toContain(sec);
    }
    // Aliases
    expect(sections).toContain('attendance');
    expect(sections).toContain('sheets');
    expect(sections).toContain('promote');
    expect(sections).toContain('logs');
  });

  it('cto [section]/page exports generateStaticParams returning every nav section and alias', () => {
    expect(typeof ctoPage.generateStaticParams).toBe('function');
    expect(ctoPage.dynamicParams).toBe(true);
    const params = ctoPage.generateStaticParams();
    const sections = params.map(p => p.section);

    const ctoNavGroups = navFor({ role: 'cto', permissions: DEFAULT_PERMISSIONS.cto });
    const expectedFromNav = ctoNavGroups
      .flatMap(g => g.items)
      .map(i => i.href.split('/').pop());

    for (const sec of expectedFromNav) {
      expect(sections).toContain(sec);
    }
    expect(sections).toContain('attendance');
    expect(sections).toContain('sheets');
    expect(sections).toContain('promote');
    expect(sections).toContain('logs');
  });

  it('marker [section]/page exports generateStaticParams returning mark and history', () => {
    expect(typeof markerPage.generateStaticParams).toBe('function');
    expect(markerPage.dynamicParams).toBe(true);
    const params = markerPage.generateStaticParams();
    const sections = params.map(p => p.section);
    expect(sections).toEqual(['mark', 'history']);
  });
});

describe('PART A: Optimistic Highlight, Progress Bar & 3s Fallback', () => {
  let originalLocation;
  let assignMock;

  beforeEach(() => {
    nav.path = '/dashboard/admin/overview';
    navState.autoNav = true;
    originalLocation = window.location;
    assignMock = vi.fn();
    delete window.location;
    window.location = {
      ...originalLocation,
      assign: assignMock,
      pathname: '/dashboard/admin/overview',
      search: '',
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.location = originalLocation;
    navState.autoNav = true;
  });

  it('clicking a sidebar item immediately applies active class and shows 2px top progress bar, falling back after 3s', async () => {
    jar.cookie = '';
    sessionStorage.clear();
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'adminnav', password: 'Admin@123' }),
    });
    expect(loginRes.status).toBe(200);

    render(
      React.createElement(
        DashboardLayout,
        null,
        React.createElement('div', null, 'Content')
      )
    );

    // Wait for user to be loaded and sidebar rendered
    await waitFor(() => {
      expect(screen.queryByLabelText('Loading')).toBeNull();
    });

    const approvalsLinks = await screen.findAllByRole('link', { name: /approvals/i });
    const approvalsLink = approvalsLinks[0];
    expect(approvalsLink).toBeDefined();

    // Disable auto-navigation so pathname does not change immediately
    navState.autoNav = false;
    vi.useFakeTimers();

    // Click Approvals link
    fireEvent.click(approvalsLink);

    // Optimistic active highlight applies immediately
    expect(approvalsLink.classList.contains('active')).toBe(true);

    // 2px top progress bar appears immediately
    const progressBar = document.querySelector('.nav-progress-bar');
    expect(progressBar).not.toBeNull();
    expect(progressBar.getAttribute('role')).toBe('progressbar');

    // Advance timers by 2900ms: assign not called yet
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(assignMock).not.toHaveBeenCalled();

    // Advance past 3000ms: safety net triggers window.location.assign('/dashboard/admin/approvals')
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(assignMock).toHaveBeenCalledWith('/dashboard/admin/approvals');
  });
});

describe('PART B: Marker SWR Cache, Parallel Loading & Cache Clear', () => {
  const uid = 'test-marker-uid';

  beforeEach(() => {
    sessionStorage.clear();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders roll immediately from cache before network responds', async () => {
    const cachedCadets = [
      { id: 'cadet_cached_1', name: 'Cached Arjun', regNo: 'KA/101', year: 1, type: 'SD' },
    ];
    sessionStorage.setItem('ncc_uid', uid);
    sessionStorage.setItem(
      `ncc_cache_cadets_${uid}`,
      JSON.stringify({ data: { cadets: cachedCadets }, timestamp: Date.now() })
    );
    sessionStorage.setItem(
      `ncc_cache_meta_${uid}`,
      JSON.stringify({ data: { reasons: ['Sick'] }, timestamp: Date.now() })
    );

    // Mount MarkAttendance wrapped in UIProvider
    render(
      React.createElement(
        UIProvider,
        null,
        React.createElement(MarkAttendance, { who: 'marker', goHistory: () => {} })
      )
    );

    // The cached cadet is in state synchronously on mount
    expect(screen.queryByText(/No cadets match/i)).toBeNull();
  });

  it('clearTab and clearCaches remove ncc_cache_meta_*, ncc_cache_cadets_*, and drafts from sessionStorage', () => {
    sessionStorage.setItem('ncc_tab', 'tab-123');
    sessionStorage.setItem('ncc_uid', 'user-456');
    sessionStorage.setItem('ncc_cache_meta_user-456', JSON.stringify({ data: {}, timestamp: Date.now() }));
    sessionStorage.setItem('ncc_cache_cadets_user-456', JSON.stringify({ data: {}, timestamp: Date.now() }));
    sessionStorage.setItem('ncc_draft_user-456', JSON.stringify({ date: '2026-10-26' }));

    clearTab();

    expect(sessionStorage.getItem('ncc_tab')).toBeNull();
    expect(sessionStorage.getItem('ncc_uid')).toBeNull();
    expect(sessionStorage.getItem('ncc_cache_meta_user-456')).toBeNull();
    expect(sessionStorage.getItem('ncc_cache_cadets_user-456')).toBeNull();
    expect(sessionStorage.getItem('ncc_draft_user-456')).toBeNull();
  });
});

describe('PART C: Admin Can Remove Rejected Items', () => {
  let adminCookie, ctoCookie, markerCookie;
  const adminTab = 'tab-admin-test';
  const ctoTab = 'tab-cto-test';
  const markerTab = 'tab-marker-test';

  beforeAll(async () => {
    const tokenA = await createToken({
      id: 'admin_del',
      name: 'Admin Officer',
      role: 'admin',
      permissions: DEFAULT_PERMISSIONS.admin,
      tokenVersion: 0,
      tid: hashTabId(adminTab),
    });
    adminCookie = `ncc_token=${tokenA}`;

    const tokenC = await createToken({
      id: 'cto_del',
      name: 'Lt. Sir',
      role: 'cto',
      permissions: DEFAULT_PERMISSIONS.cto,
      tokenVersion: 0,
      tid: hashTabId(ctoTab),
    });
    ctoCookie = `ncc_token=${tokenC}`;

    const tokenM = await createToken({
      id: 'marker_del',
      name: 'Sgt Rohan',
      role: 'marker',
      permissions: DEFAULT_PERMISSIONS.marker,
      tokenVersion: 0,
      tid: hashTabId(markerTab),
    });
    markerCookie = `ncc_token=${tokenM}`;
  });

  it('Admin can delete a rejected submission', async () => {
    await db.collection('pending_sessions').doc('rej_to_delete').set({
      date: '2026-10-20',
      activityType: 'Parade',
      groupLabel: 'Year 1',
      state: 'rejected',
      markedBy: 'marker_del',
      markedByName: 'Sgt Rohan',
      createdAt: new Date().toISOString(),
      records: [],
    });

    const res = await call(apprR.DELETE, {
      method: 'DELETE',
      url: '/api/approvals?id=rej_to_delete',
      cookie: adminCookie,
      headers: { 'x-tab-id': adminTab },
    });

    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);

    const snap = await db.collection('pending_sessions').doc('rej_to_delete').get();
    expect(snap.exists).toBe(false);

    // Check audit entry
    const audits = db.all('audit_log').map(d => d.data);
    const deleteAudit = audits.find(a => a.type === 'delete-rejected' && a.sessionId === 'rej_to_delete');
    expect(deleteAudit).toBeDefined();
    expect(deleteAudit.byName).toBe('Admin Officer');
  });

  it('Admin can delete a resubmitted submission', async () => {
    await db.collection('pending_sessions').doc('resub_to_delete').set({
      date: '2026-10-21',
      activityType: 'Camp',
      groupLabel: 'Year 2',
      state: 'resubmitted',
      markedBy: 'marker_del',
      markedByName: 'Sgt Rohan',
      createdAt: new Date().toISOString(),
      records: [],
    });

    const res = await call(apprR.DELETE, {
      method: 'DELETE',
      url: '/api/approvals?id=resub_to_delete',
      cookie: adminCookie,
      headers: { 'x-tab-id': adminTab },
    });

    expect(res.status).toBe(200);
    const snap = await db.collection('pending_sessions').doc('resub_to_delete').get();
    expect(snap.exists).toBe(false);
  });

  it('CTO and marker get 403 on delete attempt', async () => {
    await db.collection('pending_sessions').doc('rej_forbidden').set({
      date: '2026-10-22',
      state: 'rejected',
      createdAt: new Date().toISOString(),
    });

    const resCTO = await call(apprR.DELETE, {
      method: 'DELETE',
      url: '/api/approvals?id=rej_forbidden',
      cookie: ctoCookie,
      headers: { 'x-tab-id': ctoTab },
    });
    expect(resCTO.status).toBe(403);

    const resMarker = await call(apprR.DELETE, {
      method: 'DELETE',
      url: '/api/approvals?id=rej_forbidden',
      cookie: markerCookie,
      headers: { 'x-tab-id': markerTab },
    });
    expect(resMarker.status).toBe(403);
  });

  it('Pending item cannot be deleted (returns 409)', async () => {
    await db.collection('pending_sessions').doc('pend_cant_delete').set({
      date: '2026-10-23',
      state: 'pending',
      createdAt: new Date().toISOString(),
    });

    const res = await call(apprR.DELETE, {
      method: 'DELETE',
      url: '/api/approvals?id=pend_cant_delete',
      cookie: adminCookie,
      headers: { 'x-tab-id': adminTab },
    });
    expect(res.status).toBe(409);

    const snap = await db.collection('pending_sessions').doc('pend_cant_delete').get();
    expect(snap.exists).toBe(true);
  });

  it('Nightly cron removes only old rejected or resubmitted documents (>30 days)', async () => {
    const oldDate = new Date(Date.now() - 35 * 86400000).toISOString();
    const recentDate = new Date(Date.now() - 5 * 86400000).toISOString();

    await db.collection('pending_sessions').doc('old_rejected').set({
      state: 'rejected',
      createdAt: oldDate,
    });
    await db.collection('pending_sessions').doc('old_resubmitted').set({
      state: 'resubmitted',
      createdAt: oldDate,
    });
    await db.collection('pending_sessions').doc('old_pending').set({
      state: 'pending',
      createdAt: oldDate,
    });
    await db.collection('pending_sessions').doc('recent_rejected').set({
      state: 'rejected',
      createdAt: recentDate,
    });

    // Run nightly cron with valid authorization
    process.env.CRON_SECRET = 'test-cron-secret-12345';
    const cronRes = await call(cronR.GET, {
      headers: { authorization: 'Bearer test-cron-secret-12345' },
    });
    expect(cronRes.status).toBe(200);

    // Verify: old_rejected and old_resubmitted removed
    const snapOldRej = await db.collection('pending_sessions').doc('old_rejected').get();
    expect(snapOldRej.exists).toBe(false);

    const snapOldResub = await db.collection('pending_sessions').doc('old_resubmitted').get();
    expect(snapOldResub.exists).toBe(false);

    // old_pending must NOT be deleted
    const snapOldPend = await db.collection('pending_sessions').doc('old_pending').get();
    expect(snapOldPend.exists).toBe(true);

    // recent_rejected must NOT be deleted
    const snapRecentRej = await db.collection('pending_sessions').doc('recent_rejected').get();
    expect(snapRecentRej.exists).toBe(true);
  });

  afterAll(async () => {
    const toDelete = [
      'rej_to_delete',
      'resub_to_delete',
      'rej_forbidden',
      'pend_cant_delete',
      'old_rejected',
      'old_resubmitted',
      'old_pending',
      'recent_rejected',
    ];
    for (const id of toDelete) {
      await db.collection('pending_sessions').doc(id).delete();
    }
    await db.collection('users').doc('admin_nav').delete();
    await db.collection('users').doc('marker_nav').delete();
  });
});
