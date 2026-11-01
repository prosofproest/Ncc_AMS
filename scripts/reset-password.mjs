import { cleanKey } from '../lib/keys.mjs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { lookupAccount, resetPassword } from '../lib/resetPassword.mjs';

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const positionalArgs = args.filter(a => !a.startsWith('--'));

  // Ensure password is never passed as a CLI argument
  const badArg = args.find(a => a.startsWith('--password') || a.startsWith('-p'));
  if (badArg) {
    console.error('Error: Do NOT pass passwords as command line arguments. Provide it via NEW_PASSWORD environment variable.');
    process.exit(1);
  }

  if (positionalArgs.length === 0) {
    console.error('Usage: NEW_PASSWORD=\'...\' npm run reset-password -- <username | e-mail | regNo> --yes');
    process.exit(1);
  }

  const identifier = positionalArgs[0];
  const newPassword = process.env.NEW_PASSWORD;

  if (!newPassword) {
    console.error('Error: NEW_PASSWORD environment variable is missing.');
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error('Error: NEW_PASSWORD must be at least 8 characters long.');
    process.exit(1);
  }

  const need = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'].filter(k => !process.env[k]);
  if (need.length) {
    console.error(`Missing ${need.join(', ')} — put them in .env.local`);
    process.exit(1);
  }

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: cleanKey(process.env.FIREBASE_PRIVATE_KEY),
        }),
      });

  const db = getFirestore(app);

  // Look up account and print name and role
  const { matches, error } = await lookupAccount(db, identifier);
  if (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }

  if (!matches || matches.length === 0) {
    console.error(`Account not found for identifier: ${identifier}`);
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(`Ambiguous identifier: ${matches.length} accounts match "${identifier}". Refusing to reset.`);
    process.exit(1);
  }

  const account = matches[0];
  console.log(`Found account: ${account.name || account.id} (Role: ${account.role || 'cadet'})`);

  if (!yes) {
    console.error('Error: Confirmation required. Add --yes to proceed.');
    process.exit(1);
  }

  await resetPassword(db, {
    identifier,
    newPassword,
    yes: true,
  });

  console.log(`Password reset successfully for ${account.name || account.id} (${account.role || 'cadet'}).`);
  console.log('Account has been signed out everywhere and must change password on next sign-in.');
  process.exit(0);
}

main().catch(err => {
  console.error('Reset failed:', err.message);
  process.exit(1);
});
