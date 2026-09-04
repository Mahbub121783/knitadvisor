#!/usr/bin/env node
/**
 * Import the master recipe reference (2nd factory source) into PostgreSQL.
 *
 *   node scripts/import-master-recipe-reference.js            # dry run
 *   node scripts/import-master-recipe-reference.js --apply    # write
 *
 * Source: backend/data/master-recipe-reference.json
 * Target: reference_sources, dyeing_recipes, dyeing_recipe_chemicals
 *         (021_dyeing_reference.sql, extended by 023_master_recipe_reference.sql)
 *
 * Shares the same two tables as import-dyeing-reference.js (the Mozammel
 * cards) — distinguished by source_key, not a separate table — same
 * citation/audit role, same Pattern-B split (dyeing-engine.js never queries
 * these at request time). Refuses to run until
 * scripts/verify-master-recipe-rules.js passes. Idempotent — every insert is
 * ON CONFLICT DO UPDATE.
 */
'use strict';

require('dotenv').config();
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');
const { transaction, query, close } = require('../db/client');

const APPLY = process.argv.includes('--apply');
const REF = require('../data/master-recipe-reference.json');

const sha = obj => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');

function verifyOrRefuse() {
  const script = path.join(__dirname, 'verify-master-recipe-rules.js');
  try {
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
    console.log('[gate] verify-master-recipe-rules.js passed — every recipe reproduces its own arithmetic\n');
    return true;
  } catch (err) {
    console.error('[gate] verify-master-recipe-rules.js FAILED. Nothing will be imported.\n');
    console.error(String(err.stdout || '') + String(err.stderr || ''));
    return false;
  }
}

// Both dyeing sources now share dyeing_recipes/dyeing_recipe_chemicals, so a
// freshness stamp must reflect the FULL current table content, not just
// whichever source's importer last ran — otherwise re-running the Mozammel
// importer later would silently overwrite this stamp with only its own rows
// (and vice versa), making reference_versions ping-pong between two partial
// truths instead of describing what is actually in the table.
async function stampFullTable(q) {
  const recipes = await q(`
    SELECT id, recipe_key, source_key, sheet_name, buyer, color_label, shade_tiers,
           composition_tag, fabric_qty_kg, ml_ratio, water_l, cost_per_kg_tk,
           total_bath_count, total_time_min, dye_cost_included, cost_gaps
      FROM dyeing_recipes ORDER BY id`);
  const chemicals = await q(`
    SELECT id, recipe_id, step_order, stage, functional_name, commercial_name,
           dosing, dosing_basis, unit_price_tk, required_qty_kg, price_tk,
           remarks, time_min, topping_tk
      FROM dyeing_recipe_chemicals ORDER BY id`);
  for (const [table, rows] of Object.entries({ dyeing_recipes: recipes, dyeing_recipe_chemicals: chemicals })) {
    await q(
      `INSERT INTO reference_versions (table_name, row_count, checksum, source)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (table_name) DO UPDATE SET
         row_count=EXCLUDED.row_count, checksum=EXCLUDED.checksum,
         source=EXCLUDED.source, imported_at=now()`,
      [table, rows.length, sha(rows), 'multiple (dyeing_recipes.source_key)']
    );
  }
}

async function run() {
  if (!verifyOrRefuse()) { await close(); process.exit(1); }

  const counts = {};
  const totalChemicals = REF.recipes.reduce((s, r) => s + r.steps.length, 0);
  const src = REF.source;

  console.log(`Source : ${src.title} (${src.author || 'company not stated'})`);
  console.log(`Domain : ${src.domain}`);
  console.log(`Scope  : ${src.scope_warning}\n`);
  console.log(`  ${String(1).padStart(4)}  reference_sources`);
  console.log(`  ${String(REF.recipes.length).padStart(4)}  dyeing_recipes`);
  console.log(`  ${String(totalChemicals).padStart(4)}  dyeing_recipe_chemicals`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.');
    await close();
    return;
  }

  console.log('');
  await transaction(async q => {
    await q(
      `INSERT INTO reference_sources (key, title, author, publisher, year, identifier, domain, page_offset, scope_note, archived_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (key) DO UPDATE SET
         title=EXCLUDED.title, author=EXCLUDED.author, publisher=EXCLUDED.publisher,
         year=EXCLUDED.year, identifier=EXCLUDED.identifier, domain=EXCLUDED.domain,
         scope_note=EXCLUDED.scope_note`,
      [src.key, src.title, src.author, src.publisher, src.year, src.identifier, src.domain, 0, src.scope_warning, null]
    );
    counts.reference_sources = 1;

    let chemicalCount = 0;
    for (const r of REF.recipes) {
      const recipeRow = await q(
        `INSERT INTO dyeing_recipes
           (recipe_key, source_key, sheet_name, buyer, color_label, shade_tiers,
            composition_tag, fabric_qty_kg, ml_ratio, water_l, cost_per_kg_tk,
            total_bath_count, total_time_min, dye_cost_included, cost_gaps)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (recipe_key) DO UPDATE SET
           source_key=EXCLUDED.source_key, sheet_name=EXCLUDED.sheet_name, buyer=EXCLUDED.buyer,
           color_label=EXCLUDED.color_label, shade_tiers=EXCLUDED.shade_tiers,
           composition_tag=EXCLUDED.composition_tag, fabric_qty_kg=EXCLUDED.fabric_qty_kg,
           ml_ratio=EXCLUDED.ml_ratio, water_l=EXCLUDED.water_l, cost_per_kg_tk=EXCLUDED.cost_per_kg_tk,
           total_bath_count=EXCLUDED.total_bath_count, total_time_min=EXCLUDED.total_time_min,
           dye_cost_included=EXCLUDED.dye_cost_included, cost_gaps=EXCLUDED.cost_gaps
         RETURNING id`,
        [r.id, src.key, r.sheet_name, null, r.color_label, r.shade_tiers,
         r.fabrication_tag, r.fabric_qty_kg, r.ml_ratio, r.water_l, r.cost_per_kg_tk,
         r.total_bath_count, r.total_time_min, r.cost_complete, JSON.stringify(r.cost_gaps)]
      );
      const recipeId = recipeRow[0].id;

      for (const s of r.steps) {
        await q(
          `INSERT INTO dyeing_recipe_chemicals
             (recipe_id, step_order, stage, functional_name, commercial_name,
              dosing, dosing_basis, unit_price_tk, required_qty_kg, price_tk, remarks, time_min, topping_tk)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (recipe_id, step_order) DO UPDATE SET
             stage=EXCLUDED.stage, functional_name=EXCLUDED.functional_name,
             commercial_name=EXCLUDED.commercial_name, dosing=EXCLUDED.dosing,
             dosing_basis=EXCLUDED.dosing_basis, unit_price_tk=EXCLUDED.unit_price_tk,
             required_qty_kg=EXCLUDED.required_qty_kg, price_tk=EXCLUDED.price_tk,
             remarks=EXCLUDED.remarks, time_min=EXCLUDED.time_min, topping_tk=EXCLUDED.topping_tk`,
          [recipeId, s.step_order, s.stage, null, s.commercial_name,
           s.dosing, s.dosing_basis, s.unit_price_tk, s.required_qty_kg, s.price_tk, null, 0, s.topping_tk]
        );
        chemicalCount++;
      }
    }
    counts.dyeing_recipes = REF.recipes.length;
    counts.dyeing_recipe_chemicals = chemicalCount;

    await stampFullTable(q);
  });

  for (const [t, n] of Object.entries(counts)) console.log(`  wrote ${String(n).padStart(4)}  ${t}`);

  const [check] = await query(`
    SELECT (SELECT count(*) FROM dyeing_recipes)          AS recipes,
           (SELECT count(*) FROM dyeing_recipe_chemicals) AS chemicals,
           (SELECT count(*) FROM dyeing_recipes WHERE source_key = $1) AS this_source_recipes`,
    [src.key]);
  console.log('\nIn the database now (both sources combined):');
  console.log(`  ${check.recipes} recipes · ${check.chemicals} chemical/step rows · ` +
              `${check.this_source_recipes} from this source`);

  await close();
}

run().catch(async err => { console.error('\nimport failed:', err.message); await close(); process.exit(1); });
