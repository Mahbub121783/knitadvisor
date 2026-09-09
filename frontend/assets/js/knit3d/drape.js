// KnitAdvisor · knit3d — drape (ধাপ ৫).
//
// v1 (until 2026-09) was a single authored formula for the whole shape: a
// fixed cylinder bulge + sine wrinkle + gravity droop. It looked plausible
// but every fabric bent by the same hand-picked curve regardless of what a
// real swatch's own weight/stiffness would actually do to it.
//
// v2 gets the MACRO shape (the bulge/sag the swatch settles into) from a
// real constraint-physics relaxation instead (cloth-sim.js: gravity +
// structural/shear/bend distance constraints on a coarse grid, run once to
// convergence) — genuine simulated physics, not a curve someone tuned by
// eye. It still layers a small procedural high-frequency wrinkle on top for
// yarn-scale surface detail, because that is a different, far-higher-
// resolution problem than the coarse grid was ever meant to solve: a full
// per-stitch cloth solver over thousands of tube control points is still
// infeasible at interactive rates, in a browser, on an ordinary laptop or
// phone. Simulating the coarse macro shape and keeping the fine detail
// procedural is the standard split real-time cloth rendering always makes —
// this is that split, not a shortcut around it.
//
// `amount` (0..1) is the drape strength — heavier / stiffer / double-bed
// fabrics drape LESS (computed by the renderer from GSM·density·construction).

import { hash2 } from './noise.js?v=20260608g';
import { relaxClothGrid, sampleCloth } from './cloth-sim.js?v=20260609a';

export function applyDrape(paths, opts = {}) {
  const amount = opts.amount != null ? opts.amount : 0.6;
  if (amount <= 0) return;

  // bounds over every FINITE control point — a construction that ever slips
  // a NaN through earlier stages must not poison the whole bounding box (see
  // the warp-knit density guard upstream in knit-renderer.js).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of paths) for (const v of p.points) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return; // nothing finite to drape
  const W = (maxX - minX) || 1, Hh = (maxY - minY) || 1, D = Math.max(W, Hh);

  // Grid resolution: proportional to the caller's actual stitch counts when
  // given, otherwise a sane default — clamped so relaxation always stays
  // cheap (worst case here is ~20x26 = 520 particles, tens of constraints
  // each, well under a millisecond-scale cost even unoptimised).
  const cols = Math.max(8, Math.min(20, Math.round((opts.wales || 16) / 1.4)));
  const rows = Math.max(10, Math.min(26, Math.round((opts.courses || 16) / 1.2)));
  const grid = relaxClothGrid({
    cols, rows, width: W, height: Hh,
    bulge: 0.10 + 0.10 * amount,
    gravity: 0.6 + 0.6 * amount,
    pin: 'corners4', // held flat by its 4 corners, sags/bulges forward in the middle — a swatch card, not a hanging curtain
  });

  // Fine procedural wrinkle — yarn-scale surface detail the coarse grid
  // cannot represent, kept shallow so troughs never sink behind the backing.
  const wrink = 0.006 * D * amount;
  const phase = hash2(7, 13) * 6.283;

  for (const p of paths) for (const v of p.points) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) continue;
    const u = (v.x - minX) / W;   // 0..1 across wales
    const vv = (v.y - minY) / Hh; // 0..1 up courses
    const cloth = sampleCloth(grid, u, vv);

    v.x += cloth.dx * amount;
    v.y += cloth.dy * amount;
    v.z += cloth.dz * amount;
    v.z += wrink * Math.sin(u * Math.PI * 3.0 + phase) * Math.sin(vv * Math.PI * 2.0);
  }
}
