/**
 * KnitAdvisor — Yarn chemistry engine: what a yarn is made of, chemically, and what the wet route does to it.
 *
 * Built for the Fabric Studio. Give the fibres of a yarn (any blend, label %), its count and the shade it is going to take;
 * it works out, from the fibres:
 *
 *   1  FIBRES & CLASSES   what each fibre is chemically, the dye class it takes, the conditions, the dye-rate differences
 *                         between the fibres (the blend's dyeing problem)
 *   2  DYEING ROUTE       the ordered wet route the blend needs (scour, bleach, mercerise, dye in the order the chemistry
 *                         allows, reduction clear, soap, bio-polish, heat-set), each step with temperature, pH, time and
 *                         chemicals; one bath or two, and why
 *   3  RECIPE             dye (% owf by fibre, with the fineness correction), salt, alkali, acid, auxiliaries — in kg per
 *                         100 kg of yarn and g/L — and what is unfixed and goes to the effluent. Amounts only, no money
 *   4  RESISTANCE         how each fibre stands to acids, alkalis, bleaches, reducing agents, solvents, enzymes, light and
 *                         mildew, and which fibre of the blend governs each
 *   5  STRENGTH           what the route does to the yarn: each fibre's retention through each step, run through the blend
 *                         yarn engine, so the yarn's tenacity and elongation AFTER the route come from the fibres' own curves
 *   6  FASTNESS           the wash, rubbing, light and perspiration grades the dye classes give at this depth, the blend's
 *                         governing grade, and the risks (staining, thermomigration, wet-rub)
 *   7  MOISTURE & LIQUOR  regain, swelling, the water a yarn carries out of the bath, boil-off shrinkage
 *   8  WHITENING          optical brightening and yellowing, for a white or pastel
 *   9  SHADE SWEEP        the recipe at every depth, so the depth can be chosen, not guessed
 *  10  DERIVATIONS        the working behind every figure
 *
 * Every figure carries its basis (the convention of materials.js, the melange and the blend engines):
 *   measured   a published fibre-property table value        law       worked out by arithmetic or physics
 *   blend      measured fibre values combined by the law that applies   typical   an industry default; the test that
 *   estimate   a model not yet calibrated on the mill's own result                 replaces it is named
 *   calibrated the model fitted on the mill's own measurement
 *
 * Dye-class conditions are the dyeing-theory layer's (dyeing-theory-engine.js). Resistance ratings, retention factors, depth
 * tables and fastness grades are typical wet-processing knowledge, stated as typical, to be replaced by the mill's own
 * recipes and lab results. No outside source is named in what this returns.
 */
'use strict';

const Y = require('./yarn-engine');
const BY = require('./blend-yarn-engine');
const THEORY = require('./dyeing-theory-engine');

class ChemError extends Error {}
const FP = Y.FIBER_PROPERTIES;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rd = (v, d) => (v == null || Number.isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
const r1 = (v) => rd(v, 1), r2 = (v) => rd(v, 2), r3 = (v) => rd(v, 3);
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const V = (value, unit, basis, extra) => (value == null || Number.isNaN(value) ? null : { value, unit, basis, ...(extra || {}) });

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FIBRES: what they are, chemically
// ═════════════════════════════════════════════════════════════════════════════════════════════
// family · primary dye class · alternatives · reference fineness (dtex, for the shade-depth correction) · a depth factor
// (how much dye the fibre needs for the same apparent depth against cotton: viscose takes more of what it is given) ·
// the table row the regain and strength come from · the blend engine's id for the strength model (null = not modelled there)
const FIB = {
  cotton:    { label: 'Cotton',            family: 'cellulosic', polymer: 'cellulose I (native)',   primary: 'reactive', alt: ['direct', 'vat', 'sulphur'], dtex: 1.65, depth: 1.00, tbl: 'cotton', by: 'cotton' },
  linen:     { label: 'Linen',             family: 'cellulosic', polymer: 'cellulose I with lignin and pectin', primary: 'reactive', alt: ['direct', 'vat', 'sulphur'], dtex: 15, depth: 1.10, tbl: 'linen', by: null },
  viscose:   { label: 'Viscose',           family: 'cellulosic', polymer: 'regenerated cellulose II', primary: 'reactive', alt: ['direct', 'vat', 'sulphur'], dtex: 1.30, depth: 0.85, tbl: 'viscose', by: 'viscose' },
  modal:     { label: 'Modal',             family: 'cellulosic', polymer: 'regenerated cellulose II (high wet modulus)', primary: 'reactive', alt: ['direct', 'vat'], dtex: 1.00, depth: 0.90, tbl: 'modal', by: 'modal' },
  tencel:    { label: 'Lyocell (Tencel)', family: 'cellulosic', polymer: 'solvent-spun cellulose II', primary: 'reactive', alt: ['direct'], dtex: 1.30, depth: 0.90, tbl: 'tencel', by: 'tencel' },
  bamboo:    { label: 'Bamboo viscose',    family: 'cellulosic', polymer: 'regenerated cellulose II', primary: 'reactive', alt: ['direct'], dtex: 1.30, depth: 0.85, tbl: 'bamboo', by: 'bamboo' },
  polyester: { label: 'Polyester',         family: 'polyester', polymer: 'poly(ethylene terephthalate)', primary: 'disperse', alt: [], dtex: 1.33, depth: 1.00, tbl: 'polyester', by: 'polyester' },
  cdp:       { label: 'Cationic-dyeable polyester', family: 'polyester', polymer: 'PET with sulphonate groups', primary: 'cationic', alt: ['disperse'], dtex: 1.33, depth: 1.00, tbl: 'polyester', by: 'polyester' },
  nylon:     { label: 'Nylon',             family: 'polyamide', polymer: 'polyamide 6 / 6.6', primary: 'acid', alt: ['disperse'], dtex: 1.70, depth: 1.00, tbl: 'nylon', by: 'nylon' },
  acrylic:   { label: 'Acrylic',           family: 'acrylic', polymer: 'polyacrylonitrile copolymer', primary: 'cationic', alt: [], dtex: 1.70, depth: 1.00, tbl: 'acrylic', by: 'acrylic' },
  wool:      { label: 'Wool',              family: 'protein', polymer: 'keratin', primary: 'acid', alt: ['reactive'], dtex: 4.10, depth: 1.00, tbl: 'wool', by: 'wool' },
  silk:      { label: 'Silk',              family: 'protein', polymer: 'fibroin', primary: 'acid', alt: ['reactive'], dtex: 1.10, depth: 1.00, tbl: 'silk', by: null },
  elastane:  { label: 'Elastane',          family: 'elastane', polymer: 'segmented polyurethane-urea', primary: 'disperse', alt: ['acid'], dtex: 0, depth: 1.00, tbl: 'elastane', by: null, rides: true },
};
const FIBRE_IDS = Object.keys(FIB);
const THEORY_KEY = { reactive: 'reactive', disperse: 'disperse', acid: 'acid', cationic: 'basic_cationic', direct: 'direct', vat: 'vat', sulphur: 'sulphur' };
const CLASS_LABEL = { reactive: 'Reactive', disperse: 'Disperse', acid: 'Acid', cationic: 'Cationic (basic)', direct: 'Direct', vat: 'Vat', sulphur: 'Sulphur' };

const regainOf = (f) => { const t = FP[FIB[f].tbl]; if (!t) return 0; const c = t.regain_detail && t.regain_detail.commercial; return c != null ? c : (Array.isArray(t.regain) ? (t.regain[0] + t.regain[1]) / 2 : t.regain); };
const densityOf = (f) => (FP[FIB[f].tbl] && FP[FIB[f].tbl].density) || 1.4;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// DYE CLASSES: numbers (conditions in words come from the dyeing-theory layer)
// ═════════════════════════════════════════════════════════════════════════════════════════════
const DEPTHS = ['white', 'pastel', 'light', 'medium', 'dark', 'black'];
const DEPTH_LABEL = { white: 'White / optical white', pastel: 'Pastel', light: 'Light', medium: 'Medium', dark: 'Dark', black: 'Black / navy' };
// nominal dye on the weight of fibre (% owf) by depth, for a fibre of its usual fineness
const OWF = {
  reactive: [0, 0.2, 0.8, 2.5, 4.5, 7.5], disperse: [0, 0.1, 0.5, 1.5, 3.5, 6.0], acid: [0, 0.2, 0.8, 2.0, 3.5, 5.0], cationic: [0, 0.1, 0.4, 1.0, 2.0, 3.0],
  direct: [0, 0.3, 1.0, 3.0, 5.0, 8.0], vat: [0, 0.3, 1.0, 2.5, 4.5, 6.0], sulphur: [0, 0.5, 1.5, 4.0, 7.0, 10.0],
};
// the bath: temperature (°C), pH, time at temperature (min), the fixation (share of the dye that ends in the fibre) by depth
const BATH = {
  reactive: { t: 60, ph: 11, time: 60, fix: [0, 80, 80, 76, 72, 68] },
  disperse: { t: 130, ph: 5, time: 45, fix: [0, 95, 94, 92, 90, 88] },
  acid:     { t: 98, ph: 5, time: 50, fix: [0, 96, 95, 93, 91, 88] },
  cationic: { t: 98, ph: 4.5, time: 50, fix: [0, 99, 99, 98, 97, 96] },
  direct:   { t: 95, ph: 8, time: 50, fix: [0, 75, 72, 70, 66, 62] },
  vat:      { t: 55, ph: 13, time: 40, fix: [0, 90, 90, 88, 86, 84] },
  sulphur:  { t: 90, ph: 11, time: 50, fix: [0, 80, 78, 75, 72, 70] },
};
// the chemicals of the bath (g/L) by depth [white, pastel, light, medium, dark, black]; null = not used at that depth
const CHEM = {
  reactive: [
    { name: 'Salt (NaCl or Glauber\'s)', g: [0, 20, 30, 50, 70, 80], role: 'drives the dye onto the fibre' },
    { name: 'Soda ash', g: [0, 5, 10, 15, 20, 20], role: 'raises the pH so the dye reacts with the cellulose' },
    { name: 'Sequestering agent', g: [0, 1, 1, 1, 1, 1], role: 'ties up hardness and metals' },
    { name: 'Levelling / wetting agent', g: [0, 0.5, 0.5, 0.5, 1, 1], role: 'even uptake' },
  ],
  disperse: [
    { name: 'Acetic acid', g: [0, 0.5, 0.5, 0.8, 1, 1], role: 'holds the pH at 4.5–5.5' },
    { name: 'Dispersing / levelling agent', g: [0, 1, 1, 1, 1.5, 1.5], role: 'keeps the dye dispersed and the uptake even' },
    { name: 'Sequestering agent', g: [0, 0.5, 0.5, 0.5, 0.5, 0.5], role: 'ties up hardness and metals' },
  ],
  acid: [
    { name: 'Acetic or formic acid', g: [0, 1, 1, 1.5, 2, 2], role: 'protonates the fibre so it takes the anionic dye' },
    { name: 'Levelling agent', g: [0, 1, 1, 1, 1.5, 1.5], role: 'slows the first rush of dye' },
    { name: 'Sodium acetate / ammonium sulphate', g: [0, 0.5, 0.5, 1, 1, 1], role: 'buffers the pH' },
  ],
  cationic: [
    { name: 'Acetic acid', g: [0, 0.5, 0.5, 1, 1, 1], role: 'holds the pH at 4–5.5' },
    { name: 'Retarder (cationic)', g: [0, 1, 1, 1, 1.5, 1.5], role: 'slows uptake: cationic dye strikes fast and uneven' },
    { name: 'Sodium acetate', g: [0, 0.5, 0.5, 0.5, 0.5, 0.5], role: 'buffers the pH' },
  ],
  direct: [{ name: 'Salt', g: [0, 5, 10, 15, 20, 25], role: 'exhausts the dye' }, { name: 'Soda ash', g: [0, 1, 1, 2, 2, 2], role: 'mild alkali' }],
  vat: [{ name: 'Caustic soda', g: [0, 4, 6, 8, 10, 12], role: 'dissolves the reduced dye' }, { name: 'Sodium hydrosulphite', g: [0, 3, 4, 6, 8, 10], role: 'reduces the dye to its soluble leuco form' }],
  sulphur: [{ name: 'Sodium sulphide', g: [0, 4, 6, 8, 10, 12], role: 'reduces and dissolves the dye' }, { name: 'Soda ash', g: [0, 3, 4, 5, 6, 6], role: 'alkali' }],
};
// fastness grades (1–5) typical for the class by depth: [lo, hi]
const FAST = {
  reactive: { wash: [[4, 5], [4, 5], [4, 5], [4, 5], [4, 5], [4, 5]], stain: [[4, 5], [4, 5], [4, 5], [3, 4], [3, 4], [3, 4]], rub_dry: [[4, 5], [4, 5], [4, 5], [4, 5], [3, 4], [3, 4]], rub_wet: [[4, 5], [4, 5], [3, 4], [3, 4], [2, 3], [2, 3]], light: [[3, 4], [4, 5], [4, 5], [4, 5], [3, 4], [3, 4]], sweat: [[4, 5], [4, 5], [4, 5], [4], [3, 4], [3, 4]] },
  disperse: { wash: [[4, 5], [4, 5], [4, 5], [4, 5], [4, 5], [4, 5]], stain: [[4, 5], [4, 5], [4], [3, 4], [3, 4], [3]], rub_dry: [[4, 5], [4, 5], [4, 5], [4, 5], [4, 5], [4]], rub_wet: [[4, 5], [4, 5], [4, 5], [4], [4], [3, 4]], light: [[3, 4], [4], [4, 5], [4, 5], [5], [5]], sweat: [[4, 5], [4, 5], [4, 5], [4, 5], [4], [4]] },
  acid: { wash: [[3, 4], [3, 4], [3, 4], [3, 4], [3, 4], [3, 4]], stain: [[3, 4], [3, 4], [3, 4], [3], [3], [2, 3]], rub_dry: [[4, 5], [4, 5], [4], [4], [4], [3, 4]], rub_wet: [[4], [4], [3, 4], [3, 4], [3], [2, 3]], light: [[3, 4], [4], [4, 5], [4, 5], [4, 5], [4]], sweat: [[3, 4], [3, 4], [3, 4], [3, 4], [3], [3]] },
  cationic: { wash: [[4, 5], [4, 5], [4, 5], [4, 5], [4, 5], [4, 5]], stain: [[4, 5], [4, 5], [4], [4], [3, 4], [3, 4]], rub_dry: [[4, 5], [4, 5], [4, 5], [4], [4], [4]], rub_wet: [[4], [4], [4], [3, 4], [3, 4], [3]], light: [[4, 5], [5, 6], [5, 6], [5, 6], [5], [5]], sweat: [[4, 5], [4, 5], [4, 5], [4, 5], [4], [4]] },
  direct: { wash: [[2, 3], [2, 3], [2, 3], [2], [2], [2]], stain: [[2, 3], [2, 3], [2], [2], [2], [2]], rub_dry: [[4], [4], [4], [3, 4], [3, 4], [3]], rub_wet: [[3], [3], [2, 3], [2, 3], [2], [2]], light: [[3], [3, 4], [3, 4], [3], [3], [3]], sweat: [[3], [3], [3], [3], [2, 3], [2, 3]] },
  vat: { wash: [[5], [5], [5], [5], [5], [5]], stain: [[5], [5], [4, 5], [4, 5], [4], [4]], rub_dry: [[5], [5], [4, 5], [4, 5], [4], [4]], rub_wet: [[4, 5], [4, 5], [4], [3, 4], [3, 4], [3]], light: [[6], [6], [6], [6], [6, 7], [6, 7]], sweat: [[5], [5], [5], [4, 5], [4, 5], [4]] },
  sulphur: { wash: [[3, 4], [3, 4], [3, 4], [3, 4], [3, 4], [3, 4]], stain: [[3, 4], [3, 4], [3, 4], [3], [3], [3]], rub_dry: [[4], [4], [4], [3, 4], [3, 4], [3]], rub_wet: [[3], [3], [3], [2, 3], [2, 3], [2]], light: [[4, 5], [4, 5], [4, 5], [4, 5], [4, 5], [4, 5]], sweat: [[4], [4], [4], [3, 4], [3, 4], [3]] },
};
const FAST_KEYS = [['wash', 'Wash (colour change)'], ['stain', 'Wash (staining)'], ['rub_dry', 'Rubbing, dry'], ['rub_wet', 'Rubbing, wet'], ['light', 'Light'], ['sweat', 'Perspiration']];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// RESISTANCE (0 destroyed … 4 resistant), typical wet-processing knowledge; the light order is the tables' (Table 13.8)
// ═════════════════════════════════════════════════════════════════════════════════════════════
const AGENTS = [
  { id: 'acid_dilute', label: 'Dilute acid (pH 4–5, hot)' }, { id: 'acid_strong', label: 'Strong mineral acid' },
  { id: 'alkali_dilute', label: 'Dilute alkali (soda ash, pH 11, 60–95 °C)' }, { id: 'alkali_strong', label: 'Strong alkali (caustic, hot or concentrated)' },
  { id: 'hypochlorite', label: 'Hypochlorite / chlorine bleach' }, { id: 'peroxide', label: 'Hydrogen peroxide (alkaline, 90 °C)' },
  { id: 'reducing', label: 'Reducing agents (hydrosulphite)' }, { id: 'solvent', label: 'Dry-cleaning solvents' },
  { id: 'cellulase', label: 'Cellulase (bio-polish)' }, { id: 'light', label: 'Sunlight (UV)' }, { id: 'mildew', label: 'Mildew and rot' },
];
const RES = {
  cotton:    [3, 0, 4, 3, 2, 3, 4, 4, 0, 2, 1], linen: [3, 0, 4, 3, 2, 3, 4, 4, 0, 2, 1],
  viscose:   [2, 0, 3, 1, 2, 3, 4, 4, 0, 2, 1], modal: [2, 0, 3, 2, 2, 3, 4, 4, 0, 2, 1], tencel: [2, 0, 3, 2, 2, 3, 4, 4, 1, 2, 1], bamboo: [2, 0, 3, 1, 2, 3, 4, 4, 0, 2, 1],
  polyester: [4, 3, 3, 1, 4, 4, 3, 3, 4, 3, 4], cdp: [4, 3, 2, 1, 4, 4, 3, 3, 4, 3, 4],
  nylon:     [2, 0, 3, 2, 1, 2, 3, 4, 4, 1, 4], acrylic: [4, 3, 3, 1, 3, 3, 3, 3, 4, 4, 4],
  wool:      [4, 2, 1, 0, 0, 2, 2, 3, 4, 1, 2], silk: [3, 1, 2, 0, 0, 2, 3, 4, 4, 0, 2],
  elastane:  [3, 2, 3, 2, 0, 2, 3, 2, 4, 2, 4],
};
const RES_NOTE = {
  acid_strong: 'Cellulose is hydrolysed (tender cloth after drying); nylon dissolves in concentrated acid; polyester, acrylic and wool stand it.',
  alkali_strong: 'Swells and, under tension, strengthens cotton (mercerising); eats polyester\'s surface (weight loss) and destroys wool and silk.',
  hypochlorite: 'Chlorine damages nylon, wool, silk and elastane badly (yellowing, strength loss): never on a blend that has them.',
  peroxide: 'The safe bleach for cellulose and polyester; wool and elastane need it milder.',
  light: 'From the tables\' own order: acrylic best, then polyester, then nylon, viscose and cotton alike, silk worst.',
  cellulase: 'Cuts the hairs of cellulosic fibres (bio-polish). It does nothing to polyester, nylon or acrylic, so their pills stay.',
  reducing: 'Hydrosulphite with caustic clears surplus disperse dye; hot, it can weaken wool, silk and viscose.',
};
const RATING_WORD = ['destroyed', 'poor', 'fair, with care', 'good', 'resistant'];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE WET ROUTE'S STEPS and what each does to a fibre's strength (retention, typical)
// ═════════════════════════════════════════════════════════════════════════════════════════════
const PROC = {
  scour:     { label: 'Scouring', t: 95, ph: 10.5, time: 30, chem: [['Caustic soda or soda ash', 2], ['Detergent / wetting agent', 1], ['Sequestering agent', 1]], why: 'removes wax, oil, size and dirt so the dye gets in evenly', ret: { cotton: 0.98, linen: 0.97, viscose: 0.95, modal: 0.96, tencel: 0.95, bamboo: 0.95, polyester: 0.995, cdp: 0.99, nylon: 0.99, acrylic: 0.98, wool: 0.85, silk: 0.9, elastane: 0.98 } },
  bleach:    { label: 'Peroxide bleaching', t: 95, ph: 10.8, time: 45, chem: [['Hydrogen peroxide (50 %)', 4], ['Caustic soda', 1.5], ['Peroxide stabiliser', 1], ['Sequestering agent', 1]], why: 'removes the natural colour and the seed-coat; a white ground for pastels and whites', ret: { cotton: 0.95, linen: 0.93, viscose: 0.93, modal: 0.94, tencel: 0.94, bamboo: 0.93, polyester: 1, cdp: 1, nylon: 0.97, acrylic: 0.98, wool: 0.9, silk: 0.9, elastane: 0.95 } },
  mercerise: { label: 'Mercerising', t: 20, ph: 14, time: 1, chem: [['Caustic soda (24–28 °Bé)', 270]], why: 'swells the cotton round under tension: more lustre, dye uptake and strength', ret: { cotton: 1.08, linen: 1.05, viscose: 0.85, modal: 0.9, tencel: 0.9, bamboo: 0.85, polyester: 1, cdp: 1, nylon: 1, acrylic: 0.97, wool: 0.4, silk: 0.4, elastane: 0.9 } },
  dye_reactive: { label: 'Reactive dyeing', t: 60, ph: 11, time: 60, ret: { cotton: 0.97, linen: 0.97, viscose: 0.95, modal: 0.96, tencel: 0.95, bamboo: 0.95, polyester: 1, cdp: 1, nylon: 0.99, acrylic: 0.99, wool: 0.95, silk: 0.95, elastane: 0.99 } },
  dye_disperse: { label: 'Disperse dyeing', t: 130, ph: 5, time: 45, ret: { cotton: 0.96, linen: 0.95, viscose: 0.93, modal: 0.94, tencel: 0.94, bamboo: 0.93, polyester: 0.97, cdp: 0.97, nylon: 0.95, acrylic: 0.85, wool: 0.7, silk: 0.7, elastane: 0.85 } },
  dye_acid:  { label: 'Acid dyeing', t: 98, ph: 5, time: 50, ret: { cotton: 0.99, viscose: 0.98, modal: 0.98, tencel: 0.98, bamboo: 0.98, polyester: 1, cdp: 1, nylon: 0.97, acrylic: 1, wool: 0.95, silk: 0.95, elastane: 0.97, linen: 0.99 } },
  dye_cationic: { label: 'Cationic dyeing', t: 98, ph: 4.5, time: 50, ret: { cotton: 0.99, viscose: 0.98, modal: 0.98, tencel: 0.98, bamboo: 0.98, polyester: 1, cdp: 0.98, nylon: 1, acrylic: 0.98, wool: 0.95, silk: 0.95, elastane: 0.97, linen: 0.99 } },
  reduction_clear: { label: 'Reduction clearing', t: 75, ph: 12, time: 20, chem: [['Sodium hydrosulphite', 2], ['Caustic soda', 2]], why: 'strips the disperse dye left on the surface and on the cotton: the wash and rubbing fastness of a polyester blend depends on it', ret: { cotton: 0.99, linen: 0.99, viscose: 0.96, modal: 0.97, tencel: 0.97, bamboo: 0.96, polyester: 0.99, cdp: 0.99, nylon: 0.98, acrylic: 0.98, wool: 0.8, silk: 0.85, elastane: 0.95 } },
  soap:      { label: 'Soaping and rinsing', t: 95, ph: 7, time: 15, chem: [['Soaping agent', 1]], why: 'washes off hydrolysed and unfixed dye: the reactive dyeing\'s rubbing fastness', ret: { cotton: 1, linen: 1, viscose: 0.99, modal: 1, tencel: 1, bamboo: 0.99, polyester: 1, cdp: 1, nylon: 1, acrylic: 1, wool: 0.98, silk: 0.98, elastane: 1 } },
  biopolish: { label: 'Bio-polishing', t: 55, ph: 5, time: 40, chem: [['Cellulase (acid)', 1], ['Acetic acid', 0.5]], why: 'cuts the surface hairs of the cellulosic fibres: a smooth face, less pilling', ret: { cotton: 0.96, linen: 0.95, viscose: 0.9, modal: 0.92, tencel: 0.88, bamboo: 0.9, polyester: 1, cdp: 1, nylon: 1, acrylic: 1, wool: 1, silk: 1, elastane: 1 } },
  heatset:   { label: 'Heat-setting', t: 190, ph: null, time: 0.6, chem: [], why: 'fixes the width and shape of the polyester and elastane; done before dyeing, it stops creasing and unlevel dyeing', ret: { cotton: 0.92, linen: 0.9, viscose: 0.9, modal: 0.9, tencel: 0.9, bamboo: 0.9, polyester: 1, cdp: 1, nylon: 0.95, acrylic: 0.85, wool: 0.6, silk: 0.7, elastane: 0.9 } },
  oba:       { label: 'Optical brightening', t: 60, ph: 8.5, time: 20, chem: [['Optical brightener', 0.8]], why: 'a fluorescent whitener: the cellulosic and the polyester each need their own type, matched in tone', ret: {} },
  soften:    { label: 'Softening', t: 40, ph: 5.5, time: 20, chem: [['Cationic or silicone softener', 2.5]], why: 'handle and lubricity; a finish for the knitting and for the wearer', ret: {} },
};
// boil-off shrinkage of the yarn, % (typical)
const BOILOFF = { cotton: 2.5, linen: 2, viscose: 3, modal: 2.5, tencel: 2, bamboo: 3, polyester: 3, cdp: 3, nylon: 6, acrylic: 2, wool: 5, silk: 2, elastane: 0 };
// a filament yarn shrinks more in the bath than a staple yarn of the same polymer (typical)
const FILAMENT_BOILOFF = { polyester: 7, cdp: 7, nylon: 9 };

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INPUT
// ═════════════════════════════════════════════════════════════════════════════════════════════
function readFibres(input) {
  let map = null;
  if (input.fibres && typeof input.fibres === 'object') map = input.fibres;
  else if (input.fibers && typeof input.fibers === 'object') map = input.fibers;
  else if (Array.isArray(input.components)) { map = {}; input.components.forEach((c) => { const k = c && (c.variant === 'cdp' && c.fibre === 'polyester' ? 'cdp' : c.fibre); if (k) map[k] = (map[k] || 0) + (+c.share || 0); }); }
  if (!map) throw new ChemError('Give the yarn\'s fibres and their shares, for example cotton 60 and polyester 40.');
  const list = Object.entries(map).filter(([, v]) => !(v === 0 || v === '0'));
  if (!list.length) throw new ChemError('Give the yarn\'s fibres and their shares, for example cotton 60 and polyester 40.');
  if (list.length > 4) throw new ChemError('At most 4 fibres in a yarn.');
  return list.map(([f, v]) => {
    if (!own(FIB, f)) throw new ChemError(`"${f}" is not a fibre this engine knows (${FIBRE_IDS.join(', ')}).`);
    if (!(+v > 0)) throw new ChemError(`${FIB[f].label}: give its share, above 0.`);
    return { id: f, share: +v };
  });
}
function readCountTex(input) {
  const ct = input.count && typeof input.count === 'object' ? input.count : null;
  const tbl = { ne: (v) => 590.5 / v, nm: (v) => 1000 / v, tex: (v) => v, dtex: (v) => v / 10, denier: (v) => v / 9 };
  let tex = null;
  if (ct && +ct.value > 0) { const u = String(ct.unit || 'ne').toLowerCase(); if (!own(tbl, u)) throw new ChemError(`Count unit "${ct.unit}": use ne, nm, tex, dtex or denier.`); tex = tbl[u](+ct.value); }
  else if (+input.tex > 0) tex = +input.tex;
  else if (+input.count_ne > 0) tex = 590.5 / +input.count_ne;
  if (!(tex > 0)) throw new ChemError('Give the yarn count (value and unit, for example 30 Ne).');
  if (tex < 1 || tex > 400) throw new ChemError(`${r1(tex)} tex is outside 1–400 tex: check the count and the unit.`);
  return tex;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE ROUTE
// ═════════════════════════════════════════════════════════════════════════════════════════════
const CLASS_PROC = { reactive: 'dye_reactive', disperse: 'dye_disperse', acid: 'dye_acid', cationic: 'dye_cationic' };
// the order the chemistry allows: the high-temperature classes first, alkaline reactive last (disperse dye left on cotton is cleared before
// the reactive dye goes on, and the reactive's alkali would otherwise strip the polyester's disperse dye)
const CLASS_ORDER = ['disperse', 'cationic', 'acid', 'reactive'];

function classesFor(fibres, variantDisperseOnCdp) {
  const set = new Set();
  fibres.forEach((f) => {
    if (FIB[f.id].rides && fibres.length > 1) return;                  // elastane rides with the face fibre's bath
    let cls = FIB[f.id].primary;
    if (f.id === 'cdp' && variantDisperseOnCdp) cls = 'disperse';
    if (['direct', 'vat', 'sulphur'].includes(cls)) cls = 'reactive';
    set.add(cls);
  });
  return CLASS_ORDER.filter((c) => set.has(c));
}
function compatibility(classes, depthIdx) {
  if (classes.length <= 1) return { one_bath: true, baths: 1, why: classes.length ? `One dye class (${CLASS_LABEL[classes[0]].toLowerCase()}): one bath.` : 'No dye class needed.' };
  const has = (c) => classes.includes(c);
  if (has('disperse') && has('reactive') && classes.length === 2) {
    const light = depthIdx <= 2;
    return { one_bath: light, baths: light ? 1 : 2, why: light ? 'A pastel or light shade can be dyed one bath, two steps (disperse at 130 °C, cool, then the reactive with salt and alkali), but the shade depth and the fastness are limited: the reactive dye is hydrolysed by the hot, acid-to-alkaline swing and the disperse dye stains the cotton.' : 'Two baths: disperse dye at 130 °C first, then reduction clearing, then the reactive dye. The alkali of the reactive bath would strip the disperse dye, and the disperse dye left on the cotton would ruin the wash fastness; a medium to dark shade needs both cleared.' };
  }
  if (has('cationic') && has('reactive')) return { one_bath: false, baths: 2, why: 'Two baths: the cationic dye strikes fast at pH 4–5 and would stain the cellulose; the reactive dye needs alkali. Cationic first, then the reactive.' };
  if (has('acid') && has('reactive')) return { one_bath: false, baths: 2, why: 'Two baths: acid dye at pH 4–6 for the polyamide or protein, then the reactive dye for the cellulose; the reactive dye stains nylon and wool unless the acid bath goes first and a fixing agent is used.' };
  if (has('disperse') && has('acid')) return { one_bath: depthIdx <= 3, baths: depthIdx <= 3 ? 1 : 2, why: 'Nylon takes both: disperse covers a polyester/nylon blend in one bath for light to medium shades; a dark shade needs a separate acid bath for the nylon.' };
  return { one_bath: false, baths: classes.length, why: 'One bath per dye class: the classes need different pH and temperature.' };
}

function routeFor(spec, fibres, classes, comp, depthIdx, opt) {
  const steps = [];
  const ids = fibres.map((f) => f.id);
  const has = (id) => ids.includes(id);
  const cellulosic = ids.some((i) => FIB[i].family === 'cellulosic');
  const cotton = has('cotton') || has('linen');
  const poly = has('polyester') || has('cdp');
  const elast = has('elastane'), nylon = has('nylon'), wool = has('wool') || has('silk');
  const add = (proc, extra) => steps.push({ proc, ...PROC[proc], ...(extra || {}) });
  // pre-treatment
  if (poly || elast) if (opt.heatset_first !== false && (elast || spec.heatset === 'before')) add('heatset', { label: 'Heat-setting (before dyeing)', temp_note: 'stabilises the width and the shape; 180–190 °C for polyester, 170–190 °C with elastane (not above what the elastane stands)' });
  add('scour', cellulosic ? {} : { ph: 9.5, chem: [['Detergent / wetting agent', 1], ['Soda ash', 1]], why: 'removes spinning oil and dirt; a gentler alkali for a synthetic' });
  if (depthIdx === 0 || depthIdx === 1 || cellulosic && depthIdx <= 2 || spec.bleach === true) {
    if (cellulosic || wool) {
      if (wool || nylon || elast) steps.push({ proc: 'bleach', ...PROC.bleach, label: 'Peroxide bleaching (mild)', t: 80, ph: 9.5, chem: [['Hydrogen peroxide (50 %)', 2], ['Stabiliser', 1]], why: 'a mild peroxide bleach: never hypochlorite on a blend with nylon, wool or elastane', mild: true });
      else add('bleach');
    }
  }
  if (depthIdx === 0) add('oba');
  if (spec.mercerise && cotton && !ids.some((i) => ['viscose', 'bamboo', 'wool', 'silk'].includes(i))) add('mercerise');
  // dyeing, in the order the chemistry allows
  if (depthIdx > 0) {
    const dyed = comp.one_bath && classes.length > 1 ? ['one_bath'] : classes;
    dyed.forEach((c, k) => {
      if (c === 'one_bath') {
        const lowT = elast || nylon || wool;
        steps.push({ proc: 'dye_disperse', ...PROC.dye_disperse, t: lowT ? 120 : 130, label: classes.includes('reactive') ? 'Disperse + reactive, one bath, two steps' : 'Disperse + acid, one bath', one_bath: true, classes,
          temp_note: lowT ? 'held at 120 °C because the nylon, wool or elastane would be damaged at 130 °C; the polyester takes a little less dye' : null });
        return;
      }
      const p = CLASS_PROC[c];
      let extra = {};
      if (c === 'disperse' && (elast || nylon || cellulosic && wool)) extra = { t: 120, label: 'Disperse dyeing (lowered to 120 °C)', temp_note: 'held at 120 °C because the elastane, nylon or wool would be damaged at 130 °C; the polyester takes a little less dye' };
      if (c === 'cationic' && has('cdp') && !has('acrylic')) extra = { t: 120, label: 'Cationic dyeing of cationic-dyeable polyester (120 °C)' };
      if (c === 'reactive' && cellulosic && ids.some((i) => ['viscose', 'modal', 'tencel', 'bamboo'].includes(i)) && cotton) extra = { label: 'Reactive dyeing (viscose compensated)', temp_note: 'viscose takes the dye faster and deeper: a levelling agent, a slower alkali dosing and a little less dye for the regenerated part' };
      add(p, extra);
      if (c === 'disperse' && cellulosic && depthIdx >= 2) add('reduction_clear');
      if (c === 'disperse' && !cellulosic && depthIdx >= 3) add('reduction_clear', { label: 'Reduction clearing (poly-only)' });
      if (c === 'reactive') add('soap');
    });
    if (comp.one_bath && classes.length > 1) { add('reduction_clear', { label: 'Reduction clearing (light)', time: 10, chem: [['Sodium hydrosulphite', 1], ['Soda ash', 1]] }); add('soap'); }
  }
  if (cellulosic && spec.biopolish !== false && !wool) add('biopolish');
  if ((poly || elast) && spec.heatset !== 'none' && spec.heatset !== 'before' && !elast) add('heatset', { label: 'Heat-setting (after dyeing)', temp_note: 'sets the polyester; done after dyeing it risks thermomigration of disperse dye to the surface and yellowing of the white' });
  add('soften');
  return steps;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE ANALYSIS
// ═════════════════════════════════════════════════════════════════════════════════════════════
function analyse(input) {
  if (!input || typeof input !== 'object') throw new ChemError('Give the yarn: its fibres and a count.');
  const list = readFibres(input);
  const tex = readCountTex(input);
  const shade = own(DEPTH_LABEL, input.shade) ? input.shade : 'medium';
  const depthIdx = DEPTHS.indexOf(shade);
  const LR = clamp(+input.liquor_ratio > 0 ? +input.liquor_ratio : 8, 3, 30);
  const filament = !!input.filament;
  const warnings = [], say = (level, text) => warnings.push({ level, text });
  const tot = list.reduce((t, x) => t + x.share, 0);
  // composition: label → dry → fibre number
  const R = list.map((x) => regainOf(x.id));
  const dryRaw = list.map((x, i) => (x.share / tot) / (1 + R[i] / 100)), dsum = dryRaw.reduce((a, b) => a + b, 0);
  const dry = dryRaw.map((v) => v / dsum);
  const label = list.map((x) => x.share / tot);
  const fineness = input.fineness && typeof input.fineness === 'object' ? input.fineness : {};
  const dtex = list.map((x) => (own(fineness, x.id) && +fineness[x.id] > 0 ? +fineness[x.id] : FIB[x.id].dtex));
  const dtexBasis = list.map((x) => (own(fineness, x.id) && +fineness[x.id] > 0 ? 'measured' : 'typical'));
  const blendR = dry.reduce((t, d, i) => t + d * R[i], 0);
  const fibres = list.map((x, i) => ({ ...x, ...FIB[x.id], label_share: label[i], dry: dry[i], regain: R[i], dtex: dtex[i], dtex_basis: dtexBasis[i], i }));
  const ids = fibres.map((f) => f.id);
  const has = (id) => ids.includes(id);
  const cellulosic = fibres.some((f) => f.family === 'cellulosic');
  const spec = { mercerise: !!input.mercerise, biopolish: input.biopolish === false ? false : undefined, heatset: input.heatset, bleach: input.bleach };

  // forbidden / dangerous combinations
  if (has('elastane') && fibres.length > 1) say('note', 'Elastane rides with the other fibre: it is dyed in the same bath at a lower temperature, never bleached with chlorine, and heat-set no hotter than it stands.');
  if (['nylon', 'wool', 'silk', 'elastane'].some(has)) say('warn', 'Chlorine bleach (hypochlorite) is not used on this yarn: it damages nylon, wool, silk and elastane. Peroxide only.');
  if (has('wool') && cellulosic) say('warn', 'Wool and cellulosic fibres in one yarn: the alkali that cellulose needs (scouring, reactive dyeing) attacks the wool; the wool\'s acid dyeing does not suit the cellulose. Keep the alkali mild and cool, or dye the fibres before blending.');
  if (has('wool') && input.agitation !== false) say('note', 'Wool felts with heat, moisture and agitation: dye in a gentle machine and avoid shock cooling.');
  if (spec.mercerise && ids.some((i) => ['viscose', 'bamboo', 'wool', 'silk'].includes(i))) say('warn', 'Mercerising is left out: caustic at that strength damages viscose, bamboo, wool and silk.');
  if (spec.mercerise && !(has('cotton') || has('linen'))) say('note', 'Mercerising is for cotton and linen: there is none in this yarn.');
  if (filament && !ids.every((i) => ['polyester', 'nylon', 'cdp', 'elastane'].includes(i))) say('note', 'Filament yarn is taken as polyester or nylon; other fibres are staple.');

  // dye classes, compatibility, route
  const classes = depthIdx === 0 ? [] : classesFor(fibres, !!input.cdp_disperse);
  const comp = compatibility(classes, depthIdx);
  const stepsRaw = routeFor(spec, list, classes, comp, depthIdx, { heatset_first: true });
  if (comp.baths > 1 && depthIdx > 0) say('note', `${comp.baths} dye baths are needed: ${comp.why}`);
  // dye-rate differences between the fibres of one class
  const orient = (() => { try { const m = {}; fibres.forEach((f) => { if (FP[FIB[f.id].tbl]) m[FIB[f.id].tbl] = (m[FIB[f.id].tbl] || 0) + f.label_share * 100; }); return Y.molecularOrientation(m); } catch (e) { return null; } })();
  const rateSplit = !!(orient && orient.dye_rate_split && fibres.filter((f) => f.family === 'cellulosic').length > 1);
  if (rateSplit) say('warn', `The cellulosic fibres here are unequally oriented (${orient.most_oriented.fibre} against ${orient.least_oriented.fibre}): in one reactive bath they dye two shades. Compensate with a levelling agent, slow alkali dosing and a lower dye on the less oriented fibre.`);

  // ── the recipe ────────────────────────────────────────────────────────────────────────────
  const yarnKg = clamp(+input.yarn_kg > 0 ? +input.yarn_kg : 100, 1, 100000);
  const dryYarnKg = yarnKg / (1 + blendR / 100);
  const dyes = [], derive = [];
  const D = (id, quantity, formula, working, result, unit, basis) => derive.push({ id, quantity, formula, working, result, unit, basis });
  const perClass = {};
  if (depthIdx > 0) {
    fibres.forEach((f) => {
      if (f.rides && fibres.length > 1) return;
      let cls = f.primary; if (f.id === 'cdp' && input.cdp_disperse) cls = 'disperse'; if (['direct', 'vat', 'sulphur'].includes(cls)) cls = 'reactive';
      const base = OWF[cls][depthIdx];
      const fin = f.dtex > 0 ? Math.sqrt(FIB[f.id].dtex / f.dtex) : 1;
      const owf = base * fin * f.depth;
      const kg = (owf / 100) * f.dry * dryYarnKg;
      const e = perClass[cls] || (perClass[cls] = { cls, kg: 0, by_fibre: [] });
      e.kg += kg; e.by_fibre.push({ fibre: f.id, label: f.label, share_pct: r1(f.dry * 100), owf_pct: r2(owf), fineness_factor: r2(fin), depth_factor: f.depth, kg: r3(kg) });
    });
    Object.values(perClass).forEach((e) => {
      const fix = BATH[e.cls].fix[depthIdx];
      dyes.push({ class: e.cls, class_label: CLASS_LABEL[e.cls], kg: V(r2(e.kg), 'kg per ' + yarnKg + ' kg yarn', 'typical'), owf_on_yarn_pct: r2((e.kg / dryYarnKg) * 100), fixation_pct: V(fix, '%', 'typical'), unfixed_kg: r2(e.kg * (1 - fix / 100)), by_fibre: e.by_fibre,
        theory: (() => { const t = THEORY.getDyeClass(THEORY_KEY[e.cls]); return t ? { name: t.name, mechanism: t.mechanism, conditions: t.typical_conditions, limitations: t.limitations } : null; })() });
      D('dye_' + e.cls, CLASS_LABEL[e.cls] + ' dye', 'kg = Σ (owf% ÷ 100) × dry share × dry yarn kg;  owf% = base(depth) × √(reference dtex ÷ dtex) × depth factor',
        e.by_fibre.map((b) => `${b.label}: ${b.owf_pct} % × ${b.share_pct} % × ${r1(dryYarnKg)} kg`).join('; '), r2(e.kg), 'kg', 'typical');
    });
  }
  // the chemicals of every dyeing step and the effluent
  const chemicals = [], seen = {};
  const volume = LR * yarnKg;                                              // litres of liquor per bath
  const addChem = (name, g, role, bath) => { const k = name + '|' + bath; if (seen[k]) return; seen[k] = 1; chemicals.push({ name, g_per_l: g, kg: r2((g * volume) / 1000), role, bath }); };
  if (depthIdx > 0) classes.forEach((c) => CHEM[c].forEach((x) => { if (x.g[depthIdx] > 0) addChem(x.name, x.g[depthIdx], x.role, CLASS_LABEL[c] + ' bath'); }));
  stepsRaw.forEach((s) => { if (/^(scour|bleach|reduction_clear|soap|biopolish|soften|oba)$/.test(s.proc)) (s.chem || []).forEach(([n, g]) => addChem(n, g, s.why || '', s.label)); });
  const salt = chemicals.filter((c) => /^Salt/.test(c.name)).reduce((t, c) => t + c.kg, 0);
  const unfixed = dyes.reduce((t, d) => t + d.unfixed_kg, 0);
  const recipe = {
    shade, shade_label: DEPTH_LABEL[shade], liquor_ratio: V(LR, ':1', 'typical'), yarn_kg: yarnKg, dry_yarn_kg: r1(dryYarnKg), liquor_volume_l: Math.round(volume),
    dyes, chemicals, effluent: { unfixed_dye_kg: r2(unfixed), salt_kg: r1(salt), salt_g_per_l: r1(salt * 1000 / volume), note: dyes.some((d) => d.class === 'reactive') ? 'A reactive dyeing loses 20–30 % of the dye to hydrolysis; it is washed off in soaping, and the salt goes to the drain.' : 'Little unfixed dye with this class; the effluent load is mostly the auxiliaries.' },
    basis: 'typical: the % owf by depth and the g/L are industry conventions, replaced by the mill\'s own recipe cards', note: `Dye % is on the dry weight of the fibre, corrected for fineness: a finer fibre has more surface for the same mass, so it needs √(reference dtex ÷ dtex) times more dye for the same apparent depth. Amounts are for ${yarnKg} kg of yarn in ${Math.round(volume)} L of liquor.`,
  };
  D('liquor', 'Liquor volume', 'V = liquor ratio × yarn kg', `${LR} × ${yarnKg}`, Math.round(volume), 'L', 'law');
  D('dry', 'Dry share of each fibre', 'dryᵢ = (labelᵢ ÷ (1 + Rᵢ/100)) ÷ Σ(…)', fibres.map((f) => `${f.label}: ${r2(f.label_share * 100)} ÷ (1 + ${r2(f.regain)}/100)`).join('; '), fibres.map((f) => r1(f.dry * 100) + ' %').join(' / '), '', 'law');

  // ── resistance ────────────────────────────────────────────────────────────────────────────
  const resistance = AGENTS.map((a, k) => {
    const per = fibres.map((f) => ({ fibre: f.id, label: f.label, rating: RES[f.id][k], word: RATING_WORD[RES[f.id][k]] }));
    const min = per.reduce((m, p) => (p.rating < m.rating ? p : m), per[0]);
    return { agent: a.id, label: a.label, per_fibre: per, governed_by: { fibre: min.fibre, label: min.label, rating: min.rating, word: min.word }, note: RES_NOTE[a.id] || null,
      verdict: min.rating <= 0 ? 'avoid: it destroys ' + min.label.toLowerCase() : min.rating === 1 ? 'poor: only briefly and cold, because of ' + min.label.toLowerCase() : min.rating === 2 ? 'with care: ' + min.label.toLowerCase() + ' sets the limit' : 'safe for every fibre in the blend' };
  });

  // ── strength through the route ────────────────────────────────────────────────────────────
  const byIds = {};
  fibres.forEach((f) => { const k = FIB[f.id].by; if (k) byIds[k] = (byIds[k] || 0) + f.label_share * 100; });
  const cum = Object.fromEntries(fibres.map((f) => [f.id, 1]));
  const strengthSpec = Object.keys(byIds).length && !filament ? { fibres: byIds, count: { value: tex, unit: 'tex' }, spinning: own(BY.GEO, input.spinning) ? input.spinning : undefined, grade: input.grade } : null;
  let strength = null, trace = [];
  const tenacityWith = (retention) => {
    if (!strengthSpec) return null;
    const P = BY.prep(strengthSpec); const bl = BY.build(P.comps, P.spinKey);
    const c = BY.core(bl, P.tex, { spinKey: P.spinKey, grade: P.grade, ply: 1, form: 'single', retention });
    return { tenacity: c.tenacity, elong: c.peakEps * 100, force: c.peak * 100 * c.tex };
  };
  const toBy = (cumR) => { const m = {}; fibres.forEach((f) => { const k = FIB[f.id].by; if (k) { m[k] = m[k] ? { ten: (m[k].ten + cumR[f.id]) / 2 } : { ten: cumR[f.id] }; } }); return m; };
  const start = tenacityWith({});
  const steps = stepsRaw.map((s) => {
    const ret = {};
    fibres.forEach((f) => { const r = s.ret && s.ret[f.id] != null ? s.ret[f.id] : 1; ret[f.id] = r; cum[f.id] *= r; });
    const t = tenacityWith(toBy(cum));
    const after = start && t ? { tenacity: r1(t.tenacity), retained_pct: r1((t.tenacity / start.tenacity) * 100), elongation: r1(t.elong) } : null;
    trace.push(after);
    return { id: s.proc, label: s.label, t_c: s.t, ph: s.ph, time_min: s.time, chemicals: (s.chem || []).map(([n, g]) => ({ name: n, g_per_l: g })), purpose: s.why || null, note: s.temp_note || null, classes: s.classes || null,
      retention: Object.fromEntries(fibres.map((f) => [f.id, r2(ret[f.id])])), yarn_after: after };
  });
  const endT = start ? tenacityWith(toBy(cum)) : null;
  const fibreRet = fibres.map((f) => ({ fibre: f.id, label: f.label, retained_pct: r1(cum[f.id] * 100) }));
  const weighted = fibres.reduce((t, f) => t + f.dry * cum[f.id], 0);
  strength = {
    before: start ? { tenacity: V(r1(start.tenacity), 'cN/tex', 'blend'), elongation: V(r1(start.elong), '%', 'blend'), force: V(r1(start.force), 'cN', 'blend') } : null,
    after: endT ? { tenacity: V(r1(endT.tenacity), 'cN/tex', 'blend'), elongation: V(r1(endT.elong), '%', 'blend'), force: V(r1(endT.force), 'cN', 'blend') } : null,
    retained_pct: V(r1((endT ? endT.tenacity / start.tenacity : weighted) * 100), '%', endT ? 'blend' : 'estimate'),
    by_fibre: fibreRet, trace: steps.map((s) => ({ step: s.label, ...s.yarn_after })),
    note: strengthSpec ? 'Each step has a retention for each fibre (typical). The yarn after the route is worked out by the blend yarn engine with the fibres\' reduced strengths, so the fibre that loses most does not simply average out: a blend is governed by which fibre breaks first.' : 'A filament yarn or a fibre the yarn model does not hold: the retention is shown per fibre and weighted by dry share.',
  };
  if (strength.retained_pct.value < 85) say('warn', `The route leaves ${strength.retained_pct.value} % of the yarn's strength: ${fibreRet.sort((a, b) => a.retained_pct - b.retained_pct)[0].label.toLowerCase()} loses most. Make the route milder or use a stronger yarn.`);
  D('retention', 'Strength retained', 'retained = Π over steps of each fibre\'s retention; the yarn tenacity is re-run through the blend yarn engine', fibreRet.map((f) => `${f.label} ${f.retained_pct} %`).join('; '), strength.retained_pct.value, '%', endT ? 'blend' : 'estimate');

  // ── fastness ──────────────────────────────────────────────────────────────────────────────
  let fastness = null;
  if (depthIdx > 0) {
    const per = classes.map((c) => ({ class: c, class_label: CLASS_LABEL[c], grades: Object.fromEntries(FAST_KEYS.map(([k]) => [k, FAST[c][k][depthIdx]])) }));
    const overall = Object.fromEntries(FAST_KEYS.map(([k]) => [k, [Math.min(...per.map((p) => p.grades[k][0])), Math.min(...per.map((p) => p.grades[k][p.grades[k].length - 1]))]]));
    const risks = [];
    if (classes.includes('disperse') && cellulosic) risks.push('Disperse dye stains the cotton: reduction clearing is what gives the wash fastness of a polyester/cotton blend.');
    if (classes.includes('disperse')) risks.push('Thermomigration: disperse dye moves to the surface at 150 °C and above (heat-setting, finishing). Keep the finishing cool and the softener non-migrating, or the rubbing and wash fastness fall.');
    if (classes.includes('reactive') && depthIdx >= 4) risks.push('A dark reactive shade rubs off wet (grade 2–3): soap hard and finish with a cationic fixing agent.');
    if (classes.includes('acid') && has('nylon')) risks.push('Nylon dyed with acid dye washes only 3–4: an after-treatment with a syntan raises it.');
    if (depthIdx >= 4 && cellulosic) risks.push('A black or navy on cotton is the lowest on light fastness: look for a dye with a better light grade, or accept a 3–4.');
    if (rateSplit) risks.push('Two cellulosic fibres of unequal dye uptake can show a two-tone: a deeper viscose in a cotton/viscose heather.');
    fastness = { per_class: per, overall, overall_note: 'The blend is no better than its worst class: the lowest grade of each test governs.', risks, test_keys: FAST_KEYS.map(([k, l]) => ({ key: k, label: l })), basis: 'typical' };
  }

  // ── moisture & liquor ─────────────────────────────────────────────────────────────────────
  const mix100 = Object.fromEntries(fibres.filter((f) => FP[FIB[f.id].tbl]).map((f) => [FIB[f.id].tbl, f.label_share * 100]));
  const ask = (fn, ...a) => { try { return fn(...a) || null; } catch (e) { return null; } };
  const jam = ask(Y.wetJamming, mix100) || {}, dryL = ask(Y.dryingLoad, mix100) || {}, heat = ask(Y.heatCeiling, mix100) || {}, merc = has('cotton') ? ask(Y.mercerisingGain, { cotton: 100 }) : null;
  const boil = fibres.reduce((t, f) => t + f.dry * ((filament && FILAMENT_BOILOFF[f.id]) || BOILOFF[f.id] || 0), 0);
  const moisture = {
    regain: V(r2(blendR), '%', 'blend'), swelling_diameter_gain: jam.diameter_gain_pct != null ? V(jam.diameter_gain_pct, '%', 'measured', { note: jam.worst ? jam.worst.fibre + ' swells most' : null }) : null,
    water_after_extraction: dryL.water_after_extraction_pct ? V(dryL.water_after_extraction_pct.value, '% of dry weight', 'measured') : null,
    boil_off_shrinkage: V(r1(boil), '%', 'typical'), heat_ceiling_c: heat.working_ceiling_c != null ? V(heat.working_ceiling_c, '°C', 'measured') : null,
    note: 'Regain and swelling are from the fibre tables. A swollen cellulosic yarn is thicker and shorter in the bath and fills the needle clearance; boil-off shrinkage is the yarn relaxing in the hot bath and is typical until measured.',
  };

  // ── whitening ─────────────────────────────────────────────────────────────────────────────
  let whitening = null;
  if (depthIdx <= 1) {
    whitening = { applies: true,
      steps: [cellulosic ? 'Peroxide bleach to a clean white ground (cellulosic part).' : null, (has('polyester') || has('cdp')) ? 'Optical brightener of the disperse (benzoxazole or coumarin) type for the polyester, applied in the heat-set or the disperse bath.' : null, cellulosic ? 'Optical brightener of the anionic stilbene type for the cellulosic part, in the bleach or after it.' : null, has('nylon') ? 'An acid-type brightener for the nylon.' : null].filter(Boolean),
      risks: [(has('polyester') || has('cdp')) && cellulosic ? 'The two brighteners must match in tone, or the cotton and the polyester are two whites; heat-setting above 180 °C yellows the cellulosic brightener.' : null, 'Optical brightening is not fastness: it fades in light and with some softeners.'].filter(Boolean),
      basis: 'typical' };
  }

  // ── the sweep over depth ──────────────────────────────────────────────────────────────────
  const sweep = DEPTHS.map((d, k) => {
    const cl = k === 0 ? [] : classesFor(list, !!input.cdp_disperse);
    let dyeKg = 0;
    if (k > 0) fibres.forEach((f) => { if (f.rides && fibres.length > 1) return; let c = f.primary; if (f.id === 'cdp' && input.cdp_disperse) c = 'disperse'; if (['direct', 'vat', 'sulphur'].includes(c)) c = 'reactive'; dyeKg += (OWF[c][k] * (f.dtex > 0 ? Math.sqrt(FIB[f.id].dtex / f.dtex) : 1) * f.depth / 100) * f.dry * dryYarnKg; });
    const saltG = cl.includes('reactive') ? CHEM.reactive[0].g[k] : 0, alkG = cl.includes('reactive') ? CHEM.reactive[1].g[k] : 0;
    const cp = compatibility(cl, k);
    const rt = routeFor(spec, list, cl, cp, k, { heatset_first: true });
    return { shade: d, label: DEPTH_LABEL[d], dye_kg: r2(dyeKg), salt_g_l: saltG, alkali_g_l: alkG, baths: k === 0 ? 0 : cp.baths, steps: rt.length, time_min: Math.round(rt.reduce((t, s) => t + (s.time < 2 ? 2 : s.time) + 15, 0)) };
  });

  const total_time = steps.reduce((t, s) => t + (s.time_min < 2 ? 2 : s.time_min), 0);
  return {
    success: true,
    identity: { fibres: Object.fromEntries(fibres.map((f) => [f.id, r1(f.label_share * 100)])), label: BY.labelOfMix(Object.fromEntries(fibres.filter((f) => BY.FIB[f.id]).map((f) => [f.id, f.label_share * 100]))) || fibres.map((f) => f.label).join(' / '), families: [...new Set(fibres.map((f) => f.family))], count: { tex: r2(tex), ne: r1(590.5 / tex) }, filament, shade: DEPTH_LABEL[shade] },
    fibres: fibres.map((f) => ({ fibre: f.id, label: f.label, family: f.family, polymer: f.polymer, label_share_pct: r1(f.label_share * 100), dry_share_pct: r1(f.dry * 100), regain: V(r2(f.regain), '%', 'measured'), density: V(densityOf(f.id), 'g/cm³', 'measured'), fibre_dtex: f.dtex > 0 ? V(f.dtex, 'dtex', f.dtex_basis) : null,
      primary_class: f.primary, primary_class_label: CLASS_LABEL[f.primary], alternatives: f.alt.map((a) => CLASS_LABEL[a]), theory: (() => { const t = THEORY.getDyeClass(THEORY_KEY[f.primary]); return t ? { name: t.name, mechanism: t.mechanism, conditions: t.typical_conditions } : null; })() })),
    dyeing: { classes: classes.map((c) => ({ id: c, label: CLASS_LABEL[c], t_c: BATH[c].t, ph: BATH[c].ph, time_min: BATH[c].time })), one_bath: comp.one_bath, baths: comp.baths, why: comp.why, dye_rate_split: rateSplit, orientation: orient ? { most_oriented: orient.most_oriented, least_oriented: orient.least_oriented } : null, order_note: classes.length > 1 ? 'The order: ' + classes.map((c) => CLASS_LABEL[c].toLowerCase()).join(' → ') + ': the highest-temperature class first, alkaline reactive last.' : null },
    route: { steps, total_time_min: Math.round(total_time), note: 'The ordered wet route this yarn needs for this shade. Temperatures, pH and times are typical conventions; the chemistry decides the ORDER and what is left out.' },
    recipe, resistance, strength, fastness, moisture, whitening,
    sweep: { depth: sweep },
    derivations: derive, warnings,
  };
}

function catalogue() {
  return {
    fibres: FIBRE_IDS.map((id) => ({ id, label: FIB[id].label, family: FIB[id].family, primary: FIB[id].primary })),
    shades: DEPTHS.map((id) => ({ id, label: DEPTH_LABEL[id] })),
    agents: AGENTS.map((a) => ({ ...a })),
    processes: Object.keys(PROC).map((id) => ({ id, label: PROC[id].label })),
  };
}
/** The Studio's yarn → a chemistry profile: a fibre mix (label %), a tex, filament or not, elastane share, and the person's choices. */
function profileOf(mix, tex, opts) {
  const fibres = {};
  for (const [f, v] of Object.entries(mix || {})) { const k = f === 'spandex' ? 'elastane' : f; if (own(FIB, k) && +v > 0) fibres[k] = (fibres[k] || 0) + +v; }
  if (!Object.keys(fibres).length) return null;
  const o = opts || {};
  return analyse({ fibres, count: { value: tex, unit: 'tex' }, filament: o.filament, shade: o.shade, liquor_ratio: o.liquor_ratio, mercerise: o.mercerise, biopolish: o.biopolish, heatset: o.heatset, spinning: o.spinning, grade: o.grade, cdp_disperse: o.cdp_disperse, yarn_kg: o.yarn_kg });
}

module.exports = { analyse, profileOf, catalogue, ChemError, FIB, DEPTHS, AGENTS, PROC, RES, OWF, BATH, CHEM, FAST };
