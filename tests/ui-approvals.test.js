// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import bcrypt from 'bcryptjs';
import { installBrowser, jar } from './helpers/browser.js';
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

const db = globalThis.__db, TODAY = todayIST();
const wait = (fn, o) => waitFor(fn, { timeout: 9000, ...o });
const userByName = n => db.all('users').map(d => ({ id: d.id, ...d.data })).find(u => u.name === n);
const stats = { total: 0, present: 0, absent: 0, months: {} };
const api = async (url, method = 'GET', body) => (await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
const signIn = async (id, pw) => { jar.cookie = ''; sessionStorage.clear(); const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: id, password: pw }) }); expect(r.status).toBe(200); };
const mount = (Page, path, props = {}) => { cleanup(); nav.path = path; history.pushState({}, '', path); render(React.createElement(DashboardLayout, null, React.createElement(Page, props))); };
const mountAdmin = (section = 'overview') => mount(AdminSectionPage, `/dashboard/admin/${section}`, { params: { section } });
const mountCto = (section = 'overview') => mount(CtoSectionPage, `/dashboard/cto/${section}`, { params: { section } });
const day = n => { const d = new Date(TODAY + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const submitAsMarker = async (date, years, records) => {
  await signIn('mk', 'Marker@123');
  const live = date === TODAY;
  const r = await api('/api/attendance', 'POST', { date, activity_type: 'Parade', activity_description: 'Drill', years, photo_urls: live ? ['https://res.cloudinary.com/x/image/upload/a.jpg'] : [], ...(live ? { geo_lat: 12.9, geo_lng: 74.8 } : {}), records: records.map(([cadet_id, status, reason = '']) => ({ cadet_id, status, reason })) });
  expect(r.pending).toBe(true); return r.sessionId;
};
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
  }
};

beforeAll(async () => {
  installBrowser();
  const mk = (id, d) => db.collection('users').doc(id).set({ isActive: true, discharged: false, stats, benefit: 0, mustChangePassword: false, otpRequired: false, ...d });
  await mk('admin1', { name: 'Admin Officer', role: 'admin', username: 'admin', passwordHash: await bcrypt.hash('Admin@123', 4), email: 'admin@test.in' });
  await mk('cto1', { name: 'Lt. Sir', role: 'cto', username: 'sir', passwordHash: await bcrypt.hash('Sir@12345', 4), email: 'sir.cto@test.in' });
  await mk('mk1', { name: 'Sgt Rohan', role: 'marker', username: 'mk', passwordHash: await bcrypt.hash('Marker@123', 4), email: 'rohan@test.in' });
  await db.collection('settings').doc('main').set({ sirEmail: 'sir@test.in', backupEmail: 'backup@test.in' });
  for (const [i, [name, year, email]] of [['Arjun Sharma', 1, 'arjun@test.in'], ['Priya Nair', 1, 'priya@test.in'], ['Rahul Shetty', 1, ''], ['Karthik Bhat', 2, 'karthik@test.in']].entries())
    await mk('c' + i, { name, role: 'cadet', year, type: 'SD', email, regNo: `KAR/NCC/${year}/${100 + i}`, passwordHash: await bcrypt.hash('x', 4) });
});

describe('Approvals tab — Admin and CTO', () => {
  let pendingId;
  it('a submission appears live with a counter, the Admin reviews, corrects and approves; the CTO finalises', async () => {
    const u = userEvent.setup({ delay: null });
    await signIn('admin', 'Admin@123'); mountAdmin('overview');
    await screen.findByRole('heading', { name: /Overview/ });
    expect(screen.queryByText(/waiting for your approval/)).toBeNull();                         // nothing yet
    pendingId = await submitAsMarker(TODAY, [1], [['c0', 'Present'], ['c1', 'Absent', 'Sick / Medical'], ['c2', 'Present']]);
    await signIn('admin', 'Admin@123');                                                          // (the browser is the admin again)
    await screen.findByText(/1 attendance submission is waiting for your approval/, {}, { timeout: 15000 });   // arrives by itself, no reload
    await screen.findByText(/new attendance submission/, {}, { timeout: 3000 });                 // toast
    const mainNav = await screen.findByRole('navigation', { name: /Main/i });
    const approvalsLink = within(mainNav).getByRole('link', { name: /Approvals/ });
    expect(approvalsLink.textContent).toMatch(/1/);
    await navLink(u, /Approvals/);
    const card = (await screen.findByText(/Year 1 · by Sgt Rohan|Year 1/, { selector: '.sub' })).closest('button');
    expect(within(card).getByText('Needs you')).toBeTruthy(); expect(within(card).getByText('2 A'.replace('2', '1'))).toBeTruthy();
    await u.click(card);
    const dlg = await screen.findByRole('dialog'); await within(dlg).findByText('Priya Nair');
    expect(within(dlg).getByText(/Marked by/)).toBeTruthy(); expect(within(dlg).getAllByText(/Waiting/).length).toBe(2);
    // correct a mistake first: Rahul was actually absent
    const rahul = within(dlg).getByText('Rahul Shetty').closest('.item');
    await u.click(within(rahul).getByRole('button', { name: 'A' }));
    const sel = within(rahul).getByRole('combobox'); await u.selectOptions(sel, 'Late arrival');
    expect(within(dlg).getByRole('button', { name: /^Approve$/ }).disabled).toBe(true);        // must save the edit first
    await u.click(within(dlg).getByRole('button', { name: /Save 1 edit/ }));
    await screen.findByText(/Your approval is recorded; the CTO must approve again/);
    expect((await db.collection('pending_sessions').doc(pendingId).get()).data()).toMatchObject({ present: 1, absent: 2, waitingFor: ['cto'] });
    await wait(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Admin sees it is no longer waiting for them
    await wait(() => expect(screen.queryByText('Needs you')).toBeNull(), { timeout: 12000 });
    expect(db.all('attendance').length).toBe(0); expect(globalThis.__mail.length).toBe(0);

    // ── the CTO ──
    await signIn('sir', 'Sir@12345'); mountCto('overview');
    await screen.findByText(/1 attendance submission is waiting for your approval/, {}, { timeout: 12000 });
    await navLink(u, /Approvals/);
    await u.click((await screen.findByText('Needs you')).closest('button'));
    const d2 = await screen.findByRole('dialog'); await within(d2).findByText('Priya Nair');
    expect(within(d2).getByText('Admin Officer')).toBeTruthy();                                  // Admin's approval is shown
    await u.click(within(d2).getByRole('button', { name: /^Approve$/ }));
    const conf = await screen.findByText('Approve and finalise?'); expect(conf).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Approve & finalise' }));
    await screen.findByText(/Approved and saved\. Parade report is being e-mailed\./);
    await flushBg();
    expect(db.all('attendance').length).toBe(3);
    expect(userByName('Rahul Shetty').stats).toMatchObject({ total: 1, absent: 1 });
    const parade = globalThis.__mail.find(m => /Parade Report/.test(m.subject)); expect(parade.subject).toMatch(/P:1 A:2/);
    expect(parade.html).toContain('Approved · Admin'); expect(parade.html).toContain('Approved · CTO'); expect(parade.html).toContain('Respected Sir');
    expect(parade.html).toContain('prepared by <b');
    expect(db.all('pending_sessions').length).toBe(0);
  });

  it('reject with a reason → listed under Rejected, the marker sees the reason', async () => {
    const u = userEvent.setup({ delay: null });
    const id = await submitAsMarker(day(2), [1], [['c0', 'Present'], ['c1', 'Present']]);
    await signIn('sir', 'Sir@12345'); mountCto('overview'); await navLink(u, /Approvals/);
    await u.click((await screen.findByText('Needs you', {}, { timeout: 10000 })).closest('button'));
    const dlg = await screen.findByRole('dialog'); await within(dlg).findByText('Arjun Sharma');
    await u.click(within(dlg).getByRole('button', { name: /Reject…/ }));
    await u.type(within(dlg).getByPlaceholderText(/Reason \(the marker will see this\)/), 'Wrong date');
    await u.click(within(dlg).getByRole('button', { name: /^Reject$/ }));
    await screen.findByText(/Rejected\. The marker will see your reason/);
    await u.click(await screen.findByRole('button', { name: 'Rejected' }));
    expect(await screen.findByText(/“Wrong date”/)).toBeTruthy();
    await signIn('mk', 'Marker@123');
    expect((await api('/api/approvals?mine=1')).submissions.find(x => x.id === id)).toMatchObject({ state: 'rejected', rejection: { reason: 'Wrong date' } });
    expect(db.all('attendance').length).toBe(3);
  });

  it('Admin can take attendance too: own approval is automatic, the CTO is still needed', async () => {
    const u = userEvent.setup({ delay: null });
    await signIn('admin', 'Admin@123'); mountAdmin('overview'); await navLink(u, /Mark attendance/);
    await u.click(await screen.findByRole('button', { name: /^Year 2/ })); await screen.findByText('Karthik Bhat');
    await u.click(await screen.findByRole('button', { name: /Take photo/ }).then(() => screen.getByLabelText('Date')).then(() => screen.getByRole('button', { name: /^Submit$/ })).catch(() => screen.getByRole('button', { name: /^Submit$/ })));   // blocked (location + photo needed for today) — handled below
    expect(screen.getByRole('button', { name: /^Submit$/ }).disabled).toBe(true);
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: day(3) } });              // past date: no location/photo needed
    await wait(() => expect(screen.getByRole('button', { name: /^Submit$/ }).disabled).toBe(false));
    await u.click(screen.getByRole('button', { name: /^Submit$/ }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Yes, submit/ }));
    await screen.findByText('Sent for approval');
    expect(screen.getByText(/waiting for approval from CTO/)).toBeTruthy();
    const p = db.all('pending_sessions').find(x => x.data.date === day(3)).data;
    expect(p).toMatchObject({ markerRole: 'admin', waitingFor: ['cto'] }); expect(p.approvals.admin.byName).toBe('Admin Officer');
    await u.click(screen.getByRole('button', { name: /Open approvals/ }));
    await screen.findByText(/Year 2 · by Admin Officer \(Admin\)|Year 2/, { selector: '.sub' });
    expect(screen.queryByText('Needs you')).toBeNull();                                          // nothing for the Admin to do on their own submission
  });
});
