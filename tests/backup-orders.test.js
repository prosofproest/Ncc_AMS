import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { generateBackupWorkbook } from '@/lib/backup';
import { fmtDateTimeIST } from '@/lib/time';

describe('PART D: Backup Order and Submission Dates', () => {
  let workbook;

  beforeAll(async () => {
    // Mock users with diverse years, SD/SW types, Reg Nos, and left unit (graduated/discharged)
    const users = [
      { id: 'u_y1_sw_b', name: 'Bhavana SW', regNo: 'REG/102', year: 1, type: 'SW', role: 'cadet', isActive: true, discharged: false },
      { id: 'u_y1_sd_a', name: 'Aakash SD', regNo: 'REG/101', year: 1, type: 'SD', role: 'cadet', isActive: true, discharged: false },
      { id: 'u_y2_sd_c', name: 'Chirag SD', regNo: 'REG/201', year: 2, type: 'SD', role: 'cadet', isActive: true, discharged: false },
      // Left unit:
      { id: 'u_left_y1', name: 'Discharged Y1', regNo: 'REG/D01', year: 1, dischargedFromYear: 1, type: 'SD', role: 'cadet', isActive: false, discharged: true },
      { id: 'u_left_y3', name: 'Graduated Y3', regNo: 'REG/G01', year: 3, type: 'SD', role: 'cadet', isActive: false, graduatedAt: '2026-10-01' },
      { id: 'u_left_y3_2', name: 'Graduated Y3 2', regNo: 'REG/G02', year: 3, type: 'SW', role: 'cadet', isActive: false, graduatedAt: '2026-10-01' }
    ];

    // Mock sessions: Oct 10, and Oct 20 with two sessions on same day at different times
    const sessions = [
      {
        id: 'sess_oct_20_evening',
        date: '2026-10-20',
        cycle: 1,
        activityType: 'Parade',
        groupLabel: 'Year 1',
        years: [1],
        total: 2, present: 2, absent: 0,
        markedByName: 'Marker One',
        createdAt: '2026-10-20T14:00:00.000Z',
        approvedAt: '2026-10-20T15:00:00.000Z',
        approvals: {
          admin: { byName: 'Col. Admin' },
          cto: { byName: 'Maj. CTO' }
        }
      },
      {
        id: 'sess_oct_10_morning',
        date: '2026-10-10',
        cycle: 1,
        activityType: 'PT',
        groupLabel: 'Year 1 & 2',
        years: [1, 2],
        total: 3, present: 3, absent: 0,
        markedByName: 'Marker One',
        createdAt: '2026-10-10T06:00:00.000Z',
        approvedAt: '2026-10-10T07:00:00.000Z',
        approvals: {
          admin: { byName: 'Col. Admin' },
          cto: { byName: 'Maj. CTO' }
        }
      },
      {
        id: 'sess_oct_20_morning',
        date: '2026-10-20',
        cycle: 1,
        activityType: 'Drill',
        groupLabel: 'Year 1',
        years: [1],
        total: 2, present: 1, absent: 1,
        markedByName: 'Marker Two',
        createdAt: '2026-10-20T08:00:00.000Z',
        approvedAt: '2026-10-20T09:00:00.000Z',
        approvals: {
          admin: { byName: 'Col. Admin' },
          cto: { byName: 'Maj. CTO' }
        }
      }
    ];

    // Mock attendance records
    const attendance = [
      // For sess_oct_10_morning:
      { id: 'att_3', sessionId: 'sess_oct_10_morning', date: '2026-10-10', cadetId: 'u_y2_sd_c', cadetName: 'Chirag SD', cadetRegNo: 'REG/201', cadetYear: 2, cadetType: 'SD', status: 'Present', cycle: 1 },
      { id: 'att_2', sessionId: 'sess_oct_10_morning', date: '2026-10-10', cadetId: 'u_y1_sw_b', cadetName: 'Bhavana SW', cadetRegNo: 'REG/102', cadetYear: 1, cadetType: 'SW', status: 'Present', cycle: 1 },
      { id: 'att_1', sessionId: 'sess_oct_10_morning', date: '2026-10-10', cadetId: 'u_y1_sd_a', cadetName: 'Aakash SD', cadetRegNo: 'REG/101', cadetYear: 1, cadetType: 'SD', status: 'Present', cycle: 1 },
      // For sess_oct_20_morning:
      { id: 'att_4', sessionId: 'sess_oct_20_morning', date: '2026-10-20', cadetId: 'u_y1_sd_a', cadetName: 'Aakash SD', cadetRegNo: 'REG/101', cadetYear: 1, cadetType: 'SD', status: 'Present', cycle: 1 },
      { id: 'att_5', sessionId: 'sess_oct_20_morning', date: '2026-10-20', cadetId: 'u_y1_sw_b', cadetName: 'Bhavana SW', cadetRegNo: 'REG/102', cadetYear: 1, cadetType: 'SW', status: 'Absent', reason: 'Sick', cycle: 1 }
    ];

    const mockDb = {
      collection: (col) => ({
        get: async () => {
          if (col === 'sessions') return { docs: sessions.map(s => ({ id: s.id, data: () => s })) };
          if (col === 'users') return { docs: users.map(u => ({ id: u.id, data: () => u })) };
          if (col === 'attendance') return { docs: attendance.map(a => ({ id: a.id, data: () => a })) };
          if (col === 'benefits') return { docs: [] };
          if (col === 'audit_log') return { docs: [] };
          return { docs: [] };
        },
        orderBy: () => ({
          limit: () => ({
            get: async () => ({ docs: [] })
          })
        })
      })
    };

    const res = await generateBackupWorkbook({
      db: mockDb,
      settings: { currentCycle: 1, cycleLabel: '2026-2027', thresholdPct: 75 }
    });
    workbook = res.workbook;
  });

  it('Sessions sheet sorted by parade date ascending, then by submission time, with new columns', () => {
    const ws = workbook.getWorksheet('Sessions');
    expect(ws).toBeDefined();

    // Verify headers include the 4 new columns
    const headerValues = ws.getRow(1).values;
    expect(headerValues).toContain('Submitted At');
    expect(headerValues).toContain('Approved At');
    expect(headerValues).toContain('Approved By (Admin)');
    expect(headerValues).toContain('Approved By (CTO)');

    // Verify row ordering:
    // Row 2: sess_oct_10_morning
    // Row 3: sess_oct_20_morning (08:00 UTC)
    // Row 4: sess_oct_20_evening (14:00 UTC)
    const row2 = ws.getRow(2);
    const row3 = ws.getRow(3);
    const row4 = ws.getRow(4);

    expect(row2.getCell(1).value).toBe('sess_oct_10_morning');
    expect(row3.getCell(1).value).toBe('sess_oct_20_morning');
    expect(row4.getCell(1).value).toBe('sess_oct_20_evening');

    // Check approval values
    expect(row3.getCell(headerValues.indexOf('Approved By (Admin)')).value).toBe('Col. Admin');
    expect(row3.getCell(headerValues.indexOf('Approved By (CTO)')).value).toBe('Maj. CTO');
    expect(row3.getCell(headerValues.indexOf('Submitted At')).value).toMatch(/2026-10-20/);
  });

  it('Attendance sheet sorted by parade date, year, SD before SW, Reg No, with Submitted At column', () => {
    const ws = workbook.getWorksheet('Attendance');
    expect(ws).toBeDefined();

    const headerValues = ws.getRow(1).values;
    expect(headerValues).toContain('Submitted At');

    // On 2026-10-10:
    // Order: Year 1 SD (Aakash REG/101), Year 1 SW (Bhavana REG/102), Year 2 SD (Chirag REG/201)
    const r2 = ws.getRow(2);
    const r3 = ws.getRow(3);
    const r4 = ws.getRow(4);

    expect(r2.getCell(4).value).toBe('Aakash SD');
    expect(r3.getCell(4).value).toBe('Bhavana SW');
    expect(r4.getCell(4).value).toBe('Chirag SD');

    // Submitted At populated from session's createdAt
    expect(r2.getCell(headerValues.indexOf('Submitted At')).value).toBe('2026-10-10T06:00:00.000Z');
  });

  it('Cadets sheet sorted Year, SD before SW, Reg No; ID in LAST column; Left unit sorted last year then Reg No', () => {
    const ws = workbook.getWorksheet('Cadets');
    expect(ws).toBeDefined();

    const headerValues = ws.getRow(1).values;
    const lastColIndex = headerValues.length - 1;
    expect(headerValues[lastColIndex]).toBe('ID');

    // Cadets: Year 1 SD (Aakash), Year 1 SD (Discharged Y1), Year 1 SW (Bhavana), Year 2 SD (Chirag)
    expect(ws.getRow(2).getCell(2).value).toBe('Aakash SD');
    expect(ws.getRow(3).getCell(2).value).toBe('Discharged Y1');
    expect(ws.getRow(4).getCell(2).value).toBe('Bhavana SW');
    expect(ws.getRow(5).getCell(2).value).toBe('Chirag SD');

    // ID is in last column
    expect(ws.getRow(2).getCell(lastColIndex).value).toBe('u_y1_sd_a');

    // Left unit sheet
    const wsLeft = workbook.getWorksheet('Left unit');
    expect(wsLeft).toBeDefined();

    // Sorted by last year then Reg No:
    // Row 2: Year 1 (Discharged Y1, REG/D01)
    // Row 3: Year 3 (Graduated Y3, REG/G01)
    // Row 4: Year 3 (Graduated Y3 2, REG/G02)
    expect(wsLeft.getRow(2).getCell(2).value).toBe('Discharged Y1');
    expect(wsLeft.getRow(3).getCell(2).value).toBe('Graduated Y3');
    expect(wsLeft.getRow(4).getCell(2).value).toBe('Graduated Y3 2');
  });

  it('Year sheets include submission time in date header note ("Submitted <date time IST>")', () => {
    const wsY1 = workbook.getWorksheet('Year 1');
    expect(wsY1).toBeDefined();

    const headerRow = wsY1.getRow(1);
    // Find a date header cell
    let noteFound = false;
    headerRow.eachCell(cell => {
      if (cell.note && typeof cell.note === 'string' && cell.note.includes('Submitted')) {
        noteFound = true;
        expect(cell.note).toMatch(/Submitted \d{1,2} \w{3} \d{4}, \d{2}:\d{2} IST/);
      }
    });
    expect(noteFound).toBe(true);
  });
});
