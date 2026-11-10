/**
 * KnitAdvisor — Fabric Studio, WARP knitting (tricot / raschel)
 * =============================================================
 *
 * In warp knitting every needle is fed by its own warp ends, one set per
 * guide bar. A bar's lapping says, course by course, where its guides swing:
 *
 *   NOTATION  "1-0/1-2//" — each pair is one course: the guide swings in
 *             front of the needles from the first gap to the second (the
 *             OVERLAP, which wraps the yarn round the needle between them),
 *             then shogs behind the needles to the first number of the next
 *             pair (the UNDERLAP). "//" closes the repeat. Gaps are numbered
 *             0, 1, 2 …; needle n stands between gap n and gap n+1.
 *             1-0/1-2  tricot (1-needle underlap)        1-0/2-3  2-needle (cord)
 *             1-0/3-4  3-needle (satin)                  1-0/4-5  4-needle (velvet)
 *             1-0/0-1  pillar (chain: no underlap)       0-0/2-2  inlay (no overlap)
 *   LAP       closed when the underlap runs back across the overlap's
 *             direction (the yarn crosses itself at the loop's foot); open
 *             when it carries on the same way.
 *   THREADING which guides carry an end: "X" full set, "X." one in, one out …
 *
 * GEOMETRY (derived — Spencer, Knitting Technology, warp-knit yarn path):
 * per course the yarn forms the loop round the needle and runs the underlap
 * to the next loop; with needle pitch p = 25.4/E, course spacing c = 10/cpc,
 * wrap radius rn = (0.45 p + δ)/2 (fitted on 31 published constructions):
 *   overlap   2c + π rn + (o − 1) p        (two legs, the head, a wider overlap)
 *             + π δ on a pillar (the chain loop wraps the loop below it)
 *   underlap  √((u p)² + c²)               (diagonally across u needles over one course)
 *   inlay     √((u p)² + c²)               (no loop: it only crosses)
 *   runner    Σ over the repeat ÷ courses × 480   (mm per rack of 480 courses)
 * The yarn the bar delivers is what the let-off (runner) sets; this geometry
 * is the length a loop of that size needs — e.g. E28 tricot back bar 1-0/1-2
 * at 20 courses/cm ≈ 1,300 mm/rack, front 1-0/2-3 ≈ 1,700 (the order of
 * published charmeuse runners).
 *
 * WEIGHT: GSM = Σ bars [ends/cm × courses/cm × ℓ_course(mm) × tex] / 100,
 * in the FINISHED state: a warp knit narrows and closes up off the machine
 * (heat setting, relaxation). Finished wales = machine wales × kw, courses
 * × kc: rigid tricot 1.28 / 1.07 (medians of 15 published nylon tricots);
 * with elastane 1.8 (a published elastic locknit: 330 cm knitted, 140–150 cm
 * greige, widened 20–30 % in pre-setting) / 1.6 (modelled); raschel 1.2 / 1.1
 * modelled. A finished width you give replaces kw.
 * Elastane is fed drafted: its runner is the geometric length ÷ draft.
 *
 * NOTATION STYLE: tricot style counts one per needle space (1-0/1-2), raschel
 * style two (2-0/2-4); both are read.
 * DOUBLE-NEEDLE-BAR (spacer): the pairs alternate front bed, back bed (or a
 * course is written whole, 1-0-0-1); a bar looping on both beds is a spacer
 * yarn and crosses the bed gap G between its loops — see dnbLength. Thickness
 * = G + both faces (modelled).
 * HOLDS TOGETHER: every end is followed across a band of needles; loops,
 * underlaps and inlays join the wales they touch — more than one piece is an
 * error, a needle left without a loop is a pressed-off hole (holdsTogether).
 */
'use strict';

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;

class WarpError extends Error {}

const RACK = 480;
// the yarn's wrap round the needle (needle and the yarn under it) ≈ 0.45 × pitch:
// fitted on 31 published constructions (see engine/catalog/warp-literature.js)
const TN = 0.45;

// ── machine classes ─────────────────────────────────────────────────────
const MACHINES = {
  tricot: {
    label: 'Tricot (compound needles, 2–4 guide bars)', bars: [2, 4], gauges: [24, 44], speed: [1500, 3300], shog: 6, needle: 'compound needle', beds: 1,
    // finished / machine wales and courses: medians of 15 published 30 d nylon tricots (kw 1.06–1.64, kc 0.68–1.32)
    kw: 1.28, kc: 1.07, use: 'lingerie, sportswear, linings, brushed and printed tricot, swimwear (with elastane)',
  },
  raschel: {
    label: 'Raschel (2–8 guide bars)', bars: [1, 8], gauges: [12, 32], speed: [800, 2000], shog: 10, needle: 'compound (or latch) needle', beds: 1,
    kw: 1.2, kc: 1.1, use: 'powernet, nets, curtains, technical fabrics, pillar-inlay, lace grounds',
  },
  double_raschel: {
    label: 'Double-needle-bar raschel (two beds)', bars: [3, 8], gauges: [12, 24], speed: [300, 900], shog: 6, needle: 'latch / compound needles, two bars', beds: 2,
    kw: 1.1, kc: 1.05, use: 'spacer fabrics, plush (cut between the beds), tubular articles',
  },
};

// ── yarns (warp knitting is mostly filament; spun yarns on raschel) ──────
const UNITS = { ne: (v) => 590.5 / v, nm: (v) => 1000 / v, tex: (v) => v, dtex: (v) => v / 10, denier: (v) => v / 9 };
const FIBRES = {
  nylon_filament: { label: 'Nylon (polyamide) filament', d: 0.99 }, polyester_filament: { label: 'Polyester filament', d: 0.90 },
  elastane: { label: 'Elastane (spandex)', d: 1.10, elastic: true }, polypropylene: { label: 'Polypropylene filament', d: 1.15 },
  cotton: { label: 'Cotton (spun)', d: 1.00 }, polyester_spun: { label: 'Polyester (spun)', d: 1.05 }, viscose: { label: 'Viscose', d: 1.00 },
  // monofilaments (spacer yarns, nets): one round filament, its diameter from the density
  polyester_mono: { label: 'Polyester monofilament', d: 1.0, mono: true, rho: 1.38 }, nylon_mono: { label: 'Nylon monofilament', d: 1.0, mono: true, rho: 1.14 },
};
// fibre densities (g/cm³), for a count given as a monofilament diameter
const RHO = { nylon_filament: 1.14, polyester_filament: 1.38, elastane: 1.2, polypropylene: 0.91, cotton: 1.52, polyester_spun: 1.38, viscose: 1.5, polyester_mono: 1.38, nylon_mono: 1.14 };
function readYarn(y, bar) {
  const o = y || {};
  const uIn = String(o.unit || 'denier').toLowerCase();
  const unit = UNITS[uIn] || uIn === 'mm' ? uIn : 'denier';
  const v = +o.count;
  if (!(v > 0)) throw new WarpError(`Bar ${bar}: give the yarn count.`);
  const fibre = FIBRES[o.fibre] ? o.fibre : 'nylon_filament';
  // a monofilament is often given by its diameter: tex = ρ · π d²/4 · 1000
  if (unit === 'mm' && !(v >= 0.02 && v <= 1.2)) throw new WarpError(`Bar ${bar}: a monofilament diameter of ${v} mm is outside 0.02–1.2 mm.`);
  const tex = (unit === 'mm' ? RHO[fibre] * Math.PI * v * v / 4 * 1000 : UNITS[unit](v)) * ([1, 2, 3].includes(+o.ply) ? +o.ply : 1);
  if (tex < 0.5 || tex > 300) throw new WarpError(`Bar ${bar}: ${r1(tex)} tex is outside 0.5–300 tex — check the count and the unit.`);
  const mono = !!FIBRES[fibre].mono || +o.filaments === 1 || unit === 'mm';
  const label = unit === 'mm' ? `${v} mm mono (${Math.round(tex * 9)} D)` : `${v} ${unit === 'ne' ? 'Ne' : unit === 'denier' ? 'D' : unit}${+o.filaments > 0 ? '/' + Math.round(+o.filaments) + 'F' : ''}`;
  // diameter: a monofilament is a solid round rod; a multifilament or spun yarn packs looser
  const dMono = Math.sqrt((4 * tex) / (1000 * Math.PI * RHO[fibre]));
  // elastane: `draft` is the TOTAL draft (relaxed yarn → knitted); part of it is put in
  // at warping (the beam draft, ~1.7 published), the rest by the let-off
  const draft = FIBRES[fibre].elastic ? Math.min(4.5, Math.max(1.2, +o.draft > 0 ? +o.draft : 2.2)) : 1;
  const beamDraft = FIBRES[fibre].elastic ? Math.min(draft, Math.max(1, +o.beam_draft > 0 ? +o.beam_draft : Math.min(1.7, draft))) : 1;
  return { tex, label, fibre, fibre_label: FIBRES[fibre].label, elastic: !!FIBRES[fibre].elastic, mono, d_mm: mono ? dMono : (Math.sqrt(tex) / 28) * FIBRES[fibre].d,
    draft, beamDraft, denier: r1(tex * 9) };
}

// ── notation ──────────────────────────────────────────────────────────────
// opts.step: 1 = tricot style (one number per needle space: 1-0/1-2), 2 = raschel
// style (two: 2-0/2-4). A four-number group "1-0-2-3" is one double-needle-bar
// course written whole: front bed 1-0, back bed 2-3.
function parseNotation(text, bar, opts) {
  const step = (opts && opts.step) === 2 ? 2 : 1;
  const raw = String(text || '').replace(/\s+/g, '').replace(/,/g, '/').replace(/\/\/+$/, '').replace(/\/+$/, '');
  if (!raw) throw new WarpError(`Bar ${bar}: write its lapping, e.g. 1-0/1-2//.`);
  const pairs = [];
  raw.split('/').forEach((p, k) => {
    const m = p.match(/^(\d{1,2})-(\d{1,2})(?:-(\d{1,2})-(\d{1,2}))?$/);
    if (!m) throw new WarpError(`Bar ${bar}, course ${k + 1}: "${p}" is not a lapping pair — write two guide positions, e.g. 1-0 (or four on a double-needle-bar machine, e.g. 1-0-2-3).`);
    pairs.push([+m[1], +m[2]]);
    if (m[3] != null) pairs.push([+m[3], +m[4]]);
  });
  if (step === 2) {
    if (pairs.some((q) => q[0] % 2 || q[1] % 2)) throw new WarpError(`Bar ${bar}: raschel-style notation counts two steps per needle space (2-0/2-4), so every number must be even — or switch the notation to tricot style.`);
    pairs.forEach((q) => { q[0] /= 2; q[1] /= 2; });
  }
  if (pairs.length > 96) throw new WarpError(`Bar ${bar}: at most 48 courses in a repeat.`);
  return pairs;
}
function threadingOf(text, bar) {
  const t = String(text || 'X').toUpperCase().replace(/[^X.]/g, '');
  if (!t) return { pattern: 'X', fraction: 1 };
  if (!t.includes('X')) throw new WarpError(`Bar ${bar}: the threading has no threaded guide (X).`);
  return { pattern: t, fraction: t.split('').filter((c) => c === 'X').length / t.length };
}

/** Per course: overlap and underlap sizes, lap type, and what the bar is. */
function lapping(pairs) {
  const n = pairs.length;
  return pairs.map(([a, b], k) => {
    const [na] = pairs[(k + 1) % n];
    const over = b - a, under = na - b;
    const o = Math.abs(over), u = Math.abs(under);
    const nextOver = pairs[(k + 1) % n][1] - na;
    const closed = o > 0 && ((u > 0 && Math.sign(under) === -Math.sign(over)) || (u === 0 && Math.sign(nextOver) === -Math.sign(over)));
    return { course: k + 1, a, b, o, u, inlay: o === 0, closed, dir: Math.sign(under) };
  });
}
function kindOf(laps) {
  if (laps.every((l) => l.inlay)) return { key: 'inlay', label: 'inlay (laid in, no loops)' };
  const us = laps.map((l) => l.u);
  const maxU = Math.max(...us);
  if (laps.some((l) => l.inlay)) return { key: 'part_inlay', label: 'loops with inlaid courses' };
  if (maxU === 0) return { key: 'pillar', label: 'pillar (chain) stitch' };
  // atlas: the overlap walks one needle further each course for several courses, then walks back
  const centre = laps.map((l) => (l.a + l.b) / 2);
  let run = 0, best = 0;
  for (let i = 1; i < centre.length; i++) { const st = centre[i] - centre[i - 1]; run = Math.abs(st) === 1 && Math.sign(st) === Math.sign(centre[i - 1] - (centre[i - 2] != null ? centre[i - 2] : centre[i - 1] - st)) ? run + 1 : Math.abs(st) === 1 ? 1 : 0; best = Math.max(best, run); }
  if (laps.length >= 4 && best >= 2) return { key: 'atlas', label: 'atlas (the lap walks across the needles and back)' };
  const names = { 1: 'tricot (1-needle underlap)', 2: '2-needle underlap (cord)', 3: '3-needle underlap (satin)', 4: '4-needle underlap (velvet)' };
  return { key: `u${Math.min(maxU, 5)}`, label: names[maxU] || `${maxU}-needle underlap` };
}

/** Yarn per course of one bar (mm), at needle pitch p and course spacing c. */
function courseLength(laps, p, c, delta) {
  const rn = (TN * p + delta) / 2;
  let sum = 0;
  for (const l of laps) {
    // a pillar (no underlap) draws each loop straight through the loop below it on the
    // same needle: its yarn turns once more round that loop's yarn (+ π·δ) — fitted: −9.8 % → 0 %
    const over = l.inlay ? 0 : 2 * c + Math.PI * rn + Math.max(0, l.o - 1) * p + (l.u === 0 ? Math.PI * delta : 0);
    const under = Math.sqrt((l.u * p) ** 2 + c * c);
    sum += over + under;
  }
  return sum / laps.length;
}

/**
 * DOUBLE-NEEDLE-BAR raschel: the pairs alternate front bed, back bed (one
 * machine course = two pairs); a pair with no swing (1-1) is no loop on that
 * bed. Yarn per machine course (mm) for one bar, the beds G mm apart:
 *   each loop          2c + π rn + (o − 1) p (+ π δ on a chain loop)
 *   to its next loop   same bed:  √((u p)² + (Δ c)²)
 *                      other bed: √((u p)² + G² + (Δ c)²)   — the spacer yarn crossing
 * Δ = machine courses between the two loops (half a course from one bed to the other).
 */
function dnbLength(pairs, p, c, delta, G) {
  const n = pairs.length, courses = n / 2, rn = (TN * p + delta) / 2;
  const ev = [];
  pairs.forEach(([a, b], i) => { if (a !== b) ev.push({ i, bed: i % 2, a, b, n: Math.min(a, b), o: Math.abs(b - a) }); });
  if (!ev.length) {
    // laid in: it only crosses inside its layer
    let s = 0;
    for (let i = 0; i < n; i++) { const u = Math.abs(pairs[(i + 1) % n][0] - pairs[i][1]); s += Math.sqrt((u * p) ** 2 + (c / 2) ** 2); }
    return { perCourse: s / courses, cross: 0, crossings: 0, slant: 0 };
  }
  let s = 0, cross = 0, crossings = 0, slant = 0;
  ev.forEach((e, k) => {
    const nx = ev[(k + 1) % ev.length];
    let dI = nx.i - e.i; if (dI <= 0) dI += n;
    const u = Math.abs(nx.a - e.b), dy = (c * dI) / 2;
    const same = nx.bed === e.bed;
    s += 2 * c + Math.PI * rn + Math.max(0, e.o - 1) * p + (same && dI === 2 && nx.n === e.n ? Math.PI * delta : 0);
    if (same) s += Math.sqrt((u * p) ** 2 + dy * dy);
    else {
      const L = Math.sqrt((u * p) ** 2 + G * G + dy * dy);
      s += L; cross += L; crossings++;
      slant += Math.abs(nx.n - e.n);
    }
  });
  return { perCourse: s / courses, cross: cross / courses, crossings: crossings / courses, slant: crossings ? slant / crossings : 0 };
}
/** Which bed(s) a bar loops on: 'front', 'back', 'spacer' (both) or 'inlay'. */
function bedRole(pairs) {
  const f = pairs.some(([a, b], i) => i % 2 === 0 && a !== b), bk = pairs.some(([a, b], i) => i % 2 === 1 && a !== b);
  return f && bk ? 'spacer' : f ? 'front' : bk ? 'back' : 'inlay';
}
const bedPairs = (pairs, bed) => pairs.filter((_, i) => i % 2 === bed);

/**
 * Does the cloth hold together? Every threaded end is followed across a band
 * of needles: a loop joins the needle it is on to the needle of the end's
 * next loop; an inlaid end ties the needles it lies across. The knitting
 * needles in the middle of the band must form ONE connected net (else the
 * cloth falls apart into strips — pillars with nothing laid across them).
 * A needle that knits but gets no loop at some course presses its loop off:
 * an open hole (a net's eyelet; in a closed cloth, a fault).
 */
function holdsTogether(bars, beds, repeatPairs) {
  const W = 44, LO = 14, HI = 30;
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const node = (k) => { if (!parent.has(k)) parent.set(k, k); return k; };
  const union = (a, b) => { const ra = find(node(a)), rb = find(node(b)); if (ra !== rb) parent.set(ra, rb); };
  const knit = new Map();
  bars.forEach((b) => {
    const P = b.pairs.length, thr = b.thread.pattern, T = thr.length;
    const hi = Math.max(...b.pairs.flat());
    for (let g = -hi - 2; g <= W + 2; g++) {
      if (thr[((g % T) + T) % T] !== 'X') continue;
      let prev = null, lo = Infinity, top = -Infinity, loops = 0;
      for (let i = 0; i < 2 * repeatPairs; i++) {
        const [a, z] = b.pairs[i % P], bed = beds === 2 ? i % 2 : 0;
        lo = Math.min(lo, a + g, z + g); top = Math.max(top, a + g, z + g);
        if (a === z) continue;
        const key = `${bed}:${Math.min(a, z) + g}`;
        node(key); loops++;
        if (!knit.has(key)) knit.set(key, new Set());
        knit.get(key).add(i % repeatPairs);
        if (prev) union(prev, key);
        prev = key;
        // the underlap to the next pair lies across the needles between: their loops bind it
        const na = b.pairs[(i + 1) % P][0] + g, from = z + g;
        for (let m = Math.min(na, from); m + 1 < Math.max(na, from); m++) union(`${bed}:${m}`, `${bed}:${m + 1}`);
      }
      if (!loops) for (let n = lo; n + 1 < top; n++) union(`0:${n}`, `0:${n + 1}`);
    }
  });
  const central = [...knit.keys()].filter((k) => { const n = +k.split(':')[1]; return n >= LO && n < HI; });
  const roots = new Set(central.map(find));
  const pressed = [];
  central.forEach((k) => {
    const [bed, n] = k.split(':').map(Number), got = knit.get(k);
    for (let i = 0; i < repeatPairs; i++) if ((beds === 1 || i % 2 === bed) && !got.has(i)) { pressed.push({ bed, n, course: beds === 2 ? Math.floor(i / 2) + 1 : i + 1 }); break; }
  });
  return { pieces: roots.size, pressed, needles: central.length };
}

/**
 * BEAMS AND LET-OFF. Each bar runs off its own set of section beams across the
 * working width. A beam holds the yarn volume between barrel and flange at a
 * packing density (fibre density × packing fraction — modelled: flat
 * filament 0.70, monofilament 0.75, elastane 0.75, spun 0.45):
 *   capacity (kg)   = π/4 (D² − d²) · W · φ ρ
 *   warp length (m) = capacity ÷ (ends per beam · tex on the beam), tex on the beam = tex ÷ beam draft
 *   courses         = warp length ÷ run-in per course
 * The bar whose beams run out first sets the beam-set life; winding every bar
 * to that many courses lets the whole set run out together (a matched set).
 * Let-off speed = courses/min × run-in per course.
 */
const BEAM_DEFAULTS = { tricot: { flange_in: 21, barrel_in: 7, width_in: 21 }, raschel: { flange_in: 30, barrel_in: 8, width_in: 21 }, double_raschel: { flange_in: 30, barrel_in: 8, width_in: 21 } };
function packOf(y) { return (y.elastic ? 0.75 : y.mono ? 0.75 : /filament|polypropylene/.test(y.fibre) ? 0.70 : 0.45) * (RHO[y.fibre] || 1.2); }
function planBeams({ bars, per, barsOut, mType, widthIn, cpcM, kc, speed, eff, beam, orderM }) {
  const D0 = BEAM_DEFAULTS[mType] || BEAM_DEFAULTS.tricot;
  const pick = (k, lo, hi) => { const v = +beam[k]; return v >= lo && v <= hi ? v : D0[k]; };
  const flange = pick('flange_in', 10, 40), barrel = Math.min(pick('barrel_in', 3, 20), flange - 1), bw = pick('width_in', 6, 60);
  const nBeams = Math.max(1, Math.ceil(widthIn / bw - 1e-9));
  const volCm3 = (Math.PI / 4) * ((flange * 2.54) ** 2 - (barrel * 2.54) ** 2) * bw * 2.54;
  const coursesPerMin = speed * eff;
  const endsOf = (i) => Math.ceil(barsOut[i].ends / nBeams);
  // CALIBRATION: a full beam weighed (net kg) or measured (metres) on one bar sets the
  // packing for that yarn; the other bars keep their modelled packing scaled the same way
  let k = 1, calib = null;
  const cb = Math.min(bars.length, Math.max(1, Math.round(+beam.full_bar || 1))) - 1;
  const modelKg = (volCm3 * packOf(bars[cb].yarn)) / 1000;
  let measuredKg = +beam.full_kg > 0 ? +beam.full_kg : null;
  if (!measuredKg && +beam.full_m > 0) measuredKg = (+beam.full_m * endsOf(cb) * bars[cb].yarn.tex / bars[cb].yarn.beamDraft) / 1e6;
  if (measuredKg) {
    k = measuredKg / modelKg;
    calib = { bar: cb + 1, measured_kg: r1(measuredKg), modelled_kg: r1(modelKg), factor: r2(k), packing_g_cm3: r2(packOf(bars[cb].yarn) * k) };
  }
  // what stays on the beam (the last layers on the barrel) and what is lost in warping and knitting
  const residue = Math.min(10, Math.max(0, Number.isFinite(+beam.residue_pct) && beam.residue_pct !== '' && beam.residue_pct != null ? +beam.residue_pct : 1.5)) / 100;
  const waste = Math.min(25, Math.max(0, Number.isFinite(+beam.waste_pct) && beam.waste_pct !== '' && beam.waste_pct != null ? +beam.waste_pct : 2)) / 100;
  const rows = bars.map((b, i) => {
    const x = per[i];
    const endsPerBeam = endsOf(i);
    const density = packOf(b.yarn) * k;
    const kgBeam = (volCm3 * density) / 1000;
    const texOnBeam = b.yarn.tex / b.yarn.beamDraft;
    const lengthM = (kgBeam * 1e6) / (endsPerBeam * texOnBeam);
    const courses = (lengthM * (1 - residue) * 1000) / x.runin;          // what can be knitted before the residue
    return {
      bar: b.n, beams: nBeams, ends_per_beam: endsPerBeam, density_g_cm3: r2(density), kg_per_beam: r1(kgBeam), kg_per_set: r1(kgBeam * nBeams),
      warp_length_m: Math.round(lengthM), runin_mm_per_rack: Math.round(x.runin * RACK), let_off_m_per_min: r2((coursesPerMin * x.runin) / 1000),
      courses: Math.round(courses), fabric_m: Math.round(courses / (cpcM * 100) / kc), hours: r1(courses / coursesPerMin / 60),
    };
  });
  const lim = rows.reduce((a, r) => (r.courses < a.courses ? r : a), rows[0]);
  // a matched set: every bar wound to the limiting bar's courses (plus its residue), all run out together
  const matched = rows.map((r, i) => {
    const lengthM = (lim.courses * per[i].runin) / 1000 / (1 - residue);
    return { bar: r.bar, warp_length_m: Math.round(lengthM), kg_per_beam: r1((lengthM * r.ends_per_beam * bars[i].yarn.tex / bars[i].yarn.beamDraft) / 1e6), full_pct: Math.round((lim.courses / r.courses) * 100) };
  });
  let order = null;
  if (orderM > 0) {
    const courses = orderM * kc * cpcM * 100;
    order = {
      finished_m: orderM, courses: Math.round(courses), hours: r1(courses / coursesPerMin / 60), beam_sets: r2(courses / lim.courses), waste_pct: r1(waste * 100), residue_pct: r1(residue * 100),
      yarn: rows.map((r, i) => {
        const net = (barsOut[i].ends * per[i].fed * courses * bars[i].yarn.tex) / 1e9;
        // to buy: the net yarn, the beam residue, then warping and knitting waste
        const gross = net / (1 - residue) / (1 - waste);
        return { bar: r.bar, kg: r1(net), kg_gross: r1(gross), warp_length_m: Math.round((courses * per[i].runin) / 1000 / (1 - residue)) };
      }),
    };
    order.kg_net = r1(order.yarn.reduce((t, y) => t + y.kg, 0));
    order.kg_gross = r1(order.yarn.reduce((t, y) => t + y.kg_gross, 0));
  }
  const warn = rows.some((r) => r.ends_per_beam > 1600) ? `Over 1,600 ends on one section beam (bar${rows.filter((r) => r.ends_per_beam > 1600).map((r) => ' ' + r.bar).join(',')}): beyond what a warping creel usually holds — use narrower section beams or more of them.`
    : calib && (k < 0.5 || k > 1.6) ? `Your beam (${calib.measured_kg} kg) is ${k < 1 ? 'far lighter' : 'far heavier'} than this beam size holds at a normal packing (${calib.modelled_kg} kg modelled): check the flange, barrel and width, and that the weight is the yarn alone (net of the empty beam).` : null;
  return {
    flange_in: flange, barrel_in: barrel, width_in: bw, beams_per_bar: nBeams, per_bar: rows, limiting_bar: lim.bar,
    set_hours: lim.hours, set_fabric_m: lim.fabric_m, matched, order, warn, calibration: calib, residue_pct: r1(residue * 100), waste_pct: r1(waste * 100),
    basis: `section beams ${flange}" flange × ${barrel}" barrel × ${bw}" wide (${D0 === BEAM_DEFAULTS.tricot ? 'tricot' : 'raschel'} defaults unless you set them); `
      + (calib ? `packing calibrated on your bar ${calib.bar} beam: ${calib.measured_kg} kg against ${calib.modelled_kg} kg modelled (× ${calib.factor})` : 'packing density modelled (flat filament 0.70, mono and elastane 0.75, spun 0.45 × fibre density) — weigh one full beam to calibrate it')
      + `; ${r1(residue * 100)} % left on the beam; elastane wound at its beam draft`,
  };
}

/**
 * YARN COST from the prices the user gives (any currency, per kg of each bar's yarn).
 * Per finished metre: Σ bars (machine-length kg per 1,000 m × kc ÷ 1,000) × price, grossed up
 * for what stays on the beams and the warping/knitting waste (see planBeams). Dyeing,
 * finishing and conversion are not here — this is the yarn only.
 */
function costPlan({ barsIn, barsOut, kc, widthM, gsm, beams }) {
  const prices = barsIn.map((b) => (+b.price > 0 ? +b.price : null));
  if (!prices.some((p) => p != null)) return null;
  if (prices.some((p) => p == null)) return { missing: barsOut.filter((_, i) => prices[i] == null).map((b) => b.bar) };
  const gross = 1 / (1 - (beams.residue_pct || 0) / 100) / (1 - (beams.waste_pct || 0) / 100);
  const perBar = barsOut.map((b, i) => {
    const kgM = (b.kg_per_1000m * kc) / 1000;                 // net yarn, kg per finished metre
    return { bar: b.bar, price: prices[i], kg_per_m: r3(kgM * gross), cost_per_m: r3(kgM * gross * prices[i]) };
  });
  const perM = perBar.reduce((t, x) => t + x.cost_per_m, 0);
  const kgFabricPerM = (gsm * widthM) / 1000;                 // finished fabric, kg per metre
  const yarnKgPerM = perBar.reduce((t, x) => t + x.kg_per_m, 0);
  return {
    per_bar: perBar, cost_per_m: r3(perM), cost_per_m2: r3(perM / widthM), cost_per_kg_fabric: r3(perM / kgFabricPerM),
    yarn_kg_per_m: r3(yarnKgPerM), gross_factor: r3(gross),
    basis: `yarn only, at your prices; includes ${r1(((gross - 1) / gross) * 100)} % lost on the beam residue and waste. Dyeing, finishing and conversion are not included`,
  };
}

// the fabric name for the common two-bar structures (front bar first)
function nameOf(bars) {
  const base = nameOf0(bars);
  const el = bars.filter((b) => b.yarn.elastic);
  return base && el.length && !/Powernet|Elastic/.test(base) ? `${base} with elastane (bar${el.map((b) => ' ' + b.n).join(',')})` : base;
}
function nameOf0(bars) {
  if (bars[0].role) {
    const ground = bars.filter((b) => b.role === 'front' || b.role === 'back');
    const open = ground.some((b) => b.thread.fraction < 1);
    const sp = bars.filter((b) => b.role === 'spacer');
    if (!sp.length) return null;
    return `${open ? 'Spacer mesh (open face)' : 'Spacer fabric'}${sp.every((b) => b.yarn.mono) ? ', monofilament spacer yarns' : ''}`;
  }
  const loop = bars.filter((b) => b.kind.key !== 'inlay');
  if (!bars.some((b) => b.yarn.elastic) && loop.length >= 2 && loop.every((b) => b.thread.fraction < 1)) return loop.some((b) => b.laps.length >= 6) ? 'Hexagonal net (sandfly / tulle type)' : 'Net (part-threaded ground: marquisette / tulle type)';
  const sig = bars.map((b) => b.kind.key).join('+');
  const counter = bars.length >= 2 && bars[0].laps[0].dir !== 0 && bars[1].laps[0].dir !== 0 && bars[0].laps[0].dir === -bars[1].laps[0].dir;
  if (bars.length === 2 && sig === 'u1+u1') return counter ? 'Full tricot (jersey)' : 'Tricot, both bars lapping the same way';
  if (bars.length === 2 && sig === 'u2+u1') return 'Locknit (charmeuse)';
  if (bars.length === 2 && sig === 'u1+u2') return 'Reverse locknit';
  if (bars.length === 2 && sig === 'u3+u1') return 'Satin (3-needle front bar)';
  if (bars.length === 2 && (sig === 'u4+u1' || sig === 'u5+u1')) return 'Velour / velvet (long front underlap, for cutting or raising)';
  if (bars.length === 2 && sig === 'u1+u3') return 'Sharkskin';
  if (bars.length === 2 && sig === 'pillar+u3') return 'Queenscord';
  if (bars.some((b) => b.yarn.elastic) && bars.some((b) => b.thread.fraction < 1)) return 'Powernet (net with elastane)';
  if (loop.length >= 2 && loop.every((b) => b.thread.fraction < 1)) return loop.every((b) => b.kind.key !== 'pillar') && loop.some((b) => b.laps.length >= 6) ? 'Hexagonal net (sandfly / tulle type)' : 'Net (part-threaded ground: marquisette / tulle type)';
  if (bars.some((b) => b.yarn.elastic && (b.kind.key === 'inlay' || b.kind.key === 'part_inlay'))) return 'Elastic raschel (elastane laid in)';
  if (sig.startsWith('pillar') && bars.slice(1).some((b) => b.kind.key === 'inlay')) return 'Pillar-inlay (marquisette / raschel ground)';
  if (bars.every((b) => b.kind.key === 'atlas')) return 'Atlas';
  if (loop.length === 1 && bars.length === 1) return `Single-bar ${bars[0].kind.label}`;
  return null;
}

/**
 * @param input { machine: {type, gauge, width_in, speed_cpm, efficiency, cpc}, bars: [{notation, threading, yarn:{count,unit,fibre,filaments,ply,draft}}],
 *                target: {gsm, width_in (finished)} }
 */
function analyse(input) {
  try {
    const m = input.machine || {};
    const M = MACHINES[m.type] || MACHINES.tricot;
    const mType = MACHINES[m.type] ? m.type : 'tricot';
    const barsIn = Array.isArray(input.bars) ? input.bars : [];
    if (!barsIn.length) throw new WarpError('Give at least one guide bar.');
    if (barsIn.length > 8) throw new WarpError('At most 8 guide bars here (multi-bar lace raschels are not modelled).');
    const E = +m.gauge > 0 ? +m.gauge : mType === 'tricot' ? 28 : 24;
    const p = 25.4 / E;
    const widthIn = +m.width_in > 0 ? +m.width_in : mType === 'tricot' ? 130 : 136;
    const beds = M.beds;
    const step = +m.notation_step === 2 ? 2 : 1;
    // the gap between the two needle beds (double-needle-bar): sets the spacer's thickness
    const G = beds === 2 ? (+m.gap_mm > 0 ? +m.gap_mm : 6) : 0;
    if (beds === 2 && (G < 1 || G > 65)) throw new WarpError(`A ${G} mm gap between the needle beds is outside what double-needle-bar machines set (about 1–65 mm).`);
    const bars = barsIn.map((b, i) => {
      const pairs = parseNotation(b.notation, i + 1, { step });
      if (beds === 2 && pairs.length % 2) throw new WarpError(`Bar ${i + 1}: on a double-needle-bar machine every course has two pairs — the front bed, then the back bed (e.g. 1-0/1-1/0-1/1-1// or 1-0-1-1/0-1-1-1//). This lapping has ${pairs.length}.`);
      const yarn = readYarn(b.yarn, i + 1);
      const thread = threadingOf(b.threading, i + 1);
      if (beds === 2) {
        // each bed's own lapping, read as a single-bed one
        const role = bedRole(pairs);
        const own = role === 'back' ? bedPairs(pairs, 1) : bedPairs(pairs, 0);
        const laps = lapping(own.some(([a, z]) => a !== z) ? own : pairs);
        const kind = role === 'spacer' ? { key: 'spacer', label: 'spacer yarn (loops on both beds, crosses between the faces)' }
          : role === 'inlay' ? { key: 'inlay', label: 'inlay (laid in, no loops)' }
          : { key: kindOf(laps).key, label: `${role} face: ${kindOf(laps).label}` };
        return { n: i + 1, notation: pairs.map((q) => q.join('-')).join('/') + '//', pairs, laps, yarn, thread, kind, role };
      }
      const laps = lapping(pairs);
      return { n: i + 1, notation: pairs.map((q) => q.join('-')).join('/') + '//', pairs, laps, yarn, thread, kind: kindOf(laps) };
    });
    const repeatPairs = bars.reduce((t, b) => lcm(t, b.pairs.length), 1);
    const repeat = beds === 2 ? repeatPairs / 2 : repeatPairs;
    const elastic = bars.some((b) => b.yarn.elastic);
    // finished state: the cloth narrows and closes up off the machine
    let kw = elastic ? 1.8 : M.kw;
    const kc = elastic ? 1.6 : M.kc;
    const tgtW = +((input.target || {}).width_in);
    const needles = Math.round(E * widthIn);
    const wpcMachine = E / 2.54;
    if (tgtW > 0) kw = (needles / (tgtW * 2.54)) / wpcMachine;

    // GSM at a machine course density
    const at = (cpcM) => {
      const c = 10 / cpcM;
      const per = bars.map((b) => {
        const dn = beds === 2 ? dnbLength(b.pairs, p, c, b.yarn.d_mm, G) : null;
        const lc = dn ? dn.perCourse : courseLength(b.laps, p, c, b.yarn.d_mm);      // mm of yarn per end per course (on the machine)
        const fed = lc / b.yarn.draft;                           // relaxed yarn per course (the mass): elastane is knitted drafted
        const runin = fed * b.yarn.beamDraft;                    // off the beam, where it is already wound stretched
        const ends = wpcMachine * kw * b.thread.fraction;        // ends per cm, finished
        const gsm = (ends * cpcM * kc * fed * b.yarn.tex) / 100;
        return { lc, fed, runin, ends, gsm, dn };
      });
      return { per, gsm: per.reduce((t, x) => t + x.gsm, 0) };
    };
    const tg = +((input.target || {}).gsm);
    let cpcM, cpcSource;
    if (+m.cpc > 0) { cpcM = +m.cpc; cpcSource = 'your machine setting'; }
    else if (tg > 0) {
      let lo = 3, hi = 60;
      if (at(lo).gsm > tg) throw new WarpError(`${tg} GSM is lighter than these bars knit at the loosest quality (${Math.round(at(lo).gsm)} GSM at 3 courses/cm): use a finer yarn or part threading.`);
      if (at(hi).gsm < tg) throw new WarpError(`${tg} GSM is heavier than these bars knit at the closest quality (${Math.round(at(hi).gsm)} GSM at 60 courses/cm): use a coarser yarn or another bar.`);
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (at(mid).gsm < tg) lo = mid; else hi = mid; }
      cpcM = (lo + hi) / 2; cpcSource = `solved for ${tg} GSM`;
    } else throw new WarpError('Give a target GSM, or the courses per cm the machine knits (quality).');
    const R = at(cpcM);

    // ── checks ──
    const checks = [];
    const add = (level, text) => checks.push({ level, text });
    if (bars.length < M.bars[0] || bars.length > M.bars[1]) add('warn', `${M.label}: usually ${M.bars[0]}–${M.bars[1]} guide bars; this design has ${bars.length}.`);
    if (E < M.gauges[0] || E > M.gauges[1]) add('warn', `E${E} is outside the gauges a ${mType.replace('_', ' ')} is usually built in (E${M.gauges[0]}–E${M.gauges[1]}).`);
    bars.forEach((b) => {
      const maxU = Math.max(...b.laps.map((l) => l.u));
      if (maxU > M.shog) add('error', `Bar ${b.n}: an underlap across ${maxU} needles — more than this machine's guide bar shogs (about ${M.shog}, modelled).`);
      if (b.laps.some((l) => l.o > 2)) add('warn', `Bar ${b.n}: an overlap across more than 2 needles is not a normal loop — check the notation.`);
    });
    // every course must form loops on every needle, or the fabric falls apart
    if (beds === 1) for (let k = 0; k < repeat; k++) {
      const looping = bars.filter((b) => !b.laps[k % b.laps.length].inlay);
      if (!looping.length) add('error', `Course ${k + 1}: no bar makes a loop — every bar inlays or rests, so the fabric is not held together at that course.`);
      else if (!looping.some((b) => b.thread.fraction === 1) && looping.every((b) => b.thread.pattern === looping[0].thread.pattern)) add('note', `Course ${k + 1}: every loop-forming bar is part-threaded the same way — the empty needles knit no loop: an open net.`);
    }
    if (beds === 1 && bars[0].kind.key === 'inlay') add('error', 'Bar 1 (the front bar) inlays: an inlay is held by the loops and underlaps of the bars in front of it, so it must be on a bar further back.');
    if (beds === 1) bars.forEach((b, i) => { if (b.kind.key === 'inlay' && !bars.slice(0, i).some((x) => x.kind.key !== 'inlay')) add('error', `Bar ${b.n} inlays with no loop-forming bar in front of it to hold it.`); });
    if (beds === 1 && bars.length >= 2) {
      const [f, b2] = bars;
      if (f.kind.key !== 'inlay' && b2.kind.key !== 'inlay' && f.laps[0].dir !== 0 && f.laps[0].dir === b2.laps[0].dir)
        add('warn', 'Bars 1 and 2 lap the same way: the loops lean (a skew in the cloth) and the structure splits along the wales more easily. Counter-lap them (one bar underlaps left while the other underlaps right).');
    }
    if (beds === 2) {
      // both faces must be knitted every course, and joined
      for (let k = 0; k < repeat; k++) for (const bed of [0, 1]) {
        if (!bars.some((b) => { const q = b.pairs[(2 * k + bed) % b.pairs.length]; return q[0] !== q[1]; }))
          add('error', `Course ${k + 1}: no bar makes a loop on the ${bed ? 'back' : 'front'} bed — that face is not knitted at that course.`);
      }
      const sp = bars.filter((b) => b.role === 'spacer');
      if (!sp.length) add('error', 'No bar knits on both beds: nothing joins the two faces — the machine knits two separate fabrics. Give a spacer bar loops on both beds (e.g. 1-0/0-1// on a pair: front 1-0, back 0-1).');
      if (!bars.some((b) => b.role === 'front' || b.role === 'back') && sp.length) add('note', 'Every looping bar is a spacer bar: the spacer yarns knit both faces themselves (a pile-only spacer).');
      sp.forEach((b) => {
        if (!b.yarn.mono && G > 6) add('warn', `Bar ${b.n}: a ${G} mm spacer with a multifilament spacer yarn will not stand up — it collapses under its own weight; spacers above ~5 mm use a monofilament (0.1–0.25 mm).`);
        if (b.yarn.mono && b.yarn.d_mm > 0.45 * p) add('warn', `Bar ${b.n}: a ${r2(b.yarn.d_mm)} mm monofilament is thick for E${E} (${r2(p)} mm needle pitch) — the needle hook and the guides are too tight for it.`);
      });
      if (G > 20) add('note', `${G} mm between the beds: a high-distance machine (most double-needle-bar raschels set about 2–20 mm).`);
    }
    // does the cloth hold together, and where are its holes?
    {
      const h = holdsTogether(bars, beds, repeatPairs);
      if (h.needles && h.pieces > 1) add('error', `The wales are not joined sideways: this lapping knits ${h.pieces} separate pieces (strips or chains with nothing laid across them). Give a bar an underlap or an inlay that crosses between them.`);
      if (h.pressed.length) {
        const net = bars.some((b) => b.thread.fraction < 1);
        const ex = h.pressed.slice(0, 3).map((x) => `needle ${x.n}${beds === 2 ? (x.bed ? ' (back)' : ' (front)') : ''} at course ${x.course}`).join(', ');
        add(net ? 'note' : 'warn', `Some needles get no new loop at some courses (${ex}…): their loop is pressed off — ${net ? "the net's open holes" : 'a hole or a dropped stitch in a closed cloth; check the lapping'}.`);
      }
    }
    // (per looped course: a bar that inlays on some courses averages fewer loops)
    const shortLoops = beds === 1 && R.per.some((x, i) => { const L = bars[i].laps, k = L.filter((l) => !l.inlay).length / L.length; return k > 0 && x.lc < k * (Math.PI * ((TN * p + bars[i].yarn.d_mm) / 2) + 2 * (10 / cpcM)) - 1e-9; });
    if (shortLoops) add('warn', 'Very short loops for this gauge — check the quality.');
    if (cpcM > 35) add('warn', `${r1(cpcM)} courses/cm on the machine is a very close quality — a stiff cloth and slow running.`);
    if (cpcM < 6) add('warn', `${r1(cpcM)} courses/cm on the machine is a very open quality — an unstable cloth.`);

    // ── character from the lapping ──
    const front = bars[0], back = bars[bars.length - 1];
    const fU = Math.max(...front.laps.map((l) => l.u));
    const counter = bars.length >= 2 && bars[0].laps[0].dir !== 0 && bars[1].laps[0].dir !== 0 && bars[0].laps[0].dir === -bars[1].laps[0].dir;
    const character = [];
    const say = (area, text) => character.push({ area, text });
    if (beds === 2) say('Face and back', `Two faces knitted at once, one on each needle bed, ${G} mm apart, joined by the spacer yarns of bar${bars.filter((b) => b.role === 'spacer').map((b) => ' ' + b.n).join(',')}; each face's technical back (its underlaps) faces inwards.`);
    else say('Face and back', `The front bar (bar 1) shows most: its underlaps lie outermost on the technical back and its loops on the face — ${front.yarn.label} ${front.yarn.fibre_label.toLowerCase()} decides the look${fU >= 2 ? '; its long underlaps give a smooth, covered back that raises or brushes well' : ''}.`);
    say('Stability', bars.some((b) => b.kind.key === 'pillar') ? 'Pillar stitches hold the length: little lengthwise stretch.' : fU >= 2 ? `The ${fU}-needle front underlap ties the wales together: firm across the width, little widthwise stretch.` : 'Short underlaps: the cloth stretches in both directions.');
    say('Runs and splitting', counter ? 'Counter-lapped bars lock each loop: the cloth does not ladder, and resists splitting.' : bars.length === 1 ? 'One bar: the loops of a wale are joined only by their own underlaps — it unravels and splits easily.' : 'Bars lapping the same way: the loops are not locked against each other — prone to splitting along the wales.');
    if (elastic) say('Stretch', `Elastane on bar${bars.filter((b) => b.yarn.elastic).map((b) => ' ' + b.n).join(',')}, fed at a draft of ${bars.find((b) => b.yarn.elastic).yarn.draft}: power stretch and recovery; the cloth closes up strongly off the machine.`);
    if (bars.some((b) => b.laps.some((l) => !l.inlay && !l.closed))) say('Laps', `Open laps on bar${bars.filter((b) => b.laps.some((l) => !l.inlay && !l.closed)).map((b) => ' ' + b.n).join(',')}: the yarn does not cross at the loop's foot — a softer, more open loop.`);
    let spacer = null;
    if (beds === 2) {
      // the spacer: thickness from the bed gap, its yarns' slant and how many stand per cm²
      const sp = bars.map((b, i) => ({ b, x: R.per[i] })).filter((o) => o.b.role === 'spacer');
      const skin = (role) => Math.max(0, ...bars.filter((b) => b.role === role || b.role === 'spacer').map((b) => b.yarn.d_mm));
      const greige = G + 2 * skin('front') + 2 * skin('back');
      const mono = sp.length && sp.every((o) => o.b.yarn.mono);
      // a monofilament spacer stands nearly at the gap; a multifilament one sags (modelled)
      const stand = mono ? 0.95 : Math.max(0.45, 1 - 0.04 * G);
      const perCm2 = sp.reduce((t, o) => t + o.x.ends * (o.x.dn ? o.x.dn.crossings : 0) * cpcM * kc, 0);
      const slant = sp.length ? sp.reduce((t, o) => t + (o.x.dn ? o.x.dn.slant : 0), 0) / sp.length : 0;
      const angle = Math.atan((slant * p) / G) * 180 / Math.PI;
      spacer = {
        gap_mm: G, thickness_mm: r1(greige * stand), greige_thickness_mm: r1(greige), spacer_yarns_per_cm2: r1(perCm2), slant_needles: r1(slant), angle_deg: r1(angle),
        share_pct: r1(sp.reduce((t, o) => t + o.x.gsm, 0) / R.gsm * 100),
        basis: `thickness = bed gap + both faces (2 yarn diameters each)${mono ? ', a monofilament standing at ~95 %' : ', a multifilament spacer sagging'} — modelled`,
      };
      say('Thickness', `${spacer.thickness_mm} mm (bed gap ${G} mm${mono ? '' : '; multifilament spacer yarns sag, so it is less than the gap'}): ${r1(perCm2)} spacer yarns cross per cm².`);
      say('Compression', slant < 0.5 ? 'The spacer yarns stand straight across (each loops on the same needle on both beds): stiff at first touch, then they buckle all together — a firm but collapsing cushion; the faces shear easily against each other.'
        : `The spacer yarns lean ${r1(angle)}° (across ${r1(slant)} needle${slant >= 1.5 ? 's' : ''}): they bend rather than buckle — a softer, progressive cushion that holds the faces from shearing${sp.length >= 2 ? ', best when two spacer bars lean opposite ways (crossed, an X)' : ''}.`);
      say('Air and moisture', 'The open middle layer moves air and moisture across the cloth — mattress covers, shoe uppers, car seats, bra cups and medical pads.');
    } else say('Curling', 'Like all single-faced warp knits, the edges curl towards the technical face lengthwise and the back crosswise — heat-set to flatten.');

    // ── production and beams ──
    const speed = +m.speed_cpm > 0 ? +m.speed_cpm : Math.round((M.speed[0] + M.speed[1]) / 2);
    const eff = (+m.efficiency > 0 ? +m.efficiency : 85) / 100;
    const mPerH = (speed * 60 * eff) / (cpcM * 100);              // machine length
    const finishedMperH = mPerH / kc;
    const finishedWidthIn = needles / (wpcMachine * kw) / 2.54;
    const kgh = (finishedMperH * (finishedWidthIn * 0.0254) * R.gsm) / 1000;
    const barsOut = bars.map((b, i) => {
      const x = R.per[i];
      const ends = Math.round(needles * b.thread.fraction);
      const runner = x.lc * RACK;
      return {
        bar: b.n, notation: b.notation, kind: b.kind.label, bed: b.role || 'front', threading: b.thread.pattern, threaded_pct: r1(b.thread.fraction * 100),
        yarn: b.yarn.label, fibre: b.yarn.fibre_label, tex: r2(b.yarn.tex), draft: b.yarn.draft > 1 ? b.yarn.draft : null,
        laps: b.laps.map((l) => ({ course: l.course, overlap: l.inlay ? 0 : l.o, underlap: l.u, lap: l.inlay ? 'inlay' : l.closed ? 'closed' : 'open' })),
        d_mm: r3(b.yarn.d_mm), mm_per_course: r3(x.lc), runner_mm_per_rack: Math.round(runner), fed_mm_per_rack: Math.round(x.runin * RACK), beam_draft: b.yarn.beamDraft > 1 ? r2(b.yarn.beamDraft) : null,
        ends, gsm: r1(x.gsm), pct: r1((x.gsm / R.gsm) * 100),
        // yarn this bar takes per 1,000 m of fabric off the machine
        kg_per_1000m: r2((ends * (x.fed / 1000) * (cpcM * 100) * 1000 * b.yarn.tex) / 1e6),
      };
    });
    const beamPlan = planBeams({ bars, per: R.per, barsOut, mType, widthIn, cpcM, kc, speed, eff, beam: input.beams || {}, orderM: +((input.target || {}).order_m) });
    if (beamPlan.warn) add('warn', beamPlan.warn);
    const cost = costPlan({ barsIn, barsOut, kc, widthM: finishedWidthIn * 0.0254, gsm: R.gsm, beams: beamPlan });
    const lappingPaths = bars.map((b) => ({ bar: b.n, pairs: b.pairs, role: b.role || null }));
    return {
      success: true,
      tech: 'warp',
      structure: { name: nameOf(bars), bars: bars.length, repeat_courses: repeat, counter_lapped: counter, beds, gap_mm: G || null },
      checks: checks.sort((a, b) => ({ error: 0, warn: 1, note: 2, ok: 3 }[a.level] - { error: 0, warn: 1, note: 2, ok: 3 }[b.level])),
      ok_to_knit: !checks.some((c) => c.level === 'error'),
      machine: {
        type: mType, label: M.label, needle: M.needle, gauge: E, pitch_mm: r3(p), width_in: widthIn, needles, speed_cpm: speed, efficiency_pct: Math.round(eff * 100),
        cpc_machine: r2(cpcM), cpc_source: cpcSource, m_per_hour: r1(mPerH), finished_m_per_hour: r1(finishedMperH), kg_per_hour: r2(kgh), use: M.use,
      },
      fabric: {
        spacer,
        gsm: Math.round(R.gsm), wpc: r2(wpcMachine * kw), cpc: r2(cpcM * kc), width_in: r1(finishedWidthIn),
        relax: { kw: r2(kw), kc: r2(kc), basis: tgtW > 0 ? 'width: your finished width; length: modelled' : `modelled for a ${mType.replace('_', ' ')}${elastic ? ' with elastane' : ''} (finished wales = machine × ${r2(kw)}, courses × ${r2(kc)})` },
        composition: barsOut.map((b) => ({ part: `bar ${b.bar}: ${b.yarn} ${b.fibre}`, pct: b.pct })),
        formula: 'GSM = Σ bars [ends/cm × courses/cm × yarn per course (mm) × tex] ÷ 100 (finished); yarn per course = 2c + π·rn + √((u·p)² + c²)',
      },
      bars: barsOut,
      beams: beamPlan,
      cost,
      character,
      lapping: lappingPaths,
      basis: 'geometry derived (loop legs, needle wrap, diagonal underlap), checked on 31 published constructions — runner median error about 4 %; wrap radius and the pillar term fitted there; tricot finished-state factors from 15 published nylon tricots; raschel factors and shog limits modelled; no factory warp records yet',
    };
  } catch (e) {
    if (e instanceof WarpError) return { success: false, error: e.message };
    throw e;
  }
}

// ── starting points ───────────────────────────────────────────────────────
const NY = (count, extra) => ({ count, unit: 'denier', fibre: 'nylon_filament', ...(extra || {}) });
const TEMPLATES = [
  { id: 'full_tricot', name: 'Full tricot (jersey)', machine: 'tricot', gauge: 28, gsm: 100, bars: [{ notation: '1-0/1-2//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }] },
  { id: 'locknit', name: 'Locknit (charmeuse)', machine: 'tricot', gauge: 28, gsm: 115, bars: [{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }] },
  { id: 'reverse_locknit', name: 'Reverse locknit', machine: 'tricot', gauge: 28, gsm: 115, bars: [{ notation: '1-0/1-2//', yarn: NY(40) }, { notation: '2-3/1-0//', yarn: NY(40) }] },
  { id: 'satin', name: 'Satin', machine: 'tricot', gauge: 28, gsm: 135, bars: [{ notation: '1-0/3-4//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }] },
  { id: 'velour', name: 'Velour (4-needle front, for raising)', machine: 'tricot', gauge: 28, gsm: 220, bars: [{ notation: '1-0/4-5//', yarn: NY(70) }, { notation: '1-2/1-0//', yarn: NY(40) }] },
  { id: 'sharkskin', name: 'Sharkskin', machine: 'tricot', gauge: 28, gsm: 140, bars: [{ notation: '1-0/1-2//', yarn: NY(40) }, { notation: '3-4/1-0//', yarn: NY(40) }] },
  { id: 'queenscord', name: 'Queenscord', machine: 'tricot', gauge: 28, gsm: 130, bars: [{ notation: '1-0/0-1//', yarn: NY(40) }, { notation: '3-4/1-0//', yarn: NY(40) }] },
  { id: 'swim_tricot', name: 'Swimwear tricot (nylon + elastane)', machine: 'tricot', gauge: 28, gsm: 190, bars: [{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: { count: 40, unit: 'denier', fibre: 'elastane', draft: 2.2 } }] },
  { id: 'powernet', name: 'Powernet', machine: 'raschel', gauge: 28, gsm: 180, bars: [{ notation: '1-0/0-1//', threading: 'X.', yarn: NY(40) }, { notation: '1-0/1-2/2-3/2-1//', threading: '.X', yarn: NY(40) }, { notation: '0-0/2-2//', threading: 'X.', yarn: { count: 280, unit: 'denier', fibre: 'elastane', draft: 2.5 } }] },
  { id: 'pillar_inlay', name: 'Pillar-inlay (marquisette)', machine: 'raschel', gauge: 24, gsm: 90, bars: [{ notation: '1-0/0-1//', yarn: { count: 75, unit: 'denier', fibre: 'polyester_filament' } }, { notation: '0-0/3-3//', yarn: { count: 75, unit: 'denier', fibre: 'polyester_filament' } }] },
  { id: 'sandfly', name: 'Sandfly net (hexagonal, half set)', machine: 'raschel', gauge: 24, gsm: 25, bars: [{ notation: '1-0/0-1/1-0/1-2/2-1/1-2//', threading: 'X.', yarn: NY(40) }, { notation: '1-2/2-1/1-2/1-0/0-1/1-0//', threading: '.X', yarn: NY(40) }] },
  // raschel-style notation (two numbers per needle space): a published three-bar elastic raschel
  { id: 'elastic_raschel', name: 'Elastic raschel (raschel notation 2-0/2-4)', machine: 'raschel', gauge: 28, gsm: 150, notation_step: 2, bars: [{ notation: '4-2/0-0/2-4/6-6//', yarn: NY(40, { filaments: 13 }) }, { notation: '2-2/2-4/2-2/2-0//', yarn: NY(40, { filaments: 13 }) }, { notation: '0-0/2-2/4-4/2-2//', yarn: { count: 140, unit: 'denier', fibre: 'elastane', draft: 2 } }] },
  // double-needle-bar: pairs alternate front bed, back bed
  { id: 'spacer', name: 'Spacer fabric (crossed monofilament, 6 bars)', machine: 'double_raschel', gauge: 18, gap: 5, gsm: 520, bars: [
    { notation: '1-0/1-1/1-2/2-2//', yarn: { count: 150, unit: 'denier', fibre: 'polyester_filament', filaments: 48 } },
    { notation: '1-0/0-0/0-1/1-1//', yarn: { count: 150, unit: 'denier', fibre: 'polyester_filament', filaments: 48 } },
    { notation: '1-0/1-2//', threading: 'X...', yarn: { count: 0.2, unit: 'mm', fibre: 'polyester_mono' } },
    { notation: '1-2/1-0//', threading: '..X.', yarn: { count: 0.2, unit: 'mm', fibre: 'polyester_mono' } },
    { notation: '0-0/1-0/1-1/0-1//', yarn: { count: 150, unit: 'denier', fibre: 'polyester_filament', filaments: 48 } },
    { notation: '1-1/1-0/2-2/1-2//', yarn: { count: 150, unit: 'denier', fibre: 'polyester_filament', filaments: 48 } }] },
  { id: 'spacer_stretch', name: 'Stretch spacer (7 bars, elastane faces)', machine: 'double_raschel', gauge: 22, gap: 3, gsm: 500, bars: [
    { notation: '2-1/1-1/0-1/1-1//', yarn: { count: 40, unit: 'denier', fibre: 'elastane', draft: 2 } },
    { notation: '0-1/1-1/3-2/2-2//', yarn: { count: 70, unit: 'denier', fibre: 'polyester_filament', filaments: 34 } },
    { notation: '1-0/1-2/2-3/2-1//', yarn: { count: 30, unit: 'denier', fibre: 'polyester_mono' } },
    { notation: '2-3/2-1/1-0/1-2//', yarn: { count: 30, unit: 'denier', fibre: 'polyester_mono' } },
    { notation: '1-0/0-1/0-1/1-0//', yarn: { count: 30, unit: 'denier', fibre: 'polyester_mono' } },
    { notation: '1-1/3-2/2-2/0-1//', yarn: { count: 70, unit: 'denier', fibre: 'polyester_filament', filaments: 34 } },
    { notation: '1-1/0-1/1-1/2-1//', yarn: { count: 40, unit: 'denier', fibre: 'elastane', draft: 2 } }] },
  { id: 'atlas', name: 'Atlas (2 bars)', machine: 'tricot', gauge: 28, gsm: 85, bars: [{ notation: '1-0/1-2/2-3/3-4/3-2/2-1//', yarn: NY(40) }, { notation: '3-4/3-2/2-1/1-0/1-2/2-3//', yarn: NY(40) }] },
];

module.exports = { analyse, MACHINES, FIBRES, TEMPLATES, parseNotation, lapping, courseLength, kindOf, dnbLength, bedRole, holdsTogether };
