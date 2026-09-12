/**
 * KnitAdvisor — Garment Operation Breakdown & SAM Catalog
 * =========================================================
 *
 * Standard Allowed Minute (SAM) methodology, per the sourced industry
 * formula (onlineclothingstudy.com, textilelearner.net, ordnur.com):
 *
 *   SAM = Basic Time × (1 + Bundle Allowance + Machine/Personal Allowance)
 *       = Basic Time × (1 + 0.10 + 0.20)
 *       = Basic Time × 1.30
 *
 * "Basic Time" here is the sum of the named sewing operations below, each in
 * minutes. The GSD/PMTS system real factories use to build these numbers
 * from individual hand/machine motions (a licensed, proprietary 39-code
 * motion-time database — see textilelearner.net's GSD article) isn't
 * reproducible without that database, so this catalog instead works
 * top-down: published total-SAM benchmarks for each garment type are the
 * ANCHOR (cited per garment below), and the operation list is this engine's
 * own reasonable construction of what a factory's operation bulletin for
 * that style typically looks like, tuned so operations-sum × 1.30 lands on
 * the cited benchmark. Treat the TOTAL as the sourced number; treat the
 * per-operation split as an illustrative, tech-pack-style breakdown, not a
 * factory's actual measured bulletin.
 *
 * Sources for the benchmark totals:
 *   - Basic T-shirt  ~8.5 min  — onlineclothingstudy.com / textilesscholars.blogspot.com
 *   - Polo shirt     ~10.4 min — textilesscholars.blogspot.com (polo t-shirt operation breakdown)
 *   - Hoodie (fleece)~16.0 min — ordnur.com (350gsm fleece hoodie, 5000pc order, total SMV 15.99)
 *   - Basic bottom   ~11.65 min — general trouser/jean benchmark (nearest published proxy for a
 *                                 basic knit jogger/sweatpant; jeans are woven, so this is the
 *                                 closest available reference, not a knit-specific measurement —
 *                                 flagged ESTIMATED_PROXY, not the same confidence as the other 3)
 */

const ALLOWANCE_FACTOR = 1.30; // 10% bundle + 20% machine/personal, standard industry figure

const GARMENT_CATALOG = {
  basic_tshirt: {
    name: 'Basic Crew-Neck T-Shirt',
    name_bn: 'বেসিক টি-শার্ট',
    benchmark_sam: 8.5,
    benchmark_source: 'INDUSTRY_TYPICAL',
    operations: [
      { name: 'Shoulder join (2-needle chain stitch)', machine: 'Overlock/Chainstitch', basic_min: 0.35 },
      { name: 'Neck tape insert (twill tape reinforcement)', machine: 'Flatlock', basic_min: 0.32 },
      { name: 'Neck rib joining (loop closure)', machine: 'Overlock', basic_min: 0.28 },
      { name: 'Neck rib attach to body', machine: 'Overlock', basic_min: 0.52 },
      { name: 'Neck rib top-stitch', machine: 'Flatlock/Coverstitch', basic_min: 0.35 },
      { name: 'Sleeve attach, left', machine: 'Overlock', basic_min: 0.50 },
      { name: 'Sleeve attach, right', machine: 'Overlock', basic_min: 0.50 },
      { name: 'Side seam + underarm, left', machine: 'Overlock', basic_min: 0.58 },
      { name: 'Side seam + underarm, right', machine: 'Overlock', basic_min: 0.58 },
      { name: 'Sleeve hem, left', machine: 'Coverstitch', basic_min: 0.38 },
      { name: 'Sleeve hem, right', machine: 'Coverstitch', basic_min: 0.38 },
      { name: 'Bottom hem', machine: 'Coverstitch', basic_min: 0.55 },
      { name: 'Main (woven) label attach', machine: 'Single needle', basic_min: 0.28 },
      { name: 'Care + size label attach', machine: 'Single needle', basic_min: 0.32 },
      { name: 'Trimming & thread cleaning', machine: 'Manual', basic_min: 0.35 },
      { name: 'Final measurement check', machine: 'Manual', basic_min: 0.30 },
    ],
  },

  polo_shirt: {
    name: 'Basic Short-Sleeve Polo Shirt',
    name_bn: 'পোলো শার্ট',
    benchmark_sam: 10.4,
    benchmark_source: 'INDUSTRY_TYPICAL',
    operations: [
      { name: 'Shoulder join', machine: 'Overlock/Chainstitch', basic_min: 0.35 },
      { name: 'Collar make (fuse, turn, topstitch)', machine: 'Single needle', basic_min: 0.65 },
      { name: 'Collar attach to body', machine: 'Overlock', basic_min: 0.55 },
      { name: 'Placket make (fold & prepare)', machine: 'Single needle', basic_min: 0.45 },
      { name: 'Placket attach', machine: 'Single needle', basic_min: 0.50 },
      { name: 'Buttonhole (2-3 holes)', machine: 'Buttonhole', basic_min: 0.35 },
      { name: 'Button attach (2-3 buttons)', machine: 'Button attach', basic_min: 0.30 },
      { name: 'Placket bartack', machine: 'Bartack', basic_min: 0.13 },
      { name: 'Sleeve attach, left', machine: 'Overlock', basic_min: 0.50 },
      { name: 'Sleeve attach, right', machine: 'Overlock', basic_min: 0.50 },
      { name: 'Side seam + underarm, left', machine: 'Overlock', basic_min: 0.58 },
      { name: 'Side seam + underarm, right', machine: 'Overlock', basic_min: 0.58 },
      { name: 'Sleeve hem, left', machine: 'Coverstitch', basic_min: 0.38 },
      { name: 'Sleeve hem, right', machine: 'Coverstitch', basic_min: 0.38 },
      { name: 'Bottom hem', machine: 'Coverstitch', basic_min: 0.55 },
      { name: 'Main label attach', machine: 'Single needle', basic_min: 0.28 },
      { name: 'Care + size label attach', machine: 'Single needle', basic_min: 0.32 },
      { name: 'Trimming & thread cleaning', machine: 'Manual', basic_min: 0.35 },
      { name: 'Final measurement check', machine: 'Manual', basic_min: 0.30 },
    ],
  },

  basic_hoodie: {
    name: 'Basic Pullover Hoodie (Kangaroo Pocket)',
    name_bn: 'হুডি',
    benchmark_sam: 16.0,
    benchmark_source: 'LOOKUP_DERIVED',
    benchmark_source_note: '350gsm fleece hoodie, 5,000pc order — ordnur.com operation-breakdown case study (total SMV 15.99)',
    operations: [
      { name: 'Shoulder join', machine: 'Overlock/Chainstitch', basic_min: 0.35 },
      { name: 'Hood make (join panels + facing)', machine: 'Overlock + Single needle', basic_min: 1.10 },
      { name: 'Hood attach to body neckline', machine: 'Overlock', basic_min: 0.70 },
      { name: 'Hood drawstring channel topstitch', machine: 'Coverstitch', basic_min: 0.55 },
      { name: 'Drawstring insert + tip attach', machine: 'Manual + Bartack', basic_min: 0.45 },
      { name: 'Eyelet/grommet, drawstring holes (2pcs)', machine: 'Eyelet press', basic_min: 0.30 },
      { name: 'Kangaroo pocket make (fold + hem opening)', machine: 'Coverstitch', basic_min: 0.60 },
      { name: 'Kangaroo pocket attach (topstitch + bartack)', machine: 'Single needle + Bartack', basic_min: 1.55 },
      { name: 'Sleeve attach, left', machine: 'Overlock', basic_min: 0.50 },
      { name: 'Sleeve attach, right', machine: 'Overlock', basic_min: 0.50 },
      { name: 'Rib cuff make (both sleeves)', machine: 'Overlock', basic_min: 0.55 },
      { name: 'Rib cuff attach (both sleeves)', machine: 'Overlock', basic_min: 0.95 },
      { name: 'Side seam + underarm, left', machine: 'Overlock', basic_min: 0.58 },
      { name: 'Side seam + underarm, right', machine: 'Overlock', basic_min: 0.58 },
      { name: 'Rib waistband make', machine: 'Overlock', basic_min: 0.45 },
      { name: 'Rib waistband attach', machine: 'Overlock', basic_min: 1.20 },
      { name: 'Bartack reinforcement (pocket corners, hood)', machine: 'Bartack', basic_min: 0.35 },
      { name: 'Main + care + size label attach', machine: 'Single needle', basic_min: 0.40 },
      { name: 'Trimming & thread cleaning', machine: 'Manual', basic_min: 0.35 },
      { name: 'Final measurement check', machine: 'Manual', basic_min: 0.30 },
    ],
  },

  basic_jogger: {
    name: 'Basic Knit Jogger / Sweatpant',
    name_bn: 'জগার প্যান্ট',
    benchmark_sam: 11.65,
    benchmark_source: 'ESTIMATED_PROXY',
    benchmark_source_note: 'Nearest published proxy is the general trouser/jeans SMV benchmark — jeans are woven, so this stands in for a knit jogger\'s complexity level rather than being a knit-specific measurement. Lower confidence than the other 3 garment types.',
    operations: [
      { name: 'Side seam pocket make + attach (both sides)', machine: 'Overlock + Single needle', basic_min: 1.55 },
      { name: 'Waistband elastic channel make', machine: 'Coverstitch', basic_min: 0.55 },
      { name: 'Elastic insert + close', machine: 'Manual + Single needle', basic_min: 0.45 },
      { name: 'Waistband attach to body', machine: 'Overlock', basic_min: 0.96 },
      { name: 'Inseam, both legs', machine: 'Overlock', basic_min: 0.95 },
      { name: 'Outseam/side seam, both legs', machine: 'Overlock', basic_min: 0.70 },
      { name: 'Crotch seam (rise)', machine: 'Overlock', basic_min: 0.45 },
      { name: 'Leg hem / rib cuff attach, both legs', machine: 'Coverstitch/Overlock', basic_min: 0.75 },
      { name: 'Drawstring eyelets (2pcs)', machine: 'Eyelet press', basic_min: 0.30 },
      { name: 'Drawstring insert', machine: 'Manual', basic_min: 0.35 },
      { name: 'Back patch pocket (optional style)', machine: 'Single needle', basic_min: 0.50 },
      { name: 'Main + care + size label attach', machine: 'Single needle', basic_min: 0.45 },
      { name: 'Bartack (pocket corners)', machine: 'Bartack', basic_min: 0.35 },
      { name: 'Trimming & thread cleaning', machine: 'Manual', basic_min: 0.35 },
      { name: 'Final measurement check', machine: 'Manual', basic_min: 0.30 },
    ],
  },
};

// Optional add-on operations — extra work content a buyer's style can layer
// on top of a base garment (e.g. a zip-through hoodie instead of pullover).
// Each figure is this engine's own reasonable estimate for the NAMED
// operation only (not benchmarked against a published total the way the
// base garments above are) — source: ESTIMATED throughout.
const COMPLEXITY_ADDONS = {
  full_zipper: { name: 'Full-front zipper insertion', basic_min: 1.80, source: 'ESTIMATED' },
  contrast_tipping: { name: 'Contrast tipping / piping detail', basic_min: 0.30, source: 'ESTIMATED' },
  embroidery_handling: { name: 'Embroidery placement & handling (embroidery itself not included)', basic_min: 0.25, source: 'ESTIMATED' },
  extra_pocket: { name: 'Additional patch pocket', basic_min: 0.50, source: 'ESTIMATED' },
  reflective_trim: { name: 'Reflective trim application', basic_min: 0.40, source: 'ESTIMATED' },
};

/** Sum an operations array's basic_min. */
function sumBasicMinutes(operations) {
  return operations.reduce((s, op) => s + op.basic_min, 0);
}

/** Full SAM build for a garment type, with optional add-on operation keys. */
function buildGarmentSam(garmentTypeId, addonKeys = []) {
  const g = GARMENT_CATALOG[garmentTypeId];
  if (!g) return null;

  const baseOps = g.operations;
  const addonOps = (addonKeys || [])
    .map(k => COMPLEXITY_ADDONS[k])
    .filter(Boolean)
    .map(a => ({ name: a.name, machine: 'Add-on', basic_min: a.basic_min, is_addon: true }));

  const allOps = [...baseOps, ...addonOps];
  const basicMinutesTotal = sumBasicMinutes(allOps);
  const sam = basicMinutesTotal * ALLOWANCE_FACTOR;

  return {
    garment_type: garmentTypeId,
    name: g.name,
    name_bn: g.name_bn,
    operations: allOps,
    basic_minutes_total: parseFloat(basicMinutesTotal.toFixed(4)),
    allowance_factor: ALLOWANCE_FACTOR,
    allowance_breakdown: { bundle_pct: 10, machine_personal_pct: 20 },
    sam_minutes: parseFloat(sam.toFixed(4)),
    benchmark_sam: g.benchmark_sam,
    benchmark_source: g.benchmark_source,
    benchmark_source_note: g.benchmark_source_note || null,
  };
}

module.exports = {
  GARMENT_CATALOG,
  COMPLEXITY_ADDONS,
  ALLOWANCE_FACTOR,
  buildGarmentSam,
  sumBasicMinutes,
};
