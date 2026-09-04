#!/usr/bin/env node
/**
 * Import the dyeing reference extracted from Alim Knit (BD) Ltd's recipe
 * cards into PostgreSQL.
 *
 *   node scripts/import-dyeing-reference.js            # dry run — reports only
 *   node scripts/import-dyeing-reference.js --apply    # write
 *
 * Source: backend/data/dyeing-reference.json
 * Target: reference_sources, dyeing_recipes, dyeing_recipe_chemicals (migration 021)
 *
 * The import REFUSES TO RUN until scripts/verify-dyeing-rules.js passes. That
 * script recomputes every recipe's own required-qty/price/cost-per-kg from
 * its raw fields (respecting each row's own dosing basis) and compares
 * against the extracted values; if the extraction has drifted, nothing
 * reaches the database. Same gate as import-woven-reference.js.
 *
 * These tables are a citation/audit layer only — dyeing-engine.js reads
 * dyeing-reference.json directly and never queries the database at request
 * time (same Pattern-B split as woven-derivatives.js / woven_weaves).
 *
 * Idempotent — every insert is ON CONFLICT DO UPDATE.
 */
'use strict';

require('dotenv').config();
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');
const { transaction, query, close } = require('../db/client');

const APPLY = process.argv.includes('--apply');
const REF = require('../data/dyeing-reference.json');

const sha = obj => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');

// ---------------------------------------------------------------- the gate
function verifyOrRefuse() {
  const script = path.join(__dirname, 'verify-dyeing-rules.js');
  try {
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
    console.log('[gate] verify-dyeing-rules.js passed — every recipe reproduces its own arithmetic\n');
    return true;
  } catch (err) {
    console.error('[gate] verify-dyeing-rules.js FAILED. Nothing will be imported.\n');
    console.error(String(err.stdout || '') + String(err.stderr || ''));
    return false;
  }
}

// ---------------------------------------------------------------- import
async function run() {
  if (!verifyOrRefuse()) { await close(); process.exit(1); }

  const counts = {};
  const totalChemicals = REF.recipes.reduce((s, r) => s + r.steps.length, 0);
  const src = REF.source;

  console.log(`Source : ${src.title} (${src.author})`);
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
    // ---- source registry -------------------------------------------------
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

    // ---- recipes + their chemical rows ------------------------------------
    let chemicalCount = 0;
    for (const r of REF.recipes) {
      const recipeRow = await q(
        `INSERT INTO dyeing_recipes
           (recipe_key, source_key, sheet_name, buyer, color_label, shade_tiers,
            composition_tag, fabric_qty_kg, ml_ratio, water_l, cost_per_kg_tk,
            total_bath_count, total_time_min, dye_cost_included)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (recipe_key) DO UPDATE SET
           source_key=EXCLUDED.source_key, sheet_name=EXCLUDED.sheet_name, buyer=EXCLUDED.buyer,
           color_label=EXCLUDED.color_label, shade_tiers=EXCLUDED.shade_tiers,
           composition_tag=EXCLUDED.composition_tag, fabric_qty_kg=EXCLUDED.fabric_qty_kg,
           ml_ratio=EXCLUDED.ml_ratio, water_l=EXCLUDED.water_l, cost_per_kg_tk=EXCLUDED.cost_per_kg_tk,
           total_bath_count=EXCLUDED.total_bath_count, total_time_min=EXCLUDED.total_time_min,
           dye_cost_included=EXCLUDED.dye_cost_included
         RETURNING id`,
        [r.id, src.key, r.sheet_name, r.buyer || null, r.color_label, r.shade_tiers,
         r.composition_tag, r.fabric_qty_kg, r.ml_ratio, r.water_l, r.cost_per_kg_tk,
         r.total_bath_count, r.total_time_min, r.dye_cost_included]
      );
      const recipeId = recipeRow[0].id;

      for (const s of r.steps) {
        await q(
          `INSERT INTO dyeing_recipe_chemicals
             (recipe_id, step_order, stage, functional_name, commercial_name,
              dosing, dosing_basis, unit_price_tk, required_qty_kg, price_tk, remarks, time_min)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (recipe_id, step_order) DO UPDATE SET
             stage=EXCLUDED.stage, functional_name=EXCLUDED.functional_name,
             commercial_name=EXCLUDED.commercial_name, dosing=EXCLUDED.dosing,
             dosing_basis=EXCLUDED.dosing_basis, unit_price_tk=EXCLUDED.unit_price_tk,
             required_qty_kg=EXCLUDED.required_qty_kg, price_tk=EXCLUDED.price_tk,
             remarks=EXCLUDED.remarks, time_min=EXCLUDED.time_min`,
          [recipeId, s.step_order, s.stage, s.functional_name, s.commercial_name,
           s.dosing, s.dosing_basis, s.unit_price_tk, s.required_qty_kg, s.price_tk, s.remarks, s.time_min]
        );
        chemicalCount++;
      }
    }
    counts.dyeing_recipes = REF.recipes.length;
    counts.dyeing_recipe_chemicals = chemicalCount;

    // ---- freshness stamps ------------------------------------------------
    const stamps = {
      dyeing_recipes: REF.recipes,
      dyeing_recipe_chemicals: REF.recipes.flatMap(r => r.steps),
    };
    for (const [table, data] of Object.entries(stamps)) {
      await q(
        `INSERT INTO reference_versions (table_name, row_count, checksum, source)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (table_name) DO UPDATE SET
           row_count=EXCLUDED.row_count, checksum=EXCLUDED.checksum,
           source=EXCLUDED.source, imported_at=now()`,
        [table, counts[table], sha(data), src.key]
      );
    }
  });

  for (const [t, n] of Object.entries(counts)) console.log(`  wrote ${String(n).padStart(4)}  ${t}`);

  // ---- read back -------------------------------------------------------
  const [check] = await query(`
    SELECT (SELECT count(*) FROM dyeing_recipes)          AS recipes,
           (SELECT count(*) FROM dyeing_recipe_chemicals) AS chemicals,
           (SELECT count(*) FROM dyeing_recipes WHERE dye_cost_included) AS complete_cost_recipes`);
  console.log('\nIn the database now:');
  console.log(`  ${check.recipes} recipes · ${check.chemicals} chemical/step rows · ` +
              `${check.complete_cost_recipes} with a complete (dye-inclusive) cost`);

  await close();
}

run().catch(async err => { console.error('\nimport failed:', err.message); await close(); process.exit(1); });
