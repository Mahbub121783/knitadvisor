// Composition solver: the Studio run backwards from a fibre composition (composition-solver.js).
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const CS = require('../engine/domain/composition-solver');
const DNA = require('../engine/domain/fabric-dna');

console.log('--- Running Composition Solver Tests ---');
const tpl = (id, extra) => {
  const t = S.listTemplates().find((x) => x.id === id);
  return { bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })), yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: Math.round((t.gsm_range.min + t.gsm_range.max) / 2) }, machine: {}, ...(extra || {}) };
};
const solveOn = (id, composition, roles) => { const i = tpl(id); i.target.composition = composition; if (roles) i.target.composition_roles = roles; return S.analyse(i); };

{
  // elastane: the share asked for is the share knitted, with a draft inside the window, on single jersey, rib and interlock
  for (const id of ['single_jersey', 'rib_1x1', 'interlock'])
    for (const pct of [2, 3, 5, 8, 12]) {
      const r = solveOn(id, { cotton: 100 - pct, elastane: pct });
      assert(r.success, `${id} ${pct}: ${r.error}`);
      const c = r.composition_solve;
      assert(c.largest_miss_pts <= 0.5, `${id} ${pct} % elastane: miss ${c.largest_miss_pts}`);
      const e = c.solved.elastane;
      assert(e.draft >= CS.DRAFT_MIN && e.draft <= CS.DRAFT_MAX, `${id} ${pct}: draft ${e.draft}`);
      assert(r.fabric.gsm > 0 && Math.abs(r.fabric.gsm / tpl(id).target.gsm - 1) < 0.02, 'the weight stays on target');
    }
  console.log('✓ elastane: 2–12 % on jersey, rib and interlock lands within half a point, the draft inside 2.0–4.2, the weight unchanged');
}
{
  // text, ISO short codes, blends
  let r = S.analyse({ ...tpl('single_jersey'), target: { gsm: 180, composition: '95% CO 5% EL' } });
  assert(r.success && r.composition_solve.achieved.cotton === 95 && r.composition_solve.achieved.elastane === 5);
  r = S.analyse({ ...tpl('single_jersey'), target: { gsm: 180, composition: '55% cotton 40% polyester 5% elastane' } });
  assert(r.success && Math.abs(r.composition_solve.achieved.polyester - 40) <= 0.5 && Math.abs(r.composition_solve.achieved.cotton - 55) <= 0.5);
  r = solveOn('single_jersey', { cotton: 70, viscose: 30 });
  assert(r.success && r.composition_solve.achieved.viscose === 30);
  r = solveOn('single_jersey', { tencel: 100 });
  assert(r.success && r.composition_solve.achieved.tencel === 100, 'a fibre with no Studio key goes in as a blend');
  console.log('✓ "95% CO 5% EL", a three-fibre text, a cotton/viscose mix and tencel are all knitted as written');
}
{
  // per-role fibres: the count of the minor fibre's yarn is solved
  const r = solveOn('fleece_3_thread', { cotton: 75, polyester: 25 }, { face: 'cotton', binder: 'cotton', loop: 'polyester' });
  assert(r.success, r.error);
  const c = r.composition_solve;
  assert(c.largest_miss_pts <= 0.5, `fleece roles: miss ${c.largest_miss_pts}`);
  assert(c.solved.roles.cotton.kept && c.solved.roles.cotton.count_ne[0] === 30, 'the largest fibre keeps the count given');
  assert(c.solved.roles.polyester.roles.join() === 'loop' && c.solved.roles.polyester.count_tex[0] > 0);
  const r2 = solveOn('fleece_3_thread', { cotton: 60, polyester: 35, elastane: 5 }, { face: 'cotton', binder: 'cotton', loop: 'polyester' });
  assert(r2.success && r2.composition_solve.largest_miss_pts <= 0.5 && r2.composition_solve.solved.elastane);
  // one blend in every yarn on a fleece: the assumed loop yarn is spun of the same blend
  const r3 = solveOn('fleece_3_thread', { cotton: 65, polyester: 35 });
  assert(r3.success && r3.composition_solve.largest_miss_pts <= 0.5, `fleece one blend: ${r3.composition_solve.largest_miss_pts}`);
  console.log('✓ fleece: the loop yarn\'s count is solved for 75/25 cotton/polyester by role, with elastane on top, and one blend through every yarn also holds');
}
{
  // refusals in words
  const bad = (c, roles, re) => { const r = solveOn('single_jersey', c, roles); assert(!r.success && re.test(r.error), String(r.error)); };
  bad({ cotton: 60, polyester: 30 }, null, /adds to 90/);
  bad('95% cotton 5% xyz', null, /xyz/);
  bad({ cotton: 60, kryptonite: 40 }, null, /kryptonite/);
  bad({ elastane: 100 }, null, /elastane/);
  bad({ cotton: 60, elastane: 40 }, null, /elastane/);
  bad({ cotton: 50, polyester: 50 }, { ground: 'cotton' }, /polyester/);
  const i = tpl('single_jersey', { blend: { ground: { fibres: { cotton: 60, polyester: 40 } } } }); i.target.composition = { cotton: 100 };
  const r = S.analyse(i); assert(!r.success && /blend/.test(r.error));
  console.log('✓ a total off 100, an unknown fibre, an elastane-only or 40 % elastane cloth, a fibre no role carries, and a clash with the blend card are each refused in words');
}
{
  // the solved design is what the DNA writes
  const i = tpl('single_jersey'); i.target.composition = { cotton: 95, elastane: 5 };
  const out = S.analyse(i), d = DNA.toDNA(i, out);
  assert(d.yarns.some((y) => /elastane/i.test(y.label)) && d.yarns.find((y) => y.elastaneDraftRatio !== undefined || /elastane/i.test(y.label)));
  // the ordinary path is untouched: no target composition, no report
  const plain = S.analyse(tpl('single_jersey'));
  assert(plain.success && plain.composition_solve === undefined);
  console.log('✓ the DNA carries the solved elastane; a design without a composition target is analysed as before');
}
console.log('Composition solver tests passed');
