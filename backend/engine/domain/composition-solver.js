/**
 * Composition solver — the Studio run backwards from a fibre composition.
 *
 * The person writes what the cloth must be ("95% CO 5% EL", {cotton: 55, polyester: 40, elastane: 5}) and the solver finds what to put in the machine:
 *   1. ELASTANE: the bare-yarn denier, the draft and how often it is fed (every feeder / alternate feeders) so that its share of the cloth's mass is
 *      the target. Draft must stay inside the knitting window (2.0 – 4.2), and 3.0 is preferred; a thin yarn at a high draft is chosen over a thick one
 *      at a low draft only when the window demands it.
 *   2. STAPLE FIBRES, one blend in every yarn (default): the remaining fibres, renormalised, become the mix of the yarn (blend-yarn-engine).
 *   3. STAPLE FIBRES, one fibre per role (`target.composition_roles`, e.g. {face:'cotton', binder:'cotton', loop:'polyester'}): the fibre of each
 *      role is fixed by the person, and the COUNT of the roles of the minor fibres is solved so that each fibre's share of the mass is the target
 *      (the largest fibre's yarn keeps the count given, mass = share × stitch length × tex, so a fibre's share moves with its yarn's count).
 *
 * Every answer is checked: the Studio is run on the solved design and the cloth's fibre shares (feasibility-engine.clothFibres) are compared with the
 * target. The report says what was solved, what the cloth really is, the largest miss in points and whether it is inside the label tolerance.
 *
 * The basis is the mass of yarn as fed to the machine (as the Studio weighs it). A commercial label is on dry mass with a regain allowance:
 * the report says so, and the gap is a point or less for the fibres here.
 */
'use strict';

const BY = require('./blend-yarn-engine');
const FEAS = require('./feasibility-engine');
const CE = require('./composition-engine');

class CompositionError extends Error { constructor(m) { super(m); this.name = 'CompositionError'; } }

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const DRAFT_MIN = 2.0, DRAFT_MAX = 4.2, DRAFT_PREFERRED = 3.0;
const DENIERS = [20, 30, 40, 70, 100, 140];
const EVERY = [['all', 1], ['alternate', 0.5]];
const TOL_PTS = 3;                 // the label tolerance of the textile-labelling rules (points of the cloth)
const SOLVED_PTS = 0.25;           // a solved composition is held to this
const ALIAS = { elastane: 'elastane', spandex: 'elastane', lycra: 'elastane', polyester_spun: 'polyester', pes: 'polyester', nylon_filament: 'nylon', polyamide: 'nylon' };
// the Studio's own fibre keys for a pure yarn; anything else goes in as a blend carrying its true mix
const PLAIN = { cotton: 'cotton', polyester: 'polyester_spun', viscose: 'viscose', modal: 'modal', wool: 'wool', acrylic: 'acrylic', silk: 'silk', linen: 'linen', polypropylene: 'polypropylene' };

/** A composition as { fibre: % } summing to 100, from a text ("95% CO 5% EL") or an object. */
function readTarget(raw) {
  let v;
  if (typeof raw === 'string') {
    const p = CE.parseComposition(raw);
    if (!p || !p.fibers || !Object.keys(p.fibers).length) throw new CompositionError(`Could not read the composition "${raw}". Write it like "95% CO 5% EL" or "60% cotton 40% polyester".`);
    v = p.fibers;
    // a share the parser could not name must not vanish (it renormalises what is left): every "N% name" is checked on its own
    const tok = /(\d+(?:\.\d+)?)\s*%\s*([a-zA-Z][a-zA-Z\s\-\/]*?)(?=\s*[\+,]|\s+\d+%|\s*$)/g;
    let m, n = 0;
    while ((m = tok.exec(raw)) !== null) { n++; if (!CE.parseComposition(`${m[1]}% ${m[2].trim()}`)) throw new CompositionError(`"${m[2].trim()}" in "${raw}" is not a fibre name the solver reads. Use CO, PES, CV (viscose), MODAL, EL, PA, WO, SE, LI, PP, or the full name.`); }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) v = raw;
  else throw new CompositionError('Give the composition as text ("95% CO 5% EL") or as { fibre: percent }.');
  const out = {};
  for (const [k0, x] of Object.entries(v)) {
    const k = String(k0).toLowerCase(); const key = own(ALIAS, k) ? ALIAS[k] : k;
    const n = +x;
    if (!(n > 0)) continue;
    if (key !== 'elastane' && !own(BY.FIB, key)) throw new CompositionError(`"${k0}" is not a fibre the solver knows. It knows: ${Object.keys(BY.FIB).join(', ')}, elastane.`);
    out[key] = (out[key] || 0) + n;
  }
  const tot = Object.values(out).reduce((t, x) => t + x, 0);
  if (!Object.keys(out).length) throw new CompositionError('The composition has no fibre with a share above zero.');
  if (Math.abs(tot - 100) > 1) throw new CompositionError(`The composition adds to ${r1(tot)} %: it must add to 100 %.`);
  Object.keys(out).forEach((k) => { out[k] = (out[k] / tot) * 100; });
  if (out.elastane >= 30) throw new CompositionError(`${r1(out.elastane)} % elastane is outside what a knitted cloth carries (up to about 20 %).`);
  return out;
}

// a yarn carrying a fibre mix, the way the Studio takes it (blend-yarn-engine.toStudioYarn)
function yarnOfMix(mix) {
  const keys = Object.keys(mix);
  if (keys.length === 1 && own(PLAIN, keys[0])) return { fibre: PLAIN[keys[0]], mix: null, blend: null, blend_density: null };
  let sy;
  try { sy = BY.toStudioYarn({ fibres: mix }); } catch (e) { if (e instanceof BY.BlendError) throw new CompositionError(e.message); throw e; }
  return { fibre: sy.fibre, mix: sy.mix, blend: true, blend_density: sy.density };
}

const staplePart = (target) => {
  const el = target.elastane || 0, rest = 100 - el, mix = {};
  Object.entries(target).forEach(([k, v]) => { if (k !== 'elastane') mix[k] = (v / rest) * 100; });
  return { el, mix, rest };
};

/** the cloth's fibre shares (% of all), elastane included */
const clothOf = (out) => FEAS.clothFibres(out);
const missPts = (target, got) => {
  let worst = 0, at = null;
  for (const k of new Set([...Object.keys(target), ...Object.keys(got)])) { const d = Math.abs((got[k] || 0) - (target[k] || 0)); if (d > worst) { worst = d; at = k; } }
  return { pts: r2(worst), fibre: at };
};
const elastanePct = (out) => ((out.yarn && out.yarn.composition) || []).filter((c) => /elastane|lycra|spandex/i.test(c.part || '')).reduce((t, c) => t + (+c.pct || 0), 0);

/**
 * solve(input, analyse) — input.target.composition is the target; `analyse` is the Studio's analyse. Returns the Studio answer for the solved design,
 * with `composition_solve` (the report). Throws CompositionError for an impossible request.
 */
function solve(input, analyse) {
  const tIn = input.target || {};
  if (input.blend || input.melange) throw new CompositionError('A target composition and the blend / melange cards both set the yarn\'s fibres. Use one of them: the composition target already writes the blend.');
  const target = readTarget(tIn.composition);
  const { el, mix, rest } = staplePart(target);
  const notes = [];
  const clean = { ...input, target: { ...tIn } };
  delete clean.target.composition; delete clean.target.composition_roles;
  const run = (inp) => { const o = analyse(inp); if (!o || o.success === false) throw new CompositionError(o && o.error ? o.error : 'The Studio could not analyse the design.'); return o; };
  const solved = {};

  // ── staple fibres ─────────────────────────────────────────────────────────────────────────────────────────────
  let work = { ...clean, yarn: { ...(clean.yarn || {}) } };
  const rolesIn = tIn.composition_roles && typeof tIn.composition_roles === 'object' ? tIn.composition_roles : null;
  const stapleKeys = Object.keys(mix);
  let roleSolve = null;
  if (!rolesIn) {
    const y = yarnOfMix(mix);
    // a single fibre the yarn already is stays the yarn it is: "100% polyester" on a 75 D textured filament keeps the filament (the composition
    // names the fibre, not the spinning: a staple yarn of it was put in its place, and every look of the filament with it)
    const base = (k) => ({ polyester_spun: 'polyester', polyester_filament: 'polyester', nylon_filament: 'nylon' })[k] || k;
    const put = (yy) => (yy && !y.blend && yy.fibre && base(yy.fibre) === base(y.fibre) ? { ...yy, mix: null, blend: null } : { ...yy, fibre: y.fibre, mix: y.mix, blend: y.blend, blend_density: y.blend_density });
    work.yarn = put(work.yarn);
    work.yarns = { ...(work.yarns || {}) };
    ['binder', 'loop', 'plate'].forEach((r) => { if (work.yarns[r]) work.yarns[r] = put(work.yarns[r]); });
    work.feeds = (work.feeds || []).map((f) => (f && f.yarn ? { ...f, yarn: put(f.yarn) } : f));
    solved.yarn = { fibres: Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, r1(v)])), basis: 'every yarn carries the one blend' };
  } else {
    roleSolve = solveRoles(work, rolesIn, mix, el, run, notes);
    work = roleSolve.input;
    solved.roles = roleSolve.report;
  }

  // ── elastane ─────────────────────────────────────────────────────────────────────────────────────────────────
  if (el > 0) {
    const given = work.elastane && typeof work.elastane === 'object' ? work.elastane : {};
    const d0 = +given.denier > 0 ? +given.denier : 40, g0 = +given.draft > 0 ? +given.draft : DRAFT_PREFERRED, e0 = given.every === 'alternate' ? 'alternate' : 'all';
    const probe = run({ ...work, elastane: { denier: d0, draft: g0, every: e0 } });
    const p0 = elastanePct(probe) / 100;
    if (!(p0 > 0)) throw new CompositionError('The Studio carried no elastane in the probe run: the elastane could not be sized.');
    const f0 = e0 === 'alternate' ? 0.5 : 1;
    const rho0 = p0 / (1 - p0), rhoT = el / 100 / (1 - el / 100);
    // the draft for each (denier, feeding) that gives the target mass share; keep the ones inside the window
    const cands = [];
    for (const d of DENIERS) for (const [e, f] of EVERY) {
      const g = (rho0 * (d / d0) * g0 * (f / f0)) / rhoT;
      const inside = g >= DRAFT_MIN && g <= DRAFT_MAX;
      const gc = Math.min(DRAFT_MAX, Math.max(DRAFT_MIN, g));
      cands.push({ d, e, g, gc, inside, score: Math.abs(gc - DRAFT_PREFERRED) + (inside ? 0 : 5 + Math.abs(g - gc)) + (e === 'alternate' ? 0.3 : 0) + 0.15 * Math.abs(Math.log(d / 40)) });
    }
    cands.sort((a, b) => a.score - b.score);
    const best = cands[0];
    let draft = best.gc;
    if (!best.inside) notes.push(`${r1(el)} % elastane cannot be reached inside the draft window ${DRAFT_MIN}–${DRAFT_MAX} with the deniers and feedings tried: the nearest, ${best.d} D ${best.e === 'alternate' ? 'on alternate feeders' : 'on every feeder'} at a draft of ${r2(best.gc)}, is used.`);
    // the actual cloth settles the last fraction: scale the draft by the miss, a few rounds
    let o = null;
    for (let k = 0; k < 6; k++) {
      o = run({ ...work, elastane: { denier: best.d, draft: r2(draft), every: best.e } });
      const got = elastanePct(o);
      if (Math.abs(got - el) < SOLVED_PTS / 2 || !best.inside) break;
      draft = Math.min(DRAFT_MAX, Math.max(DRAFT_MIN, draft * (got / el)));
    }
    work = { ...work, elastane: { denier: best.d, draft: r2(draft), every: best.e } };
    solved.elastane = { denier: best.d, draft: r2(draft), every: best.e, basis: 'the draft is solved for the share; the denier is the one that keeps the draft nearest 3.0 inside the knitting window' };
    if (el < 1) notes.push('Under 1 % elastane is a trace: it will not give the cloth any stretch recovery.');
  } else if (work.elastane) { work = { ...work }; delete work.elastane; notes.push('The target has no elastane, so the elastane card is not used.'); }

  // ── the answer, checked ───────────────────────────────────────────────────────────────────────────────────────
  const out = run(work);
  const got = clothOf(out), m = missPts(target, got);
  const inside = m.pts <= SOLVED_PTS * 2, label = m.pts <= TOL_PTS;
  out.composition_solve = {
    success: inside || label,
    target: Object.fromEntries(Object.entries(target).map(([k, v]) => [k, r1(v)])),
    achieved: got, largest_miss_pts: m.pts, largest_miss_fibre: m.fibre,
    held: inside ? 'solved: inside half a point' : label ? `inside the ${TOL_PTS}-point label tolerance, not exact` : 'NOT reached',
    solved, notes,
    basis: 'mass of yarn as fed to the machine (the Studio\'s weighing). A label is on dry mass with a regain allowance: the gap is about a point or less for these fibres. Staple yarns are assumed; a filament yarn is named in the yarn card.',
    inputs_written: { yarn: work.yarn && { fibre: work.yarn.fibre, mix: work.yarn.mix || null }, elastane: work.elastane || null },
  };
  Object.defineProperty(out, '_design', { value: work, enumerable: false });      // the design the solver wrote (the routes weigh it, not the target)
  return out;
}

// per-role fibres: solve the count of the minor groups so each fibre's share of the mass is the target
function solveRoles(work, rolesIn, mix, el, run, notes) {
  const fibreOf = (role) => (own(rolesIn, role) ? String(rolesIn[role]).toLowerCase() : null);
  const feeds0 = work.feeds || [];
  const roleOfFeed = feeds0.map((f) => (f && f.role) || 'ground');
  const groups = {};
  roleOfFeed.forEach((role, i) => { const fb0 = fibreOf(role); if (!fb0) return; const fb = own(ALIAS, fb0) ? ALIAS[fb0] : fb0; (groups[fb] = groups[fb] || []).push(i); });
  for (const k of Object.keys(mix)) if (!groups[k]) throw new CompositionError(`${k} is in the composition but no role of the design carries it. Assign it in composition_roles (the roles of this design: ${[...new Set(roleOfFeed)].join(', ')}).`);
  for (const k of Object.keys(groups)) if (!(k in mix)) throw new CompositionError(`A role is assigned ${k}, which is not in the composition.`);
  const keys = Object.keys(groups);
  const ref = keys.slice().sort((a, b) => mix[b] - mix[a])[0];
  // starting counts: the Studio's own answer for the design as given (every role's count is written out, so the fibre can be changed without moving it)
  const yarnOf = (k, tex) => { const y = yarnOfMix({ [k]: 100 }); return { fibre: y.fibre, mix: y.mix, blend: y.blend, blend_density: y.blend_density, count: tex, unit: 'tex' }; };
  const o0 = run(work);
  const baseTex = (i) => { const role = roleOfFeed[i]; const f = (o0.yarn.feeds || []).find((x) => x.role === role); return f ? +f.tex : null; };
  const texOf = {};
  keys.forEach((k) => { texOf[k] = groups[k].map((i) => baseTex(i)); });
  const build = () => ({ ...work, feeds: feeds0.map((f, i) => { const k = keys.find((x) => groups[x].includes(i)); if (!k) return f; const j = groups[k].indexOf(i); return { ...(f || {}), yarn: { ...((f && f.yarn) || {}), ...yarnOf(k, r2(texOf[k][j] * factor[k])) } }; }) });
  const factor = Object.fromEntries(keys.map((k) => [k, 1]));
  let cur = build();
  let o = run(cur);
  const share = (oo) => { // % of the staple mass by fibre
    const got = clothOf(oo); const tot = Object.keys(mix).reduce((t, k) => t + (got[k] || 0), 0) || 1;
    return Object.fromEntries(Object.keys(mix).map((k) => [k, ((got[k] || 0) / tot) * 100]));
  };
  let capped = false;
  for (let it = 0; it < 10; it++) {
    const s = share(o);
    const worst = Math.max(...keys.map((k) => Math.abs(s[k] - mix[k])));
    if (worst < SOLVED_PTS / 2) break;
    const refAdj = mix[ref] / Math.max(s[ref], 0.01);
    keys.forEach((k) => { if (k === ref) return; factor[k] *= (mix[k] / Math.max(s[k], 0.01)) / refAdj; });
    const bad = keys.some((k) => texOf[k].some((t) => { const v = t * factor[k]; return !(v >= 2.5 && v <= 120); }));
    if (bad) { capped = true; keys.forEach((k) => { if (k !== ref) factor[k] = Math.min(120 / Math.max(...texOf[k]), Math.max(2.5 / Math.min(...texOf[k]), factor[k])); }); cur = build(); o = run(cur); break; }
    cur = build();
    o = run(cur);
  }
  if (capped) notes.push('A yarn count needed to hold the composition would be outside 2.5–120 tex: the nearest reachable counts are used.');
  const report = {};
  keys.forEach((k) => { report[k] = { roles: [...new Set(groups[k].map((i) => roleOfFeed[i]))], count_tex: texOf[k].map((t) => r2(t * factor[k])), count_ne: texOf[k].map((t) => r1(590.5 / (t * factor[k]))), kept: k === ref }; });
  return { input: cur, report };
}

module.exports = { solve, readTarget, CompositionError, DRAFT_MIN, DRAFT_MAX };
