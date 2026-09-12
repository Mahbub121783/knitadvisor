/**
 * KnitAdvisor — Garment CMT (Cut-Make-Trim) Costing Engine
 * ==========================================================
 *
 * Turns a fabric-level cost (already produced by costing-engine.js's
 * per-garment section, driven by garment_weight_g) into a full garment cost
 * estimate by adding Cut + Make + Trim labor/materials, then G&A overhead
 * and profit margin, to reach an FOB-style total.
 *
 * ── THE CORE FORMULA (sourced) ──────────────────────────────────────────
 * Cost-per-minute (CM), "at 100% efficiency":
 *   CM_100 = MonthlyGrossWage / WorkingMinutesPerMonth
 *
 * Labor cost for a given SAM of work, adjusted for real line efficiency:
 *   LaborCost = (SAM × CM_100) / EfficiencyFraction
 *
 * This exact form — "CM cost = (SAM of the garment x Minute cost of the
 * labor)/Line efficiency(%)" — is the formula given by ordnur.com and
 * textilecalculations.com's worked CM-costing examples. The one-example
 * cross-check (salary 6000, 20 workers, 480 shift-min, 80% efficiency ->
 * CM_100 = 6000/(20*480) = 0.625, cost-per-SAM-at-80% = 0.625/0.8 = 0.78)
 * matches the source's stated 0.78 result — see garment_costing.test.js.
 *
 * ── WHAT'S SOURCED vs ESTIMATED ──────────────────────────────────────────
 * - Wage grades: GOVT_GAZETTE (Bangladesh Minimum Wage Board, Dec 2023) —
 *   see catalog/bd-wage-board.js.
 * - Garment SAM totals: INDUSTRY_TYPICAL / LOOKUP_DERIVED per garment type —
 *   see catalog/garment-operations.js.
 * - Line efficiency default (60%): INDUSTRY_TYPICAL, real range 43-82%.
 * - Cutting-room SAM, trim cost, overhead %, profit % below: ESTIMATED —
 *   these vary enormously by factory and buyer negotiation and no single
 *   public number is authoritative. Exposed as adjustable inputs, not
 *   hidden inside the formula, so a real quote can override every one.
 *
 * This engine ONLY knows about labor/trim/overhead/profit. Fabric cost is
 * computed by costing-engine.js (calculateCost with garment_weight_g) and
 * passed in here as `fabricCostPerGarmentUsd` — kept separate because that
 * engine already has real yarn-price and dyeing-cost sourcing this one has
 * no business duplicating.
 */

const {
  BD_WAGE_GRADES,
  STANDARD_WORKING_MINUTES_PER_MONTH,
  DEFAULT_LINE_EFFICIENCY_PCT,
  LINE_EFFICIENCY_SOURCE_NOTE,
  getWageGrade,
} = require('../catalog/bd-wage-board');

const { buildGarmentSam, GARMENT_CATALOG } = require('../catalog/garment-operations');

// ============================================================
// CUTTING ROOM — SAM as a fraction of sewing SAM
// ============================================================
// Cutting-room work (spreading, marking/marker-making, cutting, numbering,
// bundling) is done on a laid-up multi-ply stack, not per garment, so its
// per-garment SAM is much smaller than sewing. No single published % is
// authoritative; 8% of the garment's sewing SAM is used here as a practical
// mid-range approximation — ESTIMATED, adjustable via `cutting_sam_pct`.
const DEFAULT_CUTTING_SAM_PCT_OF_SEWING = 8;

// Cutting-room labor is typically better-paid/more skilled per head but the
// work itself is less labor-intensive per garment; this engine uses the same
// wage-grade table and a separately adjustable efficiency (cutting rooms
// commonly run tighter than sewing lines because there's no line-balancing
// problem — batch work, not a moving assembly line).
const DEFAULT_CUTTING_EFFICIENCY_PCT = 75;

// ============================================================
// TRIM — named components, each ESTIMATED (no single public per-unit price
// is authoritative; real prices come from a supplier quote). Kept as named
// line items, not one lump sum, so a real quote can override any single one
// without losing the others — same "show your work" convention as the rest
// of this codebase's costing.
// ============================================================
const DEFAULT_TRIM_COMPONENTS_USD = {
  main_label:  { name: 'Main woven label',        usd: 0.020, source: 'ESTIMATED' },
  care_label:  { name: 'Care label (printed)',    usd: 0.008, source: 'ESTIMATED' },
  size_label:  { name: 'Size label',              usd: 0.006, source: 'ESTIMATED' },
  hangtag:     { name: 'Hangtag + string/pin',    usd: 0.035, source: 'ESTIMATED' },
  poly_bag:    { name: 'Poly bag (individual)',   usd: 0.015, source: 'ESTIMATED' },
  sewing_thread: { name: 'Sewing thread (all seams)', usd: 0.025, source: 'ESTIMATED' },
  carton_alloc:  { name: 'Carton + packing, per-piece allocation', usd: 0.030, source: 'ESTIMATED' },
};

// Garment-type-specific extra trims (buttons/zips/eyelets already have a SAM
// cost for the LABOR of attaching them — this is the materials cost of the
// trim item itself).
const GARMENT_EXTRA_TRIMS_USD = {
  polo_shirt:    { buttons: { name: 'Buttons (3pc)', usd: 0.018, source: 'ESTIMATED' } },
  basic_hoodie:  {
    drawstring: { name: 'Drawstring cord + tips', usd: 0.045, source: 'ESTIMATED' },
    eyelets:    { name: 'Eyelets (2pc)',          usd: 0.012, source: 'ESTIMATED' },
  },
  basic_jogger:  {
    elastic:     { name: 'Waistband elastic',      usd: 0.055, source: 'ESTIMATED' },
    drawstring:  { name: 'Drawstring cord + tips', usd: 0.045, source: 'ESTIMATED' },
    eyelets:     { name: 'Eyelets (2pc)',          usd: 0.012, source: 'ESTIMATED' },
  },
};

// ============================================================
// OVERHEAD & PROFIT
// ============================================================
// Typical CMT-quote structure adds a factory G&A/overhead % and a profit
// margin % on top of the direct CMT cost. Both vary by factory size,
// compliance tier and buyer negotiating power — ESTIMATED mid-range
// defaults, always adjustable.
const DEFAULT_OVERHEAD_PCT = 10;
const DEFAULT_PROFIT_PCT = 10;

function round4(v) { return Math.round(v * 10000) / 10000; }

/**
 * @param {object} params
 *   garment_type          — key into GARMENT_CATALOG (required)
 *   fabric_cost_per_garment_usd — from costing-engine.js's per-garment fabric cost (required)
 *   wage_grade            — 1-5, default 3 ("typical operator")
 *   line_efficiency_pct    — default 60 (INDUSTRY_TYPICAL)
 *   cutting_efficiency_pct — default 75
 *   cutting_sam_pct        — default 8 (% of sewing SAM)
 *   addons                — array of COMPLEXITY_ADDONS keys, e.g. ['full_zipper']
 *   overhead_pct           — default 10
 *   profit_pct             — default 10
 *   trim_overrides         — { componentKey: usd } to replace any DEFAULT_TRIM_COMPONENTS_USD entry
 *   order_quantity         — optional, informational only (larger orders don't change the
 *                            unit-cost math here — real volume discounts happen at the yarn/fabric
 *                            price stage, already handled by costing-engine.js)
 */
function calculateGarmentCosting(params = {}) {
  const startTime = Date.now();
  const warnings = [];

  const garmentType = (params.garment_type || '').toLowerCase().trim();
  const garmentDef = GARMENT_CATALOG[garmentType];
  if (!garmentDef) {
    return {
      success: false,
      error: `Unknown garment_type "${params.garment_type}". Valid options: ${Object.keys(GARMENT_CATALOG).join(', ')}`,
    };
  }

  const fabricCostPerGarmentUsd = parseFloat(params.fabric_cost_per_garment_usd);
  if (!Number.isFinite(fabricCostPerGarmentUsd) || fabricCostPerGarmentUsd < 0) {
    return {
      success: false,
      error: 'fabric_cost_per_garment_usd is required (compute it first via /api/calculate-cost with garment_weight_g, then pass its garment.total_usd here).',
    };
  }

  const wageGradeNum = parseInt(params.wage_grade, 10) || 3;
  const wageGrade = getWageGrade(wageGradeNum);
  if (params.wage_grade && parseInt(params.wage_grade, 10) !== wageGrade.grade) {
    warnings.push(`wage_grade ${params.wage_grade} not found — used Grade ${wageGrade.grade} instead.`);
  }

  const lineEfficiencyPct = parseFloat(params.line_efficiency_pct) || DEFAULT_LINE_EFFICIENCY_PCT;
  const cuttingEfficiencyPct = parseFloat(params.cutting_efficiency_pct) || DEFAULT_CUTTING_EFFICIENCY_PCT;
  const cuttingSamPct = parseFloat(params.cutting_sam_pct) || DEFAULT_CUTTING_SAM_PCT_OF_SEWING;
  const overheadPct = params.overhead_pct != null ? parseFloat(params.overhead_pct) : DEFAULT_OVERHEAD_PCT;
  const profitPct = params.profit_pct != null ? parseFloat(params.profit_pct) : DEFAULT_PROFIT_PCT;

  if (lineEfficiencyPct <= 0 || lineEfficiencyPct > 100) {
    return { success: false, error: 'line_efficiency_pct must be between 0 (exclusive) and 100.' };
  }

  // ---- 1. SEWING SAM (build from operations + any complexity add-ons) ----
  const addons = Array.isArray(params.addons) ? params.addons : [];
  const samBuild = buildGarmentSam(garmentType, addons);
  const sewingSam = samBuild.sam_minutes;

  // ---- 2. CUTTING-ROOM SAM ----
  const cuttingSam = round4(sewingSam * (cuttingSamPct / 100));

  // ---- 3. COST PER MINUTE, at 100% efficiency, from the wage grade ----
  const cm100 = wageGrade.gross_bdt / STANDARD_WORKING_MINUTES_PER_MONTH;

  // ---- 4. MAKE (sewing) COST ----
  const makingCostBdt = round4((sewingSam * cm100) / (lineEfficiencyPct / 100));

  // ---- 5. CUT (cutting room) COST ----
  const cuttingCostBdt = round4((cuttingSam * cm100) / (cuttingEfficiencyPct / 100));

  // ---- 6. TRIM COST (materials, USD directly — trims are usually
  //         imported/dollar-denominated inputs even in a BDT-wage factory) ----
  const trimComponents = { ...DEFAULT_TRIM_COMPONENTS_USD, ...(params.trim_overrides ? Object.fromEntries(
    Object.entries(params.trim_overrides).map(([k, usd]) => [k, { ...(DEFAULT_TRIM_COMPONENTS_USD[k] || { name: k }), usd: parseFloat(usd), source: 'USER_OVERRIDE' }])
  ) : {}) };
  const extraTrims = GARMENT_EXTRA_TRIMS_USD[garmentType] || {};
  const allTrimLineItems = { ...trimComponents, ...extraTrims };
  const trimTotalUsd = round4(Object.values(allTrimLineItems).reduce((s, t) => s + t.usd, 0));

  // ---- 7. CONVERT LABOR (BDT) TO USD ----
  // Uses the same DEFAULT_EXCHANGE_RATES anchor as costing-engine.js would,
  // but that engine's rate table is USD-based (BDT not listed there — the
  // whole app quotes Bangladesh as the anchor in USD, not BDT), so a
  // separate, explicit BDT/USD rate is taken here. Passed in or defaulted;
  // ESTIMATED because FX moves daily and this app does not have a live feed
  // for it (unlike yarn prices, which do have one — see yarn-price-feed).
  const bdtPerUsd = parseFloat(params.bdt_per_usd) || 121.5; // approximate 2026 rate — ESTIMATED, pass a live rate if you have one
  const makingCostUsd = round4(makingCostBdt / bdtPerUsd);
  const cuttingCostUsd = round4(cuttingCostBdt / bdtPerUsd);

  // ---- 8. CMT TOTAL ----
  const cmtTotalUsd = round4(makingCostUsd + cuttingCostUsd + trimTotalUsd);

  // ---- 9. DIRECT COST (fabric + CMT), then overhead + profit ----
  const directCostUsd = round4(fabricCostPerGarmentUsd + cmtTotalUsd);
  const overheadUsd = round4(directCostUsd * (overheadPct / 100));
  const subtotalUsd = round4(directCostUsd + overheadUsd);
  const profitUsd = round4(subtotalUsd * (profitPct / 100));
  const fobTotalUsd = round4(subtotalUsd + profitUsd);

  // Sanity flag: published guidance says fabric typically runs 60-70% of a
  // basic garment's total cost (leelineapparel.com, fumaofabric.com). Outside
  // that band isn't necessarily wrong (embellished styles, very cheap fabric,
  // very labor-heavy styles all shift it) but is worth a second look.
  const fabricSharePct = round4((fabricCostPerGarmentUsd / fobTotalUsd) * 100);
  if (fabricSharePct < 40 || fabricSharePct > 80) {
    warnings.push(`Fabric is ${fabricSharePct}% of the FOB total — published guidance for a basic garment is ~60-70%. Not necessarily wrong (check GSM, style complexity and trims before assuming an error).`);
  }

  return {
    success: true,
    response_ms: Date.now() - startTime,
    warnings,

    garment: {
      type: garmentType,
      name: garmentDef.name,
      name_bn: garmentDef.name_bn,
    },

    sam: {
      sewing: samBuild,
      cutting_minutes: cuttingSam,
      cutting_pct_of_sewing: cuttingSamPct,
      cutting_pct_source: 'ESTIMATED',
    },

    labor: {
      wage_grade: wageGrade,
      standard_working_minutes_per_month: STANDARD_WORKING_MINUTES_PER_MONTH,
      cost_per_minute_at_100pct_bdt: round4(cm100),
      line_efficiency_pct: lineEfficiencyPct,
      line_efficiency_source: lineEfficiencyPct === DEFAULT_LINE_EFFICIENCY_PCT ? LINE_EFFICIENCY_SOURCE_NOTE : 'USER_OVERRIDE',
      cutting_efficiency_pct: cuttingEfficiencyPct,
      making_cost_bdt: makingCostBdt,
      cutting_cost_bdt: cuttingCostBdt,
      bdt_per_usd: bdtPerUsd,
      making_cost_usd: makingCostUsd,
      cutting_cost_usd: cuttingCostUsd,
    },

    trim: {
      line_items: allTrimLineItems,
      total_usd: trimTotalUsd,
    },

    cmt_total_usd: cmtTotalUsd,

    fabric_cost_per_garment_usd: round4(fabricCostPerGarmentUsd),

    summary: {
      fabric_usd: round4(fabricCostPerGarmentUsd),
      cmt_usd: cmtTotalUsd,
      direct_cost_usd: directCostUsd,
      overhead_pct: overheadPct,
      overhead_usd: overheadUsd,
      subtotal_usd: subtotalUsd,
      profit_pct: profitPct,
      profit_usd: profitUsd,
      fob_total_usd: fobTotalUsd,
      fabric_share_pct_of_fob: fabricSharePct,
    },
  };
}

module.exports = {
  calculateGarmentCosting,
  DEFAULT_CUTTING_SAM_PCT_OF_SEWING,
  DEFAULT_CUTTING_EFFICIENCY_PCT,
  DEFAULT_TRIM_COMPONENTS_USD,
  GARMENT_EXTRA_TRIMS_USD,
  DEFAULT_OVERHEAD_PCT,
  DEFAULT_PROFIT_PCT,
};
