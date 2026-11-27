/**
 * KnitAdvisor — the universal loop model
 * ========================================
 *
 * One set of laws for ANY weft-knitted construction, read from its needle diagram, so a fabric nobody has knitted
 * before is designed from how it is built, not looked up by its name.
 *
 *   mass       a feed lays SL mm of yarn on every needle of the beds it uses (the length the mill sets, course length ÷
 *              needles), so the yarn per needle slot of one repeat is  Y = Σ SL·tex·n          (law)
 *   cell       a repeat covers  A = α · l² · L · W  per slot, where l is the knitted loop (SL spread over the loops it
 *              forms), L the loops one wale is high per repeat and W the wales standing in a slot  (law + constant α)
 *   weight     GSM = Y ÷ A                                                                     (law)
 *   tightness  the mill finishes a loop at a tightness  TF = 10·√tex ÷ l                          (practice, TF)
 *
 * α, TF, the stitch-length ratios of a binder and a laid-in yarn, and the needle pitch a yarn wants are each a log-linear
 * function of what the cloth IS: its tucks and misses, its beds and gating, needles taken out, elastane, fibres,
 * spinning, brushing, weight. Designing runs the laws backwards: TF and α give the count that carries the weight, the
 * count is taken to a commercial one, and the stitch length is solved exactly for the GSM.
 *
 * Constants: data/universal-model.json (private: not in the repository; fitted by tools/universal-fit.js from knitting records; the
 * constants only, no record).
 */
'use strict';

const fs = require('fs');
const path = require('path');

// distilled from the mill's own orders, so kept with them: outside the repository, copied to the server by hand
const FILE = path.join(__dirname, '..', '..', 'data', 'universal-model.json');
const TUCK = 0.7;                      // a tuck stores about this much of a knit loop's yarn (Part 5's rule)
const COUNTS = [6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 50, 60, 70, 80];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/**
 * What the needle diagram says. grid: { C: [rows of K/T/M/-], D? }, roles per feed, gating 'single'|'rib'|'interlock'.
 */
function diagram({ C, D, roles, gating }) {
  const beds = [C, D].filter(Boolean).map((g) => g.map((r) => (Array.isArray(r) ? r : String(r).split(''))));
  const F = beds[0].length, W = beds[0][0].length;
  const active = beds.map((g) => Array.from({ length: W }, (_, j) => g.some((row) => row[j] !== '-')));
  const needlesOf = active.map((a) => a.filter(Boolean).length);
  const nAll = needlesOf.reduce((t, v) => t + v, 0);
  const rl = Array.from({ length: F }, (_, i) => (roles && roles[i]) || 'ground');
  const inlayFeed = (i) => rl[i] === 'loop';
  let K = 0, T = 0, Ms = 0, Md = 0, bothBeds = 0, knitFeeds = 0, held = 0;
  const feeds = [];
  for (let i = 0; i < F; i++) {
    let k = 0, t = 0;
    const used = [];
    beds.forEach((g, b) => {
      const row = g[i];
      let any = false;
      row.forEach((x) => { if (x === 'K' || x === 'T') any = true; if (x === 'K') k++; if (x === 'T') t++; });
      if (any) used.push(b);
    });
    // the mill's stitch length is course length ÷ all the needles of the machine's beds (also on a feed that knits one bed)
    const n = nAll;
    beds.forEach((g, b) => g[i].forEach((x, j) => {
      if (x !== 'M' || !active[b][j]) return;
      if (beds.length > 1) { if (!beds[1 - b][i].includes('K')) Md++; } else if (!inlayFeed(i)) Ms++;
    }));
    if (!inlayFeed(i)) { K += k; T += t; if (k > 0) { knitFeeds++; if (used.length > 1) bothBeds++; } }
    feeds.push({ role: rl[i], k, t, n, sig: beds.map((g) => g[i].join('')).join('/') });
  }
  // held loops: the longest run of tucks one needle keeps
  beds.forEach((g) => { for (let j = 0; j < W; j++) { let run = 0; for (let i = 0; i < F * 2; i++) { const x = g[i % F][j]; if (inlayFeed(i % F)) continue; if (x === 'T') { run++; held = Math.max(held, Math.min(run, F)); } else if (x === 'K') run = 0; } } });
  // loops per wale per repeat (the height), over the knitting yarns
  const perWale = [];
  beds.forEach((g, b) => { for (let j = 0; j < W; j++) { if (!active[b][j]) continue; let c = 0; for (let i = 0; i < F; i++) if (!inlayFeed(i) && rl[i] !== 'binder' && g[i][j] === 'K') c++; if (c) perWale.push(c); } });
  const L = perWale.length ? perWale.reduce((s, v) => s + v, 0) / perWale.length : 1;
  // the knitted loop per unit of SL: the needles a feed passes against the loops it forms
  const face = feeds.filter((f) => f.role !== 'loop' && f.role !== 'binder' && f.k + f.t > 0);
  const kappa = face.length ? face.reduce((s, f) => s + f.n / (f.k + TUCK * f.t), 0) / face.length : 1;
  const double = beds.length > 1;
  return {
    // interlock gating stands the two beds' wales back to back: a slot is one wale wide, the dial wale behind it
    F, W, feeds, nAll, L, wales: (nAll / W) / (double && gating === 'interlock' ? 2 : 1), kappa,
    faceFeeds: feeds.map((f, i) => i).filter((i) => feeds[i].role !== 'loop' && feeds[i].role !== 'binder' && feeds[i].k + feeds[i].t > 0),
    double: double ? 1 : 0, interlock: double && gating === 'interlock' ? 1 : 0,
    tuck: K ? T / K : 0, miss: K ? Ms / K : 0, missD: K ? Md / K : 0, held: Math.max(0, held - 1),
    out: 1 - nAll / (W * beds.length), both: knitFeeds ? bothBeds / knitFeeds : 0,
    inlay: rl.includes('loop') ? 1 : 0, binder: rl.includes('binder') ? 1 : 0,
  };
}

/** which of the mill's stitch lengths each feed runs: by role where the yarns have roles, else by the kind of feed in order */
function slForFeeds(d, sl) {
  if (d.inlay) {
    const hasB = d.binder && sl.length >= 3;
    return d.feeds.map((f) => (f.role === 'loop' ? sl[sl.length - 1] : f.role === 'binder' ? (hasB ? sl[1] : sl[0]) : sl[0]));
  }
  const kinds = [];
  d.feeds.forEach((f) => { const key = `${f.k > 0 ? 'k' : ''}${f.t > 0 ? 't' : ''}${f.n}`; if (!kinds.includes(key)) kinds.push(key); });
  return d.feeds.map((f) => { const key = `${f.k > 0 ? 'k' : ''}${f.t > 0 ? 't' : ''}${f.n}`; return sl[Math.min(sl.length - 1, kinds.indexOf(key))]; });
}

/** the features the constants are a function of */
function features(d, m, gsm) {
  return {
    one: 1, double: d.double, interlock: d.interlock, tuck: d.tuck, tuck2: d.tuck * d.tuck, miss: d.miss, missD: d.missD, held: d.held,
    out: d.out, both: d.both * d.double, inlay: d.inlay, binder: d.binder, tuckDouble: d.tuck * d.double,
    el: m.elastane ? 1 : 0, elDouble: m.elastane ? d.double : 0, half: m.half ? 1 : 0,
    poly: (m.mix.polyester || 0) / 100, regen: ((m.mix.viscose || 0) + (m.mix.modal || 0) + (m.mix.tencel || 0) + (m.mix.bamboo || 0)) / 100,
    melange: m.style === 'melange' ? 1 : 0, carded: m.style === 'carded' || m.style === 'rotor' ? 1 : 0,
    brushed: m.brushed ? 1 : 0, filBinder: m.binderFilament ? 1 : 0, yd: m.yd ? 1 : 0, plated: m.plated ? 1 : 0,
    lg: Math.log(gsm / 220), lg2: Math.log(gsm / 220) ** 2, lgD: Math.log(gsm / 220) * d.double, lgI: Math.log(gsm / 220) * d.inlay,
    // an elastane cloth gains weight by drawing in: its counts and gauge follow the weight differently
    lgEl: m.elastane ? Math.log(gsm / 220) : 0,
  };
}

const SETS = {
  alpha: ['one', 'double', 'interlock', 'tuck', 'tuck2', 'miss', 'missD', 'held', 'out', 'both', 'inlay', 'binder', 'tuckDouble', 'el', 'elDouble', 'half', 'poly', 'regen', 'melange', 'carded', 'brushed', 'yd', 'plated', 'lg', 'lg2', 'lgI', 'lgEl'],
  tf: ['one', 'double', 'interlock', 'tuck', 'tuck2', 'miss', 'missD', 'held', 'out', 'both', 'inlay', 'binder', 'tuckDouble', 'el', 'elDouble', 'half', 'poly', 'regen', 'melange', 'carded', 'brushed', 'yd', 'plated', 'lg', 'lg2', 'lgD', 'lgI', 'lgEl'],
  gauge: ['one', 'double', 'interlock', 'tuck', 'miss', 'out', 'inlay', 'binder', 'brushed', 'el', 'lg', 'lgEl'],
  rb: ['one', 'filBinder', 'brushed', 'lg'],
  rl: ['one', 'brushed', 'filBinder', 'lg'],
  tl: ['one', 'brushed', 'filBinder', 'lg'],
};

/** the knitted loop of a design: each knitting feed's stitch length spread over the loops it forms */
function loopLength(d, sl) {
  const F = d.faceFeeds.length ? d.faceFeeds : [0];
  return F.reduce((s, i) => s + (sl[i] * d.feeds[i].n) / (d.feeds[i].k + TUCK * d.feeds[i].t || 1), 0) / F.length;
}

/** the gauges a construction's machine is built in (the usual circular machines) */
const gaugesFor = (d) => (d.inlay ? (d.binder ? [18, 20, 24] : [20, 24, 28]) : d.interlock ? [18, 24, 28] : d.double ? [14, 18, 22] : [14, 20, 24, 28]);

/** the gauge a construction of this weight is usually knitted on */
const usualGauge = (d, gsm) => (d.inlay ? (d.binder ? 20 : 24) : d.interlock ? 24 : d.double ? 18 : d.tuck > 0 ? (gsm > 300 ? 20 : 24) : gsm > 275 ? 14 : gsm > 215 ? 20 : 24);

const dot = (coef, x) => Object.entries(coef).reduce((s, [k, v]) => s + v * (x[k] || 0), 0);

/** the kernel the cloths are compared with, for a construction's own correction to carry to its neighbours */
const KERNEL = ['double', 'interlock', 'tuck', 'miss', 'missD', 'out', 'inlay', 'binder', 'held', 'both'];
const kdist = (a, b) => KERNEL.reduce((s, k) => s + (a[k] - b[k]) ** 2 * (k === 'double' || k === 'inlay' || k === 'interlock' ? 4 : 2), 0);

class Model {
  constructor(spec) { this.spec = spec; }
  get ok() { return !!(this.spec && this.spec.coef); }
  /** a cloth's own records, with or without elastane as asked; the other kind where it was only knitted that way */
  own(cloth, el, what) {
    const R = (this.spec.residuals || []).filter((r) => r.cloth === cloth && (!what || r[what] != null));
    return R.find((r) => !!r.el === !!el) || R[0] || null;
  }
  /** a cloth's own correction (shrunk), or its nearest neighbours' where it is new */
  correction(what, cloth, d, el) {
    const R = this.spec.residuals || [];
    const own = cloth ? this.own(cloth, el, what) : null;
    if (own && own[what] != null) return own[what] * own.wt;
    if (!d) return 0;
    let sw = 0, s = 0;
    R.forEach((r) => { if (r[what] == null) return; const w = Math.exp(-kdist(d, r.d) / this.spec.bandwidth) * r.wt; sw += w; s += w * r[what]; });
    return sw > 0 ? (s / (sw + this.spec.prior)) : 0;
  }
  value(what, x, cloth, d) { return Math.exp(dot(this.spec.coef[what], x) + this.correction(what, cloth, d, x.el)); }

  /** the gauge this construction is usually knitted on at this weight: its own records' where known, else the machine class's */
  machineGauge(d, gsm, cloth, el) {
    const own = cloth ? this.own(cloth, el) : null;
    if (own && own.gauges && own.gauges.length) {
      const best = own.gauges.reduce((b, g) => (Math.abs(g[0] - gsm) < Math.abs(b[0] - gsm) ? g : b), own.gauges[0]);
      if (Math.abs(best[0] - gsm) <= 30) return best[1];
    }
    return usualGauge(d, gsm);
  }

  /** the GSM of a design knitted at its own yarns and stitch lengths: yarns per feed [{ tex }], sl per feed [mm] */
  weigh(d, m, yarnTex, sl, cloth) {
    const lk = loopLength(d, sl);
    const Y = d.feeds.reduce((s, f, i) => s + sl[i] * yarnTex[i] * (f.n / d.W), 0);
    let g = 200;
    for (let k = 0; k < 4; k++) g = Y / (this.value('alpha', features(d, m, g), cloth, d) * lk * lk * d.L * d.wales);
    return g;
  }

  /**
   * Design a cloth never knitted: d = diagram(...), m = { mix, elastane, half, style, brushed, binderFilament, yd, plated, ends },
   * gsm, opts: { cloth (its name where known), counts (allowed Ne), gauges (allowed), faceNe, gauge }
   */
  design(d, m, gsm, opts = {}) {
    if (!this.ok || !(gsm > 0)) return null;
    const cloth = opts.cloth || null, x = features(d, m, gsm);
    const alpha = this.value('alpha', x, cloth, d), tf = this.value('tf', x, cloth, d);
    const ends = m.ends > 0 ? m.ends : 1;
    // the filament tied in: the usual 75 denier; a coarser one only where the composition needs it
    const binderDenier = +m.binderDenier > 0 ? +m.binderDenier : 75;
    // yarn and stitch-length ratios against the face
    const rb = d.binder ? clamp(this.value('rb', x, cloth, d), 0.45, 1.2) : 1;
    const rl = d.inlay ? clamp(this.value('rl', x, cloth, d), 0.2, 0.75) : 1;
    const tl = d.inlay ? clamp(this.value('tl', x, cloth, d), 0.8, 8) : 1;
    const parts = (faceTex) => d.feeds.map((f) => {
      if (f.role === 'loop') return { sl: rl, tex: faceTex * tl };
      if (f.role === 'binder') return { sl: rb, tex: m.binderFilament ? binderDenier / 9 : faceTex };
      return { sl: 1, tex: faceTex };
    });
    const faceIdx = Math.max(0, d.feeds.findIndex((f) => f.role !== 'loop' && f.role !== 'binder' && f.k > 0));
    // S(tex): the yarn mass per mm of face stitch length
    const S = (faceTex) => { const p = parts(faceTex); return d.feeds.reduce((s, f, i) => s + p[i].sl * p[i].tex * (f.n / d.W), 0); };
    // the knitted loop per mm of face stitch length
    const kk = loopLength(d, parts(20).map((q) => q.sl));
    const k2 = alpha * kk * kk * d.L * d.wales * gsm;
    // the count whose solved stitch length sits at the mill's tightness
    // TF = 10·√tex ÷ (κ·SL) and SL = S(tex) ÷ k2, with S nearly proportional to tex: solved for tex by repeating
    let faceTex = 20;
    for (let it = 0; it < 12; it++) faceTex = clamp(((10 * k2 * faceTex) / (tf * kk * S(faceTex))) ** 2, 4, 120);
    // the count also belongs to a machine: the yarn the machine's usual gauge at this weight carries, weighed against the tightness's answer
    const blend = this.spec.gaugeBlend || 0;
    if (blend > 0 && !(+opts.gauge > 0)) {
      const g0 = this.machineGauge(d, gsm, cloth, m.elastane), ratio = this.value('gauge', x, cloth, d), texG = ((25.4 / g0 / ratio) * 28) ** 2;
      faceTex = Math.exp((1 - blend) * Math.log(faceTex) + blend * Math.log(clamp(texG, 4, 120)));
    }
    const list = opts.counts || COUNTS;
    const ne = +opts.faceNe > 0 ? +opts.faceNe : list.reduce((b, c) => (Math.abs(Math.log((590.5 / c) * ends / faceTex)) < Math.abs(Math.log((590.5 / b) * ends / faceTex)) ? c : b), list[0]);
    const t = (590.5 / ne) * ends;
    const slFace = S(t) / k2;
    const p = parts(t);
    const sl = d.feeds.map((f, i) => Math.round(p[i].sl * slFace * 100) / 100);
    const loopFeed = d.feeds.findIndex((f) => f.role === 'loop');
    const loopNe = loopFeed >= 0 ? [6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34].reduce((b, c) => (Math.abs(Math.log(590.5 / c / p[loopFeed].tex)) < Math.abs(Math.log(590.5 / b / p[loopFeed].tex)) ? c : b), 16) : null;
    // the gauge: the needle pitch this yarn wants
    const dYarn = Math.sqrt(t) / 28;
    const pitch = this.value('gauge', x, cloth, d) * dYarn;
    const gauges = opts.gauges || gaugesFor(d);
    // the machine the construction usually runs on at this weight, unless the yarn asks for a pitch a long way from it
    const usual = this.machineGauge(d, gsm, cloth, m.elastane);
    const near = gauges.reduce((b, g) => (Math.abs(Math.log(25.4 / g / pitch)) < Math.abs(Math.log(25.4 / b / pitch)) ? g : b), gauges[0]);
    const gauge = +opts.gauge > 0 ? +opts.gauge : Math.abs(Math.log(25.4 / usual / pitch)) < (this.spec.gaugeHold != null ? this.spec.gaugeHold : 0.3) ? usual : near;
    return {
      face_ne: ne, ends, face_tex: t, loop_ne: loopNe, binder: d.binder ? (m.binderFilament ? { denier: binderDenier } : { ne }) : null,
      sl_per_feed: sl, sl_face: sl[faceIdx], sl_binder: d.binder ? sl[d.feeds.findIndex((f) => f.role === 'binder')] : null, sl_loop: loopFeed >= 0 ? sl[loopFeed] : null,
      gauge, tightness: Math.round(tf * 10) / 10, alpha,
    };
  }
}

let shared = null;
function model() {
  if (!shared) {
    let spec = null;
    // without the file (a fresh checkout, CI) or with KA_NO_MODEL the engines answer by themselves
    try { if (!process.env.KA_NO_MODEL && fs.existsSync(FILE)) spec = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.error('[universal-model] could not read the constants:', e.message); }
    shared = new Model(spec);
  }
  return shared;
}
function use(m) { shared = m; }

module.exports = { Model, model, use, diagram, features, slForFeeds, loopLength, SETS, KERNEL, COUNTS, TUCK };
