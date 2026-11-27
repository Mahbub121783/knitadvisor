/**
 * Fit the universal loop model's constants (engine/domain/universal-model.js) from knitting records, and judge them
 * honestly: every construction left out in turn ("a cloth never knitted"), the stitch lengths and counts it would be
 * designed with compared with what was run, and the weight predicted from the yarns and stitch lengths actually run.
 *
 *   node tools/universal-fit.js              fit on all, judge leave-one-construction-out, write the constants
 *   node tools/universal-fit.js --dry        judge only
 *
 * Records: backend/data/rnd-recipes.json (the work orders). The file written holds constants only.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const U = require('../engine/domain/universal-model');
const RB = require('../engine/domain/recipe-book');
process.env.KA_NO_RECIPES = '1';
const S = require('../engine/domain/fabric-studio');

const OUT = path.join(__dirname, '..', 'data', 'universal-model.json');
// the work orders' cloths → the needle diagram that knits them
const DIAGRAM = {
  single_jersey: 'single_jersey', heavy_jersey: 'heavy_jersey', plated_jersey: 'plated_jersey', fleece_brushed: 'fleece_3_thread', fleece_loopback: 'french_terry',
  fleece_diagonal: 'fleece_diagonal', terry_2t: 'fleece_2_thread', rib_1x1: 'rib_1x1', rib_2x2: 'rib_2x2', rib_2x1: 'rib_2x1', rib_3x2: 'rib_3x2', rib_3x3: 'rib_3x3',
  rib_4x1: 'rib_4x1', rib_4x2: 'rib_4x2', rib_5x3: 'rib_5x3', interlock: 'interlock', ponte_di_roma: 'ponte_di_roma', pique: 'pique_single', lacoste_single: 'lacoste_single', waffle_tuck: 'waffle_knit',
};
const T = S.listTemplates();
const diagrams = {};
function diagramOf(id) {
  if (!diagrams[id]) {
    const t = T.find((x) => x.id === id);
    diagrams[id] = U.diagram({ C: t.grid.C, D: t.grid.D, roles: t.roles, gating: t.bed === 'single' ? 'single' : t.gating });
  }
  return diagrams[id];
}
const BRUSHED = new Set(['fleece_brushed', 'fleece_diagonal']);

function observe(r) {
  const id = DIAGRAM[r.cloth];
  if (!id || !r.sl.length || !r.yarns.length) return null;
  const d = diagramOf(id);
  const pos = RB.positions(r);
  if (!pos.face || pos.face.fil) return null;
  const need = d.inlay ? (d.binder ? 2 : 2) : 1;
  if (r.sl.length < need) return null;
  const sl = U.slForFeeds(d, r.sl);
  const tex = (y) => (y ? y.tex || y.d / 9 : null);
  const faceTex = tex(pos.face) * (r.cloth === 'plated_jersey' && (pos.face.ply || 1) === 1 ? 2 : 1);
  const yarnTex = d.feeds.map((f) => (f.role === 'loop' ? tex(pos.loop) : f.role === 'binder' ? tex(pos.binder) : faceTex));
  if (yarnTex.some((v) => !(v > 0))) return null;
  const fi = d.faceFeeds[0];
  const lk = U.loopLength(d, sl);
  const Y = d.feeds.reduce((s, f, i) => s + sl[i] * yarnTex[i] * (f.n / d.W), 0);
  const comp = RB.compositionOf(r);
  const mix = { ...comp }; const elPct = mix.elastane || 0; delete mix.elastane;
  const tot = Object.values(mix).reduce((t, v) => t + v, 0) || 100; Object.keys(mix).forEach((k) => { mix[k] = (mix[k] * 100) / tot; });
  // a plated jersey knits two yarns into every loop (the sheet writes the one count)
  const ends = r.cloth === 'plated_jersey' ? Math.max(2, pos.face.ply || 1) : pos.face.ply || 1;
  const m = { mix, elastane: !!r.el || elPct > 0, half: r.half, style: pos.face.style, brushed: BRUSHED.has(r.cloth), binderFilament: !!(pos.binder && pos.binder.fil), yd: r.yd, plated: r.cloth === 'plated_jersey', ends };
  const o = {
    alpha: Y / (r.gsm * lk * lk * d.L * d.wales),
    tf: (10 * Math.sqrt(faceTex)) / lk,
    gauge: r.g ? (25.4 / r.g) / (Math.sqrt(faceTex) / 28) : null,
    rb: d.binder ? sl[d.feeds.findIndex((f) => f.role === 'binder')] / sl[fi] : null,
    rl: d.inlay ? sl[d.feeds.findIndex((f) => f.role === 'loop')] / sl[fi] : null,
    tl: d.inlay ? tex(pos.loop) / faceTex : null,
  };
  if (!(o.alpha > 0.005 && o.alpha < 0.4 && o.tf > 5 && o.tf < 40)) return null;
  return { cloth: r.cloth, n: r.n, gsm: r.gsm, d, m, o, sl, yarnTex, faceNe: pos.face.ne, ply: ends, loopNe: pos.loop && !pos.loop.fil ? pos.loop.ne : null, gauge: r.g, rec: r };
}

// what physics says should hardly matter is held to nothing unless the records insist: a laid-in yarn is not knitted, so it does not set the
// tightness or the gauge of the loops that are
const PRIOR = { alpha: { inlay: 40, tuckDouble: 4 }, tf: { inlay: 40, tuckDouble: 4 }, gauge: { inlay: 20 } };

// ── weighted ridge with robust reweighting ───────────────────────────────
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const v = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / v; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}
function ridge(X, y, w, keys, lambda, heavy = {}) {
  let wr = w.slice(), beta = null;
  for (let it = 0; it < 4; it++) {
    const p = keys.length, A = Array.from({ length: p }, () => Array(p).fill(0)), b = Array(p).fill(0);
    for (let i = 0; i < X.length; i++) {
      const xi = keys.map((k) => X[i][k] || 0);
      for (let a = 0; a < p; a++) { if (!xi[a]) continue; b[a] += wr[i] * xi[a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += wr[i] * xi[a] * xi[c]; }
    }
    keys.forEach((k, a) => { A[a][a] += k === 'one' ? 1e-9 : lambda * (heavy[k] || 1); });
    beta = solve(A, b);
    // Huber: a record far off its fellows counts for less
    wr = w.map((wi, i) => { const e = Math.abs(y[i] - keys.reduce((s, k, a) => s + beta[a] * (X[i][k] || 0), 0)); return e > 0.08 ? (wi * 0.08) / e : wi; });
  }
  return Object.fromEntries(keys.map((k, a) => [k, beta[a]]));
}
const wmedian = (a) => { const s = a.slice().sort((x, y) => x[0] - y[0]), t = s.reduce((q, p) => q + p[1], 0); let c = 0; for (const [v, w] of s) { c += w; if (c >= t / 2) return v; } return 0; };

function fit(obs, H) {
  const per = {};
  obs.forEach((o) => { per[o.cloth] = (per[o.cloth] || 0) + Math.sqrt(o.n); });
  const coef = {}, spec = { coef, shrink: H.shrink, bandwidth: H.bandwidth, prior: H.prior, gaugeBlend: H.gaugeBlend || 0, gaugeHold: H.gaugeHold };
  const X = obs.map((o) => U.features(o.d, o.m, o.gsm));
  for (const what of Object.keys(U.SETS)) {
    const idx = obs.map((o, i) => i).filter((i) => obs[i].o[what] > 0);
    // each construction counts alike, however often it was run (up to a point)
    const w = idx.map((i) => (Math.sqrt(obs[i].n) / Math.pow(per[obs[i].cloth], H.balance)));
    const norm = idx.length / w.reduce((t, v) => t + v, 0);
    coef[what] = ridge(idx.map((i) => X[i]), idx.map((i) => Math.log(obs[i].o[what])), w.map((v) => v * norm), U.SETS[what], H.lambda, PRIOR[what]);
  }
  // a cloth's own corrections, apart with and without elastane (a thin group is folded into the other)
  const byCloth = {};
  const orders = (idx) => idx.reduce((s, i) => s + obs[i].n, 0);
  obs.forEach((o, i) => { const k = `${o.cloth}|${o.m.elastane ? 1 : 0}`; (byCloth[k] = byCloth[k] || []).push(i); });
  Object.keys(byCloth).forEach((k) => {
    const [c, e] = k.split('|'), other = `${c}|${e === '1' ? 0 : 1}`;
    if (byCloth[k] && byCloth[other] && orders(byCloth[k]) < 20 && orders(byCloth[k]) <= orders(byCloth[other])) { byCloth[other].push(...byCloth[k]); delete byCloth[k]; }
  });
  // how far the constructions taught reach: the model does not answer beyond them (a float or a stack of held loops it has never seen)
  spec.domain = Object.fromEntries(['tuck', 'miss', 'missD', 'held', 'out'].map((k) => [k, Math.max(0, ...obs.map((o) => o.d[k]))]));
  spec.residuals = Object.entries(byCloth).map(([key, idx]) => {
    const [cloth, el] = key.split('|');
    // how far the cloth's own correction is trusted (shrunk towards none where it has few orders), to one decimal
    const r = { cloth, el: +el, wt: Math.max(0.1, Math.round((10 * idx.length) / (idx.length + H.shrink)) / 10), d: Object.fromEntries(U.KERNEL.map((k) => [k, obs[idx[0]].d[k]])) };
    // the weights this cloth was knitted at, the odd order at either end left out (1 in 100 each side)
    const ws = idx.map((i) => [obs[i].gsm, obs[i].n]).sort((a, b) => a[0] - b[0]), total = orders(idx);
    const at = (q) => { let c = 0; for (const [g, n] of ws) { c += n; if (c >= q * total) return g; } return ws[ws.length - 1][0]; };
    r.gsm = [at(0.01), at(0.99)];
    // the tightness and the gauges its orders ran: a design inside both is a setting this cloth is knitted at
    const ts = idx.filter((i) => obs[i].o.tf > 0).map((i) => [obs[i].o.tf, obs[i].n]).sort((a, b) => a[0] - b[0]), tn = ts.reduce((s, x) => s + x[1], 0);
    const atT = (q) => { let c = 0; for (const [v, n] of ts) { c += n; if (c >= q * tn) return v; } return ts[ts.length - 1][0]; };
    if (tn >= 10) r.tfq = [Math.round(atT(0.02) * 100) / 100, Math.round(atT(0.98) * 100) / 100];
    const gn = {}; idx.forEach((i) => { if (obs[i].gauge) gn[obs[i].gauge] = (gn[obs[i].gauge] || 0) + obs[i].n; });
    r.gset = Object.entries(gn).filter(([, n]) => n >= 3).map(([g]) => +g).sort((a, b) => a - b);
    // the gauge most run at each weight band (aggregated; at least three orders)
    const bins = {};
    idx.forEach((i) => { const o = obs[i]; if (!o.gauge) return; const b = Math.round(o.gsm / 20) * 20; bins[b] = bins[b] || {}; bins[b][o.gauge] = (bins[b][o.gauge] || 0) + o.n; });
    // a heavier cloth is never knitted on a finer gauge: bands that say so are pooled and the pooled band's most run gauge taken
    const mode = (g) => +Object.entries(g).sort((x, y) => y[1] - x[1])[0][0];
    const blocks = [];
    Object.entries(bins).sort((x, y) => x[0] - y[0]).forEach(([b, g]) => {
      if (Object.values(g).reduce((q, v) => q + v, 0) < 3) return;
      blocks.push({ at: [+b], g: { ...g } });
      while (blocks.length > 1 && mode(blocks[blocks.length - 1].g) > mode(blocks[blocks.length - 2].g)) {
        const last = blocks.pop(), prev = blocks[blocks.length - 1];
        prev.at.push(...last.at); Object.entries(last.g).forEach(([k, v]) => { prev.g[k] = (prev.g[k] || 0) + v; });
      }
    });
    r.gauges = blocks.flatMap((x) => x.at.map((at) => [at, mode(x.g)]));
    for (const what of Object.keys(U.SETS)) {
      const pairs = idx.filter((i) => obs[i].o[what] > 0).map((i) => [Math.log(obs[i].o[what]) - Object.entries(coef[what]).reduce((s, [k, v]) => s + v * (X[i][k] || 0), 0), Math.sqrt(obs[i].n)]);
      if (pairs.length >= 5) r[what] = wmedian(pairs);
    }
    return r;
  });
  return spec;
}

// ── judging ──────────────────────────────────────────────────────────────
const COUNTS = U.COUNTS;
const idxOf = (ne) => COUNTS.reduce((b, c, i) => (Math.abs(Math.log(c / ne)) < Math.abs(Math.log(COUNTS[b] / ne)) ? i : b), 0);
function blank() { return { n: 0, gsm: [], face: 0, face1: 0, slE: [], sl5: 0, sl2: 0, g: 0, g2: 0, gN: 0 }; }
function judgeDesign(t, o, a) {
  const w = o.n;
  t.n += w;
  t.face += a.face === o.faceNe ? w : 0;
  t.face1 += Math.abs(idxOf(a.face) - idxOf(o.faceNe)) <= 1 ? w : 0;
  const errs = o.sl.map((v, i) => Math.abs(a.sl[i] / v - 1));
  for (let k = 0; k < w; k++) t.slE.push(errs[o.d.feeds.findIndex((f) => f.role !== 'loop' && f.k > 0)] || errs[0]);
  t.sl5 += errs.every((e) => e <= 0.05) ? w : 0;
  t.sl2 += errs.every((e) => e <= 0.02) ? w : 0;
  if (o.gauge) { t.gN += w; t.g += a.g === o.gauge ? w : 0; t.g2 += Math.abs(a.g - o.gauge) <= 2 ? w : 0; }
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const summary = (t) => ({ orders: t.n, gsm_err_med: t.gsm.length ? Math.round(med(t.gsm) * 1000) / 10 : null, face: pct(t.face, t.n), face_1step: pct(t.face1, t.n), sl_err_med: t.slE.length ? Math.round(med(t.slE) * 1000) / 10 : null, sl5: pct(t.sl5, t.n), sl2: pct(t.sl2, t.n), gauge: pct(t.g, t.gN), gauge_2: pct(t.g2, t.gN) });
function judgeModel(spec, obs, t, clothName) {
  const M = new U.Model(spec);
  for (const o of obs) {
    const g = M.weigh(o.d, o.m, o.yarnTex, o.sl, clothName);
    for (let k = 0; k < o.n; k++) t.gsm.push(Math.abs(g / o.gsm - 1));
    const r = M.design(o.d, o.m, o.gsm, { cloth: clothName });
    judgeDesign(t, o, { face: r.face_ne, sl: r.sl_per_feed, g: r.gauge });
  }
}
function evaluate(all, H, verbose) {
  const cloths = [...new Set(all.map((o) => o.cloth))].filter((c) => all.filter((o) => o.cloth === c).reduce((s, o) => s + o.n, 0) >= 20);
  const loco = blank(), by = {};
  for (const c of cloths) {
    const spec = fit(all.filter((o) => o.cloth !== c), H);
    by[c] = blank();
    judgeModel(spec, all.filter((o) => o.cloth === c), by[c], null);
    judgeModel(spec, all.filter((o) => o.cloth === c), loco, null);
  }
  // a new weight or composition of a known cloth: every order of that composition and weight left out
  const known = blank(), knownBy = {};
  const folds = 5;
  const keyOf = (o) => `${o.cloth}|${o.gsm}|${Math.round((o.m.mix.polyester || 0) / 5)}`;
  const keys = [...new Set(all.map(keyOf))];
  for (let f = 0; f < folds; f++) {
    const out = new Set(keys.filter((_, i) => i % folds === f));
    const spec = fit(all.filter((o) => !out.has(keyOf(o))), H);
    const test = all.filter((o) => out.has(keyOf(o)));
    for (const o of test) { judgeModel(spec, [o], known, o.cloth); judgeModel(spec, [o], (knownBy[o.cloth] = knownBy[o.cloth] || blank()), o.cloth); }
  }
  return { loco: summary(loco), known: summary(known), knownBy: Object.fromEntries(Object.entries(knownBy).map(([k, v]) => [k, summary(v)])), by: verbose ? Object.fromEntries(Object.entries(by).map(([k, v]) => [k, summary(v)])) : undefined };
}

// the Studio's own engines (loop model and work orders off) asked the same orders
function judgeStudio(all) {
  const by = {}, cache = new Map();
  for (const o of all) {
    const id = DIAGRAM[o.cloth], tp = T.find((x) => x.id === id);
    const mix = Object.entries(o.m.mix).filter(([, v]) => v >= 2.5).map(([k, v]) => [Math.round(v / 5) * 5 || 5, k]);
    if (mix.length) mix[0][0] += 100 - mix.reduce((s, x) => s + x[0], 0);
    if (o.m.elastane && mix.length) mix[0][0] -= 5;
    const comp = mix.map(([v, k]) => `${v}% ${k}`).concat(o.m.elastane ? ['5% elastane'] : []).join(' ');
    const key = [id, comp, o.gsm, o.m.brushed].join('|');
    if (!cache.has(key)) {
      const C = tp.grid.C, D = tp.grid.D || null, w = Math.max(C[0].length, D ? D[0].length : 0);
      const fit = (g) => g.map((x) => Array.from({ length: w }, (_, j) => x[j % x.length]).join(''));
      cache.set(key, S.analyse({ bed: D ? 'double' : 'single', gating: tp.gating === 'interlock' ? 'interlock' : 'rib', grid: { C: fit(C), D: D ? fit(D) : null }, feeds: tp.roles.map((x) => ({ role: x, plate: !!tp.plated })),
        yarn: { fibre: 'cotton', type: 'auto', ply: o.cloth === 'heavy_jersey' ? 1 : tp.ends || 1 }, yarns: {}, finish: { brush: o.m.brushed ? 'back' : 'none' }, target: { gsm: o.gsm, composition: comp }, machine: {}, use_recipe: false, use_model: false }));
    }
    const r = cache.get(key);
    if (!r || r.success === false) continue;
    const feeds = r.yarn.feeds || [];
    const sl = o.d.feeds.map((f, i) => { const x = feeds.find((y) => y.feed === i + 1) || feeds[i % feeds.length]; const v = x ? x.sl_mm : 0; return o.d.interlock ? v / 2 : v; });
    judgeDesign((by[o.cloth] = by[o.cloth] || blank()), o, { face: parseFloat(String(r.yarn.ground.count).replace(/^\d+\//, '')), sl, g: r.machine.gauge });
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, summary(v)]));
}
// the cloths the engines keep: the model must be as close on stitch length (within a fifth) and at least as often right on count (one
// step), stitch length (5 %) and gauge taken together
function engineBetter(model, engine) {
  const together = (s) => ((s.face_1step || 0) + (s.sl5 || 0) + (s.gauge || 0)) / 3;
  return Object.keys(model).filter((c) => engine[c] && !(model[c].sl_err_med <= engine[c].sl_err_med * 1.2 && together(model[c]) >= together(engine[c]))).sort();
}

function load() {
  const data = require('../data/rnd-recipes.json');
  return data.records.map(observe).filter(Boolean);
}

if (require.main === module) {
  const obs = load();
  const H = { lambda: 1, balance: 0.5, shrink: 20, bandwidth: 3, prior: 2, gaugeBlend: 0.5, gaugeHold: 0.3 };
  console.log('observations', obs.length, 'orders', obs.reduce((s, o) => s + o.n, 0));
  const res = evaluate(obs, H, true);
  console.log('never-knitted construction', JSON.stringify(res.loco));
  console.log('new weight/composition of a known cloth', JSON.stringify(res.known));
  Object.entries(res.by).forEach(([k, v]) => console.log('  ', k.padEnd(16), JSON.stringify(v)));
  if (!process.argv.includes('--dry')) {
    const spec = fit(obs, H);
    spec.built = new Date().toISOString().slice(0, 10);
    const engine = judgeStudio(obs);
    spec.engine_better = engineBetter(res.knownBy, engine);
    console.log('engines keep:', spec.engine_better.join(', '));
    // shares and typical differences only: how many orders were run is the mill's business
    const hide = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'orders' ? undefined : v)));
    spec.judged = hide({ never_knitted_construction: res.loco, new_weight_or_composition: res.known, by_construction: res.by, known_by_construction: res.knownBy, engines_by_construction: engine });
    fs.writeFileSync(OUT, JSON.stringify(spec, null, 1));
    console.log('written', OUT);
  }
}

module.exports = { observe, fit, evaluate, load, judgeModel, blank, summary, judgeDesign, judgeStudio, engineBetter, DIAGRAM };
