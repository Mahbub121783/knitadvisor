/**
 * Reads the Anthropic / Voyage API keys the Knowledge Assistant needs, out of
 * the SAME encrypted `ai_provider_stats` / `ai_provider_keys` tables the
 * existing multi-provider NL-parser (provider-manager-v2.js) already uses —
 * so the admin adds/edits these two keys through the admin panel's existing
 * "AI Providers" screen (Add Provider -> type "anthropic"/"voyage" -> paste
 * key), with the same AES-256 encryption-at-rest, instead of a second secret
 * store or a raw .env value.
 *
 * Deliberately read-only and separate from provider-manager-v2.js's own
 * parse()/callProvider() dispatch — this module never calls orderProviders()
 * or callProvider(), so it cannot be pulled into that fallback rotation, and
 * it does not gate on is_enabled/is_healthy/cooldown (this feature has its
 * own rate limiting and budget cap — see engine/domain/knowledge-assistant-engine.js).
 */
const providerManager = require('./provider-manager-v2');

async function getDecryptedKey(providerType) {
  const providers = await providerManager.getProviders();
  const row = providers.find(p => p.provider_type === providerType);
  if (!row) return null;

  const keys = await providerManager.getProviderKeys(row.id);
  const active = keys.find(k => k.is_active) || keys[0];
  if (!active) return null;

  return providerManager.decryptApiKey(active.api_key_encrypted);
}

async function getAnthropicKey() {
  return getDecryptedKey('anthropic');
}

async function getVoyageKey() {
  return getDecryptedKey('voyage');
}

module.exports = { getDecryptedKey, getAnthropicKey, getVoyageKey };
