/**
 * Floor machines and their logged rolls (migration 043). Every statement is keyed by the
 * signed-in user's id, so one account never sees or changes another's machines.
 */
'use strict';
const { query, queryOne } = require('../client');

class FloorError extends Error {}
const MAX_MACHINES = 60, MAX_ROLLS_PER_MACHINE = 2000;

function cleanMachine(b) {
  const name = String((b || {}).name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) throw new FloorError('Give the machine a name (e.g. "M-07" or "Mayer 30″ 24G").');
  const kind = ['single', 'rib', 'interlock'].includes(b.kind) ? b.kind : null;
  if (!kind) throw new FloorError('Choose the machine type: single jersey, rib or interlock.');
  const int = (v, lo, hi, what) => { if (v == null || v === '') return null; const n = Math.round(+v); if (!(n >= lo && n <= hi)) throw new FloorError(`${what} must be ${lo}–${hi}.`); return n; };
  const dia = b.dia == null || b.dia === '' ? null : +b.dia;
  if (dia != null && !(dia >= 8 && dia <= 60)) throw new FloorError('Diameter must be 8–60 inches.');
  return { name, kind, gauge: int(b.gauge, 5, 50, 'Gauge'), dia, feeders: int(b.feeders, 1, 400, 'Feeders'), note: b.note ? String(b.note).slice(0, 200) : null };
}

const machines = {
  list(userId) {
    return query(
      `SELECT m.id, m.name, m.kind, m.gauge, m.dia, m.feeders, m.note, m.created_at,
              (SELECT count(*) FROM studio_floor_rolls r WHERE r.machine_id = m.id)::int AS rolls,
              (SELECT max(created_at) FROM studio_floor_rolls r WHERE r.machine_id = m.id) AS last_roll_at
         FROM studio_floor_machines m WHERE m.user_id = $1 ORDER BY lower(m.name)`, [userId]);
  },
  async create(userId, body) {
    const m = cleanMachine(body);
    const { n } = await queryOne('SELECT count(*)::int AS n FROM studio_floor_machines WHERE user_id = $1', [userId]);
    if (n >= MAX_MACHINES) throw new FloorError(`At most ${MAX_MACHINES} machines.`);
    try {
      return await queryOne(
        'INSERT INTO studio_floor_machines (user_id, name, kind, gauge, dia, feeders, note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, kind, gauge, dia, feeders, note',
        [userId, m.name, m.kind, m.gauge, m.dia, m.feeders, m.note]);
    } catch (e) {
      if (e.code === '23505') throw new FloorError('You already have a machine with that name.');
      throw e;
    }
  },
  get(userId, id) { return queryOne('SELECT id, name, kind, gauge, dia, feeders FROM studio_floor_machines WHERE id = $1 AND user_id = $2', [id, userId]); },
  async remove(userId, id) { const r = await query('DELETE FROM studio_floor_machines WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]); return r.length > 0; },
};

const rolls = {
  /** Oldest first: the order the learning reads them in. */
  forMachine(userId, machineId, limit = 400) {
    return query(
      `SELECT * FROM (SELECT id, group_key, structure, design_name, ne, sl_mm, gauge, dia, shade, gsm, width_in, gsm_model, width_model, knitted_on, created_at
         FROM studio_floor_rolls WHERE user_id = $1 AND machine_id = $2 ORDER BY created_at DESC, id DESC LIMIT $3) t ORDER BY created_at, id`,
      [userId, machineId, limit]);
  },
  async add(userId, machineId, r) {
    const { n } = await queryOne('SELECT count(*)::int AS n FROM studio_floor_rolls WHERE machine_id = $1 AND user_id = $2', [machineId, userId]);
    if (n >= MAX_ROLLS_PER_MACHINE) throw new FloorError(`This machine already has ${MAX_ROLLS_PER_MACHINE} rolls — delete old ones first.`);
    return queryOne(
      `INSERT INTO studio_floor_rolls (user_id, machine_id, group_key, structure, design_name, ne, sl_mm, gauge, dia, shade, gsm, width_in, gsm_model, width_model, knitted_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, group_key, gsm, gsm_model, width_in, width_model, created_at`,
      [userId, machineId, r.group_key, r.structure, r.design_name, r.ne, r.sl_mm, r.gauge, r.dia, r.shade, r.gsm, r.width_in, r.gsm_model, r.width_model, r.knitted_on]);
  },
  async remove(userId, id) { const r = await query('DELETE FROM studio_floor_rolls WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]); return r.length > 0; },
};

/** A machine's rolls as the engine reads them: measured ÷ predicted, per structure group. */
const asLearning = (rows) => rows.map((r) => ({ group: r.group_key, ne: r.ne != null ? +r.ne : null, gsm_ratio: +r.gsm / +r.gsm_model, width_ratio: r.width_in && r.width_model ? +r.width_in / +r.width_model : null }));

module.exports = { machines, rolls, asLearning, cleanMachine, FloorError, MAX_MACHINES };
