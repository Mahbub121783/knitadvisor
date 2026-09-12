/**
 * KnitAdvisor — Fabric Consumption Allowance Factors (Cutting Room)
 * ===================================================================
 *
 * A garment's NET fabric weight (what ends up sewn into the finished piece —
 * `garment_weight_g` elsewhere in this codebase) is not what a factory has to
 * BUY. Between the fabric roll and the finished garment, real fabric is lost
 * to marker/lay inefficiency, spreading defects, unusable roll ends, and a
 * buffer against the mill's own GSM tolerance — on top of a one-time
 * sample/development yardage every style consumes before bulk cutting even
 * starts. This file holds the sourced, named factors for that gross-up; the
 * math lives in engine/domain/fabric-consumption-engine.js.
 *
 * Published figures diverge across sources (a single-number "10% wastage" in
 * some, a granular "10-15% cutting + 3-5% rejection + 1-3% special ops"
 * breakdown in others) because factories report different subsets of the
 * same loss chain under different names. This file takes the GRANULAR view
 * — each named cause its own adjustable line item — because that is the only
 * form a real quote can audit or override piece by piece, matching the
 * "named line items, not a lump sum" convention used elsewhere in this
 * codebase (see DEFAULT_TRIM_COMPONENTS_USD in garment-costing-engine.js).
 *
 * SOURCES (fetched 2026-09-13):
 * - Marker efficiency 80-90% typical / 82-90% for t-shirt basics, complex
 *   multi-panel styles fall toward the low end, simple rectangular pieces
 *   toward the high end:
 *   apexfashionlab.com/glossary/marker-making,
 *   smartpatternmaking.com/blogs/articles/how-to-calculate-marker-efficiency-in-3-simple-steps,
 *   onlineclothingstudy.com (jigsaw marker case study, 79.0% -> 84.9%)
 * - Granular wastage breakdown (10-15% cutting, 3-5% rejection, 1-3% special
 *   operations): researchgate.net/figure/Comparison-table-for-fabric-consumption_tbl3_334761958
 * - End bits / roll remnants are real, separately-named cutting-room losses:
 *   onlineclothingstudy.com/2015/11/what-is-end-bits-and-end-loss-in.html,
 *   textileblog.com/types-of-fabric-losses-in-cut-order-plan
 * - Total-consumption gross-up formula shape, "Total = Net x (1+Wastage%)":
 *   garmentcalc.com/fabric-consumption-methods, onlineclothingstudy.com/2011/03/how-to-measure-fabric-consumption-of.html
 * - Knit fabric GSM/dimensional tolerance commonly quoted +-3 to 5%:
 *   fumaofabric.com/how-to-understand-fabric-dimensional-stability-shrinkage-stretch,
 *   rectexya.com/2025/11/understanding-fabric-shrinkage.html
 *
 * WHAT THIS DELIBERATELY DOES NOT MODEL: multi-fabric BOMs (a hoodie's body
 * fleece vs. its rib cuffs/waistband are, in reality, two different fabrics
 * costed separately — this codebase's costing-engine.js takes one fabric per
 * calculation, so this consumption layer inherits that same simplification
 * rather than silently pretending to solve it). Also excluded: shrinkage
 * itself as a MASS loss — shrinkage changes the area a given mass of fabric
 * occupies, not the mass, so a `garment_weight_g` already measured on the
 * finished (post-shrink) garment needs no separate shrinkage deduction here;
 * shrinkage instead widens the CUT PATTERN before sewing, which is a pattern-
 * making concern this engine does not receive body measurements to model.
 */

// Marker/lay-planning cutting loss, by garment style complexity. More small,
// curved or bias pieces (hoods, plackets, collars, pocket bags) nest less
// efficiently on a marker than a few large rectangular panels — this is a
// textbook marker-making principle, not a per-garment measured figure, so
// each entry is INDUSTRY_TYPICAL, picked from within the published 10-20%
// band according to that style's known panel complexity.
const MARKER_EFFICIENCY_BY_GARMENT_TYPE = {
  basic_tshirt: {
    marker_cutting_loss_pct: 13,
    marker_efficiency_pct: 87,
    complexity: 'low',
    note: 'Few, large, mostly-rectangular panels (body front/back, 2 sleeves, neck rib) — marker efficiency sits toward the upper end of the published 80-90% band.',
  },
  polo_shirt: {
    marker_cutting_loss_pct: 16,
    marker_efficiency_pct: 84,
    complexity: 'medium',
    note: 'Collar, placket and cuff pieces are small and irregularly shaped, pulling marker efficiency below a plain tee.',
  },
  basic_hoodie: {
    marker_cutting_loss_pct: 20,
    marker_efficiency_pct: 80,
    complexity: 'high',
    note: 'Hood (multiple curved panels + facing), kangaroo pocket and two separate ribbed components (cuff + waistband) add many small/curved pieces — pushes marker efficiency toward the lower end of the published band.',
  },
  basic_jogger: {
    marker_cutting_loss_pct: 17,
    marker_efficiency_pct: 83,
    complexity: 'medium-high',
    note: 'Leg panels nest efficiently (large, near-rectangular), but pocket bags, waistband and cuffs add small pieces that drag the average down.',
  },
};

// Fabric holes, shading-off, spreading defects (tension bands, needle lines)
// that force a panel to be re-cut from elsewhere in the lay. Not garment-
// style dependent — this is a fabric-quality/inspection outcome. Published
// range 3-5%; 4% used as the midpoint default.
const REJECTION_DAMAGE_PCT_DEFAULT = 4;

// Unusable fabric left at the end of each roll once it is too short to lay
// another full marker length ("end bits"), plus minor splice/part-change
// loss. Published range (as part of a "special operations" loss line) 1-3%;
// 2% used as the midpoint default.
const END_BIT_REMNANT_PCT_DEFAULT = 2;

// Buffer against the mill's own delivered-GSM tolerance (commonly quoted
// +-3 to 5% on a knit fabric) so a shipment that lands light doesn't leave
// the cut order short of fabric. 3% used as a moderate default — a buyer
// with a tighter GSM tolerance clause in their fabric PO can override lower.
const GSM_TOLERANCE_BUFFER_PCT_DEFAULT = 3;

// Sample & development yardage: every style consumes fabric for a lab-dip
// swatch round, a fit sample, a PP (pre-production) sample and a size-set
// before bulk cutting starts — cut in small quantities, by hand, at far
// lower efficiency than a bulk marker. Modelled as a "pieces-equivalent"
// count (each priced at the style's own net garment weight) plus an
// inefficiency multiplier for the low-ply manual cutting, rather than a
// flat unsourced kg figure, so it scales correctly with the actual garment.
// ESTIMATED throughout — no single public figure covers every buyer's
// development calendar; every count is independently overridable.
const SAMPLE_DEVELOPMENT_DEFAULTS = {
  lab_dip_pcs_equivalent: 2,   // small swatches for shade approval rounds
  fit_sample_pcs: 3,           // 1st + 2nd fit + a spare
  pp_sample_pcs: 3,            // pre-production sample set shown to the buyer
  size_set_pcs: 6,             // one piece per size in a typical S-XXL run
  sample_cutting_inefficiency_multiplier: 1.3, // manual, low-ply cutting wastes more per piece than a bulk marker
};

module.exports = {
  MARKER_EFFICIENCY_BY_GARMENT_TYPE,
  REJECTION_DAMAGE_PCT_DEFAULT,
  END_BIT_REMNANT_PCT_DEFAULT,
  GSM_TOLERANCE_BUFFER_PCT_DEFAULT,
  SAMPLE_DEVELOPMENT_DEFAULTS,
};
