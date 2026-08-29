# KnitAdvisor Remote Database Configuration & Management Guide

This document describes the remote MySQL database setup, connection variables, and guidelines to ensure continuous development and deployment without risking user data loss or service disruption.

---

## 🚀 Overview

To maintain continuous development while protecting live user calculations, query history, and system logs, **KnitAdvisor uses a unified remote database model**. 
The local SQL files (`database/schema.sql` and `database/seed-data.sql`) have been **permanently deleted** from the repository to prevent accidental re-imports or table drops during production updates.

Both the local development environment and the live cPanel production environment connect directly to the same remote MySQL server.

---

## ⚙️ Connection Configurations

### 1. Local Development (`backend/.env`)
Your local backend environment uses the absolute path-based `.env` configuration to read credentials. It connects directly to the remote host:
```env
DB_HOST=38.46.220.25
DB_PORT=3306
DB_USER=tecnedub_knitadvisor
DB_PASS=M@hbubu5
DB_NAME=tecnedub_knitadvisor
```

### 2. Production Environment (cPanel Node.js App)
In production, environment variables are loaded securely via the **cPanel Application Manager dashboard** under the **Setup Node.js App** dashboard (Environment Variables section) pointing to the same database.

> [!NOTE]
> Since the database host is remote (`38.46.220.25`), you **do not need to install or run a local MySQL service** on your development machine. The system works immediately out of the box.

---

## ⚠️ Continuous Deployment (GitHub Actions)

KnitAdvisor uses a GitHub Action workflow (`.github/workflows/deploy.yml`) to automatically sync code to cPanel via FTP. 

- **Database Safety**: The deploy script **never** modifies the database tables.
- **Environment Exclusions**: The `.env` and `backend/.env` files are explicitly ignored by Git and excluded from FTP deployment to prevent local credentials from overwriting production environment variables.

---

## 🛠️ Best Practices for Database Schema Changes

If you need to add a new table, change a column, or update master parameters:

### 1. Do Not Drop Tables or Re-import Schema
Never execute `DROP DATABASE` or `DROP TABLE` on the live database. Doing so will delete live user calculation logs, registered API providers, cached results, and session tokens.

### 2. Manual Schema Modifications via phpMyAdmin
1. Log in to your **cPanel Dashboard** and open **phpMyAdmin**.
2. Select `tecnedub_knitadvisor`.
3. Perform incremental updates (e.g. `ALTER TABLE`, `ADD COLUMN`) directly inside phpMyAdmin's SQL execution tab.

### 3. Incremental Database Migrations (Recommended)
Write a Node.js migration script under `backend/scripts/` (for example, similar to `backend/scripts/migrate-providers.js`) to apply modifications programmatically:
```javascript
const { query } = require('../config/database');

async function run() {
  console.log('Applying database updates...');
  await query('ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS user_session_id VARCHAR(100);');
  console.log('Update complete!');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
```
You can run this migration script locally, and it will immediately execute against the remote database.

---

## 💾 Automated Database Backups

To protect against accidental user data loss, cPanel is configured with a daily cron job that backs up the entire database every midnight:

- **Storage Location**: `/home/tecnedub/db_backups/`
- **Filename Pattern**: `knitadvisor_YYYY-MM-DD.sql.gz`
- **Cron Command**:
  ```bash
  /usr/bin/mysqldump -u tecnedub_knitadvisor -p'M@hbubu5' tecnedub_knitadvisor | gzip > /home/tecnedub/db_backups/knitadvisor_$(date +\%F).sql.gz
  ```

If you ever need to restore user data or query logs, retrieve the latest backup from the `db_backups` folder via cPanel File Manager and import it inside phpMyAdmin.
