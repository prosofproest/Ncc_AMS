// Run work after the HTTP response has been sent, without it being killed on Vercel.
import { waitUntil } from '@vercel/functions';

export function runInBackground(promiseOrFn) {
  const p = Promise.resolve().then(() => (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn))
    .catch(e => console.error('[BG] task failed:', e?.message || e));
  try { waitUntil(p); } catch { /* not on Vercel — promise simply continues */ }
  return p;
}
