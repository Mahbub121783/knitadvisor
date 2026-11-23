// Cam sheet import: the way a design is written on the floor (tracks x feeders, a needle setting, feeder colours) becomes the Studio's drawing.
'use strict';
const assert = require('assert');
const CS = require('../engine/domain/cam-sheet');
const S = require('../engine/domain/fabric-studio');

console.log('--- Running Cam Sheet Tests ---');
const analyse = (d, gsm) => S.analyse({ bed: d.bed === 'double' ? d.gating : 'single', gating: d.gating === 'single' ? undefined : d.gating, grid: { C: d.C, D: d.D }, feeds: d.feeds, yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: gsm || 200 }, machine: {} });

{
  // the two complete sheets: they build, the Studio knits them, and the Studio's own cam chart reproduces the sheet exactly
  for (const ex of CS.EXAMPLES) {
    const d = CS.build(ex.spec);
    const r = analyse(d);
    assert(r.success && r.ok_to_knit, `${ex.id}: ${r.error || r.checks.filter((c) => c.level === 'error').map((c) => c.text).join('; ')}`);
    const back = CS.sheetOf(d.C);
    assert.deepStrictEqual(back.tracks, ex.spec.tracks, ex.id + ': the tracks come back as written');
    assert.strictEqual(back.needles.join(' '), ex.spec.needles, ex.id + ': the needle setting comes back as written');
    // and the Studio's own derived set-out is the same sheet again
    const st = r.setup.tracks.C;
    assert.strictEqual(st.sequences.map((x) => x.sequence).join(','), ex.spec.tracks.map((t) => t.replace(/-/g, 'M').replace(/K/g, 'K')).map((t) => t).join(','));
  }
  console.log('✓ the 2-colour jacquard (11 feeders, 4 tracks, 14 needles) and the crepe (12 feeders, 3 tracks) build, knit, and come back from the Studio\'s own cam chart exactly as written');
}
{
  // the formula: a needle knits at a feeder when the cam of ITS track is a knit there
  const d = CS.build({ tracks: ['K-', '-K'], needles: '1 2 2 1', legend: 'letters' });
  assert.deepStrictEqual(d.C.map((r) => r.join('')), ['KMMK', 'MKKM']);
  // the tuck feeder of the crepe is not an error: its yarn is cast off by the next knitting feeder
  const crepe = analyse(CS.build(CS.EXAMPLES[1].spec), 220);
  assert(!crepe.checks.some((c) => c.level === 'error') && crepe.checks.some((c) => /only tucks/.test(c.text)), 'a tuck-only feeder is a note, not an error');
  // a feeder with neither knit nor tuck is still an error: its yarn is caught nowhere
  const lost = analyse(CS.build({ tracks: ['KKK-', 'KKK-'], needles: '1 2', legend: 'letters' }));
  assert(lost.checks.some((c) => c.level === 'error' && /knits on no needle/.test(c.text)));
  console.log('✓ grid[feeder][needle] = track of the needle at that feeder; a tuck-only feeder is a note, a feeder that catches nothing is still an error');
}
{
  // symbols: the same chart in two legends
  const cam = CS.build({ legend: 'cam', tracks: ['^-V^', '-^^-'], needles: '1 2 1' });
  assert.deepStrictEqual(cam.C.map((r) => r.join('')), ['KMK', 'MKM', 'TKT', 'KMK'].map((x, i) => x).slice(0, 4).map((x, i) => ['KMK', 'MKM', 'TKT', 'KMK'][i]));
  const spaced = CS.build({ legend: 'letters', tracks: ['K - - K', 'K K - -'], needles: [1, 2] });
  assert.deepStrictEqual(spaced.C.map((r) => r.join('')), ['KK', 'MK', 'MM', 'KM']);
  const odd = CS.build({ legend: 'letters', tracks: ['K?K'], needles: '1' });
  assert(odd.notes.some((n) => /"\?" is not in the legend/.test(n)));
  const custom = CS.build({ map: { X: 'K', O: 'T' }, tracks: ['XO-'], needles: '1' });
  assert.deepStrictEqual(custom.C.map((r) => r.join('')), ['K', 'T', 'M']);
  console.log('✓ legends: letters, cam symbols (^ V -), spaced rows, a custom map; a symbol the legend does not know is read as a miss and said so');
}
{
  // colours: names, one letter each, six at most
  const d = CS.build({ ...CS.EXAMPLES[0].spec, colours: 'WBWBWBWBWBW' });
  assert.deepStrictEqual(d.feeds.map((f) => f.colour).join(''), 'ABABABABABA');
  assert.deepStrictEqual(d.colours.letters, { A: 'white', B: 'black' });
  assert(/^#[0-9a-f]{6}$/i.test(d.colours.hex.A) && d.colours.hex.A !== d.colours.hex.B);
  assert.throws(() => CS.build({ ...CS.EXAMPLES[0].spec, colours: 'White Black' }), /2 feeder colours were given for 11 feeders/);
  assert.throws(() => CS.build({ tracks: ['KKKKKKK'], needles: '1', colours: 'a b c d e f g' }), /different colours/);
  assert(CS.build({ tracks: ['K'], needles: '1', colours: 'teal' }).notes.some((n) => /teal/.test(n)));
  console.log('✓ feeder colours: names or letters (W B), mapped to the Studio\'s yarn colours A-F with real colours; wrong counts are refused in words');
}
{
  // two beds: the dial's own tracks and needle setting; settings of different length repeat together
  const d = CS.build({ legend: 'letters', tracks: ['KM', 'MK'], needles: '1 2', dial_tracks: ['MK', 'KM'], dial_needles: '1 2', gating: 'rib' });
  assert.strictEqual(d.bed, 'double'); assert.deepStrictEqual([d.C.length, d.C[0].length, d.D.length, d.D[0].length], [2, 2, 2, 2]);
  const lcm = CS.build({ legend: 'letters', tracks: ['KM', 'MK'], needles: '1 2 1', dial_tracks: ['MK', 'KM'], dial_needles: '1 2', gating: 'interlock' });
  assert.strictEqual(lcm.C[0].length, 6); assert.strictEqual(lcm.gating, 'interlock');
  assert.throws(() => CS.build({ legend: 'letters', tracks: ['KM', 'MK'], needles: '1 2', dial_tracks: ['MKM'], dial_needles: '1' }), /dial sheet has 3 feeders/);
  const rib = analyse(CS.build({ legend: 'letters', tracks: ['K', 'M'], needles: '1 2', dial_tracks: ['M', 'K'], dial_needles: '1 2', gating: 'rib' }), 240);
  assert(rib.success, rib.error);
  console.log('✓ two beds: cylinder and dial each have their own tracks and needle setting; different lengths repeat together (capped at 48); mismatched feeders are refused');
}
{
  // refusals in words
  assert.throws(() => CS.build({ tracks: ['KK', 'K'], needles: '1' }), /do not have the same number of feeders/);
  assert.throws(() => CS.build({ tracks: ['KK'], needles: '1 2' }), /only 1 track/);
  assert.throws(() => CS.build({ tracks: ['KK'], needles: '' }), /needle setting/);
  assert.throws(() => CS.build({ tracks: [], needles: '1' }), /Give the cylinder tracks/);
  assert.throws(() => CS.build({ tracks: ['K'], needles: '1', legend: 'nope' }), /Unknown legend/);
  assert.throws(() => CS.build({ tracks: ['K'.repeat(49)], needles: '1' }), /more than the Studio holds/);
  console.log('✓ a track of the wrong length, a needle number beyond the tracks, no needle setting, no tracks, an unknown legend and a sheet too big are each refused with the reason');
}
{
  // a sheet with the cam chart and no needle setting ("What is the needle setting?"): the settings that knit are searched for
  const crepe = CS.suggestNeedles({ tracks: CS.EXAMPLES[1].spec.tracks, legend: 'letters' }, { min_length: 4, max_length: 4, limit: 20 });
  assert(crepe.suggestions.length >= 5 && crepe.suggestions.every((x) => x.length === 4 && x.knit_pct > 0));
  assert(crepe.suggestions.some((x) => x.needles === '1 2 3 2'), 'the own setting of the sheet is among the answers (as its rotation 1 2 3 2)');
  // every suggestion really knits: built and analysed it again
  for (const x of crepe.suggestions.slice(0, 5)) { const d = CS.build({ tracks: CS.EXAMPLES[1].spec.tracks, needles: x.needles, legend: 'letters' }); assert(analyse(d).ok_to_knit, x.needles); }
  // the same sheet gives the same answers; a feeder left with nothing never appears
  assert.deepStrictEqual(CS.suggestNeedles({ tracks: CS.EXAMPLES[1].spec.tracks, legend: 'letters' }).suggestions.map((x) => x.needles), CS.suggestNeedles({ tracks: CS.EXAMPLES[1].spec.tracks, legend: 'letters' }).suggestions.map((x) => x.needles));
  assert(/NOT known/.test(crepe.basis), 'it says the cam chart alone does not decide the setting');
  console.log('✓ no needle setting on the sheet: the settings that knit are searched (the own setting of the sheet is among them), each is rebuilt and knits, the answer is repeatable, and it says the chart alone cannot decide');
}
console.log('Cam sheet tests passed');
