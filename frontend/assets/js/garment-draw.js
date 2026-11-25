/**
 * The free pattern window: draw any piece (pen, rectangle, ellipse), shape it (points, curve handles, darts, notches), sew edge to edge,
 * hold an edge, and drape the result on a body in the 3D window. The drawing is KAPat data; Drape writes it as a garment document.
 */
(function () {
  'use strict';
  var Pat = window.KAPat, root = document.getElementById('gs-2dfree'); if (!Pat || !root) return;
  var KEY = 'ka-free-pattern-v1', SEAMC = ['#16a34a', '#2563eb', '#c026d3', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#65a30d'];
  var P = load() || Pat.create(), S = { tool: 'select', sel: { piece: null, node: null, edge: null }, view: { tx: 40, ty: 40, k: 7 }, pen: null, sewA: null, drag: null, hover: null, hist: [], fut: [], allow: 0, dart: { w: 3, d: 8 }, size: { w: 40, h: 30 } };
  var svg, hint, side, W = 600, H = 400;

  function load() { try { var t = localStorage.getItem(KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* the page works without it */ } }
  function snapshot() { return JSON.stringify(P); }
  function push() { S.hist.push(snapshot()); if (S.hist.length > 120) S.hist.shift(); S.fut = []; }
  function undo() { if (!S.hist.length) return; S.fut.push(snapshot()); P = JSON.parse(S.hist.pop()); fixSel(); changed(true); }
  function redo() { if (!S.fut.length) return; S.hist.push(snapshot()); P = JSON.parse(S.fut.pop()); fixSel(); changed(true); }
  function fixSel() { var p = cur(); if (!p) S.sel = { piece: null, node: null, edge: null }; else { if (S.sel.node != null && S.sel.node >= p.nodes.length) S.sel.node = null; if (S.sel.edge != null && S.sel.edge >= p.nodes.length) S.sel.edge = null; } }
  function cur() { return S.sel.piece ? Pat.byId(P, S.sel.piece) : null; }
  function changed() { save(); draw(); panel(); }
  function toast(t) { var s = window.KAGarmentStudio; var e = document.getElementById('gs-toast'); if (e) { e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('on'); }, 2800); } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ── the window ──
  var TOOLS = [['select', 'Select', 'Select and move pieces, points and handles (V)'], ['pen', 'Pen', 'Draw an outline point by point; drag to pull a curve; click the first point or press Enter to close (P)'], ['rect', 'Rectangle', 'Drag a rectangle (R)'], ['ellipse', 'Ellipse', 'Drag an ellipse (O)'],
    ['point', 'Add point', 'Click an edge to add a point (A)'], ['dart', 'Dart', 'Click an edge to cut a dart (D)'], ['notch', 'Notch', 'Click an edge to mark a notch (N)'], ['line', 'Inner line', 'Click two points inside a piece for a line (L)'],
    ['sew', 'Sew', 'Click an edge, then the edge it is sewn to; Shift+click adds more edges to a side (S)'], ['stitch', 'Stitch', 'Click a point on one outline, then a point on another (T)'], ['hold', 'Hold', 'Click an edge to hold it on the body (a waist, a neck) (H)']];
  function build() {
    root.innerHTML = '<div class="gf-bar" id="gf-bar" role="toolbar" aria-label="Pattern tools">' + TOOLS.map(function (t) { return '<button type="button" class="gf-b" data-tool="' + t[0] + '" title="' + esc(t[2]) + '">' + t[1] + '</button>'; }).join('') +
      '<span class="gf-sep"></span><button type="button" class="gf-b" data-act="undo" title="Undo (Ctrl Z)">Undo</button><button type="button" class="gf-b" data-act="redo" title="Redo (Ctrl Shift Z)">Redo</button>' +
      '<span class="gf-sep"></span><button type="button" class="gf-b gf-go" data-act="drape" title="Hang the drawn pieces on the body in the 3D window and drape them">Drape in 3D</button></div>' +
      '<div class="gf-main"><div class="gf-cv" id="gf-cv"><svg id="gf-svg" tabindex="0" aria-label="Pattern drawing area"></svg><div class="gf-hint" id="gf-hint"></div></div><aside class="gf-side" id="gf-side" aria-label="Piece properties"></aside></div>';
    svg = root.querySelector('#gf-svg'); hint = root.querySelector('#gf-hint'); side = root.querySelector('#gf-side');
    bind(); resize(); setTool('select'); panel();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(root.querySelector('#gf-cv'));
  }
  function resize() { var r = root.querySelector('#gf-cv').getBoundingClientRect(); W = Math.max(200, r.width); H = Math.max(160, r.height); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', W); svg.setAttribute('height', H); draw(); }
  var HINTS = { select: 'Click a piece, an edge or a point · drag to move · double-click a point to round it · double-click an edge to add a point · Del removes', pen: 'Click to place points · drag after a click to pull a curve · click the first point, or Enter, to close · Esc cancels',
    rect: 'Drag from one corner to the other', ellipse: 'Drag across the box of the ellipse', point: 'Click on an edge', dart: 'Click on an edge where the dart goes (size in the panel)', notch: 'Click on an edge', line: 'Click the two ends of the line', sew: 'Click the first edge (Shift+click adds more), then the edge it is sewn to (Shift+click adds more)', stitch: 'Click a point on an outline, then the point it is stitched to', hold: 'Click an edge to hold it, again to let it go' };
  function setTool(t) { S.tool = t; S.pen = null; S.sewA = null; S.stA = null; S.drag = null; root.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tool') === t); }); hint.textContent = HINTS[t] || ''; draw(); }

  // the point at a share (0..1) of the way round a piece's outline
  function pointAt(p, sh) {
    var poly = Pat.flatten(p, 1).poly, n = poly.length, c = [0], i; for (i = 0; i < n; i++) { var a = poly[i], b = poly[(i + 1) % n]; c.push(c[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    var d = (((sh % 1) + 1) % 1) * c[n]; for (i = 0; i < n && c[i + 1] < d; i++); var a2 = poly[i], b2 = poly[(i + 1) % n], u = (d - c[i]) / ((c[i + 1] - c[i]) || 1); return [a2[0] + (b2[0] - a2[0]) * u, a2[1] + (b2[1] - a2[1]) * u];
  }
  // ── drawing ──
  var sx = function (x) { return x * S.view.k + S.view.tx; }, sy = function (y) { return y * S.view.k + S.view.ty; };
  var wx = function (x) { return (x - S.view.tx) / S.view.k; }, wy = function (y) { return (y - S.view.ty) / S.view.k; };
  function edgeD(p, e) { var c = Pat.seg(p, e), d = 'M' + sx(c[0][0]) + ' ' + sy(c[0][1]); return d + (c[1][0] === c[0][0] && c[1][1] === c[0][1] && c[2][0] === c[3][0] && c[2][1] === c[3][1] ? 'L' + sx(c[3][0]) + ' ' + sy(c[3][1]) : 'C' + sx(c[1][0]) + ' ' + sy(c[1][1]) + ' ' + sx(c[2][0]) + ' ' + sy(c[2][1]) + ' ' + sx(c[3][0]) + ' ' + sy(c[3][1])); }
  function mid(p, e) { var c = Pat.seg(p, e), t = 0.5, u = 0.5, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, f = t * t * t; return [a * c[0][0] + b * c[1][0] + d * c[2][0] + f * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + f * c[3][1]]; }
  function draw() {
    if (!svg) return; var o = [], k = S.view.k, step = k >= 14 ? 1 : k >= 4 ? 5 : 10;
    // the grid, in cm
    var x0 = Math.floor(wx(0) / step) * step, x1 = wx(W), y0 = Math.floor(wy(0) / step) * step, y1 = wy(H);
    for (var gx = x0; gx <= x1; gx += step) o.push('<line x1="' + sx(gx) + '" y1="0" x2="' + sx(gx) + '" y2="' + H + '" class="gf-grid' + (gx % 10 === 0 ? ' gf-g10' : '') + '"/>');
    for (var gy = y0; gy <= y1; gy += step) o.push('<line x1="0" y1="' + sy(gy) + '" x2="' + W + '" y2="' + sy(gy) + '" class="gf-grid' + (gy % 10 === 0 ? ' gf-g10' : '') + '"/>');
    var info = Pat.seamInfo(P), colourOf = {}; info.forEach(function (s, i) { s.a.concat(s.b).forEach(function (g) { colourOf[g.eid] = SEAMC[i % SEAMC.length]; }); });
    P.pieces.forEach(function (p) {
      var fl = Pat.flatten(p, 1), on = p.id === S.sel.piece, d = 'M' + fl.poly.map(function (q) { return sx(q[0]) + ' ' + sy(q[1]); }).join('L') + 'Z';
      if (S.allow > 0) o.push('<path d="M' + Pat.allowance(p, S.allow).map(function (q) { return sx(q[0]) + ' ' + sy(q[1]); }).join('L') + 'Z" class="gf-allow"/>');
      o.push('<path d="' + d + '" class="gf-fill' + (on ? ' on' : '') + '" data-piece="' + p.id + '"/>');
      p.lines.forEach(function (l) { o.push('<line x1="' + sx(l.a[0]) + '" y1="' + sy(l.a[1]) + '" x2="' + sx(l.b[0]) + '" y2="' + sy(l.b[1]) + '" class="gf-inner"/>'); });
      p.edges.forEach(function (ed, e) {
        var cls = 'gf-edge' + (ed.hold ? ' hold' : '') + (ed.label === 'dart' ? ' dart' : '') + (on && S.sel.edge === e ? ' sel' : '') + (S.sewA && S.sewA.some(function (q) { return q.eid === ed.id; }) ? ' sel' : ''), col = colourOf[ed.id];
        o.push('<path d="' + edgeD(p, e) + '" class="' + cls + '"' + (col ? ' style="stroke:' + col + '"' : '') + '/>');
      });
      p.notches.forEach(function (q) { var e = p.edges.findIndex(function (x) { return x.id === q.edge; }); if (e < 0) return; var c = Pat.seg(p, e), t = q.t, u = 1 - t, a = u * u * u, b = 3 * u * u * t, dd = 3 * u * t * t, f = t * t * t, X = a * c[0][0] + b * c[1][0] + dd * c[2][0] + f * c[3][0], Y = a * c[0][1] + b * c[1][1] + dd * c[2][1] + f * c[3][1]; o.push('<circle cx="' + sx(X) + '" cy="' + sy(Y) + '" r="3" class="gf-notch"/>'); });
      if (on || S.tool !== 'select') p.nodes.forEach(function (N, i) {
        var sel = on && S.sel.node === i, sm = N.sm || N.o || N.i;
        o.push(sm ? '<circle cx="' + sx(N.x) + '" cy="' + sy(N.y) + '" r="' + (sel ? 5 : 4) + '" class="gf-node' + (sel ? ' sel' : '') + '"/>' : '<rect x="' + (sx(N.x) - (sel ? 5 : 4)) + '" y="' + (sy(N.y) - (sel ? 5 : 4)) + '" width="' + (sel ? 10 : 8) + '" height="' + (sel ? 10 : 8) + '" class="gf-node' + (sel ? ' sel' : '') + '"/>');
        if (sel && sm) { var h = Pat.handles(p, i); [['o', h.o], ['i', h.i]].forEach(function (q) { var hx = N.x + q[1][0], hy = N.y + q[1][1]; o.push('<line x1="' + sx(N.x) + '" y1="' + sy(N.y) + '" x2="' + sx(hx) + '" y2="' + sy(hy) + '" class="gf-hl"/><circle cx="' + sx(hx) + '" cy="' + sy(hy) + '" r="4" class="gf-handle" data-h="' + q[0] + '"/>'); }); }
      });
      var bb = Pat.bbox(fl.poly); o.push('<text x="' + sx((bb.x0 + bb.x1) / 2) + '" y="' + sy((bb.y0 + bb.y1) / 2) + '" class="gf-name" text-anchor="middle">' + esc(p.name) + '</text>');
    });
    info.forEach(function (s, i) {   // a thread between the two sides of each seam
      var A = P.pieces.find(function (p) { return p.id === s.a[0].piece; }), B = P.pieces.find(function (p) { return p.id === s.b[0].piece; }); if (!A || !B) return;
      var ea = A.edges.findIndex(function (x) { return x.id === s.a[0].eid; }), eb = B.edges.findIndex(function (x) { return x.id === s.b[0].eid; }); if (ea < 0 || eb < 0) return;
      var a = mid(A, ea), b = mid(B, eb), col = SEAMC[i % SEAMC.length];
      if (A !== B) o.push('<line x1="' + sx(a[0]) + '" y1="' + sy(a[1]) + '" x2="' + sx(b[0]) + '" y2="' + sy(b[1]) + '" class="gf-thread" style="stroke:' + col + '"/>');
      o.push('<text x="' + sx(a[0]) + '" y="' + (sy(a[1]) - 6) + '" class="gf-ease' + (Math.abs(s.pct) > 3 ? ' warn' : '') + '" text-anchor="middle">' + s.lenA.toFixed(1) + '</text>');
      o.push('<text x="' + sx(b[0]) + '" y="' + (sy(b[1]) - 6) + '" class="gf-ease' + (Math.abs(s.pct) > 3 ? ' warn' : '') + '" text-anchor="middle">' + s.lenB.toFixed(1) + '</text>');
    });
    (P.stitches || []).forEach(function (t) {
      var A = P.pieces.find(function (q) { return q.id === t.a.piece; }), B = P.pieces.find(function (q) { return q.id === t.b.piece; }); if (!A || !B) return;
      var a = pointAt(A, t.a.s), b = pointAt(B, t.b.s); o.push('<line x1="' + sx(a[0]) + '" y1="' + sy(a[1]) + '" x2="' + sx(b[0]) + '" y2="' + sy(b[1]) + '" class="gf-stitch"/><circle cx="' + sx(a[0]) + '" cy="' + sy(a[1]) + '" r="3" class="gf-stp"/><circle cx="' + sx(b[0]) + '" cy="' + sy(b[1]) + '" r="3" class="gf-stp"/>');
    });
    if (S.stA) { var pa = P.pieces.find(function (q) { return q.id === S.stA.piece; }); if (pa) { var qa = pointAt(pa, S.stA.s); o.push('<circle cx="' + sx(qa[0]) + '" cy="' + sy(qa[1]) + '" r="5" class="gf-stp sel"/>'); } }
    if (S.pen) {   // the outline being drawn
      var pts = S.pen.nodes; if (pts.length) { var dd = 'M' + sx(pts[0].x) + ' ' + sy(pts[0].y); for (var i = 1; i < pts.length; i++) dd += 'L' + sx(pts[i].x) + ' ' + sy(pts[i].y); if (S.hover) dd += 'L' + sx(S.hover[0]) + ' ' + sy(S.hover[1]); o.push('<path d="' + dd + '" class="gf-pen"/>'); pts.forEach(function (q, i) { o.push('<circle cx="' + sx(q.x) + '" cy="' + sy(q.y) + '" r="' + (i === 0 ? 6 : 4) + '" class="gf-node sel"/>'); }); }
    }
    if (S.drag && S.drag.kind === 'shape') { var a = S.drag, x = Math.min(a.x0, a.x1), y = Math.min(a.y0, a.y1), w = Math.abs(a.x1 - a.x0), h = Math.abs(a.y1 - a.y0); o.push(S.tool === 'ellipse' ? '<ellipse cx="' + sx(x + w / 2) + '" cy="' + sy(y + h / 2) + '" rx="' + (w * k / 2) + '" ry="' + (h * k / 2) + '" class="gf-pen"/>' : '<rect x="' + sx(x) + '" y="' + sy(y) + '" width="' + w * k + '" height="' + h * k + '" class="gf-pen"/>'); o.push('<text x="' + sx(x + w / 2) + '" y="' + (sy(y) - 6) + '" class="gf-ease" text-anchor="middle">' + w.toFixed(1) + ' × ' + h.toFixed(1) + ' cm</text>'); }
    svg.innerHTML = o.join('');
  }

  // ── the side panel ──
  function bodyM() { return Object.assign({}, Pat.PRESETS.female, P.body ? Pat.PRESETS[P.body.preset] : null, P.body || {}); }
  function anchors() { return Pat.bodyFromMeasures(P.body || { preset: 'female' }).anchors; }
  function num(id, v, step, min, max) { return '<input type="number" id="' + id + '" value="' + (Math.round(v * 100) / 100) + '" step="' + (step || 0.1) + '"' + (min != null ? ' min="' + min + '"' : '') + (max != null ? ' max="' + max + '"' : '') + '>'; }
  function panel() {
    if (!side) return; var p = cur(), h = [];
    h.push('<div class="gf-card"><b>New piece</b><div class="gf-row"><label>Width ' + num('gf-w', S.size.w, 0.5, 1, 400) + '</label><label>Height ' + num('gf-h', S.size.h, 0.5, 1, 400) + '</label></div><div class="gf-row"><button type="button" class="gf-b" data-act="addrect">Add a rectangle</button><button type="button" class="gf-b" data-act="addell">Add an ellipse</button></div>' +
      '<div class="gf-row"><label>Start from <select id="gf-tpl"><option value="">…</option><option value="skirt">A skirt</option><option value="tube">A front and a back</option></select></label></div></div>');
    if (p) {
      var bb = Pat.bbox(Pat.flatten(p).poly);
      h.push('<div class="gf-card"><b>Piece</b><label>Name <input type="text" id="gf-name" value="' + esc(p.name) + '" maxlength="40"></label><div class="gf-meta">' + bb.w.toFixed(1) + ' × ' + bb.h.toFixed(1) + ' cm · ' + Math.abs(Pat.area(Pat.flatten(p).poly)).toFixed(0) + ' cm² · ' + p.nodes.length + ' points</div>' +
        '<label>Hangs on the body <select id="gf-mode"><option value="wrap"' + (p.arr.mode === 'wrap' ? ' selected' : '') + '>wrapped all round</option><option value="front"' + (p.arr.mode === 'front' ? ' selected' : '') + '>on the front</option><option value="back"' + (p.arr.mode === 'back' ? ' selected' : '') + '>on the back</option>' + ['armL', 'armR', 'legL', 'legR'].map(function (m) { return '<option value="' + m + '"' + (p.arr.mode === m ? ' selected' : '') + '>round the ' + { armL: 'left arm', armR: 'right arm', legL: 'left leg', legR: 'right leg' }[m] + '</option>'; }).join('') + '</select></label>' +
        (/^(arm|leg)/.test(p.arr.mode) ? '<div class="gf-row"><label>Starts down the limb (cm) ' + num('gf-along', p.arr.along || 0, 1, 0, 120) + '</label><label>Turn (cm) ' + num('gf-dx', p.arr.dx || 0, 0.5) + '</label></div>' :
          '<label>Top at <select id="gf-anchor"><option value="">(pick a place on the body)</option>' + Object.keys(anchors()).map(function (k) { return '<option value="' + k + '">' + k + ' · ' + anchors()[k] + ' cm</option>'; }).join('') + '</select></label><div class="gf-row"><label>Top at height (cm) ' + num('gf-top', p.arr.top, 1, 0, 200) + '</label><label>Turn (cm) ' + num('gf-dx', p.arr.dx || 0, 0.5) + '</label></div>') +
        '<label>Fabric <select id="gf-mat"><option value="main"' + (p.mat !== 'rib' ? ' selected' : '') + '>main</option><option value="rib"' + (p.mat === 'rib' ? ' selected' : '') + '>rib</option></select></label>' +
        '<div class="gf-row"><button type="button" class="gf-b" data-act="mcopy">Mirrored copy</button><button type="button" class="gf-b" data-act="mfold" title="Select an edge first: the piece is reflected across it and closed">Fold on the edge</button><button type="button" class="gf-b gf-del" data-act="delpiece">Delete</button></div></div>');
      if (S.sel.edge != null && p.edges[S.sel.edge]) {
        var ed = p.edges[S.sel.edge], sw = P.seams.filter(function (s) { return s.a.concat(s.b).some(function (g) { return g.eid === ed.id; }); });
        h.push('<div class="gf-card"><b>Edge ' + (S.sel.edge + 1) + '</b> <span class="gf-meta">' + Pat.edgeLen(p, S.sel.edge).toFixed(1) + ' cm</span><label>Label <input type="text" id="gf-elabel" value="' + esc(ed.label) + '" maxlength="30" placeholder="e.g. waist, side, hem"></label><label class="gf-chk"><input type="checkbox" id="gf-ehold"' + (ed.hold ? ' checked' : '') + '> held on the body (a waist, a neck)</label>' + (sw.length ? '<div class="gf-meta">sewn: ' + sw.length + ' seam(s) — see below</div>' : '') + '</div>');
      }
      if (S.sel.node != null && p.nodes[S.sel.node]) {
        var N = p.nodes[S.sel.node];
        h.push('<div class="gf-card"><b>Point ' + (S.sel.node + 1) + '</b><div class="gf-row"><label>x ' + num('gf-nx', N.x, 0.1) + '</label><label>y ' + num('gf-ny', N.y, 0.1) + '</label></div><label class="gf-chk"><input type="checkbox" id="gf-nsm"' + (N.sm || N.o || N.i ? ' checked' : '') + '> smooth (a curve through it)</label><button type="button" class="gf-b gf-del" data-act="delnode">Delete the point</button></div>');
      }
    }
    var B = bodyM(); h.push('<div class="gf-card"><b>Body</b><label>Shape <select id="gf-bpre"><option value=""' + (P.body ? '' : ' selected') + '>standard</option>' + ['female', 'male', 'child'].map(function (k) { return '<option value="' + k + '"' + (P.body && P.body.preset === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></label>' +
      (P.body ? '<div class="gf-row"><label>Height ' + num('gf-bh', B.height, 1, 80, 210) + '</label><label>Chest ' + num('gf-bc', B.chest, 1, 40, 160) + '</label></div><div class="gf-row"><label>Waist ' + num('gf-bw', B.waist, 1, 35, 160) + '</label><label>Hip ' + num('gf-bhp', B.hip, 1, 40, 170) + '</label><label>Shoulder ' + num('gf-bs', B.shoulder, 1, 20, 60) + '</label></div>' : '') +
      '<button type="button" class="gf-b" data-act="auto" title="A first guess of where each piece hangs, from its shape and its seams">Arrange the pieces on the body</button></div>');
    h.push('<div class="gf-card"><b>Dart size</b><div class="gf-row"><label>Width ' + num('gf-dw', S.dart.w, 0.5, 0.5, 20) + '</label><label>Depth ' + num('gf-dd', S.dart.d, 0.5, 1, 40) + '</label></div><label>Seam allowance (cm) ' + num('gf-allow', S.allow, 0.5, 0, 5) + '</label></div>');
    var info = Pat.seamInfo(P), pn = function (id) { var q = Pat.byId(P, id); return q ? q.name : '?'; }, en = function (g) { var q = Pat.byId(P, g.piece), e = q ? q.edges.findIndex(function (x) { return x.id === g.eid; }) : -1; return pn(g.piece) + ' ' + (e + 1); };
    h.push('<div class="gf-card"><b>Seams</b>' + (info.length ? info.map(function (s, i) { return '<div class="gf-seam"><i style="background:' + SEAMC[i % SEAMC.length] + '"></i><span>' + esc(s.a.map(en).join('+')) + ' ↔ ' + esc(s.b.map(en).join('+')) + '<small>' + s.lenA.toFixed(1) + ' / ' + s.lenB.toFixed(1) + ' cm' + (Math.abs(s.diff) > 0.05 ? ' · ' + (s.diff > 0 ? 'first ' : 'second ') + Math.abs(s.diff).toFixed(1) + ' cm longer (eased in)' : ' · equal') + '</small></span><button type="button" class="gf-x" data-flip="' + s.id + '" title="Turn this seam the other way round" aria-label="Turn this seam the other way round">⇄</button><button type="button" class="gf-x" data-unsew="' + s.id + '" aria-label="Remove this seam">×</button></div>'; }).join('') : '<div class="gf-meta">None yet. Use the Sew tool: click an edge, then the edge it goes to.</div>') + ((P.stitches || []).length ? '<b>Stitches</b>' + P.stitches.map(function (t) { return '<div class="gf-seam"><i style="background:#ca8a04"></i><span>' + esc(pn(t.a.piece)) + ' ↔ ' + esc(pn(t.b.piece)) + '<small>point to point</small></span><button type="button" class="gf-x" data-unstitch="' + t.id + '" aria-label="Remove this stitch">×</button></div>'; }).join('') : '') + '</div>');
    h.push('<div class="gf-card"><b>Fabric</b><label>GSM ' + num('gf-gsm', P.fabric.gsm, 5, 40, 800) + '</label><div class="gf-row"><button type="button" class="gf-b" data-act="svg">Download the patterns (SVG)</button><button type="button" class="gf-b" data-act="docsave">Save the document</button><button type="button" class="gf-b gf-del" data-act="clear">Clear all</button></div></div>');
    side.innerHTML = h.join('');
  }

  // ── doing things ──
  function select(piece, node, edge) { S.sel = { piece: piece, node: node == null ? null : node, edge: edge == null ? null : edge }; draw(); panel(); }
  function drape() {
    if (!P.pieces.length) { toast('Draw a piece first.'); return; }
    var doc; try { doc = Pat.toDoc(P); } catch (e) { toast('The pattern cannot be made: ' + e.message); return; }
    var bad = window.KADoc ? window.KADoc.validate(doc) : ['the document module is not loaded']; if (bad.length) { toast(bad[0]); return; }
    if (!P.seams.length) toast('No seams yet: the pieces will hang apart. Use the Sew tool to join edges.');
    if (window.KAGarmentStudio && window.KAGarmentStudio.freeDrape) window.KAGarmentStudio.freeDrape(doc);
  }
  function addShape(kind, x, y, w, h) { push(); var p = kind === 'rect' ? Pat.rect(P, x, y, w, h, 'Piece ' + (P.pieces.length + 1)) : Pat.ellipse(P, x + w / 2, y + h / 2, w / 2, h / 2, 'Piece ' + (P.pieces.length + 1)); select(p.id, null, null); changed(); return p; }
  function freeSpot(w, h) { var x = 0; P.pieces.forEach(function (p) { var bb = Pat.bbox(Pat.flatten(p).poly); x = Math.max(x, bb.x1 + 6); }); return [x, 0]; }
  function act(a) {
    var p = cur();
    if (a === 'undo') undo(); else if (a === 'redo') redo(); else if (a === 'drape') drape();
    else if (a === 'addrect' || a === 'addell') { var s = freeSpot(S.size.w, S.size.h); addShape(a === 'addrect' ? 'rect' : 'ell', s[0], s[1], S.size.w, S.size.h); fit(); }
    else if (a === 'mcopy' && p) { push(); var c = Pat.mirrorCopy(P, p); select(c.id, null, null); changed(); }
    else if (a === 'mfold' && p) { if (S.sel.edge == null) { toast('Select the edge that is the fold first.'); return; } push(); if (Pat.mirrorFold(P, p, S.sel.edge)) { select(p.id, null, null); changed(); } else toast('That cannot be folded.'); }
    else if (a === 'delpiece' && p) { push(); Pat.removePiece(P, p.id); select(null); changed(); }
    else if (a === 'delnode' && p && S.sel.node != null) { push(); if (!Pat.removeNode(P, p, S.sel.node)) toast('A piece needs at least 3 points.'); S.sel.node = null; S.sel.edge = null; changed(); }
    else if (a === 'auto') { push(); Pat.autoArrange(P); changed(); toast('Arranged: ' + P.pieces.map(function (q) { return q.name + ' → ' + q.arr.mode; }).join(', ')); }
    else if (a === 'clear') { push(); P = Pat.create(); select(null); changed(); }
    else if (a === 'svg') { var t = Pat.toSVG(P, S.allow); if (!t) { toast('Nothing to download.'); return; } dl(t, 'image/svg+xml', 'free-pattern.svg'); }
    else if (a === 'docsave') { if (!P.pieces.length) { toast('Nothing to save.'); return; } dl(window.KADoc.toJSON(Pat.toDoc(P)), 'application/json', (P.name || 'garment') + '.ka-garment.json'); }
  }
  function dl(text, type, name) { var b = new Blob([text], { type: type }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function fit() {
    if (!P.pieces.length) { S.view = { tx: 40, ty: 40, k: 7 }; draw(); return; }
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; P.pieces.forEach(function (p) { var b = Pat.bbox(Pat.flatten(p).poly); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); });
    var k = Math.max(1.5, Math.min(30, Math.min((W - 60) / Math.max(1, x1 - x0), (H - 60) / Math.max(1, y1 - y0)))); S.view = { k: k, tx: (W - (x1 - x0) * k) / 2 - x0 * k, ty: (H - (y1 - y0) * k) / 2 - y0 * k }; draw();
  }

  // ── the mouse ──
  var snap = function (v, e) { return e && e.altKey ? v : Math.round(v * 2) / 2; };
  function at(e) { var r = svg.getBoundingClientRect(); return [wx(e.clientX - r.left), wy(e.clientY - r.top), e.clientX - r.left, e.clientY - r.top]; }
  function hitNode(p, x, y, px) { var best = null; p.nodes.forEach(function (N, i) { var d = Math.hypot(N.x - x, N.y - y) * S.view.k; if (d < px && (!best || d < best.d)) best = { i: i, d: d }; }); return best; }
  function hitEdge(x, y, px) { var best = null; P.pieces.forEach(function (p) { var n = Pat.nearest(p, x, y); if (n && n.d * S.view.k < px && (!best || n.d < best.n.d)) best = { p: p, n: n }; }); return best; }
  function hitPiece(x, y) { for (var i = P.pieces.length - 1; i >= 0; i--) if (Pat.inside(Pat.flatten(P.pieces[i], 1).poly, x, y)) return P.pieces[i]; return null; }
  function closePen() {
    if (!S.pen || S.pen.nodes.length < 3) { S.pen = null; draw(); return; } push();
    var p = Pat.addPiece(P, S.pen.nodes, 'Piece ' + (P.pieces.length + 1)); S.pen = null; select(p.id, null, null); changed();
  }
  function down(e) {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey && S.tool === 'select') || S.space) { S.drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, tx: S.view.tx, ty: S.view.ty }; svg.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (e.button !== 0) return; var q = at(e), x = q[0], y = q[1], t = S.tool, p = cur(); svg.focus();
    if (t === 'select') {
      if (p && S.sel.node != null) { var N = p.nodes[S.sel.node], h = Pat.handles(p, S.sel.node); [['o', h.o], ['i', h.i]].forEach(function (c) { if (!S.drag && (N.sm || N.o || N.i) && Math.hypot(N.x + c[1][0] - x, N.y + c[1][1] - y) * S.view.k < 8) { push(); S.drag = { kind: 'handle', which: c[0] }; } }); }
      if (!S.drag) { var cand = p ? [p] : []; P.pieces.forEach(function (o) { if (o !== p) cand.push(o); }); for (var i = 0; i < cand.length && !S.drag; i++) { var hn = hitNode(cand[i], x, y, 9); if (hn) { select(cand[i].id, hn.i, null); push(); S.drag = { kind: 'node', i: hn.i }; } } }
      if (!S.drag) { var he = hitEdge(x, y, 7); if (he) { select(he.p.id, null, he.n.e); S.drag = { kind: 'none' }; } }
      if (!S.drag) { var hp = hitPiece(x, y); if (hp) { select(hp.id, null, null); push(); S.drag = { kind: 'move', x: x, y: y, moved: false }; } }
      if (!S.drag) { select(null); S.drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, tx: S.view.tx, ty: S.view.ty }; }
      svg.setPointerCapture(e.pointerId); return;
    }
    if (t === 'pen') {
      if (!S.pen) S.pen = { nodes: [] }; var nd = S.pen.nodes;
      if (nd.length >= 3 && Math.hypot(nd[0].x - x, nd[0].y - y) * S.view.k < 10) { closePen(); return; }
      var N2 = { x: snap(x, e), y: snap(y, e) }; nd.push(N2); S.drag = { kind: 'pen', N: N2, px: e.clientX, py: e.clientY }; svg.setPointerCapture(e.pointerId); draw(); return;
    }
    if (t === 'rect' || t === 'ellipse') { S.drag = { kind: 'shape', x0: snap(x, e), y0: snap(y, e), x1: snap(x, e), y1: snap(y, e) }; svg.setPointerCapture(e.pointerId); return; }
    var he2 = hitEdge(x, y, 9);
    if (t === 'point' && he2) { push(); var ni = Pat.addNode(P, he2.p, he2.n.e, Math.max(0.02, Math.min(0.98, he2.n.t))); select(he2.p.id, ni, null); changed(); }
    else if (t === 'dart' && he2) { push(); Pat.addDart(P, he2.p, he2.n.e, Math.max(0.1, Math.min(0.9, he2.n.t)), S.dart.w, S.dart.d); select(he2.p.id, null, null); changed(); toast('A dart is cut and its two legs are sewn together.'); }
    else if (t === 'notch' && he2) { push(); Pat.addNotch(he2.p, he2.n.e, he2.n.t); select(he2.p.id, null, he2.n.e); changed(); }
    else if (t === 'hold' && he2) { push(); var ed = he2.p.edges[he2.n.e]; ed.hold = !ed.hold; select(he2.p.id, null, he2.n.e); changed(); }
    else if (t === 'sew' && he2) {
      var g = { piece: he2.p.id, eid: he2.p.edges[he2.n.e].id };
      if (S.sewA && e.shiftKey && S.sewPhase === 'A') { if (!S.sewA.some(function (q) { return q.eid === g.eid; })) S.sewA.push(g); draw(); }
      else if (e.shiftKey && S.lastSeam && !S.sewA) { push(); if (Pat.addToSeam(P, S.lastSeam, 'b', g)) { changed(); toast('Added to the second side of the seam.'); } else { S.hist.pop(); toast('That edge is already in the seam.'); } }
      else if (!S.sewA) { S.sewA = [g]; S.sewPhase = 'A'; S.lastSeam = null; hint.textContent = 'Now click the edge it is sewn to (Shift+click adds more to the first side; Esc cancels)'; draw(); }
      else {
        push(); var s = Pat.sew(P, S.sewA, g); S.sewA = null; S.sewPhase = ''; hint.textContent = HINTS.sew;
        if (s) { S.lastSeam = s.id; var inf = Pat.seamInfo(P).find(function (z) { return z.id === s.id; }); toast('Sewn: ' + inf.lenA.toFixed(1) + ' cm to ' + inf.lenB.toFixed(1) + ' cm' + (Math.abs(inf.diff) > 0.05 ? ' (' + Math.abs(inf.diff).toFixed(1) + ' cm eased in)' : '') + ' · Shift+click another edge to add it to the second side'); } else { S.hist.pop(); toast('Those edges cannot be sewn.'); }
        changed();
      }
    }
    else if (t === 'stitch' && he2) {
      if (!S.stA) { S.stA = { piece: he2.p.id, s: he2.n.s }; hint.textContent = 'Now click the point it is stitched to (Esc cancels)'; draw(); }
      else { push(); Pat.stitch(P, S.stA.piece, S.stA.s, he2.p.id, he2.n.s); S.stA = null; hint.textContent = HINTS.stitch; changed(); }
    }
    else if (t === 'line') { var hp2 = hitPiece(x, y); if (!hp2) return; if (!S.lineA) { S.lineA = [snap(x, e), snap(y, e), hp2.id]; } else { push(); Pat.addLine(Pat.byId(P, S.lineA[2]) || hp2, [S.lineA[0], S.lineA[1]], [snap(x, e), snap(y, e)]); S.lineA = null; changed(); } }
  }
  function move(e) {
    var q = at(e), x = q[0], y = q[1], d = S.drag;
    if (S.tool === 'pen' && S.pen) S.hover = [snap(x, e), snap(y, e)];
    if (!d) { if (S.pen || S.sewA) draw(); return; }
    if (d.kind === 'pan') { S.view.tx = d.tx + e.clientX - d.cx; S.view.ty = d.ty + e.clientY - d.cy; draw(); return; }
    var p = cur();
    if (d.kind === 'node' && p) { Pat.moveNode(p, d.i, snap(x, e), snap(y, e)); draw(); }
    else if (d.kind === 'handle' && p) { var N = p.nodes[S.sel.node]; Pat.moveHandle(p, S.sel.node, d.which, x - N.x, y - N.y, !e.altKey); draw(); }
    else if (d.kind === 'move' && p) { var dx = snap(x - d.x, e), dy = snap(y - d.y, e); if (dx || dy) { Pat.translate(p, dx, dy); d.x += dx; d.y += dy; d.moved = true; draw(); } }
    else if (d.kind === 'shape') { d.x1 = snap(x, e); d.y1 = snap(y, e); draw(); }
    else if (d.kind === 'pen') { var dxp = e.clientX - d.px, dyp = e.clientY - d.py; if (Math.hypot(dxp, dyp) > 4) { var o = [x - d.N.x, y - d.N.y]; d.N.sm = true; d.N.o = [o[0], o[1]]; d.N.i = [-o[0], -o[1]]; } draw(); }
  }
  function up(e) {
    var d = S.drag; S.drag = null; if (!d) return; try { svg.releasePointerCapture(e.pointerId); } catch (x) { /* released */ }
    if (d.kind === 'shape') { var w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0); if (w >= 1 && h >= 1) { S.size = { w: w, h: h }; addShape(S.tool, Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), w, h); setTool('select'); } else draw(); }
    else if (d.kind === 'pen') draw();
    else if (d.kind === 'node' || d.kind === 'handle' || d.kind === 'move') { if (d.kind === 'move' && !d.moved) S.hist.pop(); changed(); }
    else draw();
  }
  function wheel(e) { e.preventDefault(); var q = at(e), f = e.deltaY < 0 ? 1.15 : 1 / 1.15, k = Math.max(1.2, Math.min(60, S.view.k * f)), r = k / S.view.k; S.view.tx = q[2] - (q[2] - S.view.tx) * r; S.view.ty = q[3] - (q[3] - S.view.ty) * r; S.view.k = k; draw(); }
  function dbl(e) {
    var q = at(e), x = q[0], y = q[1], p = cur();
    if (S.tool === 'pen') { if (S.pen) { S.pen.nodes.pop(); closePen(); } return; }
    if (S.tool !== 'select') return;
    if (p) { var hn = hitNode(p, x, y, 9); if (hn) { push(); Pat.toggleSmooth(p, hn.i); select(p.id, hn.i, null); changed(); return; } }
    var he = hitEdge(x, y, 8); if (he) { push(); var ni = Pat.addNode(P, he.p, he.n.e, Math.max(0.02, Math.min(0.98, he.n.t))); select(he.p.id, ni, null); changed(); }
  }
  function key(e) {
    var t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return; if (!root.classList.contains('on')) return;
    var k = e.key, c = e.ctrlKey || e.metaKey;
    if (c && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; } if (c && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; } if (c || e.altKey) return;
    if (k === 'Escape') { S.pen = null; S.sewA = null; S.stA = null; S.lineA = null; S.drag = null; hint.textContent = HINTS[S.tool] || ''; draw(); return; }
    if (k === 'Enter' && S.pen) { closePen(); return; }
    if (k === 'Delete' || k === 'Backspace') { var p = cur(); if (!p) return; e.preventDefault(); act(S.sel.node != null ? 'delnode' : 'delpiece'); return; }
    if (k === ' ') { S.space = true; e.preventDefault(); return; }
    var map = { t: 'stitch', v: 'select', p: 'pen', r: 'rect', o: 'ellipse', a: 'point', d: 'dart', n: 'notch', l: 'line', s: 'sew', h: 'hold' }; if (map[k.toLowerCase()] && !e.shiftKey) { setTool(map[k.toLowerCase()]); e.stopImmediatePropagation(); } else if (k === 'f') { fit(); e.stopImmediatePropagation(); }
  }
  function change(e) {
    var id = e.target.id, v = e.target.value, p = cur();
    if (id === 'gf-w') S.size.w = Math.max(1, +v || 1); else if (id === 'gf-h') S.size.h = Math.max(1, +v || 1);
    else if (id === 'gf-dw') S.dart.w = Math.max(0.5, +v || 1); else if (id === 'gf-dd') S.dart.d = Math.max(1, +v || 1); else if (id === 'gf-allow') { S.allow = Math.max(0, Math.min(5, +v || 0)); draw(); }
    else if (id === 'gf-gsm') { push(); P.fabric.gsm = Math.max(40, Math.min(800, +v || 180)); changed(); }
    else if (id === 'gf-bpre') { push(); if (!v) delete P.body; else P.body = { preset: v }; changed(); }
    else if (/^gf-b(h|c|w|hp|s)$/.test(id)) { push(); var kk = { 'gf-bh': 'height', 'gf-bc': 'chest', 'gf-bw': 'waist', 'gf-bhp': 'hip', 'gf-bs': 'shoulder' }[id]; P.body = Object.assign({}, P.body || { preset: 'female' }); P.body[kk] = +v || P.body[kk]; changed(); }
    else if (id === 'gf-anchor') { if (v && cur()) { push(); cur().arr.top = anchors()[v]; changed(); } }
    else if (id === 'gf-tpl') { if (!v) return; push(); var made = Pat.TEMPLATES[v](P), first = [].concat(made)[0]; select(first.id, null, null); changed(); fit(); }
    else if (p) {
      push();
      if (id === 'gf-name') p.name = v.slice(0, 40) || p.name; else if (id === 'gf-mode') p.arr.mode = v; else if (id === 'gf-top') p.arr.top = +v || 0; else if (id === 'gf-along') p.arr.along = +v || 0; else if (id === 'gf-dx') p.arr.dx = +v || 0; else if (id === 'gf-mat') p.mat = v;
      else if (id === 'gf-elabel' && S.sel.edge != null) p.edges[S.sel.edge].label = v.slice(0, 30); else if (id === 'gf-ehold' && S.sel.edge != null) p.edges[S.sel.edge].hold = e.target.checked;
      else if (S.sel.node != null && (id === 'gf-nx' || id === 'gf-ny')) { var N = p.nodes[S.sel.node]; Pat.moveNode(p, S.sel.node, id === 'gf-nx' ? +v : N.x, id === 'gf-ny' ? +v : N.y); }
      else if (id === 'gf-nsm' && S.sel.node != null) { var Nn = p.nodes[S.sel.node]; if (!!(Nn.sm || Nn.o || Nn.i) !== e.target.checked) Pat.toggleSmooth(p, S.sel.node); } else S.hist.pop();
      changed();
    }
  }
  function bind() {
    svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('wheel', wheel, { passive: false }); svg.addEventListener('dblclick', dbl); svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('keydown', key, true); document.addEventListener('keyup', function (e) { if (e.key === ' ') S.space = false; });
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tool]'); if (t) { setTool(t.getAttribute('data-tool')); return; }
      var a = e.target.closest('[data-act]'); if (a) { act(a.getAttribute('data-act')); return; }
      var fl = e.target.closest('[data-flip]'); if (fl) { push(); Pat.flipSeam(P, fl.getAttribute('data-flip')); changed(); return; }
      var us = e.target.closest('[data-unstitch]'); if (us) { push(); Pat.unstitch(P, us.getAttribute('data-unstitch')); changed(); return; }
      var u = e.target.closest('[data-unsew]'); if (u) { push(); Pat.unsew(P, u.getAttribute('data-unsew')); changed(); }
    });
    root.addEventListener('change', change);
  }
  build();
  window.KAFreeDraw = { project: function () { return P; }, set: function (p) { P = p; fixSel(); changed(); fit(); }, toDoc: function () { return Pat.toDoc(P); }, fit: fit, redraw: function () { resize(); }, tool: setTool, state: function () { return S; } };
})();
