/**
 * Real-order validation records — raw CRUD only.
 *
 * Scoring a record against the engine (running calculate() on its spec_input
 * and comparing to actual_*) is deliberately NOT done here — that is
 * engine/domain/validation-scoring.js's job, kept separate so this file stays
 * a plain data-access layer, same split as every other repository.
 */
const { query, queryOne } = require('../client');

const LIST_LIMIT_MAX = 500;

async function add(rec) {
  const row = await queryOne(
    `INSERT INTO real_order_validations
       (fabric_id, spec_input, actual_count_ne, actual_sl_mm, actual_gsm, mill_name, order_ref, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, fabric_id, spec_input, actual_count_ne, actual_sl_mm, actual_gsm, mill_name, order_ref, notes, created_at`,
    [
      rec.fabric_id,
      JSON.stringify(rec.spec_input),
      rec.actual_count_ne ?? null,
      rec.actual_sl_mm ?? null,
      rec.actual_gsm ?? null,
      rec.mill_name ?? null,
      rec.order_ref ?? null,
      rec.notes ?? null,
    ]
  );
  return row;
}

async function remove(id) {
  await query('DELETE FROM real_order_validations WHERE id = $1', [id]);
}

/** Paginated, newest first — for the admin table. */
async function list({ page = 1, limit = 20, fabric = null } = {}) {
  const lim = Math.min(Math.max(1, limit), LIST_LIMIT_MAX);
  const offset = (Math.max(1, page) - 1) * lim;

  const where = fabric ? 'WHERE fabric_id = $3' : '';
  const params = fabric ? [lim, offset, fabric] : [lim, offset];

  const rows = await query(
    `SELECT id, fabric_id, spec_input, actual_count_ne, actual_sl_mm, actual_gsm,
            mill_name, order_ref, notes, created_at
       FROM real_order_validations
       ${where}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    params
  );

  const countRow = await queryOne(
    `SELECT count(*) AS n FROM real_order_validations ${fabric ? 'WHERE fabric_id = $1' : ''}`,
    fabric ? [fabric] : []
  );

  return { rows, total: Number(countRow.n), page, pages: Math.max(1, Math.ceil(Number(countRow.n) / lim)) };
}

/** Every record, for the summary/calibration pass — bounded so this can never grow unbounded in memory. */
async function all(limitCap = 5000) {
  return query(
    `SELECT id, fabric_id, spec_input, actual_count_ne, actual_sl_mm, actual_gsm,
            mill_name, order_ref, notes, created_at
       FROM real_order_validations
      ORDER BY created_at DESC
      LIMIT $1`,
    [limitCap]
  );
}

module.exports = { add, remove, list, all };
