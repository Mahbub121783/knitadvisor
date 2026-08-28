/**
 * Idempotent seeding, run once at startup after migrations.
 *
 * This replaces initAdminDatabase()/initVizDatabase() in the old
 * config/database.js, which ran CREATE TABLE IF NOT EXISTS on every boot.
 * Structure now belongs to migrations; only data lives here, and only data that
 * the app genuinely cannot start without.
 */
const { queryOne } = require('./client');
const vizRepo = require('./repositories/viz-repo');
const adminRepo = require('./repositories/admin-repo');
const { hashPassword, generatePassword } = require('../middleware/password');

async function seedAdminUser() {
  const count = await adminRepo.users.count();
  if (count > 0) return { admin_seeded: false };

  // The old seed used the literal password 'knitadvisor2026', hardcoded in a
  // public repository — the admin panel shipped with a published password.
  const username = process.env.ADMIN_SEED_USER || 'knitadvisor';
  const password = process.env.ADMIN_SEED_PASSWORD || generatePassword(16);

  await adminRepo.users.create(username, hashPassword(password));
  console.log('[Seed] Admin user "%s" created with password: %s', username, password);
  console.log('[Seed] ^ Change it immediately. This is printed only on first seed.');
  return { admin_seeded: true, username };
}

async function seedVizConfigs() {
  const inserted = await vizRepo.seedDefaults();
  if (inserted) console.log(`[Seed] viz_configs: ${inserted} default row(s) inserted`);
  return { viz_configs_inserted: inserted };
}

/**
 * Verifies migrations have run. The app should refuse to serve against a
 * schema it does not recognise rather than failing one request at a time
 * with confusing "relation does not exist" errors.
 */
async function assertSchemaReady() {
  const row = await queryOne(
    `SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN
       ('admin_users','ai_provider_stats','query_logs','result_cache','viz_configs')`
  );
  if (!row || row.n < 5) {
    throw new Error(
      `Schema incomplete (${row ? row.n : 0}/5 core tables found). ` +
      'Run: node db/migrate.js'
    );
  }
}

async function run() {
  await assertSchemaReady();
  const results = { ...(await seedAdminUser()), ...(await seedVizConfigs()) };
  return results;
}

module.exports = { run, seedAdminUser, seedVizConfigs, assertSchemaReady };
