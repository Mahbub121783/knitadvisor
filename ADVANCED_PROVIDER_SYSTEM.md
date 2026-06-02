# Advanced AI Provider System v2 — Complete Implementation

## What Changed

### Before (v1)
- ❌ API keys stored in `.env` file (security risk)
- ❌ Single API key per provider (no fallback)
- ❌ Single model per provider (no switching)
- ❌ No per-key health tracking
- ❌ No per-model health tracking
- ❌ Admin can't manage keys without file access

### After (v2) 
- ✅ API keys stored **encrypted** in database
- ✅ **5 API keys per provider** (automatic fallback)
- ✅ **2-3 models per provider** (intelligent switching)
- ✅ **Per-key health tracking** with cooldowns
- ✅ **Per-model health tracking** with response time averages
- ✅ **Admin panel** to manage all keys and models
- ✅ **Model sticky behavior** — keeps using a model until it fails
- ✅ **Zero secrets in git** — all keys in encrypted DB

---

## How It Works (Flow Diagram)

```
User calls /api/parse?text="..."
   ↓
Provider Manager loads:
   • Providers (ordered by strategy: priority/round-robin/weighted/fastest)
   • For each provider: all active keys (1-5)
   • For each key: all active models (2-3)
   ↓
Try PROVIDER 1:
   ├─ Try KEY 1:
   │  ├─ Try MODEL 1: GROQ + llama-3.3-70b-versatile
   │  │  └─ SUCCESS! ✓ Return result, update all stats, STICK with model
   │  │
   │  ├─ Try MODEL 2: GROQ + llama-2-70b-chat (if MODEL 1 fails)
   │  │  └─ Try next if fails, mark model unhealthy for 5 min
   │  │
   │  └─ All models fail → Mark KEY 1 unhealthy, try KEY 2
   │
   ├─ Try KEY 2: (if KEY 1 failed)
   │  ├─ Try MODEL 1,2,3... (same logic)
   │  │
   │  └─ All models fail → Mark KEY 2 unhealthy, try KEY 3
   │
   ├─ Try KEY 3, 4, 5 (if earlier keys failed)
   │
   └─ All keys failed → Mark PROVIDER 1 unhealthy, try PROVIDER 2
   ↓
Try PROVIDER 2 (if PROVIDER 1 failed): Gemini with all its keys and models
Try PROVIDER 3 (if PROVIDER 2 failed): Mistral with all its keys and models
Try PROVIDER 4 (if PROVIDER 3 failed): Cohere with all its keys and models
   ↓
If all fail: "All AI providers unavailable"
```

---

## Database Tables

### ai_provider_keys
Stores **encrypted API keys** (AES-256-CBC).

```sql
SELECT * FROM ai_provider_keys;

id  provider_id  key_index  api_key_encrypted  is_active  is_healthy  failures_today  tokens_today
──  ───────────  ─────────  ─────────────────  ─────────  ─────────  ──────────────  ────────────
1   1            1          (encrypted)        1          1          0               844
2   1            2          (encrypted)        1          1          0               0
3   1            3          (encrypted)        1          0          2               100          ← unhealthy
```

### ai_provider_models  
Tracks **health per model per provider**.

```sql
SELECT * FROM ai_provider_models;

id  provider_id  model_name                    is_active  is_healthy  avg_response_ms  requests_today  failures_today
──  ───────────  ────────────────────────────  ─────────  ─────────  ────────────────  ──────────────  ──────────────
1   1            llama-3.3-70b-versatile       1          1          316              1               0
2   1            llama-2-70b-chat              1          1          0                0               0
3   2            gemini-1.5-flash              1          1          280              1               0
4   2            gemini-1.5-pro                1          0          0                0               2              ← unhealthy
```

### ai_provider_stats (Extended)
Original provider table now has additional columns:

```sql
ALTER TABLE ai_provider_stats ADD COLUMN api_key_source VARCHAR(20);        -- 'database'
ALTER TABLE ai_provider_stats ADD COLUMN current_model_id INT UNSIGNED;     -- ID of active model
ALTER TABLE ai_provider_stats ADD COLUMN current_key_id INT UNSIGNED;       -- ID of active key
ALTER TABLE ai_provider_stats ADD COLUMN model_switching_enabled TINYINT;   -- Enable/disable
ALTER TABLE ai_provider_stats ADD COLUMN key_switching_enabled TINYINT;     -- Enable/disable
```

---

## Fallback Logic (Detailed)

### Level 1: Provider Selection
**Strategy determines order:**
- `priority` → sort by `priority` column (1,2,3,...)
- `round_robin` → rotate starting point
- `weighted` → sort by failure rate (lower = higher priority)
- `fastest` → sort by `avg_response_ms` (ascending)

### Level 2: Key Selection  
**Try keys in index order: 1 → 2 → 3 → 4 → 5**
- Skip disabled keys (`is_active=0`)
- Skip keys in cooldown (mark as unhealthy for 5 min after failure)
- Update `last_used_at` timestamp on each attempt

### Level 3: Model Selection
**Try models in order: healthy first, then by response time**
- Skip disabled models (`is_active=0`)
- Skip models in cooldown (5 min timeout)
- **STICKY BEHAVIOR:** Once a model succeeds, keep using it next time until it fails
  - This reduces context switching and improves performance

### Health State Machine

```
HEALTHY (is_healthy=1, cooldown_until=NULL)
   │
   ├─ Call succeeds → Stay HEALTHY, update stats
   │
   └─ Call fails → Mark UNHEALTHY, set cooldown_until = now + 5 min
                  │
                  └─ 5 minutes pass → Auto-recover to HEALTHY
                     (next parse request triggers recovery)
```

---

## Admin Panel API Endpoints

All endpoints require `x-admin-token` header.

### View All Providers with Details
```bash
GET /admin/api/providers
Authorization: x-admin-token

Response:
{
  "providers": [
    {
      "id": 1,
      "provider_name": "groq",
      "provider_type": "groq",
      "display_name": "GROQ",
      "is_enabled": 1,
      "priority": 1,
      "is_healthy": 1,
      "tokens_today": 844,
      "requests_today": 1,
      "daily_limit": 14400,
      "keys": [
        {
          "id": 1,
          "key_index": 1,
          "is_active": 1,
          "is_healthy": 1,
          "failures_today": 0,
          "tokens_today": 844,
          "last_used_at": "2026-06-02T..."
        }
      ],
      "models": [
        {
          "id": 1,
          "model_name": "llama-3.3-70b-versatile",
          "is_active": 1,
          "is_healthy": 1,
          "avg_response_ms": 316,
          "requests_today": 1,
          "failures_today": 0
        }
      ]
    }
  ],
  "strategy": "priority"
}
```

### Add New API Key
```bash
POST /admin/api/providers/:provider_id/keys
{
  "api_key": "gsk_xxxxx",
  "key_index": 2  # Optional, defaults to 1
}
```

### Add New Model
```bash
POST /admin/api/providers/:provider_id/models
{
  "model_name": "llama-3.2-90b-text-preview"
}
```

### Set Global Strategy
```bash
POST /admin/api/strategy
{
  "strategy": "weighted"  # priority | round_robin | weighted | fastest
}
```

### Disable an API Key (temporarily)
```bash
DELETE /admin/api/providers/:provider_id/keys/:key_id
```

### Reset Daily Stats
```bash
POST /admin/api/reset-daily-stats
```

---

## Files Changed/Created

### New Files
- `backend/ai/provider-manager-v2.js` — Core manager with fallback logic
- `backend/scripts/migrate-providers-v2.js` — Database schema migration
- `backend/scripts/seed-provider-keys.js` — Seed keys from .env to DB
- `backend/routes/admin-ai-providers.js` — Admin API endpoints
- `AI_PROVIDER_SETUP.md` — Setup guide
- `ADVANCED_PROVIDER_SYSTEM.md` — This file

### Modified Files
- `backend/routes/admin.js` — Changed import to v2
- `backend/routes/api.js` — Changed import to v2
- `backend/.env` — Removed API keys (now in DB)

### Unchanged
- `backend/server.js` — Works with both v1 and v2
- `frontend/` — No changes needed
- `backend/engine/` — No changes needed

---

## Encryption Details

API keys are encrypted using **AES-256-CBC** before storage:

```javascript
const ENCRYPTION_KEY = crypto.scryptSync(DB_PASS, 'salt', 32);
// Uses scrypt derivation from database password
// Makes key unique per installation

function encryptApiKey(plaintext) {
  const iv = crypto.randomBytes(16);  // Random IV each time
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;  // IV:ciphertext
}

function decryptApiKey(encrypted) {
  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

**Security properties:**
- Keys never appear in logs, error messages, or git
- Encryption key derived from DB password (changes per installation)
- Random IV per encryption (prevents rainbow tables)
- AES-256 (256-bit key, NIST standard)

---

## Performance Impact

- **Encryption/Decryption:** ~1ms per operation (negligible)
- **Database lookups:** Cached in memory once per request
- **Model selection:** Single query with sorting (indexed by provider_id)
- **Fallback overhead:** Only incurred on provider failure (rare case)

**Result:** Zero performance degradation in normal case. Fallback is only used on errors.

---

## Troubleshooting

### API key not being used
Check the key is marked active:
```sql
SELECT * FROM ai_provider_keys WHERE provider_id = 1;
-- is_active should be 1
-- is_healthy should be 1
-- cooldown_until should be NULL
```

### Model keeps failing
Check if model is in cooldown:
```sql
SELECT * FROM ai_provider_models WHERE model_name = 'llama-3.3-70b-versatile';
-- cooldown_until should be NULL or less than NOW()
-- If cooldown_until > NOW(), wait or manually reset
```

### All providers unavailable
```sql
UPDATE ai_provider_keys SET is_healthy = 1, cooldown_until = NULL;
UPDATE ai_provider_models SET is_healthy = 1, cooldown_until = NULL;
UPDATE ai_provider_stats SET is_healthy = 1, cooldown_until = NULL;
```

### "Can't decrypt API key"
If you see this error, the encryption key changed (usually after DB password change):
```bash
# Migrate old keys
node backend/scripts/seed-provider-keys.js
```

---

## Migration Path from v1

If you were using provider-manager v1:

1. ✅ Run `migrate-providers-v2.js` (new tables created)
2. ✅ Run `seed-provider-keys.js` (keys from .env → encrypted DB)
3. ✅ Update imports: `provider-manager` → `provider-manager-v2`
4. ✅ Clear API keys from `.env`
5. ✅ Commit and push
6. ✅ Restart server

No breaking changes to external API (`/api/parse` works same as before).

---

## Future Enhancements

- [ ] API key expiration tracking
- [ ] Automatic key rotation
- [ ] Per-key rate limiting
- [ ] Cost tracking per provider/model
- [ ] Performance analytics dashboard
- [ ] A/B testing between models
- [ ] Load balancing within a provider (round-robin across keys)
- [ ] Webhook notifications on provider failures
- [ ] Auto-disable keys that fail N times in a day

---

## Questions?

See `AI_PROVIDER_SETUP.md` for detailed setup instructions.
