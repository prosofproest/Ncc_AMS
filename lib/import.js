// Sheet -> database roster import (the sheet is where the unit types its cadet data).
import { db, Collections, commitInChunks } from '@/lib/firebase';
import { hashPassword } from '@/lib/auth';
import { readCadetsFromSheet, sheetsConfigured, pickCanonicalCadet } from '@/lib/sheets';
import { getAllUsers, invalidateUsers } from '@/lib/users';
import { getSettings, saveSettings, cleanEmail } from '@/lib/settings';
import { emptyStats } from '@/lib/stats';
import { normalizeRegNo } from '@/lib/keys.mjs';

const sameText = (a, b) => String(a ?? '') === String(b ?? '');

export async function importFromSheet() {
  const read = await readCadetsFromSheet();
  if (!read.success) return read;
  const sheet = read.cadets;
  if (sheet.length === 0)
    return { success: false, error: 'The sheet has no cadets, so nothing was imported (this protects against wiping the roster by accident).' };

  const settings = await getSettings();
  const pattern = settings.regNoPattern || '^KA\\d{4}(SD|SW)AF\\d{7}$';
  let regRe;
  try { regRe = new RegExp(pattern); } catch (_) { regRe = /^KA\d{4}(SD|SW)AF\d{7}$/; }

  const users = await getAllUsers({ fresh: true });

  const res = {
    created: 0,
    updated: 0,
    unchanged: 0,
    deactivated: 0,
    warnings: [...(read.warnings || [])],
    errors: [],
    duplicates: [],
  };

  const ops = [], now = new Date().toISOString();

  // 1. Check for duplicate database cadets by normalized Reg No
  const byRegGroups = new Map();
  users.filter(u => u.role === 'cadet').forEach(u => {
    const nr = normalizeRegNo(u.regNo);
    if (nr) {
      if (!byRegGroups.has(nr)) byRegGroups.set(nr, []);
      byRegGroups.get(nr).push(u);
    }
  });

  const canonicalByReg = new Map();
  const duplicateCadetIds = new Set();

  for (const [nr, group] of byRegGroups.entries()) {
    if (group.length > 1) {
      const canonical = pickCanonicalCadet(group);
      canonicalByReg.set(nr, canonical);
      for (const u of group) {
        if (u.id !== canonical.id) {
          duplicateCadetIds.add(u.id);
          res.duplicates.push({ id: u.id, name: u.name, regNo: u.regNo, duplicateOf: canonical.id });
          // Deactivate non-canonical duplicate: status duplicate-regno, duplicateOf set
          ops.push(b => b.update(db.collection(Collections.USERS).doc(u.id), {
            isActive: false,
            status: 'duplicate-regno',
            duplicateOf: canonical.id,
            tokenVersion: Date.now(),
            updatedAt: now,
          }));
          res.deactivated++;
        }
      }
    } else {
      canonicalByReg.set(nr, group[0]);
    }
  }

  const byName = new Map();
  users.filter(u => u.role === 'cadet' && !duplicateCadetIds.has(u.id)).forEach(u => {
    const k = `${u.role}|${u.name.toLowerCase()}`;
    if (!byName.has(k)) byName.set(k, u);
  });

  // 2. Import warnings (never block)
  // - duplicate Reg No inside the sheet (list the names)
  const sheetByReg = new Map();
  sheet.forEach(c => {
    const nr = normalizeRegNo(c.regNo);
    if (nr) {
      if (!sheetByReg.has(nr)) sheetByReg.set(nr, []);
      sheetByReg.get(nr).push(c.name);
    }
  });
  sheetByReg.forEach((names, nr) => {
    if (names.length > 1) {
      res.warnings.push(`Duplicate Reg No. ${nr} in the sheet (${names.join(', ')})`);
    }
  });

  // - e-mail or phone shared by two cadets
  const sheetByEmail = new Map();
  const sheetByPhone = new Map();
  sheet.forEach(c => {
    const em = cleanEmail(c.email);
    if (em) {
      if (!sheetByEmail.has(em)) sheetByEmail.set(em, []);
      sheetByEmail.get(em).push(c.name);
    }
    const ph = String(c.phone || '').trim().replace(/\s+/g, '');
    if (ph) {
      if (!sheetByPhone.has(ph)) sheetByPhone.set(ph, []);
      sheetByPhone.get(ph).push(c.name);
    }
  });
  sheetByEmail.forEach((names, em) => {
    if (names.length > 1) {
      res.warnings.push(`Email "${em}" shared by ${names.join(', ')}`);
    }
  });
  sheetByPhone.forEach((names, ph) => {
    if (names.length > 1) {
      res.warnings.push(`Phone "${ph}" shared by ${names.join(', ')}`);
    }
  });

  // - per-cadet checks: format, type mismatch, missing email, missing phone
  sheet.forEach(c => {
    if (c.regNo) {
      const nr = normalizeRegNo(c.regNo);
      if (!regRe.test(nr)) {
        res.warnings.push(`Reg No "${c.regNo}" does not match pattern (${pattern}) (${c.name})`);
      }
      const hasSD = nr.includes('SD');
      const hasSW = nr.includes('SW');
      if (hasSD && c.type === 'SW') {
        res.warnings.push(`Type mismatch: Reg No ${c.regNo} contains SD but type is SW (${c.name})`);
      }
      if (hasSW && c.type === 'SD') {
        res.warnings.push(`Type mismatch: Reg No ${c.regNo} contains SW but type is SD (${c.name})`);
      }
    }
    if (!c.email) {
      res.warnings.push(`Missing email (${c.name}, ${c.regNo || 'no Reg No'})`);
    }
    if (!String(c.phone || '').trim()) {
      res.warnings.push(`Missing phone (${c.name}, ${c.regNo || 'no Reg No'})`);
    }
  });

  // 3. Match sheet rows and update/create database cadets
  const seen = new Set();
  const seenReg = new Set();

  for (const c of sheet) {
    const normReg = normalizeRegNo(c.regNo);
    if (normReg) {
      if (seenReg.has(normReg)) {
        continue;
      }
      seenReg.add(normReg);
    }
    let u = normReg ? canonicalByReg.get(normReg) : null;
    if (!u) {
      const cand = byName.get(`cadet|${c.name.toLowerCase()}`);
      if (cand && (!cand.regNo || !c.regNo)) u = cand;
    }

    if (!u) {
      const pw = normReg || c.name;
      const ref = db.collection(Collections.USERS).doc();
      const data = {
        name: c.name, regNo: normReg || null, username: null, role: 'cadet', year: c.year, type: c.type, email: c.email || '', phone: c.phone || '',
        passwordHash: await hashPassword(pw), mustChangePassword: true, otpRequired: true, isActive: true, discharged: false,
        stats: emptyStats(), benefit: 0, fromSheet: true, createdAt: now,
      };
      ops.push(b => b.set(ref, data));
      seen.add(ref.id);
      res.created++;
      continue;
    }

    seen.add(u.id);
    const upd = {};
    if (!sameText(u.name, c.name)) upd.name = c.name;
    if (normReg && !sameText(normalizeRegNo(u.regNo), normReg)) upd.regNo = normReg;
    if (u.year !== c.year) upd.year = c.year;
    if (!sameText(u.type, c.type)) upd.type = c.type;
    if (c.email !== undefined && !sameText(u.email || '', c.email || '')) upd.email = c.email || '';
    if (!sameText(u.phone || '', c.phone || '')) upd.phone = c.phone || '';
    if (!u.fromSheet) upd.fromSheet = true;
    if (u.status === 'removed-from-sheet' && !u.discharged) { upd.isActive = true; upd.status = 'active'; }
    if (Object.keys(upd).length) {
      upd.updatedAt = now;
      ops.push(b => b.update(db.collection(Collections.USERS).doc(u.id), upd));
      res.updated++;
    } else res.unchanged++;
  }

  // 4. Decide "present" by document id only (seen.has(u.id)); remove every regNo-based presence check.
  for (const u of users) {
    if (!u.fromSheet || !u.isActive || u.discharged || u.role !== 'cadet') continue;
    if (duplicateCadetIds.has(u.id)) continue;
    const present = seen.has(u.id);
    if (!present) {
      ops.push(b => b.update(db.collection(Collections.USERS).doc(u.id), { isActive: false, status: 'removed-from-sheet', updatedAt: now }));
      res.deactivated++;
    }
  }

  await commitInChunks(ops, 400);
  invalidateUsers();

  const counts = {
    created: res.created,
    updated: res.updated,
    unchanged: res.unchanged,
    deactivated: res.deactivated,
    totalCadets: sheet.length,
    totalWarnings: res.warnings.length,
  };
  const lastImportReport = {
    counts,
    warnings: res.warnings.slice(0, 60),
    importedAt: now,
  };
  await saveSettings({ lastSheetImportAt: now, lastImportReport });
  return { success: true, ...res, lastImportReport };
}

// Throttled automatic import: at most one every 10 minutes, claimed before it starts.
export async function maybeAutoImport() {
  if (!sheetsConfigured()) return null;
  const s = await getSettings();
  if (s.lastSheetImportAt && Date.now() - Date.parse(s.lastSheetImportAt) < 10 * 60000) return null;
  await saveSettings({ lastSheetImportAt: new Date().toISOString() });
  return importFromSheet();
}
