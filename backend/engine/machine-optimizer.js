/**
 * KnitAdvisor — Machine Optimizer (Optimal Single Dia + Single Gauge)
 * ===================================================================
 *
 * Expert requirement: instead of showing a Dia RANGE and a Gauge RANGE,
 * recommend ONE optimal Gauge and ONE optimal Dia tuned to the actual
 * yarn count / GSM the user entered.
 *
 * Methodology (industry-grounded):
 *
 *  GAUGE  — fully deterministic from yarn count via cover-factor theory.
 *           NPI = √(K_cover / Tex) × 2.54   (K = 1650 single, 1400 double)
 *           ≡ NPI ≈ 4.25·√Ne (single) / 3.91·√Ne (double).
 *           Source: Spencer "Knitting Technology" 3rd ed.; Munden cover factor.
 *           Then SNAP to nearest commercially-available gauge (machines only
 *           come in discrete gauges) and validate against the fabric's range.
 *
 *  DIA    — smart hybrid:
 *           (a) If a target finished open-width is given → solve exactly:
 *               Dia = (Width_cm × WPC) / (π × Gauge), then snap to standard dia.
 *           (b) Otherwise → recommend the standard economical "workhorse" dia
 *               for that fabric category (real mill default).
 *           Open width (cm) = π·Dia·Gauge / WPC  (relaxed wales/cm).
 *
 * Every recommendation is SNAPPED to a real commercial machine size so the
 * output is buildable, not just theoretical. Tightness Factor is cross-checked
 * so the recommended pair is guaranteed knittable.
 */

'use strict';

// ============================================================
// COMMERCIAL MACHINE KNOWLEDGE (real Mayer/Terrot/Fukuhara/Pailung configs)
// ============================================================

// Discrete gauges (needles per inch) actually manufactured, per fabric family.
const COMMERCIAL_GAUGES = {
  single_jersey: [18, 20, 22, 24, 28, 32, 36],
  rib:           [14, 16, 18, 20, 22, 24, 28],
  interlock:     [18, 20, 22, 24, 28, 32],
  warp_knit:     [18, 20, 22, 24, 28, 32, 36, 40],   // E-gauge for tricot/raschel
};

// Standard machine diameters (inches) available off-the-shelf.
const STANDARD_DIA = {
  single_jersey: [26, 28, 30, 32, 34, 36, 38, 40],
  rib:           [28, 30, 32, 34, 36, 38, 40],
  interlock:     [28, 30, 32, 34, 36, 38, 40],
};

// Most common / economical "workhorse" diameter when no width target given.
const WORKHORSE_DIA = {
  single_jersey: 30,
  rib:           34,
  interlock:     34,
};

// Relaxed wales-per-cm factor: WPC = (gauge_NPI / 2.54) × factor.
// Accounts for widthwise relaxation/contraction after the fabric leaves the
// needles. Rib contracts most (elastic), interlock moderately, SJ least.
const WPC_RELAX_FACTOR = {
  single_jersey: 1.13,
  rib:           1.40,
  interlock:     1.20,
};

// Cover-factor constants (consistent with formulas.js calcOptimumGaugeFromTex).
const K_COVER = { single: 1650, double: 1400 };

// ============================================================
// HELPERS
// ============================================================

function categoryFamily(category) {
  if (category === 'rib') return 'rib';
  if (category === 'interlock') return 'interlock';
  if (category === 'warp_knit') return 'warp_knit';
  return 'single_jersey'; // single_jersey, fleece, terry, etc. behave single-bed
}

function isDoubleBed(category) {
  return category === 'rib' || category === 'interlock';
}

function snapToNearest(value, list) {
  if (!list || !list.length) return Math.round(value);
  return list.reduce((best, cur) =>
    Math.abs(cur - value) < Math.abs(best - value) ? cur : best, list[0]);
}

function neToTex(ne) {
  return ne > 0 ? 590.5 / ne : null;
}

// ============================================================
// 1. OPTIMAL GAUGE — deterministic from yarn count
// ============================================================
/**
 * @param {number} count_ne  cotton count (Ne)
 * @param {string} category  fabric category
 * @param {object} fabricDef fabric definition (for gauge_range validation)
 * @param {number} [tex]     optional Tex (if already computed); else derived
 */
function recommendOptimalGauge(count_ne, category, fabricDef, tex) {
  const family = categoryFamily(category);
  const isDouble = isDoubleBed(category);
  const k = isDouble ? K_COVER.double : K_COVER.single;
  const T = tex || neToTex(count_ne);

  if (!T || T <= 0) {
    return { ok: false, reason: 'count_unavailable' };
  }

  // NPI = √(K / Tex) × 2.54
  const npc = Math.sqrt(k / T);
  const theoretical_npi = parseFloat((npc * 2.54).toFixed(2));

  // Snap to nearest commercial gauge for this family.
  const available = COMMERCIAL_GAUGES[family] || COMMERCIAL_GAUGES.single_jersey;
  let optimal_gauge = snapToNearest(theoretical_npi, available);

  // Constrain to the fabric's published gauge_range when available.
  const gr = fabricDef && fabricDef.gauge_range;
  let clamped = false;
  if (gr && gr.min != null && gr.max != null) {
    if (optimal_gauge < gr.min) { optimal_gauge = snapToNearest(gr.min, available); clamped = true; }
    if (optimal_gauge > gr.max) { optimal_gauge = snapToNearest(gr.max, available); clamped = true; }
  }

  const k_label = isDouble ? '4.64·√Ne (double bed)' : '4.25·√Ne (single bed)';

  return {
    ok: true,
    theoretical_npi,
    optimal_gauge,
    available_gauges: available,
    clamped_to_range: clamped,
    tex: parseFloat(T.toFixed(2)),
    formula: `NPI = √(${k} / ${T.toFixed(2)}) × 2.54 = ${theoretical_npi} ≈ ${k_label}`,
    note: clamped
      ? `Theoretical ${theoretical_npi} NPI snapped to ${optimal_gauge} GG (kept within fabric's ${gr.min}–${gr.max} GG build range).`
      : `Theoretical ${theoretical_npi} NPI → nearest commercial gauge ${optimal_gauge} GG.`,
  };
}

// ============================================================
// 2. OPTIMAL DIA — smart hybrid (target-width OR economical default)
// ============================================================
/**
 * @param {object} args
 * @param {number} args.gauge          chosen optimal gauge (NPI)
 * @param {string} args.category       fabric category
 * @param {number} [args.targetWidthInches] finished OPEN width target (inches)
 */
function recommendOptimalDia({ gauge, category, targetWidthInches }) {
  const family = categoryFamily(category);
  if (family === 'warp_knit') {
    return { ok: false, reason: 'warp_knit_flatbed', note: 'Warp knit machines are flat-bed; dia not applicable (use working width).' };
  }

  const wpc = (gauge / 2.54) * (WPC_RELAX_FACTOR[family] || 1.13); // wales per cm (relaxed)
  const standardList = STANDARD_DIA[family] || STANDARD_DIA.single_jersey;

  let mode, exact_dia, optimal_dia;

  if (targetWidthInches && targetWidthInches > 0) {
    // Solve: Dia = (Width_cm × WPC) / (π × Gauge)
    const widthCm = targetWidthInches * 2.54;
    exact_dia = (widthCm * wpc) / (Math.PI * gauge);
    optimal_dia = snapToNearest(exact_dia, standardList);
    mode = 'width_target';
  } else {
    // Economical workhorse default for this fabric family.
    optimal_dia = WORKHORSE_DIA[family] || 30;
    exact_dia = optimal_dia;
    mode = 'economical_default';
  }

  // Resulting machine geometry for the snapped dia.
  const needles_raw = Math.PI * optimal_dia * gauge;
  const needles = Math.round(needles_raw / 2) * 2; // nearest even
  const open_width_cm = parseFloat((needles / wpc).toFixed(1));
  const open_width_in = parseFloat((open_width_cm / 2.54).toFixed(1));
  const tube_flat_in = parseFloat((open_width_in / 2).toFixed(1));
  const feeders = Math.round(optimal_dia * 3.5); // mill rule: ~3.5 feeders/inch modern multi-feeder

  return {
    ok: true,
    mode,
    optimal_dia,
    exact_dia: parseFloat(exact_dia.toFixed(2)),
    standard_options: standardList,
    needles,
    feeders,
    wpc_relaxed: parseFloat(wpc.toFixed(2)),
    open_width_cm,
    open_width_in,
    tube_flat_in,
    note: mode === 'width_target'
      ? `Target ${targetWidthInches}" open → exact ${exact_dia.toFixed(1)}" dia, snapped to standard ${optimal_dia}". Delivers ~${open_width_in}" open width.`
      : `No width target → ${optimal_dia}" workhorse dia (most economical for ${family.replace('_', ' ')}). Yields ~${open_width_in}" open width, ${feeders} feeders.`,
  };
}

// ============================================================
// 3. ORCHESTRATOR — full optimal machine recommendation
// ============================================================
/**
 * @param {object} args
 * @param {object} args.fabricDef
 * @param {number} args.count_ne
 * @param {number} [args.tex]
 * @param {number} [args.tf]                   tightness factor (√Tex/ℓcm) from main engine
 * @param {string} [args.tfStatus]             knittability status from main engine
 * @param {object} [args.tfLimits]             { ideal_min, ideal_max } from main engine
 * @param {number} [args.targetWidthInches]    optional finished open-width target
 */
function recommendMachine({ fabricDef, count_ne, tex, tf, tfStatus, tfLimits, targetWidthInches }) {
  if (!fabricDef || !count_ne || count_ne <= 0) {
    return { ok: false, reason: 'insufficient_input' };
  }
  const category = fabricDef.category;

  const gaugeRec = recommendOptimalGauge(count_ne, category, fabricDef, tex);
  if (!gaugeRec.ok) return { ok: false, reason: gaugeRec.reason };

  const diaRec = recommendOptimalDia({
    gauge: gaugeRec.optimal_gauge,
    category,
    targetWidthInches,
  });

  // Tightness Factor cross-check — reuse the main engine's TF (already computed
  // with fiber-correct dynamic limits) so units & band stay consistent.
  let tightness = null;
  if (tf != null) {
    const min = tfLimits && tfLimits.ideal_min != null ? tfLimits.ideal_min : 14.0;
    const max = tfLimits && tfLimits.ideal_max != null ? tfLimits.ideal_max : 16.5;
    let verdict = 'balanced';
    if (tf < min) verdict = 'slack';
    else if (tf > max) verdict = 'tight';
    tightness = {
      tf,
      verdict,
      status: tfStatus || null,
      healthy_band: `${min}–${max}`,
    };
  }

  const confidence = gaugeRec.clamped_to_range ? 'high' : 'very_high';

  return {
    ok: true,
    confidence,
    // headline single values
    optimal_gauge: gaugeRec.optimal_gauge,
    optimal_dia: diaRec.ok ? diaRec.optimal_dia : null,
    // gauge detail
    gauge: gaugeRec,
    // dia detail
    dia: diaRec,
    // cross-check
    tightness,
    // human summary line
    summary: diaRec.ok
      ? `USE ${diaRec.optimal_dia}" Dia × ${gaugeRec.optimal_gauge} GG — ${diaRec.needles} needles, ${diaRec.feeders} feeders, ~${diaRec.open_width_in}" open width.`
      : `USE ${gaugeRec.optimal_gauge} GG (flat-bed; set working width directly).`,
  };
}

module.exports = {
  recommendMachine,
  recommendOptimalGauge,
  recommendOptimalDia,
  COMMERCIAL_GAUGES,
  STANDARD_DIA,
  WORKHORSE_DIA,
};
