#!/usr/bin/env node
/**
 * Verify the master recipe reference (master-recipe-reference.json) against
 * its own arithmetic — same discipline as verify-dyeing-rules.js applies to
 * the Mozammel cards, adapted for this source's different layout (no fixed
 * "total no of bath" row, dosing normalized from a raw-percent convention,
 * an extra topping-cost component, and per-row cost_gaps instead of a single
 * dye_cost_included flag).
 *
 *   node scripts/verify-master-recipe-rules.js
 *
 * A recipe that fails ANY check is reported, not imported.
 */
'use strict';

const REF = require('../data/master-recipe-reference.json');
const { SHADE_TIERS } = require('../engine/domain/color-engine');

let pass = 0, fail = 0;
const failures = [];

function check(ok, label, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : (fail++, failures.push(label + (detail ? ': ' + detail : '')));
}

const EPS = 1e-6;
const close = (a, b, eps = EPS) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

console.log(`\nSource: ${REF.source.title} (${REF.source.author || 'company not stated'})`);
console.log(`Recipes: ${REF.recipes.length}\n`);

const seenIds = new Set();

for (const r of REF.recipes) {
  console.log(`${r.id}  (${r.color_label} / ${r.fabrication_tag || 'no fabrication tag'})`);

  check(!seenIds.has(r.id), `${r.id}: recipe id is unique`);
  seenIds.add(r.id);

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
  for (const s of r.steps) {
    const label = `${r.id} step ${s.step_order} (${s.commercial_name || 'unnamed'})`;
    check(s.dosing >= 0 && isFinite(s.dosing), `${label}: dosing is not negative/NaN`, String(s.dosing));
    check(s.unit_price_tk >= 0 && isFinite(s.unit_price_tk), `${label}: unit_price_tk is not negative/NaN`, String(s.unit_price_tk));

    // unit_hint (column C's literal 'GPL'/'%' label) is cross-checked against
    // dosing_basis (read from the E-column FORMULA) as an informational note,
    // not a hard failure: the source itself has at least one row where they
    // disagree (black 140-180's "CHT Catalase BF" is labelled GPL but its own
    // formula uses the %-basis shape) — the formula is what actually computed
    // the source's numbers, so it governs required_qty_kg here too; the label
    // is decorative and can legitimately be a leftover copy-paste artifact.
    const expectedHint = s.dosing_basis === 'liquor_gpl' ? 'GPL' : s.dosing_basis === 'percent_owf' ? '%' : null;
    if (expectedHint && s.unit_hint && s.unit_hint !== expectedHint) {
      console.log(`  note  ${label}: column-C unit label "${s.unit_hint}" disagrees with the formula's own ${s.dosing_basis} basis — formula wins, this is a source labelling artifact`);
    }

    if (s.dosing_basis === 'liquor_gpl') {
      const expectedQty = r.fabric_qty_kg * r.ml_ratio * s.dosing / 1000;
      check(close(s.required_qty_kg, expectedQty, 1e-3),
        `${label}: required_qty_kg = fabric_qty x ml_ratio x dosing/1000 (liquor_gpl)`,
        `${s.required_qty_kg} vs ${expectedQty.toFixed(4)}`);
    } else if (s.dosing_basis === 'percent_owf') {
      const expectedQty = r.fabric_qty_kg * s.dosing;
      check(close(s.required_qty_kg, expectedQty, 1e-3),
        `${label}: required_qty_kg = fabric_qty x dosing (percent_owf, dosing already normalized to a fraction)`,
        `${s.required_qty_kg} vs ${expectedQty.toFixed(4)}`);
    } else if (s.dosing_basis === 'other') {
      check(isFinite(s.required_qty_kg), `${label}: required_qty_kg (dosing_basis=other, transcribed as-is) is at least a finite number`,
        String(s.required_qty_kg));
    } else {
      check(s.required_qty_kg === 0, `${label}: no dosing formula present, so required_qty_kg is 0`, String(s.required_qty_kg));
    }

    const expectedPrice = s.required_qty_kg * s.unit_price_tk;
    check(close(s.price_tk, expectedPrice, 1e-2),
      `${label}: price_tk = required_qty_kg x unit_price_tk`,
      `${s.price_tk} vs ${expectedPrice.toFixed(4)}`);

    check(s.topping_tk >= 0 && isFinite(s.topping_tk), `${label}: topping_tk is not negative/NaN`, String(s.topping_tk));
  }

  // ── 4. cost/kg = sum of every step's price + topping / fabric qty ────────
  const sumPrice = r.steps.reduce((s, x) => s + x.price_tk + x.topping_tk, 0);
  const expectedCostPerKg = sumPrice / r.fabric_qty_kg;
  check(close(r.cost_per_kg_tk, expectedCostPerKg, 1e-3),
    `${r.id}: cost_per_kg_tk = SUM(step price_tk + topping_tk) / fabric_qty_kg`,
    `${r.cost_per_kg_tk} vs ${expectedCostPerKg.toFixed(4)}`);

  // ── 5. cost_complete/cost_gaps are internally consistent ──────────────────
  check(r.cost_complete === (r.cost_gaps.length === 0),
    `${r.id}: cost_complete matches whether cost_gaps is empty`,
    `cost_complete=${r.cost_complete}, cost_gaps.length=${r.cost_gaps.length}`);
  for (const g of r.cost_gaps) {
    check(g.required_qty_kg > 0, `${r.id}: cost gap "${g.commercial_name}" is for an actually-costed row`, String(g.required_qty_kg));
    const step = r.steps.find(s => s.commercial_name === g.commercial_name && s.unit_price_tk === 0);
    check(!!step, `${r.id}: cost gap "${g.commercial_name}" corresponds to a real step priced at 0`);
  }

  // ── 6. this source tracks no time/bath data — must say so, not fabricate ──
  check(r.total_time_min === null, `${r.id}: total_time_min is null (not tracked in this source)`, String(r.total_time_min));
  check(r.total_bath_count === null, `${r.id}: total_bath_count is null (not tracked in this source)`, String(r.total_bath_count));

  console.log('');
}

console.log('═'.repeat(60));
if (failures.length) {
  console.log(`FAILED — ${pass} passed, ${fail} failed\n`);
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('\nThe master recipe reference should not be imported until these are understood.');
  process.exit(1);
}
console.log(`PASSED — all ${pass} checks.`);
console.log('Every recipe\'s own arithmetic reproduces from its raw fields, and every');
console.log('shade tier used is a real SHADE_TIERS member.');
