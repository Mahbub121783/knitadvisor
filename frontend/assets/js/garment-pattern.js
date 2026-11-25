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
    const keys = [[Y(152), nr, nr], [Y(149.5), 8 * s, 7 * s], [Y(147.5), sh * 0.88, ch[1] * 0.78], [Y(143), sh * 0.97, ch[1] * 0.85], [Y(135), ch[0] * 1.02, ch[1] * 0.95], [Y(125), ch[0], ch[1]], [Y(108), wa[0], wa[1]], [Y(98), (wa[0] + hi[0]) / 2, (wa[1] + hi[1]) / 2], [Y(90), hi[0], hi[1]], [Y(80), hi[0] * 0.95, hi[1] * 0.92]].map((k) => k.map(r3));
    const rt = 8.5 * g, rk = 6.2 * g, ra = 4.2 * s, legs = (sg) => [[sg * lx, Y(82), 0, rt], [sg * lx, Y(45), 0, rk], [sg * lx, Y(6), 0, ra]], arms = (sg) => [[sg * ax, Y(143), 0, 4.8 * c], [sg * (ax + 8 * s), Y(112), 0, 3.6 * c], [sg * (ax + 11 * s), Y(86), 0, 2.8 * c]];
    const caps = []; [legs(1), legs(-1), arms(1), arms(-1)].forEach((L) => { for (let i = 0; i + 1 < L.length; i++) caps.push({ A: [r3(L[i][0]), L[i][1], 0], B: [r3(L[i + 1][0]), L[i + 1][1], 0], ra: r3(L[i][3]), rb: r3(L[i + 1][3]) }); });
    const limb = (L) => L.map((q) => q.map(r3));
    return { top: Y(178), loft: { from: Y(80), keys }, caps, spheres: [{ c: [0, Y(160), r3(1.5 * s)], r: r3(10.5 * Math.pow(s, 0.6)) }],
      limbs: { armL: limb(arms(1)), armR: limb(arms(-1)), legL: limb(legs(1)), legR: limb(legs(-1)) },
      anchors: { neck: Y(150), shoulder: Y(145), chest: Y(125), waist: Y(108), 'high hip': Y(98), hip: Y(90), crotch: Y(80), knee: Y(45), ankle: Y(6) }, measures: { height: m.height, chest: m.chest, waist: m.waist, hip: m.hip, shoulder: m.shoulder } };
  }
  // wrap a piece round a limb: its height runs down the limb, its width round it (the seam on the far side from the body's middle)
  function limbMap(desc, arr, poly, give) {
    const L = desc.limbs && desc.limbs[arr.mode]; if (!L) return null;
    const bb = bbox(poly), cl = [0]; for (let i = 1; i < L.length; i++) cl.push(cl[i - 1] + Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1], L[i][2] - L[i - 1][2]));
    const side = L[0][0] >= 0 ? 1 : -1, gap = arr.gap == null ? 1.2 : arr.gap, tot = cl[cl.length - 1], A0 = arr.auto ? autoAlong(desc, arr, poly, give) : null;
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return (x, y) => {
      const d0 = Math.min(tot, (y - bb.y0) + (A0 != null ? A0 : arr.along || 0)); let i = 0; while (i + 2 < L.length && cl[i + 1] < d0) i++;
      const t = Math.min(1, (d0 - cl[i]) / ((cl[i + 1] - cl[i]) || 1)), A = L[i], B = L[i + 1], ctr = [0, 1, 2].map((k) => A[k] + (B[k] - A[k]) * t), r = A[3] + (B[3] - A[3]) * Math.max(0, t) + gap;
      const dv = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], dl = Math.hypot(...dv) || 1, d = dv.map((v) => v / dl), o = [side, 0, 0], od = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], e1r = [o[0] - od * d[0], o[1] - od * d[1], o[2] - od * d[2]], el = Math.hypot(...e1r) || 1, e1 = e1r.map((v) => v / el), e2 = cross(d, e1);
      const f = (x - bb.x0) / Math.max(1e-3, bb.w), ring = 2 * Math.PI * r, span = 2 * Math.PI * Math.min(1, (bb.w * (1 + (give || 0))) / ring), phi = (f - 0.5) * span + (arr.dx || 0) / r;
      return [0, 1, 2].map((k) => ctr[k] + r * (Math.cos(phi) * e1[k] + Math.sin(phi) * e2[k]));
    };
  }
  // a first guess at where each piece hangs, from nothing but its shape and its seams: a piece sewn to itself is a tube (a limb if it is narrow, the torso if not),
  // two pieces sewn to each other twice are a front and a back. The person can change any of it.
  function autoArrange(P, desc) {
    const d = desc || bodyFromMeasures(P.body || { preset: 'female' }), an = d.anchors || { waist: 108, chest: 125, shoulder: 145 }, H = d.top || 178, taken = {};
    const limbR = d.limbs ? 2 * Math.PI * (d.limbs.armL[0][3] + 1.2) : 30;
    P.pieces.forEach((p) => {
      if (taken[p.id] || p.arr.mode === 'patch') return;
      const bb = bbox(flatten(p).poly), mine = P.seams.filter((s) => s.a.concat(s.b).some((g) => g.piece === p.id));
      const self = mine.some((s) => s.a.some((g) => g.piece === p.id) && s.b.some((g) => g.piece === p.id));
      const other = {}; mine.forEach((s) => s.a.concat(s.b).forEach((g) => { if (g.piece !== p.id) other[g.piece] = (other[g.piece] || 0) + 1; }));
      const pair = Object.keys(other).find((id) => other[id] >= 2 && !taken[id]), held = p.edges.some((e) => e.hold);
      delete p.arr.along; delete p.arr.auto;
      if (self && d.limbs && bb.w <= limbR * 2.2) { const arm = bb.h <= 0.4 * H; p.arr.mode = arm ? (taken.arm ? 'armR' : 'armL') : (taken.leg ? 'legR' : 'legL'); taken[arm ? 'arm' : 'leg'] = 1; taken[p.id] = 1; p.arr.auto = true; if (!P.body) P.body = { preset: 'female' }; return; }
      if (pair) { taken[p.id] = 1; taken[pair] = 1; const q = byId(P, pair), swap = /(back|rear)/i.test(p.name) || (q && /front/i.test(q.name)); p.arr.mode = swap ? 'back' : 'front'; if (q) q.arr.mode = swap ? 'front' : 'back'; } else p.arr.mode = 'wrap';
      const long = bb.h > 0.3 * H; p.arr.top = r3(held && !long ? an.waist : long ? an.neck : (an.chest));
      if (pair) { const q = byId(P, pair); if (q) q.arr.top = p.arr.top; }
    });
    return P;
  }

  // how much a piece's cloth gives across (a fraction): measured on the cloth if it was, else the family's typical
  function giveFor(P, p) {
    const K = KS(), fam = p.fab || (p.mat === 'rib' ? 'rib' : null) || (P.fabric && P.fabric.family), f = K && K.FAMILIES && K.FAMILIES[fam], st = P.fabric && P.fabric.stretch, x = st && st.x > 0 && !p.fab ? st.x : f ? f.x : 0; return Math.min(0.5, x * 0.9);
  }
  const KS = () => root.KASim || (typeof require !== 'undefined' ? require('./garment-sim.js') : null);
  // how far down the limb a piece must start to be clear of the rest of the body: the body without that limb, and the first rows of the piece must all be outside it
  function autoAlong(desc, arr, poly, give) {
    const L = desc.limbs && desc.limbs[arr.mode]; if (!L) return 0; const K = KS(); if (!K) return arr.along || 0;
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3, onLimb = (c) => L.some((q) => near(c.A, q) || near(c.B, q));
    const rest = K.avatar({ top: desc.top, loft: desc.loft, caps: (desc.caps || []).filter((c) => !onLimb(c)), spheres: desc.spheres || [] }), bb = bbox(poly), m = (d) => limbMap(desc, Object.assign({}, arr, { auto: false, along: d }), poly, give);
    for (let d = -8; d <= 45; d += 1) {
      const map = m(d); let ok = true;
      for (const y of [bb.y0, bb.y0 + Math.min(3, bb.h * 0.2)]) for (let k = 0; k <= 12 && ok; k++) { const q = map(bb.x0 + (bb.w * k) / 12, y); if (rest.sdf(q[0], q[1], q[2]) < 0.4) ok = false; }
      if (ok) return d;
    }
    return 45;
  }
  // ── is the arrangement good: for every piece, the way round the body where it hangs, the width it has, what it gives, whether it is inside the body ──
  const perim = (a, b) => ringOf(a, b);
  function pieceFacts(P, desc, p) {
    const fl = flatten(p), bb = bbox(fl.poly), ar = Math.abs(area(fl.poly)), meanW = ar / (bb.h || 1) - (p.pleats || []).reduce((t, q) => t + 2 * q.depth, 0), mode = p.arr.mode || 'wrap', gap = p.arr.gap == null ? (/^(arm|leg)/.test(mode) ? 1.2 : 1.5) : p.arr.gap;
    let ring = 0;
    if (/^(arm|leg)[LR]$/.test(mode) && desc.limbs && desc.limbs[mode]) { const L = desc.limbs[mode], dm = (p.arr.auto ? autoAlong(desc, p.arr, fl.poly.map(([x, y]) => [x - bb.x0, y - bb.y0]), 0) : p.arr.along || 0) + bb.h / 2; let acc = 0, r = L[L.length - 1][3]; for (let i = 1; i < L.length; i++) { const l = Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); if (dm <= acc + l || i === L.length - 1) { const t = Math.max(0, Math.min(1, (dm - acc) / (l || 1))); r = L[i - 1][3] + (L[i][3] - L[i - 1][3]) * t; break; } acc += l; } ring = 2 * Math.PI * (r + gap); }
    else { const wy = (p.arr.top || 0) - bb.h / 2, e = ellipseAt(desc, wy), q = p.arr.arc ? Math.max(0.05, p.arr.arc[1] - p.arr.arc[0]) : 1; ring = perim(e[0] + gap, e[1] + gap) * (mode === 'wrap' ? 1 : 0.5 * q); }
    const give = giveFor(P, p);
    return { fl, bb, meanW, ring, give, mode };
  }
  function arrangeReport(P, desc) {
    const d = desc || (P.body ? bodyFromMeasures(P.body) : standardBody()), K = KS(), sdf = K ? K.avatar(d).sdf : () => 1, out = [];
    P.pieces.forEach((p) => {
      if (p.arr.mode === 'patch') { out.push({ piece: p.name, id: p.id, mode: 'patch', status: 'ok', note: 'sewn on ' + ((byId(P, p.arr.on) || {}).name || 'another piece') }); return; }
      const f = pieceFacts(P, d, p), local = f.fl.poly.map(([x, y]) => [x - f.bb.x0, y - f.bb.y0]), map = arrangeMap(d, p.arr, local, f.give); let deep = 0;
      for (let k = 0; k < local.length; k += 2) { const q = map(local[k][0], local[k][1]), v = sdf(q[0], q[1], q[2]); if (v < deep) deep = v; }
      const need = f.ring - f.meanW * (1 + f.give), short = Math.max(0, need), loose = Math.max(0, f.meanW - f.ring * 1.25);
      let status = 'ok', note = 'fits: ' + f.meanW.toFixed(1) + ' cm across, ' + f.ring.toFixed(1) + ' cm round the body here';
      if (deep < -(/^(arm|leg)/.test(f.mode) ? 1.5 : 6)) { status = 'inside'; note = 'starts ' + (-deep).toFixed(1) + ' cm inside the body: ' + (/^(arm|leg)/.test(f.mode) ? 'start it lower on the limb' : 'move it, or hang it somewhere else'); }
      else if (short > 0.5 + 0.03 * f.ring) { status = 'narrow'; note = 'too narrow by ' + short.toFixed(1) + ' cm (' + f.meanW.toFixed(1) + ' cm for ' + f.ring.toFixed(1) + ' cm' + (f.give ? ', it gives ' + Math.round(f.give * 100) + ' %' : ', it does not stretch') + '): widen the piece or use a cloth that gives'; }
      else if (loose > 0) { status = 'wide'; note = 'wider than the body by ' + loose.toFixed(1) + ' cm: it will hang loose or gather'; }
      out.push({ piece: p.name, id: p.id, mode: f.mode, status, ring: f.ring, width: f.meanW, short_cm: short, loose_cm: loose, inside_cm: -deep, note });
    });
    return out;
  }
  // scale a piece across so that it goes round the body where it hangs (plus ease, cm in all); a piece that gives is brought to its ring less what it gives
  function fitToBody(P, pieceId, ease, desc) {
    const p = byId(P, pieceId); if (!p || p.arr.mode === 'patch') return null; const d = desc || (P.body ? bodyFromMeasures(P.body) : standardBody()), f = pieceFacts(P, d, p);
    const target = (f.ring + (ease == null ? 2 : ease)) / (1 + f.give * 0.5), k = target / (f.meanW || 1), cx = f.bb.x0 + f.bb.w / 2;
    p.nodes.forEach((N) => { N.x = r3(cx + (N.x - cx) * k); if (N.o) N.o = [N.o[0] * k, N.o[1]]; if (N.i) N.i = [N.i[0] * k, N.i[1]]; });
    (p.lines || []).forEach((l) => { l.a[0] = cx + (l.a[0] - cx) * k; l.b[0] = cx + (l.b[0] - cx) * k; }); (p.folds || []).forEach((q) => { q.a[0] = cx + (q.a[0] - cx) * k; q.b[0] = cx + (q.b[0] - cx) * k; }); (p.buttons || []).forEach((b) => { b.x = r3(cx + (b.x - cx) * k); });
    return { from: r3(f.meanW), to: r3(f.meanW * k), scale: r3(k) };
  }
  // ── the arrangement solved: every piece tries every way of hanging (round the body, on the front, on the back, round an arm or a leg; at each place on the body), and keeps the one where its seams meet
  // the pieces they are sewn to, it is outside the body, and it is as wide as the body is there. The pieces take turns, three rounds. ──
  function solveArrangement(P, opt) {
    const o = opt || {}, desc = o.desc || (P.body ? bodyFromMeasures(P.body) : standardBody()), K = KS(); if (!K) return { changed: [], note: 'the simulator is not loaded' };
    const sdf = K.avatar(desc).sdf, pre = {}, pcs = P.pieces.filter((p) => p.arr.mode !== 'patch');
    P.pieces.forEach((p) => { const fl = flatten(p), bb = bbox(fl.poly), sh = shares(p, fl); pre[p.id] = { fl, bb, sh, local: fl.poly.map(([x, y]) => [x - bb.x0, y - bb.y0]), give: pieceFacts(P, desc, p).give }; });
    // a side of a seam as a path: u in 0..1 along its edges, as a place on a piece
    const path = (side) => {
      const segs = side.map((g) => { const p = byId(P, g.piece), e = p ? p.edges.findIndex((x) => x.id === g.eid) : -1; if (e < 0) return null; const I = pre[p.id], n = I.fl.poly.length, i0 = I.sh[e].i0, i1 = I.sh[e].i1, pts = []; for (let i = i0; ; i = (i + 1) % n) { pts.push(I.local[i]); if (i === i1) break; } return { id: p.id, pts }; }).filter(Boolean);
      const lens = segs.map((sg) => { let t = 0; for (let i = 1; i < sg.pts.length; i++) t += Math.hypot(sg.pts[i][0] - sg.pts[i - 1][0], sg.pts[i][1] - sg.pts[i - 1][1]); return t; }), tot = lens.reduce((a, b) => a + b, 0) || 1;
      return (u) => { let d = u * tot; for (let k = 0; k < segs.length; k++) { if (d <= lens[k] + 1e-9 || k === segs.length - 1) { const sg = segs[k]; let acc = 0; d = Math.min(d, lens[k]); for (let i = 1; i < sg.pts.length; i++) { const l = Math.hypot(sg.pts[i][0] - sg.pts[i - 1][0], sg.pts[i][1] - sg.pts[i - 1][1]); if (acc + l >= d - 1e-9 || i === sg.pts.length - 1) { const t = l ? Math.min(1, (d - acc) / l) : 0; return { id: sg.id, x: sg.pts[i - 1][0] + (sg.pts[i][0] - sg.pts[i - 1][0]) * t, y: sg.pts[i - 1][1] + (sg.pts[i][1] - sg.pts[i - 1][1]) * t }; } acc += l; } } d -= lens[k]; } return { id: segs[0].id, x: 0, y: 0 }; };
    };
    const seams = P.seams.map((sm) => ({ sm, pa: path(sm.a), pb: path(sm.b), pieces: new Set(sm.a.concat(sm.b).map((g) => g.piece)) })), U = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1];
    const maps = {}; const mk = (p, arr) => arrangeMap(desc, arr, pre[p.id].local, pre[p.id].give);
    pcs.forEach((p) => { maps[p.id] = mk(p, p.arr); }); P.pieces.filter((p) => p.arr.mode === 'patch').forEach(() => {});
    const cost = (p, arr, map) => {
      const I = pre[p.id]; let c = 0;
      seams.forEach((S) => {
        if (!S.pieces.has(p.id)) return; const at = (ps, u) => { const q = ps(u), m = q.id === p.id ? map : maps[q.id]; return m ? m(q.x, q.y) : null; };
        let f = 0, r = 0, n = 0; U.forEach((u) => { const a = at(S.pa, u), bq = at(S.pb, u), br = at(S.pb, 1 - u); if (!a || !bq || !br) return; f += Math.hypot(a[0] - bq[0], a[1] - bq[1], a[2] - bq[2]); r += Math.hypot(a[0] - br[0], a[1] - br[1], a[2] - br[2]); n++; });
        if (n) c += Math.min(f, r) / n;
      });
      if (/^(arm|leg)/.test(arr.mode) && pcs.some((q) => q !== p && q.arr.mode === arr.mode)) c += 2;      // two pieces on one limb is the one thing the other limb is for
      let deep = 0, cnt = 0; for (let k = 0; k < I.local.length; k += 3) { const q = map(I.local[k][0], I.local[k][1]), v = sdf(q[0], q[1], q[2]); if (v < 0) { deep += -v; cnt++; } } c += (deep / Math.max(1, I.local.length / 3)) * 0.6;
      // what the person called the piece says where it goes (front, back): a hint that breaks a tie between a drape and its mirror image, never a rule
      if (/front/i.test(p.name)) c += arr.mode === 'front' ? 0 : arr.mode === 'back' ? 1.5 : 0.8; else if (/(back|rear)/i.test(p.name)) c += arr.mode === 'back' ? 0 : arr.mode === 'front' ? 1.5 : 0.8;
      const facts = pieceFacts(P, desc, Object.assign({}, p, { arr })), need = facts.ring - facts.meanW * (1 + facts.give); if (need > 0.5) c += 0.35 * need; if (facts.meanW > facts.ring * 1.4) c += 0.05 * (facts.meanW - facts.ring * 1.4); if (/^(arm|leg)/.test(arr.mode) && facts.meanW > facts.ring * 1.15) c += 0.3 * (facts.meanW - facts.ring * 1.15);
      { const hl = p.edges.reduce((t, e, k) => t + (e.hold ? I.sh[k].len : 0), 0); if (hl > 0.5 * I.bb.w && !/^(arm|leg)/.test(arr.mode)) { const e0 = ellipseAt(desc, arr.top || 0), q = arr.arc ? Math.max(0.05, arr.arc[1] - arr.arc[0]) : 1, rt = perim(e0[0] + 1.5, e0[1] + 1.5) * (arr.mode === 'wrap' ? 1 : 0.5 * q); c += 0.25 * Math.abs(hl * (1 + pre[p.id].give) - rt); } }
      if (!/^(arm|leg)/.test(arr.mode) && p.edges.some((e) => e.hold)) { let nd = 1e9; Object.values(desc.anchors || {}).forEach((a) => { nd = Math.min(nd, Math.abs((arr.top || 0) - a)); }); c += 0.2 * nd; }
      if (!/^(arm|leg)/.test(arr.mode)) { const bottom = (arr.top || 0) - I.bb.h; if (bottom < -1) c += 0.5 * (-bottom); } else { const L = desc.limbs[arr.mode]; let tot = 0; for (let i = 1; i < L.length; i++) tot += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); if (I.bb.h > tot + 8) c += 0.4 * (I.bb.h - tot - 8); }
      return c;
    };
    const anchors = Object.values(desc.anchors || { waist: 108, chest: 125 }), tops = new Set(); anchors.forEach((a) => [-10, -5, 0, 5, 10].forEach((d) => { const t = Math.round((a + d) * 2) / 2; if (t > 20 && t < (desc.top || 180)) tops.add(t); }));
    const before = {}; pcs.forEach((p) => { before[p.id] = p.arr.mode + '@' + Math.round(p.arr.top || 0); });
    for (let pass = 0; pass < (o.rounds || 3); pass++) {
      let moved = false;
      pcs.forEach((p) => {
        const cur = Object.assign({}, p.arr); let best = { c: cost(p, cur, maps[p.id]) - 0.0001, arr: cur, map: maps[p.id] };
        const modes = cur.arc ? ['front', 'back'] : ['wrap', 'front', 'back'].concat(desc.limbs ? ['armL', 'armR', 'legL', 'legR'] : []);
        modes.forEach((mode) => {
          const limb = /^(arm|leg)/.test(mode), tl = limb ? [cur.top || 0] : Array.from(tops), alongs = limb ? [null, -12, -8, -4, 0, 4, 8, 12, 16, 20] : [0];
          tl.forEach((t) => alongs.forEach((al) => {
            const arr = Object.assign({}, cur, { mode, top: t }); if (limb) { if (al == null) { arr.auto = true; delete arr.along; } else { arr.auto = false; arr.along = al; } } else { delete arr.auto; arr.along = cur.along || 0; if (mode === 'wrap') delete arr.arc; }
            const map = mk(p, arr), c = cost(p, arr, map) + 0.02 * Math.abs(t - (cur.top || 0)) * (/^(arm|leg)/.test(mode) ? 0 : 1);
            if (c < best.c - 1e-6) best = { c, arr, map };
          }));
        });
        if (best.arr !== cur) { p.arr = best.arr; maps[p.id] = best.map; moved = true; }
      });
      if (!moved) break;
    }
    if (pcs.some((p) => /^(arm|leg)/.test(p.arr.mode)) && !P.body) P.body = { preset: 'female' };
    return { changed: pcs.filter((p) => before[p.id] !== p.arr.mode + '@' + Math.round(p.arr.top || 0)).map((p) => ({ piece: p.name, from: before[p.id], to: p.arr.mode + '@' + Math.round(p.arr.top || 0) })), report: arrangeReport(P, desc) };
  }
  const bodyDesc = (P) => (P.body ? bodyFromMeasures(P.body) : standardBody());
  // where each flat point of a piece starts in 3D, as the document will have it (a patch is placed on the piece it goes on)
  function mapFor(P, p, desc) {
    const d = desc || bodyDesc(P), f = pieceFacts(P, d, p), local = f.fl.poly.map(([x, y]) => [x - f.bb.x0, y - f.bb.y0]), par = p.arr.mode === 'patch' ? byId(P, p.arr.on) : null;
    return pieceMap(P, p, d, Math.max(0.06, giveFor(P, p)), f.fl, f.bb, local, shares(p, f.fl), par && par.arr.mode !== 'patch' ? mapFor(P, par, d) : null);
  }
  // the first guess, then the solver
  function arrange(P, desc) {
    const key = (p) => p.arr.mode + '@' + Math.round(p.arr.top || 0), before = {}; P.pieces.forEach((p) => { before[p.id] = key(p); });
    autoArrange(P, desc); const r = solveArrangement(P, { desc }); r.changed = P.pieces.filter((p) => p.arr.mode !== 'patch' && before[p.id] !== key(p)).map((p) => ({ piece: p.name, from: before[p.id], to: key(p) })); return r;
  }
  // the angle of the point that is s cm round an ellipse (a, b) from its front, by the length of the curve; tables are kept for the ellipses already seen
  const ARCS = new Map();
  function arcTable(a, b) {
    const key = Math.round(a * 20) + ':' + Math.round(b * 20); let t = ARCS.get(key); if (t) return t;
    const n = 180, ph = new Float64Array(n + 1), ar = new Float64Array(n + 1); let acc = 0;
    for (let i = 0; i <= n; i++) { ph[i] = (i / n) * (Math.PI / 2); if (i) { const m = (ph[i] + ph[i - 1]) / 2; acc += Math.sqrt(a * a * Math.cos(m) * Math.cos(m) + b * b * Math.sin(m) * Math.sin(m)) * (ph[i] - ph[i - 1]); } ar[i] = acc; }
    const q = acc, per = 4 * q;       // a quarter of the way round, and all of it
    const quarter = (s) => { if (s <= 0) return 0; if (s >= q) return Math.PI / 2; let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ar[m] <= s) lo = m; else hi = m; } const u = (s - ar[lo]) / ((ar[hi] - ar[lo]) || 1); return ph[lo] + (ph[hi] - ph[lo]) * u; };
    // x = a sin(phi), z = b cos(phi): phi = 0 is the front, a quarter turn is the side; any length, either way round
    t = { per, phi(s) { let w = ((s % per) + per) % per; if (w > per / 2) w -= per; const sg = w < 0 ? -1 : 1; w = Math.abs(w); return sg * (w <= q ? quarter(w) : w <= 2 * q ? Math.PI - quarter(2 * q - w) : Math.PI); } };
    if (ARCS.size > 400) ARCS.delete(ARCS.keys().next().value); ARCS.set(key, t); return t;
  }
  // where the flat point (x, y) of a piece starts, in 3D. wrap: the width of the piece round the body once (row by row); front / back: the half of the body, side to side
  function arrangeMap(desc, arr, poly, give) {
    if (/^(arm|leg)[LR]$/.test(arr.mode || '')) { const lm = limbMap(desc, arr, poly, give); if (lm) return lm; }
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
      const aq = arr.arc && mode !== 'wrap' ? Math.max(0.05, arr.arc[1] - arr.arc[0]) : 1, cen = arr.arc && mode !== 'wrap' ? (arr.arc[0] + arr.arc[1]) / 2 - 0.5 : 0, ring = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) * (mode === 'wrap' ? 1 : 0.5) * aq, arcSpan = (mode === 'wrap' ? 2 : 1) * Math.PI * aq * Math.min(1, (w * (1 + (give || 0))) / Math.max(1e-3, ring));
      // the way round is measured along the body (cm), not in angle: on an ellipse an equal step in angle is not an equal step of cloth, and a piece laid on it would start stretched and squeezed
      const tab = arcTable(a, b), turn = ((f - 0.5) * arcSpan) / (2 * Math.PI) + cen * 0.5 + (arr.dx || 0) / tab.per, phi = tab.phi(turn * tab.per) + (mode === 'back' ? Math.PI : 0);
      let X = a * Math.sin(phi), Z = b * Math.cos(phi);
      // a gathered edge: the cloth is brought in to the body by the ratio of its width to the way round, and what is brought in stands out as waves (sine waves whose length of curve is the length of cloth taken up), fading away from the edge
      const gz = arr.gather; if (gz && gz.zone > 0) {
        const dist = gz.side === 'bottom' ? bb.y1 - y : y - bb.y0;
        if (dist < gz.zone) { const ratio = (w * (1 + (give || 0))) / Math.max(1e-3, ring), wgt = Math.pow(1 - dist / gz.zone, 2), lam = gz.wave || 3.5, amp = Math.min(2.5, (lam / Math.PI) * Math.sqrt(Math.max(0, ratio - 1))) * wgt, nx = Math.sin(phi) / a, nz = Math.cos(phi) / b, nl = Math.hypot(nx, nz) || 1, off = amp * Math.sin((2 * Math.PI * turn * tab.per) / lam); X += (nx / nl) * off; Z += (nz / nl) * off; }
      }
      return [X, wy, Z];
    };
  }

  // where each flat point of a piece starts in 3D: on the body by its arrangement, folded by its pleats, with the waves of a gathered edge; a patch on the piece below it
  function pieceMap(P, p, desc, give, fl, bb, local, sh, parentMap) {
    let map;
      if (p.arr.mode === 'patch' && parentMap) map = patchMap(parentMap, p.arr);
      else {
        let arr = p.arr.mode === 'patch' ? Object.assign({}, p.arr, { mode: 'wrap' }) : p.arr;
        const ge = p.edges.findIndex((e) => e.gather); if (ge >= 0 && !/^(arm|leg)/.test(arr.mode)) { const q = sh[ge], ym = (fl.poly[q.i0][1] + fl.poly[q.i1][1]) / 2; arr = Object.assign({}, arr, { gather: { side: Math.abs(ym - bb.y0) <= Math.abs(ym - bb.y1) ? 'top' : 'bottom', zone: Math.min(14, 0.3 * bb.h), wave: 3.5 } }); }
        if ((p.pleats || []).length) {          // the pleated piece is laid on the body at the width it has once folded, and each point is put where its fold puts it
          const xf = pleatXform(p.pleats.map((q) => Object.assign({}, q, { x: q.x - bb.x0 }))), vloc = local.map(([x, y]) => [xf(x).p, y]), m0 = arrangeMap(desc, arr, vloc, give), e = 0.6;
          map = (x, y) => { const t = xf(x), P0 = m0(t.p, y); if (!t.level) return P0; const A = m0(t.p + e, y), B = m0(t.p, y + e), t1 = [A[0] - P0[0], A[1] - P0[1], A[2] - P0[2]], t2 = [B[0] - P0[0], B[1] - P0[1], B[2] - P0[2]]; let n = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]]; const nl = Math.hypot(...n) || 1, out = n[0] * P0[0] + n[2] * P0[2] < 0 ? -1 : 1, g = -t.level * PLEAT_GAP * out / nl; return [P0[0] + n[0] * g, P0[1] + n[1] * g, P0[2] + n[2] * g]; };
        } else map = arrangeMap(desc, arr, local, give);
      }
    return map;
  }

  // ── the project as a garment document ──
  function toDoc(P, opt) {
    const D = KD(), o = opt || {}, desc = o.avatar || (P.body ? bodyFromMeasures(P.body) : standardBody()), pieces = [], info = {}, trims = [], topstitch = [], extra = [];
    const KS = root.KASim || (typeof require !== 'undefined' ? require('./garment-sim.js') : null), giveOf = (p) => Math.max(0.06, giveFor(P, p));      // a piece a little narrow for its ring is put on slightly stretched all over (6 % at least), so its seam closes with the strain spread, not as a few overstretched edges
    const place = (p) => {
      const fl = flatten(p), bb = bbox(fl.poly), local = fl.poly.map(([x, y]) => [r3(x - bb.x0), r3(y - bb.y0)]), sh = shares(p, fl);
      const map = pieceMap(P, p, desc, giveOf(p), fl, bb, local, sh, p.arr.mode === 'patch' && info[p.arr.on] ? info[p.arr.on].map : null);
      info[p.id] = { fl, sh, local, map, bb };
    };
    P.pieces.filter((p) => p.arr.mode !== 'patch').forEach(place); P.pieces.filter((p) => p.arr.mode === 'patch').forEach(place);
    P.pieces.forEach((p) => {
      const I = info[p.id], bx = I.bb.x0, by = I.bb.y0, fam = p.fab || null;
      pieces.push(Object.assign({ id: p.id, pid: p.id, name: p.name, poly: I.local, labels: I.fl.labels, material: p.mat || 'main', grp: null, pinAll: false, placement: D.samplePlacement(I.local, I.map, 1) }, fam ? { fab: fam } : {},
        (p.folds || []).length || (p.pleats || []).length ? { folds: (p.folds || []).concat(pleatFolds(p, I.bb)).map((f) => ({ a: [r3(f.a[0] - bx), r3(f.a[1] - by)], b: [r3(f.b[0] - bx), r3(f.b[1] - by)], angle: f.angle })) } : {}));
      (p.buttons || []).forEach((b) => trims.push({ kind: 'button', piece: p.id, x: r3(b.x - bx), y: r3(b.y - by), r: b.r || 0.6 }));
      p.edges.forEach((ed, e) => { const q = I.sh[e]; if (ed.topstitch) topstitch.push({ piece: p.id, s0: r3(q.s0), s1: r3(e === p.edges.length - 1 ? 1.0001 : q.s1) }); });
    });
    // a patch (a pocket, a label) sewn down along the edges marked so: its outline is stitched to the point of the piece below it where it lies
    P.pieces.forEach((p) => {
      if (p.arr.mode !== 'patch' || !info[p.arr.on]) return; const I = info[p.id], px = (p.arr.x || 0) - 0, py = (p.arr.y || 0), parent = info[p.arr.on];
      p.edges.forEach((ed, e) => {
        if (!ed.attach) return; const c = seg(p, e), L = I.sh[e].len, n = Math.max(1, Math.ceil(L / 2)), q = I.sh[e];
        for (let k = 0; k <= n; k++) { const pt = bez(c, k / n), lx = pt[0] - I.bb.x0, ly = pt[1] - I.bb.y0; extra.push({ a: [p.id, r3((q.s0 + (q.s1 - q.s0) * (k / n)) % 1)], b: [p.arr.on, null, r3(lx + px), r3(ly + py)] }); }
      });
    });
    const pins = []; P.pieces.forEach((p) => p.edges.forEach((ed, e) => { if (ed.hold) { const s = info[p.id].sh[e]; pins.push({ piece: p.id, s0: r3(s.s0), s1: r3(e === p.edges.length - 1 ? 1.0001 : s.s1) }); } }));
    const where = (g, end) => { const p = byId(P, g.piece), e = p.edges.findIndex((x) => x.id === g.eid), I = info[p.id], q = I.local[end ? I.sh[e].i1 : I.sh[e].i0]; return I.map(q[0], q[1]); };
    const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
    const seams = [];
    P.seams.forEach((s) => {
      const ok = (g) => byId(P, g.piece) && byId(P, g.piece).edges.some((x) => x.id === g.eid); if (!s.a.every(ok) || !s.b.every(ok)) return;
      const A0 = where(s.a[0], false), A1 = where(s.a[s.a.length - 1], true), B0 = where(s.b[0], false), B1 = where(s.b[s.b.length - 1], true), auto = dist(A0, B0) + dist(A1, B1) > dist(A0, B1) + dist(A1, B0) + 1e-6, rev = auto !== !!s.flip;
      const mk = (g, r) => { const p = byId(P, g.piece), e = p.edges.findIndex((x) => x.id === g.eid), q = info[p.id].sh[e]; return { piece: g.piece, s0: r3(q.s0), s1: r3(e === p.edges.length - 1 ? 1.0001 : q.s1), rev: r || undefined }; };
      seams.push(Object.assign({ a: s.a.map((g) => mk(g, false)), b: (rev ? s.b.slice().reverse() : s.b).map((g) => mk(g, rev)), mode: 'share' }, s.zip ? { zip: true } : {}));
    });
    seams.forEach((s) => s.b.forEach((g) => { if (g.rev === undefined) delete g.rev; })); seams.forEach((s) => s.a.forEach((g) => { delete g.rev; }));
    return { format: D.FORMAT, version: D.VERSION, unit: 'cm', name: P.name, block: null, fabric: Object.assign({ gsm: P.fabric && +P.fabric.gsm || 0 }, P.fabric && P.fabric.family ? { family: P.fabric.family } : {}, P.fabric && P.fabric.stretch ? { stretch: P.fabric.stretch } : {}, P.fabric && P.fabric.bend_len > 0 ? { bend_len: P.fabric.bend_len } : {}, P.fabric && P.fabric.friction > 0 ? { friction: P.fabric.friction } : {}, P.fabric && P.fabric.thick_mm > 0 ? { thick_mm: P.fabric.thick_mm } : {}), pieces, stitches: (P.stitches || []).filter((t) => info[t.a.piece] && info[t.b.piece]).map((t) => { const end = (e) => (e.s != null ? [e.piece, e.s] : [e.piece, null, r3(e.x - info[e.piece].bb.x0), r3(e.y - info[e.piece].bb.y0)]); return { a: end(t.a), b: end(t.b) }; }).concat(extra), seams, pins, trims, topstitch, avatar: desc, sim: Object.assign({ gravity: 980 }, P.pieces.some((p) => p.arr.mode === 'patch' || (p.folds || []).length || (p.pleats || []).length) ? { selfCollide: true } : {}) };
  }

  // ── details ──
  // where a patch starts: on the piece below, at (x, y) of that piece, a hair off its surface (outward from the body)
  function patchMap(parentMap, arr) {
    const gap = arr.gap == null ? 1 : arr.gap, px = arr.x || 0, py = arr.y || 0, e = 0.5;
    return (x, y) => {
      const u = x + px, v = y + py, P0 = parentMap(u, v), A = parentMap(u + e, v), B = parentMap(u, v + e), t1 = [A[0] - P0[0], A[1] - P0[1], A[2] - P0[2]], t2 = [B[0] - P0[0], B[1] - P0[1], B[2] - P0[2]];
      let n = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]]; const nl = Math.hypot(...n) || 1; n = n.map((c) => c / nl);
      const out = n[0] * P0[0] + n[2] * P0[2] < 0 ? -1 : 1;                                   // outward = away from the body's upright axis
      return [P0[0] + out * n[0] * gap, P0[1] + out * n[1] * gap, P0[2] + out * n[2] * gap];
    };
  }
  // a crease: a line across a piece that its cloth is held folded along, to `angle` degrees (180 is flat)
  const addFold = (p, a, b, angle) => { p.folds = p.folds || []; p.folds.push({ a: [r3(a[0]), r3(a[1])], b: [r3(b[0]), r3(b[1])], angle: angle == null ? 60 : angle }); return p.folds.length - 1; };
  // a pleat: two creases across the piece, one folded the one way and one the other, `width` apart
  function addPleat(p, x, width, angle) { const bb = bbox(flatten(p).poly); return [addFold(p, [x, bb.y0 - 1], [x, bb.y1 + 1], angle == null ? 40 : angle), addFold(p, [x + width, bb.y0 - 1], [x + width, bb.y1 + 1], angle == null ? 40 : angle)]; }
  const addButton = (p, x, y, r) => { p.buttons = p.buttons || []; p.buttons.push({ x: r3(x), y: r3(y), r: r || 0.6 }); return p.buttons.length - 1; };
  const setZip = (P, seamId, on) => { const s = P.seams.find((q) => q.id === seamId); if (s) s.zip = !!on; return !!s; };
  // hold a point inside one piece to a point inside another (a button to its hole, a tack through two layers)
  function tack(P, a, b) { if (!byId(P, a.piece) || !byId(P, b.piece)) return null; P.stitches = P.stitches || []; const t = { id: nid(P, 't'), a: { piece: a.piece, x: r3(a.x), y: r3(a.y) }, b: { piece: b.piece, x: r3(b.x), y: r3(b.y) } }; P.stitches.push(t); return t; }
  const setFabric = (P, family, gsm) => { if (family != null) { if (family) P.fabric.family = family; else delete P.fabric.family; } if (gsm) P.fabric.gsm = gsm; };


  // ── pleats: cloth that is folded away, not cut away ──
  //   p.pleats = [{ x, depth, dir }]  x: where it starts in the flat piece; a knife pleat of depth d takes up 3 d of cloth and shows d of it (so 2 d more cloth than the place it goes to);
  //   dir -1 turns the folds the other way (outward); a box pleat is a knife pleat each way
  const PLEAT_GAP = 0.9;
  function pleatXform(pleats) {
    const L = (pleats || []).slice().sort((a, b) => a.x - b.x);
    return (x) => {
      let shift = 0;
      for (const q of L) {
        const d = q.depth, x0 = q.x, s = x - x0;
        if (s <= 0) break;
        if (s >= 3 * d) { shift += 2 * d; continue; }
        const p0 = x0 - shift, f = s < d ? s : s < 2 * d ? 2 * d - s : s - 2 * d, lv = s < d ? 0 : s < 2 * d ? 1 : 2;
        return { p: p0 + f, level: lv * (q.dir === -1 ? -1 : 1) };
      }
      return { p: x - shift, level: 0 };
    };
  }
  const addPleatReal = (p, x, depth, dir) => { p.pleats = p.pleats || []; p.pleats.push({ x: r3(x), depth: r3(depth), dir: dir === -1 ? -1 : 1 }); return p.pleats.length - 1; };
  // n pleats across an edge range: from x0 to x1 (in the flat piece), each a knife pleat of this depth; box = true makes each a box (a pleat each way)
  function addPleatSet(p, x0, x1, n, depth, box) {
    const out = []; for (let k = 0; k < n; k++) { const x = x0 + ((x1 - x0) * (k + 0.5)) / n - (box ? 3 * depth : 1.5 * depth); out.push(addPleatReal(p, x, depth, 1)); if (box) out.push(addPleatReal(p, x + 3 * depth, depth, -1)); } return out;
  }
  // the pleats' own folds, as the creases that hold them folded
  const pleatFolds = (p, bb) => (p.pleats || []).reduce((l, q) => l.concat([[q.x + q.depth], [q.x + 2 * q.depth]].map(([x]) => ({ a: [x, bb.y0 - 1], b: [x, bb.y1 + 1], angle: 14 }))), []);
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

  const KAPat = { create, byId, addPiece, rect, ellipse, flatten, shares, edgeLen, area, bbox, inside, nearest, moveNode, moveHandle, toggleSmooth, translate, addNode, removeNode, removePiece, addDart, addNotch, addLine, mirrorCopy, mirrorFold, allowance, addFold, addPleat, addPleatReal, addPleatSet, pleatXform, addButton, setZip, tack, setFabric, patchMap, sew, unsew, addToSeam, flipSeam, stitch, unstitch, bodyFromMeasures, PRESETS, autoArrange, arrange, solveArrangement, bodyDesc, mapFor, arrangeReport, fitToBody, autoAlong, seamInfo, standardBody, arrangeMap, toDoc, toSVG, TEMPLATES, handles, seg, clone };
  root.KAPat = KAPat; if (typeof module !== 'undefined' && module.exports) module.exports = KAPat;
})(typeof window !== 'undefined' ? window : globalThis);
