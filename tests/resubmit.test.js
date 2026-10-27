// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import bcrypt from 'bcryptjs';
import { installBrowser, jar } from './helpers/browser.js';
import { flushBg } from './helpers/http.js';
import { todayIST } from '@/lib/time';
import { setupSheetTabs, writeRosterFull, writeSummaries, TABS } from '@/lib/sheets';
import { DEFAULT_PERMISSIONS } from '@/lib/permissions';

const { nav } = vi.hoisted(() => ({ nav: { replace: vi.fn(), push: vi.fn(), path: '/dashboard/admin/overview' } }));
const stableRouter = vi.hoisted(() => ({}));
vi.mock('next/navigation', () => {
  Object.assign(stableRouter, {
    replace: (url) => { nav.path = url; nav.replace(url); },
    push: (url) => { nav.path = url; nav.push(url); }
  });
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
  class SignJWT { constructor(p) { this.p = { ...p }; } setProtectedHeader() { return this; } setIssuedAt() { this.p.iat = Math.floor(Date.now() / 1000); return this; } setExpirationTime() { this.p.exp = Math.floor(Date.now() / 1000) + 7 * 86400; return this; }
    async sign(key) { const h = b64({ alg: 'HS256' }), p = b64(this.p); return `${h}.${p}.${mac(h + '.' + p, key)}`; } }
  const jwtVerify = async (t, key) => { const [h, p, s] = String(t).split('.'); if (!s || mac(h + '.' + p, key) !== s) throw new Error('bad signature'); const payload = JSON.parse(Buffer.from(p, 'base64url').toString()); if (payload.exp < Date.now() / 1000) throw new Error('expired'); return { payload }; };
  return { SignJWT, jwtVerify };
});

import DashboardLayout from '@/app/dashboard/layout';
import AdminSectionPage from '@/app/dashboard/admin/[section]/page';
import CtoSectionPage from '@/app/dashboard/cto/[section]/page';
import MarkerSectionPage from '@/app/dashboard/marker/[section]/page';
import MarkAttendance from '@/app/components/MarkAttendance';

const db = globalThis.__db;
const TODAY = todayIST();
const wait = (fn, o) => waitFor(fn, { timeout: 9000, ...o });
const stats = { total: 0, present: 0, absent: 0, months: {} };
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, ...json };
};
const signIn = async (id, pw) => {
  jar.cookie = ''; sessionStorage.clear();
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: id, password: pw }) });
  expect(r.status).toBe(200);
};

const mount = (Page, path, props = {}) => {
  cleanup(); nav.path = path; history.pushState({}, '', path);
  render(React.createElement(DashboardLayout, null, React.createElement(Page, props)));
};
const mountAdmin = (section = 'approvals') => mount(AdminSectionPage, `/dashboard/admin/${section}`, { params: { section } });
const mountCto = (section = 'approvals') => mount(CtoSectionPage, `/dashboard/cto/${section}`, { params: { section } });
const mountMarker = (section = 'history') => mount(MarkerSectionPage, `/dashboard/marker/${section}`, { params: { section } });

beforeAll(async () => {
  installBrowser();
  await setupSheetTabs();
  const mk = (id, d) => db.collection('users').doc(id).set({ isActive: true, discharged: false, stats, benefit: 0, mustChangePassword: false, otpRequired: false, ...d });
  await mk('admin_resubmit', { name: 'Admin Officer', role: 'admin', username: 'admin_resub', passwordHash: await bcrypt.hash('Admin@123', 4), email: 'admin.resub@test.in' });
  await mk('cto_resubmit', { name: 'Lt. Sir', role: 'cto', username: 'cto_resub', passwordHash: await bcrypt.hash('Sir@12345', 4), email: 'sir.resub@test.in' });
  await mk('mk_resubmit_1', { name: 'Sgt Rohan', role: 'marker', username: 'mk_resub1', passwordHash: await bcrypt.hash('Marker@123', 4), email: 'rohan.resub@test.in' });
  await mk('mk_resubmit_2', { name: 'Cpl Vikrant', role: 'marker', username: 'mk_resub2', passwordHash: await bcrypt.hash('Marker@123', 4), email: 'vikrant.resub@test.in' });
  await db.collection('settings').doc('main').set({ currentCycle: 1, cycleLabel: '2026-27', thresholdPct: 75, requirePhotos: true, reasons: ['Sick / Medical', 'Family function', 'Late arrival'] });

  for (const [i, [name, year, email]] of [
    ['Cadet Alpha', 1, 'alpha@test.in'],
    ['Cadet Beta', 1, 'beta@test.in'],
    ['Cadet Gamma', 1, 'gamma@test.in'],
    ['Cadet Delta', 2, 'delta@test.in'],
  ].entries()) {
    await mk('cadet_resub_' + i, { name, role: 'cadet', year, type: 'SD', email, regNo: `KAR/NCC/${year}/90${i}`, passwordHash: await bcrypt.hash('x', 4) });
  }
});

describe('Part 1, 2, 3, 4: Resubmit, Permissions, CTO Cadets, Sheets Change Log', () => {
  let rejectedId;
  let resubmittedId;
  const testDate = '2026-10-15'; // historical date so GPS is not mandatory

  it('1. Marker submits, CTO rejects -> Change Log has Rejected entry, cadets unlocked', async () => {
    await signIn('mk_resub1', 'Marker@123');
    const sub = await api('/api/attendance', 'POST', {
      date: testDate,
      activity_type: 'Parade',
      activity_description: 'Morning Drill',
      years: [1],
      photo_urls: ['https://res.cloudinary.com/x/image/upload/sample1.jpg'],
      records: [
        { cadet_id: 'cadet_resub_0', status: 'Present', reason: '' },
        { cadet_id: 'cadet_resub_1', status: 'Absent', reason: 'Fever' }, // custom/non-standard reason
      ]
    });
    expect(sub.ok).toBe(true);
    expect(sub.pending).toBe(true);
    rejectedId = sub.sessionId;

    // Reject as CTO
    await signIn('cto_resub', 'Sir@12345');
    const rej = await api('/api/approvals', 'POST', {
      id: rejectedId,
      action: 'reject',
      reason: 'Photo blurry and wrong date'
    });
    expect(rej.ok).toBe(true);

    await flushBg();

    // Verify rejection in DB
    const rejDoc = (await db.collection('pending_sessions').doc(rejectedId).get()).data();
    expect(rejDoc.state).toBe('rejected');
    expect(rejDoc.rejection).toMatchObject({
      byName: 'Lt. Sir',
      side: 'cto',
      reason: 'Photo blurry and wrong date'
    });

    // Check Change Log tab in fake sheet
    const changes = globalThis.__sheets.tab(TABS.changes)?.rows || [];
    const lastRow = changes[changes.length - 1];
    expect(lastRow[1]).toBe('Rejected');
    expect(lastRow[2]).toBe('Lt. Sir');
    expect(lastRow[3]).toBe(testDate);
    expect(lastRow[5]).toBe('Parade - Year 1');
    expect(lastRow[6]).toBe('Pending');
    expect(lastRow[7]).toBe('Rejected');
    expect(lastRow[8]).toBe('Photo blurry and wrong date');
  });

  it('2. Another marker cannot resubmit someone else\'s rejected submission', async () => {
    await signIn('mk_resub2', 'Marker@123');
    const res = await api('/api/attendance', 'POST', {
      resubmit_of: rejectedId,
      date: testDate,
      activity_type: 'Parade',
      activity_description: 'Morning Drill',
      years: [1],
      photo_urls: ['https://res.cloudinary.com/x/image/upload/sample1.jpg'],
      records: [
        { cadet_id: 'cadet_resub_0', status: 'Present', reason: '' },
        { cadet_id: 'cadet_resub_1', status: 'Present', reason: '' },
      ]
    });
    expect(res.status).toBe(403);
    expect(res.error).toBe('You can only resubmit attendance that was marked by you.');
  });

  it('3. Original marker resubmits -> old doc becomes resubmitted, vanishes from lists, new doc has previousRejection', async () => {
    await signIn('mk_resub1', 'Marker@123');
    // Verify old doc is visible in my submissions before resubmission
    const beforeMine = await api('/api/approvals?mine=1');
    expect(beforeMine.submissions.some(s => s.id === rejectedId && s.state === 'rejected')).toBe(true);

    const res = await api('/api/attendance', 'POST', {
      resubmit_of: rejectedId,
      date: testDate,
      activity_type: 'Parade',
      activity_description: 'Morning Drill Corrected',
      years: [1],
      photo_urls: ['https://res.cloudinary.com/x/image/upload/sample1.jpg', 'https://res.cloudinary.com/x/image/upload/sample2.jpg'],
      records: [
        { cadet_id: 'cadet_resub_0', status: 'Present', reason: '' },
        { cadet_id: 'cadet_resub_1', status: 'Absent', reason: 'Sick / Medical' },
      ]
    });
    expect(res.ok).toBe(true);
    expect(res.pending).toBe(true);
    resubmittedId = res.sessionId;

    await flushBg();

    // Verify old doc is updated to 'resubmitted'
    const oldDoc = (await db.collection('pending_sessions').doc(rejectedId).get()).data();
    expect(oldDoc.state).toBe('resubmitted');
    expect(oldDoc.resubmittedAs).toBe(resubmittedId);
    expect(oldDoc.waitingFor).toEqual([]);

    // Old doc vanishes from "My submissions"
    const afterMine = await api('/api/approvals?mine=1');
    expect(afterMine.submissions.some(s => s.id === rejectedId)).toBe(false);

    // Old doc vanishes from rejected list
    await signIn('admin_resub', 'Admin@123');
    const rejList = await api('/api/approvals?state=rejected');
    expect(rejList.submissions.some(s => s.id === rejectedId)).toBe(false);

    // New doc stores resubmitOf and previousRejection
    const newDoc = (await db.collection('pending_sessions').doc(resubmittedId).get()).data();
    expect(newDoc.resubmitOf).toBe(rejectedId);
    expect(newDoc.previousRejection).toMatchObject({
      byName: 'Lt. Sir',
      side: 'cto',
      reason: 'Photo blurry and wrong date'
    });

    // Check Change Log tab in fake sheet has Resubmitted row
    const changes = globalThis.__sheets.tab(TABS.changes)?.rows || [];
    const resubRow = changes.find(r => r[1] === 'Resubmitted' && r[3] === testDate);
    expect(resubRow).toBeTruthy();
    expect(resubRow[1]).toBe('Resubmitted');
    expect(resubRow[2]).toBe('Sgt Rohan');
    expect(resubRow[3]).toBe(testDate);
    expect(resubRow[5]).toBe('Parade - Year 1');
    expect(resubRow[6]).toBe('Rejected');
    expect(resubRow[7]).toBe('Pending');
  });

  it('4. Second resubmit of the old doc is refused (can only be resubmitted once)', async () => {
    await signIn('mk_resub1', 'Marker@123');
    const res = await api('/api/attendance', 'POST', {
      resubmit_of: rejectedId,
      date: testDate,
      activity_type: 'Parade',
      activity_description: 'Attempt 2',
      years: [1],
      records: [
        { cadet_id: 'cadet_resub_0', status: 'Present', reason: '' },
      ]
    });
    expect(res.status).toBe(400);
    expect(res.error).toBe('This submission has already been resubmitted.');
  });

  it('5. Part 2: Only Administrator may edit pending rolls; CTO gets 403; Change Log appends Edit (pending)', async () => {
    // CTO tries to edit pending roll
    await signIn('cto_resub', 'Sir@12345');
    const ctoEdit = await api('/api/approvals', 'PUT', {
      id: resubmittedId,
      changes: [{ cadet_id: 'cadet_resub_0', status: 'Absent', reason: 'Late arrival' }]
    });
    expect(ctoEdit.status).toBe(403);
    expect(ctoEdit.error).toBe('Only the Administrator can correct attendance. You can approve or reject.');

    // Admin edits pending roll
    await signIn('admin_resub', 'Admin@123');
    const adminEdit = await api('/api/approvals', 'PUT', {
      id: resubmittedId,
      note: 'Admin corrected cadet 0',
      changes: [{ cadet_id: 'cadet_resub_0', status: 'Absent', reason: 'Late arrival' }]
    });
    expect(adminEdit.ok).toBe(true);
    expect(adminEdit.changed).toBe(1);

    await flushBg();

    // Check Change Log tab in fake sheet has Edit (pending) row
    const changes = globalThis.__sheets.tab(TABS.changes)?.rows || [];
    const editRow = changes.find(r => r[1] === 'Edit (pending)' && r[3] === testDate);
    expect(editRow).toBeTruthy();
    expect(editRow[1]).toBe('Edit (pending)');
    expect(editRow[2]).toBe('Admin Officer');
    expect(editRow[3]).toBe(testDate);
    expect(editRow[4]).toBe('KAR/NCC/1/900');
    expect(editRow[5]).toBe('Cadet Alpha');
    expect(editRow[6]).toBe('Present');
    expect(editRow[7]).toBe('Absent');
    expect(editRow[8]).toBe('Late arrival');

    // CTO cannot edit saved attendance either (PUT /api/attendance)
    await signIn('cto_resub', 'Sir@12345');
    const ctoSavedEdit = await api('/api/attendance', 'PUT', {
      sessionId: 'any_session',
      changes: [{ cadet_id: 'cadet_resub_0', status: 'Present' }]
    });
    expect(ctoSavedEdit.status).toBe(403);
  });

  it('6. Part 3: CTO Cadets screen returns only role === cadet, sheet tabs never contain non-cadets', async () => {
    // CTO calling GET /api/cadets?all=1
    await signIn('cto_resub', 'Sir@12345');
    const ctoCadets = await api('/api/cadets?all=1');
    expect(ctoCadets.ok).toBe(true);
    expect(ctoCadets.cadets.length).toBeGreaterThan(0);
    // Every returned user must have role === 'cadet'
    for (const c of ctoCadets.cadets) {
      expect(c.role).toBe('cadet');
    }
    expect(ctoCadets.cadets.some(c => c.name === 'Admin Officer')).toBe(false);
    expect(ctoCadets.cadets.some(c => c.name === 'Lt. Sir')).toBe(false);
    expect(ctoCadets.cadets.some(c => c.name === 'Sgt Rohan')).toBe(false);

    // Admin calling GET /api/cadets?all=1 gets staff too
    await signIn('admin_resub', 'Admin@123');
    const adminCadets = await api('/api/cadets?all=1');
    expect(adminCadets.ok).toBe(true);
    expect(adminCadets.cadets.some(c => c.name === 'Admin Officer')).toBe(true);
    expect(adminCadets.cadets.some(c => c.name === 'Lt. Sir')).toBe(true);
    expect(adminCadets.cadets.some(c => c.name === 'Sgt Rohan')).toBe(true);

    // Test that sheet tabs never contain any non-cadet
    const allUsers = (await db.collection('users').get()).docs.map(d => ({ id: d.id, ...d.data() }));
    await writeRosterFull(allUsers);
    await writeSummaries(allUsers);

    const tabsToCheck = ['Year 1', 'Year 2', 'Year 3', TABS.summary, TABS.monthly, TABS.graduated, TABS.discharged];
    for (const tabName of tabsToCheck) {
      const tabRows = globalThis.__sheets.tab(tabName)?.rows || [];
      // Data rows start from row index 1 (skipping header)
      for (let r = 1; r < tabRows.length; r++) {
        const rowStr = JSON.stringify(tabRows[r]);
        expect(rowStr).not.toContain('Admin Officer');
        expect(rowStr).not.toContain('Lt. Sir');
        expect(rowStr).not.toContain('Sgt Rohan');
        expect(rowStr).not.toContain('Cpl Vikrant');
      }
    }
  });

  it('7. UI: ApprovalsPanel renders "Resubmitted" badge and modal "Earlier rejected by" text', async () => {
    const u = userEvent.setup({ delay: null });
    await signIn('admin_resub', 'Admin@123');
    mountAdmin('approvals');

    // List renders "Resubmitted" badge
    const badge = await screen.findByText('Resubmitted');
    expect(badge).toBeTruthy();

    // Click item to open review modal
    const itemCard = badge.closest('button');
    await u.click(itemCard);

    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/Earlier rejected by Lt\. Sir: 'Photo blurry and wrong date'/)).toBeTruthy();

    // Admin has editable roster and P/A buttons
    expect(within(dlg).getAllByRole('button', { name: 'P' }).length).toBeGreaterThan(0);
  });

  it('8. UI: ApprovalsPanel for CTO is READ-ONLY with the exact notification sentence', async () => {
    const u = userEvent.setup({ delay: null });
    await signIn('cto_resub', 'Sir@12345');
    mountCto('approvals');

    const badge = await screen.findByText('Resubmitted');
    expect(badge).toBeTruthy();

    const itemCard = badge.closest('button');
    await u.click(itemCard);

    const dlg = await screen.findByRole('dialog');
    // Banner sentence displayed once above roster
    expect(within(dlg).getByText('Only the Administrator can correct attendance. You can approve or reject.')).toBeTruthy();

    // No P or A buttons, no reason dropdowns, no "Save edits"
    expect(within(dlg).queryByRole('button', { name: 'P' })).toBeNull();
    expect(within(dlg).queryByRole('button', { name: 'A' })).toBeNull();
    expect(within(dlg).queryByRole('combobox')).toBeNull();
    expect(within(dlg).queryByRole('button', { name: /Save.*edit/i })).toBeNull();

    // Approve and Reject buttons stay for CTO
    expect(within(dlg).getByRole('button', { name: /Reject…/i })).toBeTruthy();
    expect(within(dlg).getByRole('button', { name: /^Approve$/i })).toBeTruthy();
  });

  it('9. UI: MarkAttendance pre-fills when ncc_resubmit key exists, shows banner, and Start Fresh clears it', async () => {
    const u = userEvent.setup({ delay: null });
    const date2 = '2026-10-14';
    await signIn('mk_resub1', 'Marker@123');
    const sub2 = await api('/api/attendance', 'POST', {
      date: date2,
      activity_type: 'Parade',
      activity_description: 'Morning Drill',
      years: [1],
      photo_urls: ['https://res.cloudinary.com/x/image/upload/sample1.jpg'],
      records: [
        { cadet_id: 'cadet_resub_0', status: 'Present', reason: '' },
        { cadet_id: 'cadet_resub_1', status: 'Absent', reason: 'Fever' },
      ]
    });
    expect(sub2.ok).toBe(true);
    await signIn('cto_resub', 'Sir@12345');
    await api('/api/approvals', 'POST', {
      id: sub2.sessionId,
      action: 'reject',
      reason: 'Photo blurry and wrong date'
    });

    // Marker signs in
    await signIn('mk_resub1', 'Marker@123');

    // Store sub2.sessionId in sessionStorage key ncc_resubmit
    sessionStorage.setItem('ncc_resubmit', sub2.sessionId);

    cleanup();
    const { UIProvider } = await import('@/app/components/ui');
    render(React.createElement(UIProvider, null, React.createElement(MarkAttendance, { who: 'marker', goHistory: () => {} })));

    // Key should be cleared after reading
    expect(sessionStorage.getItem('ncc_resubmit')).toBeNull();

    // Banner should be visible
    const banner = await screen.findByText(/Rejected by Lt\. Sir \(CTO\): 'Photo blurry and wrong date'\. Correct what is needed and submit again\./);
    expect(banner).toBeTruthy();

    // Activity description should be pre-filled
    const descInput = screen.getByLabelText(/Description/i);
    expect(descInput.value).toBe('Morning Drill');

    // Date should be pre-filled
    const dateInput = screen.getByLabelText(/Date/i);
    expect(dateInput.value).toBe(date2);

    // Photos should be pre-filled (reused as uploaded)
    await screen.findByAltText('Parade');

    // Statuses & reasons pre-filled: Cadet Alpha was Present, Cadet Beta was Absent with 'Fever' (non-standard -> Other with text)
    await screen.findByText('Cadet Alpha');
    await screen.findByText('Cadet Beta');

    const betaItem = screen.getByText('Cadet Beta').closest('.item');
    const reasonSelect = within(betaItem).getByRole('combobox');
    expect(reasonSelect.value).toBe('__other__');
    const otherInput = within(betaItem).getByPlaceholderText(/Type the reason/i);
    expect(otherInput.value).toBe('Fever');

    // Click "Start fresh"
    const startFreshBtn = screen.getByRole('button', { name: /Start fresh/i });
    await u.click(startFreshBtn);

    // Banner is removed
    expect(screen.queryByText(/Rejected by Lt\. Sir/)).toBeNull();
    // Description is cleared
    expect(descInput.value).toBe('');
    // Photos cleared
    expect(screen.queryByAltText('Parade')).toBeNull();
  });

  it('10. UI: History > My submissions shows "Correct and resubmit" for rejected items, setting key and navigating', async () => {
    const u = userEvent.setup({ delay: null });
    await signIn('mk_resub1', 'Marker@123');

    mountMarker('history');

    const btn = await screen.findByRole('button', { name: 'Correct and resubmit' });
    expect(btn).toBeTruthy();
    expect(btn.className).toContain('btn-primary');

    await u.click(btn);

    expect(nav.path).toBe('/dashboard/marker/mark');
    // MarkAttendance mounts and displays the rejection banner
    expect(await screen.findByText(/Rejected by Lt\. Sir \(CTO\): 'Photo blurry and wrong date'/)).toBeTruthy();
  });
});
