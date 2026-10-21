'use client';
// Attendance saved on the phone while offline (photos included) and sent when the network is back.
// Sync runs whenever the app is open: on load, when the connection returns, and when the tab is shown again.
const DB = 'ncc-offline', STORE = 'queue';

function open() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB unavailable'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); });
};

export async function queueSubmission({ payload, photos, geo }) {
  return tx('readwrite', s => s.add({ createdAt: new Date().toISOString(), payload, geo, photos: photos.map(f => ({ blob: f, name: f.name || 'photo.jpg', type: f.type || 'image/jpeg' })), status: 'pending', error: null }));
}
export async function listQueue() { try { return await tx('readonly', s => s.getAll()); } catch { return []; } }
export async function removeItem(id) { return tx('readwrite', s => s.delete(id)); }
async function updateItem(item) { return tx('readwrite', s => s.put(item)); }

let running = false;
// Returns { sent, failed, left }. Stops quietly at the first network error.
export async function syncQueue(onProgress) {
  if (running || (typeof navigator !== 'undefined' && !navigator.onLine)) return { sent: 0, failed: 0, left: (await listQueue()).length };
  running = true; let sent = 0, failed = 0;
  try {
    for (const item of await listQueue()) {
      if (item.status === 'failed') continue;
      try {
        let urls = item.payload.photo_urls || [];
        if (item.photos.length && !urls.length) {
          const fd = new FormData();
          item.photos.forEach(p => fd.append('file', new File([p.blob], p.name, { type: p.type })));
          fd.append('date', item.payload.date);
          if (item.geo) { fd.append('geo_lat', item.geo.lat); fd.append('geo_lng', item.geo.lng); }
          const up = await fetch('/api/attendance/upload-photo', { method: 'POST', body: fd });
          if (up.status === 401) return { sent, failed, left: 1, auth: true };
          const uj = await up.json().catch(() => ({}));
          if (up.ok) urls = uj.urls || [];
        }
        const r = await fetch('/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...item.payload, photo_urls: urls, geo_lat: item.geo?.lat ?? item.payload.geo_lat, geo_lng: item.geo?.lng ?? item.payload.geo_lng }) });
        if (r.status === 401) return { sent, failed, left: 1, auth: true };
        if (r.ok) { await removeItem(item.id); sent++; onProgress?.(item, 'sent'); }
        else { const j = await r.json().catch(() => ({})); item.status = 'failed'; item.error = j.error || `Error ${r.status}`; await updateItem(item); failed++; onProgress?.(item, 'failed'); }
      } catch { break; }     // network dropped again — try later
    }
  } finally { running = false; }
  return { sent, failed, left: (await listQueue()).filter(i => i.status !== 'failed').length };
}
