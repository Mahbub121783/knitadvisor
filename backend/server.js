/**
 * KnitAdvisor Server — Entry Point
 * Runs on cPanel Node.js App
 */
// Load environment variables from either application root or backend folder
(() => {
  const path = require('path');
  const fs = require('fs');
  const rootEnv = path.join(__dirname, '..', '.env');
  if (fs.existsSync(rootEnv)) {
    require('dotenv').config({ path: rootEnv });
  }
  const backendEnv = path.join(__dirname, '.env');
  if (fs.existsSync(backendEnv)) {
    require('dotenv').config({ path: backendEnv });
  }
})();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const apiRoutes = require('./routes/api');
const vizRoutes = require('./routes/viz');
const adminRoutes = require('./routes/admin');
const cronRoutes = require('./routes/internal-cron');
const rateLimiter = require('./middleware/rate-limiter');
const { testConnection, poolStats, query } = require('./db/client');
const seed = require('./db/seed');

const app = express();
const PORT = process.env.PORT || 3001;

// This runs on cPanel behind Apache/Passenger's reverse proxy — without this,
// Express never reads X-Forwarded-For, so req.ip resolves to the proxy's own
// address for EVERY visitor. The per-IP rate limiter below then shares ONE
// bucket across the entire site's traffic instead of one per real visitor,
// so unrelated users' requests count against each other and legitimate use
// (e.g. comparing several fabric types in one session) can trip a 429 that
// looks like random per-fabric breakage but has nothing to do with the fabric.
app.set('trust proxy', 1);

// ============================================================
// MIDDLEWARE
// ============================================================
// Apache/Passenger terminates TLS and forwards over plain HTTP, so an http://
// visitor reaches Express looking identical to an https:// one apart from this
// header. Without the redirect the HSTS header below never gets a chance to
// apply — a first-time visitor's whole session, admin login included, can stay
// in cleartext.
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();
  if (req.secure || req.get('x-forwarded-proto') === 'https') return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  return res.redirect(308, 'https://' + req.get('host') + req.originalUrl);
});

// The admin panel renders log rows built from request bodies, so a CSP is a
// real second line of defence there rather than decoration. Keep it permissive
// enough for the existing inline scripts and the Three.js import map, but shut
// the door on injected external script sources.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Static assets dominate this app's bytes — three.module.js alone is 1.27 MB —
// and Passenger serves them through Node, not Apache, because the subdomain's
// document root holds only the Passenger .htaccess. Uncompressed that was a
// multi-second first paint on every cold visit.
app.use(compression());

// cors() with no options answers every origin with Access-Control-Allow-Origin:*,
// which let any site script the API (including the unauthenticated AI parse
// endpoint) from a visitor's browser. Same-origin is all the frontend needs;
// extra origins can be listed in CORS_ORIGINS as a comma-separated list.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);            // same-origin / curl / server-to-server
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);                        // no CORS headers — browser blocks it
  },
  credentials: false,
}));

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// Rate limiter on API routes
app.use('/api', rateLimiter);

// ============================================================
// ROUTES
// ============================================================

// API routes
app.use('/api', apiRoutes);

// Visualization routes (internal — no external APIs)
app.use('/api', vizRoutes);

// Admin routes
app.use('/admin', adminRoutes);

// Scheduled maintenance, driven by cPanel cron. Secret-gated, not rate limited
// (cron is the only caller and a 429 would silently skip a backup).
app.use('/internal-cron', cronRoutes);

// Emergency recovery routes are deliberately NOT mounted. They were written for
// a period when SSH to the cPanel host was unavailable, and every one of them is
// unauthenticated by design: /write-env can repoint the app at another database,
// /test-login is an unrate-limited password oracle, /fix-all writes to the DB and
// restarts the app. SSH works now, so the recovery path they existed for is gone
// while their exposure was not. Set EMERGENCY_ROUTES=enabled to mount them for a
// specific incident, and unset it again afterwards.
if (process.env.EMERGENCY_ROUTES === 'enabled') {
  console.warn('[Server] EMERGENCY ROUTES MOUNTED — unauthenticated. Disable when done.');
  app.use('/emergency', require('./routes/emergency'));
}

// Static frontend (served by Express in dev, Apache in production)
// IMPORTANT: HTML must never be heuristically cached, otherwise a stale
// index.html keeps running an old inline script and new front-end logic
// (e.g. the colour-engine input) silently never reaches the backend.
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.includes('vendor')) {
      // Vendored libraries are pinned to a version and only change when the file
      // is replaced wholesale, so they can be cached hard. Everything else gets
      // revalidated so an engine fix reaches browsers on the next load.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  },
}));

// Deep health check: verifies the database round-trips and reports pool
// pressure. The plain /health below only proves the process is alive, which is
// all the existing 5-minute cron ping needs; this one is for diagnosing.
app.get('/health/deep', async (req, res) => {
  const started = Date.now();
  let db;
  try {
    const [row] = await query('SELECT now() AS ts');
    db = { ok: true, latency_ms: Date.now() - started, server_time: row.ts };
  } catch (err) {
    db = { ok: false, error: err.message };
  }
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    version: '1.1.0',
    database: db,
    pool: poolStats(),
    memory_mb: Math.round(process.memoryUsage().rss / 1048576),
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '1.1.0',
  });
});

// This app is a set of real .html pages, not a client-routed SPA, so anything
// that reached here matched no static file. Serving index.html with a 200 told
// crawlers every typo URL was a valid page and hid broken links from us.
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(__dirname, '..', 'frontend', '404.html'), (err) => {
    if (err) res.status(404).type('txt').send('404 — Not found');
  });
});

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ============================================================
// START
// ============================================================
async function start() {
  console.log('===========================================');
  console.log('  KnitAdvisor Server v1.1 — PostgreSQL');
  console.log('===========================================');

  const dbOk = await testConnection();
  if (!dbOk) {
    // The engine is pure computation and needs no database, so the app still
    // serves calculations. What is lost is the L2 cache, query logging and the
    // admin panel — worth saying explicitly rather than failing obscurely later.
    console.warn('[WARN] Database not available. Running without L2 cache, logging and admin.');
    console.warn('[WARN] Calculation engine still works (in-memory only).');
  } else {
    try {
      // Refuses to start against an unmigrated schema instead of failing one
      // request at a time with "relation does not exist".
      const seeded = await seed.run();
      console.log('[Seed]', JSON.stringify(seeded));
    } catch (err) {
      console.error('[FATAL] ' + err.message);
      process.exit(1);
    }
  }

  app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
    console.log(`[Server] API: http://localhost:${PORT}/api`);
    console.log(`[Server] Health: http://localhost:${PORT}/health`);
    console.log('===========================================');
  });
}

start();

module.exports = app; // for testing
