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
  // the mannequin as data: a stack of ellipses (the torso, from a height up or everywhere), tapered capsules (limbs), spheres (a head). Any body is a list of these.
  //   desc = { top, loft: { keys: [[y, a, b], ...] descending in y, from: y | null }, caps: [{ A, B, ra, rb }], spheres: [{ c, r }] }
  function avatar(desc) {
    const keys = desc.loft && desc.loft.keys, from = desc.loft ? desc.loft.from : null, caps = desc.caps || [], sph = desc.spheres || [];
    return { desc, top: desc.top, sdf(x, y, z) {
      let best = 1e9;
      if (keys && (from == null || y >= from)) best = torsoDist(keys, x, y, z);
      for (const c of caps) best = Math.min(best, capsule(x, y, z, c.A, c.B, c.ra, c.rb));
      for (const s of sph) best = Math.min(best, Math.hypot(x - s.c[0], y - s.c[1], z - s.c[2]) - s.r);
      return best;
    } };
  }
  // a top: a torso that is the garment's chest less its ease, shoulders, a neck and a head, arms along the sleeve axis
  function bodyTee(size, opt) {
    opt = opt || {};
    const m = size.m, d = size.derived || {}, L = m.length, ease = opt.ease != null ? opt.ease : (size.pieces && size.pieces.some((p) => p.id === 'hemband') ? 14 : 8);
    const k = 0.64, ac = (2 * m.chest - ease) / ellK(k), bc = k * ac, sw = Math.max(ac * 0.8, m.shoulder / 2 - 0.5), an = Math.max(3, Math.min(5, (d.neck_len || 44) / TAU * 0.62)), yu = L - (d.underarm_y || L * 0.36);
    const keys = [[L + 10, an, an], [L - 0.8, an * 1.04, an], [L - (m.slope || 2.5) - 3.2, sw, 0.3 * ac], [yu + 3, ac * 0.97, bc * 0.94], [yu, ac, bc], [L * 0.5, ac * 0.9, bc * 0.86], [0, ac * 0.97, bc * 0.92], [-60, ac * 0.97, bc * 0.92]];
    const gam = 28 * Math.PI / 180, armL = (m.sleeve_l || 20) + (m.cuff_h || 0) + 16, r0 = Math.max(3, (2 * m.bicep - 4) / TAU), r1 = r0 * 0.66;
    const arms = [1, -1].map((s) => { const A = [s * (sw - 2.2), L - (m.slope || 2.5) - 3.2, 0]; return [A, [A[0] + s * Math.sin(gam) * armL, A[1] - Math.cos(gam) * armL, 0]]; });
    const head = [0, L + 14, 1.2], hr = 9.6;
    const caps = arms.map(([A, B]) => ({ A, B, ra: r0, rb: r1 })), desc = { top: L + 24, loft: { keys, from: null }, caps, spheres: [{ c: head, r: hr }] };
    return Object.assign(avatar(desc), { kind: 'tee', parts: { loft: { keys, y0: -4, y1: L + 9 }, caps, spheres: desc.spheres } });
  }
  // a bottom: a waist and a seat that are the garment's less their ease, two legs tapering to the leg opening
  function bodyLegs(size, opt) {
    opt = opt || {};
    const m = size.m, d = size.derived || {}, top = m.outseam, F = m.waistband_h, yc = top - F - d.crotch_y, k = 0.66, ease = opt.ease != null ? opt.ease : 6;
    const aw = (2 * m.waist_stretched - ease) / ellK(k), as = (2 * m.seat_w - ease) / ellK(k), ys = top - F - (m.seat_pos - F);
    const rt = Math.max(3, (2 * m.thigh - ease) / TAU), ra = Math.max(2.5, (2 * m.leg_opening - 4) / TAU), cxl = rt + 0.4, bottom = 0 - 12;
    const keys = [[top + 14, aw * 0.96, aw * k * 0.92], [top - F * 0.5, aw, aw * k], [ys, as, as * k], [yc + 0.5, as * 0.98, as * k * 0.98]];
    const caps = [1, -1].map((s) => ({ A: [s * cxl, yc + 6, 0], B: [s * cxl * 0.96, 0, 0], ra: rt, rb: ra })).concat([1, -1].map((s) => ({ A: [s * cxl * 0.96, 0, 0], B: [s * cxl * 0.94, bottom, 0], ra, rb: ra * 0.8 }))), desc = { top: top + 20, loft: { keys, from: yc }, caps, spheres: [] };
    return Object.assign(avatar(desc), { kind: 'legs', geo: { top, F, yc, keys, cxl, rt, ra }, parts: { loft: { keys, y0: yc + 0.5, y1: top + 14 }, caps, spheres: [] } });
  }

  // ── fabrics: how far a cloth gives in each direction before it locks (a fraction of its length), and how stiff it bends. TYPICAL numbers by family, not measurements of a given fabric. ──
  //   x = across the knit (the courses / the weft), y = along it (the wales / the warp), bias = how much more it gives on the diagonal
  const FAMILIES = {
    jersey: { x: 0.35, y: 0.15, bias: 0.1, bend: 1 }, rib: { x: 0.8, y: 0.15, bias: 0.1, bend: 0.8 }, interlock: { x: 0.25, y: 0.12, bias: 0.08, bend: 1.2 }, fleece: { x: 0.2, y: 0.1, bias: 0.08, bend: 1.6 },
    woven: { x: 0.03, y: 0.02, bias: 0.2, bend: 1.4 }, stretch_woven: { x: 0.12, y: 0.04, bias: 0.2, bend: 1.3 }, denim: { x: 0.02, y: 0.015, bias: 0.15, bend: 2.2 }, elastic: { x: 1.0, y: 0.1, bias: 0.05, bend: 0.6 }, lycra: { x: 0.9, y: 0.5, bias: 0.1, bend: 0.5 },
  };
  const fabricParams = (fab, family) => { const f = FAMILIES[family || (fab && fab.family)]; if (!f) return null; const u = fab && fab.stretch; return { x: u && u.x > 0 ? u.x : f.x, y: u && u.y > 0 ? u.y : f.y, bias: f.bias, bend: f.bend }; };
  // what the weight of a cloth does to how it hangs: a heavier cloth is stiffer and a little thicker
  const physics = (fab) => { const g = (fab && +fab.gsm) || 0; if (!g) return null; return { bend: Math.max(0.01, Math.min(0.4, 0.02 * Math.pow(g / 140, 2.2))), stretch: g > 300 ? 0.97 : 0.955, thick: Math.max(0.3, Math.min(0.9, 0.25 + g / 600)), friction: (fab && fab.friction) || 0.12 }; };
  const fabEdge = (fab, dx, dy, base) => {                                  // the stiffness scale and the limit of one spring, from its direction in the flat piece
    if (!fab) return { k: 1, m: base };
    const l = Math.hypot(dx, dy) || 1, c = Math.abs(dx) / l, sn = Math.abs(dy) / l; let lim = 1 / Math.sqrt((c / fab.x) * (c / fab.x) + (sn / fab.y) * (sn / fab.y)); lim *= 1 + fab.bias * 4 * c * c * sn * sn;
    return { k: Math.max(0.1, Math.min(1, (base + 0.06) / (lim + 0.06))), m: Math.max(base, lim) };
  };
  const segX = (p, q, a, b) => { const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]); if (Math.abs(d) < 1e-9) return false; const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d, u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1; };

  // ── the cloth ──
  // instances: [{id, mesh, map(x, y) -> [X, Y, Z], rest: 'flat' | 'init', pin: (i) => bool, label: string}]
  class Cloth {
    constructor(instances, body, opt) {
      opt = opt || {};
      this.body = body; this.inst = instances; this.opt = Object.assign({ bend: 0.08, stretch: 0.96, gravity: 980, damp: 0.985, thick: 0.45, friction: 0.12, iters: 14, seamTol: 1.5, maxStrain: 0.02, limitPasses: 8 }, opt);
      let N = 0; instances.forEach((it) => { it.off = N; N += it.mesh.pts.length; });
      this.N = N; this.X = new Float32Array(3 * N); this.Q = new Float32Array(3 * N); this.pin = new Uint8Array(N); this.P0 = new Float32Array(3 * N);
      const es = [], er = [], ek = [], em = [], bs = [], br = [], bk = [], flatRest = (it, a, b) => Math.hypot(it.mesh.pts[a][0] - it.mesh.pts[b][0], it.mesh.pts[a][1] - it.mesh.pts[b][1]);
      instances.forEach((it) => {
        it.mesh.pts.forEach((p, i) => { const q = it.map(p[0], p[1]), o = 3 * (it.off + i); this.X[o] = this.Q[o] = this.P0[o] = q[0]; this.X[o + 1] = this.Q[o + 1] = this.P0[o + 1] = q[1]; this.X[o + 2] = this.Q[o + 2] = this.P0[o + 2] = q[2]; if (it.pin && it.pin(i, p)) this.pin[it.off + i] = 1; });
        const ed = new Map(), tri = it.mesh.tris;
        const dist3 = (a, b) => { const A = 3 * (it.off + a), B = 3 * (it.off + b); return Math.hypot(this.X[A] - this.X[B], this.X[A + 1] - this.X[B + 1], this.X[A + 2] - this.X[B + 2]); };
        tri.forEach((t, ti) => { [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(([a, b], k) => { const key = a < b ? a * 65536 + b : b * 65536 + a, e = ed.get(key); const opp = t[(k + 2) % 3]; if (e) e.o2 = opp; else ed.set(key, { a, b, o1: opp, o2: -1 }); }); });
        ed.forEach((e) => {
          es.push(it.off + e.a, it.off + e.b); er.push(it.rest === 'init' ? dist3(e.a, e.b) : flatRest(it, e.a, e.b));
          const pa = it.mesh.pts[e.a], pb = it.mesh.pts[e.b], fe = fabEdge(it.fab, pb[0] - pa[0], pb[1] - pa[1], this.opt.maxStrain); ek.push(fe.k); em.push(fe.m);
          if (e.o2 >= 0) {
            bs.push(it.off + e.o1, it.off + e.o2); let r = it.rest === 'init' ? dist3(e.o1, e.o2) : flatRest(it, e.o1, e.o2), kk = it.fab ? it.fab.bend : 1;
            (it.folds || []).forEach((fl) => { if (segX(pa, pb, fl.a, fl.b)) { r *= fl.f; kk *= 3; } });                        // a crease: the two sides are held folded
            if (it.stiffV && (it.stiffV.has(e.a) || it.stiffV.has(e.b))) kk *= 3;                                                // a topstitched edge is stiffer
            br.push(r); bk.push(kk);
          }
        });
      });
      this.es = Int32Array.from(es); this.er = Float32Array.from(er); this.bs = Int32Array.from(bs); this.br = Float32Array.from(br); this.ek = Float32Array.from(ek); this.em = Float32Array.from(em); this.bk = Float32Array.from(bk);
      this.vi = new Int32Array(N); this.vl = new Int32Array(N); instances.forEach((it, ii) => { for (let i = 0; i < it.mesh.pts.length; i++) { this.vi[it.off + i] = ii; this.vl[it.off + i] = i; } });
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
      if (!this.opt.fixedPairs) B.forEach((b) => { if (!prox(b)) return; const c = near(b); if (c && prox(c)) nn.set(b.g, c.g); });
      (this.opt.fixedPairs || []).forEach(([p, q]) => { const a = Math.min(p, q), c = Math.max(p, q); if (a !== c) pairs.set(a * 1048576 + c, [a, c]); });
      nn.forEach((g2, g1) => { const mutual = nn.get(g2) === g1, o1 = 3 * g1, o2 = 3 * g2, d = Math.hypot(this.X[o1] - this.X[o2], this.X[o1 + 1] - this.X[o2 + 1], this.X[o1 + 2] - this.X[o2 + 2]); if (mutual || d < tol * 0.5) { const a = Math.min(g1, g2), c = Math.max(g1, g2); pairs.set(a * 1048576 + c, [a, c]); } });
      (this.opt.sewing || []).forEach(([ra, rb, mode]) => this._sewRuns(ra, rb, pairs, mode));
      this.ss = Int32Array.from([].concat(...[...pairs.values()]));
    }
    // two runs of outline points, each an ordered list of [instance id, outline index], are sewn by their share of the way along: the point that is a third along one meets the one a third along the other
    _sewRuns(ra, rb, pairs, mode) {
      const get = (run) => run.map(([id, i]) => { const ii = this.inst.findIndex((t) => t.id === id); return ii < 0 ? null : { g: this.inst[ii].off + i, p: this.inst[ii].mesh.pts[i] }; }).filter(Boolean);
      const A = get(ra), B = get(rb); if (A.length < 2 || B.length < 2) return;
      const cum = (R) => { const c = [0]; for (let k = 1; k < R.length; k++) c.push(c[k - 1] + Math.hypot(R[k].p[0] - R[k - 1].p[0], R[k].p[1] - R[k - 1].p[1])); return c; };
      const ca = cum(A), cb = cum(B), ta = ca[ca.length - 1] || 1, tb = cb[cb.length - 1] || 1;
      const pair = (X, cx, tx, Y, cy, ty) => X.forEach((q, k) => { const f = cx[k] / tx; let best = 0, bd = 1e9; for (let j = 0; j < Y.length; j++) { const d = Math.abs(cy[j] / ty - f); if (d < bd) { bd = d; best = j; } } const a = Math.min(q.g, Y[best].g), c = Math.max(q.g, Y[best].g); if (a !== c) pairs.set(a * 1048576 + c, [a, c]); });
      if (mode === 'end') {                                                                                // sewn from the last point (the hem, the crotch point): the same distance from it, as far as the shorter run goes
        const lim = 1.2 * (this.opt.h || 2), pe = (X, cx, tx, Y, cy, ty) => X.forEach((q, k) => { const s = tx - cx[k]; let best = -1, bd = lim; for (let j = 0; j < Y.length; j++) { const d = Math.abs(ty - cy[j] - s); if (d < bd) { bd = d; best = j; } } if (best < 0) return; const a = Math.min(q.g, Y[best].g), c = Math.max(q.g, Y[best].g); if (a !== c) pairs.set(a * 1048576 + c, [a, c]); });
        pe(A, ca, ta, B, cb, tb); pe(B, cb, tb, A, ca, ta); return;
      }
      pair(A, ca, ta, B, cb, tb); pair(B, cb, tb, A, ca, ta);
    }
    step(dt) {
      dt = dt || 1 / 100; const o = this.opt, X = this.X, Q = this.Q, N = this.N, g = o.gravity * Math.min(1, 0.15 + this.t / 40), dd = o.damp;
      for (let i = 0; i < N; i++) {
        if (this.pin[i]) continue; const a = 3 * i;
        for (let c = 0; c < 3; c++) { const v = (X[a + c] - Q[a + c]) * dd; Q[a + c] = X[a + c]; X[a + c] += v + (c === 1 ? -g * dt * dt : 0); }
      }
      const ks = 1 - Math.pow(1 - o.stretch, 1 / o.iters), kb = 1 - Math.pow(1 - o.bend, 1 / o.iters);          // a stiffness that does not change with the number of passes
      if (!this._ks || this._ks.ks !== ks || this._ks.kb !== kb) this._ks = { ks, kb, es: Float32Array.from(this.ek, (v) => Math.min(1, ks * v)), bs: Float32Array.from(this.bk, (v) => Math.min(1, kb * v)) };
      for (let it = 0; it < o.iters; it++) {
        this._pull(this.es, this.er, this._ks.es); this._pull(this.bs, this.br, this._ks.bs);
        this._seamPull(0.5);
        if (it % 3 === 0) this._collide();
        if (o.selfCollide && it % 4 === 0) this._selfCollide();
      }
      this._limit(this.es, this.er, o.maxStrain);          // cloth does not stretch like rubber: whatever is over the limit is pulled back at once
      this._collide();
      this.t++;
    }
    _pull(S, R, K) {
      const X = this.X, pin = this.pin;
      for (let e = 0, n = R.length; e < n; e++) {
        const a = S[2 * e], b = S[2 * e + 1], A = 3 * a, B = 3 * b, dx = X[B] - X[A], dy = X[B + 1] - X[A + 1], dz = X[B + 2] - X[A + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const wa = pin[a] ? 0 : 1, wb = pin[b] ? 0 : 1, w = wa + wb; if (!w) continue; const c = (K[e] * (l - R[e])) / (l * w);
        X[A] += dx * c * wa; X[A + 1] += dy * c * wa; X[A + 2] += dz * c * wa; X[B] -= dx * c * wb; X[B + 1] -= dy * c * wb; X[B + 2] -= dz * c * wb;
      }
    }
    _limit(S, R, max) {
      const X = this.X, pin = this.pin; if (!this._lim) this._lim = Float32Array.from(R, (r, e) => r * (1 + this.em[e])); const L = this._lim;
      for (let pass = 0; pass < (this.opt.limitPasses || 8); pass++) for (let e = 0, n = R.length; e < n; e++) {
        const a = S[2 * e], b = S[2 * e + 1], A = 3 * a, B = 3 * b, dx = X[B] - X[A], dy = X[B + 1] - X[A + 1], dz = X[B + 2] - X[A + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9, lim = L[e];
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
      if (!this._dc) { this._dc = new Float32Array(this.N); this._dp = new Float32Array(3 * this.N); this._dc.fill(-1e9); }
      const dc = this._dc, dp = this._dp;
      for (let i = 0; i < this.N; i++) {
        if (this.pin[i]) continue; const a = 3 * i, x = X[a], y = X[a + 1], z = X[a + 2];
        if (dc[i] > 0) { const mv = Math.abs(x - dp[a]) + Math.abs(y - dp[a + 1]) + Math.abs(z - dp[a + 2]); if (dc[i] - th - 1.2 * mv > 0.3) continue; }
        const sd = body.sdf(x, y, z), d = sd - th; dc[i] = sd; dp[a] = x; dp[a + 1] = y; dp[a + 2] = z;
        if (d >= 0) continue;
        let nx = body.sdf(x + eps, y, z) - body.sdf(x - eps, y, z), ny = body.sdf(x, y + eps, z) - body.sdf(x, y - eps, z), nz = body.sdf(x, y, z + eps) - body.sdf(x, y, z - eps); const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        X[a] -= nx * d; X[a + 1] -= ny * d; X[a + 2] -= nz * d;
        const vx = X[a] - Q[a], vy = X[a + 1] - Q[a + 1], vz = X[a + 2] - Q[a + 2], vn = vx * nx + vy * ny + vz * nz;           // friction: take away part of what slid along the body this step
        X[a] -= (vx - vn * nx) * fr; X[a + 1] -= (vy - vn * ny) * fr; X[a + 2] -= (vz - vn * nz) * fr;
      }
    }
    // cloth against cloth: two layers, or a fold lying on itself, keep a thickness apart (points of one piece that are near each other in the flat, and the sewn outlines of two pieces, are left alone)
    _selfCollide() {
      const X = this.X, N = this.N, d0 = this.opt.layer || Math.max(0.5, 2 * this.opt.thick), cell = d0 * 1.5, grid = new Map(), pin = this.pin, h = this.opt.h || 2, near = 3 * h;
      const kx = (v) => Math.floor(v / cell) + 2048;
      for (let i = 0; i < N; i++) { const k = (kx(X[3 * i]) * 4096 + kx(X[3 * i + 1])) * 4096 + kx(X[3 * i + 2]); const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i]); }
      for (let i = 0; i < N; i++) {
        const a = 3 * i, cx = kx(X[a]), cy = kx(X[a + 1]), cz = kx(X[a + 2]), ii = this.vi[i], li = this.vl[i], bi = li < this.inst[ii].mesh.nb;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.get(((cx + dx) * 4096 + cy + dy) * 4096 + cz + dz); if (!arr) continue;
          for (let q = 0; q < arr.length; q++) {
            const j = arr[q]; if (j <= i) continue; const wi = pin[i] ? 0 : 1, wj = pin[j] ? 0 : 1, w = wi + wj; if (!w) continue;
            const jj = this.vi[j], lj = this.vl[j];
            if (jj === ii) { const p = this.inst[ii].mesh.pts[li], r = this.inst[ii].mesh.pts[lj]; if (Math.hypot(p[0] - r[0], p[1] - r[1]) < near) continue; }
            else if (bi && lj < this.inst[jj].mesh.nb) continue;
            const b = 3 * j, ex = X[b] - X[a], ey = X[b + 1] - X[a + 1], ez = X[b + 2] - X[a + 2], d = Math.sqrt(ex * ex + ey * ey + ez * ez); if (d >= d0 || d < 1e-6) continue;
            const c = (d0 - d) / (d * w); X[a] -= ex * c * wi; X[a + 1] -= ey * c * wi; X[a + 2] -= ez * c * wi; X[b] += ex * c * wj; X[b + 1] += ey * c * wj; X[b + 2] += ez * c * wj;
          }
        }
      }
    }
    // how hard each point is pulled: + is stretched, as a fraction of what its cloth allows (1 = at the limit); - is crowded (squeezed together), as a fraction of a quarter of its length
    stress() {
      const X = this.X, out = new Float32Array(this.N);
      for (let e = 0; e < this.er.length; e++) {
        const a = this.es[2 * e], b = this.es[2 * e + 1], A = 3 * a, B = 3 * b, l = Math.hypot(X[A] - X[B], X[A + 1] - X[B + 1], X[A + 2] - X[B + 2]), st = l / (this.er[e] || 1) - 1, v = st >= 0 ? st / (this.em[e] || 0.02) : st / 0.25;
        if (Math.abs(v) > Math.abs(out[a])) out[a] = v; if (Math.abs(v) > Math.abs(out[b])) out[b] = v;
      }
      return out;
    }
    // a short account of the fit: how much of the cloth is near its limit, and where it is most pulled
    fitReport() {
      const s = this.stress(); let tight = 0, loose = 0, worst = 0, wi = 0; for (let i = 0; i < this.N; i++) { if (s[i] > 0.8) tight++; if (s[i] < -0.5) loose++; if (s[i] > worst) { worst = s[i]; wi = i; } }
      return { tight_pct: (100 * tight) / this.N, crowded_pct: (100 * loose) / this.N, worst, at: [this.X[3 * wi], this.X[3 * wi + 1], this.X[3 * wi + 2]], piece: this.inst[this.vi[wi]].id };
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

  // ── the garment document: pieces, where each starts in space, what is sewn to what, what is held, the body, the fabric. All data; this is the only way in. ──
  //   piece      { id, pid, name, poly: [[x, y]...] cm, labels: [per vertex], material: 'main'|'rib', placement: { x0, y0, dx, dy, nx, ny, xyz: [x, y, z ...] }, pinAll?: true }
  //   stitches   [{ a: [piece, s], b: [piece, s] }]    point to point; s is the share (0..1) of the way round the piece's outline
  //   seams      [{ a: [seg...], b: [seg...], mode: 'share' | 'end' }]  seg = { piece, s0, s1, rev? }: a run of an outline, sewn to another by share (or from the last point)
  //   pins       [{ piece, s0, s1 }]    outline held where it starts (a neckline, a waistband)
  //   avatar     a desc for avatar();   sim { gravity, seamTol, thick ... }
  const gridMap = (pl) => {
    const nx = pl.nx, ny = pl.ny, v = pl.xyz, cl = (t, n) => Math.max(0, Math.min(n - 1, t));
    return (x, y) => {
      const fx = cl((x - pl.x0) / pl.dx, nx), fy = cl((y - pl.y0) / pl.dy, ny), i = Math.min(Math.floor(fx), Math.max(0, nx - 2)), j = Math.min(Math.floor(fy), Math.max(0, ny - 2)), tx = nx > 1 ? fx - i : 0, ty = ny > 1 ? fy - j : 0;
      const at = (a, b, c) => v[3 * (Math.min(ny - 1, b) * nx + Math.min(nx - 1, a)) + c];
      return [0, 1, 2].map((c) => at(i, j, c) * (1 - tx) * (1 - ty) + at(i + 1, j, c) * tx * (1 - ty) + at(i, j + 1, c) * (1 - tx) * ty + at(i + 1, j + 1, c) * tx * ty);
    };
  };
  const outlineS = (mesh) => {                                                   // the share of the way round the outline of each boundary point
    const n = mesh.nb, c = [0]; for (let i = 1; i <= n; i++) { const p = mesh.pts[i % n], q = mesh.pts[i - 1]; c.push(c[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1])); }
    const t = c[n] || 1; return c.slice(0, n).map((v) => v / t);
  };
  function fromDoc(doc, hOverride) {
    const area = doc.pieces.reduce((a, it) => { let s = 0; for (let i = 0; i < it.poly.length; i++) { const p = it.poly[i], q = it.poly[(i + 1) % it.poly.length]; s += p[0] * q[1] - q[0] * p[1]; } return a + Math.abs(s) / 2; }, 0);
    const h = hOverride || Math.max(1.5, Math.min(3.2, Math.sqrt(area / (3200 * 0.866))));
    const insts = doc.pieces.map((p) => { const mesh = meshPiece(p.poly, p.labels, h); return { id: p.id, pid: p.pid || p.id, mesh, s: outlineS(mesh), map: gridMap(p.placement), rest: p.rest || 'flat', mat: p.material || 'main', grp: p.grp, pinAll: !!p.pinAll, fab: fabricParams(doc.fabric, p.fab || (p.material === 'rib' ? 'rib' : null)), folds: (p.folds || []).map((f) => ({ a: f.a, b: f.b, f: Math.max(0.15, Math.sin((Math.max(5, Math.min(175, f.angle == null ? 60 : f.angle)) * Math.PI) / 360)) })) }; });
    const by = (id) => insts.find((t) => t.id === id), off = []; let N = 0; insts.forEach((it) => { off.push(N); N += it.mesh.pts.length; });
    const near = (it, s) => { let best = 0, bd = 9; it.s.forEach((v, i) => { const d = Math.min(Math.abs(v - s), 1 - Math.abs(v - s)); if (d < bd) { bd = d; best = i; } }); return best; };
    const nearXY = (it, x, y) => { let best = 0, bd = 1e18; it.mesh.pts.forEach((q, i) => { const d = (q[0] - x) * (q[0] - x) + (q[1] - y) * (q[1] - y); if (d < bd) { bd = d; best = i; } }); return best; };
    const vtx = (A, e) => off[insts.indexOf(A)] + (e[1] == null ? nearXY(A, e[2], e[3]) : near(A, e[1]));                // a stitch end is a share of the way round the outline, or a point inside the piece [id, null, x, y]
    const fixed = []; (doc.stitches || []).forEach((st) => { const A = by(st.a[0]), B = by(st.b[0]); if (!A || !B) return; fixed.push([vtx(A, st.a), vtx(B, st.b)]); });
    // a segment is a stretch of the outline from s0 to s1 (s1 over 1 goes on round past the start of the outline); the key puts its points in order along it
    const key = (s, g) => { if (s >= g.s0 - 1e-6 && s <= g.s1 + 1e-6) return s; if (g.s1 > 1 && s + 1 >= g.s0 - 1e-6 && s + 1 <= g.s1 + 1e-6) return s + 1; return null; };
    const runs = (segs) => [].concat(...segs.map((g) => { const it = by(g.piece); if (!it) return []; const r = []; for (let i = 0; i < it.mesh.nb; i++) { const k = key(it.s[i], g); if (k != null) r.push([it.id, i, k]); } r.sort((a, b) => (g.rev ? b[2] - a[2] : a[2] - b[2])); return r.map((q) => [q[0], q[1]]); }));
    const sewing = (doc.seams || []).map((sm) => [runs(sm.a), runs(sm.b), sm.mode]);
    const pinSet = new Map(); (doc.pins || []).forEach((p) => { const it = by(p.piece); if (!it) return; const set = pinSet.get(it.id) || new Set(); for (let i = 0; i < it.mesh.nb; i++) if (key(it.s[i], p) != null) set.add(i); pinSet.set(it.id, set); });
    insts.forEach((it) => { const set = pinSet.get(it.id); if (set) it.pin = (i) => set.has(i); });
    (doc.topstitch || []).forEach((t) => { const it = by(t.piece); if (!it) return; it.stiffV = it.stiffV || new Set(); for (let i = 0; i < it.mesh.nb; i++) if (it.s[i] >= t.s0 - 1e-6 && it.s[i] <= t.s1 + 1e-6) it.stiffV.add(i); });
    const trims = (doc.trims || []).map((t) => { const it = by(t.piece); if (!it) return null; return Object.assign({}, t, { v: off[insts.indexOf(it)] + nearXY(it, t.x, t.y) }); }).filter(Boolean);
    const zips = (doc.seams || []).filter((sm) => sm.zip).map((sm) => runs(sm.a).map(([id, i]) => off[insts.indexOf(by(id))] + i));
    const ph = doc.fabric && doc.fabric.family ? physics(doc.fabric) : null;
    return { insts, body: avatar(doc.avatar), h, trims, zips, opt: Object.assign({ h, seamTol: Math.max(1.6, h * 0.85), fixedPairs: fixed, sewing }, ph ? { thick: ph.thick, friction: ph.friction } : {}, doc.sim || {}) };
  }

  const KASim = { delaunay, meshPiece, meshArea, bodyTee, bodyLegs, avatar, lerpKeys, Cloth, DRAPE, ellK, fromDoc, gridMap, outlineS, FAMILIES, fabricParams, physics };
  root.KASim = KASim; if (typeof module !== 'undefined' && module.exports) module.exports = KASim;
})(typeof window !== 'undefined' ? window : globalThis);
