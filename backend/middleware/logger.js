/**
 * Request logger — logs calculation requests to query_logs table
 */
const crypto = require('crypto');

// Falls back to a random per-process value when unset, which still keeps logs
// from being reversible — it just means hashes stop correlating across restarts.
const IP_HASH_SALT = process.env.IP_HASH_SALT || crypto.randomBytes(16).toString('hex');

async function logQuery(db, data) {
  try {
    const queryFn =
      typeof db === 'function'
        ? db
        : (db && typeof db.query === 'function')
          ? db.query.bind(db)
          : null;

    if (!queryFn) {
      throw new Error('Invalid db client (expected query fn or {query})');
    }

    // Unsalted MD5 of an IP is not pseudonymisation: the whole IPv4 space is
    // 4 billion values, so the table can be reversed exhaustively in minutes.
    // A secret salt is what makes the digest one-way in practice.
    const ipHash = data.ip
      ? crypto.createHash('sha256').update(IP_HASH_SALT + data.ip).digest('hex').slice(0, 32)
      : null;
    await queryFn(
      `INSERT INTO query_logs (input_text, input_type, parsed_fabric, parsed_gsm, parsed_dia, parsed_gauge, 
       result_json, response_ms, from_cache, cache_key, ai_provider, ip_hash, user_agent) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.input_text || null,
        data.input_type || 'form',
        data.parsed_fabric || null,
        data.parsed_gsm || null,
        data.parsed_dia || null,
        data.parsed_gauge || null,
        data.result_json ? JSON.stringify(data.result_json) : null,
        data.response_ms || null,
        data.from_cache ? 1 : 0,
        data.cache_key || null,
        data.ai_provider || null,
        ipHash,
        data.user_agent || null,
      ]
    );
  } catch (err) {
    console.error('[Logger] Failed to log query:', err.message);
  }
}

module.exports = { logQuery };
