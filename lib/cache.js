// Tiny in-memory TTL cache. Lives per server instance — it only removes repeated
// Firestore reads on a warm instance, and every write path invalidates it.
const store = new Map();

export async function cached(key, ttlMs, loader) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.exp > now) return hit.val;
  if (hit?.pending) return hit.pending;
  const pending = Promise.resolve(loader()).then(val => {
    store.set(key, { val, exp: Date.now() + ttlMs });
    return val;
  }).catch(err => { store.delete(key); throw err; });
  store.set(key, { ...(hit || {}), pending, exp: 0 });
  return pending;
}
export function invalidate(prefix = '') {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
