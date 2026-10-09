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
  FLEECE_BIND_DEPTH, FLEECE_TUCK_EVERY, MISS,
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
  for (let w = 0; w < p.wales; w++) {
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
  return { points };
}

// Which wales tie the binding/fleecy yarn in (tuck) vs let it float (miss),
// on course c — staggered course to course (real fabric never ties in down
// one straight vertical line). Shared by the course builder below AND by
// knit-renderer.js's pile placement, so the two can never silently disagree
// about where the real floats are.
function isFleeceBindWale(w, c, tuckEvery) {
  const stagger = c % tuckEvery;
  return ((w + stagger) % tuckEvery) === 0;
}

/**
 * World-space anchor points for every FLOAT segment of the binding/fleecy
 * yarn — i.e. everywhere it is NOT tucked in. This is what real finishing
 * brushes into the raised nap, so pile fibres are rooted here (see
 * knit-renderer.js `_addPile`) instead of scattered across an unrelated flat
 * plane with no structural relationship to the knit.
 */
export function fleeceFloatAnchors({ wales, courses, tuckEvery = FLEECE_TUCK_EVERY, xPitch = PITCH_X, pitchY = PITCH_Y, zDepth = FLEECE_BIND_DEPTH }) {
  const anchors = [];
  for (let c = 0; c < courses; c++) {
    for (let w = 0; w < wales; w++) {
      if (isFleeceBindWale(w, c, tuckEvery)) continue;   // tucked in here, not floating
      anchors.push({
        x: w * xPitch, y: c * pitchY + MISS.y, z: zDepth + MISS.z,
      });
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

  // 3-thread fleece: a real second yarn (binding + fleecy), not a cosmetic
  // overlay. The FACE course is a plain knit, identical to single jersey —
  // real 3-thread fleece's technical face reads the same as plain jersey,
  // which is the point of the construction. The BINDING+FLEECY course runs
  // behind it: tucked in every FLEECE_TUCK_EVERY-th wale (the real 3-thread
  // ratio), floating the rest of the way — those floats are exactly what
  // _addPile (knit-renderer.js) brushes into the raised nap, via
  // fleeceFloatAnchors above, instead of an unrelated flat backing plane.
  if (con.type === 'fleece' && con.pile === 'brush') {
    const wales = opts.wales || PATCH.wales;
    const courses = opts.courses || PATCH.courses;
    const tuckEvery = FLEECE_TUCK_EVERY;
    const facePaths = [];
    const backPaths = [];
    for (let c = 0; c < courses; c++) {
      facePaths.push(buildCourse(c, {
        wales, courses, sample, xPitch: PITCH_X, xOffset: 0, pitchY,
        baseMirror: false, zBaseFor: () => 0,
      }));
      const bindSample = (w, cc) => (isFleeceBindWale(w, cc, tuckEvery) ? 'tuck' : 'miss');
      backPaths.push(buildCourse(c, {
        wales, courses, sample: bindSample, xPitch: PITCH_X, xOffset: 0, pitchY,
        baseMirror: false, zBaseFor: () => FLEECE_BIND_DEPTH,
      }));
    }
    return {
      paths: facePaths.concat(backPaths),
      floatAnchors: fleeceFloatAnchors({ wales, courses, tuckEvery, xPitch: PITCH_X, pitchY }),
    };
  }

  if (con.type === 'rib') {
    const wales = opts.wales || PATCH.ribWales;
    const courses = opts.courses || PATCH.courses;
    const xPitch = PITCH_X * RIB_PITCH_SCALE;
    for (let c = 0; c < courses; c++) {
      paths.push(buildCourse(c, {
        wales, courses, sample, xPitch, xOffset: 0, pitchY, baseMirror: false,
        zBaseFor: (token) => (token === 'purl' ? -RIB_DEPTH : RIB_DEPTH),
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
