#!/usr/bin/env node
/**
 * Reset the admin password when nobody can log in to change it the normal way.
 *
 * The supported path is the panel's Settings tab, which requires the CURRENT
 * password. There is deliberately no "forgot password" flow — the panel has one
 * account, no email on file and nothing to send a reset link to, so a recovery
 * flow would be a second way in guarded by nothing. That leaves this: a script
 * that has to be run by someone already holding shell access to the server and
 * the .env beside it.
 *
 * It takes a HASH, not a password. The plaintext is generated and hashed on the
 * operator's own machine and only the scrypt hash travels, so the password
 * never lands in a shell history, a psql query string, a slow-query log or a
 * connection log. That is the same reason pgcrypto is left unused here even
 * though it is available.
 *
 *   node scripts/reset-admin-password.js --hash 'scrypt$16384$<salt>$<key>'
 *   node scripts/reset-admin-password.js --hash-file /path/to/hash.txt
 *
 * Sessions are deleted afterwards, matching what the Settings endpoint does:
 * a password reset is most often a reaction to a suspected compromise, and
 * leaving old tokens alive would defeat it.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { query, queryOne } = require('../db/client');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

(async () => {
  const hashFile = arg('--hash-file');
  const hash = (hashFile ? fs.readFileSync(hashFile, 'utf8') : arg('--hash') || '').trim();

  // Reject anything that is not the current stored format. The table also has a
  // CHECK that refuses bare SHA-256, but failing here says why.
  if (!/^scrypt\$\d+\$[0-9a-f]{32,}\$[0-9a-f]{64}$/.test(hash)) {
    console.error('Expected a hash in the form scrypt$<N>$<saltHex>$<keyHex>.');
    console.error('Generate it where the password is chosen, never on the server:');
    console.error("  node -e \"console.log(require('./middleware/password').hashPassword('...'))\"");
    process.exit(1);
  }

  const user = await queryOne('SELECT id, username FROM admin_users ORDER BY id LIMIT 1');
  if (!user) {
    console.error('No admin user exists. Run db/seed.js to create one.');
    process.exit(1);
  }

  await query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
  const cleared = await query('DELETE FROM admin_sessions');

  console.log(`Password reset for "${user.username}" (id ${user.id}).`);
  console.log(`${cleared.rowCount || 0} session(s) signed out.`);
  process.exit(0);
})().catch(err => {
  console.error('Reset failed:', err.message);
  process.exit(1);
});
