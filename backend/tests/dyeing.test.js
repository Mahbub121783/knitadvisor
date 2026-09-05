const assert = require('assert');
const {
  matchDyeingRecipe,
  calculateDyeingCost,
  listDyeingRecipes,
  getDyeingRecipe,
} = require('../engine/domain/dyeing-engine');
const { calculateCost } = require('../engine/domain/costing-engine');
const {
  DYEING_FAULTS_DATABASE,
  diagnoseDyeingFaults,
  listDyeingFaults,
  getShadeVariationChecklist,
  getProcessCheckpoints,
  getSaltComparison,
  getDyeingKnowledge,
} = require('../engine/domain/dyeing-faults-engine');
const {
  listDyeClasses,
  getDyeClass,
  listMachines,
  getMachine,
  listProcessFlows,
  getProcessFlow,
  getFastnessTheory,
  getDyeingTheory,
} = require('../engine/domain/dyeing-theory-engine');

console.log("--- Running Dyeing Engine Tests ---");

// ---- dyeing-engine.js (recipe matching/costing) ----------------------

// Test 1: recipe list is non-empty and every recipe id is unique
const recipes = listDyeingRecipes();
console.log("Total dyeing recipes (expected >= 40):", recipes.length);
assert(recipes.length >= 40);
assert.strictEqual(new Set(recipes.map(r => r.id)).size, recipes.length);

// Test 2: matchDyeingRecipe returns null for a shade tier no recipe covers,
// and for a missing shade_tier — never a fabricated guess.
const noMatch = matchDyeingRecipe({ shade_tier: 'not_a_real_shade_tier' });
assert.strictEqual(noMatch, null);
assert.strictEqual(matchDyeingRecipe({}), null);

// Test 2b: is_woven refuses a match outright, even for a shade every knit
// recipe covers — all 40 source cards are knit constructions (see this
// engine's header), so a woven fabric must fall through to the price-list
// estimate rather than silently inherit a rope/jet-dyeing recipe.
assert(matchDyeingRecipe({ shade_tier: 'black' }), 'sanity: black must be covered when not woven');
assert.strictEqual(matchDyeingRecipe({ shade_tier: 'black', is_woven: true }), null);

// Test 3: matchDyeingRecipe returns a real recipe for a covered shade tier
const blackMatch = matchDyeingRecipe({ shade_tier: 'black' });
assert(blackMatch, 'expected a real recipe for black shade tier');
assert(Array.isArray(blackMatch.shade_tiers) && blackMatch.shade_tiers.includes('black'));

// Test 4: getDyeingRecipe round-trips by id, and returns null for unknown ids
const fetched = getDyeingRecipe(blackMatch.id);
assert.strictEqual(fetched.id, blackMatch.id);
assert.strictEqual(getDyeingRecipe('__no_such_recipe__'), null);

// Test 5: calculateDyeingCost is scale-invariant per-kg for a liquor_gpl/percent_owf recipe
const cost1 = calculateDyeingCost({ recipe: fetched, fabric_qty_kg: 1, bdt_per_usd: 110 });
const cost50 = calculateDyeingCost({ recipe: fetched, fabric_qty_kg: 50, bdt_per_usd: 110 });
console.log("cost/kg at qty=1 vs qty=50 (should match):", cost1.cost_per_kg_tk.toFixed(4), cost50.cost_per_kg_tk.toFixed(4));
assert(Math.abs(cost1.cost_per_kg_tk - cost50.cost_per_kg_tk) < 0.01);

// Test 6: calculateDyeingCost requires a positive bdt_per_usd
assert.throws(() => calculateDyeingCost({ recipe: fetched, bdt_per_usd: 0 }));
assert.throws(() => calculateDyeingCost({ recipe: null, bdt_per_usd: 110 }));

// ---- dyeing-faults-engine.js (fault knowledge base) -------------------

// Test 7: fault database loaded, and no internal source_key (or any other
// attribution) ever reaches a caller — per knitadvisor-no-source-links, this
// module's output must carry no trace of where an entry was researched.
console.log("Total dyeing faults (expected 13):", DYEING_FAULTS_DATABASE.length);
assert.strictEqual(DYEING_FAULTS_DATABASE.length, 13);
const publicFaults = listDyeingFaults();
publicFaults.forEach(f => {
  assert.strictEqual(f.source_key, undefined, `fault ${f.id} leaked its raw source_key`);
  assert.strictEqual(f.source, undefined, `fault ${f.id} leaked a source attribution`);
});

// Test 8: diagnosis matches shade-variation fault on a relevant free-text term
const diagnosed = diagnoseDyeingFaults(['shade variation', 'batch']);
console.log("Shade-variation diagnosis top match:", diagnosed[0] && diagnosed[0].id);
assert(diagnosed.length > 0);
assert.strictEqual(diagnosed[0].id, 'shade_variation_batch');

// Test 9: diagnosis with no symptoms returns nothing (no fabricated guess)
assert.strictEqual(diagnoseDyeingFaults([]).length, 0);
assert.strictEqual(diagnoseDyeingFaults().length, 0);

// Test 10: knowledge blocks are present and carry no attribution
const checklist = getShadeVariationChecklist();
assert(checklist.stages.length === 5, 'expected the 5-stage QC checklist');
assert.strictEqual(checklist.source_key, undefined);

const checkpoints = getProcessCheckpoints();
assert(checkpoints.groups.length > 0);
assert.strictEqual(checkpoints.source_key, undefined);

const saltComparison = getSaltComparison();
assert.strictEqual(saltComparison.salts.length, 3);
assert.strictEqual(saltComparison.source_key, undefined);

// Test 11: the combined knowledge endpoint returns all sections together, no sources block at all
const all = getDyeingKnowledge();
assert.strictEqual(all.sources, undefined, 'the combined endpoint must not expose a sources list');
assert(all.faults.length === 13);
assert(all.qc_framework && all.process_checkpoints && all.salt_comparison);

// ---- dyeing-theory-engine.js (dye classes / machines / flows / fastness) --

// Test 12: all 7 dye classes present, each with conditions and both an
// advantage and a limitation (a class with no limitation would be a red flag
// — every real dye class trades something off).
const dyeClasses = listDyeClasses();
console.log("Dye classes (expected 7):", dyeClasses.length);
assert.strictEqual(dyeClasses.length, 7);
dyeClasses.forEach(d => {
  assert(d.advantages.length > 0 && d.limitations.length > 0, `${d.key} missing advantages/limitations`);
  assert(d.typical_conditions && d.typical_conditions.temp_c, `${d.key} missing typical_conditions`);
});
assert.strictEqual(getDyeClass('reactive').key, 'reactive');
assert.strictEqual(getDyeClass('__nope__'), null);

// Test 13: all 6 machine types present
const machines = listMachines();
console.log("Machines (expected 6):", machines.length);
assert.strictEqual(machines.length, 6);
assert.strictEqual(getMachine('jet').key, 'jet');
assert.strictEqual(getMachine('__nope__'), null);

// Test 14: all 5 process flows present, each with an ordered, non-empty step list
const flows = listProcessFlows();
console.log("Process flows (expected 5):", flows.length);
assert.strictEqual(flows.length, 5);
flows.forEach(f => {
  assert(f.steps.length > 0, `${f.key} has no steps`);
  f.steps.forEach((s, i) => assert.strictEqual(s.step, i + 1, `${f.key} step numbering broken at index ${i}`));
});
assert.strictEqual(getProcessFlow('denim_indigo_rope').key, 'denim_indigo_rope');
assert.strictEqual(getProcessFlow('__nope__'), null);

// Test 15: fastness theory has both grey scales and at least the 4 core test types
const fastness = getFastnessTheory();
assert(fastness.grey_scale_change && fastness.grey_scale_staining);
assert(fastness.test_types.length >= 4);

// Test 16: the combined theory endpoint returns all four sections
const allTheory = getDyeingTheory();
assert(allTheory.dye_classes.length === 7 && allTheory.machines.length === 6 && allTheory.process_flows.length === 5 && allTheory.fastness);

// ---- costing-engine.js integration: dyeing is KNIT-only, full stop ----
// (per the user's explicit direction — woven fabrics never need a dyeing
// cost in this tool, not a real recipe and not even a price-list estimate)

// Test 17: black on a KNIT fabric matches a real recipe, cost > 0.
const knitResult = calculateCost({ gsm: 180, fabric: 'single_jersey', color_shade: 'black', order_qty_kg: 1000 });
console.log("Knit black dyeing source (expected REAL_RECIPE):", knitResult.cost_breakdown_usd.dyeing.source);
assert.strictEqual(knitResult.cost_breakdown_usd.dyeing.source, 'REAL_RECIPE');
assert(knitResult.cost_breakdown_usd.dyeing.per_kg > 0);

// Test 18: the SAME shade on a WOVEN fabric gets NO dyeing cost at all —
// source NOT_APPLICABLE, per_kg exactly 0. Not a real recipe (none of the 40
// cards is woven construction) and not even the price-list estimate: dyeing
// is out of scope for a woven fabric in this tool, not an uncovered case.
const wovenResult = calculateCost({ gsm: 180, fabric: 'woven_plain_shirting', color_shade: 'black', order_qty_kg: 1000 });
console.log("Woven black dyeing source (expected NOT_APPLICABLE, per_kg=0):",
  wovenResult.cost_breakdown_usd.dyeing.source, wovenResult.cost_breakdown_usd.dyeing.per_kg);
assert.strictEqual(wovenResult.cost_breakdown_usd.dyeing.source, 'NOT_APPLICABLE');
assert.strictEqual(wovenResult.cost_breakdown_usd.dyeing.per_kg, 0);

// Test 19: an explicit user-supplied dyeing_cost still applies even to a
// woven fabric — that's the caller's own stated number, not this engine
// assuming a woven fabric needs one.
const wovenOverride = calculateCost({ gsm: 180, fabric: 'woven_plain_shirting', color_shade: 'black', dyeing_cost: 0.5, order_qty_kg: 1000 });
assert.strictEqual(wovenOverride.cost_breakdown_usd.dyeing.source, 'user_override');
assert.strictEqual(wovenOverride.cost_breakdown_usd.dyeing.per_kg, 0.5);

console.log("All Dyeing Engine Tests Passed!");
