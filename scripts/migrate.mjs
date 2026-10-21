import { cleanKey } from '../lib/keys.mjs';
// Usage:  npm run migrate            (applies)
//         npm run migrate -- --dry   (only shows what would change)
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { migrateLegacy } from '../lib/migrate.mjs';

const need = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'].filter(k => !process.env[k]);
if (need.length) { console.error(`Missing ${need.join(', ')} — put them in .env.local`); process.exit(1); }
const app = initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: cleanKey(process.env.FIREBASE_PRIVATE_KEY) }) });
const dry = process.argv.includes('--dry');
migrateLegacy(getFirestore(app), { dryRun: dry, log: m => console.log('•', m) })
  .then(r => { console.log(dry ? '\nDry run — nothing was changed.' : '\n✅ Migration finished.', r); process.exit(0); })
  .catch(e => { console.error('Migration failed:', e); process.exit(1); });
