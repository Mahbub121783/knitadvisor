// Drape (the cloth hung from its own hand numbers) and the water drop (contact angle, spray rating, roll-off).
'use strict';
const assert = require('assert');
const D = require('../engine/domain/drape-engine');
const R = require('../engine/domain/repellency-engine');
const S = require('../engine/domain/fabric-studio');

console.log('--- Running Drape and Repellency Tests ---');
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m || ''} ${a} vs ${b} (±${tol})`);
const jersey = (extra) => S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 160 }, machine: {}, hand: { enabled: true }, ...(extra || {}) });
const dc = (p) => D.analyse(p).drape_coefficient.value;

{
  // the cloth is hung from the hand engine's own numbers
  const r = jersey();
  const p = D.fromHand(r.hand, 'cusick');
  assert.strictEqual(p.gsm, r.hand.geometry.gsm); assert.strictEqual(p.B_wale, r.hand.bending.wale.value); assert.strictEqual(p.G, r.hand.shear.G.value);
  assert.strictEqual(p.EMT_course, r.hand.tensile.width.EMT.value);
  assert.throws(() => D.fromHand(null), /hand numbers/);
  const t = Date.now();
  const d = D.analyse(p);
  const ms = Date.now() - t;
  assert(d.success && d.test === 'cusick');
  assert(d.drape_coefficient.value > 20 && d.drape_coefficient.value < 80, `a cotton jersey drapes in the middle of the scale (${d.drape_coefficient.value})`);
  assert(d.drape_coefficient.range[0] <= d.drape_coefficient.value && d.drape_coefficient.range[1] >= d.drape_coefficient.value);
  assert(d.folds.nodes >= 3 && d.folds.nodes <= 12, `folds ${d.folds.nodes}`);
  assert.strictEqual(d.sample.diameter_cm, 30); assert.strictEqual(d.sample.support_cm, 18);
  assert(d.mesh.x.length === d.sample.particles && d.outline.length === 60);
  assert(ms < 6000, `a drape takes about a second, not ${ms} ms`);
  console.log('✓ a cotton jersey hung from its hand numbers: DC', d.drape_coefficient.value, '% (' + d.drape_coefficient.range.join('–') + '), nodes', d.folds.nodes, ',', ms, 'ms');
}
{
  // the order of cloths: limp < jersey < stiff < board; a softener lowers it, a resin finish raises it
  const limp = dc({ gsm: 90, B_course: 0.004, B_wale: 0.004, G: 0.05, EMT_course: 40, EMT_wale: 30 });
  const soft = D.analyse(D.fromHand(jersey({ hand: { enabled: true, finish: 'silicone' } }).hand)).drape_coefficient.value;
  const plain = D.analyse(D.fromHand(jersey().hand)).drape_coefficient.value;
  const resin = D.analyse(D.fromHand(jersey({ hand: { enabled: true, finish: 'resin' } }).hand)).drape_coefficient.value;
  const stiff = dc({ gsm: 300, B_course: 2.5, B_wale: 2.5, G: 2, EMT_course: 5, EMT_wale: 4 });
  const board = dc({ gsm: 400, B_course: 20, B_wale: 20, G: 5, EMT_course: 2, EMT_wale: 2 });
  assert(limp < soft && soft < plain && plain < resin, `limp ${limp} < silicone ${soft} < plain ${plain} < resin ${resin}`);
  assert(resin < stiff && stiff < board + 1, `resin ${resin} < stiff ${stiff} ≤ board ${board}`);
  assert(limp < 45 && board > 85, 'a limp silk is limp and a board stands');
  console.log('✓ drape coefficient order: limp', limp, '< silicone', soft, '< plain', plain, '< resin', resin, '< stiff', stiff, '≤ board', board);
}
{
  // heavier at the same stiffness drapes more; seeded; folds fewer when stiffer
  const base = { gsm: 160, B_course: 0.05, B_wale: 0.05, G: 0.4, EMT_course: 20, EMT_wale: 15 };
  assert(dc({ ...base, gsm: 400 }) < dc(base), 'a heavier cloth of the same stiffness hangs more');
  assert.strictEqual(dc(base), dc(base), 'the same cloth hangs the same way');
  const stiff = D.analyse({ ...base, B_course: 3, B_wale: 3 });
  assert(stiff.folds.nodes <= D.analyse(base).folds.nodes + 1, 'a stiffer cloth has fewer folds');
  // anisotropy: stiffer along the wales than across changes the fold pattern but stays between the two isotropic cases
  const iso1 = dc({ ...base, B_course: 0.02, B_wale: 0.02 }), iso2 = dc({ ...base, B_course: 0.2, B_wale: 0.2 }), aniso = dc({ ...base, B_course: 0.02, B_wale: 0.2 });
  assert(aniso > iso1 - 3 && aniso < iso2 + 3, `anisotropic ${aniso} between ${iso1} and ${iso2}`);
  console.log('✓ drape: heavier drapes more, stiffer has fewer folds, seeded, an anisotropic cloth sits between its two stiffnesses');
}
{
  // the cantilever law the solver is built on: a clamped strip droops by w L⁴ ÷ 8B — checked through the sample's hang (a stiff board stays near flat)
  const board = D.simulate({ gsm: 400, B_course: 20, B_wale: 20, G: 5, EMT_course: 2, EMT_wale: 2 });
  let zmin = 0; for (let k = 0; k < board.N; k++) zmin = Math.min(zmin, board.X[3 * k + 2]);
  assert(-zmin < 0.05, `a board with a 6 cm overhang droops under 5 cm (${(-zmin * 100).toFixed(1)})`);
  const rag = D.simulate({ gsm: 90, B_course: 0.004, B_wale: 0.004, G: 0.05, EMT_course: 40, EMT_wale: 30 });
  let zr = 0; for (let k = 0; k < rag.N; k++) zr = Math.min(zr, rag.X[3 * k + 2]);
  assert(-zr > 0.05, `a limp cloth hangs down the side of the discs (${(-zr * 100).toFixed(1)} cm)`);
  // the cloth does not go through the discs
  for (let k = 0; k < rag.N; k++) if (rag.X[3 * k + 2] < -1e-3) assert(Math.hypot(rag.X[3 * k], rag.X[3 * k + 1]) >= rag.Rd - 1e-3, 'hangs outside the disc');
  console.log('✓ the solver: a board stays near flat, a limp cloth hangs down the side and never through the discs');
}
{
  // the skirt
  const p = D.fromHand(jersey().hand, 'skirt');
  const t = Date.now();
  const s = D.analyse(p);
  assert(s.success && s.test === 'skirt' && s.skirt && !s.drape_coefficient);
  assert.strictEqual(s.skirt.hem_flat_radius_cm, 55);
  assert(s.skirt.hem_sweep_ratio > 0.1 && s.skirt.hem_sweep_ratio < 1, 'the hem sweeps in from its flat radius');
  assert(s.skirt.hem_drop_cm > 30, `it hangs down (${s.skirt.hem_drop_cm} cm)`);
  const stiff = D.analyse({ ...p, B_course: 2.5, B_wale: 2.5, gsm: 300 });
  assert(stiff.skirt.hem_sweep_ratio > s.skirt.hem_sweep_ratio, 'a stiffer skirt flares further from the body');
  console.log('✓ a circular skirt: hem sweep', s.skirt.hem_sweep_ratio, 'of its flat radius; a stiff one flares to', stiff.skirt.hem_sweep_ratio, ';', Date.now() - t, 'ms for both');
  assert.throws(() => D.analyse({ gsm: 100 }), /bending rigidity/);
}
{
  // repellency: Cassie–Baxter and Wenzel
  const open = 0.05;
  const raw = (fibres, finish, o) => R.analyse({ fibres, open_rest: o == null ? open : o, open_20: (o == null ? open : o) * 1.8, finish });
  const cot = raw({ cotton: 100 }, 'none'), pet = raw({ polyester: 100 }, 'none'), petC6 = raw({ polyester: 100 }, 'c6'), petC0 = raw({ polyester: 100 }, 'c0'), cotC6 = raw({ cotton: 100 }, 'c6');
  assert(cot.contact_angle.value < 10 && cot.wicks, 'a scoured cotton wicks');
  assert(pet.contact_angle.value > 30 && pet.contact_angle.value < 90, 'untreated polyester is wettable');
  assert(petC6.contact_angle.value > 125 && petC6.contact_angle.value > petC0.contact_angle.value && petC0.contact_angle.value > pet.contact_angle.value, `C6 ${petC6.contact_angle.value} > C0 ${petC0.contact_angle.value} > none ${pet.contact_angle.value}`);
  near(cotC6.contact_angle.value, petC6.contact_angle.value, 0.5, 'the finish sets the surface: the fibre underneath does not matter');
  assert(petC6.spray_rating.value >= 90 && pet.spray_rating.value === 0, 'spray rating: C6 ≥ 90, bare polyester 0');
  assert(petC6.roll_off.value != null && petC6.roll_off.value < 20 && !petC6.roll_off.sticks, 'a drop rolls off a C6 finish at a small tilt');
  assert(pet.roll_off.value === null && pet.roll_off.sticks, 'a drop does not roll off a wetting surface');
  // Cassie–Baxter by hand: f = 0.45 × 0.95 = 0.4275; cos θ = f (cos 118° + 1) − 1
  const f = 0.4275, th = (Math.acos(f * (Math.cos(118 * Math.PI / 180) + 1) - 1) * 180) / Math.PI;
  near(petC6.contact_angle.value, th, 0.2, 'Cassie–Baxter');
  // more air under the drop raises the angle; a tight cloth lowers it
  const loose = raw({ polyester: 100 }, 'c6', 0.2), tight = raw({ polyester: 100 }, 'c6', 0.0);
  assert(loose.contact_angle.value > petC6.contact_angle.value && petC6.contact_angle.value > tight.contact_angle.value);
  assert(tight.warnings.some((w) => /too little air|only/.test(w.text)) || tight.contact_angle.value >= 110);
  // a hydrophilic softener makes any cloth wick
  assert(raw({ polyester: 100 }, 'hydrophilic').wicks);
  // polypropylene is hydrophobic by itself
  assert(raw({ polypropylene: 100 }, 'none').contact_angle.value > 100);
  assert(R.catalogue().finishes.length === 4);
  console.log('✓ the drop: cotton wicks, polyester + C6 beads at', petC6.contact_angle.value + '° (spray', petC6.spray_rating.value + ', rolls off at', petC6.roll_off.value + '°); Cassie–Baxter checked by hand');
}
{
  // in the Studio: only on request; the finish chosen sets it; the open area is the cloth's own
  const off = jersey();
  assert.strictEqual(off.repel, null);
  const pet = (dwr) => jersey({ yarn: { fibre: 'polyester_spun', type: 'combed', count: 30, unit: 'ne' }, drape: { enabled: true, dwr } });
  assert(pet('c6').repel.contact_angle.value > pet('none').repel.contact_angle.value + 40);
  assert(pet('c6').repel.spray_rating.value >= 90);
  const loose = jersey({ yarn: { fibre: 'polyester_spun', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 110 }, drape: { enabled: true, dwr: 'c6' } }), tight = jersey({ yarn: { fibre: 'polyester_spun', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 260 }, drape: { enabled: true, dwr: 'c6' } });
  assert(loose.repel.contact_angle.value >= tight.repel.contact_angle.value, 'a lighter, more open jersey carries a higher angle');
  console.log('✓ in the Studio: off by default; C6 on a polyester jersey', pet('c6').repel.contact_angle.value + '° against', pet('none').repel.contact_angle.value + '° untreated');
}
console.log('Drape and repellency tests passed');
