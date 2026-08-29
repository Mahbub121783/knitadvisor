# Advanced AI Provider System v2 — Setup Guide

## Overview

The new AI provider system is **database-driven** with **zero API keys in environment variables**. Features:

- ✅ Multiple API keys per provider (5 keys per provider)
- ✅ Automatic key fallback (try all keys before switching providers)
- ✅ Multiple models per provider with intelligent switching
- ✅ Model sticky behavior (use a model until it fails, then try next)
- ✅ Per-model health tracking with cooldowns
- ✅ Strategy support: priority | round_robin | weighted | fastest
- ✅ Encrypted API key storage in database
- ✅ Admin panel to manage all keys and models

---

## Setup Steps (One-Time)

### 1. Run Schema Migration v2

```bash
cd backend
node scripts/migrate-providers-v2.js
```

**Output:**
```
Running advanced provider migration v2...

[1/4] Creating ai_provider_keys table...
  ✓ Created/exists
[2/4] Creating ai_provider_models table...
  ✓ Created/exists
[3/4] Updating ai_provider_stats table...
  ✓ api_key_source
  ✓ current_model_id
  ✓ current_key_id
  ✓ model_switching_enabled
  ✓ key_switching_enabled
[4/4] Creating ai_provider_config table...
  ✓ Created/exists

✓ Migration v2 complete!
```

### 2. Seed API Keys and Models

```bash
node scripts/seed-provider-keys.js
```

**What it does:**
- Reads API keys from `.env` file
- Encrypts them with AES-256-CBC
- Stores in `ai_provider_keys` table
- Creates default models for each provider

**Output:**
```
Seeding provider API keys and models...

✓ Added API key for groq
  → Model: llama-3.3-70b-versatile
  → Model: llama-2-70b-chat
✓ Added API key for gemini
  → Model: gemini-1.5-flash
  → Model: gemini-1.5-pro
...
✓ Seed complete!
```

### 3. Clear .env of API Keys

The `.env` file should now contain **NO API KEYS**:

```env
DB_HOST=...
DB_USER=...
DB_PASS=...
DB_NAME=...
PORT=3001
NODE_ENV=development
ADMIN_USERNAME=knitadvisor
ADMIN_PASSWORD=knitadvisor2026

# AI Providers — NO API KEYS IN .env
# All API keys are stored securely in the database (ai_provider_keys table)
# Manage API keys via the admin panel
```

### 4. Restart Server

```bash
npm start
```

The system will use `provider-manager-v2.js` which reads all keys and models from the database.

---

## How It Works

### Parse Flow

```
User requests parse → /api/parse
  ↓
1. Get all ENABLED providers (sorted by strategy: priority/round-robin/weighted/fastest)
   ↓
2. For EACH provider:
   ├─ Get all ACTIVE API keys (1-5 per provider)
   │  ↓
   ├─ For EACH API key:
   │  ├─ Get all ACTIVE models (2-3 per provider)
   │  │  ↓
   │  ├─ For EACH model:
   │  │  ├─ Call AI with (provider + key + model)
   │  │  ├─ If SUCCESS → Return (update stats, mark model healthy, stick with it)
   │  │  ├─ If FAILURE → Mark model unhealthy for 5 min, try next model
   │  │
   │  └─ All models failed → Mark key unhealthy for 5 min, try next key
   │
   └─ All keys failed → Mark provider unhealthy for 5 min, try next provider
   
3. If ALL providers/keys/models fail → Throw error
```

### Health States

Each level has independent health tracking:

**Provider Level:**
- `is_healthy` — enabled and not in cooldown
- `cooldown_until` — when health resets
- `tokens_today` / `requests_today` — daily usage stats

**Key Level:**
- `is_active` — can be disabled by admin
- `is_healthy` — tracking per-key failures
- `failures_today` — count of failed calls with this key
- `tokens_today` — tokens consumed by this key

**Model Level:**
- `is_active` — can be disabled by admin
- `is_healthy` — tracking per-model failures
- `avg_response_ms` — rolling average response time
- `requests_today` / `failures_today` — daily usage

---

## Database Schema

### ai_provider_keys

Stores encrypted API keys for each provider. Up to 5 keys per provider.

```sql
CREATE TABLE ai_provider_keys (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_id         INT UNSIGNED NOT NULL,
  key_index           INT UNSIGNED NOT NULL DEFAULT 1,     -- 1,2,3,4,5
  api_key_encrypted   VARCHAR(500) NOT NULL,              -- AES-256-CBC encrypted
  is_active           TINYINT DEFAULT 1,                   -- Admin can disable
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at        TIMESTAMP NULL,
  failures_today      INT UNSIGNED DEFAULT 0,
  tokens_today        INT UNSIGNED DEFAULT 0,
  is_healthy          TINYINT DEFAULT 1,
  cooldown_until      TIMESTAMP NULL,
  UNIQUE KEY unique_provider_key (provider_id, key_index),
  FOREIGN KEY (provider_id) REFERENCES ai_provider_stats(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

### ai_provider_models

Tracks health and stats per model per provider.

```sql
CREATE TABLE ai_provider_models (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_id     INT UNSIGNED NOT NULL,
  model_name      VARCHAR(100) NOT NULL,
  is_active       TINYINT DEFAULT 1,                      -- Admin can disable
  is_healthy      TINYINT DEFAULT 1,
  avg_response_ms INT UNSIGNED DEFAULT 0,
  requests_today  INT UNSIGNED DEFAULT 0,
  failures_today  INT UNSIGNED DEFAULT 0,
  last_failure_at TIMESTAMP NULL,
  cooldown_until  TIMESTAMP NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_provider_model (provider_id, model_name),
  FOREIGN KEY (provider_id) REFERENCES ai_provider_stats(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

### ai_provider_stats

Extended with new columns for v2:

```sql
ALTER TABLE ai_provider_stats ADD COLUMN api_key_source VARCHAR(20) DEFAULT 'database' COMMENT 'env|database';
ALTER TABLE ai_provider_stats ADD COLUMN current_model_id INT UNSIGNED NULL COMMENT 'ID of currently active model';
ALTER TABLE ai_provider_stats ADD COLUMN current_key_id INT UNSIGNED NULL COMMENT 'ID of currently active API key';
ALTER TABLE ai_provider_stats ADD COLUMN model_switching_enabled TINYINT DEFAULT 1;
ALTER TABLE ai_provider_stats ADD COLUMN key_switching_enabled TINYINT DEFAULT 1;
```

---

## Admin Panel API

### List All Providers with Keys & Models

```bash
GET /admin/api/providers
Headers: x-admin-token: <token>

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
      "tokens_today": 854,
      "requests_today": 1,
      "daily_limit": 14400,
      "keys": [
        {
          "id": 1,
          "key_index": 1,
          "is_active": 1,
          "is_healthy": 1,
          "failures_today": 0,
          "tokens_today": 854,
          "last_used_at": "2026-06-02T10:30:00Z"
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
        },
        {
          "id": 2,
          "model_name": "llama-2-70b-chat",
          "is_active": 1,
          "is_healthy": 1,
          "avg_response_ms": 0,
          "requests_today": 0,
          "failures_today": 0
        }
      ]
    }
  ],
  "strategy": "priority"
}
```

### Add API Key

```bash
POST /admin/api/providers/:id/keys
Headers: x-admin-token: <token>
Content-Type: application/json

Body:
{
  "api_key": "sk_live_...",
  "key_index": 2  // optional, defaults to 1
}

Response:
{
  "message": "API key added",
  "keys": [...]
}
```

### Add Model

```bash
POST /admin/api/providers/:id/models
Headers: x-admin-token: <token>
Content-Type: application/json

Body:
{
  "model_name": "llama-3.2-90b-text-preview"
}

Response:
{
  "message": "Model added",
  "models": [...]
}
```

### Set Global Strategy

```bash
POST /admin/api/strategy
Headers: x-admin-token: <token>
Content-Type: application/json

Body:
{
  "strategy": "weighted"  // or: priority, round_robin, fastest
}

Response:
{
  "strategy": "weighted"
}
```

### Disable an API Key

```bash
DELETE /admin/api/providers/:providerId/keys/:keyId
Headers: x-admin-token: <token>

Response:
{
  "message": "API key disabled"
}
```

### Reset Daily Stats

```bash
POST /admin/api/reset-daily-stats
Headers: x-admin-token: <token>

Response:
{
  "message": "Daily stats reset"
}
```

---

## Code Examples

### Using provider-manager-v2 in your code

```javascript
const providerMgr = require('./ai/provider-manager-v2');

// Parse text (tries all providers/keys/models with fallback)
const result = await providerMgr.parse('single jersey 180 GSM 30 dia');

console.log({
  parsed: result.fabric,  // e.g., "single_jersey"
  provider_used: result.provider_used,  // e.g., "groq"
  model_used: result.model_used,  // e.g., "llama-3.3-70b-versatile"
  key_index: result.key_index,  // which key was used: 1-5
  tokens_used: result.tokens_used,
  response_ms: result.response_ms
});
```

### Manually adding an API key from code

```javascript
const providerMgr = require('./ai/provider-manager-v2');

// Add key 1 for Groq provider (id=1)
await providerMgr.addApiKey(1, 'gsk_xxxxx', 1);

// Add key 2 (fallback)
await providerMgr.addApiKey(1, 'gsk_yyyyy', 2);
```

### Adding multiple models

```javascript
await providerMgr.addModel(1, 'llama-3.3-70b-versatile');
await providerMgr.addModel(1, 'llama-2-70b-chat');
await providerMgr.addModel(1, 'mixtral-8x7b');
```

---

## Troubleshooting

### "All AI providers unavailable or exhausted"

**Causes:**
1. No API keys configured in database
2. All API keys are invalid (disabled or expired)
3. All models are disabled
4. Daily token limit reached for all providers

**Fix:**
```bash
# Check provider status
SELECT id, provider_name, is_enabled, is_healthy, tokens_today, daily_limit 
FROM ai_provider_stats;

# Check API keys
SELECT provider_id, key_index, is_active, is_healthy, failures_today 
FROM ai_provider_keys;

# Check models
SELECT provider_id, model_name, is_active, is_healthy 
FROM ai_provider_models;

# Reset if stuck
UPDATE ai_provider_keys SET is_healthy = 1, cooldown_until = NULL;
UPDATE ai_provider_models SET is_healthy = 1, cooldown_until = NULL;
```

### "Model llama-3.1-70b-versatile has been decommissioned"

**Fix:** Update to newer model:
```bash
UPDATE ai_provider_models 
SET model_name = 'llama-3.3-70b-versatile' 
WHERE model_name = 'llama-3.1-70b-versatile';
```

### Keys are marked "unhealthy" and never recover

The system has a **5-minute cooldown**. After failure, the key is marked unhealthy for 5 minutes, then automatically recovers. You can manually reset:

```bash
UPDATE ai_provider_keys SET is_healthy = 1, cooldown_until = NULL;
UPDATE ai_provider_models SET is_healthy = 1, cooldown_until = NULL;
```

---

## Performance Notes

- **Encryption/Decryption:** AES-256-CBC using DB password as key. ~1ms per operation.
- **API Key Lookup:** All keys cached in memory once per request.
- **Model Selection:** Queries DB once per provider, cached for request lifetime.
- **Fallback Strategy:** Tries providers in order; only moves to next on failure.

---

## Migration from v1

If upgrading from the old system:

1. Run `migrate-providers-v2.js` ✓
2. Run `seed-provider-keys.js` (migrates keys from .env) ✓
3. Update code to use `provider-manager-v2.js` ✓
4. Clear old API keys from .env ✓
5. Restart server ✓
6. Test via admin panel ✓

---

## Security

- **API Keys:** Encrypted with AES-256-CBC before storage
- **Environment:** No API keys in `.env`, `.gitignore`, or git history
- **Admin API:** Protected by `x-admin-token` header
- **Database:** Keys only readable by backend (not frontend)
- **Cooldowns:** Prevent brute-force attempts on invalid keys

---

## Future Enhancements

- [ ] Rate limiting per API key
- [ ] Automatic key rotation on expiration
- [ ] Cost tracking per provider/model
- [ ] Performance analytics dashboard
- [ ] Webhook notifications on provider failures
- [ ] A/B testing between models
- [ ] Load balancing across keys within a provider
