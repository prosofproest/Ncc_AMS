import { cleanKey } from '../lib/keys.mjs';
// Creates the first administrator (only if none exists).
//   ADMIN_PASSWORD="choose-a-strong-one" ADMIN_EMAIL="you@example.com" npm run setup-admin
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import bcrypt from 'bcryptjs';

const pw = process.env.ADMIN_PASSWORD;
if (!pw || pw.length < 8) { console.error('Set ADMIN_PASSWORD (at least 8 characters), e.g.  ADMIN_PASSWORD="..." npm run setup-admin'); process.exit(1); }

const app = initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: cleanKey(process.env.FIREBASE_PRIVATE_KEY) }) });
const db = getFirestore(app);

async function setup() {
  const existing = await db.collection('users').where('role', '==', 'admin').limit(1).get();
  if (!existing.empty) { console.log('✓ An administrator already exists — nothing to do.'); process.exit(0); }
  await db.collection('users').add({
    name: 'Administrator', role: 'admin', username: 'admin', regNo: 'ADMIN001', email: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    year: null, type: null, passwordHash: await bcrypt.hash(pw, 10), mustChangePassword: false, otpRequired: false,
    isActive: true, discharged: false, stats: { total: 0, present: 0, absent: 0, months: {} }, benefit: 0, createdAt: new Date().toISOString(),
  });
  console.log('✅ Administrator created.  Sign in with username: admin   (or ADMIN001)');
  process.exit(0);
}
setup().catch(e => { console.error(e); process.exit(1); });
