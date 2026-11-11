// Parts 1–2 — fibre and yarn: each number checked against the law it comes from, and against the tests that replace it.
const assert = require('assert');
console.log('--- Running Materials (fibre, yarn) Tests ---');
const M = require('../engine/domain/materials');
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol * Math.abs(b), `${what}: ${a} vs ${b}`);

// 1. counts: every system from one tex, exactly
const y30 = M.yarn({ count: 30, unit: 'ne', fibres: 'cotton', spinning: 'combed' });
near(y30.count.tex.value, 590.5 / 30, 1e-3, 'tex'); near(y30.count.nm.value, 1000 / (590.5 / 30), 1e-3, 'Nm'); near(y30.count.denier.value, 9 * 590.5 / 30, 1e-3, 'denier');
near(M.yarn({ count: 2 * 30, unit: 'ne', ply: 2, spinning: 'combed' }).count.tex.value, 590.5 / 30, 1e-3, '2/60s weighs as a 30s');
near(M.yarn({ count: 150, unit: 'denier', fibres: 'polyester', filaments: 48 }).count.dtex.value, 166.7, 1e-3, 'denier → dtex');

// 2. diameter: the packing law reproduces the long-used cotton rule d = 1/(28√Ne) inch; a monofilament is a solid rod
near(y30.diameter.value, 25.4 / (28 * Math.sqrt(30)), 0.02, 'ring cotton diameter');
for (const ne of [10, 20, 40, 60]) near(M.yarn({ count: ne, unit: 'ne', spinning: 'combed' }).diameter.value, 25.4 / (28 * Math.sqrt(ne)), 0.02, `diameter at ${ne}s`);
const mono = M.yarn({ count: 30, unit: 'denier', fibres: 'nylon', filaments: 1, spinning: 'mono' });
near(mono.diameter.value, Math.sqrt((4 * 30 / 9) / (1000 * Math.PI * 1.14)), 1e-3, 'monofilament');
const md = M.yarn({ count: 30, unit: 'ne', spinning: 'combed', tests: { diameter_mm: 0.18 } });
assert.strictEqual(md.diameter.basis, 'measured'); assert(md.packing.value < 0.6 && md.packing.basis === 'law', 'a measured diameter replaces the packing');

// 3. fibres in the section and evenness: the limit irregularity is 100 ÷ √n; a test replaces the estimate
near(y30.fibres_in_section.value, (590.5 / 30) / 0.165, 1e-3, 'fibres in the section');
near(y30.evenness.limit.value, 100 / Math.sqrt(y30.fibres_in_section.value), 1e-3, 'limit irregularity');
assert(y30.evenness.cvm.value > 10 && y30.evenness.cvm.value < 16, 'a combed 30s evens out at about 12–14 % CVm');
assert.strictEqual(M.yarn({ count: 30, unit: 'ne', spinning: 'combed', tests: { cvm_pct: 11.2 } }).evenness.cvm.basis, 'measured');
const mic = M.yarn({ count: 30, unit: 'ne', spinning: 'combed', tests: { micronaire: 3.8 } });
near(mic.fibre.fineness.value, 3.8 * 0.394, 1e-3, 'fineness from micronaire');
assert(mic.fibres_in_section.value > y30.fibres_in_section.value, 'finer fibre, more in the section');

// 4. twist: αe √Ne turns per inch, and the surface angle tan θ = π d T
near(y30.twist.tpm.value, 3.5 * Math.sqrt(30) * 39.37, 1e-3, 'twist');
near(Math.tan(y30.twist.surface_angle.value * Math.PI / 180), Math.PI * y30.diameter.value * y30.twist.tpm.value / 1000, 1e-3, 'twist angle');
assert(y30.twist.surface_angle.value > 15 && y30.twist.surface_angle.value < 30, 'a knitting yarn twists at about 15–30° at its surface');
assert.strictEqual(M.yarn({ count: 30, unit: 'ne', spinning: 'combed', tests: { twist_tpm: 820 } }).twist.tpm.basis, 'measured');
assert.strictEqual(M.yarn({ count: 70, unit: 'denier', fibres: 'nylon', filaments: 24 }).twist, null, 'a flat filament has no spinning twist');

// 5. rigidity: fibre B = η · tex_f², the yarn between its fibres free (n B) and locked (n² B)
const f = y30.fibre;
near(f.flexural_rigidity.value, f.specific_flexural_rigidity.value * f.fibre_tex.value ** 2, 1e-3, 'fibre rigidity');
near(y30.bending_rigidity.free.value, y30.fibres_in_section.value * f.flexural_rigidity.value, 1e-2, 'free bound');
near(y30.bending_rigidity.locked.value / y30.bending_rigidity.free.value, y30.fibres_in_section.value, 1e-2, 'locked = n × free');
// physics cross-check: a jersey's bending rigidity per metre of width ≈ yarn rigidity × wales per metre, about 1–5 µN·m
const perWidth = y30.bending_rigidity.estimate.value * 1e-9 * 1400;
assert(perWidth > 0.5e-6 && perWidth < 1e-5, `jersey bending ${perWidth} N·m`);

// 6. residual torque: 1 at the reference, more for coarser or harder-twisted cotton, less with polyester
assert(Math.abs(y30.residual_torque.value - 1) < 0.02);
assert(M.yarn({ count: 20, unit: 'ne', spinning: 'combed' }).residual_torque.value > 1, 'a coarser yarn holds more torque');
assert(M.yarn({ count: 30, unit: 'ne', spinning: 'combed', twist: { alpha_e: 4.0 } }).residual_torque.value > 1, 'harder twist, more torque');
assert(M.yarn({ count: 30, unit: 'ne', fibres: { cotton: 60, polyester: 40 }, spinning: 'combed' }).residual_torque.value < 1, 'polyester is softer in torsion');
assert(/wrapper/.test(M.yarn({ count: 20, unit: 'ne', spinning: 'open_end' }).residual_torque.note), 'rotor yarn: the limit of the law is said');

// 7. blends: volumes add for density; the weakest fibre caps the strength; heat-setting needs a common window
const cvc = M.fibre({ cotton: 60, polyester: 40 });
near(cvc.density.value, 1 / (0.6 / 1.52 + 0.4 / 1.39), 1e-3, 'blend density');
assert.strictEqual(cvc.tensile.tenacity.basis, 'bound');
assert.strictEqual(cvc.thermal.heat_set.value, 190); assert.deepStrictEqual(cvc.thermal.heat_set.window, [180, 200]);
assert.strictEqual(M.fibre('cotton').thermal.heat_set, null);
assert.strictEqual(M.fibre({ polyester: 50, polypropylene: 50 }).thermal.heat_set.value, null, 'no common heat-setting window');
assert(cvc.unmeasured.length > 0, 'what the tables do not measure is said');

// 8. strength and friction: a test wins; a waxed yarn runs easier on metal
assert.strictEqual(M.yarn({ count: 30, unit: 'ne', spinning: 'combed', tests: { rkm_cN_tex: 19.5 } }).strength.rkm.basis, 'measured');
near(y30.strength.breaking_load.value, y30.strength.rkm.value * y30.count.tex.value / 100, 1e-3, 'breaking load = RKM × tex');
assert(y30.friction.waxed && y30.friction.yarn_on_metal.value < M.yarn({ count: 30, unit: 'ne', spinning: 'combed', waxed: false }).friction.yarn_on_metal.value);

// 9. refusals, and nothing names an outside source
assert.throws(() => M.yarn({ count: 30, unit: 'xx' }), M.MaterialError);
assert.throws(() => M.yarn({ unit: 'ne' }), M.MaterialError);
assert.throws(() => M.yarn({ count: 30, unit: 'ne', fibres: 'unobtainium' }), M.MaterialError);
assert.throws(() => M.yarn({ count: 30, unit: 'ne', spinning: 'magic' }), M.MaterialError);
for (const o of [y30, cvc, M.yarn({ count: 40, unit: 'denier', fibres: 'nylon', filaments: 13 }), M.fibre('elastane')]) assert(!/morton|hearle|page|table \d|http/i.test(JSON.stringify(o)), 'no outside source in the output');
console.log('Materials tests passed');
