import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { call, flushBg } from './helpers/http.js';
import { DEFAULT_MAIL_ROUTING, officialRecipients, getSettings } from '@/lib/settings';
import { sendParadeReport, sendChangeLog, sendPeriodSummary, sendBackupEmail } from '@/lib/email';
import * as setR from '@/app/api/settings/route';
import * as loginR from '@/app/api/auth/login/route';

const db = globalThis.__db;

describe('PART C: Mail Routing Settings', () => {
  let adminCookie;

  beforeAll(async () => {
    const pw = await bcrypt.hash('Admin@123', 4);
    await db.collection('users').doc('admin_mail').set({
      name: 'Admin Mail',
      role: 'admin',
      username: 'adminmail',
      passwordHash: pw,
      email: 'adminmail@test.in',
      isActive: true,
      permissions: { canManageSettings: true }
    });
    const loginRes = await call(loginR.POST, { method: 'POST', body: { identifier: 'adminmail', password: 'Admin@123' } });
    adminCookie = loginRes.cookie;
  });

  it('defaults: DEFAULT_MAIL_ROUTING shape and migration for documents without mailRouting', async () => {
    expect(DEFAULT_MAIL_ROUTING).toEqual({
      parade: { sir: true, backup: true },
      changes: { sir: true, backup: true },
      weekly: { sir: true, backup: true },
      monthly: { sir: true, backup: true },
      backup: { sir: false, backup: true }
    });

    // Doc without mailRouting gets defaults
    await db.collection('settings').doc('main').set({
      sirEmail: 'sir@test.in',
      backupEmail: 'backup@test.in'
    });
    const s = await getSettings({ fresh: true });
    expect(s.mailRouting).toEqual(DEFAULT_MAIL_ROUTING);
  });

  it('officialRecipients: each kind honours its ticks and deduplicates addresses', () => {
    const settings = {
      sirEmail: 'sir@test.in',
      backupEmail: 'backup@test.in',
      mailRouting: {
        parade: { sir: true, backup: false },
        changes: { sir: false, backup: true },
        weekly: { sir: true, backup: true },
        monthly: { sir: false, backup: false },
        backup: { sir: false, backup: true }
      }
    };

    expect(officialRecipients(settings, 'parade')).toEqual(['sir@test.in']);
    expect(officialRecipients(settings, 'changes')).toEqual(['backup@test.in']);
    expect(officialRecipients(settings, 'weekly')).toEqual(['sir@test.in', 'backup@test.in']);
    expect(officialRecipients(settings, 'monthly')).toEqual([]);
  });

  it('backup mail never goes to Sir even if stored setting says so', () => {
    const badSetting = {
      sirEmail: 'sir@test.in',
      backupEmail: 'backup@test.in',
      mailRouting: {
        backup: { sir: true, backup: true }
      }
    };
    expect(officialRecipients(badSetting, 'backup')).toEqual(['backup@test.in']);
  });

  it('empty routing skips send and logs warning event "no recipient for <kind>"', async () => {
    globalThis.__mail.length = 0;
    const settings = {
      sirEmail: 'sir@test.in',
      backupEmail: 'backup@test.in',
      mailRouting: {
        parade: { sir: false, backup: false },
        changes: { sir: false, backup: false },
        weekly: { sir: false, backup: false },
        monthly: { sir: false, backup: false },
        backup: { sir: false, backup: false }
      }
    };
    await db.collection('settings').doc('main').set(settings);

    // Test sendParadeReport
    const r1 = await sendParadeReport({
      reportSession: { id: 's1', date: '2026-11-04', activityType: 'Parade', groupLabel: 'Year 1', total: 10, present: 10, absent: 0 },
      records: [],
      absentees: [],
      photoUrls: []
    });
    expect(r1.skipped).toBeTruthy();
    expect(globalThis.__mail.length).toBe(0);

    // Test sendChangeLog
    const r2 = await sendChangeLog({
      kind: 'edit',
      byName: 'Admin',
      reportSession: { id: 's1', date: '2026-11-04' },
      changes: []
    });
    expect(r2.skipped).toBeTruthy();
    expect(globalThis.__mail.length).toBe(0);

    // Test sendBackupEmail
    const r3 = await sendBackupEmail({
      buffer: Buffer.from('data'),
      filename: 'backup.xlsx'
    });
    expect(r3.skipped).toBeTruthy();
    expect(globalThis.__mail.length).toBe(0);

    // Check warning events were logged
    const events = db.all('system_events').map(e => e.data);
    expect(events.some(e => e.message === 'no recipient for parade')).toBe(true);
    expect(events.some(e => e.message === 'no recipient for changes')).toBe(true);
    expect(events.some(e => e.message === 'no recipient for backup')).toBe(true);
  });

  it('settings PUT validates mailRouting shape and forces backup.sir to false', async () => {
    // Bad shape: not an object
    const bad1 = await call(setR.PUT, {
      method: 'PUT',
      cookie: adminCookie,
      body: { mailRouting: 'invalid' }
    });
    expect(bad1.status).toBe(400);

    // Bad shape: missing key or non-boolean
    const bad2 = await call(setR.PUT, {
      method: 'PUT',
      cookie: adminCookie,
      body: { mailRouting: { parade: { sir: 'yes' } } }
    });
    expect(bad2.status).toBe(400);

    // Valid shape, tries to set backup.sir = true -> backend forces backup.sir = false
    const ok = await call(setR.PUT, {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        mailRouting: {
          parade: { sir: true, backup: true },
          changes: { sir: true, backup: false },
          weekly: { sir: false, backup: true },
          monthly: { sir: true, backup: true },
          backup: { sir: true, backup: true }
        }
      }
    });
    expect(ok.status).toBe(200);
    expect(ok.json.settings.mailRouting.backup.sir).toBe(false);
    expect(ok.json.settings.mailRouting.changes.backup).toBe(false);
    expect(ok.json.settings.mailRouting.weekly.sir).toBe(false);
  });
});
