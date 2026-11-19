// Phase B: polypropylene, forced process (hard blocks with repairs), and what the wet-process chemicals do to the cloth.
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const CHEMY = require('../engine/domain/yarn-chemistry-engine');
const PE = require('../engine/domain/process-effects');
const FEAS = require('../engine/domain/feasibility-engine');

console.log('--- Running Process Effects Tests ---');
const base = { bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 180 }, machine: {}, look: { shade: 'white' } };
const run = (extra) => S.analyse({ ...base, ...(extra || {}) });
const chem = (shade, process, extra) => run({ chemistry: { enabled: true, shade, process }, ...(extra || {}) });
const rule = (r, id) => r.feasibility.rules.find((x) => x.id === id);

{
  // polypropylene: a Studio fibre, dope-dyed, no dye class, route kept cool
  const r = run({ yarn: { fibre: 'polypropylene', type: 'combed', count: 30, unit: 'ne' } });
  assert(r.success, r.error);
  const cotton = run();
  assert(r.yarn.ground.d_mm > cotton.yarn.ground.d_mm * 1.2, 'a lighter fibre (0.91) makes a thicker yarn at the same count');
  assert.strictEqual(r.feasibility.fibres.polypropylene, 100);
  for (const shade of ['white', 'dark']) {
    const p = CHEMY.profileOf({ polypropylene: 100 }, 20, { shade });
    assert.strictEqual(p.dyeing.classes.length, 0, 'polypropylene takes no dye in the piece');
    assert(p.route.steps.every((s) => s.t_c <= 115), 'every bath at 115 °C or below');
    assert(p.warnings.some((w) => /dope-dyed|spun in/i.test(w.text)));
  }
  assert.strictEqual(rule(chem('dark'), 'U-10').status, 'na', 'cotton design: U-10 not applicable');
  // polypropylene beside cotton: the cotton's reactive route (95 °C scour, 60 °C dye) is safe; beside polyester it needs 130 °C: FATAL
  const cotpp = CHEMY.profileOf({ cotton: 60, polypropylene: 40 }, 20, { shade: 'medium' });
  assert(cotpp.route.steps.every((s) => s.t_c <= 115) && cotpp.dyeing.classes.length === 1);
  const petpp = CHEMY.profileOf({ polyester: 50, polypropylene: 50 }, 20, { shade: 'dark' });
  assert(petpp.route.steps.some((s) => s.t_c >= 130));
  console.log('✓ polypropylene: a Studio fibre, no dye class, every bath ≤ 115 °C alone or with cotton; beside polyester the 130 °C route is the conflict');
}
{
  // forced process: each is a hard block with a repair that clears it
  const wool = { yarn: { fibre: 'wool', count: 30, unit: 'ne' } };
  const clean = chem('dark', undefined, wool);
  assert.strictEqual(rule(clean, 'U-09').status, 'pass');
  const caustic = chem('dark', { scour_caustic: true }, wool);
  assert.strictEqual(rule(caustic, 'U-09').status, 'fatal', 'caustic scour with wool is FATAL');
  assert.strictEqual(caustic.feasibility.export_locked, true);
  const fix = rule(caustic, 'U-09').repair;
  assert(fix.forced && fix.changes[0].field === 'chemistry.process.scour_caustic' && fix.changes[0].to === null, 'the repair clears the forced setting');
  assert(caustic.feasibility.safe_route && !caustic.feasibility.safe_route.some((x) => x.t_c > 100 && x.id === 'scour'), 'the compiled safe route is shown');
  assert(caustic.feasibility.route.find((x) => x.id === 'scour').requested, 'the forced step is marked');
  assert.strictEqual(chem('dark', { disperse_c: 130 }, { yarn: { fibre: 'wool', count: 30, unit: 'ne' } }).feasibility.rules.find((x) => x.id === 'U-09').status, 'pass', 'no disperse step in a wool-only cloth');
  console.log('✓ forced caustic scour on wool is FATAL, locks the export, and the repair clears exactly that setting');
}
{
  const kill = chem('white', { skip_killer: true });
  assert.strictEqual(rule(kill, 'U-12').status, 'fatal');
  assert(rule(kill, 'U-12').repair.changes[0].field === 'chemistry.process.skip_killer');
  assert.strictEqual(rule(chem('white'), 'U-12').status, 'pass', 'the compiled route has the killer');
  const cat = chem('white', { softener: 'cationic' });
  assert.strictEqual(rule(cat, 'U-18').status, 'warn');
  assert.strictEqual(rule(chem('white', { softener: 'silicone' }), 'U-18').status, 'pass');
  const rf = chem('dark', { reactive_first: true }, { yarn: { fibre: 'cvc', type: 'combed', count: 30, unit: 'ne' } });
  assert.strictEqual(rule(rf, 'U-11').status, 'fatal', 'reactive before the 130 °C disperse');
  assert.strictEqual(rule(chem('dark', undefined, { yarn: { fibre: 'cvc', type: 'combed', count: 30, unit: 'ne' } }), 'U-11').status, 'pass');
  const el = { elastane: { denier: 40, draft: 2.6 } };
  assert.strictEqual(rule(chem('light', { heatset_c: 210 }, el), 'U-19').status, 'warn');
  assert.strictEqual(rule(chem('light', { heatset_c: 210 }, el), 'U-19').repair.changes[0].field, 'chemistry.process.heatset_c');
  assert.strictEqual(rule(chem('light', undefined, el), 'U-19').status, 'pass');
  // a bad value is ignored, not trusted
  assert.deepStrictEqual(CHEMY.cleanProcess({ disperse_c: 9999, heatset_c: 'x', softener: 'acid', finishes: ['dwr', 'bogus'], scour_caustic: 'yes' }), { finishes: ['dwr'] });
  console.log('✓ U-11, U-12, U-18, U-19: each forced setting is refused or warned, with a repair that clears it; the compiled route passes');
}
{
  // process effects: off unless the chemistry card is on; chemicals found in the route and the dye bath
  assert.strictEqual(run().process_effects, null);
  const w = chem('white'), m = chem('medium'), d = chem('dark');
  assert(w.process_effects && w.process_effects.basis === 'estimate');
  const ids = (r) => r.process_effects.chemicals.map((c) => c.id);
  assert(ids(w).includes(3) && ids(w).includes(6) && ids(w).includes(16), 'a white: peroxide, killer, brightener');
  assert(ids(m).includes(9) && ids(m).includes(8) && ids(m).includes(17), 'a reactive medium: salt, soda ash, soaping');
  assert(ids(d).includes(11), 'a dark shade adds the multifunctional levelling agent');
  assert(w.process_effects.totals.delta_b < -5, 'peroxide and brightener whiten the cloth (b* falls)');
  assert(chem('white', { softener: 'cationic' }).process_effects.totals.delta_b > w.process_effects.totals.delta_b, 'a cationic softener yellows it');
  // one softener per route, never counted twice
  [w, m, d, chem('white', { softener: 'cationic' })].forEach((r) => assert.strictEqual(ids(r).filter((i) => [21, 22, 23].includes(i)).length, 1));
  // extra finishes
  const dwr = chem('dark', { finishes: ['dwr', 'wet_rub', 'gsm_improver'] });
  assert(ids(dwr).includes(24) && ids(dwr).includes(25) && ids(dwr).includes(26));
  assert(dwr.process_effects.totals.gsm_pct > d.process_effects.totals.gsm_pct + 3.5, 'DWR + wet-rub improver + GSM improver add weight');
  assert(dwr.process_effects.totals.wet_rub_grades >= d.process_effects.totals.wet_rub_grades + 1);
  assert.strictEqual(dwr.fabric.gsm, d.fabric.gsm, 'the Studio\'s weight (factory records) is not changed');
  console.log('✓ process effects: found in the route and the dye bath, one softener, finishes add up, weight untouched');
}
{
  // the Hand card works with them: the softener is the hand engine's own finish, the other chemicals ride on top
  const hand = { hand: { enabled: true } };
  const off = run({ ...hand, look: { shade: 'medium' } }), on = chem('medium', undefined, { ...hand, look: { shade: 'medium' } });
  assert(off.hand && on.hand && on.hand.identity.finish.process_chemicals && !off.hand.identity.finish.process_chemicals);
  assert(on.hand.bending.wale.value < off.hand.bending.wale.value, 'softener + enzyme: a more flexible cloth');
  assert(on.hand.surface.MIU.value < off.hand.surface.MIU.value, 'and a smoother one');
  const stiff = chem('medium', { finishes: ['dwr', 'gsm_improver'] }, { ...hand, look: { shade: 'medium' } });
  assert(stiff.hand.bending.wale.value > on.hand.bending.wale.value, 'a DWR and a GSM improver stiffen it');
  // a finish the person chose in the Hand card wins over the route's softener
  const chosen = chem('medium', undefined, { hand: { enabled: true, finish: 'resin' }, look: { shade: 'medium' } });
  assert.strictEqual(chosen.hand.identity.finish.chemical, 'Resin (crisp) finish');
  console.log('✓ the Hand card follows the route: softener + enzyme soften, DWR + GSM improver stiffen, a chosen finish wins');
}
{
  const cat = PE.catalogue();
  assert.strictEqual(cat.chemicals.length, 27, 'all 27 chemicals');
  assert(cat.chemicals.every((c) => c.note && c.stage && c.id));
  assert(FEAS.catalogue().rules.length === 20);
  console.log('✓ the 27-chemical table');
}
console.log('Process effects tests passed');
