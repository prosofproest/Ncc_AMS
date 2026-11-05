export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getSettings, saveSettings, cleanEmail, DEFAULT_MAIL_ROUTING } from '@/lib/settings';
import { cleanText } from '@/lib/attendance';
import { db, Collections } from '@/lib/firebase';
import { sendChangeLog } from '@/lib/email';

const PUBLIC = s => ({
  sirEmail: s.sirEmail, backupEmail: s.backupEmail, absentReasons: s.absentReasons,
  mailRouting: s.mailRouting || DEFAULT_MAIL_ROUTING,
  absenceMailEnabled: s.absenceMailEnabled, changeMailEnabled: s.changeMailEnabled, monthlyMailEnabled: s.monthlyMailEnabled,
  weeklyBackupMailEnabled: s.weeklyBackupMailEnabled !== false,
  notifyAdminOnReturn: s.notifyAdminOnReturn !== false, notifyCtoOnAdminApproval: s.notifyCtoOnAdminApproval === true,
  thresholdPct: s.thresholdPct, currentCycle: s.currentCycle, cycleLabel: s.cycleLabel, cycleStartedAt: s.cycleStartedAt, lastSheetImportAt: s.lastSheetImportAt,
  lastImportReport: s.lastImportReport || null,
  regNoPattern: s.regNoPattern || '^KA\\d{4}(SD|SW)AF\\d{7}$',
  requirePhotos: s.requirePhotos !== false,
});

export async function GET(request) {
  const { payload, error } = await authenticate(request);
  if (error) return error;
  if (!(can(payload, 'canManageSettings') || can(payload, 'canViewAllAttendance'))) return NextResponse.json({ error: 'No permission.' }, { status: 403 });
  return NextResponse.json({ settings: PUBLIC(await getSettings({ fresh: true })) });
}

export async function PUT(request) {
  const { payload, error } = await authenticate(request, { perm: 'canManageSettings' });
  if (error) return error;
  const b = await request.json().catch(() => ({}));
  const prev = await getSettings({ fresh: true });
  const patch = {};
  for (const k of ['sirEmail', 'backupEmail']) {
    if (b[k] === undefined) continue;
    const raw = String(b[k] || '').trim();
    const e = cleanEmail(raw);
    if (raw && !e) return NextResponse.json({ error: `${k === 'sirEmail' ? "Sir's" : 'Backup'} email is not valid.` }, { status: 400 });
    patch[k] = e;
  }
  if (b.absentReasons !== undefined) {
    const list = [...new Set((Array.isArray(b.absentReasons) ? b.absentReasons : []).map(r => cleanText(r, 40)).filter(Boolean))].slice(0, 15);
    if (!list.length) return NextResponse.json({ error: 'Keep at least one absence reason.' }, { status: 400 });
    patch.absentReasons = list;
  }
  for (const k of ['absenceMailEnabled', 'changeMailEnabled', 'monthlyMailEnabled', 'weeklyBackupMailEnabled', 'notifyAdminOnReturn', 'notifyCtoOnAdminApproval']) if (b[k] !== undefined) patch[k] = b[k] === true;
  if (b.requirePhotos !== undefined) {
    patch.requirePhotos = b.requirePhotos === true;
  }
  if (b.mailRouting !== undefined) {
    if (!b.mailRouting || typeof b.mailRouting !== 'object' || Array.isArray(b.mailRouting)) {
      return NextResponse.json({ error: 'Invalid mail routing settings.' }, { status: 400 });
    }
    const ALLOWED_KINDS = ['parade', 'changes', 'weekly', 'monthly', 'backup'];
    for (const [k, v] of Object.entries(b.mailRouting)) {
      if (!ALLOWED_KINDS.includes(k) || !v || typeof v !== 'object' || Array.isArray(v)) {
        return NextResponse.json({ error: 'Invalid mail routing settings.' }, { status: 400 });
      }
      for (const [rk, rv] of Object.entries(v)) {
        if (!['sir', 'backup'].includes(rk) || typeof rv !== 'boolean') {
          return NextResponse.json({ error: 'Invalid mail routing settings.' }, { status: 400 });
        }
      }
    }
    const prevMr = prev.mailRouting || DEFAULT_MAIL_ROUTING;
    patch.mailRouting = {
      parade:  { sir: b.mailRouting.parade?.sir !== undefined ? b.mailRouting.parade.sir === true : prevMr.parade.sir, backup: b.mailRouting.parade?.backup !== undefined ? b.mailRouting.parade.backup === true : prevMr.parade.backup },
      changes: { sir: b.mailRouting.changes?.sir !== undefined ? b.mailRouting.changes.sir === true : prevMr.changes.sir, backup: b.mailRouting.changes?.backup !== undefined ? b.mailRouting.changes.backup === true : prevMr.changes.backup },
      weekly:  { sir: b.mailRouting.weekly?.sir !== undefined ? b.mailRouting.weekly.sir === true : prevMr.weekly.sir, backup: b.mailRouting.weekly?.backup !== undefined ? b.mailRouting.weekly.backup === true : prevMr.weekly.backup },
      monthly: { sir: b.mailRouting.monthly?.sir !== undefined ? b.mailRouting.monthly.sir === true : prevMr.monthly.sir, backup: b.mailRouting.monthly?.backup !== undefined ? b.mailRouting.monthly.backup === true : prevMr.monthly.backup },
      backup:  { sir: false, backup: b.mailRouting.backup?.backup !== undefined ? b.mailRouting.backup.backup === true : prevMr.backup.backup },
    };
  }
  if (b.thresholdPct !== undefined) {
    const t = parseInt(b.thresholdPct, 10);
    if (!(t >= 1 && t <= 100)) return NextResponse.json({ error: 'Required attendance must be between 1 and 100.' }, { status: 400 });
    patch.thresholdPct = t;
  }
  if (b.regNoPattern !== undefined) {
    const p = String(b.regNoPattern || '').trim();
    if (p) {
      try {
        new RegExp(p);
        patch.regNoPattern = p;
      } catch (_) {
        return NextResponse.json({ error: 'Invalid Reg No pattern regex.' }, { status: 400 });
      }
    } else {
      patch.regNoPattern = '^KA\\d{4}(SD|SW)AF\\d{7}$';
    }
  }

  const updated = await saveSettings(patch);

  if (patch.mailRouting !== undefined && JSON.stringify(patch.mailRouting) !== JSON.stringify(prev.mailRouting)) {
    const note = 'Mail routing updated';
    const changes = [{ name: 'mailRouting', regNo: '', from: JSON.stringify(prev.mailRouting || DEFAULT_MAIL_ROUTING), to: JSON.stringify(patch.mailRouting), reason: note }];
    await db.collection(Collections.AUDIT_LOG).add({
      type: 'settings',
      by: payload.id,
      byName: payload.name,
      at: new Date().toISOString(),
      note,
      changes,
    }).catch(err => console.error('[SETTINGS:AUDIT]', err.message));
    sendChangeLog({
      settings: updated,
      kind: 'edit',
      byName: payload.name,
      date: new Date().toISOString().slice(0, 10),
      activity: 'Settings change',
      changes,
      note,
    }).catch(err => console.error('[SETTINGS:CHANGELOG]', err.message));
  }

  if (patch.requirePhotos !== undefined && patch.requirePhotos !== (prev.requirePhotos !== false)) {
    const note = patch.requirePhotos ? 'Parade photos required for live attendance' : 'Parade photos NOT required (emergency mode enabled)';
    const changes = [{ name: 'requirePhotos', regNo: '', from: String(prev.requirePhotos !== false), to: String(patch.requirePhotos), reason: note }];
    await db.collection(Collections.AUDIT_LOG).add({
      type: 'settings',
      by: payload.id,
      byName: payload.name,
      at: new Date().toISOString(),
      note,
      changes,
    }).catch(err => console.error('[SETTINGS:AUDIT]', err.message));
    sendChangeLog({
      settings: updated,
      kind: 'edit',
      byName: payload.name,
      date: new Date().toISOString().slice(0, 10),
      activity: 'Settings change',
      changes,
      note,
    }).catch(err => console.error('[SETTINGS:CHANGELOG]', err.message));
  }

  return NextResponse.json({ success: true, settings: PUBLIC(updated) });
}
