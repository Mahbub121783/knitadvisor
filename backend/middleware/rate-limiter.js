/**
 * Simple in-memory rate limiter
 * 240 req/min per IP
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

module.exports = rateLimiter;
