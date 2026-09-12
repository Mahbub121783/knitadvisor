/**
 * KnitAdvisor — Fabric Consumption & Cutting-Room Allowance Engine
 * ===================================================================
 *
 * Turns a garment's NET fabric weight (what ends up sewn into the finished
 * piece) into the GROSS fabric a factory actually has to buy and cut, by
 * layering the named, sourced allowance factors from
 * catalog/fabric-consumption-factors.js on top of it — then converts that
 * gross weight into a gross fabric cost using the fabric's own per-kg price.
 *
 * ── THE CORE FORMULA (sourced) ───────────────────────────────────────────
 *   Total fabric consumption = Net fabric consumption x (1 + Total Wastage%)
 * — the standard shape used across onlineclothingstudy.com and
 * garmentcalc.com's weight-based consumption formulas. `Total Wastage%` here
 * is the SUM of four independently-sourced, independently-overridable named
 * causes (marker/lay loss, rejection/damage, end-bit/remnant, GSM-tolerance
 * buffer) rather than one opaque number — see the catalog file for each
 * one's citation and range.
 *
 * On top of the per-garment gross-up, a one-time sample & development
 * fabric allocation (lab dip, fit, PP and size-set sampling — cut before
 * bulk production, at lower efficiency) is computed and, when an
 * `order_quantity` is supplied, amortized into a per-garment addition.
 *
 * This engine sits between costing-engine.js (which prices fabric per kg)
 * and garment-costing-engine.js (which prices CMT labor/trim on top of a
 * per-garment fabric cost) — it does not duplicate either. Previously,
 * `/api/garment-costing` passed costing-engine.js's NET per-garment fabric
 * cost straight into the CMT engine, silently understating the real fabric
 * spend (and therefore the fabric-share-of-FOB sanity check) by the entire
 * wastage chain modelled here.
 */

const {
  MARKER_EFFICIENCY_BY_GARMENT_TYPE,
  REJECTION_DAMAGE_PCT_DEFAULT,
  END_BIT_REMNANT_PCT_DEFAULT,
  GSM_TOLERANCE_BUFFER_PCT_DEFAULT,
  SAMPLE_DEVELOPMENT_DEFAULTS,
} = require('../catalog/fabric-consumption-factors');

function round4(v) { return Math.round(v * 10000) / 10000; }

const FLAT_MARKER_LOSS_FALLBACK_PCT = 15; // mid-point of the published 10-20% marker-loss band, used only when garment_type has no complexity profile

/**
 * @param {object} params
 *   net_garment_weight_g   — the finished garment's fabric weight, grams (required)
 *   fabric_cost_per_kg_usd — the fabric's own per-kg cost, e.g. costing-engine.js's
 *                            cost_breakdown_usd.total_per_kg (required)
 *   garment_type           — key into MARKER_EFFICIENCY_BY_GARMENT_TYPE, selects the
 *                            default marker/cutting-loss %; unknown/absent falls back
 *                            to a flat 15% with a warning
 *   marker_cutting_loss_pct, rejection_damage_pct, end_bit_remnant_pct,
 *   gsm_tolerance_buffer_pct — each overrides its named default (0-100)
 *   order_quantity          — optional; when given, amortizes the one-time sample/
 *                             development fabric into a per-garment addition and
 *                             totals the full order's fabric requirement
 *   sample_development_overrides — object overriding any SAMPLE_DEVELOPMENT_DEFAULTS key
 */
function calculateFabricConsumption(params = {}) {
  const warnings = [];

  const netGarmentWeightG = parseFloat(params.net_garment_weight_g);
  if (!Number.isFinite(netGarmentWeightG) || netGarmentWeightG <= 0) {
    return { success: false, error: 'net_garment_weight_g is required (the finished garment\'s fabric weight in grams, before cutting-room allowances).' };
  }

  const fabricCostPerKgUsd = parseFloat(params.fabric_cost_per_kg_usd);
  if (!Number.isFinite(fabricCostPerKgUsd) || fabricCostPerKgUsd < 0) {
    return { success: false, error: 'fabric_cost_per_kg_usd is required (the fabric\'s per-kg cost — e.g. /api/cost\'s cost_breakdown_usd.total_per_kg).' };
  }

  const garmentType = (params.garment_type || '').toLowerCase().trim();
  const complexityDefaults = MARKER_EFFICIENCY_BY_GARMENT_TYPE[garmentType] || null;

  const markerCuttingLossPct = params.marker_cutting_loss_pct != null
    ? parseFloat(params.marker_cutting_loss_pct)
    : (complexityDefaults ? complexityDefaults.marker_cutting_loss_pct : FLAT_MARKER_LOSS_FALLBACK_PCT);

  if (params.marker_cutting_loss_pct == null && !complexityDefaults) {
    warnings.push(garmentType
      ? `No marker-efficiency profile for garment_type "${garmentType}" — used a flat ${FLAT_MARKER_LOSS_FALLBACK_PCT}% cutting-loss default (mid-point of the published 10-20% range).`
      : `No garment_type supplied — used a flat ${FLAT_MARKER_LOSS_FALLBACK_PCT}% marker/cutting-loss default (mid-point of the published 10-20% range).`);
  }

  const rejectionDamagePct = params.rejection_damage_pct != null ? parseFloat(params.rejection_damage_pct) : REJECTION_DAMAGE_PCT_DEFAULT;
  const endBitRemnantPct = params.end_bit_remnant_pct != null ? parseFloat(params.end_bit_remnant_pct) : END_BIT_REMNANT_PCT_DEFAULT;
  const gsmTolerancePct = params.gsm_tolerance_buffer_pct != null ? parseFloat(params.gsm_tolerance_buffer_pct) : GSM_TOLERANCE_BUFFER_PCT_DEFAULT;

  const pctChecks = [
    ['marker_cutting_loss_pct', markerCuttingLossPct],
    ['rejection_damage_pct', rejectionDamagePct],
    ['end_bit_remnant_pct', endBitRemnantPct],
    ['gsm_tolerance_buffer_pct', gsmTolerancePct],
  ];
  for (const [label, val] of pctChecks) {
    if (!Number.isFinite(val) || val < 0 || val > 100) {
      return { success: false, error: `${label} must be a number between 0 and 100.` };
    }
  }

  const totalWastagePct = round4(markerCuttingLossPct + rejectionDamagePct + endBitRemnantPct + gsmTolerancePct);

  // ---- NET vs GROSS fabric weight & cost ----
  const netWeightKg = netGarmentWeightG / 1000;
  const grossWeightKg = round4(netWeightKg * (1 + totalWastagePct / 100));
  const grossWeightG = round4(grossWeightKg * 1000);

  const netFabricCostUsd = round4(netWeightKg * fabricCostPerKgUsd);
  const grossFabricCostUsd = round4(grossWeightKg * fabricCostPerKgUsd);
  const wastageCostUsd = round4(grossFabricCostUsd - netFabricCostUsd);

  // ---- Sample & development yardage (one-time per style) ----
  const sd = { ...SAMPLE_DEVELOPMENT_DEFAULTS, ...(params.sample_development_overrides || {}) };
  const samplePiecesEquivalent = sd.lab_dip_pcs_equivalent + sd.fit_sample_pcs + sd.pp_sample_pcs + sd.size_set_pcs;
  const sampleFabricKg = round4(samplePiecesEquivalent * netWeightKg * sd.sample_cutting_inefficiency_multiplier);
  const sampleFabricCostUsd = round4(sampleFabricKg * fabricCostPerKgUsd);

  const orderQuantity = params.order_quantity != null && params.order_quantity !== ''
    ? parseInt(params.order_quantity, 10)
    : null;

  let sampleCostPerGarmentUsd = null;
  let order = null;

  if (orderQuantity && orderQuantity > 0) {
    sampleCostPerGarmentUsd = round4(sampleFabricCostUsd / orderQuantity);
    order = {
      quantity: orderQuantity,
      total_fabric_kg: round4(grossWeightKg * orderQuantity + sampleFabricKg),
      total_fabric_cost_usd: round4(grossFabricCostUsd * orderQuantity + sampleFabricCostUsd),
    };
  } else {
    warnings.push('order_quantity not provided — sample & development fabric is reported as a one-time total only, not amortized into the per-garment fabric cost.');
  }

  const fabricCostPerGarmentUsd = round4(grossFabricCostUsd + (sampleCostPerGarmentUsd || 0));

  return {
    success: true,
    warnings,
    garment_type: garmentType || null,

    net: {
      weight_g: netGarmentWeightG,
      weight_kg: round4(netWeightKg),
      fabric_cost_usd: netFabricCostUsd,
    },

    allowances: {
      marker_cutting_loss_pct: {
        value: markerCuttingLossPct,
        source: params.marker_cutting_loss_pct != null ? 'USER_OVERRIDE' : 'INDUSTRY_TYPICAL',
        complexity: complexityDefaults ? complexityDefaults.complexity : null,
        note: complexityDefaults ? complexityDefaults.note : 'Flat default — published marker efficiency is generally 80-90% (10-20% loss); styles with many small/curved panels sit lower, simple rectangular pieces sit higher.',
      },
      rejection_damage_pct: {
        value: rejectionDamagePct,
        source: params.rejection_damage_pct != null ? 'USER_OVERRIDE' : 'INDUSTRY_TYPICAL',
        note: 'Fabric holes, shading-off and spreading defects that force a panel to be re-cut — published range 3-5%.',
      },
      end_bit_remnant_pct: {
        value: endBitRemnantPct,
        source: params.end_bit_remnant_pct != null ? 'USER_OVERRIDE' : 'INDUSTRY_TYPICAL',
        note: 'Unusable fabric at the end of each roll, plus minor splice loss — published range 1-3%.',
      },
      gsm_tolerance_buffer_pct: {
        value: gsmTolerancePct,
        source: params.gsm_tolerance_buffer_pct != null ? 'USER_OVERRIDE' : 'INDUSTRY_TYPICAL',
        note: 'Buffer against the mill\'s own delivered-GSM tolerance (commonly +-3 to 5%) so a lighter-than-nominal roll doesn\'t leave the cut order short.',
      },
      total_wastage_pct: totalWastagePct,
    },

    gross: {
      weight_g: grossWeightG,
      weight_kg: grossWeightKg,
      fabric_cost_usd: grossFabricCostUsd,
      wastage_cost_usd: wastageCostUsd,
    },

    sample_development: {
      assumptions: sd,
      pieces_equivalent: samplePiecesEquivalent,
      fabric_kg_one_time: sampleFabricKg,
      fabric_cost_usd_one_time: sampleFabricCostUsd,
      amortized_cost_per_garment_usd: sampleCostPerGarmentUsd,
      source: 'ESTIMATED',
      note: 'Lab-dip, fit, PP and size-set sample cutting, consumed before/alongside bulk production at lower (manual, low-ply) efficiency than the bulk marker.',
    },

    order,

    fabric_cost_per_garment_usd: fabricCostPerGarmentUsd,
    fabric_cost_per_kg_usd: fabricCostPerKgUsd,
  };
}

module.exports = {
  calculateFabricConsumption,
  FLAT_MARKER_LOSS_FALLBACK_PCT,
};
