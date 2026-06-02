# AI Provider System v2 — Quick Start

## TL;DR — One Time Setup

```bash
# 1. Run migrations (creates tables)
node backend/scripts/migrate-providers-v2.js

# 2. Seed API keys to database (from .env)
node backend/scripts/seed-provider-keys.js

# 3. Clear API keys from .env file (no secrets!)
# Edit .env - remove all GROQ_API_KEY, GEMINI_API_KEY, etc.

# 4. Restart server
npm start
```

Done! System now uses **encrypted database storage** with **zero secrets in .env**.

---

## Testing It Works

```bash
# Parse request (uses new provider-manager-v2 with fallback logic)
curl -X POST http://localhost:3001/api/parse \
  -H "Content-Type: application/json" \
  -d '{"text":"single jersey 180 GSM 30 dia"}'

# Response should show:
# {
#   "fabric": "single_jersey",
#   "gsm": 180,
#   "dia": 30,
#   "provider_used": "groq",
#   "model_used": "llama-3.3-70b-versatile",
#   "key_index": 1,
#   "tokens_used": 844,
#   "response_ms": 1064
# }
```

---

## Managing Providers (Admin Panel)

### Login to Admin Panel
```
1. Go to http://localhost:3001/admin
2. Login with: knitadvisor / knitadvisor2026
3. Click "AI Providers" in menu
```

### Add API Key (Fallback)
**Example:** Add 2nd Groq API key as fallback

1. Find "GROQ" provider in the list
2. Click "Add API Key"
3. Paste your API key: `gsk_xxxxx...`
4. Select key_index: **2**
5. Click "Save"

Now if key 1 fails, system tries key 2 automatically.

### Add Model (Alternative)
**Example:** Add Mistral-7B as backup for Groq

1. Find "GROQ" provider
2. Click "Add Model"
3. Enter model name: `mistral-7b-instruct-v0.1`
4. Click "Save"

Now if llama-3.3-70b fails, system tries mistral-7b next.

### Change Strategy
**Available strategies:**
- `priority` — use providers in priority order
- `round_robin` — rotate between providers
- `weighted` — prefer providers with fewer failures
- `fastest` — use provider with lowest response time

**To change:**
1. Scroll to "Strategy" section
2. Select new strategy from dropdown
3. Click "Save"

### Reset Health States (if stuck)
If all providers marked unhealthy:
1. Scroll to "Stats" section
2. Click "Reset Daily Stats"
3. All health states reset, cooldowns cleared

---

## API Key Encryption

All keys are encrypted **AES-256-CBC** before storage:

```sql
-- View encrypted keys (admin only)
SELECT provider_id, key_index, is_active, is_healthy 
FROM ai_provider_keys;

-- Key is never shown, only health status
-- Database password is encryption key (unique per installation)
```

**Security:**
- ✅ Keys encrypted at rest
- ✅ Keys never in logs or error messages
- ✅ Keys never in git history or .env
- ✅ Admin API requires authentication token

---

## How Fallback Works

When you call `/api/parse`:

```
1. Try Provider 1 (Groq)
   ├─ Try Key 1 (your main groq key)
   │  ├─ Try Model 1 (llama-3.3-70b-versatile)
   │  │  └─ SUCCESS ✓ Return result
   │  │
   │  └─ Try Model 2 (llama-2-70b-chat) — if Model 1 fails
   │
   └─ Try Key 2 (if Key 1 fails) — if you have 5 keys

2. Try Provider 2 (Gemini) — if Provider 1 all keys fail

3. Try Provider 3, 4, etc.

4. Return error only if all fail
```

**Health states auto-recover after 5 minutes.**

---

## Key Commands

### View provider status
```bash
curl -s http://localhost:3001/admin/api/providers \
  -H "x-admin-token: YOUR_TOKEN" | head -100
```

### Check which key is active
```bash
SELECT provider_id, key_index, is_active, is_healthy, last_used_at 
FROM ai_provider_keys;
```

### View model health
```bash
SELECT model_name, is_active, is_healthy, avg_response_ms, failures_today 
FROM ai_provider_models;
```

### Manually reset a key (if unhealthy)
```bash
UPDATE ai_provider_keys 
SET is_healthy = 1, cooldown_until = NULL 
WHERE id = 1;
```

### Add key via SQL (emergency)
```bash
-- First, encrypt the key manually:
-- Use provider-manager-v2.encryptApiKey('your_key_here')

INSERT INTO ai_provider_keys (provider_id, key_index, api_key_encrypted, is_active)
VALUES (1, 2, 'ENCRYPTED_KEY_HERE', 1);
```

---

## Environment Variables (What NOT to Set)

✗ **DO NOT** add these to `.env`:
- `GROQ_API_KEY`
- `GEMINI_API_KEY`
- `MISTRAL_API_KEY`
- `COHERE_API_KEY`
- `OPENAI_API_KEY`

All should be managed via admin panel or database.

✓ **Keep these in .env:**
- `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- `PORT`, `NODE_ENV`
- `CACHE_TTL_SECONDS`

---

## Troubleshooting

### "All AI providers unavailable"
```sql
-- Check all keys
SELECT COUNT(*) FROM ai_provider_keys WHERE is_active = 1;

-- Should return > 0. If 0:
INSERT INTO ai_provider_keys (provider_id, key_index, api_key_encrypted, is_active)
VALUES (1, 1, <encrypted_key>, 1);
```

### "Can't decrypt API key"
Usually happens if DB password changed:
```bash
# Re-seed keys from .env
node backend/scripts/seed-provider-keys.js
```

### Parse takes too long
Check if fallback chain is active:
```sql
SELECT provider_id, model_name, is_healthy 
FROM ai_provider_models 
WHERE is_healthy = 0;

-- If many models unhealthy, reset:
UPDATE ai_provider_models SET is_healthy = 1, cooldown_until = NULL;
```

---

## Next Steps

1. **Production Deployment**: Use Admin Panel to add production API keys
2. **Multiple Keys**: Add 2-3 keys per provider for better reliability
3. **Multiple Models**: Add backup models (e.g., llama-2 + mistral for Groq)
4. **Monitoring**: Check daily stats in admin panel
5. **Scale**: As usage grows, distribute load across providers

---

## Full Documentation

- `AI_PROVIDER_SETUP.md` — Detailed setup guide
- `ADVANCED_PROVIDER_SYSTEM.md` — Architecture and implementation details
- `backend/ai/provider-manager-v2.js` — Source code with comments
- `backend/scripts/migrate-providers-v2.js` — Database migration script

---

**Questions?** Check the admin panel logs or run:
```bash
tail -f backend/.log  # if logging enabled
```
