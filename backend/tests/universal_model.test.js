// The universal loop model: any weft construction designed from its needle diagram — counts, stitch lengths and gauge the
// laws and the fitted constants give, weighed to the target — and the work orders only for the accounts allowed them.
'use strict';
const assert = require('assert');
const U = require('../engine/domain/universal-model');
const { modelFor } = require('../engine/domain/universal-apply');
const ACC = require('../engine/domain/recipe-access');
const S = require('../engine/domain/fabric-studio');
const E = require('../engine');

console.log('--- Running Universal Model Tests ---');
// the constants are private (fitted from the mill's orders): a checkout without them has nothing to test here
if (!U.model().ok) { console.log('Universal model tests skipped: data/universal-model.json is not on this machine'); process.exit(0); }
const T = S.listTemplates();
const t = (id) => T.find((x) => x.id === id);
const diag = (id) => U.diagram({ C: t(id).grid.C, D: t(id).grid.D, roles: t(id).roles, gating: t(id).gating });
{
  const j = diag('single_jersey'), i = diag('interlock'), r = diag('rib_2x2'), f = diag('fleece_3_thread');
  assert(j.wales === 1 && j.L === 1 && !j.double);
  assert(i.interlock === 1 && i.wales === 1, 'interlock beds stand back to back');
  assert(r.out > 0.3 && f.inlay === 1 && f.binder === 1);
  console.log('✓ the diagram is read: wales, loops per wale, needles out, laid-in and binder yarns');
}
{
  const sj = modelFor({ C: t('single_jersey').grid.C, roles: ['ground'], gsm: 180, fabricId: 'single_jersey' });
  assert(sj.face.ne >= 22 && sj.face.ne <= 26 && Math.abs(sj.sl[0] - 2.8) < 0.2 && sj.gauge === 24, JSON.stringify([sj.face.ne, sj.sl, sj.gauge]));
  const il = modelFor({ C: t('interlock').grid.C, D: t('interlock').grid.D, roles: ['ground', 'ground'], gating: 'interlock', gsm: 220, fabricId: 'interlock' });
  assert(il.sl[0] < 2 && Math.abs(il.sl_loop_mm[0] - 2 * il.sl[0]) < 0.02 && il.face.ne >= 32 && il.face.ne <= 44, JSON.stringify([il.face.ne, il.sl, il.gauge]));
  const fl = modelFor({ C: t('fleece_3_thread').grid.C, roles: t('fleece_3_thread').roles, gsm: 300, fibres: { cotton: 80, polyester: 20 }, brushed: true, fabricId: 'fleece_3_thread' });
  assert(fl.sl.length === 3 && fl.sl[0] > fl.sl[2] * 1.8 && fl.binder.denier >= 75 && fl.loop.ne < fl.face.ne, JSON.stringify([fl.face, fl.binder, fl.loop, fl.sl]));
  assert.strictEqual(modelFor({ C: [['K', 'M'], ['M', 'K']], roles: ['ground', 'ground'], gsm: 160 }), null, 'floats on one bed are beyond what it was taught');
  assert.strictEqual(modelFor({ C: [['K']], roles: ['ground'], gsm: 800 }), null);
  console.log('✓ single jersey, interlock and 3-thread fleece come out as knitted; beyond its training it does not answer');
}
{
  // a construction nobody drew before: a cross-tuck of three feeds
  const r = S.analyse({ bed: 'single', grid: { C: ['KT', 'KK', 'TK'] }, target: { gsm: 210 } });
  assert(r.success && r.ok_to_knit && r.recipe && r.recipe.model && !r.recipe.known_construction, JSON.stringify([r.success, r.error, r.recipe && r.recipe.model]));
  assert(Math.abs(r.fabric.gsm - 210) <= 2 && r.fabric.sl_mm > 2 && r.fabric.sl_mm < 4 && r.structure.confidence.level === 'estimate', JSON.stringify([r.fabric.gsm, r.fabric.sl_mm]));
  const off = S.analyse({ use_model: false, bed: 'single', grid: { C: ['KT', 'KK', 'TK'] }, target: { gsm: 210 } });
  assert(off.success && !off.recipe, 'switched off: the Studio\'s own search');
  const own = S.analyse({ bed: 'single', grid: { C: ['K'] }, target: { gsm: 180 }, yarn: { count: 30, unit: 'ne' } });
  assert(!own.recipe && /^30s/.test(own.yarn.ground.count), 'your own count wins');
  console.log('✓ a new construction is designed from its needles and weighs what was asked: ' + r.yarn.ground.count + ' at ' + r.fabric.sl_mm + ' mm on ' + r.machine.gauge + ' GG');
}
{
  const c = E.calculate({ fabric: 'rib_2x2', gsm: 280, composition: '95% cotton 5% elastane' });
  assert(c.success !== false && c.recipe && c.recipe.model && /loop model/i.test(c.yarn.source_confidence.label), JSON.stringify([c.error, c.yarn && c.yarn.source_confidence]));
  assert.strictEqual(c.knit_plan.machine.gauge, c.recipe.gauge);
  console.log('✓ the calculator designs with the model: ' + c.yarn.count_display);
}
{
  const user = { email: 'Owner@Mill.com', email_verified: true };
  process.env.KA_RECIPE_ACCOUNTS = 'owner@mill.com';
  assert(ACC.allowedAccount(user) && !ACC.allowedAccount({ email: 'someone@else.com' }) && !ACC.allowedAccount({ ...user, email_verified: false }) && !ACC.allowedAccount(null));
  const input = ACC.grant({ [ACC.ACCESS]: true }, { email: 'someone@else.com' });
  assert(!ACC.granted(input), 'the mark is removed for others');
  assert(ACC.granted(ACC.grant({}, user)) && !ACC.granted(JSON.parse('{"ka.factoryRecipes":true,"recipe_access":true}')), 'a request body cannot carry the mark');
  delete process.env.KA_RECIPE_ACCOUNTS;
  console.log('✓ the factory work orders answer only the allowed accounts, and no request can grant itself');
}
{
  // the engines keep the cloths they judged better on, and a weight far outside what a cloth was knitted at
  assert(U.model().spec.engine_better.includes('pique') && modelFor({ C: t('pique_single').grid.C, roles: t('pique_single').roles, gsm: 220, fabricId: 'pique_single' }) === null);
  assert.strictEqual(modelFor({ C: t('single_jersey').grid.C, roles: ['ground'], gsm: 420, fabricId: 'single_jersey' }), null);
  // one cloth, one answer: the calculator and the Studio
  for (const [id, gsm, composition] of [['rib_1x1', 220, '100% cotton'], ['single_jersey', 180, '95% cotton 5% elastane'], ['fleece_3_thread', 300, '80% cotton 20% polyester']]) {
    const tp = t(id), c = E.calculate({ fabric: id, gsm, composition });
    const s = S.analyse({ template: id, bed: tp.bed, gating: tp.gating, grid: tp.grid, feeds: tp.roles.map((role) => ({ role })), yarn: { fibre: 'cotton', type: 'auto' }, target: { gsm, composition }, finish: { brush: /fleece_3/.test(id) ? 'back' : 'none' } });
    assert(c.recipe && c.recipe.model && s.recipe && s.recipe.model, id);
    assert.deepStrictEqual([c.recipe.face.ne, c.recipe.sl, c.recipe.gauge], [s.recipe.face.ne, s.recipe.sl, s.recipe.gauge], id);
  }
  // a fibre nobody knows is still refused in words, not dropped
  const bad = S.analyse({ bed: 'single', grid: { C: ['K'] }, target: { gsm: 180, composition: '95% CO 5% XYZ' } });
  assert(!bad.success && /XYZ/.test(bad.error), bad.error);
  console.log('✓ the engines keep what they do better, one cloth gets one answer, and an unknown fibre is refused');
}
console.log('Universal model tests passed');
