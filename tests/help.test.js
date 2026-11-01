// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { navFor } from '@/app/components/shell/nav';
import { DEFAULT_PERMISSIONS } from '@/lib/permissions';
import { UserCtx } from '@/app/components/user';
import HelpPage from '@/app/dashboard/help/page';
import Icon from '@/app/components/Icon';

describe('Part D: Help Page & Navigation', () => {
  it('1. Help item exists in main navigation group for every role and links to /dashboard/help', () => {
    const roles = [
      { role: 'admin', permissions: DEFAULT_PERMISSIONS.admin },
      { role: 'cto', permissions: DEFAULT_PERMISSIONS.cto },
      { role: 'marker', permissions: DEFAULT_PERMISSIONS.marker },
      { role: 'cadet', permissions: DEFAULT_PERMISSIONS.cadet },
    ];

    for (const u of roles) {
      const groups = navFor(u);
      expect(groups.length).toBeGreaterThan(0);
      const mainGroup = groups[0];
      const helpItem = mainGroup.items.find(i => i.id === 'help');
      expect(helpItem, `Help item missing for ${u.role}`).toBeDefined();
      expect(helpItem.href).toBe('/dashboard/help');
      expect(helpItem.label).toBe('Help');
      expect(helpItem.icon).toBe('help-circle');
      // Must be at the bottom of the main navigation group
      expect(mainGroup.items[mainGroup.items.length - 1].id).toBe('help');
    }
  });

  it('2. Icon component renders help-circle icon', () => {
    const { container } = render(React.createElement(Icon, { name: 'help-circle', size: 18 }));
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('3. Attendance marker sees only marker guide as 6 to 9 numbered steps', () => {
    cleanup();
    render(
      React.createElement(
        UserCtx.Provider,
        { value: { role: 'marker', permissions: DEFAULT_PERMISSIONS.marker } },
        React.createElement(HelpPage)
      )
    );

    expect(screen.getByText('Help')).toBeTruthy();
    expect(screen.getByText('Attendance Marker Guide')).toBeTruthy();
    expect(screen.getByText(/Sign in with e-mail and the code/i)).toBeTruthy();
    expect(screen.getByText(/Open Mark attendance/i)).toBeTruthy();
    expect(screen.getByText(/Mark P or A and choose a reason/i)).toBeTruthy();
    expect(screen.getByText(/Correct and resubmit/i)).toBeTruthy();
    expect(screen.getByText('Questions? Contact the Administrator.')).toBeTruthy();

    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBeGreaterThanOrEqual(6);
    expect(listItems.length).toBeLessThanOrEqual(9);

    expect(screen.queryByText('Administrator Guide')).toBeNull();
    expect(screen.queryByText(/Care Taker Officer/i)).toBeNull();
    expect(screen.queryByText('Cadet Guide')).toBeNull();
    expect(screen.queryByText(/Promotion once a year/i)).toBeNull();
  });

  it('4. Administrator sees only admin guide as 6 to 9 numbered steps', () => {
    cleanup();
    render(
      React.createElement(
        UserCtx.Provider,
        { value: { role: 'admin', permissions: DEFAULT_PERMISSIONS.admin } },
        React.createElement(HelpPage)
      )
    );

    expect(screen.getByText('Help')).toBeTruthy();
    expect(screen.getByText('Administrator Guide')).toBeTruthy();
    expect(screen.getByText(/Approvals shows items with you/i)).toBeTruthy();
    expect(screen.getByText(/Approve sends it to the CTO/i)).toBeTruthy();
    expect(screen.getByText(/Promotion once a year/i)).toBeTruthy();
    expect(screen.getByText('Questions? Contact the Administrator.')).toBeTruthy();

    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBeGreaterThanOrEqual(6);
    expect(listItems.length).toBeLessThanOrEqual(9);

    expect(screen.queryByText('Attendance Marker Guide')).toBeNull();
    expect(screen.queryByText(/Care Taker Officer/i)).toBeNull();
    expect(screen.queryByText('Cadet Guide')).toBeNull();
    expect(screen.queryByText(/Open Mark attendance/i)).toBeNull();
  });

  it('5. CTO sees only CTO guide as 6 to 9 numbered steps', () => {
    cleanup();
    render(
      React.createElement(
        UserCtx.Provider,
        { value: { role: 'cto', permissions: DEFAULT_PERMISSIONS.cto } },
        React.createElement(HelpPage)
      )
    );

    expect(screen.getByText('Help')).toBeTruthy();
    expect(screen.getByText(/Care Taker Officer/i)).toBeTruthy();
    expect(screen.getByText(/Approvals shows items the Administrator has approved/i)).toBeTruthy();
    expect(screen.getByText(/Approve saves and e-mails the parade report/i)).toBeTruthy();
    expect(screen.getByText(/Return to Administrator needs a reason/i)).toBeTruthy();
    expect(screen.getByText(/Reports for downloads/i)).toBeTruthy();
    expect(screen.getByText('Questions? Contact the Administrator.')).toBeTruthy();

    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBeGreaterThanOrEqual(6);
    expect(listItems.length).toBeLessThanOrEqual(9);

    expect(screen.queryByText('Attendance Marker Guide')).toBeNull();
    expect(screen.queryByText('Administrator Guide')).toBeNull();
    expect(screen.queryByText('Cadet Guide')).toBeNull();
    expect(screen.queryByText(/Promotion once a year/i)).toBeNull();
  });

  it('6. Cadet sees only cadet guide as 6 to 9 numbered steps', () => {
    cleanup();
    render(
      React.createElement(
        UserCtx.Provider,
        { value: { role: 'cadet', permissions: DEFAULT_PERMISSIONS.cadet } },
        React.createElement(HelpPage)
      )
    );

    expect(screen.getByText('Help')).toBeTruthy();
    expect(screen.getByText('Cadet Guide')).toBeTruthy();
    expect(screen.getByText(/My attendance shows your percentage/i)).toBeTruthy();
    expect(screen.getByText(/The required percentage is set by the unit/i)).toBeTruthy();
    expect(screen.getByText(/Leaderboard/i)).toBeTruthy();
    expect(screen.getByText(/Calendar/i)).toBeTruthy();
    expect(screen.getByText('Questions? Contact the Administrator.')).toBeTruthy();

    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBeGreaterThanOrEqual(6);
    expect(listItems.length).toBeLessThanOrEqual(9);

    expect(screen.queryByText('Attendance Marker Guide')).toBeNull();
    expect(screen.queryByText('Administrator Guide')).toBeNull();
    expect(screen.queryByText(/Care Taker Officer/i)).toBeNull();
    expect(screen.queryByText(/Promotion once a year/i)).toBeNull();
  });
});
