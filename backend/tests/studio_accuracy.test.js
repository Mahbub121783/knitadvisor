// How right the Studio is, measured honestly: cross-validation on the factory records (weft) and
// leave-one-out on the published tricots (warp), and the ranges every answer now carries.
const assert = require('assert');
const path = require('path');
console.log('--- Running Studio Accuracy Tests ---');

const CV = require('../tools/studio-crossval');
const dataset = require('../engine/catalog/factory-dataset');
const before = dataset.FACTORY_RECORDS.length;
const fresh = CV.run();
// the tool puts every record back, and the engine's constants are the production ones again
assert.strictEqual(dataset.FACTORY_RECORDS.length, before, 'cross-validation restores the records');
const saved = require('../engine/catalog/studio-accuracy.json');

// 1. the committed file is what the tool computes today (regenerate it when the engine or the records change)
for (const k of ['single_jersey', 'lacoste_single', 'rib_1x1+L', 'fleece_3_thread', '_all']) {
  assert.strictEqual(saved.groups[k].gsm.n, fresh.groups[k].gsm.n, `${k}: same records`);
  assert(Math.abs(saved.groups[k].gsm.mae_med - fresh.groups[k].gsm.mae_med) < 0.002, `${k}: studio-accuracy.json is stale — run node tools/studio-crossval.js`);
}
assert.strictEqual(fresh.refused === saved.refused, true);
assert(/5-fold/.test(saved.method) && saved.interval === 0.8);

// 2. what it found
const G = fresh.groups;
assert(G.single_jersey.gsm.n > 1000 && G.single_jersey.gsm.within_5 >= 60, 'single jersey: most land within ±5 % even unseen');
assert(G._all.gsm.mae_med < 0.05, 'all structures: typical GSM error under 5 %');
assert(G.rib_2x2.gsm.mae_med < 0.1, 'plain 2x2 rib: was 46 % off when its 13 records ran thin (single jersey\'s book value), now carried from its lycra twin');
// a structure with no records is honestly worse than one with records
assert(fresh.unseen.pooled.gsm.mae_med > G._all.gsm.mae_med, 'no records → wider error');
assert(fresh.unseen.by_family.rib.gsm.mae_med > 0.1, 'rib with no rib records is poorly predicted, and the file says so');
for (const v of Object.values(G)) for (const f of ['gsm', 'width']) if (v[f]) assert(v[f].p10 <= v[f].p50 && v[f].p50 <= v[f].p90 && v[f].within_3 <= v[f].within_5 && v[f].within_5 <= v[f].within_8, 'quantiles and hit rates are ordered');

// 3. the thin-variant fallback
const KP = require('../engine/domain/knit-plan');
const thin = KP.calFor('ks', 'waffle', true);
assert(thin.carried && /carried/.test(thin.basis) && thin.n === 26, 'waffle with elastane (3 records) borrows plain waffle, says so');
assert(!KP.calFor('ks', 'single_jersey', true).carried, 'a variant with records uses its own');
assert(KP.LYCRA_RATIO.ks > 0.5 && KP.LYCRA_RATIO.ks < 2);

// 4. every Studio answer carries its measured range
const S = require('../engine/domain/fabric-studio');
const T = S.listTemplates();
const rows = (g) => g.map((r) => (r.join ? r.join('') : r));
const run = (id, extra) => { const t = T.find((x) => x.id === id); return S.analyse({ bed: t.grid.D ? 'double' : 'single', gating: t.gating || 'rib', grid: { C: rows(t.grid.C), D: t.grid.D ? rows(t.grid.D) : null }, feeds: t.roles.map((role) => ({ role })), yarn: { fibre: 'cotton' }, target: { gsm: 180 }, machine: {}, ...(extra || {}) }); };
const sj = run('single_jersey');
const a = sj.fabric.accuracy;
assert(a && a.interval_pct === 80 && /cross-validated/.test(a.basis) && /1119/.test(a.basis));
assert(a.gsm.range[0] < sj.fabric.gsm && sj.fabric.gsm < a.gsm.range[1], 'the answer sits inside its range');
assert.deepStrictEqual(sj.fabric.gsm_range, a.gsm.range, 'gsm_range is the measured range, not the constants\' quartiles');
assert(a.gsm.within_5_pct === Math.round(G.single_jersey.gsm.within_5));
assert(a.width && a.width.range[0] < sj.fabric.width_open_in && sj.fabric.width_open_in < a.width.range[1]);
// a new structure: wider than the catalogue one
const novel = S.analyse({ bed: 'single', grid: { C: ['KT', 'TK', 'KK', 'KK'], D: null }, feeds: [0, 1, 2, 3].map(() => ({ role: 'ground' })), yarn: { fibre: 'cotton' }, target: { gsm: 180 }, machine: {} });
const na = novel.fabric.accuracy, la = run('lacoste_single').fabric.accuracy;
assert(['close', 'estimate'].includes(na.level));
assert((na.gsm.range[1] - na.gsm.range[0]) / novel.fabric.gsm > (la.gsm.range[1] - la.gsm.range[0]) / run('lacoste_single').fabric.gsm - 1e-9, 'an uncatalogued structure gets a range at least as wide as the catalogued one');
assert(na.gsm.within_5_pct <= la.gsm.within_5_pct);

// 5. warp: tricot checked leave-one-out, the rest says it is not checked
const WCV = require('../tools/warp-crossval').run();
const WS = require('../engine/catalog/warp-accuracy.json');
assert(Math.abs(WCV.tricot.gsm.mae_med - WS.tricot.gsm.mae_med) < 1e-9, 'warp-accuracy.json is current');
const W = require('../engine/domain/warp-studio');
const tpl = (id) => W.TEMPLATES.find((x) => x.id === id);
const wa = (id) => { const t = tpl(id); return W.analyse({ machine: { type: t.machine, gauge: t.gauge, gap_mm: t.gap }, bars: t.bars, target: { gsm: t.gsm } }); };
const lk = wa('locknit');
assert(lk.fabric.accuracy.checked && lk.fabric.accuracy.gsm.range[0] < lk.fabric.gsm && lk.fabric.gsm < lk.fabric.accuracy.gsm.range[1] && /leave-one-out/.test(lk.fabric.accuracy.basis));
for (const id of ['powernet', 'spacer', 'swim_tricot']) assert(!wa(id).fabric.accuracy.checked && /no published or factory/.test(wa(id).fabric.accuracy.basis), `${id}: not checked, and says so`);
assert(!wa('powernet').fabric.accuracy.gsm, 'no invented range where nothing was checked');

console.log('Studio accuracy tests passed');
