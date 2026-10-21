import { describe, it, expect } from 'vitest';
import { migrateLegacy } from '@/lib/migrate.mjs';
const db = globalThis.__db;

describe('upgrade from the old data structure', () => {
  it('builds sessions, converts Leave, rebuilds counters, and is safe to run twice', async () => {
    await db.collection('users').doc('c1').set({ name: 'A', role: 'cadet', year: 1, isActive: true });
    await db.collection('users').doc('c2').set({ name: 'B', role: 'cadet', year: 2, isActive: true, benefit: 2 });
    await db.collection('users').doc('adm').set({ name: 'Adm', role: 'admin', isActive: true });
    const old = (id, d) => db.collection('attendance').doc(id).set({ activityType: 'Parade', activityDescription: 'Drill', markedBy: 'u1', markedByName: 'Rohan', photoUrls: ['https://x/a.jpg'], updatedAt: '2026-09-01T10:00:00Z', ...d });
    await old('2026-09-01_c1', { date: '2026-09-01', cadetId: 'c1', cadetName: 'A', cadetYear: 1, cadetRole: 'cadet', status: 'Present' });
    await old('2026-09-01_c2', { date: '2026-09-01', cadetId: 'c2', cadetName: 'B', cadetYear: 2, cadetRole: 'cadet', status: 'Leave', remarks: 'Exam', permissionTaken: true });
    await old('2026-09-08_c1', { date: '2026-09-08', cadetId: 'c1', cadetName: 'A', cadetYear: 1, cadetRole: 'cadet', status: 'Absent', remarks: 'Fever' });
    const dry = await migrateLegacy(db, { dryRun: true });
    expect(dry).toMatchObject({ sessionsCreated: 2, recordsUpdated: 3, usersUpdated: 2, leaveConverted: 1, dryRun: true });
    expect(db.all('sessions').length).toBe(0);                                                  // dry run changes nothing
    const r = await migrateLegacy(db);
    expect(r).toMatchObject({ sessionsCreated: 2, recordsUpdated: 3 });
    const s1 = db.all('sessions').map(s => s.data).find(s => s.date === '2026-09-01');
    expect(s1).toMatchObject({ total: 2, present: 1, absent: 1, groupLabel: 'Year 1 & 2', markedByName: 'Rohan', cycle: 1, legacy: true });
    expect(db.docs.get('attendance/2026-09-01_c2')).toMatchObject({ status: 'Absent', reason: 'Exam', cycle: 1 });
    expect(db.docs.get('attendance/2026-09-08_c1')).toMatchObject({ status: 'Absent', reason: 'Fever' });
    expect(db.docs.get('users/c1').stats).toEqual({ total: 2, present: 1, absent: 1, months: { m202609: { t: 2, p: 1 } } });
    expect(db.docs.get('users/c2')).toMatchObject({ benefit: 2, stats: { total: 1, present: 0, absent: 1 } });
    expect(db.docs.get('users/adm').stats).toBeUndefined();                                      // admins untouched
    expect(db.docs.get('settings/main').currentCycle).toBe(1);
    const again = await migrateLegacy(db);
    expect(again.sessionsCreated).toBe(0); expect(db.all('sessions').length).toBe(2);           // idempotent
    expect(db.docs.get('users/c1').stats.total).toBe(2);
  });
});
