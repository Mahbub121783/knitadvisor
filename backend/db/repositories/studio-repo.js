/**
 * Fabric Studio designs, per account (table from migration 035).
 * Every query is keyed by the signed-in user's id; the id is never read from
 * a URL or a body.
 */
const { query, queryOne } = require('../client');

const MAX_DESIGNS = 100;
const MAX_BYTES = 64 * 1024;
const MAX_NAME = 60;

class DesignError extends Error {}

/** Checks the shape the page writes; returns { name, design } ready to store. */
function cleanDesign(body) {
  const b = body || {};
  const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!name) throw new DesignError('Give the design a name.');
  const d = b.design;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new DesignError('Nothing to save.');
  const grid = (g, what) => {
    if (!Array.isArray(g) || !g.length || g.length > 48) throw new DesignError(`${what}: 1 to 48 feeds.`);
    const w = Array.isArray(g[0]) ? g[0].length : -1;
    if (w < 1 || w > 48) throw new DesignError(`${what}: 1 to 48 needles.`);
    g.forEach((row) => {
      if (!Array.isArray(row) || row.length !== w || row.some((x) => !['K', 'T', 'M', '-'].includes(x))) throw new DesignError(`${what}: every feed must hold the same number of K, T, M or - cells.`);
    });
  };
  grid(d.C, 'Cylinder');
  if (d.D != null) { grid(d.D, 'Dial'); if (d.D.length !== d.C.length) throw new DesignError('Dial and cylinder must have the same number of feeds.'); }
  if (d.rolls != null && (!Array.isArray(d.rolls) || d.rolls.length > 12)) throw new DesignError('At most 12 trial rolls.');
  const json = JSON.stringify({ ...d, name });
  if (Buffer.byteLength(json) > MAX_BYTES) throw new DesignError('This design is too large to save.');
  return { name, json };
}

const designs = {
  list(userId) {
    return query(
      'SELECT id, name, design, created_at, updated_at FROM studio_designs WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT ' + MAX_DESIGNS,
      [userId]
    );
  },

  /** Saves under the name, replacing the same name (any case). */
  async save(userId, body) {
    const { name, json } = cleanDesign(body);
    const exists = await queryOne('SELECT id FROM studio_designs WHERE user_id = $1 AND lower(name) = lower($2)', [userId, name]);
    if (!exists) {
      const { count } = await queryOne('SELECT count(*)::int AS count FROM studio_designs WHERE user_id = $1', [userId]);
      if (count >= MAX_DESIGNS) throw new DesignError(`You have ${MAX_DESIGNS} saved designs — delete one first.`);
    }
    return queryOne(
      `INSERT INTO studio_designs (user_id, name, design) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, lower(name)) DO UPDATE SET design = EXCLUDED.design, name = EXCLUDED.name, updated_at = now()
       RETURNING id, name, updated_at`,
      [userId, name, json]
    );
  },

  async remove(userId, id) {
    const rows = await query('DELETE FROM studio_designs WHERE user_id = $1 AND id = $2 RETURNING id', [userId, id]);
    return rows.length > 0;
  },
};

module.exports = { designs, cleanDesign, DesignError, MAX_DESIGNS };
