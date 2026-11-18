// Blend yarn engine: any fibre blend at any count — the laws, the anchors, the sweeps, the Studio's use of it.
const assert = require('assert');
const B = require('../engine/domain/blend-yarn-engine');
const Y = require('../engine/domain/yarn-engine');
const S = require('../engine/domain/fabric-studio');
console.log('--- Running Blend Yarn Engine Tests ---');

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const run = (fibres, ne, extra = {}) => B.analyse({ fibres, count: { value: ne, unit: 'ne' }, ...extra });
const finite = (o, path = '') => {
  if (o == null) return;
  if (typeof o === 'number') { assert(Number.isFinite(o), `non-finite number at ${path}`); return; }
  if (typeof o === 'object') for (const [k, v] of Object.entries(o)) finite(v, path + '.' + k);
};

// ── 1. the fibre curve passes through what was measured ──────────────────────────────────────
{
  for (const f of ['cotton', 'polyester', 'viscose', 'modal', 'nylon', 'acrylic', 'wool']) {
    const t = Y.FIBER_PROPERTIES[f].tensile;
    const c = B.curveFit(t.modulus, t.tenacity, t.extension / 100);
    near(B.sigma(c, t.extension / 100), t.tenacity, 1e-6, f + ' breaking point');
    assert.strictEqual(B.sigma(c, t.extension / 100 + 0.01), 0, f + ': a broken fibre carries nothing');
    near(B.sigma(c, 1e-5) / 1e-5, c.linear ? c.E : t.modulus, (c.linear ? c.E : t.modulus) * 0.01, f + ' initial modulus');
    let prev = 0; for (let e = 0; e <= t.extension / 100; e += 0.002) { const s = B.sigma(c, e); assert(s >= prev - 1e-9, f + ' curve rises'); prev = s; }
  }
  console.log('✓ fibre stress–strain curves pass through the measured modulus and breaking point');
}

// ── 2. composition: the laws, by hand ────────────────────────────────────────────────────────
{
  const r = run({ cotton: 60, polyester: 40 }, 30);
  const [c, p] = r.composition.per_fibre;
  // dry shares: label ÷ (1+R), normalised
  const dc = 60 / 1.085, dp = 40 / 1.004;
  near(c.dry_share_pct, dc / (dc + dp) * 100, 0.02, 'dry share of cotton'); near(p.dry_share_pct + c.dry_share_pct, 100, 0.02);
  near(r.composition.blend_regain.value, (dc * 8.5 + dp * 0.4) / (dc + dp), 0.02, 'blend regain');
  const rho = 1 / ((dc / (dc + dp)) / 1.52 + (dp / (dc + dp)) / 1.39);
  near(r.composition.blend_density.value, rho, 0.002, 'blend density');
  // fibres in the section: n = tex × Σ(dry/fibre tex)
  const tex = 590.5 / 30, n = tex * ((dc / (dc + dp)) / 0.165 + (dp / (dc + dp)) / 0.133);
  near(r.geometry.fibres_in_section.value, n, 1, 'fibres in the section');
  near(c.fibres_in_section + p.fibres_in_section, n, 1);
  near(c.number_share_pct + p.number_share_pct, 100, 0.2);
  assert.strictEqual(r.identity.family, 'CVC'); assert.strictEqual(r.identity.label, 'CVC 60/40');
  assert.strictEqual(run({ polyester: 65, cotton: 35 }, 30).identity.family, 'PC');
  assert.strictEqual(run({ cotton: 70, viscose: 30 }, 30).identity.label, 'Cotton/Viscose 70/30');
  // the mass chain: the bale issue closes, and weighing at the label ratio drifts the polyester up
  near(r.composition.per_fibre.reduce((t, x) => t + x.issue_share_pct, 0), 100, 0.2);
  assert(p.if_weighed_at_label_ratio_pct > 40, 'polyester loses less in the mill, so weighing at 60/40 gives more polyester than 40 %');
  // finer count → fewer fibres, thinner yarn, twist up
  const r40 = run({ cotton: 60, polyester: 40 }, 40);
  assert(r40.geometry.fibres_in_section.value < r.geometry.fibres_in_section.value && r40.geometry.diameter.value < r.geometry.diameter.value);
  near(r.geometry.tpi.value, r.geometry.twist_multiplier.value * Math.sqrt(30), 0.1, 'TPI = αe√Ne');
  console.log('✓ composition: dry share, regain, density, fibres in the section, names, the bale issue');
}

// ── 3. tensile: anchored to the spinning system, driven by the fibres ────────────────────────
{
  // 100 % cotton on a system gives that system's own tenacity (the utilisation is fixed on it)
  for (const sys of ['combed', 'carded', 'compact', 'open_end']) {
    const r = run({ cotton: 100 }, 30, { spinning: sys });
    near(r.tensile.tenacity.value, Y.SPINNING_SYSTEMS[sys].rkm * 0.9807, Y.SPINNING_SYSTEMS[sys].rkm * 0.9807 * 0.03, sys + ' cotton tenacity');
  }
  const cot = run({ cotton: 100 }, 30, { spinning: 'combed' }), cvc = run({ cotton: 60, polyester: 40 }, 30, { spinning: 'combed' }), pes = run({ polyester: 100 }, 30, { spinning: 'combed' });
  assert(cvc.tensile.tenacity.value > cot.tensile.tenacity.value && pes.tensile.tenacity.value > cvc.tensile.tenacity.value, 'polyester adds strength (from the tables)');
  assert(pes.tensile.tenacity.value > 25 && pes.tensile.tenacity.value < 40, `a spun polyester yarn is 25–40 cN/tex: ${pes.tensile.tenacity.value}`);
  // elongation: cotton ≈ its fibre's 7.1 % ÷ cos²θ; polyester's 15 % ÷ cos²θ; the blend breaks where cotton does
  near(cot.tensile.elongation_at_break.value, 7.1 / cot.tensile.utilisation.cos2_theta_mean, 0.3, 'cotton yarn elongation');
  near(pes.tensile.elongation_at_break.value, 15 / pes.tensile.utilisation.cos2_theta_mean, 0.6);
  near(cvc.tensile.elongation_at_break.value, cot.tensile.elongation_at_break.value, 0.4, 'CVC breaks at the cotton break');
  assert.strictEqual(cvc.tensile.breaks_first.fibre, 'cotton'); assert.strictEqual(cvc.tensile.last_to_go.fibre, 'polyester');
  assert(cvc.tensile.ultimate_elongation.value > cvc.tensile.elongation_at_break.value + 5, 'the polyester holds on to a higher elongation');
  assert(/Cotton breaks first/.test(cvc.tensile.sequence_note));
  // force = tenacity × tex; the curve rises from 0 to the peak
  near(cvc.tensile.breaking_force.value, cvc.tensile.tenacity.value * (590.5 / 30), 1, 'F = tenacity × tex');
  const peak = Math.max(...cvc.tensile.curve.map((p) => p.force_cn)); near(peak, cvc.tensile.breaking_force.value, cvc.tensile.breaking_force.value * 0.03);
  assert.strictEqual(cvc.tensile.curve[0].force_cn, 0);
  // wet and hot-wet from the fibres' own wet factors: cotton gains wet, polyester does not, hot-wet loses
  assert(cot.tensile.scenarios.wet.tenacity > cot.tensile.scenarios.dry.tenacity, 'cotton is stronger wet');
  assert(cvc.tensile.scenarios.hot_wet.tenacity < cvc.tensile.scenarios.dry.tenacity, 'hot wet is weaker');
  const vis = run({ viscose: 100 }, 30, { spinning: 'combed' }); assert(vis.tensile.scenarios.wet.tenacity < vis.tensile.scenarios.dry.tenacity * 0.7, 'viscose loses much of its strength wet');
  // plied: the plies add, a little less than the sum
  const p2 = run({ cotton: 60, polyester: 40 }, 40, { ply: 2 }), p1 = run({ cotton: 60, polyester: 40 }, 40);
  near(p2.tensile.breaking_force.value / p1.tensile.breaking_force.value, 1.9, 0.1, '2-ply force');
  near(p2.count.tex.value, 2 * p1.count.tex.value, 0.05);
  // the blend with nylon has a weak ratio (the first fibre breaks, the second cannot carry it up): the sweep finds it
  const nyl = run({ cotton: 85, nylon: 15 }, 30);
  assert(nyl.sweep.ratio.minimum && nyl.sweep.ratio.minimum.tenacity_cn_tex < Math.min(nyl.sweep.ratio.points[0].tenacity_cn_tex, nyl.sweep.ratio.points[10].tenacity_cn_tex), 'cotton/nylon has a dip');
  assert.strictEqual(cvc.sweep.ratio.minimum, null, 'cotton/polyester from the tables has no dip');
  // the strength-ratio curve is a real sweep of eleven points ending at the pure fibres
  assert.strictEqual(cvc.sweep.ratio.points.length, 11);
  near(cvc.sweep.ratio.points[0].tenacity_cn_tex, cot.tensile.tenacity.value, 0.6, 'ratio sweep starts at cotton');
  near(cvc.sweep.ratio.points[10].tenacity_cn_tex, pes.tensile.tenacity.value, 0.6, 'and ends at polyester');
  console.log('✓ tensile: anchored on the system, curve through the fibres, break sequence, wet, ply, the ratio sweep and its dip');
}

// ── 4. the count sweep: every count, the same laws ───────────────────────────────────────────
{
  const r = run({ cotton: 60, polyester: 40 }, 30);
  const sw = r.sweep.count;
  assert(sw.length >= 15 && sw.every((x, i) => i === 0 || x.ne > sw[i - 1].ne), 'counts in order');
  // n ∝ 1/tex and d ∝ √tex, within the packing differences of the systems chosen per count
  const a = sw.find((x) => x.ne === 20), b = sw.find((x) => x.ne === 40);
  near(a.fibres_in_section / b.fibres_in_section, 2, 0.05, 'twice the fibres at half the count');
  assert(a.diameter_mm > b.diameter_mm); assert(b.u_pct >= a.u_pct - 0.4, 'finer yarn is less even');
  assert(sw.find((x) => x.ne === 8).spinning === 'open_end' && sw.find((x) => x.ne === 40).spinning === 'compact', 'the system follows the count');
  assert(sw.every((x) => x.tenacity_cn_tex > 10 && x.tenacity_cn_tex < 40 && x.breaking_force_cn > 0));
  // a count too fine for the fibres: not spinnable, and the finest count is stated
  const fine = run({ cotton: 60, polyester: 40 }, 30, { spinning: 'open_end' });
  assert(fine.geometry.finest_count.ne <= 30 && fine.geometry.finest_count.ne >= 20, `open-end finest ${fine.geometry.finest_count.ne}`);
  const tooFine = run({ cotton: 60, polyester: 40 }, 50, { spinning: 'open_end' });
  assert(tooFine.warnings.some((w) => /fibres in the section|finer than/.test(w.text)), 'a warning for a count too fine for the system');
  // the recommendation moves with the count
  assert.strictEqual(B.recommendSystem(50, { cotton: 60 }).id, 'compact'); assert.strictEqual(B.recommendSystem(20, { cotton: 60 }).id, 'combed');
  assert.strictEqual(B.recommendSystem(12, { cotton: 60 }).id, 'carded'); assert.strictEqual(B.recommendSystem(6, { cotton: 60 }).id, 'open_end');
  console.log('✓ count sweep: fibres ∝ 1/tex, diameter ∝ √tex, system by count, the finest count');
}

// ── 5. evenness, lustre, texture, properties ─────────────────────────────────────────────────
{
  const r = run({ cotton: 60, polyester: 40 }, 30);
  near(r.evenness.cv_limit_pct.value, 100 / Math.sqrt(r.geometry.fibres_in_section.value), 0.02, 'CVlim = 100/√n');
  near(r.evenness.u_pct.value, 0.8 * r.evenness.cvm_pct.value, 0.06, 'U = 0.8 CVm');
  assert(r.evenness.hairiness_h.value < run({ cotton: 100 }, 30).evenness.hairiness_h.value, 'polyester yarn is less hairy');
  // blend-ratio spread and the creel
  const m = r.evenness.mixing;
  near(m.ideal_cv_pct, Math.sqrt((1 - m.number_share_pct / 100) / (m.number_share_pct / 100 * r.geometry.fibres_in_section.value)) * 100, 0.1);
  assert(run({ cotton: 60, polyester: 40 }, 30, { passages: 3 }).evenness.mixing.cv_section_pct.value < run({ cotton: 60, polyester: 40 }, 30, { passages: 1 }).evenness.mixing.cv_section_pct.value, 'more passages, a better blend');
  assert(m.creel.length && m.creel.every((o) => o.effect_slivers + o.base_slivers === o.doublings));
  assert(run({ cotton: 60, polyester: 40 }, 30, { passages: 1 }).warnings.some((w) => /passage/.test(w.text)), 'one passage is called out');
  // lustre: bright > semi-dull > full-dull; mercerising lifts cotton
  const lus = (l) => run({ cotton: 60, polyester: 40 }, 30, { components: [{ fibre: 'cotton', share: 60 }, { fibre: 'polyester', share: 40, lustre: l }] }).lustre.index.value;
  assert(lus('bright') > lus('semi_dull') && lus('semi_dull') > lus('full_dull'), 'delustrant lowers the sheen');
  assert(run({ cotton: 100 }, 30, { mercerised: true }).lustre.index.value > run({ cotton: 100 }, 30).lustre.index.value * 2, 'mercerised cotton is far more lustrous');
  assert(run({ cotton: 100 }, 30, { spinning: 'compact' }).lustre.index.value > run({ cotton: 100 }, 30, { spinning: 'open_end' }).lustre.index.value, 'a smooth yarn shows more sheen');
  // texture: cotton is the reference
  near(run({ cotton: 100 }, 30).texture.softness.value, 100, 0.01); near(run({ cotton: 100 }, 30).texture.bending_rigidity_vs_cotton.value, 1, 0.001);
  assert(run({ polyester: 100 }, 30).texture.crispness.value > run({ cotton: 100 }, 30).texture.crispness.value);
  // properties: moisture falls with polyester, pilling gets worse, static is flagged, the heat ceiling is the polyester's
  assert(run({ polyester: 65, cotton: 35 }, 30).properties.moisture.regain_conditioned.value < r.properties.moisture.regain_conditioned.value);
  assert(r.properties.pilling.martindale_grade_at_2000.value < run({ cotton: 100 }, 30).properties.pilling.martindale_grade_at_2000.value, 'a blend pills worse than cotton');
  assert.strictEqual(r.properties.static.at_risk, true); assert(r.properties.heat.working_ceiling_c <= 260);
  assert(r.process.steps.some((s) => /130 °C/.test(s.text)) && r.process.steps.some((s) => s.stage === 'Heat setting'));
  console.log('✓ evenness, mixing, lustre (delustrant, mercerising, system), texture, properties, process');
}

// ── 6. bursting estimate, calibrated by one burst ────────────────────────────────────────────
{
  const fab = { wales_per_cm: 15, courses_per_cm: 19 };
  const a = run({ cotton: 60, polyester: 40 }, 30, { fabric: fab }).bursting;
  assert(a.bursting_pressure.value > 250 && a.bursting_pressure.value < 900 && a.bursting_pressure.basis === 'estimate', `bursting ${a.bursting_pressure.value} kPa`);
  assert(run({ cotton: 60, polyester: 40 }, 40, { fabric: fab }).bursting.bursting_pressure.value < a.bursting_pressure.value, 'a finer yarn bursts at a lower pressure at the same density');
  assert(run({ polyester: 100 }, 30, { fabric: fab }).bursting.bursting_pressure.value > a.bursting_pressure.value, 'a stronger yarn bursts higher');
  const c = run({ cotton: 60, polyester: 40 }, 30, { fabric: { ...fab, bursting_kpa: 480 } }).bursting;
  assert.strictEqual(c.bursting_pressure.value, 480); assert.strictEqual(c.bursting_pressure.basis, 'calibrated'); assert(c.calibration.fitted_interaction > 0);
  assert.strictEqual(run({ cotton: 60, polyester: 40 }, 30).bursting, null, 'no fabric, no bursting figure');
  console.log('✓ bursting estimate follows the yarn force and the density, and is fitted by one measured burst');
}

// ── 7. derivations carry the working ─────────────────────────────────────────────────────────
{
  const r = run({ cotton: 60, polyester: 40 }, 30);
  const ids = r.derivations.map((d) => d.id);
  for (const id of ['dry', 'regain', 'density', 'fibres', 'diameter', 'twist', 'fibrecurve', 'utilisation', 'yarnload', 'force', 'elong', 'u', 'sheen', 'mix', 'finest']) assert(ids.includes(id), 'derivation ' + id);
  assert(r.derivations.every((d) => d.formula && d.working && d.result != null && d.basis), 'each derivation has a formula, the working, a result and a basis');
  assert(/√/.test(r.derivations.find((d) => d.id === 'twist').working) || /×/.test(r.derivations.find((d) => d.id === 'twist').working));
  console.log('✓ derivations: formula, the numbers put in, the result, its basis');
}

// ── 8. bad input in words, hardened, and the whole field finite ──────────────────────────────
{
  assert.throws(() => B.analyse({ fibres: { cotton: 60, unobtainium: 40 }, count: { value: 30, unit: 'ne' } }), /not a fibre/);
  assert.throws(() => B.analyse({ fibres: { constructor: 50, cotton: 50 }, count: { value: 30, unit: 'ne' } }), /not a fibre/);
  assert.throws(() => B.analyse({ fibres: { __proto__x: 50, cotton: 50 }, count: { value: 30, unit: 'ne' } }), /not a fibre/);
  assert.throws(() => B.analyse({ fibres: { cotton: 20, polyester: 20, viscose: 20, modal: 20, nylon: 20 }, count: { value: 30, unit: 'ne' } }), /At most 4/);
  assert.throws(() => B.analyse({ components: [{ fibre: 'cotton', share: 50 }, { fibre: 'cotton', share: 50 }], count: { value: 30, unit: 'ne' } }), /twice/);
  assert.throws(() => B.analyse({ components: [{ fibre: 'cotton', share: 0 }, { fibre: 'polyester', share: 40 }, { fibre: 'viscose', share: -3 }], count: { value: 30, unit: 'ne' } }), /share/);
  assert.throws(() => B.analyse({ fibres: { cotton: 100 } }), /count/); assert.throws(() => B.analyse({ fibres: { cotton: 100 }, count: { value: 30, unit: 'furlong' } }), /unit/);
  assert.throws(() => B.analyse({ fibres: { cotton: 100 }, count: { value: 400, unit: 'ne' } }), /outside/);
  assert.throws(() => B.analyse(null), /blend yarn/); assert.throws(() => B.analyse({ count: { value: 30, unit: 'ne' } }), /Give the blend/);
  // a random field: every figure finite, every balance closes
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const ids = ['cotton', 'polyester', 'viscose', 'modal', 'tencel', 'bamboo', 'nylon', 'acrylic', 'wool'];
  for (let i = 0; i < 500; i++) {
    const k = 1 + Math.floor(rnd() * 4), pick = ids.slice().sort(() => rnd() - 0.5).slice(0, k);
    const fibres = {}; pick.forEach((f) => { fibres[f] = 5 + Math.floor(rnd() * 90); });
    const ne = [6, 8, 10, 16, 20, 24, 30, 36, 40, 50, 60, 80][Math.floor(rnd() * 12)];
    const r = B.analyse({ fibres, count: { value: ne, unit: 'ne' }, spinning: rnd() < 0.5 ? undefined : ['carded', 'combed', 'compact', 'open_end', 'vortex', 'siro'][Math.floor(rnd() * 6)], ply: rnd() < 0.2 ? 2 : 1, fabric: rnd() < 0.5 ? { wales_per_cm: 10 + rnd() * 8, courses_per_cm: 12 + rnd() * 10 } : undefined });
    finite(r);
    near(r.composition.per_fibre.reduce((t, x) => t + x.label_share_pct, 0), 100, 0.1, 'label shares close');
    near(r.composition.per_fibre.reduce((t, x) => t + x.dry_share_pct, 0), 100, 0.1);
    assert(r.tensile.tenacity.value > 5 && r.tensile.tenacity.value < 60, `tenacity ${r.tensile.tenacity.value} for ${JSON.stringify(fibres)} ${ne}s`);
    assert(r.tensile.elongation_at_break.value > 2 && r.tensile.elongation_at_break.value < 60);
    assert(r.derivations.length >= 14 && r.sweep.count.length >= 15);
  }
  console.log('✓ bad input in words; prototype keys refused; 500 random blends all finite and closed');
}

// ── 9. the Studio uses it: any ratio, the count solved, the blend result on the response ─────
{
  const base = (yarn, blend, extra = {}) => S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn, target: { gsm: 160 }, machine: {}, ...(blend ? { blend: { ground: blend } } : {}), ...extra });
  const y = { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' };
  const legacy = base({ ...y, fibre: 'cvc' }), b60 = base(y, { fibres: { cotton: 60, polyester: 40 } });
  assert(legacy.success && b60.success);
  near(b60.fabric.sl_mm, legacy.fabric.sl_mm, 0.06, 'CVC 60/40 as a blend gives the legacy CVC answer');
  const sl = [20, 40, 60].map((p) => base(y, { fibres: { cotton: 100 - p, polyester: p } }).fabric.sl_mm);
  assert(sl[0] < sl[1] && sl[1] < sl[2], `the ratio now moves the stitch length: ${sl.join(' < ')}`);
  const d = (f) => base(y, { fibres: f }).yarn.ground.d_mm;
  assert(d({ cotton: 80, polyester: 20 }) < d({ cotton: 35, polyester: 65 }) + 1e-9, 'a polyester-rich yarn is bulkier at the same tex');
  assert.strictEqual(b60.yarn.ground.fibre, 'CVC 60/40', 'the yarn is named by its blend');
  const r = b60.blend.ground;
  assert(r.identity.label === 'CVC 60/40' && r.tensile.tenacity.value > 15 && r.bursting && r.bursting.bursting_pressure.value > 0, 'the response carries the blend result with a bursting figure from the cloth');
  near(r.count.ne.value, 30, 0.1, 'at the count the Studio uses');
  // the count solved from a target GSM: the blend result is at the solved count
  const auto = base({ fibre: 'cotton', type: 'combed' }, { fibres: { cotton: 52, polyester: 48 } });
  assert(auto.success && auto.blend.ground.count.ne.value > 8 && auto.yarn.ground.fibre === 'CVC 52/48', 'auto count with a blend');
  near(auto.blend.ground.count.tex.value, auto.yarn.ground.tex, 0.05);
  // a melange on the same role wins; a blend on another role works
  const both = S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: y, target: { gsm: 160 }, machine: {}, blend: { ground: { fibres: { cotton: 60, polyester: 40 } } }, melange: { ground: M_PRESET() } });
  assert(both.success && both.yarn.ground.source === 'melange', 'a melange on the role wins over a blend');
  // bad blend: said in words
  const bad = base(y, { fibres: { cotton: 60, kryptonite: 40 } });
  assert.strictEqual(bad.success, false); assert(/not a fibre/.test(bad.error));
  // disabled roles are left alone
  assert.strictEqual(base(y, { enabled: false, fibres: { cotton: 50, polyester: 50 } }).yarn.ground.fibre, 'Cotton');
  // the other family members: cotton/viscose, T/R
  for (const f of [{ cotton: 70, viscose: 30 }, { polyester: 65, viscose: 35 }, { cotton: 50, polyester: 30, viscose: 20 }]) assert(base(y, { fibres: f }).success, JSON.stringify(f));
  console.log('✓ Studio: any ratio moves the stitch length and diameter, CVC 60/40 equals the old CVC, the count solved, melange wins, bad input in words');
}
function M_PRESET() { const M = require('../engine/domain/melange-engine'); return JSON.parse(JSON.stringify(M.PRESETS.find((p) => p.id === 'grey_85_15').spec)); }

console.log('Blend yarn engine tests passed');
