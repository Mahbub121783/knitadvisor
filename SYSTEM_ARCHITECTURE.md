# KnitAdvisor — AI Provider System Architecture v2

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (static HTML/JS)               │
│                                                             │
│  - index.html (fabric calculator)                           │
│  - result.html (calculation results)                        │
│  - patterns.html (pattern browser)                          │
│  - admin.html (admin panel)                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
┌──────────────────┐       ┌──────────────────────┐
│  REST API Routes │       │  Admin Routes        │
│  /api/*          │       │  /admin/*            │
│                  │       │                      │
│ - /parse         │       │ - POST /login        │
│ - /calculate     │       │ - GET  /providers    │
│ - /pattern/:id   │       │ - POST /providers/*  │
│ - /convert       │       │ - POST /strategy     │
└────────┬─────────┘       └──────────┬───────────┘
         │                            │
         └────────────┬───────────────┘
                      │
                      ▼
    ┌─────────────────────────────────┐
    │  Express.js Server (port 3001)  │
    │                                 │
    │  Middleware:                    │
    │  - CORS, Helmet, JSON parser    │
    │  - Rate limiter                 │
    │  - Logger                       │
    └────────────────┬────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌──────────────────┐    ┌────────────────────┐
│  Calculation     │    │  AI Provider       │
│  Engine          │    │  Manager v2        │
│                  │    │                    │
│ - calculator.js  │    │ - provider-        │
│ - formulas.js    │    │   manager-v2.js    │
│ - pattern.js     │    │                    │
│ - quality.js     │    │ Features:          │
│ - costing.js     │    │ • Multi-key        │
│                  │    │ • Multi-model      │
│                  │    │ • Fallback logic   │
│                  │    │ • Health tracking  │
└──────────────────┘    │ • AES-256 encrypt  │
                        └────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
            ┌──────────────────┐    ┌─────────────────┐
            │  Encryption      │    │  Database       │
            │  Module          │    │  MySQL          │
            │                  │    │                 │
            │ - AES-256-CBC    │    │ Tables:         │
            │ - Scrypt derive  │    │                 │
            │ - Random IV      │    │ Core:           │
            └──────────────────┘    │ • fabrics       │
                                    │ • query_logs    │
                                    │                 │
                                    │ AI Provider v2: │
                                    │ • ai_provider_  │
                                    │   stats         │
                                    │ • ai_provider_  │
                                    │   keys (new)    │
                                    │ • ai_provider_  │
                                    │   models (new)  │
                                    │ • ai_provider_  │
                                    │   config        │
                                    │                 │
                                    │ Cache:          │
                                    │ • result_cache  │
                                    │ • sessions      │
                                    └─────────────────┘
```

---

## Data Flow: Parse Request

```
User submits: "single jersey 180 GSM 30 dia"
│
▼
POST /api/parse
│
├─ Cache check: Is this text already parsed? → Return cached result
│
└─ Cache MISS:
   │
   ├─ Load Provider Manager v2
   │  │
   │  ├─ Get all providers (ordered by strategy)
   │  ├─ Get all API keys for each provider
   │  ├─ Get all models for each provider
   │  │
   │  └─ Try providers in order:
   │     │
   │     ├─ Provider 1 (Groq)
   │     │  ├─ Key 1 (main key)
   │     │  │  ├─ Model 1 (llama-3.3-70b-versatile)
   │     │  │  │  ├─ Decrypt key from DB
   │     │  │  │  ├─ Call Groq API
   │     │  │  │  ├─ Parse JSON response
   │     │  │  │  ├─ SUCCESS ✓
   │     │  │  │  ├─ Update stats:
   │     │  │  │  │  • ai_provider_keys: tokens_today++
   │     │  │  │  │  • ai_provider_models: avg_response_ms
   │     │  │  │  │  • ai_provider_stats: tokens_today++
   │     │  │  │  └─ Return result
   │     │  │
   │     │  └─ (Model 2, 3 only tried if Model 1 fails)
   │     │
   │     └─ (Key 2, 3, 4, 5 only tried if Key 1 all fail)
   │
   └─ Cache result (TTL = 30 days)

Response to user:
{
  "fabric": "single_jersey",
  "gsm": 180,
  "dia": 30,
  "composition": "100% Cotton",
  "provider_used": "groq",
  "model_used": "llama-3.3-70b-versatile",
  "key_index": 1,
  "tokens_used": 844,
  "response_ms": 1064
}
```

---

## Data Flow: Calculate Request

```
User submits: fabric="single_jersey", gsm=180, dia=30, gauge=24
│
▼
POST /api/calculate
│
├─ Normalize parameters
├─ Cache check (by hash of params)
│
├─ If cache HIT → Return cached result
│
└─ If cache MISS:
   │
   ├─ Load calculation engine (engine/calculator.js)
   │  ├─ Get fabric definition
   │  ├─ Validate parameters
   │  └─ Run calculation chain:
   │     ├─ FabricWeightFormulas (GSM → yarn count)
   │     ├─ YarnCountFormulas (yarn count → properties)
   │     ├─ WeftCalculators (dia + gauge → specs)
   │     ├─ PatternEngine (get K/T/M pattern)
   │     ├─ QualityEngine (predict quality issues)
   │     ├─ CostingEngine (calculate price)
   │     └─ CacheResult (store in DB)
   │
   └─ Log query (for analytics)

Response to user:
{
  "fabric": "single_jersey",
  "gsm": 180,
  "properties": {
    "yarn_count": "30/1 Ne",
    "linear_density": 0.187,
    "stitch_density": {...}
  },
  "machine_specs": {...},
  "quality": {...},
  "cost": {...},
  "pattern": {...}
}
```

---

## Provider Fallback State Machine

```
                    ┌─────────────┐
                    │   HEALTHY   │
                    │ is_healthy=1│
                    │ cooldown=NUL│
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │             │
              SUCCESS        FAILURE
                    │             │
                    ▼             ▼
             Update stats    Mark UNHEALTHY
             (no change)     Set cooldown
                             = now + 5 min
                             │
                             │ (5 minutes pass)
                             │
                    ┌────────┴────────┐
                    │                 │
             Cooldown expires    Operator resets
                    │                 │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   HEALTHY       │
                    │ (auto-recovery) │
                    │ is_healthy=1    │
                    │ cooldown=NULL   │
                    └─────────────────┘
```

**Applied at 3 levels:**
1. **Provider level** — whole provider unavailable
2. **Key level** — specific API key invalid/quota exceeded
3. **Model level** — model decommissioned or not responding

---

## Database Schema (AI Provider v2)

### Core Tables (Existing)
```sql
ai_provider_stats (extended)
├─ id (PK)
├─ provider_name: VARCHAR(40)
├─ provider_type: VARCHAR(20) [groq|gemini|mistral|cohere|openai]
├─ display_name: VARCHAR(60)
├─ priority: INT (1, 2, 3, ... = order)
├─ is_enabled: TINYINT (1=yes, 0=no)
├─ is_healthy: TINYINT
├─ daily_limit: INT (tokens/day)
├─ tokens_today: INT
├─ requests_today: INT
├─ failures_today: INT
├─ last_failure_at: TIMESTAMP
├─ cooldown_until: TIMESTAMP
├─ api_url: VARCHAR(200)
├─ avg_response_ms: INT
├─ [NEW] api_key_source: VARCHAR(20) → 'database'
├─ [NEW] current_key_id: INT (FK → ai_provider_keys.id)
├─ [NEW] current_model_id: INT (FK → ai_provider_models.id)
├─ [NEW] model_switching_enabled: TINYINT
└─ [NEW] key_switching_enabled: TINYINT
```

### New Tables (v2)
```sql
ai_provider_keys
├─ id (PK)
├─ provider_id (FK → ai_provider_stats.id)
├─ key_index: INT (1, 2, 3, 4, 5)
├─ api_key_encrypted: VARCHAR(500) [AES-256-CBC]
├─ is_active: TINYINT
├─ is_healthy: TINYINT
├─ failures_today: INT
├─ tokens_today: INT
├─ created_at: TIMESTAMP
├─ last_used_at: TIMESTAMP
├─ cooldown_until: TIMESTAMP
└─ UNIQUE(provider_id, key_index)

ai_provider_models
├─ id (PK)
├─ provider_id (FK → ai_provider_stats.id)
├─ model_name: VARCHAR(100)
├─ is_active: TINYINT
├─ is_healthy: TINYINT
├─ avg_response_ms: INT
├─ requests_today: INT
├─ failures_today: INT
├─ created_at: TIMESTAMP
├─ last_failure_at: TIMESTAMP
├─ cooldown_until: TIMESTAMP
└─ UNIQUE(provider_id, model_name)

ai_provider_config
├─ id (PK)
├─ cfg_key: VARCHAR(40) UNIQUE
├─ cfg_value: VARCHAR(500)
└─ updated_at: TIMESTAMP
    [Contains: strategy → 'priority'|'round_robin'|'weighted'|'fastest']
```

---

## Encryption Architecture

### Key Derivation
```javascript
ENCRYPTION_KEY = scrypt(DB_PASSWORD, 'salt', 32 bytes)

// Example:
// DB_PASS = "M@hbubu5"
// ENCRYPTION_KEY = 256-bit derived from password
// Unique per installation, changes if password changes
```

### Encryption Process
```
Plain API Key: "gsk_9nV6TBj8DI..."
    │
    ├─ Generate random IV (16 bytes)
    │
    ├─ Create cipher: AES-256-CBC
    │
    ├─ Encrypt with ENCRYPTION_KEY
    │
    └─ Store as: "IV_HEX:CIPHERTEXT_HEX"
       Example: "a1b2c3d4e5f6...:f7e8d9c0b1a2..."

Decryption Process:
Stored: "a1b2c3d4e5f6...:f7e8d9c0b1a2..."
    │
    ├─ Split on ":"
    ├─ IV = hex2bytes(first part)
    ├─ Ciphertext = hex2bytes(second part)
    │
    ├─ Create decipher: AES-256-CBC with IV
    │
    ├─ Decrypt with ENCRYPTION_KEY
    │
    └─ Returns: "gsk_9nV6TBj8DI..."
```

---

## Admin API Authentication

```
All admin endpoints require:

Header: x-admin-token: <token>

Token generation:
1. POST /admin/login { username, password }
2. Server validates against ADMIN_USERNAME, ADMIN_PASSWORD
3. Server generates random token
4. Token hashed and stored in sessions table
5. Raw token returned to client
6. Client includes token in x-admin-token header

Token validation:
1. Client sends x-admin-token header
2. Server hashes token
3. Server looks up hash in sessions table
4. If found, request is authorized
5. If not found, return 401 Unauthorized

Session expiry:
- Sessions stored in admin_sessions table
- Can be invalidated on logout
- Optional timeout (configurable)
```

---

## Deployment Architecture

### Development
```
localhost:3001
├─ Frontend static: /frontend
├─ API: /api/*
└─ Admin: /admin/*
```

### Production (cPanel)
```
cPanel Node.js App
├─ Runs backend/server.js
├─ Listens on internal port (e.g., 3001)
├─ Apache proxy: domain.com → localhost:3001
├─ Static files served by Apache with caching
├─ Database: external MySQL server (38.46.220.25:3306)
└─ Environment:
    - NODE_ENV=production
    - All .env vars loaded securely
    - API keys encrypted in database (not .env)
```

---

## Performance Optimization

### Caching Strategy
```
Layer 1: Memory Cache (in-process)
├─ Cache-duration: entire request
├─ Stores: providers, keys, models list
└─ Invalidated: on parse/calculate miss

Layer 2: Database Cache
├─ Table: result_cache
├─ TTL: 30 days (configured in .env)
├─ Hit on: exact parameter match
└─ Stores: full calculation results

Layer 3: Browser Cache
├─ Static assets (HTML/CSS/JS)
├─ Cache-Control headers from Apache
└─ Reduces bandwidth
```

### Database Optimization
```
Indexes:
- ai_provider_stats: PRIMARY KEY (id), UNIQUE (provider_name)
- ai_provider_keys: UNIQUE (provider_id, key_index)
- ai_provider_models: UNIQUE (provider_id, model_name)
- result_cache: PRIMARY KEY (cache_key), INDEX (expires_at)
- query_logs: INDEX (created_at), INDEX (parsed_fabric)

Query optimization:
- Single query to load all providers
- Single query to load all keys for a provider
- Single query to load all models for a provider
- Minimal database hits per request (often 0 due to cache)
```

---

## Monitoring & Analytics

### Daily Logs
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_parses,
  SUM(CASE WHEN provider_used='groq' THEN 1 ELSE 0 END) as groq_count,
  SUM(CASE WHEN from_cache=1 THEN 1 ELSE 0 END) as cache_hits,
  ROUND(100 * SUM(from_cache) / COUNT(*), 1) as cache_hit_pct,
  ROUND(AVG(response_ms), 0) as avg_response_ms
FROM query_logs
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### Provider Stats
```sql
SELECT 
  p.display_name,
  COUNT(qlog.id) as requests,
  ROUND(AVG(qlog.response_ms), 0) as avg_response_ms,
  SUM(CASE WHEN qlog.response_ms > 1000 THEN 1 ELSE 0 END) as slow_requests,
  ROUND(100 * SUM(CASE WHEN qlog.response_ms > 1000 THEN 1 ELSE 0 END) / COUNT(*), 1) as slow_pct
FROM ai_provider_stats p
LEFT JOIN query_logs qlog ON qlog.ai_provider = p.display_name
WHERE qlog.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY p.id, p.display_name
ORDER BY requests DESC;
```

---

## Security Considerations

### API Keys
- ✅ Never stored in .env (commits leak them)
- ✅ Never in git history (git filter doesn't catch all)
- ✅ Encrypted in database (AES-256-CBC)
- ✅ Decrypted only in memory (never printed/logged)
- ✅ Unique encryption key per installation (derived from DB password)

### Access Control
- ✅ Admin endpoints require x-admin-token header
- ✅ Token hashed before storage (can't leak plaintext)
- ✅ Rate limiting on /api/* endpoints
- ✅ CORS configured (only allow trusted domains)
- ✅ CSRF protection (if needed for forms)

### Database
- ✅ Prepared statements (prevents SQL injection)
- ✅ Input validation (all params validated)
- ✅ Limited privileges (app user can only write to specific tables)
- ✅ No sensitive data in logs (keys redacted)

### Network
- ✅ HTTPS in production (Apache config)
- ✅ CSP headers (Helmet middleware)
- ✅ X-Frame-Options (Helmet middleware)
- ✅ No sensitive data in URLs (POST requests for secrets)

---

## Future Enhancements

1. **Cost Tracking**
   - Track tokens used per provider/model
   - Calculate cost based on pricing tier
   - Alert on budget exceeded

2. **Load Balancing**
   - Round-robin within a provider (across 5 keys)
   - Prefer keys with lower cost
   - A/B testing between models

3. **Webhook Notifications**
   - Alert on provider failures
   - Cost threshold alerts
   - New model available notifications

4. **Performance Analytics**
   - Dashboard showing provider performance
   - Response time histograms
   - Cache hit rate trends

5. **Auto-Recovery**
   - Automatic provider re-enablement after success
   - Smart backoff algorithm
   - Gradual key trust restoration

---

## Glossary

| Term | Definition |
|------|-----------|
| **Provider** | AI API service (Groq, Gemini, Mistral, Cohere, OpenAI) |
| **API Key** | Secret token for authentication with provider |
| **Model** | Specific LLM variant (e.g., llama-3.3-70b-versatile) |
| **Fallback** | Try next option if current fails |
| **Cooldown** | Temporary lock on unhealthy provider/key/model (5 min) |
| **Strategy** | Method to select which provider to use (priority, round-robin, weighted, fastest) |
| **Health** | is_healthy flag tracking if provider/key/model is working |
| **Token** | Unit of API usage (varies per provider) |

---

**Last Updated:** 2026-06-02  
**Version:** 2.0.0 (Advanced Multi-Key Multi-Model System)  
**Status:** Production Ready ✅
