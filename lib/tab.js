'use client';

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getTabId() {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return '';
  }
  let tid = sessionStorage.getItem('ncc_tab');
  if (!tid) {
    tid = makeId();
    sessionStorage.setItem('ncc_tab', tid);
  }
  return tid;
}

export function tabHeaders() {
  return { 'x-tab-id': getTabId() };
}

export function clearCaches() {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
  try {
    const toRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith('ncc_cache_') || k.startsWith('ncc_draft_') || k === 'ncc_uid')) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      sessionStorage.removeItem(k);
    }
  } catch {}
}

export function clearTab() {
  if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('ncc_tab');
    sessionStorage.removeItem('ncc_has_session');
    clearCaches();
  }
}
