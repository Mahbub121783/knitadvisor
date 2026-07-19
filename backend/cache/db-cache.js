/**
 * MySQL persistent cache — L2 cache layer
 * Survives server restarts. 30-day TTL.
 */
const { query } = require('../config/database');

const DEFAULT_TTL_S = parseInt(process.env.CACHE_TTL_SECONDS) || 2592000; // 30 days

// The calculation engine itself runs in well under 50ms — this L2 lookup only
// exists to survive server restarts / share across instances, not because
// calculation is expensive. But it sits on the request's critical path
// (routes/api.js awaits it before falling through to compute), and the DB is
// remote (network round-trip, connectTimeout up to 20s on a stalled
// connection). A slow/degraded DB was silently making every cache-miss
// request multiple seconds slower than just computing fresh would have been.
// Cap the wait: if the DB doesn't answer within budget, treat it as a miss —
// compute happens anyway and is fast, and the fresh result still gets
// written back to L2 (fire-and-forget, not on this path).
const GET_TIMEOUT_MS = 80;

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ timedOut: true }); } }, ms);
    promise.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ timedOut: false, value: v }); } },
      ()  => { if (!settled) { settled = true; clearTimeout(timer); resolve({ timedOut: false, value: undefined, errored: true }); } }
    );
  });
}

module.exports = {
  async get(cacheKey) {
    try {
      const outcome = await withTimeout(
        query('SELECT result_json FROM result_cache WHERE cache_key = ? AND expires_at > NOW()', [cacheKey]),
        GET_TIMEOUT_MS
      );
      if (outcome.timedOut) {
        console.warn('[DB-Cache] get timed out after', GET_TIMEOUT_MS, 'ms — treating as miss');
        return null;
      }
      if (outcome.errored || !outcome.value) return null;
      const rows = outcome.value;
      if (rows.length > 0) {
        // Hit-count bookkeeping is analytics, not correctness — don't make
        // the response wait on a second round trip for it.
        query('UPDATE result_cache SET hit_count = hit_count + 1, last_hit = NOW() WHERE cache_key = ?', [cacheKey])
          .catch(err => console.error('[DB-Cache] hit_count update error:', err.message));
        return JSON.parse(rows[0].result_json);
      }
      return null;
    } catch (err) {
      console.error('[DB-Cache] get error:', err.message);
      return null;
    }
  },

  async set(cacheKey, result) {
    try {
      const json = JSON.stringify(result);
      await query(
        `INSERT INTO result_cache (cache_key, result_json, expires_at) 
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
         ON DUPLICATE KEY UPDATE result_json = VALUES(result_json), hit_count = 0, expires_at = VALUES(expires_at)`,
        [cacheKey, json, DEFAULT_TTL_S]
      );
    } catch (err) {
      console.error('[DB-Cache] set error:', err.message);
    }
  },

  async flush() {
    try {
      await query('DELETE FROM result_cache');
      return true;
    } catch (err) {
      console.error('[DB-Cache] flush error:', err.message);
      return false;
    }
  },

  async stats() {
    try {
      const rows = await query('SELECT COUNT(*) as cnt, SUM(hit_count) as hits FROM result_cache WHERE expires_at > NOW()');
      return { entries: rows[0].cnt, total_hits: rows[0].hits || 0 };
    } catch (err) {
      return { entries: 0, total_hits: 0 };
    }
  },

  async cleanup() {
    try {
      const result = await query('DELETE FROM result_cache WHERE expires_at < NOW()');
      return result.affectedRows || 0;
    } catch (err) { return 0; }
  },
};
