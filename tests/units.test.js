import { describe, it, expect } from 'vitest';
import { groupLabel, summarize, byYear, personOrder } from '@/lib/groups';
import { readStats } from '@/lib/stats';
import { fmtDate, fmtDateLong, academicLabel, prevMonthKey, isValidDate, monthKeyOf } from '@/lib/time';
import { shell, esc } from '@/lib/email-theme';
import { buildParadeReportPdf, ascii } from '@/lib/pdf';
import { sendParadeReport, sendAbsenceNotices } from '@/lib/email';
import { summariesDue, weekRange } from '@/lib/summary';

describe('year-group labels — every possible combination', () => {
  const cases = [
    [[1], 'Year 1'],
    [[2], 'Year 2'],
    [[3], 'Year 3'],
    [[1, 2], 'Year 1 & 2'],
    [[2, 3], 'Year 2 & 3'],
    [[1, 3], 'Year 1 & 3'],
    [[3, 1], 'Year 1 & 3'],
    [[1, 2, 3], 'All Years'],
    [[], 'No group'],
    [[1, 1, 7], 'Year 1']
  ];
  cases.forEach(([y, e]) => it(`${JSON.stringify(y)} → ${e}`, () => expect(groupLabel(y)).toBe(e)));
});
describe('percentages', () => {
  it('benefit credits count as present but never push above 100%', () => {
    expect(readStats({ stats: { total: 10, present: 7, absent: 3 }, benefit: 2 }).pct).toBe(90);
    expect(readStats({ stats: { total: 4, present: 4, absent: 0 }, benefit: 5 }).pct).toBe(100);
    expect(readStats({ stats: { total: 0 } }).pct).toBe(null);
    expect(readStats({}).pct).toBe(null);
    expect(readStats({ stats: { total: 3, present: 1, absent: 2 }, benefit: -4 }).pct).toBe(33.3);   // a corrupted negative benefit is ignored
  });
  it('summaries and year breakdown', () => {
    const recs = [{ status: 'Present', cadetYear: 1 }, { status: 'Absent', cadetYear: 1 }, { status: 'Leave', cadetYear: 2 }, { status: 'Present', cadetYear: 3 }];
    expect(summarize(recs)).toMatchObject({ total: 4, present: 2, absent: 2, pct: 50 });
    expect(byYear(recs).map(r => r.label)).toEqual(['Year 1', 'Year 2', 'Year 3']);
  });
  it('roster ordering: year, then SD before SW, then Reg No.', () => {
    const l = [{ cadetYear: 2, cadetType: 'SD', cadetRegNo: 'B' }, { cadetYear: 1, cadetType: 'SW', cadetRegNo: 'A' }, { cadetYear: 1, cadetType: 'SD', cadetRegNo: 'Z10' }, { cadetYear: 1, cadetType: 'SD', cadetRegNo: 'Z9' }];
    expect(l.sort(personOrder).map(x => x.cadetRegNo)).toEqual(['Z9', 'Z10', 'A', 'B']);
  });
});
describe('dates (IST strings)', () => {
  it('formats and validates', () => {
    expect(fmtDate('2026-10-13')).toBe('13 Oct 2026'); expect(fmtDateLong('2026-10-13')).toBe('Tuesday, 13 October 2026');
    expect(isValidDate('2026-02-30')).toBe(false); expect(isValidDate('2026-02-28')).toBe(true); expect(isValidDate('13-10-2026')).toBe(false);
    expect(academicLabel('2026-10-13')).toBe('2026-27'); expect(academicLabel('2027-03-01')).toBe('2026-27'); expect(academicLabel('2027-06-01')).toBe('2027-28');
    expect(prevMonthKey('2026-01-05')).toBe('2025-12'); expect(prevMonthKey('2026-10-01')).toBe('2026-09'); expect(monthKeyOf('2026-10-13')).toBe('m202610');
  });
});
describe('safety: user-typed text can never break an email or a PDF', () => {
  const evil = '<img src=x onerror=alert(1)> & "quoted" \'single\'';
  it('html-escapes names and reasons in every email', async () => {
    const session = { date: '2026-10-13', activityType: 'Parade', activityDescription: evil, groupLabel: 'Year 1', markedByName: evil, createdAt: new Date().toISOString() };
    const rec = [{ cadetId: 'x', cadetName: evil, cadetRegNo: evil, cadetYear: 1, cadetType: 'SD', status: 'Absent', reason: evil }];
    globalThis.__mail.length = 0;
    await sendParadeReport({ session, records: rec, settings: { sirEmail: 'a@b.in', thresholdPct: 75 } });
    await sendAbsenceNotices({ session, absentRecords: rec, usersById: { x: { email: 'x@y.in', stats: { total: 1, present: 0 } } }, settings: { absenceMailEnabled: true, thresholdPct: 75 } });
    for (const m of globalThis.__mail) { expect(m.html).not.toContain('<img src=x'); expect(m.html).toContain('&lt;img src=x'); }
    expect(globalThis.__mail.length).toBe(2);
  });
  it('PDF copes with odd characters and long names (no crash, no overflow pages)', async () => {
    const recs = Array.from({ length: 5 }, (_, i) => ({ cadetId: 'i' + i, cadetName: ['Ravi Shankar Ñandi 🙂', 'ಕನ್ನಡ Name', 'A'.repeat(90), "O'Brien \"Sir\"", 'Zoë Ångström'][i], cadetRegNo: 'KAR/NCC/2026/' + i, cadetYear: 1, cadetType: 'SD', status: i % 2 ? 'Absent' : 'Present', reason: i % 2 ? 'R'.repeat(120) : '' }));
    const pdf = await buildParadeReportPdf({ session: { date: '2026-10-13', activityType: 'Parade', groupLabel: 'Year 1', markedByName: 'M' }, records: recs });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(ascii('Zoë Ångström 🙂')).toBe('Zoe Angstrom ');
    const pages = (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length; expect(pages).toBe(1);
  });
  it('email shell carries the unit identity and mobile viewport', () => {
    const h = shell({ eyebrow: 'E', title: 'T', body: 'b' });
    expect(h).toContain('NCC AIRWING'); expect(h).toContain('FLIGHT-B'); expect(h).toContain('6 KAR AIR SQN NCC'); expect(h).toContain('viewport'); expect(h).toContain('@media (max-width:520px)');
  });
});

describe('the single nightly job decides which summaries are due (keeps Vercel to one cron job)', () => {
  it('weekly on Monday, monthly on the 1st, nothing otherwise', () => {
    expect(summariesDue('2026-10-19')).toEqual({ weekly: true, monthly: false });     // Monday
    expect(summariesDue('2026-11-01')).toEqual({ weekly: false, monthly: true });     // Sunday the 1st
    expect(summariesDue('2026-06-01')).toEqual({ weekly: true, monthly: true });      // Monday the 1st → both
    expect(summariesDue('2026-10-13')).toEqual({ weekly: false, monthly: false });    // Tuesday
  });
  it('the weekly digest always covers the previous Monday to Sunday', () => {
    expect(weekRange('2026-10-19')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(weekRange('2026-10-21')).toEqual({ from: '2026-10-12', to: '2026-10-18' });   // run mid-week by hand
    expect(weekRange('2027-01-04')).toEqual({ from: '2026-12-28', to: '2027-01-03' });   // across the new year
  });
});
