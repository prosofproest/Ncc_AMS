import { describe, it, expect } from 'vitest';
import { readCadetsFromSheet } from '@/lib/sheets';
const sheets = globalThis.__sheets;

describe('older sectioned sheet layout is still understood', () => {
  it('reads SD/SW sections, skips titles, blanks and placeholder rows', async () => {
    const legacy = [
      ['── SD ──'], ['Sl.', 'Name', 'Reg No.', 'Type', 'Year', 'Attendance %'],
      [1, 'Asha Kini', 'KAR/NCC/2026/501', 'SD', 1], [2, 'Bharath Rao', '', 'SD', 1], [],
      ['── SW ──'], ['Sl.', 'Name', 'Reg No.', 'Type', 'Year', 'Attendance %'],
      [1, 'Chaitra Shetty', 'KAR/NCC/2026/502', 'SW', 1], [2, '(Example) Sample Cadet', '', '', ''], ['No SW cadets'],
    ];
    sheets.addTab('Year 1', legacy); sheets.addTab('Year 2', [['Sl.', 'Name', 'Reg No.', 'Type (SD/SW)', 'Email'], [1, 'Dinesh Pai', ' kar/ncc/2025/601 ', 'sw', 'Dinesh@Test.IN ']]);
    sheets.addTab('Year 3', []); sheets.addTab('Archive', [['Sl.', 'Name', 'Reg No.'], [1, 'Sgt Eshwar', 'KAR/S/1']]);
    const r = await readCadetsFromSheet();
    expect(r.success).toBe(true);
    expect(r.cadets.map(c => [c.name, c.regNo, c.year, c.type, c.role])).toEqual([
      ['Asha Kini', 'KAR/NCC/2026/501', 1, 'SD', 'cadet'], ['Bharath Rao', null, 1, 'SD', 'cadet'], ['Chaitra Shetty', 'KAR/NCC/2026/502', 1, 'SW', 'cadet'],
      ['Dinesh Pai', 'KAR/NCC/2025/601', 2, 'SW', 'cadet']]);
    expect(r.cadets.find(c => c.name === 'Dinesh Pai').email).toBe('dinesh@test.in');       // trimmed + lower-cased
    expect(sheets.tab('Archive')).toBeDefined(); // old tab is left untouched
  });
});
