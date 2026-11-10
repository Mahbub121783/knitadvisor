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
console.log('Studio machine tests passed');
