/**
 * API key gate: a request that carries "Authorization: Bearer ka_live_..." (or
 * X-API-Key) is a customer's own system calling the engines. requireUser hands
 * such a request here instead of looking for a browser session.
 *
 * A call carries THREE things that must agree: the key; the email of the account it was issued to
 * (X-User-Email); and — when the key is registered to a website — that website. A browser sends its own
 * Origin (a web page cannot forge it); a server names the site in X-Website. A key with no email, or
 * another account's email, or the wrong website, is refused: a key found on its own is not enough, and a
 * customer who points the wrong key at the wrong system finds out at once. Wrong emails and wrong websites
 * count towards the same "too many bad keys" limit and use no quota.
 *
 * In order: the endpoint must be one the API sells (never the account itself);
 * the key must exist, be active, unexpired, its owner enabled, and — if the key
 * has an allowed-IP list — the caller on it; then the per-minute rate and the
 * monthly quota are counted, both shared across workers. The counters fail
 * CLOSED here (a paid API that silently stops metering is worse than a short
 * outage), unlike the web app's limiters.
 *
 * A browser call: the request's Origin must be one of the key's allowed sites (a key used
 * from a web page is visible to its visitors, so it is held to that site, and should carry
 * a small quota); the answer then carries the CORS headers for that site only. A key with
 * no allowed sites refuses any request that has an Origin — it is a server's key.
 *
 * On success req.user is the key's owner (so the engine routes run unchanged)
 * and req.apiKey the key; the answer carries X-RateLimit-* (per minute) and
 * X-Quota-* (per month) headers.
 */
'use strict';
const catalogue = require('../engine/domain/api-catalogue');
const apiRepo = require('../db/repositories/api-key-repo');

const FAIL_PER_MIN = 20;          // wrong keys from one address per minute

const refuse = (res, status, code, error, extra) => res.status(status).json({ success: false, code, error, ...(extra || {}) });

/** Start of next month, Asia/Dhaka (UTC+6, no DST), as an ISO string. */
function nextReset(now = new Date()) {
  const d = new Date(now.getTime() + 6 * 3600 * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 6 * 3600 * 1000).toISOString();
}

function createGate(repo = apiRepo.keys, deps = {}) {
  const cat = deps.catalogue || catalogue;
  const now = deps.now || (() => new Date());
  return async function apiKeyGate(req, res, next, rawKey) {
    try {
      const endpoint = cat.matchEndpoint(req.method, req.path);
      if (!endpoint) return refuse(res, 403, 'ENDPOINT_NOT_IN_API', 'This endpoint is not part of the KnitAdvisor API. See /api-docs.html for what an API key can call.');
      const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
      const key = apiRepo.KEY_RE.test(rawKey) ? await repo.findByHash(apiRepo.hashKey(rawKey)) : null;
      if (!key) {
        const f = await repo.hitWindow('apikey_fail', ip, 60);
        if (f && f.count > FAIL_PER_MIN) { res.set('Retry-After', '60'); return refuse(res, 429, 'TOO_MANY_BAD_KEYS', 'Too many invalid API keys from this address. Wait a minute.'); }
        return refuse(res, 401, 'INVALID_API_KEY', 'This API key is not valid. Check it was copied whole, and that it has not been revoked.');
      }
      // the key and the account email must agree
      const sent = String((req.headers && req.headers['x-user-email']) || '').trim().toLowerCase();
      if (!sent) return refuse(res, 401, 'EMAIL_REQUIRED', 'Send the email of the account this key was issued to in the X-User-Email header, together with the key.');
      if (sent !== String(key.email || '').trim().toLowerCase()) {
        const f = await repo.hitWindow('apikey_fail', ip, 60);
        if (f && f.count > FAIL_PER_MIN) { res.set('Retry-After', '60'); return refuse(res, 429, 'TOO_MANY_BAD_KEYS', 'Too many invalid API keys from this address. Wait a minute.'); }
        return refuse(res, 401, 'EMAIL_MISMATCH', 'This email does not match the account this key was issued to. Use the email of the account that owns the key.');
      }
      // the website: the key's own, from the browser's Origin (it cannot be forged by a page) or, from a server, the X-Website header
      const sites = key.allowed_origins || [];
      const origin = req.headers && req.headers.origin ? String(req.headers.origin).trim().toLowerCase() : '';
      const declared = String((req.headers && req.headers['x-website']) || '').trim().toLowerCase().replace(/\/+$/, '');
      const badSite = async (code, text, extra) => {
        const f = await repo.hitWindow('apikey_fail', ip, 60);
        if (f && f.count > FAIL_PER_MIN) { res.set('Retry-After', '60'); return refuse(res, 429, 'TOO_MANY_BAD_KEYS', 'Too many invalid API keys from this address. Wait a minute.'); }
        return refuse(res, 401, code, text, extra);
      };
      if (origin && !sites.includes(origin)) return badSite('WEBSITE_MISMATCH', sites.length ? 'This key is registered to another website. A web page can use it only from the site it was registered for.' : 'This key is not registered for use from a web page. It is a server key: call the API from your server.', { your_origin: origin });
      if (sites.length) {
        const site = origin || declared;
        if (!site) return refuse(res, 401, 'WEBSITE_REQUIRED', 'This key is registered to a website. Send that website in the X-Website header (a browser sends its own Origin), together with the key and the email.');
        if (!sites.includes(site)) return badSite('WEBSITE_MISMATCH', 'This website is not the one this key is registered to. Use the key, the email and the website of the same registration.', { your_website: site });
        if (origin) cors(res, origin);
      }
      if (key.status === 'revoked') return refuse(res, 401, 'KEY_REVOKED', 'This API key has been revoked.');
      if (key.status === 'suspended') return refuse(res, 403, 'KEY_SUSPENDED', 'This API key is suspended. Contact KnitAdvisor.');
      if (key.expires_at && new Date(key.expires_at) < now()) return refuse(res, 401, 'KEY_EXPIRED', 'This API key has expired.');
      if (key.user_disabled) return refuse(res, 403, 'ACCOUNT_DISABLED', 'The account this key belongs to is disabled.');
      if (key.allowed_ips && key.allowed_ips.length) {
        const norm = (s) => String(s).replace(/^::ffff:/i, '');
        if (!key.allowed_ips.map(norm).includes(norm(ip))) return refuse(res, 403, 'IP_NOT_ALLOWED', 'This key may not be used from this IP address.', { your_ip: norm(ip) });
      }
      const lim = cat.limitsFor(key);

      // per minute
      const w = await repo.hitWindow('apikey_min', key.id, 60);
      const remainingMin = Math.max(0, lim.per_min - w.count);
      res.set('X-RateLimit-Limit', String(lim.per_min));
      res.set('X-RateLimit-Remaining', String(remainingMin));
      if (w.count > lim.per_min) {
        const retry = Math.max(1, Math.ceil((new Date(w.window_start).getTime() + 60000 - now().getTime()) / 1000));
        res.set('Retry-After', String(retry));
        return refuse(res, 429, 'RATE_LIMITED', `Over ${lim.per_min} calls a minute for this key.`, { retry_after_seconds: retry });
      }
      // per month
      const used = await repo.hitMonth(key.id, lim.monthly);
      res.set('X-Quota-Limit', String(lim.monthly));
      if (used == null) {
        res.set('X-Quota-Remaining', '0'); res.set('X-Quota-Reset', nextReset(now()));
        return refuse(res, 429, 'QUOTA_EXCEEDED', `This key has used its ${lim.monthly.toLocaleString('en')} calls for the month.`, { quota: lim.monthly, resets_at: nextReset(now()) });
      }
      res.set('X-Quota-Remaining', String(Math.max(0, lim.monthly - used)));
      res.set('X-Quota-Reset', nextReset(now()));

      req.apiKey = { id: key.id, name: key.name, prefix: key.prefix, plan: key.plan, limits: lim, used_this_month: used, endpoint: endpoint.id };
      req.user = { id: key.user_id, email: key.email, username: key.username, full_name: key.full_name, company: key.company, is_paid: key.is_paid,
        student_status: key.student_status, student_expires_at: key.student_expires_at, email_verified: key.email_verified, two_factor: key.two_factor };
      res.on('finish', () => { repo.record(key.id, res.statusCode >= 400).catch(() => {}); });
      return next();
    } catch (err) {
      console.error('[ApiKey] gate failed:', err.message);
      return refuse(res, 503, 'API_UNAVAILABLE', 'The API could not check this key just now. Try again in a moment.');
    }
  };
}

const EXPOSE = 'X-RateLimit-Limit, X-RateLimit-Remaining, X-Quota-Limit, X-Quota-Remaining, X-Quota-Reset, Retry-After';
function cors(res, origin) {
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Expose-Headers', EXPOSE);
}

/** The browser's preflight for /api/v1: it carries no key, so it is answered for any site; the real call is held to the key's sites. */
function preflight(req, res) {
  const origin = req.headers.origin;
  if (origin) cors(res, origin);
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key, X-User-Email, X-Website');
  res.set('Access-Control-Max-Age', '600');
  res.status(204).end();
}

/**
 * Everything under /api/v1 passes through here (server.js sets req.viaV1). The API is the catalogue and the
 * listed endpoints, and each of those needs a key — including the engines the website serves openly at /api/x.
 */
function createV1Surface(g) {
  return function v1Surface(req, res, next) {
    if (!req.viaV1) return next();
    if (req.method === 'OPTIONS') return preflight(req, res);
    if (req.method === 'GET' && /^\/catalogue\/?$/.test(req.path)) return next();
    if (!catalogue.matchEndpoint(req.method, req.path)) return refuse(res, 404, 'NOT_IN_API', 'No such endpoint in the KnitAdvisor API. See /api-docs.html for the list.');
    const raw = apiRepo.keyFromRequest(req);
    if (!raw) return refuse(res, 401, 'API_KEY_REQUIRED', 'This endpoint needs an API key: Authorization: Bearer <your key>. See /api-docs.html.');
    return g(req, res, next, raw);
  };
}

const gate = createGate();
const v1Surface = createV1Surface(gate);
module.exports = { createGate, createV1Surface, gate, v1Surface, preflight, nextReset, keyFromRequest: apiRepo.keyFromRequest };
