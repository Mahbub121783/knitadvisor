/**
 * KnitAdvisor — Colourway engine: a cloth made of several yarn colours, dyed as YARN before it is knitted (stripes, wale stripes, jacquard).
 *
 *   1  FACE MAP     the drawing's feeds and the colour each feeder carries (a stripe written as A12 B4 C2 or a colour per feeder) become
 *                   the colour of every loop on the face (and on the back of a double bed). Feeds are grouped into pixel rows: a row is
 *                   the run of feeds in which every needle knits once, so a jacquard row of two colours is two feeds, a stripe row is one.
 *   2  KIND         every row one colour                    → horizontal stripe
 *                   every row the same colours by needle   → wale (vertical) stripe — an interlock whose two feeders of one course carry
 *                                                             two colours makes this, because each feeder knits every other wale
 *                   anything else                           → motif (needle-wise colour, jacquard)
 *   3  EDGES        which colours touch, along the course and up the wale, counted from the face map. Each touching pair is judged:
 *                   dark against light (the dark yarn can stain the light one in washing), and two colours so close that the pattern
 *                   disappears (tone on tone).
 *   4  YARN DYEING  every colour is its own yarn lot: its depth class from the luminance (colour-target-engine), its route, dye on the
 *                   weight of yarn and its fastness grades from yarn-chemistry-engine, and, for an order, the kilograms of yarn it needs
 *                   with the loss in dyeing and winding, the lots it makes and whether it falls under the dyer's minimum.
 *   5  THE MACHINE  the feeders each colour takes and the yarn carriers a pixel row needs.
 *
 * Basis: law = arithmetic on the drawing; typical = an industry convention (loss, minimum lot, fastness grades); estimate = a model that a
 * trial dyeing replaces. The colours are screen values: the physical shade card and the dyer's lab dip rule.
 */
'use strict';

const CT = require('./colour-target-engine');
const CHEMY = require('./yarn-chemistry-engine');
const MEL = require('./melange-engine');

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const DEFAULT_HEX = { A: '#1f3b73', B: '#f2f2f2', C: '#c0392b', D: '#f1c40f', E: '#27ae60', F: '#2c3e50' };
const hexOk = (h) => /^#[0-9a-f]{6}$/i.test(h || '');
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;
const isKnit = (x) => x === 'K';
const isLoop = (x) => x === 'K' || x === 'T';

class ColourwayError extends Error { constructor(m) { super(m); this.name = 'ColourwayError'; } }

/** The colour of every loop of one bed: rows[r][w] = a letter or null. One virtual feed per entry of `colourOf`. */
function faceRows(grid, colourOf, total) {
  const F = grid.length, W = grid[0].length;
  const rows = [];
  let cur = null, filled = null;
  const open = () => { cur = Array(W).fill(null); filled = Array(W).fill(false); rows.push(cur); };
  for (let c = 0; c < total; c++) {
    const g = grid[c % F], col = colourOf(c);
    const knits = [];
    for (let w = 0; w < W; w++) if (isKnit(g[w])) knits.push(w);
    if (!knits.length) continue;
    if (!cur || knits.some((w) => filled[w])) open();
    knits.forEach((w) => { cur[w] = col; filled[w] = true; });
  }
  return rows;
}

function edgeCounts(rows) {
  const pairs = {};
  const add = (a, b) => { if (!a || !b || a === b) return; const k = a < b ? a + b : b + a; pairs[k] = (pairs[k] || 0) + 1; };
  const R = rows.length, W = R ? rows[0].length : 0;
  for (let r = 0; r < R; r++) for (let w = 0; w < W; w++) {
    add(rows[r][w], rows[r][(w + 1) % W]);
    add(rows[r][w], rows[(r + 1) % R][w]);
  }
  return pairs;
}

function kindOf(rows) {
  const multi = rows.map((r) => new Set(r.filter(Boolean)).size);
  if (!rows.length) return 'none';
  if (multi.every((n) => n <= 1)) return new Set(rows.flatMap((r) => r.filter(Boolean))).size > 1 ? 'horizontal stripe' : 'one colour';
  const sig = rows.map((r) => r.map((x) => x || '.').join(''));
  if (sig.every((s) => s === sig[0])) return 'wale stripe';
  return 'motif';
}

function profileFor(mix, tex, depth, kg) {
  try {
    return CHEMY.profileOf(mix || { cotton: 100 }, tex, { shade: depth, yarn_kg: Math.max(1, kg || 100), biopolish: false, heatset: 'none' });
  } catch (e) { return null; }
}

/**
 * spec: {
 *   C, D            drawing grids, arrays of strings or arrays, one row per feed (before the repeat is reduced)
 *   feedColours     a letter or null for every feed
 *   seq             the stripe as typed or as the feeders carry it: one letter per feed, cyclic (the machine stripe)
 *   colours, names  { A: '#hex' } and { A: 'Navy' }
 *   gating          'rib' | 'interlock'
 *   plan            the stripe plan of the machine (runs, yarn_pct, method, threading) or null
 *   mix, tex        the ground yarn: { cotton: 100 } and tex of the single thread
 *   feeders         the machine's feeders
 *   order           { kg, loss_pct, lot_min_kg }
 * }
 */
function analyse(spec) {
  if (!spec || !spec.C || !spec.C.length) throw new ColourwayError('Give the drawing.');
  const C = spec.C.map((r) => (Array.isArray(r) ? r : String(r).split('')));
  const D = spec.D && spec.D.length ? spec.D.map((r) => (Array.isArray(r) ? r : String(r).split(''))) : null;
  const F = C.length;
  const feedCol = (spec.feedColours || []).map((c) => (LETTERS.includes(c) ? c : null));
  const anyFeedColour = feedCol.some(Boolean);
  const seq = spec.seq && spec.seq.length ? spec.seq : null;
  if (!seq && !anyFeedColour) return null;

  // the virtual feeds: one pass of the machine's stripe over the drawing's feeds
  const N = seq ? seq.length : F;
  const total = Math.min(2400, seq ? lcm(F, N) : F);
  const colourOf = seq ? (c) => seq[c % N] : (c) => feedCol[c % F] || 'A';
  let rowsC = faceRows(C, colourOf, total);
  const rowsD = D ? faceRows(D, colourOf, total) : null;
  // a cloth whose cylinder only tucks or misses shows the dial's loops: the face map is then the dial's
  if (!rowsC.length && rowsD && rowsD.length) rowsC = rowsD;
  if (!rowsC.length) return null;
  const kind = kindOf(rowsC);
  const used = [...new Set([...rowsC, ...(rowsD || [])].flatMap((r) => r.filter(Boolean)))].sort();
  if (used.length < 2) return null;

  // face shares
  const share = (rows) => { const t = {}; let n = 0; rows.forEach((r) => r.forEach((x) => { if (x) { t[x] = (t[x] || 0) + 1; n++; } })); return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r1(v / (n || 1) * 100)])); };
  const faceShare = share(rowsC), backShare = rowsD ? share(rowsD) : null;
  const perRow = Math.max(...rowsC.map((r) => new Set(r.filter(Boolean)).size));
  // feeds a pixel row takes: the feeds that make one row
  const feedsPerRow = rowsC.length ? Math.round((seq ? total : F) / rowsC.length * 10) / 10 : 1;

  // yarn mass share: the machine plan's (by feed, with its real yarn); the face share where there is no plan
  const yarnPct = spec.plan && spec.plan.yarn_pct ? spec.plan.yarn_pct : null;
  const massOf = (l) => (yarnPct && yarnPct[l] != null ? yarnPct[l] : faceShare[l] || 0);

  // colours: depth, route, dye, fastness
  const colours = used.map((l) => {
    const hex = hexOk((spec.colours || {})[l]) ? spec.colours[l] : DEFAULT_HEX[l];
    let ct = null;
    try { ct = CT.analyse({ target: hex }); } catch (e) { ct = null; }
    const lab = ct ? ct.colour.lab : null;
    // a cream or an ecru reads as 'white' by its luminance but is a pastel dyeing, not a bleach: only a true white (L* above 93, no chroma) is bleached
    const trueWhite = !!(lab && lab[0] > 93 && Math.hypot(lab[1], lab[2]) < 5);
    let depth = ct ? ct.depth.id : 'medium';
    if (depth === 'white' && !trueWhite) depth = 'pastel';
    const pct = massOf(l);
    const kgNet = spec.order && +spec.order.kg > 0 ? (+spec.order.kg * pct) / 100 : null;
    const loss = spec.order && +spec.order.loss_pct >= 0 && spec.order.loss_pct !== '' && spec.order.loss_pct != null ? +spec.order.loss_pct : 3;
    const kgGross = kgNet != null ? kgNet / (1 - loss / 100) : null;
    const lotMin = spec.order && +spec.order.lot_min_kg > 0 ? +spec.order.lot_min_kg : null;
    const prof = spec.tex > 0 ? profileFor(spec.mix, spec.tex, depth, kgGross || 100) : null;
    const dye = prof && prof.recipe && prof.recipe.dyes ? prof.recipe.dyes.map((d) => ({ class: d.class_label, owf_pct: d.owf_on_yarn_pct, kg_per_100kg_yarn: d.kg ? d.kg.value : null, kg_for_order: kgGross != null && d.kg ? r2(d.kg.value * kgGross / 100) : null })) : [];
    const route = prof && prof.route ? prof.route.steps.map((s) => s.label) : [];
    return {
      letter: l, name: (spec.names || {})[l] || null, hex, lab: lab ? lab.map(r1) : null, depth, depth_label: CHEMY.DEPTH_LABEL[depth] || depth, words: ct ? ct.colour.words : null,
      face_pct: faceShare[l] || 0, back_pct: backShare ? backShare[l] || 0 : null, yarn_pct: pct,
      kg_net: kgNet != null ? r1(kgNet) : null, kg_yarn: kgGross != null ? r1(kgGross) : null,
      below_min_lot: lotMin != null && kgGross != null && kgGross < lotMin, lot_min_kg: lotMin, short_by_kg: lotMin != null && kgGross != null && kgGross < lotMin ? r1(lotMin - kgGross) : null,
      dye, route,
      fastness: prof && prof.fastness ? { overall: prof.fastness.overall, risks: prof.fastness.risks } : null,
      strength_retained_pct: prof && prof.strength && prof.strength.retained_pct ? prof.strength.retained_pct.value : null,
      white: trueWhite,
      pantone: ct && ct.nearest && ct.nearest[0] ? { code: ct.nearest[0].code, name: ct.nearest[0].name, delta_e00: ct.nearest[0].delta_e00 } : null,
    };
  });
  const byL = Object.fromEntries(colours.map((c) => [c.letter, c]));

  // edges: who touches whom
  const e1 = edgeCounts(rowsC), e2 = rowsD ? edgeCounts(rowsD) : {};
  const edges = {}; Object.entries(e1).forEach(([k, v]) => { edges[k] = (edges[k] || 0) + v; }); Object.entries(e2).forEach(([k, v]) => { edges[k] = (edges[k] || 0) + v; });
  const edgeTot = Object.values(edges).reduce((a, b) => a + b, 0) || 1;
  const checks = [];
  const say = (level, text, basis) => checks.push({ level, text, basis: basis || 'typical' });
  const pairs = Object.entries(edges).map(([k, n]) => {
    const a = byL[k[0]], b = byL[k[1]];
    const dE = a.lab && b.lab ? MEL.dE00(a.lab, b.lab) : null;
    const dark = a.lab && b.lab ? (a.lab[0] <= b.lab[0] ? a : b) : null, light = dark ? (dark === a ? b : a) : null;
    let risk = 'ok', words = 'a clear edge';
    if (dE != null && dE < 6) { risk = 'tone'; words = `ΔE00 ${r1(dE)}: the two read as one colour, the pattern fades into tone on tone`; }
    else if (dark && light && (dark.depth === 'dark' || dark.depth === 'black') && light.lab[0] >= 68) {
      const st = dark.fastness && dark.fastness.overall && dark.fastness.overall.stain ? dark.fastness.overall.stain : null;
      risk = 'stain'; words = `${dark.depth === 'black' ? 'a black / navy' : 'a dark'} yarn next to a light one: in the first washes the dark yarn can stain the light one${st ? ` (staining grade ${st[0]}–${st[1]} typical at this depth)` : ''}`;
    }
    return { a: k[0], b: k[1], edge_pct: r1(n / edgeTot * 100), delta_e00: dE != null ? r1(dE) : null, risk, words };
  }).sort((x, y) => y.edge_pct - x.edge_pct);

  // what the kind means for the person drawing
  const kindWords = {
    'horizontal stripe': 'Every course is one colour: a horizontal stripe.',
    'wale stripe': 'Every course carries the same colours needle by needle, so the colours run up the wales: a vertical (wale) stripe. On an interlock this is what two colours on the two feeders of one course make, because each feeder knits every other wale.',
    motif: `The colour changes needle by needle inside a course (jacquard): ${perRow} colours in a pixel row, so a row takes ${perRow} feeds and the yarn that does not knit floats on the back.`,
  };
  say('note', kindWords[kind] || kind, 'law');
  if (kind === 'wale stripe' && spec.seq && spec.gating === 'interlock') say('note', 'You wrote the stripe feed by feed. An interlock course takes two feeds, so for a HORIZONTAL stripe write the colours in pairs of feeds (for example A2 B2); A1 B1 gives the wale stripe.', 'law');
  if (kind === 'horizontal stripe' && spec.gating === 'interlock' && !spec.seq && anyFeedColour) say('ok', 'Both feeders of every interlock course carry one colour: clean horizontal bands.', 'law');
  pairs.forEach((p) => {
    if (p.risk === 'stain') say('warn', `${byL[p.a].name || p.a} and ${byL[p.b].name || p.b}: ${p.words}. Soap the dyed yarn hard, ask the dyer for the wash-staining grade (ISO 105-C06) of this colour, and tell the buyer to wash it separately at first.`);
    if (p.risk === 'tone' && p.edge_pct >= 10) say('note', `${byL[p.a].name || p.a} and ${byL[p.b].name || p.b}: ${p.words}.`);
  });
  colours.forEach((c) => {
    if (c.below_min_lot) say('warn', `${c.name || c.letter}: ${c.kg_yarn} kg of yarn is under the dyer's minimum lot of ${c.lot_min_kg} kg — you pay for the minimum (${c.short_by_kg} kg of yarn you will not use) or plan a second order of the same colour.`);
    if (c.white) say('note', `${c.name || c.letter}: a white in the stripe is bleached and brightened as YARN (peroxide, optical brightener); do not bleach the knitted cloth, it would damage the dyed yarns next to it.`);
  });
  say('note', 'The weight, width and shrinkage constants of the Studio are measured on piece-dyed cloth. A yarn-dyed cloth is dyed before knitting (the yarn is relaxed in the dye package and then waxed), so its stitch length and shrinkage can differ: knit a trial roll before you commit.', 'typical');
  if (colours.some((c) => !c.white)) say('note', 'Dye all yarn of one colour in ONE lot, and mix cones from one lot at the knitting machine: two lots of the same colour a ΔE00 above about 0.8–1 apart show as a band across the stripe repeats.');
  if (colours.some((c) => !c.white)) say('note', 'Dyed yarn is waxed at winding (paraffin) so its friction is as the undyed yarn\'s; otherwise the stitch length drifts and needles wear faster.');

  // the machine side
  const plan = spec.plan || null;
  const feedersBy = {};
  if (plan && plan.method === 'feeder stripe' && seq && +spec.feeders > 0) for (let k = 0; k < +spec.feeders; k++) { const l = seq[k % N]; feedersBy[l] = (feedersBy[l] || 0) + 1; }
  colours.forEach((c) => { c.feeders = feedersBy[c.letter] != null ? feedersBy[c.letter] : null; });

  return {
    motif: rowsC.length <= 300 ? { face: rowsC.map((r) => r.map((x) => x || '-').join('')), back: rowsD ? rowsD.map((r) => r.map((x) => x || '-').join('')) : null, width: rowsC[0].length, height: rowsC.length } : null,
    size_cm: +spec.wpc > 0 && +spec.cpc > 0 ? { width: r1(rowsC[0].length / +spec.wpc), height: r1(rowsC.length / +spec.cpc), basis: 'the repeat as the Studio finishes the cloth: needles ÷ wales per cm, rows ÷ courses per cm' } : null,
    kind, colours_n: used.length, rows: rowsC.length, feeds_per_row: feedsPerRow, colours_per_row: perRow,
    colours, pairs, checks,
    machine: {
      method: plan ? plan.method : null, fingers_needed: plan ? plan.fingers_needed : null, fingers_available: plan ? plan.fingers_available : null,
      yarn_carriers_per_row: perRow, cones_to_hang: used.length,
      note: kind === 'motif' || kind === 'wale stripe' ? 'Colour by needle: the feeders of one pixel row each carry one colour (every feeder keeps its yarn); the needle selection or the cams decide which needles take it.' : plan && plan.method === 'striper' ? 'A striper changes the yarn at the feeder from revolution to revolution.' : 'Each feeder keeps one yarn: the stripe is threaded, no striper is needed.',
    },
    order: spec.order && +spec.order.kg > 0 ? { fabric_kg: +spec.order.kg, loss_pct: spec.order.loss_pct != null && spec.order.loss_pct !== '' ? +spec.order.loss_pct : 3, lot_min_kg: +spec.order.lot_min_kg > 0 ? +spec.order.lot_min_kg : null,
      yarn_kg_total: r1(colours.reduce((t, c) => t + (c.kg_yarn || 0), 0)), basis: 'law (share × fabric kg ÷ (1 − loss)); the loss is typical 2–4 % in yarn dyeing and winding' } : null,
    basis: { law: ['the face map and its edges from the drawing', 'the kilograms from the mass share of each feed'], typical: ['loss in dyeing and winding', 'minimum lot', 'fastness grades by depth'], estimate: ['dye on the weight of yarn from the luminance (colour-target-engine)'], replaced_by: 'the yarn dyer\'s lab dips and the lot reports' },
  };
}

module.exports = { analyse, faceRows, kindOf, edgeCounts, ColourwayError, DEFAULT_HEX, LETTERS };
