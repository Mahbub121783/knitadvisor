const assert = require('assert');
const {
  matchDyeingRecipe,
  calculateDyeingCost,
  listDyeingRecipes,
  getDyeingRecipe,
} = require('../engine/domain/dyeing-engine');
const {
  DYEING_FAULTS_DATABASE,
  diagnoseDyeingFaults,
  listDyeingFaults,
  getShadeVariationChecklist,
  getProcessCheckpoints,
  getSaltComparison,
  getDyeingKnowledge,
} = require('../engine/domain/dyeing-faults-engine');

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

// Test 7: fault database loaded, every fault carries a resolvable source
console.log("Total dyeing faults (expected 13):", DYEING_FAULTS_DATABASE.length);
assert.strictEqual(DYEING_FAULTS_DATABASE.length, 13);
const withSources = listDyeingFaults();
withSources.forEach(f => assert(f.source && f.source.url, `fault ${f.id} missing a source citation`));

// Test 8: diagnosis matches shade-variation fault on a relevant free-text term
const diagnosed = diagnoseDyeingFaults(['shade variation', 'batch']);
console.log("Shade-variation diagnosis top match:", diagnosed[0] && diagnosed[0].id);
assert(diagnosed.length > 0);
assert.strictEqual(diagnosed[0].id, 'shade_variation_batch');

// Test 9: diagnosis with no symptoms returns nothing (no fabricated guess)
assert.strictEqual(diagnoseDyeingFaults([]).length, 0);
assert.strictEqual(diagnoseDyeingFaults().length, 0);

// Test 10: knowledge blocks are present and sourced
const checklist = getShadeVariationChecklist();
assert(checklist.stages.length === 5, 'expected the 5-stage QC checklist');
assert(checklist.source && checklist.source.url);

const checkpoints = getProcessCheckpoints();
assert(checkpoints.groups.length > 0);
assert(checkpoints.source && checkpoints.source.url);

const saltComparison = getSaltComparison();
assert.strictEqual(saltComparison.salts.length, 3);
assert(saltComparison.source && saltComparison.source.url);

// Test 11: the combined knowledge endpoint returns all sections together
const all = getDyeingKnowledge();
assert(all.sources.length >= 4);
assert(all.faults.length === 13);
assert(all.qc_framework && all.process_checkpoints && all.salt_comparison);

console.log("All Dyeing Engine Tests Passed!");
