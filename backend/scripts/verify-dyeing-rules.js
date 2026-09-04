#!/usr/bin/env node
/**
 * Verify the dyeing reference extracted from the Alim Knit (BD) Ltd recipe
 * cards against the cards' OWN arithmetic.
 *
 *   node scripts/verify-dyeing-rules.js
 *
 * WHY THIS EXISTS
 * ---------------
 * The source file computes everything with live Excel formulas
 * (Required Qty = FabricQty x M:L x Dosing/1000, Price = RequiredQty x
 * UnitPrice, Cost/Kg = SUM(Price)/FabricQty, Water = FabricQty x M:L). This
 * script re-derives every one of those numbers independently from the raw
 * extracted fields and checks it against what extraction recorded — the same
 * discipline verify-woven-rules.js applies to the Gokarneshan extraction, so
 * a slipped column or a mis-mapped cell cannot reach the database quietly.
 *
 * A recipe that fails ANY check is reported, not imported.
 */
'use strict';

const REF = require('../data/dyeing-reference.json');
const { SHADE_TIERS } = require('../engine/domain/color-engine');

let pass = 0, fail = 0;
const failures = [];

function check(ok, label, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : (fail++, failures.push(label + (detail ? ': ' + detail : '')));
}

const EPS = 1e-6;
const close = (a, b, eps = EPS) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

console.log(`\nSource: ${REF.source.title} (${REF.source.author})`);
console.log(`Recipes: ${REF.recipes.length}\n`);

for (const r of REF.recipes) {
  console.log(`${r.id}  (${r.color_label} / ${r.composition_tag || 'no composition tag'})`);

  // ── 1. shade_tiers are real, valid tiers ──────────────────────────────────
  check(Array.isArray(r.shade_tiers) && r.shade_tiers.length > 0,
    `${r.id}: shade_tiers is a non-empty array`, JSON.stringify(r.shade_tiers));
  for (const tier of r.shade_tiers || []) {
    check(SHADE_TIERS.includes(tier),
      `${r.id}: shade tier "${tier}" is a real SHADE_TIERS member`, SHADE_TIERS.join(', '));
  }

  // ── 2. water = fabric_qty x ml_ratio ──────────────────────────────────────
  check(close(r.water_l, r.fabric_qty_kg * r.ml_ratio),
    `${r.id}: water_l = fabric_qty_kg x ml_ratio`,
    `${r.water_l} vs ${r.fabric_qty_kg} x ${r.ml_ratio} = ${r.fabric_qty_kg * r.ml_ratio}`);

  // ── 3. every step's required_qty and price recompute from its own fields ──
  // The source mixes two dosing bases (liquor-ratio g/L and %owf) plus one
  // known broken-formula cell (see extract-dyeing-reference.js's header) —
  // each step carries its OWN dosing_basis read from its actual Excel
  // formula, so the check below applies the SAME formula that cell used,
  // never a single assumed one.
  for (const s of r.steps) {
    const label = `${r.id} step ${s.step_order} (${s.commercial_name || s.functional_name || 'unnamed'})`;
    check(s.dosing >= 0 && isFinite(s.dosing), `${label}: dosing is not negative/NaN`, String(s.dosing));
    check(s.unit_price_tk >= 0 && isFinite(s.unit_price_tk), `${label}: unit_price_tk is not negative/NaN`, String(s.unit_price_tk));

    if (s.dosing_basis === 'liquor_gpl') {
      const expectedQty = r.fabric_qty_kg * r.ml_ratio * s.dosing / 1000;
      check(close(s.required_qty_kg, expectedQty, 1e-3),
        `${label}: required_qty_kg = fabric_qty x ml_ratio x dosing/1000 (liquor_gpl)`,
        `${s.required_qty_kg} vs ${expectedQty.toFixed(4)}`);
    } else if (s.dosing_basis === 'percent_owf') {
      const expectedQty = r.fabric_qty_kg * s.dosing;
      check(close(s.required_qty_kg, expectedQty, 1e-3),
        `${label}: required_qty_kg = fabric_qty x dosing (percent_owf)`,
        `${s.required_qty_kg} vs ${expectedQty.toFixed(4)}`);
    } else if (s.dosing_basis === 'other') {
      // A non-standard formula (the one known broken_ref cell, or any future
      // one-off) — transcribed as-is, not independently re-derivable. Only
      // sanity-checked, never asserted against a guessed formula.
      check(isFinite(s.required_qty_kg), `${label}: required_qty_kg (dosing_basis=other, transcribed as-is) is at least a finite number`,
        String(s.required_qty_kg));
    } else {
      // No formula at all on this row's H cell — a pure process-instruction
      // row (e.g. "Direct Drain"), correctly carrying no Required-Qty.
      check(s.required_qty_kg === 0, `${label}: no dosing formula present, so required_qty_kg is 0`, String(s.required_qty_kg));
    }

    const expectedPrice = s.required_qty_kg * s.unit_price_tk;
    check(close(s.price_tk, expectedPrice, 1e-2),
      `${label}: price_tk = required_qty_kg x unit_price_tk`,
      `${s.price_tk} vs ${expectedPrice.toFixed(4)}`);
  }

  // ── 4. cost/kg = sum of every step's price / fabric qty ───────────────────
  const sumPrice = r.steps.reduce((s, x) => s + x.price_tk, 0);
  const expectedCostPerKg = sumPrice / r.fabric_qty_kg;
  check(close(r.cost_per_kg_tk, expectedCostPerKg, 1e-3),
    `${r.id}: cost_per_kg_tk = SUM(step prices) / fabric_qty_kg`,
    `${r.cost_per_kg_tk} vs ${expectedCostPerKg.toFixed(4)}`);

  // ── 5. total_time_min = sum of every step's time_min ──────────────────────
  const sumTime = r.steps.reduce((s, x) => s + x.time_min, 0);
  check(close(r.total_time_min, sumTime, 0.5),
    `${r.id}: total_time_min = SUM(step time_min)`,
    `${r.total_time_min} vs ${sumTime}`);

  // ── 6. dye_cost_included is honest: if false, no REACTIVE DYES row is costed ──
  const dyeRows = r.steps.filter(s => /^reactive dyes$/i.test(s.functional_name || ''));
  if (dyeRows.length) {
    const anyCosted = dyeRows.some(s => s.dosing > 0);
    check(r.dye_cost_included === anyCosted,
      `${r.id}: dye_cost_included (${r.dye_cost_included}) matches whether any REACTIVE DYES row is actually costed (${anyCosted})`);
  } else {
    check(r.dye_cost_included === true,
      `${r.id}: no REACTIVE DYES stage present, so dye_cost_included should be true (nothing dye-related is being hidden)`);
  }

  console.log('');
}

console.log('═'.repeat(60));
if (failures.length) {
  console.log(`FAILED — ${pass} passed, ${fail} failed\n`);
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('\nThe dyeing reference should not be imported until these are understood.');
  process.exit(1);
}
console.log(`PASSED — all ${pass} checks.`);
console.log('Every recipe\'s own arithmetic reproduces from its raw fields, and every');
console.log('shade tier used is a real SHADE_TIERS member.');
