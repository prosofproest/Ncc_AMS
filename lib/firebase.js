import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { cleanKey, cleanEnv } from './keys.mjs';

function getApp() {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId:   cleanEnv(process.env.FIREBASE_PROJECT_ID),
      clientEmail: cleanEnv(process.env.FIREBASE_CLIENT_EMAIL),
      privateKey:  cleanKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });
}

let _db = null;
// Lazy getter — Firebase only initialises when first used at request time
export function getDb() {
  if (_db) return _db;
  getApp();
  _db = getFirestore();
  try { _db.settings({ ignoreUndefinedProperties: true }); } catch { /* already configured */ }
  return _db;
}

// Backward-compatible proxy so `db.collection(...)`, `db.batch()`, `db.getAll()` work
export const db = new Proxy({}, {
  get(_, prop) {
    const real = getDb();
    const v = real[prop];
    return typeof v === 'function' ? v.bind(real) : v;
  },
});

export { FieldValue };

export const Collections = {
  USERS:       'users',
  ATTENDANCE:  'attendance',
  SESSIONS:    'sessions',
  PENDING:     'pending_sessions',
  PENDING_LOCKS: 'pending_locks',
  BENEFITS:    'benefits',
  AUDIT_LOG:   'audit_log',
  ROLE_CONFIG: 'roleConfig',
  SETTINGS:    'settings',
  OTP:         'otp_challenges',
  EVENTS:      'system_events',
};

export function docToObj(snap) {
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}
export function snapToArr(querySnap) {
  return querySnap.docs.map(d => ({ id: d.id, ...d.data() }));
}
// Commit writes in chunks below Firestore's 500-operation batch limit
export async function commitInChunks(ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + size)) op(batch);
    await batch.commit();
  }
}
