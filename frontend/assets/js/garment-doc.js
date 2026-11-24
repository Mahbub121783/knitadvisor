/**
 * KnitAdvisor — the garment document (plain data; no three.js)
 * ===================================================================
 * A garment is a document, whatever it is: pieces (an outline, the label of every edge, where the piece starts in space, the fabric it is cut from),
 * the stitches that join one piece's edge to another's, the outline held where it starts, the body it hangs on, the settings of the cloth.
 * The cloth simulator reads this and nothing else (KASim.fromDoc): it has no idea what a tee, a trouser or a skirt is.
 *
 * Where a document comes from:
 *   - a block (a tee, a pair of legs, ...) that turns a drafted size into a document: fromRaw(). The garment-specific knowledge (which edge is sewn to which) is
 *     in BLOCKS below, as data-producing rules, and nowhere else;
 *   - the pattern editor (a piece drawn by hand, a seam clicked edge to edge): the same fields, written by the editor;
 *   - a file: toJSON() / fromJSON().
 *
 *   doc = { format: 'ka-garment', version: 1, unit: 'cm', name, block, fabric: { gsm },
 *           pieces:   [{ id, pid, name, poly, labels, material, grp?, pinAll?, placement: { x0, y0, dx, dy, nx, ny, xyz } }],
 *           stitches: [{ a: [pieceId, s], b: [pieceId, s] }],       s = the share (0..1) of the way round the outline
 *           seams:    [{ a: [{ piece, s0, s1, rev? }], b: [...], mode: 'share' | 'end' }],
 *           pins:     [{ piece, s0, s1 }],
 *           avatar:   { top, loft: { keys, from }, caps: [{ A, B, ra, rb }], spheres: [{ c, r }] },
 *           sim:      { gravity } }
 */
(function (root) {
  'use strict';
  const FORMAT = 'ka-garment', VERSION = 1;

  // ── blocks: what a drafted tee or a pair of legs knows about itself, written out as data ──
  const runOf = (insts, id, labels, opt) => {                                       // the outline points of a piece that carry these edge labels, in order along y
    opt = opt || {}; const t = insts.find((q) => q.id === id); if (!t) return []; const m = t.mesh, r = [];
    for (let i = 0; i < m.nb; i++) { if (labels.indexOf(m.blabels[i]) < 0) continue; const x = m.pts[i][0]; if (opt.side > 0 ? x < -0.01 : opt.side < 0 ? x > 0.01 : false) continue; r.push([id, i, m.pts[i][1]]); }
    r.sort((a, b) => (opt.order === 'up' ? a[2] - b[2] : b[2] - a[2])); return r.map((q) => [q[0], q[1]]);
  };
  const BLOCKS = {
    tee: {
      gravity: 980, pinSeams: ['neck'], proxSeams: ['neck', 'hem', 'sleeve_hem', 'band_end', 'cuff_end', 'hemband_end'], selfSeams: ['underarm', 'band_end', 'cuff_end', 'hemband_end'], groupSeams: null,
      avatar: (K, size) => K.bodyTee(size, {}),
      // the shoulders, the sides, the armholes to the sleeve caps, the underarm of each sleeve
      sewing(insts) {
        const out = [], by = (id) => insts.find((t) => t.id === id), fid = by('front') ? 'front' : null;
        [1, -1].forEach((s) => {
          const F = fid || (s > 0 ? 'front_r' : 'front_l'), sl = s > 0 ? 'sleeveR' : 'sleeveL', fs = fid ? s : 0;
          out.push([runOf(insts, F, ['shoulder'], { side: fs, order: 'up' }), runOf(insts, 'back', ['shoulder'], { side: -s, order: 'up' })]);
          out.push([runOf(insts, F, ['side', 'sidehem'], { side: fs, order: 'down' }), runOf(insts, 'back', ['side', 'sidehem'], { side: -s, order: 'down' })]);
          const A = runOf(insts, F, ['armhole'], { side: fs, order: 'up' }).concat(runOf(insts, 'back', ['armhole'], { side: -s, order: 'down' }));
          const C = runOf(insts, sl, ['cap'], { side: 1, order: 'up' }).concat(runOf(insts, sl, ['cap'], { side: -1, order: 'down' }));
          out.push([A, C]);
        });
        ['sleeveR', 'sleeveL'].forEach((id) => out.push([runOf(insts, id, ['underarm', 'underarmhem'], { side: 1, order: 'up' }), runOf(insts, id, ['underarm', 'underarmhem'], { side: -1, order: 'up' })]));
        return out;
      },
    },
    legs: {
      gravity: 700, pinSeams: ['waistband'], proxSeams: [], selfSeams: ['band_end'], groupSeams: ['inseam', 'side'],
      avatar: (K, size) => K.bodyLegs(size, {}),
      // each leg's side and inseam, front to back, from the hem up; the rise joins the right half to the left, in front and behind
      sewing(insts) {
        const out = [];
        const up = { order: 'up' };
        ['R', 'L'].forEach((g) => { out.push([runOf(insts, 'front' + g, ['side', 'sidehem'], up), runOf(insts, 'back' + g, ['side', 'sidehem'], up), 'end']); out.push([runOf(insts, 'front' + g, ['inseam', 'inseamhem'], up), runOf(insts, 'back' + g, ['inseam', 'inseamhem'], up), 'end']); });
        ['front', 'back'].forEach((p) => out.push([runOf(insts, p + 'R', ['centre', 'crotch'], { order: 'up' }), runOf(insts, p + 'L', ['centre', 'crotch'], { order: 'up' })]));
        return out;
      },
    },
  };

  const r3 = (v) => Math.round(v * 1000) / 1000;
  // sample where a piece starts (a function of its flat point) on a grid, so the document holds numbers and not code
  function samplePlacement(poly, map, g) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; poly.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; });
    x0 -= 0.5; y0 -= 0.5; x1 += 0.5; y1 += 0.5; const nx = Math.max(2, Math.ceil((x1 - x0) / g) + 1), ny = Math.max(2, Math.ceil((y1 - y0) / g) + 1), dx = (x1 - x0) / (nx - 1), dy = (y1 - y0) / (ny - 1), xyz = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const p = map(x0 + i * dx, y0 + j * dy); xyz.push(r3(p[0]), r3(p[1]), r3(p[2])); }
    return { x0: r3(x0), y0: r3(y0), dx: r3(dx), dy: r3(dy), nx, ny, xyz };
  }

  // a drafted garment (the raw record the 3D form leaves: pieces with the function that places them) -> a document
  function fromRaw(raw, ctx) {
    const K = ctx.K, blk = BLOCKS[raw.kind]; if (!blk) throw new Error('no block for ' + raw.kind);
    const body = blk.avatar(K, raw.size);
    const area = raw.inst.reduce((a, it) => { let s = 0; for (let i = 0; i < it.poly.length; i++) { const p = it.poly[i], q = it.poly[(i + 1) % it.poly.length]; s += p[0] * q[1] - q[0] * p[1]; } return a + Math.abs(s) / 2; }, 0);
    const h = Math.max(1.5, Math.min(3.2, Math.sqrt(area / (3200 * 0.866))));
    const insts = raw.inst.map((it) => ({ id: it.id, pid: it.pid, mesh: K.meshPiece(it.poly, it.labels, h), map: it.map, rest: it.rest, mat: it.mat, grp: it.grp, pinAll: it.id === 'band' }));
    // the seams are found where the pieces start (and written by the block's rules), then written down as stitches: the document keeps the result, not the search
    const cloth = new K.Cloth(insts, body, { h, seamTol: Math.max(1.6, h * 0.85), gravity: blk.gravity, seamOf: ctx.seamOf || null, pinSeams: blk.pinSeams, proxSeams: blk.proxSeams, sewing: blk.sewing(insts), groupSeams: blk.groupSeams, selfSeams: blk.selfSeams });
    const S = insts.map((it) => K.outlineS(it.mesh)), where = (g) => { for (let k = 0; k < insts.length; k++) if (g >= insts[k].off && g < insts[k].off + insts[k].mesh.nb) return [k, g - insts[k].off]; return null; };
    const stitches = []; for (let e = 0; e < cloth.ss.length; e += 2) { const a = where(cloth.ss[e]), b = where(cloth.ss[e + 1]); if (!a || !b) continue; stitches.push({ a: [insts[a[0]].id, r3(S[a[0]][a[1]])], b: [insts[b[0]].id, r3(S[b[0]][b[1]])] }); }
    const pins = []; insts.forEach((it, k) => {
      if (it.pinAll) return; const nb = it.mesh.nb, on = (i) => !!cloth.pin[it.off + i];
      for (let i = 0; i < nb;) { if (!on(i)) { i++; continue; } let j = i; while (j + 1 < nb && on(j + 1)) j++; pins.push({ piece: it.id, s0: r3(S[k][i]), s1: r3(S[k][j]) }); i = j + 1; }
    });
    const pieces = insts.map((it, k) => ({ id: it.id, pid: it.pid, name: it.pid, poly: raw.inst[k].poly.map((p) => [r3(p[0]), r3(p[1])]), labels: raw.inst[k].labels.slice(), material: it.mat, grp: it.grp || null, pinAll: !!it.pinAll, rest: it.rest, placement: samplePlacement(raw.inst[k].poly, it.map, 1) }));
    return { format: FORMAT, version: VERSION, unit: 'cm', name: raw.name || raw.kind, block: raw.kind, fabric: { gsm: raw.fabric && +raw.fabric.gsm || 0 }, pieces, stitches, seams: [], pins, avatar: body.desc, sim: { gravity: blk.gravity } };
  }

  // is this a document the simulator can run? the list of what is wrong, empty if nothing is
  function validate(doc) {
    const bad = [], fin = (a) => Array.isArray(a) && a.every((v) => Number.isFinite(v));
    if (!doc || doc.format !== FORMAT) return ['not a KnitAdvisor garment document']; if (doc.version > VERSION) bad.push('written by a newer version');
    if (!Array.isArray(doc.pieces) || !doc.pieces.length) return bad.concat('no pieces');
    const ids = new Set();
    doc.pieces.forEach((p) => {
      if (!p.id || ids.has(p.id)) bad.push('piece id missing or repeated: ' + p.id); ids.add(p.id);
      if (!Array.isArray(p.poly) || p.poly.length < 3 || !p.poly.every((q) => fin(q) && q.length === 2)) bad.push(p.id + ': the outline needs 3 or more points'); else if (!Array.isArray(p.labels) || p.labels.length !== p.poly.length) bad.push(p.id + ': every outline point needs an edge label');
      const pl = p.placement; if (!pl || !(pl.nx >= 2 && pl.ny >= 2) || !Array.isArray(pl.xyz) || pl.xyz.length !== 3 * pl.nx * pl.ny || !fin(pl.xyz)) bad.push(p.id + ': where the piece starts is missing');
    });
    (doc.stitches || []).forEach((s, i) => { if (!ids.has(s.a && s.a[0]) || !ids.has(s.b && s.b[0])) bad.push('stitch ' + i + ' names a piece that is not there'); });
    (doc.seams || []).forEach((s, i) => { (s.a || []).concat(s.b || []).forEach((g) => { if (!ids.has(g.piece)) bad.push('seam ' + i + ' names a piece that is not there'); }); });
    (doc.pins || []).forEach((p, i) => { if (!ids.has(p.piece)) bad.push('pin ' + i + ' names a piece that is not there'); });
    if (!doc.avatar || !(doc.avatar.loft || (doc.avatar.caps && doc.avatar.caps.length) || (doc.avatar.spheres && doc.avatar.spheres.length))) bad.push('there is no body to hang the garment on');
    return bad;
  }
  const toJSON = (doc) => JSON.stringify(doc);
  const fromJSON = (text) => { let d; try { d = JSON.parse(text); } catch (e) { throw new Error('this file is not JSON'); } const bad = validate(d); if (bad.length) throw new Error(bad[0]); return d; };

  const KADoc = { FORMAT, VERSION, BLOCKS, fromRaw, validate, toJSON, fromJSON, samplePlacement };
  root.KADoc = KADoc; if (typeof module !== 'undefined' && module.exports) module.exports = KADoc;
})(typeof window !== 'undefined' ? window : globalThis);
