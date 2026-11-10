/**
 * KnitAdvisor — Fabric studio
 * ===========================
 *
 * The R&D bench for a NEW weft-knitted fabric: the technologist draws the
 * needle programme (K / T / M / "-" per needle, per feed, cylinder and dial),
 * names the yarn on each feed, gives a target GSM (and width), and gets back
 * everything the knitting floor needs — checked, and with every number saying
 * where it comes from:
 *
 *   measured    the factory R&D file (2,201 greige → finish rows): Kw, Ks, the
 *               tightness-factor window, the gauge used at a count, the dia.
 *   calculated  a formula applied to the user's own inputs: course length,
 *               yarn speed, production, needles, track factorisation, helix.
 *   estimated   a measured family constant carried over to a structure that
 *               is not that family's own (a new structure has no records), or
 *               a rule of thumb (hook load, input tension). Labelled as such.
 *
 * How a new structure is weighed. Each family's Ks is fitted on its own
 * fabrics (GSM = Ks × tex ÷ 10ℓ). Written per needle position and feed,
 * GSM = Ks ÷ (10 ℓ² M) × mean(sᵢ ℓᵢ texᵢ), where sᵢ is the yarn a feed lays
 * per needle position (a knit takes a loop, a tuck ~0.7 of one, a miss a
 * float — knit-plan.js) and M is the same mean for the family's own anchor
 * structure. When the drawn structure IS the anchor this is the measured fit
 * exactly; otherwise the yarn the structure lays per position is the
 * correction, and the result is labelled an estimate.
 *
 * Where the reference monograph supplied to the project disagrees with the
 * factory file, the file wins and the difference is stated: its gauge-count
 * rule (Ne ≈ 0.0295 E²) gives 17s at 24 GG where the factory knits 28s; its
 * cotton single-jersey tightness window (14.0–15.2) sits below the factory's
 * finished fabrics (16.7–17.7 interquartile).
 */
'use strict';

const KP = require('./knit-plan');
const KM = require('./knit-machine');
const TE = require('./terry-engine');
const { FABRIC_DERIVATIVES } = require('../catalog/fabric-derivatives');
const { FACTORY_RECORDS } = require('../catalog/factory-dataset');

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const mean = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0);
const quant = (arr, q) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]; };

const LIMITS = { feeds: 48, needles: 48 };
const ROLES = ['ground', 'face', 'binder', 'loop'];
const COUNTS = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 45, 50, 60];

// yarn diameter relative to cotton at the same tex: d ∝ √(tex ÷ yarn density).
// Fibre density (cotton 1.52, polyester 1.38, nylon 1.14) and, for filament,
// the closer packing of continuous fibres. Rule-of-thumb level — it only
// feeds the hook-load and gauge-fit checks.
const FIBRES = {
  cotton:            { label: 'Cotton',               dFactor: 1.00 },
  polyester_spun:    { label: 'Polyester (spun)',     dFactor: 1.05 },
  viscose:           { label: 'Viscose',              dFactor: 1.00 },
  modal:             { label: 'Modal',                dFactor: 1.00 },
  cvc:               { label: 'CVC / PC blend',       dFactor: 1.03 },
  polyester_filament:{ label: 'Polyester filament',   dFactor: 0.90 },
  nylon_filament:    { label: 'Nylon filament',       dFactor: 0.99 },
};

const FAMILY = {
  single_jersey: { label: 'Single jersey family (knit / miss)', machine: 'single', anchor: 'single_jersey' },
  pique:         { label: 'Tuck family (piqué / lacoste)',     machine: 'pique',  anchor: 'lacoste_single' },
  fleece:        { label: 'Fleece family (ground + loop yarn)', machine: 'fleece', anchor: 'fleece_3_thread' },
  rib:           { label: 'Rib family (rib gating)',           machine: 'rib',    anchor: 'rib_1x1' },
  interlock:     { label: 'Interlock family (interlock gating)', machine: 'interlock', anchor: 'interlock' },
};
// the anchor's loop yarn against its ground: a 3-thread fleece is usually a
// 30s face on a 10s–20s loop yarn; 2.5× the ground tex is the middle of that
const ANCHOR_LOOP_TEX_RATIO = 2.5;

// ── measured: the tightness factor the factory actually finishes at ────────
const TF_WINDOW = (() => {
  const by = {};
  for (const r of FACTORY_RECORDS) {
    if (!(r.ne > 0 && r.sl > 0)) continue;
    const k = `${r.fab}|${/lycra/.test(String(r.spin || '')) ? 'L' : 'P'}`;
    (by[k] = by[k] || []).push(Math.sqrt(590.5 / r.ne) / (r.sl / 10));
  }
  return Object.fromEntries(Object.entries(by).map(([k, a]) => [k, {
    p5: r2(quant(a, 0.05)), q1: r2(quant(a, 0.25)), med: r2(quant(a, 0.5)), q3: r2(quant(a, 0.75)), p95: r2(quant(a, 0.95)), n: a.length,
  }]));
})();
function tfWindow(family, lycra, rate = 1) {
  const pick = (fam) => { const a = TF_WINDOW[`${fam}|${lycra ? 'L' : 'P'}`], b = TF_WINDOW[`${fam}|P`]; return a && a.n >= 12 ? a : b; };
  const w = pick(family);
  if (!w) return null;
  const basis = `${w.n} factory records (${family.replace('_', ' ')}${lycra && w === TF_WINDOW[`${family}|L`] ? ', lycra' : ''})`;
  // a double bed whose needles miss feeds is a cloth between rib (rate 1) and
  // interlock (rate ½): its factory window lies between theirs
  if ((family === 'rib' || family === 'interlock') && Math.abs(rate - (family === 'rib' ? 1 : 0.5)) > 0.01) {
    const R = pick('rib'), I = pick('interlock');
    if (R && I) {
      const t = Math.max(0, Math.min(1, (1 - rate) / 0.5));
      const mix = {}; for (const k of ['p5', 'q1', 'med', 'q3', 'p95']) mix[k] = r2(R[k] + t * (I[k] - R[k]));
      return { ...mix, n: R.n + I.n, basis: `rib (${R.n}) and interlock (${I.n}) factory records, ${Math.round(t * 100)}% of the way to interlock at loop rate ${r2(rate)}` };
    }
  }
  return { ...w, basis };
}

// ── catalogue ───────────────────────────────────────────────────────────────
const CATALOGUE = (Array.isArray(FABRIC_DERIVATIVES) ? FABRIC_DERIVATIVES : Object.values(FABRIC_DERIVATIVES))
  .filter((f) => f && f.structure && f.structure.pattern && !['warp_knit', 'purl'].includes(f.category));
const byId = (id) => CATALOGUE.find((f) => f.id === id);

function roleOf(y) {
  const t = String(y || '').toLowerCase();
  if (/loop|fleece|pile/.test(t)) return 'loop';
  if (/binder|tie/.test(t)) return 'binder';
  if (/face/.test(t)) return 'face';
  return 'ground';
}

// On interlock gating needle j of the cylinder faces needle j of the dial, so
// the two cannot both rise at one feed. Several catalogue entries filed under
// interlock (the double piqués, poplin, gabardine, blister) are drawn with
// both rising — a programme that only runs on rib gating, which is also where
// the rib/interlock lecture in the lesson store puts the double piqués. The
// studio opens them on rib gating and says why; the catalogue is left as is.
function clashesOnInterlock(st) {
  if (!st.beds.D) return false;
  const up = (x) => x === 'K' || x === 'T';
  return st.beds.C.some((row, i) => row.some((c, j) => up(c) && up(st.beds.D[i][j])));
}

function templateOf(f) {
  // normalised as the knitting plan reads it: beds padded to one width
  const st = KP.normaliseStructure(f);
  const C = st.beds.C, D = st.beds.D;
  const feeds = st.feeds;
  const cam = Array.isArray(f.structure.cam) ? f.structure.cam : [];
  const ilClash = f.category === 'interlock' && clashesOnInterlock(st);
  // the catalogue draws a pointelle's eyelets as misses; they are loop
  // transfers (E): the needle hands its loop to the next needle and starts
  // a new one, which leaves the hole
  const eyelet = /pointelle/.test(f.id) && !D;
  const Cg = eyelet ? C.map((row) => row.map((x) => (x === 'M' ? 'E' : x))) : C;
  return {
    id: f.id, name: f.name, category: f.category,
    bed: D ? 'double' : 'single', gating: D ? (f.category === 'interlock' && !ilClash ? 'interlock' : 'rib') : 'single',
    note: ilClash ? 'Listed with the interlock family, but cylinder and dial needles rise together at one feed: this programme runs on rib gating.'
      : eyelet ? 'Each eyelet is a loop transfer (E): knitted on a pointelle machine with transfer and electronic needle selection.' : null,
    grid: { C: Cg, D },
    roles: Array.from({ length: feeds }, (_, i) => { const c = cam.find((x) => +x.feed === i + 1); return roleOf(c && c.yarn); }),
    typical_gauge: f.typical_gauge || null,
    gsm_range: f.gsm_range || null,
  };
}

function listTemplates() {
  return CATALOGUE.map(templateOf);
}

// ── input ───────────────────────────────────────────────────────────────────
class StudioError extends Error {}

function readBed(rows, name) {
  if (rows == null) return null;
  if (!Array.isArray(rows) || !rows.length) throw new StudioError(`${name}: draw at least one feed.`);
  const g = rows.map((row) => (Array.isArray(row) ? row : String(row).split('')).map((x) => String(x).trim().toUpperCase()));
  const w = g[0].length;
  if (!w) throw new StudioError(`${name}: draw at least one needle.`);
  if (g.length > LIMITS.feeds) throw new StudioError(`${name}: at most ${LIMITS.feeds} feeds in one repeat.`);
  if (w > LIMITS.needles) throw new StudioError(`${name}: at most ${LIMITS.needles} needles in one repeat.`);
  g.forEach((row, i) => {
    if (row.length !== w) throw new StudioError(`${name}: feed ${i + 1} has ${row.length} needles, feed 1 has ${w}. Every feed must cover the same needles.`);
    row.forEach((x, j) => {
      if (!['K', 'T', 'M', 'E', 'R', '-'].includes(x)) throw new StudioError(`${name}: feed ${i + 1}, needle ${j + 1} is "${x}". Use K, T, M, E, R or -.`);
      if (x === 'E' && name === 'Dial') throw new StudioError(`Dial: feed ${i + 1}, needle ${j + 1}: a transfer (E) is drawn on the cylinder — the loop moves to the next cylinder needle.`);
    });
  });
  return g;
}

function readYarn(y, fallback) {
  const o = y || {};
  let tex = null, label = null;
  if (+o.ne > 0) { tex = 590.5 / +o.ne; label = `${r1(+o.ne)}s Ne`; }
  else if (+o.denier > 0) { tex = +o.denier / 9; label = `${r1(+o.denier)} D`; }
  else if (+o.tex > 0) { tex = +o.tex; label = `${r1(+o.tex)} tex`; }
  if (!tex) return fallback || null;
  if (tex < 2 || tex > 120) throw new StudioError(`Yarn ${label}: outside 5s–300s Ne — check the count.`);
  const fibre = FIBRES[o.fibre] ? o.fibre : (fallback && fallback.fibre) || 'cotton';
  return { tex, ne: 590.5 / tex, label, fibre, fibre_label: FIBRES[fibre].label };
}

// ── structure helpers ──────────────────────────────────────────────────────
const shiftRows = (g, r, c) => g.map((_, i) => { const row = g[(i + r) % g.length]; return row.map((__, j) => row[(j + c) % row.length]); });
const same = (a, b) => (!a && !b) || (a && b && a.length === b.length && a.every((row, i) => row.join('') === b[i].join('')));

function matchCatalogue(st0) {
  const st = { ...st0, beds: { C: st0.beds.C.map((r) => r.map((x) => (x === 'E' || x === 'R' ? 'M' : x))), D: st0.beds.D && st0.beds.D.map((r) => r.map((x) => (x === 'R' ? 'M' : x))) } };
  for (const f of CATALOGUE) {
    const t = KP.normaliseStructure(f);
    if (!t || t.feeds !== st.feeds || t.width !== st.width || !!t.beds.D !== !!st.beds.D) continue;
    for (let r = 0; r < st.feeds; r++) for (let c = 0; c < st.width; c++) {
      if (same(shiftRows(st.beds.C, r, c), t.beds.C) && (!st.beds.D || same(shiftRows(st.beds.D, r, c), t.beds.D))) return f;
    }
  }
  return null;
}

function classify(st, roles, gating) {
  if (st.beds.D) return gating === 'interlock' ? 'interlock' : 'rib';
  if (roles.includes('loop')) return 'fleece';
  if (st.beds.C.some((row) => row.includes('T'))) return 'pique';
  return 'single_jersey';
}

// the anchor's yarn per needle position, in ground-tex units
// (memoised: the setup search asks for it thousands of times)
const anchorCache = new Map();
function anchorMass(family, pitchMm, slMm) {
  const key = `${family}|${pitchMm}|${slMm}`;
  if (anchorCache.has(key)) return anchorCache.get(key);
  let a = anchorCache.get(family);
  if (!a) { const f = byId(FAMILY[family].anchor); a = { f, t: KP.normaliseStructure(f), roles: templateOf(f).roles }; anchorCache.set(family, a); }
  const cons = KP.feedConsumption(a.t, pitchMm, slMm);
  const out = { def: a.f, M: mean(cons.map((c, i) => c.share * (a.roles[i] === 'loop' ? ANCHOR_LOOP_TEX_RATIO : 1))) };
  if (anchorCache.size > 5000) anchorCache.clear();
  anchorCache.set(key, out);
  return out;
}

function maxRun(col, sym) {
  let r = 0, m = 0;
  for (const x of [...col, ...col]) { r = x === sym ? r + 1 : 0; m = Math.max(m, r); }
  return m >= 2 * col.length ? col.length : m;
}

// ── the machine ─────────────────────────────────────────────────────────────
function factoryGauge(family, lycra, ne) {
  const gList = KP.CAL.gauges[`${family}|${lycra ? 'L' : 'P'}`] || KP.CAL.gauges[`${family}|P`] || [];
  let near = [];
  for (const w of [1, 2, 4, 6, 10]) { near = gList.filter((r) => Math.abs(r.ne - ne) <= w); if (near.length >= 8) break; }
  if (near.length < 5) return null;
  const c = {}; near.forEach((r) => { c[r.g] = (c[r.g] || 0) + 1; });
  const [g, n] = Object.entries(c).sort((x, y) => y[1] - x[1])[0];
  return { gauge: +g, share_pct: Math.round(n / near.length * 100), n: near.length };
}

function gaugeFit(family, gauge, tex, fibre) {
  const pitch = 25.4 / gauge;
  const yarnD = (Math.sqrt(tex) / 28) * FIBRES[fibre].dFactor;
  const ratio = pitch / yarnD;
  const B = KP.CAL.band[family] && KP.CAL.band[family].n >= 20 ? KP.CAL.band[family] : KP.CAL.band.single_jersey;
  const fit = ratio < B.lo * 0.92 ? 'too fine' : ratio > B.hi * 1.08 ? 'coarse' : 'good';
  return { pitch_mm: r3(pitch), yarn_d_mm: r3(yarnD), ratio: r2(ratio), band: [r2(B.lo), r2(B.hi)], fit };
}

// ── one complete solution for one ground count ─────────────────────────────
// ── how the structure and the yarn move the family constants ───────────────
// Measured: single jersey (no tuck) against piqué (the lacoste anchor, 2 tucks
// in 8 needle-feeds) gives how much wider and how much denser in courses a
// tuck makes the cloth; the fibre ratios come from the same records. NOT
// measured: how much a miss narrows the cloth (the factory file has no
// float structure) — a direction from float-stitch theory with a modest
// magnitude, flagged wherever it is used.
const TUCK_ANCHOR = 0.25;
const TUCK_CAP = 1.3;       // beyond 1.3 × the anchor's tuck share nothing is measured
const MISS_KW = 0.25;       // estimate, see above
const ratioOf = (table, num, den) => { const a = KP.calFor(table, num, false), b = KP.calFor(table, den, false); return a.n >= 12 && b.n >= 12 ? a.med / b.med : null; };
const TUCK_KW = ratioOf('kw', 'pique', 'single_jersey') || 0.77;
const TUCK_KS = ratioOf('ks', 'pique', 'single_jersey') || 1.1;

const FIBRE_RATIO = (() => {
  const by = { ks: {}, kw: {} };
  for (const r of FACTORY_RECORDS) {
    if (r.fab !== 'single_jersey' || /lycra/.test(String(r.spin || ''))) continue;
    if (r.sl > 0 && r.ne > 0 && r.fgsm > 0) (by.ks[r.comp] = by.ks[r.comp] || []).push(10 * r.fgsm * (r.sl / 10) / (590.5 / r.ne));
    if (r.g > 0 && r.dia > 0 && r.sl > 0 && r.fdia > 0) (by.kw[r.comp] = by.kw[r.comp] || []).push(Math.PI * r.dia * r.g * (r.sl / 10) / (r.fdia * 2.54));
  }
  const med = (a) => quant(a, 0.5);
  const out = {};
  for (const comp of Object.keys(by.ks)) {
    const a = by.ks[comp], b = by.kw[comp] || [];
    if (a.length >= 8 && b.length >= 8 && by.ks.cotton) out[comp] = { ks: med(a) / med(by.ks.cotton), kw: med(b) / med(by.kw.cotton), n: a.length };
  }
  return out;
})();
const FIBRE_COMP = { cotton: 'cotton', cvc: 'cvc', polyester_spun: 'pc', viscose: 'viscose', modal: 'modal' };
function fibreFactor(fibre) {
  const f = FIBRE_RATIO[FIBRE_COMP[fibre]];
  if (fibre === 'cotton') return { ks: 1, kw: 1, basis: 'cotton is the reference' };
  if (f) return { ks: f.ks, kw: f.kw, basis: `${f.n} factory single-jersey records (${FIBRES[fibre].label}) against cotton` };
  return { ks: 1, kw: 1, basis: `no factory records for ${FIBRES[fibre].label} — cotton constants used (estimate)` };
}

function shares(st, feedRows) {
  let pos = 0, tuck = 0, miss = 0;
  for (let i = 0; i < st.feeds; i++) {
    if (feedRows[i].role === 'loop') continue;
    for (const b of ['C', 'D']) {
      if (!st.beds[b]) continue;
      const other = b === 'C' ? st.beds.D : st.beds.C;
      st.beds[b][i].forEach((x, j) => {
        if (x === '-') return;
        pos++;
        if (x === 'T') tuck++;
        // a miss on a double bed is the other bed's loop passing by, not a float
        else if (x === 'M' && !(other && (other[i][j] === 'K' || other[i][j] === 'T'))) miss++;
      });
    }
  }
  return { tau: pos ? tuck / pos : 0, mu: pos ? miss / pos : 0 };
}

// The share of needle-feeds at which a working needle forms a loop (knit or
// tuck), over the ground feeds of both beds. Below 1 the needle misses some
// feeds and its loop is held across them: that bed then makes fewer courses
// than the machine has feeds, and the cloth packs more feeds into each cm.
function loopRate(st, feedRows) {
  let n = 0, k = 0;
  const feeds = Array.from({ length: st.feeds }, (_, i) => i).filter((i) => feedRows[i].role !== 'loop');
  if (!feeds.length) return 1;
  for (const b of ['C', 'D']) {
    const g = st.beds[b]; if (!g) continue;
    for (let j = 0; j < st.width; j++) {
      if (feeds.every((i) => g[i][j] === '-')) continue;
      n++; k += feeds.filter((i) => g[i][j] === 'K' || g[i][j] === 'T' || g[i][j] === 'E' || g[i][j] === 'R').length / feeds.length;
    }
  }
  return n ? k / n : 1;
}

// How much held loops pack the cloth, MEASURED on a double bed: interlock is
// a rib in which every needle misses one feed in two (loop rate ½), and the
// factory has both. Their constants against each other give the packing at
// rate ½; a rate between ½ and 1 interpolates (log scale) between the two
// measured cloths. A single bed has no measured miss cloth: there the loops
// are taken to keep their shape (packing = 1 ÷ rate), an estimate.
const SINGLE_BED_PACK = 0.42;
function holdPacking(family, rate, pitchMm, slMm) {
  if (rate >= 0.999) return { ks: 1, kw: 1, basis: null };
  const double = family === 'rib' || family === 'interlock';
  if (!double) {
    // between no packing (held loops rob all their extra yarn from the
    // neighbours) and full packing 1 ÷ rate (every loop keeps its shape).
    // Set by the one measured pair we have: cotton single jersey and 1×1
    // cross miss knitted from the same yarn at the same 3.0 mm loop, finished
    // 163 and 170.7 GSM — (1 ÷ rate)^0.42 reproduces it. One pair, one mill:
    // the likely range stays wide, and a trial roll replaces it.
    const r = Math.max(rate, 0.25);
    return { ks: Math.pow(1 / r, SINGLE_BED_PACK), kw: 1, spread: Math.pow(1 / r, 0.2), basis: `loop rate ${r2(rate)}: each needle misses ${r1((1 - rate) * 100)}% of the feeds, so its loop is held and the cloth packs more feeds per cm — (1 ÷ rate)^${SINGLE_BED_PACK}, set on one published jersey / cross-miss pair (same yarn and loop), not on your factory's records; likely range widened (estimate — a trial roll fixes it)`, measured: false };
  }
  const ksR = KP.calFor('ks', 'rib', false).med, ksI = KP.calFor('ks', 'interlock', false).med;
  const kwR = KP.calFor('kw', 'rib', false).med, kwI = KP.calFor('kw', 'interlock', false).med;
  const mR = anchorMass('rib', pitchMm, slMm).M, mI = anchorMass('interlock', pitchMm, slMm).M;
  const ksHalf = (ksI / ksR) * (mR / mI), kwHalf = kwI / kwR;           // rib → interlock, measured
  const at = (half, r) => Math.pow(half, (1 - r) / 0.5);
  const r = Math.max(rate, 0.34);
  // relative to the family's own anchor (rib at rate 1, interlock at ½)
  const base = family === 'interlock' ? 0.5 : 1;
  return {
    ks: at(ksHalf, r) / at(ksHalf, base), kw: at(kwHalf, r) / at(kwHalf, base), ksHalf, kwHalf,
    basis: `loop rate ${r2(rate)}: needles miss ${r1((1 - rate) * 100)}% of the feeds and their loops are held — packing interpolated between the factory's rib (rate 1) and interlock (rate ½) records${rate < 0.5 ? '; below ½ it is extrapolated' : ''}`,
    measured: rate >= 0.5,
  };
}

function structureModel(ctx) {
  const { st, family, feedRows } = ctx;
  const { tau, mu } = shares(st, feedRows);
  const e = Math.min(tau / TUCK_ANCHOR, TUCK_CAP);
  const eFam = family === 'pique' ? 1 : 0;
  const kwF = Math.pow(TUCK_KW, e - eFam) * (1 + MISS_KW * mu);
  const ksF = Math.pow(TUCK_KS, e - eFam) * (1 + MISS_KW * mu);
  const notes = [];
  if (tau > 0) notes.push(`tuck share ${r2(tau)} of needle-feeds (the lacoste anchor is ${TUCK_ANCHOR}): wales and courses set from the single-jersey → piqué records${tau / TUCK_ANCHOR > TUCK_CAP ? `, held at ${TUCK_CAP}× the anchor — beyond that nothing is measured` : ''}`);
  if (mu > 0) notes.push(`miss share ${r2(mu)}: the floats draw the wales together (cloth narrower by about ${r1(MISS_KW * mu * 100)}%) — direction from float-stitch theory; the size of the effect is not measured in the factory file`);
  return { tau, mu, e, eFam, kwF, ksF, notes };
}

function platingFraction(ctx) {
  const el = ctx.elastane;
  if (!el) return 0;
  const knit = ctx.feedRows.map((f, i) => i).filter((i) => ctx.feedRows[i].role !== 'loop');
  return knit.length ? el.feeds.filter((i) => knit.includes(i)).length / knit.length : 1;
}

function blend(a, b, w) {
  const m = (k) => a[k] + w * (b[k] - a[k]);
  return { med: m('med'), q1: m('q1'), q3: m('q3'), n: Math.min(a.n, b.n), basis: w > 0 && w < 1 ? `plain and plated family constants blended ${Math.round(w * 100)}% (no records for part-plated cloth)` : (w >= 1 ? b.basis : a.basis) };
}
const scaled = (c, k) => ({ ...c, med: c.med * k, q1: c.q1 * k, q3: c.q3 * k });

function isKnitFeed(st, feedRows, i) {
  return feedRows[i].role !== 'loop' && [st.beds.C, st.beds.D].filter(Boolean).some((g) => g[i].includes('K'));
}

// ── feeder roles: what each one does on the machine ──────────────────────
// A role names the yarn a feeder carries; the cells say what its needles do.
// Every combination has a mechanical meaning — none is refused:
//   ground / face  a knitting yarn (face = the one that shows on the face)
//   binder         knits behind the face and ties a loop yarn in; with no
//                  loop yarn in the repeat it is simply another ground course
//   loop           the fleecy yarn: tucks on some needles (tied in), floats
//                  over the rest. Where it KNITS it is either a sinker-loop
//                  pile (terry / velour, when a pile is chosen) or it knits
//                  in like any ground yarn — a jersey course of that yarn
// The drawn role is kept (role_drawn); the engine weighs the effective one.
function resolveRoles(C, D, feedRows, pileWanted) {
  const notes = [];
  const add = (level, text) => notes.push({ level, text });
  const W = C[0].length;
  feedRows.forEach((f, i) => {
    f.drawn = f.role;
    if (f.role !== 'loop') return;
    const cells = D ? C[i].concat(D[i]) : C[i];
    const knits = cells.includes('K'), tucks = cells.includes('T');
    if (knits && (D || !pileWanted)) {
      f.role = 'ground';
      add('warn', `Feed ${i + 1} carries the loop yarn but knits${D ? ' on a double bed' : ''}: on the machine that yarn forms needle loops and shows in the fabric as a ${D ? 'double-jersey' : 'jersey'} course of the coarse loop yarn — it is weighed as a knitting course. For a fleece back, let the loop yarn tuck on 1 needle in 3–6 and miss the rest${D ? '' : '; for terry / velour choose "Sinker-loop pile"'}.`);
      return;
    }
    if (!knits && !tucks) {
      add('error', `Feed ${i + 1}: the loop yarn never tucks or knits, so nothing ties it in — it would lie loose behind the fabric and fall out. Give it a tuck on at least 1 needle in 6.`);
      return;
    }
    if (!knits) {
      const t = C[i].filter((x) => x === 'T').length + (D ? D[i].filter((x) => x === 'T').length : 0);
      // the longest float of the loop yarn on the cylinder, round the repeat
      let run = 0, best = 0;
      for (let k = 0; k < 2 * W; k++) { if (C[i][k % W] === 'T' || C[i][k % W] === 'K') run = 0; else { run++; best = Math.max(best, run); } }
      best = Math.min(best, W);
      if (D) add('note', `Feed ${i + 1}: the loop yarn tucks on ${t} needle${t > 1 ? 's' : ''} and lies between the two beds — a laid-in (inlay) yarn: it adds weight and bulk, no loops of its own.`);
      else add('ok', `Feed ${i + 1}: loop yarn tied in by a tuck on ${t} of ${W} needles, floating over ${best} needle${best === 1 ? '' : 's'} at most between tucks.`);
      if (!D && t / W > 0.5) add('warn', `Feed ${i + 1}: the loop yarn tucks on more than half the needles — it is held like a tuck course, its floats are short and there is little to raise into a fleece.`);
    }
  });
  const hasLoop = feedRows.some((f) => f.role === 'loop');
  feedRows.forEach((f, i) => {
    if (f.role === 'binder' && !hasLoop) add('note', `Feed ${i + 1} is a binder, but no feeder lays a loop yarn for it to tie in — it knits as a plain ground course.`);
  });
  const fleecy = feedRows.some((f, i) => f.role === 'loop' && !C[i].includes('K'));
  if (fleecy && !D && !feedRows.some((f) => f.role === 'binder')) add('note', 'No binder feeder: the loop yarn is tied in by the knitting course itself (two-thread fleece). It can grin through to the face; a binder behind the face (three-thread) hides it.');
  return notes;
}

// ── finish: brushing (raising) ──────────────────────────────────────────
// MODELLED, from the fleece engine: each pass of the raising rollers tears
// ~3.5% of the loop yarn's fibre into the nap; the nap length grows with the
// staple and the passes. A fabric with no floats (jersey, piqué, rib) only
// loses surface fibre — taken here as ~1.2% of that side's yarn per pass.
// The fleece family's factory records are RAISED fleece (back, the usual
// passes), so an unbrushed (loopback) fleece is heavier than they say.
const PASS_LOSS = 0.035, SURF_LOSS = 0.012;
const STAPLE = { cotton: 28, cvc: 32, polyester_spun: 38, viscose: 38, modal: 38, polyester_filament: 0, nylon_filament: 0 };
function finishModel(ctx, S) {
  const f = ctx.input.finish || {};
  const fleece = ctx.family === 'fleece';
  const legacy = !f.brush;
  const brush = legacy ? (fleece ? 'back' : 'none') : (['none', 'back', 'face', 'both'].includes(f.brush) ? f.brush : 'none');
  const fib = S.ground.fibre;
  const poly = /polyester|nylon/.test(fib) ? 1 : fib === 'cvc' ? 0.4 : 0;
  const p0 = poly >= 0.6 ? 5 : poly > 0.1 ? 4 : 3;
  const passes = brush === 'none' ? 0 : (+f.passes > 0 ? Math.min(12, Math.round(+f.passes)) : p0);
  const loopLoss = (p) => 1 - Math.pow(1 - PASS_LOSS, p);
  const surfLoss = (p) => 1 - Math.pow(1 - SURF_LOSS, p);
  const tot = S.feeds.reduce((t, x) => t + x.mass, 0) || 1;
  const loopShare = S.feeds.filter((x) => x.role === 'loop').reduce((t, x) => t + x.mass, 0) / tot;
  const back = brush === 'back' || brush === 'both', face = brush === 'face' || brush === 'both';
  let loss = 0;
  if (back) loss += fleece && loopShare > 0 ? loopLoss(passes) * loopShare : surfLoss(passes) * 0.5;
  if (face) loss += surfLoss(passes) * 0.5;
  const base = fleece ? loopLoss(p0) * loopShare : 0;
  const staple = STAPLE[fib] != null ? STAPLE[fib] : 28;
  let pile = passes && staple ? 0.065 * staple * (1 - Math.exp(-passes / 2.5)) : 0;
  if (!(fleece && back && loopShare > 0)) pile *= 0.35;            // no floats to raise: a short peach nap
  const sheared = !!f.sheared && passes > 0;
  if (sheared) pile = Math.min(pile, fleece ? 1.2 : 0.4);
  return { k: (1 - loss) / (1 - base), brush, passes, p0, loss, loopShare, loopLost: fleece && back ? loopLoss(passes) : 0, pile, sheared, fleece, legacy, filament: /filament/.test(fib) };
}
function finishChecks(fin, family, plush) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  if (plush) { if (fin.brush !== 'none' && !fin.legacy) add('note', 'Plush is not raised: a terry keeps its loops, a velour is cut and sheared (the "Shear the loops open" option). The brushing choice is not applied.'); return out; }
  const pct = (x) => r1(x * 100);
  if (fin.fleece) {
    if (fin.brush === 'none') add('note', `Not brushed: the loop yarn's floats stay as loops on the back — a loopback (French terry). Nothing is torn out, so it weighs ${pct(fin.k - 1)}% more than a raised fleece of the same knitting (modelled).`);
    else add('note', `Raised ${fin.brush === 'both' ? 'on both sides' : fin.brush === 'face' ? 'on the face only — the loop yarn on the back is not raised' : 'on the back'}: ${fin.passes} passes tear about ${pct(fin.loopLost)}% of the loop yarn into a nap about ${r1(fin.pile)} mm long${fin.sheared ? ' (sheared level)' : ''} — ${pct(fin.loss)}% of the fabric weight (modelled). Dry it on the stenter 15–18% wider than finish before raising: raising pulls the width in.`);
  } else if (fin.brush !== 'none') {
    add('note', `Brushed ${fin.brush === 'both' ? 'on both sides' : 'on the ' + fin.brush} (peach / raised ${family === 'single_jersey' ? 'jersey' : family}): there are no floats to raise, so the nap is short (about ${r1(fin.pile)} mm) and comes from the loops' own surface fibre; about ${pct(fin.loss)}% of the weight is lost (modelled). Expect lower bursting strength and more pilling than unbrushed.`);
  }
  if (fin.brush !== 'none' && fin.filament) add('warn', 'Filament yarn: raising breaks the filaments instead of pulling out fibre — it is sanded (peached), not brushed; strength drops.');
  return out;
}

function solve(ctx, ground) {
  const { st, family, lycra, feedRows, input } = ctx;
  const mach = input.machine || {};
  const M = KP.MACHINE[FAMILY[family].machine];
  const phi = platingFraction(ctx);
  const fibre = fibreFactor(ground.fibre);
  const model = structureModel(ctx);
  // a rib with needles out of action (2-in-1-out, 2x2) is weighed on its own factory records
  const ksFam = family === 'rib' && ctx.posNorm > 1.01 ? 'rib2x2' : family;
  const KS0 = blend(KP.calFor('ks', ksFam, false), KP.calFor('ks', ksFam, true), phi);
  const KW0 = blend(KP.calFor('kw', family, false), KP.calFor('kw', family, true), phi);
  const pitch0 = 25.4 / (+mach.gauge > 0 ? +mach.gauge : 24);
  const pack = holdPacking(family, ctx.rate == null ? 1 : ctx.rate, pitch0, 3);
  let KS = scaled(KS0, fibre.ks * model.ksF * pack.ks);
  if (pack.spread) KS = { ...KS, q1: KS.q1 / pack.spread, q3: KS.q3 * pack.spread };
  let KW = scaled(KW0, fibre.kw * model.kwF * pack.kw);
  const modelKS = KS.med, modelKW = KW.med;
  if (ctx.calib) {
    const sp = Math.max(0.015, ctx.calib.spread);
    KS = { ...KS, med: ctx.calib.ks, q1: ctx.calib.ks * (1 - sp), q3: ctx.calib.ks * (1 + sp), n: ctx.calib.n, basis: `${ctx.calib.n} trial roll${ctx.calib.n > 1 ? 's' : ''} measured at your mill` };
    KW = { ...KW, med: ctx.calib.kw, q1: ctx.calib.kw * (1 - sp), q3: ctx.calib.kw * (1 + sp), n: ctx.calib.n, basis: `${ctx.calib.n} trial roll${ctx.calib.n > 1 ? 's' : ''} measured at your mill` };
  }
  // a loop feed with no yarn named gets the anchor's loop yarn, and says so
  const loopYarn = (() => {
    const tex = ground.tex * ANCHOR_LOOP_TEX_RATIO;
    const ne = COUNTS.reduce((b, c) => (Math.abs(590.5 / c - tex) < Math.abs(590.5 / b - tex) ? c : b), COUNTS[0]);
    return { tex: 590.5 / ne, ne, label: `${ne}s Ne (assumed)`, fibre: ground.fibre, fibre_label: ground.fibre_label };
  })();
  const yarns = feedRows.map((f) => f.yarn || (f.role === 'loop' ? loopYarn : ground));
  // a rib's out-of-action needles are not cloth: the family constants are per
  // working needle (the same basis as its width), so is the yarn here
  const posNorm = ctx.posNorm;

  // gauge
  const fg = factoryGauge(family, lycra, ground.ne);
  const isDouble = !!st.beds.D;
  const npi = Math.sqrt((isDouble ? 770 : 1650) / ground.tex) * 2.54;
  const coverGauge = M.gauges.reduce((b, g) => (Math.abs(g - npi) < Math.abs(b - npi) ? g : b), M.gauges[0]);
  const recGauge = fg ? fg.gauge : coverGauge;
  // the machine class bounds the gauge it is built in
  const PG = ctx.profile && ctx.profile.gauges;
  const gauge = +mach.gauge > 0 ? +mach.gauge : PG ? Math.min(PG[1], Math.max(PG[0], recGauge)) : recGauge;
  const pitch = 25.4 / gauge;

  // stitch length: per feed ℓᵢ = own setting, or ℓref × ratio
  const slOf0 = (i, lref) => feedRows[i].sl_mm || lref * feedRows[i].sl_ratio;
  const knitFeeds = feedRows.map((f, i) => i).filter((i) => isKnitFeed(st, feedRows, i));
  // the cloth's loop length is the knitting feeders': a tuck feeder set tighter changes the yarn, not the loop
  const lk = (lref) => (knitFeeds.length ? mean(knitFeeds.map((i) => slOf0(i, lref))) : lref);
  // the yarn share the family constant is per, at this structure's tuck level
  const mb = (e) => 1 - (1 - anchorMass('pique', pitch, 3).M) * e;
  const gsmAt = (lref, ks = KS.med) => {
    const A = anchorMass(family, pitch, lref);
    const cons = KP.feedConsumption(st, pitch, lref);
    const Y = posNorm * mean(cons.map((c, i) => c.share * (slOf0(i, lref) / 10) * yarns[i].tex));
    const den = A.M * mb(model.e) / mb(model.eFam);
    return { gsm: (ks * Y) / (10 * (lk(lref) / 10) ** 2 * den) * (ctx.finishK || 1), cons, A };
  };
  const target = +((input.target || {}).gsm) || null;
  let lref, slSource;
  if (+mach.sl_mm > 0) { lref = +mach.sl_mm; slSource = 'your setting'; }
  else if (target) {
    let lo = 1.0, hi = 12;
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (gsmAt(mid).gsm > target) lo = mid; else hi = mid; }
    lref = (lo + hi) / 2; slSource = `solved for ${target} GSM`;
  } else throw new StudioError('Give a target GSM, or your machine stitch length.');
  const at = gsmAt(lref);
  const gsm = at.gsm;
  const gsmRange = [gsmAt(lref, KS.q1).gsm, gsmAt(lref, KS.q3).gsm];
  const slRange = target && slSource.startsWith('solved')
    ? [KS.q1, KS.q3].map((ks) => { let lo = 1, hi = 12; for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (gsmAt(m, ks).gsm > target) lo = m; else hi = m; } return r2((lo + hi) / 2); })
    : null;
  const lcm = lk(lref) / 10;
  const slOf = (i) => feedRows[i].sl_mm || lref * feedRows[i].sl_ratio;

  // width, needles, dia
  const wrep = st.width;
  const step = Math.max(2, wrep % 2 ? wrep * 2 : wrep);
  const needlesAt = (d, g) => Math.round(Math.PI * d * g / step) * step;
  const workFrac = 1 / posNorm;
  const widthAt = (d, k = KW.med) => (needlesAt(d, gauge) * workFrac * lcm) / (k * 2.54);
  const tW = +((input.target || {}).width_in) || null;
  let dia, diaSource;
  if (+mach.dia > 0) { dia = +mach.dia; diaSource = 'your machine'; }
  else if (tW) {
    const exact = (tW * KW.med * 2.54) / (Math.PI * gauge * lcm * workFrac);
    dia = KP.STANDARD_DIA.reduce((b, d) => (Math.abs(d - exact) < Math.abs(b - exact) ? d : b), 30);
    diaSource = `solved for ${tW}" open width (exact ${r1(exact)}")`;
  } else {
    dia = KP.CAL.diaMode[`${family}|${lycra ? 'L' : 'P'}`] || KP.CAL.diaMode[`${family}|P`] || 30;
    diaSource = 'the factory\'s most common diameter for this family';
  }
  const needles = needlesAt(dia, gauge);
  const width = widthAt(dia);
  const feedsRep = st.feeds;
  const fpi = ctx.profile && ctx.profile.fpi ? ctx.profile.fpi : M.fpi;
  const unit = ctx.feederUnit || feedsRep;
  const feeders = +mach.feeders > 0 ? +mach.feeders : Math.max(unit, Math.round((fpi * dia) / unit) * unit);
  const rpm = +mach.rpm > 0 ? +mach.rpm : Math.round((ctx.profile && ctx.profile.sf ? ctx.profile.sf : M.sf) / dia);
  const eff = (+mach.efficiency > 0 ? +mach.efficiency : 85) / 100;

  // yarn per feed
  const feeds = feedRows.map((f, i) => {
    const s = at.cons[i].share;
    const l = slOf(i);
    const courseM = (s * needles * l) / 1000;            // yarn per revolution at this feeder
    const knitsHere = [st.beds.C, st.beds.D].filter(Boolean).some((g) => g[i].includes('K'));
    const loopy = f.role === 'loop' || !knitsHere;
    const elast = ctx.elastane && ctx.elastane.feeds.includes(i) ? ctx.elastane : null;
    return {
      feed: i + 1, role: f.role, role_drawn: f.drawn || f.role, yarn: yarns[i].label, fibre: yarns[i].fibre_label, tex: r2(yarns[i].tex),
      sl_mm: r3(l), sl_source: f.sl_mm ? 'your setting' : f.sl_ratio !== 1 ? `${f.sl_ratio} × ground` : 'ground stitch length',
      tf: knitsHere ? r2(Math.sqrt(yarns[i].tex) / (l / 10)) : null,
      share: r2(s), course_length_m: r3(courseM), yarn_speed_m_min: r1(courseM * rpm),
      mass: s * l * yarns[i].tex, // relative, per needle position
      elastane_mass: elast ? s * (l / elast.draft) * (elast.denier / 9) : 0,
      tension_cN: loopy ? [r1(0.08 * yarns[i].tex), r1(0.10 * yarns[i].tex)] : [r1(0.12 * yarns[i].tex), r1(0.16 * yarns[i].tex)],
    };
  });
  const massTot = feeds.reduce((t, f) => t + f.mass, 0);
  const elastTot = feeds.reduce((t, f) => t + f.elastane_mass, 0);
  feeds.forEach((f) => { f.mass_share_pct = r1((f.mass / (massTot + elastTot)) * 100); });

  // composition by role
  const byRole = {};
  feeds.forEach((f) => { const k = `${f.role}: ${f.yarn} ${f.fibre}`; byRole[k] = (byRole[k] || 0) + f.mass; });
  const composition = Object.entries(byRole).map(([k, m]) => ({ part: k, pct: r1((m / (massTot + elastTot)) * 100) }));
  if (elastTot > 0) composition.push({ part: `elastane ${ctx.elastane.denier} D (draft ${ctx.elastane.draft})`, pct: r1((elastTot / (massTot + elastTot)) * 100) });

  // production
  const gPerRev = (feeders / feedsRep) * feeds.reduce((t, f, i) => t + f.course_length_m * yarns[i].tex, 0) / 1000;
  const kgh = (gPerRev * rpm * 60 * eff) / 1000;

  // density
  const bedsLoops = st.beds.D ? 2 : 1;
  const wpc = KW.med / lcm;
  // courses you count on the face: where loops are held, one face course
  // takes 1 ÷ loop rate feeds (interlock's own constants already count so)
  const rate = ctx.rate == null ? 1 : ctx.rate;
  const cpc = (KS.med / (bedsLoops * KW.med)) / lcm * rate / (family === 'interlock' ? 0.5 : 1);

  // TF
  const groundIdx = feedRows.findIndex((f, i) => ['ground', 'face'].includes(f.role) && [st.beds.C, st.beds.D].filter(Boolean).some((g) => g[i].includes('K')));
  const tfGround = Math.sqrt(ground.tex) / (slOf(groundIdx >= 0 ? groundIdx : 0) / 10);

  return {
    ground, gauge, recGauge, fg, coverGauge, pitch, lref, slSource, slRange, gsm, gsmRange, target,
    KS, KW, modelKS, modelKW, model, pack, fibre, phi, A: at.A, dia, diaSource, needles, width, widthRange: [widthAt(dia, KW.q3), widthAt(dia, KW.q1)], workFrac,
    feeders, rpm, eff, feeds, composition, kgh, wpc, cpc, tfGround, M, tW,
    gfit: gaugeFit(family, gauge, ground.tex, ground.fibre),
  };
}


// ── trial rolls: the mill's own measurements replace the carried-over constants ─
// A roll knitted and finished (dyed, compacted) is measured for stitch length,
// GSM and open width. Run through this same design, each gives the Ks and Kw
// that reproduce it; the mean of the rolls (geometric) then stands in for the
// family constant, with the rolls' own scatter as the likely range.
function calibrate(ctx, ground, rolls) {
  if (!Array.isArray(rolls) || !rolls.length) return null;
  if (rolls.length > 12) throw new StudioError('At most 12 trial rolls.');
  const per = rolls.map((r, n) => {
    const need = (v, lo, hi, what) => {
      const x = +v;
      if (!(x >= lo && x <= hi)) throw new StudioError(`Trial roll ${n + 1}: ${what} must be between ${lo} and ${hi}.`);
      return x;
    };
    const sl = need(r.sl_mm, 1, 10, 'stitch length (mm)'), gsm = need(r.gsm, 40, 800, 'finished GSM'), width = need(r.width_in, 15, 120, 'finished open width (in)');
    const dia = need(r.dia, 10, 60, 'cylinder diameter (in)'), gauge = need(r.gauge, 5, 50, 'gauge');
    const y = +r.ne > 0 ? readYarn({ ne: need(r.ne, 5, 150, 'count (Ne)'), fibre: ground.fibre }, null) : ground;
    const probe = solve({ ...ctx, calib: null, input: { ...ctx.input, machine: { ...(ctx.input.machine || {}), sl_mm: sl, gauge, dia, feeders: null, rpm: null }, target: {} } }, y);
    return {
      roll: n + 1, ks: probe.KS.med * gsm / probe.gsm, kw: probe.KW.med * probe.width / width,
      model_gsm: Math.round(probe.gsm), model_width_in: r1(probe.width), gsm, width_in: width,
    };
  });
  const gm = (k) => Math.exp(mean(per.map((x) => Math.log(x[k]))));
  const ks = gm('ks'), kw = gm('kw');
  const cv = (k, m) => (per.length > 1 ? Math.sqrt(mean(per.map((x) => (x[k] / m - 1) ** 2)) * per.length / (per.length - 1)) : 0);
  const spread = Math.max(cv('ks', ks), cv('kw', kw));
  per.forEach((x) => { x.ks_off_pct = r1((x.ks / ks - 1) * 100); x.kw_off_pct = r1((x.kw / kw - 1) * 100); x.outlier = per.length > 2 && (Math.abs(x.ks / ks - 1) > 0.1 || Math.abs(x.kw / kw - 1) > 0.1); });
  return { ks, kw, n: per.length, spread, per };
}


// ── checks the floor would otherwise find on the machine ───────────────────
// hook load: loops held in one hook against the space between needles
// The loops in one hook, each of its own feeder's yarn: the held loop and
// every tuck laid on it since (and a loop transferred in). Yarn diameter
// scales as √tex from the ground yarn's (Peirce: d ∝ √tex for one fibre).
function hookLoad(st, S, dir = 1) {
  const d0 = S.gfit.yarn_d_mm, t0 = S.ground.tex;
  const own = S.feeds.length === st.feeds;
  const dOf = (i) => (own && S.feeds[i] ? d0 * Math.sqrt(S.feeds[i].tex / t0) : d0);
  let worst = { idx: 0, loops: 1, where: '', mm: d0 };
  for (const [b, name] of [['C', 'cylinder'], ['D', 'dial']]) {
    const g = st.beds[b]; if (!g) continue;
    const F = g.length;
    for (let j = 0; j < st.width; j++) {
      const col = g.map((r) => r[j]); if (col.every((x) => x === '-')) continue;
      const into = b === 'C' && g.some((r) => r[(j - dir + st.width) % st.width] === 'E');
      for (let f = 0; f < F; f++) {
        if (col[f] !== 'T') continue;
        // back from this tuck to the last knit: those loops are all in the hook now
        let mm = dOf(f), loops = 1;
        for (let k = 1; k < F; k++) {
          const i = (f - k + F) % F;
          if (col[i] === 'T') { mm += dOf(i); loops++; } else if (col[i] === 'K') { mm += dOf(i); loops++; break; }
        }
        if (into) { mm += d0; loops++; }
        const idx = mm / S.pitch;
        if (idx > worst.idx) worst = { idx, loops, where: `${name} needle ${j + 1} at feed ${f + 1}`, mm };
      }
      if (!col.includes('T') && into && 2 * d0 / S.pitch > worst.idx) worst = { idx: 2 * d0 / S.pitch, loops: 2, where: `${name} needle ${j + 1}`, mm: 2 * d0 };
    }
  }
  return worst;
}

// ── choosing the count and the gauge together ─────────────────────────────
// The limits a setting must keep, every one from the checks below, so the
// studio never proposes a setting its own checks then reject:
//   tightness factor inside the factory's 5th–95th percentile for the family
//   needle pitch ÷ yarn diameter inside the factory's band (gauge fit)
//   hook load ≤ 0.6 where tucks pile loops in one hook
//   stitch length 1.8–7 mm
// Every commercial count is tried on every gauge whose fit could be good for
// it (or only on the gauge you set). Settings that keep all limits are ranked
// by how near the middle of the factory's practice they sit; when none keeps
// them all the nearest is returned with the limits it breaks, and the answer
// says so instead of passing it off as a solution.
function chooseSetup(ctx, fibre) {
  const { family, input, st } = ctx;
  const mach = input.machine || {};
  const W = tfWindow(family, ctx.lycra, ctx.rate);
  const M = KP.MACHINE[FAMILY[family].machine];
  const B = KP.CAL.band[family] && KP.CAL.band[family].n >= 20 ? KP.CAL.band[family] : KP.CAL.band.single_jersey;
  const fixedGauge = +mach.gauge > 0 ? +mach.gauge : null;
  const tried = [];
  for (const ne of COUNTS) {
    const yarn = { tex: 590.5 / ne, ne, label: `${ne}s Ne`, fibre, fibre_label: FIBRES[fibre].label };
    const yarnD = (Math.sqrt(yarn.tex) / 28) * FIBRES[fibre].dFactor;
    const fits = M.gauges.filter((g) => { const r = 25.4 / g / yarnD; return r >= B.lo * 0.92 && r <= B.hi * 1.08; });
    const fg = factoryGauge(family, ctx.lycra, ne);
    const gauges = fixedGauge ? [fixedGauge] : [...new Set([...(fits.length ? fits : []), ...(fg ? [fg.gauge] : [])])];
    if (!gauges.length) gauges.push(M.gauges.reduce((b, g) => (Math.abs(25.4 / g / yarnD - (B.lo + B.hi) / 2) < Math.abs(25.4 / b / yarnD - (B.lo + B.hi) / 2) ? g : b), M.gauges[0]));
    for (const g of gauges) {
      let s;
      try { s = solve({ ...ctx, input: { ...input, machine: { ...mach, gauge: g } } }, yarn); } catch (e) { if (e instanceof StudioError) continue; throw e; }
      const broken = [];
      if (W && s.tfGround > W.p95) broken.push(`tightness factor ${r1(s.tfGround)} above the factory's ${W.p95}`);
      if (W && s.tfGround < W.p5) broken.push(`tightness factor ${r1(s.tfGround)} below the factory's ${W.p5}`);
      if (s.gfit.fit !== 'good') broken.push(`${g} GG ${s.gfit.fit} for ${ne}s (pitch/yarn ${s.gfit.ratio}, factory ${s.gfit.band[0]}–${s.gfit.band[1]})`);
      const hl = hookLoad(st, s, ctx.transferDir === 'left' ? -1 : 1);
      if (hl.loops > 1 && hl.idx > 0.6) broken.push(`hook load ${r2(hl.idx)} (${hl.loops} loops) above 0.6`);
      if (s.lref < 1.8 || s.lref > 7) broken.push(`stitch length ${r2(s.lref)} mm outside 1.8–7`);
      const spread = W ? Math.max(0.3, W.q3 - W.q1) : 1;
      const mid = Math.sqrt(B.lo * B.hi);
      // the factory's own gauge for this count weighs more than the middle of the fit band
      const score = (W ? Math.abs(s.tfGround - W.med) / spread : 0)
        + 0.5 * Math.abs(Math.log(s.gfit.ratio / mid)) / Math.log(B.hi / B.lo)
        + (fg && fg.gauge !== g ? 0.8 : 0);
      tried.push({ s, g, ne, broken, score, practised: !!(fg && fg.gauge === g), tfIn: W ? s.tfGround >= W.q1 && s.tfGround <= W.q3 : null });
    }
  }
  if (!tried.length) throw new StudioError('No commercial count reaches this GSM on this structure.');
  const ok = tried.filter((t) => !t.broken.length).sort((a, b) => a.score - b.score);
  const rest = tried.filter((t) => t.broken.length).sort((a, b) => a.broken.length - b.broken.length || a.score - b.score);
  const ranked = ok.length ? ok : rest;
  const best = ranked[0];
  const target = +((input.target || {}).gsm);
  let verdict;
  if (ok.length) {
    verdict = { level: 'ok', text: `${ok.length} setting${ok.length > 1 ? 's' : ''} of ${tried.length} tried keep every limit. Best: ${best.ne}s Ne on ${best.g} GG at ${r2(best.s.lref)} mm${best.practised ? ' — the gauge the factory most often knits this count on' : ''}.` };
  } else {
    // what the structure can reach inside the limits, so the answer says what to change
    const heavy = W && tried.every((t) => t.s.tfGround > W.p95);
    const light = W && tried.every((t) => t.s.tfGround < W.p5);
    verdict = {
      level: 'not_reachable',
      text: `No count and gauge knits ${target} GSM on this structure inside every factory limit. ` +
        (heavy ? `Every workable count would have to be knitted tighter than the factory ever finishes this family: ${target} GSM is too heavy for it. Lower the target, use a heavier (or plied) yarn, or a structure that lays more yarn per needle.`
          : light ? `Every workable count would be knitted looser than the factory ever finishes this family: ${target} GSM is too light for it. Raise the target, use a finer count or a more open structure.`
            : '') +
        ` Nearest: ${best.ne}s Ne on ${best.g} GG at ${r2(best.s.lref)} mm, which breaks: ${best.broken.join('; ')}.`.replace(/\s+/g, ' '),
    };
  }
  return {
    S: best.s, verdict,
    solver: {
      basis: `every commercial count (${COUNTS[0]}s–${COUNTS[COUNTS.length - 1]}s) tried on ${fixedGauge ? `your ${fixedGauge} GG` : 'each gauge that suits it'}; limits from the factory records${W ? ` (tightness factor ${W.p5}–${W.p95}, ${W.basis})` : ''}, ranked by nearness to the factory median`,
      verdict,
      tried: tried.length, feasible: ok.length,
      options: ranked.slice(0, 6).map((t) => ({
        count: t.s.ground.label, sl_mm: r2(t.s.lref), tf: r1(t.s.tfGround), gauge: t.g, gauge_fit: t.s.gfit.fit,
        gsm: Math.round(t.s.gsm), width_in: r1(t.s.width), practised: t.practised, breaks: t.broken, score: r2(t.score),
      })),
    },
  };
}

function checksFor(ctx, S, T) {
  const { st, family, input, feedRows } = ctx;
  const mach = input.machine || {};
  const out = KP.structureChecks(st, T, S.M).filter((c) => !/needle track/.test(c.text));
  const add = (level, text) => out.push({ level, text });
  const tC = T.C ? T.C.sequences.length : 0, tD = T.D ? T.D.sequences.length : 0;
  const capC = +mach.tracks_cyl > 0 ? +mach.tracks_cyl : 4, capD = +mach.tracks_dial > 0 ? +mach.tracks_dial : 2;
  if (ctx.transfers) {
    add('note', `${ctx.transfers} transfer${ctx.transfers > 1 ? 's' : ''} (E) per repeat: knitted on a pointelle machine with loop transfer and electronic needle selection, so cam tracks do not limit the repeat. The tracks below are the knit / tuck / miss part of it.`);
    const C = st.beds.C, F = st.feeds, Wd = st.width;
    for (let i = 0; i < F; i++) for (let j = 0; j < Wd; j++) {
      if (C[i][j] !== 'E') continue;
      const dir = ctx.transferDir === 'left' ? -1 : 1, to = (j + dir + Wd) % Wd;
      const nb = C[i][to], next = C[(i + 1) % F][j];
      if (nb !== 'K' && nb !== 'T') add('error', `Feed ${i + 1}, needle ${j + 1}: the transferred loop goes onto needle ${to + 1} (${dir > 0 ? 'right' : 'left'}), which must knit or tuck at this feed to take it (it is "${nb}").`);
      if (next !== 'K') add('warn', `Feed ${i + 1}, needle ${j + 1}: after a transfer the empty needle should knit at the next feed, or the eyelet does not close round a new loop (it is "${next}").`);
    }
  } else if (ctx.profile) { /* tracks, cams and needles: knit-machine.js fit() */ }
  else if (tC > capC) add('error', `Cylinder needs ${tC} needle tracks; the machine has ${capC}. Simplify the repeat or use an electronic (jacquard) selection machine.`);
  else if (T.C) add('ok', `Cylinder: ${tC} track${tC > 1 ? 's' : ''} needed, machine has ${capC}.`);
  if (T.D && !ctx.profile) {
    if (tD > capD) add('error', `Dial needs ${tD} needle tracks; the machine has ${capD}.`);
    else add('ok', `Dial: ${tD} track${tD > 1 ? 's' : ''} needed, machine has ${capD}.`);
  }
  // transfers between the beds (R): the loop goes to the needle opposite
  for (const [b, o, name, other] of [['C', 'D', 'cylinder', 'dial'], ['D', 'C', 'dial', 'cylinder']]) {
    const g = st.beds[b]; if (!g) continue;
    for (let i = 0; i < st.feeds; i++) for (let j = 0; j < st.width; j++) {
      if (g[i][j] !== 'R') continue;
      if (!st.beds[o]) { add('error', `Feed ${i + 1}, needle ${j + 1}: R hands the loop to the other bed — there is no dial. Draw on rib or interlock gating.`); continue; }
      const rx = st.beds[o][i][j], next = g[(i + 1) % st.feeds][j];
      if (rx !== 'K' && rx !== 'T') add('error', `Feed ${i + 1}, ${name} needle ${j + 1}: the loop goes to the ${other} needle opposite, which must knit or tuck at this feed to take it (it is "${rx}").`);
      if (next !== 'K' && next !== 'T') add('note', `Feed ${i + 1}, ${name} needle ${j + 1}: after the transfer this needle stays empty — its wale continues on the ${other} (rib to jersey, or a reverse stitch in a face wale).`);
    }
  }
  // interlock gating: needle j of the cylinder faces needle j of the dial
  if (st.beds.D && ctx.gating === 'interlock') {
    for (let i = 0; i < st.feeds; i++) for (let j = 0; j < st.width; j++) {
      const c = st.beds.C[i][j], d = st.beds.D[i][j];
      if ((c === 'K' || c === 'T') && (d === 'K' || d === 'T')) add('error', `Feed ${i + 1}, needle ${j + 1}: on interlock gating the cylinder and dial needles face each other — both cannot rise at the same feed. Move one to the other track.`);
    }
  }
  const worst = hookLoad(st, S, ctx.transferDir === 'left' ? -1 : 1);
  if (worst.loops > 1) {
    const msg = `${worst.where}: ${worst.loops} loops in one hook at ${S.gauge} GG — ${r2(worst.mm)} mm of yarn (each loop at its own feeder's count) in a ${r2(S.pitch)} mm needle pitch: hook load ${r2(worst.idx)} (estimate).`;
    if (worst.idx > 0.6) add('warn', `${msg} Above 0.6: press-off and needle damage are likely — use a finer yarn, a coarser gauge or fewer tucks in a row.`);
    else if (worst.idx > 0.45) add('note', `${msg} Close to the limit: keep the tuck feeders' tension low.`);
  }
  // floats in millimetres
  const pitchFab = 10 / S.wpc; // mm between wales, finished
  for (const [b, name] of [['C', 'cylinder'], ['D', 'dial']]) {
    const g = st.beds[b]; if (!g) continue;
    g.forEach((row, i) => {
      if (feedRows[i].role === 'loop' || (!row.includes('K') && !row.includes('T'))) return;
      const m = maxRun(row, 'M');
      if (m >= 2 && m < row.length && m * pitchFab > 10) add('warn', `Feed ${i + 1}, ${name}: float of ${m} needles ≈ ${r1(m * pitchFab)} mm in the finished fabric — over 10 mm snags in wear.`);
    });
  }
  if (feedRows.some((f, i) => f.sl_mm || f.sl_ratio !== 1)) add('note', 'Per-feeder stitch lengths change the yarn each feeder lays; the width and density of the cloth follow the knitting feeders\' mean length.');
  if (S.feeders % st.feeds) add('error', `${S.feeders} feeders is not a whole number of ${st.feeds}-feed repeats: the pattern breaks where the feeders wrap round. Use ${Math.max(st.feeds, Math.round(S.feeders / st.feeds) * st.feeds)}.`);
  if (S.gfit.fit !== 'good') add('warn', `${S.gauge} GG is ${S.gfit.fit} for ${S.ground.label}: needle pitch ${S.gfit.pitch_mm} mm against a ${S.gfit.yarn_d_mm} mm yarn (ratio ${S.gfit.ratio}; the factory knits this family between ${S.gfit.band[0]} and ${S.gfit.band[1]}).`);
  const W = tfWindow(family, ctx.lycra, ctx.rate);
  if (W) {
    const tf = S.tfGround;
    if (tf < W.p5 || tf > W.p95) add('warn', `Tightness factor ${r1(tf)} is outside what the factory finishes this family at (${W.p5}–${W.p95}, 5th–95th percentile): ${tf < W.p5 ? 'loose — expect high shrinkage, spirality and a sleazy hand' : 'tight — expect yarn breaks, needle wear and a boardy hand'}.`);
    else if (tf < W.q1 || tf > W.q3) add('note', `Tightness factor ${r1(tf)}: inside the factory range but outside the middle half (${W.q1}–${W.q3}).`);
    else add('ok', `Tightness factor ${r1(tf)}: in the middle of the factory's range for this family (${W.q1}–${W.q3}).`);
  }
  if (S.target && Math.abs(S.gsm / S.target - 1) > 0.03) add('note', `At the set stitch length this fabric comes out at ${Math.round(S.gsm)} GSM against the ${S.target} target.`);
  if (S.tW && Math.abs(S.width / S.tW - 1) > 0.04) add('note', `Open width ${r1(S.width)}" against the ${S.tW}" target — adjust on the stenter or choose another diameter.`);
  const order = { error: 0, warn: 1, note: 2, ok: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// A drawn repeat larger than it needs to be (KKKK, or the same two feeds twice)
// is the same fabric as its smallest repeat: reduce it, so the set-out, the
// track count, the feeder rule and the catalogue match see the real structure.
function reduceRepeat(C, D, feedRows, altPlating) {
  const beds = [C, D].filter(Boolean);
  const F = C.length, W = C[0].length;
  const key = (i) => { const f = feedRows[i]; return JSON.stringify([f.role, f.yarn && f.yarn.tex, f.yarn && f.yarn.fibre, f.sl_mm, f.sl_ratio, altPlating ? i % 2 : 0]); };
  let q = F;
  for (let d = 1; d < F; d++) {
    if (F % d) continue;
    let ok = true;
    for (let i = d; i < F && ok; i++) {
      if (key(i) !== key(i % d) || beds.some((g) => g[i].join('') !== g[i % d].join(''))) ok = false;
    }
    if (ok && (!altPlating || d % 2 === 0)) { q = d; break; }
  }
  let pN = W;
  for (let d = 1; d < W; d++) {
    if (W % d) continue;
    if (beds.every((g) => g.every((row) => row.every((x, j) => x === row[j % d])))) { pN = d; break; }
  }
  return { feeds: q, needles: pN, changed: q !== F || pN !== W, from: [F, W] };
}

// ── public ──────────────────────────────────────────────────────────────────
function analyse(input) {
  try {
    const g = input && input.grid ? input.grid : {};
    const C = readBed(g.C, 'Cylinder');
    const D = input.bed === 'double' ? readBed(g.D, 'Dial') : null;
    if (!C) throw new StudioError('Cylinder: draw the needle programme.');
    if (D && D.length !== C.length) throw new StudioError(`Dial has ${D.length} feeds and the cylinder ${C.length}. Both beds work at every feed.`);
    if (D && D[0].length !== C[0].length) throw new StudioError(`Dial has ${D[0].length} needles per repeat and the cylinder ${C[0].length}. Draw them over the same repeat.`);
    const gating = D ? (input.gating === 'interlock' ? 'interlock' : 'rib') : 'single';

    const ground = readYarn(input.yarn, null);
    const auto = !ground;
    const feedRows = C.map((_, i) => {
      const f = (input.feeds || [])[i] || {};
      const role = ROLES.includes(f.role) ? f.role : 'ground';
      return {
        role,
        yarn: readYarn(f.yarn, null),
        sl_mm: +f.sl_mm > 0 ? +f.sl_mm : null,
        sl_ratio: +f.sl_ratio > 0 ? Math.min(3, Math.max(0.3, +f.sl_ratio)) : 1,
      };
    });
    // stripe colours as drawn, feed by feed (before the repeat is reduced)
    const feedColours = C.map((_, i) => { const c = ((input.feeds || [])[i] || {}).colour; return /^[A-F]$/.test(c || '') ? c : null; });
    const elIn = input.elastane || {};
    // part-plating on alternate feeders needs an even number of feeds to be a repeat
    if (elIn.every === 'alternate' && C.length % 2) {
      const n = C.length;
      for (let i = 0; i < n; i++) { C.push(C[i].slice()); if (D) D.push(D[i].slice()); feedRows.push({ ...feedRows[i] }); }
    }
    const reduced = reduceRepeat(C, D, feedRows, elIn.every === 'alternate');
    if (reduced.changed) {
      C.splice(reduced.feeds); C.forEach((row) => row.splice(reduced.needles));
      if (D) { D.splice(reduced.feeds); D.forEach((row) => row.splice(reduced.needles)); }
      feedRows.splice(reduced.feeds);
    }
    // a loop yarn that knits is a sinker-loop pile only when a pile is chosen
    // (older clients send no choice: there it always was a pile)
    const pileWanted = input.pile == null ? true : input.pile === 'sinker';
    const roleNotes = resolveRoles(C, D, feedRows, pileWanted);
    const fabricDef = {
      id: 'studio_custom', category: D ? (gating === 'interlock' ? 'interlock' : 'rib') : 'single_jersey',
      structure: { pattern: { C, D }, cam: feedRows.map((f, i) => ({ feed: i + 1, yarn: f.role === 'ground' ? null : f.role })) },
    };
    const st = KP.normaliseStructure(fabricDef);
    const roles = feedRows.map((f) => f.role);
    const family = classify(st, roles, gating);
    const el = elIn;
    const elastane = +el.denier > 0 ? {
      denier: +el.denier, draft: Math.min(4, Math.max(1.5, +el.draft || 2.6)),
      feeds: feedRows.map((f, i) => i).filter((i) => (el.every === 'alternate' ? i % 2 === 0 : true) && feedRows[i].role !== 'loop'),
    } : null;
    const lycra = !!elastane;
    const nb = st.beds.D ? 2 : 1;
    const working = [st.beds.C, st.beds.D].filter(Boolean).reduce((t, g) => t + g[0].filter((x) => x !== '-').length, 0);
    const posNorm = (nb * st.width) / Math.max(1, working);
    const ctx = { st, family, lycra, feedRows, input, gating, elastane, posNorm, calib: null, rate: loopRate(st, feedRows) };
    const rolls = input.calibration && input.calibration.rolls;
    if (Array.isArray(rolls) && rolls.length) {
      const g0 = ground || readYarn({ ne: +rolls[0].ne, fibre: (input.yarn || {}).fibre }, null);
      if (!g0) throw new StudioError('Trial roll 1: give the count (Ne) of the yarn you knitted.');
      ctx.calib = calibrate(ctx, g0, rolls);
    }

    // ── sinker-loop plush (towel terry, velour) ──
    // A loop-yarn feed that KNITS is plated into every needle loop behind the
    // ground yarn and drawn over the high sinker nib. Its weight is set by the
    // sinker height and the two yarns, not by a needle programme, so it is not
    // weighed on a fleece's constants: the plush model is (loop size from the
    // factory's terry records, the 2h pile geometry derived).
    const pileFeed = st.beds.D ? -1 : feedRows.findIndex((f, i) => f.role === 'loop' && st.beds.C[i].includes('K'));
    // ── the machine: profile chosen (or picked) for what the notation asks ──
    ctx.transferDir = (input.machine || {}).transfer_dir === 'left' ? 'left' : 'right';
    // stripes: the yarn each course is knitted in
    const stripeSeq = KM.parseStripe((input.stripes || {}).sequence, feedColours);
    const diaIn = +((input.machine || {}).dia) || 30;
    const req = KM.requirements(st, gating, feedRows, { pile: pileFeed > -1, transferDir: ctx.transferDir, stripe: KM.stripeRequirement(stripeSeq, st.feeds, diaIn) });
    const profile = KM.resolve(input.machine, req);
    ctx.profile = profile;
    // a feeder stripe needs a whole number of stripe repeats round the machine
    if (req.stripe && !KM.needsStriper(req.stripe, profile)) ctx.feederUnit = req.stripe.lcm;
    let plush = null;
    if (pileFeed > -1) {
      // plain courses between the pile courses: the pile is spread over them.
      // Weight follows the number of pile loops per cm², so the course share is
      // carried as the needle arrangement with the same pile density.
      const plainFeeds = feedRows.filter((f, i) => i !== pileFeed && isKnitFeed(st, feedRows, i)).length;
      const pileFeeds = feedRows.filter((f, i) => f.role === 'loop' && st.beds.C[i].includes('K')).length;
      var pileShare = pileFeeds / (pileFeeds + plainFeeds);
      const tgt = +((input.target || {}).gsm);
      if (!(tgt > 0)) throw new StudioError('Plush terry and velour are solved from the finished weight: give a target GSM.');
      const pl = { ...(input.plush || {}) };
      var plushSpread = null;
      if (pileShare < 1) {
        const DENS = { full: 1, alternate: 0.5, checker: 0.5, diagonal: 1 / 3 };
        const want = (DENS[pl.arrangement] || 1) * pileShare;
        const arr = Object.keys(DENS).reduce((b, k) => (Math.abs(DENS[k] - want) < Math.abs(DENS[b] - want) - 1e-9 ? k : b), pl.arrangement && DENS[pl.arrangement] ? pl.arrangement : 'full');
        plushSpread = { pileFeeds, plainFeeds, share: pileShare, want, arrangement: arr, density: DENS[arr] };
        pl.arrangement = arr;
      }
      const fib = FIBRES[(input.yarn || {}).fibre] ? input.yarn.fibre : 'cotton';
      const comp = fib === 'cvc' ? { cotton: 60, polyester: 40 } : /polyester/.test(fib) ? { polyester: 100 } : { [['viscose', 'modal'].includes(fib) ? fib : 'cotton']: 100 };
      const py0 = feedRows[pileFeed].yarn;
      plush = TE.analyzePlushTerry({
        fabricId: pl.cut ? 'velour_plush' : 'terry_fabric', gsm: tgt, gauge: +((input.machine || {}).gauge) || 20,
        composition: { fibers: comp }, groundNe: ground ? ground.ne : null, pileNe: py0 ? py0.ne : null,
        pileHeightMm: +pl.sinker_mm > 0 ? +pl.sinker_mm : null, cut: !!pl.cut, loopArrangement: pl.arrangement,
      });
      if (!plush) throw new StudioError('The plush model could not solve this weight.');
      ctx.calib = null;
    }

    // solver over counts when no ground yarn is given
    let solver = null, S, finish = null;
    if (plush) {
      const fib = FIBRES[(input.yarn || {}).fibre] ? input.yarn.fibre : 'cotton';
      const yOf = (y) => readYarn(y.denier ? { denier: y.denier, fibre: 'polyester_filament' } : { ne: y.ne, fibre: fib }, null);
      const gY = plush.yarns[0], pY = plush.yarns[1];
      const groundP = yOf(gY), pileY = yOf(pY);
      feedRows[pileFeed] = { ...feedRows[pileFeed], yarn: pileY, sl_mm: pY.sl_mm };
      const ctxP = { ...ctx, input: { ...input, machine: { ...(input.machine || {}), gauge: plush.machine.gauge, sl_mm: gY.sl_mm }, target: {} } };
      S = solve(ctxP, groundP);
      const mb = plush.mass_balance, cal = plush.calibration;
      const sd = cal.tightness_sd / cal.tightness_factor;
      Object.assign(S, {
        gsm: mb.gsm_at_chosen_counts, gsmRange: [mb.gsm_at_chosen_counts * (1 - sd), mb.gsm_at_chosen_counts * (1 + sd)], target: +input.target.gsm,
        wpc: mb.wales_per_cm, cpc: mb.courses_per_cm, lref: gY.sl_mm, slRange: null,
        slSource: `ground + pile plated at the factory terry tightness (${cal.factory_rows} rows)`,
        tfGround: Math.sqrt(groundP.tex + pileY.tex) / (gY.sl_mm / 10),
      });
      S.width = S.needles / S.wpc / 2.54;
      S.widthRange = [S.width * (1 - sd), S.width * (1 + sd)];
      S.KS = { ...S.KS, basis: 'not used for plush — weight from the plush mass balance' };
      S.KW = { ...S.KW, basis: `not used for plush — wales per cm ${cal.wales_per_cm_per_gauge} × gauge, from the factory terry records` };
      // the feed carries two yarns: show both
      const row = (role, y, sl, share, tf, tension) => {
        const courseM = (S.needles * sl) / 1000;
        return { feed: pileFeed + 1, role, yarn: y.label, fibre: y.fibre_label, tex: r2(y.tex), sl_mm: r2(sl), sl_source: 'plush model', tf, share: 1,
          course_length_m: r3(courseM), yarn_speed_m_min: r1(courseM * S.rpm), mass_share_pct: share, tension_cN: tension.map((k) => r1(k * y.tex)) };
      };
      S.feeds = [
        row('ground (plated)', groundP, gY.sl_mm, gY.share_pct, r1(S.tfGround), [0.12, 0.16]),
        row('pile', pileY, pY.sl_mm, pY.share_pct, null, [0.08, 0.10]),
      ].map((f) => ({ ...f, mass: 0, elastane_mass: 0 }));
      // plain courses between the pile courses: ground yarn alone, same loop
      feedRows.forEach((f, i) => {
        if (i === pileFeed || !isKnitFeed(st, feedRows, i)) return;
        const r = row('ground (plain course)', groundP, gY.sl_mm, null, r1(Math.sqrt(groundP.tex) / (gY.sl_mm / 10)), [0.12, 0.16]);
        S.feeds.push({ ...r, feed: i + 1, mass: 0, elastane_mass: 0 });
      });
      S.composition = plush.yarns.filter((y) => y.share_pct).map((y) => ({ part: y.role === 'elastane' ? y.label : `${y.role}: ${y.label}`, pct: y.share_pct }));
      const gPerRev = (S.feeders / st.feeds) * S.feeds.reduce((t, f) => t + f.course_length_m * f.tex, 0) / 1000;
      S.kgh = (gPerRev * S.rpm * 60 * S.eff) / 1000;
    } else {
      if (auto && !((input.target || {}).gsm > 0)) throw new StudioError('Give the ground yarn count, or a target GSM so the count can be solved.');
      const fibre = FIBRES[(input.yarn || {}).fibre] ? input.yarn.fibre : 'cotton';
      const run = () => { if (auto) { const pick = chooseSetup(ctx, fibre); solver = pick.solver; return pick.S; } return solve(ctx, ground); };
      ctx.finishK = 1;
      S = run();
      // brushing tears yarn out: weigh the design again with what is left
      finish = finishModel(ctx, S);
      if (Math.abs(finish.k - 1) > 1e-6) { ctx.finishK = finish.k; S = run(); }
    }

    const transfers = st.beds.C.reduce((t, row) => t + row.filter((x) => x === 'E').length, 0);
    const noR = (g) => g && g.map((r) => r.map((x) => (x === 'E' || x === 'R' ? 'M' : x)));
    const T = { C: KP.tracksOf(noR(st.beds.C)), D: KP.tracksOf(noR(st.beds.D)) };
    ctx.transfers = transfers;
    let checks = checksFor(ctx, S, T);
    if (plush) {
      const cal = plush.calibration, gc = plush.gauge_check;
      // the ground-yarn tightness window and gauge fit are a single yarn's; a
      // plush loop carries two yarns and has its own measured tightness
      checks = checks.filter((c) => !/^Tightness factor|GG is (too fine|coarse)|^Per-feeder stitch lengths/.test(c.text));
      const add = (level, text) => checks.push({ level, text });
      add('ok', `Ground and pile plated at the factory's terry tightness: √(tex ground + tex pile) ÷ loop = ${r1(S.tfGround)} (${cal.factory_rows} factory rows, spread ±${r1(cal.tightness_sd / cal.tightness_factor * 100)}%).`);
      add(gc.ok ? 'ok' : 'warn', gc.ok
        ? `${gc.gauge} GG takes the plated bundle (${gc.bundle_tex} tex, limit ${gc.bundle_limit_tex} tex — modelled from mill practice).`
        : `${gc.gauge} GG is too fine for the plated bundle (${gc.bundle_tex} tex against a ${gc.bundle_limit_tex} tex limit, modelled).${gc.suggested_gauge ? ` Use ${gc.suggested_gauge} GG.` : ''}`);
      plush.warnings.forEach((w) => add('warn', w));
      plush.risks.forEach((r) => add('note', `${r.topic}: ${r.note}`));
      const order = { error: 0, warn: 1, note: 2, ok: 3 };
      checks.sort((a, b) => order[a.level] - order[b.level]);
    }
    // machine fit, build range and the set-up it implies
    const mPlan = KM.plan(profile, st, gating, S.needles, S.feeders);
    {
      const mc = KM.fit(profile, req);
      const add = (level, text) => mc.push({ level, text });
      if (!mc.some((c) => c.level === 'error' || c.level === 'warn')) add('ok', `${profile.label}${profile.auto ? ' (picked for this design)' : ''}: knits the design as drawn — ${req.tracks.C} cylinder sequence${req.tracks.C > 1 ? 's' : ''}${req.tracks.D ? `, ${req.tracks.D} dial` : ''}.`);
      const [g0, g1] = profile.gauges, [d0, d1] = profile.dia;
      if (S.gauge < g0 || S.gauge > g1) add('warn', `${S.gauge} GG is outside the gauges a ${profile.label.toLowerCase()} is usually built in (${g0}–${g1} GG, typical build).`);
      if (S.dia < d0 || S.dia > d1) add('warn', `${S.dia}" is outside the diameters this class of machine is usually built in (${d0}–${d1}").`);
      if (S.feeders > 1.6 * profile.fpi * S.dia) add('warn', `${S.feeders} feeders on ${S.dia}" is ${r1(S.feeders / S.dia)} per inch — more than this class of machine carries (about ${profile.fpi} per inch, typical build).`);
      const v = (Math.PI * S.dia * 0.0254 * S.rpm) / 60, vmax = KM.speedLimit(profile).max_m_s;
      if (v > vmax) add('warn', `${S.rpm} RPM on ${S.dia}" is ${r2(v)} m/s at the cylinder surface — above the ${vmax} m/s this class of machine runs at (${profile.sf} RPM × inch, typical). Expect press-off, needle and latch wear${profile.selection === 'needle' ? ', and selection errors' : ''}.`);
      if (D && profile.timing && profile.timing.length === 1 && gating === 'rib') add('note', `${profile.label} runs ${profile.timing[0]} timing only.`);
      if (stripeSeq) {
        const sp = KM.stripePlan(stripeSeq, st.feeds, S.feeders, profile, Array(st.feeds).fill(1));
        if (sp.method === 'striper' && sp.fingers_needed > (profile.striper || 1)) add('error', `Stripes on ${S.feeders} feeders: a feeder has to change between ${sp.fingers_needed} yarns — ${profile.striper ? `the stripers have ${profile.striper} fingers` : 'this machine has no stripers'}.${!profile.striper && sp.courses <= 200 ? ` Or make the feeders a multiple of ${KM.stripeRequirement(stripeSeq, st.feeds).lcm} so every feeder keeps one yarn.` : ''}`);
        else if (sp.method === 'feeder stripe') add('ok', `Feeder stripe: ${sp.courses}-course repeat in ${new Set(stripeSeq).size} yarns — every feeder keeps one yarn (${S.feeders} feeders = ${S.feeders / sp.courses} stripe repeats per revolution).`);
        else add('ok', `Striper stripe: each feeder changes between up to ${sp.fingers_needed} yarns, the repeat takes ${sp.revolutions_per_repeat} revolution${sp.revolutions_per_repeat > 1 ? 's' : ''}.`);
        if (+((input.machine || {}).feeders) > 0 && sp.method === 'striper' && !profile.striper) add('note', 'Your feeder count is not a multiple of the stripe repeat, so the stripe cannot be threaded feeder by feeder.');
      }
      checks = checks.concat(mc);
    }
    {
      const extra = [...roleNotes];
      if (plush && plushSpread) extra.push({ level: 'warn', text: `Pile on ${plushSpread.pileFeeds} of ${plushSpread.pileFeeds + plushSpread.plainFeeds} knitting feeds: the plain feeds knit ground-only jersey courses between the pile courses. Weighed as ${Math.round(plushSpread.want * 100)}% pile loops per cm² — the plush model's "${plushSpread.arrangement}" arrangement (${Math.round(plushSpread.density * 100)}%); the pile stands in bands, one pile course in ${r1(1 / plushSpread.share)}.` });
      if (finish || plush) extra.push(...finishChecks(finish || { brush: ((input.finish || {}).brush) || 'none', legacy: !(input.finish || {}).brush }, family, plush));
      if (extra.length) {
        checks = checks.concat(extra);
        const order = { error: 0, warn: 1, note: 2, ok: 3 };
        checks.sort((a, b) => order[a.level] - order[b.level]);
      }
    }
    if (solver) {
      const v = { level: solver.verdict.level === 'ok' ? 'ok' : 'warn', text: solver.verdict.text };
      const at = checks.findIndex((c) => c.level !== 'error');
      checks.splice(at < 0 ? checks.length : at, 0, v);
    }
    let match = matchCatalogue(st);
    // a loopback and a raised fleece are knitted alike: the finish tells them apart
    if (match && family === 'fleece' && finish && ['french_terry', 'fleece_3_thread'].includes(match.id)) {
      const other = byId(finish.brush === 'none' ? 'french_terry' : 'fleece_3_thread');
      if (other && JSON.stringify(KP.normaliseStructure(other).beds) === JSON.stringify(KP.normaliseStructure(match).beds)) match = other;
    }
    const anchorDef = S.A.def;
    const isAnchor = match && match.id === anchorDef.id;
    const M0 = S.model;
    const myM = posNorm * mean(KP.feedConsumption(st, S.pitch, S.lref).map((c, i) => c.share * (((S.feeds[i] || S.feeds[0]).tex) / S.ground.tex)));
    const ratio = myM / S.A.M;
    const partPlated = S.phi > 0 && S.phi < 1;
    const unmeasured = M0.mu > 0 || partPlated || M0.tau / TUCK_ANCHOR > TUCK_CAP || S.fibre.ks === 1 && S.ground.fibre !== 'cotton' || family === 'fleece' || (S.pack.basis && !S.pack.measured);
    const reasons = [...M0.notes, ...(S.pack.basis ? [S.pack.basis] : [])];
    if (S.ground.fibre !== 'cotton') reasons.push(`fibre: ${S.fibre.basis}`);
    if (partPlated) reasons.push(S.KS.basis);
    const confidence = plush
      ? { level: 'estimate', why: `Sinker-loop plush: ${plush.calibration.note}` }
      : ctx.calib
      ? { level: 'verified', why: `Calibrated on your ${ctx.calib.n} trial roll${ctx.calib.n > 1 ? 's' : ''}: Ks ${r1(ctx.calib.ks)} (the factory constants alone would give ${r1(S.modelKS)}), Kw ${r2(ctx.calib.kw)} (${r2(S.modelKW)}). Valid for this structure, fibre and plating, finished state.` }
      : isAnchor && !unmeasured && Math.abs(M0.kwF - 1) < 0.001 && S.ground.fibre === 'cotton'
      ? { level: 'calibrated', why: `This is ${anchorDef.name} — the structure the family constants were measured on.` }
      : !unmeasured && M0.tau / TUCK_ANCHOR <= 1 && Math.abs(ratio - 1) <= 0.15
        ? { level: 'close', why: `A ${FAMILY[family].label.toLowerCase()} structure.${reasons.length ? ' ' + reasons.join('; ') + '.' : ''} The measured family constants carry over with these corrections.` }
        : { level: 'estimate', why: `No factory records for this structure.${reasons.length ? ' ' + reasons.join('; ') + '.' : ''} Weight and width are carried over from ${anchorDef.name} and corrected for the yarn it lays (${r1((ratio - 1) * 100)}%). Knit a trial roll and enter the measured stitch length, GSM and width to confirm.` };

    // quality belts: feeds that take the same yarn per revolution run off one VDQ
    const groups = [];
    S.feeds.forEach((f) => {
      const g0 = groups.find((g) => Math.abs(g.course_length_m / f.course_length_m - 1) <= 0.015);
      if (g0) g0.feeds.push(f.feed); else groups.push({ course_length_m: f.course_length_m, yarn_speed_m_min: f.yarn_speed_m_min, feeds: [f.feed] });
    });
    const pts = (((input.machine || {}).vdq || {}).points || []).filter((p) => +p.reading > 0 && +p.course_length_m > 0);
    let vdqMethod = null;
    if (pts.length >= 2) {
      const [a, b] = pts;
      const slope = (b.reading - a.reading) / (b.course_length_m - a.course_length_m);
      if (Number.isFinite(slope) && slope > 0) {
        groups.forEach((g) => { g.vdq_reading = r2(+a.reading + slope * (g.course_length_m - a.course_length_m)); });
        vdqMethod = 'straight line through your two reference settings';
      }
    } else if (pts.length === 1) {
      const k = pts[0].reading / pts[0].course_length_m;
      groups.forEach((g) => { g.vdq_reading = r2(k * g.course_length_m); });
      vdqMethod = 'in proportion to your one reference setting (assumes the scale reads from zero — give a second point to remove that assumption)';
    }

    // course inclination of a tube knitted by many feeders (geometry)
    const knitFeeds = Array.from({ length: st.feeds }, (_, i) => i).filter((i) => [st.beds.C, st.beds.D].filter(Boolean).some((b) => b[i].includes('K'))).length;
    const coursesPerRev = (S.feeders / st.feeds) * knitFeeds / (st.beds.D ? 2 : 1);
    const helix = Math.atan((coursesPerRev / S.cpc) / (Math.PI * S.dia * 2.54)) * 180 / Math.PI;

    const W = plush
      ? (() => { const t = plush.calibration.tightness_factor * 10, d = plush.calibration.tightness_sd * 10; return { p5: r2(t - 2 * d), q1: r2(t - 0.67 * d), med: r2(t), q3: r2(t + 0.67 * d), p95: r2(t + 2 * d), n: plush.calibration.factory_rows, basis: `${plush.calibration.factory_rows} factory terry rows, ground + pile plated` }; })()
      : tfWindow(family, lycra, ctx.rate);
    return {
      success: true,
      structure: {
        bed: D ? 'double' : 'single', gating, feeds: st.feeds, needles_per_repeat: st.width, beds: st.beds, roles, roles_drawn: feedRows.map((f) => f.drawn || f.role),
        family: plush ? 'plush' : family, family_label: plush ? 'Sinker-loop plush (terry / velour)' : FAMILY[family].label,
        anchor: plush ? { id: 'terry', name: 'factory loopback terry (loop size)' } : { id: anchorDef.id, name: anchorDef.name },
        match: plush ? { id: plush.variant.id, name: plush.variant.name } : match ? { id: match.id, name: match.name } : null,
        yarn_vs_anchor_pct: r1((ratio - 1) * 100),
        reduced: reduced.changed ? { from: `${reduced.from[0]} feeds × ${reduced.from[1]} needles`, to: `${st.feeds} feeds × ${st.width} needles` } : null,
        confidence,
      },
      checks,
      ok_to_knit: !checks.some((c) => c.level === 'error'),
      setup: {
        tracks: {
          C: T.C ? { count: T.C.sequences.length, setout: T.C.setout.join(' '), sequences: T.C.sequences } : null,
          D: T.D ? { count: T.D.sequences.length, setout: T.D.setout.join(' '), sequences: T.D.sequences } : null,
        },
        cam_chart: KP.camChart(st, T).map((r, i) => ({ ...r, role: roles[i] })),
        timing: D ? (gating === 'interlock'
          ? 'Synchronised timing (dial and cylinder knock over together) — the setting for interlock gating.'
          : st.beds.D.some((row) => row.includes('T'))
            ? 'The dial tucks: these structures are usually run with synchronised timing. Plain rib feeds run delayed (rib) timing for a tighter, finer loop.'
            : 'Delayed (rib) timing: the dial knocks over a few needles after the cylinder and draws its loop from the cylinder\'s — a tighter, finer rib.') : null,
      },
      yarn: {
        ground: { count: S.ground.label, tex: r2(S.ground.tex), fibre: S.ground.fibre_label, source: auto || (plush && !ground) ? 'solved' : 'your input' },
        feeds: S.feeds.map(({ mass, elastane_mass, ...f }) => f),
        composition: S.composition,
      },
      fabric: {
        gsm: Math.round(S.gsm), gsm_range: S.gsmRange.map(Math.round), target_gsm: S.target,
        sl_mm: r2(S.lref), sl_source: S.slSource, sl_range_mm: S.slRange,
        tf: r1(S.tfGround), tf_window: W,
        wpi: r1(S.wpc * 2.54), cpi: r1(S.cpc * 2.54), wpc: r1(S.wpc), cpc: r1(S.cpc),
        width_open_in: r1(S.width), width_range_in: S.widthRange.map(r1), tube_in: r1(S.width / 2), target_width_in: S.tW,
        kw: r2(S.KW.med), kw_basis: S.KW.basis, ks: r1(S.KS.med), ks_basis: S.KS.basis,
        calibration: ctx.calib ? {
          n: ctx.calib.n, ks: r2(ctx.calib.ks), kw: r3(ctx.calib.kw), model_ks: r2(S.modelKS), model_kw: r3(S.modelKW),
          ks_vs_model_pct: r1((ctx.calib.ks / S.modelKS - 1) * 100), kw_vs_model_pct: r1((ctx.calib.kw / S.modelKW - 1) * 100),
          scatter_pct: r1(ctx.calib.spread * 100), rolls: ctx.calib.per.map((x) => ({ ...x, ks: r2(x.ks), kw: r3(x.kw) })),
        } : null,
        structure_model: { tuck_share: r2(S.model.tau), miss_share: r2(S.model.mu), kw_factor: r2(S.model.kwF), ks_factor: r2(S.model.ksF), fibre_ks: r2(S.fibre.ks), fibre_kw: r2(S.fibre.kw), plating: r2(S.phi), loop_rate: r2(ctx.rate), hold_packing_ks: r2(S.pack.ks), hold_packing_kw: r2(S.pack.kw), notes: S.pack.basis ? [...S.model.notes, S.pack.basis] : S.model.notes },
        state: 'finished (dyed and compacted), as the factory records measure it',
        formulas: {
          gsm: plush ? plush.mass_balance.formula : `GSM = Ks × mean(s·ℓ·tex) ÷ (10 ℓ² M), Ks = ${r1(S.KS.med)} (family × structure ${r2(S.model.ksF)} × fibre ${r2(S.fibre.ks)})`,
          width: plush ? `open width = needles ÷ wales per cm ÷ 2.54 = ${S.needles} ÷ ${r2(S.wpc)} ÷ 2.54` : `open width = needles × working share × ℓ ÷ (Kw × 2.54) = ${S.needles} × ${r2(S.workFrac)} × ${r3(S.lref / 10)} ÷ (${r2(S.KW.med)} × 2.54)`,
        },
      },
      machine: {
        machine_label: profile.label, gauge: S.gauge, gauge_source: +((input.machine || {}).gauge) > 0 ? 'your machine' : S.fg ? `factory records (${S.fg.share_pct}% of ${S.fg.n} rows at this count)` : 'cover factor',
        gauge_recommended: S.recGauge, gauge_fit: S.gfit,
        dia: S.dia, dia_source: S.diaSource, needles: S.needles, feeders: S.feeders, feeders_per_repeat: st.feeds,
        repeats_round: r2(S.feeders / st.feeds), rpm: S.rpm, efficiency_pct: Math.round(S.eff * 100),
        kg_per_hour: r2(S.kgh), kg_per_day: r1(S.kgh * 24),
        production_formula: 'kg/h = RPM × 60 × efficiency × (feeders ÷ feeds per repeat) × Σ(course length × tex) ÷ 10⁶',
      },
      vdq: {
        groups, method: vdqMethod,
        note: 'Course length is the yarn one feeder takes in one revolution — the figure a yarn-length meter reads and the quality pulley sets. It is the same on every make; the VDQ scale is not, so give one or two settings you already run to turn it into scale readings.',
      },
      spirality: !D ? {
        helix_deg: r2(helix), courses_per_rev: r1(coursesPerRev),
        note: 'Course inclination from the number of feeders (geometry). Yarn twist adds to or offsets it — the main calculator models the twist part.',
      } : null,
      solver,
      machine_setup: {
        profile: KM.describe(profile),
        requirements: req,
        alternatives: KM.ORDER.filter((id) => !KM.fit(KM.PROFILES[id], req).some((c) => c.level === 'error' || c.level === 'warn')).map((id) => ({ id, label: KM.PROFILES[id].label })),
        beds: mPlan,
        transfer_dir: req.transfer ? ctx.transferDir : null,
        speed: { rpm: S.rpm, surface_m_s: r2((Math.PI * S.dia * 0.0254 * S.rpm) / 60), max_m_s: KM.speedLimit(profile).max_m_s, speed_factor: profile.sf, basis: 'RPM × diameter of this class of machine (typical build, modelled)' },
        feeds: KM.feedPlan(profile, st, feedRows, { elastaneFeeds: elastane ? elastane.feeds : [], pileFeed, striper: KM.needsStriper(req.stripe, profile) }),
        stripes: stripeSeq ? (() => {
          const sp = KM.stripePlan(stripeSeq, st.feeds, S.feeders, profile, S.feeds.length === st.feeds ? S.feeds.map((f) => f.mass || f.mass_share_pct || 1) : Array(st.feeds).fill(1));
          // stripe height in the cloth: the design repeat's feeds make its face courses
          const kf = Array.from({ length: st.feeds }, (_, i) => i).filter((i) => [st.beds.C, st.beds.D].filter(Boolean).some((g) => g[i].includes('K'))).length;
          const coursesPerFeed = kf / st.feeds / (st.beds.D ? 2 : 1) * (st.beds.D ? 2 : 1);
          sp.repeat_mm = r1((sp.courses * coursesPerFeed / S.cpc) * 10);
          sp.runs = sp.runs.map((x) => ({ ...x, mm: r1((x.courses * coursesPerFeed / S.cpc) * 10) }));
          return sp;
        })() : null,
      },
      finish: finish ? {
        brushed: finish.brush, passes: finish.passes, sheared: finish.sheared,
        fabric_loss_pct: r1(finish.loss * 100), loop_yarn_raised_pct: finish.fleece ? r1(finish.loopLost * 100) : null,
        nap_mm: r2(finish.pile), gsm_before_brushing: Math.round(S.gsm / (1 - finish.loss)), weight_factor: r3(finish.k),
        basis: 'modelled: ~3.5% of the loop yarn raised per pass (fleece), ~1.2% surface fibre per pass on a side with no floats; nap from staple and passes',
      } : null,
      plush_spread: plushSpread ? { pile_feeds: plushSpread.pileFeeds, plain_feeds: plushSpread.plainFeeds, pile_density: r2(plushSpread.want), arrangement: plushSpread.arrangement } : null,
      plush: plush ? {
        variant: plush.variant, declaration: plush.declaration, pile: plush.pile, loop: plush.loop, shearing: plush.shearing,
        mass_balance: plush.mass_balance, gauge_check: plush.gauge_check, plating: plush.plating, absorbency: plush.absorbency,
        thermal: plush.thermal, process_route: plush.process_route, machine: plush.machine, composition: plush.composition,
      } : null,
      legend: {
        measured: 'factory R&D records',
        calculated: 'formula on your inputs',
        estimated: 'family constant carried to a new structure, or a rule of thumb',
      },
    };
  } catch (e) {
    if (e instanceof StudioError) return { success: false, error: e.message };
    throw e;
  }
}

module.exports = { analyse, listTemplates, FIBRES, ROLES, LIMITS, TF_WINDOW };
