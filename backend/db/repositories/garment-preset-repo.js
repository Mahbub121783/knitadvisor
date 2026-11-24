/** Garment presets (migration 048). Every statement is keyed by the signed-in user's id. */
'use strict';
const { query, queryOne } = require('../client');

const MAX_PER_USER = 60;

module.exports = {
  MAX_PER_USER,
  list(userId) {
    return query(`SELECT id, name, style, note, updated_at, jsonb_array_length(COALESCE(preset->'sizes', '[]'::jsonb)) AS sizes
                    FROM garment_presets WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 200`, [userId]);
  },
  get(userId, id) { return queryOne('SELECT id, name, style, note, preset FROM garment_presets WHERE id = $1 AND user_id = $2', [id, userId]); },
  async save(userId, r) {
    const have = await queryOne('SELECT id FROM garment_presets WHERE user_id = $1 AND lower(name) = lower($2)', [userId, r.name]);
    if (have) return queryOne('UPDATE garment_presets SET preset = $3::jsonb, note = $4, style = $5, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id', [have.id, userId, JSON.stringify(r.preset), r.note, r.style]);
    const { n } = await queryOne('SELECT count(*)::int AS n FROM garment_presets WHERE user_id = $1', [userId]);
    if (n >= MAX_PER_USER) throw Object.assign(new Error(`At most ${MAX_PER_USER} presets: delete one first.`), { code: 'PRESET_LIMIT' });
    return queryOne('INSERT INTO garment_presets (user_id, name, style, note, preset) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id', [userId, r.name, r.style, r.note, JSON.stringify(r.preset)]);
  },
  async remove(userId, id) { const r = await query('DELETE FROM garment_presets WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]); return r.length > 0; },
};
