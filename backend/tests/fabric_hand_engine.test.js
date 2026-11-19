// Fabric hand engine: the physics numbers of a knit and the hand they give.
'use strict';
const assert = require('assert');
const H = require('../engine/domain/fabric-hand-engine');
const S = require('../engine/domain/fabric-studio');

console.log('--- Running Fabric Hand Tests ---');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const jersey = (o = {}) => H.analyse({ structure: 'jersey', fibres: { cotton: 100 }, count: { value: 30, unit: 'ne' }, spinning: 'combed', ...o });
const fin = (x, path = '') => {
  if (typeof x === 'number') assert(Number.isFinite(x), 'not finite at ' + path);
  else if (Array.isArray(x)) x.forEach((v, i) => fin(v, path + '[' + i + ']'));
  else if (x && typeof x === 'object') Object.keys(x).forEach((k) => fin(x[k], path + '.' + k));
};

// ── 1. a reference jersey lands in the ranges knits have
{
  const r = jersey();
  assert(r.success); fin(r);
  assert(r.bending.wale.value > 0.02 && r.bending.wale.value < 0.09, 'bending along the wales: ' + r.bending.wale.value);
  assert(r.bending.course.value > 0.01 && r.bending.course.value < 0.06, 'bending across: ' + r.bending.course.value);
  assert(r.bending.bending_length.value > 0.9 && r.bending.bending_length.value < 2.2, 'bending length');
  assert(r.shear.G.value > 0.1 && r.shear.G.value < 1.2 && r.shear.HG5.value > r.shear.HG.value, 'shear');
  assert(r.compression.T0.value > 0.35 && r.compression.T0.value < 0.9 && r.compression.Tm.value < r.compression.T0.value, 'thickness');
  assert(r.compression.apparent_density.value > 0.15 && r.compression.apparent_density.value < 0.5, 'apparent density');
  assert(r.compression.RC.value > 35 && r.compression.RC.value < 70 && r.compression.WC.value > 0.05 && r.compression.WC.value < 2, 'compression');
  assert(r.tensile.width.EMT.value > r.tensile.length.EMT.value, 'a jersey stretches more across than along');
  assert(r.tensile.width.LT.value > 0.15 && r.tensile.width.LT.value < 1.2 && r.tensile.width.RT.value > 20 && r.tensile.width.RT.value < 90, 'tensile');
  assert(r.surface.MIU.value > 0.1 && r.surface.MIU.value < 0.5 && r.surface.SMD.value > 1.5 && r.surface.SMD.value < 12, 'surface');
  Object.values(r.hand.scores).forEach((s) => assert(s.score >= 0 && s.score <= 10 && s.word));
  near(r.reference.ratios.bending, 1, 0.03, 'a reference jersey set against itself');
  assert(r.hand.summary.length > 20 && r.hand.use_fit.length === 6 && r.derivations.length >= 8);
  console.log('✓ a 30s cotton jersey: bending, shear, tensile, compression and surface all land in the ranges knits have');
}

// ── 2. the directions each move the right way
{
  const base = jersey();
  const fine = jersey({ count: { value: 50, unit: 'ne' } }), coarse = jersey({ count: { value: 16, unit: 'ne' } });
  assert(fine.bending.wale.value < base.bending.wale.value && base.bending.wale.value < coarse.bending.wale.value, 'a finer yarn bends more easily');
  assert(fine.hand.scores.stiffness.score < coarse.hand.scores.stiffness.score && fine.compression.T0.value < coarse.compression.T0.value);
  const tight = jersey({ loop_mm: 2.3 }), loose = jersey({ loop_mm: 3.5 });
  assert(tight.bending.wale.value > loose.bending.wale.value && tight.shear.G.value > loose.shear.G.value && tight.tensile.width.EMT.value < loose.tensile.width.EMT.value, 'tighter is stiffer and stretches less');
  const wool = jersey({ fibres: { wool: 100 }, count: { value: 20, unit: 'ne' } }), cot = jersey({ count: { value: 20, unit: 'ne' } });
  assert(wool.bending.wale.value > cot.bending.wale.value, 'a coarse wool fibre bends less easily than cotton (d to the fourth)');
  const pes = jersey({ fibres: { polyester: 100 } }), vis = jersey({ fibres: { viscose: 100 } });
  assert(pes.compression.RC.value > vis.compression.RC.value && pes.hand.scores.springiness.score > vis.hand.scores.springiness.score, 'polyester springs back, viscose does not');
  const interlock = jersey({ structure: 'interlock' }), warp = jersey({ structure: 'warp' }), mesh = jersey({ structure: 'mesh' });
  assert(interlock.compression.T0.value > base.compression.T0.value && warp.shear.G.value > 1.5 * base.shear.G.value && mesh.shear.G.value < base.shear.G.value, 'structures: thickness, shear');
  const fleece = jersey({ structure: 'fleece', count: { value: 20, unit: 'ne' }, finish: { brushed: 'back' }, gsm: 280 });
  assert(fleece.compression.T0.value > 1.5 * base.compression.T0.value && fleece.compression.WC.value > 2 * base.compression.WC.value && fleece.hand.scores.fullness.score > base.hand.scores.fullness.score, 'a raised fleece is thick and compressible');
  const soft = jersey({ finish: { chemical: 'silicone' } }), resin = jersey({ finish: { chemical: 'resin' } });
  assert(soft.bending.wale.value < base.bending.wale.value && base.bending.wale.value < resin.bending.wale.value && soft.surface.MIU.value < base.surface.MIU.value && soft.hand.scores.smoothness.score > base.hand.scores.smoothness.score, 'finishes');
  const el = jersey({ elastane_pct: 5 });
  assert(el.tensile.length.EMT.value > base.tensile.length.EMT.value * 0.9 && el.geometry.wales_per_cm > base.geometry.wales_per_cm, 'elastane compacts the cloth');
  console.log('✓ finer is softer, tighter is stiffer, wool bends less than cotton, polyester springs, structures and finishes move the right way');
}

// ── 3. the tensile load, and the cloth that breaks first
{
  const a = jersey({ load_gf_cm: 100 }), b = jersey({ load_gf_cm: 500 });
  assert(a.tensile.width.EMT.value < b.tensile.width.EMT.value, 'a bigger load reaches a bigger stretch');
  assert(a.tensile.width.steps.length === 6 && a.tensile.width.steps[0].stretch_pct < a.tensile.width.steps[5].stretch_pct);
  const weak = H.analyse({ structure: 'jersey', fibres: { cotton: 100 }, count: { value: 120, unit: 'ne' }, spinning: 'combed', load_gf_cm: 500 });
  assert(weak.success && weak.warnings.every((w) => w.text) && Number.isFinite(weak.tensile.width.EMT.value));
  const f = jersey().fast_style;
  near(f.bending_rigidity_uNm, jersey().bending.wale.value * 0 + Math.sqrt(jersey().bending.wale.value * jersey().bending.course.value) * 98.0665, 0.2, 'gf·cm²/cm to µN·m');
  assert(f.extensibility.width.E5 < f.extensibility.width.E20 && f.extensibility.width.E20 < f.extensibility.width.E100);
  console.log('✓ the load sets the stretch, the steps rise, a very fine yarn is still answered, the second tester\'s terms follow');
}

// ── 4. bad input
{
  assert.throws(() => H.analyse({ fibres: { unobtainium: 100 } }), H.HandError);
  assert.throws(() => H.analyse({ fibres: {}, count: { value: 30, unit: 'ne' } }), H.HandError);
  assert(H.analyse({}).success, 'no input at all is a 30s cotton jersey');
  assert(H.analyse({ structure: 'banana', fibres: { cotton: 100 } }).success, 'an unknown structure is a jersey');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const fibs = ['cotton', 'polyester', 'viscose', 'wool', 'acrylic', 'linen', 'silk', 'nylon', 'modal'], strs = ['jersey', 'pique', 'rib', 'interlock', 'purl', 'fleece', 'terry', 'plush', 'mesh', 'warp'], fins = ['none', 'softener', 'silicone', 'resin'];
  for (let i = 0; i < 300; i++) {
    const r = H.analyse({ structure: strs[Math.floor(rnd() * strs.length)], fibres: { [fibs[Math.floor(rnd() * fibs.length)]]: 100 }, count: { value: 8 + rnd() * 70, unit: 'ne' }, loop_mm: rnd() < 0.5 ? 2 + rnd() * 2.4 : undefined, elastane_pct: rnd() < 0.3 ? rnd() * 12 : 0, finish: { chemical: fins[Math.floor(rnd() * 4)], brushed: ['none', 'face', 'back'][Math.floor(rnd() * 3)] }, load_gf_cm: [100, 200, 500][Math.floor(rnd() * 3)] });
    assert(r.success); fin(r);
    Object.values(r.hand.scores).forEach((s) => assert(s.score >= 0 && s.score <= 10));
  }
  console.log('✓ bad input is refused; 300 random cloths come back finite and in 0–10');
}

// ── 5. the Studio
{
  const run = (extra) => S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 150 }, machine: {}, ...extra });
  const plain = run({}), on = run({ hand: { enabled: true } });
  assert(plain.success && plain.hand === null && on.success && on.hand && on.hand.success && on.hand.hand.summary, 'asked only when switched on');
  near(on.hand.geometry.gsm, on.fabric.gsm || 150, 25, 'the hand takes the Studio\'s own weight');
  const soft = run({ hand: { enabled: true, finish: 'silicone' } }), resin = run({ hand: { enabled: true, finish: 'resin' } });
  assert(soft.hand.bending.wale.value < on.hand.bending.wale.value && on.hand.bending.wale.value < resin.hand.bending.wale.value);
  const brushed = run({ hand: { enabled: true }, finish: { brush: 'back' } });
  assert(brushed.hand.identity.finish.brushed === 'back' && brushed.hand.compression.T0.value > on.hand.compression.T0.value, 'brushing in the Studio reaches the hand');
  const withRec = run({ hand: { enabled: true }, recovery: { enabled: true } });
  assert(withRec.hand.success && withRec.recovery, 'the yarn recovery engine feeds the same stretch curve');
  const rib = run({ hand: { enabled: true }, grid: { C: ['K', 'K'], D: ['K', 'K'] }, bed: 'double' });
  assert(rib.success === undefined || rib.hand === null || rib.hand.success !== false, 'a double-bed design is answered');
  const fine = run({ hand: { enabled: true }, yarn: { fibre: 'cotton', type: 'combed', count: 50, unit: 'ne' } });
  near(fine.hand.identity.yarn.count_ne, 50, 0.6, 'the count the Studio settled on is the one used');
  assert(fine.hand.compression.T0.value < on.hand.compression.T0.value, 'a finer yarn is a thinner cloth');
  console.log('✓ in the Studio: asked when switched on, finish and raising and the yarn recovery all reach it');
}

console.log('Fabric hand tests passed');
