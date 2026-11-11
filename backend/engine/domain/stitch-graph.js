/**
 * Part 0 — the stitch graph: ONE description of any knitted structure, weft or warp.
 *
 * Every knit, of every kind, is the same few facts: a YARN meets a NEEDLE at a COURSE and either forms a loop
 * there, drawn through the loops that needle is holding, or does not and passes by. Notation, cam chart,
 * needle set-out, lapping and threading are only ways of writing those facts down; consumption, geometry,
 * the yarn model, the 3D view and the quality checks all need the facts themselves. So they are built once,
 * here, and every other part reads them:
 *
 *   needles   bed (cylinder C / dial D, flat front F / back B, warp bar W / back bar V), index, position x
 *   yarns     what feeds them: a feeder (weft) or one guide of a guide bar (warp), and their role
 *   loops     needle, course, the yarns in it, its kind, the loops it is DRAWN THROUGH (the interlocking),
 *             the course it is cast off at, how many courses it was held
 *   passes    each yarn's path through a course: the needles it meets in order and what it does at each,
 *             and the spans between the needles it is caught on (sinker loop, float, bed crossing, underlap, inlay)
 *
 * WEFT (circular or flat): a knit (K) draws a new loop through everything held on the needle and casts that
 * off; a tuck (T) adds a loop to what is held, drawn through nothing; a miss (M) leaves the yarn passing; a
 * transfer moves the held loops to the next needle (E) or to the other bed (R) before the feed knits; '-' is
 * no needle. A knit on an emptied needle starts a new wale (an eyelet).
 * WARP: in every course each guide's overlap wraps the needle between its two gap positions (needle n stands
 * between gap n and n+1); all the yarns lapped onto one needle form that needle's new loop, drawn through
 * its old one; the underlap runs behind to the next overlap; a bar that never overlaps is laid in. A needle
 * that gets no yarn presses its loop off.
 *
 * The structure is periodic: the repeat is knitted a few times to reach the steady state, and the graph is
 * the last repeat — a loop's `through` may name a loop of the repeat before (course < 0: the same loop, one
 * repeat earlier). Nothing here is measured or fitted: it is the logic of the machine, and each check says
 * which rule it applies.
 */
'use strict';

const W = require('./warp-studio');

class GraphError extends Error {}
const MAX_NEEDLES = 48, MAX_COURSES = 96, WARM = 4;
const HOLD_WARN = 4, STACK_WARN = 4, FLOAT_WARN = 5;
const mod = (a, n) => ((a % n) + n) % n;
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const lcm = (a, b) => (a / gcd(a, b)) * b;
const lid = (needle, course) => `${needle}@${course}`;
const rowsOf = (g) => (g || []).map((r) => (Array.isArray(r) ? r.map(String) : String(r).split('')));

// ── WEFT ──────────────────────────────────────────────────────────────────────
/**
 * @param spec { grid: { C: rows, D: rows|null }, gating: 'rib'|'interlock', technique: 'circular'|'flat',
 *               feeds: [{ role, plated }], elastane: { every: 'all'|'alternate' }|null,
 *               transfer_dir: 'right'|'left', racking: [int per course] (flat: back needle i faces front needle i + r),
 *               pile: bool }
 */
function fromWeft(spec) {
  const s = spec || {};
  const C = rowsOf(s.grid && s.grid.C), D = s.grid && s.grid.D ? rowsOf(s.grid.D) : null;
  if (!C.length || !C[0].length) throw new GraphError('Draw the needle programme of the cylinder (or front bed).');
  const R = C.length, N = C[0].length;
  if (R > MAX_COURSES || N > MAX_NEEDLES) throw new GraphError(`At most ${MAX_COURSES} feeds and ${MAX_NEEDLES} needles in a repeat.`);
  if (C.some((r) => r.length !== N) || (D && (D.length !== R || D.some((r) => r.length !== N)))) throw new GraphError('Every feed must cover the same needles on each bed.');
  const SYM = new Set(['K', 'T', 'M', 'E', 'R', '-']);
  for (const [b, rows] of [['C', C], ['D', D]]) if (rows) rows.forEach((r, f) => r.forEach((x, i) => { if (!SYM.has(x)) throw new GraphError(`Feed ${f + 1}, ${b === 'C' ? 'cylinder' : 'dial'} needle ${i + 1}: "${x}" is not K, T, M, E, R or -.`); }));
  const flat = s.technique === 'flat';
  const gating = D ? (s.gating === 'interlock' ? 'interlock' : 'rib') : 'single';
  const name = flat ? { C: 'F', D: 'B' } : { C: 'C', D: 'D' };
  const dir = s.transfer_dir === 'left' ? -1 : 1;
  const checks = [];
  const check = (level, code, text, where) => { if (!checks.some((c) => c.code === code && c.where === where)) checks.push({ level, code, text, where: where || null }); };

  // needles: a column that is '-' at every feed is no needle at all
  const grid = { C, D };
  const needles = [];
  for (const b of ['C', 'D']) {
    if (!grid[b]) continue;
    for (let i = 0; i < N; i++) {
      const col = grid[b].map((r) => r[i]);
      if (col.every((x) => x === '-')) continue;
      if (col.some((x) => x === '-')) check('info', 'part_absent', `${b === 'C' ? 'Cylinder' : 'Dial'} needle ${i + 1} is marked "no needle" at some feeds only — read as idle there.`, `${name[b]}${i}`);
      const x = b === 'C' ? i : gating === 'interlock' ? i : i + 0.5;
      needles.push({ id: `${name[b]}${i}`, bed: name[b], key: b, i, x });
    }
  }
  if (!needles.length) throw new GraphError('No needle is in action.');
  const byId = new Map(needles.map((n) => [n.id, n]));
  const order = [...needles].sort((p, q) => p.x - q.x || (p.key === 'C' ? -1 : 1));

  // yarns: one per feeder, a plated yarn beside it where asked
  const feeds = Array.from({ length: R }, (_, f) => (s.feeds || [])[f] || {});
  const yarns = [], yarnsOfFeed = [];
  feeds.forEach((fd, f) => {
    const ids = [`F${f + 1}`];
    yarns.push({ id: `F${f + 1}`, role: fd.role || 'ground', source: { feed: f + 1 } });
    const el = s.elastane && (s.elastane.every !== 'alternate' || f % 2 === 0);
    if (fd.plated || el) { ids.push(`F${f + 1}p`); yarns.push({ id: `F${f + 1}p`, role: el && !fd.plated ? 'elastane' : 'plating', source: { feed: f + 1 }, plated_with: `F${f + 1}` }); }
    yarnsOfFeed.push(ids);
  });
  // which feeds knit INTO the course of the feed before (plated into the same loops) rather than starting a new one.
  // The designer says so per feed (course: 'same' | 'new'); left unsaid, a face feeder right after a binder (or a binder
  // right after a face) joins it — the three-thread fleece face course: the binder knits every needle behind the face.
  const joins = feeds.map((fd, f) => {
    if (fd.course === 'same') return f > 0 || R > 1;
    if (fd.course === 'new') return false;
    const prev = feeds[mod(f - 1, R)] || {};
    return R > 1 && ((fd.role === 'face' && prev.role === 'binder') || (fd.role === 'binder' && prev.role === 'face' && prev.course !== 'same'));
  });
  const courseOfFeed = []; { let k = -1; for (let f = 0; f < R; f++) { if (!joins[f]) k++; courseOfFeed.push(Math.max(0, k)); } }
  const fabricCourses = joins.filter((j) => !j).length || 1;

  const stack = new Map(needles.map((n) => [n.id, []]));
  const loops = new Map(), passes = [], transfers = [];
  const opposite = (n, c) => {
    if (!D) return null;
    const rack = flat && Array.isArray(s.racking) ? (+s.racking[mod(c, R)] || 0) : 0;
    const otherKey = n.key === 'C' ? 'D' : 'C';
    const j = n.key === 'C' ? n.i - rack : n.i + rack;
    return byId.get(`${name[otherKey]}${mod(j, N)}`) || null;
  };
  for (let c = -WARM * R; c < 2 * R; c++) {
    const f = mod(c, R), keep = c >= 0 && c < R;
    const act = (n) => grid[n.key][f][n.i];
    // 1. transfers first: the held loops move, the needle is emptied
    for (const n of needles) {
      const a = act(n);
      if (a !== 'E' && a !== 'R') continue;
      const to = a === 'E' ? byId.get(`${n.bed}${mod(n.i + dir, N)}`) : opposite(n, c);
      if (!to) { check('error', a === 'R' ? 'no_opposite' : 'no_neighbour', a === 'R' ? `Feed ${f + 1}: ${n.id} transfers to the other bed, but there is no needle opposite it.` : `Feed ${f + 1}: ${n.id} transfers to a needle that is not in action.`, n.id); continue; }
      const moved = stack.get(n.id);
      if (moved.length) { stack.set(to.id, [...stack.get(to.id), ...moved]); stack.set(n.id, []); }
      if (keep) transfers.push({ course: c, from: n.id, to: to.id, loops: moved.slice() });
    }
    // 2. the yarn passes the needles in order and knits, tucks or misses
    const dirC = flat ? (mod(c, 2) === 0 ? 1 : -1) : 1;
    const path = dirC > 0 ? order : [...order].reverse();
    const visits = [];
    for (const n of path) {
      const a = act(n);
      let made = null;
      const top = stack.get(n.id).length === 1 ? loops.get(stack.get(n.id)[0]) : null;
      if (a === 'K' && joins[f] && top && top.course === c - 1 && top.kind !== 'tuck') {
        // the same course: this feeder's yarn is plated into the loop the feeder before has just made on this needle
        top.yarns = [...top.yarns, ...yarnsOfFeed[f]]; top.plated_feeds = (top.plated_feeds || 1) + 1;
        made = top;
      } else if (a === 'K') {
        const through = stack.get(n.id);
        through.forEach((t) => { const L = loops.get(t); if (L && L.cast_off == null) L.cast_off = c; });
        made = { id: lid(n.id, c), needle: n.id, course: c, yarns: yarnsOfFeed[f].slice(), kind: through.length ? 'knit' : 'cast-on', through: through.slice(), cast_off: null };
        loops.set(made.id, made); stack.set(n.id, [made.id]);
      } else if (a === 'T') {
        made = { id: lid(n.id, c), needle: n.id, course: c, yarns: yarnsOfFeed[f].slice(), kind: 'tuck', through: [], cast_off: null };
        loops.set(made.id, made); stack.get(n.id).push(made.id);
        if (stack.get(n.id).length > STACK_WARN + 1 && c >= 0) check('warn', 'tuck_stack', `${n.id} holds ${stack.get(n.id).length - 1} tucks on its loop at feed ${f + 1}: past about ${STACK_WARN} the hook overloads and the yarn breaks or the tucks fail to clear.`, n.id);
      }
      visits.push({ needle: n.id, act: a, loop: made ? made.id : null });
    }
    if (!keep) continue;
    // 3. the spans between the needles the yarn is caught on
    const caught = visits.map((v, k) => (v.act === 'K' || v.act === 'T' ? k : -1)).filter((k) => k >= 0);
    if (!caught.length) check('error', 'yarn_not_caught', `Feed ${f + 1} neither knits nor tucks on any needle: its yarn is not held and falls out of the cloth.`, `F${f + 1}`);
    const spans = caught.map((k, j) => {
      const k2 = caught[(j + 1) % caught.length], a = byId.get(visits[k].needle), b = byId.get(visits[k2].needle);
      const missed = []; for (let q = (k + 1) % visits.length; q !== k2; q = (q + 1) % visits.length) missed.push(visits[q].needle);
      const missSame = missed.filter((id) => byId.get(id).key === a.key).length;
      let kind = a.key !== b.key ? 'crossing' : missSame ? 'float' : 'sinker';
      if (kind === 'sinker' && s.pile && yarns.find((y) => y.id === yarnsOfFeed[f][0]).role === 'loop') kind = 'pile';
      const dx = dirC > 0 ? mod(b.x - a.x, N) : mod(a.x - b.x, N);
      return { from: a.id, to: b.id, kind, missed, float_needles: kind === 'float' ? missSame : 0, span_pitches: dx === 0 ? N : dx };
    });
    const fl = Math.max(0, ...spans.map((x) => x.float_needles));
    if (fl > FLOAT_WARN && !D) check('warn', 'long_float', `Feed ${f + 1} floats over ${fl} needles: a float that long snags and lets the cloth grin; keep it to about ${FLOAT_WARN} unless it is tied in.`, `F${f + 1}`);
    for (const y of yarnsOfFeed[f]) passes.push({ yarn: y, course: c, direction: dirC, visits, spans });
  }

  // the steady-state repeat, and what each loop did
  const out = [...loops.values()].filter((L) => L.course >= 0 && L.course < R).map((L) => ({ ...L, held: L.cast_off == null ? null : L.cast_off - L.course }));
  for (const n of needles) {
    const col = grid[n.key].map((r) => r[n.i]);
    if (!col.includes('K')) {
      if (col.includes('T')) check('error', 'never_cleared', `${n.id} tucks but never knits: its loops are never cleared and pile up until the yarn breaks.`, n.id);
      else if (!col.includes('E') && !col.includes('R')) check('info', 'idle_needle', `${n.id} never takes yarn — take it out of action ("-") or it rubs the cloth.`, n.id);
    }
  }
  for (const L of out) {
    if (L.held != null && L.held > HOLD_WARN) check('warn', 'long_hold', `${L.needle} holds its loop ${L.held} courses (feed ${L.course + 1} to ${mod(L.cast_off, R) + 1}): the loop is stretched that far; most yarns allow about ${HOLD_WARN}–6.`, L.needle);
    if (L.kind === 'cast-on') check('info', 'eyelet', `${L.needle} knits at feed ${L.course + 1} on an emptied needle: a new wale starts there, with an eyelet below it.`, L.needle);
  }
  // steady state: the repeat before must look the same, shifted by one repeat
  const prev = [...loops.values()].filter((L) => L.course >= -R && L.course < 0);
  const sig = (L, sh) => `${L.needle}|${L.course + sh}|${L.kind}|${L.through.map((t) => { const [nn, cc] = t.split('@'); return `${nn}@${+cc + sh}`; }).sort().join(',')}`;
  const a1 = out.map((L) => sig(L, 0)).sort().join(';'), a0 = prev.map((L) => sig(L, R)).sort().join(';');
  const steady = a1 === a0;
  if (!steady) check('error', 'not_periodic', 'The programme does not settle into a repeating cloth (a needle keeps gathering loops): it cannot be knitted continuously.', null);

  return finish({ technique: flat ? 'weft-flat' : 'weft-circular', gating, period: { courses: R, needles: N, fabric_courses: fabricCourses },
    feeds: feeds.map((fd, f) => ({ feed: f + 1, role: fd.role || 'ground', fabric_course: courseOfFeed[f] + 1, joins_previous: joins[f], said: fd.course === 'same' || fd.course === 'new' })), beds: [...new Set(needles.map((n) => n.bed))], needles, yarns, loops: out, passes, transfers, checks, steady });
}

// ── WARP ──────────────────────────────────────────────────────────────────────
/**
 * @param spec { machine: { type: 'tricot'|'raschel'|'double_raschel', notation_step: 1|2 }, bars: [{ notation, threading }] }
 */
function fromWarp(spec) {
  const s = spec || {};
  const m = s.machine || {};
  const type = W.MACHINES[m.type] ? m.type : 'tricot';
  const beds = W.MACHINES[type].beds;
  const step = +m.notation_step === 2 ? 2 : 1;
  const barsIn = Array.isArray(s.bars) ? s.bars : [];
  if (!barsIn.length) throw new GraphError('Give at least one guide bar.');
  const checks = [];
  const check = (level, code, text, where) => { if (!checks.some((c) => c.code === code && c.where === where)) checks.push({ level, code, text, where: where || null }); };
  let bars;
  try {
    bars = barsIn.map((b, i) => {
      const pairs = W.parseNotation(b.notation, i + 1, { step });
      if (beds === 2 && pairs.length % 2) throw new GraphError(`Bar ${i + 1}: on a double-needle-bar machine every course has two pairs (front bed, back bed).`);
      const t = String(b.threading || 'X').toUpperCase().replace(/[^X.]/g, '') || 'X';
      if (!t.includes('X')) throw new GraphError(`Bar ${i + 1}: the threading has no threaded guide (X).`);
      return { n: i + 1, pairs, thread: t, steps: pairs.length };
    });
  } catch (e) { if (e instanceof GraphError) throw e; throw new GraphError(e.message); }
  // the repeat: courses (pairs; two per machine course on a double needle bar) and needles (threading)
  const S = bars.reduce((a, b) => lcm(a, b.steps), 1), Nn = bars.reduce((a, b) => lcm(a, b.thread.length), 1);
  if (S > MAX_COURSES || Nn > MAX_NEEDLES) throw new GraphError('The repeat is too long to model here.');
  const R = beds === 2 ? S / 2 : S;
  const bedOf = (k) => (beds === 2 ? (k % 2 ? 'V' : 'W') : 'W');
  const courseOf = (k) => (beds === 2 ? Math.floor(k / 2) : k);
  const needles = [];
  for (const b of beds === 2 ? ['W', 'V'] : ['W']) for (let i = 0; i < Nn; i++) needles.push({ id: `${b}${i}`, bed: b, key: b, i, x: i });
  const yarns = [];
  bars.forEach((b) => { for (let g = 0; g < Nn; g++) if (b.thread[g % b.thread.length] === 'X') yarns.push({ id: `B${b.n}g${g}`, role: b.pairs.every(([a, z]) => a === z) ? 'inlay' : 'loop', source: { bar: b.n, guide: g } }); });
  bars.forEach((b) => { b.laps = beds === 2 ? null : W.lapping(b.pairs); b.inlay = b.pairs.every(([a, z]) => a === z); });
  if (bars.every((b) => b.inlay)) check('error', 'no_loops', 'Every bar is laid in: no needle forms a loop, so there is no cloth.', null);

  const stack = new Map(needles.map((n) => [n.id, null]));
  const loops = new Map(), passes = [];
  for (let k = -WARM * S; k < 2 * S; k++) {
    const c = courseOf(k), bed = bedOf(k), keep = k >= 0 && k < S;
    // every threaded guide's overlap this step
    const onNeedle = new Map();
    const steps = [];
    for (const y of yarns) {
      const b = bars[y.source.bar - 1], P = b.pairs.length, j = mod(k, P);
      const [a, z] = b.pairs[j], [an] = b.pairs[mod(j + 1, P)];
      const g = y.source.guide;
      const ovl = a !== z ? { from_gap: a + g, to_gap: z + g, needle: `${bed}${mod(Math.min(a, z) + g, Nn)}`, width: Math.abs(z - a) } : null;
      if (ovl) { if (!onNeedle.has(ovl.needle)) onNeedle.set(ovl.needle, []); onNeedle.get(ovl.needle).push(y.id); }
      const lap = ovl && b.laps ? (b.laps[j].closed ? 'closed' : 'open') : null;
      steps.push({ yarn: y.id, ovl, lap, under: { from_gap: z + g, to_gap: an + g, needles: Math.abs(an - z) } });
    }
    // each needle of this bed: a new loop from every yarn lapped onto it, drawn through its old loop
    for (const n of needles.filter((x) => x.bed === bed)) {
      const ys = onNeedle.get(n.id), old = stack.get(n.id);
      if (ys) {
        if (old) loops.get(old).cast_off = c;
        const L = { id: lid(n.id, c), needle: n.id, course: c, yarns: ys, kind: old ? 'warp' : 'cast-on', through: old ? [old] : [], cast_off: null };
        loops.set(L.id, L); stack.set(n.id, L.id);
      } else if (old) {
        const L = loops.get(old);
        L.cast_off = c; L.pressed_off = true; stack.set(n.id, null);
        if (keep) check('warn', 'pressed_off', `${n.id} gets no yarn at course ${c + 1}: its loop is pressed off — an open hole (an eyelet in a net, a fault in a closed cloth).`, n.id);
      }
    }
    if (!keep) continue;
    for (const st of steps) {
      passes.push({ yarn: st.yarn, course: c, bed, overlap: st.ovl, lap: st.lap, underlap: st.under, loop: st.ovl ? lid(st.ovl.needle, c) : null });
    }
  }
  const out = [...loops.values()].filter((L) => L.course >= 0 && L.course < R).map((L) => ({ ...L, held: L.cast_off == null ? null : L.cast_off - L.course }));
  for (const n of needles) if (!out.some((L) => L.needle === n.id)) check('info', 'empty_wale', `${n.id} never gets yarn: an empty wale (a net's opening, or a needle left out).`, n.id);

  // does the cloth hold together? every yarn ties the wales it touches; inlays tie the wales they lie across
  const conn = holdsTogether(bars, Nn, S, beds);
  if (!conn) check('error', 'falls_apart', 'The wales are not tied to each other: with no underlap or inlay crossing between them the cloth falls apart into strips (pillars need a laid-in or underlapping bar).', null);
  return finish({ technique: beds === 2 ? 'warp-double' : 'warp', machine: type, period: { courses: R, needles: Nn, steps: S }, beds: beds === 2 ? ['W', 'V'] : ['W'], needles, yarns, loops: out, passes, transfers: [], checks, steady: true, bars: bars.map((b) => ({ n: b.n, thread: b.thread, steps: b.steps, inlay: b.inlay })) });
}

/**
 * Wale connectivity on a band of needles, followed along the yarn paths themselves (union-find over
 * bed:needle): consecutive loops of one end tie their wales, an underlap ties the wales it lies across
 * (their loops bind it), an inlay ties the wales between its positions. One piece = the cloth holds.
 */
function holdsTogether(bars, Nn, S, beds) {
  const span = Math.max(...bars.map((b) => Math.max(...b.pairs.flat()))) + 2;
  const Wd = Math.max(24, 6 * Nn + 4 * span), lo = 2 * span, hi = Wd - 2 * span;
  const parent = new Map();
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const node = (a) => { if (!parent.has(a)) parent.set(a, a); return a; };
  const union = (a, b) => { const ra = find(node(a)), rb = find(node(b)); if (ra !== rb) parent.set(ra, rb); };
  const knits = new Set();
  bars.forEach((b) => {
    const P = b.pairs.length, T = b.thread.length;
    for (let g = -span; g < Wd + span; g++) {
      if (b.thread[mod(g, T)] !== 'X') continue;
      let prev = null, loops = 0, x0 = Infinity, x1 = -Infinity;
      for (let k = 0; k < 2 * lcm(S, P); k++) {
        const [a, z] = b.pairs[k % P], bed = beds === 2 ? k % 2 : 0;
        x0 = Math.min(x0, a + g, z + g); x1 = Math.max(x1, a + g, z + g);
        if (a === z) continue;
        const key = `${bed}:${Math.min(a, z) + g}`;
        knits.add(key); loops++;
        if (prev) union(prev, key);
        prev = key;
        const na = b.pairs[(k + 1) % P][0] + g, from = z + g;
        for (let m = Math.min(na, from); m + 1 < Math.max(na, from); m++) union(`${bed}:${m}`, `${bed}:${m + 1}`);
      }
      if (!loops) for (let n = x0; n + 1 < x1; n++) union(`0:${n}`, `0:${n + 1}`);   // laid in: it ties the wales it lies across
    }
  });
  const mids = [...knits].filter((k) => { const n = +k.split(':')[1]; return n >= lo && n < hi; });
  if (!mids.length) return false;
  const r0 = find(node(mids[0]));
  return mids.every((k) => find(node(k)) === r0);
}

// ── shared: statistics, and the views every other part reads ─────────────────
function finish(g) {
  const byKind = (k) => g.loops.filter((L) => L.kind === k).length;
  const held = g.loops.map((L) => L.held).filter((h) => h != null);
  const spans = g.passes.flatMap((p) => p.spans || []);
  g.stats = {
    courses: g.period.courses, needles: g.needles.length, yarns: g.yarns.length, loops: g.loops.length,
    knit: byKind('knit') + byKind('warp'), tuck: byKind('tuck'), cast_on: byKind('cast-on'),
    held_max: held.length ? Math.max(...held) : null, float_max: spans.length ? Math.max(0, ...spans.map((x) => x.float_needles)) : null,
    underlap_max: g.passes.some((p) => p.underlap) ? Math.max(...g.passes.map((p) => (p.underlap ? p.underlap.needles : 0))) : null,
    crossings: spans.filter((x) => x.kind === 'crossing').length, transfers: g.transfers.length,
    knittable: !g.checks.some((c) => c.level === 'error'),
  };
  return g;
}

/** Weft: the needle programme back from the graph — the notation is a view of it. */
function toGrid(g) {
  const R = g.period.courses, N = g.period.needles, key = { C: 'C', D: 'D', F: 'C', B: 'D' };
  const out = { C: Array.from({ length: R }, () => Array(N).fill('-')), D: g.beds.some((b) => b === 'D' || b === 'B') ? Array.from({ length: R }, () => Array(N).fill('-')) : null };
  const nb = new Map(g.needles.map((n) => [n.id, n]));
  const seen = new Set();
  for (const p of g.passes) {
    if (seen.has(p.course)) continue; seen.add(p.course);
    for (const v of p.visits) { const n = nb.get(v.needle); out[key[n.bed]][p.course][n.i] = v.act; }
  }
  return { C: out.C.map((r) => r.join('')), D: out.D ? out.D.map((r) => r.join('')) : null };
}

/** Warp: each bar's lapping back from the graph (its first threaded guide's overlaps and underlaps). */
function toLapping(g) {
  return (g.bars || []).map((b) => {
    const y = g.yarns.find((x) => x.source.bar === b.n);
    const g0 = y.source.guide;
    const steps = [];
    // the stored passes cover one repeat of S steps; read the bar's own P steps
    const mine = g.passes.filter((p) => p.yarn === y.id);
    for (let k = 0; k < b.steps; k++) {
      const p = mine[k];
      steps.push(p.overlap ? `${p.overlap.from_gap - g0}-${p.overlap.to_gap - g0}` : `${p.underlap.from_gap - g0}-${p.underlap.from_gap - g0}`);
    }
    return { bar: b.n, notation: steps.join('/') + '//', threading: b.thread };
  });
}

/** Every needle's chain of loops through the repeat: what the geometry and the yarn model build on. */
function wales(g) {
  return g.needles.map((n) => ({ needle: n.id, bed: n.bed, x: n.x, loops: g.loops.filter((L) => L.needle === n.id).sort((a, b) => a.course - b.course).map((L) => ({ id: L.id, course: L.course, kind: L.kind, held: L.held, through: L.through.length, yarns: L.yarns.length })) }));
}

/** The graph of a Studio design, whichever technique it is. */
function fromDesign(d) {
  if (d && Array.isArray(d.bars)) return fromWarp(d);
  return fromWeft({
    grid: d.grid, gating: d.gating, technique: d.technique, feeds: d.feeds, elastane: d.elastane || null,
    transfer_dir: (d.machine || {}).transfer_dir, racking: d.racking, pile: !!(d.plush && d.plush.mode !== 'none') || d.pile === 'sinker',
  });
}

module.exports = { fromWeft, fromWarp, fromDesign, toGrid, toLapping, wales, GraphError, HOLD_WARN, STACK_WARN, FLOAT_WARN };
