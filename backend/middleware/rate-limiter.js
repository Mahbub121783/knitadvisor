/**
 * Simple in-memory rate limiter
 * 60 req/min per IP
 */
const limits = new Map();

const WINDOW_MS = 60 * 1000;     // 1 minute
const MAX_PER_WINDOW = 60;

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
