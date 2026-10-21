export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { authenticate } from '@/lib/session';
import { recentEvents, logEvent } from '@/lib/events';
import { pingSheets } from '@/lib/sheets';
import { verifyMail } from '@/lib/mailer';
import { sendTestEmail } from '@/lib/email';
import { getSettings } from '@/lib/settings';
import { todayIST } from '@/lib/time';
import { cloudinary, pingPhotos } from '@/lib/cloudinary';
import { pendingCount } from '@/lib/approvals';

const REQUIRED_ENV = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'JWT_SECRET', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID', 'EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS', 'NEXT_PUBLIC_APP_URL'];

async function time(fn) {
  const t0 = Date.now();
  try { const r = await fn(); return { ok: true, ms: Date.now() - t0, ...(r || {}) }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, message: e.message }; }
}

// GET /api/health?mode=quick   -> server + database latency only (polled every few seconds)
// GET /api/health?mode=full    -> every integration + recent activity (admin presses "Run full check")
// POST /api/health { sendTest: true } -> also sends a real test email to the admin / Sir
export async function GET(request) {
  const { error } = await authenticate(request, { roles: ['admin'] });
  if (error) return error;
  const mode = new URL(request.url).searchParams.get('mode') || 'quick';
  const checkedAt = new Date().toISOString();

  const database = await time(async () => {
    const t0 = Date.now();
    await db.collection(Collections.SETTINGS).doc('main').get();
    const read = Date.now() - t0;
    const t1 = Date.now();
    await db.collection(Collections.SETTINGS).doc('_ping').set({ at: checkedAt });
    return { readMs: read, writeMs: Date.now() - t1, message: `read ${read} ms · write ${Date.now() - t1} ms` };
  });
  if (mode === 'quick') return NextResponse.json({ mode, checkedAt, database, events: (await recentEvents(8)).slice(0, 8) });

  const [sheets, mail, photos] = await Promise.all([
    pingSheets(),
    verifyMail(),
    pingPhotos(),
  ]);
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  const events = await recentEvents(60);
  const day = Date.now() - 86400000;
  const last24 = events.filter(e => Date.parse(e.at) > day);
  const failures = last24.filter(e => !e.ok);
  const counts = {};
  last24.forEach(e => { const k = e.type.split(':')[0]; counts[k] = counts[k] || { ok: 0, failed: 0 }; e.ok ? counts[k].ok++ : counts[k].failed++; });
  const avg = type => { const l = last24.filter(e => e.type.startsWith(type) && e.ms != null); return l.length ? Math.round(l.reduce((n, e) => n + e.ms, 0) / l.length) : null; };

  const settings = await getSettings({ fresh: true });
  const crons = {};
  ['cron:nightly', 'cron:monthly', 'cron:weekly'].forEach(t => { const e = events.find(x => x.type === t); crons[t.split(':')[1]] = e ? { at: e.at, ok: e.ok, message: e.message } : null; });

  const pendingApprovals = await pendingCount().catch(() => null);
  const result = {
    mode, checkedAt, today: todayIST(), pendingApprovals,
    services: {
      database: { ...database, label: 'Firebase database' },
      sheets:   { ...sheets, label: 'Google Sheets' },
      email:    { ...mail, label: 'Email (SMTP)' },
      photos:   { ...photos, label: 'Cloudinary (photos)' },
      env:      { ok: missing.length === 0, label: 'Environment variables', message: missing.length ? `Missing: ${missing.join(', ')}` : 'All required variables are set' },
      officialMail: { ok: !!(settings.sirEmail || settings.backupEmail), label: 'Sir / backup email', message: settings.sirEmail || settings.backupEmail ? `Reports go to ${[settings.sirEmail, settings.backupEmail].filter(Boolean).join(' and ')}` : 'Not set — open Settings and add Sir’s email' },
    },
    activity: { counts, failures: failures.length, avgMs: { sheets: avg('sheets'), email: avg('email') }, crons },
    events: events.slice(0, 40),
  };
  result.allOk = Object.values(result.services).every(s => s.ok) && failures.length === 0;
  return NextResponse.json(result);
}

export async function POST(request) {
  const { payload, error } = await authenticate(request, { roles: ['admin'] });
  if (error) return error;
  const settings = await getSettings();
  const to = settings.sirEmail || process.env.EMAIL_USER;
  const t0 = Date.now();
  const r = await sendTestEmail(to);
  await logEvent({ type: 'email:test', ok: r.success, ms: Date.now() - t0, message: r.success ? `test mail sent to ${to}` : r.error });
  return NextResponse.json({ ...r, to, ms: Date.now() - t0, by: payload.name });
}
