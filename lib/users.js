import { db, Collections, snapToArr } from '@/lib/firebase';
import { cached, invalidate } from '@/lib/cache';
import { normalizeRegNo } from '@/lib/keys.mjs';

export const SAFE_FIELDS = (u) => {
  const { passwordHash, lockedUntil, failedLogins, ...rest } = u;
  return rest;
};

export async function findUsersByIdentifier(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return [];
  const lower = id.toLowerCase();
  const upper = id.toUpperCase();
  const normReg = normalizeRegNo(id);

  const allUsersSnap = await db.collection(Collections.USERS).get();
  return allUsersSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => {
    const mUser = u.username && String(u.username).trim().toLowerCase() === lower;
    const mReg = u.regNo && (String(u.regNo).trim().toUpperCase() === upper || (normReg && normalizeRegNo(u.regNo) === normReg));
    const mEmail = u.role !== 'cadet' && u.email && String(u.email).trim().toLowerCase() === lower;
    return mUser || mReg || mEmail;
  });
}

export async function findUserByIdentifier(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  const lower = id.toLowerCase();
  const upper = id.toUpperCase();
  const normReg = normalizeRegNo(id);

  const [byUser, byReg, byEmail] = await Promise.all([
    db.collection(Collections.USERS).where('username', '==', lower).limit(1).get(),
    db.collection(Collections.USERS).where('regNo', '==', upper).limit(1).get(),
    db.collection(Collections.USERS).where('email', '==', lower).get(),
  ]);

  if (!byUser.empty) {
    const doc = byUser.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  if (!byReg.empty) {
    const doc = byReg.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  if (normReg) {
    const byNorm = await db.collection(Collections.USERS).where('regNo', '==', normReg).limit(1).get();
    if (!byNorm.empty) {
      const doc = byNorm.docs[0];
      return { id: doc.id, ...doc.data() };
    }
  }

  if (!byEmail.empty) {
    const nonCadet = byEmail.docs.find(d => d.data()?.role !== 'cadet');
    if (nonCadet) return { id: nonCadet.id, ...nonCadet.data() };
  }

  // Case-insensitive fallback for non-cadet accounts in case email was stored mixed-case
  const allUsersSnap = await db.collection(Collections.USERS).get();
  const staffMatch = allUsersSnap.docs.find(d => {
    const u = d.data();
    if (u.role === 'cadet') return false;
    return String(u.email || '').trim().toLowerCase() === lower ||
           String(u.username || '').trim().toLowerCase() === lower;
  });
  if (staffMatch) return { id: staffMatch.id, ...staffMatch.data() };

  return null;
}

// All users, cached briefly. Every write path calls invalidateUsers().
export async function getAllUsers({ fresh = false } = {}) {
  if (fresh) invalidate('users');
  return cached('users:all', 15_000, async () => snapToArr(await db.collection(Collections.USERS).get()));
}
export function invalidateUsers() { invalidate('users'); }

export const byRole = (users, role) => users.filter(u => u.role === role);
export const isLive = u => u.isActive && !u.discharged;

// Fetch several user docs in one round trip
export async function getUsersByIds(ids) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return {};
  const refs = uniq.map(id => db.collection(Collections.USERS).doc(id));
  const snaps = await db.getAll(...refs);
  const out = {};
  snaps.forEach(s => { if (s.exists) out[s.id] = { id: s.id, ...s.data() }; });
  return out;
}
