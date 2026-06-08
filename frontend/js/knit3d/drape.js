// KnitAdvisor · knit3d — analytic drape (ধাপ ৫, light tier).
//
// A real swatch is never a flat card: it curves and wrinkles under its own
// weight. A full per-stitch cloth solver over thousands of tube control points
// is infeasible at interactive rates, so instead we deform the yarn CONTROL
// POINTS once (before the tubes are built) with an analytic drape field:
//   • a gentle vertical-axis cylinder bulge toward the viewer,
//   • soft low-frequency wrinkles,
//   • a slight bottom-edge droop (gravity).
// Because this runs before the mesh is measured, the cover-fit framing and the
// shadow camera adapt to the draped shape automatically.
//
// `amount` (0..1) is the drape strength — heavier / stiffer / double-bed
// fabrics drape LESS (computed by the renderer from GSM·density·construction).

import { hash2 } from './noise.js?v=20260608g';

export function applyDrape(paths, opts = {}) {
  const amount = opts.amount != null ? opts.amount : 0.6;
  if (amount <= 0) return;

  // bounds over every control point
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of paths) for (const v of p.points) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
  }
  const W = (maxX - minX) || 1, Hh = (maxY - minY) || 1, D = Math.max(W, Hh);

  const bow   = 0.045 * W  * amount;   // forward cylinder bulge (toward viewer)
  const wrink = 0.006 * D  * amount;   // soft surface wrinkles (kept shallow so
                                       // troughs never sink behind the backing)
  const droop = 0.030 * Hh * amount;   // bottom-edge gravity sag
  const phase = hash2(7, 13) * 6.283;  // stable wrinkle phase

  for (const p of paths) for (const v of p.points) {
    const u = (v.x - minX) / W;        // 0..1 across wales
    const vv = (v.y - minY) / Hh;      // 0..1 up courses
    const cu = u - 0.5;
    // cylinder bulge (max at centre, 0 at L/R selvedge) + wrinkles
    let dz = bow * Math.cos(cu * Math.PI);
    dz += wrink * Math.sin(u * Math.PI * 3.0 + phase) * Math.sin(vv * Math.PI * 2.0);
    v.z += dz;
    // lower edge droops down a touch (gravity)
    const below = Math.max(0, 0.5 - vv);
    v.y -= droop * below * below * 4;
  }
}
