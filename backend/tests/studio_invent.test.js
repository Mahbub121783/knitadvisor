// Design from a goal: the Studio's own search for needle programmes, and the structural indicators it ranks them by.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require('../engine/domain/studio-invent');
const T = require('../engine/domain/structure-traits');
const S = require('../engine/domain/fabric-studio');
console.log('--- Running Studio Invent Tests ---');

const rows = (g) => g.map((r) => (r.join ? r.join('') : r));
const traitsOfTemplate = (id) => { const t = S.listTemplates().find((x) => x.id === id); return T.traitsOf({ C: rows(t.grid.C), D: t.grid.D ? rows(t.grid.D) : null }, t.grid.D ? (t.gating || 'rib') : null); };

// 1. the indicators follow the textbook order on the catalogue's own structures
{
  const sj = traitsOfTemplate('single_jersey'), rib = traitsOfTemplate('rib_1x1'), il = traitsOfTemplate('interlock'), lac = traitsOfTemplate('lacoste_single'), pq = traitsOfTemplate('pique_single'), pt = traitsOfTemplate('pointelle_eyelet');
  assert(rib.stretch > sj.stretch && sj.stretch > il.stretch, 'widthwise stretch: rib > jersey > interlock');
  assert(lac.texture > sj.texture && pq.texture > sj.texture, 'tucks give relief');
  assert(pt.open > sj.open && lac.open > sj.open, 'eyelets and isolated tucks open the cloth');
  assert(rib.flat > sj.flat && il.flat > sj.flat, 'a double bed lies flatter than single jersey');
  assert(sj.smooth > lac.smooth && sj.smooth > pq.smooth, 'plain knit is the smoothest face');
  assert.strictEqual(il.shares.miss, 0, "interlock's alternate misses are its structure, not floats");
  for (const v of [sj, rib, il, lac, pq, pt]) for (const k of T.TRAITS) assert(v[k] >= 0 && v[k] <= 1);
  assert.strictEqual(T.longestRun('KMMK', 'M'), 2); assert.strictEqual(T.longestRun('MKKM', 'M'), 2, 'runs wrap round the repeat'); assert.strictEqual(T.longestRun('MMM', 'M'), 3);
}

// 2. the goal is checked
assert.throws(() => I.cleanGoal({ gsm: 20 }), /80 to 600/);
assert.throws(() => I.cleanGoal({}), /target weight/);
const g = I.cleanGoal({ gsm: 180, bed: 'nonsense', prefs: { open: 5, stretch: -3, colour: 1 }, max_needles: 99 });
assert(g.bed === 'any' && g.prefs.open === 1 && g.prefs.stretch === -1 && !('colour' in g.prefs) && g.max_needles === 8);

// 3. what it finds: knittable at the weight, within the limits, different from each other, best for what was asked
const t0 = Date.now();
const open = I.invent({ gsm: 160, bed: 'single', prefs: { open: 1 }, novelty: 'new', max_needles: 4, max_feeds: 6 });
const ms = Date.now() - t0;
assert(open.success && open.candidates.length >= 3, 'answers found');
assert(ms < 6000, `bounded: ${ms} ms`);
assert(open.stats.evaluated <= 320 && open.stats.knittable > 0);
for (const c of open.candidates) {
  assert.strictEqual(c.bed, 'single'); assert(c.needles <= 4 && c.feeds <= 6 && c.longest_float <= 3, 'within the limits');
  // knitted again by the engine on its own: it really knits, at the weight
  const a = S.analyse({ bed: 'single', grid: { C: c.grid.C, D: null }, feeds: c.grid.C.map(() => ({ role: 'ground' })), yarn: { fibre: 'cotton' }, target: { gsm: 160 }, machine: {} });
  assert(a.success && a.ok_to_knit && Math.abs(a.fabric.gsm - 160) / 160 <= 0.04, `${c.grid.C.join('/')} knits at 160 GSM`);
  assert(c.accuracy && c.accuracy.gsm_range[0] <= c.fabric.gsm && c.fabric.gsm <= c.accuracy.gsm_range[1], 'each carries its measured range');
  assert(c.settings.yarn && c.settings.gauge > 0 && c.settings.sl_mm > 0, 'and the settings to knit it');
}
for (let i = 0; i < open.candidates.length; i++) for (let j = i + 1; j < open.candidates.length; j++) assert.notStrictEqual(open.candidates[i].grid.C.join('/'), open.candidates[j].grid.C.join('/'), 'all different');
// asked for open: the answers are more open than a search asking for the opposite
const closed = I.invent({ gsm: 160, bed: 'single', prefs: { open: -1 }, novelty: 'balanced', max_needles: 4, max_feeds: 6 });
const mean = (r, k) => r.candidates.reduce((t, c) => t + c.traits[k], 0) / r.candidates.length;
assert(mean(open, 'open') > mean(closed, 'open') + 0.15, 'the search follows the goal');
assert(open.candidates.filter((c) => c.is_new).length >= open.candidates.length / 2, '"surprise me" finds new structures');

// the same goal gives the same answers (so it caches)
const again = I.invent({ gsm: 160, bed: 'single', prefs: { open: 1 }, novelty: 'new', max_needles: 4, max_feeds: 6 });
assert.deepStrictEqual(again.candidates.map((c) => c.grid.C.join('/')), open.candidates.map((c) => c.grid.C.join('/')));

// a double bed, stretch, proven: rib-family answers, mostly catalogue structures
const rib = I.invent({ gsm: 260, bed: 'double', prefs: { stretch: 1 }, novelty: 'proven' });
assert(rib.candidates.every((c) => c.bed === 'double'));
assert(rib.candidates[0].traits.stretch >= 0.8, 'the best answer stretches');
assert(rib.candidates.filter((c) => !c.is_new).length >= 2, 'proven: catalogue structures come first');

// 4. wiring: a limited, cached route, and in the API
const api = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
assert(/router\.post\('\/studio\/invent', requireUser, inventLimiter/.test(api) && /inventRunning >= 2/.test(api) && /inventCache/.test(api));
assert(require('../engine/domain/api-catalogue').matchEndpoint('POST', '/studio/invent'));
const page = fs.readFileSync(path.join(__dirname, '../../frontend/studio.html'), 'utf8');
assert(page.includes('id="inv-card"') && page.includes('id="inv-go"'));
console.log(`Studio invent tests passed (${ms} ms for a search)`);
