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
  // interlock jacquard: every preset with an even width knits, each needle of each bed knits once per pixel row, and facing needles never knit at one feed
  J.PRESETS.forEach((p) => {
    [['same'], ['plain'], ['negative']].forEach(([back]) => {
      if (back === 'negative' && p.colours.length !== 2) return;
      let d; try { d = J.build({ motif: p.rows, bed: 'interlock', back }); } catch (e) { assert(/needs \d+ feeds/.test(e.message), e.message); return; }
      d.C.forEach((cr, f) => cr.forEach((x, w) => assert(!(x === 'K' && d.D[f][w] === 'K'), `${p.id} ${back}: facing needles ${w} knit together at feed ${f + 1}`)));
      const r = run({ bed: 'double', gating: 'interlock', grid: { C: d.C.map((x) => x.join('')), D: d.D.map((x) => x.join('')) }, feeds: d.feeds, target: { gsm: 260 }, colourway: { colours: { A: '#1b2a4a', B: '#e9e4d8', C: '#a8322d' } } });
      assert(r.success && r.ok_to_knit, `${p.id} interlock ${back}: ${r.error || errs(r).join('; ')}`);
      assert(r.colourway && (r.colourway.kind === 'motif' || r.colourway.kind === 'wale stripe'));
    });
  });
  assert.throws(() => J.build({ motif: ['AAB', 'ABB'], bed: 'interlock' }), /even number of needles/);
  const il = J.build({ motif: ['AABB'], bed: 'interlock', back: 'same' });
  assert.deepStrictEqual(il.C.map((r) => r.join('')), ['KMMM', 'MKMM', 'MMKM', 'MMMK'], 'two colours x two parities: four feeds, one cylinder needle each');
  assert.deepStrictEqual(il.D.map((r) => r.join('')), ['MKMM', 'KMMM', 'MMMK', 'MMKM'], 'the dial needle facing it knits at the other feed of the pair');
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
  assert.throws(() => J.build({ motif: ['AB'.repeat(J.MAX_WIDTH / 2 + 1)] }), new RegExp('holds ' + J.MAX_WIDTH));
  assert.throws(() => J.build({ motif: J.PRESETS.find((p) => p.id === 'plaid').rows, bed: 'rib', back: 'negative' }), /exactly two colours/);
  assert.throws(() => J.build({ motif: Array.from({ length: 80 }, (_, i) => 'ABC'.repeat(2).slice(i % 3, (i % 3) + 4).padEnd(4, 'A')) }), /needs \d+ feeds/);
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
{
  // a picture instead of a painted motif: colours picked, motif sized to the loop, floats tied with tucks, programme built
  const MI = require('../engine/domain/motif-from-image');
  const X = require('../engine/domain/machine-export');
  const pic = (w, h, f) => { const b = Buffer.alloc(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f(x / w, y / h); b[(y * w + x) * 3] = c[0]; b[(y * w + x) * 3 + 1] = c[1]; b[(y * w + x) * 3 + 2] = c[2]; } return { width: w, height: h, rgb: b.toString('base64') }; };
  const NAVY = [18, 41, 90], CREAM = [239, 230, 210], RED = [179, 32, 42];
  const circle = pic(120, 120, (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.38 ? NAVY : CREAM));
  const r = MI.fromImage({ ...circle, needles: 24, bed: 'single', wpc: 12.2, cpc: 10.5 });
  assert.strictEqual(r.palette.length, 2); assert.strictEqual(r.palette[0].letter, 'A');
  assert(r.palette[0].share_pct > r.palette[1].share_pct, 'A is the commonest colour (the ground)');
  assert(r.palette.every((p) => p.pantone && p.pantone.code), 'each yarn colour is matched to a Pantone TCX');
  assert.strictEqual(r.colour_error.quality, 'good');
  assert.strictEqual(r.width, 24); assert.strictEqual(r.height, Math.round(24 * (10.5 / 12.2)), 'rows follow the loop: a pixel is 1/wpc wide and 1/cpc high');
  assert(Math.abs(r.size.width_cm / r.size.height_cm - 1) < 0.06, 'a circle stays a circle: the motif is as wide as it is high in cm, not in pixels');
  // the picture is the circle: the middle is navy (B), the corners cream (A), and it is symmetric
  const mid = r.motif[Math.floor(r.height / 2)];
  assert(mid[12] !== mid[0], 'the middle and the corner are different colours');
  r.motif.slice(5, 9).forEach((row) => assert.strictEqual(row, row.split('').reverse().join(''), 'a row through the circle reads the same from both ends'));
  // floats are bound with tucks, and the picture is untouched: every pixel of the motif still knits at its own colour's feed
  const d = J.build({ motif: r.motif, bed: 'single', tie_floats: true });
  assert(d.longest_float <= 4 && d.ties > 0, `floats are tied: longest ${d.longest_float}, ${d.ties} tucks`);
  let ri = 0, f = 0;
  while (ri < r.motif.length) {
    const row = r.motif[ri], cols = [...new Set(row.split(''))].sort();
    cols.forEach((X1) => { d.C[f].forEach((x, w) => { if (x === 'K') assert.strictEqual(row[w], X1, 'a knit is where the picture has that colour'); if (row[w] === X1) assert.strictEqual(x, 'K', 'every pixel of that colour knits'); }); f++; });
    ri++;
  }
  const an = run({ bed: 'single', grid: { C: d.C.map((x) => x.join('')) }, feeds: d.feeds, colourway: { colours: { A: r.palette[0].hex, B: r.palette[1].hex } } });
  assert(an.success && an.ok_to_knit && an.colourway.kind === 'motif', an.error || errs(an).join('; '));
  assert(!an.checks.some((c) => /a float across/.test(c.text)), 'the Studio\'s own float check is satisfied after the ties');
  // flat stripes: three colours, a clean result, no ties needed
  const flag = MI.fromImage({ ...pic(150, 100, (u, v) => (v < 0.34 ? NAVY : v < 0.67 ? CREAM : RED)), needles: 24, bed: 'single' });
  assert.strictEqual(flag.palette.length, 3); assert(flag.motif.every((row) => new Set(row).size === 1), 'every row is one colour: no blended edge colour appears');
  // a photograph-like gradient and noise are told to be simplified
  assert.strictEqual(MI.fromImage({ ...pic(100, 100, (u, v) => [Math.round(255 * u), Math.round(255 * v), Math.round(255 * (1 - u))]), needles: 24, bed: 'single' }).colour_error.quality, 'poor');
  // interlock: even width, two feeds a colour, fits the feeds the Studio holds by dropping colours, then size
  const il = MI.fromImage({ ...pic(120, 120, (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.4 ? (Math.hypot(u - 0.5, v - 0.5) < 0.2 ? [232, 195, 42] : NAVY) : CREAM)), needles: 25, bed: 'interlock', back: 'same' });
  assert(il.width % 2 === 0 && il.programme.feeds <= J.MAX_FEEDS && il.palette.length >= 2, `interlock: ${il.width} wide, ${il.programme.feeds} feeds`);
  const ild = J.build({ motif: il.motif, bed: 'interlock', back: 'same', tie_floats: true });
  const ilr = run({ bed: 'double', gating: 'interlock', grid: { C: ild.C.map((x) => x.join('')), D: ild.D.map((x) => x.join('')) }, feeds: ild.feeds, target: { gsm: 260 } });
  assert(ilr.success && ilr.ok_to_knit, ilr.error || errs(ilr).join('; '));
  // refusals in words
  assert.throws(() => MI.fromImage({ width: 10, height: 10, rgb: 'AAAA' }), /needs 300/);
  assert.throws(() => MI.fromImage({ ...pic(40, 40, () => NAVY), needles: 12 }), /one colour/);
  // the colour files: a PNG in the yarn colours and the colour list
  const sheetOut = run({ bed: 'single', grid: { C: d.C.map((x) => x.join('')) }, feeds: d.feeds, colourway: { colours: { A: r.palette[0].hex, B: r.palette[1].hex }, order: { kg: 200 } } });
  const P = X.motifProgramme(sheetOut, 'face');
  assert.strictEqual(P.W, 24); assert.strictEqual(P.pal.length, 3);
  const png = X.png(P, 4); assert.strictEqual(png.slice(1, 4).toString(), 'PNG');
  assert.strictEqual(png.readUInt32BE(16), 24 * 4, 'the PNG is one pixel per needle (times the scale) wide');
  const csv = X.colourCsv(sheetOut, 'circle');
  assert(/Nearest Pantone TCX/.test(csv) && /Yarn to dye kg/.test(csv) && /Motif — face/.test(csv));
  assert.throws(() => X.motifProgramme(run({ bed: 'single', grid: { C: ['K'] } })), /no colours to export/);
  console.log('✓ a picture becomes the motif: the yarn colours are picked (A is the ground) and matched to Pantone, the rows follow the loop proportions, floats are tied with tucks without changing the picture, a gradient is told to be simplified, an interlock fits the feeds; the colour motif PNG and the yarn-colour CSV export');
}
{
  // the Studio's own rules understand a jacquard: a course is the feeds in which every needle knits once, and on a double bed a float is where neither bed catches the yarn
  const tri = J.build({ motif: ['AABBCC', 'ABCABC', 'CCBBAA', 'BCABCA'], bed: 'single' });
  const a1 = run({ bed: 'single', grid: { C: tri.C.map((x) => x.join('')) }, feeds: tri.feeds });
  assert(!a1.checks.some((c) => /misses \d+ feeds running/.test(c.text)), 'three colours a row: a needle misses two feeds in a course, not "stretched over courses"');
  // a plain structure keeps the rule: one needle missing six feeds running is still flagged
  const held = run({ bed: 'single', grid: { C: ['KK', 'KM', 'KM', 'KM', 'KM', 'KM', 'KM'] } });
  assert(held.checks.some((c) => c.level === 'warn' && /misses 6 feeds running/.test(c.text)));
  // a double-bed feed whose face needles miss but whose dial needles knit has no float
  const dbl = J.build({ motif: J.PRESETS.find((p) => p.id === 'diamond').rows, bed: 'rib', back: 'negative' });
  const a2 = run({ bed: 'double', gating: 'rib', grid: { C: dbl.C.map((x) => x.join('')), D: dbl.D.map((x) => x.join('')) }, feeds: dbl.feeds, target: { gsm: 240 } });
  assert(!a2.checks.some((c) => /a float across|float of \d+ needles/.test(c.text)), 'the exchanged back catches every needle on one bed or the other: no float');
  // the Studio holds 96 feeds
  const tall = J.build({ motif: Array.from({ length: 40 }, (_, y) => 'AB'.repeat(8).slice(y % 2, y % 2 + 12)), bed: 'single' });
  assert(tall.feeds_total === 80 && J.MAX_FEEDS === S.LIMITS.feeds, 'the builder and the Studio agree on the feed limit');
  const a3 = run({ bed: 'single', grid: { C: tall.C.map((x) => x.join('')) }, feeds: tall.feeds });
  assert(a3.success && a3.ok_to_knit, a3.error || errs(a3).join('; '));
  console.log('✓ the Studio rules: misses are counted in courses (a jacquard row is one course), a double-bed float is where neither bed catches the yarn, and 96 feeds are held (the builder and the Studio agree)');
}
console.log('Colourway tests passed');
