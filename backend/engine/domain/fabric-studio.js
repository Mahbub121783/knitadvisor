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
function tfWindow(family, lycra) {
  const a = TF_WINDOW[`${family}|${lycra ? 'L' : 'P'}`], b = TF_WINDOW[`${family}|P`];
  const w = a && a.n >= 12 ? a : b;
  return w ? { ...w, basis: `${w.n} factory records (${family.replace('_', ' ')}${w === a && lycra ? ', lycra' : ''})` } : null;
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
  return {
    id: f.id, name: f.name, category: f.category,
    bed: D ? 'double' : 'single', gating: D ? (f.category === 'interlock' && !ilClash ? 'interlock' : 'rib') : 'single',
    note: ilClash ? 'Listed with the interlock family, but cylinder and dial needles rise together at one feed: this programme runs on rib gating.' : null,
    grid: { C, D },
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
    row.forEach((x, j) => { if (!['K', 'T', 'M', '-'].includes(x)) throw new StudioError(`${name}: feed ${i + 1}, needle ${j + 1} is "${x}". Use K, T, M or -.`); });
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

function matchCatalogue(st) {
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
function anchorMass(family, pitchMm, slMm) {
  const f = byId(FAMILY[family].anchor);
  const t = KP.normaliseStructure(f);
  const roles = templateOf(f).roles;
  const cons = KP.feedConsumption(t, pitchMm, slMm);
  return { def: f, M: mean(cons.map((c, i) => c.share * (roles[i] === 'loop' ? ANCHOR_LOOP_TEX_RATIO : 1))) };
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

function solve(ctx, ground) {
  const { st, family, lycra, feedRows, input } = ctx;
  const mach = input.machine || {};
  const M = KP.MACHINE[FAMILY[family].machine];
  const phi = platingFraction(ctx);
  const fibre = fibreFactor(ground.fibre);
  const model = structureModel(ctx);
  const KS0 = blend(KP.calFor('ks', family, false), KP.calFor('ks', family, true), phi);
  const KW0 = blend(KP.calFor('kw', family, false), KP.calFor('kw', family, true), phi);
  let KS = scaled(KS0, fibre.ks * model.ksF);
  let KW = scaled(KW0, fibre.kw * model.kwF);
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
  const gauge = +mach.gauge > 0 ? +mach.gauge : recGauge;
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
    return { gsm: (ks * Y) / (10 * (lk(lref) / 10) ** 2 * den), cons, A };
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
  const feeders = +mach.feeders > 0 ? +mach.feeders : Math.max(feedsRep, Math.round((M.fpi * dia) / feedsRep) * feedsRep);
  const rpm = +mach.rpm > 0 ? +mach.rpm : Math.round(M.sf / dia);
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
      feed: i + 1, role: f.role, yarn: yarns[i].label, fibre: yarns[i].fibre_label, tex: r2(yarns[i].tex),
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
  const cpc = (KS.med / (bedsLoops * KW.med)) / lcm;

  // TF
  const groundIdx = feedRows.findIndex((f, i) => ['ground', 'face'].includes(f.role) && [st.beds.C, st.beds.D].filter(Boolean).some((g) => g[i].includes('K')));
  const tfGround = Math.sqrt(ground.tex) / (slOf(groundIdx >= 0 ? groundIdx : 0) / 10);

  return {
    ground, gauge, recGauge, fg, coverGauge, pitch, lref, slSource, slRange, gsm, gsmRange, target,
    KS, KW, modelKS, modelKW, model, fibre, phi, A: at.A, dia, diaSource, needles, width, widthRange: [widthAt(dia, KW.q3), widthAt(dia, KW.q1)], workFrac,
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
function checksFor(ctx, S, T) {
  const { st, family, input, feedRows } = ctx;
  const mach = input.machine || {};
  const out = KP.structureChecks(st, T, S.M).filter((c) => !/needle track/.test(c.text));
  const add = (level, text) => out.push({ level, text });
  const tC = T.C ? T.C.sequences.length : 0, tD = T.D ? T.D.sequences.length : 0;
  const capC = +mach.tracks_cyl > 0 ? +mach.tracks_cyl : 4, capD = +mach.tracks_dial > 0 ? +mach.tracks_dial : 2;
  if (tC > capC) add('error', `Cylinder needs ${tC} needle tracks; the machine has ${capC}. Simplify the repeat or use an electronic (jacquard) selection machine.`);
  else if (T.C) add('ok', `Cylinder: ${tC} track${tC > 1 ? 's' : ''} needed, machine has ${capC}.`);
  if (T.D) {
    if (tD > capD) add('error', `Dial needs ${tD} needle tracks; the machine has ${capD}.`);
    else add('ok', `Dial: ${tD} track${tD > 1 ? 's' : ''} needed, machine has ${capD}.`);
  }
  // interlock gating: needle j of the cylinder faces needle j of the dial
  if (st.beds.D && ctx.gating === 'interlock') {
    for (let i = 0; i < st.feeds; i++) for (let j = 0; j < st.width; j++) {
      const c = st.beds.C[i][j], d = st.beds.D[i][j];
      if ((c === 'K' || c === 'T') && (d === 'K' || d === 'T')) add('error', `Feed ${i + 1}, needle ${j + 1}: on interlock gating the cylinder and dial needles face each other — both cannot rise at the same feed. Move one to the other track.`);
    }
  }
  // hook load: loops held in one hook against the space between needles
  const d = S.gfit.yarn_d_mm;
  let worst = { idx: 0, loops: 1, where: '' };
  for (const [b, name] of [['C', 'cylinder'], ['D', 'dial']]) {
    const g = st.beds[b]; if (!g) continue;
    for (let j = 0; j < st.width; j++) {
      const col = g.map((r) => r[j]); if (col.every((x) => x === '-')) continue;
      const loops = 1 + maxRun(col, 'T');
      const idx = (loops * d) / S.pitch;
      if (idx > worst.idx) worst = { idx, loops, where: `${name} needle ${j + 1}` };
    }
  }
  if (worst.loops > 1) {
    const msg = `${worst.where}: ${worst.loops} loops in one hook at ${S.gauge} GG with ${S.ground.label} — hook load ${r2(worst.idx)} (yarn Ø × loops ÷ needle pitch; estimate).`;
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
  const W = tfWindow(family, ctx.lycra);
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
    const ctx = { st, family, lycra, feedRows, input, gating, elastane, posNorm, calib: null };
    const rolls = input.calibration && input.calibration.rolls;
    if (Array.isArray(rolls) && rolls.length) {
      const g0 = ground || readYarn({ ne: +rolls[0].ne, fibre: (input.yarn || {}).fibre }, null);
      if (!g0) throw new StudioError('Trial roll 1: give the count (Ne) of the yarn you knitted.');
      ctx.calib = calibrate(ctx, g0, rolls);
    }

    // solver over counts when no ground yarn is given
    let solver = null, S;
    if (auto) {
      if (!((input.target || {}).gsm > 0)) throw new StudioError('Give the ground yarn count, or a target GSM so the count can be solved.');
      const W = tfWindow(family, lycra);
      const fibre = FIBRES[(input.yarn || {}).fibre] ? input.yarn.fibre : 'cotton';
      const opts = [];
      for (const ne of COUNTS) {
        try {
          const s = solve(ctx, { tex: 590.5 / ne, ne, label: `${ne}s Ne`, fibre, fibre_label: FIBRES[fibre].label });
          const spread = W ? Math.max(0.3, W.q3 - W.q1) : 1;
          let score = W ? Math.abs(s.tfGround - W.med) / spread : 0;
          if (s.gfit.fit !== 'good') score += 2;
          if (s.lref < 1.8 || s.lref > 7) score += 5;
          opts.push({ s, score });
        } catch (e) { if (!(e instanceof StudioError)) throw e; }
      }
      opts.sort((a, b) => a.score - b.score);
      if (!opts.length) throw new StudioError('No commercial count reaches this GSM on this structure.');
      S = opts[0].s;
      solver = {
        basis: W ? `count chosen so the tightness factor sits nearest the factory median (${W.med}, ${W.basis})` : 'nearest workable count',
        options: opts.slice(0, 4).map(({ s, score }) => ({
          count: s.ground.label, sl_mm: r2(s.lref), tf: r1(s.tfGround), gauge: s.gauge, gauge_fit: s.gfit.fit, score: r2(score),
        })),
      };
    } else S = solve(ctx, ground);

    const T = { C: KP.tracksOf(st.beds.C), D: KP.tracksOf(st.beds.D) };
    const checks = checksFor(ctx, S, T);
    const match = matchCatalogue(st);
    const anchorDef = S.A.def;
    const isAnchor = match && match.id === anchorDef.id;
    const M0 = S.model;
    const myM = posNorm * mean(KP.feedConsumption(st, S.pitch, S.lref).map((c, i) => c.share * ((S.feeds[i].tex) / S.ground.tex)));
    const ratio = myM / S.A.M;
    const partPlated = S.phi > 0 && S.phi < 1;
    const unmeasured = M0.mu > 0 || partPlated || M0.tau / TUCK_ANCHOR > TUCK_CAP || S.fibre.ks === 1 && S.ground.fibre !== 'cotton' || family === 'fleece';
    const reasons = [...M0.notes];
    if (S.ground.fibre !== 'cotton') reasons.push(`fibre: ${S.fibre.basis}`);
    if (partPlated) reasons.push(S.KS.basis);
    const confidence = ctx.calib
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
    const knitFeeds = S.feeds.filter((f, i) => [st.beds.C, st.beds.D].filter(Boolean).some((b) => b[i].includes('K'))).length;
    const coursesPerRev = (S.feeders / st.feeds) * knitFeeds / (st.beds.D ? 2 : 1);
    const helix = Math.atan((coursesPerRev / S.cpc) / (Math.PI * S.dia * 2.54)) * 180 / Math.PI;

    const W = tfWindow(family, lycra);
    return {
      success: true,
      structure: {
        bed: D ? 'double' : 'single', gating, feeds: st.feeds, needles_per_repeat: st.width, beds: st.beds, roles,
        family, family_label: FAMILY[family].label,
        anchor: { id: anchorDef.id, name: anchorDef.name },
        match: match ? { id: match.id, name: match.name } : null,
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
        ground: { count: S.ground.label, tex: r2(S.ground.tex), fibre: S.ground.fibre_label, source: auto ? 'solved' : 'your input' },
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
        structure_model: { tuck_share: r2(S.model.tau), miss_share: r2(S.model.mu), kw_factor: r2(S.model.kwF), ks_factor: r2(S.model.ksF), fibre_ks: r2(S.fibre.ks), fibre_kw: r2(S.fibre.kw), plating: r2(S.phi), notes: S.model.notes },
        state: 'finished (dyed and compacted), as the factory records measure it',
        formulas: {
          gsm: `GSM = Ks × mean(s·ℓ·tex) ÷ (10 ℓ² M), Ks = ${r1(S.KS.med)} (family × structure ${r2(S.model.ksF)} × fibre ${r2(S.fibre.ks)})`,
          width: `open width = needles × working share × ℓ ÷ (Kw × 2.54) = ${S.needles} × ${r2(S.workFrac)} × ${r3(S.lref / 10)} ÷ (${r2(S.KW.med)} × 2.54)`,
        },
      },
      machine: {
        machine_label: S.M.label, gauge: S.gauge, gauge_source: +((input.machine || {}).gauge) > 0 ? 'your machine' : S.fg ? `factory records (${S.fg.share_pct}% of ${S.fg.n} rows at this count)` : 'cover factor',
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
