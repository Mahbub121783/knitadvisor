/**
 * MySQL persistent cache — L2 cache layer
 * Survives server restarts. 30-day TTL.
 */
const { query } = require('../config/database');

const DEFAULT_TTL_S = parseInt(process.env.CACHE_TTL_SECONDS) || 2592000; // 30 days

module.exports = {
  async get(cacheKey) {
    try {
      const rows = await query(
        'SELECT result_json FROM result_cache WHERE cache_key = ? AND expires_at > NOW()',
        [cacheKey]
      );
      if (rows.length > 0) {
        await query('UPDATE result_cache SET hit_count = hit_count + 1, last_hit = NOW() WHERE cache_key = ?', [cacheKey]);
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
