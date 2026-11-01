// KnitAdvisor · knit3d — fabric topology.
//
// Turns a construction recipe + a K/T/M sample(w,c) into a set of continuous
// yarn paths (one polyline PER COURSE, per needle bed). Per-course strands keep
// the geometry light enough for a fine, dense swatch while staying continuous
// across every wale (loop → sinker → loop → sinker — no inter-wale gaps).
//
//   • Held loops (tuck/miss above) elongate UP through those courses.
//   • RIB       — knit & purl wales alternate fore/aft beds; the strand zig-zags
//     in z for genuine reversible corrugation.
//   • INTERLOCK — two all-knit beds, the back one GAITED half a wale and pushed
//     well behind (no interpenetration).
//   • MESH / POINTELLE — single jersey bed with transfer-stitch EYELETS: the
//     hole cell carries the yarn across the back and the ring loops lean away,
//     opening the eyelet (chevron / diamond / grid motifs).

import { stitchPoints } from './loop-geometry.js?v=20260608g';
import { stitchJitter } from './noise.js?v=20260608g';
import { makePointelle, makePatternHoles } from './pointelle.js?v=20260608g';
import { buildWarpPaths } from './warp-topology.js?v=20260608g';
import {
  PITCH_X, PITCH_Y, RIB_PITCH_SCALE, RIB_DEPTH, LOOP, TUCK,
  INTERLOCK_DEPTH, INTERLOCK_GAIT, JITTER, PATCH,
  FLEECE_BIND_DEPTH, FLEECE_TUCK_Z, FLEECE_TUCK_EVERY, FLEECE_BINDER_Z,
} from './constants.js?v=20260608g';

const isHoldToken = (t) => t === 'tuck' || t === 'miss';

// Set per buildYarnPaths call (synchronous). When building a tile to bake
// into a repeating texture, the per-stitch imperfection must repeat with
// the tile too, or the tile edges would not meet.
let jitterPeriod = null;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a && b ? (a * b) / gcd(a, b) : (a || b || 1));

// How many consecutive held (tuck/miss) courses sit directly above (w,c).
function heldAbove(sample, w, c, courses) {
  let n = 0;
  for (let cc = c + 1; cc < courses; cc++) {
    if (isHoldToken(sample(w, cc))) n++; else break;
  }
  return n;
}

// ── Piqué deformation ─────────────────────────────────────────────────────
// What the tucks do to the loops around them (numbers from the engine's
// pique analysis, pique-engine.js):
//   held loop  stretched up through its tuck courses: H0 + n·C
//   held loop  drawn toward the technical face, half the cell depth
//   knit loop  next to a tucking needle buckles toward the technical back,
//              and leans sideways toward that needle — the zig-zag of a
//              Lacoste wale and the walls of the honeycomb cell
//   tuck loop  an arch whose crown lies one yarn diameter behind the held loop
// `side` is +1 for a bed whose technical face looks at +z, -1 for the
// mirrored (dial) bed.
function piqueShape(token, w, c, ctx, p) {
  const q = p.pique;
  const side = p.baseMirror ? -1 : 1;
  const half = q.relief * 0.5;
  const hold = (ww, cc) => isHoldToken(p.sample(ww, cc));
  if (token === 'tuck') {
    // Tuck crown and held loop lie on the same needle, one against the
    // other: centres one yarn diameter apart. The arch as authored sits
    // (headZ - cupZ) behind a held crown; push it back the rest of the way.
    const extra = Math.max(0, q.d - (LOOP.headZ - TUCK.cupZ));
    return { dz: side * (half - extra), dx: 0 };
  }
  if (token !== 'knit' && token !== 'purl') return { dz: 0, dx: 0 };
  // Double knit: the two beds' loops are tied across the gap. Where the
  // other bed knits beside this loop (its needles sit half a wale either
  // side) the loop is drawn in toward it; where the other bed holds (miss
  // or tuck — Swiss and French piqué's alternating dial) it is pushed out.
  // That alternation is the bird's-eye cell of a double piqué's face.
  let cross = 0;
  if (p.other) {
    const o = (ww) => (isHoldToken(p.other(ww, c)) ? 0 : 1);
    const knitting = p.baseMirror ? o(w) + o(w + 1) : o(w - 1) + o(w);
    cross = -side * half * 0.6 * (knitting - 1);
  }
  if (ctx.heldExtra > 0) return { dz: side * half + cross, dx: 0 };
  const left = hold(w - 1, c) || hold(w - 1, c + 1);
  const right = hold(w + 1, c) || hold(w + 1, c + 1);
  const n = (left ? 1 : 0) + (right ? 1 : 0);
  return {
    dz: -side * half * Math.min(1, n * 0.65) + cross,
    dx: q.lean * ((right ? 1 : 0) - (left ? 1 : 0)),
  };
}

// Half a turn about the wale axis: the technical back faces +z. A rotation,
// not a mirror, so the yarn twist keeps its hand.
function turnOver(paths, wales) {
  const X = (wales - 1) * PITCH_X;
  for (const path of paths) for (const pt of path.points) { pt.x = X - pt.x; pt.z = -pt.z; }
}

// Build one course as a single continuous polyline (authored left→right).
function buildCourse(c, p) {
  const points = [];
  const starts = [];                  // index of each wale's first point
  for (let w = 0; w < p.wales; w++) {
    starts.push(points.length);
    const isHole = p.holes && p.holes.isHole(w, c);
    const token = isHole ? 'transfer' : (p.forceToken || p.sample(w, c));

    // base imperfection + (for mesh) lean away from neighbouring holes
    const jit = jitterPeriod
      ? stitchJitter(w % jitterPeriod.w, c % jitterPeriod.c, JITTER)
      : stitchJitter(w, c, JITTER);
    if (p.holes) {
      const d = p.holes.displacement(w, c);
      jit.x += d.x; jit.y += d.y; jit.z += d.z;
    }

    const ctx = {
      cx: w * p.xPitch + p.xOffset,
      cy: c * (p.pitchY || PITCH_Y),   // course spacing (density-driven loop height)
      heldExtra: isHoldToken(token) || token === 'transfer' ? 0 : heldAbove(p.sample, w, c, p.courses),
      zBase: p.zBaseFor(token, w),
      mirror: p.baseMirror,
      jitter: jit,
      sinker: w < p.wales - 1,    // no trailing sinker off the last wale (selvedge)
    };
    if (p.pique) {
      ctx.heldPitch = (p.pitchY || PITCH_Y) * p.pique.alpha;
      ctx.yScale = p.pique.yScale;
      ctx.tuckArch = true;
      const s = piqueShape(token, w, c, ctx, p);
      ctx.zBase += s.dz;
      jit.x += s.dx;
    }
    const stitch = stitchPoints(token, ctx);
    for (const pt of stitch) points.push(pt);
  }
  return { points, starts };
}

// Loop height of an unraised terry back, in wale units (one wale ≈ 0.85 mm
// at 20G, so ≈ 1 mm): the sinker sets it, the engine's loop yarn length per
// needle carries it.
const LOOPBACK_HEIGHT = 1.7;

// Turn a loop yarn's straight floats into standing loops. Each run of missed
// needles between two tucks is re-drawn as a dense arc that rises off the
// back (−z), sags toward the knitting direction and leans a little — loops
// never stand in a perfect row. The tucks themselves stay where they are,
// caught into the back of the face loops.
function loopArcs(course, tokenAt, wales, height) {
  const pts = course.points, st = course.starts;
  const seg = (w) => pts.slice(st[w], w + 1 < st.length ? st[w + 1] : pts.length);
  const out = [], starts = [];
  let w = 0;
  while (w < wales) {
    if (tokenAt(w) !== 'miss') { starts.push(out.length); for (const p of seg(w)) out.push(p); w++; continue; }
    let e = w;
    while (e + 1 < wales && tokenAt(e + 1) === 'miss') e++;
    const a = seg(w)[0], lastSeg = seg(e), b = lastSeg[lastSeg.length - 1];
    const n = Math.max(8, (e - w + 1) * 7);
    const h = height * (0.85 + 0.3 * frac(Math.sin((w + 1) * 12.9898 + (a.y || 0) * 78.233) * 43758.5453));
    const lean = (frac(Math.sin((w + 3) * 4.1414 + (a.y || 0) * 9.31) * 1e4) - 0.5) * 0.25;
    for (let i = 0; i < n; i++) {
      if (i % 7 === 0) starts.push(out.length);
      const t = (i + 0.5) / n;
      const arc = Math.sin(Math.PI * t);
      const p = a.clone ? a.clone() : { ...a };
      p.x = a.x + (b.x - a.x) * t + lean * arc * h * 0.5;
      p.y = a.y + (b.y - a.y) * t - 0.34 * h * Math.pow(arc, 1.6);
      p.z = a.z + (b.z - a.z) * t - h * Math.pow(arc, 0.85);
      out.push(p);
    }
    for (let k = starts.length; k < e + 1; k++) starts.push(out.length - 1);
    w = e + 1;
  }
  course.points = out;
  course.starts = starts.slice(0, wales);
}
const frac = (x) => x - Math.floor(x);
function ihash(x, y, salt) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt, 1013904223)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Sinker-loop plush: the pile yarn is plated into every needle loop behind
// the ground yarn, and between two needles it is drawn over the HIGH sinker
// nib — so where a plain yarn has a short sinker loop, the pile yarn stands
// a loop `height` tall off the technical back (−z). Knitted towel terry is a
// field of these, one per needle per course. They are Ω-shaped (narrow where
// the two needle loops pinch them, rounder at the top), a little different
// in height and each leaning its own way — a terry pile never stands in
// rows. Cut (velour): the loops are sheared open, so only a short stub of
// yarn is modelled and the cut fibre is drawn as a pile on top of it.
// which needle positions carry a pile loop (terry-loops.js PLUSH_ARRANGEMENTS)
const PLUSH_SELECT = {
  full: () => true,
  alternate: (w) => w % 2 === 0,
  checker: (w, c) => (w + c) % 2 === 0,
  diagonal: (w, c) => (w + c) % 3 === 0,
};
function plushLoops(course, c, wales, height, every, cut, arrangement) {
  const selected = PLUSH_SELECT[arrangement] || (every === 2 ? PLUSH_SELECT.alternate : PLUSH_SELECT.full);
  const pts = course.points, st = course.starts;
  const out = [], starts = [], floatIdx = [];
  for (let w = 0; w < wales; w++) {
    const end = w + 1 < st.length ? st[w + 1] : pts.length;
    const seg = pts.slice(st[w], end);
    starts.push(out.length);
    if (w >= wales - 1 || !selected(w, c) || seg.length < 3) { for (const p of seg) out.push(p); continue; }
    for (let i = 0; i < seg.length - 1; i++) out.push(seg[i]);     // the needle loop, without its sinker
    const a = seg[seg.length - 2], b = pts[st[w + 1]];
    // per-loop variation; repeats with the structure tile when baking
    const kw = jitterPeriod ? w % jitterPeriod.w : w, kc = jitterPeriod ? c % jitterPeriod.c : c;
    // integer hash: a sin() hash of (w, c) leaves faint diagonal order that
    // the eye picks out once the baked tile repeats across a whole cloth
    const ra = ihash(kw, kc, 1), rb = ihash(kw, kc, 2), rc = ihash(kw, kc, 3), rd = ihash(kw, kc, 4);
    const h = height * (0.8 + 0.4 * ra);
    const leanY = (rb - 0.5) * 0.95, leanX = (rc - 0.5) * 0.7;
    // each loop turns on its own axis as it is pulled off the sinker and
    // relaxes in finishing — seen from above a towel is a field of open
    // rings facing every way, not arches in rows
    const twist = cut ? 0 : (rd - 0.5) * 2.4;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const n = cut ? 7 : 18;
    for (let i = 1; i < n; i++) {
      const t = i / n, s = Math.sin(Math.PI * t), s15 = Math.pow(s, 1.5);
      const p = a.clone ? a.clone() : { ...a };
      let x = a.x + (b.x - a.x) * t + (t - 0.5) * 0.6 * s;
      let y = a.y + (b.y - a.y) * t - 0.1 * s;
      if (twist) {
        const ang = twist * Math.pow(s, 0.6), co = Math.cos(ang), si = Math.sin(ang);
        const dx = x - mx, dy = y - my;
        x = mx + dx * co - dy * si; y = my + dx * si + dy * co;
      }
      p.x = x + leanX * h * s15 * 0.45;
      p.y = y + leanY * h * s15 * 0.5;
      p.z = a.z + (b.z - a.z) * t - h * Math.pow(s, 0.7);
      out.push(p);
      if (cut && i === (n >> 1)) floatIdx.push(out.length - 1);
    }
  }
  course.points = out;
  course.starts = starts;
  if (cut) course.floatIdx = floatIdx;
}

// The machine's feed sequence for a fleece, from the engine's real cylinder
// programme (pattern_cylinder): an all-K row is a FACE/ground feed, a row
// with T/M is a FLEECY feed (that yarn tucks where the row says T and floats
// where it says M). 3-thread fleece comes back as K,K,M/T,K,K,M/T — two
// knitted courses per fleecy feed, tucking every 4th needle, staggered by 2.
// Falls back to a synthetic one-fleecy-feed-per-course, tuck-every-4th
// sequence only when no usable programme is present.
function fleeceFeeds(pattern) {
  const grid = pattern && pattern.grid;
  if (Array.isArray(grid) && grid.length) {
    const yarns = pattern.feedYarns || [];
    const feeds = grid.map((row, i) => (row.some(c => c === 'T' || c === 'M')
      ? { fleecy: row }
      : { face: true, plated: yarns[i] === 'plated' }));
    if (feeds.some(f => f.face) && feeds.some(f => f.fleecy && f.fleecy.includes('T'))) return feeds;
  }
  const n = FLEECE_TUCK_EVERY;
  const row = (shift) => Array.from({ length: n }, (_, i) => (i === shift ? 'T' : 'M'));
  return [{ face: true }, { fleecy: row(0) }, { face: true }, { fleecy: row(n >> 1) }];
}

/**
 * The structure's true repeat — in wales, in courses — and the wale pitch:
 * the smallest tile after which every stitch token, every bed offset and
 * every fleecy feed recurs. Null where the structure has no fixed repeat
 * (synthetic eyelet motifs, warp knits), which the macro view then skips.
 */
export function structureRepeat(con, pattern) {
  if (!con || con.base === 'warp' || con.type === 'tricot' || con.type === 'mesh' || con.type === 'spacer') return null;
  const pc = (pattern && pattern.cols) || 1, pr = (pattern && pattern.rows) || 1;
  // the loops' own irregularity repeats over 16 × 16 stitches (~1.5 cm), long
  // enough that the baked tile does not read as a check from a distance
  if (con.type === 'plush') {
    const r = con.arrangement === 'diagonal' ? 12 : 16;      // a whole number of 1-in-3 steps
    return { wales: r, courses: r, xPitch: PITCH_X };
  }
  if ((con.type === 'fleece' && con.pile === 'brush') || con.type === 'terry') {
    const feeds = fleeceFeeds(pattern);
    const faces = feeds.filter(f => f.face).length || 1;
    const w = feeds.reduce((acc, f) => (f.fleecy ? lcm(acc, f.fleecy.length) : acc), 1);
    return { wales: w, courses: faces, xPitch: PITCH_X };
  }
  if (con.type === 'interlock') {
    return {
      wales: lcm(pc, (pattern && pattern.dialCols) || 1),
      courses: lcm(pr, (pattern && pattern.dialRows) || 1),
      xPitch: PITCH_X,
    };
  }
  if (con.type === 'rib') {
    const rep = con.ribRepeat || { a: 1, b: 1 };
    const period = Math.max(1, rep.a || 1) + Math.max(1, rep.b || 1);
    return { wales: lcm(period, pc), courses: pr, xPitch: PITCH_X * RIB_PITCH_SCALE };
  }
  return { wales: pc, courses: pr, xPitch: PITCH_X };
}

/**
 * Nap roots: the midpoint of every fleecy-yarn float, read from the paths'
 * CURRENT (post-drape) points — computing them from the flat pre-drape grid
 * left the nap hovering off the floats wherever the drape bulged the cloth.
 */
export function floatAnchorsFromPaths(paths) {
  const anchors = [];
  for (const path of paths) {
    if (!path.floatIdx) continue;
    for (const i of path.floatIdx) {
      const a = path.points[i], b = path.points[i + 1];
      if (!a || !b) continue;
      anchors.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
    }
  }
  return anchors;
}

/**
 * @param {object} opts
 *   construction : { type, ribRepeat, holeShape, ... }
 *   sample       : (w,c) -> 'knit'|'purl'|'tuck'|'miss'
 *   wales,courses: optional patch size overrides
 * @returns {{ paths: {points: THREE.Vector3[]}[], backPaths?, floatAnchors? }}
 */
export function buildYarnPaths(opts) {
  jitterPeriod = opts.jitterPeriod || null;
  const con = opts.construction || { type: 'jersey' };
  const sample = typeof opts.sample === 'function' ? opts.sample : () => 'knit';
  const pitchY = opts.pitchY || PITCH_Y;     // density-driven course spacing
  const paths = [];
  // Piqué geometry in stitch units: cell depth from yarn diameters, lean
  // from fractions of a wale (see piqueShape).
  const pq = opts.pique;
  const yd = 2 * (opts.yarnRadius || 0.15);
  const piq = pq ? {
    relief: (pq.reliefD || 0) * yd,
    lean: (pq.lean || 0) * PITCH_X,
    alpha: pq.alpha != null ? pq.alpha : 1,
    d: yd,
    // Loops shortened to the packed course pitch, against a jersey's
    // (PITCH_Y / 1.3 at a jersey's course/wale ratio): the same yarn, held
    // between courses that sit ~1.4x closer.
    yScale: Math.max(0.45, Math.min(1, pitchY / (PITCH_Y / 1.3))),
  } : null;

  // WARP knit (tricot / raschel / warp net) — own topology (guide-bar zig-zag).
  if (con.base === 'warp' || con.type === 'tricot') {
    const net = con.type === 'mesh' || con.type === 'spacer' || con.mesh;
    return buildWarpPaths({ ends: opts.wales || PATCH.wales, courses: opts.courses || PATCH.courses, net, pitchY });
  }

  if (con.type === 'interlock') {
    const wales = opts.wales || PATCH.interlockWales;
    const courses = opts.courses || PATCH.interlockCourses;
    // A PLAIN interlock reads as full knit on both sides — the cylinder and
    // dial circuits both knit every feed, so each bed is forced to 'knit'.
    // A PATTERNED interlock (the dial carrying its own tuck/miss programme,
    // via pattern-engine's `pat.dial`) genuinely differs bed to bed — that is
    // real backend data, computed and handed down as `sampleBack`, that this
    // branch used to discard outright by forcing 'knit' regardless. Falling
    // back to `sample` keeps a plain interlock pixel-identical to before
    // (sampleBack resolves to 'knit' too when there is no dial programme —
    // see fabric-visualizer.js `_tokenAt`'s `useDial` check).
    const sampleBack = typeof opts.sampleBack === 'function' ? opts.sampleBack : sample;
    // A double-bed piqué's cylinder programme has its own misses and tucks
    // (Swiss and French piqué rest the cylinder on alternate feeds); only a
    // cylinder that knits every feed is forced to knit.
    const cylProgramme = !!(opts.pattern && opts.pattern.hasTM);
    for (let c = 0; c < courses; c++) {
      paths.push(buildCourse(c, {
        wales, courses, sample, xPitch: PITCH_X, xOffset: 0, pitchY,
        baseMirror: false, forceToken: cylProgramme ? null : 'knit', zBaseFor: () => INTERLOCK_DEPTH,
        pique: piq, other: piq ? sampleBack : null,
      }));
      paths.push(buildCourse(c, {
        wales, courses, sample: sampleBack, xPitch: PITCH_X, xOffset: PITCH_X * INTERLOCK_GAIT, pitchY,
        baseMirror: true, zBaseFor: () => -INTERLOCK_DEPTH, pique: piq,
        other: piq ? (cylProgramme ? sample : () => 'knit') : null,
      }));
    }
    if (pq && pq.showBack) turnOver(paths, wales);
    return { paths };
  }

  // Plush terry / velour: per course the ground yarn knits every needle (the
  // jersey face) and the pile yarn is plated one yarn-width behind it, then
  // stands off the back over the high sinker (plushLoops).
  if (con.type === 'plush') {
    const wales = opts.wales || PATCH.wales;
    const courses = opts.courses || PATCH.courses;
    const knitOnly = () => 'knit';
    const every = con.every === 2 ? 2 : 1;
    const height = opts.loopHeight || (con.cut ? 0.5 : 2.2);
    const out = [];
    for (let c = 0; c < courses; c++) {
      out.push(buildCourse(c, {
        wales, courses, sample: knitOnly, xPitch: PITCH_X, xOffset: 0, pitchY,
        baseMirror: false, zBaseFor: () => 0,
      }));
      const pile = buildCourse(c, {
        wales, courses, sample: knitOnly, xPitch: PITCH_X, xOffset: 0, pitchY,
        baseMirror: false, zBaseFor: () => FLEECE_BINDER_Z,
      });
      pile.role = 'fleecy';
      plushLoops(pile, c, wales, height, every, !!con.cut, con.arrangement);
      out.push(pile);
    }
    return { paths: out, floatAnchors: !!con.cut };
  }

  // Fleece: the face is plain jersey — every face/ground feed knits every
  // needle, which is the whole point of the construction. The fleecy yarn is
  // a separate yarn laid in between face courses at its own feed: caught into
  // the BACK of a face loop where it tucks, floating across the technical
  // back everywhere else. Those floats are what brushing raises into the nap,
  // so the pile is rooted on them (floatAnchors → knit-renderer.js _addPile).
  // Loopback (french terry) is the same knitting as a fleece — the loop yarn
  // tucks and floats on the back — but it is never raised: the floats are fed
  // long (the sinker sets the loop height), so each one stands off the back
  // as a small loop. That loop field IS the terry back.
  const loopBack = con.type === 'terry';
  if ((con.type === 'fleece' && con.pile === 'brush') || loopBack) {
    const wales = opts.wales || PATCH.wales;
    const courses = opts.courses || PATCH.courses;
    const feeds = fleeceFeeds(opts.pattern);
    const knitOnly = () => 'knit';
    const facePaths = [];
    const backPaths = [];
    const floatAnchors = [];
    for (let c = 0, f = 0; c < courses; f++) {
      const feed = feeds[f % feeds.length];
      if (feed.face) {
        facePaths.push(buildCourse(c, {
          wales, courses, sample: knitOnly, xPitch: PITCH_X, xOffset: 0, pitchY,
          baseMirror: false, zBaseFor: () => 0,
        }));
        // Plated feed: the tie-in binder is knitted into the SAME loops,
        // directly behind the face yarn — hidden from the face, closing it
        // from behind, and holding the fleecy yarn's tucks in place.
        if (feed.plated) {
          const binder = buildCourse(c, {
            wales, courses, sample: knitOnly, xPitch: PITCH_X, xOffset: 0, pitchY,
            baseMirror: false, zBaseFor: () => FLEECE_BINDER_Z,
          });
          binder.role = 'binder';
          backPaths.push(binder);
        }
        c++;
        continue;
      }
      const row = feed.fleecy;
      const tokenAt = (w) => (row[w % row.length] === 'T' ? 'tuck' : 'miss');
      const host = Math.max(0, c - 1);              // the face course it is laid into
      const lift = pitchY * 0.5;                    // between that course and the next
      const course = buildCourse(host, {
        wales, courses, sample: (w) => tokenAt(w), xPitch: PITCH_X, xOffset: 0, pitchY,
        baseMirror: false, zBaseFor: (tok) => (tok === 'tuck' ? FLEECE_TUCK_Z : FLEECE_BIND_DEPTH),
      });
      for (const p of course.points) p.y += lift;
      if (loopBack) {
        loopArcs(course, (w) => tokenAt(w), wales, opts.loopHeight != null ? opts.loopHeight : LOOPBACK_HEIGHT);
        course.role = 'fleecy';
        backPaths.push(course);
        continue;
      }
      // Remember where each float's two mid points sit in this path, so the
      // renderer can root the nap on the floats AFTER the drape pass has
      // moved them (see floatAnchorsFromPaths).
      course.role = 'fleecy';
      course.floatIdx = [];
      for (let w = 0; w < wales; w++) {
        if (tokenAt(w) === 'miss') course.floatIdx.push(course.starts[w] + 1);
      }
      backPaths.push(course);
    }
    return { paths: facePaths.concat(backPaths), floatAnchors: !loopBack };
  }

  if (con.type === 'rib') {
    const wales = opts.wales || PATCH.ribWales;
    const courses = opts.courses || PATCH.courses;
    const xPitch = PITCH_X * RIB_PITCH_SCALE;
    for (let c = 0; c < courses; c++) {
      paths.push(buildCourse(c, {
        wales, courses, sample, xPitch, xOffset: 0, pitchY, baseMirror: false,
        // Purl recedes only PART of the way back — the full -RIB_DEPTH offset
        // (matching knit's own +RIB_DEPTH push forward) buried the purl bump
        // entirely behind the neighbouring knit column's wide, forward legs
        // under a straight-on camera, so every column read as the same knit
        // V regardless of the real alternating stitch (see loop-geometry.js
        // `purlLoop`). A shallower recede keeps real depth parallax for
        // orbiting while staying visible head-on.
        zBaseFor: (token) => (token === 'purl' ? -RIB_DEPTH * 0.12 : RIB_DEPTH),
      }));
    }
    return { paths };
  }

  // Single-bed family: jersey / piqué / terry / fleece / mesh / pointelle.
  const wales = opts.wales || PATCH.wales;
  const courses = opts.courses || PATCH.courses;
  // eyelets: prefer the REAL transfer pattern (M cells via sample) when the
  // fabric provides one; otherwise fall back to the synthetic motif by holeShape.
  let holes = null;
  if (con.type === 'mesh' || con.type === 'spacer') {
    holes = con.holeSource === 'pattern'
      ? makePatternHoles(sample)
      : makePointelle(con.holeShape || 'hex');
  }
  for (let c = 0; c < courses; c++) {
    paths.push(buildCourse(c, {
      wales, courses, sample, xPitch: PITCH_X, xOffset: 0, pitchY,
      baseMirror: false, zBaseFor: () => 0, holes, pique: piq,
    }));
  }
  // A piqué sold on its technical back: turn the cloth over, so the default
  // view, the macro bake's face and the loop model all show the cells.
  if (pq && pq.showBack) turnOver(paths, wales);
  return { paths };
}
