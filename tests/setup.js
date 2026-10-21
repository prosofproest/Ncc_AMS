import { vi } from 'vitest';
import { TextEncoder as NodeTextEncoder } from 'node:util';
globalThis.TextEncoder = NodeTextEncoder;
globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;   // the real (Node-realm) Uint8Array   // test-only: jsdom's TextEncoder yields a foreign Uint8Array that `jose` rejects
import { FakeDB } from './helpers/fake-firestore.js';
import { FakeSheets } from './helpers/fake-sheets.js';

process.env.JWT_SECRET = 'test-secret-test-secret-123456';
process.env.EMAIL_USER = 'unit@example.com'; process.env.EMAIL_PASS = 'pass'; process.env.EMAIL_HOST = 'smtp.test';
process.env.GOOGLE_SHEET_ID = 'sheet1'; process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'svc@test.iam'; process.env.GOOGLE_PRIVATE_KEY = 'key';
process.env.NEXT_PUBLIC_APP_URL = 'https://ncc.example.com'; process.env.CRON_SECRET = 'cron-secret';
process.env.CLOUDINARY_CLOUD_NAME = 'c'; process.env.CLOUDINARY_API_KEY = 'k'; process.env.CLOUDINARY_API_SECRET = 's';
process.env.FIREBASE_PROJECT_ID = 'p'; process.env.FIREBASE_CLIENT_EMAIL = 'e'; process.env.FIREBASE_PRIVATE_KEY = 'k';

globalThis.__db = new FakeDB();
globalThis.__sheets = new FakeSheets();
globalThis.__mail = [];
globalThis.__bg = [];
globalThis.__bgErrors = [];
globalThis.__mailFail = false;

vi.mock('@/lib/firebase', async () => {
  const { makeFirebaseModule } = await import('./helpers/fake-firestore.js');
  return makeFirebaseModule(globalThis.__db);
});
vi.mock('@/lib/bg', () => ({
  runInBackground: fn => {
    const p = Promise.resolve().then(() => (typeof fn === 'function' ? fn() : fn)).catch(e => { globalThis.__bgErrors.push(e); });
    globalThis.__bg.push(p); return p;
  },
}));
vi.mock('nodemailer', () => {
  const t = {
    sendMail: async opts => { if (globalThis.__mailFail) throw new Error('SMTP down'); globalThis.__mail.push(opts); return { messageId: 'x' }; },
    verify: async () => true,
  };
  return { default: { createTransport: () => t } };
});
vi.mock('@googleapis/sheets', () => ({ auth: { GoogleAuth: class {} }, sheets: () => globalThis.__sheets }));
vi.mock('@/lib/cloudinary', () => ({
  ALLOWED_PHOTO_MIMES: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  escapeContextValue: v => String(v ?? '').replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/\|/g, '\\|'),
  uploadParadePhoto: async () => ({ url: 'https://res.cloudinary.com/demo/image/upload/v1/parade.jpg', publicId: 'parade_1', width: 800, height: 600 }),
  pingPhotos: async () => ({ ok: true, ms: 42, message: 'upload test OK (42 ms)' }),
  cloudinary: {
    api: { ping: async () => ({ status: 'ok' }) },
    uploader: {
      upload: async () => ({ public_id: 'ams-healthcheck-1', secure_url: 'https://res.cloudinary.com/x/image/upload/1.png' }),
      destroy: async () => ({ result: 'ok' }),
    },
  },
}));
