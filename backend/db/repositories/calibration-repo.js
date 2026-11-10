/** Calibration records (migration 045). Every statement is keyed by the signed-in user's id. */
'use strict';
const { query, queryOne } = require('../client');
const { MAX_PER_USER, CalibrationError } = require('../../engine/domain/calibration-intake');

module.exports = {
  list(userId) {
    return query('SELECT id, design_name, group_key, structure, predicted, measured, created_at FROM studio_calibration WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200', [userId]);
  },
  async add(userId, r) {
    const { n } = await queryOne('SELECT count(*)::int AS n FROM studio_calibration WHERE user_id = $1', [userId]);
    if (n >= MAX_PER_USER) throw new CalibrationError(`At most ${MAX_PER_USER} calibration records — delete old ones first.`);
    return queryOne(
      `INSERT INTO studio_calibration (user_id, design_name, group_key, structure, design, predicted, measured)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) RETURNING id, created_at`,
      [userId, r.design_name, r.group_key, r.structure, JSON.stringify(r.design), JSON.stringify(r.predicted), JSON.stringify(r.measured)]);
  },
  async remove(userId, id) { const r = await query('DELETE FROM studio_calibration WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]); return r.length > 0; },
};
