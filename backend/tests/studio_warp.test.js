// Fabric Studio, warp knitting (warp-studio.js): lapping notation, laps,
// what each bar knits, runner geometry, weight, width and the checks.
const assert = require('assert');
const W = require('../engine/domain/warp-studio');
console.log('--- Running Studio Warp Tests ---');

const near = (a, b, t, m) => assert(Math.abs(a - b) <= t, `${m}: ${a} vs ${b}`);
const NY = (count) => ({ count, unit: 'denier', fibre: 'nylon_filament' });
const run = (bars, machine, target) => W.analyse({ machine: { type: 'tricot', gauge: 28, ...(machine || {}) }, bars, target: target || {} });

// notation: pairs, overlap / underlap, closed and open laps
assert.deepStrictEqual(W.parseNotation('1-0/1-2//', 1), [[1, 0], [1, 2]]);
const tl = W.lapping([[1, 0], [1, 2]]);
assert(tl.every((l) => l.o === 1 && l.u === 1 && l.closed), 'tricot 1-0/1-2: 1-needle overlap and underlap, closed laps');
const open = W.lapping([[0, 1], [2, 3]]);
assert(open.some((l) => !l.closed), '0-1/2-3 laps open (underlap carries on the overlap direction)');
assert.strictEqual(W.kindOf(W.lapping([[1, 0], [0, 1]])).key, 'pillar');
assert.strictEqual(W.kindOf(W.lapping([[0, 0], [2, 2]])).key, 'inlay');
assert.strictEqual(W.kindOf(W.lapping([[1, 0], [3, 4]])).key, 'u3');
assert.strictEqual(W.kindOf(W.lapping(W.parseNotation('1-0/1-2/2-3/3-4/3-2/2-1//'))).key, 'atlas');

// every template knits and is named
for (const t of W.TEMPLATES) {
  const r = W.analyse({ machine: { type: t.machine, gauge: t.gauge }, bars: t.bars, target: { gsm: t.gsm } });
  assert(r.success, `${t.id}: ${r.error}`);
  assert(r.ok_to_knit, `${t.id}: ${r.checks.filter((c) => c.level === 'error').map((c) => c.text)}`);
  assert(r.structure.name, `${t.id}: named`);
  near(r.fabric.gsm, t.gsm, 1, `${t.id}: the quality solved hits the GSM`);
}

// runner geometry: a longer underlap needs more yarn; E28 charmeuse runners in the published order (front ~1,700, back ~1,300 mm/rack at 20 cpc)
{
  const r = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 });
  const [f, b] = r.bars.map((x) => x.runner_mm_per_rack);
  assert(f > b, 'the 2-needle front bar takes more yarn than the 1-needle back bar');
  assert(f > 1450 && f < 1950 && b > 1100 && b < 1500, `runners ${f} / ${b}`);
  // a closer quality (more courses/cm) → shorter loops → less yarn per course, more GSM
  const r2 = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 30 });
  assert(r2.bars[0].mm_per_course < r.bars[0].mm_per_course && r2.fabric.gsm > r.fabric.gsm);
  // weight follows the yarn: double the denier, double the weight
  const r3 = run([{ notation: '1-0/2-3//', yarn: NY(80) }, { notation: '1-2/1-0//', yarn: NY(80) }], { cpc: 20 });
  near(r3.fabric.gsm / r.fabric.gsm, 2, 0.06, 'GSM ∝ tex');
  // part threading halves that bar's ends
  const r4 = run([{ notation: '1-0/2-3//', threading: 'X.', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 });
  assert.strictEqual(r4.bars[0].ends, Math.round(r.bars[0].ends / 2));
  // elastane is fed drafted
  const r5 = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: { count: 40, unit: 'denier', fibre: 'elastane', draft: 2 } }], { cpc: 20 });
  near(r5.bars[1].fed_mm_per_rack * 2, r5.bars[1].runner_mm_per_rack, 2, 'fed = runner ÷ draft');
  // a finished width given sets the narrowing
  const r6 = run([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 }, { width_in: 80 });
  near(r6.fabric.width_in, 80, 0.1, 'finished width as given');
}

// checks
{
  const err = (r) => r.checks.filter((c) => c.level === 'error').map((c) => c.text).join(' | ');
  assert(/front bar\) inlays/.test(err(run([{ notation: '0-0/2-2//', yarn: NY(40) }, { notation: '1-0/0-1//', yarn: NY(40) }], { cpc: 20 }))));
  assert(/no bar makes a loop/.test(err(run([{ notation: '1-0/1-1//', yarn: NY(40) }, { notation: '0-0/1-1//', yarn: NY(40) }], { cpc: 20 }))));
  assert(/shogs/.test(err(run([{ notation: '1-0/8-9//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { cpc: 20 }))));
  assert(run([{ notation: '1-0/1-2//', yarn: NY(40) }, { notation: '1-0/1-2//', yarn: NY(40) }], { cpc: 20 }).checks.some((c) => c.level === 'warn' && /same way/.test(c.text)));
  // bad notation: a clear message, not a crash
  const bad = run([{ notation: '1-0/9', yarn: NY(40) }], { cpc: 20 });
  assert(!bad.success && /not a lapping pair/.test(bad.error));
  assert(!run([{ notation: '1-0/1-2//', yarn: {} }], { cpc: 20 }).success, 'a bar needs its yarn');
}
console.log('Studio warp tests passed');
