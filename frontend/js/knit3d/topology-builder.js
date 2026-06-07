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

import { stitchPoints } from './loop-geometry.js?v=20260608f';
import { stitchJitter } from './noise.js?v=20260608f';
import { makePointelle, makePatternHoles } from './pointelle.js?v=20260608f';
import { buildWarpPaths } from './warp-topology.js?v=20260608f';
import {
  PITCH_X, PITCH_Y, RIB_PITCH_SCALE, RIB_DEPTH,
  INTERLOCK_DEPTH, INTERLOCK_GAIT, JITTER, PATCH,
} from './constants.js?v=20260608f';

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

/**
 * @param {object} opts
 *   construction : { type, ribRepeat, holeShape, ... }
 *   sample       : (w,c) -> 'knit'|'purl'|'tuck'|'miss'
 *   wales,courses: optional patch size overrides
 * @returns {{ paths: {points: THREE.Vector3[]}[] }}
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
    // front bed knits the CYLINDER programme; back bed knits the DIAL programme
    // (their 'M' gaiting interleaves the two beds — true interlock, not 2 jerseys)
    const sampleBack = opts.sampleBack || sample;
    for (let c = 0; c < courses; c++) {
      paths.push(buildCourse(c, {
        wales, courses, sample, xPitch: PITCH_X, xOffset: 0, pitchY,
        baseMirror: false, zBaseFor: () => INTERLOCK_DEPTH,
      }));
      paths.push(buildCourse(c, {
        wales, courses, sample: sampleBack, xPitch: PITCH_X, xOffset: PITCH_X * INTERLOCK_GAIT, pitchY,
        baseMirror: true, zBaseFor: () => -INTERLOCK_DEPTH,
      }));
    }
    return { paths };
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
