/**
 * KnitAdvisor — cloth simulation for the garment studio (no three.js in here: plain numbers, so it runs in a test too)
 * ===================================================================
 * The pattern pieces are meshed into triangles (a Delaunay triangulation of points along the outline and a staggered grid inside), each triangle edge is a spring
 * of the piece's own flat length, the seams are pairs of edge points held together, and the cloth falls under gravity on a body made of ellipses and capsules.
 * It is position-based dynamics: move the points, then pull each constraint back, a few times, every step.
 *
 *   mesh      a piece's outline (cm, with the seam label of each edge) -> points + triangles
 *   body      a signed distance (positive outside) from a mannequin built from the garment's own measures plus an ease
 *   cloth     points start where the garment's form puts them (already sewn: the seams are the pairs of edge points that start together), then drape
 *
 * What it is: a drape of the pattern as drafted, with the ease the chart gives, on a mannequin of the same measures: folds, hang, how loose or close it sits.
 * What it is not: a body of YOUR customer, a cloth with measured bending or stretch (three soft / medium / stiff settings), layers that slide (no self-collision).
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;

  // ── a Delaunay triangulation (Bowyer–Watson); n up to a few thousand ──
  function delaunay(P) {
    const n = P.length; let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    P.forEach(([x, y]) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; });
    const dm = Math.max(x1 - x0, y1 - y0, 1) * 20, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const V = P.concat([[mx - dm, my - dm], [mx, my + dm], [mx + dm, my - dm]]);
    const mk = (a, b, c) => {
      const ax = V[a][0], ay = V[a][1], bx = V[b][0], by = V[b][1], cx = V[c][0], cy = V[c][1], d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-12;
      const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d, uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
      return { a, b, c, ux, uy, r2: (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy) };
    };
    let T = [mk(n, n + 1, n + 2)];
    for (let i = 0; i < n; i++) {
      const px = V[i][0], py = V[i][1], keep = [], edges = new Map();
      for (const t of T) {
        const dx = px - t.ux, dy = py - t.uy;
        if (dx * dx + dy * dy < t.r2 - 1e-9) { [[t.a, t.b], [t.b, t.c], [t.c, t.a]].forEach(([a, b]) => { const k = a < b ? a * 65536 + b : b * 65536 + a; const e = edges.get(k); if (e) e.n++; else edges.set(k, { a, b, n: 1 }); }); }
        else keep.push(t);
      }
      edges.forEach((e) => { if (e.n === 1) keep.push(mk(e.a, e.b, i)); });
      T = keep;
    }
    return T.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
  }
  function inside(poly, x, y) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }

  // ── a piece into points and triangles; the first `nb` points are the outline, each with the label of its edge ──
  function meshPiece(poly, labels, h) {
    const n = poly.length, cum = [0];
    for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = cum[n];
    // the corners stay; between them the outline is sampled every h
    const turn = (i) => { const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n]; const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]], l = Math.hypot(...v1) * Math.hypot(...v2) || 1; return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / l))); };
    const corners = []; for (let i = 0; i < n; i++) if (turn(i) > 0.55 || labels[i] !== labels[(i + n - 1) % n]) corners.push(i);
    if (!corners.length) corners.push(0);
    const at = (s) => { s = ((s % total) + total) % total; let i = 0; while (i < n - 1 && cum[i + 1] <= s) i++; const a = poly[i], b = poly[(i + 1) % n], t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1); return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], l: labels[i] }; };
    const B = [], BL = [];
    for (let k = 0; k < corners.length; k++) {
      const s0 = cum[corners[k]], s1 = k + 1 < corners.length ? cum[corners[k + 1]] : cum[corners[0]] + total, m = Math.max(1, Math.round((s1 - s0) / h));
      for (let j = 0; j < m; j++) { const q = at(s0 + ((s1 - s0) * j) / m + 1e-6); B.push(q.p); BL.push(q.l); }
    }
    let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18; poly.forEach(([x, y]) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; });
    const I = [], dh = h * 0.866;
    let row = 0;
    for (let y = y0 + dh * 0.5; y < y1; y += dh, row++) for (let x = x0 + (row % 2 ? h * 0.5 : 0) + h * 0.25; x < x1; x += h) {
      if (!inside(poly, x, y)) continue;
      let dmin = 1e18; for (let k = 0; k < B.length; k++) { const d = (B[k][0] - x) * (B[k][0] - x) + (B[k][1] - y) * (B[k][1] - y); if (d < dmin) dmin = d; }
      if (dmin > 0.36 * h * h) I.push([x, y]);
    }
    const pts = B.concat(I);
    const tris = delaunay(pts).filter(([a, b, c]) => { const cx = (pts[a][0] + pts[b][0] + pts[c][0]) / 3, cy = (pts[a][1] + pts[b][1] + pts[c][1]) / 3; const ar = Math.abs((pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1])) / 2; return ar > 1e-6 && inside(poly, cx, cy); });
    return { pts, tris, nb: B.length, blabels: BL };
  }
  const meshArea = (m) => m.tris.reduce((s, [a, b, c]) => s + Math.abs((m.pts[b][0] - m.pts[a][0]) * (m.pts[c][1] - m.pts[a][1]) - (m.pts[c][0] - m.pts[a][0]) * (m.pts[b][1] - m.pts[a][1])) / 2, 0);

  // ── the mannequin: a signed distance, positive outside ──
  const lerpKeys = (keys, y) => {                                              // keys descend in y: [y, a, b]
    if (y >= keys[0][0]) return [keys[0][1], keys[0][2]];
    for (let i = 1; i < keys.length; i++) if (y >= keys[i][0]) { const t = (keys[i - 1][0] - y) / (keys[i - 1][0] - keys[i][0] || 1); return [keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * t, keys[i - 1][2] + (keys[i][2] - keys[i - 1][2]) * t]; }
    const k = keys[keys.length - 1]; return [k[1], k[2]];
  };
  const ellipseDist = (x, z, a, b) => { const f = Math.sqrt((x / a) * (x / a) + (z / b) * (z / b)); const g = Math.sqrt((x / (a * a)) * (x / (a * a)) + (z / (b * b)) * (z / (b * b))) / (f || 1); return (f - 1) / (g || 1); };
  // the torso as a stack of ellipses: its distance uses the whole gradient (the narrowing of the shoulders counts), so under the top of the shoulder the way out is up
  const stackF = (keys, x, y, z) => { const [a, b] = lerpKeys(keys, y); return Math.sqrt((x / a) * (x / a) + (z / b) * (z / b)); };
  const torsoDist = (keys, x, y, z) => {
    const f = stackF(keys, x, y, z), e = 0.2, gx = (stackF(keys, x + e, y, z) - stackF(keys, x - e, y, z)) / (2 * e), gy = (stackF(keys, x, y + e, z) - stackF(keys, x, y - e, z)) / (2 * e), gz = (stackF(keys, x, y, z + e) - stackF(keys, x, y, z - e)) / (2 * e);
    return (f - 1) / (Math.hypot(gx, gy, gz) || 1);
  };
  const capsule = (x, y, z, A, B, ra, rb) => {                                 // a tapered capsule from A to B
    const bx = B[0] - A[0], by = B[1] - A[1], bz = B[2] - A[2], l2 = bx * bx + by * by + bz * bz || 1;
    let t = ((x - A[0]) * bx + (y - A[1]) * by + (z - A[2]) * bz) / l2; t = Math.max(0, Math.min(1, t));
    const px = A[0] + bx * t, py = A[1] + by * t, pz = A[2] + bz * t;
    return Math.hypot(x - px, y - py, z - pz) - (ra + (rb - ra) * t);
  };
  const ellK = (k) => Math.PI * (3 * (1 + k) - Math.sqrt((3 + k) * (1 + 3 * k)));       // the perimeter of an ellipse of long semi-axis 1 and short k
  // a top: a torso that is the garment's chest less its ease, shoulders, a neck and a head, arms along the sleeve axis
  function bodyTee(size, opt) {
    opt = opt || {};
    const m = size.m, d = size.derived || {}, L = m.length, ease = opt.ease != null ? opt.ease : (size.pieces && size.pieces.some((p) => p.id === 'hemband') ? 14 : 8);
    const k = 0.64, ac = (2 * m.chest - ease) / ellK(k), bc = k * ac, sw = Math.max(ac * 0.8, m.shoulder / 2 - 0.5), an = Math.max(3, Math.min(5, (d.neck_len || 44) / TAU * 0.62)), yu = L - (d.underarm_y || L * 0.36);
    const keys = [[L + 10, an, an], [L - 0.8, an * 1.04, an], [L - (m.slope || 2.5) - 3.2, sw, 0.3 * ac], [yu + 3, ac * 0.97, bc * 0.94], [yu, ac, bc], [L * 0.5, ac * 0.9, bc * 0.86], [0, ac * 0.97, bc * 0.92], [-60, ac * 0.97, bc * 0.92]];
    const gam = 28 * Math.PI / 180, armL = (m.sleeve_l || 20) + (m.cuff_h || 0) + 16, r0 = Math.max(3, (2 * m.bicep - 4) / TAU), r1 = r0 * 0.66;
    const arms = [1, -1].map((s) => { const A = [s * (sw - 2.2), L - (m.slope || 2.5) - 3.2, 0]; return [A, [A[0] + s * Math.sin(gam) * armL, A[1] - Math.cos(gam) * armL, 0]]; });
    const head = [0, L + 14, 1.2], hr = 9.6;
    return {
      kind: 'tee', top: L + 24, parts: { loft: { keys, y0: -4, y1: L + 9 }, caps: arms.map(([A, B]) => ({ A, B, ra: r0, rb: r1 })), spheres: [{ c: head, r: hr }] }, sdf(x, y, z) {
        let best = 1e9;
        best = Math.min(best, torsoDist(keys, x, y, z));
        for (const [A, B] of arms) best = Math.min(best, capsule(x, y, z, A, B, r0, r1));
        best = Math.min(best, Math.hypot(x - head[0], y - head[1], z - head[2]) - hr);
        return best;
      },
    };
  }
  // a bottom: a waist and a seat that are the garment's less their ease, two legs tapering to the leg opening
  function bodyLegs(size, opt) {
    opt = opt || {};
    const m = size.m, d = size.derived || {}, top = m.outseam, F = m.waistband_h, yc = top - F - d.crotch_y, k = 0.66, ease = opt.ease != null ? opt.ease : 6;
    const aw = (2 * m.waist_stretched - ease) / ellK(k), as = (2 * m.seat_w - ease) / ellK(k), ys = top - F - (m.seat_pos - F);
    const rt = Math.max(3, (2 * m.thigh - ease) / TAU), ra = Math.max(2.5, (2 * m.leg_opening - 4) / TAU), cxl = rt + 0.4, bottom = 0 - 12;
    const keys = [[top + 14, aw * 0.96, aw * k * 0.92], [top - F * 0.5, aw, aw * k], [ys, as, as * k], [yc + 0.5, as * 0.98, as * k * 0.98]];
    return {
      kind: 'legs', top: top + 20, parts: { loft: { keys, y0: yc + 0.5, y1: top + 14 }, caps: [1, -1].map((s) => ({ A: [s * cxl, yc + 6, 0], B: [s * cxl * 0.96, 0, 0], ra: rt, rb: ra })).concat([1, -1].map((s) => ({ A: [s * cxl * 0.96, 0, 0], B: [s * cxl * 0.94, bottom, 0], ra, rb: ra * 0.8 }))), spheres: [] }, sdf(x, y, z) {
        let best = 1e9;
        if (y >= yc) best = torsoDist(keys, x, y, z);
        for (const s of [1, -1]) best = Math.min(best, capsule(x, y, z, [s * cxl, yc + 6, 0], [s * cxl * 0.96, 0, 0], rt, ra), capsule(x, y, z, [s * cxl * 0.96, 0, 0], [s * cxl * 0.94, bottom, 0], ra, ra * 0.8));
        return best;
      },
    };
  }

  // ── the cloth ──
  // instances: [{id, mesh, map(x, y) -> [X, Y, Z], rest: 'flat' | 'init', pin: (i) => bool, label: string}]
  class Cloth {
    constructor(instances, body, opt) {
      opt = opt || {};
      this.body = body; this.inst = instances; this.opt = Object.assign({ bend: 0.08, stretch: 0.96, gravity: 980, damp: 0.985, thick: 0.45, friction: 0.12, iters: 14, seamTol: 1.5, maxStrain: 0.02, limitPasses: 8 }, opt);
      let N = 0; instances.forEach((it) => { it.off = N; N += it.mesh.pts.length; });
      this.N = N; this.X = new Float32Array(3 * N); this.Q = new Float32Array(3 * N); this.pin = new Uint8Array(N); this.P0 = new Float32Array(3 * N);
      const es = [], er = [], bs = [], br = [], flatRest = (it, a, b) => Math.hypot(it.mesh.pts[a][0] - it.mesh.pts[b][0], it.mesh.pts[a][1] - it.mesh.pts[b][1]);
      instances.forEach((it) => {
        it.mesh.pts.forEach((p, i) => { const q = it.map(p[0], p[1]), o = 3 * (it.off + i); this.X[o] = this.Q[o] = this.P0[o] = q[0]; this.X[o + 1] = this.Q[o + 1] = this.P0[o + 1] = q[1]; this.X[o + 2] = this.Q[o + 2] = this.P0[o + 2] = q[2]; if (it.pin && it.pin(i, p)) this.pin[it.off + i] = 1; });
        const ed = new Map(), tri = it.mesh.tris;
        const dist3 = (a, b) => { const A = 3 * (it.off + a), B = 3 * (it.off + b); return Math.hypot(this.X[A] - this.X[B], this.X[A + 1] - this.X[B + 1], this.X[A + 2] - this.X[B + 2]); };
        tri.forEach((t, ti) => { [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(([a, b], k) => { const key = a < b ? a * 65536 + b : b * 65536 + a, e = ed.get(key); const opp = t[(k + 2) % 3]; if (e) e.o2 = opp; else ed.set(key, { a, b, o1: opp, o2: -1 }); }); });
        ed.forEach((e) => {
          es.push(it.off + e.a, it.off + e.b); er.push(it.rest === 'init' ? dist3(e.a, e.b) : flatRest(it, e.a, e.b));
          if (e.o2 >= 0) { bs.push(it.off + e.o1, it.off + e.o2); br.push(it.rest === 'init' ? dist3(e.o1, e.o2) : flatRest(it, e.o1, e.o2)); }
        });
      });
      this.es = Int32Array.from(es); this.er = Float32Array.from(er); this.bs = Int32Array.from(bs); this.br = Float32Array.from(br);
      this._seams();
      if (this.opt.pinSeams && this.opt.seamOf) instances.forEach((it) => { for (let i = 0; i < it.mesh.nb; i++) if (this.opt.pinSeams.indexOf(this.opt.seamOf[it.mesh.blabels[i]]) >= 0) this.pin[it.off + i] = 1; });
      instances.forEach((it) => { if (it.pinAll) for (let i = 0; i < it.mesh.pts.length; i++) this.pin[it.off + i] = 1; });
      this._surface(); this.t = 0; this.energy = 0;
    }
    // a form that starts partly inside the mannequin (a neckline is the usual place): take it out to the surface, once, before anything moves
    _surface() {
      const X = this.X, Q = this.Q, body = this.body, th = this.opt.thick + 0.2, e = 0.25;
      for (let i = 0; i < this.N; i++) {
        const a = 3 * i; if (this.pin[i]) continue;
        for (let k = 0; k < 8; k++) {
          const d = body.sdf(X[a], X[a + 1], X[a + 2]) - th; if (d >= 0) break;
          let nx = body.sdf(X[a] + e, X[a + 1], X[a + 2]) - body.sdf(X[a] - e, X[a + 1], X[a + 2]), ny = body.sdf(X[a], X[a + 1] + e, X[a + 2]) - body.sdf(X[a], X[a + 1] - e, X[a + 2]), nz = body.sdf(X[a], X[a + 1], X[a + 2] + e) - body.sdf(X[a], X[a + 1], X[a + 2] - e); const nl = Math.hypot(nx, ny, nz) || 1;
          X[a] -= (nx / nl) * d; X[a + 1] -= (ny / nl) * d; X[a + 2] -= (nz / nl) * d;
        }
        Q[a] = X[a]; Q[a + 1] = X[a + 1]; Q[a + 2] = X[a + 2];
      }
    }
    // the seams: boundary points of different pieces (or far apart on one piece) that start within seamTol of each other are held together
    _seams() {
      const tol = this.opt.seamTol, cell = tol, grid = new Map(), B = [];
      this.inst.forEach((it, ii) => { for (let i = 0; i < it.mesh.nb; i++) B.push({ g: it.off + i, ii, i }); });
      const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
      B.forEach((b) => { const o = 3 * b.g, k = key(this.X[o], this.X[o + 1], this.X[o + 2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); });
      const near = (b) => {
        const o = 3 * b.g, cx = Math.floor(this.X[o] / cell), cy = Math.floor(this.X[o + 1] / cell), cz = Math.floor(this.X[o + 2] / cell); let best = null, bd = tol * tol;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const arr = grid.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!arr) continue; for (const c of arr) {
          if (c.g === b.g) continue;
          if (this.opt.seamOf) { const la = this.inst[b.ii].mesh.blabels[b.i], lb = this.inst[c.ii].mesh.blabels[c.i], sa = this.opt.seamOf[la], sb = this.opt.seamOf[lb]; if (!sa || sa !== sb) continue; }                 // only edges that are the same seam are sewn together
          if (this.opt.groupSeams && this.opt.seamOf) { const sb = this.opt.seamOf[this.inst[b.ii].mesh.blabels[b.i]]; if (this.opt.groupSeams.indexOf(sb) >= 0 && this.inst[b.ii].grp !== this.inst[c.ii].grp) continue; }          // a leg's own seams join its own front and back, not the other leg
          if (c.ii === b.ii) { const it = this.inst[b.ii], p = it.mesh.pts[b.i], q = it.mesh.pts[c.i]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 4 * (this.opt.h || 2)) continue; if (this.opt.selfSeams && this.opt.seamOf && this.opt.selfSeams.indexOf(this.opt.seamOf[it.mesh.blabels[b.i]]) < 0) continue; }          // the same piece: only a seam that closes it on itself (a sleeve's underarm)
          const o2 = 3 * c.g, d = (this.X[o] - this.X[o2]) ** 2 + (this.X[o + 1] - this.X[o2 + 1]) ** 2 + (this.X[o + 2] - this.X[o2 + 2]) ** 2; if (d < bd) { bd = d; best = c; } } }
        return best;
      };
      const pairs = new Map(), nn = new Map();
      const prox = this.opt.proxSeams && this.opt.seamOf ? (b) => this.opt.proxSeams.indexOf(this.opt.seamOf[this.inst[b.ii].mesh.blabels[b.i]]) >= 0 : () => true;
      B.forEach((b) => { if (!prox(b)) return; const c = near(b); if (c && prox(c)) nn.set(b.g, c.g); });
      nn.forEach((g2, g1) => { const mutual = nn.get(g2) === g1, o1 = 3 * g1, o2 = 3 * g2, d = Math.hypot(this.X[o1] - this.X[o2], this.X[o1 + 1] - this.X[o2 + 1], this.X[o1 + 2] - this.X[o2 + 2]); if (mutual || d < tol * 0.5) { const a = Math.min(g1, g2), c = Math.max(g1, g2); pairs.set(a * 1048576 + c, [a, c]); } });
      (this.opt.sewing || []).forEach(([ra, rb]) => this._sewRuns(ra, rb, pairs));
      this.ss = Int32Array.from([].concat(...[...pairs.values()]));
    }
    // two runs of outline points, each an ordered list of [instance id, outline index], are sewn by their share of the way along: the point that is a third along one meets the one a third along the other
    _sewRuns(ra, rb, pairs) {
      const get = (run) => run.map(([id, i]) => { const ii = this.inst.findIndex((t) => t.id === id); return ii < 0 ? null : { g: this.inst[ii].off + i, p: this.inst[ii].mesh.pts[i] }; }).filter(Boolean);
      const A = get(ra), B = get(rb); if (A.length < 2 || B.length < 2) return;
      const cum = (R) => { const c = [0]; for (let k = 1; k < R.length; k++) c.push(c[k - 1] + Math.hypot(R[k].p[0] - R[k - 1].p[0], R[k].p[1] - R[k - 1].p[1])); return c; };
      const ca = cum(A), cb = cum(B), ta = ca[ca.length - 1] || 1, tb = cb[cb.length - 1] || 1;
      const pair = (X, cx, tx, Y, cy, ty) => X.forEach((q, k) => { const f = cx[k] / tx; let best = 0, bd = 1e9; for (let j = 0; j < Y.length; j++) { const d = Math.abs(cy[j] / ty - f); if (d < bd) { bd = d; best = j; } } const a = Math.min(q.g, Y[best].g), c = Math.max(q.g, Y[best].g); if (a !== c) pairs.set(a * 1048576 + c, [a, c]); });
      pair(A, ca, ta, B, cb, tb); pair(B, cb, tb, A, ca, ta);
    }
    step(dt) {
      dt = dt || 1 / 100; const o = this.opt, X = this.X, Q = this.Q, N = this.N, g = o.gravity * Math.min(1, 0.15 + this.t / 40), dd = o.damp;
      for (let i = 0; i < N; i++) {
        if (this.pin[i]) continue; const a = 3 * i;
        for (let c = 0; c < 3; c++) { const v = (X[a + c] - Q[a + c]) * dd; Q[a + c] = X[a + c]; X[a + c] += v + (c === 1 ? -g * dt * dt : 0); }
      }
      const ks = 1 - Math.pow(1 - o.stretch, 1 / o.iters), kb = 1 - Math.pow(1 - o.bend, 1 / o.iters);          // a stiffness that does not change with the number of passes
      for (let it = 0; it < o.iters; it++) {
        this._pull(this.es, this.er, ks); this._pull(this.bs, this.br, kb);
        this._seamPull(0.5);
        this._collide();
      }
      this._limit(this.es, this.er, o.maxStrain);          // cloth does not stretch like rubber: whatever is over the limit is pulled back at once
      this._collide();
      this.t++;
    }
    _pull(S, R, k) {
      const X = this.X, pin = this.pin;
      for (let e = 0, n = R.length; e < n; e++) {
        const a = S[2 * e], b = S[2 * e + 1], A = 3 * a, B = 3 * b, dx = X[B] - X[A], dy = X[B + 1] - X[A + 1], dz = X[B + 2] - X[A + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const wa = pin[a] ? 0 : 1, wb = pin[b] ? 0 : 1, w = wa + wb; if (!w) continue; const c = (k * (l - R[e])) / (l * w);
        X[A] += dx * c * wa; X[A + 1] += dy * c * wa; X[A + 2] += dz * c * wa; X[B] -= dx * c * wb; X[B + 1] -= dy * c * wb; X[B + 2] -= dz * c * wb;
      }
    }
    _limit(S, R, max) {
      const X = this.X, pin = this.pin;
      for (let pass = 0; pass < (this.opt.limitPasses || 8); pass++) for (let e = 0, n = R.length; e < n; e++) {
        const a = S[2 * e], b = S[2 * e + 1], A = 3 * a, B = 3 * b, dx = X[B] - X[A], dy = X[B + 1] - X[A + 1], dz = X[B + 2] - X[A + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9, lim = R[e] * (1 + max);
        if (l <= lim) continue; const wa = pin[a] ? 0 : 1, wb = pin[b] ? 0 : 1, w = wa + wb; if (!w) continue; const c = (l - lim) / (l * w);
        X[A] += dx * c * wa; X[A + 1] += dy * c * wa; X[A + 2] += dz * c * wa; X[B] -= dx * c * wb; X[B + 1] -= dy * c * wb; X[B + 2] -= dz * c * wb;
      }
    }
    _seamPull(k) {
      const X = this.X, S = this.ss, pin = this.pin;
      for (let e = 0, n = S.length / 2; e < n; e++) {
        const a = S[2 * e], b = S[2 * e + 1], A = 3 * a, B = 3 * b, wa = pin[a] ? 0 : 1, wb = pin[b] ? 0 : 1, w = wa + wb; if (!w) continue;
        const cx = (X[B] - X[A]) * k / w, cy = (X[B + 1] - X[A + 1]) * k / w, cz = (X[B + 2] - X[A + 2]) * k / w;
        X[A] += cx * wa; X[A + 1] += cy * wa; X[A + 2] += cz * wa; X[B] -= cx * wb; X[B + 1] -= cy * wb; X[B + 2] -= cz * wb;
      }
    }
    _collide() {
      const X = this.X, Q = this.Q, body = this.body, th = this.opt.thick, fr = this.opt.friction, eps = 0.25;
      for (let i = 0; i < this.N; i++) {
        if (this.pin[i]) continue; const a = 3 * i, x = X[a], y = X[a + 1], z = X[a + 2], d = body.sdf(x, y, z) - th;
        if (d >= 0) continue;
        let nx = body.sdf(x + eps, y, z) - body.sdf(x - eps, y, z), ny = body.sdf(x, y + eps, z) - body.sdf(x, y - eps, z), nz = body.sdf(x, y, z + eps) - body.sdf(x, y, z - eps); const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        X[a] -= nx * d; X[a + 1] -= ny * d; X[a + 2] -= nz * d;
        const vx = X[a] - Q[a], vy = X[a + 1] - Q[a + 1], vz = X[a + 2] - Q[a + 2], vn = vx * nx + vy * ny + vz * nz;           // friction: take away part of what slid along the body this step
        X[a] -= (vx - vn * nx) * fr; X[a + 1] -= (vy - vn * ny) * fr; X[a + 2] -= (vz - vn * nz) * fr;
      }
    }
    run(n) { for (let i = 0; i < n; i++) this.step(); }
    // how far the cloth is still moving (cm per step, the mean), the worst seam gap, the deepest point inside the body, the worst stretch
    stats() {
      const X = this.X, Q = this.Q; let mv = 0; for (let i = 0; i < this.N; i++) mv += Math.hypot(X[3 * i] - Q[3 * i], X[3 * i + 1] - Q[3 * i + 1], X[3 * i + 2] - Q[3 * i + 2]);
      let gap = 0; for (let e = 0; e < this.ss.length; e += 2) { const A = 3 * this.ss[e], B = 3 * this.ss[e + 1]; gap = Math.max(gap, Math.hypot(X[A] - X[B], X[A + 1] - X[B + 1], X[A + 2] - X[B + 2])); }
      let deep = 0; for (let i = 0; i < this.N; i++) deep = Math.min(deep, this.body.sdf(X[3 * i], X[3 * i + 1], X[3 * i + 2]));
      let strain = 0; for (let e = 0; e < this.er.length; e++) { const A = 3 * this.es[2 * e], B = 3 * this.es[2 * e + 1]; strain = Math.max(strain, Math.abs(Math.hypot(X[A] - X[B], X[A + 1] - X[B + 1], X[A + 2] - X[B + 2]) / (this.er[e] || 1) - 1)); }
      return { moving: mv / this.N, seam_gap: gap, inside_body: deep, max_strain: strain, seams: this.ss.length / 2, points: this.N };
    }
  }
  // the three settings of how the cloth bends
  const DRAPE = { soft: { bend: 0.02, stretch: 0.95 }, medium: { bend: 0.08, stretch: 0.96 }, stiff: { bend: 0.3, stretch: 0.97 } };

  const KASim = { delaunay, meshPiece, meshArea, bodyTee, bodyLegs, Cloth, DRAPE, ellK };
  root.KASim = KASim; if (typeof module !== 'undefined' && module.exports) module.exports = KASim;
})(typeof window !== 'undefined' ? window : globalThis);
