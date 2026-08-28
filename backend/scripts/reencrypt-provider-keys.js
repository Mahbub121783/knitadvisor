/**
 * One-shot migration: re-encrypt ai_provider_keys from the old hardcoded
 * secret ('knitadvisor-secret' + salt 'salt', both published in this repo) to
 * the secret in API_KEY_ENCRYPTION_SECRET.
 *
 * Run once, on the server, after adding API_KEY_ENCRYPTION_SECRET to .env:
 *   node scripts/reencrypt-provider-keys.js          # dry run — reports only
 *   node scripts/reencrypt-provider-keys.js --apply  # writes
 *
 * Rows already readable under the new secret are left alone, so re-running is
 * safe. Note that rotating the encryption secret does NOT make the old provider
 * keys safe: they were decryptable by anyone with the repo and the database, so
 * every provider key should also be regenerated at the provider's own console.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { query } = require('../config/database');
const { encryptApiKey, decryptApiKey } = require('../ai/provider-manager-v2');

const APPLY = process.argv.includes('--apply');

async function main() {
  const rows = await query('SELECT id, provider_id, key_index, api_key_encrypted FROM ai_provider_keys');
  console.log(`[Reencrypt] ${rows.length} key row(s) found. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  let migrated = 0, alreadyNew = 0, failed = 0;

  for (const row of rows) {
    // Already readable with the current secret? Nothing to do.
    try {
      decryptApiKey(row.api_key_encrypted);
      alreadyNew++;
      console.log(`  id=${row.id} provider=${row.provider_id} — already on new secret, skipped`);
      continue;
    } catch { /* fall through to legacy attempt */ }

    let plaintext;
    try {
      plaintext = decryptApiKey(row.api_key_encrypted, { legacy: true });
    } catch (err) {
      failed++;
      console.error(`  id=${row.id} provider=${row.provider_id} — FAILED to decrypt with either secret: ${err.message}`);
      continue;
    }

    if (APPLY) {
      await query('UPDATE ai_provider_keys SET api_key_encrypted = ? WHERE id = ?', [encryptApiKey(plaintext), row.id]);
    }
    migrated++;
    console.log(`  id=${row.id} provider=${row.provider_id} — ${APPLY ? 're-encrypted' : 'would re-encrypt'} (${plaintext.length} chars)`);
  }

  console.log(`[Reencrypt] done — ${migrated} migrated, ${alreadyNew} already current, ${failed} failed`);
  if (!APPLY && migrated > 0) console.log('[Reencrypt] re-run with --apply to write these changes.');
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch(err => { console.error('[Reencrypt] fatal:', err.message); process.exitCode = 1; })
  .finally(() => process.exit(process.exitCode || 0));
