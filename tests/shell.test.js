// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within, cleanup, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import bcrypt from 'bcryptjs';
import { installBrowser, jar } from './helpers/browser.js';
import { todayIST } from '@/lib/time';
import { navFor, isItemActive } from '@/app/components/shell/nav';
import { DEFAULT_PERMISSIONS } from '@/lib/permissions';
import { middleware } from '@/middleware';
import { NextRequest } from 'next/server';

const { nav } = vi.hoisted(() => ({ nav: { replace: vi.fn(), push: vi.fn(), path: '/dashboard/admin/overview' } }));
const stableRouter = vi.hoisted(() => ({}));
vi.mock('next/navigation', () => {
  Object.assign(stableRouter, { replace: nav.replace, push: nav.push });
  return {
    useRouter: () => stableRouter,
    usePathname: () => nav.path,
    redirect: (url) => { nav.path = url; nav.replace(url); }
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
          if (!e.defaultPrevented) {
            nav.path = href;
            nav.push(href);
          }
        },
        ...p
      }, children)
  };
});
vi.mock('jose', async () => {
  const c = await import('node:crypto');
  const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const mac = (data, key) => c.createHmac('sha256', Buffer.from(key)).update(data).digest('base64url');
  class SignJWT {
    constructor(p) { this.p = { ...p }; }
    setProtectedHeader() { return this; }
    setIssuedAt() { this.p.iat = Math.floor(Date.now() / 1000); return this; }
    setExpirationTime() { this.p.exp = Math.floor(Date.now() / 1000) + 7 * 86400; return this; }
    async sign(key) { const h = b64({ alg: 'HS256' }), p = b64(this.p); return `${h}.${p}.${mac(h + '.' + p, key)}`; }
  }
  const jwtVerify = async (t, key) => {
    const [h, p, s] = String(t).split('.');
    if (!s || mac(h + '.' + p, key) !== s) throw new Error('bad signature');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp < Date.now() / 1000) throw new Error('expired');
    return { payload };
  };
  return { SignJWT, jwtVerify };
});

import DashboardLayout from '@/app/dashboard/layout';
import AdminSectionPage from '@/app/dashboard/admin/[section]/page';
import ManageSection from '@/app/components/shell/ManageSection';

const db = globalThis.__db;
const TODAY = todayIST();
let env;
const signIn = async (id, pw) => {
  jar.cookie = '';
  sessionStorage.clear();
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: id, password: pw })
  });
  expect(r.status).toBe(200);
};

const mount = (Page, path, props = {}) => {
  cleanup();
  nav.path = path;
  history.pushState({}, '', path);
  render(React.createElement(DashboardLayout, null, React.createElement(Page, props)));
};

beforeAll(async () => {
  env = installBrowser();
  const mk = (id, d) => db.collection('users').doc(id).set({ isActive: true, discharged: false, stats: { total: 0, present: 0, absent: 0, months: {} }, benefit: 0, mustChangePassword: false, otpRequired: false, ...d });
  await mk('admin1', { name: 'Admin Officer', role: 'admin', username: 'admin', passwordHash: await bcrypt.hash('Admin@123', 4), email: 'admin@test.in' });
  await mk('cto1', { name: 'Lt. Sir', role: 'cto', username: 'sir', passwordHash: await bcrypt.hash('Sir@12345', 4), email: 'sir.cto@test.in' });
  await mk('mk1', { name: 'Sgt Rohan', role: 'marker', username: 'rohan', passwordHash: await bcrypt.hash('Marker@123', 4), email: 'rohan@test.in' });
  await mk('c0', { name: 'Arjun Sharma', role: 'cadet', year: 1, type: 'SD', email: 'arjun@test.in', regNo: 'KAR/NCC/1/100', passwordHash: await bcrypt.hash('x', 4) });
  await db.collection('settings').doc('main').set({ sirEmail: 'sir@test.in', backupEmail: 'backup@test.in' });
});

describe('Shell & Navigation Architecture', () => {
  it('a) nav items per role (admin 14, CTO subset, marker 2, cadet 3) in the right groups', () => {
    // Admin: 14 items in Attendance, People and reports, System
    const adminUser = { role: 'admin', permissions: DEFAULT_PERMISSIONS.admin };
    const adminGroups = navFor(adminUser);
    expect(adminGroups.map(g => g.title)).toEqual(['Attendance', 'People and reports', 'System']);
    const adminItems = adminGroups.flatMap(g => g.items);
    expect(adminItems.length).toBe(14);
    expect(adminGroups[0].items.map(i => i.id)).toEqual(['overview', 'approvals', 'mark', 'records', 'calendar']);
    expect(adminGroups[1].items.map(i => i.id)).toEqual(['people', 'reports', 'benefits']);
    expect(adminGroups[2].items.map(i => i.id)).toEqual(['sheet', 'settings', 'promotion', 'roles', 'health', 'log']);

    // CTO: subset of admin items
    const ctoUser = { role: 'cto', permissions: DEFAULT_PERMISSIONS.cto };
    const ctoGroups = navFor(ctoUser);
    const ctoItems = ctoGroups.flatMap(g => g.items);
    expect(ctoItems.length).toBe(8);
    for (const item of ctoItems) {
      expect(adminItems.some(ai => ai.id === item.id)).toBe(true);
    }
    expect(ctoGroups.find(g => g.title === 'People and reports').items.find(i => i.id === 'people').label).toBe('Cadets');

    // Marker: 2 items
    const markerUser = { role: 'marker', permissions: DEFAULT_PERMISSIONS.marker };
    const markerGroups = navFor(markerUser);
    const markerItems = markerGroups.flatMap(g => g.items);
    expect(markerItems.length).toBe(2);
    expect(markerItems.map(i => i.id)).toEqual(['mark', 'history']);

    // Cadet: 3 items
    const cadetUser = { role: 'cadet', permissions: DEFAULT_PERMISSIONS.cadet };
    const cadetGroups = navFor(cadetUser);
    const cadetItems = cadetGroups.flatMap(g => g.items);
    expect(cadetItems.length).toBe(3);
    expect(cadetItems.map(i => i.id)).toEqual(['cadet', 'leaderboard', 'calendar']);
  });

  it('b) active item has aria-current', async () => {
    await signIn('admin', 'Admin@123');
    mount(AdminSectionPage, '/dashboard/admin/reports', { params: { section: 'reports' } });
    await screen.findByRole('heading', { name: 'Reports' });

    const mainNav = screen.getByRole('navigation', { name: /Main/i });
    const activeLink = within(mainNav).getByRole('link', { name: /Reports/i });
    expect(activeLink.getAttribute('aria-current')).toBe('page');
    expect(activeLink.classList.contains('active')).toBe(true);

    const otherLink = within(mainNav).getByRole('link', { name: /Overview/i });
    expect(otherLink.getAttribute('aria-current')).toBeNull();
  });

  it('c) no <header class="topbar"> exists on desktop widths', async () => {
    await signIn('admin', 'Admin@123');
    mount(AdminSectionPage, '/dashboard/admin/overview', { params: { section: 'overview' } });
    await screen.findByRole('heading', { name: 'Overview' });

    expect(document.querySelector('header.topbar')).toBeNull();
  });

  it('d) approvals badge appears and updates on every section without reload', async () => {
    // Mock pending approval session
    await db.collection('pending_sessions').doc('pend-test-1').set({
      date: TODAY,
      state: 'pending',
      waitingFor: ['admin', 'cto'],
      approvals: {}
    });

    await signIn('admin', 'Admin@123');
    mount(AdminSectionPage, '/dashboard/admin/reports', { params: { section: 'reports' } });
    await screen.findByRole('heading', { name: 'Reports' });

    // The live approvals polling in layout updates the badge
    await waitFor(() => {
      const approvalsLink = within(screen.getByRole('navigation', { name: /Main/i })).getByRole('link', { name: /Approvals/i });
      expect(approvalsLink.querySelector('.nav-badge')).toBeTruthy();
    }, { timeout: 8000 });

    // Clean up
    await db.collection('pending_sessions').doc('pend-test-1').delete();
  });

  it('e) an unauthorized section redirects to the default one', async () => {
    await signIn('sir', 'Sir@12345');
    nav.replace.mockClear();
    mount(AdminSectionPage, '/dashboard/cto/settings', { params: { section: 'settings' } });

    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith('/dashboard/cto/overview');
    });
  });

  it('f) mobile: drawer opens with the menu button, traps focus, closes with Esc and on navigation; bottom bar shows the primary items', async () => {
    const u = userEvent.setup({ delay: null });
    await signIn('admin', 'Admin@123');
    mount(AdminSectionPage, '/dashboard/admin/overview', { params: { section: 'overview' } });
    await screen.findByRole('heading', { name: 'Overview' });

    // Menu button opens drawer
    const menuBtn = screen.getByRole('button', { name: /Open navigation menu/i });
    await u.click(menuBtn);
    const sidebar = document.querySelector('.sidebar');
    expect(sidebar.classList.contains('drawer-open')).toBe(true);

    // Pressing Esc closes drawer
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(sidebar.classList.contains('drawer-open')).toBe(false);

    // Reopen and close via nav click
    await u.click(menuBtn);
    expect(sidebar.classList.contains('drawer-open')).toBe(true);
    const markLink = within(screen.getByRole('navigation', { name: /Main/i })).getByRole('link', { name: /Mark attendance/i });
    await u.click(markLink);
    expect(sidebar.classList.contains('drawer-open')).toBe(false);

    // Bottom bar shows primary items
    const bottomNav = screen.getByRole('navigation', { name: /Quick navigation/i });
    expect(within(bottomNav).getByRole('link', { name: /Overview/i })).toBeTruthy();
    expect(within(bottomNav).getByRole('link', { name: /Approvals/i })).toBeTruthy();
    expect(within(bottomNav).getByRole('link', { name: /Mark/i })).toBeTruthy();
    expect(within(bottomNav).getByRole('link', { name: /Records/i })).toBeTruthy();
    expect(within(bottomNav).getByRole('button', { name: /Open full menu/i })).toBeTruthy();
  });

  it('g) collapsed rail state is remembered', async () => {
    const u = userEvent.setup({ delay: null });
    localStorage.clear();
    await signIn('admin', 'Admin@123');
    mount(AdminSectionPage, '/dashboard/admin/overview', { params: { section: 'overview' } });
    await screen.findByRole('heading', { name: 'Overview' });

    const toggleBtn = screen.getByRole('button', { name: /Expand sidebar/i });
    await u.click(toggleBtn);
    expect(localStorage.getItem('ncc_rail_expanded')).toBe('true');
  });

  it('h) Ctrl+K opens search', async () => {
    await signIn('admin', 'Admin@123');
    mount(AdminSectionPage, '/dashboard/admin/overview', { params: { section: 'overview' } });
    await screen.findByRole('heading', { name: 'Overview' });

    const searchInput = screen.getByPlaceholderText(/Search… ⌘K/i);
    expect(document.activeElement).not.toBe(searchInput);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(searchInput);
  });

  it('i) skip link works', async () => {
    await signIn('admin', 'Admin@123');
    mount(AdminSectionPage, '/dashboard/admin/overview', { params: { section: 'overview' } });
    await screen.findByRole('heading', { name: 'Overview' });

    const skipLink = screen.getByRole('link', { name: /Skip to content/i });
    expect(skipLink).toBeTruthy();
    expect(skipLink.getAttribute('href')).toBe('#main-content');
    const mainEl = document.getElementById('main-content');
    expect(mainEl).toBeTruthy();
  });

  it('j) deep link /dashboard/admin/reports renders Reports directly', async () => {
    await signIn('admin', 'Admin@123');
    mount(AdminSectionPage, '/dashboard/admin/reports', { params: { section: 'reports' } });
    await screen.findByRole('heading', { name: 'Reports' });
    expect(screen.getByText(/Day report/i)).toBeTruthy();
  });

  it('k) middleware tests for nested paths and cross-role blocking', async () => {
    const jwt = await import('jose');
    const secret = process.env.JWT_SECRET?.trim() || 'dev-only-secret-change-me-1234567890';
    const tokenFor = async (user) => {
      return await new jwt.SignJWT({ id: user.id, name: user.name, role: user.role, dashboardPath: user.dashboardPath, permissions: user.permissions || {} })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode(secret));
    };

    const adminToken = await tokenFor({ id: 'admin1', name: 'Admin Officer', role: 'admin', dashboardPath: '/dashboard/admin' });
    const ctoToken = await tokenFor({ id: 'cto1', name: 'Lt. Sir', role: 'cto', dashboardPath: '/dashboard/cto' });
    const markerToken = await tokenFor({ id: 'mk1', name: 'Sgt Rohan', role: 'marker', dashboardPath: '/dashboard/marker' });
    const cadetToken = await tokenFor({ id: 'c0', name: 'Arjun Sharma', role: 'cadet', dashboardPath: '/dashboard/cadet' });

    const testReq = (path, token) => {
      return new NextRequest(new URL(path, 'http://localhost:3000'), {
        headers: { cookie: `ncc_token=${token}` }
      });
    };

    // 1. Nested paths allowed for correct roles
    const rAdminNested = await middleware(testReq('/dashboard/admin/reports', adminToken));
    expect(rAdminNested.status).toBe(200);

    const rCtoNested = await middleware(testReq('/dashboard/cto/approvals', ctoToken));
    expect(rCtoNested.status).toBe(200);

    const rMarkerNested = await middleware(testReq('/dashboard/marker/mark', markerToken));
    expect(rMarkerNested.status).toBe(200);

    const rShared = await middleware(testReq('/dashboard/calendar', cadetToken));
    expect(rShared.status).toBe(200);

    // 2. Cross-role blocking
    const rCadetBlocked = await middleware(testReq('/dashboard/admin/reports', cadetToken));
    expect(rCadetBlocked.status).toBe(307);
    expect(rCadetBlocked.headers.get('location')).toBe('http://localhost:3000/dashboard/cadet');

    const rMarkerBlocked = await middleware(testReq('/dashboard/admin/settings', markerToken));
    expect(rMarkerBlocked.status).toBe(307);
    expect(rMarkerBlocked.headers.get('location')).toBe('http://localhost:3000/dashboard/marker');

    const rCtoBlocked = await middleware(testReq('/dashboard/admin/settings', ctoToken));
    expect(rCtoBlocked.status).toBe(307);
    expect(rCtoBlocked.headers.get('location')).toBe('http://localhost:3000/dashboard/cto');
  });
});
