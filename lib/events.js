// Lightweight operational log shown on the admin "System Health" panel.
import { db, Collections, snapToArr } from './firebase.js';

export async function logEvent({ type, ok, ms = null, message = '', meta = null }) {
  try {
    await db.collection(Collections.EVENTS).add({
      type, ok: !!ok, ms, message: String(message || '').slice(0, 300),
      meta: meta || null, at: new Date().toISOString(),
    });
  } catch (e) { console.error('[EVENT] could not log:', e.message); }
}

// Time an async task and record the outcome.
export async function timed(type, fn, describe = () => '') {
  const t0 = Date.now();
  try {
    const out = await fn();
    const ok  = out?.success !== false;
    await logEvent({ type, ok, ms: Date.now() - t0, message: ok ? describe(out) : (out?.error || 'failed') });
    return out;
  } catch (e) {
    await logEvent({ type, ok: false, ms: Date.now() - t0, message: e.message });
    return { success: false, error: e.message };
  }
}

export async function recentEvents(limit = 40) {
  const snap = await db.collection(Collections.EVENTS).orderBy('at', 'desc').limit(limit).get();
  return snapToArr(snap);
}

export async function pruneEvents(days = 14) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const snap = await db.collection(Collections.EVENTS).where('at', '<', cutoff).limit(400).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}
