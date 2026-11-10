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
const KF = require('./knit-formation');
const KR = require('./knit-relax');
const YC = require('./yarn-character');
const { SPINNING_SYSTEMS } = require('./yarn-engine');
const TE = require('./terry-engine');
const { FABRIC_DERIVATIVES } = require('../catalog/fabric-derivatives');
const { FACTORY_RECORDS } = require('../catalog/factory-dataset');

// ── how right the Studio is: cross-validated on the factory records (tools/studio-crossval.js) ──
// Every weight and width carries the range that 80 % of comparable cloths fell in when the
// Studio predicted them WITHOUT having seen them, and how often it landed within ±5 %.
let ACCURACY = null;
try { ACCURACY = require('../catalog/studio-accuracy.json'); } catch (_) { ACCURACY = null; }
const ACC_GROUP = { single_jersey: 'single_jersey', heavy_jersey: 'heavy_jersey', rib_1x1: 'rib_1x1', rib_2x2: 'rib_2x2', lacoste_single: 'lacoste_single', interlock: 'interlock', fleece_3_thread: 'fleece_3_thread', waffle_knit: 'waffle_knit' };
const ACC_FAMILY_GROUP = { single_jersey: 'single_jersey', pique: 'lacoste_single', rib: 'rib_1x1', interlock: 'interlock', fleece: 'fleece_3_thread' };
const ACC_FAMILY_FAB = { single_jersey: null, pique: 'pique', rib: 'rib', interlock: 'interlock', fleece: 'fleece' };
const ACC_MIN_N = 15;
/**
 * The error distribution that applies to this answer.
 *   calibrated  this structure's own cross-validated errors (its records, never the ones predicted)
 *   close       half-way between those and the errors of a structure with no records
 *   estimate    a structure with no records: its family left out of the records entirely
 */
function accuracyFor({ matchId, family, lycra, level }) {
  if (!ACCURACY) return null;
  const G = ACCURACY.groups, U = ACCURACY.unseen;
  const base = ACC_GROUP[matchId] || ACC_FAMILY_GROUP[family] || 'single_jersey';
  const pick = (k) => (G[k] && G[k].gsm && G[k].gsm.n >= ACC_MIN_N ? { key: k, v: G[k] } : null);
  const own = pick(base + (lycra ? '+L' : '')) || pick(base) || { key: '_all', v: G._all };
  const fab = ACC_FAMILY_FAB[family];
  const unseen = fab && U.by_family[fab] && U.by_family[fab].gsm && U.by_family[fab].gsm.n >= ACC_MIN_N
    ? { key: `a ${fab.replace('_', ' ')} structure with no records`, v: U.by_family[fab] } : { key: 'a structure with no records', v: U.pooled };
  const w = level === 'estimate' ? 1 : level === 'close' ? 0.5 : 0;
  const mix = (a, b) => (a && b ? Object.fromEntries(['p10', 'p90', 'mae_med', 'within_3', 'within_5', 'within_8'].map((k) => [k, a[k] * (1 - w) + b[k] * w])) : a || b);
  const nice = (k) => (k === '_all' ? 'all structures' : k.replace('+L', ' with elastane').replace(/_/g, ' '));
  const basis = w === 1 ? `cross-validated on the factory records: ${unseen.key} (its family left out), ${unseen.v.gsm.n} cloths`
    : w === 0.5 ? `cross-validated on the factory records: between ${nice(own.key)} (${own.v.gsm.n} cloths) and a structure with no records`
      : `cross-validated on the factory records: ${nice(own.key)}, ${own.v.gsm.n} cloths the engine had not seen when it predicted them`;
  return { gsm: mix(own.v.gsm, unseen.v.gsm), width: mix(own.v.width, unseen.v.width), basis, group: own.key, method: ACCURACY.method, generated: ACCURACY.generated };
}
/** The structure group a design is weighed in: its catalogue twin, or its family's anchor, with or without elastane. */
function groupKeyOf(matchId, family, lycra) { return (ACC_GROUP[matchId] || ACC_FAMILY_GROUP[family] || 'single_jersey') + (lycra ? '+L' : ''); }
const ML = require('./machine-learning');
const MP = require('./machine-pool');
/** A floor machine's rolls (and the pool's numbers for new structures), as the caller passes them: kept only if they look like it. */
function cleanFloor(f) {
  if (!f || typeof f !== 'object') return null;
  const pool = MP.cleanTable(f.pool);
  const rolls = (Array.isArray(f.rolls) ? f.rolls : []).slice(-400).filter((r) => r && typeof r.group === 'string' && (+r.gsm_ratio > 0.5 && +r.gsm_ratio < 2 || +r.width_ratio > 0.5 && +r.width_ratio < 2))
    .map((r) => ({ group: r.group, ne: +r.ne > 0 ? +r.ne : null, gsm_ratio: +r.gsm_ratio > 0.5 && +r.gsm_ratio < 2 ? +r.gsm_ratio : null, width_ratio: +r.width_ratio > 0.5 && +r.width_ratio < 2 ? +r.width_ratio : null }));
  if (!rolls.length && !pool) return null;
  return { name: f.name ? String(f.name).slice(0, 60) : null, rolls, pool };
}
/** Where a machine's correction came from, in words: its own rolls, the pool of other mills, or both. */
function floorSource(floor, n, pooled) {
  const own = n ? `${n} roll${n === 1 ? '' : 's'} on ${floor.name || 'your machine'}` : null;
  const pool = pooled ? `${pooled.accounts} mills' pooled rolls` : null;
  return [own, pool].filter(Boolean).join(' and ');
}
/** Where 80 % of measured cloths land, given the prediction and the signed error quantiles (e = (pred − meas) / meas). */
const rangeOf = (pred, e) => [pred / (1 + e.p90), pred / (1 + e.p10)];

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
      : eyelet ? 'Each eyelet is a loop transfer (E): knitted on a pointelle machine with transfer and electronic needle selection.'
        : f.id === 'plated_jersey' ? 'Plating: a second yarn is fed through the same guide into every loop and held to the back — set the Plated (back) yarn under Yarn (e.g. a cotton face on a polyester back).'
        : f.id === 'heavy_jersey' ? 'Heavy jersey is knitted with two ends per feeder (two yarns fed together into every loop): set as 2-ply. The heavy-jersey rows in the factory records weigh what two ends do — one end at that loop length would be about half.' : null,
    // heavy jersey: two ends per feeder (the factory's rows: 22s at a 4 mm loop, ~280 GSM)
    ends: f.id === 'heavy_jersey' ? 2 : 1,
    // plated jersey: two yarns through one plating feeder, face and back
    plated: f.id === 'plated_jersey',
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

// ── yarn: count in any system, ply, type ─────────────────────────────────
// Every count system comes down to tex (grams per km):
//   Ne (cotton)  590.5 / Ne     Nm (metric)  1000 / Nm     Nw (worsted)  885.8 / Nw
//   dtex         dtex / 10      denier       den / 9       tex           tex
// A ply yarn written 2/40s is two 40s singles: resultant tex = ply × single tex.
// A filament yarn's filament count (75D/72F) gives the fineness of one
// filament (dpf) — the softer the finer. The yarn TYPE sets its diameter at a
// given count: spinning system and yarn form for spun yarns, flat (FDY) or
// textured (DTY) for filament (bulk factors from the yarn-character tables).
const UNITS = {
  ne: { label: 'Ne', toTex: (v) => 590.5 / v }, nm: { label: 'Nm', toTex: (v) => 1000 / v }, nw: { label: 'Nw', toTex: (v) => 885.8 / v },
  tex: { label: 'tex', toTex: (v) => v }, dtex: { label: 'dtex', toTex: (v) => v / 10 }, denier: { label: 'D', toTex: (v) => v / 9 },
};
const FILAMENT_FIBRES = ['polyester_filament', 'nylon_filament'];
const SPUN_TYPES = Object.keys(YC.SYSTEM_LOOK);
function readYarn(y, fallback) {
  const o = y || {};
  let unit = UNITS[String(o.unit || '').toLowerCase()] ? String(o.unit).toLowerCase() : null;
  let v = +o.count > 0 ? +o.count : null;
  if (!v || !unit) { if (+o.ne > 0) { v = +o.ne; unit = 'ne'; } else if (+o.denier > 0) { v = +o.denier; unit = 'denier'; } else if (+o.tex > 0) { v = +o.tex; unit = 'tex'; } else if (+o.dtex > 0) { v = +o.dtex; unit = 'dtex'; } else if (+o.nm > 0) { v = +o.nm; unit = 'nm'; } }
  if (!v || !unit) return fallback || null;
  const ply = [1, 2, 3, 4].includes(+o.ply) ? +o.ply : 1;
  const single = UNITS[unit].toTex(v);
  const tex = single * ply;
  const countLabel = unit === 'ne' ? `${r1(v)}s Ne` : unit === 'denier' ? `${r1(v)} D` : `${r1(v)} ${UNITS[unit].label}`;
  const label = (ply > 1 ? `${ply}/${countLabel}` : countLabel) + (+o.filaments > 0 ? `/${Math.round(+o.filaments)}F` : '');
  if (tex < 2 || tex > 120) throw new StudioError(`Yarn ${label}: ${r1(tex)} tex is outside 2–120 tex (5s–300s Ne) — check the count and the unit.`);
  const fibre = FIBRES[o.fibre] ? o.fibre : (fallback && fallback.fibre) || 'cotton';
  const filament = FILAMENT_FIBRES.includes(fibre);
  // type: a spinning system for spun yarn, flat / textured for filament
  const type = filament ? (['fdy', 'dty'].includes(o.type) ? o.type : 'dty') : (SPUN_TYPES.includes(o.type) ? o.type : 'combed');
  const form = filament ? null : (ply > 1 ? 'ply2' : ['slub', 'core_spun'].includes(o.form) ? o.form : 'single');
  const bulk = filament ? YC.POLY_FORM[type].bulk : YC.SYSTEM_LOOK[type].bulk * YC.FORM_LOOK[form].bulk;
  const typeLabel = filament ? YC.POLY_FORM[type].label : `${type.replace('_', '-')}${form !== 'single' ? ', ' + YC.FORM_LOOK[form].label : ''}`;
  const dpf = filament && +o.filaments > 0 ? (tex * 9) / +o.filaments : null;
  return {
    tex, ne: 590.5 / tex, single_ne: 590.5 / single, label, fibre, fibre_label: FIBRES[fibre].label, ply, type, form, type_label: typeLabel, bulk,
    // Peirce's diameter d = √tex / 28 mm, by fibre packing and by the yarn's own bulk
    d_mm: (Math.sqrt(tex) / 28) * FIBRES[fibre].dFactor * bulk,
    filaments: +o.filaments > 0 ? Math.round(+o.filaments) : null, dpf: dpf ? r2(dpf) : null,
    equivalents: { ne: r1(590.5 / tex), nm: r1(1000 / tex), tex: r2(tex), dtex: r1(tex * 10), denier: r1(tex * 9) },
  };
}

// ── what the KIND of yarn does (yarn-character.js, the calculator's engine) ──
// Strength, evenness, hairiness and torque of the spinning system are the
// yarn engine's tables (sourced); bulk, lustre, handle and the knitting and
// finishing consequences are modelled there.
const FIBRE_MIX = {
  cotton: { cotton: 100 }, cvc: { cotton: 60, polyester: 40 }, polyester_spun: { polyester: 100 },
  viscose: { viscose: 100 }, modal: { modal: 100 }, polyester_filament: { polyester: 100 }, nylon_filament: { nylon: 100 },
};
function characterOf(y) {
  if (!y) return null;
  const filament = FILAMENT_FIBRES.includes(y.fibre);
  const spinKey = filament ? 'combed' : y.type;
  const c = YC.yarnCharacter({
    spinKey, spin: SPINNING_SYSTEMS[spinKey], form: y.form || 'single', fibers: FIBRE_MIX[y.fibre] || { cotton: 100 }, countNe: y.single_ne || y.ne,
    poly_form: filament ? y.type : /polyester|cvc/.test(y.fibre) ? 'staple' : undefined, poly_lustre: 'semi_dull',
  });
  const spin = SPINNING_SYSTEMS[spinKey];
  const ne1 = y.single_ne || y.ne;
  const spinnable = filament || !spin || (ne1 >= spin.count_min && ne1 <= spin.count_max);
  return { c, spinnable, range: spin && !filament ? [spin.count_min, spin.count_max] : null, label: filament ? c.polyester ? c.polyester.form_label : 'filament' : spin ? spin.label : spinKey };
}

// ── structure helpers ──────────────────────────────────────────────────────
const shiftRows = (g, r, c) => g.map((_, i) => { const row = g[(i + r) % g.length]; return row.map((__, j) => row[(j + c) % row.length]); });
const same = (a, b) => (!a && !b) || (a && b && a.length === b.length && a.every((row, i) => row.join('') === b[i].join('')));

function matchCatalogue(st0) {
  const st = { ...st0, beds: { C: st0.beds.C.map((r) => r.map((x) => (x === 'E' || x === 'R' ? 'M' : x))), D: st0.beds.D && st0.beds.D.map((r) => r.map((x) => (x === 'R' ? 'M' : x))) } };
  for (const f of CATALOGUE) {
    const t = KP.normaliseStructure(f);
    if (!t || !!t.beds.D !== !!st.beds.D || t.feeds % st.feeds || t.width % st.width) continue;
    // the design's repeat may be reduced: tile it up to the catalogue's before comparing
    const tile = (g) => g && Array.from({ length: t.feeds }, (_, i) => Array.from({ length: t.width }, (__, j) => g[i % st.feeds][j % st.width]));
    const C = tile(st.beds.C), D = tile(st.beds.D);
    for (let r = 0; r < t.feeds; r++) for (let c = 0; c < t.width; c++) {
      if (same(shiftRows(C, r, c), t.beds.C) && (!D || same(shiftRows(D, r, c), t.beds.D))) return f;
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
// (the anchor structure is read once per family; its consumption is cheap — counted once — so it is not cached per loop)
const anchorDefs = new Map();
function anchorMass(family, pitchMm, slMm) {
  let a = anchorDefs.get(family);
  if (!a) {
    // M is linear in the miss float share: M = A + B·missShare, the two read once from the anchor's cells
    const f = byId(FAMILY[family].anchor), t = KP.normaliseStructure(f), roles = templateOf(f).roles;
    const c0 = KP.feedConsumptionCells(t, 1, 1e9), c1 = KP.feedConsumptionCells(t, 1, 1.1);   // missShare 0.15 and 0.6 (clamped ends)
    const w = (i) => (roles[i] === 'loop' ? ANCHOR_LOOP_TEX_RATIO : 1);
    const m0 = mean(c0.map((c, i) => c.share * w(i))), m1 = mean(c1.map((c, i) => c.share * w(i)));
    const B = (m1 - m0) / (0.6 - 0.15);
    a = { f, A: m0 - B * 0.15, B };
    anchorDefs.set(family, a);
  }
  const miss = Math.max(0.15, Math.min(0.6, (pitchMm * 1.1) / slMm));
  return { def: a.f, M: a.A + a.B * miss };
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

function gaugeFit(family, gauge, tex, fibre, bulk = 1) {
  const pitch = 25.4 / gauge;
  const yarnD = (Math.sqrt(tex) / 28) * FIBRES[fibre].dFactor * bulk;
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
// ── finish: open-width stenter setting ──────────────────────────────────
// MODELLED, by conservation of mass: the cloth's weight per metre does not change
// on the stenter, so pinning it wider or narrower than the width it finishes at
// by itself spreads the same grams over more or less area. GSM × natural ÷ set.
// The engine's own GSM and width stay those of the cloth finished as the factory
// records were (dyed, compacted); this is what a different setting would give.
function stenterSet(input, S) {
  const set = +((input.finish || {}).set_width_in);
  if (!(set > 0)) return null;
  if (!(set >= 15 && set <= 120)) throw new StudioError('Stenter set width must be between 15 and 120 inches.');
  const nat = S.width, change = set / nat - 1;
  const gsm = S.gsm * nat / set;
  const note = change > 0.08 ? `Pinned ${r1(change * 100)}% wider than it finishes by itself: the cloth is held stretched, so expect it to shrink back in width (and grow in length) at the first wash — residual shrinkage beyond buyer limits is likely past about 5–8%.`
    : change < -0.08 ? `Set ${r1(-change * 100)}% narrower than it finishes by itself: the width is overfed, which risks crease marks and an uneven face; a tighter knit (shorter stitch length) is the cleaner route to this weight.`
      : 'Within about ±8% of the width it finishes at by itself: a normal stenter adjustment.';
  return { set_width_in: r1(set), natural_width_in: r1(nat), gsm_at_set: Math.round(gsm), change_pct: r1(change * 100), gsm_change_pct: r1((nat / set - 1) * 100), basis: 'modelled: the same grams per metre spread over the set width (mass conserved); the GSM and width above are the cloth as finished in the factory records', note };
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
  const model = ctx.exactFam ? { ...structureModel(ctx), ksF: 1, kwF: 1, notes: [`measured on this exact structure (${ctx.exactFam} factory records)`] } : structureModel(ctx);
  // a rib with needles out of action (2-in-1-out, 2x2) is weighed on its own factory records
  const ksFam = family === 'rib' && ctx.posNorm > 1.01 ? 'rib2x2' : family;
  // a design that IS a structure the factory has measured: its own constants, no carrying over
  const ex = ctx.exactFam;
  const KS0 = ex ? blend(KP.calFor('ks', ex, false), KP.calFor('ks', ex, true), phi) : blend(KP.calFor('ks', ksFam, false), KP.calFor('ks', ksFam, true), phi);
  const KW0 = ex ? blend(KP.calFor('kw', ex, false), KP.calFor('kw', ex, true), phi) : blend(KP.calFor('kw', family, false), KP.calFor('kw', family, true), phi);
  const pitch0 = 25.4 / (+mach.gauge > 0 ? +mach.gauge : 24);
  const pack = ctx.exactFam ? { ks: 1, kw: 1, basis: null, measured: true } : holdPacking(family, ctx.rate == null ? 1 : ctx.rate, pitch0, 3);
  let KS = scaled(KS0, fibre.ks * model.ksF * pack.ks);
  if (pack.spread) KS = { ...KS, q1: KS.q1 / pack.spread, q3: KS.q3 * pack.spread };
  let KW = scaled(KW0, fibre.kw * model.kwF * pack.kw);
  const modelKS = KS.med, modelKW = KW.med;
  if (ctx.floor && !ctx.calib) {
    KS = { ...scaled(KS, ctx.floor.gsm_factor), basis: `${KS.basis}; × ${r3(ctx.floor.gsm_factor)} learned from ${floorSource(ctx.floor, ctx.floor.n_gsm, ctx.floor.pooled_gsm)}` };
    KW = { ...scaled(KW, 1 / ctx.floor.width_factor), basis: `${KW.basis}; width × ${r3(ctx.floor.width_factor)} learned from ${floorSource(ctx.floor, ctx.floor.n_width, ctx.floor.pooled_width)}` };
  }
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
  const yarns = feedRows.map((f) => {
    const y = f.yarn || (f.role === 'loop' ? loopYarn : ground);
    if (!f.plate) return y;
    // plated: both yarns follow the same loop; the back yarn has no plated yarn given → the ground yarn again
    const pY = f.plate === 'ground' ? ground : f.plate;
    const d1 = y.d_mm || (Math.sqrt(y.tex) / 28), d2 = pY.d_mm || (Math.sqrt(pY.tex) / 28);
    return { ...y, tex: y.tex + pY.tex, label: `${y.label} + ${pY.label} plated`, d_mm: d1 + d2, plated: { face: y, back: pY, share: pY.tex / (y.tex + pY.tex) } };
  });
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
    // exact structure: Ks was measured as 10·GSM·ℓ/tex on it, so weigh it on its own yarn per needle
    const den = ctx.exactFam ? posNorm * mean(cons.map((c) => c.share)) : A.M * mb(model.e) / mb(model.eFam);
    return { gsm: (ks * Y) / (10 * (lk(lref) / 10) ** 2 * den) * (ctx.finishK || 1), cons, A };
  };
  const target = +((input.target || {}).gsm) || null;
  let lref, slSource;
  if (+mach.sl_mm > 0) { lref = +mach.sl_mm; slSource = 'your setting'; }
  else if (target) {
    let lo = 1.0, hi = 12;
    for (let k = 0; k < 36; k++) { const mid = (lo + hi) / 2; if (gsmAt(mid).gsm > target) lo = mid; else hi = mid; }
    lref = (lo + hi) / 2; slSource = `solved for ${target} GSM`;
  } else throw new StudioError('Give a target GSM, or your machine stitch length.');
  const at = gsmAt(lref);
  const gsm = at.gsm;
  const gsmRange = [gsmAt(lref, KS.q1).gsm, gsmAt(lref, KS.q3).gsm];
  const slRange = target && slSource.startsWith('solved')
    ? [KS.q1, KS.q3].map((ks) => { let lo = 1, hi = 12; for (let k = 0; k < 32; k++) { const m = (lo + hi) / 2; if (gsmAt(m, ks).gsm > target) lo = m; else hi = m; } return r2((lo + hi) / 2); })
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
      feed: i + 1, role: f.role, role_drawn: f.drawn || f.role, yarn: yarns[i].label, yarn_type: yarns[i].type_label || null, d_mm: yarns[i].d_mm ? r3(yarns[i].d_mm) : null, fibre: yarns[i].fibre_label, tex: r2(yarns[i].tex),
      sl_mm: r3(l), sl_source: f.sl_mm ? 'your setting' : f.sl_ratio !== 1 ? `${f.sl_ratio} × ground` : 'ground stitch length',
      tf: knitsHere ? r2(Math.sqrt(yarns[i].tex) / (l / 10)) : null, plated: yarns[i].plated ? { back: yarns[i].plated.back.label, back_pct: r1(yarns[i].plated.share * 100) } : null,
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
  feeds.forEach((f, i) => {
    const P = yarns[i] && yarns[i].plated;
    if (P) {
      // a plated feed: the face yarn and the back yarn, by their tex
      const kf = `${f.role} (face): ${P.face.label} ${P.face.fibre_label}`, kb = `plated (back): ${P.back.label} ${P.back.fibre_label}`;
      byRole[kf] = (byRole[kf] || 0) + f.mass * (1 - P.share); byRole[kb] = (byRole[kb] || 0) + f.mass * P.share;
      return;
    }
    const k = `${f.role}: ${f.yarn} ${f.fibre}`; byRole[k] = (byRole[k] || 0) + f.mass;
  });
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
    gfit: gaugeFit(family, gauge, ground.tex, ground.fibre, ground.bulk || 1),
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
  const dOf = (i) => (own && S.feeds[i] ? (S.feeds[i].d_mm || d0 * Math.sqrt(S.feeds[i].tex / t0)) : d0);
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
  const key = (i) => { const f = feedRows[i]; return JSON.stringify([f.role, f.yarn && f.yarn.tex, f.yarn && f.yarn.fibre, f.sl_mm, f.sl_ratio, f.plate ? f.plate.tex : 0, altPlating ? i % 2 : 0]); };
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
    const roleYarn = {};
    for (const role of ['binder', 'loop', 'plate']) {
      const y = input.yarns && input.yarns[role];
      if (y) roleYarn[role] = readYarn({ fibre: (input.yarn || {}).fibre, ...y }, null);
    }
    const auto = !ground;
    const feedRows = C.map((_, i) => {
      const f = (input.feeds || [])[i] || {};
      const role = ROLES.includes(f.role) ? f.role : 'ground';
      return {
        role,
        yarn: readYarn(f.yarn ? { ...(input.yarn || {}), ne: null, count: null, unit: null, ...f.yarn } : null, null) || roleYarn[role] || null,
        sl_mm: +f.sl_mm > 0 ? +f.sl_mm : null,
        sl_ratio: +f.sl_ratio > 0 ? Math.min(3, Math.max(0.3, +f.sl_ratio)) : 1,
        // plating: a second yarn fed through the same guide into every loop of this feed, held to the back
        plate: f.plate ? (readYarn(input.yarns && input.yarns.plate ? { fibre: (input.yarn || {}).fibre, ...input.yarns.plate } : null, null) || 'ground') : null,
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
    // structures the factory records under their own name
    const EXACT = { waffle_knit: 'waffle' };
    { const m0 = matchCatalogue(st); const ef = m0 && EXACT[m0.id]; if (ef && KP.calFor('ks', ef, false).n >= 12 && KP.calFor('kw', ef, false).n >= 12) ctx.exactFam = ef; }
    // a floor machine's logged rolls: the profile this design's structure has learned on it (machine-learning.js)
    const m1 = matchCatalogue(st);
    const group = groupKeyOf(m1 && m1.id, family, lycra);
    ctx.group = group;
    const floor = cleanFloor(input.floor);
    if (floor) {
      const G = ACCURACY && (ACCURACY.groups[group] || ACCURACY.groups[group.replace('+L', '')] || ACCURACY.groups._all);
      const ne = (input.yarn || {}).count > 0 && String((input.yarn || {}).unit || 'ne').toLowerCase() === 'ne' ? +input.yarn.count : null;
      const prof = ML.learnProfile(floor.rolls, { group, ne, gsmCV: G && G.gsm, widthCV: G && G.width, pool: MP.lookup(floor.pool, group, ne) });
      if (prof.n > 0 || prof.pooled_gsm || prof.pooled_width) ctx.floor = { ...prof, name: floor.name, group };
    }
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
      if (!plush) throw new StudioError(`No sinker height and pile yarn plate to ${tgt} GSM on this ground yarn: a terry or velour this light is not knittable — raise the target GSM or use a finer ground yarn.`);
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
      // the stitch cam set as a knock-over depth: the loop it forms is the stitch length
      const camD = +((input.machine || {}).cam_depth_mm);
      if (camD > 0 && !(+((input.machine || {}).sl_mm) > 0)) {
        const fs = profile.selection === 'tracks' ? 'positive' : 'storage';
        const sl = KF.loopFromDepth(camD, { st, gating, S, machine: input.machine, feedSystem: fs });
        if (sl) { ctx.input = { ...ctx.input, machine: { ...(ctx.input.machine || {}), sl_mm: r2(sl) } }; ctx.camLoop = { depth: camD, sl }; S = run(); }
      }
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
    // stitch formation: knock-over depth for every knitting feed, timing, cam scale
    const defTiming = profile.timing && profile.timing.length === 1 ? profile.timing[0]
      : gating === 'interlock' || (D && st.beds.D.some((row) => row.includes('T'))) ? 'synchronised' : 'delayed';
    // yarn character per role, and what it does to the fabric
    const yarnChars = (() => {
      const seen = {}, out = [];
      feedRows.forEach((f, i) => {
        const key = f.role === 'face' || f.role === 'ground' ? 'face' : f.role;
        if (seen[key] || !S.feeds[i]) return;
        const y = f.yarn || (f.role === 'loop' ? null : S.ground);
        const ch = characterOf(y || S.ground);
        if (!ch) return;
        seen[key] = true;
        out.push({ role: key === 'face' ? (feedRows.some((x) => x.role === 'face') ? 'face' : 'ground') : key, count: (y || S.ground).label, system: ch.label, spinnable: ch.spinnable, range: ch.range,
          mass_pct: S.feeds.filter((x, k) => ((feedRows[k] || {}).role === f.role)).reduce((t, x) => t + (x.mass_share_pct || 0), 0), ch: ch.c });
      });
      // the plated (back) yarn, when there is one
      const pf = feedRows.find((f) => f.plate && f.plate !== 'ground');
      if (pf) { const ch = characterOf(pf.plate); if (ch) out.push({ role: 'plated', count: pf.plate.label, system: ch.label, spinnable: ch.spinnable, range: ch.range, mass_pct: (S.yarnPlatedPct || 0), ch: ch.c }); }
      return out;
    })();
    const yarnFx = (() => {
      const face = yarnChars.find((x) => x.role === 'face' || x.role === 'ground');
      if (!face) return null;
      // strength of the knitting yarns (not the loop yarn), by mass; filament yarns are not in the spun tables
      const knitting = yarnChars.filter((x) => x.role !== 'loop' && x.role !== 'plated' && x.ch.relative_to_combed_ring.strength_pct != null);
      const tot = knitting.reduce((t, x) => t + (x.mass_pct || 0), 0);
      const strength = !knitting.length || !tot ? null : Math.round(knitting.reduce((t, x) => t + x.mass_pct * x.ch.relative_to_combed_ring.strength_pct, 0) / tot);
      // pilling grade (1-5): a combed ring cotton jersey ~3.5, shifted by the face yarn and the finish
      const br = finish ? finish.brush : 'none';
      const pill = Math.max(1, Math.min(5, 3.5 + face.ch.pilling_delta - (br === 'face' || br === 'both' ? 0.5 : 0) - (family === 'fleece' && br !== 'none' ? 0.3 : 0)));
      // spirality: on a single bed the singles yarn's twist torque leans the wales;
      // a combed ring single yarn gives ~4° (modelled), scaled by the system's torque; ply yarns are balanced
      const tq = face.ch.relative_to_combed_ring.spirality_pct;
      const twistDeg = D || tq == null ? null : Math.max(0, 4 * (1 + tq / 100));
      return {
        pilling_grade: Math.round(pill * 2) / 2, strength_vs_combed_pct: strength, twist_spirality_deg: twistDeg == null ? null : r1(twistDeg),
        hairiness: face.ch.hair_factor, lustre: face.ch.lustre.class, handle: (face.ch.effects.find((e) => e.area === 'Handle') || {}).text || null,
        basis: 'yarn-character tables (spinning-system strength, hairiness and torque — sourced; pilling shift, lustre and handle — modelled); pilling grade from a 3.5 combed-ring jersey reference, spirality from ~4° for a combed singles jersey — modelled',
      };
    })();
    // relaxation states and residual shrinkage (Munden: dimensions follow the state, the loop length stays)
    const relax = plush ? null : KR.states({ S, fibre: S.ground.fibre, elastane: !!elastane,
      jersey: (() => { const ks = KP.calFor('ks', 'single_jersey', false).med, kw = KP.calFor('kw', 'single_jersey', false).med; return { kc: ks / kw, kw }; })(),
      limitPct: +((input.target || {}).shrinkage_pct) });
    const formation = plush ? null : KF.plan({ st, gating, S, machine: input.machine, feedSystem: profile.selection === 'tracks' ? 'positive' : 'storage', defaultTiming: defTiming });
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
      if (relax) mc.push(...KR.checks(relax, family));
      // plating: which yarn shows where
      feedRows.forEach((f, i) => {
        if (!f.plate || !S.feeds[i] || !S.feeds[i].plated) return;
        const face = f.yarn || (f.role === 'loop' ? null : S.ground), back = f.plate === 'ground' ? S.ground : f.plate;
        if (!face) return;
        if (back.tex > 1.3 * face.tex) mc.push({ level: 'warn', text: `Feed ${i + 1}: the plated back yarn (${back.label}) is much coarser than the face yarn (${face.label}) — a coarse back yarn grins through to the face. Plating is cleanest with the face yarn as coarse as the back yarn or coarser.` });
        else mc.push({ level: 'ok', text: `Feed ${i + 1} plated: ${face.label} on the face, ${back.label} on the back (${S.feeds[i].plated.back_pct}% of that feed's yarn) — fed through a plating feeder with two yarn holes, the face yarn's tension kept a little above the back yarn's so it stays in front.` });
      });
      yarnChars.forEach((y) => {
        if (!y.spinnable && y.range) mc.push({ level: 'warn', text: `${y.role[0].toUpperCase() + y.role.slice(1)} yarn ${y.count}: ${y.system} spinning makes about ${y.range[0]}s–${y.range[1]}s Ne — this count is outside it. Choose another system or count.` });
        y.ch.warnings.forEach((w) => mc.push({ level: 'warn', text: `${y.role[0].toUpperCase() + y.role.slice(1)} yarn: ${w}` }));
      });
      if (yarnFx && yarnFx.pilling_grade < 3) mc.push({ level: 'warn', text: `Pilling about grade ${yarnFx.pilling_grade} (modelled from the face yarn${finish && finish.brush !== 'none' ? ' and the brushing' : ''}) — below the usual 3–3.5 buyer minimum: a compact or siro face yarn, a ply yarn or a bio-polish lifts it.` });
      if (yarnFx && yarnFx.twist_spirality_deg > 5) mc.push({ level: 'note', text: `The face yarn's twist leans the wales about ${yarnFx.twist_spirality_deg}° in a single jersey (modelled) — a lower-torque system, a ply yarn or alternate S/Z twist feeders reduce it.` });
      if (formation) {
        mc.push(...formation.checks);
        if (formation.timing && profile.timing && !profile.timing.includes(formation.timing)) mc.push({ level: 'warn', text: `${profile.label} runs ${profile.timing.join(' / ')} timing; ${formation.timing} is set.` });
        if (formation.timing === 'delayed' && gating === 'interlock') mc.push({ level: 'warn', text: 'Interlock gating runs synchronised timing: facing needles knock over together. Delayed timing is for rib gating.' });
        if (ctx.camLoop) mc.push({ level: 'ok', text: `Stitch cam set to ${r2(ctx.camLoop.depth)} mm below the knock-over level: it forms a ${r2(ctx.camLoop.sl)} mm loop (geometry) — the stitch length used here.` });
      } else if (plush) mc.push({ level: 'note', text: 'Plush: the pile loop is set by the terry sinker nib, not by the stitch cam — the stitch formation model is for needle loops.' });
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
    const exactN = ctx.exactFam ? KP.calFor('ks', ctx.exactFam, lycra).n : 0;
    const confidence = ctx.exactFam && !ctx.calib && !plush
      ? { level: 'calibrated', why: `${match ? match.name : 'This structure'} — measured on this exact structure: ${exactN} factory records (${ctx.exactFam}) give its own Ks and Kw.` }
      : plush
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
    // how right this answer is likely to be: measured by cross-validation (plush has its own model and no records)
    const acc = accuracyFor({ matchId: match && match.id, family, lycra, level: plush ? 'estimate' : confidence.level });
    return {
      success: true,
      structure: {
        bed: D ? 'double' : 'single', gating, feeds: st.feeds, needles_per_repeat: st.width, beds: st.beds, roles, roles_drawn: feedRows.map((f) => f.drawn || f.role),
        family: plush ? 'plush' : family, family_label: plush ? 'Sinker-loop plush (terry / velour)' : FAMILY[family].label,
        anchor: plush ? { id: 'terry', name: 'factory loopback terry (loop size)' } : { id: anchorDef.id, name: anchorDef.name },
        match: plush ? { id: plush.variant.id, name: plush.variant.name } : match ? { id: match.id, name: match.name } : null,
        group: ctx.group,
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
        ground: { count: S.ground.label, tex: r2(S.ground.tex), fibre: S.ground.fibre_label, source: auto || (plush && !ground) ? 'solved' : 'your input',
          type: S.ground.type_label || null, d_mm: r3(S.gfit.yarn_d_mm), equivalents: S.ground.equivalents || { ne: r1(590.5 / S.ground.tex), nm: r1(1000 / S.ground.tex), tex: r2(S.ground.tex), dtex: r1(S.ground.tex * 10), denier: r1(S.ground.tex * 9) }, dpf: S.ground.dpf || null },
        roles: (() => {
          const out = {};
          feedRows.forEach((f, i) => {
            const y = S.feeds[i]; if (!y || out[f.role] || f.role === 'ground' || f.role === 'face') return;
            out[f.role] = { count: y.yarn, tex: y.tex, type: y.yarn_type, d_mm: y.d_mm, source: f.yarn ? 'your input' : f.role === 'loop' ? 'assumed (2.5 × the ground tex)' : 'the ground yarn',
              equivalents: { ne: r1(590.5 / y.tex), nm: r1(1000 / y.tex), tex: r2(y.tex), dtex: r1(y.tex * 10), denier: r1(y.tex * 9) } };
          });
          return out;
        })(),
        feeds: S.feeds.map(({ mass, elastane_mass, ...f }) => f),
        composition: S.composition,
        character: yarnChars.map((y) => ({ role: y.role, count: y.count, system: y.system, spinnable: y.spinnable, range: y.range, mass_pct: r1(y.mass_pct),
          hair_factor: y.ch.hair_factor, bulk: y.ch.bulk, lustre: y.ch.lustre, relative: y.ch.relative_to_combed_ring, pilling_delta: y.ch.pilling_delta,
          effects: y.ch.effects, process: y.ch.process, warnings: y.ch.warnings, look: y.ch.look })),
        effects: yarnFx,
      },
      fabric: {
        accuracy: acc && ctx.floor && !ctx.calib ? {
          interval_pct: 80, level: ctx.floor.n > 0 ? 'machine' : 'pooled', own_rolls: false, method: acc.method, generated: acc.generated,
          supported_by_rolls: ctx.floor.n, machine: ctx.floor.name, gsm_factor: r3(ctx.floor.gsm_factor), width_factor: r3(ctx.floor.width_factor),
          pooled: ctx.floor.pooled_gsm || ctx.floor.pooled_width ? { gsm_mills: ctx.floor.pooled_gsm ? ctx.floor.pooled_gsm.accounts : 0, width_mills: ctx.floor.pooled_width ? ctx.floor.pooled_width.accounts : 0 } : null,
          basis: (ctx.floor.n > 0
            ? `learned from ${ctx.floor.n} of your roll${ctx.floor.n === 1 ? '' : 's'} of this structure on ${ctx.floor.name || 'your machine'} (the last ${ML.WINDOW}, weighed against ${ML.K} rolls' worth of the factory records' spread)`
            : "no roll of your own on this structure yet: started from other mills' pooled rolls (anonymous, none of them yours); the range is the factory records' own") +
            (ctx.floor.n > 0 && (ctx.floor.pooled_gsm || ctx.floor.pooled_width) ? `, started from ${Math.max(ctx.floor.pooled_gsm ? ctx.floor.pooled_gsm.accounts : 0, ctx.floor.pooled_width ? ctx.floor.pooled_width.accounts : 0)} other mills' pooled rolls` : ''),
          gsm: { range: ML.band(S.gsm, ctx.floor.gsm_sd).map(Math.round), typical_error_pct: r1((Math.exp(0.6745 * ctx.floor.gsm_sd) - 1) * 100), within_3_pct: ML.withinPct(ctx.floor.gsm_sd, 0.03), within_5_pct: ML.withinPct(ctx.floor.gsm_sd, 0.05), within_8_pct: ML.withinPct(ctx.floor.gsm_sd, 0.08) },
          width: { range: ML.band(S.width, ctx.floor.width_sd).map(r1), typical_error_pct: r1((Math.exp(0.6745 * ctx.floor.width_sd) - 1) * 100), within_3_pct: ML.withinPct(ctx.floor.width_sd, 0.03), within_5_pct: ML.withinPct(ctx.floor.width_sd, 0.05), within_8_pct: ML.withinPct(ctx.floor.width_sd, 0.08) },
        } : acc ? {
          interval_pct: 80, level: confidence.level, basis: acc.basis, method: acc.method, generated: acc.generated, own_rolls: !!ctx.calib, supported_by_rolls: 0,
          gsm: { range: rangeOf(S.gsm, acc.gsm).map(Math.round), typical_error_pct: r1(acc.gsm.mae_med * 100), within_3_pct: Math.round(acc.gsm.within_3), within_5_pct: Math.round(acc.gsm.within_5), within_8_pct: Math.round(acc.gsm.within_8) },
          width: acc.width ? { range: rangeOf(S.width, acc.width).map(r1), typical_error_pct: r1(acc.width.mae_med * 100), within_3_pct: Math.round(acc.width.within_3), within_5_pct: Math.round(acc.width.within_5), within_8_pct: Math.round(acc.width.within_8) } : null,
        } : null,
        gsm: Math.round(S.gsm), gsm_range: (ctx.floor && !ctx.calib ? ML.band(S.gsm, ctx.floor.gsm_sd) : acc && !ctx.calib ? rangeOf(S.gsm, acc.gsm) : S.gsmRange).map(Math.round), target_gsm: S.target,
        sl_mm: r2(S.lref), sl_source: S.slSource, sl_range_mm: S.slRange,
        tf: r1(S.tfGround), tf_window: W,
        wpi: r1(S.wpc * 2.54), cpi: r1(S.cpc * 2.54), wpc: r1(S.wpc), cpc: r1(S.cpc),
        width_open_in: r1(S.width), width_range_in: (ctx.floor && !ctx.calib ? ML.band(S.width, ctx.floor.width_sd) : acc && acc.width && !ctx.calib ? rangeOf(S.width, acc.width) : S.widthRange).map(r1), tube_in: r1(S.width / 2), target_width_in: S.tW,
        kw: r2(S.KW.med), kw_basis: S.KW.basis, ks: r1(S.KS.med), ks_basis: S.KS.basis,
        relaxation: relax,
        stenter: plush ? null : stenterSet(input, S),
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
        formation: formation ? (({ checks: _c, ...f }) => f)(formation) : null,
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

module.exports = {
  groupKeyOf, cleanFloor, analyse, listTemplates, FIBRES, ROLES, LIMITS, TF_WINDOW };
