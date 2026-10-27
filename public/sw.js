// NCC AMS service worker — keeps the app installable and shows a friendly page offline.
// Pages and API calls are NEVER served from cache, so a new release is visible immediately.
const CACHE = 'ncc-ams-v3';
const ASSETS = ['/icon-192.png', '/icon-512.png', '/icon.svg', '/manifest.json'];

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (ASSETS.includes(url.pathname)) { e.respondWith(caches.match(req).then(c => c || fetch(req))); return; }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,BlinkMacSystemFont,\\"SF Pro Text\\",\\"Segoe UI\\",Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#F5F6F8;color:#101828;text-align:center;padding:24px"><div><div style="display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:rgba(16,24,40,.06);margin-bottom:16px"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#667085" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><line x1="2" x2="22" y1="2" y2="22"/></svg></div><h2 style="margin:0 0 8px 0;font-size:20px;font-weight:600">You are offline</h2><p style="color:#667085;font-size:14px;max-width:360px;margin:0 auto 20px auto">Reconnect to continue.</p><button onclick="location.reload()" style="padding:10px 20px;border:0;border-radius:8px;background:#0A66D6;color:#fff;font-weight:500;font-size:14px;cursor:pointer">Try again</button></div></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
  }
});
