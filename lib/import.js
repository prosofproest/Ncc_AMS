// Sheet -> database roster import (the sheet is where the unit types its cadet data).
import { db, Collections, commitInChunks } from '@/lib/firebase';
import { hashPassword } from '@/lib/auth';
import { readCadetsFromSheet, sheetsConfigured } from '@/lib/sheets';
import { getAllUsers, invalidateUsers } from '@/lib/users';
import { getSettings, saveSettings } from '@/lib/settings';
import { emptyStats } from '@/lib/stats';

const sameText = (a, b) => String(a ?? '') === String(b ?? '');

export async function importFromSheet() {
  const read = await readCadetsFromSheet();
  if (!read.success) return read;
  const sheet = read.cadets;
  if (sheet.length === 0)
    return { success: false, error: 'The sheet has no cadets, so nothing was imported (this protects against wiping the roster by accident).' };

  const users = await getAllUsers({ fresh: true });
  const byReg = new Map(users.filter(u => u.role === 'cadet' && u.regNo).map(u => [u.regNo, u]));
  const byName = new Map();
  users.filter(u => u.role === 'cadet').forEach(u => { const k = `${u.role}|${u.name.toLowerCase()}`; if (!byName.has(k)) byName.set(k, u); });

  const res = { created: 0, updated: 0, unchanged: 0, deactivated: 0, warnings: read.warnings || [], errors: [] };
  const ops = [], seen = new Set(), now = new Date().toISOString();
  const seenReg = new Set();

  for (const c of sheet) {
    if (c.regNo) {
      if (seenReg.has(c.regNo)) { res.warnings.push(`Duplicate Reg No. ${c.regNo} in the sheet (${c.name}) — second one ignored.`); continue; }
      seenReg.add(c.regNo);
    }
    let u = c.regNo ? byReg.get(c.regNo) : null;
    if (!u) { const cand = byName.get(`${c.role}|${c.name.toLowerCase()}`); if (cand && (!cand.regNo || !c.regNo)) u = cand; }

    if (!u) {
      const pw = c.regNo || c.name;
      const ref = db.collection(Collections.USERS).doc();
      const data = {
        name: c.name, regNo: c.regNo || null, username: null, role: 'cadet', year: c.year, type: c.type, email: c.email || '', phone: c.phone || '',
        passwordHash: await hashPassword(pw), mustChangePassword: true, otpRequired: true, isActive: true, discharged: false,
        stats: emptyStats(), benefit: 0, fromSheet: true, createdAt: now,
      };
      ops.push(b => b.set(ref, data));
      res.created++;
      continue;
    }
    seen.add(u.id);
    const upd = {};
    if (!sameText(u.name, c.name)) upd.name = c.name;
    if (c.regNo && !sameText(u.regNo, c.regNo)) upd.regNo = c.regNo;
    if (u.year !== c.year) upd.year = c.year;
    if (!sameText(u.type, c.type)) upd.type = c.type;
    if (c.email !== undefined && !sameText(u.email || '', c.email || '')) upd.email = c.email || '';
    if (!sameText(u.phone || '', c.phone || '')) upd.phone = c.phone || '';
    if (!u.fromSheet) upd.fromSheet = true;
    if (u.status === 'removed-from-sheet' && !u.discharged) { upd.isActive = true; upd.status = 'active'; }   // added back to the sheet
    if (Object.keys(upd).length) {
      upd.updatedAt = now;
      ops.push(b => b.update(db.collection(Collections.USERS).doc(u.id), upd));
      res.updated++;
    } else res.unchanged++;
  }

  // People who were imported earlier but are no longer in the sheet are deactivated (never deleted —
  // their attendance history must stay intact).
  for (const u of users) {
    if (!u.fromSheet || !u.isActive || u.discharged || u.role !== 'cadet') continue;
    const present = seen.has(u.id) || [...seenReg].includes(u.regNo);
    const created = sheet.some(c => c.regNo && c.regNo === u.regNo);
    if (!present && !created) {
      ops.push(b => b.update(db.collection(Collections.USERS).doc(u.id), { isActive: false, status: 'removed-from-sheet', updatedAt: now }));
      res.deactivated++;
    }
  }
  await commitInChunks(ops, 400);
  invalidateUsers();
  await saveSettings({ lastSheetImportAt: now });
  return { success: true, ...res };
}

// Throttled automatic import: at most one every 10 minutes, claimed before it starts.
export async function maybeAutoImport() {
  if (!sheetsConfigured()) return null;
  const s = await getSettings();
  if (s.lastSheetImportAt && Date.now() - Date.parse(s.lastSheetImportAt) < 10 * 60000) return null;
  await saveSettings({ lastSheetImportAt: new Date().toISOString() });
  return importFromSheet();
}
