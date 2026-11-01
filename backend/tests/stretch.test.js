// Stretch engine — load–extension, recovery, growth, grain under load, gaps.
const assert = require('assert');
const { analyzeStretch, kindOf, fibreRecovery } = require('../engine/domain/stretch-engine');
const { calculate } = require('../engine');

console.log('--- Running Stretch Engine Tests ---');

const S = (fibers, extra = {}) => analyzeStretch({
  fabricId: 'single_jersey', category: 'single_jersey', loopMm: 2.7, countNe: 30, fibers, rkm: 15, spiralityPct: 3, ...extra,
});
const at = (curve, e) => curve.find((c) => c.e >= e) || curve[curve.length - 1];

// 1. structures map to the right model
{
  assert.strictEqual(kindOf('rib_2x1', 'rib'), 'rib');
  assert.strictEqual(kindOf('full_milano', 'rib'), 'interlock');
  assert.strictEqual(kindOf('french_terry', 'single_jersey'), 'terry');
  assert.strictEqual(kindOf('terry_fabric'), 'plush');
  assert.strictEqual(kindOf('fleece_3_thread', 'single_jersey'), 'fleece');
  assert.strictEqual(kindOf('lacoste_single', 'single_jersey'), 'pique');
  assert.strictEqual(kindOf('tricot_plain', 'warp_knit'), 'warp');
  assert.strictEqual(kindOf('single_jersey', 'single_jersey'), 'jersey');
}

// 2. the J-curve: soft, then a wall at the jam; monotonic; stages in order
{
  const W = S({ cotton: 100 }).directions.width;
  const c = W.curve;
  for (let i = 1; i < c.length; i++) assert(c[i].t >= c[i - 1].t, 'load never falls as the stretch rises');
  const half = at(c, W.jam_pct / 2), jam = at(c, W.jam_pct), past = c[c.length - 1];
  assert(half.t < jam.t / 5, `half-way to the jam the loops carry a fraction of the jam load (${half.t} vs ${jam.t} N/m)`);
  assert(past.t > jam.t * 3, 'past the jam the yarn itself carries the load: the wall');
  const order = ['loops', 'tightening', 'jammed', 'damage', 'break'];
  const seen = c.map((x) => order.indexOf(x.stage));
  for (let i = 1; i < seen.length; i++) assert(seen[i] >= seen[i - 1], 'stages only go forward');
  assert(W.break_pct > W.jam_pct, 'it breaks after it jams');
}

// 3. a jersey goes further across than along; a rib much further across
{
  const J = S({ cotton: 100 }).directions;
  assert(J.width.jam_pct > J.length.jam_pct * 1.5, `jersey: width ${J.width.jam_pct}% vs length ${J.length.jam_pct}%`);
  const R = analyzeStretch({ fabricId: 'rib_1x1', category: 'rib', loopMm: 2.7, countNe: 30, fibers: { cotton: 100 }, rkm: 15 }).directions;
  assert(R.width.jam_pct > J.width.jam_pct * 1.6, `1x1 rib opens its purl wales: ${R.width.jam_pct}% vs jersey ${J.width.jam_pct}%`);
  const I = analyzeStretch({ fabricId: 'interlock', category: 'interlock', loopMm: 2.7, countNe: 30, fibers: { cotton: 100 }, rkm: 15 }).directions;
  assert(I.width.standard.form.stretch_pct < J.width.standard.form.stretch_pct, 'interlock stretches less than jersey at the same load');
  // a tighter knit has less reserve
  const tight = S({ cotton: 100 }, { loopMm: 2.3 }).directions.width.jam_pct;
  assert(tight < J.width.jam_pct, `shorter loop, less reserve: ${tight}% vs ${J.width.jam_pct}%`);
}

// 4. recovery: cotton grows, elastane comes back, synthetics in between
{
  const cot = S({ cotton: 100 }), el = S({ cotton: 95, elastane: 5 }, { lycraDenier: 40, feedType: 'half_feed' }), pes = S({ polyester: 100 });
  const g = (r, e) => at(r.directions.width.curve, e).g;
  assert(g(cot, 50) > g(pes, 50), `polyester springs back better than cotton (${g(pes, 50)} vs ${g(cot, 50)}%)`);
  assert(g(el, 50) < g(cot, 50) / 3, `5 % elastane cuts the growth at 50 % stretch to under a third (${g(el, 50)} vs ${g(cot, 50)}%)`);
  assert(el.directions.width.jam_pct > cot.directions.width.jam_pct, 'elastane compacts the cloth: more reserve before the wall');
  assert(el.geometry.elastane_compaction_pct > 10 && el.geometry.elastane_compaction_pct < 16, 'about an eighth tighter each way at 5 %');
  // past the jam the fibre's own recovery takes over: much more stays
  const c = cot.directions.width.curve, j = cot.directions.width.jam_pct;
  const before = at(c, j * 0.9), after = c[c.length - 3];
  assert(after.ys > before.ys * 3, 'yarn strain climbs past the jam');
  // the hold and the rest matter as the growth test says
  const r = at(c, 60);
  assert(r.g60 > r.g && r.g1h < r.g60 && r.gw < r.g1h, 'held 2 h grows more; an hour\'s rest and a wash give some back');
  assert(r.g1hq < r.g, 'a quick pull also recovers more over an hour');
  const std = cot.directions.width.standard;
  assert(std.loose.stretch_pct < std.form.stretch_pct, 'the heavier ASTM D2594 load stretches it further');
  assert(std.growth && std.growth.after_1h_pct < std.growth.after_60s_pct, 'D2594 growth falls between 1 min and 1 h');
}

// 5. fibre recovery is the measured one, interpolated
{
  const rec = { e1: 91, e5: 52, e10: 40 };
  assert.strictEqual(fibreRecovery(rec, 0), 100);
  assert.strictEqual(fibreRecovery(rec, 0.01), 91);
  assert.strictEqual(fibreRecovery(rec, 0.05), 52);
  assert(Math.abs(fibreRecovery(rec, 0.03) - 71.5) < 1e-6);
  const r = S({ modal: 100 });
  assert(r.fibre_recovery.proxies.some((p) => p.fibre === 'modal' && p.uses === 'viscose'), 'an unmeasured fibre names what stands in for it');
}

// 6. grain and gaps
{
  const c = S({ cotton: 100 }).directions.width.curve;
  const rest = c[0], mid = at(c, 60);
  assert(mid.skew > rest.skew, 'a stretch across rotates the existing lean further');
  assert(mid.perp < 0, 'the cloth narrows across the pull');
  assert(mid.open > rest.open, 'gaps open');
  const W = S({ cotton: 100 }).directions.width;
  assert(W.gape_onset_pct != null && W.gape_onset_pct < W.break_pct, 'see-through starts before the break');
  const noSp = S({ cotton: 100 }, { spiralityPct: 0 }).directions.width.curve[0].skew;
  assert.strictEqual(noSp, 0, 'no spirality, no lean at rest');
  const fl = analyzeStretch({ fabricId: 'fleece_3_thread', loopMm: 4.4, countNe: 30, fibers: { cotton: 100 }, rkm: 15 });
  assert(fl.rest.open_pct < S({ cotton: 100 }).rest.open_pct, 'a fleece back closes the cloth');
}

// 7. through calculate(): every fabric family returns a stretch block, no source names
{
  for (const [fabric, comp, gsm] of [['single_jersey', '100% Cotton', 160], ['single_jersey', '92% Cotton 8% Elastane', 200], ['rib_1x1', '100% Cotton', 220], ['interlock', '100% Cotton', 220], ['fleece_3_thread', '80% Cotton 20% Polyester', 300], ['french_terry', '100% Cotton', 280], ['terry_fabric', '100% Cotton', 400], ['lacoste_single', '100% Cotton', 220], ['tricot_plain', '100% Polyester', 140]]) {
    const r = calculate({ fabric, gsm, composition: comp, efficiency: 85 });
    const s = r.stretch;
    assert(s && s.ok, `${fabric}: stretch block present`);
    for (const d of ['width', 'length']) {
      const D = s.directions[d];
      assert(D.curve.length === 49 && D.curve.every((x) => Number.isFinite(x.t) && Number.isFinite(x.g)), `${fabric} ${d}: a full, finite curve`);
      assert(D.break_pct > 5 && D.break_pct < 400, `${fabric} ${d}: break ${D.break_pct}% is plausible`);
    }
    const txt = JSON.stringify(s);
    assert(!/Hearle|Munden|Doyle|Chowdhury|Eltahan|GardenTex|textilelearner/i.test(txt), `${fabric}: no source attribution in the API`);
  }
  const hp = calculate({ fabric: 'single_jersey', gsm: 200, composition: '90% Nylon 10% Elastane', efficiency: 85 }).stretch;
  assert(/D4964/.test(hp.po_spec.standard), 'high-power stretch is specified to ASTM D4964');
  console.log(`  Cotton jersey across: ${S({ cotton: 100 }).directions.width.standard.form.stretch_pct}% at the D2594 body-fit load; 1x1 rib jam ${analyzeStretch({ fabricId: 'rib_1x1', category: 'rib', loopMm: 2.7, countNe: 30, fibers: { cotton: 100 }, rkm: 15 }).directions.width.jam_pct}%`);
}

console.log('\nAll stretch tests passed.');
