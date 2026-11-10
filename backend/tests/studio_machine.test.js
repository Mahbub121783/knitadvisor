// Fabric Studio: the machine, needle-selection and cam engine (knit-machine.js).
//   - each design gets the simplest machine class that knits it
//   - a chosen machine refuses what it cannot knit: too many needle
//     sequences for its tracks, a cam it does not have, a transfer without
//     transfer needles, two beds on a single-bed machine, the wrong gating,
//     a pile without terry sinkers
//   - needle selection (jacquard) has no track limit
//   - set-out + cam chart compile back to exactly the notation (all templates)
//   - cam totals round the machine add up
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const KM = require('../engine/domain/knit-machine');
console.log('--- Running Studio Machine Tests ---');

const T = S.listTemplates();
const rows = (g) => g.map((r) => (r.join ? r.join('') : r));
const pay = (t, machine, extra) => ({
  bed: t.grid.D ? 'double' : 'single', gating: t.gating || 'rib', grid: { C: rows(t.grid.C), D: t.grid.D ? rows(t.grid.D) : null },
  feeds: t.roles.map((role) => ({ role })), yarn: { fibre: 'cotton' }, target: { gsm: 200 }, machine: machine || {}, ...(extra || {}),
});
const run = (id, machine, extra) => S.analyse(pay(T.find((x) => x.id === id), machine, extra));
const errs = (r) => r.checks.filter((c) => c.level === 'error').map((c) => c.text);

// auto: the simplest class that knits it
const auto = { single_jersey: 'sj_2track', lacoste_single: 'sj_2track', knitted_twill: 'sj_4track', fleece_3_thread: 'fleece_3t', terry_fabric: 'terry',
  pointelle: 'pointelle', rib_1x1: 'rib_dj', full_cardigan: 'rib_dj', interlock: 'interlock_2x2' };
for (const [id, p] of Object.entries(auto)) {
  const r = run(id);
  assert(r.success, id);
  assert.strictEqual(r.machine_setup.profile.id, p, `${id} → ${p}`);
  assert(r.machine_setup.profile.auto);
  assert(!errs(r).some((t) => /machine|track|cam|sinker|needle/.test(t) && !/never knits|knits on no/.test(t)), `${id}: knits on its own machine: ${errs(r)}`);
}

// a chosen machine says what it cannot knit
assert(errs(run('pointelle', { profile: 'sj_4track' })).some((t) => /transfer needles/.test(t)), 'no transfer needles');
assert(errs(run('rib_1x1', { profile: 'sj_4track' })).some((t) => /has no dial/.test(t)), 'two beds on a single bed');
assert(errs(run('rib_1x1', { profile: 'interlock_2x2' })).some((t) => /built for interlock gating/.test(t)), 'gating');
assert(errs(run('half_cardigan', { profile: 'interlock_2x2' })).some((t) => /no tuck cam/.test(t)), 'classic interlock has no tuck cams');
assert(errs(run('knitted_twill', { profile: 'sj_2track' })).some((t) => /needs \d+ different needle sequences/.test(t)), 'more sequences than tracks');
assert(!errs(run('knitted_twill', { profile: 'sj_jacquard' })).some((t) => /needle sequences/.test(t)), 'jacquard: no track limit');
assert(errs(run('terry_fabric', { profile: 'sj_4track' })).some((t) => /terry sinkers/.test(t)), 'a pile needs terry sinkers');
assert(run('fleece_3_thread', { profile: 'sj_4track' }).checks.some((c) => c.level === 'warn' && /fleece sinkers/.test(c.text)), 'fleece on jersey sinkers');
// the user's own track count overrides the class
assert(errs(run('knitted_twill', { profile: 'sj_4track', tracks_cyl: 2 })).some((t) => /machine has 2 cam tracks/.test(t)));
// alternatives list what else knits it
assert(run('knitted_twill').machine_setup.alternatives.some((a) => a.id === 'sj_jacquard'));

// set-out + cam chart compile back to the notation, for every template
for (const t of T) {
  const r = S.analyse(pay(t));
  if (!r.success) continue;
  const P = KM.PROFILES[r.machine_setup.profile.id];
  const beds = r.machine_setup.beds;
  if (beds.C.selection === 'needle') continue;           // a selection file, not a cam set-up
  const setup = { setout: { C: beds.C.setout, D: beds.D ? beds.D.setout : '' }, cams: beds.C.cams_per_feeder.map((row, i) => ({ C: row, D: beds.D ? beds.D.cams_per_feeder[i] : null })) };
  const c = KM.compile(setup, { ...P, id: r.machine_setup.profile.id });
  assert.deepStrictEqual(c.errors, [], `${t.id}: ${c.errors}`);
  const want = r.structure.beds;
  assert.deepStrictEqual(c.grid.C, want.C.map((x) => x.join('').replace(/E/g, 'M')), `${t.id}: cylinder compiles back`);
  if (want.D) assert.deepStrictEqual(c.grid.D, want.D.map((x) => x.join('')), `${t.id}: dial compiles back`);
  // cams round the machine: one per track per feeder
  const tot = beds.C.cam_totals_machine;
  assert.strictEqual(tot.knit + tot.tuck + tot.miss, beds.C.tracks_used * r.machine.feeders, `${t.id}: cam total`);
}

// compile catches what a machine cannot take
const bad = KM.compile({ setout: { C: 'ABC' }, cams: [{ C: { A: 'K', B: 'T', C: 'X' } }] }, KM.PROFILES.sj_2track);
assert(bad.errors.some((e) => /3 tracks/.test(e)) && bad.errors.some((e) => /not a cam/.test(e)));
const il = KM.compile({ setout: { C: 'AB', D: 'AB' }, cams: [{ C: { A: 'K', B: 'M' }, D: { A: 'T', B: 'K' } }] }, KM.PROFILES.interlock_2x2);
assert(il.errors.some((e) => /no tuck cam/.test(e)));
// ── stage 1b ──
// speed: RPM from the class's speed factor; a too-fast setting is flagged
assert(run('pointelle').machine.rpm < run('single_jersey').machine.rpm, 'a transfer machine runs slower than a plain jersey');
assert(run('single_jersey', { rpm: 60, dia: 30 }).checks.some((c) => c.level === 'warn' && /m\/s at the cylinder surface/.test(c.text)));
// 2-way selection: one cam height per feeder
assert(errs(run('lacoste_single', { profile: 'sj_jacquard_2way' })).some((t) => /2-way selection/.test(t)), '2-way: knit and tuck on one feeder');
assert(!errs(run('birds_eye', { profile: 'sj_jacquard_2way' })).some((t) => /2-way/.test(t)), '2-way: knit / miss is fine');
// transfer direction: the receiving needle is the left one
{
  const g = { bed: 'single', grid: { C: ['KKKK', 'KEKK', 'KKKK'] }, yarn: { fibre: 'cotton' }, target: { gsm: 150 } };
  const right = S.analyse({ ...g, grid: { C: ['KKKK', 'MEKK', 'KKKK'] }, machine: { transfer_dir: 'right' } });
  const left = S.analyse({ ...g, grid: { C: ['KKKK', 'MEKK', 'KKKK'] }, machine: { transfer_dir: 'left' } });
  assert(!errs(right).some((t) => /transferred loop/.test(t)), 'right: needle 3 knits and takes it');
  assert(errs(left).some((t) => /goes onto needle 1 \(left\)/.test(t)), 'left: needle 1 misses and cannot take it');
  const geom = require('../../frontend/assets/js/studio-loop-geom.js');
  const C = ['KKKK', 'KEKK', 'KKKK'].map((r) => r.split(''));
  const top = (dir) => { const gg = geom.buildLoopPaths({ C, feeds: C.map(() => ({ role: 'ground' })), h: 0.75, transferDir: dir, wales: 8, courses: 6 }); const st = gg.courses[0].stitches.find((x) => x.wale === 1); const pts = gg.courses[0].points.slice(st.from, st.to + 1); return pts.reduce((b, p) => (p.y > b.y ? p : b)).x; };
  assert(top('right') > 1.2 && top('left') < 0.8, 'the transferred loop leans its head onto the needle that takes it');
}
// interlock: long-butt cylinder needles face short-butt dial needles
{
  const r = run('interlock');
  const b = r.machine_setup.beds;
  assert.deepStrictEqual(b.C.per_track.map((t) => t.butt), ['long butt', 'short butt']);
  b.facing.forEach((f) => { const cb = b.C.per_track.find((t) => t.track === f.cylinder).butt; f.dial.forEach((k) => assert.notStrictEqual(b.D.per_track.find((t) => t.track === k).butt, cb)); });
}
// feed system: needle selection takes storage feeders, a track machine positive feed
assert(run('knitted_twill', { profile: 'sj_jacquard' }).machine_setup.feeds.every((f) => f.system === 'storage feeder'));
assert(run('lacoste_single').machine_setup.feeds.every((f) => f.system === 'positive tape feed'));
assert(S.analyse({ ...pay(T.find((x) => x.id === 'single_jersey')), elastane: { denier: 40, draft: 2.6, every: 'all' } }).machine_setup.feeds[0].extra.some((e) => /elastane/.test(e)));
// hook load: each tucked loop at its own feeder's yarn — a coarse yarn on the tuck feeder loads the hook more
{
  const base = { bed: 'single', grid: { C: ['KK', 'TK', 'KK', 'KT'] }, yarn: { ne: 30, fibre: 'cotton' }, machine: { sl_mm: 2.8, gauge: 28 } };
  const fine = S.analyse({ ...base, feeds: [{ role: 'ground' }, { role: 'ground' }, { role: 'ground' }, { role: 'ground' }] });
  const coarse = S.analyse({ ...base, feeds: [{ role: 'ground' }, { role: 'ground', yarn: { ne: 10, fibre: 'cotton' } }, { role: 'ground' }, { role: 'ground', yarn: { ne: 10, fibre: 'cotton' } }] });
  const idx = (r) => { const c = r.checks.find((x) => /hook load/.test(x.text)); return c ? +c.text.match(/hook load ([\d.]+)/)[1] : 0; };
  assert(idx(coarse) > idx(fine), `hook load follows the tuck feeder's yarn (${idx(fine)} → ${idx(coarse)})`);
}
// ── stripes, transfers between the beds, mechanical jacquard, my machine ──
{
  const base = { bed: 'single', grid: { C: ['KK', 'KK', 'KK', 'KK'] }, feeds: [0, 1, 2, 3].map(() => ({ role: 'ground' })), yarn: { fibre: 'cotton' }, target: { gsm: 160 }, machine: {} };
  // a feeder stripe: the repeat divides the feeders, every feeder keeps one yarn
  const fs = S.analyse({ ...base, stripes: { sequence: 'A2 B2' } });
  assert.strictEqual(fs.machine_setup.stripes.method, 'feeder stripe');
  assert.strictEqual(fs.machine.feeders % 4, 0);
  // colours drawn per feeder survive the repeat reduction
  const fc = S.analyse({ ...base, feeds: ['A', 'B', 'A', 'C'].map((colour) => ({ role: 'ground', colour })) });
  assert.deepStrictEqual(fc.machine_setup.stripes.yarn_pct, { A: 50, B: 25, C: 25 });
  // a long engineered stripe: auto takes a striper machine; a plain machine is refused
  const long = S.analyse({ ...base, stripes: { sequence: 'A100 B20 C7' } });
  assert.strictEqual(long.machine_setup.profile.id, 'sj_striper');
  assert(long.ok_to_knit && long.machine_setup.stripes.method === 'striper' && long.machine_setup.stripes.fingers_needed <= 6);
  assert(errs(S.analyse({ ...base, stripes: { sequence: 'A100 B20 C7' }, machine: { profile: 'sj_4track' } })).some((t) => /needs stripers/.test(t)));
  const rib = S.analyse({ bed: 'double', gating: 'rib', grid: { C: ['K'], D: ['K'] }, yarn: { fibre: 'cotton' }, target: { gsm: 250 }, machine: {}, stripes: { sequence: 'A60 B10 C5 D3' } });
  assert.strictEqual(rib.machine_setup.profile.id, 'dj_striper', 'a rib stripe longer than the feeders: double jersey stripers');
  // the stripe: course c on feeder c mod n — the fingers a feeder needs
  const sp = KM.stripePlan(['A', 'A', 'B'], 1, 4, { striper: 6 }, [1]);
  assert.strictEqual(sp.method, 'striper'); assert.strictEqual(sp.fingers_needed, 2); assert.strictEqual(sp.revolutions_per_repeat, 3);
}
{
  // R: the loop to the needle opposite on the other bed
  const ok = S.analyse({ bed: 'double', gating: 'rib', grid: { C: ['KK', 'RK', 'KK'], D: ['KK', 'KK', 'KK'] }, yarn: { fibre: 'cotton' }, target: { gsm: 250 }, machine: {} });
  assert.strictEqual(ok.machine_setup.profile.id, 'dj_transfer');
  assert(!errs(ok).some((t) => /opposite|other bed/.test(t)));
  const bad = S.analyse({ bed: 'double', gating: 'rib', grid: { C: ['KK', 'RK', 'KK'], D: ['KK', 'MK', 'KK'] }, yarn: { fibre: 'cotton' }, target: { gsm: 250 }, machine: {} });
  assert(errs(bad).some((t) => /must knit or tuck at this feed to take it/.test(t)));
  assert(errs(S.analyse({ bed: 'double', gating: 'rib', grid: { C: ['KK', 'RK', 'KK'], D: ['KK', 'KK', 'KK'] }, yarn: { fibre: 'cotton' }, target: { gsm: 250 }, machine: { profile: 'rib_dj' } })).some((t) => /transfer machine/.test(t)));
  const geom = require('../../frontend/assets/js/studio-loop-geom.js');
  const g = geom.buildLoopPaths({ C: ['KK', 'RK', 'KK', 'KK'].map((r) => r.split('')), D: ['KK', 'KK', 'KK', 'KK'].map((r) => r.split('')), bed: 'rib', feeds: [0, 1, 2, 3].map(() => ({ role: 'ground' })), h: 0.75, wales: 4, courses: 8 });
  const st = g.courses[0].stitches.find((x) => x.bed === 'C' && x.wale === 0);
  assert.strictEqual(st.toBed, 'D', 'the loop before an R leans onto the dial');
}
{
  // mechanical jacquard: 2-way, a pattern wheel per feeder
  assert(errs(run('lacoste_single', { profile: 'sj_mech_jacquard' })).some((t) => /2-way/.test(t)));
  assert.strictEqual(run('birds_eye', { profile: 'sj_mech_jacquard' }).machine_setup.beds.C.selection, 'wheel');
  const narrow = KM.fit(KM.customProfile({ kind: 'single', selection: 'wheel', max_width: 8 }), { kind: 'single', gating: 'single', tracks: { C: 2 }, cams: { C: ['K', 'M'], D: [] }, width: 12 });
  assert(narrow.some((c) => c.level === 'error' && /pattern wheel has 8 slots/.test(c.text)));
}
{
  // my machine: its own figures, no class estimates
  const r = run('lacoste_single', { profile: 'custom', custom: { name: 'Line 3', kind: 'single', selection: 'tracks', tracks_cyl: 2, cams_cyl: ['K', 'T', 'M'], fpi: 3.2, sf: 1000 }, dia: 30 });
  assert(r.success && r.machine_setup.profile.custom && /your machine/.test(r.machine_setup.profile.build.basis));
  assert.strictEqual(r.machine.rpm, Math.round(1000 / 30));
  assert(errs(run('lacoste_single', { profile: 'custom', custom: { kind: 'single', tracks_cyl: 2, cams_cyl: ['K', 'M'] } })).some((t) => /no tuck cam/.test(t)));
}
console.log('Studio machine tests passed');
// a reduced repeat still matches its catalogue structure; waffle on its own factory records
{
  const w = T.find((x) => x.id === 'waffle_knit');
  const r = S.analyse({ bed: 'double', gating: w.gating, grid: { C: rows(w.grid.C), D: rows(w.grid.D) }, yarn: { count: 34, unit: 'ne' }, machine: { gauge: 18, dia: 34, sl_mm: 2.7 }, target: {} });
  assert.strictEqual(r.structure.match.id, 'waffle_knit');
  assert(/waffle/.test(r.fabric.kw_basis) && r.structure.confidence.level === 'calibrated');
  assert(r.fabric.width_open_in > 55 && r.fabric.width_open_in < 75, `waffle on 34" 18 GG finishes about 64-68": ${r.fabric.width_open_in}`);
}
// a plush too light to plate: a message, never a crash
{
  const r = S.analyse({ bed: 'single', grid: { C: ['K', 'K'] }, feeds: [{ role: 'loop' }, { role: 'ground' }], pile: 'sinker', yarn: { count: 10, unit: 'ne' }, target: { gsm: 60 }, machine: {} });
  assert(typeof r.success === 'boolean');
}
console.log('Studio machine extra tests passed');
