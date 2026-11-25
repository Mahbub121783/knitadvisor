'use strict';
/**
 * The garment tech pack as a PDF, drawn from the "pack" the pattern window builds (frontend/assets/js/garment-prod.js: KAProd.pack).
 * Nothing is computed here: the pack carries every number; this only checks it, and draws it (the pieces in true size where they fit, scaled where they do not).
 */
const PDFDocument = require('pdfkit');

const MAX_PIECES = 40, MAX_POINTS = 3000, MAX_SIZES = 12, MAX_SEAMS = 200;
const num = (v, d) => (Number.isFinite(+v) ? +v : d || 0);
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n || 80);
const pt = (p) => (Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) ? [+p[0], +p[1]] : null);

// a pack from outside is data to be checked, never trusted
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('no pack');
  const sizes = (Array.isArray(raw.sizes) ? raw.sizes : []).slice(0, MAX_SIZES).map((s) => str(s, 12));
  const pieces = (Array.isArray(raw.pieces) ? raw.pieces : []).slice(0, MAX_PIECES).map((p) => ({
    name: str(p.name, 40), mode: str(p.mode, 20), cloth: str(p.cloth, 20),
    poly: (Array.isArray(p.poly) ? p.poly : []).slice(0, MAX_POINTS).map(pt).filter(Boolean),
    edges: (Array.isArray(p.edges) ? p.edges : []).slice(0, 200).map((e) => ({ n: num(e.n), label: str(e.label, 30), len: num(e.len), hold: !!e.hold, topstitch: !!e.topstitch, attach: !!e.attach, mid: pt(e.mid) })),
    notches: (Array.isArray(p.notches) ? p.notches : []).slice(0, 100).map(pt).filter(Boolean), buttons: (Array.isArray(p.buttons) ? p.buttons : []).slice(0, 100).map(pt).filter(Boolean),
  })).filter((p) => p.poly.length >= 3);
  if (!pieces.length) throw new Error('no pieces');
  const seams = (Array.isArray(raw.seams) ? raw.seams : []).slice(0, MAX_SEAMS).map((s) => ({ a: str(s.a, 60), b: str(s.b, 60), lenA: num(s.lenA), lenB: num(s.lenB), pct: num(s.pct), zip: !!s.zip }));
  const grade = (Array.isArray(raw.grade) ? raw.grade : []).slice(0, MAX_PIECES).map((g) => ({ name: str(g.name, 40), sizes: Object.fromEntries(sizes.map((s) => [s, { w: num(g.sizes && g.sizes[s] && g.sizes[s].w), h: num(g.sizes && g.sizes[s] && g.sizes[s].h) }])) }));
  const fit = (Array.isArray(raw.fit) ? raw.fit : []).slice(0, MAX_SIZES).map((f) => ({ size: str(f.size, 12), tight_pct: num(f.tight_pct), crowded_pct: num(f.crowded_pct), seam_gap: num(f.seam_gap), mean_gap: num(f.mean_gap, -1), p95_gap: num(f.p95_gap, -1) }));
  const b = raw.body || {};
  return { name: str(raw.name, 60) || 'Garment', date: str(raw.date, 12), fabric: { family: str(raw.fabric && raw.fabric.family, 20), gsm: num(raw.fabric && raw.fabric.gsm) }, body: { preset: str(b.preset, 10), height: num(b.height), chest: num(b.chest), waist: num(b.waist), hip: num(b.hip), shoulder: num(b.shoulder) }, sizes, base: str(raw.base, 12), pieces, seams, grade, fit };
}

function renderGarmentPack(raw) {
  const pack = sanitize(raw), doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: pack.name + ' — tech pack', Author: 'KnitAdvisor' } });
  const W = doc.page.width - 72, line = (t, o) => doc.text(t, Object.assign({ width: W }, o || {}));
  const head = (t) => { doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(t).moveDown(0.3); doc.font('Helvetica').fontSize(9).fillColor('#222'); };
  // page 1: what it is
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#111').text(pack.name); doc.font('Helvetica').fontSize(9).fillColor('#555').text('Garment tech pack · ' + pack.date + ' · KnitAdvisor').moveDown(1);
  head('Cloth and body');
  line('Cloth: ' + (pack.fabric.family ? pack.fabric.family.replace('_', ' ') : 'not chosen') + (pack.fabric.gsm ? ', ' + pack.fabric.gsm + ' GSM' : '') + '. The stretch and drape numbers of a cloth family are typical values, not measurements of this fabric.');
  line('Body the pattern is drafted for: ' + [pack.body.preset, pack.body.height && 'height ' + pack.body.height, pack.body.chest && 'chest ' + pack.body.chest, pack.body.waist && 'waist ' + pack.body.waist, pack.body.hip && 'hip ' + pack.body.hip].filter(Boolean).join(', ') + ' cm.'); doc.moveDown(0.8);
  if (pack.grade.length && pack.sizes.length) {
    head('Pieces by size (width × height, cm, flat outline)'); const c0 = 36, cw = Math.min(90, (W - 130) / pack.sizes.length); let y = doc.y;
    doc.font('Helvetica-Bold').text('Piece', c0, y, { width: 126 }); pack.sizes.forEach((s, i) => doc.text(s + (s === pack.base ? ' (base)' : ''), c0 + 130 + i * cw, y, { width: cw })); y += 14; doc.font('Helvetica');
    pack.grade.forEach((g) => { if (y > 740) { doc.addPage(); y = 50; } doc.text(g.name, c0, y, { width: 126 }); pack.sizes.forEach((s, i) => doc.text(g.sizes[s].w.toFixed(1) + ' × ' + g.sizes[s].h.toFixed(1), c0 + 130 + i * cw, y, { width: cw })); y += 13; });
    doc.y = y + 8; doc.x = 36;
  }
  if (pack.fit.length) { doc.moveDown(0.5); head('Fit by size (a cloth simulation on a body of that size)'); pack.fit.forEach((f) => line(f.size + ': ' + f.tight_pct.toFixed(0) + ' % of the cloth near its limit, ' + f.crowded_pct.toFixed(0) + ' % crowded, seams closed to within ' + (f.mean_gap >= 0 ? f.mean_gap.toFixed(1) + ' cm on average (95 % within ' + f.p95_gap.toFixed(1) + ' cm)' : f.seam_gap.toFixed(1) + ' cm at the worst'))); }
  if (pack.seams.length) {
    doc.addPage(); head('Seams'); pack.seams.forEach((s) => { if (doc.y > 760) doc.addPage(); line((s.zip ? '[zip] ' : '') + s.a + '  ↔  ' + s.b + '   ' + s.lenA.toFixed(1) + ' / ' + s.lenB.toFixed(1) + ' cm' + (Math.abs(s.pct) > 0.5 ? '   ease ' + Math.abs(s.pct).toFixed(1) + ' %' : '')); });
  }
  // one page per piece, drawn as large as the page allows (true size when it fits)
  pack.pieces.forEach((p) => {
    doc.addPage(); doc.font('Helvetica-Bold').fontSize(15).fillColor('#111').text(p.name); doc.font('Helvetica').fontSize(9).fillColor('#555').text('Hangs: ' + (p.mode || '—') + (p.cloth ? ' · cloth ' + p.cloth : '')).moveDown(0.5);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; p.poly.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const CM = 28.3465, bw = W, bh = 420, k = Math.min(CM, bw / Math.max(1, x1 - x0), bh / Math.max(1, y1 - y0)), ox = 36 + (bw - (x1 - x0) * k) / 2, oy = doc.y + 4, X = (x) => ox + (x - x0) * k, Y = (y) => oy + (y - y0) * k;
    doc.lineWidth(0.8).strokeColor('#111'); doc.moveTo(X(p.poly[0][0]), Y(p.poly[0][1])); p.poly.slice(1).forEach((q) => doc.lineTo(X(q[0]), Y(q[1]))); doc.closePath().stroke();
    p.edges.forEach((e) => { if (!e.mid) return; doc.fontSize(8).fillColor(e.hold ? '#1d4ed8' : '#b45309').text(String(e.n), X(e.mid[0]) - 4, Y(e.mid[1]) - 4, { width: 12, lineBreak: false }); });
    p.notches.forEach((n) => doc.circle(X(n[0]), Y(n[1]), 2).fill('#dc2626')); p.buttons.forEach((b) => doc.circle(X(b[0]), Y(b[1]), 3).lineWidth(0.6).stroke('#555'));
    doc.fontSize(8).fillColor('#555').text(k >= CM - 1e-6 ? 'Drawn 1:1.' : 'Drawn at ' + Math.round((k / CM) * 100) + ' % of true size.', 36, oy + bh + 6, { width: W });
    doc.y = oy + bh + 22; doc.x = 36; doc.fontSize(9).fillColor('#222'); p.edges.forEach((e) => { if (doc.y > 790) return; line(e.n + '. ' + (e.label || 'edge') + ' — ' + e.len.toFixed(1) + ' cm' + (e.hold ? ' · held on the body' : '') + (e.topstitch ? ' · topstitched' : '') + (e.attach ? ' · sewn down' : '')); });
  });
  return doc;
}

module.exports = { renderGarmentPack, sanitize };
