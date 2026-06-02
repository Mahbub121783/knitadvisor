# 🔴 CRITICAL: Admin Login Failure — Emergency Fix

## Problem
Admin panel login is failing with "Login failed" error even with correct credentials.

**Root Cause:** The `admin_sessions` table was never created in the live database.

---

## Solution — Two Options

### **OPTION A: Via Web (No SSH Required) — EASIEST**

This is the fastest way if you don't have SSH access!

```bash
# Step 1: Create the missing table via web endpoint
curl -X POST https://knitadvisor.onlinetextileschool.com/emergency/create-admin-sessions

# Expected response:
# {
#   "ok": true,
#   "message": "admin_sessions table created successfully",
#   "next_steps": [...]
# }
```

Then **Restart Node.js in cPanel:**
1. Go to cPanel → "Node.js Domains"
2. Find your KnitAdvisor app
3. Click **STOP** 
4. Wait 3 seconds
5. Click **START**

Done! Login will work now.

---

### **OPTION B: Via SSH (If you have access)**

#### Step 1: SSH to cPanel Server
You need to find your cPanel username first. Usually it's in your hosting welcome email or you can ask your hosting provider.

```bash
ssh your_cpanel_username@knitadvisor.onlinetextileschool.com
```

If you don't know your username, try common ones:
- `knitadvisor`
- `knitad` (abbreviated)
- Check your cPanel welcome email
- Contact hosting provider

#### Step 2: Navigate to Backend
```bash
cd ~/public_html/backend
# or wherever the app is deployed
```

#### Step 3: Create the Missing Table
```bash
node scripts/create-admin-sessions.js
```

**Expected Output:**
```
Creating admin_sessions table...

[DB] MySQL pool created
✓ admin_sessions table created successfully

You can now log in to the admin panel.
```

#### Step 4: Restart Node.js Application
This is **CRITICAL** — the running Node.js process needs to restart.

**Option A: Via cPanel (Recommended)**
1. Go to cPanel → "Node.js Domains"
2. Find your KnitAdvisor app
3. Click **STOP** 
4. Wait 3 seconds
5. Click **START**

**Option B: Via Terminal**
```bash
# Kill the process
pkill -f "node server.js"

# Start it again
nohup node server.js > /tmp/knitadvisor.log 2>&1 &
```

#### Step 5: Verify Login Works
```bash
curl -X POST https://knitadvisor.onlinetextileschool.com/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"knitadvisor","password":"knitadvisor2026"}'
```

**Expected Response:**
```json
{
  "ok": true,
  "token": "a1b2c3d4e5f6... (long hex string)"
}
```

---

## Emergency Diagnostic Endpoints

Before trying the fix, check your server status:

```bash
# Check if everything is ready
curl https://knitadvisor.onlinetextileschool.com/emergency/auth-status

# Expected response if system is broken:
# {
#   "admin_configured": true,
#   "admin_username": "knitadvisor",
#   "admin_sessions_table_exists": false,  ← THIS IS THE PROBLEM
#   "status": "MISSING_TABLE"
# }

# Check database connection
curl https://knitadvisor.onlinetextileschool.com/emergency/db-status

# Expected response:
# {
#   "database": "connected",
#   "tables_total": 25,
#   "admin_sessions_exists": false
# }
```

---

## If Still Not Working

### Check 1: Verify Table Was Created
```bash
node -e "require('dotenv').config(); const db = require('./config/database'); db.query('SELECT COUNT(*) as cnt FROM admin_sessions').then(r => { console.log('Table check:', r[0]); process.exit(0); });"
```

### Check 2: Check Database Connection
```bash
node -e "require('dotenv').config(); const db = require('./config/database'); db.testConnection().then(() => { console.log('✓ DB connected'); process.exit(0); }).catch(e => { console.log('✗ DB error:', e.message); process.exit(1); });"
```

### Check 3: Check Admin Credentials in .env
```bash
grep ADMIN_ .env
```

Should show:
```
ADMIN_USERNAME=knitadvisor
ADMIN_PASSWORD=knitadvisor2026
```

### Check 4: Review Server Logs
```bash
tail -f /tmp/knitadvisor.log
# or check cPanel error logs
```

---

## What Was the Issue?

The `admin_sessions` table was referenced in the code but never created. This happened because:

1. Initial database setup didn't include admin session storage
2. Code tries to insert session when user logs in
3. Table doesn't exist → INSERT fails → "Login failed" error

The frontend sees "Login failed" but the **actual issue was database error**, not wrong credentials.

---

## Prevention: Update Your Deployment Script

Add this to your deployment checklist:

```bash
# Always run this after pulling new code
node backend/scripts/create-admin-sessions.js
node backend/scripts/migrate-providers-v2.js
node backend/scripts/seed-provider-keys.js

# Then restart
pkill -f "node server.js"
nohup node server.js > /tmp/knitadvisor.log 2>&1 &
```

---

## Technical Details

The `admin_sessions` table schema:
```sql
CREATE TABLE admin_sessions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  ip_address  VARCHAR(45) DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP DEFAULT NULL,
  is_active   TINYINT DEFAULT 1,
  INDEX idx_token_hash (token_hash),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB;
```

When user logs in:
1. User submits username/password
2. Server validates credentials against .env
3. Server generates random token
4. Server hashes token (SHA256)
5. Server stores hash in `admin_sessions` table ← **THIS WAS FAILING**
6. Server returns raw token to user
7. User stores token in browser localStorage
8. All future requests include `x-admin-token` header with the token
9. Server validates token by looking up its hash in `admin_sessions` table

---

## Questions?

Check the logs:
```bash
tail -100 /tmp/knitadvisor.log
```

Or contact support with the error message from the logs.

---

**Status:** FIXED (after running create-admin-sessions.js + restart)  
**Severity:** CRITICAL (blocks all admin access)  
**Deployment:** knitadvisor.onlinetextileschool.com
