/**
 * Visualisation configuration.
 *
 * bar_colors is jsonb now rather than a LONGTEXT holding JSON, so the
 * hand-rolled "if it's a string, try JSON.parse and swallow the error" dance at
 * every call site is gone — the driver returns an array or null.
 */
const { query, queryOne } = require('../client');

const DEFAULTS = [
  ['single_jersey', 'single_jersey', 'single_bed_circular', 'matte', 0.300, 0.950, 0.200, 1, null, false],
  ['rib_1x1', 'rib', 'double_bed_circular', 'matte', 0.300, 0.950, 0.200, 2, null, false],
  ['interlock', 'interlock', 'double_bed_circular_interlock', 'matte', 0.280, 0.980, 0.190, 2, null, false],
  ['tricot_plain', 'warp_knit', 'warp_knit_tricot', 'high_sheen', 0.300, 0.950, 0.200, 2,
    JSON.stringify(['#2563EB', '#DC2626', '#16A34A', '#D97706']), true],
  ['locknit', 'warp_knit', 'warp_knit_tricot', 'high_sheen', 0.300, 0.950, 0.200, 2,
    JSON.stringify(['#7C3AED', '#DB2777', '#0891B2', '#65A30D']), true],
];

async function findByFabric(fabricId) {
  return queryOne('SELECT * FROM viz_configs WHERE fabric_id = $1', [fabricId]);
}

async function all() {
  return query('SELECT * FROM viz_configs ORDER BY fabric_id');
}

async function upsert(cfg) {
  return queryOne(
    `INSERT INTO viz_configs
       (fabric_id, fabric_category, machine_type, sheen_model,
        loop_head_ratio, loop_height_ratio, foot_splay_ratio, layer_count, bar_colors, animate_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (fabric_id) DO UPDATE SET
       fabric_category   = EXCLUDED.fabric_category,
       machine_type      = EXCLUDED.machine_type,
       sheen_model       = EXCLUDED.sheen_model,
       loop_head_ratio   = EXCLUDED.loop_head_ratio,
       loop_height_ratio = EXCLUDED.loop_height_ratio,
       foot_splay_ratio  = EXCLUDED.foot_splay_ratio,
       layer_count       = EXCLUDED.layer_count,
       bar_colors        = EXCLUDED.bar_colors,
       animate_default   = EXCLUDED.animate_default
     RETURNING id`,
    [cfg.fabric_id, cfg.fabric_category, cfg.machine_type, cfg.sheen_model || 'matte',
     cfg.loop_head_ratio ?? 0.300, cfg.loop_height_ratio ?? 0.950, cfg.foot_splay_ratio ?? 0.200,
     cfg.layer_count ?? 2, cfg.bar_colors ? JSON.stringify(cfg.bar_colors) : null,
     cfg.animate_default ?? false]
  );
}

/** Seeds the five built-in fabric configs. Idempotent — used on first deploy. */
async function seedDefaults() {
  let inserted = 0;
  for (const row of DEFAULTS) {
    const res = await query(
      `INSERT INTO viz_configs
         (fabric_id, fabric_category, machine_type, sheen_model,
          loop_head_ratio, loop_height_ratio, foot_splay_ratio, layer_count, bar_colors, animate_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (fabric_id) DO NOTHING
       RETURNING id`,
      row
    );
    inserted += res.length;
  }
  return inserted;
}

module.exports = { findByFabric, all, upsert, seedDefaults, DEFAULTS };
