// One-time upgrade of data written by the OLD version of the app to the new structure:
//   • attendance records get a session + cycle (so history, edit-lock and reports work)
//   • "Leave" becomes Absent (only Present / Absent exist now); the old remark becomes the reason
//   • every person gets attendance counters (total / present / absent / per month) rebuilt from the records
// Safe to run more than once. Nothing is deleted.  Self-contained: it runs from `scripts/migrate.mjs`.
const monthKey = d => 'm' + d.slice(0, 4) + d.slice(5, 7);
const norm = s => (s === 'Present' ? 'Present' : 'Absent');
const labelOf = (years) => {
  const ys = [...new Set(years)].filter(y => [1, 2, 3].includes(y)).sort();
  let b = ys.length === 3 ? 'All Years' : ys.length === 2 ? `Year ${ys[0]} & ${ys[1]}` : ys.length === 1 ? `Year ${ys[0]}` : '';
  return b || 'All';
};
async function commit(db, ops) {
  for (let i = 0; i < ops.length; i += 400) { const b = db.batch(); ops.slice(i, i + 400).forEach(f => f(b)); await b.commit(); }
}

export async function migrateLegacy(db, { dryRun = false, log = () => {} } = {}) {
  const out = { sessionsCreated: 0, recordsUpdated: 0, usersUpdated: 0, leaveConverted: 0 };
  const attSnap = await db.collection('attendance').get();
  const allRecs = attSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  const isOldStaff = r => r.cadetRole === 'senior';
  const oldStaffRecs = allRecs.filter(isOldStaff);
  if (oldStaffRecs.length) {
    log(`skipped ${oldStaffRecs.length} legacy staff records`);
  }
  const recs = allRecs.filter(r => !isOldStaff(r));
  log(`${recs.length} attendance records found`);

  // 1 ─ group records that were submitted together into sessions
  const fresh = recs.filter(r => !r.sessionId && r.date);
  const groups = new Map();
  for (const r of fresh) {
    const k = [r.date, r.activityType || 'Parade', r.activityDescription || '', r.markedBy || ''].join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const ops = []; let n = 0;
  for (const list of groups.values()) {
    const first = list[0];
    const id = `${first.date}_legacy${(++n).toString(36)}`;
    const present = list.filter(r => norm(r.status) === 'Present').length;
    const years = list.filter(r => (r.cadetRole || 'cadet') === 'cadet' && r.cadetYear).map(r => r.cadetYear);
    const times = list.map(r => r.updatedAt || r.createdAt).filter(Boolean).sort();
    const session = {
      date: first.date, cycle: 1, activityType: first.activityType || 'Parade', activityDescription: first.activityDescription || '',
      years: [...new Set(years)].sort(), groupLabel: labelOf(years),
      total: list.length, present, absent: list.length - present,
      photoUrls: [...new Set(list.flatMap(r => r.photoUrls || []))].slice(0, 8),
      geoLat: list.find(r => r.geoLat)?.geoLat ?? null, geoLng: list.find(r => r.geoLng)?.geoLng ?? null,
      markedBy: first.markedBy || '', markedByName: first.markedByName || '', isHistorical: !!first.isHistorical,
      createdAt: times[0] || new Date().toISOString(), updatedAt: times.at(-1) || new Date().toISOString(), legacy: true,
    };
    ops.push(b => b.set(db.collection('sessions').doc(id), session)); out.sessionsCreated++;
    for (const r of list) {
      const wasLeave = r.status === 'Leave'; if (wasLeave) out.leaveConverted++;
      const reason = norm(r.status) === 'Absent' ? (r.reason || r.remarks || (wasLeave ? 'Leave' : 'Not specified')) : '';
      ops.push(b => b.update(r.ref, { sessionId: id, cycle: 1, status: norm(r.status), reason }));
      r.status = norm(r.status); out.recordsUpdated++;
    }
  }
  // records that already have a session but still say "Leave"
  for (const r of recs.filter(x => x.sessionId && x.status === 'Leave')) {
    ops.push(b => b.update(r.ref, { status: 'Absent', reason: r.reason || r.remarks || 'Leave' })); r.status = 'Absent'; out.leaveConverted++;
  }

  // 2 ─ rebuild every person's counters from the records
  const byCadet = new Map();
  for (const r of recs) {
    if (!r.cadetId || !r.date || (r.cycle || 1) !== 1) continue;
    const s = byCadet.get(r.cadetId) || { total: 0, present: 0, absent: 0, months: {} };
    const ok = norm(r.status) === 'Present', mk = monthKey(r.date);
    s.total++; ok ? s.present++ : s.absent++;
    s.months[mk] = s.months[mk] || { t: 0 }; s.months[mk].t++; if (ok) s.months[mk].p = (s.months[mk].p || 0) + 1;
    byCadet.set(r.cadetId, s);
  }
  const users = await db.collection('users').get();
  for (const u of users.docs) {
    if (u.data().role !== 'cadet') continue;
    const upd = { stats: byCadet.get(u.id) || { total: 0, present: 0, absent: 0, months: {} } };
    if (u.data().benefit === undefined) upd.benefit = 0;
    ops.push(b => b.update(u.ref, upd)); out.usersUpdated++;
  }

  // 3 ─ settings document (keeps anything already there)
  ops.push(b => b.set(db.collection('settings').doc('main'), { currentCycle: 1, migratedAt: new Date().toISOString() }, { merge: true }));

  log(`${out.sessionsCreated} sessions, ${out.recordsUpdated} records, ${out.usersUpdated} people, ${out.leaveConverted} "Leave" converted`);
  if (!dryRun) await commit(db, ops);
  return { ...out, dryRun };
}
