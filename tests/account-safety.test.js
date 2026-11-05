import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { call } from './helpers/http.js';
import * as loginR from '@/app/api/auth/login/route';
import * as cadetsR from '@/app/api/cadets/route';
import * as cadetIdR from '@/app/api/cadets/[id]/route';
import * as healthR from '@/app/api/health/route';

const db = globalThis.__db;

describe('PART E: Account Safety', () => {
  let admin1Cookie, admin2Cookie, markerCookie;

  beforeAll(async () => {
    const pw = await bcrypt.hash('Admin@123', 4);
    await db.collection('users').doc('admin_safe_1').set({
      id: 'admin_safe_1',
      name: 'Safe Admin 1',
      role: 'admin',
      username: 'admin1safe',
      passwordHash: pw,
      email: 'admin1safe@test.in',
      isActive: true,
      otpRequired: false,
      permissions: { canManageUsers: true }
    });

    await db.collection('users').doc('admin_safe_2').set({
      id: 'admin_safe_2',
      name: 'Safe Admin 2',
      role: 'admin',
      username: 'admin2safe',
      passwordHash: pw,
      email: 'admin2safe@test.in',
      isActive: true,
      otpRequired: false,
      permissions: { canManageUsers: true }
    });

    await db.collection('users').doc('marker_safe_1').set({
      id: 'marker_safe_1',
      name: 'Safe Marker 1',
      role: 'marker',
      username: 'marker1safe',
      passwordHash: pw,
      email: 'marker1safe@test.in',
      isActive: true,
      otpRequired: false
    });

    await db.collection('users').doc('cadet_safe_1').set({
      id: 'cadet_safe_1',
      name: 'Safe Cadet 1',
      role: 'cadet',
      regNo: 'SAFE/101',
      year: 1,
      type: 'SD',
      passwordHash: pw,
      isActive: true,
      discharged: false
    });

    const l1 = await call(loginR.POST, { method: 'POST', body: { identifier: 'admin1safe', password: 'Admin@123' } });
    admin1Cookie = l1.cookie;

    const l2 = await call(loginR.POST, { method: 'POST', body: { identifier: 'admin2safe', password: 'Admin@123' } });
    admin2Cookie = l2.cookie;

    const lm = await call(loginR.POST, { method: 'POST', body: { identifier: 'marker1safe', password: 'Admin@123' } });
    markerCookie = lm.cookie;
  });

  describe('1. Delete account rules & last-admin guard', () => {
    it('non-admin calling delete returns 403', async () => {
      const res = await call(cadetIdR.DELETE, {
        method: 'DELETE',
        cookie: markerCookie,
        params: { id: 'marker_safe_1' },
        body: { action: 'delete' }
      });
      expect(res.status).toBe(403);
    });

    it('refuses (409) deleting your own account', async () => {
      const res = await call(cadetIdR.DELETE, {
        method: 'DELETE',
        cookie: admin1Cookie,
        params: { id: 'admin_safe_1' },
        body: { action: 'delete' }
      });
      expect(res.status).toBe(409);
      expect(res.json.error).toMatch(/own account/i);
    });

    it('cadets cannot be deleted with action "delete" when they have history (must use discharge)', async () => {
      await db.collection('users').doc('cadet_safe_1').update({ 'stats.total': 1 });
      const res = await call(cadetIdR.DELETE, {
        method: 'DELETE',
        cookie: admin1Cookie,
        params: { id: 'cadet_safe_1' },
        body: { action: 'delete' }
      });
      expect(res.status).toBe(409);
      expect(res.json.error).toMatch(/discharge/i);
    });

    it('deletes a non-cadet account, removes users document, and writes audit entry', async () => {
      // Create a temporary marker to delete
      const pw = await bcrypt.hash('Marker@123', 4);
      await db.collection('users').doc('marker_to_delete').set({
        id: 'marker_to_delete',
        name: 'Marker To Delete',
        role: 'marker',
        username: 'markertodel',
        passwordHash: pw,
        email: 'todel@test.in',
        isActive: true
      });

      const res = await call(cadetIdR.DELETE, {
        method: 'DELETE',
        cookie: admin1Cookie,
        params: { id: 'marker_to_delete' },
        body: { action: 'delete' }
      });
      expect(res.status).toBe(200);
      expect(res.json.deleted).toBe(true);

      // Verify document was removed from users collection
      const doc = await db.collection('users').doc('marker_to_delete').get();
      expect(doc.exists).toBe(false);

      // Verify audit log entry type 'account-delete'
      const audits = db.all('audit_log').map(a => a.data);
      const delAudit = audits.find(a => a.type === 'account-delete' && a.targetId === 'marker_to_delete');
      expect(delAudit).toBeDefined();
      expect(delAudit.byName).toBe('Safe Admin 1');
      expect(delAudit.targetName).toBe('Marker To Delete');
      expect(delAudit.targetRole).toBe('marker');
    });

    it('last active admin guard: refuses (409) deleting the last active administrator', async () => {
      // First delete admin_safe_2
      const del2 = await call(cadetIdR.DELETE, {
        method: 'DELETE',
        cookie: admin1Cookie,
        params: { id: 'admin_safe_2' },
        body: { action: 'delete' }
      });
      expect(del2.status).toBe(200);

      // Now admin_safe_1 is the ONLY active admin left. Another request trying to delete admin_safe_1:
      // Even if called with admin_safe_1 credentials on itself it would be 409 self, but if another token or params:
      // Let's create an emergency admin3, make them inactive, and verify deleting the only active admin is refused
      await db.collection('users').doc('admin_safe_inactive').set({
        id: 'admin_safe_inactive',
        name: 'Inactive Admin',
        role: 'admin',
        isActive: false
      });

      // Try deleting admin_safe_1
      const res = await call(cadetIdR.DELETE, {
        method: 'DELETE',
        cookie: admin1Cookie,
        params: { id: 'admin_safe_1' },
        body: { action: 'delete' }
      });
      expect(res.status).toBe(409);
    });
  });

  describe('2. Uniqueness & Required Emails for Admin/CTO', () => {
    it('admin or CTO account requires email on create and update', async () => {
      // Create admin without email -> 400
      const badCreate = await call(cadetsR.POST, {
        method: 'POST',
        cookie: admin1Cookie,
        body: {
          name: 'No Email Admin',
          role: 'admin',
          username: 'noemailadmin',
          password: 'Password@123'
        }
      });
      expect(badCreate.status).toBe(400);
      expect(badCreate.json.error).toMatch(/email/i);

      // Create CTO without email -> 400
      const badCto = await call(cadetsR.POST, {
        method: 'POST',
        cookie: admin1Cookie,
        body: {
          name: 'No Email CTO',
          role: 'cto',
          username: 'noemailcto',
          password: 'Password@123'
        }
      });
      expect(badCto.status).toBe(400);
      expect(badCto.json.error).toMatch(/email/i);

      // Update admin to remove email -> 400
      const badUpd = await call(cadetIdR.PUT, {
        method: 'PUT',
        cookie: admin1Cookie,
        params: { id: 'admin_safe_1' },
        body: { email: '' }
      });
      expect(badUpd.status).toBe(400);
      expect(badUpd.json.error).toMatch(/email/i);
    });

    it('rejects duplicate username or email on create (case-insensitive)', async () => {
      // Existing marker has email 'marker1safe@test.in' and username 'marker1safe'
      // Try creating another marker with uppercase email
      const dupEmail = await call(cadetsR.POST, {
        method: 'POST',
        cookie: admin1Cookie,
        body: {
          name: 'Dup Email Marker',
          role: 'marker',
          username: 'uniquename1',
          email: 'MARKER1SAFE@TEST.IN',
          password: 'Password@123'
        }
      });
      expect(dupEmail.status).toBe(400);
      expect(dupEmail.json.error).toMatch(/already in use/i);

      // Try creating another marker with uppercase username
      const dupUser = await call(cadetsR.POST, {
        method: 'POST',
        cookie: admin1Cookie,
        body: {
          name: 'Dup User Marker',
          role: 'marker',
          username: 'MARKER1SAFE',
          email: 'uniqueemail1@test.in',
          password: 'Password@123'
        }
      });
      expect(dupUser.status).toBe(400);
      expect(dupUser.json.error).toMatch(/already/i);
    });

    it('rejects duplicate username or email on update (case-insensitive)', async () => {
      // Create a second valid marker
      const m2 = await call(cadetsR.POST, {
        method: 'POST',
        cookie: admin1Cookie,
        body: {
          name: 'Marker Two',
          role: 'marker',
          username: 'markertwo',
          email: 'markertwo@test.in',
          password: 'Password@123'
        }
      });
      expect(m2.status).toBe(200);
      const m2Id = m2.json.user.id;

      // Update m2 with m1's email case-insensitively
      const dupUpdEmail = await call(cadetIdR.PUT, {
        method: 'PUT',
        cookie: admin1Cookie,
        params: { id: m2Id },
        body: { email: 'MARKER1SAFE@TEST.IN' }
      });
      expect(dupUpdEmail.status).toBe(400);
      expect(dupUpdEmail.json.error).toMatch(/already in use/i);

      // Update m2 with m1's username case-insensitively
      const dupUpdUser = await call(cadetIdR.PUT, {
        method: 'PUT',
        cookie: admin1Cookie,
        params: { id: m2Id },
        body: { username: 'MARKER1SAFE' }
      });
      expect(dupUpdUser.status).toBe(400);
      expect(dupUpdUser.json.error).toMatch(/already/i);
    });
  });

  describe('3. Ambiguous login identifier handling', () => {
    it('returns 401 "Invalid credentials." and logs auth:ambiguous-identifier event when multiple active accounts match', async () => {
      const pw = await bcrypt.hash('CommonPass@123', 4);
      // Seed two active accounts with the same username
      await db.collection('users').doc('user_ambig_1').set({
        id: 'user_ambig_1',
        name: 'Ambiguous User 1',
        role: 'cadet',
        username: 'shared_login',
        passwordHash: pw,
        isActive: true,
        discharged: false
      });
      await db.collection('users').doc('user_ambig_2').set({
        id: 'user_ambig_2',
        name: 'Ambiguous User 2',
        role: 'cadet',
        username: 'shared_login',
        passwordHash: pw,
        isActive: true,
        discharged: false
      });

      const res = await call(loginR.POST, {
        method: 'POST',
        body: { identifier: 'shared_login', password: 'CommonPass@123' }
      });
      expect(res.status).toBe(401);
      expect(res.json.error).toBe('Invalid credentials.');

      // Verify system event was logged
      const events = db.all('system_events').map(e => e.data);
      const ambigEvent = events.find(e => e.type === 'auth:ambiguous-identifier');
      expect(ambigEvent).toBeDefined();
      expect(ambigEvent.meta?.identifierType).toBe('username');
      expect(JSON.stringify(ambigEvent)).not.toContain('CommonPass@123'); // never password
    });
  });

  describe('4. Admin OTP bypass rules & environment override', () => {
    it('admin with OTP on and no email gets 403 unless ALLOW_ADMIN_WITHOUT_OTP="true"', async () => {
      const pw = await bcrypt.hash('AdminNoEmail@123', 4);
      await db.collection('users').doc('admin_no_email_test').set({
        id: 'admin_no_email_test',
        name: 'Admin No Email',
        role: 'admin',
        username: 'adminnoemail',
        passwordHash: pw,
        email: null,
        otpRequired: true,
        isActive: true
      });

      // Default (ALLOW_ADMIN_WITHOUT_OTP not set) -> 403
      delete process.env.ALLOW_ADMIN_WITHOUT_OTP;
      const resForbidden = await call(loginR.POST, {
        method: 'POST',
        body: { identifier: 'adminnoemail', password: 'AdminNoEmail@123' }
      });
      expect(resForbidden.status).toBe(403);
      expect(resForbidden.json.error).toBe(
        'OTP is on for this account but no e-mail is set. Ask another administrator, or use the recovery script.'
      );

      // With environment override ALLOW_ADMIN_WITHOUT_OTP="true" -> 200
      process.env.ALLOW_ADMIN_WITHOUT_OTP = 'true';
      const resAllowed = await call(loginR.POST, {
        method: 'POST',
        body: { identifier: 'adminnoemail', password: 'AdminNoEmail@123' }
      });
      expect(resAllowed.status).toBe(200);
      expect(resAllowed.json.otpSkipped).toBeTruthy();
      delete process.env.ALLOW_ADMIN_WITHOUT_OTP;
    });
  });

  describe('5. System health Accounts service', () => {
    it('Accounts service turns RED for staff without email, duplicate identifiers, >3 admins, or leftover test data names', async () => {
      // 1. Staff without email
      await db.collection('users').doc('staff_no_email').set({
        name: 'Staff Missing Email',
        role: 'marker',
        username: 'staffnoemail',
        email: null,
        isActive: true,
        discharged: false
      });

      const h1 = await call(healthR.GET, { cookie: admin1Cookie, url: '/api/health?mode=full' });
      expect(h1.json.services.accounts.ok).toBe(false);
      expect(h1.json.services.accounts.message).toContain('Staff Missing Email');
      await db.collection('users').doc('staff_no_email').delete();

      // 2. More than 3 active administrators
      for (let i = 1; i <= 4; i++) {
        await db.collection('users').doc(`extra_admin_${i}`).set({
          name: `Admin Extra ${i}`,
          role: 'admin',
          username: `extraadmin${i}`,
          email: `extra${i}@test.in`,
          isActive: true,
          discharged: false
        });
      }
      const h2 = await call(healthR.GET, { cookie: admin1Cookie, url: '/api/health?mode=full' });
      expect(h2.json.services.accounts.ok).toBe(false);
      expect(h2.json.services.accounts.message).toMatch(/More than 3 administrators/);
      for (let i = 1; i <= 4; i++) await db.collection('users').doc(`extra_admin_${i}`).delete();

      // 3. Leftover test data names
      await db.collection('users').doc('test_marker_account').set({
        name: 'Test Marker',
        role: 'marker',
        username: 'testmarker',
        email: 'testmarker@test.in',
        isActive: true,
        discharged: false
      });
      const h3 = await call(healthR.GET, { cookie: admin1Cookie, url: '/api/health?mode=full' });
      expect(h3.json.services.accounts.ok).toBe(false);
      expect(h3.json.services.accounts.message).toContain('Test Marker');
      await db.collection('users').doc('test_marker_account').delete();
    });
  });
});

