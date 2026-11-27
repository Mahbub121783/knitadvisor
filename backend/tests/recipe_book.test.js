// The recipe book: the mill's work orders answer what they cover — in the calculator and the Studio alike — and the
// engines' own laws answer everything else. Runs on made-up orders (the mill's file is private and not in the repository).
'use strict';
const assert = require('assert');
const RP = require('../engine/domain/recipe-parse');
const RB = require('../engine/domain/recipe-book');
const RAP = require('../engine/domain/recipe-apply');
const ACC = require('../engine/domain/recipe-access');
const mine = (input) => { input[ACC.ACCESS] = true; return input; };      // an account allowed to see the work orders

console.log('--- Running Recipe Book Tests ---');

// one row of the sheet: [process, raw, std fabric, yarn text, c1, f1, c2, f2, c3, f3, filament, material, elastane, feeder, summary, check, colour, GSM, DIAxGAUGE, SL]
const row = (fab, y, gsm, mc, sl, o = {}) => ['SOLID', fab, fab, '', ...[0, 1, 2].flatMap((i) => (y[i] ? y[i] : ['', ''])), o.fil || '', o.filmat || '', o.el || '', '', '', '', o.colour || 'AVG', String(gsm), mc, sl];
const rows = [];
const times = (n, r) => { for (let i = 0; i < n; i++) rows.push(r); };
times(6, row('Single Jersey', [['26/1', 'Combed Cotton']], 160, '30X24', '2.80'));
times(2, row('Single Jersey', [['28/1', 'Combed Cotton']], 160, '30X28', '2.60'));
times(5, row('Single Jersey', [['22/1', 'Combed Cotton']], 190, '30X24', '2.85'));
times(4, row('Fleece (Brushed Back) 2-Tuck', [['28/1', 'Combed Cotton'], ['16/1', 'KC Cotton']], 280, '30X20', '4.60/2.90/1.90', { fil: '75D/72F', filmat: 'POLYESTER' }));
times(3, row('Single Jersey with Elastane', [['32/1', 'Combed Cotton']], 200, '32X24', '3.10', { el: '40D' }));
times(3, row('Interlock', [['40/1', 'Combed Cotton']], 190, '36X24', '1.45'));
times(2, row('1x1 Rib with Elastane (Half Feeder)', [['34/1', 'Combed Cotton']], 220, '36X18', '2.65', { el: '40D' }));
times(2, row('Plated Jersey', [['34/1', 'Combed Cotton']], 220, '30X20', '3.45'));
times(2, row('Heavy Jersey', [['12/1', 'Combed Cotton']], 250, '30X14', '4.00'));

{
  const recs = rows.map(RP.readRow).filter((x) => !x.skip).map((x) => ({ ...x.rec, n: 1 }));
  assert.strictEqual(recs.length, rows.length, 'every row reads');
  const f = recs.find((r) => r.cloth === 'fleece_brushed');
  assert(f.fil.d === 75 && f.yarns.length === 2 && f.sl.length === 3 && f.dia === 30 && f.g === 20);
  const c = RB.compositionOf(f); assert(c.polyester > 8 && c.polyester < 20 && c.cotton > 80, 'the cloth\'s composition from its yarns: ' + JSON.stringify(c));
  assert.strictEqual(RP.readRow(row('Fancy Collar (Knitted)', [['30/1', 'Combed Cotton']], 300, '', '')).skip, 'cloth', 'collars are not body fabric');
  assert.strictEqual(RP.readRow(row('Single Jersey', [['30/1', 'Combed Cotton']], 'AS SWATCH', '', '')).skip, 'no_gsm');
  console.log('✓ the sheet reads: yarns, filament, elastane, machine, stitch lengths; collars and rows without a weight left out');
}
const book = new RB.Book(rows.map(RP.readRow).filter((x) => !x.skip).map((x) => ({ ...x.rec, n: 1 })));
RB.use(book);
{
  const k = RAP.recipeFor({ fabricId: 'single_jersey', gsm: 160, fibres: { cotton: 100 } });
  assert(k.known && k.face.ne === 26 && k.gauge === 24 && k.sl[0] === 2.8 && k.agreement_pct === 75, JSON.stringify(k));
  const n = RAP.recipeFor({ fabricId: 'single_jersey', gsm: 175, fibres: { cotton: 100 } });
  assert(n && !n.known && n.face.ne >= 22 && n.face.ne <= 26, 'between knitted weights: ' + JSON.stringify(n && n.face));
  assert.strictEqual(RAP.recipeFor({ fabricId: 'single_jersey', gsm: 300, fibres: { cotton: 100 } }), null, 'far from every order: nothing');
  assert.strictEqual(RAP.recipeFor({ fabricId: 'single_jersey', gsm: 160, fibres: { polyester: 100 } }), null, 'another cloth: nothing');
  const i = RAP.recipeFor({ fabricId: 'interlock', gsm: 190, fibres: { cotton: 100 } });
  assert(i.sl[0] === 1.45 && i.sl_loop_mm[0] === 2.9, 'an interlock\'s sheet figure is half the loop: ' + JSON.stringify(i.sl_loop_mm));
  console.log('✓ known weights give the standard most orders ran; weights between are carried; nothing where no order is near');
}
{
  const E = require('../engine');
  const r = E.calculate(mine({ fabric: 'fleece_3_thread', gsm: 280, composition: '85% cotton 15% polyester' }));
  assert(r.recipe && r.recipe.known && r.yarn.count_ne === 28 && r.knit_plan.machine.gauge === 20 && r.knit_plan.machine.dia === 30, JSON.stringify([r.yarn.count_ne, r.recipe && r.recipe.known]));
  const loop = r.fleece.yarns.find((y) => y.role === 'loop'), binder = r.fleece.yarns.find((y) => y.role === 'binder');
  assert(loop.ne === 16 && Math.abs(loop.sl_mm - 1.9) < 0.01 && /75D/.test(binder.label) && Math.abs(binder.sl_mm - 2.9) < 0.01, JSON.stringify(r.fleece.yarns.map((y) => [y.role, y.label, y.sl_mm])));
  assert(/work orders/i.test(r.yarn.source_confidence.label));
  const off = E.calculate(mine({ fabric: 'fleece_3_thread', gsm: 280, composition: '85% cotton 15% polyester', use_recipe: 'false' }));
  assert(!off.recipe || off.recipe.model, 'switched off: the model or the engine answers');
  const other = E.calculate({ fabric: 'fleece_3_thread', gsm: 280, composition: '85% cotton 15% polyester', recipe_access: true, 'ka.factoryRecipes': true });
  assert(!other.recipe || other.recipe.model, 'a request cannot grant itself the work orders');
  const own = E.calculate(mine({ fabric: 'single_jersey', gsm: 160, gauge: 20 }));
  assert(!own.recipe || own.recipe.model, 'your own gauge leaves the recipe');
  const el = E.calculate(mine({ fabric: 'lycra_rib_1x1', gsm: 220, composition: '95% cotton 5% elastane', elastane_feed: 'half' }));
  assert(el.recipe && el.recipe.half && /half feeder/.test(el.yarn.count_display), el.yarn.count_display);
  console.log('✓ the calculator answers with the work orders: yarns, stitch lengths, gauge and diameter; off on request');
}
{
  const S = require('../engine/domain/fabric-studio');
  const T = S.listTemplates();
  const design = (id, extra) => { const t = T.find((x) => x.id === id); return mine({ template: id, bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((r) => ({ role: r, plate: !!t.plated })), yarn: { fibre: 'cotton', type: 'auto', ply: t.ends || 1 }, ...extra }); };
  const r = S.analyse(design('single_jersey', { target: { gsm: 160, composition: '100% cotton' } }));
  assert(r.success && r.recipe && /^26s/.test(r.yarn.ground.count) && r.machine.gauge === 24 && Math.abs(r.fabric.sl_mm - 2.8) < 0.005 && Math.abs(r.fabric.gsm - 160) <= 1, JSON.stringify([r.yarn.ground.count, r.fabric.sl_mm, r.fabric.gsm]));
  assert(r.yarn_plan.recipe && r.yarn_plan.rows[0].source === 'work orders' && r.structure.confidence.level === 'calibrated');
  const f = S.analyse(design('fleece_3_thread', { finish: { brush: 'back' }, target: { gsm: 280, composition: '85% cotton 15% polyester' } }));
  const sl = Object.fromEntries(f.yarn.feeds.map((x) => [x.role, x.sl_mm]));
  assert(f.recipe && Math.abs(sl.face - 4.6) < 0.01 && Math.abs(sl.binder - 2.9) < 0.01 && Math.abs(sl.loop - 1.9) < 0.01 && Math.abs(f.fabric.gsm - 280) <= 2, JSON.stringify([sl, f.fabric.gsm]));
  const h = S.analyse(design('heavy_jersey', { target: { gsm: 250 } }));
  assert(h.recipe && h.recipe.cloth === 'heavy_jersey', 'a heavy jersey started as one is its own cloth');
  const p = S.analyse(design('plated_jersey', { target: { gsm: 220 } }));
  assert(p.recipe && p.recipe.cloth === 'plated_jersey', 'a plated jersey too');
  const own = S.analyse(design('single_jersey', { target: { gsm: 160 }, yarn: { fibre: 'cotton', count: 30, unit: 'ne' } }));
  assert(!own.recipe && /^30s/.test(own.yarn.ground.count), 'your own count wins');
  const anyone = S.analyse({ ...design('single_jersey', { target: { gsm: 160 } }), [ACC.ACCESS]: false });
  assert(!anyone.recipe || anyone.recipe.model, 'an account without access is never answered from the work orders');
  const drawn = S.analyse(mine({ bed: 'single', grid: { C: ['KTM', 'MKT', 'TMK'] }, target: { gsm: 160 } }));
  assert(drawn.success && (!drawn.recipe || drawn.recipe.model), 'a structure the work orders never knit is answered by the model or the engine');
  console.log('✓ the Studio designs with the work orders where they cover the drawing, and with its own laws elsewhere');
}
RB.use(new RB.Book([]));
console.log('Recipe book tests passed');
