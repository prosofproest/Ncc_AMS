import { describe, it, expect, beforeEach } from 'vitest';
import { setupSheetTabs, writeSummaries, TAB_LAYOUT, TABS, ROSTER_TABS } from '@/lib/sheets';
import { FakeSheets } from './helpers/fake-sheets';

describe('Google Sheets layout formatting', () => {
  beforeEach(() => {
    globalThis.__sheets.reset();
  });

  it('(a) after setup every tab has exactly the widths specified in TAB_LAYOUT', async () => {
    await setupSheetTabs();
    const sheets = globalThis.__sheets;

    const allTabs = [
      ...ROSTER_TABS,
      TABS.graduated,
      TABS.discharged,
      TABS.log,
      TABS.daily,
      TABS.absent,
      TABS.monthly,
      TABS.summary,
      TABS.benefits,
      TABS.changes,
    ];

    for (const title of allTabs) {
      const tab = sheets.tab(title);
      expect(tab, `tab "${title}" should exist`).toBeDefined();
      const expectedCols = TAB_LAYOUT[title];
      const expectedWidths = expectedCols.map(c => c.width_px);
      expect(
        tab.colWidths.slice(0, expectedWidths.length),
        `Column widths mismatch for tab "${title}"`
      ).toEqual(expectedWidths);
    }
  });

  it('(b) wrap columns wrap and others clip', async () => {
    await setupSheetTabs();
    const sheets = globalThis.__sheets;

    const checkWrap = (title, wrapIndices) => {
      const tab = sheets.tab(title);
      expect(tab, `tab "${title}" should exist`).toBeDefined();
      const cols = TAB_LAYOUT[title];
      cols.forEach((c, idx) => {
        const expectedStrategy = wrapIndices.includes(idx) ? 'WRAP' : 'CLIP';
        expect(
          tab.colFormats[idx]?.wrapStrategy,
          `wrapStrategy mismatch on ${title} col ${idx} (${c.header})`
        ).toBe(expectedStrategy);
      });
    };

    // Attendance Log: Reason (col 9) wrap
    checkWrap(TABS.log, [9]);

    // Daily Report: Activity (col 2) wrap
    checkWrap(TABS.daily, [2]);

    // Absentees: Reason (col 5) wrap
    checkWrap(TABS.absent, [5]);

    // Benefits: Reason (col 5) wrap
    checkWrap(TABS.benefits, [5]);

    // Change Log: Before (6), After (7), Reason / Note (8) wrap
    checkWrap(TABS.changes, [6, 7, 8]);

    // Cadet Summary: all clip
    checkWrap(TABS.summary, []);

    // Year 1: all clip
    checkWrap(TABS.y1, []);
  });

  it('(c) running setup 3 times leaves exactly 1 conditional rule on Attendance Log and on Cadet Summary', async () => {
    await setupSheetTabs();
    await setupSheetTabs();
    await setupSheetTabs();
    const sheets = globalThis.__sheets;

    const logTab = sheets.tab(TABS.log);
    expect(logTab.conditionalFormats.length).toBe(1);
    expect(logTab.conditionalFormats[0].booleanRule.condition.values[0].userEnteredValue).toContain('Absent');

    const sumTab = sheets.tab(TABS.summary);
    expect(sumTab.conditionalFormats.length).toBe(1);
    expect(sumTab.conditionalFormats[0].booleanRule.condition.values[0].userEnteredValue).toContain('BELOW');

    // Other tabs should have 0 rules
    for (const title of [...ROSTER_TABS, TABS.graduated, TABS.discharged, TABS.daily, TABS.absent, TABS.monthly, TABS.benefits, TABS.changes]) {
      const tab = sheets.tab(title);
      expect(tab.conditionalFormats.length, `tab "${title}" should have 0 conditional rules`).toBe(0);
    }
  });

  it('(d) a tab whose widths were changed by hand is restored by setup', async () => {
    await setupSheetTabs();
    const sheets = globalThis.__sheets;

    // Simulate user resizing columns manually
    const y1 = sheets.tab('Year 1');
    y1.colWidths[1] = 999;
    y1.colWidths[2] = 42;

    const log = sheets.tab('Attendance Log');
    log.colWidths[5] = 500;

    // Run setup again
    await setupSheetTabs();

    // Verify widths are restored to TAB_LAYOUT definitions
    expect(y1.colWidths[1]).toBe(220); // Name
    expect(y1.colWidths[2]).toBe(170); // Reg No.
    expect(log.colWidths[5]).toBe(220); // Name
  });

  it('(e) hidden key columns stay hidden', async () => {
    await setupSheetTabs();
    const sheets = globalThis.__sheets;

    const logTab = sheets.tab(TABS.log);
    expect(logTab.hiddenCols).toContain(12);

    const dailyTab = sheets.tab(TABS.daily);
    expect(dailyTab.hiddenCols).toContain(10);

    const absentTab = sheets.tab(TABS.absent);
    expect(absentTab.hiddenCols).toContain(7);

    const benTab = sheets.tab(TABS.benefits);
    expect(benTab.hiddenCols).toContain(7);

    // Visible tabs like Year 1 should not have any hidden columns
    const y1Tab = sheets.tab(TABS.y1);
    expect(y1Tab.hiddenCols.length).toBe(0);
  });

  it('(f) Monthly Report with 4 months gets 4 x 120px month columns', async () => {
    const sheets = globalThis.__sheets;
    await setupSheetTabs();

    const sampleUsers = [
      {
        id: 'u1',
        name: 'Arjun',
        regNo: 'KAR/101',
        year: 1,
        type: 'SD',
        role: 'cadet',
        isActive: true,
        discharged: false,
        stats: {
          total: 12,
          present: 10,
          absent: 2,
          months: {
            m202601: { t: 3, p: 3 },
            m202602: { t: 3, p: 2 },
            m202603: { t: 3, p: 3 },
            m202604: { t: 3, p: 2 },
          },
        },
      },
    ];

    await writeSummaries(sampleUsers);

    const monthlyTab = sheets.tab(TABS.monthly);
    expect(monthlyTab).toBeDefined();

    // Expected columns: Reg No. (170), Name (220), Year (80), Type (80),
    // 4 month columns (120 each), Overall % (100)
    const expected = [170, 220, 80, 80, 120, 120, 120, 120, 100];
    expect(monthlyTab.colWidths.slice(0, expected.length)).toEqual(expected);
    expect(monthlyTab.frozen).toBe(1);
    expect(monthlyTab.frozenCols).toBe(2);
  });

  it('(g) typed roster data is untouched', async () => {
    const sheets = globalThis.__sheets;
    const existingRows = [
      ['Sl.', 'Name', 'Reg No.', 'Type (SD/SW)', 'Email', 'Phone', 'Attendance %', 'Status'],
      [1, 'Arjun Sharma', 'KAR/NCC/2026/101', 'SD', 'arjun@test.in', '9000000001', '85%', 'Active'],
      [2, 'Priya Nair', 'KAR/NCC/2026/102', 'SW', 'priya@test.in', '9000000002', '90%', 'Active'],
    ];

    sheets.addTab('Year 1', existingRows);

    await setupSheetTabs();

    const y1 = sheets.tab('Year 1');
    expect(y1.rows[1]).toEqual([1, 'Arjun Sharma', 'KAR/NCC/2026/101', 'SD', 'arjun@test.in', '9000000001', '85%', 'Active']);
    expect(y1.rows[2]).toEqual([2, 'Priya Nair', 'KAR/NCC/2026/102', 'SW', 'priya@test.in', '9000000002', '90%', 'Active']);
  });
});
