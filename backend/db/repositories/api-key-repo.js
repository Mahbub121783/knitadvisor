/**
 * API keys (migration 041). Only the SHA-256 of a key is stored; the full key is
 * returned once, by create(). Counters are single atomic statements so two
 * workers can never both decide a key is still under its limit.
 */
'use strict';
const crypto = require('crypto');
const { query, queryOne } = require('../client');

const KEY_RE = /^ka_live_[A-Za-z0-9_-]{43}$/;
const tz = () => process.env.BUSINESS_TIMEZONE || 'Asia/Dhaka';

class KeyError extends Error {}

const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

/** A new key: 256 random bits, url-safe, with a recognisable prefix. */
function generateKey() {
  const key = 'ka_live_' + crypto.randomBytes(32).toString('base64url');
  return { key, prefix: key.slice(0, 15), hash: hashKey(key) };
}

/** The key a request carries (Authorization: Bearer, or X-API-Key), exactly as sent, or null. */
function keyFromRequest(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  const m = h.match(/^Bearer\s+(\S+)$/i);
  const raw = (m && m[1]) || (req.headers && req.headers['x-api-key']) || '';
  return typeof raw === 'string' && raw.startsWith('ka_') ? raw : null;
}

const OWNER = `u.id AS user_id, u.email, u.username, u.full_name, u.company, u.is_paid, u.student_status, u.student_expires_at, u.email_verified, u.two_factor, u.disabled AS user_disabled`;

const keys = {
  /** Every key with its owner and this month's calls (admin). */
  list() {
    return query(
      `SELECT k.id, k.name, k.prefix, k.plan, k.monthly_limit, k.per_min_limit, k.status, k.allowed_ips, k.allowed_origins, k.note, k.expires_at, k.created_at, k.last_used_at, k.revoked_at,
              u.email, u.full_name, u.company, COALESCE(m.calls, 0) AS calls_this_month
         FROM api_keys k JOIN app_users u ON u.id = k.user_id
         LEFT JOIN api_key_usage m ON m.key_id = k.id AND m.period = to_char(now() AT TIME ZONE $1, 'YYYY-MM')
        ORDER BY k.created_at DESC LIMIT 500`,
      [tz()]
    );
  },

  /** One account's keys (its owner). */
  listForUser(userId) {
    return query(
      `SELECT k.id, k.name, k.prefix, k.plan, k.monthly_limit, k.per_min_limit, k.status, k.allowed_ips, k.allowed_origins, k.expires_at, k.created_at, k.last_used_at, COALESCE(m.calls, 0) AS calls_this_month
         FROM api_keys k
         LEFT JOIN api_key_usage m ON m.key_id = k.id AND m.period = to_char(now() AT TIME ZONE $2, 'YYYY-MM')
        WHERE k.user_id = $1 AND k.status <> 'revoked' ORDER BY k.created_at DESC`,
      [userId, tz()]
    );
  },

  /** The key behind a request, with its owner. Null if no such key. */
  findByHash(hash) {
    return queryOne(
      `SELECT k.id, k.name, k.prefix, k.plan, k.monthly_limit, k.per_min_limit, k.status, k.allowed_ips, k.allowed_origins, k.expires_at, ${OWNER}
         FROM api_keys k JOIN app_users u ON u.id = k.user_id WHERE k.key_hash = $1`,
      [hash]
    );
  },

  /** Issues a key for an account found by email (admin). Returns the row and the key, once. */
  async create(opts, catalogue) {
    const user = await queryOne('SELECT id, email, disabled FROM app_users WHERE lower(email) = lower($1)', [String(opts.email || '').trim()]);
    if (!user) throw new KeyError('No customer account has that email. They must sign up first.');
    return keys.issue(user, opts, catalogue);
  },

  /** The same, for a known account (a paid order the customer turns into a key). */
  async createForUser(userId, opts, catalogue) {
    const user = await queryOne('SELECT id, email, disabled FROM app_users WHERE id = $1', [userId]);
    if (!user) throw new KeyError('Account not found.');
    return keys.issue(user, opts, catalogue);
  },

  async issue(user, { name, plan, monthly_limit, per_min_limit, allowed_ips, allowed_origins, expires_at, note }, catalogue) {
    if (user.disabled) throw new KeyError('That account is disabled.');
    const p = catalogue.PLANS[plan];
    if (!p) throw new KeyError(`Unknown plan "${plan}".`);
    const nm = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'API key';
    const monthly = monthly_limit === '' || monthly_limit == null ? p.monthly : +monthly_limit;
    const perMin = per_min_limit === '' || per_min_limit == null ? p.per_min : +per_min_limit;
    if (!Number.isInteger(monthly) || monthly < 0 || monthly > 1e9) throw new KeyError('The monthly limit must be a whole number from 0 up.');
    if (!Number.isInteger(perMin) || perMin < 1 || perMin > 100000) throw new KeyError('The per-minute limit must be a whole number of 1 or more.');
    const ips = cleanIps(allowed_ips), origins = cleanOrigins(allowed_origins);
    let exp = null;
    if (expires_at) { exp = new Date(expires_at); if (isNaN(exp) || exp < new Date()) throw new KeyError('The expiry date must be in the future.'); }
    const g = generateKey();
    const row = await queryOne(
      `INSERT INTO api_keys (user_id, name, prefix, key_hash, plan, monthly_limit, per_min_limit, allowed_ips, allowed_origins, expires_at, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, name, prefix, plan, monthly_limit, per_min_limit, status, allowed_ips, allowed_origins, expires_at, created_at`,
      [user.id, nm, g.prefix, g.hash, plan, monthly, perMin, ips, origins, exp, note ? String(note).slice(0, 200) : null]
    );
    return { ...row, email: user.email, key: g.key };
  },

  /** Plan, limits, allowed IPs / origins, status. A revoked key stays revoked. */
  async update(id, patch, catalogue) {
    const k = await queryOne('SELECT * FROM api_keys WHERE id = $1', [id]);
    if (!k) throw new KeyError('Key not found.');
    if (k.status === 'revoked') throw new KeyError('A revoked key cannot be changed. Issue a new one.');
    const plan = patch.plan != null ? patch.plan : k.plan;
    if (!catalogue.PLANS[plan]) throw new KeyError(`Unknown plan "${plan}".`);
    const num = (v, cur, lo, hi, what) => { if (v === undefined) return cur; const n = +v; if (!Number.isInteger(n) || n < lo || n > hi) throw new KeyError(`${what} is not valid.`); return n; };
    const monthly = num(patch.monthly_limit, k.monthly_limit, 0, 1e9, 'The monthly limit');
    const perMin = num(patch.per_min_limit, k.per_min_limit, 1, 100000, 'The per-minute limit');
    const status = patch.status != null ? patch.status : k.status;
    if (!['active', 'suspended'].includes(status)) throw new KeyError('Status is active or suspended (revoke is separate).');
    const ips = patch.allowed_ips !== undefined ? cleanIps(patch.allowed_ips) : k.allowed_ips;
    const origins = patch.allowed_origins !== undefined ? cleanOrigins(patch.allowed_origins) : k.allowed_origins;
    const name = patch.name != null ? String(patch.name).replace(/\s+/g, ' ').trim().slice(0, 60) || k.name : k.name;
    return queryOne(
      `UPDATE api_keys SET plan=$2, monthly_limit=$3, per_min_limit=$4, status=$5, allowed_ips=$6, allowed_origins=$7, name=$8 WHERE id=$1
       RETURNING id, name, prefix, plan, monthly_limit, per_min_limit, status, allowed_ips, allowed_origins`,
      [id, plan, monthly, perMin, status, ips, origins, name]
    );
  },

  /** What the key's OWNER may change: its name and where it may be used from. Never plan or limits. */
  async updateOwn(userId, id, patch) {
    const k = await queryOne('SELECT id, name, allowed_ips, allowed_origins, status FROM api_keys WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!k || k.status === 'revoked') throw new KeyError('Key not found.');
    const ips = patch.allowed_ips !== undefined ? cleanIps(patch.allowed_ips) : k.allowed_ips;
    const origins = patch.allowed_origins !== undefined ? cleanOrigins(patch.allowed_origins) : k.allowed_origins;
    const name = patch.name != null ? String(patch.name).replace(/\s+/g, ' ').trim().slice(0, 60) || k.name : k.name;
    return queryOne('UPDATE api_keys SET name = $3, allowed_ips = $4, allowed_origins = $5 WHERE id = $1 AND user_id = $2 RETURNING id, name, prefix, allowed_ips, allowed_origins', [id, userId, name, ips, origins]);
  },

  async revoke(id) {
    const rows = await query("UPDATE api_keys SET status='revoked', revoked_at=now() WHERE id=$1 AND status<>'revoked' RETURNING id", [id]);
    return rows.length > 0;
  },

  /** One call against the monthly quota: the count after it, or null when the key is at its limit. Atomic. */
  async hitMonth(keyId, limit) {
    if (limit < 1) return null;
    const row = await queryOne(
      `INSERT INTO api_key_usage (key_id, period, calls) VALUES ($1, to_char(now() AT TIME ZONE $3, 'YYYY-MM'), 1)
       ON CONFLICT (key_id, period) DO UPDATE SET calls = api_key_usage.calls + 1 WHERE api_key_usage.calls < $2
       RETURNING calls`,
      [keyId, limit, tz()]
    );
    return row ? row.calls : null;
  },

  /** A counter in a window shared by every worker (rate_limit_hits, migration 032): the count and when the window opened. */
  async hitWindow(bucket, key, windowSec) {
    return queryOne(
      `INSERT INTO rate_limit_hits (bucket, key, window_start, count) VALUES ($1, $2, now(), 1)
       ON CONFLICT (bucket, key) DO UPDATE SET
         window_start = CASE WHEN rate_limit_hits.window_start < now() - make_interval(secs => $3::double precision) THEN now() ELSE rate_limit_hits.window_start END,
         count        = CASE WHEN rate_limit_hits.window_start < now() - make_interval(secs => $3::double precision) THEN 1 ELSE rate_limit_hits.count + 1 END
       RETURNING count, window_start`,
      [bucket, String(key), windowSec]
    );
  },

  /** After the response: the day's tally and "last used" — never on the request's path. */
  async record(keyId, isError) {
    await query(
      `INSERT INTO api_key_daily (key_id, day, calls, errors) VALUES ($1, (now() AT TIME ZONE $3)::date, 1, $2)
       ON CONFLICT (key_id, day) DO UPDATE SET calls = api_key_daily.calls + 1, errors = api_key_daily.errors + $2`,
      [keyId, isError ? 1 : 0, tz()]
    );
    await query("UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')", [keyId]);
  },

  /** This month's calls and the last 30 days, for one key. */
  async usage(keyId) {
    const month = await queryOne("SELECT COALESCE(max(calls), 0) AS calls FROM api_key_usage WHERE key_id=$1 AND period = to_char(now() AT TIME ZONE $2, 'YYYY-MM')", [keyId, tz()]);
    const days = await query(
      "SELECT to_char(day, 'YYYY-MM-DD') AS day, calls, errors FROM api_key_daily WHERE key_id=$1 AND day > (now() AT TIME ZONE $2)::date - 30 ORDER BY day",
      [keyId, tz()]
    );
    return { month_calls: month.calls, days };
  },
};

/** Allowed IPs as the owner or the admin typed them: one per line or comma, IPv4 / IPv6 (a CIDR is not read). */
function cleanIps(v) {
  if (v == null || v === '') return null;
  const list = (Array.isArray(v) ? v : String(v).split(/[\s,;]+/)).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return null;
  if (list.length > 20) throw new KeyError('At most 20 allowed IP addresses.');
  list.forEach((ip) => { if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip) || require('net').isIP(ip.replace(/^::ffff:/i, '')) === 0) throw new KeyError(`"${ip}" is not an IP address.`); });
  return list;
}

/** Sites a key may be used from in a browser: https://host[:port] exactly (http only for localhost), no path, no wildcard. */
function cleanOrigins(v) {
  if (v == null || v === '') return null;
  const list = (Array.isArray(v) ? v : String(v).split(/[\s,;]+/)).map((x) => String(x).trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);
  if (!list.length) return null;
  if (list.length > 10) throw new KeyError('At most 10 allowed sites.');
  list.forEach((o) => {
    const m = o.match(/^(https?):\/\/([a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:\d{1,5})?$/);
    if (!m) throw new KeyError(`"${o}" is not a site address. Write it like https://erp.yourmill.com (no path, no * ).`);
    if (m[1] === 'http' && !/^(localhost|127\.0\.0\.1)$/.test(m[2])) throw new KeyError(`"${o}": a site must use https (http is only allowed for localhost while you build).`);
  });
  return [...new Set(list)];
}

module.exports = { keys, KeyError, generateKey, hashKey, keyFromRequest, cleanIps, cleanOrigins, KEY_RE };
