/**
 * Starting garments, drafted from measures: each one is a function that draws pieces, arranges them and sews them (KAPat data), nothing more.
 * The measures are those of a spec sheet (flat widths, in cm): chest, length, shoulder, armhole, neck_w, neck_df, sleeve_l, bicep, sleeve_o, hem, ...
 * A draft is a plain starting point: a person can change any piece afterwards, and a template has no special standing in the simulator.
 */
(function (root) {
  'use strict';
  const Pat = () => root.KAPat || (typeof require !== 'undefined' ? require('./garment-pattern.js') : null);
  const r2 = (v) => Math.round(v * 100) / 100;
  const N = (x, y, o) => Object.assign({ x, y }, o || {});
  const DEFAULT = { chest: 52, length: 70, shoulder: 45, armhole: 23, neck_w: 18, neck_df: 8, sleeve_l: 21, bicep: 18.5, sleeve_o: 16.5 };

  // what a spec sheet may leave out: the usual shares of the chest (the same ones the pattern engine uses)
  const fillTee = (m0) => { const c = m0.chest; return Object.assign({ shoulder: 0.865 * c, armhole: 0.44 * c, neck_w: 0.345 * c, neck_df: 0.155 * c, neck_db: 2, sleeve_l: 0.4 * c, bicep: 0.355 * c, sleeve_o: 0.32 * c, slope: 2.5, hem: c, length: 1.35 * c }, m0); };

  // the front or the back of a top: a neck, shoulders, curved armholes, sides and a hem; edge k runs from node k to node k+1
  function bodyNodes(m, drop) {
    const W = m.chest, i = (W - m.shoulder) / 2, cx = W / 2, nw = m.neck_w, ah = m.armhole, sl = m.slope, L = m.length, hw = m.hem / 2, k = 0.55, bulge = 0.08 * ah;
    return [
      N(cx - nw / 2, 0, { o: [0, k * drop] }), N(cx, drop, { sm: true, i: [-k * nw / 2, 0], o: [k * nw / 2, 0] }), N(cx + nw / 2, 0, { i: [0, k * drop], o: [0, 0] }),
      N(W - i, sl), N(W - i - bulge, sl + 0.55 * ah, { sm: true }), N(W, sl + ah), N(cx + hw, L), N(cx - hw, L), N(0, sl + ah), N(i + bulge, sl + 0.55 * ah, { sm: true }), N(i, sl),
    ];
  }
  const BODY_LABELS = ['neck', 'neck', 'shoulder', 'armhole', 'armhole', 'side', 'hem', 'side', 'armhole', 'armhole', 'shoulder'];

  const KATpl = {
    LIST: [
      { id: 'skirt', name: 'Skirt (A-line)', note: 'One piece, a held waist, a side seam.', fam: 'woven' },
      { id: 'tee', name: 'T-shirt', note: 'Front, back, two sleeves.', fam: 'jersey' },
      { id: 'longsleeve', name: 'Long-sleeve tee', note: 'The tee with long sleeves.', fam: 'jersey' },
      { id: 'polo', name: 'Polo', note: 'The tee with a button placket.', fam: 'interlock' },
      { id: 'shirt', name: 'Shirt', note: 'Long sleeves and a button placket.', fam: 'woven' },
      { id: 'jacket', name: 'Zip jacket', note: 'Two fronts closed by a zip, a back, long sleeves.', fam: 'fleece' },
      { id: 'hoodie', name: 'Pullover with pocket', note: 'A sweatshirt with a kangaroo pocket. The hood is not made: it needs a head to fall over.', fam: 'fleece' },
      { id: 'dress', name: 'Dress (sleeveless)', note: 'A long top that flares to the hem.', fam: 'jersey' },
      { id: 'pant', name: 'Trousers (legs only)', note: 'Two legs hung from the hips; no waistband or rise yet.', fam: 'woven' },
      { id: 'bandeau', name: 'Bandeau top', note: 'A band round the chest. A bra needs a body with a bust, and this body has none.', fam: 'lycra' },
    ],
    // a spec-sheet chart ({key: {size: value}}) to the measures of one size, in cm
    fromChart(chart, size, unit) {
      const f = unit === 'inch' ? 2.54 : 1, out = {}; Object.keys(chart || {}).forEach((k) => { const v = parseFloat(chart[k] && chart[k][size]); if (v > 0) out[k] = r2(v * f); });
      if (out.hem_w && !out.hem) out.hem = out.hem_w; return out;
    },
    // build a template into a new project. m0: measures (cm); opt: { size, fabric }
    build(kind, m0, opt) { const P = this.draft(kind, m0, opt); this.layout(P); return P; },
    // the pieces side by side on the table (patches on the piece they go on are not moved: they are placed by their own numbers), so they can be seen and picked
    layout(P) {
      const K = Pat(); let x = 0, ymax = 0; P.pieces.filter((p) => p.arr.mode !== 'patch').forEach((p) => { const bb = K.bbox(K.flatten(p).poly); K.translate(p, x - bb.x0, -bb.y0); x += bb.w + 8; ymax = Math.max(ymax, bb.h); });
      let px = 0; P.pieces.filter((p) => p.arr.mode === 'patch').forEach((p) => { const bb = K.bbox(K.flatten(p).poly); K.translate(p, px - bb.x0, ymax + 8 - bb.y0); px += bb.w + 8; });
    },
    draft(kind, m0, opt) {
      const K = Pat(), o = opt || {}, info = this.LIST.find((t) => t.id === kind); if (!info) throw new Error('no template ' + kind);
      const P = K.create(info.name); P.tpl = { kind, size: o.size || null }; P.fabric = Object.assign({ gsm: 180, family: info.fam }, o.fabric || {});
      const add = (nodes, name, arr, mat) => K.addPiece(P, nodes, name, { arr, mat }), E = (p, k) => ({ piece: p.id, eid: p.edges[k].id }), sew = (a, b) => K.sew(P, a, b);
      const label = (p, ls) => ls.forEach((l, k) => { if (p.edges[k]) p.edges[k].label = l; }), idx = (p, l) => p.edges.map((e, k) => (e.label === l ? k : -1)).filter((k) => k >= 0);
      if (kind === 'skirt') {
        const m = Object.assign({ waist: 70, hip: 94, length: 55, hem: 110 }, m0), w = m.waist, p = add([[(m.hem - w) / 2, 0], [(m.hem + w) / 2, 0], [m.hem, m.length], [0, m.length]], 'Skirt', { mode: 'wrap', top: 108 });
        label(p, ['waist', 'side', 'hem', 'side']); p.edges[0].hold = true; sew(E(p, 1), E(p, 3)); P.body = { preset: 'female', waist: Math.round(m.waist * 0.85), hip: Math.round(m.hip * 0.97) }; return P;
      }
      if (kind === 'pant') {
        const m = Object.assign({ thigh: 30, leg_opening: 20, inseam: 75 }, m0), tw = 2 * m.thigh, hw = 2 * m.leg_opening;
        ['legL', 'legR'].forEach((mode, s) => { const p = add([[0, 0], [tw, 0], [(tw + hw) / 2, m.inseam], [(tw - hw) / 2, m.inseam]], s ? 'Right leg' : 'Left leg', { mode, along: 6 }); label(p, ['top', 'inseam', 'hem', 'outseam']); p.edges[0].hold = true; sew(E(p, 1), E(p, 3)); });
        P.body = { preset: 'female' }; return P;
      }
      if (kind === 'bandeau') {
        const m = Object.assign({ chest: 80, height: 14 }, m0), p = add([[0, 0], [m.chest, 0], [m.chest, m.height], [0, m.height]], 'Band', { mode: 'wrap', top: 130 }, 'rib');
        label(p, ['top', 'side', 'bottom', 'side']); p.edges[0].hold = true; sew(E(p, 1), E(p, 3)); P.body = { preset: 'female' }; return P;
      }
      // the tops
      const m = fillTee(Object.assign({}, DEFAULT, m0)), long = ['longsleeve', 'shirt', 'jacket', 'hoodie'].includes(kind), sleeveless = kind === 'dress', has = (k) => m0 && m0[k] > 0;
      if (long && !has('sleeve_l')) m.sleeve_l = Math.round(0.9 * m.length);
      if (long && !has('sleeve_o')) m.sleeve_o = Math.max(8, m.sleeve_o * 0.8);
      if (sleeveless) { if (!has('length')) m.length = 105; if (!has('hem')) m.hem = m.chest * 1.45; }
      P.body = { preset: 'female', chest: Math.round(2 * m.chest - 8), shoulder: Math.round(m.shoulder - 1) };
      const topY = K.bodyFromMeasures(P.body).anchors.neck, arr = (mode, extra) => Object.assign({ mode, top: topY }, extra || {});
      const back = add(bodyNodes(m, m.neck_db), 'Back', arr('back', { arc: [-0.05, 1.05] })); label(back, BODY_LABELS);
      let rightF, leftF, fronts;
      if (kind === 'jacket') {                                   // two halves, each from the centre front out to one side
        const cx = m.chest / 2, fn = bodyNodes(m, m.neck_df), h = [fn[1], fn[2], fn[3], fn[4], fn[5], fn[6], N(cx, m.length)].map((q) => JSON.parse(JSON.stringify(q)));
        h.forEach((q) => { q.x -= cx; }); delete h[0].sm; delete h[0].i;
        rightF = add(h, 'Front right', arr('front', { arc: [0.5, 1.05] })); label(rightF, ['neck', 'shoulder', 'armhole', 'armhole', 'side', 'hem', 'centre']);
        leftF = K.mirrorCopy(P, rightF); leftF.name = 'Front left'; leftF.arr = arr('front', { arc: [-0.05, 0.5] }); fronts = [rightF, leftF];
        const z = sew(E(rightF, idx(rightF, 'centre')[0]), E(leftF, idx(leftF, 'centre')[0])); if (z) K.setZip(P, z.id, true);
      } else { rightF = leftF = add(bodyNodes(m, m.neck_df), 'Front', arr('front', { arc: [-0.05, 1.05] })); label(rightF, BODY_LABELS); fronts = [rightF]; }
      // shoulders and sides: the front's right is the back's left (the back is seen from behind)
      const pair = (a, b, l, ia, ib) => sew(E(a, idx(a, l)[ia]), E(b, idx(b, l)[ib]));
      pair(rightF, back, 'shoulder', 0, 1); pair(leftF, back, 'shoulder', leftF === rightF ? 1 : 0, 0); pair(rightF, back, 'side', 0, 1); pair(leftF, back, 'side', leftF === rightF ? 1 : 0, 0);
      if (!sleeveless) {
        const armRun = (p) => idx(p, 'armhole').map((k) => E(p, k)), backL = [8, 9].map((k) => E(back, k)), backR = [3, 4].map((k) => E(back, k)), frontR = kind === 'jacket' ? armRun(rightF) : [3, 4].map((k) => E(rightF, k)), frontL = kind === 'jacket' ? armRun(leftF) : [8, 9].map((k) => E(leftF, k));
        // the sleeve: its cap is made as long as the armhole it goes into
        const G = 2 * m.bicep, GO = 2 * m.sleeve_o, capT = K.shares(back)[8].len + K.shares(back)[9].len;
        const mk = (ch) => [N(0, ch, { o: [G * 0.16, 0] }), N(G / 2, 0, { sm: true, i: [-G * 0.27, 0], o: [G * 0.27, 0] }), N(G, ch, { i: [-G * 0.16, 0] }), N((G + GO) / 2, m.sleeve_l + ch * 0.6), N((G - GO) / 2, m.sleeve_l + ch * 0.6)];
        let best = 0.3 * m.armhole, bd = 1e9; for (let c = 0.1; c <= 0.8; c += 0.02) { const nodes = mk(c * m.armhole), t = { nodes, edges: nodes.map((_, j) => ({ id: 't' + j, label: '' })) }, len = K.shares(t)[0].len + K.shares(t)[1].len; if (Math.abs(K.shares(t)[0].len - capT) < bd) { bd = Math.abs(K.shares(t)[0].len - capT); best = c * m.armhole; } }
        [['armL', 'Sleeve (left arm)', backL, frontR], ['armR', 'Sleeve (right arm)', frontL, backR]].forEach(([mode, name, leftRun, rightRun]) => {
          const s = add(mk(best), name, { mode, along: -4 }); label(s, ['cap', 'cap', 'underarm', 'hem', 'underarm']); sew(E(s, 4), E(s, 2)); sew(E(s, 0), leftRun); sew(E(s, 1), rightRun);
        });
      }
      // what carries the garment: the outer part of the back's shoulder seams is held where it starts, on the shoulders; the rest of the garment hangs from it by its seams.
      // (Holding the neck holds the front and the back a neck's width apart, and a seam cannot close across that; holding nothing lets a tee slide down the body.)
      if (o.holdNeck) fronts.concat([back]).forEach((p) => p.edges.forEach((e) => { if (e.label === 'neck') e.hold = true; }));
      else {
        // the shoulder seams are split where their outer part begins, and that part is held on both the front and the back
        const holdOuter = (p) => { idx(p, 'shoulder').slice().reverse().forEach((k) => { const first = p.edges.length && (p.nodes[k].x < p.nodes[(k + 1) % p.nodes.length].x); const outerIsEnd = (k === idx(p, 'shoulder')[0]) !== (leftF !== rightF && p === leftF); /* the edge whose end is the shoulder tip */ void first; void outerIsEnd; }); };
        void holdOuter;
        const tipEdges = (p) => idx(p, 'shoulder').map((k) => { const a = p.nodes[k], b = p.nodes[(k + 1) % p.nodes.length], na = p.nodes[(k + p.nodes.length - 1) % p.nodes.length]; return { k, tipAtEnd: p.edges[k] && b.y > a.y }; });
        [back].concat(fronts).forEach((p) => { tipEdges(p).sort((x, y) => y.k - x.k).forEach(({ k, tipAtEnd }) => { K.addNode(P, p, k, tipAtEnd ? 0.45 : 0.55); p.edges[tipAtEnd ? k + 1 : k].hold = true; p.edges[tipAtEnd ? k : k + 1].hold = false; }); });
      }
      const fp = fronts[0];
      if (kind === 'polo' || kind === 'shirt') { const n = kind === 'shirt' ? 6 : 3; for (let k = 0; k < n; k++) K.addButton(fp, m.chest / 2, m.neck_df + 2 + k * (kind === 'shirt' ? 9 : 7), 0.6); }
      if (kind === 'hoodie') { const pw = m.chest * 0.6, pk = K.rect(P, 0, 0, pw, 18, 'Pocket', { arr: { mode: 'patch', on: fp.id, x: (m.chest - pw) / 2, y: m.length * 0.5 } }); [1, 2, 3].forEach((k) => { pk.edges[k].attach = true; pk.edges[k].topstitch = true; }); }
      return P;
    },
  };
  root.KATpl = KATpl; if (typeof module !== 'undefined' && module.exports) module.exports = KATpl;
})(typeof window !== 'undefined' ? window : globalThis);
