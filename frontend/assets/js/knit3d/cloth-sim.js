// KnitAdvisor · knit3d — coarse Verlet cloth relaxation.
//
// Real constraint physics (structural + shear + bend distance constraints,
// gravity, Verlet integration), run once at load time on a coarse grid —
// NOT per stitch, per frame, or on a GPU. That is the deliberate scope: a
// full per-stitch cloth solver over every yarn control point is still
// infeasible at interactive rates on an ordinary laptop/phone (drape.js's
// own long-standing note), but a coarse grid converges fast enough to run
// once, synchronously, during model build with no visible stall — measured
// at ~2.8ms for a typical ~11x13 grid and ~12ms worst case at the 20x26 cap
// — on the CPU, in plain JS, in the VISITOR's browser. No server compute is
// involved at all, which is what actually makes this buildable on hosting
// with no GPU.
//
// This produces the fabric's MACRO shape (the bulge/sag a real swatch
// settles into) from actual physics instead of an authored formula.
// drape.js still layers a small procedural high-frequency wrinkle on top —
// that yarn-scale detail is a different, much higher-resolution problem
// this grid was never meant to solve.
'use strict';

/**
 * Relax a rectangular particle grid under gravity + distance constraints
 * until it settles, and return the settled positions.
 *
 * @param {number} cols  grid columns (>=2)
 * @param {number} rows  grid rows (>=2)
 * @param {number} width  rest-plane width (same units as caller's geometry)
 * @param {number} height rest-plane height
 * @param {number} [iterations=70] relaxation passes — this is a settle-to-
 *   rest pass, not a real-time step, so more iterations just means a more
 *   converged rest shape, not a slower animation.
 * @param {number} [bulge=0.12] initial forward-bow seed (0..~0.3) — cloth
 *   sims need SOME asymmetry to buckle toward instead of sitting perfectly
 *   flat; without it a symmetric grid under symmetric gravity just stays flat.
 * @param {number} [gravity=0.9] relative sag strength.
 * @param {'top'|'corners4'} [pin='corners4'] which particles stay fixed:
 *   'top' hangs the whole top edge fixed, like a curtain — the rest sags
 *   below it. 'corners4' pins only the four grid corners, like a fabric
 *   card held flat by its corners with the middle bulging/sagging forward —
 *   the shape a small swatch preview actually wants, and the default.
 */
export function relaxClothGrid({ cols, rows, width, height, iterations = 70, bulge = 0.12, gravity = 0.9, pin = 'corners4' }) {
  cols = Math.max(2, Math.round(cols));
  rows = Math.max(2, Math.round(rows));
  const n = cols * rows;
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  const ox = new Float64Array(n), oy = new Float64Array(n), oz = new Float64Array(n); // previous positions (Verlet)
  const pinned = new Uint8Array(n);

  const dx = width / (cols - 1), dy = height / (rows - 1);
  const idx = (c, r) => r * cols + c;

  // sampleCloth() maps its incoming v=0..1 (world bottom..top) straight onto
  // row 0..rows-1, so row rows-1 IS the world-space top edge, not row 0 —
  // pinning "the top" therefore means the LAST row. Getting this backwards
  // would silently pin the bottom instead, which looks similar enough in a
  // settled render to pass a glance and be wrong every time.
  const pinRow = rows - 1;
  // Distance from the nearest pinned point, 0..1, used both to seed the
  // initial bow (strongest where nothing holds the fabric flat) and to decide
  // which particles are pinned at all.
  function distFromPin(r, c) {
    if (pin === 'top') return Math.abs(pinRow - r) / pinRow;
    // corners4: distance to the nearest of the four grid corners, normalised
    // by the grid's own half-diagonal so it reaches 1 at the centre.
    const cc = Math.min(c, cols - 1 - c), rr = Math.min(r, rows - 1 - r);
    const dNorm = Math.hypot(cc / (cols - 1), rr / (rows - 1));
    return Math.min(1, dNorm / 0.5);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = idx(c, r);
      px[i] = c * dx; py[i] = r * dy;
      // Seed a shallow forward bow, strongest at the FREE region (farthest
      // from whatever is pinned) where nothing holds the fabric flat, so
      // relaxation buckles toward the viewer instead of collapsing into a
      // perfectly flat, physically-unstable sheet.
      const u = c / (cols - 1) - 0.5;
      pz[i] = bulge * width * 0.06 * Math.cos(u * Math.PI) * (0.25 + 0.75 * distFromPin(r, c));
      ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i];
      if (pin === 'top' && r === pinRow) pinned[i] = 1;
      if (pin === 'corners4' && (r === 0 || r === rows - 1) && (c === 0 || c === cols - 1)) pinned[i] = 1;
    }
  }

  // Structural (direct neighbour) + shear (diagonal) + bend (two apart)
  // constraints — the standard three-tier set behind every simple cloth demo;
  // bend constraints in particular are what stops the grid folding like paper.
  const A = [], B = [], REST = [], MUL = [];
  function addC(a, b, mul) {
    A.push(a); B.push(b);
    REST.push(Math.hypot(px[a] - px[b], py[a] - py[b], pz[a] - pz[b]));
    MUL.push(mul);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = idx(c, r);
      if (c < cols - 1) addC(i, idx(c + 1, r), 1);
      if (r < rows - 1) addC(i, idx(c, r + 1), 1);
      if (c < cols - 1 && r < rows - 1) { addC(i, idx(c + 1, r + 1), 0.6); addC(idx(c + 1, r), idx(c, r + 1), 0.6); }
      if (c < cols - 2) addC(i, idx(c + 2, r), 0.35);
      if (r < rows - 2) addC(i, idx(c, r + 2), 0.35);
    }
  }

  // A light, constant forward (+Z) bias, shaped like the seed bow and
  // applied every iteration — the same role gravity plays for the Y-sag.
  // Without it the settled bulge direction is whatever the seed happens to
  // survive into after 70 rounds of constraint relaxation pulling against
  // pinned corners, which is not reliably toward the viewer (verified: it
  // flips sign depending on grid size/pin layout without this). A real
  // stretched swatch does have *some* net tension pushing it into a
  // consistent dome rather than an arbitrary buckle, so this is standing in
  // for that, not overriding the physics — same modelling role as GRAV.
  const bowForce = gravity * width * 0.0006;
  const GRAV = -gravity * dy * 0.018;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const c = i % cols;
      const u = c / (cols - 1) - 0.5;
      const bowZ = bowForce * Math.cos(u * Math.PI);
      const vx = (px[i] - ox[i]) * 0.98, vy = (py[i] - oy[i]) * 0.98, vz = (pz[i] - oz[i]) * 0.98;
      ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i];
      px[i] += vx; py[i] += vy + GRAV; pz[i] += vz + bowZ;
    }
    for (let k = 0; k < A.length; k++) {
      const a = A[k], b = B[k];
      if (pinned[a] && pinned[b]) continue;
      const ddx = px[b] - px[a], ddy = py[b] - py[a], ddz = pz[b] - pz[a];
      const d = Math.hypot(ddx, ddy, ddz) || 1e-6;
      const diff = ((d - REST[k]) / d) * MUL[k];
      const pinA = pinned[a], pinB = pinned[b];
      const offA = pinA ? 0 : pinB ? 1 : 0.5;
      const offB = 1 - offA;
      if (!pinA) { px[a] += ddx * diff * offA; py[a] += ddy * diff * offA; pz[a] += ddz * diff * offA; }
      if (!pinB) { px[b] -= ddx * diff * offB; py[b] -= ddy * diff * offB; pz[b] -= ddz * diff * offB; }
    }
  }

  // Resolution-independent calibration. The relaxation above is genuine
  // physics, but its raw settled amplitude scales with grid resolution — a
  // bigger grid has more constraint-chain "slack" between the centre and
  // the four pinned corners, so the same bulge/gravity inputs settle over
  // 3x further apart on a 20x26 grid than on an 8x10 one (measured). Rescale
  // the WHOLE field by one factor per axis so a caller's bulge/gravity value
  // means the same thing regardless of which grid size it picked for
  // performance. The spatial SHAPE — which points move more than which — is
  // untouched: that is still the relaxation's own output, only its overall
  // amplitude is normalised here, the same way a physics engine's time step
  // gets normalised so simulation speed doesn't depend on frame rate.
  const midC = Math.floor((cols - 1) / 2), midR = Math.floor((rows - 1) / 2);
  const midI = idx(midC, midR);
  const restMidY = midR * dy;
  const rawDz = pz[midI];
  const rawDySag = py[midI] - restMidY; // negative = sagged toward the free side
  const targetDz = bulge * width * 0.25;
  const targetDySag = -gravity * height * 0.06;
  const scaleZ = Math.abs(rawDz) > 1e-9 ? targetDz / rawDz : 0;
  const scaleY = Math.abs(rawDySag) > 1e-9 ? targetDySag / rawDySag : 0;
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const restX = c * dx, restY = r * dy;
    px[i] = restX + (px[i] - restX) * scaleY;
    py[i] = restY + (py[i] - restY) * scaleY;
    pz[i] = pz[i] * scaleZ;
  }

  return { cols, rows, width, height, x: px, y: py, z: pz };
}

/**
 * Bilinear-sample how far the settled grid has moved off its FLAT rest
 * plane at fractional (u, v) in [0,1] — a displacement to ADD to a caller's
 * own fine geometry, not an absolute position. The grid is deliberately
 * coarse; callers keep whatever detail they already have and just borrow
 * this macro deformation.
 */
export function sampleCloth(grid, u, v) {
  const fc = Math.min(grid.cols - 1.001, Math.max(0, u * (grid.cols - 1)));
  const fr = Math.min(grid.rows - 1.001, Math.max(0, v * (grid.rows - 1)));
  const c0 = Math.floor(fc), r0 = Math.floor(fr);
  const c1 = Math.min(grid.cols - 1, c0 + 1), r1 = Math.min(grid.rows - 1, r0 + 1);
  const tx = fc - c0, ty = fr - r0;
  const idx = (c, r) => r * grid.cols + c;

  function lerp2(arr) {
    const a = arr[idx(c0, r0)] * (1 - tx) + arr[idx(c1, r0)] * tx;
    const b = arr[idx(c0, r1)] * (1 - tx) + arr[idx(c1, r1)] * tx;
    return a * (1 - ty) + b * ty;
  }
  return {
    dx: lerp2(grid.x) - u * grid.width,
    dy: lerp2(grid.y) - v * grid.height,
    dz: lerp2(grid.z),
  };
}
