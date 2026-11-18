/**
 * KnitAdvisor — Yarn recovery engine: what a yarn gives back, how fast, and what it keeps.
 *
 * Built for the Fabric Studio, on top of the blend yarn engine. Give a yarn's fibres and count and the strain it is held at; it
 * works out, from the fibres' own measured recovery and the parallel-fibre mechanics of a yarn:
 *
 *   1  RECOVERY       the strain a yarn recovers at once, after a rest and after a day, and the permanent set that stays,
 *                     at any strain from the first per cent to the break — with the stiff fibres setting what the soft ones
 *                     can give back (the unloaded yarn strain is the stiffness-weighted mean of the fibres' sets, not
 *                     the mass-weighted one)
 *   2  CREEP          the strain a constant load adds with time (primary, recoverable; secondary, not), at 1 s to 100 days
 *   3  RELAXATION     the stress that decays when the yarn is held at a strain
 *   4  CYCLES         the growth after 1 … 10 000 stretch cycles (the cumulative-extension test), and the cycles a yarn lasts
 *   5  CONDITIONING   a yarn that has been strained once recovers far better the second time (mechanical conditioning)
 *   6  CONDITIONS     dry, humid, wet and hot-wet: the same yarn in four rooms
 *   7  KNITTING       the strain the running tension puts in, and what the yarn gives back in finishing
 *   8  CLOTH          what this means for growth and bagging, with the fibre part separated from the loop part
 *   9  DERIVATIONS    the working behind every figure
 *
 * Every figure carries its basis (the convention of materials.js, the melange and the blend yarn engines):
 *   measured   a published fibre-property table value        law       worked out by physics or arithmetic
 *   blend      measured fibre values combined by the law that applies   typical   an industry default; the test that
 *   estimate   a model not yet calibrated on the mill's own result                 replaces it is named
 *   calibrated the model fitted on the mill's own measurement
 *
 * Measured here: elastic recovery at 1, 5 and 10 % strain at 60 and 90 % r.h.; the cumulative-extension growth after 10 and 1000
 * cycles; the recovery before and after mechanical conditioning; the order of magnitude of relaxation (about half the stress
 * lost over six decades of time); polyester's creep per decade of time. Typical, stated: creep coefficients of the other
 * fibres, the delayed-recovery shares, the yarn-structure friction factor. No outside source is named in what this returns.
 */
'use strict';

const Y = require('./yarn-engine');
const BY = require('./blend-yarn-engine');
const SE = require('./stretch-engine');

class RecoveryError extends Error {}
const FP = Y.FIBER_PROPERTIES;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rd = (v, d) => (v == null || Number.isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
const r1 = (v) => rd(v, 1), r2 = (v) => rd(v, 2), r3 = (v) => rd(v, 3);
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const V = (value, unit, basis, extra) => (value == null || Number.isNaN(value) ? null : { value, unit, basis, ...(extra || {}) });

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FIBRES: recovery data (the tables') and the time constants (typical)
// ═════════════════════════════════════════════════════════════════════════════════════════════
// proxy: the fibre whose table row stands in when the fibre has none (stated) · c: creep per decade of time, as a fraction of the
// instantaneous extension · p: the share of the creep that is primary (recoverable in time) · q: the share of the first set that
// comes back with a long rest · cond: the set after mechanical conditioning ÷ the set before (from the recovery near break
// before and after conditioning) · g10 / g1000: cumulative-extension growth (%) after 10 and 1000 cycles at 2 % imposed extension
const REC = {
  cotton:    { proxy: null,        c: 0.03, p: 0.60, q: 0.25, cond: 0.45, g10: 1.98, g1000: null, break_cycles: 331 },
  polyester: { proxy: null,        c: 0.20, p: 0.50, q: 0.35, cond: 0.18, g10: null, g1000: null, break_cycles: null },
  viscose:   { proxy: null,        c: 0.10, p: 0.50, q: 0.30, cond: 0.43, g10: 1.79, g1000: 10.8, break_cycles: 1420 },
  modal:     { proxy: 'viscose',   c: 0.07, p: 0.50, q: 0.30, cond: 0.43, g10: null, g1000: null, break_cycles: null },
  tencel:    { proxy: 'viscose',   c: 0.06, p: 0.50, q: 0.30, cond: 0.43, g10: null, g1000: null, break_cycles: null },
  bamboo:    { proxy: null,        c: 0.10, p: 0.50, q: 0.30, cond: 0.43, g10: 1.79, g1000: 10.8, break_cycles: 1420 },
  nylon:     { proxy: null,        c: 0.15, p: 0.60, q: 0.50, cond: 0.29, g10: 0.28, g1000: 1.03, break_cycles: 5000 },
  acrylic:   { proxy: null,        c: 0.12, p: 0.50, q: 0.40, cond: 0.19, g10: null, g1000: null, break_cycles: null },
  wool:      { proxy: null,        c: 0.10, p: 0.60, q: 0.55, cond: 0.29, g10: 0.48, g1000: 1.44, break_cycles: 2000 },
};
const FIBRE_IDS = Object.keys(REC);
// growth after 10 cycles where the tables have none (typical, between nylon and viscose), and the ratio of the 1000-cycle to the 10-cycle growth
const G10_TYPICAL = { polyester: 0.35, acrylic: 0.60 };
const G_RATIO = 4.5;
// the yarn's own structure holds the set a little: fibres rub on each other as they spring back (typical)
const STRUCT = { carded: 1.08, combed: 1.06, compact: 1.04, siro: 1.04, siro_compact: 1.03, open_end: 1.12, vortex: 1.07 };
const CONDITIONS = {
  dry:     { label: 'Dry, 60 % r.h.', rh: 60, creep: 1.0, relax: 1.0, rec: 1.0 },
  humid:   { label: 'Humid, 90 % r.h.', rh: 90, creep: 1.8, relax: 1.4, rec: 1.0 },
  wet:     { label: 'In water, 20 °C', rh: 90, creep: 2.2, relax: 1.6, rec: 1.0 },
  hot_wet: { label: 'In water, 95 °C', rh: 90, creep: 3.0, relax: 2.2, rec: 0.92 },
};
const TIMES = [[1, '1 s'], [10, '10 s'], [60, '1 min'], [600, '10 min'], [3600, '1 h'], [36000, '10 h'], [86400, '1 day'], [864000, '10 days'], [8640000, '100 days']];
const CYCLES = [1, 10, 100, 1000, 10000];

function recoveryCurve(id, rh) {
  const t = FP[REC[id].proxy || id];
  const a = t.recovery && t.recovery.rh60, b = t.recovery && t.recovery.rh90;
  const mk = (r) => { const e10 = r.e10 != null ? r.e10 : Math.max(r.e5 * 0.72, r.e5 - (r.e1 - r.e5) * 0.45); return { e1: r.e1, e5: r.e5, e10 }; };
  const A = mk(a), B = b && b.e1 != null ? mk(b) : A;
  const f = clamp((rh - 60) / 30, 0, 1);
  return { e1: A.e1 + (B.e1 - A.e1) * f, e5: A.e5 + (B.e5 - A.e5) * f, e10: A.e10 + (B.e10 - A.e10) * f };
}
const gOf = (t) => Math.log10(1 + Math.max(0, t)) / Math.log10(1 + 86400);

// growth by cycle N (%): measured at 10 and 1000 cycles, a straight line in log cycles between and beyond
function growthAt(id, N) {
  const r = REC[id];
  const g10 = r.g10 != null ? r.g10 : (G10_TYPICAL[id] != null ? G10_TYPICAL[id] : (REC[r.proxy] ? REC[r.proxy].g10 * 0.7 : 0.6));
  const g1000 = r.g1000 != null ? r.g1000 : g10 * G_RATIO;
  if (N <= 1) return 0;
  if (N <= 10) return g10 * Math.log10(N);
  return g10 + (g1000 - g10) * (Math.log10(N) - 1) / 2;
}
const growthBasis = (id) => (REC[id].g10 != null && REC[id].g1000 != null ? 'measured' : REC[id].g10 != null ? 'blend' : 'typical');

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE YARN
// ═════════════════════════════════════════════════════════════════════════════════════════════
function build(input) {
  if (!input || typeof input !== 'object') throw new RecoveryError('Give the yarn: its fibres and a count.');
  const fibres = {};
  const src = input.fibres || input.fibers;
  if (src && typeof src === 'object') for (const [f, v] of Object.entries(src)) { if (+v > 0 && f !== 'elastane') { if (!own(REC, f)) throw new RecoveryError(`"${f}" is not a fibre this engine holds recovery data for (${FIBRE_IDS.join(', ')}).`); fibres[f] = +v; } }
  if (!Object.keys(fibres).length) throw new RecoveryError('Give the yarn\'s fibres and their shares, for example cotton 60 and polyester 40.');
  const elastane = src && +src.elastane > 0 ? +src.elastane : 0;
  const P = BY.prep({ fibres, count: input.count, tex: input.tex, count_ne: input.count_ne, spinning: input.spinning, grade: input.grade, ply: input.ply });
  const bl = BY.build(P.comps, P.spinKey);
  const k = BY.core(bl, P.tex, { spinKey: P.spinKey, grade: P.grade, ply: P.ply, form: P.ply > 1 ? 'ply2' : 'single' });
  return { P, k, elastane };
}

function condOf(input) {
  const c = own(CONDITIONS, input.condition) ? input.condition : 'dry';
  return { id: c, ...CONDITIONS[c], rh: +input.humidity_rh > 0 ? clamp(+input.humidity_rh, 20, 95) : CONDITIONS[c].rh };
}

/** One fibre's set (fraction of the fibre strain) after a strain, a hold and a rest. */
function fibreSet(id, epsF, cond, hold, rest, conditioned) {
  const r = REC[id];
  const rec = recoveryCurve(id, cond.rh);
  const R = clamp(SE.fibreRecovery(rec, epsF) / 100 * cond.rec, 0, 1);
  const setStd = epsF * (1 - R);                                    // the standard test: held 30 s, 60 s of rest
  const inst = setStd / (1 - r.q * gOf(60));
  const holdF = clamp(1 + r.c * cond.creep * (1 - r.p) * 3 * Math.log10(Math.max(hold, 1) / 30), 0.5, 4);
  let s = inst * (1 - r.q * gOf(rest)) * holdF;
  if (conditioned) s *= r.cond;
  return clamp(s, 0, epsF);
}

function analyse(input) {
  const { P, k, elastane } = build(input);
  const cond = condOf(input);
  const ids = k.comps.map((c) => c.id);
  const w = k.dry;
  const E = k.fib.map((f) => f.curve.E * f.kappa);                  // N/tex of yarn each fibre carries per unit strain
  const lw = k.fib.map((f, i) => w[i] * E[i]); const lsum = lw.reduce((a, b) => a + b, 0);
  const share = lw.map((v) => v / lsum);                            // the stiffness share: who carries the load, and so who sets the set
  const struct = STRUCT[P.spinKey] || 1.06;
  const strainPct = clamp(+input.strain_pct > 0 ? +input.strain_pct : 2, 0.2, 30);
  const hold = clamp(+input.hold_s > 0 ? +input.hold_s : 30, 1, 3.2e7), rest = clamp(+input.rest_s > 0 ? +input.rest_s : 60, 1, 3.2e7);
  const warnings = [], say = (level, text) => warnings.push({ level, text });
  const derive = [], D = (id, quantity, formula, working, result, unit, basis) => derive.push({ id, quantity, formula, working, result, unit, basis });
  const c2 = k.c2;
  const maxStrain = Math.max(...k.fib.map((f) => f.curve.eb)) / c2 * 100;
  if (strainPct > k.peakEps * 100 * 1.001 && strainPct > 0) say('note', `${r1(strainPct)} % is beyond the yarn's breaking elongation (${r1(k.peakEps * 100)} %): the figures above that strain are for the fibres that are still unbroken.`);

  // the yarn set at a strain, a hold and a rest
  const yarnSet = (epsYpct, h, r, conditioned, cnd) => {
    const eY = epsYpct / 100, eF = eY * c2;
    const sets = ids.map((id) => fibreSet(id, eF, cnd || cond, h, r, conditioned));
    const setF = sets.reduce((t, s, i) => t + share[i] * s, 0);
    const setY = clamp((setF / c2) * struct, 0, eY);
    return { set_pct: setY * 100, recovery_pct: (1 - setY / eY) * 100, sets };
  };

  // 1 ── recovery
  const std = yarnSet(strainPct, 30, 60, false);
  const now = yarnSet(strainPct, hold, rest, false);
  const day = yarnSet(strainPct, hold, 86400, false);
  const conditioned = yarnSet(strainPct, hold, rest, true);
  const mass = (() => { // what a mass-weighted mean would say, for the difference to be seen
    const sets = ids.map((id) => fibreSet(id, strainPct / 100 * c2, cond, hold, rest, false));
    return clamp(sets.reduce((t, s, i) => t + w[i] * s, 0) / c2 * struct, 0, strainPct / 100) * 100;
  })();
  const curveAt = [0.5, 1, 2, 3, 5, 7.5, 10, 15].filter((s) => s <= Math.max(maxStrain, 1));
  const curve = curveAt.map((s) => { const a = yarnSet(s, 30, 60, false), b = yarnSet(s, 30, 86400, false), c = yarnSet(s, 30, 60, true); return { strain_pct: s, recovery_pct: r1(a.recovery_pct), set_pct: r2(a.set_pct), recovery_24h_pct: r1(b.recovery_pct), recovery_conditioned_pct: r1(c.recovery_pct) }; });
  const recovery = {
    at_strain_pct: V(strainPct, '%', 'law'), hold_s: hold, rest_s: rest,
    immediate_recovery: V(r1(yarnSet(strainPct, hold, 1, false).recovery_pct), '%', 'blend'), recovery_after_rest: V(r1(now.recovery_pct), '%', 'blend'), recovery_after_a_day: V(r1(day.recovery_pct), '%', 'blend'),
    permanent_set: V(r2(day.set_pct), '% of yarn length', 'blend'), set_after_rest: V(r2(now.set_pct), '% of yarn length', 'blend'),
    standard_test: V(r1(std.recovery_pct), '%', 'blend', { note: 'held 30 s, 60 s of rest: the test the tables are made with' }),
    by_fibre: ids.map((id, i) => ({ fibre: id, label: k.comps[i].label, stiffness_share_pct: r1(share[i] * 100), mass_share_pct: r1(w[i] * 100), set_pct_of_fibre_strain: r2((now.sets[i] / (strainPct / 100 * c2)) * 100), recovery_pct: r1((1 - now.sets[i] / (strainPct / 100 * c2)) * 100), table_basis: REC[id].proxy ? `nearest measured: ${REC[id].proxy}` : 'measured' })),
    mass_weighted_set: V(r2(mass), '%', 'law', { note: 'what a mass-weighted mean would say; the stiffness-weighted figure above is the one that follows from the mechanics' }),
    curve,
    note: 'The yarn is its fibres in parallel at one strain. When the load comes off, the fibres that have set least still push the yarn back and the ones that have set most hold it out: the unloaded strain is where the forces balance, the STIFFNESS-weighted mean of the fibre sets. A stiff fibre that sets little (polyester in a cotton blend) therefore pulls the whole yarn back harder than its mass share says, and a stiff fibre that sets a lot would hold it out.',
  };
  D('share', 'Stiffness share of each fibre', 'ℓᵢ = dryᵢ·κᵢ·Eᵢ ÷ Σ(dryⱼ·κⱼ·Eⱼ)', ids.map((id, i) => `${id}: ${r3(w[i])} × ${r3(k.fib[i].kappa)} × ${r2(k.fib[i].curve.E)}`).join('; '), share.map((v) => r1(v * 100) + ' %').join(' / '), '', 'law');
  D('fibre_set', 'Fibre set after a strain', 'sᵢ = ε_f·(1 − Rᵢ(ε_f))·(1 − qᵢ·g(rest))·H(hold),  ε_f = ε_yarn·cos²θm', `ε_f = ${r2(strainPct)} % × ${r3(c2)} = ${r2(strainPct * c2)} %; recovery Rᵢ from the 1/5/10 % table at ${cond.rh} % r.h.`, ids.map((id, i) => `${id} ${r2(now.sets[i] / (strainPct / 100 * c2) * 100)} %`).join(' · '), 'of the fibre strain', 'blend');
  D('yarn_set', 'Yarn set', 'set_yarn = (Σ ℓᵢ·sᵢ ÷ cos²θm) × structure factor', `${r3(now.set_pct / 100 / struct * c2)} ÷ ${r3(c2)} × ${struct}`, r2(now.set_pct), '% of length', 'blend');

  // 2 ── creep
  const loadFrac = clamp((+input.load_pct > 0 ? +input.load_pct : 10) / 100, 0.01, 0.9);
  const eps0 = (() => { const target = loadFrac * k.peak; for (const p of k.pts) { if (p.F >= target) return p.eps; if (p.eps >= k.peakEps) break; } return k.peakEps; })();
  const Cy = ids.reduce((t, id, i) => t + share[i] * REC[id].c, 0) * cond.creep;
  const Pyr = ids.reduce((t, id, i) => t + share[i] * REC[id].p, 0);
  const creepRows = TIMES.map(([t, lab]) => {
    const extra = eps0 * Cy * Math.log10(1 + t);
    const after = yarnSet(eps0 * 100 + extra * 100, t, 86400, false);
    return { time: lab, seconds: t, strain_pct: r3((eps0 + extra) * 100), creep_pct: r3(extra * 100), set_after_unloading_pct: r3(after.set_pct) };
  });
  const creep = {
    load: V(r1(loadFrac * 100), '% of the breaking force', 'law'), load_cn: V(r1(loadFrac * k.peak * 100 * k.tex), 'cN', 'law'), instantaneous_strain: V(r3(eps0 * 100), '%', 'blend'),
    creep_per_decade: V(r1(Cy * 100), '% of the instantaneous strain', 'typical', { note: 'polyester: measured 10–36 % per decade at 15 % of the breaking load (rope yarns); the others typical' }),
    primary_share: V(r1(Pyr * 100), '% of the creep (recoverable with time)', 'typical'), rows: creepRows,
    note: 'A constant load adds a strain that grows with the logarithm of time: a primary part that comes back after unloading, and a secondary part that does not. Humidity and heat speed it up.',
  };
  D('creep', 'Creep', 'ε(t) = ε₀·(1 + C·log₁₀(1 + t)),  C = Σ ℓᵢ·cᵢ × the condition factor', `${r3(eps0 * 100)} % × (1 + ${r3(Cy)} × log₁₀(1 + t))`, `${r3(creepRows[6].strain_pct)} % after a day`, '', 'typical');

  // 3 ── relaxation
  const rI = (id) => clamp(0.08 * REC[id].c / 0.10, 0.02, 0.14);
  const Ry = ids.reduce((t, id, i) => t + share[i] * rI(id), 0) * cond.relax;
  const relaxRows = TIMES.map(([t, lab]) => ({ time: lab, seconds: t, stress_remaining_pct: r1(Math.max(0.3, 1 - Ry * Math.log10(1 + t)) * 100) }));
  const relaxation = { per_decade: V(r1(Ry * 100), '% of the stress per decade of time', 'estimate'), rows: relaxRows, note: 'Held at a strain, the stress decays with the logarithm of time: the measured order of magnitude is about half the stress lost over six decades (an average of about 8 % per decade), more in a fibre that creeps more.' };
  D('relax', 'Stress relaxation', 'σ(t)/σ₀ = 1 − R·log₁₀(1 + t),  R = Σ ℓᵢ·rᵢ × the condition factor;  rᵢ = 0.08 × cᵢ ÷ 0.10', `R = ${r3(Ry)}`, `${relaxRows[6].stress_remaining_pct} % after a day`, '', 'estimate');

  // 4 ── cycles
  const imposed = clamp(+input.imposed_strain_pct > 0 ? +input.imposed_strain_pct : 2, 0.5, 10);
  const scaleG = Math.pow(imposed / 2, 1.5);
  const cycRows = CYCLES.map((N) => {
    const g = ids.reduce((t, id, i) => t + share[i] * growthAt(id, N), 0) * scaleG * struct;
    return { cycles: N, growth_pct: r2(g), by_fibre: Object.fromEntries(ids.map((id) => [id, r2(growthAt(id, N) * scaleG)])) };
  });
  const lives = ids.map((id) => REC[id].break_cycles).filter((x) => x != null);
  const life = lives.length ? Math.min(...lives) : null;
  const cyclic = {
    imposed_strain: V(imposed, '%', 'law'), rows: cycRows, growth_basis: ids.map((id) => ({ fibre: id, basis: growthBasis(id) })),
    cycles_to_break: life ? V(life, 'cycles at 2 % imposed extension', REC[ids.find((id) => REC[id].break_cycles === life)].g10 != null ? 'measured' : 'typical', { governed_by: ids.find((id) => REC[id].break_cycles === life) }) : null,
    note: 'In the cumulative-extension test a yarn is stretched to a set extension over and over: it grows a little each cycle, quickly at first then more slowly. The growth after 10 and 1000 cycles is measured for the fibres that have been tested; between and beyond them it follows the logarithm of the cycles. The growth at another imposed strain goes as its 1.5 power (typical).',
  };
  D('cyc', 'Growth after N cycles', 'g(N) = g₁₀·log₁₀N (N ≤ 10);  g₁₀ + (g₁₀₀₀ − g₁₀)·(log₁₀N − 1)/2 (N > 10); yarn growth = Σ ℓᵢ·gᵢ × (imposed ÷ 2)^1.5 × structure factor', ids.map((id) => `${id} g10 ${r2(growthAt(id, 10))}, g1000 ${r2(growthAt(id, 1000))}`).join('; '), `${cycRows[3].growth_pct} % after 1000`, '%', ids.every((id) => growthBasis(id) === 'measured') ? 'measured' : 'blend');

  // 5 ── conditioning
  const first = yarnSet(strainPct, hold, rest, false), second = yarnSet(strainPct, hold, rest, true);
  const conditioning = {
    first_loading: V(r1(first.recovery_pct), '% recovered', 'blend'), second_loading: V(r1(second.recovery_pct), '% recovered', 'blend'), set_ratio: V(r2(second.set_pct / Math.max(first.set_pct, 1e-9)), 'set after ÷ set before', 'measured', { from: 'the recovery near break before and after conditioning' }),
    note: 'A yarn that has been through a strain recovers far better from the same strain next time: the first loading sets the structure. The first time a yarn is knitted, or the first wash, is its hardest.',
  };

  // 6 ── conditions
  const conds = Object.keys(CONDITIONS).map((cid) => {
    const cc = { id: cid, ...CONDITIONS[cid] };
    const a = yarnSet(strainPct, hold, rest, false, cc), g = ids.reduce((t, id, i) => t + share[i] * REC[id].c, 0) * cc.creep;
    return { id: cid, label: CONDITIONS[cid].label, recovery_pct: r1(a.recovery_pct), set_pct: r2(a.set_pct), creep_per_decade_pct: r1(g * 100), relaxation_per_decade_pct: r1(ids.reduce((t, id, i) => t + share[i] * rI(id), 0) * cc.relax * 100) };
  });

  // 7 ── knitting
  const T = k.tex * 0.55;                                            // cN, the typical running tension
  const epsK = (() => { for (const p of k.pts) if (p.F * 100 * k.tex >= T) return p.eps; return k.peakEps; })();
  const gave = yarnSet(epsK * 100, 600, 86400, false, { ...CONDITIONS.hot_wet, id: 'hot_wet', rh: 90 });
  const knitting = {
    running_tension: V(r1(T), 'cN', 'typical'), yarn_strain: V(r3(epsK * 100), '%', 'blend'),
    returned_in_finishing: V(r3(Math.max(0, epsK * 100 - gave.set_pct)), '% of the yarn length', 'blend'),
    set_left_in_the_yarn: V(r3(gave.set_pct), '% of the yarn length', 'blend'),
    note: 'The running tension strains the yarn a fraction of a per cent while it knits; the elastic part comes back when the cloth is relaxed and washed (the yarn\'s share of the relaxation shrinkage). What stays is the set.',
  };

  // 8 ── the cloth
  const g1000 = cycRows[3].growth_pct;
  const growth = g1000 < 1.2 ? 'low' : g1000 < 3 ? 'moderate' : 'high';
  const recClass = day.recovery_pct >= 85 ? 'good' : day.recovery_pct >= 70 ? 'fair' : 'poor';
  const cloth = {
    yarn_growth_after_1000_cycles: V(g1000, '%', 'blend'), growth_tendency: growth, recovery_class: recClass,
    note: 'In the cloth, the first stretch is the loops changing shape: easy, and mostly coming back apart from what friction at the crossings holds. Only when the loops are straight in the pull direction is the yarn itself strained, and then THIS yarn\'s recovery decides what stays. A cotton-rich yarn keeps about half of every strain beyond a few per cent: knees, elbows and seats bag; a polyester or nylon part, and above all elastane, pulls the cloth back.',
    advice: [growth === 'high' ? 'High growth: add polyester or nylon, an elastane, or a tighter loop (a smaller stitch length) so the yarn is strained less.' : null, cond.id !== 'dry' ? 'Wet or humid yarn creeps and sets more: do not hold the cloth stretched wet.' : null, ids.includes('viscose') || ids.includes('modal') || ids.includes('bamboo') || ids.includes('tencel') ? 'Regenerated cellulose recovers worst of the common fibres: expect bagging unless it is blended.' : null].filter(Boolean),
  };
  if (elastane > 0) cloth.elastane = { share_pct: r1(elastane), note: 'Elastane brings most of its strain back (typically 95–98 % from 100 % extension, a set of 2–4 %) and pulls the loops back past the crossing friction; the figures above are for the staple yarn it rides with.', basis: 'typical' };

  return {
    success: true,
    identity: { label: BY.labelOfMix(Object.fromEntries(P.comps.map((c) => [c.id, c.share]))), count: { tex: r2(k.tex), ne: r1(590.5 / k.tex) }, spinning: P.spinKey, condition: { id: cond.id, label: cond.label, rh: cond.rh }, mean_fibre_angle: r1(k.thetaM * 180 / Math.PI), structure_factor: struct },
    recovery, creep, relaxation, cyclic, conditioning, conditions: conds, knitting, cloth, warnings, derivations: derive,
  };
}

function catalogue() {
  return {
    fibres: FIBRE_IDS.map((id) => ({ id, label: BY.FIB[id].label })),
    conditions: Object.entries(CONDITIONS).map(([id, c]) => ({ id, label: c.label })),
    times: TIMES.map(([s, l]) => ({ seconds: s, label: l })),
  };
}
/** The Studio's yarn → a recovery profile (a fibre mix in label %, a tex, the spinning system, the person's choices). */
function profileOf(mix, tex, spinKey, opts) {
  const fibres = {};
  for (const [f, v] of Object.entries(mix || {})) { const k = f === 'spandex' ? 'elastane' : f; if ((own(REC, k) || k === 'elastane') && +v > 0) fibres[k] = (fibres[k] || 0) + +v; }
  if (!Object.keys(fibres).some((f) => f !== 'elastane')) return null;
  const o = opts || {};
  return analyse({ fibres, count: { value: tex, unit: 'tex' }, spinning: own(STRUCT, spinKey) ? spinKey : undefined, ply: o.ply, strain_pct: o.strain_pct, hold_s: o.hold_s, rest_s: o.rest_s, condition: o.condition, load_pct: o.load_pct, imposed_strain_pct: o.imposed_strain_pct, humidity_rh: o.humidity_rh });
}

module.exports = { analyse, profileOf, catalogue, RecoveryError, REC, CONDITIONS, growthAt, fibreSet };
