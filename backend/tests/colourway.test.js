// Colourway: several yarn colours dyed as yarn (stripes, wale stripes, jacquard), and the motif painter that makes the needle programme.
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const CW = require('../engine/domain/colourway');
const J = require('../engine/domain/jacquard-builder');

console.log('--- Running Colourway Tests ---');
const base = { yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: 200 }, machine: {} };
const colours = { A: '#0b1f4a', B: '#f4f4f4', C: '#b3202a', D: '#e8c32a' };
const run = (o) => S.analyse({ ...base, ...o });
const IL = { bed: 'double', gating: 'interlock', grid: { C: ['KM', 'MK'], D: ['MK', 'KM'] } };
const errs = (r) => (r.checks || []).filter((c) => c.level === 'error').map((c) => c.text);

{
  // a horizontal stripe on a single jersey: the kind, the yarn share by colour, the kilograms with the loss, the minimum lot
  const r = run({ bed: 'single', grid: { C: ['K'] }, stripes: { sequence: 'A1 B1 C1 B1' }, colourway: { colours, names: { A: 'Navy', B: 'White' }, order: { kg: 500, lot_min_kg: 150 } } });
  assert(r.success && r.ok_to_knit);
  const cw = r.colourway;
  assert.strictEqual(cw.kind, 'horizontal stripe');
  assert.deepStrictEqual(cw.colours.map((c) => c.letter + c.yarn_pct), ['A25', 'B50', 'C25']);
  const A = cw.colours[0];
  assert.strictEqual(A.name, 'Navy');
  assert.strictEqual(A.kg_net, 125); assert.strictEqual(A.kg_yarn, 128.9, '125 kg ÷ (1 − 3 % loss)');
  assert(A.below_min_lot && A.short_by_kg > 0, 'a colour under the dyer\'s minimum lot is flagged');
  assert(!cw.colours[1].below_min_lot, '257 kg is over the minimum');
  assert.strictEqual(cw.order.yarn_kg_total, +cw.colours.reduce((t, c) => t + c.kg_yarn, 0).toFixed(1));
  // each colour has its own route: the white is bleached as yarn, the navy is dyed; a dark reactive has staining and wet-rub grades
  assert(cw.colours[1].white && /Peroxide/.test(cw.colours[1].route.join(' ')) && !cw.colours[1].dye.length);
  assert(/Reactive dyeing/.test(A.route.join(' ')) && A.dye[0].owf_pct > 4);
  assert(A.fastness.overall.stain && A.fastness.overall.rub_wet);
  // navy against white stains; the feeders each colour takes
  assert(cw.pairs.some((p) => p.risk === 'stain' && /A|B/.test(p.a + p.b)), 'a dark yarn beside a white one is a staining risk');
  assert(cw.checks.some((c) => c.level === 'warn' && /stain/.test(c.text)));
  assert(cw.colours.every((c) => c.feeders > 0), 'every colour has feeders threaded with it')
  console.log('✓ a single-jersey stripe: kind, yarn share by colour, kilograms with the loss, the minimum lot, a route and fastness for each colour, the staining risk of navy against white');
}
{
  // an interlock course is two feeds: A1 B1 is a WALE stripe, A2 B2 a horizontal one, and the stripe heights count two feeds as one course
  const w = run({ ...IL, stripes: { sequence: 'A1 B1' }, colourway: { colours } });
  assert.strictEqual(w.colourway.kind, 'wale stripe');
  assert(w.colourway.checks.some((c) => /pairs of feeds/.test(c.text)), 'it tells you how to write the horizontal stripe');
  const h = run({ ...IL, stripes: { sequence: 'A2 B2' }, colourway: { colours } });
  assert.strictEqual(h.colourway.kind, 'horizontal stripe');
  const cpc = h.fabric.cpc, mm = h.machine_setup.stripes.runs[0].mm;
  assert(Math.abs(mm - (10 / cpc)) < 0.06, `two interlock feeds are ONE course: ${mm} mm against ${(10 / cpc).toFixed(2)}`);
  // a colour on each feeder of the course: the same wale stripe, from the drawing
  const f = run({ ...IL, feeds: [{ colour: 'A' }, { colour: 'B' }], colourway: { colours } });
  assert.strictEqual(f.colourway.kind, 'wale stripe');
  // a rib: each feed is a course
  const rib = run({ bed: 'double', gating: 'rib', grid: { C: ['K'], D: ['K'] }, stripes: { sequence: 'A3 B1' }, colourway: { colours } });
  assert.strictEqual(rib.colourway.kind, 'horizontal stripe');
  assert.deepStrictEqual(rib.colourway.colours.map((c) => c.yarn_pct), [75, 25]);
  console.log('✓ interlock: A1 B1 is a wale stripe (and says how to write a horizontal one), A2 B2 a horizontal stripe whose height counts two feeds as one course; rib counts a feed as a course');
}
{
  // tone on tone: two navies fade into each other; no stain warning
  const r = run({ bed: 'single', grid: { C: ['K'] }, stripes: { sequence: 'A4 B4' }, colourway: { colours: { A: '#1f3b73', B: '#22407a' } } });
  assert(r.colourway.pairs[0].risk === 'tone' && r.colourway.pairs[0].delta_e00 < 6);
  assert(!r.colourway.checks.some((c) => /stain/.test(c.text)));
  // no colours: no colourway; one colour: none either
  assert.strictEqual(run({ bed: 'single', grid: { C: ['K'] } }).colourway, null);
  assert.strictEqual(CW.analyse({ C: ['K'], feedColours: ['A'], seq: ['A'] }), null);
  console.log('✓ two close colours are tone on tone, not a stain; a plain cloth has no colourway');
}
{
  // the cam sheet's two-colour jacquard: needle-wise colour, two feeds a row
  const CS = require('../engine/domain/cam-sheet');
  const d = CS.build(CS.EXAMPLES[0].spec);
  const r = run({ bed: 'single', grid: { C: d.C.map((x) => x.join('')) }, feeds: d.feeds, colourway: { colours: { A: '#ffffff', B: '#111111' } } });
  assert.strictEqual(r.colourway.kind, 'motif');
  assert.strictEqual(r.colourway.colours_per_row, 2);
  assert(Math.abs(r.colourway.colours[0].face_pct + r.colourway.colours[1].face_pct - 100) < 0.2);
  console.log('✓ the jacquard cam sheet reads as a motif of two colours a row, with the share of each colour on the face');
}
{
  // the motif painter: every preset builds, knits as drawn and reads back as a motif (or a wale stripe)
  const go = (p, bed, back) => {
    const d = J.build({ motif: p.rows, bed, back });
    const r = run({ bed: d.bed === 'double' ? 'double' : 'single', gating: d.bed === 'double' ? 'rib' : undefined, grid: { C: d.C.map((x) => x.join('')), D: d.D ? d.D.map((x) => x.join('')) : null }, feeds: d.feeds, colourway: { colours: { A: '#1b2a4a', B: '#e9e4d8', C: '#a8322d' } } });
    assert(r.success && r.ok_to_knit, `${p.id} ${bed} ${back}: ${r.error || errs(r).join('; ')}`);
    assert(r.colourway && (r.colourway.kind === 'motif' || r.colourway.kind === 'wale stripe'), `${p.id}: ${r.colourway && r.colourway.kind}`);
    return d;
  };
  J.PRESETS.forEach((p) => {
    go(p, 'single'); go(p, 'rib', 'same'); go(p, 'rib', 'plain');
    if (p.colours.length === 2) go(p, 'rib', 'negative');
  });
  // the programme: at the feed of colour X a needle knits where the motif has X, and misses elsewhere
  const d = J.build({ motif: ['AB', 'BB'], bed: 'single' });
  assert.deepStrictEqual(d.C.map((r) => r.join('')), ['KM', 'MK', 'KK'], 'row 1 is two feeds (A then B), row 2 is one feed of B knitting every needle');
  assert.deepStrictEqual(d.feeds.map((f) => f.colour), ['A', 'B', 'B']);
  // every needle knits once per pixel row, on the face and on the back
  const dd = J.build({ motif: ['AABB', 'ABAB'], bed: 'rib', back: 'negative' });
  for (let r = 0; r < 2; r++) {
    const feedsOfRow = dd.feeds.map((f, i) => i).filter((i) => dd.feeds[i] && i >= (r ? 2 : 0) && i < (r ? 4 : 2));
    for (let w = 0; w < 4; w++) { assert.strictEqual(feedsOfRow.filter((i) => dd.C[i][w] === 'K').length, 1, 'the face needle knits once'); assert.strictEqual(feedsOfRow.filter((i) => dd.D[i][w] === 'K').length, 1, 'the dial needle knits once'); }
  }
  // the exchanged back: where the face is A the back is B
  assert.strictEqual(dd.C[0].map((x, w) => (x === 'K' ? 'A' : '.')).join(''), 'AA..');
  assert.deepStrictEqual(dd.D[0], ['M', 'M', 'K', 'K'], 'at the feed of A the dial knits where the pixel is not A');
  console.log('✓ the motif painter: every preset knits as drawn on a single bed and on a double bed (same, plain, exchanged back); the programme is the colour of each needle, and each needle knits once a row');
}
{
  // floats and refusals in words
  const diamond = J.build({ motif: J.PRESETS[0].rows, bed: 'single' });
  assert(diamond.checks.some((c) => c.level === 'warn' && /float across 10 needles/.test(c.text)), 'the long float of the diamond is named');
  assert(J.build({ motif: J.PRESETS[0].rows, bed: 'single', max_float: 12 }).checks.every((c) => c.level !== 'warn'));
  assert.throws(() => J.build({ motif: ['AAB', 'AB'] }), /same width/);
  assert.throws(() => J.build({ motif: ['AAA'] }), /at least two colours/);
  assert.throws(() => J.build({ motif: ['AAXB'] }), /letters A to F/);
  assert.throws(() => J.build({ motif: ['A'.repeat(49)] }), /holds 48/);
  assert.throws(() => J.build({ motif: J.PRESETS.find((p) => p.id === 'plaid').rows, bed: 'rib', back: 'negative' }), /exactly two colours/);
  assert.throws(() => J.build({ motif: Array.from({ length: 30 }, (_, i) => 'ABC'.repeat(2).slice(i % 3, (i % 3) + 4).padEnd(4, 'A')) }), /needs \d+ feeds/);
  console.log('✓ a float over the limit is named by row and colour; a ragged motif, one colour, a bad letter, too wide, a three-colour exchanged back and too many feeds are each refused in words');
}
{
  // the development sheet carries the colours: one lot each, with the kilograms of the order, and the finishing says the cloth is not bleached
  const DS = require('../engine/domain/dev-sheet');
  const sh = DS.build({ design: { bed: 'single', grid: { C: ['K'] }, stripes: { sequence: 'A2 B2 C2 B2' }, colourway: { colours, order: { kg: 400, lot_min_kg: 50 } } }, composition: '100% CO', gsm: 180, shade: 'medium' }, S.analyse);
  assert(sh.colours && sh.colours.kind === 'horizontal stripe' && sh.colours.colours.length === 3);
  assert(sh.colours.order.yarn_kg_total > 400 && sh.colours.colours.every((c) => c.route.length >= 3));
  assert(/yarn is dyed before knitting/.test(sh.finishing.sequence.find((x) => x.step === 'Wet processing').params));
  const plain = DS.build({ design: { bed: 'single', grid: { C: ['K'] } }, composition: '100% CO', gsm: 180, shade: 'medium' }, S.analyse);
  assert.strictEqual(plain.colours, null);
  console.log('✓ the development sheet: a yarn-dyed design gets its colour section (kg per colour, route, fastness) and a wet process that does not bleach the cloth; a plain cloth has none');
}
console.log('Colourway tests passed');
