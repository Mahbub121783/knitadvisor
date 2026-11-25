/**
 * The free pattern: any piece the user draws, as data, and the document the cloth simulator reads.
 *
 *   project  { name, fabric: { gsm }, pieces: [piece], seams: [seam], seq }
 *   piece    { id, name, nodes: [{ x, y, sm?, i?, o? }], edges: [{ id, label, hold }], notches: [{ edge, t }], lines: [{ a: [x,y], b: [x,y] }], arr: { mode, top, dx, gap }, mat }
 *              node i starts edge i (edge i runs from node i to node i+1); x to the right, y DOWN, in cm.
 *              A node is a corner, or smooth (its handles follow its neighbours), or has handles of its own (i = in, o = out; offsets from the node).
 *   seam     { id, a: [{ piece, eid }], b: [{ piece, eid }] }   edges sewn to edges (edge ids stay the same when a node is added or taken away)
 *
 * Nothing in here knows what a garment is. A piece is an outline; where it first hangs (arr) is a plain choice: front, back or wrapped round the body.
 * toDoc() writes the whole thing as a KADoc, and the cloth does the rest.
 */
(function (root) {
  'use strict';
  const KD = () => root.KADoc || (typeof require !== 'undefined' ? require('./garment-doc.js') : null);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const K = 0.5523;

  // ── the project ──
  const create = (name) => ({ name: name || 'My garment', fabric: { gsm: 180 }, pieces: [], seams: [], seq: 0 });
  const nid = (P, p) => p + (++P.seq).toString(36);
  const byId = (P, id) => P.pieces.find((p) => p.id === id);
  const addPiece = (P, pts, name, opt) => {
    const o = opt || {}, p = { id: nid(P, 'p'), name: name || 'Piece ' + (P.pieces.length + 1), nodes: pts.map((q) => Object.assign({ x: r3(q.x != null ? q.x : q[0]), y: r3(q.y != null ? q.y : q[1]) }, q.sm ? { sm: true } : {}, q.i ? { i: q.i, o: q.o } : {})), edges: [], notches: [], lines: [], arr: Object.assign({ mode: 'wrap', top: 108, dx: 0, gap: 1.5 }, o.arr || {}), mat: o.mat || 'main' };
    p.edges = p.nodes.map(() => ({ id: nid(P, 'e'), label: '', hold: false })); P.pieces.push(p); return p;
  };
  const rect = (P, x, y, w, h, name, opt) => addPiece(P, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], name, opt);
  const ellipse = (P, cx, cy, rx, ry, name, opt) => addPiece(P, [
    { x: cx, y: cy - ry, sm: true, o: [K * rx, 0], i: [-K * rx, 0] }, { x: cx + rx, y: cy, sm: true, o: [0, K * ry], i: [0, -K * ry] },
    { x: cx, y: cy + ry, sm: true, o: [-K * rx, 0], i: [K * rx, 0] }, { x: cx - rx, y: cy, sm: true, o: [0, -K * ry], i: [0, K * ry] }], name, opt);

  // ── outlines ──
  const autoH = (p, i) => { const n = p.nodes.length, a = p.nodes[(i + n - 1) % n], b = p.nodes[(i + 1) % n], t = [(b.x - a.x) / 6, (b.y - a.y) / 6]; return { o: t, i: [-t[0], -t[1]] }; };
  const handles = (p, i) => { const N = p.nodes[i]; if (N.o || N.i) return { o: N.o || [0, 0], i: N.i || [0, 0] }; return N.sm ? autoH(p, i) : { o: [0, 0], i: [0, 0] }; };
  const seg = (p, e) => { const n = p.nodes.length, A = p.nodes[e], B = p.nodes[(e + 1) % n], ha = handles(p, e).o, hb = handles(p, (e + 1) % n).i; return [[A.x, A.y], [A.x + ha[0], A.y + ha[1]], [B.x + hb[0], B.y + hb[1]], [B.x, B.y]]; };
  const bez = (c, t) => { const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t; return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]]; };
  const straight = (c) => c[1][0] === c[0][0] && c[1][1] === c[0][1] && c[2][0] === c[3][0] && c[2][1] === c[3][1];
  const subs = (c, step) => { if (straight(c)) return 1; let est = 0; for (let k = 0; k < 3; k++) est += Math.hypot(c[k + 1][0] - c[k][0], c[k + 1][1] - c[k][1]); return Math.max(4, Math.ceil(est / (step || 1))); };
  // the outline as points, a label for each, and the edge each starts
  function flatten(p, step) {
    const poly = [], labels = [], vEdge = [];
    for (let e = 0; e < p.nodes.length; e++) {
      const c = seg(p, e), m = subs(c, step), lab = (p.edges[e].label || 'edge') + '#' + e;
      for (let k = 0; k < m; k++) { const q = bez(c, k / m); poly.push([r3(q[0]), r3(q[1])]); labels.push(lab); vEdge.push(e); }
    }
    return { poly, labels, vEdge };
  }
  const cumOf = (poly) => { const c = [0]; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; c.push(c[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); } return c; };
  // the share (0..1) of the way round the outline at which each edge starts and ends, and its length in cm
  function shares(p, fl) {
    fl = fl || flatten(p); const c = cumOf(fl.poly), T = c[c.length - 1] || 1, out = [];
    for (let e = 0; e < p.nodes.length; e++) { const i0 = fl.vEdge.indexOf(e), i1 = fl.vEdge.lastIndexOf(e) + 1; out.push({ s0: c[i0] / T, s1: c[i1] / T, len: c[i1] - c[i0], i0, i1: i1 % fl.poly.length }); }
    return out;
  }
  const edgeLen = (p, e) => shares(p)[e].len;
  const area = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const bbox = (poly) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; poly.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }); return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
  const inside = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  // the nearest point of the outline: { e, t (the curve parameter on that edge), d, x, y }
  function nearest(p, x, y) {
    const fl = flatten(p, 1), n = fl.poly.length, cm = cumOf(fl.poly); let best = null;
    for (let i = 0; i < n; i++) {
      const a = fl.poly[i], b = fl.poly[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9, u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)), qx = a[0] + dx * u, qy = a[1] + dy * u, d = Math.hypot(x - qx, y - qy);
      if (!best || d < best.d) { const e = fl.vEdge[i], i0 = fl.vEdge.indexOf(e), m = fl.vEdge.lastIndexOf(e) - i0 + 1; best = { e, t: (i - i0 + u) / m, d, x: qx, y: qy, s: (cm[i] + u * Math.sqrt(l2)) / (cm[n] || 1) }; }
    }
    return best;
  }

  // ── editing ──
  const materialize = (p, i) => { const h = handles(p, i), N = p.nodes[i]; N.o = h.o.slice(); N.i = h.i.slice(); };
  const moveNode = (p, i, x, y) => { p.nodes[i].x = r3(x); p.nodes[i].y = r3(y); };
  const moveHandle = (p, i, which, dx, dy, sym) => {
    const N = p.nodes[i]; if (!N.o && !N.i) materialize(p, i); N.sm = true; N[which] = [r3(dx), r3(dy)];
    if (sym !== false) { const other = which === 'o' ? 'i' : 'o', l = Math.hypot(N[other][0], N[other][1]) || Math.hypot(dx, dy), m = Math.hypot(dx, dy) || 1; N[other] = [r3((-dx / m) * l), r3((-dy / m) * l)]; }
  };
  const toggleSmooth = (p, i) => { const N = p.nodes[i]; if (N.sm || N.o || N.i) { delete N.sm; delete N.o; delete N.i; } else N.sm = true; };
  const translate = (p, dx, dy) => { p.nodes.forEach((N) => { N.x = r3(N.x + dx); N.y = r3(N.y + dy); }); p.lines.forEach((l) => { l.a[0] += dx; l.a[1] += dy; l.b[0] += dx; l.b[1] += dy; }); };
  const sideOf = (P, eid) => { const out = []; P.seams.forEach((s) => { ['a', 'b'].forEach((k) => { const j = s[k].findIndex((g) => g.eid === eid); if (j >= 0) out.push([s, k, j]); }); }); return out; };
  // a point on edge e (curve parameter t): the edge becomes two, both keep what the first had (a label, held, sewn)
  function addNode(P, p, e, t) {
    const n = p.nodes.length, c = seg(p, e), A = p.nodes[e], B = p.nodes[(e + 1) % n], lp = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const a1 = lp(c[0], c[1]), b1 = lp(c[1], c[2]), c1 = lp(c[2], c[3]), a2 = lp(a1, b1), b2 = lp(b1, c1), M = straight(c) ? lp(c[0], c[3]) : lp(a2, b2), N = { x: r3(M[0]), y: r3(M[1]) };
    if (!straight(c)) { materialize(p, e); materialize(p, (e + 1) % n); A.o = [a1[0] - c[0][0], a1[1] - c[0][1]]; N.sm = true; N.i = [a2[0] - M[0], a2[1] - M[1]]; N.o = [b2[0] - M[0], b2[1] - M[1]]; B.i = [c1[0] - c[3][0], c1[1] - c[3][1]]; }
    p.nodes.splice(e + 1, 0, N);
    const old = p.edges[e], ne = { id: nid(P, 'e'), label: old.label, hold: old.hold }; p.edges.splice(e + 1, 0, ne);
    sideOf(P, old.id).forEach(([s, k, j]) => { s[k].splice(j + 1, 0, { piece: p.id, eid: ne.id }); });
    p.notches.forEach((q) => { if (q.edge === old.id) { if (q.t >= t) { q.edge = ne.id; q.t = (q.t - t) / (1 - t || 1); } else q.t = q.t / (t || 1); } });
    return e + 1;
  }
  // a point taken away: the two edges become one (the first's name stays); a seam that named the second one drops it
  function removeNode(P, p, i) {
    const n = p.nodes.length; if (n <= 3) return false; const e0 = (i + n - 1) % n, gone = p.edges[i];
    P.seams.forEach((s) => ['a', 'b'].forEach((k) => { s[k] = s[k].filter((g) => g.eid !== gone.id); })); P.seams = P.seams.filter((s) => s.a.length && s.b.length);
    p.notches = p.notches.filter((q) => q.edge !== gone.id);
    p.nodes.splice(i, 1); p.edges.splice(i, 1); if (e0 > i) { /* the first edge was the last one: it is already in the right place */ }
    return true;
  }
  const removePiece = (P, id) => { P.pieces = P.pieces.filter((p) => p.id !== id); P.stitches = (P.stitches || []).filter((t) => t.a.piece !== id && t.b.piece !== id); P.seams.forEach((s) => ['a', 'b'].forEach((k) => { s[k] = s[k].filter((g) => g.piece !== id); })); P.seams = P.seams.filter((s) => s.a.length && s.b.length); };
  // a dart: a wedge taken out of edge e at t, `width` wide at the edge and `depth` into the piece; its two legs are sewn together
  function addDart(P, p, e, t, width, depth) {
    const L = edgeLen(p, e) || 1, w = Math.min(width, L * 0.8) / 2 / L, t1 = Math.max(0.02, t - w), t2 = Math.min(0.98, t + w);
    addNode(P, p, e, t2); const i1 = addNode(P, p, e, t1 / t2), nA = p.nodes[i1], nB = p.nodes[i1 + 1]; // after both: ... e (A..M1), e+1 (M1..M2), e+2 (M2..B)
    const mid = [(nA.x + nB.x) / 2, (nA.y + nB.y) / 2], dx = nB.x - nA.x, dy = nB.y - nA.y, l = Math.hypot(dx, dy) || 1; let nx = -dy / l, ny = dx / l;
    const poly = flatten(p).poly; if (!inside(poly, mid[0] + nx * 0.3, mid[1] + ny * 0.3)) { nx = -nx; ny = -ny; }
    [nA, nB].forEach((q) => { delete q.sm; q.o = [0, 0]; q.i = [0, 0]; });
    const ia = addNode(P, p, i1, 0.5), ap = p.nodes[ia]; delete ap.sm; ap.x = r3(mid[0] + nx * depth); ap.y = r3(mid[1] + ny * depth); ap.o = [0, 0]; ap.i = [0, 0];
    p.edges[i1].label = 'dart'; p.edges[ia].label = 'dart'; p.edges[i1].hold = p.edges[ia].hold = false;
    P.seams = P.seams.filter((s) => !s.a.concat(s.b).some((g) => g.eid === p.edges[i1].id || g.eid === p.edges[ia].id));
    sew(P, { piece: p.id, eid: p.edges[i1].id }, { piece: p.id, eid: p.edges[ia].id });
    return ia;
  }
  const addNotch = (p, e, t) => { p.notches.push({ edge: p.edges[e].id, t: Math.max(0.01, Math.min(0.99, t)) }); };
  const addLine = (p, a, b) => { p.lines.push({ a: [r3(a[0]), r3(a[1])], b: [r3(b[0]), r3(b[1])] }); };
  // a copy flipped left-right, put to the right of the original (a left sleeve from a right one)
  function mirrorCopy(P, p) {
    const n = p.nodes.length, bb = bbox(flatten(p).poly), ax = bb.x1 + 3, fx = (x) => r3(2 * ax - x), np = addPiece(P, [], p.name + ' (mirrored)', { arr: p.arr, mat: p.mat });
    for (let k = 0; k < n; k++) { const N = p.nodes[n - 1 - k], h = handles(p, n - 1 - k), q = { x: fx(N.x), y: N.y }; if (N.sm || N.o || N.i) { q.sm = true; q.o = [-h.i[0], h.i[1]]; q.i = [-h.o[0], h.o[1]]; } np.nodes.push(q); }
    np.edges = np.nodes.map((_, k) => ({ id: nid(P, 'e'), label: p.edges[(n - 2 - k + 2 * n) % n].label, hold: p.edges[(n - 2 - k + 2 * n) % n].hold }));
    np.arr = Object.assign({}, p.arr, { dx: -p.arr.dx }); return np;
  }
  // a half drawn, a whole made: the piece is reflected across its edge e, which becomes the fold (the edge is gone, the outline is closed)
  function mirrorFold(P, p, e) {
    const n = p.nodes.length, F = p.nodes[e], G = p.nodes[(e + 1) % n], dx = G.x - F.x, dy = G.y - F.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const refl = (x, y) => { const vx = x - F.x, vy = y - F.y, a = vx * ux + vy * uy; return [F.x + 2 * a * ux - vx, F.y + 2 * a * uy - vy]; }, rv = (x, y) => { const a = x * ux + y * uy; return [2 * a * ux - x, 2 * a * uy - y]; };
    // the open chain: G, ..., F (the nodes after the fold edge round to its start)
    const idx = []; for (let k = 0; k < n; k++) idx.push((e + 1 + k) % n);       // idx[0] = G ... idx[n-1] = F
    const nodes = idx.map((j) => Object.assign({}, p.nodes[j]));
    const edges = []; for (let k = 0; k < n - 1; k++) edges.push(p.edges[idx[k]]);  // edge idx[k] runs idx[k] -> idx[k+1]
    const outN = nodes.map((q) => clone(q)), outE = edges.map((q) => clone(q));
    for (let k = n - 2; k >= 1; k--) {                                              // the mirrored chain back from F to G, without F and G again
      const src = p.nodes[idx[k]], h = handles(p, idx[k]), r = refl(src.x, src.y), q = { x: r3(r[0]), y: r3(r[1]) };
      if (src.sm || src.o || src.i) { q.sm = true; const o = rv(h.i[0], h.i[1]), i = rv(h.o[0], h.o[1]); q.o = [r3(o[0]), r3(o[1])]; q.i = [r3(i[0]), r3(i[1])]; }
      outN.push(q);
    }
    for (let k = n - 2; k >= 0; k--) { const ed = p.edges[idx[k]]; outE.push({ id: nid(P, 'e'), label: ed.label, hold: ed.hold }); }
    if (outN.length !== outE.length) return false;
    p.nodes = outN; p.edges = outE; p.notches = []; return true;
  }
  // the cutting line: the outline moved d cm outward (a seam allowance)
  function allowance(p, d) {
    const poly = flatten(p, 1.5).poly, n = poly.length, sg = area(poly) >= 0 ? 1 : -1;
    return poly.map((q, i) => {
      const a = poly[(i + n - 1) % n], b = poly[(i + 1) % n], t1 = [q[0] - a[0], q[1] - a[1]], t2 = [b[0] - q[0], b[1] - q[1]], l1 = Math.hypot(...t1) || 1, l2 = Math.hypot(...t2) || 1;
      const n1 = [sg * t1[1] / l1, -sg * t1[0] / l1], n2 = [sg * t2[1] / l2, -sg * t2[0] / l2], m = [n1[0] + n2[0], n1[1] + n2[1]], ml = Math.hypot(...m) || 1, c = Math.max(0.35, (m[0] * n1[0] + m[1] * n1[1]) / ml);
      return [r3(q[0] + (m[0] / ml) * (d / c)), r3(q[1] + (m[1] / ml) * (d / c))];
    });
  }

  // ── sewing: edge to edge ──
  // a seam joins one side to another; a side is an edge or a run of edges (one long edge sewn to several short ones)
  const asSide = (g) => (Array.isArray(g) ? g : [g]).map((q) => ({ piece: q.piece, eid: q.eid }));
  function sew(P, a, b) {
    const A = asSide(a), B = asSide(b), ok = (g) => { const p = byId(P, g.piece); return p && p.edges.some((e) => e.id === g.eid); };
    if (!A.length || !B.length || !A.every(ok) || !B.every(ok) || A.some((x) => B.some((y) => x.eid === y.eid))) return null;
    if (P.seams.some((s) => s.a.length === A.length && s.b.length === B.length && ((s.a.every((g, i) => g.eid === A[i].eid) && s.b.every((g, i) => g.eid === B[i].eid)) || (s.a.every((g, i) => g.eid === B[i].eid) && s.b.every((g, i) => g.eid === A[i].eid))))) return null;
    const s = { id: nid(P, 's'), a: A, b: B }; P.seams.push(s); return s;
  }
  // one more edge on a side of a seam (shift-click in the Sew tool)
  function addToSeam(P, id, side, g) { const s = P.seams.find((q) => q.id === id), p = byId(P, g.piece); if (!s || !p || !p.edges.some((e) => e.id === g.eid) || s.a.concat(s.b).some((q) => q.eid === g.eid)) return false; s[side].push({ piece: g.piece, eid: g.eid }); return true; }
  // turn a seam the other way round (when the automatic direction is not the one wanted)
  const flipSeam = (P, id) => { const s = P.seams.find((q) => q.id === id); if (s) s.flip = !s.flip; return !!s; };
  // a stitch from one point of an outline to another, outside the edge-to-edge seams: sa, sb are shares (0..1) of the way round each outline
  function stitch(P, pa, sa, pb, sb) { if (!byId(P, pa) || !byId(P, pb)) return null; P.stitches = P.stitches || []; const t = { id: nid(P, 't'), a: { piece: pa, s: r3(sa) }, b: { piece: pb, s: r3(sb) } }; P.stitches.push(t); return t; }
  const unstitch = (P, id) => { P.stitches = (P.stitches || []).filter((t) => t.id !== id); };
  const unsew = (P, id) => { P.seams = P.seams.filter((s) => s.id !== id); };
  const sideLen = (P, side) => side.reduce((t, g) => { const p = byId(P, g.piece); if (!p) return t; const e = p.edges.findIndex((x) => x.id === g.eid); return e < 0 ? t : t + shares(p)[e].len; }, 0);
  // how long each side of every seam is, and what one is more than the other (the ease)
  const seamInfo = (P) => P.seams.map((s) => { const A = sideLen(P, s.a), B = sideLen(P, s.b); return { id: s.id, a: s.a, b: s.b, lenA: A, lenB: B, diff: A - B, pct: (100 * (A - B)) / (Math.max(A, B) || 1) }; });

  // ── the body and where a piece first hangs ──
  const standardBody = () => ({
    top: 178, loft: { from: 80, keys: [[152, 5.5, 5.5], [147, 9, 7], [143, 17, 9.5], [135, 17, 10.5], [125, 16.5, 11.5], [108, 13.5, 9.5], [98, 16.5, 10.5], [90, 17.5, 11.5], [80, 16.5, 10.5]] },
    caps: [{ A: [9, 82, 0], B: [9, 45, 0], ra: 8.5, rb: 6.2 }, { A: [-9, 82, 0], B: [-9, 45, 0], ra: 8.5, rb: 6.2 }, { A: [9, 45, 0], B: [9, 6, 0], ra: 6.2, rb: 4.2 }, { A: [-9, 45, 0], B: [-9, 6, 0], ra: 6.2, rb: 4.2 },
      { A: [19, 143, 0], B: [27, 112, 0], ra: 4.8, rb: 3.6 }, { A: [-19, 143, 0], B: [-27, 112, 0], ra: 4.8, rb: 3.6 }, { A: [27, 112, 0], B: [30, 86, 0], ra: 3.6, rb: 2.8 }, { A: [-27, 112, 0], B: [-30, 86, 0], ra: 3.6, rb: 2.8 }],
    spheres: [{ c: [0, 160, 1.5], r: 10.5 }],
  });
  const ellipseAt = (desc, y) => {
    const k = desc.loft.keys; if (y >= k[0][0]) return [k[0][1], k[0][2]]; if (y <= k[k.length - 1][0]) return [k[k.length - 1][1], k[k.length - 1][2]];
    for (let i = 0; i + 1 < k.length; i++) if (y <= k[i][0] && y >= k[i + 1][0]) { const t = (k[i][0] - y) / (k[i][0] - k[i + 1][0] || 1); return [k[i][1] + (k[i + 1][1] - k[i][1]) * t, k[i][2] + (k[i + 1][2] - k[i][2]) * t]; }
    return [k[0][1], k[0][2]];
  };

  // ── a body from measures: a stack of ellipses for the torso, capsules for the limbs; the limb paths are kept so a piece can be wrapped round one ──
  const PRESETS = { female: { height: 165, chest: 88, waist: 70, hip: 96, shoulder: 38 }, male: { height: 178, chest: 100, waist: 84, hip: 100, shoulder: 45 }, child: { height: 120, chest: 62, waist: 56, hip: 66, shoulder: 28 } };
  const ringOf = (a, b) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const ringK = (ratio, C) => { const k = C / ringOf(ratio, 1); return [ratio * k, k]; };
  function bodyFromMeasures(m0) {
    const m = Object.assign({}, PRESETS[m0 && m0.preset] || PRESETS.female, m0 || {}), s = m.height / 168, Y = (v) => r3(v * s), g = m.hip / 96, c = m.chest / 88, sh = m.shoulder / 2;
    const ch = ringK(1.6, m.chest), wa = ringK(1.4, m.waist), hi = ringK(1.5, m.hip), nr = 5.5 * s, lx = hi[0] * 0.52, ax = sh;
    const keys = [[Y(152), nr, nr], [Y(147), 9 * s, 7 * s], [Y(143), sh * 0.9, ch[1] * 0.85], [Y(135), ch[0] * 1.02, ch[1] * 0.95], [Y(125), ch[0], ch[1]], [Y(108), wa[0], wa[1]], [Y(98), (wa[0] + hi[0]) / 2, (wa[1] + hi[1]) / 2], [Y(90), hi[0], hi[1]], [Y(80), hi[0] * 0.95, hi[1] * 0.92]].map((k) => k.map(r3));
    const rt = 8.5 * g, rk = 6.2 * g, ra = 4.2 * s, legs = (sg) => [[sg * lx, Y(82), 0, rt], [sg * lx, Y(45), 0, rk], [sg * lx, Y(6), 0, ra]], arms = (sg) => [[sg * ax, Y(143), 0, 4.8 * c], [sg * (ax + 8 * s), Y(112), 0, 3.6 * c], [sg * (ax + 11 * s), Y(86), 0, 2.8 * c]];
    const caps = []; [legs(1), legs(-1), arms(1), arms(-1)].forEach((L) => { for (let i = 0; i + 1 < L.length; i++) caps.push({ A: [r3(L[i][0]), L[i][1], 0], B: [r3(L[i + 1][0]), L[i + 1][1], 0], ra: r3(L[i][3]), rb: r3(L[i + 1][3]) }); });
    const limb = (L) => L.map((q) => q.map(r3));
    return { top: Y(178), loft: { from: Y(80), keys }, caps, spheres: [{ c: [0, Y(160), r3(1.5 * s)], r: r3(10.5 * Math.pow(s, 0.6)) }],
      limbs: { armL: limb(arms(1)), armR: limb(arms(-1)), legL: limb(legs(1)), legR: limb(legs(-1)) },
      anchors: { neck: Y(150), shoulder: Y(145), chest: Y(125), waist: Y(108), 'high hip': Y(98), hip: Y(90), crotch: Y(80), knee: Y(45), ankle: Y(6) }, measures: { height: m.height, chest: m.chest, waist: m.waist, hip: m.hip, shoulder: m.shoulder } };
  }
  // wrap a piece round a limb: its height runs down the limb, its width round it (the seam on the far side from the body's middle)
  function limbMap(desc, arr, poly) {
    const L = desc.limbs && desc.limbs[arr.mode]; if (!L) return null;
    const bb = bbox(poly), cl = [0]; for (let i = 1; i < L.length; i++) cl.push(cl[i - 1] + Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1], L[i][2] - L[i - 1][2]));
    const side = L[0][0] >= 0 ? 1 : -1, gap = arr.gap == null ? 1.2 : arr.gap, tot = cl[cl.length - 1];
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return (x, y) => {
      const d0 = Math.max(0, Math.min(tot, (y - bb.y0) + (arr.along || 0))); let i = 0; while (i + 2 < L.length && cl[i + 1] < d0) i++;
      const t = Math.max(0, Math.min(1, (d0 - cl[i]) / ((cl[i + 1] - cl[i]) || 1))), A = L[i], B = L[i + 1], ctr = [0, 1, 2].map((k) => A[k] + (B[k] - A[k]) * t), r = A[3] + (B[3] - A[3]) * t + gap;
      const dv = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], dl = Math.hypot(...dv) || 1, d = dv.map((v) => v / dl), o = [side, 0, 0], od = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], e1r = [o[0] - od * d[0], o[1] - od * d[1], o[2] - od * d[2]], el = Math.hypot(...e1r) || 1, e1 = e1r.map((v) => v / el), e2 = cross(d, e1);
      const f = (x - bb.x0) / Math.max(1e-3, bb.w), ring = 2 * Math.PI * r, span = 2 * Math.PI * Math.min(1, bb.w / ring), phi = (f - 0.5) * span + (arr.dx || 0) / r;
      return [0, 1, 2].map((k) => ctr[k] + r * (Math.cos(phi) * e1[k] + Math.sin(phi) * e2[k]));
    };
  }
  // a first guess at where each piece hangs, from nothing but its shape and its seams: a piece sewn to itself is a tube (a limb if it is narrow, the torso if not),
  // two pieces sewn to each other twice are a front and a back. The person can change any of it.
  function autoArrange(P, desc) {
    const d = desc || bodyFromMeasures(P.body || { preset: 'female' }), an = d.anchors || { waist: 108, chest: 125, shoulder: 145 }, H = d.top || 178, taken = {};
    const limbR = d.limbs ? 2 * Math.PI * (d.limbs.armL[0][3] + 1.2) : 30;
    P.pieces.forEach((p) => {
      if (taken[p.id]) return;
      const bb = bbox(flatten(p).poly), mine = P.seams.filter((s) => s.a.concat(s.b).some((g) => g.piece === p.id));
      const self = mine.some((s) => s.a.some((g) => g.piece === p.id) && s.b.some((g) => g.piece === p.id));
      const other = {}; mine.forEach((s) => s.a.concat(s.b).forEach((g) => { if (g.piece !== p.id) other[g.piece] = (other[g.piece] || 0) + 1; }));
      const pair = Object.keys(other).find((id) => other[id] >= 2 && !taken[id]), held = p.edges.some((e) => e.hold);
      p.arr.along = 0;
      if (self && d.limbs && bb.w <= limbR * 2.2) { const arm = bb.h <= 0.4 * H; p.arr.mode = arm ? (taken.arm ? 'armR' : 'armL') : (taken.leg ? 'legR' : 'legL'); taken[arm ? 'arm' : 'leg'] = 1; taken[p.id] = 1; if (!P.body) P.body = { preset: 'female' }; return; }
      if (pair) { taken[p.id] = 1; taken[pair] = 1; p.arr.mode = 'front'; const q = byId(P, pair); if (q) q.arr.mode = 'back'; } else p.arr.mode = 'wrap';
      const long = bb.h > 0.3 * H; p.arr.top = r3(held && !long ? an.waist : long ? an.shoulder : (an.chest));
      if (pair) { const q = byId(P, pair); if (q) q.arr.top = p.arr.top; }
    });
    return P;
  }
  // where the flat point (x, y) of a piece starts, in 3D. wrap: the width of the piece round the body once (row by row); front / back: the half of the body, side to side
  function arrangeMap(desc, arr, poly) {
    if (/^(arm|leg)[LR]$/.test(arr.mode || '')) { const lm = limbMap(desc, arr, poly); if (lm) return lm; }
    const bb = bbox(poly), mode = arr.mode || 'wrap', gap = arr.gap == null ? 1.5 : arr.gap;
    const span = (y) => {                                                        // the outer extent of the outline on this row
      const yy = Math.min(bb.y1 - 0.01, Math.max(bb.y0 + 0.01, y)), xs = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; if ((a[1] > yy) !== (b[1] > yy)) xs.push(a[0] + ((yy - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); }
      return xs.length ? [Math.min(...xs), Math.max(...xs)] : [bb.x0, bb.x1];
    };
    return (x, y) => {
      const wy = arr.top - (y - bb.y0), e = ellipseAt(desc, wy), a = e[0] + gap, b = e[1] + gap;
      // each row spans its own width (so a slanted side starts on the side of the body), unless the row is far narrower than the piece (a strap): then the whole piece's width is the scale
      const [lo, hi] = span(y), wr = Math.max(1e-3, hi - lo), lo0 = mode === 'wrap' ? 0.3 : 0.55, q = Math.max(0, Math.min(1, (wr / Math.max(1e-3, bb.w) - lo0) / 0.25)), wt = q * q * (3 - 2 * q);
      const l0 = bb.x0 + (lo - bb.x0) * wt, w = Math.max(1e-3, bb.w + (wr - bb.w) * wt), f = (x - l0) / w;
      // a piece narrower than the way round the body keeps its own width (its seams then have a gap to pull shut); a wider one is gathered to fit
      const ring = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) * (mode === 'wrap' ? 1 : 0.5), arcSpan = (mode === 'wrap' ? 2 : 1) * Math.PI * Math.min(1, w / Math.max(1e-3, ring));
      const phi = (f - 0.5) * arcSpan + (arr.dx || 0) / (a || 1) + (mode === 'back' ? Math.PI : 0);
      return [a * Math.sin(phi), wy, b * Math.cos(phi)];
    };
  }

  // ── the project as a garment document ──
  function toDoc(P, opt) {
    const D = KD(), o = opt || {}, desc = o.avatar || (P.body ? bodyFromMeasures(P.body) : standardBody()), pieces = [], info = {};
    P.pieces.forEach((p) => {
      const fl = flatten(p), bb = bbox(fl.poly), local = fl.poly.map(([x, y]) => [r3(x - bb.x0), r3(y - bb.y0)]), sh = shares(p, fl);
      const map = arrangeMap(desc, p.arr, local); info[p.id] = { fl, sh, local, map };
      pieces.push({ id: p.id, pid: p.id, name: p.name, poly: local, labels: fl.labels, material: p.mat || 'main', grp: null, pinAll: false, placement: D.samplePlacement(local, map, 1) });
    });
    const pins = []; P.pieces.forEach((p) => p.edges.forEach((ed, e) => { if (ed.hold) { const s = info[p.id].sh[e]; pins.push({ piece: p.id, s0: r3(s.s0), s1: r3(e === p.edges.length - 1 ? 1.0001 : s.s1) }); } }));
    const where = (g, end) => { const p = byId(P, g.piece), e = p.edges.findIndex((x) => x.id === g.eid), I = info[p.id], q = I.local[end ? I.sh[e].i1 : I.sh[e].i0]; return I.map(q[0], q[1]); };
    const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
    const seams = [];
    P.seams.forEach((s) => {
      const ok = (g) => byId(P, g.piece) && byId(P, g.piece).edges.some((x) => x.id === g.eid); if (!s.a.every(ok) || !s.b.every(ok)) return;
      const A0 = where(s.a[0], false), A1 = where(s.a[s.a.length - 1], true), B0 = where(s.b[0], false), B1 = where(s.b[s.b.length - 1], true), auto = dist(A0, B0) + dist(A1, B1) > dist(A0, B1) + dist(A1, B0) + 1e-6, rev = auto !== !!s.flip;
      const mk = (g, r) => { const p = byId(P, g.piece), e = p.edges.findIndex((x) => x.id === g.eid), q = info[p.id].sh[e]; return { piece: g.piece, s0: r3(q.s0), s1: r3(e === p.edges.length - 1 ? 1.0001 : q.s1), rev: r || undefined }; };
      seams.push({ a: s.a.map((g) => mk(g, false)), b: (rev ? s.b.slice().reverse() : s.b).map((g) => mk(g, rev)), mode: 'share' });
    });
    seams.forEach((s) => s.b.forEach((g) => { if (g.rev === undefined) delete g.rev; })); seams.forEach((s) => s.a.forEach((g) => { delete g.rev; }));
    return { format: D.FORMAT, version: D.VERSION, unit: 'cm', name: P.name, block: null, fabric: { gsm: P.fabric && +P.fabric.gsm || 0 }, pieces, stitches: (P.stitches || []).filter((t) => info[t.a.piece] && info[t.b.piece]).map((t) => ({ a: [t.a.piece, t.a.s], b: [t.b.piece, t.b.s] })), seams, pins, avatar: desc, sim: { gravity: 980 } };
  }

  // ── a flat pattern as drawn, with its seam allowance, in true size (an SVG a plotter can print) ──
  function toSVG(P, allow) {
    const polys = P.pieces.map((p) => ({ p, line: flatten(p, 1).poly, cut: allow ? allowance(p, allow) : null })); if (!polys.length) return '';
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; polys.forEach((q) => (q.cut || q.line).forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
    x0 -= 2; y0 -= 2; x1 += 2; y1 += 2; const f = (v) => v.toFixed(2), d = (pl) => 'M' + pl.map((q) => f(q[0] - x0) + ' ' + f(q[1] - y0)).join('L') + 'Z';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + f(x1 - x0) + 'cm" height="' + f(y1 - y0) + 'cm" viewBox="0 0 ' + f(x1 - x0) + ' ' + f(y1 - y0) + '">' +
      polys.map((q) => (q.cut ? '<path d="' + d(q.cut) + '" fill="none" stroke="#c00" stroke-width="0.05" stroke-dasharray="0.4 0.3"/>' : '') + '<path d="' + d(q.line) + '" fill="none" stroke="#000" stroke-width="0.06"/>').join('') + '</svg>';
  }

  // ── starting points: not garments, just drawn pieces and seams to begin from ──
  const TEMPLATES = {
    skirt(P) {   // one trapezoid, its sides sewn, the top held at the waist
      const p = addPiece(P, [[13, 0], [97, 0], [110, 55], [0, 55]], 'Skirt', { arr: { mode: 'wrap', top: 108 } }); p.edges[0].label = 'waist'; p.edges[0].hold = true; p.edges[2].label = 'hem';
      sew(P, { piece: p.id, eid: p.edges[1].id }, { piece: p.id, eid: p.edges[3].id }); return p;
    },
    tube(P) {    // a front and a back, sewn at both sides, the top held
      const f = addPiece(P, [[0, 0], [44, 0], [48, 45], [-4, 45]], 'Front', { arr: { mode: 'front', top: 120 } }), b = addPiece(P, [[60, 0], [104, 0], [108, 45], [56, 45]], 'Back', { arr: { mode: 'back', top: 120 } });
      [f, b].forEach((p) => { p.edges[0].label = 'top'; p.edges[0].hold = true; p.edges[2].label = 'hem'; });
      sew(P, { piece: f.id, eid: f.edges[1].id }, { piece: b.id, eid: b.edges[3].id }); sew(P, { piece: f.id, eid: f.edges[3].id }, { piece: b.id, eid: b.edges[1].id }); return [f, b];
    },
  };

  const KAPat = { create, byId, addPiece, rect, ellipse, flatten, shares, edgeLen, area, bbox, inside, nearest, moveNode, moveHandle, toggleSmooth, translate, addNode, removeNode, removePiece, addDart, addNotch, addLine, mirrorCopy, mirrorFold, allowance, sew, unsew, addToSeam, flipSeam, stitch, unstitch, bodyFromMeasures, PRESETS, autoArrange, seamInfo, standardBody, arrangeMap, toDoc, toSVG, TEMPLATES, handles, seg, clone };
  root.KAPat = KAPat; if (typeof module !== 'undefined' && module.exports) module.exports = KAPat;
})(typeof window !== 'undefined' ? window : globalThis);
