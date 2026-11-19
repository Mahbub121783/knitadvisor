// The three feasibility gates and the 20 rules, as every weft analysis carries them (feasibility-engine.js).
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const FEAS = require('../engine/domain/feasibility-engine');
const CHEMY = require('../engine/domain/yarn-chemistry-engine');

console.log('--- Running Feasibility Engine Tests ---');
const base = { bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 160 }, machine: {} };
const run = (extra) => S.analyse({ ...base, ...(extra || {}) });
const ruleOf = (r, id) => r.feasibility.rules.find((x) => x.id === id);

{
  const r = run();
  assert(r.success && r.feasibility, 'every analysis carries the feasibility verdict');
  const F = r.feasibility;
  assert.strictEqual(F.rules.length, 20, 'all 20 rules are reported');
  assert.deepStrictEqual(F.rules.map((x) => x.id).sort(), Object.keys(FEAS.RULES).sort());
  assert.strictEqual(F.gates.gate1.status, 'pass');
  assert.strictEqual(F.gates.gate2.status, 'pass');
  assert.strictEqual(F.gates.gate3.status, 'pass');
  assert.strictEqual(F.export_locked, false);
  // Φ of a 160 GSM cotton jersey: a comfortable, open cloth (the bands' middle)
  assert(F.packing && F.packing.phi > 0.25 && F.packing.phi < 0.5, `jersey Φ ${F.packing && F.packing.phi}`);
  assert(F.packing.porosity_pct > 70 && F.packing.porosity_pct < 95);
  assert(Math.abs(F.packing.fibre_fraction - F.packing.phi * 0.58) < 0.002);
  console.log('✓ a plain jersey passes all three gates; Φ ≈', F.packing.phi);
}
{
  // a heavier cloth on the same yarn is more packed
  const a = run({ target: { gsm: 140 } }).feasibility.packing.phi, b = run({ target: { gsm: 200 } }).feasibility.packing.phi;
  assert(b > a, 'more weight on the same yarn packs the cloth more');
  console.log('✓ Φ rises with the weight on the same yarn');
}
{
  // GATE 1: a feed that is never caught, and a needle that never knits
  const loose = run({ grid: { C: ['K', 'M'], D: null }, feeds: [{ role: 'ground' }, { role: 'ground' }] });
  assert(loose.success);
  const u1 = ruleOf(loose, 'U-01');
  assert.strictEqual(u1.status, 'fatal', 'a feed that only misses lies loose');
  assert.strictEqual(loose.feasibility.gates.gate1.status, 'fatal');
  assert.strictEqual(loose.feasibility.export_locked, true, 'a FATAL locks the factory files');
  assert(u1.repair && u1.repair.changes.length, 'a repair says which needle to set');
  console.log('✓ Gate 1: a yarn never caught is FATAL and locks the export');
}
{
  // two beds with no feed on both: two separate cloths
  const r = S.analyse({ ...base, bed: 'double', gating: 'rib', grid: { C: ['KM', 'MM'], D: ['MM', 'MK'] }, feeds: [{ role: 'ground' }, { role: 'ground' }], target: { gsm: 250 } });
  if (r.success) {
    assert.strictEqual(ruleOf(r, 'U-01').status, 'fatal', 'no feed ties the beds: two cloths');
    assert(/two separate cloths/.test(ruleOf(r, 'U-01').text));
    console.log('✓ Gate 1: two beds that never meet are two cloths (FATAL)');
  } else console.log('  (two-bed case rejected earlier by the Studio:', r.error, ')');
}
{
  // a long float: warned, with a tie-in tuck in its middle
  const r = run({ grid: { C: ['KKKKKKKKKK', 'KMMMMMMMMM'], D: null }, feeds: [{ role: 'ground' }, { role: 'ground' }] });
  assert(r.success);
  const u13 = ruleOf(r, 'U-13');
  assert.strictEqual(u13.status, 'warn');
  assert(u13.value.needles >= 7);
  assert.strictEqual(u13.repair.changes[0].to, 'T', 'the repair ties the float in with a tuck');
  console.log('✓ U-13: a 9-needle float is a snag warning with a tie-in tuck');
}
{
  // tucks running on one needle
  const r = run({ grid: { C: ['K', 'T', 'T', 'T', 'T', 'T', 'T', 'T'], D: null }, feeds: Array(8).fill({ role: 'ground' }), target: { gsm: 200 } });
  if (r.success) {
    const u6 = ruleOf(r, 'U-06');
    assert.strictEqual(u6.status, 'fatal', `7 tucks running is FATAL (${u6.status})`);
    assert.strictEqual(u6.repair.changes[0].to, 'K');
    console.log('✓ U-06: seven tucks on one needle is FATAL, the repair knits one');
  } else console.log('  (tuck stack rejected earlier by the Studio:', r.error, ')');
}
{
  // GATE 2: a loose cloth (very long stitch on a fine yarn) and a tight one
  const loose = run({ machine: { sl_mm: 3.6 }, target: {} });
  assert(loose.success);
  assert.strictEqual(ruleOf(loose, 'U-03').status, 'warn', 'a very loose jersey is warned sleazy');
  assert(ruleOf(loose, 'U-03').repair.changes.some((c) => c.field === 'sl_mm' && c.to < 3.6), 'the repair shortens the stitch');
  const tight = run({ machine: { sl_mm: 2.2 }, target: {} });
  assert(tight.success);
  assert.strictEqual(ruleOf(tight, 'U-02').status, 'warn', 'a very tight jersey is warned');
  assert(ruleOf(tight, 'U-02').repair.changes.some((c) => c.field === 'sl_mm' && c.to > 2.2), 'the repair lengthens the stitch');
  console.log('✓ Gate 2: loose and tight stitches are warned, the repair moves the stitch length the right way');
}
{
  // the close-packing law: a cloth whose yarn cannot fit is FATAL
  const fake = { success: true, structure: { beds: { C: [['K']], D: null }, roles: ['ground'], gating: 'single' }, fabric: { gsm: 500, wpc: 14, cpc: 18, tf: 15, sl_mm: 2.7 }, machine: { gauge: 24 }, yarn: { ground: { tex: 19.7 }, feeds: [{ role: 'ground', tex: 19.7, fibre_mix: { cotton: 100 }, mass_share_pct: 100 }], composition: [] }, checks: [] };
  const F = FEAS.assess(fake, {}, { thickness_mm: 0.5 });
  assert(F.packing.phi > 0.907);
  assert.strictEqual(F.rules.find((x) => x.id === 'U-02').status, 'fatal', 'Φ above 0.907 cannot exist');
  assert.strictEqual(F.rules.find((x) => x.id === 'U-02').basis, 'law');
  console.log('✓ U-02: above the close packing of round yarns (0.907) the cloth cannot exist — FATAL, law');
}
{
  // GATE 3 chemistry: the route of the WHOLE cloth — wool in any yarn means no caustic
  const prof = CHEMY.profileOf({ cotton: 70, wool: 30 }, 20, { shade: 'white' });
  assert(!prof.route.steps.some((s) => s.chemicals.some((c) => /caustic/i.test(c.name))), 'a wool blend is scoured without caustic');
  const wp = CHEMY.profileOf({ wool: 50, polyester: 50 }, 20, { shade: 'dark' });
  const disp = wp.route.steps.find((s) => s.id === 'dye_disperse');
  assert(disp && disp.t_c <= 110, `wool/polyester disperse dyeing held at ≤ 110 °C (${disp && disp.t_c})`);
  assert(wp.route.steps.filter((s) => s.id === 'heatset').every((s) => s.t_c <= 180), 'a wool blend is heat-set wool-safe');
  const cw = CHEMY.profileOf({ cotton: 100 }, 20, { shade: 'white' });
  const ib = cw.route.steps.findIndex((s) => s.id === 'bleach'), ik = cw.route.steps.findIndex((s) => s.id === 'killer');
  assert(ib > -1 && ik === ib + 1, 'a peroxide killer follows the bleach');
  assert(cw.route.steps.find((s) => s.id === 'soften').chemicals.every((c) => !/cationic/i.test(c.name) || /no cationic/i.test(c.name)), 'no cationic softener on an optical white');
  // the gate sees the wool even when it is only in one yarn of the fabric
  const r = run({ yarn: { fibre: 'wool', count: 30, unit: 'ne' } });
  assert(r.success);
  assert.strictEqual(ruleOf(r, 'U-09').status, 'pass', 'wool: the route uses no caustic soda');
  assert(r.feasibility.fibres.wool > 99);
  console.log('✓ Gate 3 chemistry: wool scoured and cleared without caustic, held at 105 °C; killer after bleach; no cationic on a white');
}
{
  // the rule register: fibres the cloth carries, read across every yarn
  const fake = { success: true, structure: { beds: { C: [['K'], ['K']], D: null }, roles: ['ground', 'ground'], gating: 'single' }, fabric: { gsm: 180, wpc: 14, cpc: 18, tf: 15, sl_mm: 2.7 }, machine: { gauge: 24 }, yarn: { ground: { tex: 19.7 }, feeds: [{ role: 'ground', tex: 19.7, fibre_mix: { cotton: 100 }, mass_share_pct: 50 }, { role: 'ground', tex: 19.7, fibre_mix: { polypropylene: 100 }, mass_share_pct: 50 }], composition: [] }, checks: [] };
  const F = FEAS.assess(fake, { chemistry: { shade: 'dark' } }, { thickness_mm: 0.6 });
  assert(Math.abs(F.fibres.cotton - 50) < 0.5 && Math.abs(F.fibres.polypropylene - 50) < 0.5, 'the cloth fibres are mass-weighted across the yarns');
  assert.strictEqual(F.rules.find((x) => x.id === 'U-10').status, 'pass', 'cotton + dope-dyed polypropylene: the cotton route stays under 125 °C');
  // polypropylene with polyester: the 130 °C disperse bath would melt it
  const pet = JSON.parse(JSON.stringify(fake)); pet.yarn.feeds[0].fibre_mix = { polyester: 100 };
  const G = FEAS.assess(pet, { chemistry: { shade: 'dark' } }, { thickness_mm: 0.6 });
  assert.strictEqual(G.rules.find((x) => x.id === 'U-10').status, 'fatal', 'polypropylene in a 130 °C disperse route is FATAL');
  assert.strictEqual(G.export_locked, true);
  console.log('✓ the cloth fibres are read across every yarn; polypropylene beside polyester (130 °C) is FATAL, beside cotton it passes');
}
{
  // elastane: the heat-set window
  const r = run({ elastane: { denier: 40, draft: 2.6 } });
  assert(r.success);
  assert.strictEqual(ruleOf(r, 'U-19').status, 'pass', 'elastane heat-set at 190 °C is inside 180–202 °C');
  const hot = run({ elastane: { denier: 40, draft: 2.6 }, finish: { brush: 'none', heatset_c: 210 } });
  assert.strictEqual(ruleOf(hot, 'U-19').status, 'warn');
  console.log('✓ U-19: elastane heat-set window 180–202 °C');
}
{
  // brushing a short loop
  const r = run({ finish: { brush: 'face' }, machine: { sl_mm: 1.25 }, target: {} });
  if (r.success) { assert.strictEqual(ruleOf(r, 'U-17').status, 'warn'); console.log('✓ U-17: brushing a 1.25 mm stitch is a tear risk'); }
  const cat = FEAS.catalogue();
  assert.strictEqual(cat.rules.length, 20);
  assert(Math.abs(cat.phi.close_packing - 0.907) < 0.001);
}
{
  // the export is locked for a FATAL design, open for a passing one (route logic, without the server)
  const ok = run().feasibility, bad = run({ grid: { C: ['K', 'M'], D: null }, feeds: [{ role: 'ground' }, { role: 'ground' }] }).feasibility;
  assert(!ok.export_locked && bad.export_locked);
  assert(bad.repair.length && bad.repair[0].status === 'fatal', 'the repair list starts with the fatal one');
  console.log('✓ the repair vector lists the FATAL fixes first');
}
console.log('Feasibility engine tests passed');
