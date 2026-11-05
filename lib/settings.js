import { db, Collections } from '@/lib/firebase';
import { cached, invalidate } from '@/lib/cache';
import { academicLabel, todayIST } from '@/lib/time';

export const DEFAULT_REASONS = [
  'Sick / Medical',
  'Family function',
  'Exam / Academic duty',
  'Out of station',
  'Late arrival',
  'No information',
];

export const DEFAULT_MAIL_ROUTING = {
  parade:  { sir: true,  backup: true },
  changes: { sir: true,  backup: true },
  weekly:  { sir: true,  backup: true },
  monthly: { sir: true,  backup: true },
  backup:  { sir: false, backup: true },
};

export function defaultSettings() {
  return {
    sirEmail:           process.env.EMAIL_TO || '',
    backupEmail:        process.env.EMAIL_CC || '',
    mailRouting:        DEFAULT_MAIL_ROUTING,
    absentReasons:      DEFAULT_REASONS,
    absenceMailEnabled: true,
    changeMailEnabled:  true,
    monthlyMailEnabled: true,
    weeklyBackupMailEnabled: true,
    notifyAdminOnReturn: true,
    notifyCtoOnAdminApproval: false,
    thresholdPct:       75,
    currentCycle:       1,
    cycleLabel:         academicLabel(todayIST()),
    cycleStartedAt:     null,
    lastSheetImportAt:  null,
    lastImportReport:   null,
    regNoPattern:       '^KA\\d{4}(SD|SW)AF\\d{7}$',
    requirePhotos:      true,
  };
}

const DOC = () => db.collection(Collections.SETTINGS).doc('main');

export async function getSettings({ fresh = false } = {}) {
  const load = async () => {
    const snap = await DOC().get();
    const data = snap.exists ? snap.data() : {};
    const mr = data.mailRouting || {};
    const mailRouting = {
      parade:  { sir: mr.parade?.sir !== false,  backup: mr.parade?.backup !== false },
      changes: { sir: mr.changes?.sir !== false, backup: mr.changes?.backup !== false },
      weekly:  { sir: mr.weekly?.sir !== false,  backup: mr.weekly?.backup !== false },
      monthly: { sir: mr.monthly?.sir !== false, backup: mr.monthly?.backup !== false },
      backup:  { sir: false, backup: mr.backup?.backup !== false },
    };
    return { ...defaultSettings(), ...data, mailRouting };
  };
  if (fresh) { invalidate('settings'); return load(); }
  return cached('settings', 30_000, load);
}

export async function saveSettings(patch) {
  await DOC().set(patch, { merge: true });
  invalidate('settings');
  return getSettings({ fresh: true });
}

export function cleanEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 120 ? s : '';
}

// Recipients for official mails (Sir + backup), de-duplicated according to mail routing
export function officialRecipients(settings = {}, kind) {
  if (!kind) {
    const list = [settings.sirEmail, settings.backupEmail].map(cleanEmail).filter(Boolean);
    return [...new Set(list)];
  }
  const routing = settings.mailRouting?.[kind] || DEFAULT_MAIL_ROUTING[kind] || { sir: true, backup: true };
  const addrs = [];
  if (routing.sir && kind !== 'backup') {
    const s = cleanEmail(settings.sirEmail);
    if (s) addrs.push(s);
  }
  if (routing.backup) {
    const b = cleanEmail(settings.backupEmail);
    if (b) addrs.push(b);
  }
  return [...new Set(addrs)];
}
