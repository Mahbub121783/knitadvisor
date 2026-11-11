// Parts 3–5 — machine, stitch formation, consumption: each number from its law, and checked against the parts already in use.
const assert = require('assert');
console.log('--- Running Knitting Parts (machine, formation, consumption) Tests ---');
const G = require('../engine/domain/stitch-graph');
const M = require('../engine/domain/materials');
const P = require('../engine/domain/knitting-parts');
const KF = require('../engine/domain/knit-formation');
const F = require('../engine/domain/fabric-studio');
const Wp = require('../engine/domain/warp-studio');
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol * Math.abs(b), `${what}: ${a} vs ${b}`);

const y30 = M.yarn({ count: 30, unit: 'ne', spinning: 'combed' });
const tpl = (id) => F.listTemplates().find((t) => t.id === id);
const graphOf = (t) => G.fromDesign({ grid: t.grid, gating: t.gating, feeds: t.roles.map((r) => ({ role: r })) });

// PART 3 — the machine: pitch, needles, speeds by law; what was not given is typical and says so
const gJ = graphOf(tpl('single_jersey'));
const mJ = P.machine({ gauge: 24, dia: 30 }, gJ);
near(mJ.pitch.value, 25.4 / 24, 2e-3, 'pitch'); assert.strictEqual(mJ.needles.value, Math.round(Math.PI * 30 * 24));
assert.strictEqual(mJ.rpm.basis, 'typical'); assert.strictEqual(P.machine({ gauge: 24, dia: 30, rpm: 28 }, gJ).rpm.basis, 'measured');
near(mJ.surface_speed.value, Math.PI * 30 * 25.4 * mJ.rpm.value / 60000, 1e-3, 'surface speed');
near(mJ.needle_speed.value, mJ.surface_speed.value * Math.tan(50 * Math.PI / 180), 1e-3, 'needle speed on a 50° cam');
assert(mJ.feeders.value % gJ.period.courses === 0, 'feeders: a whole number of repeats');
assert.throws(() => P.machine({ dia: 30 }, gJ), P.PartError);
const gW = G.fromWarp({ machine: { type: 'tricot' }, bars: [{ notation: '1-0/2-3//' }, { notation: '1-2/1-0//' }] });
const mW = P.machine({ gauge: 28, type: 'tricot' }, gW);
assert.strictEqual(mW.bars, 2); assert.strictEqual(mW.needles.value, Math.round(130 * 28)); assert(mW.shog_limit.value > 0);

// PART 4 — formation: the depth forms the loop asked for; tension builds by capstan; held loops fill the hook
const fJ = P.formation(gJ, y30, mJ, { sl_mm: 2.7 });
const r0 = fJ.feeds[0];
const g = KF.geometry(false, 'single', 24, y30.diameter.value, 0.5);
near(KF.loopAt(r0.knock_over_depth.value, g), 2.7 * (1 + KF.CONST.FORM_OVER), 1e-3, 'the knock-over depth forms the loop');
assert(r0.peak_tension.value > 5 && r0.peak_tension.value < 30, `knitting tension ${r0.peak_tension.value} cN: the 10–30 cN a 30s jersey runs at`);
assert(r0.safety.value > 6, 'a jersey runs well inside the yarn\'s strength');
assert(P.formation(gJ, y30, mJ, { sl_mm: 3.2 }).feeds[0].knock_over_depth.value > r0.knock_over_depth.value, 'a longer loop needs a deeper knock-over');
const unwaxed = M.yarn({ count: 30, unit: 'ne', spinning: 'combed', waxed: false });
assert(P.formation(gJ, unwaxed, mJ, { sl_mm: 2.7 }).feeds[0].peak_tension.value > r0.peak_tension.value, 'an unwaxed yarn drags harder');
assert(P.formation(gJ, y30, P.machine({ gauge: 24, dia: 30, feed: 'storage' }, gJ), { sl_mm: 2.7 }).feeds[0].peak_tension.value > r0.peak_tension.value, 'a storage feed robs back: more tension');
const gP = graphOf(tpl('pique_single')), fP = P.formation(gP, y30, P.machine({ gauge: 24, dia: 30 }, gP), { sl_mm: 2.7 });
assert(Math.max(...fP.feeds.map((f) => f.hook_fill.value)) > r0.hook_fill.value, 'tucks hold more yarn in the hook');
assert.strictEqual(P.heldAt(gP, 'C1', 2), 3, 'at feed 3 the piqué needle holds its loop and two tucks');
const thick = M.yarn({ count: 8, unit: 'ne', spinning: 'carded' });
assert(P.formation(gJ, thick, P.machine({ gauge: 32, dia: 30 }, gJ), { sl_mm: 1.6 }).checks.some((c) => c.code === 'loop_too_short'), 'a thick yarn cannot make a short loop on a fine gauge');
// across the whole catalogue at a usual setting: nothing the machine cannot do
for (const t of F.listTemplates()) {
  const gr = graphOf(t);
  const fo = P.formation(gr, y30, P.machine({ gauge: 24, dia: 30 }, gr), { sl_mm: 2.7 });
  assert(!fo.checks.some((c) => c.level === 'error'), `${t.id}: ${fo.checks.filter((c) => c.level === 'error').map((c) => c.text).join(' ')}`);
}
// warp: a bar that shogs further than the machine moves is refused
const fW = P.formation(G.fromWarp({ machine: { type: 'tricot' }, bars: [{ notation: '1-0/8-9//' }] }), y30, mW, null);
assert(fW.checks.some((c) => c.code === 'shog'));
assert.strictEqual(P.formation(gW, y30, mW, null).bars[1].laps.closed, 2, 'the back bar 1-2/1-0 laps closed every course');

// PART 5 — consumption: a knit is the loop set, a tuck about 0.7 of it, a float the straight run across the needles it misses
const cJ = P.consumption(gJ, y30, mJ, { sl_mm: 2.7 });
near(cJ.feeds[0].course_length.value, 2.7 * mJ.needles.value / 1000, 2e-3, 'jersey: loop × needles');
const cP = P.consumption(gP, y30, P.machine({ gauge: 24, dia: 30 }, gP), { sl_mm: 2.7 });
near(cP.feeds[0].per_repeat.value, 2.7 + 0.7 * 2.7, 2e-3, 'piqué feed: a knit and a tuck');
const gM = G.fromDesign({ grid: { C: ['KM', 'MK'] }, feeds: [{}, {}] });
near(P.consumption(gM, y30, P.machine({ gauge: 24, dia: 30 }, gM), { sl_mm: 2.7 }).feeds[0].per_repeat.value, 2.7 + 25.4 / 24, 2e-3, 'a one-needle float runs one pitch');
// against the Studio's own course lengths: the same wherever there is no single-bed float (where the float rule differs)
for (const t of F.listTemplates()) {
  const o = F.analyse({ bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })), yarn: { count: 30, unit: 'ne', fibre: 'cotton' }, machine: { gauge: 24, dia: 30, sl_mm: 2.7 }, target: {} });
  if (!o.success || o.plush) continue;
  const gr = graphOf(t);
  const floats = gr.passes.some((x) => x.spans.some((s) => s.kind === 'float'));
  const cs = P.consumption(gr, y30, P.machine({ gauge: 24, dia: 30 }, gr), { sl_mm: o.fabric.sl_mm });
  if (floats || o.yarn.feeds.length !== cs.feeds.length || o.yarn.feeds.some((f) => Math.abs(f.sl_mm - o.fabric.sl_mm) > 1e-9)) continue;
  o.yarn.feeds.forEach((f, i) => near(cs.feeds[i].course_length.value, f.course_length_m, 0.005, `${t.id} feed ${i + 1} course length`));
}
// warp: the runner from the graph equals the warp studio's own
for (const t of Wp.TEMPLATES.filter((x) => x.machine !== 'double_raschel')) {
  const gr = G.fromWarp({ machine: { type: t.machine, notation_step: t.notation_step }, bars: t.bars });
  const yarns = t.bars.map((b) => ({ diameter: { value: 0.06 } }));
  const cs = P.consumption(gr, yarns, P.machine({ gauge: t.gauge, type: t.machine }, gr), null, { cpc: 20 });
  t.bars.forEach((b, i) => {
    const pairs = Wp.parseNotation(b.notation, i + 1, { step: t.notation_step === 2 ? 2 : 1 });
    near(cs.bars[i].per_course.value, Wp.courseLength(Wp.lapping(pairs), 25.4 / t.gauge, 0.5, 0.06), 2e-3, `${t.id} bar ${i + 1}`);
  });
}
// elastane is delivered short by its draft
const gE = G.fromWeft({ grid: { C: ['K'] }, feeds: [{}], elastane: { every: 'all' } });
const cE = P.consumption(gE, y30, P.machine({ gauge: 24, dia: 30 }, gE), { sl_mm: 2.7 }, { draft: 3 });
near(cE.feeds[0].elastane_delivered.value, cE.feeds[0].course_length.value / 3, 2e-3, 'elastane ÷ draft');
assert.throws(() => P.consumption(gW, y30, mW, null, {}), P.PartError, 'warp needs the courses per cm');
console.log('Knitting parts tests passed');
