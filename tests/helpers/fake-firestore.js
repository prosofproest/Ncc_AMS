// In-memory Firestore that follows the real SDK's semantics closely enough to run the app's routes:
// dotted-path updates, FieldValue.increment/delete, 500-op batch limit, getAll, where/orderBy/limit.
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export const FieldValue = {
  increment: n => ({ __op: 'inc', n }),
  delete: () => ({ __op: 'del' }),
};
const isOp = v => v && typeof v === 'object' && v.__op;

function applyPath(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  const k = parts.at(-1);
  if (isOp(val)) {
    if (val.__op === 'inc') cur[k] = (typeof cur[k] === 'number' ? cur[k] : 0) + val.n;
    else delete cur[k];
  } else cur[k] = clone(val);
}
function mergeDeep(t, s) {
  for (const [k, v] of Object.entries(s)) {
    if (isOp(v)) applyPath(t, k, v);
    else if (v && typeof v === 'object' && !Array.isArray(v) && typeof t[k] === 'object' && t[k] && !Array.isArray(t[k])) mergeDeep(t[k], v);
    else t[k] = clone(v);
  }
}
function stripOps(o) {                       // set() with increment sentinels at top level
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = isOp(v) ? (v.__op === 'inc' ? v.n : undefined) : clone(v);
  return out;
}

export class FakeDB {
  constructor() { this.docs = new Map(); this.ver = new Map(); this.idn = 0; this.reads = 0; this.writes = 0; }
  bump(path) { this.ver.set(path, (this.ver.get(path) || 0) + 1); }
  settings() {}
  collection(name) { return new Col(this, name); }
  batch() { return new Batch(this); }
  async getAll(...refs) { return refs.map(r => r._snap()); }
  // Transactions: reads see current data, writes are applied together when the callback finishes (JS is single-threaded,
  // so a callback that awaits only on the fake cannot interleave with another one between its read and its commit).
  async runTransaction(fn) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const writes = [], seen = new Map();
      const tx = {
        get: async ref => { seen.set(ref.path, this.ver.get(ref.path) || 0); return ref._snap(); },
        set: (r, d, o) => { writes.push(() => r._set(d, o)); return tx; }, update: (r, o) => { writes.push(() => r._update(o)); return tx; }, delete: r => { writes.push(() => r._delete()); return tx; },
      };
      const out = await fn(tx);
      if ([...seen].some(([path, v]) => (this.ver.get(path) || 0) !== v)) continue;     // someone changed a document we read → retry
      writes.forEach(w => w()); return out;
    }
    throw new Error('Transaction failed after 10 retries');
  }
  _key(col, id) { return `${col}/${id}`; }
  all(col) { return [...this.docs.entries()].filter(([k]) => k.startsWith(col + '/')).map(([k, v]) => ({ id: k.slice(col.length + 1), data: v })); }
}
class Col {
  constructor(db, name) { this.db = db; this.name = name; }
  doc(id) { return new Doc(this.db, this.name, id || `auto${++this.db.idn}x${Math.random().toString(36).slice(2, 8)}`); }
  async add(data) { const d = this.doc(); await d.set(data); return d; }
  where(f, op, v) { return new Query(this).where(f, op, v); }
  orderBy(f, dir) { return new Query(this).orderBy(f, dir); }
  limit(n) { return new Query(this).limit(n); }
  get() { return new Query(this).get(); }
}
class Query {
  constructor(col) { this.col = col; this.f = []; this.o = null; this.l = null; }
  where(f, op, v) { this.f.push([f, op, v]); return this; }
  orderBy(f, dir = 'asc') { this.o = [f, dir]; return this; }
  limit(n) { this.l = n; return this; }
  count() { return { get: async () => { const n = (await this.get()).size; return { data: () => ({ count: n }) }; } }; }
  async get() {
    this.col.db.reads++;
    let rows = this.col.db.all(this.col.name);
    const get = (d, f) => f.split('.').reduce((a, k) => (a == null ? undefined : a[k]), d);
    for (const [f, op, v] of this.f) rows = rows.filter(r => {
      const x = get(r.data, f);
      if (x === undefined) return false;
      return op === '==' ? x === v : op === '<' ? x < v : op === '<=' ? x <= v : op === '>' ? x > v : op === '>=' ? x >= v : op === '!=' ? x !== v : op === 'array-contains' ? Array.isArray(x) && x.includes(v) : false;
    });
    if (this.o) { const [f, dir] = this.o; rows.sort((a, b) => { const x = get(a.data, f), y = get(b.data, f); return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'desc' ? -1 : 1); }); }
    if (this.l != null) rows = rows.slice(0, this.l);
    const docs = rows.map(r => new Snap(this.col.db, this.col.name, r.id, clone(r.data), true));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}
class Snap {
  constructor(db, col, id, data, exists) { this.db = db; this.col = col; this.id = id; this._d = data; this.exists = exists; }
  data() { return this.exists ? clone(this._d) : undefined; }
  get ref() { return new Doc(this.db, this.col, this.id); }
}
class Doc {
  constructor(db, col, id) { this.db = db; this.col = col; this.id = id; this.path = `${col}/${id}`; }
  _snap() { this.db.reads++; const d = this.db.docs.get(this.path); return new Snap(this.db, this.col, this.id, d ? clone(d) : undefined, !!d); }
  async get() { return this._snap(); }
  _set(data, opts) {
    this.db.writes++; this.db.bump(this.path);
    if (opts?.merge) { const cur = this.db.docs.get(this.path) || {}; mergeDeep(cur, data); this.db.docs.set(this.path, cur); }
    else this.db.docs.set(this.path, stripOps(data));
  }
  _update(obj) {
    const cur = this.db.docs.get(this.path);
    if (!cur) throw Object.assign(new Error(`NOT_FOUND: no document to update: ${this.path}`), { code: 5 });
    this.db.writes++; this.db.bump(this.path);
    for (const [k, v] of Object.entries(obj)) applyPath(cur, k, v);
  }
  _delete() { this.db.writes++; this.db.bump(this.path); this.db.docs.delete(this.path); }
  async set(d, o) { this._set(d, o); }
  async update(o) { this._update(o); }
  async delete() { this._delete(); }
}
class Batch {
  constructor(db) { this.db = db; this.ops = []; }
  set(r, d, o) { this.ops.push(() => r._set(d, o)); return this; }
  create(r, d) { this.ops.push(() => { if (r.db.docs.has(r.path)) throw Object.assign(new Error(`6 ALREADY_EXISTS: Document already exists: ${r.path}`), { code: 6 }); r._set(d); }); return this; }
  update(r, o) { this.ops.push(() => r._update(o)); return this; }
  delete(r) { this.ops.push(() => r._delete()); return this; }
  async commit() {
    if (this.ops.length > 500) throw new Error('INVALID_ARGUMENT: maximum 500 writes allowed per request');
    // atomic: snapshot, apply, restore on failure
    const snap = new Map([...this.db.docs].map(([k, v]) => [k, clone(v)]));
    try { this.ops.forEach(f => f()); } catch (e) { this.db.docs = snap; throw e; }
  }
}
export function makeFirebaseModule(db) {
  return {
    db, getDb: () => db, FieldValue,
    Collections: { USERS: 'users', ATTENDANCE: 'attendance', SESSIONS: 'sessions', PENDING: 'pending_sessions', PENDING_LOCKS: 'pending_locks', BENEFITS: 'benefits', AUDIT_LOG: 'audit_log', ROLE_CONFIG: 'roleConfig', SETTINGS: 'settings', OTP: 'otp_challenges', EVENTS: 'system_events' },
    docToObj: s => (s.exists ? { id: s.id, ...s.data() } : null),
    snapToArr: q => q.docs.map(d => ({ id: d.id, ...d.data() })),
    commitInChunks: async (ops, size = 400) => { for (let i = 0; i < ops.length; i += size) { const b = db.batch(); ops.slice(i, i + size).forEach(op => op(b)); await b.commit(); } },
  };
}
