// The pool: mills share one clamped number per structure — and each protection is a test.
const assert = require('assert');
console.log('--- Running Studio Pool Tests ---');

const MP = require('../engine/domain/machine-pool');
const ML = require('../engine/domain/machine-learning');
const F = require('../engine/domain/fabric-studio');

// helpers: rows as the repository returns them (newest first), one account's rolls of one structure
const rolls = (user, n, gsm, width, group = 'single_jersey', ne = 30) => Array.from({ length: n }, () => ({ user, group, ne, gsm_ratio: gsm, width_ratio: width }));
const mills = (list) => list.flatMap(([u, n, g, w]) => rolls(u, n, g, w));

// 1. k ≥ 5: fewer than five OTHER accounts → nothing is told
let rows = mills([['a', 4, 1.05, 0.95], ['b', 4, 1.05, 0.95], ['c', 4, 1.05, 0.95], ['d', 4, 1.05, 0.95]]);
assert.strictEqual(MP.tableFor(MP.aggregate(rows), 'new'), null, 'four mills are not enough');
rows = rows.concat(rolls('e', 4, 1.05, 0.95));
let t = MP.tableFor(MP.aggregate(rows), 'new');
assert(t && t.gsm.length === 1 && t.width.length === 1, 'five mills are');
assert(Math.abs(t.gsm[0].f - 1.05) < 1e-3 && Math.abs(t.width[0].f - 0.95) < 1e-3 && t.gsm[0].a === 5);

// 2. the account asking is never part of what it is told
assert.strictEqual(MP.tableFor(MP.aggregate(rows), 'a'), null, "with 'a' out there are only four others — and 'a' is told nothing");
rows = rows.concat(rolls('f', 4, 1.20, 0.80));
t = MP.tableFor(MP.aggregate(rows), 'f');
assert(Math.abs(t.gsm[0].f - 1.05) < 1e-3, "'f' (the outlier) hears only the five others");

// 3. one odd mill cannot drag the median; the number stays between what the others said
t = MP.tableFor(MP.aggregate(rows), 'new');
assert(t.gsm[0].f >= 1.05 - 1e-3 && t.gsm[0].f <= 1.2, 'one outlier among six moves the median by at most one rank');
assert(Math.abs(t.gsm[0].f - 1.05) < 1e-3, 'here not at all');

// 4. one account counts once however many rolls it has, and only with at least 2 in the cell
rows = mills([['a', 3, 1.04, 1], ['b', 3, 1.04, 1], ['c', 3, 1.04, 1], ['d', 3, 1.04, 1], ['e', 3, 1.04, 1]]).concat(rolls('loud', 500, 1.10, 1), rolls('shy', 1, 1.10, 1));
t = MP.tableFor(MP.aggregate(rows), 'new');
assert.strictEqual(t.gsm[0].a, 6, "'loud' counts once, 'shy' (1 roll) not at all");
assert(Math.abs(t.gsm[0].f - 1.04) < 1e-3, 'five of the six say 1.04 — a loud account does not outvote them');
assert(t.gsm[0].n <= 5 * 3 + MP.CAP, 'only its last 20 rolls were ever read');

// 5. bounded: whatever the mills say, the pool asks for at most ±10 % (weight) and ±8 % (width)
rows = mills([['a', 3, 1.6, 0.6], ['b', 3, 1.6, 0.6], ['c', 3, 1.6, 0.6], ['d', 3, 1.6, 0.6], ['e', 3, 1.6, 0.6]]);
t = MP.tableFor(MP.aggregate(rows), 'new');
assert(Math.abs(Math.log(t.gsm[0].f) - MP.CLAMP.gsm) < 1e-3 && Math.abs(Math.log(t.width[0].f) + MP.CLAMP.width) < 1e-3);
assert.strictEqual(MP.tableFor(MP.aggregate(mills([['a', 3, 3, 3], ['b', 3, 3, 3], ['c', 3, 3, 3], ['d', 3, 3, 3], ['e', 3, 3, 3]])), 'new'), null, 'implausible ratios (outside 0.5–2) are not read at all');

// 6. what leaves is numbers about a structure — no account, no machine, no roll
assert.deepStrictEqual(Object.keys(t.gsm[0]).sort(), ['a', 'band', 'f', 'group', 'n']);
assert.deepStrictEqual(Object.keys(t.width[0]).sort(), ['a', 'f', 'group', 'n']);

// 7. a table handed in by a caller is held to the same rules
assert.strictEqual(MP.cleanTable({ gsm: [{ group: 'x', band: 1, f: 1.05, a: 4, n: 20 }], width: [] }), null, 'a < 5 mills is refused');
assert.strictEqual(MP.cleanTable({ gsm: [{ group: 'x', band: 1, f: 9, a: 9, n: 20 }] }), null, 'an absurd factor is refused');
const ct = MP.cleanTable({ gsm: [{ group: 'single_jersey', band: 3, f: 1.5, a: 9, n: 90 }], width: [{ group: 'single_jersey', f: 0.9, a: 9, n: 90 }, 'junk', null] });
assert(Math.abs(Math.log(ct.gsm[0].f) - MP.CLAMP.gsm) < 1e-9, 'and clamped again');
assert.strictEqual(MP.cleanTable('x'), null);

// 8. lookup by structure and count band
const tab = { gsm: [{ group: 'single_jersey', band: MP.bandOf(30), f: 1.04, a: 8, n: 80 }], width: [{ group: 'single_jersey', f: 0.97, a: 8, n: 80 }] };
assert(MP.lookup(tab, 'single_jersey', 31).gsm && MP.lookup(tab, 'single_jersey', 31).width);
assert.strictEqual(MP.lookup(tab, 'single_jersey', 40).gsm, null, 'weight is pooled per count band');
assert(MP.lookup(tab, 'single_jersey', 40).width, '… width across counts');
assert.strictEqual(MP.lookup(tab, 'rib_1x1', 30).width, null);
assert.deepStrictEqual(MP.lookup(null, 'x', 30), { gsm: null, width: null });
assert.deepStrictEqual(MP.coverage(tab), [{ group: 'single_jersey', accounts: 8 }]);

// 9. in the machine's learning: with no rolls the prior counts for a/(a+5); each roll of its own pulls away from it
const sd0 = { p10: -0.06, p90: 0.06 };
const ctx = { group: 'single_jersey', ne: 30, gsmCV: sd0, widthCV: sd0, pool: MP.lookup(tab, 'single_jersey', 30) };
const w8 = 8 / 13;
let p = ML.learnProfile([], ctx);
assert(Math.abs(p.gsm_factor - Math.pow(1.04, w8)) < 1e-9 && Math.abs(p.width_factor - Math.pow(0.97, w8)) < 1e-9, 'no rolls: prior^w');
assert.strictEqual(p.n, 0); assert.strictEqual(p.pooled_gsm.accounts, 8);
assert.strictEqual(p.gsm_sd, ML.sigmaFromCV(sd0), 'the pool never narrows the range');
const mine = Array.from({ length: 10 }, () => ({ group: 'single_jersey', ne: 30, gsm_ratio: 0.97, width_ratio: 1.03 }));
const q = ML.learnProfile(mine, ctx), alone = ML.learnProfile(mine, { ...ctx, pool: null });
assert(Math.abs(Math.log(q.gsm_factor) - (10 * Math.log(0.97) + ML.K * w8 * Math.log(1.04)) / (10 + ML.K)) < 1e-9, 'with rolls: (Σ ln r + K·w·ln prior) ÷ (n + K)');
assert(q.gsm_factor > alone.gsm_factor && q.gsm_factor < 1, 'the pool leans on it a little; its own rolls decide');
const noPool = ML.learnProfile(mine, { ...ctx, pool: undefined });
assert.strictEqual(noPool.pooled_gsm, null);
assert(Math.abs(ML.learnProfile(mine, ctx).gsm_factor - ML.learnProfile(mine.concat(mine, mine, mine), ctx).gsm_factor) < 1e-12, 'only the last 10 rolls count, pool or not');

// 10. in the Studio: a newcomer with no rolls is started from the pool, and told so
const t0 = F.listTemplates().find((x) => x.id === 'single_jersey');
const base = { bed: t0.bed, grid: t0.grid, feeds: [{ role: 'ground' }], yarn: { count: 30, unit: 'ne', fibre: 'cotton' }, machine: { gauge: 24, dia: 30, sl_mm: 2.7 }, target: {} };
const plain = F.analyse(base);
const pooledRun = F.analyse({ ...base, floor: { name: null, rolls: [], pool: tab } });
assert.strictEqual(pooledRun.fabric.accuracy.level, 'pooled');
assert.strictEqual(pooledRun.fabric.accuracy.supported_by_rolls, 0);
assert(pooledRun.fabric.gsm > plain.fabric.gsm && pooledRun.fabric.width_open_in < plain.fabric.width_open_in, 'heavier and narrower, as the pool says');
assert(/pooled/.test(pooledRun.fabric.accuracy.basis) && /pooled/.test(pooledRun.fabric.ks_basis), 'it says where the number came from');
assert(!/mill-?\w*-|user/i.test(JSON.stringify(pooledRun.fabric.accuracy)));
const ownToo = F.analyse({ ...base, floor: { name: 'M-07', rolls: Array.from({ length: 6 }, () => ({ group: 'single_jersey', ne: 30, gsm_ratio: 0.97, width_ratio: 1.03 })), pool: tab } });
assert.strictEqual(ownToo.fabric.accuracy.level, 'machine');
assert(/M-07/.test(ownToo.fabric.accuracy.basis) && /pooled rolls/.test(ownToo.fabric.accuracy.basis));
const thin = F.analyse({ ...base, floor: { name: null, rolls: [], pool: { gsm: [{ group: 'single_jersey', band: MP.bandOf(30), f: 1.04, a: 3, n: 30 }], width: [] } } });
assert.strictEqual(thin.fabric.gsm, plain.fabric.gsm, 'a table with fewer than 5 mills behind it is ignored');
assert.strictEqual(F.analyse({ ...base, floor: { pool: { gsm: [{ group: 'rib_1x1', band: 3, f: 1.04, a: 8, n: 80 }], width: [] } } }).fabric.gsm, plain.fabric.gsm, "another structure's number does not apply");
const own = F.analyse({ ...base, calibration: { rolls: [{ sl_mm: 2.7, gsm: 150, width_in: 64, ne: 30, gauge: 24, dia: 30 }] }, floor: { name: null, rolls: [], pool: tab } });
assert.notStrictEqual(own.fabric.accuracy.level, 'pooled', "the design's own trial roll still wins");

// 11. the search is for THIS machine: candidates are weighed on its profile
const I = require('../engine/domain/studio-invent');
const goal = { gsm: 170, bed: 'single', novelty: 'proven', yarn: { count: 30, fibre: 'cotton' }, machine: { gauge: 24, dia: 30 } };
const heavy = Array.from({ length: 8 }, () => ({ group: 'single_jersey', ne: 30, gsm_ratio: 1.08, width_ratio: 0.96 }));
const inv0 = I.invent(goal, { maxEvals: 120, timeMs: 1500 });
const inv1 = I.invent({ ...goal, floor: { name: 'M-07', rolls: heavy } }, { maxEvals: 120, timeMs: 1500 });
assert.strictEqual(inv0.machine_profile, null);
assert.deepStrictEqual(inv1.machine_profile, { name: 'M-07', rolls: 8, pooled: false });
assert(!('floor' in inv1.goal), 'the rolls are not echoed back');
assert.notDeepStrictEqual(inv1.candidates.map((c) => c.name), inv0.candidates.map((c) => c.name), 'a machine with its own history is offered different cloths');
assert.strictEqual(inv1.candidates[0].accuracy.level, 'machine', 'the best of them is one this machine has rolls behind');
const solve = (fl) => F.analyse({ ...base, machine: { gauge: 24, dia: 30 }, target: { gsm: 170 }, ...(fl ? { floor: fl } : {}) }).fabric.sl_mm;
assert(solve({ name: 'M-07', rolls: heavy }) > solve(null), 'a machine that knits heavy needs a longer stitch for the same weight');
assert(inv1.candidates.some((c) => c.accuracy && c.accuracy.level === 'machine' && c.accuracy.supported_by_rolls > 0), 'and says how many rolls stand behind a candidate');

// 12. the repository: membership is all that is stored; leaving takes effect at once; the head-count stays private under 5
const calls = [];
let members = new Set(), dbRows = [];
const stub = {
  async query(sql, args) {
    calls.push(sql.replace(/\s+/g, ' ').trim().slice(0, 40));
    if (/INSERT INTO studio_pool_members/.test(sql)) { members.add(args[0]); return []; }
    if (/DELETE FROM studio_pool_members/.test(sql)) { members.delete(args[0]); return []; }
    if (/row_number\(\)/.test(sql)) return dbRows.filter((r) => members.has(r.user));
    return [];
  },
  async queryOne(sql, args) {
    if (/FROM studio_pool_members WHERE user_id/.test(sql)) return members.has(args[0]) ? { x: 1 } : null;
    if (/count\(\*\)::int AS n FROM studio_pool_members/.test(sql)) return { n: members.size };
    if (/count\(\*\)::int AS n FROM studio_floor_rolls/.test(sql)) return { n: 7 };
    return null;
  },
};
const clientPath = require.resolve('../db/client');
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: stub };
delete require.cache[require.resolve('../db/repositories/pool-repo')];
const PR = require('../db/repositories/pool-repo');
dbRows = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((u) => rolls(u, 4, 1.04, 0.97));
(async () => {
  for (const u of ['a', 'b', 'c', 'd', 'e']) await PR.members.join(u);
  assert.strictEqual(await PR.tableFor('a'), null, "five members: 'a' is told nothing (only four others)");
  assert.strictEqual((await PR.status('a')).mills, 5);
  await PR.members.join('f');
  assert(await PR.tableFor('f'), 'six members: the sixth hears the five');
  const aTable = await PR.tableFor('a');
  assert(aTable && aTable.gsm[0].a === 5, "'a' hears the other five");
  await PR.members.leave('b');
  assert.strictEqual(await PR.members.isMember('b'), false);
  assert.strictEqual(await PR.tableFor('a'), null, "'b' left: the cache was dropped and its rolls are out of the number at once");
  const s = await PR.status('b');
  assert.strictEqual(s.member, false); assert.deepStrictEqual(s.covered, []); assert.strictEqual(s.my_rolls, 7);
  await PR.members.leave('c'); await PR.members.leave('d'); await PR.members.leave('e');
  assert.strictEqual((await PR.status('a')).mills, null, 'a head-count under 5 is not given out');
  console.log('Studio pool tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
