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

export function defaultSettings() {
  return {
    sirEmail:           process.env.EMAIL_TO || '',
    backupEmail:        process.env.EMAIL_CC || '',
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
    requirePhotos:      true,
  };
}

const DOC = () => db.collection(Collections.SETTINGS).doc('main');

export async function getSettings({ fresh = false } = {}) {
  const load = async () => {
    const snap = await DOC().get();
    return { ...defaultSettings(), ...(snap.exists ? snap.data() : {}) };
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

// Recipients for official mails (Sir + backup), de-duplicated
export function officialRecipients(settings) {
  const list = [settings.sirEmail, settings.backupEmail].map(cleanEmail).filter(Boolean);
  return [...new Set(list)];
}
