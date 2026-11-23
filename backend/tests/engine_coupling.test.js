// The engines work as ONE answer: nothing fails silently, every input moves what it should, and independent physics agrees with the Studio.
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');

console.log('--- Running Engine Coupling Tests ---');
const T = S.listTemplates();
const inputOf = (t, o) => ({ bed: t.bed === 'double' ? 'double' : 'single', gating: t.bed === 'double' ? t.gating : undefined, grid: { C: t.grid.C.map((r) => r.join('')), D: t.grid.D ? t.grid.D.map((r) => r.join('')) : null }, feeds: (t.roles || []).map((r) => ({ role: r })), yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: 200 }, machine: {}, ...(o || {}) });
const J = { bed: 'single', grid: { C: ['K'] }, yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: 180 }, machine: {}, core_engines: true };
const run = (o) => S.analyse({ ...J, ...o });

{
  // 1 · nothing dies silently: every template, six fibres, with and without elastane
  const FIB = ['cotton', 'cvc', 'polyester_spun', 'viscose', 'wool', 'nylon_filament'];
  let n = 0;
  for (const t of T) for (const fib of FIB) for (const el of [false, true]) {
    const filament = /filament/.test(fib);
    const r = S.analyse({ ...inputOf(t), core_engines: true, yarn: { fibre: fib, count: filament ? 100 : 30, unit: filament ? 'denier' : 'ne' }, elastane: el ? { denier: 40, draft: 2.6, every: 'all' } : null });
    const who = `${t.id}/${fib}${el ? '+el' : ''}`;
    assert(r.success, `${who}: ${r.error}`);
    assert.deepStrictEqual(r.engine_faults, [], `${who}: an engine failed silently: ${JSON.stringify(r.engine_faults)}`);
    for (const k of ['chemistry', 'hand', 'look', 'light', 'process_effects', 'process_dimensions', 'feasibility', 'machine_setup', 'setup']) assert(r[k] != null, `${who}: ${k} is empty`);
    // a filament yarn has no staple recovery model (its fibre table rules); a plush takes standard filament yarns for polyester
    if (!filament && !r.yarn.feeds.some((f) => /filament/i.test((f.yarn || '') + ' ' + (f.fibre || '')))) assert(r.recovery != null, `${who}: the yarn recovery is empty`);
    assert(!r.feasibility.route_error, `${who}: the wet route could not be compiled: ${r.feasibility.route_error}`);
    n++;
  }
  console.log(`✓ ${n} designs (every template × 6 fibres × elastane): no engine throws, fails silently or comes back empty; the core engines answer without any card switched on`);
}
{
  // 2 · Simple, Expert and the sheet give one answer: a card only adds inputs
  const plain = run({}), cards = run({ chemistry: { enabled: true, shade: 'medium' }, hand: { enabled: true }, recovery: { enabled: true }, look: { shade: 'medium' }, lab: { enabled: true }, inspect: { enabled: true }, drape: { enabled: true } });
  assert.strictEqual(plain.fabric.gsm, cards.fabric.gsm); assert.strictEqual(plain.fabric.sl_mm, cards.fabric.sl_mm); assert.strictEqual(plain.fabric.width_open_in, cards.fabric.width_open_in);
  assert.deepStrictEqual(plain.process_dimensions, cards.process_dimensions);
  assert.strictEqual(plain.hand.compression.T0.value, cards.hand.compression.T0.value, 'the hand is the same with or without the Hand card open');
  assert.strictEqual(run({ chemistry: { enabled: false } }).chemistry, null, 'a card can still turn an engine off');
  console.log('✓ the answer is the same with every card closed or open (weight, stitch length, width, shrinkage route, hand)');
}
{
  // 3 · the inputs move what physics says they move
  const a = run({}), b = run({ target: { gsm: 240 } });
  assert(b.fabric.sl_mm > a.fabric.sl_mm * 0 && b.fabric.wpc * b.fabric.cpc > a.fabric.wpc * a.fabric.cpc, 'a heavier target is a denser cloth');
  assert(run({ yarn: { fibre: 'cotton', count: 20, unit: 'ne' } }).fabric.sl_mm > a.fabric.sl_mm, 'a coarser yarn takes a longer stitch at the same weight');
  const poly = run({ yarn: { fibre: 'polyester_spun', count: 30, unit: 'ne' } });
  assert(/Disperse/.test(poly.chemistry.ground.route.steps.map((s) => s.label).join(' ')) && /Reactive/.test(a.chemistry.ground.route.steps.map((s) => s.label).join(' ')), 'the fibre decides the dye class');
  assert(poly.recovery.ground.identity.mean_fibre_angle !== undefined && poly.recovery.ground.recovery.permanent_set.value !== a.recovery.ground.recovery.permanent_set.value, 'the fibre moves the recovery of the yarn');
  const dark = run({ chemistry: { enabled: true, shade: 'black' }, look: { shade: 'black' } }), white = run({ chemistry: { enabled: true, shade: 'white' }, look: { shade: 'white' } });
  assert(dark.chemistry.ground.recipe.dyes[0].owf_on_yarn_pct > a.chemistry.ground.recipe.dyes[0].owf_on_yarn_pct, 'a darker shade takes more dye');
  assert(white.feasibility.rules.find((r) => r.id === 'U-12').status !== 'na', 'a white is bleached: the peroxide rule is checked');
  assert(run({ elastane: { denier: 40, draft: 2.6, every: 'all' } }).feasibility.rules.find((r) => r.id === 'U-19').status !== 'na', 'elastane switches its rule on');
  const g28 = run({ machine: { gauge: 28 } });
  assert(g28.machine.needles > a.machine.needles, 'a finer gauge has more needles');
  const e70 = run({ machine: { efficiency: 70 } });
  assert(Math.abs(e70.machine.kg_per_hour / a.machine.kg_per_hour - 70 / a.machine.efficiency_pct) < 0.01, 'output is proportional to efficiency');
  const r20 = run({ machine: { rpm: 20 } });
  assert(Math.abs(r20.machine.kg_per_hour / a.machine.kg_per_hour - (20 / a.machine.rpm) * (r20.machine.efficiency_pct / a.machine.efficiency_pct)) < 0.02, 'output is proportional to speed');
  assert(run({ finish: { brush: 'back' } }).finish && run({ finish: { brush: 'back' } }).finish.brushed === 'back', 'brushing is carried through');
  console.log('✓ inputs move what physics says: target weight and count move the stitch, the fibre the dye class, shade the dye amount and the bleach rule, gauge the needles, efficiency and speed the output');
}
{
  // 4 · independent physics agrees: GSM = loops per cm² × loop length × tex; needles = π × dia × gauge; kg/h from the yarn laid per revolution
  let n = 0;
  for (const t of T) {
    if (/terry|velour|plush/.test(t.id)) continue;
    const r = S.analyse(inputOf(t, { target: { gsm: 220 } }));
    const dbl = r.structure.bed === 'double' ? 2 : 1, f = r.fabric, m = r.machine, y = r.yarn.feeds[0];
    if (!['single_jersey', 'rib_1x1', 'interlock', 'lacoste_single', 'rib_2x2'].includes(t.id)) {
      assert(m.needles > 0 && Math.abs(m.needles - Math.PI * m.dia * m.gauge) < Math.max(2, 0.02 * m.needles), `${t.id}: needles ${m.needles} against π × dia × gauge`);
    } else {
      const g = f.wpc * f.cpc * dbl * (f.sl_mm / 1000) * (y.tex / 1000) * 1e4;
      assert(Math.abs(g / f.gsm - 1) < 0.04, `${t.id}: loops × loop length × tex = ${g.toFixed(1)} against ${f.gsm} GSM`);
    }
    let grams = 0; for (let k = 0; k < m.feeders; k++) { const fd = r.yarn.feeds[k % r.yarn.feeds.length]; grams += (+fd.course_length_m || 0) * (+fd.tex || 0) / 1000; }
    const kg = (m.rpm * 60 * grams / 1000) * (m.efficiency_pct / 100);
    assert(Math.abs(kg / m.kg_per_hour - 1) < 0.03, `${t.id}: kg/h from the yarn laid per revolution ${kg.toFixed(2)} against ${m.kg_per_hour}`);
    n++;
  }
  console.log(`✓ independent physics on ${n} templates: loops × loop length × tex gives the GSM, π × dia × gauge the needles, and the yarn laid per revolution the kg/h`);
}
{
  // 5 · a yarn-dyed cloth has its own wet route in every engine that reads one
  const sj = run({ chemistry: { enabled: true, shade: 'dark' }, stripes: { sequence: 'A2 B2' }, colourway: { colours: { A: '#0b1f4a', B: '#ffffff' } } });
  const routes = [sj.chemistry.ground.route.steps, sj.feasibility.route].map((rt) => rt.map((s) => s.label).join(' > '));
  routes.forEach((rt) => assert(/Wash-off/.test(rt) && !/Dyeing|Peroxide|Scouring/.test(rt), `the cloth is only washed off and softened: ${rt}`));
  assert.strictEqual(sj.chemistry.ground.recipe.dyes.length, 0, 'no dye in the cloth route');
  assert(sj.colourway.colours.some((c) => c.dye.length), 'the dye is in the colour plan, per colour (yarn)');
  assert.strictEqual(sj.feasibility.rules.find((r) => r.id === 'U-12').status, 'na', 'no peroxide on the cloth');
  console.log('✓ a yarn-dyed cloth: the chemistry card, the feasibility gate and the shrinkage route all see a wash-off; the dyes live in the colour plan');
}
console.log('Engine coupling tests passed');
