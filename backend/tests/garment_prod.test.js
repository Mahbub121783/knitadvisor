// Production (G7): grading, size tables, DXF, the tech pack; and the template library (G8): drafts from measures, per size, that sew and drape.
'use strict';
const assert = require('assert');
const path = require('path');
const FE = path.join(__dirname, '..', '..', 'frontend', 'assets', 'js');
const Sim = require(path.join(FE, 'garment-sim.js'));
const Doc = require(path.join(FE, 'garment-doc.js'));
const Pat = require(path.join(FE, 'garment-pattern.js'));
const Tpl = require(path.join(FE, 'garment-templates.js'));
const Prod = require(path.join(FE, 'garment-prod.js'));
const { renderGarmentPack, sanitize } = require('../engine/domain/garment-pack-pdf');

console.log('--- Running Production And Template Tests ---');
const near = (a, b, t, m) => assert(Math.abs(a - b) <= t, `${m}: ${a} vs ${b}`);
const run = (doc, steps) => { const b = Sim.fromDoc(doc), c = new Sim.Cloth(b.insts, b.body, Object.assign({}, Sim.DRAPE.medium, b.opt)); c.run(steps); return c; };
const area = (poly) => Math.abs(Pat.area(poly));
// how the seams close: the mean gap and the 95th percentile (the worst one pair is where a seam crosses the top of a shoulder, a few cm from the body's own thickness)
const gaps = (c) => { const g = []; for (let e = 0; e < c.ss.length; e += 2) { const a = 3 * c.ss[e], b = 3 * c.ss[e + 1]; g.push(Math.hypot(c.X[a] - c.X[b], c.X[a + 1] - c.X[b + 1], c.X[a + 2] - c.X[b + 2])); } g.sort((x, y) => x - y); return { mean: g.reduce((t, v) => t + v, 0) / g.length, p95: g[Math.floor(g.length * 0.95)] }; };

(async () => {
  {
    // every template is drafted, validates, and sews: nothing in the simulator knows what it is
    const kinds = Tpl.LIST.map((t) => t.id); assert(kinds.length >= 10, 'the library has its garments');
    kinds.forEach((k) => { const P = Tpl.build(k, {}), d = Pat.toDoc(P); assert.deepStrictEqual(Doc.validate(d), [], k + ' is a good document'); assert(P.seams.length >= 1 && P.pieces.length >= 1, k + ' has seams'); assert(Pat.seamInfo(P).every((s) => Math.abs(s.pct) < 25), k + ': every seam is within 25 % of equal (' + Pat.seamInfo(P).map((s) => s.pct.toFixed(0)).join(',') + ')'); });
    console.log('✓ ' + kinds.length + ' templates (' + kinds.join(', ') + ') are drafted, valid, and every seam is within 25 % of equal length');
  }
  {
    // a tee drafted from a spec sheet's measures; the sleeve cap is made as long as its armhole
    const P = Tpl.build('tee', { chest: 52, length: 70, shoulder: 45, armhole: 23, neck_w: 18, neck_df: 8, sleeve_l: 21, bicep: 18.5, sleeve_o: 16.5 }); const f = P.pieces.find((p) => p.name === 'Front'), bb = Pat.bbox(Pat.flatten(f).poly);
    near(bb.w, 52, 0.2, 'the front is as wide as the chest'); near(bb.h, 70, 0.2, 'and as long as the length');
    const inf = Pat.seamInfo(P).filter((s) => s.a.length === 1 && s.b.length === 2 || s.a.length === 2); assert(Pat.seamInfo(P).some((s) => s.b.length === 2 || s.a.length === 2), 'the armholes are runs of two edges');
    const worst = Math.max(...Pat.seamInfo(P).map((s) => Math.abs(s.pct))); assert(worst < 12, 'the sleeve cap and the armhole are close in length: ' + worst.toFixed(1) + ' %');
    const c = run(Pat.toDoc(P), 130), s = c.stats(); assert(c.X.every(Number.isFinite), 'no NaN'); const gp = gaps(c); assert(gp.mean < 3 && gp.p95 < 11, `the tee closes: mean ${gp.mean.toFixed(2)}, p95 ${gp.p95.toFixed(2)}`); assert(s.inside_body > -2, `it does not go into the body: ${s.inside_body.toFixed(2)}`); assert(Math.max(...c.X) < 200 && Math.min(...c.X) > -200 && c.X.every((v, i) => i % 3 !== 1 || v > 20), 'it hangs on the body and has not fallen');
    console.log(`✓ a tee from measures drapes and hangs: ${s.seams} seam pairs, mean gap ${gp.mean.toFixed(2)} cm (95 %: ${gp.p95.toFixed(1)}), ${s.inside_body.toFixed(2)} cm into the body; cap against armhole ${worst.toFixed(1)} % apart at worst`);
  }
  {
    // jacket (two fronts closed by a zip) and a pocketed pullover: the details the draft adds
    const J = Tpl.build('jacket', {}), dj = Pat.toDoc(J); assert(dj.seams.some((s) => s.zip), 'the jacket has a zip'); assert(J.pieces.filter((p) => /Front/.test(p.name)).length === 2, 'two fronts');
    const cj = run(dj, 110), sj = cj.stats(); const gj = gaps(cj); assert(gj.mean < 3 && gj.p95 < 11, `the jacket closes: mean ${gj.mean.toFixed(2)}, p95 ${gj.p95.toFixed(2)}`); assert(sj.inside_body > -2, `${sj.inside_body}`);
    const H = Tpl.build('hoodie', {}), dh = Pat.toDoc(H); assert(dh.pieces.some((p) => p.id && /Pocket/.test(p.name)) && dh.stitches.length > 10, 'the pocket is sewn down');
    const Po = Tpl.build('polo', {}); assert(Pat.toDoc(Po).trims.length === 3, 'a polo has three buttons'); const Sh = Tpl.build('shirt', {}); assert(Pat.toDoc(Sh).trims.length === 6, 'a shirt has six');
    console.log(`✓ a zip jacket closes (mean gap ${gj.mean.toFixed(2)} cm), a pullover has its pocket sewn down, a polo has 3 buttons and a shirt 6`);
  }
  {
    // a spec sheet's chart fills the measures, size by size; the template is drafted again at each size
    const chart = { chest: { S: '20', M: '21', L: '22' }, length: { S: '27', M: '28', L: '29' }, bicep: { S: '7', M: '7.4', L: '7.8' } };
    const mS = Tpl.fromChart(chart, 'S', 'inch'), mL = Tpl.fromChart(chart, 'L', 'inch'); near(mS.chest, 50.8, 0.01, 'inches to cm'); near(mL.length, 73.66, 0.01, 'length');
    const P = Tpl.build('tee', Tpl.fromChart(chart, 'M', 'inch'), { size: 'M' }); P.tplMeasures = { S: mS, M: Tpl.fromChart(chart, 'M', 'inch'), L: mL }; P.grading = { sizes: ['S', 'M', 'L'], base: 'M', body: { height: 3, chest: 4, waist: 4, hip: 4, shoulder: 1.5 } };
    const w = (Q) => Pat.bbox(Pat.flatten(Q.pieces.find((p) => p.name === 'Front')).poly).w; near(w(Prod.atSize(P, 'S')), 50.8, 0.2, 'S as the sheet says'); near(w(Prod.atSize(P, 'L')), 55.88, 0.2, 'L as the sheet says'); assert(w(Prod.atSize(P, 'S')) < w(Prod.atSize(P, 'M')) && w(Prod.atSize(P, 'M')) < w(Prod.atSize(P, 'L')));
    const t = Prod.sizeTable(P); assert(t.pieces.length === P.pieces.length && t.sizes.length === 3, 'a table of every piece in every size'); assert(t.pieces[0].sizes.L.w > t.pieces[0].sizes.S.w);
    console.log('✓ a spec sheet (in inches) fills the measures and the tee is drafted again at S, M and L exactly as the sheet says');
  }
  {
    // grading a drawn pattern by rules: a piece grows across and down, a node can have a rule of its own, the seams stay matched
    const P = Pat.create('g'); P.fabric = { gsm: 200, family: 'woven' }; const a = Pat.rect(P, 0, 0, 40, 50, 'Panel', { arr: { mode: 'wrap', top: 108 } }); a.edges[0].hold = true; Pat.sew(P, { piece: a.id, eid: a.edges[1].id }, { piece: a.id, eid: a.edges[3].id });
    P.grading = { sizes: ['S', 'M', 'L'], base: 'M', body: { height: 3, chest: 4, waist: 4, hip: 4, shoulder: 1.5 } }; a.grade = { w: 6, h: 3 };
    const w = (Q) => Pat.bbox(Pat.flatten(Q.pieces[0]).poly), M = Prod.atSize(P, 'M'), L = Prod.atSize(P, 'L'), S = Prod.atSize(P, 'S');
    near(w(L).w - w(M).w, 6, 0.05, 'a step wider'); near(w(L).h - w(M).h, 3, 0.05, 'a step longer'); near(w(M).w - w(S).w, 6, 0.05, 'and a step down is a step narrower'); near(w(M).w, 40, 1e-6, 'the base is the base');
    assert(!M.body && L.body.chest > Pat.PRESETS.female.chest, 'the base keeps the body as drawn; a larger size has a larger body'); near(L.body.chest - Pat.PRESETS.female.chest, 4, 1e-6, 'by the body step'); near(S.body.chest - Pat.PRESETS.female.chest, -4, 1e-6, 'and a smaller one a smaller body'); assert(P.pieces[0].nodes[0].x === 0, 'the original is not touched');
    a.nodes[2].g = [2, 0]; near(w(Prod.atSize(P, 'L')).w - w(M).w, 8, 0.1, 'a node with a rule of its own moves more');
    const seam = Pat.seamInfo(Prod.atSize(P, 'L'))[0]; assert(Math.abs(seam.pct) < 0.5, 'the two sides of the seam stay matched when graded: ' + seam.pct.toFixed(2) + ' %');
    assert.deepStrictEqual(Doc.validate(Pat.toDoc(Prod.atSize(P, 'L'))), [], 'and the graded size is a good document');
    console.log('✓ grading by rule: a piece grows across and down, a node can have its own rule, seams stay matched, the body grows with the size');
  }
  {
    // the tee in S and L drapes on bodies of their own size
    const P = Tpl.build('tee', {}); P.tplMeasures = { S: { chest: 49 }, M: { chest: 52 }, L: { chest: 55 } };
    ['S', 'L'].forEach((s) => { const c = run(Pat.toDoc(Prod.atSize(P, s)), 100), st = c.stats(); assert(c.X.every(Number.isFinite), 'no NaN'); const gq = gaps(c); assert(gq.mean < 3.5, `${s} closes: ${gq.mean.toFixed(2)}`); assert(st.inside_body > -2, `${s}: ${st.inside_body.toFixed(2)}`); });
    console.log('✓ the tee in S and in L drapes, closed, on a body of its own size');
  }
  {
    // DXF: layers by the standard's numbers, true size in mm, readable again
    const P = Tpl.build('tee', {}); P.pieces[0].notches.push({ edge: P.pieces[0].edges[6].id, t: 0.5 });
    const txt = Prod.toDXF(P, { size: 'M', allow: 1 }), ents = Prod.dxfRead(txt), polys = ents.filter((e) => e.type === 'poly');
    assert(/^0\nSECTION/.test(txt) && /EOF\n$/.test(txt), 'a DXF'); const layers = new Set(ents.map((e) => e.layer)); ['1', '14', '4', '7', '15'].forEach((l) => assert(layers.has(l), 'layer ' + l));
    assert(polys.filter((e) => e.layer === '14').length === P.pieces.length && polys.filter((e) => e.layer === '1').length === P.pieces.length, 'a sewing line and a cutting line for each piece');
    const f = P.pieces[0], sew = polys.find((e) => e.layer === '14'), cut = polys.find((e) => e.layer === '1'), a = (pts) => Math.abs(Pat.area(pts)); near(a(sew.pts) / 100, area(Pat.flatten(f, 1).poly), area(Pat.flatten(f, 1).poly) * 0.01, 'the sewing line is the piece in mm');
    assert(a(cut.pts) > a(sew.pts) * 1.05, 'the cutting line is the sewing line with its allowance'); assert(ents.some((e) => e.type === 'text' && /Front M|Back M/.test(e.text)), 'the piece is named with its size');
    const nest = Prod.dxfRead(Prod.toDXFNest(P)), np = nest.filter((e) => e.type === 'poly' && e.layer === '14'); assert(np.length === P.pieces.length * 4, 'the grade nest has every piece in all four sizes: ' + np.length);
    console.log(`✓ DXF: layers 1, 14, 4, 7, 15; the sewing line is the piece in true size (mm), the cutting line is larger; the grade nest holds ${np.length} outlines`);
  }
  {
    // the tech pack: the data, and the PDF drawn from it
    const P = Tpl.build('polo', {}); P.pieces[0].notches.push({ edge: P.pieces[0].edges[6].id, t: 0.5 }); const pk = Prod.pack(P, { fit: [{ size: 'M', tight_pct: 12, crowded_pct: 1, seam_gap: 0.4 }] });
    assert(pk.pieces.length === P.pieces.length && pk.seams.length === P.seams.length && pk.grade.length === P.pieces.length && pk.sizes.length === 4, 'the pack has the pieces, the seams, the grade table'); assert(pk.pieces[0].edges.every((e) => e.len > 0 && e.mid), 'every edge has its length and its middle');
    const buf = await new Promise((res, rej) => { const d = renderGarmentPack(pk), c = []; d.on('data', (x) => c.push(x)); d.on('end', () => res(Buffer.concat(c))); d.on('error', rej); d.end(); });
    assert(buf.slice(0, 5).toString() === '%PDF-' && buf.length > 8000, 'a PDF of some size: ' + buf.length); assert((buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= P.pieces.length + 1, 'a page for each piece and a first one');
    assert.throws(() => sanitize(null), /no pack/); assert.throws(() => sanitize({ pieces: [] }), /no pieces/); assert.throws(() => sanitize({ pieces: [{ name: 'x', poly: [[0, 0], [1, 1]] }] }), /no pieces/, 'a piece with no outline is no piece');
    const evil = sanitize({ name: 'a\u0000b'.repeat(100), pieces: [{ name: 'p', poly: [[0, 0], [10, 0], [10, 10], ['x', 4]] }], sizes: Array(50).fill('S') }); assert(evil.name.length <= 60 && !/\u0000/.test(evil.name) && evil.pieces[0].poly.length === 3 && evil.sizes.length <= 12, 'what is sent is cut down to what can be drawn');
    console.log(`✓ the tech pack: data for ${pk.pieces.length} pieces and ${pk.seams.length} seams, a ${Math.round(buf.length / 1024)} KB PDF, a hostile pack cut down`);
  }
  console.log('Production and template tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
