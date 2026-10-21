// Checks every setting before you deploy.
//   npm run check-env          → checks that each value is present and looks right
//   npm run check-env:live     → also connects to Firebase, Google Sheets, Gmail and Cloudinary for real
import { cleanKey, cleanEnv, sheetId } from '../lib/keys.mjs';

const live = process.argv.includes('--live');
const env = k => process.env[k];
const results = [];
const ok = (k, msg) => results.push(['ok', k, msg]);
const warn = (k, msg) => results.push(['warn', k, msg]);
const bad = (k, msg) => results.push(['bad', k, msg]);
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function need(k, hint) { const v = cleanEnv(env(k)); if (!v) { bad(k, `missing — ${hint}`); return null; } return v; }
function pem(k, hint) {
  const raw = env(k); if (!cleanEnv(raw)) { bad(k, `missing — ${hint}`); return; }
  const key = cleanKey(raw);
  if (!key.includes('-----BEGIN PRIVATE KEY-----') || !key.includes('-----END PRIVATE KEY-----')) return bad(k, 'does not look like a private key (it must start with -----BEGIN PRIVATE KEY----- and end with -----END PRIVATE KEY-----). Copy the "private_key" value from the downloaded JSON file.');
  if (!key.includes('\n')) return bad(k, 'the line breaks are missing. Keep the \\n characters exactly as they appear in the JSON file.');
  ok(k, 'private key format looks right');
}

// Firebase
const pid = need('FIREBASE_PROJECT_ID', 'Firebase → Project settings → Service accounts → Generate new private key → "project_id"'); if (pid) ok('FIREBASE_PROJECT_ID', pid);
const fe = need('FIREBASE_CLIENT_EMAIL', 'same JSON file → "client_email"'); if (fe) (/\.iam\.gserviceaccount\.com$/.test(fe) ? ok('FIREBASE_CLIENT_EMAIL', fe) : bad('FIREBASE_CLIENT_EMAIL', 'should end with .iam.gserviceaccount.com'));
pem('FIREBASE_PRIVATE_KEY', 'same JSON file → "private_key"');
// Cloudinary
for (const [k, h] of [['CLOUDINARY_CLOUD_NAME', 'Cloudinary Dashboard → Cloud name'], ['CLOUDINARY_API_KEY', 'Cloudinary Dashboard → API Key'], ['CLOUDINARY_API_SECRET', 'Cloudinary Dashboard → API Secret']]) { const v = need(k, h); if (v) ok(k, k === 'CLOUDINARY_API_SECRET' ? 'set' : v); }
// Secrets
for (const [k, min] of [['JWT_SECRET', 32], ['CRON_SECRET', 16]]) {
  const v = need(k, 'generate one:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  if (v) (v.length < 16 ? bad(k, `too short (${v.length} characters) — use at least 32`) : v.length < min ? warn(k, `works, but longer is safer (${v.length} characters)`) : ok(k, `${v.length} characters`));
}
// Email
const host = need('EMAIL_HOST', 'for Gmail use smtp.gmail.com'); if (host) ok('EMAIL_HOST', host);
const port = cleanEnv(env('EMAIL_PORT') || '587'); (/^\d+$/.test(port) ? ok('EMAIL_PORT', port) : bad('EMAIL_PORT', 'must be a number, e.g. 587'));
const eu = need('EMAIL_USER', 'the Gmail address that sends the mails'); if (eu) (emailRe.test(eu) ? ok('EMAIL_USER', eu) : bad('EMAIL_USER', 'is not a valid e-mail address'));
const ep = cleanEnv(env('EMAIL_PASS')).replace(/\s/g, '');
if (!ep) bad('EMAIL_PASS', 'missing — Google Account → Security → 2-Step Verification → App passwords (16 letters)');
else if (ep.length !== 16) warn('EMAIL_PASS', `Gmail app passwords are 16 letters; yours has ${ep.length}. If you used your normal Gmail password, sending will fail.`);
else ok('EMAIL_PASS', 'set (16 characters)');
for (const k of ['EMAIL_TO', 'EMAIL_CC']) { const v = cleanEnv(env(k)); if (v) (emailRe.test(v) ? ok(k, v) : bad(k, 'is not a valid e-mail address')); else warn(k, 'empty — set Sir\'s and the backup e-mail later in Admin → Settings'); }
// Google Sheets
const ge = need('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'Google Cloud → IAM → Service Accounts → the account\'s e-mail'); if (ge) (/\.iam\.gserviceaccount\.com$/.test(ge) ? ok('GOOGLE_SERVICE_ACCOUNT_EMAIL', ge) : bad('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'should end with .iam.gserviceaccount.com'));
pem('GOOGLE_PRIVATE_KEY', 'the service account JSON key → "private_key"');
const sid = sheetId(env('GOOGLE_SHEET_ID'));
if (!sid) bad('GOOGLE_SHEET_ID', 'missing — the long text between /d/ and /edit in your sheet\'s address'); else (/^[A-Za-z0-9_-]{25,}$/.test(sid) ? ok('GOOGLE_SHEET_ID', sid.length > 12 ? `${sid.slice(0, 8)}…${sid.slice(-4)}` : sid) : bad('GOOGLE_SHEET_ID', 'does not look like a sheet id (too short or has odd characters)'));
// App
const url = cleanEnv(env('NEXT_PUBLIC_APP_URL'));
if (!url) bad('NEXT_PUBLIC_APP_URL', 'missing — your site address, e.g. https://ncc-ams.vercel.app'); else if (!/^https?:\/\//.test(url)) bad('NEXT_PUBLIC_APP_URL', 'must start with https://'); else if (/localhost|127\.0\.0\.1/.test(url)) warn('NEXT_PUBLIC_APP_URL', 'is localhost — fine for testing; on Vercel use your real address'); else ok('NEXT_PUBLIC_APP_URL', url);

async function liveChecks() {
  const t = async (name, fn) => { const t0 = Date.now(); try { const m = await fn(); results.push(['ok', `LIVE ${name}`, `${m} (${Date.now() - t0} ms)`]); } catch (e) { results.push(['bad', `LIVE ${name}`, String(e.message || e).split('\n')[0]]); } };
  await t('Firebase', async () => {
    const { initializeApp, cert } = await import('firebase-admin/app'); const { getFirestore } = await import('firebase-admin/firestore');
    const app = initializeApp({ credential: cert({ projectId: cleanEnv(env('FIREBASE_PROJECT_ID')), clientEmail: cleanEnv(env('FIREBASE_CLIENT_EMAIL')), privateKey: cleanKey(env('FIREBASE_PRIVATE_KEY')) }) });
    const snap = await getFirestore(app).collection('settings').doc('main').get(); return `connected to Firestore (${snap.exists ? 'settings found' : 'empty database — normal on first run'})`;
  });
  await t('Google Sheets', async () => {
    const { sheets, auth } = await import('@googleapis/sheets');
    const a = new auth.GoogleAuth({ credentials: { client_email: cleanEnv(env('GOOGLE_SERVICE_ACCOUNT_EMAIL')), private_key: cleanKey(env('GOOGLE_PRIVATE_KEY')) }, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const r = await sheets({ version: 'v4', auth: a }).spreadsheets.get({ spreadsheetId: sheetId(env('GOOGLE_SHEET_ID')), fields: 'properties.title,sheets.properties.title' });
    return `opened "${r.data.properties.title}" with ${r.data.sheets.length} tab(s)`;
  });
  await t('Gmail', async () => {
    const nodemailer = (await import('nodemailer')).default;
    await nodemailer.createTransport({ host: cleanEnv(env('EMAIL_HOST')), port: +port, secure: +port === 465, auth: { user: cleanEnv(env('EMAIL_USER')), pass: ep } }).verify(); return 'login accepted';
  });
  await t('Cloudinary', async () => {
    const cloudName = cleanEnv(env('CLOUDINARY_CLOUD_NAME'));
    const apiKey = cleanEnv(env('CLOUDINARY_API_KEY'));
    const apiSecret = cleanEnv(env('CLOUDINARY_API_SECRET'));
    const { v2: c } = await import('cloudinary');
    c.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    try {
      const res = await c.uploader.upload(png, { folder: 'ncc-airwing/healthcheck', tags: ['ams-healthcheck'] });
      if (res?.public_id) await c.uploader.destroy(res.public_id).catch(() => {});
      return 'upload and destroy OK';
    } catch (err) {
      let raw = err.error?.message || (typeof err.error === 'string' ? err.error : '') || err.message || '';
      try {
        const crypto = await import('crypto');
        const ts = Math.floor(Date.now() / 1000);
        const toSign = `tags=ams-healthcheck&timestamp=${ts}${apiSecret}`;
        const sig = crypto.createHash('sha1').update(toSign).digest('hex');
        const fd = new FormData();
        fd.append('file', png);
        fd.append('api_key', apiKey);
        fd.append('timestamp', String(ts));
        fd.append('tags', 'ams-healthcheck');
        fd.append('signature', sig);
        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: fd });
        if (!res.ok) {
          raw = `${res.status} ${await res.text()}`;
        }
      } catch {}
      throw new Error(`upload test failed: ${raw}`);
    }
  });
}

if (live && !results.some(r => r[0] === 'bad')) await liveChecks();
else if (live) results.push(['warn', 'LIVE', 'skipped — fix the red items above first']);

const icon = { ok: '✅', warn: '⚠️ ', bad: '❌' };
console.log('\nAMS — environment check' + (live ? ' (live)' : '') + '\n');
for (const [s, k, m] of results) console.log(`${icon[s]} ${k.padEnd(30)} ${m}`);
const nb = results.filter(r => r[0] === 'bad').length, nw = results.filter(r => r[0] === 'warn').length;
console.log(`\n${nb ? `❌ ${nb} problem(s) to fix before deploying.` : '✅ Ready.'}${nw ? `  (${nw} warning(s))` : ''}${live ? '' : nb ? '' : '\nTip: run  npm run check-env:live  to test the real connections.'}\n`);
process.exit(nb ? 1 : 0);
