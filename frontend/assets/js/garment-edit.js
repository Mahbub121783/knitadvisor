/**
 * KnitAdvisor — Garment Studio: the pattern editor (garment.html, "Edit" tab)
 *
 * The engine (garment-pattern.js) draws every piece as anchors joined by straight edges and cubic Béziers, in the finished size. This is the hand on it:
 *   · drag an anchor or a handle; type its place; nudge it with the arrows; add a node on an edge; delete one; make an edge straight or a curve;
 *   · measure between two anchors or along an edge; correct a measurement (the anchors that make it move); lengthen, shorten or widen at a line;
 *   · undo and redo; reset a piece; copy an edit to every size.
 * A move is stored as an EDIT (a delta on the chart's anchor), so it survives a change of the chart; adding or deleting an anchor makes the piece MANUAL
 * (every anchor stored). The page keeps the edits in its state and posts them with the chart; the engine answers with the new pieces, the measurements, the seams
 * and the checks. Nothing here decides what a piece is: it only says what the hand did.
 *
 * Plain script. window.KAGarmentEdit: init(host), render(), fit().
 */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var EDGE = { neck: '#d97706', bandneck: '#d97706', shoulder: '#7a4fc2', armhole: '#1857C4', cap: '#1857C4', side: '#0e7490', sidehem: '#0e7490', underarm: '#0e7490', underarmhem: '#0e7490', hem: '#6b7280', shem: '#6b7280', bandend: '#0e7490', cf: '#c2410c', faceend: '#6b7280', faceedge: '#6b7280' };
  var SEAM_OF = { neck: 'neck', bandneck: 'neck', shoulder: 'shoulder', armhole: 'armhole', cap: 'armhole', side: 'side', sidehem: 'side', underarm: 'underarm', underarmhem: 'underarm', hem: 'hem', shem: 'sleeve_hem', bandend: 'band_end' };
  var PIECES = [['front', 'Front'], ['back', 'Back'], ['sleeve', 'Sleeve'], ['band', 'Neck band']], PIECES_SH = [['front', 'Front leg'], ['back', 'Back leg'], ['waistband', 'Waistband'], ['pbag', 'Pocket bag'], ['bpocket', 'Back pocket']];
  var FIXSH = {
    outseam: [['front', 'hem_inner', 'y', 1], ['front', 'hem_inner_b', 'y', 1], ['front', 'hem_outer', 'y', 1], ['front', 'hem_outer_b', 'y', 1], ['back', 'hem_inner', 'y', 1], ['back', 'hem_inner_b', 'y', 1], ['back', 'hem_outer', 'y', 1], ['back', 'hem_outer_b', 'y', 1]],
    front_rise: [['front', 'crotch', 'y', 1], ['front', 'crotch_start', 'y', 1]], back_rise: [['back', 'cf_top', 'y', -1]],
    waist_stretched: [['front', 'cf_top', 'x', 0.5], ['back', 'cf_top', 'x', 0.5]], seat_w: [['front', 'seat', 'x', 0.5], ['front', 'crotch_start', 'x', 0.5], ['back', 'seat', 'x', 0.5], ['back', 'crotch_start', 'x', 0.5]],
    seat_pos: [['front', 'seat', 'y', 1], ['back', 'seat', 'y', 1]], thigh: [['front', 'crotch', 'x', 1], ['back', 'crotch', 'x', 1]],
    leg_opening: [['front', 'hem_inner', 'x', 1], ['front', 'hem_inner_b', 'x', 1], ['back', 'hem_inner', 'x', 1], ['back', 'hem_inner_b', 'x', 1]],
    hem_h: [['front', 'hem_inner_b', 'y', 1], ['front', 'hem_outer_b', 'y', 1], ['back', 'hem_inner_b', 'y', 1], ['back', 'hem_outer_b', 'y', 1]],
    fpocket_l: [['front', 'pocket_side', 'y', 1]], fpocket_w: [['front', 'pocket_top', 'x', 1]]
  };
  function isSh() { var S = H && H.state(); return !!(S && S.style === 'shorts'); }
  function fixFor(key) { return (isSh() ? FIXSH : FIX)[key]; }
  // a correctable measurement: the anchors that move (piece, role, which way, how much of the change each takes)
  var FIX = {
    chest: [['front', 'underarm', 'x', 0.5], ['back', 'underarm', 'x', 0.5]],
    shoulder: [['front', 'shoulder_tip', 'x', 0.5], ['back', 'shoulder_tip', 'x', 0.5]],
    neck_w: [['front', 'neck_point', 'x', 0.5], ['back', 'neck_point', 'x', 0.5]],
    hem: [['front', 'hem_corner', 'x', 0.5], ['front', 'hem_bottom', 'x', 0.5], ['back', 'hem_corner', 'x', 0.5], ['back', 'hem_bottom', 'x', 0.5]],
    length: [['front', 'hem_corner', 'y', 1], ['front', 'hem_bottom', 'y', 1], ['front', 'cf_hem', 'y', 1], ['back', 'hem_corner', 'y', 1], ['back', 'hem_bottom', 'y', 1], ['back', 'cf_hem', 'y', 1]],
    neck_df: [['front', 'cf_neck', 'y', 1]], neck_db: [['back', 'cf_neck', 'y', 1]],
    slope: [['front', 'shoulder_tip', 'y', 1], ['back', 'shoulder_tip', 'y', 1]],
    hem_h: [['front', 'hem_bottom', 'y', 1], ['front', 'cf_hem', 'y', 1], ['back', 'hem_bottom', 'y', 1], ['back', 'cf_hem', 'y', 1]],
    sleeve_l: [['sleeve', 'cuff_corner', 'y', 1], ['sleeve', 'cuff_bottom', 'y', 1], ['sleeve', 'cuff_centre', 'y', 1]],
    bicep: [['sleeve', 'underarm', 'x', 1]], sleeve_o: [['sleeve', 'cuff_corner', 'x', 1], ['sleeve', 'cuff_bottom', 'x', 1]],
    sleeve_hem_h: [['sleeve', 'cuff_bottom', 'y', 1], ['sleeve', 'cuff_centre', 'y', 1]], rib_w: [],
  };
  var H = null, host = null, GAIN = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 1.7 : 1;
  var E = { pid: 'front', tool: 'select', sel: null, vb: null, fitFor: '', drag: null, work: null, undo: [], redo: [], meas: [], pend: null, snap: true };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var r4 = function (v) { return Math.round(v * 10000) / 10000; };
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (parent) parent.appendChild(e); return e; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ── what the engine said ──
  function cur() { var R = H.result(); return R && R.success ? (R.by_size.filter(function (s) { return s.size === H.size(); })[0] || R.by_size[0]) : null; }
  function isCorner(o, i, a) { var f = (H.state().cornerFlags || {})[o.size + '|' + E.pid + '|' + i]; return f == null ? !!a.corner : f; }
  function pieceInfo(o) { return o && o.edit ? o.edit[E.pid] : null; }
  function anchorsNow(o) { return E.work || (pieceInfo(o) ? pieceInfo(o).anchors : []); }
  function edits() { var S = H.state(); S.edits = S.edits || {}; return S.edits; }
  function sizeEdits(size) { var e = edits(); e[size] = e[size] || {}; return e[size]; }

  // ── geometry on anchors ──
  function ctl(a, b) { if (!a.hout && !b.hin) return null; return [[a.x, a.y], a.hout ? [a.x + a.hout[0], a.y + a.hout[1]] : [a.x, a.y], b.hin ? [b.x + b.hin[0], b.y + b.hin[1]] : [b.x, b.y], [b.x, b.y]]; }
  function bz(c, t) { var u = 1 - t; return [u * u * u * c[0][0] + 3 * u * u * t * c[1][0] + 3 * u * t * t * c[2][0] + t * t * t * c[3][0], u * u * u * c[0][1] + 3 * u * u * t * c[1][1] + 3 * u * t * t * c[2][1] + t * t * t * c[3][1]]; }
  function edgeLen(a, b) { var c = ctl(a, b); if (!c) return Math.hypot(b.x - a.x, b.y - a.y); var l = 0, p = c[0]; for (var i = 1; i <= 60; i++) { var q = bz(c, i / 60); l += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; } return l; }
  function dPath(a, b, m) {                                                    // the SVG path of the edge a -> b, mirrored about x = 0 if m
    var s = m ? -1 : 1, c = ctl(a, b);
    return 'M' + r4(s * a.x) + ' ' + r4(a.y) + (c ? 'C' + r4(s * c[1][0]) + ' ' + r4(c[1][1]) + ' ' + r4(s * c[2][0]) + ' ' + r4(c[2][1]) + ' ' + r4(s * b.x) + ' ' + r4(b.y) : 'L' + r4(s * b.x) + ' ' + r4(b.y));
  }
  function nearestOnEdge(a, b, p) {
    var c = ctl(a, b) || [[a.x, a.y], [a.x, a.y], [b.x, b.y], [b.x, b.y]], best = { t: 0.5, d: 1e9 };
    for (var i = 0; i <= 80; i++) { var t = i / 80, q = c === null ? [0, 0] : (ctl(a, b) ? bz(c, t) : [a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)]), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < best.d) best = { t: t, d: d }; }
    return best;
  }
  function splitEdge(an, i, t) {                                                // a new anchor on the edge i -> i+1 at t, the Bézier cut by de Casteljau
    var a = an[i], b = an[i + 1], c = ctl(a, b), lerp = function (p, q) { return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]; };
    var n = { x: 0, y: 0, label: a.label, hin: null, hout: null, corner: false, role: null };
    if (!c) { var p = lerp([a.x, a.y], [b.x, b.y]); n.x = p[0]; n.y = p[1]; }
    else {
      var q0 = lerp(c[0], c[1]), q1 = lerp(c[1], c[2]), q2 = lerp(c[2], c[3]), r0 = lerp(q0, q1), r1_ = lerp(q1, q2), s = lerp(r0, r1_);
      n.x = s[0]; n.y = s[1]; n.hin = [r0[0] - s[0], r0[1] - s[1]]; n.hout = [r1_[0] - s[0], r1_[1] - s[1]];
      a.hout = [q0[0] - a.x, q0[1] - a.y]; b.hin = [q2[0] - b.x, q2[1] - b.y];
    }
    an.splice(i + 1, 0, n); return i + 1;
  }

  // ── an edit, stored ──
  function pushUndo() { E.undo.push(JSON.stringify(H.state().edits || {})); if (E.undo.length > 60) E.undo.shift(); E.redo = []; }
  function restore(json) { H.state().edits = JSON.parse(json); E.sel = null; E.work = null; H.change(); }
  function undo() { if (!E.undo.length) return; E.redo.push(JSON.stringify(H.state().edits || {})); restore(E.undo.pop()); }
  function redo() { if (!E.redo.length) return; E.undo.push(JSON.stringify(H.state().edits || {})); restore(E.redo.pop()); }
  // the anchors as the hand left them -> the edit the engine takes (deltas on the chart's anchors, or every anchor for a manual piece)
  function commit(an, forceManual) {
    var o = cur(), pe = pieceInfo(o), size = o.size, se = sizeEdits(size);
    if (pe.manual || forceManual) { se[E.pid] = { manual: { anchors: clone(an), sym: pe.sym } }; }
    else {
      var mv = {}, hi = {}, ho = {}, any = false;
      an.forEach(function (a, i) {
        var b = pe.base[i]; if (!b) return;
        var dx = a.x - b.x, dy = a.y - b.y; if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) { mv[i] = [r4(dx), r4(dy)]; any = true; }
        var ai = a.hin || [0, 0], bi = b.hin || [0, 0]; if (Math.abs(ai[0] - bi[0]) > 1e-4 || Math.abs(ai[1] - bi[1]) > 1e-4) { hi[i] = [r4(ai[0] - bi[0]), r4(ai[1] - bi[1])]; any = true; }
        var ao = a.hout || [0, 0], bo = b.hout || [0, 0]; if (Math.abs(ao[0] - bo[0]) > 1e-4 || Math.abs(ao[1] - bo[1]) > 1e-4) { ho[i] = [r4(ao[0] - bo[0]), r4(ao[1] - bo[1])]; any = true; }
      });
      if (any) se[E.pid] = { move: mv, hin: hi, hout: ho }; else delete se[E.pid];
    }
    if (!Object.keys(se).length) delete edits()[size];
    E.work = null; H.change();
  }
  function addDelta(pid, idx, dx, dy) {                                         // a correction: nudge an anchor by (dx, dy) on top of what is stored
    var o = cur(), size = o.size, se = sizeEdits(size), pe = o.edit[pid];
    if (pe.manual) { var m = se[pid] && se[pid].manual ? se[pid].manual : { anchors: clone(pe.anchors), sym: pe.sym }; m.anchors[idx].x += dx; m.anchors[idx].y += dy; se[pid] = { manual: m }; return; }
    var ed = se[pid] = se[pid] || { move: {}, hin: {}, hout: {} }; ed.move = ed.move || {}; var d = ed.move[idx] || [0, 0]; ed.move[idx] = [r4(d[0] + dx), r4(d[1] + dy)];
  }
  function correct(key, target) {
    var o = cur(), m = (o.measured || []).filter(function (x) { return x.key === key; })[0], rules = fixFor(key);
    if (!m || !rules || !rules.length || !isFinite(target)) return;
    var d = target - m.pattern; if (Math.abs(d) < 1e-6) return;
    pushUndo();
    rules.forEach(function (r) { var pe = o.edit[r[0]], i = pe.anchors.findIndex(function (a) { return a.role === r[1]; }); if (i >= 0) addDelta(r[0], i, r[2] === 'x' ? d * r[3] : 0, r[2] === 'y' ? d * r[3] : 0); });
    H.change();
  }
  // lengthen or shorten at a line: every anchor below it moves down; widen or narrow below a line: every anchor below it on the right moves out
  function slash(pids, y0, amount, axis) {
    var o = cur(); pushUndo();
    pids.forEach(function (pid) {
      var pe = o.edit[pid]; if (!pe) return;
      var xs = pe.anchors.map(function (a) { return a.x; }), mid = pe.sym ? 0 : (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
      pe.anchors.forEach(function (a, i) {
        if (a.y < y0 - 1e-6) return;
        if (axis === 'y') addDelta(pid, i, 0, amount);
        else if (a.x > mid + 1e-6) addDelta(pid, i, amount / 2, 0);
        else if (!pe.sym && a.x < mid - 1e-6) addDelta(pid, i, -amount / 2, 0);
      });
    });
    H.change();
  }

  // ── the canvas ──
  function svgPoint(ev) { var svg = $('gm-edsvg'), pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; var m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 }; }
  function pxPerCm() { var svg = $('gm-edsvg'), r = svg.getBoundingClientRect(); return E.vb ? r.width / E.vb[2] : 10; }
  function bounds(an, sym) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    an.forEach(function (a) { [[a.x, a.y]].concat(a.hout ? [[a.x + a.hout[0], a.y + a.hout[1]]] : []).concat(a.hin ? [[a.x + a.hin[0], a.y + a.hin[1]]] : []).forEach(function (p) { x0 = Math.min(x0, p[0], sym ? -p[0] : p[0]); x1 = Math.max(x1, p[0], sym ? -p[0] : p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }); });
    return [x0, y0, x1, y1];
  }
  function fit() {
    var o = cur(); if (!o) return; var pe = pieceInfo(o), b = bounds(anchorsNow(o), pe.sym), svg = $('gm-edsvg'), r = svg ? svg.getBoundingClientRect() : { width: 700, height: 500 };
    var w = b[2] - b[0] + 14, h = b[3] - b[1] + 14, asp = (r.width || 700) / (r.height || 500);
    if (w / h < asp) w = h * asp; else h = w / asp;
    E.vb = [(b[0] + b[2]) / 2 - w / 2, (b[1] + b[3]) / 2 - h / 2, w, h];
    E.fitFor = o.size + '|' + E.pid; applyView();
  }
  function applyView() { var svg = $('gm-edsvg'); if (svg && E.vb) svg.setAttribute('viewBox', E.vb.map(r4).join(' ')); }

  function draw() {
    var o = cur(), box = $('gm-ed');
    if (!o) { box.innerHTML = '<div class="gm-empty">Fix the chart first: the pieces are drawn from it.</div>'; return; }
    var pe = pieceInfo(o), an = anchorsNow(o), sym = pe.sym, n = an.length, last = sym ? n - 1 : n, R = H.result();
    var svg = $('gm-edsvg');
    if (!svg) { box.innerHTML = '<svg id="gm-edsvg" xmlns="' + NS + '" role="application" aria-label="Pattern editor"></svg>'; svg = $('gm-edsvg'); E.vb = null; }
    if (E.fitFor !== o.size + '|' + E.pid || !E.vb) fit();
    svg.innerHTML = '';
    var ppc = pxPerCm(), k = 1 / ppc, g = el('g', {}, svg);
    // the grid: centimetres when there is room, every five always; the centre line of a symmetric piece
    var b = E.vb, x0 = Math.floor(b[0]), x1 = Math.ceil(b[0] + b[2]), y0 = Math.floor(b[1]), y1 = Math.ceil(b[1] + b[3]);
    for (var gx = x0; gx <= x1; gx++) { if (gx % 5 && ppc < 9) continue; el('line', { x1: gx, y1: b[1], x2: gx, y2: b[1] + b[3], stroke: gx % 5 ? '#eef0f3' : '#dfe3e8', 'stroke-width': k }, g); }
    for (var gy = y0; gy <= y1; gy++) { if (gy % 5 && ppc < 9) continue; el('line', { x1: b[0], y1: gy, x2: b[0] + b[2], y2: gy, stroke: gy % 5 ? '#eef0f3' : '#dfe3e8', 'stroke-width': k }, g); }
    if (sym) el('line', { x1: 0, y1: b[1], x2: 0, y2: b[1] + b[3], stroke: '#9aa3ad', 'stroke-width': 1.2 * k, 'stroke-dasharray': (8 * k) + ' ' + (4 * k) + ' ' + (2 * k) + ' ' + (4 * k) }, g);
    // the cut line (the sewing line grown by the allowances), put back into the finished size so it sits round the drawing
    var cutP = null, sx = R.cut_factor.across, sy = R.cut_factor.along;
    o.pieces.forEach(function (p) { if (p.id === E.pid || p.source === E.pid && o.pieces.filter(function (q) { return q.source === E.pid; }).length === 1) cutP = p; });
    if (cutP && !E.work) {
      var rib = pe.id === 'band' || pe.id === 'waistband', ax = rib ? 1 : sx, ay = rib ? 1 : sy;
      el('path', { d: 'M' + cutP.cut.map(function (q) { return r4(q[0] / ax) + ' ' + r4(q[1] / ay); }).join('L') + 'Z', fill: 'rgba(24,87,196,.045)', stroke: '#1857C4', 'stroke-opacity': .45, 'stroke-width': 1.1 * k, 'stroke-dasharray': (5 * k) + ' ' + (3 * k) }, g);
      (cutP.notches || []).forEach(function (nt) { var x = nt.x / ax, y = nt.y / ay, L = 6 * k; el('line', { x1: x - nt.nx * L, y1: y - nt.ny * L, x2: x + nt.nx * L, y2: y + nt.ny * L, stroke: '#111', 'stroke-width': 1.6 * k }, g); });
    }
    // the edges, coloured by seam; a wide invisible stroke under each is what is clicked
    for (var i = 0; i < last; i++) {
      var a = an[i], c = an[(i + 1) % n];
      [false].concat(sym ? [true] : []).forEach(function (mir) {
        var d = dPath(a, c, mir);
        el('path', { d: d, fill: 'none', stroke: EDGE[a.label] || '#0e7490', 'stroke-width': (E.sel && E.sel.type === 'edge' && E.sel.i === i ? 3.2 : 2) * k, 'stroke-linecap': 'round' }, g);
        el('path', { d: d, fill: 'none', stroke: 'transparent', 'stroke-width': 12 * k * GAIN, 'data-edge': i, 'data-m': mir ? 1 : 0, style: 'cursor:' + (E.tool === 'add' ? 'copy' : 'pointer') }, g);
      });
    }
    // the slit and the zipper
    (o.pieces.filter(function (p) { return p.id === E.pid && p.marks; })[0] || { marks: [] }).marks.forEach(function (mk) { el('line', { x1: mk.x1, y1: mk.y1, x2: mk.x2, y2: mk.y2, stroke: '#c2410c', 'stroke-width': 2.4 * k, 'stroke-dasharray': (6 * k) + ' ' + (3 * k) }, g); });
    // the handles of the selection, then the anchors
    var hs = [];
    if (E.sel && E.sel.type === 'anchor') { var s = E.sel.i; [s - 1, s, s + 1].forEach(function (j) { if (j >= 0 && j < n) hs.push(j); }); }
    else if (E.sel && E.sel.type === 'edge') { hs.push(E.sel.i, (E.sel.i + 1) % n); }
    hs.forEach(function (j) {
      var a = an[j], sel = E.sel;
      [['hin', a.hin], ['hout', a.hout]].forEach(function (h) {
        if (!h[1]) return;
        var use = sel.type === 'anchor' ? (j === sel.i || (j === sel.i - 1 && h[0] === 'hout') || (j === sel.i + 1 && h[0] === 'hin')) : ((j === sel.i && h[0] === 'hout') || (j !== sel.i && h[0] === 'hin'));
        if (!use) return;
        var hx = a.x + h[1][0], hy = a.y + h[1][1];
        el('line', { x1: a.x, y1: a.y, x2: hx, y2: hy, stroke: '#ff6a00', 'stroke-width': 1 * k, 'stroke-dasharray': (3 * k) + ' ' + (2 * k) }, g);
        el('rect', { x: hx - 4.5 * k * GAIN, y: hy - 4.5 * k * GAIN, width: 9 * k * GAIN, height: 9 * k * GAIN, fill: '#fff', stroke: '#ff6a00', 'stroke-width': 1.6 * k, 'data-h': j + ':' + h[0], style: 'cursor:move' }, g);
      });
    });
    an.forEach(function (a, i) {
      var on = E.sel && E.sel.type === 'anchor' && E.sel.i === i, r = (on ? 6.5 : 5) * k * GAIN, col = on ? '#ff6a00' : (E.pend && E.pend.i === i ? '#c2410c' : '#111');
      [false].concat(sym ? [true] : []).forEach(function (mir) {
        var x = mir ? -a.x : a.x;
        if (mir && Math.abs(a.x) < 1e-6) return;
        var cn = isCorner(o, i, a), tag = cn ? 'rect' : 'circle', at = cn ? { x: x - r, y: a.y - r, width: 2 * r, height: 2 * r } : { cx: x, cy: a.y, r: r };
        el(tag, Object.assign(at, { fill: on ? '#ff6a00' : '#fff', stroke: col, 'stroke-width': 1.8 * k, 'data-a': i, 'data-m': mir ? 1 : 0, style: 'cursor:' + (E.tool === 'select' ? 'move' : 'pointer') }), g);
      });
      if (on) { var t = el('text', { x: a.x + 9 * k, y: a.y - 9 * k, 'font-size': 11 * k, fill: '#ff6a00', 'font-weight': 700, 'font-family': 'Public Sans, Arial' }, g); t.textContent = (a.role || 'node ' + (i + 1)).replace(/_/g, ' ') + '  ' + r1(a.x) + ', ' + r1(a.y); }
    });
    // what has been measured
    E.meas.forEach(function (m) { if (m.size !== o.size || m.pid !== E.pid || !m.p) return; el('line', { x1: m.p[0][0], y1: m.p[0][1], x2: m.p[1][0], y2: m.p[1][1], stroke: '#c2410c', 'stroke-width': 1.6 * k }, g); var t = el('text', { x: (m.p[0][0] + m.p[1][0]) / 2, y: (m.p[0][1] + m.p[1][1]) / 2 - 4 * k, 'font-size': 11 * k, fill: '#c2410c', 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'Public Sans, Arial' }, g); t.textContent = m.v + ' cm'; });
    applyView();
  }

  // ── the panels ──
  function chips() {
    var o = cur(); $('gm-edpieces').innerHTML = (isSh() ? PIECES_SH : PIECES).filter(function (p) { return !o || !o.edit || o.edit[p[0]]; }).map(function (p) { var pe = o && o.edit && o.edit[p[0]]; return '<button type="button" class="gm-chipb' + (E.pid === p[0] ? ' on' : '') + '" data-pid="' + p[0] + '">' + p[1] + (pe && (pe.manual || pe.edited) ? ' <span class="gm-dot" title="' + (pe.manual ? 'manual' : 'edited') + '"></span>' : '') + '</button>'; }).join('');
    var h = E.undo.length, f = E.redo.length;
    $('gm-edtools').innerHTML = [['select', 'Select', 'V'], ['add', 'Add node', 'A'], ['measure', 'Measure', 'M'], ['hand', 'Hand', 'H']].map(function (t) { return '<button type="button" class="gm-tool' + (E.tool === t[0] ? ' on' : '') + '" data-tool="' + t[0] + '" title="' + t[1] + ' (' + t[2] + ')">' + t[1] + '</button>'; }).join('') +
      '<span class="gm-sp"></span><button type="button" class="gm-tool" data-act="undo"' + (h ? '' : ' disabled') + ' title="Undo (Ctrl+Z)">Undo</button><button type="button" class="gm-tool" data-act="redo"' + (f ? '' : ' disabled') + ' title="Redo (Ctrl+Shift+Z)">Redo</button><button type="button" class="gm-tool" data-act="fit" title="Fit (F)">Fit</button>';
  }
  function inspector() {
    var o = cur(), box = $('gm-insp'); if (!o) { box.innerHTML = ''; return; }
    var pe = pieceInfo(o), an = anchorsNow(o), S = H.state(), R = H.result(), h = '';
    h += '<section class="gm-isec"><div class="gm-ik">Piece</div><div class="gm-ibig">' + esc(pe.name) + ' · size ' + esc(o.size) + '</div><div class="gm-isub">' + (pe.manual ? '<b class="gm-flag man">Manual</b> every anchor is stored: the chart no longer moves this piece' : pe.edited ? '<b class="gm-flag ed">Edited</b> moves kept on top of the chart' : 'drawn from the chart') + (pe.sym ? ' · symmetric: the left half is the mirror' : '') + '</div>' +
      '<div class="gm-irow"><button type="button" class="gm-btn" data-act="reset">Reset this piece</button><button type="button" class="gm-btn" data-act="copyall" title="Give every other size the same edit">Copy to all sizes</button></div></section>';
    var s = E.sel;
    if (s && s.type === 'anchor' && an[s.i]) {
      var a = an[s.i], axis = pe.sym && (s.i === 0 || s.i === an.length - 1);
      h += '<section class="gm-isec"><div class="gm-ik">Anchor</div><div class="gm-ibig">' + esc((a.role || 'node ' + (s.i + 1)).replace(/_/g, ' ')) + '</div>' +
        '<div class="gm-irow2"><label>X (cm)<input type="number" step="0.1" id="gm-ax" value="' + r2(a.x) + '"' + (axis ? ' disabled title="on the centre line"' : '') + '></label><label>Y (cm)<input type="number" step="0.1" id="gm-ay" value="' + r2(a.y) + '"></label></div>' +
        '<div class="gm-irow"><button type="button" class="gm-btn" data-act="corner">' + (isCorner(o, s.i, a) ? 'Make smooth' : 'Make corner') + '</button><button type="button" class="gm-btn" data-act="delnode"' + (axis || an.length <= 3 ? ' disabled' : '') + ' title="Delete (Del): the piece becomes manual">Delete anchor</button></div>' +
        '<p class="gm-ihint">Arrow keys nudge 0.1 cm (Shift: 1 cm). Drag a square to bend the edge.</p></section>';
    } else if (s && s.type === 'edge' && an[s.i]) {
      var e0 = an[s.i], e1 = an[(s.i + 1) % an.length], seamId = SEAM_OF[e0.label], cfg = seamId && R.seams && R.seams[seamId];
      h += '<section class="gm-isec"><div class="gm-ik">Edge</div><div class="gm-ibig">' + esc(cfg ? cfg.name : e0.label) + '</div><div class="gm-isub">' + r2(edgeLen(e0, e1)) + ' cm · ' + (ctlOf(e0, e1) ? 'a curve' : 'straight') + '</div>' +
        '<div class="gm-irow"><button type="button" class="gm-btn" data-act="curve">' + (ctlOf(e0, e1) ? 'Make straight' : 'Make a curve') + '</button><button type="button" class="gm-btn" data-act="addmid">Add a node in the middle</button></div>' +
        (cfg ? '<p class="gm-ihint">Seam: ' + esc(cfg.name) + ' · ' + esc(R.catalogue.stitch[cfg.type].name) + ' · allowance ' + cfg.allowance + ' cm. Change the stitch in the Sewing tab.</p>' : '') + '</section>';
    } else h += '<section class="gm-isec gm-empty2"><b>Nothing selected</b><p>Click an anchor (a dot or a square) or an edge. Drag an anchor to move it, a handle (a white square) to bend the edge. Double-click an edge to add a node.</p></section>';
    // corrections at a line
    var body = E.pid === 'front' || E.pid === 'back';
    h += '<section class="gm-isec"><div class="gm-ik">Correct the pattern</div>' +
      '<div class="gm-irow2"><label>At y (cm)<input type="number" step="0.5" id="gm-sly" value="' + (E.sly != null ? E.sly : r1((o.derived.underarm_y || o.derived.crotch_y || 20) + 5)) + '"></label><label>By (cm)<input type="number" step="0.1" id="gm-slby" value="' + (E.slb != null ? E.slb : 1) + '"></label></div>' +
      '<div class="gm-irow"><button type="button" class="gm-btn" data-act="lengthen" title="Everything below the line moves down by this much">Lengthen / shorten</button><button type="button" class="gm-btn" data-act="widen" title="Everything below the line is wider by this much">Widen / narrow</button></div>' +
      (body ? '<label class="gm-icheck"><input type="checkbox" id="gm-slboth"' + (E.slboth === false ? '' : ' checked') + '> front and back together</label>' : '') + '</section>';
    // what has been measured
    if (E.meas.length) h += '<section class="gm-isec"><div class="gm-ik">Measured</div><ul class="gm-mlist">' + E.meas.slice(-5).reverse().map(function (m) { return '<li>' + esc(m.t) + '</li>'; }).join('') + '</ul></section>';
    box.innerHTML = h;
  }
  function ctlOf(a, b) { return a.hout || b.hin; }
  function measureTable() {
    var o = cur(), box = $('gm-edmeas'); if (!o) { box.innerHTML = ''; return; }
    var R = H.result(), tol = R.tolerance_cm, off = o.measured.filter(function (x) { return !x.ok; }).length;
    box.innerHTML = '<div class="gm-mhead"><b>The pattern against the chart</b><span class="gm-status">' + (off ? off + ' off by more than ' + tol + ' cm' : 'on the chart') + '</span><span class="gm-sp"></span>' +
      '<button type="button" class="gm-btn" data-act="bake"' + (off || sizeHasEdits(o.size) ? '' : ' disabled') + ' title="Write what the pattern measures into the chart, and drop the edits">Set the chart from the pattern</button><button type="button" class="gm-btn" data-act="resetsize"' + (sizeHasEdits(o.size) ? '' : ' disabled') + '>Reset all edits of size ' + esc(o.size) + '</button></div>' +
      '<table class="gm-table gm-mtab"><thead><tr><th>Measure</th><th>Chart</th><th>Pattern</th><th>Difference</th></tr></thead><tbody>' + o.measured.map(function (x) {
        var fix = fixFor(x.key) && fixFor(x.key).length;
        return '<tr class="' + (x.ok ? '' : 'off') + '"><td>' + esc(x.label) + '</td><td>' + x.chart + '</td><td>' + (fix ? '<input type="number" step="0.1" data-fix="' + x.key + '" value="' + x.pattern + '" aria-label="' + esc(x.label) + ' of the pattern">' : x.pattern) + '</td><td class="d">' + (x.diff > 0 ? '+' : '') + x.diff + '</td></tr>';
      }).join('') + '</tbody></table><p class="gm-hint">Type a new figure in the Pattern column: the anchors that make that measurement move. Armhole is measured, not set (it follows the shoulder and the underarm).</p>';
  }
  function sizeHasEdits(size) { var e = H.state().edits; return !!(e && e[size] && Object.keys(e[size]).length); }
  function render() { if (!H) return; var o0 = cur(); if (o0 && o0.edit && !o0.edit[E.pid]) { E.pid = o0.edit.front ? 'front' : Object.keys(o0.edit)[0]; E.sel = null; E.fitFor = ''; } chips(); draw(); inspector(); measureTable(); }

  // ── what the hand does ──
  var ptrs = {}, pinch = null;
  function onDown(ev) {
    var t = ev.target, o = cur(); if (!o) return;
    ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    if (Object.keys(ptrs).length === 2 && E.vb) { var ps = Object.keys(ptrs).map(function (k) { return ptrs[k]; }); E.drag = null; E.work = null; pinch = { d0: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1, vb: E.vb.slice(), mx: (ps[0].x + ps[1].x) / 2, my: (ps[0].y + ps[1].y) / 2 }; return; }
    var pe = pieceInfo(o), an = E.work || clone(pe.anchors), sym = pe.sym;
    if (E.tool === 'hand' && E.vb) { E.sel = null; E.drag = { type: 'pan', x: ev.clientX, y: ev.clientY, vb: E.vb.slice() }; $('gm-edsvg').setPointerCapture(ev.pointerId); ev.preventDefault(); return; }
    if (t.hasAttribute('data-h')) {                                            // a handle
      var p = t.getAttribute('data-h').split(':'); E.work = an; E.drag = { type: 'handle', i: +p[0], which: p[1] }; $('gm-edsvg').setPointerCapture(ev.pointerId); ev.preventDefault(); return;
    }
    if (t.hasAttribute('data-a')) {                                            // an anchor
      var i = +t.getAttribute('data-a'), mir = t.getAttribute('data-m') === '1';
      if (E.tool === 'measure') { pickMeasure(o, an, { type: 'anchor', i: i, mir: mir }); return; }
      E.sel = { type: 'anchor', i: i }; E.work = an; E.drag = { type: 'anchor', i: i, mir: mir, moved: false }; $('gm-edsvg').setPointerCapture(ev.pointerId); ev.preventDefault(); inspector(); draw(); return;
    }
    if (t.hasAttribute('data-edge')) {
      var ei = +t.getAttribute('data-edge'), emir = t.getAttribute('data-m') === '1';
      if (E.tool === 'add') { addNode(o, ei, emir, svgPoint(ev)); ev.preventDefault(); return; }
      if (E.tool === 'measure') { pickMeasure(o, an, { type: 'edge', i: ei }); return; }
      E.sel = { type: 'edge', i: ei }; inspector(); draw(); E.lastEdge = { i: ei, mir: emir }; return;
    }
    // the background: select nothing, and pan
    E.sel = null; E.drag = { type: 'pan', x: ev.clientX, y: ev.clientY, vb: E.vb.slice() }; $('gm-edsvg').setPointerCapture(ev.pointerId); inspector(); draw();
  }
  function onMove(ev) {
    if (ptrs[ev.pointerId]) { ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY }; }
    if (pinch && Object.keys(ptrs).length >= 2) {
      var ps = Object.keys(ptrs).map(function (k) { return ptrs[k]; }), dn = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1, f = pinch.d0 / dn, svg = $('gm-edsvg'), r = svg.getBoundingClientRect();
      var cx = pinch.vb[0] + ((pinch.mx - r.left) / r.width) * pinch.vb[2], cy = pinch.vb[1] + ((pinch.my - r.top) / r.height) * pinch.vb[3];
      E.vb = [cx - (cx - pinch.vb[0]) * f, cy - (cy - pinch.vb[1]) * f, pinch.vb[2] * f, pinch.vb[3] * f]; applyView(); return;
    }
    var d = E.drag; if (!d) return;
    if (d.type === 'pan') { var r = $('gm-edsvg').getBoundingClientRect(), k = d.vb[2] / r.width; E.vb = [d.vb[0] - (ev.clientX - d.x) * k, d.vb[1] - (ev.clientY - d.y) * k, d.vb[2], d.vb[3]]; applyView(); return; }
    var o = cur(), pe = pieceInfo(o), an = E.work, p = svgPoint(ev), snap = E.snap && !ev.altKey ? 0.1 : 0, q = function (v) { return snap ? Math.round(v / snap) * snap : v; };
    if (d.type === 'anchor') {
      var a = an[d.i], axis = pe.sym && (d.i === 0 || d.i === an.length - 1), x = d.mir ? -p.x : p.x;
      a.x = axis ? 0 : q(x); a.y = q(p.y); d.moved = true;
    } else if (d.type === 'handle') {
      var a2 = an[d.i], mir = false, hx = p.x - a2.x, hy = p.y - a2.y;
      if (pe.sym && (d.i === 0 || d.i === an.length - 1)) hy = 0;                    // the tangent on the centre line stays level
      a2[d.which] = [q(hx), q(hy)];
      if (!isCorner(o, d.i, a2) && a2.hin && a2.hout) { var other = d.which === 'hin' ? 'hout' : 'hin', L = Math.hypot(a2[other][0], a2[other][1]), m = Math.hypot(a2[d.which][0], a2[d.which][1]) || 1; a2[other] = [-a2[d.which][0] / m * L, -a2[d.which][1] / m * L]; }
      void mir; d.moved = true;
    }
    draw(); live(o, an, d);
  }
  function live(o, an, d) {                                                       // lengths and places while the hand is on an anchor
    var box = $('gm-edlive'); if (!box || !d) return; var i = d.i, a = an[i], n = an.length, parts = [];
    if (a) { parts.push('x ' + r2(a.x) + ' · y ' + r2(a.y)); if (i > 0) parts.push('edge before ' + r1(edgeLen(an[i - 1], a)) + ' cm'); if (i < n - 1 || !pieceInfo(o).sym) parts.push('edge after ' + r1(edgeLen(a, an[(i + 1) % n])) + ' cm'); }
    box.textContent = parts.join('  ·  ');
  }
  function onUp(ev) {
    delete ptrs[ev.pointerId]; if (pinch) { if (Object.keys(ptrs).length < 2) { pinch = null; draw(); } return; }
    var d = E.drag; E.drag = null; if (!d) return;
    try { $('gm-edsvg').releasePointerCapture(ev.pointerId); } catch (_) { /* gone */ }
    if (d.type === 'pan') return;
    var box = $('gm-edlive'); if (box) box.textContent = '';
    if (d.moved) { pushUndo(); commit(E.work); } else { E.work = null; draw(); }
  }
  function onWheel(ev) {
    if (!E.vb) return; ev.preventDefault();
    var p = svgPoint(ev), f = ev.deltaY < 0 ? 0.87 : 1.15, vb = E.vb;
    E.vb = [p.x - (p.x - vb[0]) * f, p.y - (p.y - vb[1]) * f, vb[2] * f, vb[3] * f]; draw();
  }
  function onDbl(ev) { var t = ev.target, o = cur(); if (o && t.hasAttribute && t.hasAttribute('data-edge')) addNode(o, +t.getAttribute('data-edge'), t.getAttribute('data-m') === '1', svgPoint(ev)); }

  function addNode(o, ei, mir, p) {
    var pe = pieceInfo(o), an = clone(anchorsNow(o)), q = mir ? [-p.x, p.y] : [p.x, p.y];
    if (ei >= an.length - (pe.sym ? 1 : 0)) return;
    var b = nearestOnEdge(an[ei], an[(ei + 1) % an.length], q);
    pushUndo(); var k = splitEdge(an, ei, Math.min(0.95, Math.max(0.05, b.t))); E.sel = { type: 'anchor', i: k }; commit(an, true);
  }
  function pickMeasure(o, an, hit) {
    var pe = pieceInfo(o), A = function (i, mir) { var a = an[i]; return [mir ? -a.x : a.x, a.y]; };
    if (hit.type === 'edge') { var a0 = an[hit.i], a1 = an[(hit.i + 1) % an.length], len = r2(edgeLen(a0, a1)); E.meas.push({ size: o.size, pid: E.pid, p: [[a0.x, a0.y], [a1.x, a1.y]], v: len, t: pe.name + ', ' + a0.label + ' edge: ' + len + ' cm along the edge' }); E.pend = null; }
    else if (E.pend == null) { E.pend = { i: hit.i, mir: hit.mir }; draw(); return; }
    else { var p0 = A(E.pend.i, E.pend.mir), p1 = A(hit.i, hit.mir), dx = Math.abs(p1[0] - p0[0]), dy = Math.abs(p1[1] - p0[1]), dd = r2(Math.hypot(dx, dy)); E.meas.push({ size: o.size, pid: E.pid, p: [p0, p1], v: dd, t: pe.name + ': ' + dd + ' cm straight (across ' + r2(dx) + ', down ' + r2(dy) + ')' }); E.pend = null; }
    draw(); inspector();
  }

  function act(a) {
    var o = cur(); if (!o) return; var pe = pieceInfo(o), an = clone(anchorsNow(o));
    if (a === 'undo') return undo(); if (a === 'redo') return redo(); if (a === 'fit') { fit(); return draw(); }
    if (a === 'reset') { pushUndo(); var se = sizeEdits(o.size); delete se[E.pid]; if (!Object.keys(se).length) delete edits()[o.size]; E.sel = null; return H.change(); }
    if (a === 'resetsize') { pushUndo(); delete edits()[o.size]; E.sel = null; return H.change(); }
    if (a === 'copyall') { var src = (edits()[o.size] || {})[E.pid]; if (!src) return; pushUndo(); H.result().sizes.forEach(function (s) { if (s !== o.size) sizeEdits(s)[E.pid] = clone(src); }); return H.change(); }
    if (a === 'bake') {
      var S = H.state(), k = S.unit === 'in' ? 1 / 2.54 : 1; pushUndo();
      o.measured.forEach(function (x) { if (x.ok && !sizeHasEdits(o.size)) return; (S.chart[x.key] = S.chart[x.key] || {})[o.size] = String(r2(x.pattern * k)); });
      delete edits()[o.size]; E.sel = null; return H.change();
    }
    if (!E.sel) { if (a === 'lengthen' || a === 'widen') return corr(a, o); return; }
    var s = E.sel;
    if (a === 'corner' && s.type === 'anchor') { var cf = H.state().cornerFlags = H.state().cornerFlags || {}, ck = o.size + '|' + E.pid + '|' + s.i; cf[ck] = !isCorner(o, s.i, an[s.i]); H.save(); return render(); }
    if (a === 'delnode' && s.type === 'anchor') { if (an.length <= 3) return; pushUndo(); an.splice(s.i, 1); E.sel = null; return commit(an, true); }
    if (a === 'curve' && s.type === 'edge') {
      var e0 = an[s.i], e1 = an[(s.i + 1) % an.length]; pushUndo();
      if (ctlOf(e0, e1)) { e0.hout = null; e1.hin = null; } else { var dx = (e1.x - e0.x) / 3, dy = (e1.y - e0.y) / 3; e0.hout = [dx, dy]; e1.hin = [-dx, -dy]; }
      return commit(an);
    }
    if (a === 'addmid' && s.type === 'edge') { pushUndo(); var kk = splitEdge(an, s.i, 0.5); E.sel = { type: 'anchor', i: kk }; return commit(an, true); }
    if (a === 'lengthen' || a === 'widen') return corr(a, o);
  }
  function corr(a, o) {
    var y0 = parseFloat($('gm-sly').value), by = parseFloat($('gm-slby').value); E.sly = y0; E.slb = by; if (!isFinite(y0) || !isFinite(by)) return;
    var both = $('gm-slboth'), pids = (E.pid === 'front' || E.pid === 'back') && (!both || both.checked) ? ['front', 'back'] : [E.pid]; E.slboth = !both || both.checked;
    slash(pids, y0, by, a === 'lengthen' ? 'y' : 'x');
  }
  function nudge(dx, dy) {
    var o = cur(); if (!o || !E.sel || E.sel.type !== 'anchor') return; var pe = pieceInfo(o), an = clone(anchorsNow(o)), a = an[E.sel.i], axis = pe.sym && (E.sel.i === 0 || E.sel.i === an.length - 1);
    if (!axis) a.x = r4(a.x + dx); a.y = r4(a.y + dy); pushUndo(); commit(an);
  }

  function onKey(ev) {
    var pane = $('gs-2dedit') || $('pane-edit'); if (!pane || !pane.classList.contains('on')) return;
    var t = ev.target; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) { if (ev.key === 'Enter') t.blur(); return; }
    var k = ev.key.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.shiftKey ? redo() : undo(); ev.preventDefault(); return; }
    if ((ev.ctrlKey || ev.metaKey) && k === 'y') { redo(); ev.preventDefault(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (k === 'h') { E.tool = 'hand'; chips(); } else if (k === 'v') { E.tool = 'select'; chips(); } else if (k === 'a') { E.tool = 'add'; chips(); } else if (k === 'm') { E.tool = 'measure'; chips(); }
    else if (k === 'f') { fit(); draw(); } else if (k === 'escape') { E.sel = null; E.pend = null; inspector(); draw(); }
    else if (k === 'delete' || k === 'backspace') { act('delnode'); ev.preventDefault(); }
    else if (/^arrow/.test(k)) { var s = ev.shiftKey ? 1 : 0.1; nudge(k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0, k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0); ev.preventDefault(); }
  }

  function init(h) {
    H = h; host = $('gm-ed'); if (!host) return;
    host.addEventListener('pointerdown', onDown); host.addEventListener('pointermove', onMove); host.addEventListener('pointerup', onUp); host.addEventListener('pointercancel', onUp);
    host.addEventListener('wheel', onWheel, { passive: false }); host.addEventListener('dblclick', onDbl);
    document.addEventListener('keydown', onKey);
    $('gm-edpieces').addEventListener('click', function (e) { var b = e.target.closest('[data-pid]'); if (b) { E.pid = b.getAttribute('data-pid'); E.sel = null; E.pend = null; E.fitFor = ''; render(); } });
    $('gm-edtools').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b || b.disabled) return; if (b.hasAttribute('data-tool')) { E.tool = b.getAttribute('data-tool'); E.pend = null; chips(); draw(); } else if (b.hasAttribute('data-act')) act(b.getAttribute('data-act')); });
    $('gm-pane-edit-body').addEventListener('click', function (e) { var b = e.target.closest('[data-act]'); if (b && !b.disabled && !$('gm-edtools').contains(b)) act(b.getAttribute('data-act')); });
    $('gm-pane-edit-body').addEventListener('change', function (e) {
      var t = e.target, o = cur(); if (!o) return;
      if (t.id === 'gm-ax' || t.id === 'gm-ay') { var an = clone(anchorsNow(o)), a = an[E.sel && E.sel.i]; if (!a) return; var v = parseFloat(t.value); if (!isFinite(v)) return; if (t.id === 'gm-ax') a.x = v; else a.y = v; pushUndo(); commit(an); }
      else if (t.hasAttribute('data-fix')) correct(t.getAttribute('data-fix'), parseFloat(t.value));
      else if (t.id === 'gm-edsnap') { E.snap = t.checked; }
    });
    var sn = $('gm-edsnap'); if (sn) sn.checked = E.snap;
    window.addEventListener('resize', function () { var p = $('gs-2dedit') || $('pane-edit'); if (p && p.classList.contains('on')) { E.fitFor = ''; render(); } });
  }
  function zoomBy(f) { if (!E.vb) return; var cx = E.vb[0] + E.vb[2] / 2, cy = E.vb[1] + E.vb[3] / 2, w = E.vb[2] * f, h = E.vb[3] * f; E.vb = [cx - w / 2, cy - h / 2, w, h]; applyView(); }
  window.KAGarmentEdit = { zoomBy: zoomBy, init: init, render: render, fit: function () { E.fitFor = ''; render(); }, state: function () { return E; } };
})();
