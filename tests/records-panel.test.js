// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import bcrypt from 'bcryptjs';
import { installBrowser, jar } from './helpers/browser.js';
import { call } from './helpers/http.js';
import { createToken } from '@/lib/auth';
import { UIProvider } from '@/app/components/ui';
import { UserCtx } from '@/app/components/user';
import AttendancePanel from '@/app/components/manage/AttendancePanel';
import * as attR from '@/app/api/attendance/route';
import * as loginR from '@/app/api/auth/login/route';

const db = globalThis.__db;

describe('PART A: Records Screen and API History', () => {
  let adminCookie, adminUser;

  beforeAll(async () => {
    installBrowser();
    sessionStorage.setItem('ncc_tab', 'test-tab-id-default');
    sessionStorage.setItem('ncc_has_session', '1');
    const pw = await bcrypt.hash('Admin@123', 4);
    adminUser = {
      id: 'admin_rec',
      name: 'Admin Records',
      role: 'admin',
      username: 'adminrec',
      passwordHash: pw,
      email: 'adminrec@test.in',
      isActive: true,
      permissions: { canManageUsers: true, canEditAttendance: true, canViewAllAttendance: true }
    };
    await db.collection('users').doc('admin_rec').set(adminUser);
    const loginRes = await call(loginR.POST, { method: 'POST', body: { identifier: 'adminrec', password: 'Admin@123' } });
    adminCookie = loginRes.cookie;
    jar.cookie = adminCookie;

    // Seed cadets in year 1 and year 2 (SD and SW)
    await db.collection('users').doc('cad_y1_sw').set({ id: 'cad_y1_sw', name: 'Zara SW', regNo: 'REG/02', year: 1, type: 'SW', role: 'cadet', isActive: true });
    await db.collection('users').doc('cad_y1_sd').set({ id: 'cad_y1_sd', name: 'Amit SD', regNo: 'REG/01', year: 1, type: 'SD', role: 'cadet', isActive: true });
    await db.collection('users').doc('cad_y2_sd').set({ id: 'cad_y2_sd', name: 'Bikram SD', regNo: 'REG/03', year: 2, type: 'SD', role: 'cadet', isActive: true });

    // Seed sessions spanning months
    await db.collection('sessions').doc('sess_nov_latest').set({
      id: 'sess_nov_latest',
      date: '2026-11-04',
      cycle: 1,
      activityType: 'Parade',
      groupLabel: 'Year 1 & 2',
      years: [1, 2],
      total: 3, present: 2, absent: 1,
      createdAt: '2026-11-04T10:30:00.000Z',
      approvedAt: '2026-11-04T11:00:00.000Z',
      markedByName: 'Marker One',
      approvals: {
        admin: { byName: 'Col. Admin', at: '2026-11-04T10:45:00.000Z' },
        cto: { byName: 'Maj. CTO', at: '2026-11-04T11:00:00.000Z' }
      }
    });

    await db.collection('sessions').doc('sess_nov_earlier').set({
      id: 'sess_nov_earlier',
      date: '2026-11-04',
      cycle: 1,
      activityType: 'PT',
      groupLabel: 'Year 1',
      years: [1],
      total: 2, present: 2, absent: 0,
      createdAt: '2026-11-04T06:30:00.000Z',
      approvedAt: '2026-11-04T07:00:00.000Z',
      markedByName: 'Marker One',
      approvals: {
        admin: { byName: 'Col. Admin', at: '2026-11-04T06:45:00.000Z' },
        cto: { byName: 'Maj. CTO', at: '2026-11-04T07:00:00.000Z' }
      }
    });

    await db.collection('sessions').doc('sess_oct').set({
      id: 'sess_oct',
      date: '2026-10-25',
      cycle: 1,
      activityType: 'Parade',
      groupLabel: 'Year 1',
      years: [1],
      total: 2, present: 1, absent: 1,
      createdAt: '2026-10-25T08:00:00.000Z',
      approvedAt: '2026-10-25T09:00:00.000Z',
      markedByName: 'Marker Two',
      approvals: {
        admin: { byName: 'Col. Admin', at: '2026-10-25T08:30:00.000Z' },
        cto: { byName: 'Maj. CTO', at: '2026-10-25T09:00:00.000Z' }
      }
    });

    // Seed attendance records for sess_nov_latest
    await db.collection('attendance').doc('2026-11-04_cad_y1_sd').set({ sessionId: 'sess_nov_latest', cadetId: 'cad_y1_sd', cadetName: 'Amit SD', cadetRegNo: 'REG/01', cadetYear: 1, cadetType: 'SD', status: 'Present', reason: '', cycle: 1, date: '2026-11-04' });
    await db.collection('attendance').doc('2026-11-04_cad_y1_sw').set({ sessionId: 'sess_nov_latest', cadetId: 'cad_y1_sw', cadetName: 'Zara SW', cadetRegNo: 'REG/02', cadetYear: 1, cadetType: 'SW', status: 'Absent', reason: 'Medical', cycle: 1, date: '2026-11-04' });
    await db.collection('attendance').doc('2026-11-04_cad_y2_sd').set({ sessionId: 'sess_nov_latest', cadetId: 'cad_y2_sd', cadetName: 'Bikram SD', cadetRegNo: 'REG/03', cadetYear: 2, cadetType: 'SD', status: 'Present', reason: '', cycle: 1, date: '2026-11-04' });

    await db.collection('settings').doc('main').set({
      currentCycle: 1,
      absentReasons: ['Medical', 'Camp', 'Other']
    });
  });

  it('GET /api/attendance?history=1 returns sessions sorted newest parade date then createdAt, with createdAt & approvedAt', async () => {
    const res = await call(attR.GET, { cookie: adminCookie, url: '/api/attendance?history=1' });
    expect(res.status).toBe(200);
    const sessions = res.json.sessions;
    expect(sessions.length).toBeGreaterThanOrEqual(3);

    // Verify ordering: 2026-11-04 (10:30) before 2026-11-04 (06:30) before 2026-10-25
    expect(sessions[0].id).toBe('sess_nov_latest');
    expect(sessions[1].id).toBe('sess_nov_earlier');
    expect(sessions[2].id).toBe('sess_oct');

    // Verify createdAt and approvedAt are present
    expect(sessions[0].createdAt).toBe('2026-11-04T10:30:00.000Z');
    expect(sessions[0].approvedAt).toBe('2026-11-04T11:00:00.000Z');
  });

  it('AttendancePanel renders month dividers, submitted line, modal with sections, filter, search and saves', async () => {
    const u = userEvent.setup({ delay: null });
    render(
      React.createElement(UIProvider, null,
        React.createElement(UserCtx.Provider, { value: adminUser },
          React.createElement(AttendancePanel, null)
        )
      )
    );

    // Month dividers
    await screen.findByText('November 2026');
    expect(screen.getByText('October 2026')).toBeTruthy();

    // Submitted lines on cards
    const submittedLabels = await screen.findAllByText(/Submitted.*4 Nov 2026/);
    expect(submittedLabels.length).toBeGreaterThanOrEqual(2);

    // Open sess_nov_latest session modal
    const card = screen.getByText(/Year 1 & 2/).closest('button');
    await u.click(card);

    // Modal submitted and approved metadata
    await screen.findByText(/Submitted.*4 Nov 2026.*Marker One/);
    expect(screen.getByText(/Approved.*4 Nov 2026.*Col\. Admin and Maj\. CTO/)).toBeTruthy();

    // Segmented control: All | Year 1 | Year 2
    expect(screen.getByRole('button', { name: /All \(3\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Year 1 \(2\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Year 2 \(1\)/ })).toBeTruthy();

    // Year sections sticky headings: "Year 1 - 2 cadets - 1 present - 1 absent"
    expect(screen.getByText(/Year 1 - 2 cadets - 1 present - 1 absent/)).toBeTruthy();
    expect(screen.getByText(/Year 2 - 1 cadet - 1 present - 0 absent/)).toBeTruthy();

    // SD before SW sub-headings
    expect(screen.getAllByText('SD').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('SW').length).toBeGreaterThanOrEqual(1);

    // Filter by year: click "Year 2"
    await u.click(screen.getByRole('button', { name: /Year 2 \(1\)/ }));
    expect(screen.queryByText(/Year 1 - 2 cadets/)).toBeNull();
    expect(screen.getByText('Bikram SD')).toBeTruthy();

    // Switch back to "All"
    await u.click(screen.getByRole('button', { name: /All \(3\)/ }));
    expect(screen.getByText(/Year 1 - 2 cadets/)).toBeTruthy();

    // Search filter
    const searchInput = screen.getByPlaceholderText('Search cadet by name or Reg No.…');
    await u.type(searchInput, 'REG/02');
    expect(screen.getByText('Zara SW')).toBeTruthy();
    expect(screen.queryByText('Amit SD')).toBeNull();

    // Clear search
    await u.clear(searchInput);
    expect(screen.getByText('Amit SD')).toBeTruthy();

    // Edit P/A: change Zara SW (who was Absent) to Present
    const presentBtns = screen.getAllByRole('button', { name: 'P' });
    await u.click(presentBtns[1]);
    const saveBtn = screen.getByRole('button', { name: 'Save 1 change' });
    expect(saveBtn).toBeTruthy();
    await u.click(saveBtn);

    // Confirm dialog
    const confirmBtn = await screen.findByRole('button', { name: 'Save changes' });
    await u.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
