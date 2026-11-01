import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { FakeDB } from './helpers/fake-firestore.js';
import { resetPassword, lookupAccount } from '../lib/resetPassword.mjs';

describe('Password recovery script (lib/resetPassword.mjs)', () => {
  let db;

  beforeEach(async () => {
    db = new FakeDB();

    // Create initial accounts
    await db.collection('users').doc('admin_id').set({
      username: 'admin',
      email: 'admin@flightb.org',
      name: 'Admin Officer',
      role: 'admin',
      passwordHash: await bcrypt.hash('OldPassword123', 4),
      failedLogins: 4,
      lockedUntil: Date.now() + 600_000,
      mustChangePassword: false,
      tokenVersion: 1000,
    });

    await db.collection('users').doc('cadet_id').set({
      username: 'cadet1',
      regNo: 'KA/26/1001',
      email: 'cadet1@flightb.org',
      name: 'Cadet One',
      role: 'cadet',
      passwordHash: await bcrypt.hash('OldCadetPass1', 4),
      failedLogins: 0,
      lockedUntil: null,
      mustChangePassword: false,
      tokenVersion: 1000,
    });
  });

  it('successfully resets password by username, email, or regNo and clears lockouts', async () => {
    const newPass = 'FreshPassword2026';
    const res = await resetPassword(db, {
      identifier: 'admin',
      newPassword: newPass,
      yes: true,
    });

    expect(res.success).toBe(true);
    expect(res.user.name).toBe('Admin Officer');
    expect(res.user.role).toBe('admin');

    const adminDoc = (await db.collection('users').doc('admin_id').get()).data();
    expect(adminDoc.failedLogins).toBe(0);
    expect(adminDoc.lockedUntil).toBeNull();
    expect(adminDoc.mustChangePassword).toBe(true);
    expect(adminDoc.tokenVersion).toBeGreaterThan(1000);

    // Verify bcrypt hash works and matches cost 10
    expect(await bcrypt.compare(newPass, adminDoc.passwordHash)).toBe(true);
    expect(adminDoc.passwordHash.startsWith('$2a$10$') || adminDoc.passwordHash.startsWith('$2b$10$')).toBe(true);

    // Verify audit log entry
    const auditLogs = db.all('audit_log').map(d => d.data);
    const resetEntry = auditLogs.find(a => a.type === 'password-reset' && a.byName === 'recovery script');
    expect(resetEntry).toBeDefined();
    expect(resetEntry.userId).toBe('admin_id');

    // Test lookup by email (lower-case normalization)
    const resEmail = await resetPassword(db, {
      identifier: 'ADMIN@FLIGHTB.ORG',
      newPassword: 'AnotherStrongPass1',
      yes: true,
    });
    expect(resEmail.success).toBe(true);

    // Test lookup by regNo (upper-case normalization)
    const resReg = await resetPassword(db, {
      identifier: 'ka/26/1001',
      newPassword: 'CadetNewPassword99',
      yes: true,
    });
    expect(resReg.success).toBe(true);
    expect(resReg.user.name).toBe('Cadet One');
    expect(resReg.user.role).toBe('cadet');
  });

  it('refuses when the account is not found', async () => {
    await expect(resetPassword(db, {
      identifier: 'nonexistent_user',
      newPassword: 'Password12345',
      yes: true,
    })).rejects.toThrow(/not found/i);
  });

  it('refuses when several accounts match (ambiguous)', async () => {
    // Add two accounts that share an identifier across different fields
    await db.collection('users').doc('user_a').set({
      username: 'shared_key',
      name: 'User Alpha',
      role: 'marker',
    });
    await db.collection('users').doc('user_b').set({
      email: 'shared_key',
      name: 'User Beta',
      role: 'cadet',
    });

    await expect(resetPassword(db, {
      identifier: 'shared_key',
      newPassword: 'Password12345',
      yes: true,
    })).rejects.toThrow(/ambiguous|match/i);
  });

  it('refuses when new password is shorter than 8 characters', async () => {
    await expect(resetPassword(db, {
      identifier: 'admin',
      newPassword: 'short',
      yes: true,
    })).rejects.toThrow(/at least 8 characters/i);

    await expect(resetPassword(db, {
      identifier: 'admin',
      newPassword: '',
      yes: true,
    })).rejects.toThrow(/at least 8 characters/i);
  });

  it('requires --yes confirmation flag', async () => {
    await expect(resetPassword(db, {
      identifier: 'admin',
      newPassword: 'ValidPassword123',
      yes: false,
    })).rejects.toThrow(/--yes/i);
  });

  it('ensures no plaintext password is stored in the database or audit log', async () => {
    const rawPass = 'SecretPlaintextPassword_XYZ_987';
    await resetPassword(db, {
      identifier: 'admin',
      newPassword: rawPass,
      yes: true,
    });

    // Check user document
    const userDoc = (await db.collection('users').doc('admin_id').get()).data();
    const userValues = JSON.stringify(userDoc);
    expect(userValues.includes(rawPass)).toBe(false);

    // Check audit log document
    const auditLogs = db.all('audit_log').map(d => d.data);
    const auditValues = JSON.stringify(auditLogs);
    expect(auditValues.includes(rawPass)).toBe(false);
  });
});
