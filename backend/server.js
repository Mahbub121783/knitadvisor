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
const fs = require('fs');

const apiRoutes = require('./routes/api');
const vizRoutes = require('./routes/viz');
const adminRoutes = require('./routes/admin');
const cronRoutes = require('./routes/internal-cron');
const searchRoutes = require('./routes/search');
const rateLimiter = require('./middleware/rate-limiter');
const { testConnection, poolStats, query } = require('./db/client');
const seed = require('./db/seed');
const reference = require('./engine/reference');

// Load the reference snapshot as soon as this module is required, NOT inside
// start(). Passenger hooks app.listen() and begins serving the moment the module
// body finishes, without waiting for start()'s promise — so anything awaited in
// there can still be pending when the first request lands, and anything that
// throws before it leaves the snapshot unloaded on a process that is already
// answering. Kicking it off here ties the load to module evaluation, which
// Passenger does wait for.
//
// The engine reads this snapshot synchronously on every calculation; loading it
// once, here, is what lets calculate() stay synchronous while the data itself
// lives in PostgreSQL. load() falls back to the seed files in backend/data/ when
// the database is unreachable, which is why the no-database path can still
// promise working calculations.
const referenceReady = reference.load()
  .then(() => {
    const st = reference.status();
    console.log(`[Reference] loaded from ${st.origin} —`, JSON.stringify(st.counts));
    if (st.origin === 'files') {
      console.warn('[Reference] seed-file fallback in use:', st.last_error);
    }
  })
  .catch(err => console.error('[Reference] load failed entirely:', err.message));

// Market yarn quotes, loaded the same way and for the same reason: the costing
// engine is synchronous. Unlike the reference layer this one is ALLOWED to be
// empty — before the first sync it is, and a costing then falls back to the
// reference price list and says so. So a failure here is logged and not fatal.
const yarnPrices = require('./db/repositories/yarn-price-repo');
yarnPrices.load()
  .then(r => console.log(`[Prices] ${r.quotes} market quotes over ${r.items} items, newest ${r.newest || 'none'}`))
  .catch(err => console.warn('[Prices] no market quotes loaded, the reference list will answer:', err.message));

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
// real second line of defence there rather than decoration.
//
// It has to be two policies, because the two halves of the site are built
// differently. admin.html loads all of its code from assets/js/admin.js and
// carries no inline <script> and no inline handler, so it can take a policy
// with no 'unsafe-inline' at all — which is the whole reason the CSP was added.
// The public pages are the opposite: their logic lives in inline <script>
// blocks and ~60 onclick attributes.
//
// One merged policy got this exactly backwards. scriptSrc listed
// 'unsafe-inline', which gutted the protection on the one page that needed it,
// while helmet's default scriptSrcAttr: 'none' survived the merge and blocked
// every onclick on the public pages — so Calculate and every suggestion chip
// silently did nothing. Note that allowing inline <script> while blocking
// inline handlers is not a coherent posture anyway: whoever can inject one can
// inject the other. The directives that do the real work here — objectSrc,
// connectSrc, frameAncestors, and 'self' on scriptSrc — are identical in both.
const CSP_SHARED = {
  defaultSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: ["'self'"],
  workerSrc: ["'self'", 'blob:'],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
};

const publicSecurity = helmet({
  contentSecurityPolicy: {
    directives: {
      ...CSP_SHARED,
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

const adminSecurity = helmet({
  contentSecurityPolicy: {
    directives: {
      ...CSP_SHARED,
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// Which requests get the strict policy. Lives in its own module so a test can
// hold it to the routes that actually exist — the previous pattern named
// /admin.html and /api/admin, the second of which has never been a path here,
// so it matched NEITHER and the strict policy was applied to nothing at all.
const { ADMIN_SURFACE } = require('./middleware/admin-surface');
app.use((req, res, next) =>
  (ADMIN_SURFACE.test(req.path) ? adminSecurity : publicSecurity)(req, res, next));

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

// Fuzzy reference search (pg_trgm). Mounted under /api/search so it sits
// beside the calculation API without being part of it — nothing here feeds
// a calculation, it only helps a user find the right input.
app.use('/api/search', searchRoutes);

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

// Every page now declares <link rel="icon" href="/favicon.svg">, so browsers
// that honour it never ask for /favicon.ico. Safari and various crawlers ask
// anyway, and without this the request falls through to the SPA 404 handler and
// gets 12 KB of 404.html in reply to a request for an icon — which is what put
// a red "favicon.ico 404" in the console. 204 answers it honestly and cheaply.
app.get('/favicon.ico', (req, res) => res.status(204).end());

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
    // Which tier the running process is actually serving reference data from.
    // A process that fell back to files answers every calculation correctly but
    // will not see an import until it is restarted, and that is invisible from
    // the outside — so it is reported here rather than only in the boot log.
    reference: reference.status(),
    pool: poolStats(),
    memory_mb: Math.round(process.memoryUsage().rss / 1048576),
  });
});

// Health check
// The build this process actually booted with. Passenger reloads when
// backend/tmp/restart.txt changes and the deploy writes the commit SHA into
// that file, so reading it at boot tells us which revision is SERVING — not
// which one is on disk. Those have come apart twice: once because the trigger
// was uploaded before the code it was meant to activate, and once because the
// trigger was not uploaded at all, and both times the deploy reported success
// while the previous revision carried on answering. Reporting it here lets the
// workflow assert the deploy took, instead of assuming it.
const BOOT_BUILD = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'tmp', 'restart.txt'), 'utf8').trim().slice(0, 40);
  } catch {
    return null;
  }
})();

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '1.1.0',
    build: BOOT_BUILD,
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

  await referenceReady;

  app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
    console.log(`[Server] API: http://localhost:${PORT}/api`);
    console.log(`[Server] Health: http://localhost:${PORT}/health`);
    console.log('===========================================');
  });
}

start();

module.exports = app; // for testing
