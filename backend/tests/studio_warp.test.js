// Fabric Studio, warp knitting (warp-studio.js): lapping notation, laps,
// what each bar knits, runner geometry, weight, width and the checks.
const assert = require('assert');
const W = require('../engine/domain/warp-studio');
console.log('--- Running Studio Warp Tests ---');

const near = (a, b, t, m) => assert(Math.abs(a - b) <= t, `${m}: ${a} vs ${b}`);
const NY = (count) => ({ count, unit: 'denier', fibre: 'nylon_filament' });
const run = (bars, machine, target) => W.analyse({ machine: { type: 'tricot', gauge: 28, ...(machine || {}) }, bars, target: target || {} });

// notation: pairs, overlap / underlap, closed and open laps
assert.deepStrictEqual(W.parseNotation('1-0/1-2//', 1), [[1, 0], [1, 2]]);
const tl = W.lapping([[1, 0], [1, 2]]);
assert(tl.every((l) => l.o === 1 && l.u === 1 && l.closed), 'tricot 1-0/1-2: 1-needle overlap and underlap, closed laps');
const open = W.lapping([[0, 1], [2, 3]]);
assert(open.some((l) => !l.closed), '0-1/2-3 laps open (underlap carries on the overlap direction)');
assert.strictEqual(W.kindOf(W.lapping([[1, 0], [0, 1]])).key, 'pillar');
assert.strictEqual(W.kindOf(W.lapping([[0, 0], [2, 2]])).key, 'inlay');
assert.strictEqual(W.kindOf(W.lapping([[1, 0], [3, 4]])).key, 'u3');
assert.strictEqual(W.kindOf(W.lapping(W.parseNotation('1-0/1-2/2-3/3-4/3-2/2-1//'))).key, 'atlas');

// every template knits and is named
for (const t of W.TEMPLATES) {
  const r = W.analyse({ machine: { type: t.machine, gauge: t.gauge, gap_mm: t.gap, notation_step: t.notation_step }, bars: t.bars, target: { gsm: t.gsm } });
  assert(r.success, `${t.id}: ${r.error}`);
  assert(r.ok_to_knit, `${t.id}: ${r.checks.filter((c) => c.level === 'error').map((c) => c.text)}`);
  assert(r.structure.name, `${t.id}: named`);
  near(r.fabric.gsm, t.gsm, 1, `${t.id}: the quality solved hits the GSM`);
}

// runner geometry: a longer underlap needs more yarn; E28 charmeuse runners in the published order (front ~1,700, back ~1,300 mm/rack at 20 cpc)
{
  const r = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 });
  const [f, b] = r.bars.map((x) => x.runner_mm_per_rack);
  assert(f > b, 'the 2-needle front bar takes more yarn than the 1-needle back bar');
  assert(f > 1450 && f < 1950 && b > 1100 && b < 1500, `runners ${f} / ${b}`);
  // a closer quality (more courses/cm) → shorter loops → less yarn per course, more GSM
  const r2 = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 30 });
  assert(r2.bars[0].mm_per_course < r.bars[0].mm_per_course && r2.fabric.gsm > r.fabric.gsm);
  // weight follows the yarn: double the denier, double the weight
  const r3 = run([{ notation: '1-0/2-3//', yarn: NY(80) }, { notation: '1-2/1-0//', yarn: NY(80) }], { cpc: 20 });
  near(r3.fabric.gsm / r.fabric.gsm, 2, 0.06, 'GSM ∝ tex');
  // part threading halves that bar's ends
  const r4 = run([{ notation: '1-0/2-3//', threading: 'X.', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 });
  assert.strictEqual(r4.bars[0].ends, Math.round(r.bars[0].ends / 2));
  // elastane is fed drafted
  const r5 = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: { count: 40, unit: 'denier', fibre: 'elastane', draft: 2 } }], { cpc: 20 });
  // total draft 2, of which 1.7 at warping (the default): the let-off draws 2 ÷ 1.7 off the beam
  near(r5.bars[1].fed_mm_per_rack * 2 / 1.7, r5.bars[1].runner_mm_per_rack, 2, 'run-in = runner × beam draft ÷ total draft');
  const r5b = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: { count: 40, unit: 'denier', fibre: 'elastane', draft: 2, beam_draft: 1 } }], { cpc: 20 });
  near(r5b.bars[1].fed_mm_per_rack * 2, r5b.bars[1].runner_mm_per_rack, 2, 'no beam draft: run-in = runner ÷ draft');
  near(r5b.fabric.gsm, r5.fabric.gsm, 0.5, 'the weight follows the total draft, not where it is put in');
  // a finished width given sets the narrowing
  const r6 = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 }, { width_in: 80 });
  near(r6.fabric.width_in, 80, 0.1, 'finished width as given');
}

// checks
{
  const err = (r) => r.checks.filter((c) => c.level === 'error').map((c) => c.text).join(' | ');
  assert(/front bar\) inlays/.test(err(run([{ notation: '0-0/2-2//', yarn: NY(40) }, { notation: '1-0/0-1//', yarn: NY(40) }], { cpc: 20 }))));
  assert(/no bar makes a loop/.test(err(run([{ notation: '1-0/1-1//', yarn: NY(40) }, { notation: '0-0/1-1//', yarn: NY(40) }], { cpc: 20 }))));
  assert(/shogs/.test(err(run([{ notation: '1-0/8-9//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 }))));
  assert(run([{ notation: '1-0/1-2//', yarn: NY(40) }, { notation: '1-0/1-2//', yarn: NY(40) }], { cpc: 20 }).checks.some((c) => c.level === 'warn' && /same way/.test(c.text)));
  // bad notation: a clear message, not a crash
  const bad = run([{ notation: '1-0/9', yarn: NY(40) }], { cpc: 20 });
  assert(!bad.success && /not a lapping pair/.test(bad.error));
  assert(!run([{ notation: '1-0/1-2//', yarn: {} }], { cpc: 20 }).success, 'a bar needs its yarn');
}
console.log('Studio warp tests passed');
// 3D: every end's path from its own lapping (studio-warp-geom.js)
{
  const G = require('../../frontend/assets/js/studio-warp-geom.js');
  const lk = G.buildWarpGeom({ bars: [{ pairs: W.parseNotation('2-3/1-0//', 1) }, { pairs: W.parseNotation('1-0/1-2//', 1) }], needles: 8, h: 0.75 });
  const fr = lk.paths.find((p) => p.bar === 0 && p.guide === 2);
  // guide 2 of 2-3/1-0: loops on needle 4 then needle 2 — a two-needle underlap, closed laps
  assert.deepStrictEqual(fr.loops.slice(0, 4).map((l) => l.needle), [4, 2, 4, 2]);
  assert(fr.loops.every((l) => l.closed), 'locknit front bar laps closed');
  // each loop is drawn through the loop below: its head one course up
  fr.loops.forEach((l) => assert(Math.abs(l.top - (l.course + 1.38) * 0.75) < 1e-9));
  // the front bar's underlaps lie outermost on the back
  const minZ = (b) => Math.min(...lk.paths.filter((p) => p.bar === b).flatMap((p) => p.points.map((q) => q.z)));
  assert(minZ(0) < minZ(1), 'front-bar underlaps outermost');
  // open laps where the underlap carries on the overlap's direction
  const op = G.buildWarpGeom({ bars: [{ pairs: [[0, 1], [2, 3]] }], needles: 8 });
  assert(op.paths[0].loops.some((l) => !l.closed));
  // threading: one in, one out carries half the ends; an inlay bar makes no loops
  const full = G.buildWarpGeom({ bars: [{ pairs: [[1, 0], [1, 2]] }], needles: 12 }).paths.length;
  const half = G.buildWarpGeom({ bars: [{ pairs: [[1, 0], [1, 2]], threading: 'X.' }], needles: 12 }).paths.length;
  assert(Math.abs(half - full / 2) <= 1, `half threading: ${half} of ${full}`);
  const pi = G.buildWarpGeom({ bars: [{ pairs: [[1, 0], [0, 1]] }, { pairs: [[0, 0], [3, 3]] }], needles: 8 });
  assert(pi.paths.filter((p) => p.bar === 1).every((p) => p.loops.length === 0), 'inlay: no loops');
  assert(pi.paths.filter((p) => p.bar === 0).every((p) => new Set(p.loops.map((l) => l.needle)).size === 1), 'pillar: one needle');
  // knit3d draws the same lapping (node, with the three.js loader)
  const { spawnSync } = require('child_process');
  const path = require('path');
  const out = spawnSync(process.execPath, ['--import', './tests/helpers/knit3d-loader.mjs', 'tests/helpers/warp3d-check.mjs'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stderr);
  const k = JSON.parse(out.stdout);
  assert(k.paths > 10 && k.finite, `knit3d warp paths: ${out.stdout}`);
  assert.deepStrictEqual(k.repeat, { wales: 2, courses: 6, xPitch: 1 }, 'the macro view tiles a half-set 6-course net by its own repeat');
  assert.deepStrictEqual(k.spacerRepeat, { wales: 4, courses: 2, xPitch: 1 }, 'a spacer repeats over its machine courses, not its pairs');
  assert(k.depth > 3.5, 'knit3d draws both faces of the spacer, the gap apart');
}
console.log('Studio warp 3D tests passed');

// raschel-style notation, four-number courses, monofilament diameters
{
  assert.deepStrictEqual(W.parseNotation('2-0/2-4//', 1, { step: 2 }), W.parseNotation('1-0/1-2//', 1), 'raschel style counts two per needle space');
  assert.throws(() => W.parseNotation('3-0/2-4//', 1, { step: 2 }), /even/);
  assert.deepStrictEqual(W.parseNotation('1-0-2-3/1-1-0-1//', 1), [[1, 0], [2, 3], [1, 1], [0, 1]], 'a four-number course is front bed then back bed');
  const mono = run([{ notation: '1-0/1-2//', yarn: { count: 0.2, unit: 'mm', fibre: 'polyester_mono' } }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 });
  near(mono.bars[0].tex, 1.38 * Math.PI * 0.01 * 1000, 0.1, '0.2 mm PET monofilament ≈ 43.4 tex');
  near(mono.bars[0].d_mm, 0.2, 0.001, 'a monofilament is as thick as its diameter');
}

// does the cloth hold together?
{
  const lvl = (r, re) => r.checks.filter((c) => re.test(c.text)).map((c) => c.level);
  // pillars alone: separate chains
  const pil = run([{ notation: '1-0/0-1//', yarn: NY(40) }], { cpc: 20 });
  assert.deepStrictEqual(lvl(pil, /not joined sideways/), ['error'], 'pillars with nothing across them fall apart');
  // queenscord: the back bar's 3-needle underlaps tie the pillars
  const qc = W.TEMPLATES.find((t) => t.id === 'queenscord');
  assert(!lvl(W.analyse({ machine: { type: 'tricot', gauge: 28 }, bars: qc.bars, target: { gsm: 150 } }), /not joined/).length, 'underlaps bind the wales they cross');
  // pillar + inlay (marquisette): held by the inlay
  assert(!lvl(run([{ notation: '1-0/0-1//', yarn: NY(40) }, { notation: '0-0/3-3//', yarn: NY(40) }], { cpc: 15 }), /not joined/).length);
  // a hexagonal net presses loops off on purpose (a note); a full-set fabric with an idle needle is warned
  const sf = W.TEMPLATES.find((t) => t.id === 'sandfly');
  const sfr = W.analyse({ machine: { type: 'raschel', gauge: 24 }, bars: sf.bars, target: { gsm: sf.gsm } });
  assert.deepStrictEqual(lvl(sfr, /pressed off/), ['note']);
  assert(/Hexagonal net/.test(sfr.structure.name));
  assert(!run([{ notation: '1-0/1-2//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 }).checks.some((c) => /pressed off/.test(c.text)), 'full tricot: every needle knits every course');
}

// double-needle-bar spacer
{
  const sp = (bars, gap, extra) => W.analyse({ machine: { type: 'double_raschel', gauge: 18, gap_mm: gap, cpc: 10, ...(extra || {}) }, bars, target: {} });
  const PET = (d) => ({ count: d, unit: 'denier', fibre: 'polyester_filament', filaments: 48 });
  const MONO = { count: 0.2, unit: 'mm', fibre: 'polyester_mono' };
  const base = (spacer, gapYarn) => [
    { notation: '1-0/1-1/1-2/2-2//', yarn: PET(150) },        // front bed only
    { notation: '1-0/0-1//', yarn: gapYarn || MONO, threading: 'X.', ...(spacer || {}) },   // both beds
    { notation: '1-1/1-0/2-2/1-2//', yarn: PET(150) },        // back bed only
  ];
  const r = sp(base(), 5);
  assert(r.success && r.ok_to_knit, r.error || JSON.stringify(r.checks));
  assert.deepStrictEqual(r.bars.map((b) => b.bed), ['front', 'spacer', 'back']);
  assert(/Spacer fabric/.test(r.structure.name) && r.structure.beds === 2);
  // thickness from the gap; a wider gap needs more spacer yarn, the faces do not change
  const r10 = sp(base(), 10);
  assert(r10.fabric.spacer.thickness_mm > r.fabric.spacer.thickness_mm + 4.5);
  assert(r10.bars[1].mm_per_course - r.bars[1].mm_per_course > 2 * 4.9, 'two crossings per course, each ~5 mm longer');
  near(r10.bars[0].mm_per_course, r.bars[0].mm_per_course, 1e-9, 'the faces do not depend on the gap');
  // straight spacer (pillar on both beds) vs one that leans across a needle
  assert.strictEqual(r.fabric.spacer.angle_deg, 0);
  assert(sp(base({ notation: '1-0/1-2//' }), 5).fabric.spacer.angle_deg > 10);
  // nothing joins the faces: two fabrics
  assert(sp([base()[0], base()[2]], 5).checks.some((c) => c.level === 'error' && /two separate fabrics/.test(c.text)));
  // a multifilament spacer at 10 mm will not stand up
  assert(sp(base(null, PET(150)), 10).checks.some((c) => c.level === 'warn' && /collapses/.test(c.text)));
  // a lapping with an odd number of pairs is not a double-needle-bar lapping
  assert(/two pairs/.test(sp([{ notation: '1-0/1-2/2-3//', yarn: PET(150) }], 5).error));
  assert(/gap/.test(sp(base(), 90).error));
}

// 3D: two beds — the back face mirrored behind the front, spacer yarns across
{
  const G = require('../../frontend/assets/js/studio-warp-geom.js');
  const g = G.buildWarpGeom({ bars: [{ pairs: [[1, 0], [1, 1], [1, 2], [2, 2]] }, { pairs: [[1, 0], [0, 1]] }, { pairs: [[1, 1], [1, 0], [2, 2], [1, 2]] }], beds: 2, gap: 4, needles: 8 });
  const zs = (b) => g.paths.filter((p) => p.bar === b).flatMap((p) => p.points.map((q) => q.z));
  assert(Math.min(...zs(0)) > 1, 'front-bed bar stays on the front face');
  assert(Math.max(...zs(2)) < -1, 'back-bed bar stays on the back face');
  assert(Math.min(...zs(1)) < -1.5 && Math.max(...zs(1)) > 1.5, 'the spacer yarn crosses between them');
  assert(g.paths.filter((p) => p.bar === 1).every((p) => new Set(p.loops.map((l) => l.bed)).size === 2));
}
console.log('Studio warp spacer / net / notation tests passed');

// beams and let-off
{
  const r = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20, width_in: 130, speed_cpm: 2000, efficiency: 85 }, {});
  const B = r.beams;
  assert.strictEqual(B.beams_per_bar, 7, '130" on 21" section beams');
  // capacity: π/4 (D² − d²) W · 0.70 · 1.14 g/cm³
  near(B.per_bar[0].kg_per_beam, Math.PI / 4 * ((21 * 2.54) ** 2 - (7 * 2.54) ** 2) * 21 * 2.54 * 0.7 * 1.14 / 1000, 0.1, 'beam capacity');
  // the 2-needle front bar uses yarn faster: it runs out first
  assert.strictEqual(B.limiting_bar, 1);
  assert(B.per_bar[1].courses > B.per_bar[0].courses);
  // warp length × ends × tex = the beam's mass
  const f = B.per_bar[0];
  near(f.warp_length_m * f.ends_per_beam * (40 / 9) / 1e6, f.kg_per_beam, 0.05, 'mass balance on the beam');
  // a matched set runs out together: the back bar wound shorter, the front full
  assert.strictEqual(B.matched[0].full_pct, 100);
  assert(B.matched[1].full_pct < 100 && B.matched[1].warp_length_m < B.per_bar[1].warp_length_m);
  // let-off: courses/min × run-in per course
  near(f.let_off_m_per_min, 2000 * 0.85 * r.bars[0].fed_mm_per_rack / 480 / 1000, 0.01, 'let-off speed');
  // an order: the yarn it takes matches kg per 1,000 m of machine fabric
  const o = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 }, { order_m: 5000 });
  const machineM = 5000 * o.fabric.relax.kc;
  near(o.beams.order.yarn[0].kg, o.bars[0].kg_per_1000m * machineM / 1000, 0.2, 'order yarn = kg/1,000 m × machine metres');
  // bigger beams hold more
  const big = W.analyse({ machine: { type: 'tricot', gauge: 28, cpc: 20 }, bars: [{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], beams: { flange_in: 30 }, target: {} });
  assert(big.beams.set_hours > B.set_hours * 1.8);
  // elastane is wound stretched: more metres on the same beam
  const el = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: { count: 40, unit: 'denier', fibre: 'elastane', draft: 2.6, beam_draft: 1.7 } }], { cpc: 20 });
  assert(el.beams.per_bar[1].warp_length_m > 1.6 * el.beams.per_bar[1].kg_per_beam * 1e6 / (el.beams.per_bar[1].ends_per_beam * 40 / 9));
}
console.log('Studio warp beam tests passed');

// beams: calibration on a weighed beam, the residue, waste in an order
{
  const bars = [{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }];
  const go = (beams, target) => W.analyse({ machine: { type: 'tricot', gauge: 28, cpc: 20 }, bars, beams, target: target || {} }).beams;
  const base = go({});
  // a weighed full beam on bar 2: that beam holds exactly what was weighed, bar 1 scales the same way
  const c = go({ full_kg: 60, full_bar: 2 });
  near(c.per_bar[1].kg_per_beam, 60, 0.05, 'calibrated beam holds what was weighed');
  near(c.per_bar[0].kg_per_beam / base.per_bar[0].kg_per_beam, 60 / base.per_bar[1].kg_per_beam, 0.01, 'the other bars scale by the same factor');
  assert(c.calibration && /calibrated/.test(c.basis));
  // the same beam given as metres of warp
  const m = go({ full_m: c.per_bar[1].warp_length_m, full_bar: 2 });
  near(m.per_bar[1].kg_per_beam, 60, 0.1, 'metres on the beam give the same calibration');
  // a weight that cannot fit this beam size is flagged
  assert(/far heavier/.test(go({ full_kg: 400 }).warn));
  // residue: what stays on the barrel is not knitted
  const r0 = go({ residue_pct: 0 }), r3 = go({ residue_pct: 3 });
  near(r3.per_bar[0].courses / r0.per_bar[0].courses, 0.97, 0.001, 'residue shortens the beam life');
  // waste: the yarn to buy = net ÷ (1 − residue) ÷ (1 − waste)
  const o = go({ residue_pct: 1.5, waste_pct: 2 }, { order_m: 1000 }).order;
  near(o.yarn[0].kg_gross, o.yarn[0].kg / 0.985 / 0.98, 0.15, 'gross yarn for the order');
  assert(o.kg_gross > o.kg_net);
}
console.log('Studio warp beam calibration tests passed');

// the calculator's warp fabrics run on this engine (engine/formulas/warp-knit.js)
{
  const K = require('../engine/formulas/warp-knit');
  const r = K.calculateWarpKnitSpec({ fabricId: 'locknit', denier: 40, gauge: 28, gsm: 115, courseSpeed: 2000, workWidth_cm: 330 });
  assert.strictEqual(r.engine, 'warp-studio');
  near(r.gsm_estimated, 115, 1, 'the calculator hits the GSM');
  // an E28 locknit front runner is ~150–175 cm/rack (published charmeuse order); the old table gave ~2×
  const run1 = r.calculations.course_length.runner_length_cm_per_rack;
  assert(run1 > 140 && run1 < 185, `front runner ${run1} cm/rack`);
  const old = K.calculateWarpKnitSpecLegacy({ fabricId: 'locknit', denier: 40, gauge: 28, gsm: 115 }).calculations.course_length.runner_length_cm_per_rack;
  assert(old > 1.8 * run1, `legacy ${old} vs ${run1}`);
  // gauge now matters: a finer gauge, a shorter loop
  const fine = K.calculateWarpKnitSpec({ fabricId: 'locknit', denier: 40, gauge: 32, gsm: 115 });
  assert(fine.calculations.course_length.value < r.calculations.course_length.value);
  // GSM only: the denier is solved
  const g = K.calculateWarpKnitSpec({ fabricId: 'tricot_plain', gsm: 100 });
  assert(g.denier_estimated > 25 && g.denier_estimated < 60, `denier ${g.denier_estimated}`);
  near(g.gsm_estimated, 100, 2);
  // every catalogue warp fabric runs, with the fields the result page reads
  for (const id of ['tricot_plain', 'locknit', 'sharkskin_tricot', 'spacer_fabric', 'powernet']) {
    const x = K.calculateWarpKnitSpec({ fabricId: id, gsm: id === 'spacer_fabric' ? 500 : 150 });
    assert(x.engine === 'warp-studio' && x.calculations.stitch_density.courses_per_cm > 0 && x.calculations.course_length.per_bar.bar_1 && x.calculations.yarn_consumption.total_weight_g > 0 && x.calculations.gsm_range, id);
  }
}
console.log('Calculator warp on the studio engine: tests passed');

// yarn cost from the user's prices
{
  const t = W.TEMPLATES.find((x) => x.id === 'swim_tricot');
  const priced = (p0, p1, beams) => W.analyse({ machine: { type: 'tricot', gauge: 28 }, bars: t.bars.map((b, i) => ({ ...b, price: i ? p1 : p0 })), beams, target: { gsm: 190 } });
  const r = priced(6, 18, { residue_pct: 0, waste_pct: 0 });
  // no waste: the yarn per metre is the fabric's mass per metre
  near(r.cost.yarn_kg_per_m, 190 * r.fabric.width_in * 0.0254 / 1000, 0.002, 'yarn per metre = GSM × width');
  near(r.cost.cost_per_m, r.cost.per_bar[0].kg_per_m * 6 + r.cost.per_bar[1].kg_per_m * 18, 0.01);
  near(r.cost.cost_per_kg_fabric * 190 * r.fabric.width_in * 0.0254 / 1000, r.cost.cost_per_m, 0.01, 'cost per kg × kg per metre = cost per metre');
  // waste and what stays on the beam raise it
  assert(priced(6, 18, { residue_pct: 2, waste_pct: 3 }).cost.cost_per_m > r.cost.cost_per_m * 1.04);
  // a price missing on one bar is asked for, not guessed
  assert.deepStrictEqual(W.analyse({ machine: { type: 'tricot', gauge: 28 }, bars: t.bars.map((b, i) => (i ? b : { ...b, price: 6 })), target: { gsm: 190 } }).cost, { missing: [2] });
  assert.strictEqual(W.analyse({ machine: { type: 'tricot', gauge: 28 }, bars: t.bars, target: { gsm: 190 } }).cost, null);
}
console.log('Studio warp cost tests passed');
