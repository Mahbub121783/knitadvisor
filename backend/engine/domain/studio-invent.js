/**
 * Fabric Studio — design from a goal (inverse design).
 *
 * The designer says what the cloth must be: its weight (and width), one bed or
 * two, and which qualities matter — more or less stretch, openness, texture,
 * flatness, a smooth face — and whether they want a proven structure or
 * something new. The Studio then searches needle programmes itself: it starts
 * from the catalogue's structures and from random ones, breeds and mutates them
 * (an evolutionary search), and keeps only what
 *
 *   1. the Studio's own engine knits: every check passes (every needle knits,
 *      held loops and floats within limits) and a real yarn, gauge and stitch
 *      length reach the target weight inside the factory's tightness window;
 *   2. scores best on the asked-for qualities (structure-traits.js indicators);
 *
 * and returns a handful of DIFFERENT answers, each with the settings to knit it
 * and the measured range of how right its weight is likely to be (the
 * cross-validated accuracy every analysis carries). A structure that matches no
 * catalogue fabric is marked new — and its range is the wider one of a
 * structure with no records.
 *
 * Bounded: a fixed number of evaluations and a time limit; the random stream is
 * seeded by the request, so the same goal gives the same answers (and caches).
 */
'use strict';
const S = require('./fabric-studio');
const { traitsOf, TRAITS, distance } = require('./structure-traits');

class InventError extends Error {}

function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rowsOf = (g) => (g || []).map((r) => (Array.isArray(r) ? r.join('') : String(r)));

function cleanGoal(input) {
  const g = input || {};
  const gsm = +g.gsm;
  if (!(gsm >= 80 && gsm <= 600)) throw new InventError('Give the target weight: 80 to 600 GSM.');
  const bed = ['single', 'double', 'any'].includes(g.bed) ? g.bed : 'any';
  const prefs = {};
  TRAITS.forEach((t) => { const v = +((g.prefs || {})[t]); prefs[t] = v > 0 ? 1 : v < 0 ? -1 : 0; });
  const novelty = ['proven', 'balanced', 'new'].includes(g.novelty) ? g.novelty : 'balanced';
  const lim = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isInteger(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  return {
    gsm, width_in: +g.width_in > 0 ? +g.width_in : null, bed, prefs, novelty,
    max_needles: lim(g.max_needles, 2, 8, 6), max_feeds: lim(g.max_feeds, 2, 8, 6), max_float: lim(g.max_float, 1, 6, 3),
    yarn: { fibre: (g.yarn || {}).fibre || 'cotton', ...((g.yarn || {}).count ? { count: +g.yarn.count, unit: g.yarn.unit || 'ne' } : {}) },
    machine: { ...(+((g.machine || {}).gauge) > 0 ? { gauge: +g.machine.gauge } : {}), ...(+((g.machine || {}).dia) > 0 ? { dia: +g.machine.dia } : {}) },
    // a floor machine's learned profile (and the pool's numbers): every candidate is weighed the way THIS machine knits
    floor: S.cleanFloor(g.floor) || null,
  };
}

/** The catalogue's structures a search may start from: plain-yarn programmes on the beds asked for. */
function seedsFor(goal) {
  return S.listTemplates().filter((t) => t.roles.every((r) => r === 'ground') && !t.plated && !(t.ends > 1))
    .map((t) => ({ gating: t.grid.D ? (t.gating || 'rib') : null, C: rowsOf(t.grid.C), D: t.grid.D ? rowsOf(t.grid.D) : null, from: t.id }))
    .filter((i) => (goal.bed === 'single' ? !i.D : goal.bed === 'double' ? !!i.D : true))
    .filter((i) => i.C.length <= goal.max_feeds && i.C[0].length <= goal.max_needles && /^[KTME\-]+$/.test(i.C.join('') + (i.D || []).join('')));
}

const keyOf = (i) => `${i.gating || 's'}|${i.C.join('/')}|${(i.D || []).join('/')}`;
const setAt = (row, j, c) => row.slice(0, j) + c + row.slice(j + 1);

function mutate(ind, rnd, goal) {
  const x = { gating: ind.gating, C: ind.C.slice(), D: ind.D ? ind.D.slice() : null };
  const pick = (n) => Math.floor(rnd() * n);
  const R = x.C.length, W = x.C[0].length;
  const alpha = x.D ? 'KKKTM' : goal.prefs.open > 0 ? 'KKKTTME' : 'KKKTTM';
  const op = rnd();
  if (op < 0.5) {                                                        // one stitch changes
    const bed = x.D && rnd() < 0.5 ? 'D' : 'C', i = pick(R), j = pick(W);
    if (x[bed][i][j] !== '-') x[bed][i] = setAt(x[bed][i], j, alpha[pick(alpha.length)]);
  } else if (op < 0.6 && R < goal.max_feeds) {                           // a feed is repeated (and may then differ)
    const i = pick(R); x.C.splice(i, 0, x.C[i]); if (x.D) x.D.splice(i, 0, x.D[i]);
  } else if (op < 0.68 && R > 1) {                                       // a feed is dropped
    const i = pick(R); x.C.splice(i, 1); if (x.D) x.D.splice(i, 1);
  } else if (op < 0.78 && W < goal.max_needles) {                        // a needle column is repeated
    const j = pick(W); x.C = x.C.map((r) => r.slice(0, j + 1) + r[j] + r.slice(j + 1)); if (x.D) x.D = x.D.map((r) => r.slice(0, j + 1) + r[j] + r.slice(j + 1));
  } else if (op < 0.85 && W > 1) {                                       // a needle column is dropped
    const j = pick(W); x.C = x.C.map((r) => r.slice(0, j) + r.slice(j + 1)); if (x.D) x.D = x.D.map((r) => r.slice(0, j) + r.slice(j + 1));
  } else if (op < 0.93) {                                                // a feed shifts one needle (diagonals, stagger)
    const i = pick(R); const r = x.C[i]; x.C[i] = r.slice(1) + r[0];
  } else if (x.D && x.gating === 'rib') {                                // a dial needle taken out (or put back): rib variations
    const j = pick(W), out = x.D.every((r) => r[j] === '-');
    x.D = x.D.map((r) => setAt(r, j, out ? 'K' : '-'));
  } else {                                                               // two feeds swap
    const a = pick(R), b = pick(R); [x.C[a], x.C[b]] = [x.C[b], x.C[a]]; if (x.D) [x.D[a], x.D[b]] = [x.D[b], x.D[a]];
  }
  return x;
}
function crossover(a, b, rnd) {
  if (a.gating !== b.gating || a.C.length !== b.C.length || a.C[0].length !== b.C[0].length) return null;
  const take = a.C.map(() => rnd() < 0.5);
  return { gating: a.gating, C: a.C.map((r, i) => (take[i] ? r : b.C[i])), D: a.D ? a.D.map((r, i) => (take[i] ? r : b.D[i])) : null };
}

function invent(input, opts = {}) {
  const goal = cleanGoal(input);
  const maxEvals = opts.maxEvals || 320, deadline = Date.now() + (opts.timeMs || 3500);
  const rnd = mulberry32(hashStr(JSON.stringify(goal)));
  const seeds = seedsFor(goal);
  if (!seeds.length) throw new InventError('No starting structure fits these limits — allow more needles or feeds.');
  const seedFeatures = seeds.map((s) => traitsOf(s, s.gating).feature);
  const cache = new Map();
  let evals = 0, knittable = 0;
  const novW = goal.novelty === 'new' ? 1 : goal.novelty === 'proven' ? -1 : 0;

  function evaluate(ind) {
    const k = keyOf(ind);
    if (cache.has(k)) return cache.get(k);
    let res = null;
    const tr = traitsOf(ind, ind.gating);
    const cols = (rows) => [...Array(rows[0].length).keys()].every((j) => rows.some((r) => r[j] === 'K' || r[j] === 'E') || rows.every((r) => r[j] === '-'));
    // cheap refusals before the engine: floats too long, a needle that never knits
    if (tr.longest_float <= goal.max_float && cols(ind.C) && (!ind.D || cols(ind.D)) && evals < maxEvals && Date.now() < deadline) {
      evals++;
      let a = null;
      try {
        a = S.analyse({ bed: ind.D ? 'double' : 'single', gating: ind.gating || 'rib', grid: { C: ind.C, D: ind.D }, feeds: ind.C.map(() => ({ role: 'ground' })), yarn: goal.yarn, machine: goal.machine, ...(goal.floor ? { floor: goal.floor } : {}), target: { gsm: goal.gsm, ...(goal.width_in ? { width_in: goal.width_in } : {}) } });
      } catch (_) { a = null; }
      if (a && a.success && a.ok_to_knit && Math.abs(a.fabric.gsm - goal.gsm) / goal.gsm <= 0.04) {
        knittable++;
        const match = a.structure.match;
        const nearest = Math.min(...seedFeatures.map((f) => distance(f, tr.feature)));
        const novelty = match ? 0.05 : Math.max(0.15, Math.min(1, nearest / 0.5));
        const acc = a.fabric.accuracy;
        let score = 0;
        TRAITS.forEach((t) => { score += goal.prefs[t] * (tr[t] - 0.5) * 2; });
        score += novW * (novelty - 0.5) * 1.2;
        score += 0.3 * ((acc ? acc.gsm.within_5_pct : 50) / 100);                     // a likelier first trial counts
        if (goal.floor && acc && acc.supported_by_rolls) score += 0.25 * Math.min(1, acc.supported_by_rolls / 10);   // a structure this machine has already knitted is surer
        if (goal.width_in) score -= 3 * Math.abs(a.fabric.width_open_in - goal.width_in) / goal.width_in;
        const warns = a.checks.filter((c) => c.level === 'warn');
        // a warning is a real risk on the floor; no setting inside every factory limit (hook load, tightness) is a serious one
        score -= 0.15 * warns.length + (warns.some((w) => /inside every factory limit|hook load/i.test(w.text)) ? 0.6 : 0);
        res = { ind, a, tr, match, novelty, score, warns };
      }
    }
    cache.set(k, res);
    return res;
  }

  // the first generation: every catalogue structure that fits, and variations of them
  let pop = [];
  seeds.forEach((s) => pop.push(s));
  while (pop.length < 36) { let x = seeds[Math.floor(rnd() * seeds.length)]; const n = 1 + Math.floor(rnd() * 3); for (let i = 0; i < n; i++) x = mutate(x, rnd, goal); pop.push(x); }
  let scored = [];
  for (let gen = 0; gen < 14 && evals < maxEvals && Date.now() < deadline; gen++) {
    scored = [...new Map(pop.map((i) => [keyOf(i), i])).values()].map(evaluate).filter(Boolean).sort((p, q) => q.score - p.score);
    const keep = scored.slice(0, 10).map((s) => s.ind);
    if (!keep.length) { pop = seeds.map((s) => mutate(s, rnd, goal)); continue; }
    const next = keep.slice();
    while (next.length < 30) {
      const a = keep[Math.floor(rnd() * keep.length)];
      let c = rnd() < 0.3 ? crossover(a, keep[Math.floor(rnd() * keep.length)], rnd) : null;
      c = mutate(c || a, rnd, goal);
      if (rnd() < 0.35) c = mutate(c, rnd, goal);
      next.push(c);
    }
    pop = next;
  }
  // every knittable answer found, best first, then a handful that differ from each other
  const all = [...cache.values()].filter(Boolean).sort((p, q) => q.score - p.score);
  const chosen = [];
  for (const s of all) {
    if (chosen.length >= (opts.top || 6)) break;
    if (chosen.some((c) => c.ind.gating === s.ind.gating && distance(c.tr.feature, s.tr.feature) < 0.12)) continue;
    chosen.push(s);
  }
  const why = (s) => {
    const parts = TRAITS.filter((t) => goal.prefs[t]).map((t) => `${goal.prefs[t] > 0 ? 'more' : 'less'} ${t}: ${Math.round(s.tr[t] * 100)}/100`);
    return parts.length ? parts.join(' · ') : 'meets the weight on a proven setting';
  };
  const { floor: floorUsed, ...goalOut } = goal;
  return {
    success: true, goal: goalOut,
    machine_profile: floorUsed ? { name: floorUsed.name, rolls: floorUsed.rolls.length, pooled: !!floorUsed.pool } : null,
    stats: { evaluated: evals, knittable, structures_seen: cache.size, ms: Math.max(0, (opts.timeMs || 3500) - (deadline - Date.now())) },
    candidates: chosen.map((s, i) => {
      const f = s.a.fabric, acc = f.accuracy;
      return {
        rank: i + 1, score: Math.round(s.score * 100) / 100,
        name: s.match ? s.match.name : 'New structure', is_new: !s.match, novelty: Math.round(s.novelty * 100) / 100,
        bed: s.ind.D ? 'double' : 'single', gating: s.ind.gating, grid: { C: s.ind.C, D: s.ind.D }, feeds: s.ind.C.length, needles: s.ind.C[0].length,
        traits: { stretch: s.tr.stretch, open: s.tr.open, texture: s.tr.texture, flat: s.tr.flat, smooth: s.tr.smooth }, shares: s.tr.shares, longest_float: s.tr.longest_float, longest_hold: s.tr.longest_hold,
        why: why(s),
        fabric: { gsm: f.gsm, width_open_in: f.width_open_in, tf: f.tf, wpc: f.wpc, cpc: f.cpc, sl_mm: f.sl_mm },
        settings: { yarn: s.a.yarn.ground.count, gauge: s.a.machine.gauge, sl_mm: f.sl_mm, machine: s.a.machine.machine_label },
        accuracy: acc ? { level: acc.level, gsm_range: acc.gsm.range, within_5_pct: acc.gsm.within_5_pct, typical_error_pct: acc.gsm.typical_error_pct, basis: acc.basis, supported_by_rolls: acc.supported_by_rolls || 0 } : null,
        confidence: s.a.structure.confidence.level,
        warnings: s.warns.map((w) => w.text).slice(0, 3),
      };
    }),
    basis: 'Searched by the Studio itself: catalogue structures and their variations, bred and mutated, each knitted by the same engine (checks, yarn, gauge, stitch length, weight) and scored on the qualities asked for. The qualities are structural indicators (0–100) for comparing designs, not measured properties; the weight range is the cross-validated one.',
  };
}

module.exports = { invent, cleanGoal, InventError, mutate, seedsFor };
