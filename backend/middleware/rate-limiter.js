/**
 * Simple in-memory rate limiter.
 *
 * Default export: 240 req/min per IP for /api.
 * createRateLimiter(): separate, independently-counted buckets for endpoints
 * that need a tighter ceiling than general API browsing — the admin login
 * (brute-force target) and the AI parse endpoint (spends paid provider quota).
 *
 * Counting is per-process and Passenger runs more than one worker, so the real
 * ceiling is the configured limit times the worker count. That is fine for the
 * "bound runaway abuse" job it does here; it is not a billing control. If a hard
 * global limit is ever needed it has to move into the database or a shared store.
 */
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

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of limits) {
    if (now - entry.windowStart > WINDOW_MS * 5) limits.delete(ip);
  }
}, 5 * 60 * 1000);

const scopedLimits = new Map();

/**
 * Build an independently-counted limiter. `name` keys its own bucket map so a
 * burst of ordinary /api traffic can never consume an endpoint's login budget.
 */
function createRateLimiter({ name, max, windowMs = WINDOW_MS, message }) {
  if (!scopedLimits.has(name)) scopedLimits.set(name, new Map());
  const buckets = scopedLimits.get(name);

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of buckets) {
      if (now - entry.windowStart > windowMs * 5) buckets.delete(ip);
    }
  }, 5 * 60 * 1000).unref();

  return function scopedRateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = buckets.get(ip);

    if (!entry || now - entry.windowStart > windowMs) {
      buckets.set(ip, { count: 1, windowStart: now });
      return next();
    }

    entry.count++;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.set('Retry-After', retryAfter);
      return res.status(429).json({
        error: message || 'Too many requests',
        retry_after_seconds: retryAfter,
      });
    }
    next();
  };
}

module.exports = rateLimiter;
module.exports.createRateLimiter = createRateLimiter;
