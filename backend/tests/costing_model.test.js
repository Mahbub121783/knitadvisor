// Fabric costing — shade-band dyeing, fibre-aware process loss, the yarn a
// fabric is really knitted from, and an honest range around the total.
const assert = require('assert');
const { calculate } = require('../engine');
const { dyeingCharge, bandFromColour, processLoss } = require('../engine/domain/wet-cost-model');

console.log('--- Running Costing Model Tests ---');
const C = (extra = {}, comp = '100% Cotton', fabric = 'single_jersey', gsm = 160) =>
  calculate({ fabric, gsm, composition: comp, efficiency: 85, ...extra }).costing;

// 1. the total is the mill's build-up, and the printed lines add up to it
{
  const c = C({ color_shade: 'light_medium' });
  const sum = c.raw_material_per_kg_usd + c.knitting_per_kg_usd + c.dyeing_per_kg_usd + c.finishing_per_kg_usd + c.process_loss.cost_per_kg;
  assert(Math.abs(sum - c.total_per_kg_usd) < 0.005, 'five lines add up to the total');
  assert(c.process_loss.pct > 10 && c.process_loss.pct < 15, `cotton loses 10-15% grey→finished (${c.process_loss.pct})`);
  assert(c.process_loss.cost_per_kg > 0.5, 'and that loss is a real share of the price');
  assert.strictEqual(c.build_up[c.build_up.length - 1].usd, Math.round(c.total_per_kg_usd * 100) / 100);
  assert(c.accuracy.low < c.total_per_kg_usd && c.accuracy.high > c.total_per_kg_usd && c.accuracy.pct < 9, 'a range around the total');
}

// 2. dyeing by shade band: the factory price-list anchors, on cotton
{
  const d = (shade, x = {}) => C({ color_shade: shade, ...x }).dyeing_per_kg_usd;
  assert.strictEqual(d('black'), 1.75);
  assert.strictEqual(d('dark_navy'), 1.55);
  assert.strictEqual(d('light_medium'), 1.30);
  assert.strictEqual(d('white_melange'), 0.80);
  assert.strictEqual(d('fluorescent'), 2.60);
  assert(d('melange', {}) < d('white_melange'), 'a melange is washed, not dyed');
  // inside a tier, the band chosen moves the price
  assert(d('light_medium', { dye_band: 'light' }) < d('light_medium', { dye_band: 'medium' }));
  assert(d('dark_navy', { dye_band: 'extra_dark' }) > d('dark_navy', { dye_band: 'dark' }));
  assert(d('light_medium', { dye_band: 'special' }) > d('light_medium') + 0.3, 'special colours cost more');
  // the exact colour reads its own band
  assert.strictEqual(bandFromColour('#F5D547').band, 'light');
  assert.strictEqual(bandFromColour('#111111').band, 'black');
  assert(bandFromColour('#30D5C8').special && bandFromColour('#2F5DB8').special, 'turquoise and royal are specials');
  assert(!bandFromColour('#1F2A44').special, 'navy is not');
  assert(d(undefined, { color_input: '#30D5C8' }) > d('light_medium', { dye_band: 'light' }) + 0.3, 'a turquoise is charged as a special');
  // %OWF is continuous
  assert(d(undefined, { shade_depth_pct: 0.3 }) < d(undefined, { shade_depth_pct: 3 }));
}

// 3. the fibre decides the route
{
  const cot = C({ color_shade: 'dark_navy' }), cvc = C({ color_shade: 'dark_navy' }, '60% Cotton 40% Polyester');
  assert(Math.abs(cvc.dyeing_per_kg_usd - cot.dyeing_per_kg_usd - 0.45) < 0.001, 'two-part is the price list\'s +0.45');
  assert.strictEqual(cvc.dyeing_detail.route, 'two_part');
  const pol = C({ color_shade: 'light_medium' }, '100% Polyester');
  assert.strictEqual(pol.dyeing_detail.route, 'disperse');
  assert(pol.dyeing_per_kg_usd < C({ color_shade: 'light_medium' }).dyeing_per_kg_usd, 'disperse is cheaper than reactive');
  assert(C({ color_shade: 'fluorescent' }, '100% Polyester').dyeing_per_kg_usd < C({ color_shade: 'fluorescent' }).dyeing_per_kg_usd, 'a polyester neon is the cheap one');
  assert.strictEqual(C({ color_shade: 'light_medium' }, '100% Nylon').dyeing_detail.route, 'acid');
  // a polyester loses far less in the bath than a cotton
  assert(pol.process_loss.pct < C({ color_shade: 'light_medium' }).process_loss.pct - 3);
  assert(processLoss({ segment: 'light', chem: 'scour', fibers: { cotton: 90, viscose: 10 } }).loss_pct
       < processLoss({ segment: 'light', chem: 'bleach', fibers: { cotton: 100 } }).loss_pct, 'a melange is not bleached');
  // a cross-dyed heather is dyed, a fibre-blend melange is washed
  assert.strictEqual(dyeingCharge({ shade: 'melange', spec: { melange: { carrier: 'cross_dye' } }, fibers: { cotton: 60, polyester: 40 } }).band, 'light_medium');
}

// 4. the yarn: synthetics on their own rows, blends from their fibres,
//    fleece and terry part by part
{
  assert(!/Cotton/.test(C({}, '100% Polyester').yarn_type_label), '100% polyester is not priced as cotton');
  assert(/Nylon/.test(C({}, '100% Nylon').yarn_type_label));
  assert(/Polyester/.test(C({}, '92% Polyester 8% Spandex').yarn_type_label), 'poly/spandex is a polyester yarn');
  const mel = C({}, '85% Cotton 15% Viscose');
  assert(/Blend/.test(mel.yarn_type_label) && mel.yarn_components.length === 2, '85/15 is priced from its fibres');
  const fl = C({ color_shade: 'black' }, '80% Cotton 20% Polyester', 'fleece_3_thread', 300);
  assert(fl.yarn_components && fl.yarn_components.length === 3, 'fleece: face, binder and loop each priced');
  const loop = fl.yarn_components.find((y) => y.role === 'loop');
  assert(/Carded/.test(loop.label) && loop.count_ne < 20, 'the coarse loop yarn is carded');
  assert(fl.finishing_detail.lines.some((l) => /Brush/.test(l.item)), 'a brushed fleece pays for the brushing');
  // spinning system moves a cotton row
  assert(C({ spinning_system: 'compact' }).yarn_final_price_usd > C({ spinning_system: 'combed' }).yarn_final_price_usd);
  assert(C({ spinning_system: 'open_end' }).yarn_final_price_usd < C({ spinning_system: 'carded' }).yarn_final_price_usd);
}

// 5. finishing by width and finish
{
  const tub = C({}), el = C({}, '95% Cotton 5% Elastane');
  assert(el.finishing_per_kg_usd > tub.finishing_per_kg_usd, 'elastane: open width + heat-set');
  assert(C({ surface_finish: 'peach_finish' }).finishing_per_kg_usd > tub.finishing_per_kg_usd);
  assert(C({ surface_finish: 'enzyme_wash', color_shade: 'light_medium' }).dyeing_per_kg_usd > C({ color_shade: 'light_medium' }).dyeing_per_kg_usd, 'enzyme runs in the dye bath');
}

// 6. the page's process-loss card shows the number the price used
{
  const r = calculate({ fabric: 'single_jersey', gsm: 160, composition: '100% Polyester', color_shade: 'black', efficiency: 85 });
  assert.strictEqual(r.process_loss.loss_pct, r.costing.process_loss.pct);
  const b = calculate({ fabric: 'single_jersey', gsm: 160, composition: '100% Cotton', color_shade: 'black', efficiency: 85 });
  assert(b.process_loss.factory_median_pct === 14, 'a black is a dark-segment loss (the six-tier key used to miss the table)');
}

// 7. no recipe card, no source names
{
  const c = C({ color_shade: 'black' });
  assert(!c.dyeing_detail.recipe_id && !c.dyeing_detail.chemicals);
  assert(!/textilepages|Fibre2Fashion|Supima\.com|Uddin|PLOS|http/i.test(JSON.stringify(c)), 'no source attribution in the costing');
  const { ENGINE_INPUTS } = require('../engine');
  assert(ENGINE_INPUTS.includes('dye_band'));
}

const show = (label, c) => console.log(`  ${label.padEnd(34)} yarn $${c.yarn_final_price_usd}  dye $${c.dyeing_per_kg_usd} (${c.dyeing_detail.band})  loss ${c.process_loss.pct}%  = $${c.total_per_kg_usd}  [$${c.accuracy.low}–$${c.accuracy.high}]`);
show('Cotton SJ, average colour', C({ color_shade: 'light_medium' }));
show('Cotton SJ, black', C({ color_shade: 'black' }));
show('CVC 60/40 SJ, navy', C({ color_shade: 'dark_navy' }, '60% Cotton 40% Polyester'));
show('Grey melange 90/10', C({ color_shade: 'melange' }, '90% Cotton 10% Viscose'));
show('Polyester SJ, neon', C({ color_shade: 'fluorescent' }, '100% Polyester'));
console.log('\nAll costing model tests passed.');
