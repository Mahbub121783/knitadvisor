/**
 * KnitAdvisor — the recipe book: what the mill knits
 * ====================================================
 *
 * Given a cloth, its composition and a finished weight, find what the mill's own R&D
 * work orders knit for it: the count of every yarn (face, binder, loop), the stitch
 * length of each, the gauge, the diameter and the elastane denier.
 *
 *   known     the same cloth, composition and weight has been knitted: the answer is
 *             what most of those orders ran (the mill's standard)
 *   near      the weights around it have been: the answer is their standard carried
 *             to this weight
 *   (nothing) no order close enough: null, and the engines' own laws answer
 *
 * The data is backend/data/rnd-recipes.json (built by scripts/build-rnd-recipes.js).
 * Without that file the book is empty and every engine behaves as before.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'rnd-recipes.json');
const texOf = (ne, ply = 1) => (590.5 / ne) * ply;
const FLEECE = /^fleece/;
const hasLoop = (cloth) => FLEECE.test(cloth) || cloth === 'terry_2t';

// tuned on the work orders themselves, leaving the specification out (tools/recipe-validate.js)
const P = {
  alpha: 0.45,       // an order run many times counts for more, but not in proportion
  h: 12,             // GSM: how fast a neighbouring weight stops counting
  beta: 0,           // a neighbour's stitch length is kept as run (the mill changes the count between weights, hardly the loop)
  compSoft: 3,       // composition points over the first 4 that fade a record's say
  yd: 0.3, stripe: 0.3, slub: 0.05, style: 0.1,
  colour: 0.9,       // a different colour class (white / melange / yarn dyed / other)
  reach: 40,         // GSM: farther than this, a weight says nothing
  compReach: 14,     // composition points: farther than this, a different cloth
  tight: 3,          // composition points: orders this close to the composition asked are the known standard
  interp: 0.015,     // between weights: the width (in ln tex) around the interpolated face count
  knownAlpha: 1,     // at a knitted weight, how much an order's repeats count
  exactKind: 3,      // at a knitted weight: 1 same solid/stripe/slub orders first, 2 then the same spinning style, 3 then the same colour
  gaugeWide: 1,      // a weight never knitted takes its gauge from all the orders around it
};

/** the yarns of a record by their place in the knit */
function positions(r) {
  const spun = r.yarns || [];
  const fil = r.fil ? { fil: true, d: r.fil.d, f: r.fil.f, mat: r.fil.mat, tex: r.fil.d / 9, mix: { [r.fil.mat === 'nylon' ? 'nylon' : 'polyester']: 100 } } : null;
  const y = (x) => (x ? { ...x, tex: texOf(x.ne, x.ply) } : null);
  if (hasLoop(r.cloth)) {
    const face = y(spun[0]);
    if (r.cloth === 'terry_2t') return { face, loop: y(spun[1]) || fil || face };
    const loop = spun.length >= 2 ? y(spun[spun.length - 1]) : fil ? null : face;
    const binder = fil || (spun.length >= 3 ? y(spun[1]) : face);
    return { face, binder, loop };
  }
  return { face: y(spun[0]) || fil, second: y(spun[1]) || (spun.length ? fil : null) };
}

const DEF_SL = { face: 4.4, binder: 3.1, loop: 1.75 };
/** the fibre shares of a record's cloth (% by mass), from each yarn's weight per needle */
function compositionOf(r) {
  const pos = positions(r);
  const parts = [];
  const names = ['face', 'binder', 'loop', 'second'].filter((k) => pos[k]);
  names.forEach((k, i) => {
    const sl = hasLoop(r.cloth) ? (r.sl.length === names.length ? r.sl[i] : r.cloth === 'terry_2t' ? (k === 'face' ? 2.9 : 1.3) : DEF_SL[k]) : 1;
    parts.push({ m: sl * (pos[k].tex || 20), mix: pos[k].mix || { cotton: 100 } });
  });
  let total = parts.reduce((t, p) => t + p.m, 0);
  const mix = {};
  parts.forEach((p) => { const s = Object.values(p.mix).reduce((t, v) => t + v, 0) || 100; Object.entries(p.mix).forEach(([f, v]) => { mix[f] = (mix[f] || 0) + (p.m * v) / s; }); });
  if (r.el) {
    // bare elastane plated at about 3 times draft, on every feeder or every other one
    const base = hasLoop(r.cloth) ? total : (pos.face ? pos.face.tex : 20) * (parts.length || 1);
    const e = ((r.el / 9) / 3) * (r.half ? 0.5 : 1);
    const share = e / (base / (parts.length || 1) + e);
    Object.keys(mix).forEach((f) => { mix[f] *= 1 - share; });
    mix.elastane = share * total;
  }
  total = Object.values(mix).reduce((t, v) => t + v, 0) || 1;
  return Object.fromEntries(Object.entries(mix).map(([f, v]) => [f, Math.round((v / total) * 1000) / 10]));
}

/** composition distance in points, elastane apart */
function compDistance(a, b) {
  const strip = (m) => { const o = { ...m }; delete o.elastane; const s = Object.values(o).reduce((t, v) => t + v, 0) || 100; Object.keys(o).forEach((k) => { o[k] = (o[k] * 100) / s; }); return o; };
  const x = strip(a), y = strip(b);
  let d = 0;
  new Set([...Object.keys(x), ...Object.keys(y)]).forEach((k) => { d += Math.abs((x[k] || 0) - (y[k] || 0)); });
  return d / 2;
}

const tupleKey = (r) => {
  const p = positions(r), one = (x) => (!x ? '-' : x.fil ? `${x.d}D` : `${x.ne}/${x.ply}`);
  return hasLoop(r.cloth) ? `${one(p.face)}|${one(p.binder)}|${one(p.loop)}` : `${one(p.face)}`;
};

function wmode(rows, keyf) {
  const t = new Map();
  rows.forEach((x) => { const k = keyf(x.r); if (k != null) t.set(k, (t.get(k) || 0) + x.w); });
  let best = null, bw = 0, tot = 0;
  t.forEach((w, k) => { tot += w; if (w > bw) { bw = w; best = k; } });
  return { key: best, share: tot ? bw / tot : 0 };
}
function wmedian(pairs) {
  const a = pairs.slice().sort((x, y) => x[0] - y[0]), tot = a.reduce((t, p) => t + p[1], 0);
  let acc = 0;
  for (const [v, w] of a) { acc += w; if (acc >= tot / 2 - 1e-12) return v; }
  return a.length ? a[a.length - 1][0] : null;
}

function prepare(records) {
  const by = new Map();
  records.forEach((r) => {
    const x = { ...r, comp: compositionOf(r) };
    if (!by.has(r.cloth)) by.set(r.cloth, []);
    by.get(r.cloth).push(x);
  });
  return by;
}

class Book {
  constructor(records, params) { this.byCloth = prepare(records || []); this.P = { ...P, ...(params || {}) }; this.size = (records || []).length; }

  clothes() { return [...this.byCloth.keys()]; }

  /**
   * query: { cloth, el (bool), half (bool), gsm, mix: { cotton: 60, polyester: 40 }, style, yd, stripe, slub }
   * opts.exclude(record) — leave records out (validation)
   */
  lookup(q, opts = {}) {
    const K = this.P, all = this.byCloth.get(q.cloth);
    const gsm = +q.gsm;
    if (!all || !(gsm > 0)) return null;
    const el = !!q.el;
    let rows = [];
    for (const r of all) {
      if (!!r.el !== el && !(el && r.el_cloth && !r.el)) continue;
      if (opts.exclude && opts.exclude(r)) continue;
      const d = Math.abs(r.gsm - gsm);
      if (d > K.reach) continue;
      const cd = q.mix ? compDistance(q.mix, r.comp) : 0;
      if (cd > K.compReach) continue;
      let w = Math.pow(r.n, K.alpha) * Math.exp(-0.5 * (d / K.h) ** 2) * (cd <= 4 ? 1 : Math.exp(-(cd - 4) / K.compSoft));
      if (q.style && r.yarns[0] && r.yarns[0].style !== q.style) w *= K.style;
      if (!!r.yd !== !!q.yd) w *= K.yd;
      if (!!r.stripe !== !!q.stripe) w *= K.stripe;
      if (!!r.slub !== !!q.slub) w *= K.slub;
      if (el && !!r.half !== !!q.half) w *= 0.1;
      if (q.colour && r.colour !== q.colour) w *= K.colour;
      if (w > 1e-6) rows.push({ r, w, d, cd });
    }
    if (!rows.length) return null;
    // the weight asked for has been knitted in this composition: those orders alone are the standard
    let exact = rows.filter((x) => x.d === 0 && x.cd <= K.tight);
    if (!exact.length) exact = rows.filter((x) => x.d === 0 && x.cd <= 6);
    const known = exact.length > 0;
    // of those, the orders of the same kind first: solid with solid, stripe with stripe, melange with melange, the same colour class
    if (known && K.exactKind) {
      const kinds = [(x) => !!x.r.yd === !!q.yd && !!x.r.stripe === !!q.stripe && !!x.r.slub === !!q.slub, (x) => !q.style || (x.r.yarns[0] || {}).style === q.style, (x) => !q.colour || x.r.colour === q.colour];
      for (let i = 0; i < K.exactKind; i++) { const f = exact.filter(kinds[i]); if (f.length) exact = f; }
    }
    // at a weight that has been knitted, the standard is what most ORDERS ran
    const pool = known ? exact.map((x) => ({ ...x, w: x.w * Math.pow(x.r.n, K.knownAlpha - K.alpha) })) : rows;
    let tuple = wmode(pool, tupleKey);
    if (!known && K.interp) {
      // between knitted weights the count moves smoothly: the face tex wanted at this weight (a weighted line through the neighbours), then the
      // most-run set of yarns whose face is nearest it
      const faceTex = (r) => { const f = positions(r).face; return f && f.tex ? f.tex : null; };
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      pool.forEach((x) => { const t = faceTex(x.r); if (!t) return; const dx = x.r.gsm - gsm, ly = Math.log(t); sw += x.w; sx += x.w * dx; sy += x.w * ly; sxx += x.w * dx * dx; sxy += x.w * dx * ly; });
      if (sw > 0) {
        const det = sw * sxx - sx * sx, want = det > sw * sw * 4 ? (sxx * sy - sx * sxy) / det : sy / sw;
        const tot = new Map();
        pool.forEach((x) => { const t = faceTex(x.r); if (!t) return; const k = tupleKey(x.r); const w = x.w * Math.exp(-Math.abs(Math.log(t) - want) / K.interp); tot.set(k, (tot.get(k) || 0) + w); });
        let best = null, bw = 0, all = 0; tot.forEach((w, k) => { all += w; if (w > bw) { bw = w; best = k; } });
        if (best) tuple = { key: best, share: all ? bw / all : 0 };
      }
    }
    const same = pool.filter((x) => tupleKey(x.r) === tuple.key);
    const sample = same.reduce((b, x) => (x.w > b.w ? x : b), same[0]).r;
    const withSl = (set) => set.filter((x) => x.r.sl.length);
    let slRows = withSl(same);
    if (!slRows.length) slRows = withSl(rows.filter((x) => tupleKey(x.r) === tuple.key));
    // no order of these yarns carries a stitch length: the same face count, moved to this weight
    const faceKey = (r) => { const f = positions(r).face; return f && !f.fil ? `${f.ne}/${f.ply}` : '-'; };
    if (!slRows.length) slRows = withSl(rows.filter((x) => faceKey(x.r) === faceKey(sample)));
    let sl = [];
    if (slRows.length) {
      const len = +wmode(slRows, (r) => r.sl.length).key;
      const set = slRows.filter((x) => x.r.sl.length === len);
      for (let i = 0; i < len; i++) sl.push(Math.round(wmedian(set.map((x) => [x.r.sl[i] * Math.pow(x.r.gsm / gsm, K.beta), x.w])) * 100) / 100);
    }
    const pick = (key, sets) => { for (const s of sets) { const have = s.filter((x) => x.r[key]); if (have.length) return +wmode(have, (r) => r[key]).key; } return null; };
    const near = rows.filter((x) => tupleKey(x.r) === tuple.key);
    // a weight never knitted takes its gauge from all the orders around it, not only those of the chosen yarns
    const gauge = pick('g', K.gaugeWide && !known ? [rows] : [same, near, rows]);
    const dia = pick('dia', [same.filter((x) => x.r.g === gauge), near, rows]);
    const denier = el ? pick('el', [same, near, rows]) : null;
    const filRow = positions(sample);
    const orders = pool.reduce((t, x) => t + x.r.n, 0);
    return {
      cloth: q.cloth, gsm, known,
      yarns: filRow,
      fil: sample.fil || null,
      sl, gauge, dia, elastane_denier: denier, half: !!sample.half,
      orders: same.reduce((t, x) => t + x.r.n, 0), orders_seen: orders,
      agreement_pct: Math.round(tuple.share * 100),
      gsm_used: [...new Set(pool.map((x) => x.r.gsm))].sort((a, b) => a - b).slice(0, 12),
      composition: sample.comp,
      alternatives: [...new Set(pool.map((x) => tupleKey(x.r)))].filter((k) => k !== tuple.key).slice(0, 4),
    };
  }
}

let shared = null;
/** the book built from the data file; empty when the file is absent */
function book() {
  if (!shared) {
    let recs = [];
    // KA_NO_RECIPES: the test suite measures the engines' own laws, the same with or without a mill's file on the machine
    try { if (!process.env.KA_NO_RECIPES && fs.existsSync(FILE)) recs = JSON.parse(fs.readFileSync(FILE, 'utf8')).records || []; } catch (e) { console.error('[recipe-book] could not read the recipes:', e.message); }
    shared = new Book(recs);
  }
  return shared;
}

/** replace the shared book (tests, or a freshly imported file) */
function use(b) { shared = b; }

module.exports = { Book, book, use, compositionOf, compDistance, positions, tupleKey, PARAMS: P };
