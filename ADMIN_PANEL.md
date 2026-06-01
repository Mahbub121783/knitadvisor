# KnitAdvisor Admin Panel — User Guide

**Version**: 1.0.0  
**Status**: Ready for deployment  
**Last Updated**: 2026-06-01

---

## 📋 Overview

The admin panel provides three key sections for managing KnitAdvisor:

1. **Query Logs** — View user query history with filtering and analytics
2. **AI Providers** — Manage AI provider settings, ranking, and API keys with rolling fallback
3. **Cache Management** — View, inspect, and manage the query result cache

All admin functions are protected by a simple password-based session token system.

---

## 🔐 Authentication

### Login
1. Navigate to `http://your-domain.com/admin`
2. Enter the admin password (from `ADMIN_PASSWORD` environment variable)
3. You'll receive a session token stored in browser sessionStorage

### Session Duration
- Sessions expire after 8 hours of creation
- Logout explicitly removes the session from the database
- Session tokens are SHA256 hashes stored securely in the database

### Security Notes
- Tokens are passed via `X-Admin-Token` HTTP header (not cookies)
- All admin API endpoints require valid authentication
- Password is checked at login time only; token validity is checked on each request

---

## 📊 Query Logs Section

### Overview
View all user API calls with filtering and real-time statistics.

### Statistics Cards
- **Queries Today** — Total API calls made today
- **Cache Hit %** — Percentage of requests served from cache
- **Avg Response ms** — Average response time in milliseconds
- **NL Queries** — Count of natural language parsing requests

### Filters
- **Fabric** — Filter by fabric type (single_jersey, terry, rib, etc.)
- **Date From / Date To** — Filter by date range
- **Cache** — Show only cache hits or misses
- **NL Only** — Show only natural language parser requests

### Table Columns
| Column | Description |
|--------|-------------|
| Time | Timestamp of the query |
| Input Text | First 50 characters of the user's input |
| Fabric | Parsed fabric type identifier |
| GSM | Parsed GSM (weight) value |
| Ms | Response time in milliseconds |
| Cache | Badge showing HIT or MISS |
| AI | AI provider used (if NL query) |

### Pagination
- 25 rows per page
- Navigation: Previous / Current page / Next
- Updates dynamically as you change pages

---

## ⚙️ AI Providers Section

### Overview
Manage AI provider settings with automatic rolling fallback and ranking system.

### Provider Cards Layout

Each provider shows:
```
↑ ↓   #1  GROQ          llama-3.3-70b    [●] healthy
         14,400 daily · tokens: 150 · reqs: 45 · fails: 0
         [Enable ✓]  [API Key input...]  [Save]  [Test ▶]
```

### Features

#### 1. Priority Ranking (Rolling Fallback)
- **Up/Down Arrows** — Reorder providers by priority
- **How it works**: When a request comes in, the system tries providers in priority order
- **Auto-fallback**: If provider fails, automatically moves to the next one
- **Cooldown**: Failed providers enter 5-minute cooldown before retry

#### 2. Enable/Disable Toggle
- **Enabled (✓)** — Provider is active and will be tried
- **Disabled** — Provider is skipped in fallback chain

#### 3. Daily Statistics
- **Daily Limit** — Maximum tokens allowed per day (e.g., 14,400)
- **Tokens** — Tokens used today
- **Reqs** — Number of requests attempted
- **Fails** — Number of failures today

#### 4. API Key Management
- **Input Field** — Shows the environment variable name (e.g., `GROQ_API_KEY`)
- **Save Button** — Updates the API key in `.env` file
- **Note**: No server restart needed; takes effect immediately

#### 5. Provider Test
- **Test Button** — Triggers a test parse with sample text
- **Result** — Shows response time and which provider was used
- **Use case**: Verify API key is valid and provider is responding

#### 6. Health Indicator
- **Green Dot** — Provider is healthy and ready
- **Red Dot** — Provider is unhealthy or in cooldown
- **Dimmed Card** — Provider is disabled

### Supported Providers
| Provider | Model | Status |
|----------|-------|--------|
| **Groq** | llama-3.3-70b-versatile | Primary (Priority 1) |
| **Gemini** | gemini-1.5-flash | Fallback (Priority 2) |
| **Mistral** | mistral-small-latest | Fallback (Priority 3) |
| **Cohere** | command-r | Fallback (Priority 4) |

### Rolling Fallback Algorithm

When `/api/parse` is called:

```
1. Get all enabled providers, sorted by priority (1-4)
2. For each provider in order:
   a. Skip if unhealthy AND cooldown_until > NOW
   b. Skip if tokens_today >= daily_limit
   c. Try to call provider with user's text
   d. On success: return result + update tokens/requests stats
   e. On fail: mark unhealthy, set 5-minute cooldown, try next
3. If all providers fail: throw "All AI providers unavailable"
```

### Reset Daily Stats
- **Button**: "Reset Daily Stats" at top right
- **Action**: Clears tokens_today, requests_today, failures_today for all providers
- **Confirmation**: Requires explicit confirmation
- **Use case**: Start fresh at the beginning of a billing period

---

## 💾 Cache Management Section

### Overview
View, inspect, and manage the two-layer caching system (memory + database).

### Statistics Cards
- **DB Entries** — Number of cached results in MySQL
- **Total Hits** — Sum of all cache hit counts
- **Memory Cache** — Current entries in in-process LRU cache (max 500)
- **Oldest Entry** — When the oldest cached result was created

### Cache Entries Table

| Column | Description |
|--------|-------------|
| Cache Key | MD5 hash of normalized query (truncated display) |
| Hits | Number of times this entry was served from cache |
| Created | Timestamp when entry was cached |
| Expires | Timestamp when entry expires (TTL: 30 days) |
| Actions | View and Delete buttons |

### Cache Operations

#### View Entry
- **Button**: "View" on a row
- **Display**: Shows full cache key and formatted JSON result
- **Use case**: Inspect what was calculated and cached for debugging

#### Delete Entry
- **Button**: "Delete" on a row
- **Confirmation**: Confirms before deletion
- **Scope**: Removes from both memory (L1) and database (L2) cache
- **Use case**: Purge incorrect cached results

#### Flush All Cache
- **Button**: "Flush All Cache" (red border)
- **Confirmation**: "Are you sure? This cannot be undone."
- **Scope**: Empties both L1 memory cache and L2 database cache
- **Return**: Shows count of deleted entries
- **Use case**: Complete cache reset for troubleshooting

#### Refresh Stats
- **Button**: "Refresh Stats"
- **Action**: Reloads cache statistics without table refresh
- **Use case**: Quick update after flushing or detecting changes

### Cache Architecture

**L1 Cache (In-Memory)**
- Type: LRU (Least Recently Used)
- Size: 500 entries max
- TTL: 24 hours
- Speed: <1 millisecond reads
- Scope: In-process only (lost on restart)

**L2 Cache (MySQL)**
- Type: Persistent relational table
- Size: Unlimited (depends on storage)
- TTL: 30 days (configurable via `CACHE_TTL_SECONDS`)
- Speed: 5-20 milliseconds reads
- Scope: Survives server restarts

**Cache Key**: MD5 hash of:
```
fabric_type + gsm + composition + color + diameter + gauge + rpm + efficiency
```

### Cache Statistics
- Query execution flow: Check L1 → Check L2 → Calculate → Store L1+L2 → Log
- Expected cache hit rate: 60-70% for typical usage
- Older caches are auto-expired by database cleanup

---

## 🔗 API Endpoints

### Public Endpoints (No Auth)
```
POST /admin/login          — Authenticate with password
POST /admin/logout         — Destroy session token
GET  /admin/ping           — Check session validity
GET  /admin                — Serve admin.html
```

### Protected Endpoints (Require X-Admin-Token header)

**Query Logs**
```
GET  /admin/api/logs/stats       — Get today's statistics
GET  /admin/api/logs?...         — Get paginated logs with filters
```

**AI Providers**
```
GET  /admin/api/providers                    — List all providers
PATCH /admin/api/providers/:id/priority      — Update provider priority
PATCH /admin/api/providers/:id/enabled       — Enable/disable provider
POST  /admin/api/providers/:id/apikey        — Update API key
POST  /admin/api/providers/:id/test          — Test provider
POST  /admin/api/providers/reset-stats       — Reset daily stats
```

**Cache**
```
GET    /admin/api/cache/stats          — Get cache statistics
GET    /admin/api/cache/entries?...    — Get paginated entries
GET    /admin/api/cache/entry/:key     — Get one entry's full content
DELETE /admin/api/cache/flush          — Flush all cache
DELETE /admin/api/cache/entry/:key     — Delete one entry
```

---

## 🛠️ Configuration

### Environment Variables Required
```bash
# .env file
ADMIN_PASSWORD=your_secure_password_here

# AI Provider API Keys (at least one required for /api/parse)
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_gemini_key
MISTRAL_API_KEY=your_mistral_key
COHERE_API_KEY=your_cohere_key
```

### Database Tables Used
- `admin_sessions` — Session token storage (token_hash, ip_address, expires_at)
- `ai_provider_stats` — Provider configuration and stats (priority, daily_limit, tokens_today, etc.)
- `query_logs` — User query audit trail (input, result, response time, cache status, etc.)
- `result_cache` — Cached calculation results (cache_key, result_json, expires_at, hit_count)

---

## 📈 Monitoring & Analytics

### What to Monitor
1. **Cache Hit Rate** — Higher is better (target >60%)
2. **Average Response Time** — Should be <200ms uncached, <5ms cached
3. **Provider Failures** — Should be near 0 in normal operation
4. **Token Usage** — Track daily usage vs provider limits

### Health Checks
- Check `/health` endpoint for server uptime
- Monitor `ai_provider_stats` table for failures and cooldowns
- Review `query_logs` for unusual patterns

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "All AI providers unavailable" | Check GROQ_API_KEY and provider health; test each provider |
| Cache hit rate too low | May indicate diverse queries; check most common query patterns |
| Provider marked unhealthy | Check API key validity; wait 5 min cooldown or manually reset |
| Database cache not growing | Check MySQL connection and write permissions |

---

## 🚀 Deployment Notes

### Pre-Deployment Checklist
- [ ] Set `ADMIN_PASSWORD` to a strong value in `.env`
- [ ] Set at least one AI provider API key (GROQ recommended)
- [ ] Verify MySQL connection with `npm run test-connection` (if available)
- [ ] Test `/admin` login with correct password
- [ ] Test rolling fallback by disabling primary provider

### Post-Deployment
1. Access admin panel at `https://your-domain.com/admin`
2. Verify all 3 tabs load (Query Logs, AI Providers, Cache)
3. Check that today's queries appear in logs
4. Test provider failover by temporarily disabling Groq
5. Monitor token usage after first day

### Performance Tuning
- Monitor cache hit % — if low, may need longer TTL
- Check average response time — aim for <50ms cached
- Scale database indexes if query_logs grows rapidly

---

## 📝 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-06-01 | Initial release with Query Logs, AI Providers, Cache Management |

---

## 📞 Support

For issues or questions:
1. Check browser console for JavaScript errors
2. Review server logs for API errors
3. Verify all environment variables are set
4. Check database connectivity
5. Test each AI provider independently

---

**End of Admin Panel Guide**
