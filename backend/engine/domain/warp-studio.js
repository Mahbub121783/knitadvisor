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
 * needle radius rn = (0.40 p + δ)/2:
 *   overlap   2c + π rn + (o − 1) p        (two legs, the head, a wider overlap)
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
 * × kc — kw, kc per machine class MODELLED (tricot 1.4 / 1.1, raschel 1.2 /
 * 1.1, with elastane 1.8 / 1.6); a finished width you give replaces kw.
 * Elastane is fed drafted: its runner is the geometric length ÷ draft.
 */
'use strict';

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;

class WarpError extends Error {}

const RACK = 480;
const TN = 0.40;            // compound / latch needle thickness ≈ 0.40 × pitch (modelled)

// ── machine classes ─────────────────────────────────────────────────────
const MACHINES = {
  tricot: {
    label: 'Tricot (compound needles, 2–4 guide bars)', bars: [2, 4], gauges: [24, 44], speed: [1500, 3300], shog: 6, needle: 'compound needle', beds: 1,
    kw: 1.4, kc: 1.1, use: 'lingerie, sportswear, linings, brushed and printed tricot, swimwear (with elastane)',
  },
  raschel: {
    label: 'Raschel (2–8 guide bars)', bars: [1, 8], gauges: [12, 32], speed: [800, 2000], shog: 10, needle: 'compound (or latch) needle', beds: 1,
    kw: 1.2, kc: 1.1, use: 'powernet, nets, curtains, technical fabrics, pillar-inlay, lace grounds',
  },
  double_raschel: {
    label: 'Double-needle-bar raschel (two beds)', bars: [4, 6], gauges: [12, 24], speed: [300, 900], shog: 6, needle: 'latch / compound needles, two bars', beds: 2,
    kw: 1.1, kc: 1.05, use: 'spacer fabrics, plush (cut between the beds), tubular articles',
  },
};

// ── yarns (warp knitting is mostly filament; spun yarns on raschel) ──────
const UNITS = { ne: (v) => 590.5 / v, nm: (v) => 1000 / v, tex: (v) => v, dtex: (v) => v / 10, denier: (v) => v / 9 };
const FIBRES = {
  nylon_filament: { label: 'Nylon (polyamide) filament', d: 0.99 }, polyester_filament: { label: 'Polyester filament', d: 0.90 },
  elastane: { label: 'Elastane (spandex)', d: 1.10, elastic: true }, polypropylene: { label: 'Polypropylene filament', d: 1.15 },
  cotton: { label: 'Cotton (spun)', d: 1.00 }, polyester_spun: { label: 'Polyester (spun)', d: 1.05 }, viscose: { label: 'Viscose', d: 1.00 },
};
function readYarn(y, bar) {
  const o = y || {};
  const unit = UNITS[String(o.unit || 'denier').toLowerCase()] ? String(o.unit || 'denier').toLowerCase() : 'denier';
  const v = +o.count;
  if (!(v > 0)) throw new WarpError(`Bar ${bar}: give the yarn count.`);
  const tex = UNITS[unit](v) * ([1, 2, 3].includes(+o.ply) ? +o.ply : 1);
  if (tex < 0.5 || tex > 120) throw new WarpError(`Bar ${bar}: ${r1(tex)} tex is outside 0.5–120 tex — check the count and the unit.`);
  const fibre = FIBRES[o.fibre] ? o.fibre : 'nylon_filament';
  const label = `${v} ${unit === 'ne' ? 'Ne' : unit === 'denier' ? 'D' : unit}${+o.filaments > 0 ? '/' + Math.round(+o.filaments) + 'F' : ''}`;
  return { tex, label, fibre, fibre_label: FIBRES[fibre].label, elastic: !!FIBRES[fibre].elastic, d_mm: (Math.sqrt(tex) / 28) * FIBRES[fibre].d,
    draft: FIBRES[fibre].elastic ? Math.min(4, Math.max(1.2, +o.draft > 0 ? +o.draft : 2.2)) : 1, denier: r1(tex * 9) };
}

// ── notation ──────────────────────────────────────────────────────────────
function parseNotation(text, bar) {
  const raw = String(text || '').replace(/\s+/g, '').replace(/\/\/+$/, '').replace(/\/+$/, '');
  if (!raw) throw new WarpError(`Bar ${bar}: write its lapping, e.g. 1-0/1-2//.`);
  const pairs = raw.split('/').map((p, k) => {
    const m = p.match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) throw new WarpError(`Bar ${bar}, course ${k + 1}: "${p}" is not a lapping pair — write two guide positions, e.g. 1-0.`);
    return [+m[1], +m[2]];
  });
  if (pairs.length > 48) throw new WarpError(`Bar ${bar}: at most 48 courses in a repeat.`);
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
    const over = l.inlay ? 0 : 2 * c + Math.PI * rn + Math.max(0, l.o - 1) * p;
    const under = Math.sqrt((l.u * p) ** 2 + c * c);
    sum += over + under;
  }
  return sum / laps.length;
}

// the fabric name for the common two-bar structures (front bar first)
function nameOf(bars) {
  const base = nameOf0(bars);
  const el = bars.filter((b) => b.yarn.elastic);
  return base && el.length && !/Powernet/.test(base) ? `${base} with elastane (bar${el.map((b) => ' ' + b.n).join(',')})` : base;
}
function nameOf0(bars) {
  const loop = bars.filter((b) => b.kind.key !== 'inlay');
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
    const bars = barsIn.map((b, i) => {
      const pairs = parseNotation(b.notation, i + 1);
      const laps = lapping(pairs);
      const yarn = readYarn(b.yarn, i + 1);
      const thread = threadingOf(b.threading, i + 1);
      return { n: i + 1, notation: pairs.map((q) => q.join('-')).join('/') + '//', pairs, laps, yarn, thread, kind: kindOf(laps) };
    });
    const repeat = bars.reduce((t, b) => lcm(t, b.pairs.length), 1);
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
        const lc = courseLength(b.laps, p, c, b.yarn.d_mm);      // mm of yarn per end per course (on the machine)
        const fed = lc / b.yarn.draft;                           // elastane is fed drafted
        const ends = wpcMachine * kw * b.thread.fraction;        // ends per cm, finished
        const gsm = (ends * cpcM * kc * fed * b.yarn.tex) / 100;
        return { lc, fed, ends, gsm };
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
    for (let k = 0; k < repeat; k++) {
      const looping = bars.filter((b) => !b.laps[k % b.laps.length].inlay);
      if (!looping.length) add('error', `Course ${k + 1}: no bar makes a loop — every bar inlays or rests, so the fabric is not held together at that course.`);
      else if (!looping.some((b) => b.thread.fraction === 1) && looping.every((b) => b.thread.pattern === looping[0].thread.pattern)) add('note', `Course ${k + 1}: every loop-forming bar is part-threaded the same way — the empty needles knit no loop: an open net.`);
    }
    if (bars[0].kind.key === 'inlay') add('error', 'Bar 1 (the front bar) inlays: an inlay is held by the loops and underlaps of the bars in front of it, so it must be on a bar further back.');
    bars.forEach((b, i) => { if (b.kind.key === 'inlay' && !bars.slice(0, i).some((x) => x.kind.key !== 'inlay')) add('error', `Bar ${b.n} inlays with no loop-forming bar in front of it to hold it.`); });
    if (bars.length >= 2) {
      const [f, b2] = bars;
      if (f.kind.key !== 'inlay' && b2.kind.key !== 'inlay' && f.laps[0].dir !== 0 && f.laps[0].dir === b2.laps[0].dir)
        add('warn', 'Bars 1 and 2 lap the same way: the loops lean (a skew in the cloth) and the structure splits along the wales more easily. Counter-lap them (one bar underlaps left while the other underlaps right).');
    }
    const shortLoops = R.per.some((x, i) => !bars[i].laps.every((l) => l.inlay) && x.lc < Math.PI * ((TN * p + bars[i].yarn.d_mm) / 2) + 2 * (10 / cpcM) - 1e-9);
    if (shortLoops) add('warn', 'Very short loops for this gauge — check the quality.');
    if (cpcM > 35) add('warn', `${r1(cpcM)} courses/cm on the machine is a very close quality — a stiff cloth and slow running.`);
    if (cpcM < 6) add('warn', `${r1(cpcM)} courses/cm on the machine is a very open quality — an unstable cloth.`);

    // ── character from the lapping ──
    const front = bars[0], back = bars[bars.length - 1];
    const fU = Math.max(...front.laps.map((l) => l.u));
    const counter = bars.length >= 2 && bars[0].laps[0].dir !== 0 && bars[1].laps[0].dir !== 0 && bars[0].laps[0].dir === -bars[1].laps[0].dir;
    const character = [];
    const say = (area, text) => character.push({ area, text });
    say('Face and back', `The front bar (bar 1) shows most: its underlaps lie outermost on the technical back and its loops on the face — ${front.yarn.label} ${front.yarn.fibre_label.toLowerCase()} decides the look${fU >= 2 ? '; its long underlaps give a smooth, covered back that raises or brushes well' : ''}.`);
    say('Stability', bars.some((b) => b.kind.key === 'pillar') ? 'Pillar stitches hold the length: little lengthwise stretch.' : fU >= 2 ? `The ${fU}-needle front underlap ties the wales together: firm across the width, little widthwise stretch.` : 'Short underlaps: the cloth stretches in both directions.');
    say('Runs and splitting', counter ? 'Counter-lapped bars lock each loop: the cloth does not ladder, and resists splitting.' : bars.length === 1 ? 'One bar: the loops of a wale are joined only by their own underlaps — it unravels and splits easily.' : 'Bars lapping the same way: the loops are not locked against each other — prone to splitting along the wales.');
    if (elastic) say('Stretch', `Elastane on bar${bars.filter((b) => b.yarn.elastic).map((b) => ' ' + b.n).join(',')}, fed at a draft of ${bars.find((b) => b.yarn.elastic).yarn.draft}: power stretch and recovery; the cloth closes up strongly off the machine.`);
    if (bars.some((b) => b.laps.some((l) => !l.inlay && !l.closed))) say('Laps', `Open laps on bar${bars.filter((b) => b.laps.some((l) => !l.inlay && !l.closed)).map((b) => ' ' + b.n).join(',')}: the yarn does not cross at the loop's foot — a softer, more open loop.`);
    say('Curling', 'Like all single-faced warp knits, the edges curl towards the technical face lengthwise and the back crosswise — heat-set to flatten.');

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
        bar: b.n, notation: b.notation, kind: b.kind.label, threading: b.thread.pattern, threaded_pct: r1(b.thread.fraction * 100),
        yarn: b.yarn.label, fibre: b.yarn.fibre_label, tex: r2(b.yarn.tex), draft: b.yarn.draft > 1 ? b.yarn.draft : null,
        laps: b.laps.map((l) => ({ course: l.course, overlap: l.inlay ? 0 : l.o, underlap: l.u, lap: l.inlay ? 'inlay' : l.closed ? 'closed' : 'open' })),
        mm_per_course: r3(x.lc), runner_mm_per_rack: Math.round(runner), fed_mm_per_rack: Math.round(x.fed * RACK),
        ends, gsm: r1(x.gsm), pct: r1((x.gsm / R.gsm) * 100),
        // yarn this bar takes per 1,000 m of fabric off the machine
        kg_per_1000m: r2((ends * (x.fed / 1000) * (cpcM * 100) * 1000 * b.yarn.tex) / 1e6),
      };
    });
    const lappingPaths = bars.map((b) => ({ bar: b.n, pairs: b.pairs }));
    return {
      success: true,
      tech: 'warp',
      structure: { name: nameOf(bars), bars: bars.length, repeat_courses: repeat, counter_lapped: counter },
      checks: checks.sort((a, b) => ({ error: 0, warn: 1, note: 2, ok: 3 }[a.level] - { error: 0, warn: 1, note: 2, ok: 3 }[b.level])),
      ok_to_knit: !checks.some((c) => c.level === 'error'),
      machine: {
        type: mType, label: M.label, needle: M.needle, gauge: E, pitch_mm: r3(p), width_in: widthIn, needles, speed_cpm: speed, efficiency_pct: Math.round(eff * 100),
        cpc_machine: r2(cpcM), cpc_source: cpcSource, m_per_hour: r1(mPerH), finished_m_per_hour: r1(finishedMperH), kg_per_hour: r2(kgh), use: M.use,
      },
      fabric: {
        gsm: Math.round(R.gsm), wpc: r2(wpcMachine * kw), cpc: r2(cpcM * kc), width_in: r1(finishedWidthIn),
        relax: { kw: r2(kw), kc: r2(kc), basis: tgtW > 0 ? 'width: your finished width; length: modelled' : `modelled for a ${mType.replace('_', ' ')}${elastic ? ' with elastane' : ''} (finished wales = machine × ${r2(kw)}, courses × ${r2(kc)})` },
        composition: barsOut.map((b) => ({ part: `bar ${b.bar}: ${b.yarn} ${b.fibre}`, pct: b.pct })),
        formula: 'GSM = Σ bars [ends/cm × courses/cm × yarn per course (mm) × tex] ÷ 100 (finished); yarn per course = 2c + π·rn + √((u·p)² + c²)',
      },
      bars: barsOut,
      character,
      lapping: lappingPaths,
      basis: 'geometry derived (loop legs, needle wrap, diagonal underlap); needle thickness 0.40 × pitch, finished-state factors and shog limits modelled — no factory warp records yet',
    };
  } catch (e) {
    if (e instanceof WarpError) return { success: false, error: e.message };
    throw e;
  }
}

// ── starting points ───────────────────────────────────────────────────────
const NY = (count, extra) => ({ count, unit: 'denier', fibre: 'nylon_filament', ...(extra || {}) });
const TEMPLATES = [
  { id: 'full_tricot', name: 'Full tricot (jersey)', machine: 'tricot', gauge: 28, gsm: 110, bars: [{ notation: '1-0/1-2//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }] },
  { id: 'locknit', name: 'Locknit (charmeuse)', machine: 'tricot', gauge: 28, gsm: 130, bars: [{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }] },
  { id: 'reverse_locknit', name: 'Reverse locknit', machine: 'tricot', gauge: 28, gsm: 130, bars: [{ notation: '1-0/1-2//', yarn: NY(40) }, { notation: '2-3/1-0//', yarn: NY(40) }] },
  { id: 'satin', name: 'Satin', machine: 'tricot', gauge: 28, gsm: 150, bars: [{ notation: '1-0/3-4//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: NY(40) }] },
  { id: 'velour', name: 'Velour (4-needle front, for raising)', machine: 'tricot', gauge: 28, gsm: 220, bars: [{ notation: '1-0/4-5//', yarn: NY(70) }, { notation: '1-2/1-0//', yarn: NY(40) }] },
  { id: 'sharkskin', name: 'Sharkskin', machine: 'tricot', gauge: 28, gsm: 160, bars: [{ notation: '1-0/1-2//', yarn: NY(40) }, { notation: '3-4/1-0//', yarn: NY(40) }] },
  { id: 'queenscord', name: 'Queenscord', machine: 'tricot', gauge: 28, gsm: 150, bars: [{ notation: '1-0/0-1//', yarn: NY(40) }, { notation: '3-4/1-0//', yarn: NY(40) }] },
  { id: 'swim_tricot', name: 'Swimwear tricot (nylon + elastane)', machine: 'tricot', gauge: 28, gsm: 190, bars: [{ notation: '1-0/2-3//', yarn: NY(40) }, { notation: '1-2/1-0//', yarn: { count: 40, unit: 'denier', fibre: 'elastane', draft: 2.2 } }] },
  { id: 'powernet', name: 'Powernet', machine: 'raschel', gauge: 28, gsm: 180, bars: [{ notation: '1-0/0-1//', threading: 'X.', yarn: NY(40) }, { notation: '1-0/1-2/2-3/2-1//', threading: '.X', yarn: NY(40) }, { notation: '0-0/2-2//', threading: 'X.', yarn: { count: 280, unit: 'denier', fibre: 'elastane', draft: 2.5 } }] },
  { id: 'pillar_inlay', name: 'Pillar-inlay (marquisette)', machine: 'raschel', gauge: 24, gsm: 90, bars: [{ notation: '1-0/0-1//', yarn: { count: 75, unit: 'denier', fibre: 'polyester_filament' } }, { notation: '0-0/3-3//', yarn: { count: 75, unit: 'denier', fibre: 'polyester_filament' } }] },
  { id: 'atlas', name: 'Atlas (2 bars)', machine: 'tricot', gauge: 28, gsm: 95, bars: [{ notation: '1-0/1-2/2-3/3-4/3-2/2-1//', yarn: NY(40) }, { notation: '3-4/3-2/2-1/1-0/1-2/2-3//', yarn: NY(40) }] },
];

module.exports = { analyse, MACHINES, FIBRES, TEMPLATES, parseNotation, lapping, courseLength, kindOf };
