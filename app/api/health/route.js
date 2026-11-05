export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { db, Collections } from '@/lib/firebase';
import { authenticate } from '@/lib/session';
import { recentEvents, logEvent } from '@/lib/events';
import { pingSheets, getSheetYearCounts } from '@/lib/sheets';
import { verifyMail } from '@/lib/mailer';
import { sendTestEmail } from '@/lib/email';
import { getSettings, cleanEmail } from '@/lib/settings';
import { todayIST } from '@/lib/time';
import { cloudinary, pingPhotos } from '@/lib/cloudinary';
import { pendingCount } from '@/lib/approvals';
import { cached } from '@/lib/cache';
import { normalizeRegNo } from '@/lib/keys.mjs';

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

  const allUsersSnap = await db.collection(Collections.USERS).get();
  const allUsers = allUsersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const activeUsers = allUsers.filter(u => u.isActive !== false && !u.discharged);

  const accountIssues = [];

  const staffNoEmail = activeUsers.filter(u => u.role !== 'cadet' && !cleanEmail(u.email));
  if (staffNoEmail.length > 0) {
    accountIssues.push(`Staff without email: ${staffNoEmail.map(u => u.name).join(', ')}`);
  }

  const sharedUsers = new Set();
  const lowerUsernames = new Map();
  const lowerEmails = new Map();
  activeUsers.forEach(u => {
    const un = String(u.username || '').trim().toLowerCase();
    if (un) {
      if (lowerUsernames.has(un)) {
        sharedUsers.add(u.name);
        sharedUsers.add(lowerUsernames.get(un));
      } else {
        lowerUsernames.set(un, u.name);
      }
    }
    const em = cleanEmail(u.email);
    if (em) {
      const eml = em.toLowerCase();
      if (lowerEmails.has(eml)) {
        sharedUsers.add(u.name);
        sharedUsers.add(lowerEmails.get(eml));
      } else {
        lowerEmails.set(eml, u.name);
      }
    }
  });
  if (sharedUsers.size > 0) {
    accountIssues.push(`Duplicate username or email: ${Array.from(sharedUsers).join(', ')}`);
  }

  const activeAdmins = activeUsers.filter(u => u.role === 'admin');
  if (activeAdmins.length > 3) {
    accountIssues.push(`More than 3 administrators (${activeAdmins.length}): ${activeAdmins.map(u => u.name).join(', ')}`);
  }

  const TEST_NAMES = ['Admin Officer', 'Sgt Rohan', 'Lt. Sir', 'Test Marker', 'Test Login Cadet'];
  const leftoverTestAccounts = activeUsers.filter(u => TEST_NAMES.includes(u.name));
  if (leftoverTestAccounts.length > 0) {
    accountIssues.push(`Leftover test data: ${leftoverTestAccounts.map(u => u.name).join(', ')}`);
  }

  const accountsService = {
    ok: accountIssues.length === 0,
    label: 'Accounts',
    message: accountIssues.length === 0 ? 'All accounts healthy' : accountIssues.join(' · ')
  };

  const dataIntegrityService = await cached('health:data-integrity', 60_000, async () => {
    const [attSnap, sheetCounts] = await Promise.all([
      db.collection(Collections.ATTENDANCE).get(),
      getSheetYearCounts(),
    ]);

    const allUsersById = new Map(allUsers.map(u => [u.id, u]));
    const allCadets = allUsers.filter(u => u.role === 'cadet');
    const activeCadets = allCadets.filter(u => u.isActive !== false && !u.discharged);

    const redIssues = [];
    const amberIssues = [];

    // 1. duplicate Reg No among cadets
    const byReg = new Map();
    allCadets.forEach(u => {
      const nr = normalizeRegNo(u.regNo);
      if (nr) {
        if (!byReg.has(nr)) byReg.set(nr, []);
        byReg.get(nr).push(u);
      }
    });
    byReg.forEach((group, nr) => {
      if (group.length > 1) {
        const formatted = group.map(u => `${u.name} (${u.id})`).join(', ');
        redIssues.push(`Duplicate Reg No ${nr}: ${formatted}`);
      }
    });

    // 2. duplicate e-mail among ACTIVE cadets
    const byEmail = new Map();
    activeCadets.forEach(u => {
      const em = cleanEmail(u.email);
      if (em) {
        if (!byEmail.has(em)) byEmail.set(em, []);
        byEmail.get(em).push(u);
      }
    });
    byEmail.forEach((group, em) => {
      if (group.length > 1) {
        const formatted = group.map(u => `${u.name} (${u.id})`).join(', ');
        redIssues.push(`Duplicate email ${em}: ${formatted}`);
      }
    });

    // 3. duplicate phone
    const byPhone = new Map();
    allCadets.forEach(u => {
      const ph = String(u.phone || '').trim().replace(/\s+/g, '');
      if (ph) {
        if (!byPhone.has(ph)) byPhone.set(ph, []);
        byPhone.get(ph).push(u);
      }
    });
    byPhone.forEach((group, ph) => {
      if (group.length > 1) {
        const formatted = group.map(u => `${u.name} (${u.id})`).join(', ');
        redIssues.push(`Duplicate phone ${ph}: ${formatted}`);
      }
    });

    // 4. active cadets whose Year is not 1, 2 or 3
    const invalidYear = activeCadets.filter(u => ![1, 2, 3].includes(Number(u.year)));
    if (invalidYear.length > 0) {
      const formatted = invalidYear.map(u => `${u.name} (${u.id}, Year ${u.year})`).join(', ');
      redIssues.push(`Active cadets with invalid year: ${formatted}`);
    }

    // 5. attendance records whose cadetId has no user
    const orphanRecords = attSnap.docs.filter(d => !allUsersById.has(d.data().cadetId));
    if (orphanRecords.length > 0) {
      const formatted = orphanRecords.slice(0, 5).map(d => `${d.id} (cadetId ${d.data().cadetId})`).join(', ');
      redIssues.push(`Attendance records without user: ${formatted}`);
    }

    // 6. count mismatch per year between the app (active cadets) and the sheet (data rows in that Year tab)
    if (sheetCounts) {
      for (const y of [1, 2, 3]) {
        const appCount = activeCadets.filter(u => Number(u.year) === y).length;
        const sheetCount = sheetCounts[y] ?? 0;
        if (appCount !== sheetCount) {
          redIssues.push(`Year ${y}: ${appCount} in the app, ${sheetCount} in the sheet`);
        }
      }
    }

    // Amber (not red) for active cadets without e-mail or without phone, with the counts per year
    for (const y of [1, 2, 3]) {
      const inYear = activeCadets.filter(u => Number(u.year) === y);
      const noEmail = inYear.filter(u => !cleanEmail(u.email)).length;
      const noPhone = inYear.filter(u => !String(u.phone || '').trim()).length;
      if (noEmail > 0 || noPhone > 0) {
        amberIssues.push(`Year ${y}: ${noEmail} without email, ${noPhone} without phone`);
      }
    }

    const ok = redIssues.length === 0;
    const warning = ok && amberIssues.length > 0;
    let message = 'All integrity checks passed';
    if (!ok) {
      message = redIssues.join(' · ');
    } else if (warning) {
      message = `Active cadets without email or phone: ${amberIssues.join(' · ')}`;
    }

    return {
      ok,
      warning,
      label: 'Data integrity',
      message,
      redIssues,
      amberIssues,
    };
  });

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
      accounts: accountsService,
      dataIntegrity: dataIntegrityService,
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
