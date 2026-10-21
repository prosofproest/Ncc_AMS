// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { call, flushBg } from './helpers/http.js';
import { installBrowser, jar } from './helpers/browser.js';
import * as loginR from '@/app/api/auth/login/route';
import * as photoR from '@/app/api/attendance/upload-photo/route';
import * as settingsR from '@/app/api/settings/route';
import * as metaR from '@/app/api/meta/route';
import * as attR from '@/app/api/attendance/route';
import * as apprR from '@/app/api/approvals/route';
import * as healthR from '@/app/api/health/route';
import { sendParadeReport } from '@/lib/email';
import { defaultSettings } from '@/lib/settings';
import { todayIST } from '@/lib/time';

vi.mock('jose', async () => {
  const c = await import('node:crypto');
  const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const mac = (data, key) => c.createHmac('sha256', Buffer.from(key)).update(data).digest('base64url');
  class SignJWT { constructor(p) { this.p = { ...p }; } setProtectedHeader() { return this; } setIssuedAt() { this.p.iat = Math.floor(Date.now() / 1000); return this; } setExpirationTime() { this.p.exp = Math.floor(Date.now() / 1000) + 7 * 86400; return this; }
    async sign(key) { const h = b64({ alg: 'HS256' }), p = b64(this.p); return `${h}.${p}.${mac(h + '.' + p, key)}`; } }
  const jwtVerify = async (t, key) => { const [h, p, s] = String(t).split('.'); if (!s || mac(h + '.' + p, key) !== s) throw new Error('bad signature'); const payload = JSON.parse(Buffer.from(p, 'base64url').toString()); if (payload.exp < Date.now() / 1000) throw new Error('expired'); return { payload }; };
  return { SignJWT, jwtVerify };
});

const db = globalThis.__db;
const cookieOf = async (id, pw) => (await call(loginR.POST, { method: 'POST', body: { identifier: id, password: pw } })).cookie;

describe('Cloudinary photo upload & emergency switch', () => {
  let actualCloudinary;
  let adminCookie;
  let markerCookie;
  let ctoCookie;

  beforeAll(async () => {
    installBrowser();
    actualCloudinary = await vi.importActual('@/lib/cloudinary');

    // Create users if not already present
    const stats = { total: 0, present: 0, absent: 0, months: {} };
    await db.collection('users').doc('admin').set({
      role: 'admin', username: 'admin', name: 'Admin Officer', passwordHash: await bcrypt.hash('Admin@123', 4), isActive: true, discharged: false, stats,
    });
    await db.collection('users').doc('sir').set({
      role: 'cto', username: 'sir', name: 'Care Taker Officer', passwordHash: await bcrypt.hash('Sir@12345', 4), isActive: true, discharged: false, stats,
    });
    await db.collection('users').doc('marker').set({
      role: 'marker', username: 'marker', name: 'Cadet Marker', passwordHash: await bcrypt.hash('Marker@123', 4), isActive: true, discharged: false, stats,
    });
    await db.collection('users').doc('cadet1').set({
      role: 'cadet', username: 'cadet1', name: 'Cadet One', regNo: 'KA/26/1001', year: 1, type: 'SD', isActive: true, discharged: false, stats,
    });

    adminCookie = await cookieOf('admin', 'Admin@123');
    markerCookie = await cookieOf('marker', 'Marker@123');
    ctoCookie = await cookieOf('sir', 'Sir@12345');
  });

  describe('lib/cloudinary.js unit tests', () => {
    it('escapes context string delimiters (=, |, \\) correctly', () => {
      const { escapeContextValue } = actualCloudinary;
      expect(escapeContextValue('hello')).toBe('hello');
      expect(escapeContextValue('date=2026-10-20|marker=John')).toBe('date\\=2026-10-20\\|marker\\=John');
      expect(escapeContextValue('path\\to=file|val')).toBe('path\\\\to\\=file\\|val');
      expect(escapeContextValue(null)).toBe('');
      expect(escapeContextValue(undefined)).toBe('');
    });

    it('defines allowed mime types and rejects unsupported types', async () => {
      const { ALLOWED_PHOTO_MIMES, uploadParadePhoto } = actualCloudinary;
      expect(ALLOWED_PHOTO_MIMES).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

      await expect(uploadParadePhoto({
        buffer: Buffer.from('dummy'),
        mimeType: 'application/pdf',
        date: '2026-10-20',
        markedBy: 'Admin',
      })).rejects.toThrow(/Unsupported image type/);

      await expect(uploadParadePhoto({
        buffer: Buffer.from('dummy'),
        mimeType: 'text/plain',
        date: '2026-10-20',
        markedBy: 'Admin',
      })).rejects.toThrow(/Unsupported image type/);
    });

    it('pingPhotos returns valid structure', async () => {
      const { pingPhotos } = await import('@/lib/cloudinary');
      const res = await pingPhotos();
      expect(res).toHaveProperty('ok');
      expect(res).toHaveProperty('message');
    });
  });

  describe('/api/attendance/upload-photo error mapping', () => {
    it('maps Cloudinary rejection errors to HTTP 502 with helpful message', async () => {
      // Mock uploadParadePhoto to simulate Cloudinary 403 forbidden error
      const mockCloudinary = await import('@/lib/cloudinary');
      const origUpload = mockCloudinary.uploadParadePhoto;
      mockCloudinary.uploadParadePhoto = vi.fn().mockImplementation(async () => {
        const err = new Error('Cloudinary upload failed (code 403): Request forbidden due to missing permissions');
        err.http_code = 403;
        throw err;
      });

      try {
        const formData = new FormData();
        const fakeFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
        formData.append('file', fakeFile);
        formData.append('date', todayIST());
        formData.append('geo_lat', '12.914');
        formData.append('geo_lng', '74.856');

        const req = new Request('http://localhost/api/attendance/upload-photo', {
          method: 'POST',
          headers: { cookie: markerCookie },
          body: formData,
        });

        const res = await photoR.POST(req);
        expect(res.status).toBe(502);
        const data = await res.json();
        expect(data.error).toBe('Photo storage rejected the upload (code 403). Tell the administrator.');
      } finally {
        mockCloudinary.uploadParadePhoto = origUpload;
      }
    });
  });

  describe('Emergency switch: requirePhotos setting', () => {
    it('defaultSettings has requirePhotos: true', () => {
      const defaults = defaultSettings();
      expect(defaults.requirePhotos).toBe(true);
    });

    it('GET /api/meta returns requirePhotos: true by default', async () => {
      const r = await call(metaR.GET, { cookie: markerCookie });
      expect(r.status).toBe(200);
      expect(r.json.requirePhotos).toBe(true);
    });

    it('PUT /api/settings toggles requirePhotos and logs audit entry', async () => {
      const res = await call(settingsR.PUT, {
        method: 'PUT',
        cookie: adminCookie,
        body: { requirePhotos: false },
      });
      expect(res.status).toBe(200);
      expect(res.json.settings.requirePhotos).toBe(false);

      // Verify audit log has the settings change
      const auditEntries = db.all('audit_log').map(d => d.data);
      const settingsAudit = auditEntries.find(a => a.type === 'settings' && a.changes?.some(c => c.name === 'requirePhotos'));
      expect(settingsAudit).toBeDefined();
      expect(settingsAudit.changes[0].to).toBe('false');

      // Verify /api/meta now reflects requirePhotos: false
      const metaRes = await call(metaR.GET, { cookie: markerCookie });
      expect(metaRes.json.requirePhotos).toBe(false);
    });

    it('allows submitting attendance without photos when requirePhotos is false', async () => {
      const date = todayIST();
      const r = await call(attR.POST, {
        method: 'POST',
        cookie: markerCookie,
        body: {
          date,
          activity_type: 'Parade',
          years: [1],
          geo_lat: 12.914,
          geo_lng: 74.856,
          photo_urls: [], // No photos submitted!
          records: [{ cadet_id: 'cadet1', status: 'Present' }],
        },
      });

      expect(r.status).toBe(200);
      expect(r.json.pending).toBe(true);
      const sessionId = r.json.sessionId;
      expect(sessionId).toBeDefined();

      // Check pending session document has photosRequired: false
      const pendingDoc = (await db.collection('pending_sessions').doc(sessionId).get()).data();
      expect(pendingDoc.photosRequired).toBe(false);

      // Admin and CTO approve
      await call(apprR.POST, { method: 'POST', cookie: adminCookie, body: { id: sessionId, action: 'approve' } });
      const finalRes = await call(apprR.POST, { method: 'POST', cookie: ctoCookie, body: { id: sessionId, action: 'approve' } });
      expect(finalRes.status).toBe(200);

      // Check committed session retains photosRequired: false
      const sessionDoc = (await db.collection('sessions').doc(sessionId).get()).data();
      expect(sessionDoc.photosRequired).toBe(false);

      // Verify sendParadeReport output includes "No parade photo"
      globalThis.__mail.length = 0;
      await sendParadeReport({
        session: sessionDoc,
        records: [{ cadetId: 'cadet1', cadetName: 'Cadet One', cadetYear: 1, cadetType: 'SD', status: 'Present' }],
        settings: { sirEmail: 'sir@example.com', thresholdPct: 75 },
      });
      expect(globalThis.__mail.length).toBe(1);
      expect(globalThis.__mail[0].html).toContain('No parade photo');

      // Reset setting back to true
      await call(settingsR.PUT, {
        method: 'PUT',
        cookie: adminCookie,
        body: { requirePhotos: true },
      });
    });
  });

  describe('Health check photo storage test', () => {
    it('/api/health?mode=full reports photos service status and tracks activity counts', async () => {
      const r = await call(healthR.GET, {
        cookie: adminCookie,
        url: '/api/health?mode=full',
      });
      expect(r.status).toBe(200);
      expect(r.json.services.photos).toBeDefined();
      expect(r.json.services.photos.label).toBe('Cloudinary (photos)');
      expect(r.json.services.photos.ok).toBe(true);
      expect(r.json.services.photos.message).toContain('upload test OK');
    });
  });
});
