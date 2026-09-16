/**
 * KnitAdvisor — Carbon Footprint Estimator
 * ============================================
 *
 * A screening-level, cradle-to-fabric CO2e estimate — fiber production
 * (composition-weighted) plus a combined processing-energy stage (knitting +
 * dyeing + finishing) converted via a grid emission factor. NOT a certified
 * LCA (that requires primary data this app has no access to — real mill
 * energy metering, actual supply-chain transport, verified fiber sourcing).
 * See catalog/carbon-footprint-factors.js for the full sourcing discussion
 * and why this file is deliberately cautious about false precision.
 *
 * Pure function — no DB, no network — same shape as every other domain
 * engine in this app, and wired into engine/index.js's calculate() the same
 * way garment-costing-engine.js is: computed from the SAME gsm/composition/
 * country inputs already flowing through that one calculation, never a
 * second, separately-parameterized estimate.
 */

const {
  FIBER_CO2E_PER_KG,
  FIBER_VARIANT_MULTIPLIERS,
  UNMODELED_FIBERS,
  GRID_EMISSION_FACTOR,
  PROCESSING_ENERGY_KWH_PER_KG,
} = require('../catalog/carbon-footprint-factors');

function round4(v) { return Math.round(v * 10000) / 10000; }

// Keyword detection on the RAW composition string — composition-engine.js's
// parser already collapses "organic cotton" / "BCI cotton" / "recycled
// cotton" onto the plain fiber key "cotton" (see FIBER_ALIASES), which loses
// exactly the distinction this engine needs. Re-detecting from the original
// text is the only way to recover it without changing that parser's own
// contract (other engines depend on its collapsed keys).
function detectVariant(fiberKey, rawCompositionText) {
  const text = (rawCompositionText || '').toLowerCase();
  const variants = FIBER_VARIANT_MULTIPLIERS[fiberKey];
  if (!variants) return null;
  if (variants.organic && /organic|bci|ic-?2|cmia|bio\s*cotton/.test(text)) return { key: 'organic', ...variants.organic };
  if (variants.recycled && /recycl|re-?cycled|regenerated/.test(text)) return { key: 'recycled', ...variants.recycled };
  return null;
}

/**
 * @param {object} params
 *   fibers            — { cotton: 60, polyester: 40, ... } percentage map (required) —
 *                        pass parsedComp.fibers, or omit to default 100% cotton
 *                        (matches engine/index.js's own "100% Cotton (assumed)" fallback)
 *   raw_composition    — the original composition string, for organic/recycled detection
 *   gsm                — fabric GSM (required) — fiber-production CO2e scales with fabric mass
 *   garment_weight_g   — optional — adds a per-garment total alongside per-kg
 *   country            — optional, default 'bangladesh' — only Bangladesh has a sourced grid factor
 */
function calculateCarbonFootprint(params = {}) {
  const warnings = [];

  const gsm = parseFloat(params.gsm);
  if (!Number.isFinite(gsm) || gsm <= 0) {
    return { success: false, error: 'gsm is required (fabric weight per square meter — fiber-production CO2e scales with fabric mass).' };
  }

  const fibers = (params.fibers && Object.keys(params.fibers).length > 0)
    ? params.fibers
    : { cotton: 100 };
  if (!params.fibers) warnings.push('No composition supplied — assuming 100% Cotton.');

  const totalPct = Object.values(fibers).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  if (totalPct <= 0) {
    return { success: false, error: 'Composition percentages must sum to more than 0.' };
  }

  // ---- Fiber production CO2e, composition-weighted ----
  const fiberBreakdown = [];
  let fiberCo2ePerKg = 0;

  for (const [fiberKey, pctRaw] of Object.entries(fibers)) {
    const pct = parseFloat(pctRaw) || 0;
    if (pct <= 0) continue;
    const share = pct / totalPct;

    if (UNMODELED_FIBERS.includes(fiberKey)) {
      warnings.push(`"${fiberKey}" (${pct}%) has no sourced carbon-footprint figure in this build — excluded from the estimate, which therefore UNDERSTATES the true total for this composition.`);
      fiberBreakdown.push({ fiber: fiberKey, pct, modeled: false });
      continue;
    }

    const entry = FIBER_CO2E_PER_KG[fiberKey];
    if (!entry) {
      warnings.push(`Unknown fiber "${fiberKey}" (${pct}%) — excluded from the estimate.`);
      fiberBreakdown.push({ fiber: fiberKey, pct, modeled: false });
      continue;
    }

    const variant = detectVariant(fiberKey, params.raw_composition);
    const factor = variant ? entry.value * variant.multiplier : entry.value;
    const contribution = round4(factor * share);
    fiberCo2ePerKg += contribution;

    fiberBreakdown.push({
      fiber: fiberKey,
      pct,
      variant: variant ? variant.key : null,
      co2e_per_kg_fiber: round4(factor),
      contribution_co2e_per_kg_fabric: contribution,
      confidence: variant ? variant.confidence : entry.confidence,
      note: variant ? variant.note : entry.note,
      modeled: true,
    });
  }
  fiberCo2ePerKg = round4(fiberCo2ePerKg);

  // ---- Processing energy CO2e ----
  const country = (params.country || 'bangladesh').toLowerCase();
  const gridFactor = GRID_EMISSION_FACTOR[country] || GRID_EMISSION_FACTOR.bangladesh;
  if (!GRID_EMISSION_FACTOR[country]) {
    warnings.push(`No sourced grid-electricity emission factor for "${params.country}" — used Bangladesh's (${gridFactor.kg_co2_per_kwh} kg CO2/kWh) as a fallback. This may over- or under-state the true processing-stage footprint for that country's actual grid mix.`);
  }
  const processingCo2ePerKg = round4(PROCESSING_ENERGY_KWH_PER_KG.value * gridFactor.kg_co2_per_kwh);

  // ---- Totals ----
  const totalCo2ePerKg = round4(fiberCo2ePerKg + processingCo2ePerKg);
  const fabricWeightKgPerM2 = gsm / 1000;
  const totalCo2ePerM2 = round4(totalCo2ePerKg * fabricWeightKgPerM2);

  let perGarment = null;
  if (params.garment_weight_g) {
    const garmentWeightKg = parseFloat(params.garment_weight_g) / 1000;
    perGarment = {
      garment_weight_g: parseFloat(params.garment_weight_g),
      total_co2e_kg: round4(totalCo2ePerKg * garmentWeightKg),
    };
  }

  // ---- Relative comparison vs a 100% conventional cotton baseline at the
  //      same GSM — a ratio is more defensible than an invented absolute
  //      Low/Medium/High threshold, and mirrors country-costs.js's own
  //      "vs anchor" comparison pattern. ----
  const cottonEntry = FIBER_CO2E_PER_KG.cotton;
  const baselineCo2ePerKg = round4(cottonEntry.value + processingCo2ePerKg);
  const vsBaselinePct = baselineCo2ePerKg > 0
    ? round4(((totalCo2ePerKg - baselineCo2ePerKg) / baselineCo2ePerKg) * 100)
    : null;

  return {
    success: true,
    warnings,
    scope: 'cradle-to-fabric (fiber production + knitting/dyeing/finishing energy) — excludes transport, use-phase and end-of-life',
    fiber_breakdown: fiberBreakdown,
    fiber_co2e_per_kg_fabric: fiberCo2ePerKg,
    processing: {
      energy_kwh_per_kg: PROCESSING_ENERGY_KWH_PER_KG.value,
      grid_emission_factor_kg_co2_per_kwh: gridFactor.kg_co2_per_kwh,
      grid_factor_source: gridFactor.source_note,
      co2e_per_kg_fabric: processingCo2ePerKg,
    },
    total_co2e_per_kg_fabric: totalCo2ePerKg,
    total_co2e_per_m2_fabric: totalCo2ePerM2,
    per_garment: perGarment,
    vs_conventional_cotton_baseline: {
      baseline_co2e_per_kg: baselineCo2ePerKg,
      pct_difference: vsBaselinePct,
      direction: vsBaselinePct == null ? null : (vsBaselinePct < 0 ? 'lower' : vsBaselinePct > 0 ? 'higher' : 'equal'),
    },
  };
}

module.exports = { calculateCarbonFootprint, detectVariant };
