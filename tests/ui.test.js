// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import bcrypt from 'bcryptjs';
import { installBrowser, jar, calls } from './helpers/browser.js';
import { flushBg, call } from './helpers/http.js';
import * as loginR from '@/app/api/auth/login/route';
import * as apprR from '@/app/api/approvals/route';
import { todayIST } from '@/lib/time';

const { nav } = vi.hoisted(() => ({ nav: { replace: vi.fn(), push: vi.fn(), path: '/dashboard/marker' } }));
const stableRouter = vi.hoisted(() => ({}));
vi.mock('next/navigation', () => { Object.assign(stableRouter, { replace: nav.replace, push: nav.push }); return { useRouter: () => stableRouter, usePathname: () => nav.path }; });   // Next's real useRouter() is referentially stable
vi.mock('next/link', async () => { const R = await import('react'); return { default: ({ href, children, ...p }) => R.createElement('a', { href, ...p }, children) }; });

import LoginPage from '@/app/login/page';
import DashboardLayout from '@/app/dashboard/layout';
import MarkerSectionPage from '@/app/dashboard/marker/[section]/page';
import CadetPage from '@/app/dashboard/cadet/page';
import AdminPage from '@/app/dashboard/admin/page';
import CtoPage from '@/app/dashboard/cto/page';
import LeaderboardPage from '@/app/dashboard/leaderboard/page';
import CalendarPage from '@/app/dashboard/calendar/page';

const db = globalThis.__db;
const TODAY = todayIST();
let env;
const user = () => userEvent.setup({ delay: null });
const userByName = n => db.all('users').map(d => ({ id: d.id, ...d.data })).find(u => u.name === n);
const wait = (fn, o) => waitFor(fn, { timeout: 8000, ...o });
const state = {};
const stats = { total: 0, present: 0, absent: 0, months: {} };
const cookieOf = async (id, pw) => (await call(loginR.POST, { method: 'POST', body: { identifier: id, password: pw } })).cookie;
const approveBoth = async sessionId => {
  const a = await call(apprR.POST, { method: 'POST', cookie: await cookieOf('admin', 'Admin@123'), body: { id: sessionId, action: 'approve' } });
  const c = await call(apprR.POST, { method: 'POST', cookie: await cookieOf('sir', 'Sir@12345'), body: { id: sessionId, action: 'approve' } });
  expect([a.status, c.status]).toEqual([200, 200]); return c.json;
};
const mountMarker = (section = 'mark') => {
  cleanup();
  nav.path = '/dashboard/marker/' + section;
  history.pushState({}, '', nav.path);
  render(React.createElement(DashboardLayout, null, React.createElement(MarkerSectionPage, { params: { section } })));
};

beforeAll(async () => {
  env = installBrowser();
  const mk = (id, d) => db.collection('users').doc(id).set({ isActive: true, discharged: false, stats, benefit: 0, mustChangePassword: false, ...d });
  await mk('admin1', { name: 'Admin Officer', role: 'admin', username: 'admin', passwordHash: await bcrypt.hash('Admin@123', 4), email: 'admin@test.in', otpRequired: false });
  await mk('cto1', { name: 'Lt. Sir', role: 'cto', username: 'sir', passwordHash: await bcrypt.hash('Sir@12345', 4), email: 'sir.cto@test.in', otpRequired: false });
  await mk('mk1', { name: 'Sgt Rohan', role: 'marker', username: 'rohan', passwordHash: await bcrypt.hash('Marker@123', 4), email: 'rohan@test.in', otpRequired: true });
  await db.collection('settings').doc('main').set({ sirEmail: 'sir@test.in', backupEmail: 'backup@test.in' });
  const people = [['Arjun Sharma', 1, 'SD', 'arjun@test.in'], ['Priya Nair', 1, 'SD', 'priya@test.in'], ['Rahul Shetty', 1, 'SW', ''], ['Karthik Bhat', 2, 'SD', 'karthik@test.in'], ['Sneha Kamath', 2, 'SW', 'sneha@test.in'], ['Vivek Pai', 3, 'SD', 'vivek@test.in']];
  for (const [i, [name, year, type, email]] of people.entries())
    await mk('c' + i, { name, role: 'cadet', year, type, email, regNo: `KAR/NCC/${year}/${100 + i}`, passwordHash: await bcrypt.hash('x', 4), otpRequired: false });
});

describe('login screen', () => {
  it('username + password, then the emailed 6-digit code, then lands on the right dashboard', async () => {
    const u = user(); history.pushState({}, '', '/login');
    render(React.createElement(LoginPage));
    expect(screen.getByText('NCC AIRWING · FLIGHT-B')).toBeTruthy(); expect(screen.getByText('6 KAR AIR SQN NCC')).toBeTruthy();
    expect(screen.queryByText(/google/i)).toBeNull();                                         // no Google button
    await u.type(screen.getByLabelText(/Username/i), 'rohan');
    await u.type(screen.getByLabelText(/^Password/i), 'wrong');
    await u.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByText(/Invalid credentials/i);
    await u.clear(screen.getByLabelText(/^Password/i)); await u.type(screen.getByLabelText(/^Password/i), 'Marker@123');
    await u.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByText(/Check your email/i); expect(screen.getByText('ro***@test.in')).toBeTruthy();
    expect(jar.cookie).toBe('');                                                               // not signed in yet
    const mail = globalThis.__mail.filter(m => /sign-in code/.test(m.subject)).at(-1);
    const code = mail.subject.match(/^(\d{6})/)[1];
    await u.type(screen.getByLabelText(/6-digit code/i), '000000' === code ? '111111' : '000000');
    await screen.findByText(/Wrong code/i);
    await u.type(screen.getByLabelText(/6-digit code/i), code);                                // auto-submits at 6 digits
    await wait(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard/marker'));
    expect(jar.cookie).toMatch(/^ncc_token=/);
  });
});

describe('marker: mark attendance end to end (the real screen + the real API)', () => {
  it('years 1 & 2, absent with typed reason, camera/gallery photo, GPS, submit → saved, mails sent', async () => {
    globalThis.__mail.length = 0;
    const u = user();
    mountMarker('mark');
    await screen.findByRole('heading', { name: /Mark attendance/i });
    expect(env.speech.length).toBe(0);                                                         // voice greeting is admin-only
    await u.click(await screen.findByRole('button', { name: /^Year 1/ }));
    await u.click(screen.getByRole('button', { name: /^Year 2/ }));
    await screen.findByText('Arjun Sharma'); expect(screen.getByText('Karthik Bhat')).toBeTruthy(); expect(screen.queryByText('Vivek Pai')).toBeNull();   // year 3 not selected
    expect(screen.getByText('Year 1 & 2', { selector: 'span.badge' })).toBeTruthy();
    // absent → reason dropdown (default list + Other…)
    await u.click(within(screen.getByRole('group', { name: /Attendance for Priya Nair/i })).getByRole('button', { name: 'A' }));
    const sel = await screen.findByLabelText(/Reason for absence/i);
    expect([...sel.options].map(o => o.text)).toEqual(['Select reason…', 'Sick / Medical', 'Family function', 'Exam / Academic duty', 'Out of station', 'Late arrival', 'No information', 'Other…']);
    // submit is blocked until reason + photo + gps
    const submit = screen.getByRole('button', { name: /^Submit$/ });
    expect(submit.disabled).toBe(true); expect(screen.getByText(/Select a reason for Priya Nair/)).toBeTruthy();
    await u.selectOptions(sel, 'Other…');
    await u.type(await screen.findByPlaceholderText(/Type the reason/i), 'Hospital visit');
    await u.click(within(screen.getByRole('group', { name: /Attendance for Sneha Kamath/i })).getByRole('button', { name: 'A' }));
    await u.selectOptions(screen.getAllByLabelText(/Reason for absence/i)[1], 'Late arrival');
    await screen.findByText(/Location captured/i);
    expect(screen.getByText(/Add at least one parade photo/)).toBeTruthy();
    // gallery AND camera inputs both exist; the camera one is the only one with capture
    const inputs = [...document.querySelectorAll('input[type=file]')];
    expect(inputs.length).toBe(2); expect(inputs.filter(i => i.hasAttribute('capture')).length).toBe(1); expect(inputs.filter(i => i.multiple).length).toBe(1);
    expect(screen.getByRole('button', { name: /Choose from gallery/i })).toBeTruthy(); expect(screen.getByRole('button', { name: /Take photo/i })).toBeTruthy();
    await u.upload(inputs.find(i => i.multiple), new File([new Uint8Array(2000)], 'gallery.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/uploaded/i);
    await wait(() => expect(screen.getByRole('button', { name: /^Submit$/ }).disabled).toBe(false));
    expect(screen.getByText(/5 cadets/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: /^Submit$/ }));
    const dlg = await screen.findByRole('dialog'); expect(within(dlg).getByText(/locked/i)).toBeTruthy();
    await u.click(within(dlg).getByRole('button', { name: /Yes, submit/i }));
    await screen.findByText('Sent for approval');
    expect(screen.getByText(/waiting for approval from Admin and CTO/)).toBeTruthy();
    await flushBg();
    const pend = db.all('pending_sessions'); expect(pend.length).toBe(1);
    state.pendingId = pend[0].id; expect(pend[0].data.records.length).toBe(5);
    expect(pend[0].data.records.find(r => r.cadetName === 'Priya Nair')).toMatchObject({ status: 'Absent', reason: 'Hospital visit', cadetYear: 1 });
    expect(pend[0].data.records.find(r => r.cadetName === 'Sneha Kamath').reason).toBe('Late arrival');
    expect(db.all('attendance').length).toBe(0);                                              // nothing saved,
    expect(userByName('Priya Nair').stats.total).toBe(0);                                     // nothing counted,
    expect(globalThis.__mail.length).toBe(0);                                                  // nothing e-mailed until both approve
    expect(pend[0].data.photoUrls[0]).toMatch(/^https:\/\//);
  });

  it('the same group again is locked while it waits for approval; another group is free', async () => {
    const u = user();
    mountMarker('mark');
    await u.click(await screen.findByRole('button', { name: /^Year 1/ }));
    await screen.findByText(/already submitted for this date.*cannot be changed here/i);
    expect((await screen.findAllByText('Awaiting approval')).length).toBe(3);
    expect(screen.queryByRole('button', { name: /^Submit$/ })?.disabled ?? true).toBe(true);
    await u.click(screen.getByRole('button', { name: /^Year 1/ }));                              // unselect
    await u.click(screen.getByRole('button', { name: /^Year 3/ }));
    await screen.findByText('Vivek Pai'); expect(screen.queryByText(/cannot be changed here/)).toBeNull();
  });

  it('photo upload failure shows retry button; clicking retry re-uploads successfully', async () => {
    const u = user();
    mountMarker('mark');
    await screen.findByRole('heading', { name: /Mark attendance/i });
    await u.click(await screen.findByRole('button', { name: /^Year 3/ }));
    await screen.findByText('Vivek Pai');

    const mockCloudinary = await import('@/lib/cloudinary');
    const origUpload = mockCloudinary.uploadParadePhoto;
    let failOnce = true;
    mockCloudinary.uploadParadePhoto = vi.fn().mockImplementation(async () => {
      if (failOnce) {
        failOnce = false;
        const err = new Error('Cloudinary 403');
        err.http_code = 403;
        throw err;
      }
      return { url: 'https://res.cloudinary.com/demo/image/upload/v1/retry.jpg' };
    });

    try {
      const inputs = [...document.querySelectorAll('input[type=file]')];
      const galInput = inputs.find(i => i.multiple);
      await u.upload(galInput, new File([new Uint8Array(1000)], 'fail.jpg', { type: 'image/jpeg' }));
      await screen.findByText(/failed/i);
      const retryBtn = screen.getByRole('button', { name: /retry upload/i });
      expect(retryBtn).toBeTruthy();

      await u.click(retryBtn);
      await screen.findByText(/uploaded/i);
    } finally {
      mockCloudinary.uploadParadePhoto = origUpload;
    }
  });

  it('the marker follows the status; after BOTH approve it is saved, counted and mailed', async () => {
    const u = user(); globalThis.__mail.length = 0;
    mountMarker('mark');
    await screen.findByRole('heading', { name: /Mark attendance/i });
    const historyLink = within(screen.getByRole('navigation', { name: /Main/i })).getByRole('link', { name: /History/i });
    await u.click(historyLink);
    mountMarker('history');
    await screen.findByText('My submissions', {}, { timeout: 8000 }); expect(screen.getByText('1 waiting')).toBeTruthy();
    const row = screen.getByText(/Year 1 & 2/, { selector: '.name' }).closest('.item');
    expect(within(row).getByText(/Admin/).textContent).toMatch(/Awaiting/); expect(within(row).getByText(/CTO/).textContent).toMatch(/Awaiting/);
    // Admin approves first -> the marker's screen shows Approved Admin, Awaiting CTO within seconds
    await call(apprR.POST, { method: 'POST', cookie: await cookieOf('admin', 'Admin@123'), body: { id: state.pendingId, action: 'approve' } });
    await wait(() => { const r = screen.getByText(/Year 1 & 2/, { selector: '.name' }).closest('.item'); expect(within(r).getByText(/Admin/).textContent).toMatch(/Approved/); expect(within(r).getByText(/CTO/).textContent).toMatch(/Awaiting/); }, { timeout: 12000 });
    expect(db.all('attendance').length).toBe(0);
    await call(apprR.POST, { method: 'POST', cookie: await cookieOf('sir', 'Sir@12345'), body: { id: state.pendingId, action: 'approve' } });
    await flushBg();
    expect(db.all('attendance').filter(a => a.data.date === TODAY).length).toBe(5);
    expect(db.all('attendance').find(a => a.data.cadetName === 'Priya Nair').data).toMatchObject({ status: 'Absent', reason: 'Hospital visit', cadetYear: 1 });
    expect(userByName('Priya Nair').stats).toMatchObject({ total: 1, absent: 1 });
    const parade = globalThis.__mail.find(m => /Parade Report/.test(m.subject));
    expect(parade.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-'); expect(parade.html).toContain('Approval record'); expect(parade.html).toContain('Admin Officer'); expect(parade.html).toContain('Lt. Sir');
    expect(globalThis.__mail.filter(m => /Absence notice/.test(m.subject)).map(m => m.to).sort()).toEqual(['priya@test.in', 'sneha@test.in']);
    await wait(() => expect(screen.queryByText('My submissions')).toBeNull(), { timeout: 14000 });          // moved to "approved & saved"
    expect(await screen.findByText(/approved/i, { selector: '.badge' }, { timeout: 14000 })).toBeTruthy();
  });

  it('all quick-pick combinations select the right years', async () => {
    const u = user();
    mountMarker('mark');
    await screen.findByRole('heading', { name: /Mark attendance/i });
    for (const [label, expected] of [['All years', 'All Years'], ['1 & 2', 'Year 1 & 2'], ['2 & 3', 'Year 2 & 3'], ['1 & 3', 'Year 1 & 3']]) {
      await u.click(screen.getByRole('button', { name: label }));
      expect(screen.getByText(expected, { selector: 'span.badge' })).toBeTruthy();
    }
    await u.click(screen.getByRole('button', { name: /^Clear$/ }));
    expect(screen.getByText('No group', { selector: 'span.badge' })).toBeTruthy();
  });
});

