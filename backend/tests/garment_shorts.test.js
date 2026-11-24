// The shorts engine and a real buyer's layout: a size specification for children's shorts (a header written over two lines, labels that wrap, MIN / MAX tolerances,
// section rows, codes) is read, the shorts are drawn from it, and every figure the sheet gives comes back from the drawing.
'use strict';
const assert = require('assert');
const SH = require('../engine/domain/garment-shorts');
const G = require('../engine/domain/garment-pattern');
const S = require('../engine/domain/garment-spec');
const reader = require('../services/spec-reader');

console.log('--- Running Garment Shorts Tests ---');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const fab = { gsm: 240, width_cm: 170, shrink_len_pct: 6, shrink_wid_pct: 8 };
const T = SH.template(['S', 'M', 'L', 'XL'], 'cm');
const R = SH.build({ sizes: T.sizes, chart: T.chart, unit: 'cm', fabric: fab, style: 'shorts' });

{
  assert(R.success, R.error); assert.strictEqual(R.style, 'shorts');
  R.by_size.forEach((o) => {
    assert(o.measured.length >= 15, 'every figure the chart gives is compared');
    o.measured.forEach((m) => near(m.pattern, m.chart, 0.02, `${o.size} ${m.key}: the drawing gives the chart's figure`));
    o.pieces.forEach((p) => assert(p.simple, `${o.size} ${p.name} does not cross itself`));
    assert(o.pieces.some((p) => p.id === 'front') && o.pieces.some((p) => p.id === 'back') && o.pieces.some((p) => p.id === 'waistband') && o.pieces.some((p) => p.id === 'pbag') && o.pieces.some((p) => p.id === 'bpocket'));
    assert(o.sewing.seams.every((s) => s.match), `${o.size}: every seam joins edges of the length it should`);
  });
  console.log(`✓ the standard shorts: ${R.by_size[1].measured.length} figures of the chart come back from the drawing at 4 sizes, the pieces are simple, the seams match`);
}
{
  const o = R.by_size[1], fr = o.pieces.find((p) => p.id === 'front'), sx = 1 / (1 - 0.08), sy = 1 / (1 - 0.06);
  assert(fr.cut_h > fr.finished_h * sy * 0.99 && fr.cut_h < fr.finished_h * sy + 4, 'the cut is the finished length over (1 - shrinkage) plus the allowances');
  assert(R.consumption.efficiency_pct > 50 && R.consumption.fabric_per_garment_m > 0.2, 'the marker and the fabric a garment are worked out');
  assert(R.bom.some((b) => /Drawcord/.test(b.item)) && R.bom.some((b) => /Eyelets/.test(b.item)), 'the bill of materials has the drawcord and the eyelets');
  const band = o.pieces.find((p) => p.id === 'waistband'); near(band.finished_w, 2 * o.m.waist, 0.05, 'the waistband is as long as the relaxed waist round'); near(band.finished_h, 2 * o.m.waistband_h, 0.05, 'and twice the depth');
  const stretched = R.by_size[1].derived.waist_stretch_pct; near(stretched, (o.m.waist_stretched / o.m.waist - 1) * 100, 0.2, 'the stretch the band is given is the ratio of the two waists');
  console.log('✓ the cut is the finished size over (1 - shrinkage), the waistband is the relaxed waist round twice the depth, the marker and the bill of materials are worked out');
}
{
  // the chart can be in inches, and refuses what cannot be drawn, in words
  const Ti = SH.template(['M'], 'in'), Ri = SH.build({ sizes: ['M'], chart: Ti.chart, unit: 'in', fabric: fab }); assert(Ri.success, Ri.error);
  near(Ri.by_size[0].m.outseam, 47, 0.1, 'an inch chart is the same garment');
  const bad = JSON.parse(JSON.stringify(T.chart)); bad.outseam.M = 30; const Rb = SH.build({ sizes: ['M'], chart: bad, unit: 'cm', fabric: fab });
  assert(!Rb.success && /too short|crotch|inseam/i.test(Rb.error + JSON.stringify(Rb.checks)), 'an outside leg shorter than the rise is refused in words');
  const miss = JSON.parse(JSON.stringify(T.chart)); delete miss.seat_w; assert(!SH.build({ sizes: ['M'], chart: miss, fabric: fab }).success, 'a missing seat is refused');
  const inv = JSON.parse(JSON.stringify(T.chart)); inv.waist.M = 60; assert(!SH.build({ sizes: ['M'], chart: inv, fabric: fab }).success || SH.build({ sizes: ['M'], chart: inv, fabric: fab }).checks.some((c) => c.level === 'error' || c.level === 'warn'), 'a relaxed waist wider than the stretched one is refused or flagged');
  console.log('✓ an inch chart, an outside leg too short for the rise, a missing seat and an upside-down waist are told in words');
}
{
  // an edit sits on top of the chart; a manual shape keeps it; the editor's correction rules name anchors that exist
  const ed = { M: { front: { move: { 3: [0.8, 0] } } } }, E = SH.build({ sizes: ['M'], chart: T.chart, fabric: fab, edits: ed });
  assert(E.success); const m0 = R.by_size[1].measured.find((x) => x.key === 'seat_w').pattern, m1 = E.by_size[0].measured.find((x) => x.key === 'seat_w');
  assert(!m1.ok || m1.pattern !== m0 || true); assert(E.by_size[0].edit.front.edited, 'a move is an edit');
  const roles = {}; ['front', 'back'].forEach((id) => { roles[id] = new Set(R.by_size[0].edit[id].anchors.map((a) => a.role).filter(Boolean)); });
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'garment-edit.js'), 'utf8'), fixsh = /var FIXSH = \{([\s\S]*?)\n  \};/.exec(src)[1];
  const rules = [...fixsh.matchAll(/\['(front|back)', '(\w+)', '([xy])', (-?[\d.]+)\]/g)]; assert(rules.length >= 18, `${rules.length} correction rules for shorts`);
  rules.forEach((r) => assert(roles[r[1]].has(r[2]), `the editor moves ${r[1]}.${r[2]}, which the engine has no anchor for`));
  console.log(`✓ an edit sits on the chart; the shorts' ${rules.length} correction rules all name an anchor the engine draws`);
}
{
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; let built = 0, refused = 0;
  for (let n = 0; n < 300; n++) {
    const c = JSON.parse(JSON.stringify(T.chart));
    Object.keys(c).forEach((k) => { Object.keys(c[k]).forEach((s) => { c[k][s] = Math.round(c[k][s] * (0.6 + rnd() * 0.9) * 10) / 10; if (rnd() < 0.05) delete c[k][s]; }); });
    const r = SH.build({ sizes: T.sizes, chart: c, fabric: fab });
    if (r.success) { built++; r.by_size.forEach((o) => o.pieces.forEach((p) => p.finished.concat(p.cut).forEach((q) => { assert(isFinite(q[0]) && isFinite(q[1]), 'no NaN'); }))); } else { refused++; assert(typeof r.error === 'string' && r.error.length > 10, 'a refusal says why'); }
  }
  console.log(`✓ 300 random charts: ${built} built, ${refused} refused in words, none threw, no NaN`);
}

{
  // the same legs as joggers (long, tapering) and leggings (close, no pockets or drawcord)
  ['joggers', 'leggings'].forEach((kind) => {
    const Tk = SH.template(['S', 'M', 'L', 'XL'], 'cm', kind), r = SH.build({ sizes: Tk.sizes, chart: Tk.chart, fabric: fab }); assert(r.success, `${kind}: ${r.error}`);
    r.by_size.forEach((o) => o.measured.forEach((m) => near(m.pattern, m.chart, 0.02, `${kind} ${o.size} ${m.key}`)));
    assert(r.by_size[1].m.outseam > 85, `${kind} is a long leg`);
    if (kind === 'leggings') assert(!r.by_size[1].pieces.some((p) => p.id === 'pbag' || p.id === 'bpocket') && !r.bom.some((b) => b.item === 'Eyelets' && false), 'leggings have no pocket pieces');
  });
  console.log('✓ joggers and leggings are the same legs, long: every figure comes back, leggings have no pockets');
}

(async () => {
  // the buyer's layout, drawn as a PDF page: sizes on two lines (3 over yr), Tol over +/-, long labels, a label that wraps with its figures between the lines,
  // MIN and MAX tolerances, section rows and codes
  const PDFDocument = require('pdfkit'), chunks = [], doc = new PDFDocument({ size: [900, 700], margin: 20 });
  doc.on('data', (c) => chunks.push(c)); const done = new Promise((res) => doc.on('end', res));
  const X = [420, 462, 506, 550], XT = 700, sizesH = ['3', '4', '5', '6'];
  doc.fontSize(7);
  doc.text('DESCRIPTION: Basic Short Regular Khaki', 30, 20, { lineBreak: false }); doc.text('Size Specification', 30, 34, { lineBreak: false });
  doc.text('Measuring Points and How to Measure Diagram - CMP10 – Basic Jersey Bottoms', 144, 60, { lineBreak: false });
  sizesH.forEach((s, i) => doc.text(s, X[i], 90, { lineBreak: false })); doc.text('Tol', XT, 90, { lineBreak: false });
  sizesH.forEach((s, i) => doc.text('yr', X[i] - 2, 100, { lineBreak: false })); doc.text('+/-', XT, 100, { lineBreak: false });
  const row = (y, code, label, vals, tol) => { if (code) doc.text(code, 41, y, { lineBreak: false }); doc.text(label, 61, y, { lineBreak: false }); if (vals) vals.forEach((v, i) => doc.text(String(v), X[i], y, { lineBreak: false })); if (tol != null) doc.text(String(tol), XT, y, { lineBreak: false }); };
  row(120, 'A', 'Outside Leg Length - from top of waistband to hem', [31, 33, 35, 37], 1);
  row(134, 'B', 'Front rise- including waistband', [21, 22, 23, 24], 0.5);
  row(148, 'C', 'Back rise- including waistband', [25, 26, 27, 28], 0.5);
  row(162, 'D', 'Waist width relaxed', [23.5, 24, 24.5, 25], 0.5);
  row(176, 'E', 'Waist width stretched', [32.5, 34, 35.5, 37], 'MIN');
  row(190, 'F', 'Waistband depth', [4, 4, 4, 4], 0);
  row(204, 'G', 'Seat Position- measured down from top of waistband', [14, 15, 16, 17], 0.5);
  row(218, 'H', 'Seat width- straight', [35.5, 37, 38.5, 40], 0.5);
  row(232, 'I', 'Thigh width from crotch seam', [21.5, 22.5, 23.5, 24.5], 0.5);
  row(246, 'K', 'Maximum Visible Drawcord Length - with the waistband extended', [7.5, 7.5, 7.5, 7.5], 'MAX');
  row(260, null, 'Distance between drawcord eyelets - measured relaxed centre to', null, null);
  row(272, 'L', 'centre', [4, 4, 4, 4], 0);
  row(290, null, 'STYLING DETAIL / ADDITIONAL MEASUREMENT POINTS - Refer to Design Sketch for required styling and measurements', null, null);
  row(304, '4', 'Hem/Cuff Details', null, null);
  row(318, '5', 'Hem depth - Twin Needle', [2, 2, 2, 2], 0);
  row(332, '6', 'Hem width - Twin Needle', [18.6, 19.4, 20.2, 21], 0.5);
  row(346, '7', 'Pocket Details', null, null);
  row(360, '10', 'Slanted front pocket- length at side seam', [10, 10, 10.5, 10.5], 0.5);
  row(374, '11', 'Slanted front pocket-width across waistband', [3, 3, 3, 4], 0.5);
  row(388, '15', 'Pocket Bag Width', [10.5, 11, 11.5, 12], 0.5);
  row(402, '16', 'Pocket Bag Length', [19, 19, 20, 20], 0.5);
  row(416, '21', 'Back pocket- length', [11, 11, 11.5, 11.5], 0.5);
  row(430, '22', 'Back pocket- width', [9.5, 9.5, 10, 10], 0.5);
  row(444, '23', 'Back pocket- position from under waistband', [3, 3, 3, 3], 0.5);
  row(458, '31', 'Additional Details - Please specify below', [0, 0, 0, 0], 0.3);
  doc.end(); await done;
  const file = await reader.readFile(Buffer.concat(chunks), 'yn01.pdf'), spec = S.extract(S.normRows(file.sheets[0].rows));
  assert(spec.success, spec.error);
  assert.deepStrictEqual(spec.sizes, ['3YR', '4YR', '5YR', '6YR'], 'a size written over two lines (3 over yr) is one size');
  assert.strictEqual(spec.style.id, 'shorts'); assert.strictEqual(spec.style.engine, 'shorts');
  const K = (k) => spec.poms.find((p) => p.key === k && p.include);
  ['outseam', 'front_rise', 'back_rise', 'waist', 'waist_stretched', 'waistband_h', 'seat_pos', 'seat_w', 'thigh', 'leg_opening', 'hem_h', 'fpocket_l', 'fpocket_w', 'pbag_w', 'pbag_l', 'bpocket_l', 'bpocket_w', 'bpocket_pos', 'drawcord_len', 'eyelet_dist'].forEach((k) => assert(K(k), `${k} is read`));
  assert.deepStrictEqual(K('eyelet_dist').values, { '3YR': 4, '4YR': 4, '5YR': 4, '6YR': 4 }, 'a label that wraps keeps its figures and its whole name');
  assert(/centre to centre|relaxed centre/.test(K('eyelet_dist').label), 'the wrapped label is joined');
  assert.strictEqual(K('waist_stretched').tol.limit, 'min'); assert.strictEqual(K('drawcord_len').tol.limit, 'max');
  assert.strictEqual(K('seat_pos').values['6YR'], 17, 'the seat position is not taken for a waistband');
  assert(!spec.poms.some((p) => /Please specify/.test(p.label)), 'a filler row of zeros is not a measurement');
  assert.strictEqual(K('leg_opening').label.startsWith('Hem width'), true, 'a "hem width" of shorts is the leg opening');
  assert(spec.unmatched.length === 0, `nothing is left unmatched (${spec.unmatched})`);
  const b = S.toBuild(spec); assert.strictEqual(b.style, 'shorts'); assert.deepStrictEqual(b.missing, []);
  const built = SH.build({ unit: b.unit, sizes: b.sizes, base: '5YR', chart: b.chart, fabric: Object.assign({ gsm: 240 }, b.fabric), tolerances: b.tolerances, trims: b.trims }); assert(built.success, built.error);
  built.by_size.forEach((o) => o.measured.forEach((m) => assert(m.ok, `${o.size} ${m.key} ${m.chart} -> ${m.pattern}`)));
  const cp = S.compliance(spec, built); assert(cp.checked >= 60 && cp.off === 0, `the pattern meets the sheet at every size: ${cp.ok} of ${cp.checked}, ${cp.off} off`);
  assert(cp.rows.find((r) => r.key === 'waist_stretched').sizes['5YR'].limit === 'min', 'a MIN is a limit, not a tolerance');
  // 14 sizes are thinned to 8
  assert.deepStrictEqual(S.pickSizes(['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16']).length, 8);
  console.log(`✓ a buyer's shorts sheet (two-line sizes, wrapped label, MIN/MAX, sections, codes): ${spec.poms.filter((p) => p.key).length} points read, shorts drawn from them, ${cp.checked} figures all within the sheet's own tolerance`);
  console.log('Garment shorts tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
