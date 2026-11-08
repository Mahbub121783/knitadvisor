/**
 * Fabric scans and phone ↔ screen pairs (migration 040).
 */
const crypto = require('crypto');
const { query, queryOne } = require('../client');

const PAIR_HOURS = 3;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I: read off a screen
function newCode() {
  const b = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

const scans = {
  save(userId, { structure, result, thumb, viaPair }) {
    return queryOne('INSERT INTO fabric_scans (user_id, structure, result, thumb, via_pair) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
      [userId, structure, JSON.stringify(result), thumb || null, !!viaPair]);
  },
  get(userId, id) {
    return queryOne('SELECT id, structure, result, thumb, created_at FROM fabric_scans WHERE user_id = $1 AND id = $2', [userId, id]);
  },
  list(userId, limit = 20) {
    return query(`SELECT id, structure, result, created_at FROM fabric_scans WHERE user_id = $1 ORDER BY created_at DESC LIMIT ${Math.min(100, limit)}`, [userId]);
  },
  remove(userId, id) {
    return query('DELETE FROM fabric_scans WHERE user_id = $1 AND id = $2 RETURNING id', [userId, id]).then((r) => r.length > 0);
  },
};

const pairs = {
  async create(userId) {
    for (let k = 0; k < 5; k++) {
      const code = newCode();
      try {
        return await queryOne(`INSERT INTO scan_pairs (code, user_id, expires_at) VALUES ($1, $2, now() + interval '${PAIR_HOURS} hours') RETURNING code, expires_at`, [code, userId]);
      } catch (e) { if (e.code !== '23505') throw e; }
    }
    throw new Error('could not make a pairing code');
  },
  /** A live pair (not expired), or null. */
  live(code) {
    return queryOne('SELECT code, user_id, last_scan, scans, expires_at FROM scan_pairs WHERE code = $1 AND expires_at > now()', [String(code || '').toUpperCase()]);
  },
  touch(code, scanId) {
    return query('UPDATE scan_pairs SET last_scan = $2, scans = scans + 1, updated_at = now() WHERE code = $1', [code, scanId]);
  },
  /** What the screen shows: the pair's newest scan, its owner's only. */
  async view(userId, code) {
    const p = await queryOne('SELECT code, user_id, last_scan, scans, expires_at, updated_at FROM scan_pairs WHERE code = $1 AND user_id = $2', [String(code || '').toUpperCase(), userId]);
    if (!p) return null;
    const scan = p.last_scan ? await scans.get(userId, p.last_scan) : null;
    return { code: p.code, scans: p.scans, expires_at: p.expires_at, updated_at: p.updated_at, scan };
  },
  prune() { return query("DELETE FROM scan_pairs WHERE expires_at < now() - interval '1 day'"); },
};

module.exports = { scans, pairs, PAIR_HOURS };
