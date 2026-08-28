/**
 * Result cache (L2) and visualisation render cache.
 *
 * The L2 lookup sits on the request's critical path, so a get() that cannot be
 * answered quickly is treated as a miss: the engine computes in single-digit
 * milliseconds anyway, and a stalled database must not be slower than not
 * having a cache at all. The write-back is fire-and-forget for the same reason.
 */
const { query, queryOne } = require('../client');

const DEFAULT_TTL_S = parseInt(process.env.CACHE_TTL_SECONDS, 10) || 2592000; // 30 days
const GET_TIMEOUT_MS = parseInt(process.env.CACHE_GET_TIMEOUT_MS, 10) || 80;

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ timedOut: true }); } }, ms);
    promise.then(
      (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ timedOut: false, value }); } },
      ()      => { if (!settled) { settled = true; clearTimeout(timer); resolve({ timedOut: false, errored: true }); } }
    );
  });
}

const resultCache = {
  async get(cacheKey) {
    try {
      const outcome = await withTimeout(
        queryOne('SELECT result_json FROM result_cache WHERE cache_key = $1 AND expires_at > now()', [cacheKey]),
        GET_TIMEOUT_MS
      );
      if (outcome.timedOut) {
        console.warn('[Cache] L2 get timed out after', GET_TIMEOUT_MS, 'ms — treating as miss');
        return null;
      }
      if (outcome.errored || !outcome.value) return null;

      // Hit bookkeeping is analytics, not correctness — don't make the response
      // wait on a second round trip for it.
      query('UPDATE result_cache SET hit_count = hit_count + 1, last_hit = now() WHERE cache_key = $1', [cacheKey])
        .catch(err => console.error('[Cache] hit_count update failed:', err.message));

      // jsonb comes back already parsed, unlike the LONGTEXT this replaced.
      return outcome.value.result_json;
    } catch (err) {
      console.error('[Cache] L2 get error:', err.message);
      return null;
    }
  },

  async set(cacheKey, result, ttlSeconds = DEFAULT_TTL_S) {
    try {
      await query(
        `INSERT INTO result_cache (cache_key, result_json, expires_at)
         VALUES ($1, $2, now() + make_interval(secs => $3))
         ON CONFLICT (cache_key) DO UPDATE
           SET result_json = EXCLUDED.result_json,
               hit_count   = 0,
               expires_at  = EXCLUDED.expires_at,
               last_hit    = now()`,
        [cacheKey, JSON.stringify(result), ttlSeconds]
      );
    } catch (err) {
      console.error('[Cache] L2 set error:', err.message);
    }
  },

  async flush() {
    try {
      const rows = await query('DELETE FROM result_cache RETURNING cache_key');
      return rows.length;
    } catch (err) {
      console.error('[Cache] flush error:', err.message);
      return 0;
    }
  },

  async remove(cacheKey) {
    const rows = await query('DELETE FROM result_cache WHERE cache_key = $1 RETURNING cache_key', [cacheKey]);
    return rows.length > 0;
  },

  async stats() {
    try {
      return await queryOne(`
        SELECT count(*)::int              AS entries,
               coalesce(sum(hit_count),0)::int AS total_hits,
               min(created_at)            AS oldest,
               max(created_at)            AS newest
        FROM result_cache WHERE expires_at > now()`);
    } catch {
      return { entries: 0, total_hits: 0, oldest: null, newest: null };
    }
  },

  async list({ page = 1, limit = 25 } = {}) {
    const offset = (page - 1) * limit;
    const [{ count }] = await query('SELECT count(*)::int AS count FROM result_cache WHERE expires_at > now()');
    const rows = await query(
      `SELECT cache_key, hit_count, created_at, expires_at
       FROM result_cache WHERE expires_at > now()
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return { rows, total: count, page, pages: Math.ceil(count / limit) };
  },

  async entry(cacheKey) {
    return queryOne(
      'SELECT cache_key, result_json, hit_count, created_at, expires_at FROM result_cache WHERE cache_key = $1',
      [cacheKey]
    );
  },

  /** Removes expired rows. Called by the prune-cache cron job. */
  async prune() {
    const rows = await query('DELETE FROM result_cache WHERE expires_at <= now() RETURNING cache_key');
    return rows.length;
  },
};

const vizCache = {
  async get(cacheKey) {
    const row = await queryOne(
      'SELECT path_json FROM viz_render_cache WHERE cache_key = $1 AND expires_at > now()',
      [cacheKey]
    );
    if (!row) return null;
    query('UPDATE viz_render_cache SET hit_count = hit_count + 1, last_hit = now() WHERE cache_key = $1', [cacheKey])
      .catch(err => console.error('[VizCache] hit_count update failed:', err.message));
    return row.path_json;
  },

  async set(cacheKey, fabricId, payload, renderMs, ttlSeconds = 7 * 24 * 3600) {
    await query(
      `INSERT INTO viz_render_cache (cache_key, fabric_id, path_json, render_ms, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
       ON CONFLICT (cache_key) DO UPDATE
         SET path_json  = EXCLUDED.path_json,
             render_ms  = EXCLUDED.render_ms,
             expires_at = EXCLUDED.expires_at`,
      [cacheKey, fabricId, JSON.stringify(payload), renderMs ?? null, ttlSeconds]
    );
  },

  async prune() {
    const rows = await query('DELETE FROM viz_render_cache WHERE expires_at <= now() RETURNING id');
    return rows.length;
  },
};

module.exports = { resultCache, vizCache };
