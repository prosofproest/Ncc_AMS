import { db, Collections, snapToArr } from '@/lib/firebase';
import { normStatus, summarize, groupLabel } from '@/lib/groups';

export const ACTIVITIES = ['Parade', 'Camp', 'Event', 'PT', 'Others'];
export const REASON_MAX = 100;

// One record per cadet per parade date within a cycle. Cycle 1 keeps the original id format so existing
// data keeps working; later cycles get a prefix so a promoted cadet can be marked on the same date again.
export const recId = (date, cadetId, cycle = 1) => (cycle > 1 ? `c${cycle}_${date}_${cadetId}` : `${date}_${cadetId}`);

export const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function parseYears(v) {
  const arr = Array.isArray(v) ? v : [];
  return [...new Set(arr.map(Number))].filter(y => [1, 2, 3].includes(y)).sort();
}

export async function sessionRecords(sessionId) {
  const snap = await db.collection(Collections.ATTENDANCE).where('sessionId', '==', sessionId).get();
  return snapToArr(snap);
}
export async function cycleSessions(cycle) {
  const snap = await db.collection(Collections.SESSIONS).where('cycle', '==', cycle).get();
  return snapToArr(snap).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function sessionDoc({ id, date, cycle, activity, description, years, recs, photoUrls, geoLat, geoLng, user, isHistorical, now }) {
  const sum = summarize(recs);
  return {
    id, date, cycle, activityType: activity, activityDescription: description,
    years, groupLabel: groupLabel(years),
    total: sum.total, present: sum.present, absent: sum.absent,
    photoUrls: photoUrls || [], geoLat: geoLat ?? null, geoLng: geoLng ?? null,
    markedBy: user.id, markedByName: user.name, isHistorical: !!isHistorical,
    createdAt: now, updatedAt: now,
  };
}

export function auditEntry({ type, payload, session, changes, note = '' }) {
  return {
    type, sessionId: session?.id || null, date: session?.date || null,
    activityType: session?.activityType || null, groupLabel: session?.groupLabel || null,
    by: payload.id, byName: payload.name, at: new Date().toISOString(),
    changes: changes || [], note,
  };
}

export { normStatus };
