/**
 * KnitAdvisor — Wet-Processing Critical-Path Engine
 * =================================================
 *
 * Explains the FABRICATION + GSM based critical path of dyeing/finishing with
 * factory-grade accuracy. Given { fabric, finish GSM, shade, dyeing method,
 * composition }, it returns:
 *
 *   1. GREIGE (grey) GSM target  — what to knit BEFORE dyeing so the finished
 *      GSM lands on spec, derived from area-shrinkage × dye-add-on factors.
 *   2. MACHINE-WISE critical path — scour, bleach, mercerize, singe, dye,
 *      heat-set, stenter, compactor, calender, raising, topping — each with
 *      purpose, the real problems that occur, their cause, the machine-level
 *      solution and the floor remedy, filtered to the fabric/shade/method.
 *   3. FABRIC-STRUCTURE issues  — spirality (single-bed), width pull-in (rib),
 *      pile evenness (fleece), lycra width/GSM jump, etc.
 *   4. COLOUR / CHEMICAL issues — bronzing, turquoise reproducibility, optic-
 *      white catalytic holes, pastel unlevel, discharge strength loss.
 *   5. PROCESS ROUTE  — ordered machine sequence for the chosen dyeing method.
 *
 * Numbers are engineering estimates calibrated to the bulk Knitting Master File
 * (process-loss) and the grey→finish R&D file (shrinkage / dye gain). Honest:
 * these are reproducible mill conventions, not a single magic constant.
 *
 * Deterministic. No AI.
 */

'use strict';

const { estimateProcessLoss } = require('./production-data');

// ============================================================
// 1. AREA-SHRINKAGE (compaction GSM gain) BY FABRIC FAMILY
// ============================================================
// Representative finished length/width shrinkage (%). The fabric relaxes and
// compacts in wet processing → area shrinks → GSM per m² rises.
//   Area-Factor = 1 / [(1 − L/100)(1 − W/100)]
const AREA_SHRINK = {
  single_jersey: { L: 0.5, W: 4.5 },
  rib:           { L: 1.0, W: 6.5 },
  interlock:     { L: 1.0, W: 4.0 },
  pique:         { L: 1.0, W: 5.0 },
  fleece:        { L: 2.0, W: 6.0 },
  terry:         { L: 2.0, W: 5.0 },
  waffle:        { L: 1.5, W: 6.0 },
  heavy_jersey:  { L: 2.0, W: 5.0 },
};

function familyOf(category) {
  if (!category) return 'single_jersey';
  if (category === 'rib') return 'rib';
  if (category === 'interlock') return 'interlock';
  if (/pique|lacoste/.test(category)) return 'pique';
  if (/fleece/.test(category)) return 'fleece';
  if (/terry/.test(category)) return 'terry';
  if (category === 'waffle') return 'waffle';
  if (category === 'heavy_jersey') return 'heavy_jersey';
  return 'single_jersey';
}

// ============================================================
// 2. DYE-ADD-ON (chemical mass gain) BY SHADE × METHOD
// ============================================================
// Fractional GSM gain from dye + auxiliary deposited on the fibre.
// Reactive exhaust adds the most; pigment/discharge differ.
// DYE_ADDON: fractional GSM gain per shade × dyeing method
// Updated to 6-tier shade system. Legacy 3-tier keys also present for compat.
const DYE_ADDON = {
  reactive: {
    black: 0.050, dark_navy: 0.040, light_medium: 0.020, fluorescent: 0.025,
    white_melange: 0.005, melange: 0.003,
    // legacy
    dark: 0.040, medium: 0.020, light: 0.005, white: 0.005,
  },
  disperse: {
    black: 0.035, dark_navy: 0.028, light_medium: 0.015, fluorescent: 0.020,
    white_melange: 0.005, melange: 0.003,
    dark: 0.028, medium: 0.015, light: 0.005, white: 0.005,
  },
  pigment: {
    black: 0.025, dark_navy: 0.018, light_medium: 0.010, fluorescent: 0.015,
    white_melange: 0.005, melange: 0.003,
    dark: 0.018, medium: 0.010, light: 0.005, white: 0.005,
  },
  discharge: {
    black: 0.055, dark_navy: 0.040, light_medium: 0.020, fluorescent: 0.020,
    white_melange: 0.010, melange: 0.005,
    dark: 0.040, medium: 0.020, light: 0.010, white: 0.010,
  },
  garment_wash: {
    black: 0.045, dark_navy: 0.035, light_medium: 0.018, fluorescent: 0.020,
    white_melange: 0.008, melange: 0.005,
    dark: 0.035, medium: 0.018, light: 0.008, white: 0.008,
  },
};

// Extra area relaxation for aggressive routes (discharge/G-wash relax harder).
const EXTRA_AREA = { discharge: 0.025, garment_wash: 0.035 };

const SHADES  = ['black','dark_navy','light_medium','fluorescent','white_melange','melange','dark','medium','light','white'];
const METHODS = ['reactive', 'disperse', 'pigment', 'discharge', 'garment_wash'];

function normShade(s) {
  const x = (s || 'light_medium').toLowerCase().replace(/ /g,'_');
  if (x.startsWith('aop')) return 'white_melange';
  if (SHADES.includes(x))  return x;
  // legacy → new
  if (x === 'dark')   return 'dark_navy';
  if (x === 'medium') return 'light_medium';
  if (x === 'light' || x === 'white') return 'white_melange';
  return 'light_medium';
}
function normMethod(m) {
  const x = (m || 'reactive').toLowerCase().replace(/[\s-]/g, '_');
  if (METHODS.includes(x)) return x;
  if (/disch/.test(x)) return 'discharge';
  if (/pig/.test(x)) return 'pigment';
  if (/disp|poly/.test(x)) return 'disperse';
  if (/wash|stone|enzyme|acid/.test(x)) return 'garment_wash';
  return 'reactive';
}

// ============================================================
// 3. GREIGE GSM TARGET  (the headline GSM critical-path answer)
// ============================================================
/**
 * @param {number} finishGsm
 * @param {string} category    fabric category
 * @param {string} shade       dark|medium|light|white
 * @param {string} method      reactive|disperse|pigment|discharge|garment_wash
 */
function greigeGsmTarget(finishGsm, category, shade, method) {
  if (!finishGsm || finishGsm <= 0) return null;
  const fam = familyOf(category);
  const sh = normShade(shade);
  const me = normMethod(method);

  const ls = AREA_SHRINK[fam] || AREA_SHRINK.single_jersey;
  const extraArea = EXTRA_AREA[me] || 0;
  const Lf = ls.L / 100;
  const Wf = ls.W / 100 + extraArea;             // aggressive routes widen the relax
  const areaFactor = 1 / ((1 - Lf) * (1 - Wf));  // >1 : GSM rises from area shrink
  const dyeFactor = 1 + ((DYE_ADDON[me] || DYE_ADDON.reactive)[sh] || 0.02);
  const totalRatio = areaFactor * dyeFactor;

  // Pigment / AOP-pigment: pad-dry-cure, little wet relax → grey ≈ finish.
  // Disperse heat-set already stabilised → milder area gain.
  const greyGsm = parseFloat((finishGsm / totalRatio).toFixed(0));
  const lowGsm  = parseFloat((finishGsm / (totalRatio * 1.015)).toFixed(0)); // tolerance band
  const highGsm = parseFloat((finishGsm / (totalRatio * 0.985)).toFixed(0));

  return {
    finish_gsm: finishGsm,
    grey_gsm_target: greyGsm,
    grey_gsm_range: [Math.min(lowGsm, highGsm), Math.max(lowGsm, highGsm)],
    shade: sh,
    dyeing_method: me,
    area_shrinkage: { length_pct: ls.L, width_pct: parseFloat((Wf * 100).toFixed(1)), area_factor: parseFloat(areaFactor.toFixed(4)) },
    dye_add_on_pct: parseFloat(((dyeFactor - 1) * 100).toFixed(1)),
    finish_to_grey_ratio: parseFloat(totalRatio.toFixed(4)),
    formula: `Grey GSM = Finish ${finishGsm} ÷ [AreaFactor ${areaFactor.toFixed(3)} × DyeFactor ${dyeFactor.toFixed(3)}] = ${finishGsm} ÷ ${totalRatio.toFixed(3)} = ${greyGsm} g/m²`,
    explanation: `Knit GREY at ~${greyGsm} g/m². In ${me.replace('_', ' ')} processing the ${fam.replace('_', ' ')} compacts (area ×${areaFactor.toFixed(3)} → +${((areaFactor - 1) * 100).toFixed(1)}% GSM) and the ${sh} shade deposits dye mass (+${((dyeFactor - 1) * 100).toFixed(1)}% GSM), so the finished fabric rises to the ${finishGsm} g/m² target.`,
  };
}

/** Grey GSM for all 6 shades at once (the floor's "show me all shades" need). */
function greigeGsmAllShades(finishGsm, category, method) {
  const shadesToShow = ['black','dark_navy','light_medium','fluorescent','white_melange','melange'];
  return shadesToShow.map(sh => {
    const g = greigeGsmTarget(finishGsm, category, sh, method);
    return g ? { shade: sh, grey_gsm: g.grey_gsm_target, dye_add_on_pct: g.dye_add_on_pct } : null;
  }).filter(Boolean);
}

// ============================================================
// 4. MACHINE-WISE CRITICAL PATH KNOWLEDGE
// ============================================================
// Each stage: when it applies, its purpose, and the problem→cause→solution→
// remedy records. `when` is a predicate over the context for relevance.
const MACHINE_STAGES = [
  {
    key: 'singeing', name: 'Singeing', cat: 'pre-treatment',
    purpose: 'Burn protruding surface fibres for a clean, smooth face — sharper pique/lacoste cells and crisp print definition (mostly combed & CVC).',
    when: (c) => c.combed || c.fam === 'pique' || c.cvc || c.method === 'pigment' || c.method === 'discharge',
    problems: [
      { problem: 'Scorch / singe line', cause: 'Flame too intense or fabric speed too slow', solution: 'Lower flame intensity, raise fabric speed, cool drum', remedy: 'Reverse-side singe, re-inspect for strength' },
      { problem: 'Still hairy / poor print', cause: 'Under-singe, flame too weak', solution: 'Increase flame, single pass each face', remedy: 'Re-singe before print' },
      { problem: 'Strength loss', cause: 'Over-singe burns load-bearing fibre', solution: 'Optimise flame×speed; avoid double-singe on fine counts', remedy: 'Limit grey strength loss ≤ 10%' },
    ],
  },
  {
    key: 'scouring', name: 'Scouring', cat: 'pre-treatment',
    purpose: 'Remove natural waxes, oils, knitting lubricant and dirt → uniform absorbency before dyeing. Mandatory for all cotton/CVC knits.',
    when: () => true,
    problems: [
      { problem: 'Uneven dye / white spots', cause: 'Incomplete scour, residual wax/oil patches', solution: 'NaOH + wetting agent + sequestrant, 95–98°C adequate time', remedy: 'Re-scour, drop-test absorbency before dye', formula: 'Absorbency: drop sinks ≤ 1 s = OK' },
      { problem: 'Strength / weight loss', cause: 'Over-scour, caustic too strong', solution: 'Control alkali dose & time', remedy: 'Cap scour weight loss ~4–8%' },
      { problem: 'Knitting-oil stain not removed', cause: 'Wrong/weak detergent for silicone oil', solution: 'Use oil-specific scouring detergent', remedy: 'Spot pre-treat heavy oil lines' },
    ],
  },
  {
    key: 'bleaching', name: 'Bleaching', cat: 'pre-treatment',
    purpose: 'Destroy natural cotton pigment → bright white base. Essential for white/optic and bright/light shades; partial (half-bleach) for darks.',
    when: (c) => c.shade === 'white' || c.shade === 'light' || c.method === 'pigment',
    problems: [
      { problem: 'Pinhole / catalytic damage', cause: 'Metal/iron in water + H₂O₂ → localised burn', solution: 'Sequestrant + peroxide stabiliser, soft water, pH 10.5–11', remedy: 'Reject affected; treat water hardness' },
      { problem: 'Yellowing / dull white', cause: 'Under-bleach or pH drift', solution: 'Optimise H₂O₂, OBA, 98°C; control pH', remedy: 'Re-bleach / add optical brightener', formula: 'CIE Whiteness ≥ 70–80 for optic white' },
      { problem: 'Shade shift after dye', cause: 'Residual peroxide oxidises reactive dye', solution: 'Peroxide-killer (catalase) before dyeing', remedy: 'Always neutralise H₂O₂ pre-dye' },
    ],
  },
  {
    key: 'mercerizing', name: 'Mercerizing', cat: 'pre-treatment',
    purpose: 'Caustic (26–30°Bé) under tension swells the fibre → lustre↑, dye uptake↑ (15–30% dye saving), strength↑, dimensional stability↑. Premium combed goods.',
    when: (c) => c.combed && c.cottonRich,
    problems: [
      { problem: 'No lustre / no benefit', cause: 'Insufficient tension during caustic', solution: 'Maintain clip/chain tension through impregnation', remedy: 'Verify lustre on sample' },
      { problem: 'Streaky / uneven dyeing', cause: 'Uneven caustic pickup', solution: 'Uniform pad, controlled caustic conc.', remedy: 'Mercerize evenly or skip for solids' },
      { problem: 'Shade shift, harsh hand', cause: 'Residual alkali not washed', solution: 'Thorough neutralise + hot wash', remedy: 'Check residual alkali (phenolphthalein)' },
    ],
  },
  {
    key: 'dyeing', name: 'Dyeing (exhaust soft-flow)', cat: 'coloration',
    purpose: 'Apply colour. Soft-flow/overflow for knits at liquor ratio 1:5–1:8. The single biggest source of shade & fastness defects.',
    when: (c) => c.method !== 'pigment',
    problems: [
      { problem: 'Uneven / patchy dyeing', cause: 'Fast dyeing, poor circulation, salt/alkali dosed too fast', solution: 'Step-dose salt & alkali, slow heat gradient, levelling agent', remedy: 'Strip & re-dye if severe', formula: 'Reactive: dose salt → 60°C → alkali in 3–4 steps' },
      { problem: 'Rope / crease mark', cause: 'High load, low liquor, heavy fabric in rope form', solution: 'Lower load, run rib/interlock OPEN-WIDTH, anti-crease agent', remedy: 'Re-process flat; calender out light creases' },
      { problem: 'Batch-to-batch shade variation', cause: 'Lab-dip mismatch, yarn lot variation', solution: 'Strict recipe, lot-wise lab-dip, right-first-time', remedy: 'Topping for small correction' },
      { problem: 'Poor wash/rub fastness', cause: 'Unfixed/hydrolysed dye, weak soaping', solution: 'Correct fixation + hot soaping + fixing agent', remedy: 'Re-soap; cationic fixer', formula: 'Test ISO 105-C06 (wash), X12 (rub)' },
      { problem: 'Tonal (side-center / head-tail)', cause: 'Uneven heat/liquor across width', solution: 'Adequate liquor ratio, slow even heating', remedy: 'Open-width dye for wide goods' },
    ],
  },
  {
    key: 'heat_set', name: 'Heat-Setting', cat: 'pre-treatment',
    purpose: 'Stabilise polyester/elastane dimension BEFORE dyeing (190–200°C, 20–40s on stenter). Prevents width-shrink & GSM jump later.',
    when: (c) => c.synthetic || c.lycra,
    problems: [
      { problem: 'Width shrink & GSM jump after dye', cause: 'No pre-heat-set of elastane', solution: 'Heat-set on stenter before dyeing', remedy: 'Re-set; plan width allowance' },
      { problem: 'Yellowing / harsh hand', cause: 'Over-heat (temp/time too high)', solution: 'Optimise 190–195°C, correct dwell', remedy: 'Reduce temp; softener later' },
      { problem: 'Lycra grin / crack', cause: 'Broken/under-fed spandex, wrong draft', solution: 'Correct elastane denier & draft; even feed', remedy: 'Replace spandex package' },
    ],
  },
  {
    key: 'printing', name: 'Printing (Discharge / Pigment AOP)', cat: 'coloration',
    purpose: 'Apply all-over print. Pigment = pad/print-dry-cure on RFD base. Discharge = destroy a dischargeable dyed ground with reducing paste + steam.',
    when: (c) => c.method === 'pigment' || c.method === 'discharge',
    problems: [
      { problem: 'Ground not discharged / dull motif', cause: 'Non-dischargeable reactive ground', solution: 'Use only dischargeable reactive dyes for the ground', remedy: 'Re-select ground recipe' },
      { problem: 'Strength / tear loss', cause: 'Aggressive reducing paste + steam + wash', solution: 'Knit grey 3–5% heavier; mild discharge auxiliaries', remedy: 'Check tear vs buyer min' },
      { problem: 'Pigment crock / poor rub', cause: 'Insufficient binder/curing', solution: 'Correct binder + cure 150–160°C; fixer', remedy: 'Re-cure; cationic softener', formula: 'Cure ~150°C × 3 min; rub ISO 105-X12 ≥ 3-4' },
      { problem: 'Stiff hand (pigment)', cause: 'Excess binder', solution: 'Optimise binder, add hand-builder softener', remedy: 'Silicone softener on stenter' },
    ],
  },
  {
    key: 'stenter', name: 'Stenter (Drying & Width-Set)', cat: 'finishing',
    purpose: 'Master finishing machine — sets WIDTH, GSM, residual shrinkage, skew/bow, applies chemical finish (softener) and dries. Controls most dimensional defects.',
    when: () => true,
    problems: [
      { problem: 'Wrong finished width', cause: 'Pin/clip width set wrong', solution: 'Set width to finished spec; use overfeed for length', remedy: 'Re-stenter to correct width', formula: 'Finish GSM ≈ WetGSM × (WetWidth/FinishWidth) × (1+overfeed%)' },
      { problem: 'Skew / bow (spiral wale line)', cause: 'Weft distortion, single-jersey torque', solution: 'Weft-straightener (anti-skew bowing) + controlled overfeed', remedy: 'Re-straighten; twist-balanced yarn next time' },
      { problem: 'GSM too low', cause: 'Over-stretched width, no overfeed', solution: 'Reduce width, increase overfeed', remedy: 'Compactor recovers some GSM' },
      { problem: 'GSM too high / boardy', cause: 'Excess overfeed', solution: 'Reduce overfeed', remedy: 'Re-process at lower overfeed' },
      { problem: 'Listing (edge-center shade)', cause: 'Uneven chamber temp/airflow', solution: 'Balance nozzle temperature & overfeed across width', remedy: 'Re-dry evenly' },
    ],
  },
  {
    key: 'compacting', name: 'Compacting (Tubular / Open-width)', cat: 'finishing',
    purpose: 'Mechanically pre-shrink LENGTH and set final GSM, hand and shrinkage. The machine that delivers shrinkage-to-spec and locks residual torque.',
    when: () => true,
    problems: [
      { problem: 'High wash shrinkage (AATCC 135 fail)', cause: 'Under-compacted, length not pre-shrunk', solution: 'Increase compaction % to bring length residual to ≤ ±3%', remedy: 'Re-compact', formula: 'Residual length shrink target ≤ buyer spec (±3 to ±5%)' },
      { problem: 'GSM too high / stiff after compact', cause: 'Over-compaction', solution: 'Reduce compaction overfeed', remedy: 'Light re-stenter to relax' },
      { problem: 'Residual spirality', cause: 'Torque not locked', solution: 'Compactor sets wale line after stenter anti-skew', remedy: 'Combine stenter overfeed + compaction' },
    ],
  },
  {
    key: 'raising', name: 'Brushing / Raising', cat: 'finishing',
    purpose: 'Raise surface fibres → soft fleece pile or peach hand. Fleece/terry/peach only.',
    when: (c) => c.fam === 'fleece' || c.fam === 'terry' || c.brush || c.peach,
    problems: [
      { problem: 'Uneven pile / direction streak', cause: 'Worn wire rollers, uneven tension', solution: 'Calibrate raising rollers, multi-pass low intensity, even direction', remedy: 'Re-raise lightly' },
      { problem: 'Pile shedding', cause: 'Loose low-twist loop yarn over-raised', solution: 'Optimise loop yarn twist; gentle raise', remedy: 'Reduce passes' },
      { problem: 'Hole / strength loss', cause: 'Over-raising tears ground', solution: 'Lower intensity, control tension', remedy: 'Limit grey strength loss' },
    ],
  },
  {
    key: 'calendering', name: 'Calendering', cat: 'finishing',
    purpose: 'Smooth/flatten surface, lustre, set pique/lacoste cells, control thickness. Avoid on raised fleece (crushes pile).',
    when: (c) => c.fam === 'pique' || c.fam === 'interlock' || c.calender,
    problems: [
      { problem: 'Crushed pile / glazing', cause: 'Over-pressure or over-heat', solution: 'Correct roller pressure/temp/speed; skip on fleece', remedy: 'Re-raise if pile crushed' },
      { problem: 'Calender mark', cause: 'Roller defect or fabric fold', solution: 'Clean rollers, feed flat & even', remedy: 'Re-process flat' },
    ],
  },
  {
    key: 'topping', name: 'Topping (Shade Correction)', cat: 'finishing',
    purpose: 'Small final shade adjustment (top-up dye) or surface effect when the dyed shade is slightly off lab-dip.',
    when: (c) => c.method !== 'pigment',
    problems: [
      { problem: 'Poor fastness after topping', cause: 'Surface-deposited top dye, unfixed', solution: 'Minimal top dye + fixing agent', remedy: 'Check rub fastness ISO 105-X12' },
      { problem: 'Patchy topping', cause: 'Uneven application', solution: 'Even pad/exhaust topping, low conc.', remedy: 'Strip if severe' },
    ],
  },
];

// ============================================================
// 5. FABRIC-STRUCTURE ISSUES (structure-specific, not machine)
// ============================================================
const STRUCTURE_ISSUES = {
  single_jersey: [
    { problem: 'Spirality / skew', cause: 'Single-yarn residual torque (twist liveliness)', solution: 'Twist-balanced/ply yarn + stenter anti-skew + compactor', remedy: 'Acceptance skew ≤ 5%' },
    { problem: 'Edge curling', cause: 'Single-bed loop torque', solution: 'Pre-set & slit straight; cannot fully remove', remedy: 'Plan cutting allowance' },
  ],
  rib: [
    { problem: 'Width pull-in (too narrow)', cause: 'Elastic widthwise contraction (rib relaxes most)', solution: 'Open-width process + stenter width set + correct dia', remedy: 'WPC relax factor ~1.40' },
    { problem: 'Listing edge-center', cause: 'Uneven liquor/heat in rope', solution: 'Open-width dyeing', remedy: 'Slit before stenter' },
  ],
  interlock: [
    { problem: 'Crack / rope mark', cause: 'Heavy double-bed run in rope', solution: 'Open-width, lower load', remedy: 'Calender light creases' },
  ],
  pique: [
    { problem: 'Cell distortion', cause: 'Over-tension on stenter', solution: 'Low overfeed, gentle calender', remedy: 'Set cells before width' },
  ],
  fleece: [
    { problem: 'Uneven pile / shedding', cause: 'Raising roller wear, loose loop twist', solution: 'Calibrate raising, optimise loop twist', remedy: 'Knit grey 4–6% heavier (high loss)' },
  ],
  terry: [
    { problem: 'Loop snag / uneven loop', cause: 'Loop yarn tension variation', solution: 'Even loop sinker timing; gentle finish', remedy: 'Inspect loop uniformity' },
  ],
  waffle: [
    { problem: 'Texture flattening', cause: 'Over-calender/over-compact', solution: 'Gentle finishing, preserve relief', remedy: 'Low pressure set' },
  ],
  heavy_jersey: [
    { problem: 'Rope crease (heavy)', cause: 'Heavy fabric in rope dyeing', solution: 'Open-width, lower load', remedy: 'Anti-crease agent' },
  ],
};

// ============================================================
// 6. COLOUR / CHEMICAL ISSUES BY SHADE
// ============================================================
const COLOUR_CHEMICAL = {
  dark: [
    { issue: 'Bronzing / poor rub fastness', cause: 'High dye conc + salt/alkali → surface unfixed dye', solution: 'Heavy hot soaping + cationic fixing agent + softener', impact: 'Crocking, GSM gain, harsh hand' },
    { issue: 'Unlevel at start of build', cause: 'Fast strike of dark reactive', solution: 'Levelling agent, slow alkali dosing', impact: 'Patchiness' },
  ],
  medium: [
    { issue: 'Reproducibility (turquoise/bright)', cause: 'Turquoise reactive low fixation, temp/pH sensitive', solution: 'Tight temp/pH control, dedicated recipe', impact: 'Tonal, batch variation' },
    { issue: 'Red/magenta bleeding', cause: 'Metal-complex sensitivity', solution: 'Sequestrant + thorough wash-off', impact: 'Cross-stain in wash' },
  ],
  light: [
    { issue: 'Tippy / unlevel shows easily', cause: 'Low dye conc magnifies unevenness on slub/uneven yarn', solution: 'Strong levelling agent, slow dyeing', impact: 'Patchy pastel' },
  ],
  white: [
    { issue: 'Catalytic pinhole / yellowing', cause: 'Over-bleach H₂O₂ + water hardness/iron', solution: 'Stabiliser + sequestrant, soft water, controlled peroxide + killer', impact: 'Pinhole, strength loss' },
  ],
};

// ============================================================
// 7. PROCESS ROUTE (ordered machine sequence) BY METHOD
// ============================================================
function processRoute(method, ctx) {
  const m = normMethod(method);
  const seq = ['Grey inspection', 'Scouring'];
  if (ctx.singe) seq.push('Singeing');
  if (ctx.shade === 'white' || ctx.shade === 'light' || m === 'pigment' || m === 'discharge') seq.push('Bleaching');
  if (ctx.combed && ctx.cottonRich) seq.push('Mercerizing (optional, premium)');
  if (ctx.synthetic || ctx.lycra) seq.push('Heat-Setting (190–195°C)');
  if (m === 'pigment') {
    seq.push('Pigment Print (pad/print)', 'Dry-Cure (150–160°C)');
  } else if (m === 'discharge') {
    seq.push('Dye dischargeable ground', 'Discharge Print', 'Steam', 'Wash-off');
  } else {
    seq.push(m === 'disperse' ? 'Disperse Dye (HT 130°C)' : 'Reactive Dye (exhaust)', 'Soaping / Wash-off');
    if (m === 'disperse') seq.push('Reduction Clearing');
  }
  if (ctx.fam === 'fleece' || ctx.fam === 'terry' || ctx.brush) seq.push('Brushing / Raising');
  seq.push('Hydro-extract / Dry (Stenter + softener + anti-skew)');
  seq.push('Compacting (shrinkage-to-spec)');
  if (ctx.fam === 'pique' || ctx.fam === 'interlock' || ctx.calender) seq.push('Calendering');
  if (m === 'garment_wash') seq.push('→ Garment make → Garment Wash (enzyme/stone/acid)');
  return seq;
}

// ============================================================
// 8. ORCHESTRATOR
// ============================================================
/**
 * @param {object} args
 * @param {string} args.fabric            fabric id
 * @param {string} args.category          fabric category
 * @param {number} args.finish_gsm
 * @param {string} [args.shade]           dark|medium|light|white
 * @param {string} [args.dyeing_method]   reactive|disperse|pigment|discharge|garment_wash
 * @param {object} [args.fibers]          { cotton, polyester, viscose, modal, elastane, ... }
 * @param {string} [args.spinning]        combed|carded|...
 * @param {string[]} [args.processes]     extra processes: aop, garment_wash, brush, peach, singe
 */
function analyzeWetProcessing(args) {
  const {
    fabric, category, finish_gsm, shade, dyeing_method,
    fibers = { cotton: 100 }, spinning, processes = [],
  } = args || {};
  if (!finish_gsm || finish_gsm <= 0) return { ok: false, reason: 'finish_gsm_required' };

  // Fabric ID is more specific than category (fleece/terry/pique are single-bed
  // so their category is 'single_jersey'); prefer the id when it names a structure.
  const famFromId = familyOf(fabric);
  const fam = famFromId !== 'single_jersey' ? famFromId : familyOf(category);
  const sh = normShade(shade);
  const me = normMethod(dyeing_method);

  // Build a relevance context for stage/structure filtering.
  const ctx = {
    fam, shade: sh, method: me,
    combed: /comb|compact/.test(spinning || ''),
    cottonRich: (fibers.cotton || 0) >= 60,
    cvc: (fibers.polyester || 0) >= 15 && (fibers.cotton || 0) >= 50,
    synthetic: (fibers.polyester || 0) >= 30,
    lycra: (fibers.elastane || fibers.spandex || fibers.lycra || 0) > 0,
    brush: processes.includes('brush') || fam === 'fleece',
    peach: processes.includes('peach'),
    singe: processes.includes('singe') || me === 'pigment' || me === 'discharge',
    calender: processes.includes('calender'),
  };

  // Greige GSM (headline) + all-shades table.
  const greige = greigeGsmTarget(finish_gsm, category, sh, me);
  const greige_all_shades = greigeGsmAllShades(finish_gsm, category, me);

  // Process loss (reuse bulk-file model).
  const lossProcesses = [];
  if (me === 'discharge' || processes.includes('aop')) lossProcesses.push('aop');
  if (me === 'garment_wash') lossProcesses.push('garment_wash');
  if (ctx.brush) lossProcesses.push('brush');
  if (ctx.peach) lossProcesses.push('peach');
  if (ctx.singe) lossProcesses.push('singe');
  const process_loss = estimateProcessLoss(sh === 'white' ? 'light' : sh, lossProcesses);

  // Machine-wise critical path filtered to relevance.
  const machine_path = MACHINE_STAGES
    .filter(s => { try { return s.when(ctx); } catch { return false; } })
    .map(s => ({
      stage: s.key, name: s.name, category: s.cat, purpose: s.purpose,
      issues: s.problems,
    }));

  // Fabric-structure & colour-chemical issues.
  const structure_issues = STRUCTURE_ISSUES[fam] || [];
  const colour_issues = COLOUR_CHEMICAL[sh] || [];

  const route = processRoute(me, ctx);

  return {
    ok: true,
    fabric, fabric_family: fam, shade: sh, dyeing_method: me,
    greige,
    greige_all_shades,
    process_loss,
    process_route: route,
    machine_critical_path: machine_path,
    fabric_structure_issues: structure_issues,
    colour_chemical_issues: colour_issues,
    summary: `${fam.replace('_', ' ')} · ${me.replace('_', ' ')} · ${sh}: knit GREY ~${greige.grey_gsm_target} g/m² (range ${greige.grey_gsm_range[0]}–${greige.grey_gsm_range[1]}) to deliver ${finish_gsm} g/m² finished. ${machine_path.length} machine stages on the critical path; process loss ~${process_loss.loss_pct}%.`,
    source: 'Wet-processing critical-path model — calibrated to factory grey→finish R&D (shrinkage/dye gain) + Knitting Master File (process loss).',
  };
}

module.exports = {
  analyzeWetProcessing,
  greigeGsmTarget,
  greigeGsmAllShades,
  familyOf,
  AREA_SHRINK,
  DYE_ADDON,
  MACHINE_STAGES,
};
