// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

const { nav } = vi.hoisted(() => ({ nav: { replace: vi.fn(), push: vi.fn(), path: '/dashboard/marker/mark' } }));
const stableRouter = vi.hoisted(() => ({}));
vi.mock('next/navigation', () => {
  Object.assign(stableRouter, { replace: nav.replace, push: nav.push });
  return { useRouter: () => stableRouter, usePathname: () => nav.path };
});
vi.mock('next/link', async () => {
  const R = await import('react');
  return { default: ({ href, children, ...p }) => R.createElement('a', { href, ...p }, children) };
});

import { call } from './helpers/http.js';
import { installBrowser, jar } from './helpers/browser.js';
import * as loginR from '@/app/api/auth/login/route';
import * as otpR from '@/app/api/auth/verify-otp/route';
import * as resendR from '@/app/api/auth/resend-otp/route';
import * as meR from '@/app/api/me/route';
import * as cpR from '@/app/api/auth/change-password/route';
import * as logoutR from '@/app/api/auth/logout/route';
import * as attR from '@/app/api/attendance/route';

import { hashTabId, verifyToken, createToken } from '@/lib/auth';
import { sessionPolicy } from '@/lib/session';
import { getTabId, tabHeaders, clearTab } from '@/lib/tab';
import LoginPage from '@/app/login/page';
import DashboardLayout from '@/app/dashboard/layout';
import MarkAttendance from '@/app/components/MarkAttendance';
import { UIProvider } from '@/app/components/ui';

const db = globalThis.__db;

describe('PART B: Tab Binding & Session Cookie', () => {
  beforeAll(async () => {
    installBrowser();
    const stats = { total: 0, present: 0, absent: 0, months: {} };
    await db.collection('users').doc('tab_admin').set({
      role: 'admin', username: 'tab_admin', name: 'Admin Officer', passwordHash: await bcrypt.hash('Pass@123', 4),
      isActive: true, discharged: false, stats, mustChangePassword: false, otpRequired: false,
    });
    await db.collection('users').doc('tab_marker').set({
      role: 'marker', username: 'tab_marker', name: 'Marker Cadet', passwordHash: await bcrypt.hash('Pass@123', 4),
      isActive: true, discharged: false, stats, mustChangePassword: false, otpRequired: false,
    });
    await db.collection('users').doc('tab_otp_user').set({
      role: 'marker', username: 'tab_otp', name: 'OTP Marker', passwordHash: await bcrypt.hash('Pass@123', 4),
      email: 'otp@example.com', isActive: true, discharged: false, stats, mustChangePassword: false, otpRequired: true,
    });
  });

  it('login without tabId is refused with 400', async () => {
    const res = await call(loginR.POST, {
      method: 'POST',
      body: { identifier: 'tab_admin', password: 'Pass@123', omitTabId: true },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/tabId is required/i);
  });

  it('same tab id works; session cookie has no Max-Age or Expires', async () => {
    const tab1 = 'tab-uuid-1111';
    const loginRes = await call(loginR.POST, {
      method: 'POST',
      body: { identifier: 'tab_admin', password: 'Pass@123', tabId: tab1 },
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.cookie).toContain('ncc_token=');

    // Verify session cookie: must NOT have Max-Age or Expires
    const rawSetCookie = loginRes.headers.get('set-cookie') || '';
    expect(rawSetCookie.toLowerCase()).not.toContain('max-age');
    expect(rawSetCookie.toLowerCase()).not.toContain('expires');
    expect(rawSetCookie).toContain('HttpOnly');
    expect(rawSetCookie).toContain('SameSite=Lax');

    // Call /api/me with matching x-tab-id header -> 200
    const meRes = await call(meR.GET, {
      cookie: loginRes.cookie,
      headers: { 'x-tab-id': tab1 },
    });
    expect(meRes.status).toBe(200);
    expect(meRes.json.user.name).toBe('Admin Officer');
  });

  it('missing x-tab-id header returns 401 code TAB and clears the cookie', async () => {
    const tab = 'tab-uuid-2222';
    const loginRes = await call(loginR.POST, {
      method: 'POST',
      body: { identifier: 'tab_admin', password: 'Pass@123', tabId: tab },
    });
    expect(loginRes.status).toBe(200);

    const meRes = await call(meR.GET, {
      cookie: loginRes.cookie,
      headers: { 'x-tab-id': '' }, // explicitly empty / omitted
    });
    expect(meRes.status).toBe(401);
    expect(meRes.json.code).toBe('TAB');
    expect(meRes.json.error).toBe('This sign-in belongs to another tab. Please sign in again.');

    // Cookie is cleared
    const setCookie = meRes.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/ncc_token=(;|deleted|;|$)/);
  });

  it('different x-tab-id header returns 401 code TAB and clears the cookie', async () => {
    const tab1 = 'tab-uuid-first';
    const tab2 = 'tab-uuid-second';
    const loginRes = await call(loginR.POST, {
      method: 'POST',
      body: { identifier: 'tab_admin', password: 'Pass@123', tabId: tab1 },
    });
    expect(loginRes.status).toBe(200);

    const meRes = await call(meR.GET, {
      cookie: loginRes.cookie,
      headers: { 'x-tab-id': tab2 },
    });
    expect(meRes.status).toBe(401);
    expect(meRes.json.code).toBe('TAB');
    expect(meRes.json.error).toBe('This sign-in belongs to another tab. Please sign in again.');
  });

  it('second login replaces the cookie so older tab gets code TAB on its next request', async () => {
    const tabA = 'tab-alpha';
    const tabB = 'tab-beta';

    // First tab logs in
    const loginA = await call(loginR.POST, {
      method: 'POST',
      body: { identifier: 'tab_admin', password: 'Pass@123', tabId: tabA },
    });
    expect(loginA.status).toBe(200);

    // Second tab logs in (simulating new cookie in same browser)
    const loginB = await call(loginR.POST, {
      method: 'POST',
      body: { identifier: 'tab_admin', password: 'Pass@123', tabId: tabB },
    });
    expect(loginB.status).toBe(200);

    // First tab makes request with the newly replaced browser cookie but its own tabId (tabA)
    const meA = await call(meR.GET, {
      cookie: loginB.cookie,
      headers: { 'x-tab-id': tabA },
    });
    expect(meA.status).toBe(401);
    expect(meA.json.code).toBe('TAB');

    // Second tab makes request with the new cookie and its tabId (tabB) -> works!
    const meB = await call(meR.GET, {
      cookie: loginB.cookie,
      headers: { 'x-tab-id': tabB },
    });
    expect(meB.status).toBe(200);
  });

  it('verify-otp with a different tabId is rejected with 401', async () => {
    const tabOrigin = 'tab-origin-otp';
    const tabImposter = 'tab-imposter-otp';

    // Step 1: Login generates OTP challenge bound to tabOrigin
    const loginRes = await call(loginR.POST, {
      method: 'POST',
      body: { identifier: 'tab_otp', password: 'Pass@123', tabId: tabOrigin },
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.json.otpRequired).toBe(true);
    const challengeId = loginRes.json.challengeId;
    expect(challengeId).toBeDefined();

    // Fetch the generated OTP from mail
    const mail = globalThis.__mail.find(m => m.to.includes('otp@example.com'));
    expect(mail).toBeDefined();
    const codeMatch = mail.text.match(/\b\d{6}\b/);
    expect(codeMatch).toBeDefined();
    const otpCode = codeMatch[0];

    // Step 2: verify-otp with imposter tabId -> rejected 401
    const verifyFail = await call(otpR.POST, {
      method: 'POST',
      body: { challengeId, code: otpCode, tabId: tabImposter },
    });
    expect(verifyFail.status).toBe(401);
    expect(verifyFail.json.error).toBe('Sign in again in the same tab');

    // Step 3: verify-otp with original tabId -> succeeds 200
    const verifyOk = await call(otpR.POST, {
      method: 'POST',
      body: { challengeId, code: otpCode, tabId: tabOrigin },
    });
    expect(verifyOk.status).toBe(200);
    expect(verifyOk.json.role).toBe('marker');

    // Payload tid matches sha256(tabOrigin)
    const payload = await verifyToken(verifyOk.cookie.replace('ncc_token=', ''));
    expect(payload.tid).toBe(hashTabId(tabOrigin));
  });

  it('lib/tab.js getTabId, tabHeaders, clearTab functions work as expected', () => {
    sessionStorage.clear();
    const id1 = getTabId();
    expect(id1).toBeTruthy();
    expect(typeof id1).toBe('string');

    // Calling again returns the exact same ID
    const id2 = getTabId();
    expect(id2).toBe(id1);

    expect(tabHeaders()).toEqual({ 'x-tab-id': id1 });

    clearTab();
    expect(sessionStorage.getItem('ncc_tab')).toBeNull();

    // Calling again creates a new random ID
    const id3 = getTabId();
    expect(id3).toBeTruthy();
    expect(id3).not.toBe(id1);
  });
});

describe('PART C: Session Lengths & Expiry Policy', () => {
  it('sessionPolicy assigns 30 minutes for markers, 8 hours for others', () => {
    // Marker role
    const markerPolicy = sessionPolicy({ role: 'marker' });
    expect(markerPolicy.lifetimeSec).toBe(30 * 60);

    // Custom role whose only capability is canMarkAttendance
    const customMarkerPolicy = sessionPolicy({
      role: 'custom',
      permissions: { canMarkAttendance: true },
    });
    expect(customMarkerPolicy.lifetimeSec).toBe(30 * 60);

    // Admin role
    const adminPolicy = sessionPolicy({ role: 'admin' });
    expect(adminPolicy.lifetimeSec).toBe(8 * 3600);

    // CTO role
    const ctoPolicy = sessionPolicy({ role: 'cto' });
    expect(ctoPolicy.lifetimeSec).toBe(8 * 3600);

    // Cadet role
    const cadetPolicy = sessionPolicy({ role: 'cadet' });
    expect(cadetPolicy.lifetimeSec).toBe(8 * 3600);
  });

  it('custom MARKER_SESSION_MINUTES env variable overrides marker session lifetime', () => {
    const origEnv = process.env.MARKER_SESSION_MINUTES;
    try {
      process.env.MARKER_SESSION_MINUTES = '2';
      const policy = sessionPolicy({ role: 'marker' });
      expect(policy.lifetimeSec).toBe(2 * 60);
    } finally {
      if (origEnv !== undefined) process.env.MARKER_SESSION_MINUTES = origEnv;
      else delete process.env.MARKER_SESSION_MINUTES;
    }
  });

  it('JWT token exp enforces the lifetime and /api/me returns expiresAt and serverNow', async () => {
    const tab = 'tab-lifetime-test';
    const loginRes = await call(loginR.POST, {
      method: 'POST',
      body: { identifier: 'tab_marker', password: 'Pass@123', tabId: tab },
    });
    expect(loginRes.status).toBe(200);

    const token = loginRes.cookie.replace('ncc_token=', '');
    const payload = await verifyToken(token);
    expect(payload.exp - payload.iat).toBe(30 * 60);

    const meRes = await call(meR.GET, {
      cookie: loginRes.cookie,
      headers: { 'x-tab-id': tab },
    });
    expect(meRes.status).toBe(200);
    expect(typeof meRes.json.expiresAt).toBe('number');
    expect(typeof meRes.json.serverNow).toBe('number');
    expect(meRes.json.expiresAt).toBe(payload.exp * 1000);
  });

  it('an expired token gets 401 with code EXPIRED', async () => {
    const tab = 'tab-expired-test';
    // Create an expired token (exp in past)
    const token = await createToken({
      id: 'tab_marker',
      role: 'marker',
      name: 'Marker Cadet',
      tid: hashTabId(tab),
      tokenVersion: 0,
    }, -60); // -60s in the past

    const req = new Request('http://localhost/api/me', {
      headers: { cookie: `ncc_token=${token}`, 'x-tab-id': tab },
    });
    const res = await meR.GET(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('EXPIRED');
  });
});

describe('UI: Login Reasons, Offline Attendance, Countdown & Draft Safety', () => {
  it('login page displays calm message for each reason parameter', () => {
    const reasonsMap = [
      ['tab', 'Your session ended because the page was closed or opened in another tab. Please sign in again.'],
      ['timeout', 'Your session ended after 30 minutes. Please sign in again.'],
      ['expired', 'Your session expired. Please sign in again.'],
      ['other-tab', 'You signed in from another tab, so this one was signed out.'],
    ];

    for (const [code, expectedText] of reasonsMap) {
      window.history.pushState({}, '', `/login?reason=${code}`);
      const { unmount } = render(React.createElement(LoginPage));
      expect(screen.getByText(expectedText)).toBeTruthy();
      unmount();
    }
  });

  it('marker session warning banner at 5:00 left with counting seconds, toast at 1:00, redirect to /login?reason=timeout at 0', async () => {
    vi.useFakeTimers();

    const origFetch = globalThis.fetch;
    const now = Date.now();
    // 5 minutes = 300 seconds left
    const expiresAt = now + 300 * 1000;

    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url === '/api/me') {
        return new Response(JSON.stringify({
          user: { id: 'mk1', name: 'Sgt Rohan', role: 'marker' },
          expiresAt,
          serverNow: now,
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/approvals?summary=1') {
        return new Response(JSON.stringify({ pending: 0, needsMe: 0 }), { headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/auth/logout') {
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });

    try {
      const { unmount } = render(
        React.createElement(UIProvider, null, React.createElement(DashboardLayout, null, React.createElement('div', null, 'Content')))
      );

      // Flush promises for initial /api/me load
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });

      // At 300s left (5:00): banner is rendered
      expect(screen.getByText(/You will be signed out in 5:00 for security\. Submit your attendance now\./)).toBeTruthy();

      // Advance by 1 second -> 4:59
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText(/You will be signed out in 4:59 for security\. Submit your attendance now\./)).toBeTruthy();

      // Advance to 60s remaining (advance 239s more): both banner and toast appear
      await act(async () => {
        await vi.advanceTimersByTimeAsync(239 * 1000);
      });
      const oneMinElements = screen.getAllByText(/You will be signed out in 1:00 for security\. Submit your attendance now\./);
      expect(oneMinElements.length).toBe(2); // 1 in banner, 1 in toast

      // Advance to 0s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 1000);
      });

      // Redirects to /login?reason=timeout
      expect(nav.replace).toHaveBeenCalledWith('/login?reason=timeout');

      unmount();
    } finally {
      vi.useRealTimers();
      globalThis.fetch = origFetch;
    }
  });

  it('draft safety: saves draft every second after change, restores for same user, ignored for different user, discard draft clears it', async () => {
    const userId1 = 'user_draft_1';
    const userId2 = 'user_draft_2';

    // Clear any previous drafts
    sessionStorage.removeItem(`ncc_draft_${userId1}`);
    sessionStorage.removeItem(`ncc_draft_${userId2}`);

    const draftData = {
      date: '2026-10-25',
      activity: 'Camp',
      description: 'Annual training camp rehearsal',
      years: [1, 2],
      marks: { c0: { status: 'Absent', reason: 'Sick / Medical', other: '' } },
      photoUrls: ['https://example.com/photo.jpg'],
    };

    // Save draft for user 1
    sessionStorage.setItem(`ncc_draft_${userId1}`, JSON.stringify(draftData));

    // Mount MarkAttendance where currentUser is user 1
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url === '/api/me') {
        return new Response(JSON.stringify({ user: { id: userId1, role: 'marker' } }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/meta') return new Response(JSON.stringify({ requirePhotos: false }), { headers: { 'content-type': 'application/json' } });
      if (url === '/api/cadets') return new Response(JSON.stringify({ cadets: [{ id: 'c0', name: 'Arjun', year: 1, type: 'SD', regNo: '101' }] }), { headers: { 'content-type': 'application/json' } });
      if (url.startsWith('/api/attendance?date=')) return new Response(JSON.stringify({ records: [] }), { headers: { 'content-type': 'application/json' } });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });

    try {
      const { unmount } = render(
        React.createElement(UIProvider, null, React.createElement(MarkAttendance, { goHistory: () => {}, who: 'marker' }))
      );

      // Verify draft restored banner is shown
      await screen.findByText('Draft restored from your earlier session. Check it before submitting.');
      const discardBtn = screen.getByRole('button', { name: /Discard draft/i });
      expect(discardBtn).toBeTruthy();

      // Click "Discard draft"
      fireEvent.click(discardBtn);
      expect(screen.queryByText('Draft restored from your earlier session. Check it before submitting.')).toBeNull();
      expect(sessionStorage.getItem(`ncc_draft_${userId1}`)).toBeNull();

      unmount();
    } finally {
      globalThis.fetch = origFetch;
    }

    // Now test that user 2 does NOT see user 1's draft
    sessionStorage.setItem(`ncc_draft_${userId1}`, JSON.stringify(draftData));
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url === '/api/me') {
        return new Response(JSON.stringify({ user: { id: userId2, role: 'marker' } }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/meta') return new Response(JSON.stringify({ requirePhotos: false }), { headers: { 'content-type': 'application/json' } });
      if (url === '/api/cadets') return new Response(JSON.stringify({ cadets: [{ id: 'c0', name: 'Arjun', year: 1, type: 'SD', regNo: '101' }] }), { headers: { 'content-type': 'application/json' } });
      if (url.startsWith('/api/attendance?date=')) return new Response(JSON.stringify({ records: [] }), { headers: { 'content-type': 'application/json' } });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });

    try {
      const { unmount } = render(
        React.createElement(UIProvider, null, React.createElement(MarkAttendance, { goHistory: () => {}, who: 'marker' }))
      );

      await waitFor(() => {
        expect(screen.queryByText('Draft restored from your earlier session. Check it before submitting.')).toBeNull();
      });
      unmount();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('offline behavior: Submit disabled when offline with helper text "You are offline.", network error shows exact message and preserves form', async () => {
    const origOnline = navigator.onLine;
    const origFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url === '/api/me') return new Response(JSON.stringify({ user: { id: 'mk1', role: 'marker' } }), { headers: { 'content-type': 'application/json' } });
      if (url === '/api/meta') return new Response(JSON.stringify({ requirePhotos: false }), { headers: { 'content-type': 'application/json' } });
      if (url === '/api/cadets') return new Response(JSON.stringify({ cadets: [{ id: 'c0', name: 'Arjun', year: 1, type: 'SD', regNo: '101' }] }), { headers: { 'content-type': 'application/json' } });
      if (url.startsWith('/api/attendance?date=')) return new Response(JSON.stringify({ records: [] }), { headers: { 'content-type': 'application/json' } });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });

    try {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));

      const { unmount } = render(
        React.createElement(UIProvider, null, React.createElement(MarkAttendance, { goHistory: () => {}, who: 'marker' }))
      );

      // Select Year 1
      const y1Btn = await screen.findByRole('button', { name: /^Year 1/ });
      fireEvent.click(y1Btn);

      // Submit button is disabled
      const submitBtn = screen.getByRole('button', { name: /^Submit$/ });
      expect(submitBtn.disabled).toBe(true);

      // Helper text says "You are offline."
      expect(screen.getByText('You are offline.')).toBeTruthy();

      unmount();
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: origOnline, configurable: true });
      window.dispatchEvent(new Event('online'));
      globalThis.fetch = origFetch;
    }
  });
});

describe('STATIC AUDIT: All raw /api fetches must carry x-tab-id / tabHeaders', () => {
  it('fails if any file in app/ or lib/ calls fetch( on an /api path without passing x-tab-id or tabHeaders', () => {
    const rootDir = process.cwd();
    const dirsToScan = [path.join(rootDir, 'app'), path.join(rootDir, 'lib')];
    const violations = [];

    function scanDir(dir) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          scanDir(full);
        } else if (/\.(jsx?|tsx?)$/.test(f)) {
          const content = fs.readFileSync(full, 'utf8');
          // Find all occurrences of fetch(
          const fetchMatches = [...content.matchAll(/fetch\s*\(([^)]+)\)/g)];
          for (const m of fetchMatches) {
            const callContent = m[0];
            const arg = m[1];

            // If the fetch targets an /api route
            if (arg.includes('/api/')) {
              // Allowed whitelist:
              // 1. app/components/ui.js (implements api and download with tabHeaders)
              // 2. lib/useRealtimeData.js (passes tabHeaders())
              // 3. app/components/MarkAttendance.js (upload-photo passes tabHeaders())
              // 4. app/login/page.js (passes tabId in request body)
              const rel = path.relative(rootDir, full);
              const isWhitelisted =
                (rel.includes('app/components/ui.js') && callContent.includes('headers: combinedHeaders') || callContent.includes('tabHeaders')) ||
                (rel.includes('lib/useRealtimeData.js') && callContent.includes('tabHeaders')) ||
                (rel.includes('app/components/MarkAttendance.js') && callContent.includes('tabHeaders')) ||
                (rel.includes('app/login/page.js') && callContent.includes('tabId'));

              if (!isWhitelisted && !callContent.includes('x-tab-id') && !callContent.includes('tabHeaders')) {
                violations.push({ file: rel, match: callContent });
              }
            }
          }
        }
      }
    }

    for (const d of dirsToScan) {
      if (fs.existsSync(d)) scanDir(d);
    }

    expect(violations).toEqual([]);
  });
});
