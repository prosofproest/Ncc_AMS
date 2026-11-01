import bcrypt from 'bcryptjs';

/**
 * Looks up a user account in Firestore matching:
 * - username (lower-case)
 * - email (lower-case)
 * - regNo (upper-case)
 *
 * @param {object} db - Firestore database instance
 * @param {string} identifier - Search query
 * @returns {Promise<{ matches: Array<object>, error?: string }>}
 */
export async function lookupAccount(db, identifier) {
  const id = String(identifier || '').trim();
  if (!id) {
    return { matches: [], error: 'Identifier is required' };
  }

  const lower = id.toLowerCase();
  const upper = id.toUpperCase();

  const [byUsername, byEmail, byRegNo] = await Promise.all([
    db.collection('users').where('username', '==', lower).get(),
    db.collection('users').where('email', '==', lower).get(),
    db.collection('users').where('regNo', '==', upper).get(),
  ]);

  const matches = new Map();
  for (const doc of byUsername?.docs || []) {
    matches.set(doc.id, { id: doc.id, ...doc.data() });
  }
  for (const doc of byEmail?.docs || []) {
    matches.set(doc.id, { id: doc.id, ...doc.data() });
  }
  for (const doc of byRegNo?.docs || []) {
    matches.set(doc.id, { id: doc.id, ...doc.data() });
  }

  // Fallback: check doc id in case document key matches identifier directly
  if (matches.size === 0) {
    const docSnap = await db.collection('users').doc(lower).get();
    if (docSnap.exists && docSnap.data()) {
      matches.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    }
  }

  return { matches: [...matches.values()] };
}

/**
 * Resets user password securely.
 *
 * Requirements:
 * - Looks up account by username (lower), email (lower), or regNo (upper).
 * - Refuses when not found or ambiguous (multiple matches).
 * - Requires --yes confirmation.
 * - Requires NEW_PASSWORD of at least 8 characters.
 * - Stores bcrypt (cost 10) hash. Never stores plaintext.
 * - Sets mustChangePassword: true, failedLogins: 0, lockedUntil: null, tokenVersion: Date.now().
 * - Writes an audit_log entry: type: 'password-reset', byName: 'recovery script'.
 *
 * @param {object} db - Firestore database
 * @param {string|object} identifierOrOpts
 * @param {object} [maybeOpts]
 */
export async function resetPassword(db, identifierOrOpts, maybeOpts) {
  let identifier;
  let newPassword;
  let yes;
  let log = null;

  if (typeof identifierOrOpts === 'object' && identifierOrOpts !== null) {
    identifier = identifierOrOpts.identifier;
    newPassword = identifierOrOpts.newPassword;
    yes = identifierOrOpts.yes ?? identifierOrOpts.confirm;
    log = identifierOrOpts.log;
  } else {
    identifier = identifierOrOpts;
    newPassword = maybeOpts?.newPassword;
    yes = maybeOpts?.yes ?? maybeOpts?.confirm;
    log = maybeOpts?.log;
  }

  const { matches, error } = await lookupAccount(db, identifier);
  if (error) {
    throw new Error(error);
  }
  if (!matches || matches.length === 0) {
    throw new Error(`Account not found for identifier: ${identifier}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous identifier: ${matches.length} accounts match "${identifier}". Refusing to reset.`);
  }

  const user = matches[0];

  // Print name and role
  if (typeof log === 'function') {
    log(`Account found: ${user.name || user.id} (Role: ${user.role || 'cadet'})`);
  }

  if (!yes) {
    throw new Error('--yes flag is required to confirm password reset');
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    throw new Error('NEW_PASSWORD must be at least 8 characters long');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const now = Date.now();

  await db.collection('users').doc(user.id).update({
    passwordHash,
    mustChangePassword: true,
    failedLogins: 0,
    lockedUntil: null,
    tokenVersion: now,
  });

  await db.collection('audit_log').add({
    type: 'password-reset',
    byName: 'recovery script',
    at: new Date().toISOString(),
    userId: user.id,
    targetName: user.name || user.id,
    targetRole: user.role || 'cadet',
  });

  return {
    success: true,
    user: {
      id: user.id,
      name: user.name || user.id,
      role: user.role || 'cadet',
    },
  };
}
