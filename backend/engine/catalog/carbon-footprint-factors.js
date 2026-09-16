/**
 * KnitAdvisor — Carbon Footprint Factors (Fiber Production + Processing)
 * ==========================================================================
 *
 * WHY THIS FILE IS UNUSUALLY CAUTIOUS
 * -------------------------------------
 * Textile LCA (life-cycle-assessment) literature disagrees with itself far
 * more than this app's other reference data does. Researching this file
 * (2026-09-16) turned up, for the SAME fiber, figures differing by 5-30x
 * depending on system boundary, region, and study year — e.g. published
 * cotton cradle-to-gate figures ranging from -0.26 to 14.1 kg CO2e/kg, and
 * linen from 0.52 to 16.7 kg CO2e/kg. Textile Exchange's own March 2026
 * Cotton LCA study (the most current, ISO-14044-reviewed authoritative
 * source found) states this outright: "LCA results remain sensitive to
 * assumptions and contextual factors... simplistic rankings or claims based
 * on these results should not be undertaken." That is the standard this
 * file tries to meet — sourced, triangulated, and honest about the size of
 * its own error bars — not a precise number dressed up as one.
 *
 * PRIMARY ANCHOR SET (internally consistent — one comparative LCA study,
 * "staple fiber production" stage, same methodology across all four, so
 * these four are comparable to EACH OTHER in a way that mixing numbers
 * from four different studies would not be):
 *   cotton 2.8, polyester 3.1, viscose 5.9, lyocell/tencel 6.1 kg CO2e/kg
 *   (A Comparative LCA of T-Shirt Production from Viscose, Lyocell, Cotton
 *   and Polyester, MDPI Sustainability 2026, 18(8):4070)
 *
 * EVERYTHING ELSE is corroborated where possible across 2+ independent
 * sources (noted per entry) or flagged as single-source/wide-uncertainty
 * when it could not be.
 *
 * WHAT THIS DELIBERATELY DOES NOT MODEL: transport/logistics (no shipping-
 * lane data in this app), use-phase (washing/drying over a garment's life —
 * genuinely out of scope for a fabric-costing tool), and end-of-life. This
 * is a cradle-to-gate (or cradle-to-fabric) estimate, not a full garment
 * LCA — the same "say what you don't cover" discipline as country-costs.js's
 * own "Not modelled" field.
 */

// ── FIBER PRODUCTION: kg CO2e per kg of fiber, cradle-to-gate ──────────────
const FIBER_CO2E_PER_KG = {
  cotton: {
    value: 2.8, confidence: 'ESTIMATED',
    note: 'Comparative LCA study (staple fiber stage) — see file header. Published literature for conventional cotton ranges roughly 1.5-6.5 kg CO2e/kg depending on region/irrigation/methodology; some studies report figures far outside that band under different system boundaries.',
  },
  polyester: {
    value: 3.1, confidence: 'ESTIMATED',
    note: 'Comparative LCA study (staple fiber stage); corroborated independently by a separate carbon-footprint database reporting 3.12 kg CO2e/kg virgin polyester.',
  },
  viscose: {
    value: 5.9, confidence: 'ESTIMATED',
    note: 'Comparative LCA study (staple fiber stage). Other viscose figures in circulation range 4.1-10.1 kg CO2e/kg.',
  },
  tencel: { // lyocell — Tencel is Lenzing's lyocell brand name
    value: 6.1, confidence: 'ESTIMATED',
    note: 'Comparative LCA study (staple fiber stage, reported as "lyocell"). Tencel is the branded form of lyocell fiber.',
  },
  modal: {
    value: 5.9, confidence: 'ESTIMATED_PROXY',
    note: 'No modal-specific cradle-to-gate figure was sourced — modal is a high-wet-modulus viscose (see composition-engine.js), so this reuses the viscose figure as the nearest cellulosic analog rather than inventing a distinct number.',
  },
  nylon: {
    value: 7.5, confidence: 'ESTIMATED',
    note: 'WIDE UNCERTAINTY — published figures range roughly 5-20 kg CO2e/kg; nylon production is understood to carry a materially higher footprint than polyester because of N2O emissions from adipic-acid manufacture, but a single reliable cradle-to-gate figure could not be corroborated across independent sources this session. Treat as the least-certain figure in this table alongside elastane and acrylic.',
  },
  elastane: {
    value: 20.0, confidence: 'ESTIMATED',
    note: 'Single-source figure, not independently corroborated. Elastane/spandex is low-volume and thinly covered in public LCA literature. Its contribution to a blend\'s total footprint is usually small in absolute terms (elastane is rarely more than 2-8% of a knit composition), which partially offsets this figure\'s uncertainty.',
  },
  acrylic: {
    value: 21.1, confidence: 'ESTIMATED',
    note: 'Single-source figure, not independently corroborated this session.',
  },
  wool: {
    value: 80.3, confidence: 'ESTIMATED',
    note: 'Single-source figure. Order of magnitude is consistent with wool\'s widely-documented high footprint from enteric methane (sheep digestion) — commonly cited published figures for greasy/clean wool cluster in the 60-90+ kg CO2e/kg range — but the specific value is not independently corroborated this session.',
  },
  linen: {
    value: 5.0, confidence: 'ESTIMATED',
    note: 'EXTREME UNCERTAINTY — published figures for linen/flax ranged from 0.52 to 16.7 kg CO2e/kg across sources found this session (a >30x spread), reflecting very different system boundaries (field-only vs full fiber processing) and the low-input nature of flax cultivation. 5.0 is a rough mid-point, not a defensible point estimate — treat any linen-heavy composition\'s result as indicative only.',
  },
};

// Fiber-sourcing variants that measurably change the footprint, applied as a
// multiplier on the base fiber figure above. Detected from the RAW
// composition string (not the parsed fiber key, which already collapses
// "organic cotton"/"BCI cotton"/"recycled cotton" all onto plain "cotton" —
// see composition-engine.js's FIBER_ALIASES) via keyword matching in
// carbon-footprint-engine.js.
const FIBER_VARIANT_MULTIPLIERS = {
  cotton: {
    organic: { multiplier: 0.54, confidence: 'ESTIMATED', note: '46% lower global warming potential than conventional cotton — Textile Exchange Cotton LCA study, March 2026 (Sphera-supported, ISO 14044-reviewed).' },
  },
  polyester: {
    recycled: { multiplier: 0.30, confidence: 'ESTIMATED', note: '~70% lower than virgin polyester production — corroborated across 2 independent sources on mechanically recycled PET.' },
  },
};

// Fibers this table does not cover at all — composition-engine.js can parse
// these (silk, polypropylene, polyethylene, bamboo), but no defensible
// cradle-to-gate figure was sourced this session. A composition containing
// one of these gets an explicit gap warning rather than a fabricated number.
const UNMODELED_FIBERS = ['silk', 'polypropylene', 'polyethylene', 'bamboo'];

// ── GRID ELECTRICITY EMISSION FACTOR ────────────────────────────────────
// Bangladesh only — this app's cost-anchor country (see country-costs.js).
// Two published figures diverge meaningfully: Bangladesh DOE's own Grid
// Emission Factor (~0.61-0.62 kg CO2/kWh, FY2020-22) vs UNFCCC's Harmonized
// IFI Default Grid Factor (0.412 kg CO2e/kWh) — the DOE figure is used here
// as the government-published source for the country this app anchors to,
// consistent with country-costs.js's own preference for official sources.
const GRID_EMISSION_FACTOR = {
  bangladesh: {
    kg_co2_per_kwh: 0.61,
    confidence: 'ESTIMATED',
    source_note: 'Bangladesh Department of Environment Grid Emission Factor, most recent published figure (~0.61-0.62 kg CO2/kWh, FY2020-22 data). UNFCCC\'s Harmonized IFI Default Grid Factor for Bangladesh (0.412 kg CO2e/kWh) is a more conservative alternative in wide use.',
  },
};

// ── PROCESSING ENERGY (knitting + wet processing/dyeing + finishing, combined) ──
// Deliberately ONE combined figure rather than three separately-sourced
// sub-figures: a circular-knitting-specific kWh/kg figure could not be
// corroborated this session (only machine POWER DRAW in kW was found, not
// energy per kg of output — a different, unusable unit without a specific
// machine's production rate), and fabricating three separate numbers with
// only one actually sourced would be MORE false precision, not less.
// 16 kWh/kg is a commonly-cited "textile dyeing" energy-intensity figure,
// used here as a conservative stand-in for the full wet-processing +
// knitting energy budget (dyeing dominates textile wet-processing energy
// use, so this likely does not understate the total).
const PROCESSING_ENERGY_KWH_PER_KG = {
  value: 16, confidence: 'ESTIMATED',
  note: 'Combined knitting + dyeing + finishing energy intensity, standing in for the full processing stage. A circular-knitting-specific per-kg figure was not independently sourced; dyeing (the dominant wet-processing energy user) commonly cited around 16 kWh/kg was used as the whole-stage proxy rather than fabricating separate knitting/finishing figures.',
};

module.exports = {
  FIBER_CO2E_PER_KG,
  FIBER_VARIANT_MULTIPLIERS,
  UNMODELED_FIBERS,
  GRID_EMISSION_FACTOR,
  PROCESSING_ENERGY_KWH_PER_KG,
};
