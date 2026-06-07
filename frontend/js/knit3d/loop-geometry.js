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
//   zBase           bed depth offset (rib/interlock push wales fore/aft)
//   mirror          true → reflect z (renders the technical BACK = a purl wale)
//   jitter          {x,y,z} per-stitch deviation (planned imperfection)
//   sinker          true → append the trailing sinker toward the next wale

import * as THREE from 'three';
import { PITCH_X, LOOP, TUCK, MISS, TRANSFER_Z } from './constants.js?v=20260608f';

// Build a local point, applying mirror (z), jitter and the world centre.
function P(ctx, lx, ly, lz) {
  const z = (ctx.mirror ? -lz : lz) + ctx.zBase;
  return new THREE.Vector3(
    ctx.cx + lx + ctx.jitter.x,
    ctx.cy + ly + ctx.jitter.y,
    z + ctx.jitter.z,
  );
}

// The trailing sinker: a short arc from this stitch's right foot toward the next
// wale's left foot. Kept as one mid control point; the spline rounds it.
function sinker(ctx) {
  return P(ctx, PITCH_X * 0.5, LOOP.sinkerY - LOOP.footY, LOOP.sinkerZ - 0);
}

/**
 * Knit needle loop (also used for a purl wale via ctx.mirror).
 * foot → left leg → left shoulder → head crown → right shoulder → right leg →
 * foot → sinker. When held, the head/shoulders lift by `extraUp` so the loop
 * stretches up through the tuck/miss courses above it (the held loop you see
 * poking through a mesh / piqué).
 */
export function knitLoop(ctx) {
  const up = (ctx.heldExtra || 0) * 0.92;            // extra height per held course
  const L = LOOP;
  const pts = [
    P(ctx, -L.footHalf,        L.footY,            L.footZ),
    P(ctx, -L.legHalf,         L.legY,             L.legZ),
    P(ctx, -L.headHalf * 0.94, L.shoulderY + up * 0.5, L.shoulderZ),
    P(ctx, -L.headHalf,        L.headY - 0.06 + up, L.shoulderZ),
    P(ctx,  0,                 L.headY + up,        L.headZ),     // crown, frontmost
    P(ctx,  L.headHalf,        L.headY - 0.06 + up, L.shoulderZ),
    P(ctx,  L.headHalf * 0.94, L.shoulderY + up * 0.5, L.shoulderZ),
    P(ctx,  L.legHalf,         L.legY,             L.legZ),
    P(ctx,  L.footHalf,        L.footY,            L.footZ),
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
    case 'purl':     return knitLoop({ ...ctx, mirror: !ctx.mirror }); // purl = back of a knit loop
    case 'knit':
    default:         return knitLoop(ctx);
  }
}
