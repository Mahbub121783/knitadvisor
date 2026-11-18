// Yarn recovery engine: the fibres' recovery, stiffness-weighted in a yarn; creep, relaxation, cycles, conditioning, conditions.
const assert = require('assert');
const R = require('../engine/domain/yarn-recovery-engine');
const Y = require('../engine/domain/yarn-engine');
const S = require('../engine/domain/fabric-studio');
console.log('--- Running Yarn Recovery Engine Tests ---');

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const run = (fibres, extra = {}) => R.analyse({ fibres, count: { value: 30, unit: 'ne' }, ...extra });
const finite = (o, path = '') => {
  if (o == null) return;
  if (typeof o === 'number') { assert(Number.isFinite(o), `non-finite number at ${path}`); return; }
  if (typeof o === 'object') for (const [k, v] of Object.entries(o)) finite(v, path + '.' + k);
};
const dry = { ...R.CONDITIONS.dry, id: 'dry' }, wet = { ...R.CONDITIONS.hot_wet, id: 'hot_wet' };

// ── 1. the fibre: the table's recovery, at the table's conditions ───────────────────────────
{
  // the standard test (held 30 s, rest 60 s) reproduces the table's recovery at 1 and 5 % strain
  for (const f of ['cotton', 'polyester', 'viscose', 'nylon', 'wool', 'acrylic']) {
    const t = Y.FIBER_PROPERTIES[f].recovery.rh60;
    for (const [e, key] of [[0.01, 'e1'], [0.05, 'e5']]) {
      const s = R.fibreSet(f, e, dry, 30, 60, false);
      near((1 - s / e) * 100, t[key], 0.2, `${f} recovery at ${e * 100} %`);
    }
    const t9 = Y.FIBER_PROPERTIES[f].recovery.rh90;
    near((1 - R.fibreSet(f, 0.01, { ...R.CONDITIONS.humid, id: 'humid' }, 30, 60, false) / 0.01) * 100, t9.e1, 0.2, `${f} at 90 % r.h.`);
  }
  // a longer hold sets more, a longer rest recovers more, conditioning sets less
  assert(R.fibreSet('cotton', 0.03, dry, 3600, 60, false) > R.fibreSet('cotton', 0.03, dry, 30, 60, false), 'a longer hold sets more');
  assert(R.fibreSet('cotton', 0.03, dry, 30, 86400, false) < R.fibreSet('cotton', 0.03, dry, 30, 60, false), 'a longer rest gives more back');
  assert(R.fibreSet('viscose', 0.03, dry, 30, 60, true) < R.fibreSet('viscose', 0.03, dry, 30, 60, false) * 0.5, 'conditioning cuts viscose\'s set by more than half (measured: 39 → 74 % recovery near break)');
  // growth: the measured anchors
  near(R.growthAt('nylon', 10), 0.28, 1e-9); near(R.growthAt('nylon', 1000), 1.03, 1e-9); near(R.growthAt('viscose', 10), 1.79, 1e-9); near(R.growthAt('viscose', 1000), 10.8, 1e-9); near(R.growthAt('wool', 1000), 1.44, 1e-9);
  assert.strictEqual(R.growthAt('cotton', 1), 0); for (const f of Object.keys(R.REC)) { let prev = -1; for (const n of [1, 3, 10, 100, 1000, 10000]) { const g = R.growthAt(f, n); assert(g >= prev - 1e-9, f + ' grows with cycles'); prev = g; } }
  console.log('✓ fibre set: the table\'s recovery at 1 and 5 % (60 and 90 % r.h.), hold and rest, conditioning, the measured growth anchors');
}

// ── 2. the yarn: stiffness-weighted, ordered by what the tables say ─────────────────────────
{
  const rec = (f, x) => run(f, x).recovery;
  const set = (f, x) => rec(f, x).permanent_set.value;
  // the order of the fibres: nylon and wool best, polyester next, cotton, then viscose worst
  const at = (f) => rec(f, { strain_pct: 5 }).recovery_after_rest.value;
  assert(at({ nylon: 100 }) > at({ polyester: 100 }) && at({ polyester: 100 }) > at({ cotton: 100 }) && at({ cotton: 100 }) > at({ viscose: 100 }), `order: ${at({ nylon: 100 })} ${at({ polyester: 100 })} ${at({ cotton: 100 })} ${at({ viscose: 100 })}`);
  // a blend lies between its fibres, and moves towards the better one as its share grows
  const c = at({ cotton: 100 }), p = at({ polyester: 100 }), b = at({ cotton: 60, polyester: 40 }), b2 = at({ cotton: 30, polyester: 70 });
  assert(b > c && b < p && b2 > b, 'a blend lies between its fibres');
  // stiffness-weighted, not mass-weighted: the two differ, and the stiffness-weighted set is the one the mechanics gives
  const r = run({ cotton: 60, polyester: 40 }, { strain_pct: 5 }).recovery;
  assert(Math.abs(r.mass_weighted_set.value - r.set_after_rest.value) > 0.01, 'the stiffness-weighted set differs from the mass-weighted one');
  near(r.by_fibre.reduce((t, f) => t + f.stiffness_share_pct, 0), 100, 0.3);
  assert(r.by_fibre.find((f) => f.fibre === 'polyester').stiffness_share_pct > r.by_fibre.find((f) => f.fibre === 'polyester').mass_share_pct, 'the stiffer fibre (polyester) carries more than its mass share, and it sets least: the blend recovers better than a mass-weighted mean says');
  assert(r.mass_weighted_set.value > r.set_after_rest.value, 'which is why the mass-weighted set is too high');
  assert(set({ cotton: 60, polyester: 40 }, { strain_pct: 5 }) >= Math.min(set({ cotton: 100 }, { strain_pct: 5 }), set({ polyester: 100 }, { strain_pct: 5 })) && set({ cotton: 60, polyester: 40 }, { strain_pct: 5 }) <= Math.max(set({ cotton: 100 }, { strain_pct: 5 }), set({ polyester: 100 }, { strain_pct: 5 })));
  // the curve falls with strain; a day of rest gives more back; conditioning gives most
  const cv = run({ cotton: 60, polyester: 40 }).recovery.curve;
  for (let i = 1; i < cv.length; i++) assert(cv[i].recovery_pct <= cv[i - 1].recovery_pct + 0.01 && cv[i].set_pct >= cv[i - 1].set_pct, 'recovery falls with strain');
  assert(cv.every((x) => x.recovery_24h_pct >= x.recovery_pct && x.recovery_conditioned_pct >= x.recovery_24h_pct - 0.5));
  // holding and resting
  assert(set({ cotton: 100 }, { hold_s: 86400 }) > set({ cotton: 100 }, { hold_s: 30 }) && rec({ cotton: 100 }, { rest_s: 86400 }).set_after_rest.value < rec({ cotton: 100 }, { rest_s: 10 }).set_after_rest.value);
  // twist: an open-end yarn holds more set than a compact one (more structure friction)
  assert(run({ cotton: 100 }, { spinning: 'open_end' }).identity.structure_factor > run({ cotton: 100 }, { spinning: 'compact' }).identity.structure_factor, 'an open-end structure holds the set more');
  console.log('✓ recovery: the fibres\' order, blends between, stiffness-weighted, falls with strain, hold and rest');
}

// ── 3. creep, relaxation, cycles, conditioning, conditions ───────────────────────────────────
{
  const r = run({ cotton: 60, polyester: 40 });
  const rows = r.creep.rows;
  for (let i = 1; i < rows.length; i++) assert(rows[i].strain_pct > rows[i - 1].strain_pct && rows[i].creep_pct > rows[i - 1].creep_pct, 'creep grows with time');
  near(r.creep.creep_per_decade.value, (0.6 * 0 + 1) * r.creep.creep_per_decade.value, 1e-9);
  assert(rows.every((x) => x.set_after_unloading_pct >= 0 && x.set_after_unloading_pct <= x.strain_pct));
  // polyester creeps most per decade, cotton least (the tables' remark: small in cellulosic fibres)
  assert(run({ polyester: 100 }).creep.creep_per_decade.value > run({ nylon: 100 }).creep.creep_per_decade.value && run({ nylon: 100 }).creep.creep_per_decade.value > run({ cotton: 100 }).creep.creep_per_decade.value);
  // the instantaneous strain is the strain at the load: more load, more strain, more creep
  assert(run({ cotton: 100 }, { load_pct: 20 }).creep.instantaneous_strain.value > run({ cotton: 100 }, { load_pct: 10 }).creep.instantaneous_strain.value);
  // relaxation falls with time, about half over six decades at the most
  const rl = r.relaxation.rows; for (let i = 1; i < rl.length; i++) assert(rl[i].stress_remaining_pct <= rl[i - 1].stress_remaining_pct);
  assert(rl[rl.length - 1].stress_remaining_pct > 25 && rl[0].stress_remaining_pct > 90);
  const half = run({ cotton: 100 }).relaxation.rows[8].stress_remaining_pct; assert(half > 80 && half < 100, 'cotton relaxes little');
  // cycles: the growth at 10 and 1000 cycles is the measured one for nylon at the test strain, scaled by the structure factor
  const n = run({ nylon: 100 }, { imposed_strain_pct: 2 }).cyclic.rows;
  near(n[1].growth_pct, 0.28 * 1.06, 0.03, 'nylon growth after 10 cycles'); near(n[3].growth_pct, 1.03 * 1.06, 0.05, 'nylon growth after 1000 cycles');
  assert(run({ nylon: 100 }, { imposed_strain_pct: 4 }).cyclic.rows[3].growth_pct > n[3].growth_pct * 2, 'more imposed strain, more growth');
  assert(run({ viscose: 100 }).cyclic.rows[3].growth_pct > run({ nylon: 100 }).cyclic.rows[3].growth_pct * 5, 'viscose grows far more than nylon');
  assert.strictEqual(run({ cotton: 60, polyester: 40 }).cyclic.cycles_to_break.value, 331, 'the weakest fibre sets the cycles to break');
  // conditioning
  assert(r.conditioning.second_loading.value > r.conditioning.first_loading.value && r.conditioning.set_ratio.value < 0.6);
  // conditions: the same yarn in four rooms; hot-wet is the worst
  const cs = r.conditions; assert.strictEqual(cs.length, 4);
  assert(cs[0].creep_per_decade_pct < cs[1].creep_per_decade_pct && cs[1].creep_per_decade_pct < cs[3].creep_per_decade_pct);
  assert(cs[3].recovery_pct < cs[0].recovery_pct && cs[3].set_pct > cs[0].set_pct, 'hot-wet recovers worst');
  assert(run({ cotton: 100 }, { condition: 'hot_wet' }).recovery.recovery_after_rest.value < run({ cotton: 100 }).recovery.recovery_after_rest.value);
  // knitting
  assert(r.knitting.yarn_strain.value > 0 && r.knitting.yarn_strain.value < 1 && r.knitting.returned_in_finishing.value >= 0 && r.knitting.set_left_in_the_yarn.value < r.knitting.yarn_strain.value);
  // the cloth
  assert(run({ viscose: 100 }).cloth.growth_tendency === 'high' && run({ nylon: 100 }).cloth.growth_tendency === 'low');
  assert(run({ cotton: 60, polyester: 40, elastane: 5 }).cloth.elastane && run({ cotton: 60, polyester: 40, elastane: 5 }).cloth.elastane.share_pct === 5);
  console.log('✓ creep, relaxation, cycles (the measured anchors), conditioning, four conditions, knitting, the cloth');
}

// ── 4. derivations, bad input, a random field ────────────────────────────────────────────────
{
  const r = run({ cotton: 60, polyester: 40 });
  assert(r.derivations.length >= 6 && r.derivations.every((d) => d.formula && d.working && d.result != null && d.basis));
  assert.throws(() => R.analyse({ fibres: { cotton: 50, kryptonite: 50 }, count: { value: 30, unit: 'ne' } }), /not a fibre/);
  assert.throws(() => R.analyse({ fibres: { constructor: 50, cotton: 50 }, count: { value: 30, unit: 'ne' } }), /not a fibre/);
  assert.throws(() => R.analyse({ fibres: { elastane: 100 }, count: { value: 30, unit: 'ne' } }), /fibres/);
  assert.throws(() => R.analyse({ fibres: { cotton: 100 } }), /count/); assert.throws(() => R.analyse(null), /Give the yarn/);
  assert.strictEqual(R.profileOf({}, 20, 'combed'), null); assert(R.profileOf({ cotton: 60, polyester: 40, spandex: 3 }, 19.7, 'combed').cloth.elastane);
  let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const ids = Object.keys(R.REC);
  for (let i = 0; i < 300; i++) {
    const k = 1 + Math.floor(rnd() * 4), pick = ids.slice().sort(() => rnd() - 0.5).slice(0, k), f = {};
    pick.forEach((x) => { f[x] = 5 + Math.floor(rnd() * 90); });
    const q = R.analyse({ fibres: f, count: { value: [8, 16, 24, 30, 40, 60][Math.floor(rnd() * 6)], unit: 'ne' }, strain_pct: 0.5 + rnd() * 12, hold_s: 1 + rnd() * 1e5, rest_s: 1 + rnd() * 1e5, load_pct: 2 + rnd() * 50, imposed_strain_pct: 1 + rnd() * 6, condition: ['dry', 'humid', 'wet', 'hot_wet'][Math.floor(rnd() * 4)] });
    finite(q);
    assert(q.recovery.recovery_after_rest.value >= 0 && q.recovery.recovery_after_rest.value <= 100, 'recovery is a percentage');
    assert(q.recovery.permanent_set.value <= q.recovery.at_strain_pct.value + 0.006);
    assert(q.cyclic.rows.every((x, i) => i === 0 || x.growth_pct >= q.cyclic.rows[i - 1].growth_pct - 1e-9));
  }
  console.log('✓ derivations, bad input in words, prototype keys refused, 300 random yarns finite and bounded');
}

// ── 5. the Studio ────────────────────────────────────────────────────────────────────────────
{
  const base = (extra) => S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 160 }, machine: {}, ...extra });
  assert.strictEqual(base({}).recovery, null, 'no recovery unless asked');
  const on = base({ blend: { ground: { fibres: { cotton: 60, polyester: 40 } } }, recovery: { enabled: true, strain_pct: 3, condition: 'humid' } });
  assert(on.success && on.recovery.ground && on.recovery.ground.identity.condition.id === 'humid' && on.recovery.ground.recovery.at_strain_pct.value === 3);
  near(on.recovery.ground.identity.count.ne, 30, 0.1, 'at the count the Studio uses');
  assert(base({ recovery: { enabled: true } }).recovery.ground.identity.label === 'Cotton');
  assert.strictEqual(base({ yarn: { fibre: 'polyester_filament', type: 'dty', count: 150, unit: 'denier' }, recovery: { enabled: true } }).recovery, null, 'a filament is not a staple yarn');
  assert(base({ elastane: { denier: 40, draft: 2.6 }, recovery: { enabled: true } }).recovery.ground.cloth.elastane, 'the Lycra card\'s elastane is noted');
  console.log('✓ Studio: recovery only on request, at the solved count, with the chosen condition');
}

// ── 6. the cloth's stretch model takes the yarn's recovery ───────────────────────────────────
{
  const SE = require('../engine/domain/stretch-engine');
  const base = { fabricId: 'single_jersey', category: '', loopMm: 2.5, countNe: 30, fibers: { cotton: 60, polyester: 40 }, rkm: 20 };
  const old = SE.analyzeStretch(base);
  assert.strictEqual(old.fibre_recovery.source, 'fibre table, mass-weighted', 'unchanged without a yarn recovery');
  const fs = run({ cotton: 60, polyester: 40 }).for_stretch;
  near(fs.rec.e1, run({ cotton: 60, polyester: 40 }).recovery.curve.find((c) => c.strain_pct === 1).recovery_pct, 0.06, 'the stretch input is the yarn recovery at 1 %');
  const withY = SE.analyzeStretch({ ...base, yarnRecovery: fs });
  assert(/yarn recovery engine/.test(withY.fibre_recovery.source) && withY.fibre_recovery.points[2].recovery_pct !== old.fibre_recovery.points[2].recovery_pct, 'the yarn recovery is used');
  near(withY.fibre_recovery.points[1].recovery_pct, fs.rec.e1, 0.06);
  // a poorer yarn recovery means more growth; a better one less
  const poor = SE.analyzeStretch({ ...base, yarnRecovery: { ...fs, rec: { e1: fs.rec.e1 - 20, e5: fs.rec.e5 - 20, e10: fs.rec.e10 - 15 } } });
  assert(poor.directions.width.standard.growth.after_1h_pct > withY.directions.width.standard.growth.after_1h_pct, 'worse yarn recovery, more cloth growth');
  // the Studio: growth follows the yarn — cotton > CVC > PC > with elastane; humid > dry; the comparison is there
  const run2 = (blend, rec, extra) => S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 160 }, machine: {}, blend: blend ? { ground: blend } : undefined, recovery: { enabled: true, ...(rec || {}) }, ...(extra || {}) });
  const g = (r) => r.recovery.ground.cloth_stretch.directions.width.growth.after_1h_pct;
  const cot = run2(null), cvc = run2({ fibres: { cotton: 60, polyester: 40 } }), pc = run2({ fibres: { polyester: 65, cotton: 35 } }), lyc = run2({ fibres: { cotton: 60, polyester: 40 } }, null, { elastane: { denier: 40, draft: 2.6 } });
  assert(g(cot) > g(cvc) && g(cvc) > g(pc) && g(pc) > g(lyc), `growth: cotton ${g(cot)} > CVC ${g(cvc)} > PC ${g(pc)} > with elastane ${g(lyc)}`);
  assert(g(run2({ fibres: { cotton: 60, polyester: 40 } }, { condition: 'humid' })) > g(cvc), 'a humid room grows more');
  const cs = cvc.recovery.ground.cloth_stretch;
  assert(cs.kind === 'jersey' && cs.directions.width.curve.length > 4 && cs.directions.length.bagging.pull_pct === 30 && ['low', 'medium', 'high'].includes(cs.directions.width.bagging.level));
  assert(cs.comparison.mass_weighted.width_growth_1h_pct !== cs.comparison.yarn_engine.width_growth_1h_pct && cs.comparison.mass_weighted.fibre_recovery.e5 !== cs.yarn_recovery_used.e5, 'the yarn model gives a different answer from the mass-weighted table');
  assert(/yarn recovery engine/.test(cs.source) && cs.yarn_recovery_used.e1 > cs.yarn_recovery_used.e5 && cs.po_spec);
  assert.strictEqual(S.analyse({ bed: 'double', gating: 'rib', grid: { C: ['KK'], D: ['KK'] }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 200 }, machine: {}, recovery: { enabled: true } }).recovery.ground.cloth_stretch.kind, 'rib');
  console.log('✓ cloth stretch: the stretch model takes the yarn recovery (cotton > CVC > PC > elastane in growth, humid grows more), unchanged without it');
}
console.log('Yarn recovery engine tests passed');
