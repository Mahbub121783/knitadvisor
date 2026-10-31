// KnitAdvisor · knit3d — interactive cloth: XPBD on a particle grid.
//
// The macro cloth (macro.js ClothSurface) is a grid of particles; this
// solver moves them. Units: positions in scene units (`unit` per metre),
// masses in kg, time in s. Spring stiffness (kg/s²) is the same in any
// length unit, so the fabric's real mechanics (fabric-body.js
// fabricMechanics) go in directly; only gravity is scaled.
//
// Per substep ("small steps" XPBD — one solver pass per substep, many
// substeps per frame, which converges far better than many passes per frame):
//   stretch   distance constraints along courses (x) and wales (y), with the
//             fabric's own 2-D modulus, plus a hard strain limit (a knit
//             jams: it stops extending once the loops close up)
//   shear     the two diagonals, much softer (knits shear easily)
//   bending   a linear second-difference constraint per row and column,
//             compliance h²/B with B the real bending rigidity — so a 160
//             GSM jersey folds tight and soft, a 400 GSM fleece wide and full
//   table     a floor at z = 0 (mid-surface), with friction
//   self      point–triangle contact between layers, one fabric thickness
//             apart, with the fabric's own layer-on-layer friction
//   pins      grabbed / clamped particles follow a target
//
// The solver sleeps once the cloth settles and costs nothing until woken.

const G = 9.81;

export class ClothSim {
  /**
   * @param {object} o
   *   nx, ny   grid size;  h  spacing (scene units);  unit  scene units per metre
   *   init     Float32Array nx*ny*3 — starting positions
   *   flat     Float32Array nx*ny*3 — the flat layout (rest shape, z = 0)
   *   mech     fabricMechanics(...)
   *   substeps per 1/60 s frame
   */
  constructor(o) {
    const { nx, ny } = o;
    const n = nx * ny;
    Object.assign(this, { nx, ny, n, h: o.h, unit: o.unit, mech: o.mech });
    this.substeps = o.substeps || 10;
    this.x = Float32Array.from(o.init);
    this.init = Float32Array.from(o.init);
    this.flat = Float32Array.from(o.flat);
    this.prev = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.ref = new Float32Array(n * 3);           // frame-start positions (collision sides)
    const hM = o.h / o.unit;
    this.mass = o.mech.massPerArea * hM * hM;
    this.w = new Float32Array(n).fill(1 / this.mass);
    this.g = G * o.unit;
    this.thick = Math.max(o.mech.thicknessM * o.unit, o.h * 0.08);
    this.muTable = o.mech.frictionTable;
    this.muSelf = o.mech.frictionSelf;
    this.limX = 0.03;                              // strain limits in normal handling
    this.limY = 0.03;
    this._buildConstraints(hM);
    this.groups = [];                              // pinned groups
    this.asleep = true;
    this._still = 0;
    this._pairs = new Int32Array(0);
    this._pairCount = 0;
  }

  _buildConstraints(hM) {
    const { nx, ny, h, mech } = this;
    const I = (i, j) => j * nx + i;
    const di = [], dj = [], dl = [], da = [], dk = [];
    const add = (a, b, L, compliance, kind) => { di.push(a); dj.push(b); dl.push(L); da.push(compliance); dk.push(kind); };
    // Solved family by family (all course links, all wale links, then the
    // crossing shear diagonals). Interleaving them quad by quad makes the
    // Gauss-Seidel pass over-correct some modes, flipping their sign every
    // pass; carried through the integrator's momentum, that oscillation
    // grows without bound on a large grid (a cloth in free fall blew up
    // within four frames).
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx - 1; i++) add(I(i, j), I(i + 1, j), h, 1 / mech.E2Dx, 0);
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++) add(I(i, j), I(i, j + 1), h, 1 / mech.E2Dy, 1);
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        add(I(i, j), I(i + 1, j + 1), h * Math.SQRT2, 1 / mech.G2D, 2);
        add(I(i + 1, j), I(i, j + 1), h * Math.SQRT2, 1 / mech.G2D, 2);
      }
    }
    this.dI = Int32Array.from(di); this.dJ = Int32Array.from(dj);
    this.dL = Float32Array.from(dl); this.dL0 = Float32Array.from(dl);
    this.dA = Float32Array.from(da); this.dK = Uint8Array.from(dk);

    const ba = [], bb = [], bc = [];
    for (let j = 0; j < ny; j++) for (let i = 1; i < nx - 1; i++) { ba.push(I(i - 1, j)); bb.push(I(i, j)); bc.push(I(i + 1, j)); }
    for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx; i++) { ba.push(I(i, j - 1)); bb.push(I(i, j)); bc.push(I(i, j + 1)); }
    this.bA = Int32Array.from(ba); this.bB = Int32Array.from(bb); this.bC = Int32Array.from(bc);
    // E = (B/2h²)|Δ²|² per strip  →  stiffness B/h², compliance h²/B (SI h)
    this.bAlpha = (hM * hM) / Math.max(1e-12, mech.B);
    // Rest curvature = the curvature of the starting pose. A cloth that
    // starts with a rounded fold keeps it when it is woken and handled — a
    // crease is memory in the cloth, not just a shape it was placed in. With
    // a flat rest every bend relaxed to zero on the first touch and the
    // fold simply unrolled.
    const init = this.init, nb = ba.length;
    this.bR = new Float32Array(nb * 3);
    for (let c = 0; c < nb; c++) {
      for (let k = 0; k < 3; k++) {
        this.bR[c * 3 + k] = init[ba[c] * 3 + k] - 2 * init[bb[c] * 3 + k] + init[bc[c] * 3 + k];
      }
    }
  }

  // ── State ───────────────────────────────────────────────────────────────
  wake() { this.asleep = false; this._still = 0; }

  reset(positions) {
    this.x.set(positions || this.init);
    this.v.fill(0);
    this.dL.set(this.dL0);
    this.limX = this.limY = 0.03;
    this.muTable = this.mech.frictionTable;
    this.groups = [];
    this.w.fill(1 / this.mass);
    this.asleep = true;
  }

  /**
   * Pin a set of particles so they follow `target + offset_i`. With `lraFrom`
   * (a particle index), every other particle also gets a long-range
   * attachment: it may be no farther from that point than its rest distance
   * allows (Kim et al. 2012). A cloth hung from one pinch otherwise stretches
   * far too much next to the pinch — the solver can't pass the whole weight
   * through one chain of links in a few passes.
   */
  pin(indices, origin, lraFrom) {
    const offs = new Float32Array(indices.length * 3);
    indices.forEach((p, k) => {
      offs[k * 3] = this.x[p * 3] - origin[0];
      offs[k * 3 + 1] = this.x[p * 3 + 1] - origin[1];
      offs[k * 3 + 2] = this.x[p * 3 + 2] - origin[2];
    });
    const g = { idx: Int32Array.from(indices), offs, target: [...origin], goal: [...origin] };
    if (lraFrom != null) {
      const f = this.flat, o0 = lraFrom * 3;
      const rest = new Float32Array(this.n);
      for (let p = 0; p < this.n; p++) {
        rest[p] = Math.hypot(f[p * 3] - f[o0], f[p * 3 + 1] - f[o0 + 1]);
      }
      g.lra = { from: lraFrom, rest };
    }
    for (const p of indices) this.w[p] = 0;
    this.groups.push(g);
    this.wake();
    return g;
  }

  _solveAttachments() {
    const { x, w, n } = this;
    const lim = 1 + Math.max(this.limX, this.limY);
    for (const g of this.groups) {
      if (!g.lra) continue;
      const o0 = g.lra.from * 3, rest = g.lra.rest;
      const ax = x[o0], ay = x[o0 + 1], az = x[o0 + 2];
      for (let p = 0; p < n; p++) {
        if (w[p] === 0) continue;
        const o = p * 3;
        const dx = x[o] - ax, dy = x[o + 1] - ay, dz = x[o + 2] - az;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const max = rest[p] * lim;
        if (d <= max || d < 1e-9) continue;
        const k = max / d;
        x[o] = ax + dx * k; x[o + 1] = ay + dy * k; x[o + 2] = az + dz * k;
      }
    }
  }

  unpin(g) {
    this.groups = this.groups.filter((x) => x !== g);
    for (const p of g.idx) {
      if (!this.groups.some((o) => o.idx.includes(p))) this.w[p] = 1 / this.mass;
    }
    this.wake();
  }

  // ── Step ────────────────────────────────────────────────────────────────
  /** Advance one 1/60 s frame. Returns false once asleep. */
  step() {
    if (this.asleep) return false;
    const dt = 1 / 60 / this.substeps;
    this._broadPhase();
    for (const g of this.groups) {
      // move the pinned group toward its goal, at most ~1.5 cm per frame
      const dx = g.goal[0] - g.target[0], dy = g.goal[1] - g.target[1], dz = g.goal[2] - g.target[2];
      const d = Math.hypot(dx, dy, dz), max = 0.015 * this.unit;
      const k = d > max ? max / d : 1;
      g.from = [...g.target];
      g.target = [g.target[0] + dx * k, g.target[1] + dy * k, g.target[2] + dz * k];
    }
    for (let s = 0; s < this.substeps; s++) this._substep(dt, (s + 1) / this.substeps);

    // sleep once everything has been still for a while
    let vmax = 0;
    for (let i = 0; i < this.n * 3; i++) vmax = Math.max(vmax, Math.abs(this.v[i]));
    const moving = this.groups.some((g) => g.goal[0] !== g.target[0] || g.goal[1] !== g.target[1] || g.goal[2] !== g.target[2]);
    this._still = vmax < 0.004 * this.unit && !moving ? this._still + 1 : 0;
    if (this._still > 45 && !this.groups.some((g) => g.held)) { this.asleep = true; this.v.fill(0); }
    return true;
  }

  _substep(dt, frac) {
    const { n, x, prev, v, w } = this;
    const damp = 1 - 0.9 * dt;                     // light air drag
    for (let p = 0; p < n; p++) {
      const o = p * 3;
      prev[o] = x[o]; prev[o + 1] = x[o + 1]; prev[o + 2] = x[o + 2];
      if (w[p] === 0) continue;
      v[o + 2] -= this.g * dt;
      v[o] *= damp; v[o + 1] *= damp; v[o + 2] *= damp;
      x[o] += v[o] * dt; x[o + 1] += v[o + 1] * dt; x[o + 2] += v[o + 2] * dt;
    }
    // pinned groups: interpolate this frame's target move across substeps
    for (const g of this.groups) {
      const t = g.from
        ? [g.from[0] + (g.target[0] - g.from[0]) * frac, g.from[1] + (g.target[1] - g.from[1]) * frac, g.from[2] + (g.target[2] - g.from[2]) * frac]
        : g.target;
      for (let k = 0; k < g.idx.length; k++) {
        const o = g.idx[k] * 3;
        x[o] = t[0] + g.offs[k * 3]; x[o + 1] = t[1] + g.offs[k * 3 + 1]; x[o + 2] = t[2] + g.offs[k * 3 + 2];
      }
    }
    const dt2 = dt * dt;
    this._solveDistance(dt2);
    this._solveBending(dt2);
    this._solveAttachments();
    this._solveSelf();
    this._solveTable();
    const inv = 1 / dt;
    for (let i = 0; i < n * 3; i++) v[i] = (x[i] - prev[i]) * inv;
    // Cap speed at ~2.5 m/s (a dropped cloth, hard flick): keeps per-frame
    // travel within the collision reach above.
    const vcap = 2.5 * this.unit;
    for (let p = 0; p < n; p++) {
      const o = p * 3;
      const s2 = v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2];
      if (s2 > vcap * vcap) { const k = vcap / Math.sqrt(s2); v[o] *= k; v[o + 1] *= k; v[o + 2] *= k; }
    }
    this._frictionTable();
  }

  // Stretch + shear, with the strain limit folded into the same pass: a knit
  // stops extending once its loops jam, so the corrected length is capped
  // per direction (the cap is raised during the stretch test).
  _solveDistance(dt2) {
    const { x, w, dI, dJ, dL, dA, dK } = this;
    const inv = 1 / dt2;
    const cap = [1 + this.limX, 1 + this.limY, 1 + Math.max(this.limX, this.limY) + 0.2];
    for (let c = 0; c < dI.length; c++) {
      const a = dI[c], b = dJ[c];
      const wa = w[a], wb = w[b], ws = wa + wb;
      if (ws === 0) continue;
      const oa = a * 3, ob = b * 3;
      const ex = x[ob] - x[oa], ey = x[ob + 1] - x[oa + 1], ez = x[ob + 2] - x[oa + 2];
      const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (len < 1e-9) continue;
      const L = dL[c];
      let dl = -(len - L) / (ws + dA[c] * inv);
      const max = L * cap[dK[c]];
      if (len + ws * dl > max) dl = (max - len) / ws;
      const k = dl / len;
      x[oa] -= wa * k * ex; x[oa + 1] -= wa * k * ey; x[oa + 2] -= wa * k * ez;
      x[ob] += wb * k * ex; x[ob + 1] += wb * k * ey; x[ob + 2] += wb * k * ez;
    }
  }

  _solveBending(dt2) {
    const { x, w, bA, bB, bC, bR } = this;
    const at = this.bAlpha / dt2;
    for (let c = 0; c < bA.length; c++) {
      const a = bA[c], b = bB[c], d = bC[c];
      const wa = w[a], wb = w[b], wd = w[d];
      const den = wa + 4 * wb + wd + at;
      if (wa + wb + wd === 0) continue;
      const oa = a * 3, ob = b * 3, od = d * 3;
      for (let k = 0; k < 3; k++) {
        const C = x[oa + k] - 2 * x[ob + k] + x[od + k] - bR[c * 3 + k];
        const l = -C / den;
        x[oa + k] += wa * l; x[ob + k] -= 2 * wb * l; x[od + k] += wd * l;
      }
    }
  }

  _solveTable() {
    const { x, n, w } = this;
    for (let p = 0; p < n; p++) {
      if (w[p] === 0) continue;
      if (x[p * 3 + 2] < 0) x[p * 3 + 2] = 0;
    }
  }

  // Coulomb-ish friction on the table: particles resting on it lose most of
  // their sliding velocity each substep in proportion to the coefficient.
  _frictionTable() {
    const { x, v, n } = this;
    const k = Math.min(1, this.muTable * 0.35);
    for (let p = 0; p < n; p++) {
      const o = p * 3;
      if (x[o + 2] > this.thick * 0.05) continue;
      if (v[o + 2] < 0) v[o + 2] = 0;
      v[o] *= 1 - k; v[o + 1] *= 1 - k;
    }
  }

  // ── Self-collision ──────────────────────────────────────────────────────
  // Broad phase once per frame: for each particle, triangles of OTHER parts of
  // the sheet (more than two grid steps away) that sit near it. Narrow phase
  // per substep: keep the particle one fabric thickness from each, on the
  // side it started the frame on.
  _broadPhase() {
    const { nx, ny, n, x, h } = this;
    this.ref.set(x);
    // A point resting on another layer is at most ~0.7 h from that layer's
    // nearest particle (half a cell diagonal), plus one fabric thickness —
    // plus however far anything can travel this frame. Candidates are only
    // gathered once per frame, so without that margin a dropped flap moving
    // faster than the reach per frame was never paired with the layer below
    // and passed straight through it.
    let vmax = 0;
    for (let i = 0; i < n * 3; i++) { const a = Math.abs(this.v[i]); if (a > vmax) vmax = a; }
    const reach = h * 0.8 + this.thick + Math.min(h * 3, vmax / 60 * 1.2);
    const cell = reach;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let p = 0; p < n; p++) {
      const o = p * 3;
      if (x[o] < minX) minX = x[o]; if (x[o] > maxX) maxX = x[o];
      if (x[o + 1] < minY) minY = x[o + 1]; if (x[o + 1] > maxY) maxY = x[o + 1];
      if (x[o + 2] < minZ) minZ = x[o + 2]; if (x[o + 2] > maxZ) maxZ = x[o + 2];
    }
    const gx = Math.floor((maxX - minX) / cell) + 1, gy = Math.floor((maxY - minY) / cell) + 1, gz = Math.floor((maxZ - minZ) / cell) + 1;
    if (gx * gy * gz > 4e6) { this._pairCount = 0; return; }
    const cellOf = (o) => (Math.floor((x[o + 2] - minZ) / cell) * gy + Math.floor((x[o + 1] - minY) / cell)) * gx + Math.floor((x[o] - minX) / cell);
    const starts = new Int32Array(gx * gy * gz + 1);
    const cid = new Int32Array(n);
    for (let p = 0; p < n; p++) { cid[p] = cellOf(p * 3); starts[cid[p] + 1]++; }
    for (let c = 0; c < gx * gy * gz; c++) starts[c + 1] += starts[c];
    const cursor = starts.slice(0, gx * gy * gz);
    const sorted = new Int32Array(n);
    for (let p = 0; p < n; p++) sorted[cursor[cid[p]]++] = p;

    let pairs = this._pairs.length ? this._pairs : new Int32Array(1 << 14);
    let count = 0;
    const r2 = reach * reach;
    for (let p = 0; p < n; p++) {
      const o = p * 3;
      const ip = p % nx, jp = (p / nx) | 0;
      const cx = Math.floor((x[o] - minX) / cell), cy = Math.floor((x[o + 1] - minY) / cell), cz = Math.floor((x[o + 2] - minZ) / cell);
      // the nearest particle of ANOTHER part of the sheet
      let best = -1, bestD = r2;
      for (let k = Math.max(0, cz - 1); k <= Math.min(gz - 1, cz + 1); k++) {
        for (let j = Math.max(0, cy - 1); j <= Math.min(gy - 1, cy + 1); j++) {
          const row = (k * gy + j) * gx;
          const s0 = starts[row + Math.max(0, cx - 1)], s1 = starts[row + Math.min(gx - 1, cx + 1) + 1];
          for (let s = s0; s < s1; s++) {
            const q = sorted[s];
            const iq = q % nx, jq = (q / nx) | 0;
            if (Math.abs(iq - ip) <= 2 && Math.abs(jq - jp) <= 2) continue;
            const oq = q * 3;
            const dx = x[oq] - x[o], dy = x[oq + 1] - x[o + 1], dz = x[oq + 2] - x[o + 2];
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bestD) { bestD = d; best = q; }
          }
        }
      }
      if (best < 0) continue;
      // the (up to 8) triangles round it: the point's projection lands in one
      const iq = best % nx, jq = (best / nx) | 0;
      for (let qj = jq - 1; qj <= jq; qj++) {
        for (let qi = iq - 1; qi <= iq; qi++) {
          if (qi < 0 || qj < 0 || qi >= nx - 1 || qj >= ny - 1) continue;
          if (qi >= ip - 2 && qi <= ip + 1 && qj >= jp - 2 && qj <= jp + 1) continue;
          for (let t = 0; t < 2; t++) {
            if (count * 2 + 2 > pairs.length) { const g = new Int32Array(pairs.length * 2); g.set(pairs); pairs = g; }
            pairs[count * 2] = p; pairs[count * 2 + 1] = (qj * (nx - 1) + qi) * 2 + t; count++;
          }
        }
      }
    }
    this._pairs = pairs;
    this._pairCount = count;
  }

  _tri(tri) {
    const nx = this.nx;
    const quad = tri >> 1, qi = quad % (nx - 1), qj = (quad / (nx - 1)) | 0;
    const a = qj * nx + qi, b = a + 1, c = a + nx, d = c + 1;
    return (tri & 1) === 0 ? [a, b, c] : [b, d, c];
  }

  _solveSelf() {
    const { x, w, ref, thick } = this;
    const pairs = this._pairs, count = this._pairCount;
    const mu = this.muSelf;
    const band = Math.max(thick * 3, (2.5 * this.unit) / (60 * this.substeps) * 1.3);
    for (let k = 0; k < count; k++) {
      const p = pairs[k * 2];
      const [a, b, c] = this._tri(pairs[k * 2 + 1]);
      const op = p * 3, oa = a * 3, ob = b * 3, oc = c * 3;
      // triangle frame now
      const e1x = x[ob] - x[oa], e1y = x[ob + 1] - x[oa + 1], e1z = x[ob + 2] - x[oa + 2];
      const e2x = x[oc] - x[oa], e2y = x[oc + 1] - x[oa + 1], e2z = x[oc + 2] - x[oa + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < 1e-12) continue;
      nx /= nl; ny /= nl; nz /= nl;
      const px = x[op] - x[oa], py = x[op + 1] - x[oa + 1], pz = x[op + 2] - x[oa + 2];
      const dist = px * nx + py * ny + pz * nz;
      // wider than the farthest a point can move in one substep (speed cap),
      // so a crossing is always caught
      if (Math.abs(dist) > band) continue;
      // projection inside the triangle? (barycentric)
      const qx = px - dist * nx, qy = py - dist * ny, qz = pz - dist * nz;
      const d00 = e1x * e1x + e1y * e1y + e1z * e1z, d01 = e1x * e2x + e1y * e2y + e1z * e2z, d11 = e2x * e2x + e2y * e2y + e2z * e2z;
      const d20 = qx * e1x + qy * e1y + qz * e1z, d21 = qx * e2x + qy * e2y + qz * e2z;
      const den = d00 * d11 - d01 * d01;
      if (Math.abs(den) < 1e-18) continue;
      const bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den, bu = 1 - bv - bw;
      if (bu < -0.02 || bv < -0.02 || bw < -0.02) continue;
      // which side was the particle on at the start of the frame?
      const rpx = ref[op] - (ref[oa] * bu + ref[ob] * bv + ref[oc] * bw);
      const rpy = ref[op + 1] - (ref[oa + 1] * bu + ref[ob + 1] * bv + ref[oc + 1] * bw);
      const rpz = ref[op + 2] - (ref[oa + 2] * bu + ref[ob + 2] * bv + ref[oc + 2] * bw);
      const side = rpx * nx + rpy * ny + rpz * nz >= 0 ? 1 : -1;
      const sd = dist * side;
      if (sd >= thick) continue;
      const wp = w[p], wa = w[a], wb = w[b], wc = w[c];
      const wsum = wp + wa * bu * bu + wb * bv * bv + wc * bw * bw;
      if (wsum === 0) continue;
      const l = (thick - sd) / wsum;
      const sx = nx * side, sy = ny * side, sz = nz * side;
      x[op] += wp * l * sx; x[op + 1] += wp * l * sy; x[op + 2] += wp * l * sz;
      x[oa] -= wa * bu * l * sx; x[oa + 1] -= wa * bu * l * sy; x[oa + 2] -= wa * bu * l * sz;
      x[ob] -= wb * bv * l * sx; x[ob + 1] -= wb * bv * l * sy; x[ob + 2] -= wb * bv * l * sz;
      x[oc] -= wc * bw * l * sx; x[oc + 1] -= wc * bw * l * sy; x[oc + 2] -= wc * bw * l * sz;
      // friction: cancel part of the particle's sliding relative to the
      // layer it rests on (a brushed back grips, a silicone finish slips)
      if (wp > 0) {
        const pr = this.prev;
        const mx = (x[op] - pr[op]) - ((x[oa] - pr[oa]) * bu + (x[ob] - pr[ob]) * bv + (x[oc] - pr[oc]) * bw);
        const my = (x[op + 1] - pr[op + 1]) - ((x[oa + 1] - pr[oa + 1]) * bu + (x[ob + 1] - pr[ob + 1]) * bv + (x[oc + 1] - pr[oc + 1]) * bw);
        const mz = (x[op + 2] - pr[op + 2]) - ((x[oa + 2] - pr[oa + 2]) * bu + (x[ob + 2] - pr[ob + 2]) * bv + (x[oc + 2] - pr[oc + 2]) * bw);
        const mn = mx * sx + my * sy + mz * sz;
        const f = Math.min(1, mu * 0.5);
        x[op] -= (mx - mn * sx) * f; x[op + 1] -= (my - mn * sy) * f; x[op + 2] -= (mz - mn * sz) * f;
      }
    }
  }
}
