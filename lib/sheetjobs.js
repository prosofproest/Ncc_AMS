// Glue between the database and the sheet writers (kept out of the routes so every
// route refreshes the sheet summaries the same way).
import { getAllUsers } from '@/lib/users';
import { getSettings } from '@/lib/settings';
import * as sheets from '@/lib/sheets';

export async function refreshSheetSummaries() {
  const [users, settings] = await Promise.all([getAllUsers({ fresh: true }), getSettings()]);
  const a = await sheets.writeSummaries(users, { thresholdPct: settings.thresholdPct });
  if (!a.success) return a;
  return sheets.writeRosterStats(users);
}
