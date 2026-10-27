'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { tabHeaders, clearTab } from '@/lib/tab';

// Polls an API endpoint, refreshes when the tab is shown again, and keeps the last good data
// on screen if a refresh fails (so a flaky mobile connection never blanks the page).
export function useRealtimeData(url, interval = 20000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const r = await fetch(url, { cache: 'no-store', headers: { ...tabHeaders() } });
      if (r.status === 401) {
        const d = (r.headers.get('content-type') || '').includes('json') ? await r.json().catch(() => null) : null;
        if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
          let reason = 'expired';
          if (d?.code === 'TAB') {
            reason = sessionStorage.getItem('ncc_has_session') ? 'other-tab' : 'tab';
          } else if (d?.code === 'TIMEOUT') {
            reason = 'timeout';
          }
          clearTab();
          location.href = `/login?reason=${reason}`;
        }
        return;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setLoading(false); }
  }, [url]);

  useEffect(() => {
    alive.current = true; setLoading(true); load();
    const t = interval ? setInterval(() => { if (document.visibilityState === 'visible') load(); }, interval) : null;
    const vis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', vis); window.addEventListener('online', load);
    return () => { alive.current = false; t && clearInterval(t); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', load); };
  }, [load, interval]);

  return { data, loading, error, refresh: load };
}
