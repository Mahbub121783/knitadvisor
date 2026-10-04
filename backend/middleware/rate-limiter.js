/**
 * Rate limiters.
 *
 * Default export: 240 req/min per IP across /api. Counted in process memory on
 * purpose — it bounds runaway scripts, and a database write per API request
 * would cost far more than the abuse it stops. Its ceiling is therefore the
 * configured limit times the worker count; it is not a billing control.
 *
 * createRateLimiter(): independently-counted buckets for endpoints where the
 * count matters — login, signup, verification codes, AI parse (paid quota),
 * student verification, RFQ submit. These count in the database
 * (rate_limit_hits, migration 032) so every worker shares one count and a
 * restart does not reset it.
 */
const { query } = require('../db/client');

const limits = new Map();

const WINDOW_MS = 60 * 1000;     // 1 minute
// A single "switch fabric and look at it" action already fires 2+ API calls
// (calculate + pattern), and someone comparing several rib gauge combos back
// to back easily does that a dozen times in a minute — the old 60/min ceiling
// left almost no headroom for real interactive use once trust-proxy was fixed
// to correctly separate visitors (previously it was masked by all traffic
// sharing one bucket). 240/min is still far below anything a human clicking
// through the UI could hit, while still bounding scripted abuse.
const MAX_PER_WINDOW = 240;

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  if (!limits.has(ip)) {
    limits.set(ip, { count: 1, windowStart: now });
    return next();
  }

  const entry = limits.get(ip);

  // Reset window if expired
  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 1;
    entry.windowStart = now;
    return next();
  }

  entry.count++;
  if (entry.count > MAX_PER_WINDOW) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    res.set('Retry-After', retryAfter);
    return res.status(429).json({
      error: 'Too many requests',
      retry_after_seconds: retryAfter,
    });
  }
  next();
}

// Cleanup old entries every 5 minutes. unref(): this timer alone must never
// keep a process alive — it would hang any script that loads this module.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of limits) {
    if (now - entry.windowStart > WINDOW_MS * 5) limits.delete(ip);
  }
}, 5 * 60 * 1000).unref();

/**
 * Shared counter store (migration 032). One atomic UPSERT per hit: a row whose
 * window has lapsed restarts at 1, otherwise it increments. Returns the count
 * and when the current window opened, so the caller can say how long to wait.
 */
const HIT_SQL = `
  INSERT INTO rate_limit_hits (bucket, key, window_start, count)
  VALUES ($1, $2, now(), 1)
  ON CONFLICT (bucket, key) DO UPDATE SET
    window_start = CASE WHEN rate_limit_hits.window_start < now() - make_interval(secs => $3::double precision)
                        THEN now() ELSE rate_limit_hits.window_start END,
    count        = CASE WHEN rate_limit_hits.window_start < now() - make_interval(secs => $3::double precision)
                        THEN 1 ELSE rate_limit_hits.count + 1 END
  RETURNING count, window_start`;

/**
 * Build a limiter whose counts are shared across every Passenger worker and
 * survive a restart. `name` is the bucket, so a burst on one endpoint never
 * spends another endpoint's budget.
 *
 * If the database cannot be reached, the request is ALLOWED and the failure
 * logged. Failing closed would turn a database blip into a site-wide login
 * outage; a few unlimited attempts during that blip is the lesser harm.
 */
function createRateLimiter({ name, max, windowMs = WINDOW_MS, message }) {
  return async function scopedRateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    let hit;
    try {
      const rows = await query(HIT_SQL, [name, ip, windowMs / 1000]);
      hit = rows[0];
    } catch (err) {
      console.error(`[RateLimit] shared store unavailable for "${name}", allowing request:`, err.message);
      return next();
    }

    if (hit.count > max) {
      const windowEnd = new Date(hit.window_start).getTime() + windowMs;
      const retryAfter = Math.max(1, Math.ceil((windowEnd - Date.now()) / 1000));
      res.set('Retry-After', retryAfter);
      return res.status(429).json({
        error: message || 'Too many requests',
        retry_after_seconds: retryAfter,
      });
    }
    next();
  };
}

/** Housekeeping for the cron job — a counter row is useless once its window has long passed. */
async function pruneRateLimitHits(olderThanHours = 24) {
  const rows = await query(
    "DELETE FROM rate_limit_hits WHERE window_start < now() - make_interval(hours => $1::int) RETURNING 1",
    [olderThanHours]
  );
  return rows.length;
}

module.exports = rateLimiter;
module.exports.createRateLimiter = createRateLimiter;
module.exports.pruneRateLimitHits = pruneRateLimitHits;
