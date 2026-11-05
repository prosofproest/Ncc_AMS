// Environment values are often pasted with surrounding quotes or literal "\n" (Vercel, .env files, JSON keys).
// These helpers make every variant work.
export function cleanKey(v) {
  let k = String(v ?? '').trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\\n/g, '\n').trim();
}
export const cleanEnv = v => {
  let s = String(v ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s.trim();
};

// GOOGLE_SHEET_ID: accept the bare id OR the whole sheet address (…/spreadsheets/d/<id>/edit)
export const sheetId = v => {
  const s = cleanEnv(v);
  const m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : s;
};

// Regimental numbers are normalized: trimmed, uppercase, and all whitespace removed.
export function normalizeRegNo(v) {
  return String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

