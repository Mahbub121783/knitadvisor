/**
 * KnitAdvisor — Dyeing Engine
 * ============================
 *
 * Matches a resolved shade tier (from color-engine.js) to a REAL, cost-
 * verified dyeing recipe extracted from an actual factory's recipe cards
 * (backend/data/dyeing-reference.json — see extract-dyeing-reference.js for
 * how it was built and verify-dyeing-rules.js for how it is checked), and
 * re-derives that recipe's cost for a requested fabric quantity.
 *
 * Pattern B, same as woven-derivatives.js / composition-reference.json: a
 * synchronous require() of a static JSON snapshot, no database, no network,
 * no await — calculateCost() (costing-engine.js) is a hard synchronous
 * invariant of this codebase and this module must stay safe to call from it.
 * The dyeing_recipes / dyeing_recipe_chemicals PostgreSQL tables (migration
 * 021) exist purely as a citation/audit surface; nothing here reads them.
 *
 * SCOPE — read this before trusting a "no match": only 6 real recipes exist
 * (2 White, 4 Navy/Black jersey or CVC-jersey), all from one factory. Every
 * shade/composition NOT covered by one of these 6 correctly returns null
 * from matchDyeingRecipe() — that is the honest, permanent behaviour for an
 * uncovered shade, not a placeholder to later fill with a guess. The caller
 * (costing-engine.js) falls through to the existing price-list estimate.
 */
'use strict';

const REF = require('../../data/dyeing-reference.json');

/**
 * @param {object} p
 * @param {string} p.shade_tier      one of color-engine.js's SHADE_TIERS
 * @param {boolean} [p.is_two_part]  true for a poly/cotton (CVC/PC) blend —
 *                                   costing-engine.js already computes this,
 *                                   and it is sufficient on its own to prefer
 *                                   the right recipe (see impliesTwoPart
 *                                   below, matched against each candidate's
 *                                   own composition_tag)
 * @returns {object|null} the matched recipe plus `match_quality`, or null if
 *   no recipe covers this shade tier at all — never fabricated.
 */
function matchDyeingRecipe({ shade_tier, is_two_part } = {}) {
  if (!shade_tier) return null;
  const candidates = REF.recipes.filter(r => r.shade_tiers.includes(shade_tier));
  if (!candidates.length) return null;

  // Graceful fallback, not a strict filter: prefer a recipe whose bath-count
  // implied by its own composition_tag matches is_two_part, but a shade-only
  // match still beats returning nothing — the user's own framing was "try to
  // give the best recipe," and refusing perfectly good real data over a
  // composition mismatch would contradict that.
  const impliesTwoPart = tag => !!tag && /cvc|pc\b|poly/i.test(tag);
  const compositionMatch = candidates.find(r => impliesTwoPart(r.composition_tag) === !!is_two_part);
  const chosen = compositionMatch || candidates[0];

  return {
    ...chosen,
    match_quality: compositionMatch ? 'exact_composition' : 'shade_only',
  };
}

/**
 * Re-derive a matched recipe's chemical quantities/cost for a REQUESTED
 * fabric quantity — not just the fixed example quantity the source card
 * happened to use (255 kg in every one of the 6 sheets).
 *
 * Each chemical row scales by its OWN dosing_basis, exactly as its source
 * cell's own formula did (see extract-dyeing-reference.js's header for why
 * this file mixes two bases plus one broken cell):
 *   liquor_gpl    required_qty = fabric_qty_kg * ml_ratio * dosing / 1000
 *   percent_owf   required_qty = fabric_qty_kg * dosing
 *   other/null    NOT scaled — carried forward at the recipe's own stored
 *                 value. This covers the one known broken source formula
 *                 (a genuine typo, not a real relationship to reproduce) and
 *                 any pure process-instruction row with no dosing at all;
 *                 inventing a scaling rule for a formula that was never
 *                 real would be fabrication, not re-derivation.
 *
 * cost_per_kg is mathematically scale-invariant in fabric_qty_kg for every
 * liquor_gpl/percent_owf row (it cancels out), so this remains meaningful
 * even at the default fabric_qty_kg=1 — the parameter mainly matters when
 * the caller wants absolute purchase quantities for a real order.
 *
 * @param {object} p
 * @param {object} p.recipe          a recipe object (from matchDyeingRecipe
 *                                   or listDyeingRecipes)
 * @param {number} [p.fabric_qty_kg=1]
 * @param {number} p.bdt_per_usd     Taka per 1 USD — passed in by the caller
 *                                   (costing-engine.js's own exchangeRates
 *                                   .BDT), never required back from it, to
 *                                   avoid a circular require.
 */
function calculateDyeingCost({ recipe, fabric_qty_kg = 1, bdt_per_usd }) {
  if (!recipe) throw new Error('calculateDyeingCost: recipe is required');
  if (!bdt_per_usd || bdt_per_usd <= 0) throw new Error('calculateDyeingCost: bdt_per_usd must be a positive number');

  const chemicals = recipe.steps.map(s => {
    let requiredQtyKg = s.required_qty_kg;
    if (s.dosing_basis === 'liquor_gpl') {
      requiredQtyKg = fabric_qty_kg * recipe.ml_ratio * s.dosing / 1000;
    } else if (s.dosing_basis === 'percent_owf') {
      requiredQtyKg = fabric_qty_kg * s.dosing;
    }
    // 'other' / null: not scaled, carried forward as-is (see header comment).
    const priceTk = requiredQtyKg * s.unit_price_tk;
    return {
      stage: s.stage,
      functional_name: s.functional_name,
      commercial_name: s.commercial_name,
      dosing: s.dosing,
      dosing_basis: s.dosing_basis,
      unit_price_tk: s.unit_price_tk,
      required_qty_kg: requiredQtyKg,
      price_tk: priceTk,
      remarks: s.remarks,
      time_min: s.time_min,
    };
  });

  const costPerKgTk = chemicals.reduce((sum, c) => sum + c.price_tk, 0) / fabric_qty_kg;
  const costPerKgUsd = costPerKgTk / bdt_per_usd;

  return {
    fabric_qty_kg,
    cost_per_kg_tk: costPerKgTk,
    cost_per_kg_usd: costPerKgUsd,
    chemicals,
  };
}

/** Flat list for a recipe picker (e.g. an admin browser). */
function listDyeingRecipes() {
  return REF.recipes.map(r => ({
    id: r.id,
    sheet_name: r.sheet_name,
    color_label: r.color_label,
    shade_tiers: r.shade_tiers,
    composition_tag: r.composition_tag,
    cost_per_kg_tk: r.cost_per_kg_tk,
    dye_cost_included: r.dye_cost_included,
    total_time_min: r.total_time_min,
    total_bath_count: r.total_bath_count,
  }));
}

module.exports = { matchDyeingRecipe, calculateDyeingCost, listDyeingRecipes };
