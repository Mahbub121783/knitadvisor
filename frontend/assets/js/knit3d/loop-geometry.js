// KnitAdvisor · knit3d — parametric stitch geometry.
//
// Every function returns an ORDERED list of THREE.Vector3 control points for a
// single stitch, authored so that the last point flows into the first point of
// the next wale's stitch (via a trailing sinker). Concatenating a whole course
// therefore yields ONE continuous yarn polyline — no open tube mouths between
// wales, which was the core gap in the previous renderer.
//
// `ctx` for every generator:
//   { cx, cy }      world centre of this stitch (wale offset already applied)
//   heldExtra       how many extra courses this loop is held (tuck/miss above)
//   heldPitch       height added per held course (default one course pitch)
//   zBase           bed depth offset (rib/interlock push wales fore/aft)
//   mirror          true → reflect z (renders the technical BACK = a purl wale)
//   jitter          {x,y,z} per-stitch deviation (planned imperfection)
//   sinker          true → append the trailing sinker toward the next wale

import * as THREE from 'three';
import { PITCH_X, LOOP, TUCK, MISS, TRANSFER_Z } from './constants.js?v=20260608g';

// Build a local point, applying mirror (z), jitter and the world centre.
// `yScale` shortens the loop where courses are packed tighter than a
// jersey's (a piqué: same yarn, squeezed between packed courses).
function P(ctx, lx, ly, lz) {
  const z = (ctx.mirror ? -lz : lz) + ctx.zBase;
  return new THREE.Vector3(
    ctx.cx + lx + ctx.jitter.x,
    ctx.cy + ly * (ctx.yScale || 1) + ctx.jitter.y,
    z + ctx.jitter.z,
  );
}

// The trailing sinker: a short arc from this stitch's right foot toward the next
// wale's left foot. Kept as one mid control point; the spline rounds it.
function sinker(ctx) {
  return P(ctx, PITCH_X * 0.5, LOOP.sinkerY, LOOP.sinkerZ);
}

/**
 * Knit needle loop (also used for a purl wale via ctx.mirror).
 * foot → left leg → left shoulder → head crown → right shoulder → right leg →
 * foot → sinker. When held, the head/shoulders lift by `extraUp` so the loop
 * stretches up through the tuck/miss courses above it (the held loop you see
 * poking through a mesh / piqué).
 */
export function knitLoop(ctx) {
  // extra height per held course: one course pitch, or n*C*alpha for a
  // pique (ctx.heldPitch, see topology-builder.js)
  const up = (ctx.heldExtra || 0) * (ctx.heldPitch != null ? ctx.heldPitch : 0.92) / (ctx.yScale || 1);
  const L = LOOP;
  const pts = [
    P(ctx, -L.footHalf,     L.footY,                L.footZ),
    P(ctx, -L.lowLegHalf,   L.lowLegY,              L.lowLegZ),
    P(ctx, -L.legHalf,      L.legY + up * 0.35,     L.legZ),
    P(ctx, -L.shoulderHalf, L.shoulderY + up * 0.7, L.shoulderZ),
    P(ctx, -L.headHalf,     L.headSideY + up,       L.headSideZ),
    P(ctx,  0,              L.headY + up,           L.headZ),
    P(ctx,  L.headHalf,     L.headSideY + up,       L.headSideZ),
    P(ctx,  L.shoulderHalf, L.shoulderY + up * 0.7, L.shoulderZ),
    P(ctx,  L.legHalf,      L.legY + up * 0.35,     L.legZ),
    P(ctx,  L.lowLegHalf,   L.lowLegY,              L.lowLegZ),
    P(ctx,  L.footHalf,     L.footY,                L.footZ),
  ];
  if (ctx.sinker) pts.push(sinker(ctx));
  return pts;
}

/**
 * Purl: the technical BACK of a knit loop, as actually seen by the camera —
 * NOT simply a z-mirrored knitLoop. Mirroring only negates z, so the x/y
 * path (the silhouette any front-on camera actually sees) was IDENTICAL to
 * a knit loop — a 1x1 rib rendered as uniform V chevrons in every column,
 * with no visible rib corrugation, which is exactly backwards: what faces
 * the viewer on a purl wale is the sinker arcs and the rounded head/foot
 * curves, which read as a wide, LOW, horizontal "pearl" bump, not a tall
 * narrow V. Matches the 2D view's own purl silhouette (see
 * fabric-visualizer.js `_drawPurlLOD`'s "half-moon bump lying across the
 * wale") instead of a depth-only approximation that collapsed to nothing
 * under an orthogonal camera.
 */
export function purlLoop(ctx) {
  const up = (ctx.heldExtra || 0) * (ctx.heldPitch != null ? ctx.heldPitch : 0.92) / (ctx.yScale || 1);
  const L = LOOP;
  // Wide, low-but-tall-ENOUGH arc: a purl bump that stays small/far back
  // disappears entirely behind the neighbouring knit column's own wide,
  // forward-pushed legs under a front-on camera — the real bug a first pass
  // at this function had (confirmed by direct instrumentation: the right
  // token WAS being generated and dispatched, it just never read as
  // visually distinct). Tall and wide enough to clear the gap between two
  // knit V's, not receding as far back as RIB_DEPTH's full offset implies
  // (see topology-builder.js's rib branch, which now gives purl a shallower
  // z than knit's).
  // Explicit numbers, not derived from LOOP's knit profile: this silhouette
  // was tuned and verified on its own, and must not drift whenever the knit
  // loop is reshaped. Only the two feet are shared, so the course stays one
  // continuous strand from a knit wale into a purl wale and back.
  const pts = [
    P(ctx, -L.footHalf, L.footY,             L.footZ),
    P(ctx, -0.50,       -0.06,               0.16),
    P(ctx, -0.29,       0.29 + up * 0.5,     0.06),
    P(ctx,  0,          0.36 + up,           0.02),
    P(ctx,  0.29,       0.29 + up * 0.5,     0.06),
    P(ctx,  0.50,       -0.06,               0.16),
    P(ctx,  L.footHalf, L.footY,             L.footZ),
  ];
  if (ctx.sinker) pts.push(sinker(ctx));
  return pts;
}

/**
 * Tuck: the new yarn is caught but the old loop is NOT cleared. The course yarn
 * forms a shallow cup that recedes to the BACK; the held loop from below rises
 * through it in front (rendered as that lower loop's heldExtra elongation).
 */
export function tuckCup(ctx) {
  const T = TUCK, L = LOOP;
  if (ctx.tuckArch) return tuckArch(ctx);
  const pts = [
    P(ctx, -L.footHalf, L.footY,  L.footZ),
    P(ctx, -T.sideX,    T.sideY,  T.sideZ),
    P(ctx,  0,          T.cupY,   T.cupZ),
    P(ctx,  T.sideX,    T.sideY,  T.sideZ),
    P(ctx,  L.footHalf, L.footY,  L.footZ),
  ];
  if (ctx.sinker) pts.push(sinker(ctx));
  return pts;
}

/**
 * Tuck loop as it lies in a piqué: never drawn through, its crown is carried
 * up and caught inside the head of the next knitted loop, so it stands as a
 * narrow arch (∩) from its own course's sinkers up to about head height,
 * BEHIND the held loop it shares the needle with (the caller sets how far
 * behind). Seen from the technical back it is the open arch over each cell.
 */
function tuckArch(ctx) {
  const L = LOOP, z = -0.18;
  const pts = [
    P(ctx, -L.footHalf, L.footY, L.footZ),
    P(ctx, -0.27, 0.05, z),
    P(ctx, -0.22, 0.45, z),
    P(ctx, 0, 0.70, z - 0.04),
    P(ctx, 0.22, 0.45, z),
    P(ctx, 0.27, 0.05, z),
    P(ctx, L.footHalf, L.footY, L.footZ),
  ];
  if (ctx.sinker) pts.push(sinker(ctx));
  return pts;
}

/**
 * Miss / float: no loop is formed; the yarn floats straight across the back of
 * the held loop. Continuity is preserved at the feet so the course stays one
 * strand.
 */
export function missFloat(ctx) {
  const M = MISS, L = LOOP;
  const pts = [
    P(ctx, -L.footHalf, L.footY,            L.footZ),
    P(ctx, -M.spanX,    M.y,                M.z),
    P(ctx,  M.spanX,    M.y,                M.z),
    P(ctx,  L.footHalf, L.footY,            L.footZ),
  ];
  if (ctx.sinker) pts.push(sinker(ctx));
  return pts;
}

/**
 * Transfer / eyelet skip: no loop is formed here (the loop was transferred to a
 * neighbour). The yarn is carried straight across at the BACK, behind the
 * backing plane, so the eyelet reads as an open hole rather than a strand.
 */
export function transferFloat(ctx) {
  const L = LOOP;
  const pts = [
    P(ctx, -L.footHalf, L.footY,  TRANSFER_Z),
    P(ctx,  0,          L.footY + 0.04, TRANSFER_Z),
    P(ctx,  L.footHalf, L.footY,  TRANSFER_Z),
  ];
  if (ctx.sinker) pts.push(P(ctx, PITCH_X * 0.5, L.sinkerY - L.footY, TRANSFER_Z));
  return pts;
}

/** Dispatch by stitch token. */
export function stitchPoints(token, ctx) {
  switch (token) {
    case 'tuck':     return tuckCup(ctx);
    case 'miss':     return missFloat(ctx);
    case 'transfer': return transferFloat(ctx);
    case 'purl':     return purlLoop(ctx);
    case 'knit':
    default:         return knitLoop(ctx);
  }
}
