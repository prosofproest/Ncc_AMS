import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cleanKey, cleanEnv, sheetId } from '@/lib/keys.mjs';

const KEY = '-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\\n-----END PRIVATE KEY-----\\n';
const good = {
  FIREBASE_PROJECT_ID: 'my-proj', FIREBASE_CLIENT_EMAIL: 'fb@my-proj.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: `"${KEY}"`,
  CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: '1', CLOUDINARY_API_SECRET: 's',
  JWT_SECRET: 'a'.repeat(64), CRON_SECRET: 'b'.repeat(64),
  EMAIL_HOST: 'smtp.gmail.com', EMAIL_PORT: '587', EMAIL_USER: 'unit@gmail.com', EMAIL_PASS: 'abcd efgh ijkl mnop', EMAIL_TO: 'sir@x.in', EMAIL_CC: '',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sh@my-proj.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: KEY,
  GOOGLE_SHEET_ID: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0', NEXT_PUBLIC_APP_URL: 'https://ncc-ams.vercel.app',
};
const run = env => spawnSync('node', ['scripts/check-env.mjs'], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

describe('credential helpers accept every way people paste them', () => {
  it('private keys: quotes, literal \\n, real newlines', () => {
    const want = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----';
    expect(cleanKey('"-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----"')).toBe(want);
    expect(cleanKey("'-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----'")).toBe(want);
    expect(cleanKey('-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n')).toBe(want);
    expect(cleanKey(undefined)).toBe('');
    expect(cleanEnv('  "value"  ')).toBe('value');
  });
  it('sheet id: bare id or the whole address', () => {
    expect(sheetId('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(sheetId(good.GOOGLE_SHEET_ID)).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
  });
});
describe('npm run check-env', () => {
  it('passes with a complete, correctly formatted configuration (quotes / spaces / full sheet URL tolerated)', () => {
    const r = run(good); expect(r.status).toBe(0); expect(r.stdout).toMatch(/✅ Ready/);
    expect(r.stdout).toMatch(/GOOGLE_SHEET_ID\s+1AbCdEfG…6789/); expect(r.stdout).toMatch(/EMAIL_PASS\s+set \(16 characters\)/);
  });
  it('flags every common mistake with a plain explanation', () => {
    const r = run({ ...good, FIREBASE_PRIVATE_KEY: 'not-a-key', JWT_SECRET: 'short', EMAIL_PASS: 'password123', EMAIL_USER: 'nobody', GOOGLE_SHEET_ID: 'abc', NEXT_PUBLIC_APP_URL: 'ncc.vercel.app', CLOUDINARY_API_KEY: '' });
    expect(r.status).toBe(1);
    for (const m of [/FIREBASE_PRIVATE_KEY\s+does not look like a private key/, /JWT_SECRET\s+too short/, /EMAIL_USER\s+is not a valid/, /GOOGLE_SHEET_ID\s+does not look like a sheet id/, /NEXT_PUBLIC_APP_URL\s+must start with https/, /CLOUDINARY_API_KEY\s+missing/, /EMAIL_PASS\s+Gmail app passwords are 16/])
      expect(r.stdout).toMatch(m);
    expect(r.stdout).toMatch(/problem\(s\) to fix/);
  });
  it('an empty environment lists everything that is missing and exits with an error', () => {
    const r = run({}); expect(r.status).toBe(1); expect((r.stdout.match(/❌/g) || []).length).toBeGreaterThan(10);
  });
});
