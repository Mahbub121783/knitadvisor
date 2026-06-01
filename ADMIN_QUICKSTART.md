# Admin Panel — Quick Start (5 minutes)

## 1. Set Up Environment
```bash
# In backend/.env, make sure you have:
ADMIN_PASSWORD=your_secure_password_here
GROQ_API_KEY=gsk_xxxxxx...  # or set via admin panel later
```

## 2. Start the Server
```bash
cd backend
npm install  # if not already done
npm start    # server runs on port 3001
```

## 3. Access Admin Panel
```
http://localhost:3001/admin
```

## 4. Login
- Enter your `ADMIN_PASSWORD` from `.env`
- You get a session token stored in sessionStorage
- Session lasts 8 hours

## 5. What You Can Do

### Query Logs Tab
- **View**: All user API calls with timestamps
- **Filter**: By fabric type, date, cache status
- **Stats**: See cache hit %, avg response time, query count

### AI Providers Tab
- **Reorder**: Drag ↑↓ arrows to set fallback priority
- **Enable/Disable**: Each provider independently
- **API Keys**: Update without restarting
- **Test**: Click "Test ▶" to verify provider works
- **Reset**: Clear daily token/request counters

### Cache Tab
- **View**: All cached results (500 max in memory, unlimited in DB)
- **Stats**: Hit counts, entry age, memory usage
- **Inspect**: Click "View" to see full cached JSON
- **Flush**: Delete cache to test fresh calculations

## 6. Rolling Fallback Example

If you have 4 providers with priorities 1-4:
1. **Request comes in** → AI parser tries **Groq** (priority 1)
2. **Groq fails** → Auto-marks unhealthy, waits 5 min, tries **Gemini** (priority 2)
3. **Gemini succeeds** → Returns result + logs which provider was used
4. **Later**: Groq recovers from cooldown and is tried again first

## 7. Common Tasks

**I need to update the Groq API key:**
1. Go to AI Providers tab
2. Find the Groq card
3. Paste new key in the API Key field
4. Click "Save"
5. (No restart needed — takes effect immediately)

**Cache hit rate is too low:**
1. Go to Cache tab
2. Check "Oldest Entry" — if very recent, cache was flushed
3. Hit rate improves as more users hit common fabrics
4. Target: 60-70% after first day of usage

**Provider is unhealthy:**
1. Go to AI Providers tab
2. Click "Test ▶" on the failing provider
3. If test fails: check API key is correct
4. If test passes: provider will auto-recover after 5 min
5. Or click "Reset Daily Stats" to clear failure count

**I want to see what was cached:**
1. Go to Cache tab
2. Click "View" on any row
3. See the full calculated JSON result
4. Useful for debugging unexpected values

## 8. Deployment Checklist

Before going to production:
- [ ] Set strong `ADMIN_PASSWORD` in `.env`
- [ ] Set at least `GROQ_API_KEY` (or other provider)
- [ ] Test login with correct password
- [ ] Test rolling fallback by disabling Groq temporarily
- [ ] Check query logs appear after first request
- [ ] Monitor cache hit % after 1 hour of traffic

## 9. File Locations

| File | Purpose |
|------|---------|
| `frontend/admin.html` | Admin UI (login screen + 3 tabs) |
| `frontend/js/admin.js` | All admin JavaScript |
| `backend/routes/admin.js` | All 15 admin API endpoints |
| `backend/middleware/admin-auth.js` | Session token validation |
| `backend/ai/provider-manager.js` | Rolling fallback logic |
| `ADMIN_PANEL.md` | Full documentation |

## 10. Troubleshooting

**"Admin panel won't load"**
- Check server is running: `curl http://localhost:3001/health`
- Check browser console for JavaScript errors
- Try `npm start` again

**"Login fails with any password"**
- Check `ADMIN_PASSWORD` is set in `.env`
- Restart the server after changing `.env`
- Make sure value is quoted if it has spaces

**"All AI providers show as unhealthy"**
- Check API keys in each provider's settings
- Click "Test" to get error details
- Verify provider account has available quota

**"Cache entries aren't appearing"**
- Check MySQL connection (should see logs in server console)
- Check `result_cache` table has rows: `SELECT COUNT(*) FROM result_cache;`
- If empty, run a calculation and check if new row appears

---

**That's it!** The admin panel is fully functional. See `ADMIN_PANEL.md` for detailed documentation.
