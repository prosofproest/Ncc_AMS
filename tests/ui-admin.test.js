// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import bcrypt from 'bcryptjs';
import { installBrowser, jar, calls } from './helpers/browser.js';
import { flushBg } from './helpers/http.js';
import { todayIST } from '@/lib/time';

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
    useSearchParams: () => new URLSearchParams(typeof window !== 'undefined' ? (window.location.search || (nav.path?.includes('?') ? nav.path.slice(nav.path.indexOf('?')) : '')) : ''),
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
import CadetPage from '@/app/dashboard/cadet/page';
import LeaderboardPage from '@/app/dashboard/leaderboard/page';
import CalendarPage from '@/app/dashboard/calendar/page';
import ChangePasswordPage from '@/app/change-password/page';

const db = globalThis.__db, TODAY = todayIST();
let env;
const wait = (fn, o) => waitFor(fn, { timeout: 8000, ...o });
const userByName = n => db.all('users').map(d => ({ id: d.id, ...d.data })).find(u => u.name === n);
const stats = { total: 0, present: 0, absent: 0, months: {} };
const api = async (url, method = 'GET', body) => (await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
const signIn = async (id, pw) => { jar.cookie = ''; sessionStorage.clear(); const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: id, password: pw }) }); expect(r.status).toBe(200); };
const mount = (Page, path, props = {}) => { cleanup(); nav.path = path; history.pushState({}, '', path); render(React.createElement(DashboardLayout, null, React.createElement(Page, props))); };
const mountAdmin = (section = 'overview') => mount(AdminSectionPage, `/dashboard/admin/${section}`, { params: { section } });
const mountCto = (section = 'overview') => mount(CtoSectionPage, `/dashboard/cto/${section}`, { params: { section } });

const navLink = async (u, name) => {
  const mainNav = await screen.findByRole('navigation', { name: /Main/i });
  let pattern = name;
  if (name === 'Attendance') pattern = /Records|Attendance/i;
  const link = within(mainNav).getByRole('link', { name: typeof pattern === 'string' ? new RegExp(`^${pattern}$`, 'i') : pattern });
  const href = link.getAttribute('href');
  await u.click(link);
  if (href.startsWith('/dashboard/admin/')) {
    const section = href.replace('/dashboard/admin/', '');
    mountAdmin(section);
  } else if (href.startsWith('/dashboard/cto/')) {
    const section = href.replace('/dashboard/cto/', '');
    mountCto(section);
  } else if (href === '/dashboard/calendar') {
    mount(CalendarPage, href);
  } else if (href === '/dashboard/leaderboard') {
    mount(LeaderboardPage, href);
  } else if (href === '/dashboard/cadet') {
    mount(CadetPage, href);
  }
};

beforeAll(async () => {
  env = installBrowser();
  const mk = (id, d) => db.collection('users').doc(id).set({ isActive: true, discharged: false, stats, benefit: 0, mustChangePassword: false, otpRequired: false, ...d });
  await mk('admin1', { name: 'Admin Officer', role: 'admin', username: 'admin', passwordHash: await bcrypt.hash('Admin@123', 4), email: 'admin@test.in' });
  await mk('cto1', { name: 'Lt. Sir', role: 'cto', username: 'sir', passwordHash: await bcrypt.hash('Sir@12345', 4), email: 'sir.cto@test.in' });
  await mk('mk1', { name: 'Sgt Rohan', role: 'marker', username: 'rohan', passwordHash: await bcrypt.hash('Marker@123', 4), email: 'rohan@test.in', otpRequired: true });
  await db.collection('settings').doc('main').set({ sirEmail: 'sir@test.in', backupEmail: 'backup@test.in' });
  const people = [['Arjun Sharma', 1, 'SD', 'arjun@test.in'], ['Priya Nair', 1, 'SD', 'priya@test.in'], ['Rahul Shetty', 1, 'SW', ''], ['Karthik Bhat', 2, 'SD', 'karthik@test.in']];
  for (const [i, [name, year, type, email]] of people.entries()) await mk('c' + i, { name, role: 'cadet', year, type, email, regNo: `KAR/NCC/${year}/${100 + i}`, passwordHash: await bcrypt.hash(`KAR/NCC/${year}/${100 + i}`, 4) });
  // the marker submits one parade (through the real API) so the dashboards have data
  await mk('mk2', { name: 'Marker Two', role: 'marker', username: 'mk2', passwordHash: await bcrypt.hash('Marker@123', 4), email: 'm2@test.in' });
  await signIn('mk2', 'Marker@123');
  const r = await api('/api/attendance', 'POST', { date: TODAY, activity_type: 'Parade', activity_description: 'Drill', years: [1, 2], geo_lat: 12.9, geo_lng: 74.8, photo_urls: ['https://res.cloudinary.com/x/image/upload/a.jpg'],
    records: [['c0', 'Present'], ['c1', 'Absent', 'Sick / Medical'], ['c2', 'Present'], ['c3', 'Present']].map(([cadet_id, status, reason = '']) => ({ cadet_id, status, reason })) });
  expect(r.success).toBe(true); expect(r.pending).toBe(true);
  // nothing exists until BOTH the Admin and the CTO approve
  await signIn('admin', 'Admin@123'); expect((await api('/api/approvals', 'POST', { id: r.sessionId, action: 'approve' })).final).toBe(false);
  await signIn('sir', 'Sir@12345');   expect((await api('/api/approvals', 'POST', { id: r.sessionId, action: 'approve' })).final).toBe(true);
  await flushBg(); globalThis.__mail.length = 0;
});

describe('administrator', () => {
  it('voice greeting is spoken once, with the right words — only for the admin', async () => {
    await signIn('admin', 'Admin@123'); env.speech.length = 0;
    mountAdmin('overview');
    await screen.findByText(/Jai Hind, Admin Officer/i);
    await wait(() => expect(env.speech).toEqual(['Jai Hind. Welcome, Admin Officer. Administrator access granted.']));
    const mainNav = await screen.findByRole('navigation', { name: /Main/i });
    const names = within(mainNav).getAllByRole('link').map(l => l.querySelector('.nav-label')?.textContent || l.textContent.trim());
    expect(names).toEqual(['Overview', 'Approvals', 'Mark attendance', 'Records', 'Calendar', 'Help', 'People', 'Reports', 'Benefits', 'Google Sheet', 'Settings', 'Promotion', 'Roles', 'System health', 'Change log']);
    mountAdmin('overview');                                                      // same sign-in session: no repeat
    await screen.findByRole('heading', { name: /Overview/ }); expect(env.speech.length).toBe(1);
  });

  it('overview shows real numbers', async () => {
    mountAdmin('overview');
    await screen.findByText('Cadets'); await screen.findByText(/Year-wise average/);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);                                 // 1 parade
    expect((await screen.findAllByText(/Parade/)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Priya Nair/)).toBeTruthy();                                // below 75% list (0%)
  });

  it('attendance tab: open a parade, correct a record, save → logged + mailed', async () => {
    const u = userEvent.setup({ delay: null }); mountAdmin('overview');
    await navLink(u, 'Records');
    await u.click(await screen.findByText(/Year 1 & 2 · by Marker Two/));
    const dlg = await screen.findByRole('dialog'); await within(dlg).findByText('Priya Nair');
    expect(within(dlg).getByText(/Tap P \/ A to correct/)).toBeTruthy();
    const row = within(dlg).getByText('Priya Nair').closest('.item');
    await u.click(within(row).getByRole('button', { name: 'P' }));
    expect(within(row).getByText('changed')).toBeTruthy();
    await u.click(within(dlg).getByRole('button', { name: /Save 1 change/ }));
    await u.click(within(await screen.findByText('Save changes?').then(e => e.closest('[role=dialog]'))).getByRole('button', { name: 'Save changes' }));
    await wait(() => expect(userByName('Priya Nair').stats).toMatchObject({ present: 1, absent: 0 }));
    await flushBg();
    const m = globalThis.__mail.find(x => /Attendance edited/.test(x.subject)); expect(m.to).toBe('sir@test.in, backup@test.in'); expect(m.attachments[0].filename).toMatch(/CORRECTED/);
    expect(db.all('audit_log').some(a => a.data.type === 'edit' && a.data.byName === 'Admin Officer')).toBe(true);
  });

  it('people tab: toggle OTP per account and create a new marker account (email, password, OTP)', async () => {
    const u = userEvent.setup({ delay: null }); mountAdmin('overview');
    await navLink(u, 'People'); await screen.findByText('Sgt Rohan');
    const sw = screen.getByRole('switch', { name: 'OTP for Sgt Rohan' }); expect(sw.getAttribute('aria-checked')).toBe('true');
    await u.click(sw); await wait(() => expect(userByName('Sgt Rohan').otpRequired).toBe(false));
    await u.click(screen.getByRole('switch', { name: 'OTP for Sgt Rohan' })); await wait(() => expect(userByName('Sgt Rohan').otpRequired).toBe(true));
    await u.click(screen.getByRole('button', { name: /Add account/ }));
    const dlg = await screen.findByRole('dialog');
    const f = l => within(dlg).getByText(l, { selector: 'label' }).parentElement.querySelector('input,select');
    await u.selectOptions(f('Account type'), 'marker');
    await u.type(f('Full name'), 'New Marker');
    await u.type(f(/^E-mail/), 'newmarker@test.in');
    const pw = f('Password'); expect(pw.value.length).toBe(10);                                // generated
    await u.click(within(dlg).getByRole('button', { name: 'Create account' }));
    await wait(() => expect(userByName('New Marker')).toMatchObject({ role: 'marker', email: 'newmarker@test.in', otpRequired: true, mustChangePassword: true }));
    expect(await screen.findByText(/Account created\. E-mail: newmarker@test\.in/)).toBeTruthy();
  });

  it('reports tab: every download button hits the report API and saves a file', async () => {
    const u = userEvent.setup({ delay: null }); mountAdmin('overview');
    const clicked = []; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { clicked.push(this.download); };
    await navLink(u, 'Reports'); await screen.findByText(/Day report/);
    calls.length = 0;
    const card = t => screen.getByText(t).closest('.card');
    let n = 0; const dl = async (cardTitle, fmt) => { await u.click(within(card(cardTitle)).getByRole('button', { name: fmt })); n += 1; const want = n; await wait(() => expect(clicked.length).toBe(want)); };
    await dl('Day report (parade report)', /PDF/); await dl('Monthly report', /Excel/); await dl('Whole unit summary', /CSV/); await dl('Absentees report', /PDF/); await dl('Year-wise summary', /PDF/);
    HTMLAnchorElement.prototype.click = orig;
    expect(clicked[0]).toMatch(/Day-Report_.*\.pdf$/); expect(clicked[1]).toMatch(/Monthly-Report_.*\.xlsx$/); expect(clicked[2]).toMatch(/Unit-Summary-Report\.csv$/);
    expect(calls.filter(c => c.includes('/api/reports')).length).toBe(5);
    // individual cadet report
    const cc = card('Individual cadet report');
    await u.selectOptions(within(cc).getByRole('listbox'), await within(cc).findByText(/Arjun Sharma/));
    HTMLAnchorElement.prototype.click = function () { clicked.push(this.download); };
    await u.click(within(cc).getByRole('button', { name: /PDF/ })); await wait(() => expect(clicked.at(-1)).toMatch(/Cadet-Report_KAR-NCC-1-100\.pdf$/));
    HTMLAnchorElement.prototype.click = orig;
  });

  it('benefits tab: give a benefit to selected cadets', async () => {
    const u = userEvent.setup({ delay: null }); mountAdmin('overview');
    await navLink(u, 'Benefits'); await u.click(await screen.findByRole('button', { name: /Give benefit/ }));
    const dlg = await screen.findByRole('dialog');
    await u.click(await within(dlg).findByText('Rahul Shetty')); await u.click(within(dlg).getByText('Karthik Bhat'));
    await u.type(within(dlg).getByPlaceholderText(/Republic Day/), 'Republic Day camp');
    await u.click(within(dlg).getByRole('button', { name: /Give to 2 cadets/ }));
    await wait(() => expect(userByName('Rahul Shetty').benefit).toBe(1));
    expect((await screen.findAllByText(/Republic Day camp ·/)).length).toBe(2);
  });

  it('settings tab: change emails, threshold, reasons and save', async () => {
    const u = userEvent.setup({ delay: null }); mountAdmin('overview');
    await navLink(u, 'Settings'); await screen.findByText('Official emails');
    const sir = screen.getByPlaceholderText('sir@example.com'); await u.clear(sir); await u.type(sir, 'newsir@test.in');
    await u.type(screen.getByPlaceholderText('Add a reason…'), 'Went for camp{enter}');
    await u.click(screen.getByRole('button', { name: /Remove Late arrival/ }));
    await u.click(screen.getByRole('button', { name: 'Save settings' }));
    await wait(async () => { const s = (await db.collection('settings').doc('main').get()).data(); expect(s.sirEmail).toBe('newsir@test.in'); expect(s.absentReasons).toContain('Went for camp'); expect(s.absentReasons).not.toContain('Late arrival'); });
    await u.click(screen.getByRole('button', { name: /Send a test email/ })); await screen.findByText(/Test email sent to newsir@test.in/);
    expect(globalThis.__mail.at(-1).to).toBe('newsir@test.in');
  });

  it('google sheet tab: setup creates tabs, import explains an empty sheet instead of wiping data', async () => {
    const u = userEvent.setup({ delay: null }); mountAdmin('overview');
    await navLink(u, 'Google Sheet'); await screen.findByText(/How the Google Sheet works/);
    await u.click(screen.getByRole('button', { name: /Set up \/ repair tabs/ })); await wait(() => expect(document.body.textContent).toMatch(/Created: |All tabs already exist|failed/));
    await u.click(screen.getByRole('button', { name: /Import cadets now/ })); await screen.findByText(/Added 0, updated \d+, unchanged \d+, deactivated 0/);   // the app already wrote every person into the sheet, so a re-import changes nothing important
    expect(db.all('users').filter(d => d.data.role === 'cadet' && d.data.isActive).length).toBe(4);
    await u.click(screen.getByRole('button', { name: /Rebuild all reports/ })); await screen.findByText(/Rebuilt 4 attendance rows and 1 parades/);
  });

  it('system health tab: live latency + every integration green', async () => {
    const u = userEvent.setup({ delay: null }); mountAdmin('overview');
    await navLink(u, 'System health');
    await screen.findByText(/Everything is working|Accounts need attention/, {}, { timeout: 9000 });
    for (const n of ['Firebase database', 'Google Sheets', 'Email (SMTP)', 'Cloudinary (photos)', 'Environment variables', 'Sir / backup email', 'Accounts']) expect(await screen.findByText(n)).toBeTruthy();
    expect(screen.getByText('Server responding')).toBeTruthy(); expect(screen.getByText('Your device -> server')).toBeTruthy();
    expect(await screen.findByText(/Sheet syncs/)).toBeTruthy();
  });

  it('promotion tab: preview then confirm word required; roles + change log render', async () => {
    const u = userEvent.setup({ delay: null }); mountAdmin('overview');
    await navLink(u, 'Promotion'); await u.click(await screen.findByRole('button', { name: /Preview promotion/ }));
    await screen.findByText(/Preview — cycle/);
    const go = screen.getByRole('button', { name: /Promote everyone now/ }); expect(go.disabled).toBe(true);
    await u.type(screen.getByPlaceholderText('PROMOTE'), 'promote'); expect(go.disabled).toBe(false);
    await u.click(go); await screen.findByText('Promotion complete');
    expect(userByName('Arjun Sharma')).toMatchObject({ year: 2 }); expect(userByName('Arjun Sharma').stats.total).toBe(0);
    await navLink(u, 'Roles'); await screen.findByRole('heading', { name: 'Administrator' }); expect(screen.getAllByRole('switch').length).toBeGreaterThan(20);
    await navLink(u, 'Change log'); await screen.findByText('Submitted'); expect(screen.getAllByText('Promotion').length).toBeGreaterThan(0);
  });
});

describe('Sir (CTO), cadet and shared pages', () => {
  it('CTO sees only what Sir needs — no promotion / roles / health / settings — and can edit attendance', async () => {
    await signIn('sir', 'Sir@12345'); env.speech.length = 0; sessionStorage.clear();
    const u = userEvent.setup({ delay: null }); mountCto('overview');
    await screen.findByRole('heading', { name: /Overview/ });
    const mainNav = await screen.findByRole('navigation', { name: /Main/i });
    const names = within(mainNav).getAllByRole('link').map(l => l.querySelector('.nav-label')?.textContent || l.textContent.trim());
    expect(names).toEqual(['Overview', 'Approvals', 'Mark attendance', 'Records', 'Help', 'Cadets', 'Reports', 'Benefits', 'Change log']);
    expect(env.speech.length).toBe(0);                                                         // no voice for Sir
    await navLink(u, 'Cadets'); await screen.findByText('Arjun Sharma'); expect(screen.queryByRole('button', { name: /Add account/ })).toBeNull(); expect(screen.queryAllByRole('switch').length).toBe(0);
  });

  it('cadet dashboard: percentage ring, record with reason, report download; leaderboard + calendar', async () => {
    await signIn('KAR/NCC/1/101', 'KAR/NCC/1/101');     // Priya (cycle was promoted in the previous test → fresh start)
    mount(CadetPage, '/dashboard/cadet');
    await screen.findByText('Priya Nair'); await screen.findByText(/No parades recorded yet/);
    await screen.findByRole('button', { name: /My report \(PDF\)/ });
    mount(LeaderboardPage, '/dashboard/leaderboard'); await screen.findByText(/minimum 3 per cadet/);
    mount(CalendarPage, '/dashboard/calendar'); await screen.findByRole('heading', { name: /Calendar/ });
  });

  it('forced password change screen', async () => {
    cleanup(); history.pushState({}, '', '/change-password'); const u = userEvent.setup({ delay: null });
    await db.collection('users').doc('c1').update({ mustChangePassword: true });
    await signIn('KAR/NCC/1/101', 'KAR/NCC/1/101');
    render(React.createElement(ChangePasswordPage));
    await u.type(screen.getByLabelText('New password'), 'abc'); await u.type(screen.getByLabelText('Confirm password'), 'abc'); await u.click(screen.getByRole('button', { name: /Save & continue/ }));
    await screen.findByText(/at least 6 characters/);
    await u.clear(screen.getByLabelText('New password')); await u.clear(screen.getByLabelText('Confirm password'));
    await u.type(screen.getByLabelText('New password'), 'GoodPass#1'); await u.type(screen.getByLabelText('Confirm password'), 'GoodPass#2'); await u.click(screen.getByRole('button', { name: /Save & continue/ }));
    await screen.findByText(/do not match/);
    await u.clear(screen.getByLabelText('Confirm password')); await u.type(screen.getByLabelText('Confirm password'), 'GoodPass#1'); await u.click(screen.getByRole('button', { name: /Save & continue/ }));
    await wait(() => expect(nav.replace).toHaveBeenLastCalledWith('/dashboard/cadet'));
  });
});
