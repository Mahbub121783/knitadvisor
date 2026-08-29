# ⚡ QUICK FIX: Admin Login Not Working

## 🚀 Fastest Solution (2 Minutes, No SSH)

Just run this command from your computer (any terminal/command prompt):

```bash
curl -X POST https://knitadvisor.onlinetextileschool.com/emergency/create-admin-sessions
```

You should see:
```json
{
  "ok": true,
  "message": "admin_sessions table created successfully"
}
```

Then:
1. Open cPanel
2. Go to "Node.js Domains"
3. Click **STOP** on your KnitAdvisor app
4. Wait 3 seconds
5. Click **START**

**That's it! Admin login will work now.**

---

## What Was Wrong?

The `admin_sessions` table didn't exist in the database. The code tried to use it during login but couldn't find it, so it returned "Login failed".

The curl command creates the table. Then restarting the app makes it use the new table.

---

## Verify It Works

```bash
curl -X POST https://knitadvisor.onlinetextileschool.com/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"knitadvisor","password":"knitadvisor2026"}'
```

Should return a token like:
```json
{"ok":true,"token":"a1b2c3d4e5f6..."}
```

If you see this, **login is working!**

---

## Emergency Diagnostic (if still not working)

Check status:
```bash
curl https://knitadvisor.onlinetextileschool.com/emergency/auth-status
```

Then restart via cPanel and try again.

For detailed troubleshooting, see `PRODUCTION_EMERGENCY_FIX.md`
