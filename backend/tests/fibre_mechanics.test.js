const assert = require('assert');
const { blendMechanics, blendPhysical, FIBER_PROPERTIES } = require('../engine/domain/yarn-engine');
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

console.log('\n✓ All fibre mechanics tests passed.');
