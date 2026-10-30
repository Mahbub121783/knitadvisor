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
  PITCH_X, PITCH_Y, RIB_PITCH_SCALE, RIB_DEPTH,
  INTERLOCK_DEPTH, INTERLOCK_GAIT, JITTER, PATCH,
  FLEECE_BIND_DEPTH, FLEECE_TUCK_Z, FLEECE_TUCK_EVERY, FLEECE_BINDER_Z,
} from './constants.js?v=20260608g';

const isHoldToken = (t) => t === 'tuck' || t === 'miss';

// How many consecutive held (tuck/miss) courses sit directly above (w,c).
function heldAbove(sample, w, c, courses) {
  let n = 0;
  for (let cc = c + 1; cc < courses; cc++) {
    if (isHoldToken(sample(w, cc))) n++; else break;
  }
  return n;
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
    const jit = stitchJitter(w, c, JITTER);
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
    const stitch = stitchPoints(token, ctx);
    for (const pt of stitch) points.push(pt);
  }
  return { points, starts };
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
  const con = opts.construction || { type: 'jersey' };
  const sample = typeof opts.sample === 'function' ? opts.sample : () => 'knit';
  const pitchY = opts.pitchY || PITCH_Y;     // density-driven course spacing
  const paths = [];

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
    for (let c = 0; c < courses; c++) {
      paths.push(buildCourse(c, {
        wales, courses, sample, xPitch: PITCH_X, xOffset: 0, pitchY,
        baseMirror: false, forceToken: 'knit', zBaseFor: () => INTERLOCK_DEPTH,
      }));
      paths.push(buildCourse(c, {
        wales, courses, sample: sampleBack, xPitch: PITCH_X, xOffset: PITCH_X * INTERLOCK_GAIT, pitchY,
        baseMirror: true, zBaseFor: () => -INTERLOCK_DEPTH,
      }));
    }
    return { paths };
  }

  // Fleece: the face is plain jersey — every face/ground feed knits every
  // needle, which is the whole point of the construction. The fleecy yarn is
  // a separate yarn laid in between face courses at its own feed: caught into
  // the BACK of a face loop where it tucks, floating across the technical
  // back everywhere else. Those floats are what brushing raises into the nap,
  // so the pile is rooted on them (floatAnchors → knit-renderer.js _addPile).
  if (con.type === 'fleece' && con.pile === 'brush') {
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
    return { paths: facePaths.concat(backPaths), floatAnchors: true };
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
      baseMirror: false, zBaseFor: () => 0, holes,
    }));
  }
  return { paths };
}
