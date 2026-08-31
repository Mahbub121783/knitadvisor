const assert = require('assert');
const { blendMechanics, blendPhysical, blendFriction, blendRecovery, fibreVariability,
        weakLinkSensitivity, FIBER_PROPERTIES } = require('../engine/domain/yarn-engine');
const { wetMechanics, dimensionalRisk, analyzeWetProcessing } =
  require('../engine/domain/wet-processing-engine');

console.log('--- Running Fibre Mechanics Tests (Morton & Hearle ch.13) ---');

// ── The constants are the ones printed in the book ──────────────────────
// scripts/check-engine-against-book.js compares all of them row by row against
// the extraction; these few are pinned here as well so a suite that runs with
// no data file still catches an edit to the figures that matter most.
const PRINTED = [
  ['cotton',    0.32,   7.1,  5.0],      // Table 13.1 p.290, Uppers
  ['viscose',   0.21,  15.7,  6.5],      // Table 13.1 p.290, Fibro staple
  ['wool',      0.11,  42.5,  2.3],      // Table 13.1 p.290, Botany 64s
  ['polyester', 0.47,  15.0, 10.6],      // Table 13.2 p.292, Terylene medium-tenacity
  ['nylon',     0.48,  20.0,  3.0],      // Table 13.2 p.292, nylon 6.6 medium-tenacity
  ['acrylic',   0.27,  25.0,  6.2],      // Table 13.2 p.292, Orlon 42 staple
  ['elastane',  0.0309, 540.0, 0.0071],  // Table 13.2 p.292, polyurethane elastomer
  ['silk',      0.38,  23.4,  7.3],      // Table 13.1 p.290
];
for (const [key, ten, ext, mod] of PRINTED) {
  const t = FIBER_PROPERTIES[key].tensile;
  assert(t, `${key} carries no tensile data`);
  assert.strictEqual(t.tenacity, ten, `${key} tenacity`);
  assert.strictEqual(t.extension, ext, `${key} extension`);
  assert.strictEqual(t.modulus, mod, `${key} modulus`);
  assert(t.page >= 289 && t.page <= 293, `${key} cites a page outside chapter 13`);
  console.log(`  ${key.padEnd(10)} ${String(t.tenacity).padEnd(7)} N/tex  ${String(t.extension).padEnd(6)}%  ${t.table} p.${t.page}`);
}

// Every tensile row must satisfy the identity the book itself sets up: the
// initial slope cannot be shallower than the chord to the breaking point.
for (const [key, row] of Object.entries(FIBER_PROPERTIES)) {
  if (!row.tensile) continue;
  const { tenacity, extension, modulus } = row.tensile;
  const chord = tenacity * 100 / extension;
  assert(modulus >= 0.9 * chord,
    `${key}: initial modulus ${modulus} is below the chord to break ${chord.toFixed(3)}`);
}

// ── Blending ────────────────────────────────────────────────────────────
const viscose = blendMechanics({ viscose: 100 });
assert.strictEqual(viscose.wet.modulus, 0.03, 'viscose keeps 3% of its modulus wet');
assert.strictEqual(viscose.wet.tenacity, 0.5, 'viscose keeps half its strength wet');
assert.strictEqual(viscose.blend_average_reliable, true, 'a single fibre is not a blend');

const cvc = blendMechanics({ cotton: 60, polyester: 40 });
assert.strictEqual(cvc.breaks_first, 'cotton',
  'cotton breaks at 7.1% and polyester at 15%, so the cotton goes first');
assert.strictEqual(cvc.blend_average_reliable, false,
  'a 2.1:1 extension spread means the blend average is an upper bound, not a prediction');
assert(cvc.tenacity_upper_bound_n_tex > 0.32 && cvc.tenacity_upper_bound_n_tex < 0.47,
  'the mass-weighted bound sits between the components');

// A fibre with no measured mechanics must be NAMED, not silently dropped and
// not silently treated as cotton. Linen is the live case: the book gives flax a
// regain and a full tensile row but chapter 5 never weighed it, so the engine
// carries nothing for it.
const withLinen = blendMechanics({ cotton: 70, linen: 30 });
assert.deepStrictEqual(withLinen.unmeasured, ['linen'], 'linen is reported, not dropped');
assert.strictEqual(withLinen.measured_pct, 70, 'the figures cover 70% of the blend');
assert.strictEqual(blendMechanics({ linen: 100 }), null,
  'a blend with nothing measured returns null rather than cotton by default');

// Elastane has tensile figures and no wet ones — Table 13.7 lists no elastomer.
// It must not be counted as 1.00, which would say water leaves it alone.
const lycra = blendMechanics({ cotton: 95, elastane: 5 });
assert.deepStrictEqual(lycra.no_wet_data, ['elastane']);
assert.strictEqual(lycra.wet.modulus, FIBER_PROPERTIES.cotton.tensile.wet.mod,
  'the wet mean is taken over cotton alone, so it equals cotton exactly');

// ── The verdict, which is the thing a user acts on ──────────────────────
// Cotton loses two thirds of its modulus wet and is rope-dyed every day without
// trouble, because it is also 11% stronger wet. Viscose loses 97% of its
// modulus AND half its strength. A rule that looked only at modulus would call
// them both dangerous and be useless.
assert.strictEqual(dimensionalRisk(0.33, 1.11), 'low',  'cotton: weaker resistance, stronger fibre');
assert.strictEqual(dimensionalRisk(0.03, 0.50), 'severe', 'viscose');
assert.strictEqual(dimensionalRisk(0.40, 0.69), 'moderate', 'wool');
assert.strictEqual(dimensionalRisk(1.00, 1.00), 'low', 'polyester');

const wv = wetMechanics({ viscose: 100 }, {});
assert.strictEqual(wv.dimensional_risk, 'severe');
assert(wv.findings.some(f => f.severity === 'severe' && /modulus/i.test(f.finding)),
  'the severe finding names the modulus');
assert(wv.findings.every(f => f.means && f.do), 'every finding says what it means and what to do');

const wc = wetMechanics({ cotton: 100 }, {});
assert.strictEqual(wc.dimensional_risk, 'low', 'cotton is not a wet dimensional risk');
assert(wc.findings.some(f => /STRONGER wet/.test(f.finding)));

// Acrylic is unaffected by cold water and comes apart in a boiling one: it
// keeps 2% of its modulus at 95 °C wet. Cold and hot verdicts must differ.
const wa = wetMechanics({ acrylic: 100 }, {});
assert.strictEqual(wa.dimensional_risk, 'low', 'cold water leaves acrylic alone');
assert.strictEqual(wa.dimensional_risk_in_bath, 'severe', 'the dyebath does not');
assert(wa.findings.some(f => /dyebath/.test(f.finding)),
  'a verdict that differs from the cold one has to be explained');

// ── Wired into the analysis a caller actually receives ──────────────────
const report = analyzeWetProcessing({
  fabric: 'single_jersey', category: 'single_jersey', finish_gsm: 180,
  shade: 'medium', dyeing_method: 'reactive', fibers: { viscose: 100 },
});
assert(report.ok);
assert(report.wet_mechanics, 'the wet-processing report carries the mechanics');
assert.strictEqual(report.wet_mechanics.dimensional_risk, 'severe');
assert(/Wet dimensional risk severe/.test(report.summary),
  'a severe risk reaches the one-line summary, not just the detail');

// A blend the book cannot describe must not silently produce a summary that
// claims it can.
const noData = analyzeWetProcessing({
  fabric: 'single_jersey', category: 'single_jersey', finish_gsm: 180,
  shade: 'medium', dyeing_method: 'reactive', fibers: { linen: 100 },
});
assert.strictEqual(noData.wet_mechanics, null, 'no measured fibre, no wet verdict');

// ── blendPhysical keeps density and the strength index separate ─────────
// Silk has a sourced density and no yarn strength index, because the index is a
// property of spun yarn and nothing in this book measures it. Averaging it in
// as zero would have dragged every silk blend towards "weak".
const silkBlend = blendPhysical({ cotton: 70, silk: 30 });
assert.deepStrictEqual(silkBlend.no_strength_index, ['silk']);
assert.strictEqual(silkBlend.rkm_from_pct, 70, 'the index is averaged over cotton alone');
assert.strictEqual(silkBlend.rkm_idx, 1.0, "so it equals cotton's index exactly");
assert(Math.abs(silkBlend.density - (1.52 * 0.7 + 1.34 * 0.3)) < 0.001,
  'density is still averaged over the whole blend');

// ── Swelling (Table 11.1, p.240) ─────────────────────────────────
// Ranges here are a disagreement between laboratories, so both endpoints are
// real published figures and neither may be rounded away.
assert.deepStrictEqual(FIBER_PROPERTIES.viscose.swelling.area, [50, 114]);
assert.deepStrictEqual(FIBER_PROPERTIES.viscose.swelling.volume, [74, 127]);
assert.deepStrictEqual(FIBER_PROPERTIES.cotton.swelling.area, [21, 42]);
assert.strictEqual(FIBER_PROPERTIES.cotton.swelling.volume, null,
  'the book gives cotton no volume swelling, and null is not zero');
assert(!FIBER_PROPERTIES.polyester.swelling,
  'Table 11.1 predates polyester and nothing is invented for it');

// Volume swelling can never be below area swelling: volume is area compounded
// with length, and no fibre in the table gets shorter in water.
for (const [key, row] of Object.entries(FIBER_PROPERTIES)) {
  if (!row.swelling || !row.swelling.volume) continue;
  assert(row.swelling.volume[1] >= row.swelling.area[0],
    `${key}: volume swelling below area swelling`);
}

// A fibre swelling 50–114% in area thickens the yarn by sqrt(1 + area/100) − 1,
// which for viscose is 22–46%. Whole per cent, because the input range spans
// more than two to one and is a disagreement between workers.
const vsw = blendMechanics({ viscose: 100 });
assert.deepStrictEqual(vsw.swelling_area_pct, [50, 114]);
assert.deepStrictEqual(vsw.yarn_diameter_gain_pct, [22, 46]);
assert.deepStrictEqual(vsw.no_swelling_data, []);

// Polyester has no swelling row, so it is excluded from the mean and named —
// not counted as zero, which would halve the figure and read as a measurement.
const cvcSw = blendMechanics({ cotton: 60, polyester: 40 });
assert.deepStrictEqual(cvcSw.swelling_area_pct, [21, 42],
  'the mean is over cotton alone, so it equals cotton exactly');
assert.strictEqual(cvcSw.swelling_covered_pct, 60);
assert.deepStrictEqual(cvcSw.no_swelling_data, ['polyester']);

const wsw = wetMechanics({ viscose: 100 }, {});
assert(wsw.findings.some(f => /swells 50.114%/.test(f.finding)),
  'the swelling finding reaches the report');
assert.deepStrictEqual(wsw.yarn_diameter_gain_pct, [22, 46]);

// ── Variability and the weak link (chapter 14) ─────────
// Cotton's fibres differ from each other six times as much as nylon's. That one
// comparison is behind most of what a spinner knows about the two.
assert.strictEqual(FIBER_PROPERTIES.cotton.variability.tenacity, 43);
assert.strictEqual(FIBER_PROPERTIES.nylon.variability.tenacity, 7);
assert.strictEqual(fibreVariability({ cotton: 100 }).consistency, 'low');
assert.strictEqual(fibreVariability({ nylon: 100 }).consistency, 'high');
assert.strictEqual(fibreVariability({ viscose: 100 }).consistency, 'moderate');

// Polyester has no row in Table 14.6, so it is named rather than averaged in.
const cvBlend = fibreVariability({ cotton: 60, polyester: 40 });
assert.strictEqual(cvBlend.covered_pct, 60);
assert.deepStrictEqual(cvBlend.unmeasured, ['polyester']);
assert.strictEqual(fibreVariability({ polyester: 100 }), null);

// The weak-link effect: a shorter specimen holds fewer weak places, so it
// cannot test weaker. Cotton gains 90% between 1 cm and 0.1 mm; nylon 15%.
for (const key of ['cotton', 'nylon']) {
  const w = weakLinkSensitivity(key);
  assert(w.at_1cm_n_tex <= w.at_1mm_n_tex && w.at_1mm_n_tex <= w.at_0_1mm_n_tex,
    `${key}: strength falls on a shorter specimen`);
}
assert.strictEqual(weakLinkSensitivity('cotton').gain_to_0_1mm_pct, 90);
assert.strictEqual(weakLinkSensitivity('nylon').gain_to_0_1mm_pct, 15);
assert.strictEqual(weakLinkSensitivity('wool'), null,
  'Table 14.1 measures only cotton and nylon, and nothing is invented for wool');

// Chapters 13 and 14 measure the same fibres at the same 1 cm test length and
// have to agree. This is the only cross-chapter check there is: everything else
// tests the extraction against itself, and a consistent misreading passes that.
assert(Math.abs(FIBER_PROPERTIES.cotton.tensile.tenacity
                - weakLinkSensitivity('cotton').at_1cm_n_tex) <= 0.05 * 0.31,
  'Table 13.1 and Table 14.1 disagree about cotton at 1 cm');
assert.strictEqual(FIBER_PROPERTIES.nylon.weak_link.cm1, 0.47,
  'Table 14.1 puts nylon at 1 cm exactly where Table 13.1 does');

// ── Friction (chapter 25) ──────────────────────────────
// Static friction is the force to START a slide and kinetic the force to keep
// it going; starting is never easier. Any row where it is has swapped columns.
for (const [key, row] of Object.entries(FIBER_PROPERTIES)) {
  const f = row.friction;
  if (!f) continue;
  if (f.static != null && f.kinetic != null) {
    assert(f.static >= f.kinetic, `${key}: static ${f.static} below kinetic ${f.kinetic}`);
  }
  for (const v of [f.parallel, f.static, f.kinetic].filter(x => x != null)) {
    assert(v > 0 && v <= 2, `${key}: ${v} is not a coefficient of friction`);
  }
}

// Wool is the only fibre in the book whose friction has a direction, and that
// asymmetry is the entire mechanism of felting. 0.13 to start a slide with the
// scales, 0.61 against them.
const woolF = FIBER_PROPERTIES.wool.friction;
assert(woolF.directional, 'wool carries the directional pair');
assert.strictEqual(woolF.directional.with_scales.static, 0.13);
assert.strictEqual(woolF.directional.against_scales.static, 0.61);
for (const key of Object.keys(FIBER_PROPERTIES)) {
  if (key === 'wool') continue;
  assert(!(FIBER_PROPERTIES[key].friction || {}).directional,
    `${key} must not carry a directional friction — only wool has one`);
}

// Nylon's 0.14–0.6 is a range the book prints; cotton's 0.29 and 0.57 are two
// workers who disagree. They arrive as the same pair of numbers and mean
// different things, so the engine records which.
assert.strictEqual(FIBER_PROPERTIES.nylon.friction.crossed_kind, 'range');
assert.strictEqual(FIBER_PROPERTIES.cotton.friction.crossed_kind, 'list');

const wf = blendFriction({ wool: 100 });
assert.strictEqual(wf.felting.directional_ratio, 4.692);
assert.strictEqual(wf.felting.severity, 'high');
assert.strictEqual(blendFriction({ wool: 5, cotton: 95 }).felting.severity, 'low',
  'a trace of wool is still a felting risk, but a smaller one');
assert.strictEqual(blendFriction({ cotton: 100 }).felting, null,
  'cotton does not felt, and nothing pretends it might');
assert.strictEqual(blendFriction({ modal: 100 }), null,
  'a fibre with no friction row returns nothing rather than a default');

// Steel and porcelain always cost more tension than a pulley or ceramic, but by
// a fibre-dependent amount — never a flat factor of two.
for (const key of ['cotton', 'viscose', 'nylon']) {
  const g = FIBER_PROPERTIES[key].friction.guide;
  assert(Math.min(g.steel, g.porcelain) > Math.max(g.pulley, g.ceramic),
    `${key}: a hard guide should run higher than a soft one`);
}

// Coverage is reported separately for each derived figure, because only three
// fibres in the book have both a static and a kinetic value.
const mixed = blendFriction({ wool: 50, polyester: 50 });
assert.strictEqual(mixed.stick_slip_from_pct, 50);
assert.strictEqual(mixed.covered_pct, 100);

// The felting finding has to reach the wet-processing report, which is where a
// user would act on it.
const wfelt = wetMechanics({ wool: 100 }, {});
assert(wfelt.findings.some(f => f.severity === 'severe' && /friction against the scales/.test(f.finding)),
  'felting is reported as a severe finding on a wool fabric');
assert(!wetMechanics({ cotton: 100 }, {}).findings.some(f => /against the scales/.test(f.finding)));

// ── Optical (chapter 24) ───────────────────────────────
// The tempting mistake, guarded against. Sheen in fabric-physics.js is a
// rendering parameter and CANNOT be derived from refractive index: Fresnel
// reflectance across every fibre in Table 24.3 spans a factor of 1.46, while
// the sheen constants span 18, and the two even disagree about whether cotton
// or nylon reflects more. This asserts the arithmetic that says so, so nobody
// "sources" sheen from the indices later and quietly makes the model worse.
{
  const book = require('../data/fibre-properties.json');
  const idx = (slug, prop) => {
    const r = book.properties.find(p => p.fibre_slug === slug && p.property === prop &&
      !/ramie/.test(p.condition || ''));
    return r ? r.value : null;
  };
  const R = slug => {
    const par = idx(slug, 'refractive_index_parallel');
    const per = idx(slug, 'refractive_index_perpendicular');
    if (par == null || per == null) return null;
    const n = (par + 2 * per) / 3;
    return ((n - 1) / (n + 1)) ** 2;
  };
  const slugs = ['cotton', 'viscose', 'acetate', 'wool', 'silk', 'nylon', 'polyester', 'acrylic'];
  const Rs = slugs.map(R).filter(v => v != null);
  assert.strictEqual(Rs.length, slugs.length, 'every fibre compared has both indices');
  const spread = Math.max(...Rs) / Math.min(...Rs);
  assert(spread < 2, `Fresnel reflectance spans only ${spread.toFixed(2)}x across all fibres`);
  // And the order disagrees with the appearance model, which is the sharper
  // half of the argument.
  assert(R('cotton') > R('nylon'),
    'cotton reflects MORE than nylon by refractive index, though it looks far duller');

  // Birefringence measures molecular orientation, and two fibres run negative.
  const bir = slug => idx(slug, 'birefringence');
  assert(bir('triacetate') < 0 && bir('polyester') > 0.15,
    'the signed birefringences survive into the data the engine reads');

  // Lustre tracks how round the cotton is, and mercerisation rounds it.
  const cottons = book.properties.filter(p => p.property === 'lustre');
  assert.strictEqual(cottons.length, 15);
  const ab = cond => (book.properties.find(p => p.property === 'fibre_ellipticity' &&
    p.condition === cond) || {}).value;
  const merc = cottons.filter(c => /mercerised/.test(c.condition));
  const nat = cottons.filter(c => !/mercerised/.test(c.condition));
  assert(Math.min(...merc.map(c => c.value)) > Math.max(...nat.map(c => c.value)),
    'mercerised cotton is more lustrous than every natural variety');
  assert(Math.max(...merc.map(c => ab(c.condition))) < Math.min(...nat.map(c => ab(c.condition))),
    'because it is rounder than every one of them');
}

// ── Elastic recovery (chapter 15) ──────────────────────
// Recovery can only get worse as the fibre is pulled further.
for (const [key, row] of Object.entries(FIBER_PROPERTIES)) {
  if (!row.recovery) continue;
  for (const branch of ['rh60', 'rh90']) {
    const s = [row.recovery[branch].e1, row.recovery[branch].e5, row.recovery[branch].e10]
      .filter(v => v != null);
    for (let i = 1; i < s.length; i++) {
      assert(s[i] <= s[i - 1], `${key} ${branch}: recovery rises from ${s[i - 1]} to ${s[i]}`);
    }
    for (const v of s) assert(v >= 0 && v <= 100, `${key}: ${v} is not a percentage`);
  }
}

// The ordering a knitter lives with, and it is not the strength ordering:
// nylon holds its shape, viscose does not, and cotton is fine until it isn't.
assert.strictEqual(blendRecovery({ nylon: 100 }, 60).severity, 'low');
assert.strictEqual(blendRecovery({ viscose: 100 }, 60).severity, 'severe');
assert.strictEqual(blendRecovery({ cotton: 100 }, 60).severity, 'high');
assert(blendRecovery({ cotton: 100 }, 60).collapse_1_to_5 > 30,
  "cotton's recovery collapses between a 1% pull and a 5% one");
assert(blendRecovery({ nylon: 100 }, 60).collapse_1_to_5 <= 2,
  'nylon barely changes across the same range');

// Table 15.2 predates elastane, and an elastomer governs recovery outright, so
// the verdict is withheld rather than computed from the fibres that are left.
// Getting this wrong would call a stretch jersey a bagging risk.
const stretch = blendRecovery({ cotton: 95, elastane: 5 }, 60);
assert.strictEqual(stretch.severity, null);
assert(/elastane governs recovery/.test(stretch.withheld_because));
assert(stretch.from_5pct.recovery === 52, 'the measured part is still reported');

// Humidity is a real variable here, not a rounding: wool recovers better wet.
assert(blendRecovery({ wool: 100 }, 90).from_5pct.recovery >
       blendRecovery({ wool: 100 }, 60).from_5pct.recovery,
  'wool recovers better at 90% r.h. than at 60%, which the table shows plainly');

console.log('\n✓ All fibre mechanics tests passed.');
