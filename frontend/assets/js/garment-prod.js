/**
 * From a drawn pattern to production: grading (the same pattern in other sizes), tables of what each size measures, a DXF a pattern plotter or a CAD can read,
 * and the data a tech pack is made from. Pure data in, data (or text) out; the PDF itself is drawn on the server from the pack.
 *
 *   P.grading = { sizes: ['S','M','L','XL'], base: 'M', body: { height, chest, waist, hip, shoulder } }   what the body grows by from one size to the next (cm)
 *   piece.grade = { w, h }   what this piece grows by across and down per size (cm); a node may have g: [dx, dy] of its own per size
 *   P.tplMeasures = { S: {...}, M: {...} }  for a template: the measures of each size (from a spec sheet), and the pattern is drafted again at each size
 */
(function (root) {
  'use strict';
  const Pat = () => root.KAPat || (typeof require !== 'undefined' ? require('./garment-pattern.js') : null);
  const Tpl = () => root.KATpl || (typeof require !== 'undefined' ? require('./garment-templates.js') : null);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const r2 = (v) => Math.round(v * 100) / 100;

  const DEFAULT_GRADING = () => ({ sizes: ['S', 'M', 'L', 'XL'], base: 'M', body: { height: 3, chest: 4, waist: 4, hip: 4, shoulder: 1.5 } });
  const grading = (P) => { if (!P.grading) P.grading = DEFAULT_GRADING(); return P.grading; };
  const stepOf = (P, size) => { const g = grading(P), i = g.sizes.indexOf(size), b = g.sizes.indexOf(g.base); return i < 0 ? 0 : i - (b < 0 ? 0 : b); };
  // what a piece grows by per size if nobody said: a piece that goes round the body takes the body's growth, a half of it if it is one of two, a limb piece a third
  function defaultRule(P, p) { const g = grading(P).body, m = p.arr && p.arr.mode; const f = m === 'wrap' ? 1 : /^(arm|leg)/.test(m) ? 0.3 : m === 'patch' ? 0.1 : 0.5; return { w: r2(g.chest * f), h: r2(g.height * 0.4 * (m === 'patch' ? 0.2 : 1)) }; }
  const ruleOf = (P, p) => Object.assign(defaultRule(P, p), p.grade || {});

  // the pattern in another size
  function atSize(P, size) {
    const K = Pat(), g = grading(P), k = stepOf(P, size);
    if (P.tpl && P.tplMeasures && P.tplMeasures[size] && Tpl()) { const Q = Tpl().build(P.tpl.kind, P.tplMeasures[size], { size, fabric: P.fabric }); Q.grading = clone(g); Q.size = size; Q.name = P.name; return Q; }
    const Q = clone(P); Q.size = size; if (!k) return Q;
    Q.pieces.forEach((p) => {
      const rule = ruleOf(P, p), bb = K.bbox(K.flatten(p).poly), cx = bb.x0 + bb.w / 2, sx = 1 + (k * rule.w) / (bb.w || 1), sy = 1 + (k * rule.h) / (bb.h || 1);
      const mv = (x, y) => [x + ((k * rule.w) / 2) * ((x - cx) / ((bb.w || 1) / 2)), y + k * rule.h * ((y - bb.y0) / (bb.h || 1))];
      p.nodes.forEach((N) => { const q = mv(N.x, N.y), gx = N.g ? k * N.g[0] : 0, gy = N.g ? k * N.g[1] : 0; N.x = r2(q[0] + gx); N.y = r2(q[1] + gy); if (N.o) N.o = [N.o[0] * sx, N.o[1] * sy]; if (N.i) N.i = [N.i[0] * sx, N.i[1] * sy]; });
      (p.pleats || []).forEach((q) => { q.x = r2(mv(q.x, bb.y0)[0]); });
      (p.lines || []).forEach((l) => { l.a = mv(l.a[0], l.a[1]); l.b = mv(l.b[0], l.b[1]); }); (p.folds || []).forEach((f) => { f.a = mv(f.a[0], f.a[1]); f.b = mv(f.b[0], f.b[1]); });
      (p.buttons || []).forEach((b) => { const q = mv(b.x, b.y); b.x = r2(q[0]); b.y = r2(q[1]); });
      if (p.arr) { const hs = (g.body.height * k) / 168; p.arr.top = r2((p.arr.top || 0) * (1 + hs)); if (p.arr.along) p.arr.along = r2(p.arr.along * (1 + hs)); if (p.arr.x) p.arr.x = r2(p.arr.x * sx); if (p.arr.y) p.arr.y = r2(p.arr.y * sy); }
    });
    const base = Object.assign({}, K.PRESETS[(P.body && P.body.preset) || 'female'], P.body || {}), st = g.body; Q.body = { preset: (P.body && P.body.preset) || 'female', height: r2(base.height + k * st.height), chest: r2(base.chest + k * st.chest), waist: r2(base.waist + k * st.waist), hip: r2(base.hip + k * st.hip), shoulder: r2(base.shoulder + k * st.shoulder) };
    return Q;
  }

  // what each piece and each seam measures, size by size
  function sizeTable(P) {
    const K = Pat(), g = grading(P), rows = {}, seams = {};
    g.sizes.forEach((s) => {
      const Q = atSize(P, s); Q.pieces.forEach((p, i) => { const bb = K.bbox(K.flatten(p).poly), key = P.pieces[i] ? P.pieces[i].name : p.name; (rows[key] = rows[key] || {})[s] = { w: r2(bb.w), h: r2(bb.h), area: r2(Math.abs(K.area(K.flatten(p).poly))) }; });
      K.seamInfo(Q).forEach((x, j) => { (seams[j] = seams[j] || {})[s] = { a: r2(x.lenA), b: r2(x.lenB), pct: r2(x.pct) }; });
    });
    return { sizes: g.sizes, base: g.base, pieces: Object.keys(rows).map((n) => ({ name: n, sizes: rows[n] })), seams: Object.keys(seams).map((j) => ({ index: +j, sizes: seams[j] })) };
  }

  // ── DXF, the way a pattern CAD names things (ASTM D6673 / AAMA layers): 1 cutting line, 14 sewing line, 4 notches, 7 grain line, 8 inner lines, 15 text ──
  const LAYER = { cut: '1', sew: '14', notch: '4', grain: '7', inner: '8', text: '15' };
  const dxfNum = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
  function dxfWrite(ents) {
    const o = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
    ents.forEach((e) => {
      if (e.type === 'poly') { o.push('0', 'POLYLINE', '8', e.layer, '66', '1', '70', e.closed ? '1' : '0'); e.pts.forEach((p) => o.push('0', 'VERTEX', '8', e.layer, '10', dxfNum(p[0]), '20', dxfNum(p[1]))); o.push('0', 'SEQEND', '8', e.layer); }
      else if (e.type === 'line') o.push('0', 'LINE', '8', e.layer, '10', dxfNum(e.a[0]), '20', dxfNum(e.a[1]), '11', dxfNum(e.b[0]), '21', dxfNum(e.b[1]));
      else if (e.type === 'text') o.push('0', 'TEXT', '8', e.layer, '10', dxfNum(e.at[0]), '20', dxfNum(e.at[1]), '40', dxfNum(e.h), '1', String(e.text).replace(/[\r\n]/g, ' '));
    });
    o.push('0', 'ENDSEC', '0', 'EOF'); return o.join('\n') + '\n';
  }
  // read back what dxfWrite writes (and the plain parts of other files): a list of { type, layer, pts | a, b | text }
  function dxfRead(text) {
    const L = String(text).split(/\r?\n/), pairs = []; for (let i = 0; i + 1 < L.length; i += 2) pairs.push([L[i].trim(), L[i + 1]]);
    const out = []; let cur = null, inEnt = false;
    pairs.forEach(([c, v]) => {
      if (c === '2' && v.trim() === 'ENTITIES') { inEnt = true; return; } if (!inEnt) return;
      if (c === '0') { const t = v.trim(); if (t === 'ENDSEC') { inEnt = false; return; } if (t === 'POLYLINE') { cur = { type: 'poly', layer: '', pts: [], closed: false }; out.push(cur); } else if (t === 'VERTEX') { cur = cur && cur.type === 'poly' ? cur : null; if (cur) cur._v = true; } else if (t === 'SEQEND') { if (cur) delete cur._v; cur = null; } else if (t === 'LINE') { cur = { type: 'line', layer: '', a: [0, 0], b: [0, 0] }; out.push(cur); } else if (t === 'TEXT') { cur = { type: 'text', layer: '', at: [0, 0], h: 0, text: '' }; out.push(cur); } else cur = null; return; }
      if (!cur) return; const n = parseFloat(v);
      if (c === '8') cur.layer = v.trim(); else if (c === '70' && cur.type === 'poly' && !cur._v) cur.closed = (n & 1) === 1;
      else if (cur.type === 'poly' && cur._v) { if (c === '10') cur.pts.push([n, 0]); else if (c === '20') cur.pts[cur.pts.length - 1][1] = n; }
      else if (cur.type === 'line') { if (c === '10') cur.a[0] = n; else if (c === '20') cur.a[1] = n; else if (c === '11') cur.b[0] = n; else if (c === '21') cur.b[1] = n; }
      else if (cur.type === 'text') { if (c === '10') cur.at[0] = n; else if (c === '20') cur.at[1] = n; else if (c === '40') cur.h = n; else if (c === '1') cur.text = v; }
    });
    return out;
  }
  // the pattern as DXF, in mm, y up. allow: seam allowance (cm) for the cutting line. One piece per row, left to right.
  function pieceEnts(P, p, ox, oy, label, allow) {
    const K = Pat(), fl = K.flatten(p, 1), bb = K.bbox(fl.poly), M = 10, X = (x) => (x - bb.x0 + ox) * M, Y = (y) => -(y - bb.y0 + oy) * M, ents = [];
    const sew = fl.poly.map((q) => [X(q[0]), Y(q[1])]); ents.push({ type: 'poly', layer: LAYER.sew, closed: true, pts: sew });
    ents.push({ type: 'poly', layer: LAYER.cut, closed: true, pts: allow > 0 ? K.allowance(p, allow).map((q) => [X(q[0]), Y(q[1])]) : sew });
    p.notches.forEach((n) => { const e = p.edges.findIndex((x) => x.id === n.edge); if (e < 0) return; const c = K.seg(p, e), t = n.t, u = 1 - t, q = [0, 1].map((k) => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]), a = [X(q[0]), Y(q[1])]; ents.push({ type: 'line', layer: LAYER.notch, a, b: [a[0], a[1] + 5] }); });
    (p.lines || []).forEach((l) => ents.push({ type: 'line', layer: LAYER.inner, a: [X(l.a[0]), Y(l.a[1])], b: [X(l.b[0]), Y(l.b[1])] }));
    const gx = X(bb.x0 + bb.w / 2); ents.push({ type: 'line', layer: LAYER.grain, a: [gx, Y(bb.y0 + bb.h * 0.15)], b: [gx, Y(bb.y0 + bb.h * 0.85)] });
    ents.push({ type: 'text', layer: LAYER.text, at: [X(bb.x0 + bb.w * 0.1), Y(bb.y0 + bb.h * 0.5)], h: 8, text: p.name + (label ? ' ' + label : '') });
    return { ents, w: bb.w, h: bb.h };
  }
  function toDXF(P, opt) {
    const o = opt || {}, Q = o.size ? atSize(P, o.size) : P, ents = []; let x = 0;
    Q.pieces.forEach((p) => { const r = pieceEnts(Q, p, x, 0, o.size || '', o.allow || 0); ents.push(...r.ents); x += r.w + 5 + (o.allow || 0) * 2; });
    return dxfWrite(ents);
  }
  // every size on top of the other, from the same reference (the centre of the top edge of each piece): the grade nest a pattern maker reads the grading from
  function toDXFNest(P, opt) {
    const o = opt || {}, g = grading(P), ents = []; let x = 0;
    P.pieces.forEach((p0, i) => {
      let wmax = 0;
      g.sizes.forEach((s) => { const Q = atSize(P, s), p = Q.pieces[i]; if (!p) return; const K = Pat(), bb0 = K.bbox(K.flatten(p).poly); const r = pieceEnts(Q, p, x + (0), 0, s, o.allow || 0); r.ents.forEach((e) => { if (e.type === 'text') return; ents.push(e); });
        ents.push({ type: 'text', layer: LAYER.text, at: [(x + bb0.w + 1) * 10, -(bb0.h * 0.5 + g.sizes.indexOf(s) * 4) * 10], h: 8, text: p0.name + ' ' + s }); wmax = Math.max(wmax, bb0.w); });
      x += wmax + 20;
    });
    return dxfWrite(ents);
  }

  // ── the data a tech pack is made from ──
  function pack(P, extra) {
    const K = Pat(), g = grading(P), st = sizeTable(P), pcs = P.pieces.map((p) => {
      const fl = K.flatten(p, 1), sh = K.shares(p, fl), at = (e, t) => { const c = K.seg(p, e), u = 1 - t; return [0, 1].map((k) => r2(u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k])); };
      return { name: p.name, mode: p.arr && p.arr.mode, cloth: p.fab || (p.mat === 'rib' ? 'rib' : null), poly: fl.poly, edges: p.edges.map((e, k) => ({ n: k + 1, label: e.label || '', len: r2(sh[k].len), hold: !!e.hold, topstitch: !!e.topstitch, attach: !!e.attach, mid: at(k, 0.5) })), notches: p.notches.map((n) => { const e = p.edges.findIndex((x) => x.id === n.edge); return e < 0 ? null : at(e, n.t); }).filter(Boolean), buttons: (p.buttons || []).map((b) => [b.x, b.y]), folds: (p.folds || []).map((f) => ({ a: f.a, b: f.b, angle: f.angle })) };
    });
    const name = (id, eid) => { const i = P.pieces.findIndex((q) => q.id === id), p = P.pieces[i]; return p ? p.name + ' ' + (p.edges.findIndex((e) => e.id === eid) + 1) : '?'; };
    const seams = K.seamInfo(P).map((s) => ({ a: s.a.map((x) => name(x.piece, x.eid)).join(' + '), b: s.b.map((x) => name(x.piece, x.eid)).join(' + '), lenA: r2(s.lenA), lenB: r2(s.lenB), pct: r2(s.pct), zip: !!(P.seams.find((q) => q.id === s.id) || {}).zip }));
    return Object.assign({ name: P.name, date: new Date().toISOString().slice(0, 10), fabric: { family: (P.fabric && P.fabric.family) || '', gsm: (P.fabric && P.fabric.gsm) || 0 }, body: Object.assign({ preset: 'female' }, P.body || {}), sizes: g.sizes, base: g.base, pieces: pcs, seams, grade: st.pieces, gradeSeams: st.seams, stitches: (P.stitches || []).length }, extra || {});
  }

  const KAProd = { DEFAULT_GRADING, grading, stepOf, defaultRule, ruleOf, atSize, sizeTable, toDXF, toDXFNest, dxfRead, dxfWrite, pack, LAYER };
  root.KAProd = KAProd; if (typeof module !== 'undefined' && module.exports) module.exports = KAProd;
})(typeof window !== 'undefined' ? window : globalThis);
