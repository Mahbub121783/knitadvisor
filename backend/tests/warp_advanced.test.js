// Warp knitting beyond the loop: trial-roll calibration, the wet route, the cloth in every state, the guide-bar drive, the open area, the gates, the files.
'use strict';
const assert = require('assert');
const W = require('../engine/domain/warp-studio');
const WP = require('../engine/domain/warp-process');
const X = require('../engine/domain/warp-export');
const { fuzz } = require('../tools/fuzz-warp');

console.log('--- Running Warp Advanced Tests ---');
const T = (id) => W.TEMPLATES.find((t) => t.id === id);
const of = (id, extra) => { const t = T(id); return W.analyse({ machine: { type: t.machine, gauge: t.gauge, gap: t.gap, notation_step: t.notation_step }, bars: t.bars, target: { gsm: t.gsm }, ...(extra || {}) }); };
const NY = (n, x) => ({ count: n, unit: 'denier', fibre: 'nylon_filament', ...(x || {}) });
const design = (bars, o) => W.analyse({ machine: { type: 'tricot', gauge: 28, cpc: 24 }, bars, ...(o || {}) });

{
  // 1 · nothing beyond the loop dies silently: every template × every shade
  let n = 0;
  for (const t of W.TEMPLATES) for (const shade of ['white', 'medium', 'black']) {
    const r = of(t.id, { chemistry: { shade } });
    assert(r.success, `${t.id}: ${r.error}`);
    assert.deepStrictEqual(r.engine_faults, [], `${t.id}/${shade}: ${JSON.stringify(r.engine_faults)}`);
    for (const k of ['chemistry', 'states', 'drive', 'open_area', 'gates']) assert(r[k], `${t.id}: ${k} is empty`);
    assert(r.chemistry.success && r.chemistry.route.length >= 2, `${t.id}: a wet route`);
    n++;
  }
  console.log(`✓ ${n} designs (every template × 3 shades): the wet route, states, drive, open area and gates all answer, nothing fails silently`);
}
{
  // 2 · trial rolls: one roll puts the level right, the width sets the finished width, a runner corrects the yarn per course, scatter is shown
  const base = design([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }]);
  const cpc = base.machine.cpc_machine;
  const measuredGsm = base.fabric.gsm * 1.08;
  const one = design([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { calibration: { rolls: [{ cpc, gsm: measuredGsm }] } });
  assert(one.calibration && Math.abs(one.calibration.f_lc - 1.08) < 0.01, `yarn per course +8 %: ${one.calibration && one.calibration.f_lc}`);
  assert(Math.abs(one.fabric.gsm / measuredGsm - 1) < 0.005, 'the model now reproduces the roll it was calibrated on');
  assert(Math.abs(one.bars[0].runner_mm_per_rack / base.bars[0].runner_mm_per_rack - 1.08) < 0.01, 'the runner follows the yarn per course');
  assert(one.fabric.accuracy.own_rolls && /1 trial roll/.test(one.fabric.accuracy.basis));
  assert(one.checks.some((c) => /Calibrated on your 1 trial roll/.test(c.text)));
  // a width
  const wide = design([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { calibration: { rolls: [{ cpc, gsm: measuredGsm, width_in: 90 }] } });
  assert(Math.abs(wide.fabric.width_in - 90) < 0.2, `finished width from the roll: ${wide.fabric.width_in}`);
  assert(Math.abs(wide.fabric.gsm / measuredGsm - 1) < 0.005, 'and the weight still matches the roll at that width');
  // a measured runner alone
  const rn = design([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { calibration: { rolls: [{ cpc, runner_mm_per_rack: [base.bars[0].runner_mm_per_rack * 0.95, base.bars[1].runner_mm_per_rack * 0.95] }] } });
  assert(Math.abs(rn.calibration.f_lc - 0.95) < 0.01 && Math.abs(rn.fabric.gsm / base.fabric.gsm - 0.95) < 0.01, 'two runners 5 % short: the weight follows');
  // two rolls scatter
  const two = design([{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }], { calibration: { rolls: [{ cpc, gsm: base.fabric.gsm * 1.05 }, { cpc, gsm: base.fabric.gsm * 1.15 }] } });
  assert(two.calibration.scatter_pct > 5 && two.calibration.scatter_pct < 9, `scatter of 5 % and 15 % rolls: ${two.calibration.scatter_pct}`);
  // refused with the reason
  assert(/courses per cm/.test(W.analyse({ machine: { type: 'tricot', gauge: 28, cpc: 24 }, bars: [{ notation: '1-0/1-2//', yarn: NY(40) }], calibration: { rolls: [{ gsm: 100 }] } }).error));
  assert(/At most 12/.test(design([{ notation: '1-0/1-2//', yarn: NY(40) }], { calibration: { rolls: Array(13).fill({ cpc, gsm: 100 }) } }).error));
  console.log('✓ trial rolls: one roll reproduces itself (weight and runner), a width sets the finished width, a measured runner corrects the yarn per course, two rolls show their scatter, bad rolls are refused with the reason');
}
{
  // 3 · the cloth in every state: one density, the finished state is the Studio's, greige is narrower, washing shrinks
  const r = of('swim_tricot'), S = Object.fromEntries(r.states.states.map((s) => [s.state, s]));
  assert.strictEqual(S.finished.gsm, r.fabric.gsm); assert.strictEqual(S.finished.width_in, r.fabric.width_in);
  assert(S.greige.width_in < S.finished.width_in, 'an elastic cloth is narrower greige than finished (the set widens it)');
  for (const s of r.states.states) assert(Math.abs(s.gsm * s.width_in * (1 / s.cpc) - r.fabric.gsm * r.fabric.width_in / r.fabric.cpc) / (r.fabric.gsm * r.fabric.width_in / r.fabric.cpc) < 0.03, `${s.state}: the same yarn: weight × width ÷ courses per cm is constant`);
  assert(S.washed.width_in <= S.finished.width_in && S.washed.cpc >= S.finished.cpc - 0.01, 'washing shrinks');
  assert.strictEqual(S.machine.wpc, Math.round(r.machine.gauge / 2.54 * 100) / 100, 'on the machine the wales are the gauge');
  assert(of('full_tricot').states.states.find((s) => s.state === 'greige').width_in / of('full_tricot').fabric.width_in > r.states.states.find((s) => s.state === 'greige').width_in / r.fabric.width_in, 'a rigid cloth is set less far than an elastic one');
  console.log('✓ the cloth in every state: the finished state is the Studio\'s, one yarn in every state (weight × width ÷ courses per cm), the elastic cloth set further, washing shrinks');
}
{
  // 4 · the drive, checked independently
  const r = of('satin'), p = r.machine.pitch_mm;
  r.drive.bars.forEach((b, bi) => {
    const P = r.lapping[bi].pairs;
    P.forEach(([x, y], k) => { const [nx] = P[(k + 1) % P.length]; assert.strictEqual(b.courses[k].underlap, Math.abs(nx - y)); assert(Math.abs(b.courses[k].shog_mm - Math.abs(nx - y) * p) < 0.011, 'shog = underlap × pitch'); });
    assert.strictEqual(b.chain_links, 2 * P.length, 'two chain links per course');
  });
  assert.strictEqual(r.drive.longest_shog_needles, 3);
  // a 3-needle shog on a tricot rated for 2: slower, in proportion to 1/√shog
  assert.strictEqual(r.drive.speed_allowed_cpm, Math.round(3300 * Math.sqrt(2 / 3)));
  assert.strictEqual(r.drive.speed_ok, r.machine.speed_cpm <= r.drive.speed_allowed_cpm);
  const fast = W.analyse({ machine: { type: 'tricot', gauge: 28, speed_cpm: 3300 }, bars: T('satin').bars, target: { gsm: 135 } });
  assert(fast.gates.rules.find((g) => g.id === 'W-04').status === 'warn', 'full speed on a 3-needle shog is flagged');
  // raschel-style notation: the chain numbers are the numbers typed
  const ras = of('elastic_raschel');
  assert(ras.drive.bars[0].courses.every((c) => c.chain.every((v) => v % 2 === 0)), 'raschel notation: even chain numbers');
  console.log('✓ the drive: shog = underlap × pitch, two chain links a course, the allowed speed falls with 1/√shog and a fast run on a long shog is flagged, raschel chain numbers are the numbers typed');
}
{
  // 5 · the wet route follows the fibres
  const ny = of('swim_tricot', { chemistry: { shade: 'dark' } }).chemistry;
  assert(ny.route.some((s) => s.id === 'heatset' && s.t_c >= 170 && s.t_c <= 195), 'nylon with elastane is set first');
  assert(ny.dyes.some((d) => /Acid/i.test(d.class)), 'nylon takes acid dye');
  const pe = design([{ notation: '1-0/1-2//', yarn: { count: 75, unit: 'denier', fibre: 'polyester_filament' } }, { notation: '1-2/1-0//', yarn: { count: 75, unit: 'denier', fibre: 'polyester_filament' } }]).chemistry;
  assert(pe.dyes.some((d) => /Disperse/i.test(d.class)), 'polyester takes disperse dye');
  const co = design([{ notation: '1-0/1-2//', yarn: { count: 30, unit: 'ne', fibre: 'cotton' } }, { notation: '1-2/1-0//', yarn: { count: 30, unit: 'ne', fibre: 'cotton' } }], { machine: { type: 'raschel', gauge: 18, cpc: 10 } }).chemistry;
  assert(co.dyes.some((d) => /Reactive/i.test(d.class)), 'cotton takes reactive dye');
  assert(of('swim_tricot', { chemistry: { shade: 'dark' } }).chemistry.dyes[0].owf_pct > of('swim_tricot', { chemistry: { shade: 'light' } }).chemistry.dyes[0].owf_pct, 'a darker shade takes more dye');
  // more than four fibres: routed on the four largest, and said
  const six = design(['nylon_filament', 'polyester_filament', 'elastane', 'polypropylene', 'cotton', 'viscose'].map((f, i) => ({ notation: i % 2 ? '1-2/1-0//' : '1-0/1-2//', yarn: f === 'cotton' || f === 'viscose' ? { count: 30, unit: 'ne', fibre: f } : NY(40, { fibre: f }) })), { machine: { type: 'raschel', gauge: 24, cpc: 20 } });
  if (six.success) assert(six.chemistry.success && six.chemistry.warnings.some((w) => /four largest/.test(w.text)), 'six fibres: the route says what it left out');
  console.log('✓ the wet route follows the fibres: nylon set then acid, polyester disperse, cotton reactive, a darker shade more dye, more than four fibres routed on the largest and said');
}
{
  // 6 · the gates
  const pp = design([{ notation: '1-0/1-2//', yarn: NY(40, { fibre: 'polypropylene' }) }, { notation: '1-2/1-0//', yarn: NY(40, { fibre: 'elastane', draft: 2.5 }) }]);
  assert.strictEqual(pp.gates.verdict, 'fatal'); assert(pp.gates.export_locked && /fuse/.test(pp.gates.rules.find((g) => g.id === 'W-05').text), 'polypropylene with elastane cannot be set');
  assert.throws(() => X.lappingCsv(pp, 'x'), /locked/);
  const mix = design([{ notation: '1-0/1-2//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40, { fibre: 'polyester_filament' }) }]);
  assert.strictEqual(mix.gates.rules.find((g) => g.id === 'W-05').status, 'warn', 'nylon with polyester: two dye classes');
  const split = design([{ notation: '1-0/0-1//', yarn: NY(40) }]);
  assert.strictEqual(split.ok_to_knit, false); assert.strictEqual(split.gates.rules.find((g) => g.id === 'W-01').status, 'fatal'); assert(split.gates.export_locked);
  const thick = design([{ notation: '1-0/1-2//', yarn: NY(300) }, { notation: '1-2/1-0//', yarn: NY(300) }], { machine: { type: 'tricot', gauge: 40, cpc: 20 } });
  assert.strictEqual(thick.gates.rules.find((g) => g.id === 'W-03').status, 'warn', 'a 300 D yarn on E40');
  const ok = of('locknit');
  assert.strictEqual(ok.gates.verdict, 'pass'); assert(!ok.gates.export_locked);
  console.log('✓ the gates: polypropylene with elastane is fatal and locks the files, nylon with polyester warns, a cloth that falls apart is fatal, a coarse yarn on a fine gauge warns, a plain locknit passes');
}
{
  // 7 · the open area
  assert(of('full_tricot').open_area.open_area_pct < 5 && of('full_tricot').open_area.kind === 'closed');
  assert(of('sandfly').open_area.open_area_pct > 40 && /open/.test(of('sandfly').open_area.kind), 'a sandfly net is open');
  assert(of('sandfly').open_area.empty_cells_pct === 50, 'half the cells of a half-set net have no loop');
  assert(of('powernet').open_area.open_area_pct > of('full_tricot').open_area.open_area_pct * 3, 'a powernet is more open than a tricot');
  console.log('✓ the open area: a tricot is closed, a half-set net is open, a powernet in between');
}
{
  // 8 · the files
  const r = of('locknit'), csv = X.lappingCsv(r, 'Locknit');
  assert(/warp lapping chart/.test(csv) && /Pattern chain and shog/.test(csv) && /Wet route/.test(csv) && /Greige/.test(csv));
  assert.strictEqual(csv.split('\r\n').filter((l) => /^\d+,\d+,\d+,\d+,\d+,\d+,[\d.]+,\d+,\d+$/.test(l)).length, r.drive.bars.reduce((t, b) => t + b.courses.length, 0), 'one line per bar and course');
  const doc = X.sheet(r, { name: 'Locknit' }), chunks = [];
  return new Promise((res) => { doc.on('data', (c) => chunks.push(c)); doc.on('end', () => res(Buffer.concat(chunks))); doc.end(); }).then(async (buf) => {
    assert(buf.slice(0, 5).toString() === '%PDF-');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pd = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
    assert(pd.numPages >= 1 && pd.numPages <= 3, `pages: ${pd.numPages}`);
    console.log('✓ the files: a lapping chart with one line for every bar and course, and a set-up sheet of ' + pd.numPages + ' page' + (pd.numPages > 1 ? 's' : ''));
    const f = fuzz(800, 20261124);
    assert.deepStrictEqual(f.bad, {}, JSON.stringify(Object.fromEntries(Object.entries(f.bad).map(([k, v]) => [k, v.slice(0, 3)]))));
    console.log(`✓ ${f.stat.designs} random lappings (${f.stat.knits} knit): no throw, no NaN, no silent engine failure, same input same answer, states and drive coherent, files made`);
    console.log('Warp advanced tests passed');
  });
}
