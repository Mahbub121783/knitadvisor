// Fleece & loopback terry engine — grounded against real orders and physics.
const assert = require('assert');
const { analyzeFleece, _model } = require('../engine/domain/fleece-engine');
const { parseComposition } = require('../engine/domain/composition-engine');
const { calculate } = require('../engine');

console.log('--- Running Fleece Engine Tests ---');
const F = (fabricId, gsm, comp = '100% Cotton', extra = {}) =>
  analyzeFleece({ fabricId, gsm, gauge: 20, composition: parseComposition(comp), ...extra });

// 1. the model is built from the data, and the anchors are live
{
  const m = _model();
  assert(m.rows >= 100, 'factory fleece rows load from the reference snapshot');
  assert(Math.abs(m.wpcPerG - 0.578) < 0.03, `finished wales/cm per gauge ≈ 0.578 (got ${m.wpcPerG})`);
  assert.deepStrictEqual(m.anchors.slice().sort((a, b) => a - b), [6, 37, 47], 'the three full order specs are present');
  for (const l of m.loo) assert(Math.abs(l.error_pct) <= 8, `leave-one-out GSM within 8% (record ${l.record}: ${l.error_pct}%)`);
  console.log(`  Model from ${m.rows} factory rows; Kc fleece ${m.KC.fleece.toFixed(2)}, terry ${m.KC.terry.toFixed(2)}; LOO ${m.loo.map(l => l.error_pct + '%').join(', ')}`);
}

// 2. the real orders come back: same face and binder in, the solved loop yarn
//    is the one the order used
{
  const r37 = F('fleece_3_thread', 370, '100% Cotton', { faceNe: 26, faceSlMm: 4.45 });
  const loop37 = r37.yarns.find(y => y.role === 'loop');
  assert(loop37.ne >= 8 && loop37.ne <= 12, `record 37 (370 GSM cotton, 26/1+26/1): loop ≈ 10/1, got ${loop37.ne}/1`);
  const b37 = r37.yarns.find(y => y.role === 'binder');
  assert(/26\/1 cotton/.test(b37.label), '100% cotton fleece gets a cotton binder of the face count, as the order did');
  const r6 = F('fleece_3_thread', 310, '77% Cotton 23% Polyester', { faceNe: 30, faceSlMm: 4.6 });
  const loop6 = r6.yarns.find(y => y.role === 'loop');
  assert(loop6.ne >= 8 && loop6.ne <= 12, `record 6 (310 GSM CVC, 30/1+150D): loop ≈ 10/1, got ${loop6.ne}/1`);
  assert(/150D/.test(r6.yarns.find(y => y.role === 'binder').label), 'a polyester-bearing fleece at 310 GSM gets a 150D filament binder');
  console.log(`  Real orders reproduced: record 37 → loop ${loop37.ne}/1, record 6 → loop ${loop6.ne}/1 (both ran 10/1)`);
}

// 3. heavier fleece → coarser loop yarn (the old table had it backwards)
{
  const ne = [220, 260, 300, 340].map(g => F('fleece_3_thread', g).yarns.find(y => y.role === 'loop').ne);
  for (let i = 1; i < ne.length; i++) assert(ne[i] <= ne[i - 1], `loop yarn coarsens with weight: ${ne.join(' → ')}`);
  console.log(`  Loop yarn coarsens with weight: ${ne.join(' → ')} Ne for 220 → 340 GSM`);
}

// 4. mass balance closes
{
  for (const g of [220, 280, 340]) {
    const r = F('fleece_3_thread', g);
    assert(Math.abs(r.mass_balance.deviation_pct) <= 6, `snapped counts land within 6% of ${g} GSM (${r.mass_balance.gsm_at_chosen_counts})`);
    const shares = r.yarns.reduce((s, y) => s + (y.share_pct || 0), 0);
    assert(Math.abs(shares - 100) <= 0.5, 'yarn shares sum to 100%');
  }
  console.log('  Mass balance closes and yarn shares add to 100%');
}

// 5. composition: the loop blend is solved so the fabric lands on what was declared
{
  const cvc = F('fleece_3_thread', 300, '60% Cotton 40% Polyester');
  const poly = +((cvc.composition.achieved.match(/(\d+)% polyester/) || [])[1] || 0);
  assert(Math.abs(poly - 40) <= 4, `60/40 lands within 4 points (got ${cvc.composition.achieved})`);
  const cot = F('fleece_3_thread', 280);
  assert(cot.composition.achieved === '100% cotton', '100% cotton stays 100% cotton (no polyester binder)');
  const pes = F('fleece_3_thread', 300, '100% Polyester');
  assert(pes.composition.achieved === '100% polyester');
  const ela = F('fleece_3_thread', 280, '95% Cotton 5% Elastane');
  assert(!/elastane/i.test(ela.yarns.find(y => y.role === 'loop').label), 'elastane never goes in the loop yarn');
  console.log(`  Composition solved: 60/40 → ${cvc.composition.achieved} (loop ${cvc.composition.loop_yarn_blend})`);
}

// 6. physics: brushing adds thickness and warmth; terry is not brushed
{
  const f = F('fleece_3_thread', 300);
  assert(f.brushing && f.brushing.passes >= 3);
  assert(f.thermal.brushed.thickness_mm > f.thermal.unbrushed.thickness_mm * 1.4, 'the nap at least ~1.4× the thickness');
  assert(f.thermal.brushed.clo > f.thermal.unbrushed.clo, 'a raised nap is warmer');
  assert(f.thermal.brushed.porosity_pct > 85 && f.thermal.brushed.porosity_pct < 99, 'a fleece is mostly air');
  const fb = f.brushing.fabric_mass_removed_pct;
  assert(fb > 1.5 && fb < 8, `brushing removes a few % of the fabric (${fb}%)`);
  const t = F('french_terry', 280);
  assert(t.brushing === null && !t.variant.brushed, 'french terry is loopback, not raised');
  assert(!t.process_route.some(x => /brush|raise/i.test(x)), 'no brushing in a terry route');
  const more = F('fleece_3_thread', 300, '100% Cotton', { brushing: { passes: 6 } });
  assert(more.brushing.pile_height_mm > f.brushing.pile_height_mm && more.brushing.fabric_mass_removed_pct > fb, 'more passes: taller pile, more lint');
  console.log(`  Brushing: ${f.brushing.passes} passes, ${fb}% lint, nap ${f.brushing.pile_height_mm} mm, ${f.thermal.unbrushed.clo} → ${f.thermal.brushed.clo} clo`);
}

// 7. gauge: 20G carries the real orders; a 6s loop does not tuck on 24G
{
  const ok = F('fleece_3_thread', 370, '100% Cotton', { faceNe: 26, faceSlMm: 4.45 });
  assert(ok.gauge_check.ok, '26/1 + 26/1 + 10/1 runs on 20G, as record 37 did');
  const tight = analyzeFleece({ fabricId: 'fleece_3_thread', gsm: 420, gauge: 24, faceNe: 20, composition: parseComposition('100% Cotton') });
  assert(!tight.gauge_check.ok && tight.gauge_check.suggested_gauge < 24, 'a 20/1 face on 24G is flagged with a coarser gauge');
  console.log(`  Gauge: 20G ok for record 37; 20/1 face on 24G → use ${tight.gauge_check.suggested_gauge}G`);
}

// 8. the full engine: route order, no brushing for terry, disperse for polyester, fleece shrinkage
{
  const r = calculate({ fabric: 'fleece_3_thread', gsm: 300, composition: '100% Cotton', efficiency: 85 });
  const route = r.wet_processing.process_route;
  const iDry = route.findIndex(x => /Stenter dry/.test(x)), iBrush = route.findIndex(x => /Brushing/.test(x)), iDye = route.findIndex(x => /Dye/.test(x));
  assert(iDye < iDry && iDry < iBrush, 'dye → stenter dry → brush (raising needs dry cloth)');
  assert(r.fleece && /Loop: /.test(r.yarn.count_display) && /Binder/.test(r.yarn.count_display));
  assert(r.machine.optimal.optimal_gauge === 20, 'fleece machine gauge comes from the fleece check, not the jersey cover factor');
  const q = r.quality_prediction.shrinkage;
  assert(q.widthwise_pct > q.lengthwise_pct && q.lengthwise_pct > 4, `fleece shrinks more in width than length, near the tested L6/W8 (${q.lengthwise_pct}/${q.widthwise_pct})`);
  const t = calculate({ fabric: 'french_terry', gsm: 280, composition: '100% Cotton', efficiency: 85 });
  assert(!t.wet_processing.process_route.some(x => /Brushing/.test(x)), 'french terry route has no brushing');
  const p = calculate({ fabric: 'fleece_3_thread', gsm: 300, composition: '100% Polyester', efficiency: 85 });
  assert(p.wet_processing.dyeing_method === 'disperse' && !p.wet_processing.process_route.some(x => /^Reactive/.test(x)), 'polyester fleece is disperse-dyed');
  const c = calculate({ fabric: 'fleece_3_thread', gsm: 300, composition: '60% Cotton 40% Polyester', efficiency: 85, color_input: '19-4052' });
  assert(c.wet_processing.process_route.some(x => /Disperse/.test(x)) && c.wet_processing.process_route.some(x => /Reactive/.test(x)), 'a dark CVC is dyed in two baths');
  console.log('  Engine: dye → stenter → brush; terry unbrushed; polyester disperse; CVC two-bath; 20G; L/W shrinkage realistic');
}

console.log('\nAll fleece tests passed.');
