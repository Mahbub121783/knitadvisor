// The garment pattern engine: a measurement chart in, pieces out. Every figure the chart gives must be reproduced by the finished outline, the cut must be the
// finished size over (1 - shrinkage), the sleeve cap must be the armhole plus the ease, the marker must not overlap, and no chart may make it throw.
'use strict';
const assert = require('assert');
const G = require('../engine/domain/garment-pattern');

console.log('--- Running Garment Pattern Tests ---');
const r1 = (v) => Math.round(v * 10) / 10;
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const fab = { gsm: 180, width_cm: 170, shrink_len_pct: 6, shrink_wid_pct: 8, rib_stretch_pct: 25 };
const T = G.template(['S', 'M', 'L', 'XL'], 'cm');
const R = G.build({ sizes: T.sizes, chart: T.chart, unit: 'cm', fabric: fab });
assert(R.success, R.error);
const piece = (size, id) => R.by_size.find((o) => o.size === size).pieces.find((p) => p.id === id);
const has = (poly, x, y, tol) => poly.some(([px, py]) => Math.hypot(px - x, py - y) <= tol);
const inside = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };

{
  // every chart figure is reproduced by the finished outline
  for (const o of R.by_size) {
    const m = o.m, f = piece(o.size, 'front').finished, b = piece(o.size, 'back').finished, s = piece(o.size, 'sleeve').finished, yu = G.underarmY(m);
    for (const poly of [f, b]) {
      [[m.chest / 2, yu], [-m.chest / 2, yu], [m.shoulder / 2, m.slope], [-m.shoulder / 2, m.slope], [m.neck_w / 2, 0], [-m.neck_w / 2, 0], [m.hem / 2, m.length], [-m.hem / 2, m.length]]
        .forEach(([x, y]) => assert(has(poly, x, y, 0.02), `size ${o.size}: the outline has the point (${x.toFixed(1)}, ${y.toFixed(1)})`));
    }
    assert(has(f, 0, m.neck_df, 0.02) && has(b, 0, m.neck_db, 0.02), `size ${o.size}: the neck drops`);
    near(Math.max(...f.map((p) => p[1])), m.length + m.hem_h, 0.02, `size ${o.size}: front length incl. hem`);
    [[m.bicep, o.derived.cap_height], [-m.bicep, o.derived.cap_height], [m.sleeve_o, m.sleeve_l], [-m.sleeve_o, m.sleeve_l], [0, 0]].forEach(([x, y]) => assert(has(s, x, y, 0.03), `size ${o.size}: the sleeve has (${x.toFixed(1)}, ${y.toFixed(1)})`));
    near(Math.max(...s.map((p) => p[1])), m.sleeve_l + m.sleeve_hem_h, 0.02, `size ${o.size}: sleeve length incl. hem`);
    // symmetric about the centre line
    [f, b, s].forEach((poly) => assert(poly.every(([x, y]) => has(poly, -x, y, 0.02)), `size ${o.size}: symmetric`));
  }
  console.log(`✓ ${R.by_size.length} sizes: the chart's chest, shoulder, neck, hem, length, bicep, sleeve opening and sleeve length are all in the finished outlines; symmetric`);
}
{
  // the sleeve cap is the armhole plus the ease; both armholes are as long
  for (const o of R.by_size) {
    const d = o.derived;
    assert(d.cap_ok, 'the cap was solved');
    near(d.armhole_front, d.armhole_back, 0.02, `size ${o.size}: armholes`);
    near(d.cap_len, (d.armhole_front + d.armhole_back) / 2 + 0.5, 0.02, `size ${o.size}: cap = armhole + ease`);
  }
  const eased = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, ease_cm: 1.5 }).by_size[0].derived;
  const none = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, ease_cm: 0 }).by_size[0].derived;
  near(eased.cap_len - none.cap_len, 1.5, 0.03, 'a bigger ease gives a longer cap');
  assert(eased.cap_height > none.cap_height, 'and a taller one');
  console.log('✓ the sleeve cap is solved: armhole + ease for every size, and it follows the ease asked for; front and back armholes equal');
}
{
  // the cut is the finished size over (1 - shrinkage), along and across; no shrinkage, no change
  const sx = 1 / (1 - 0.08), sy = 1 / (1 - 0.06);
  for (const id of ['front', 'back', 'sleeve']) {
    const p = piece('M', id);
    p.finished.forEach(([x, y], i) => { near(p.nominal[i][0], x * sx, 0.02, `${id} across`); near(p.nominal[i][1], y * sy, 0.02, `${id} along`); });
  }
  const z = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: { ...fab, shrink_len_pct: 0, shrink_wid_pct: 0 } }).by_size[0].pieces.find((p) => p.id === 'front');
  z.finished.forEach(([x, y], i) => { near(z.nominal[i][0], x, 0.011, 'no shrinkage: x'); near(z.nominal[i][1], y, 0.011, 'no shrinkage: y'); });
  const grow = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: { ...fab, shrink_len_pct: -3, shrink_wid_pct: -3 } });
  assert(grow.success && grow.cut_factor.across < 1, 'a cloth that grows is cut smaller');
  console.log('✓ cut = finished / (1 − shrinkage), along and across separately; zero shrinkage leaves the finished size; growth cuts smaller');
}
{
  // the seam allowance: the side seam sits 1.0 cm outside the nominal line on each side; the area grows by about perimeter x allowance
  const p = piece('M', 'front'), nom = p.nominal, cut = p.cut;
  const wN = Math.max(...nom.map((q) => q[0])) - Math.min(...nom.map((q) => q[0])), wC = Math.max(...cut.map((q) => q[0])) - Math.min(...cut.map((q) => q[0]));
  near(wC - wN, 2.0, 0.05, 'seam allowance on both sides of the front');
  assert(p.cut_area_cm2 > 0 && p.cut_area_cm2 > Math.abs(G.area(nom)), 'the cut is larger than the nominal');
  assert(R.by_size.every((o) => o.pieces.every((q) => q.simple)), 'every cut outline is a simple outline');
  console.log('✓ the seam allowance adds 1.0 cm to each side; every outline of every size is simple (no loops)');
}
{
  // the marker: inside the cloth, no two pieces overlap, the figures add up
  const mk = R.marker, polys = mk.pieces.map((q) => q.poly);
  assert(mk.pieces.length === 16, `4 sizes x (front, back, 2 sleeves) = 16 pieces, got ${mk.pieces.length}`);
  polys.forEach((poly, i) => poly.forEach(([x, y]) => { assert(x >= -0.01 && x <= mk.width_cm + 0.01 && y >= -0.01 && y <= mk.length_cm + 0.01, `piece ${i} is inside the marker`); }));
  let over = 0;
  for (let i = 0; i < polys.length; i++) {
    const A = polys[i], xs = A.map((q) => q[0]), ys = A.map((q) => q[1]);
    for (let j = i + 1; j < polys.length; j++) {
      const B = polys[j];
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.7) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.7) if (inside(A, x, y) && inside(B, x, y)) over++;
    }
  }
  assert.strictEqual(over, 0, `${over} sample points lie in two pieces`);
  const net = R.consumption.net_area_per_garment_cm2 * R.consumption.garments_in_marker, gross = R.marker.length_cm * R.marker.width_cm;
  near(R.consumption.efficiency_pct, (net / gross) * 100, 0.2, 'efficiency = piece area / marker area');
  assert(R.consumption.efficiency_pct > 60 && R.consumption.efficiency_pct < 95, `efficiency ${R.consumption.efficiency_pct}`);
  near(R.consumption.gross_kg_per_garment, (gross / R.consumption.garments_in_marker / 10000) * 0.18, 0.001, 'kg per garment from the marker area and the GSM');
  console.log(`✓ the marker: 16 pieces inside the cloth, none overlapping, efficiency ${R.consumption.efficiency_pct} %, ${R.consumption.gross_kg_per_garment} kg a garment`);
  const one = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, orient: 'one_way' });
  assert(one.marker.pieces.every((q) => q.rot === 0), 'one-way: no piece turned');
  const narrow = G.build({ sizes: ['XL'], chart: T.chart, unit: 'cm', fabric: { ...fab, width_cm: 60 } });
  assert(!narrow.success && /170|60|wide|cuts/.test(narrow.error + JSON.stringify(narrow.checks)), 'a cloth narrower than a piece is refused');
  const t1 = G.build({ sizes: T.sizes, chart: T.chart, unit: 'cm', fabric: fab, marker_trials: 1 }), t24 = G.build({ sizes: T.sizes, chart: T.chart, unit: 'cm', fabric: fab, marker_trials: 24 }), t24b = G.build({ sizes: T.sizes, chart: T.chart, unit: 'cm', fabric: fab, marker_trials: 24 });
  assert(t24.marker.length_cm <= t1.marker.length_cm, 'more orders never lay a longer marker');
  assert.deepStrictEqual(t24.marker.pieces.map((q) => q.poly), t24b.marker.pieces.map((q) => q.poly), 'the same chart lays the same marker');
  console.log(`✓ one-way cutting turns nothing; a cloth narrower than the widest piece is refused; ${24} orders lay a marker ${r1(t1.marker.length_cm - t24.marker.length_cm)} cm shorter than one, and the same every time`);
}
{
  // inches give the same pieces as centimetres
  const inch = G.template(['S', 'M', 'L', 'XL'], 'in');
  const ri = G.build({ sizes: inch.sizes, chart: inch.chart, unit: 'in', fabric: fab });
  assert(ri.success);
  ri.by_size.forEach((o, k) => o.pieces.forEach((p, i) => near(p.cut_area_cm2 / R.by_size[k].pieces[i].cut_area_cm2, 1, 0.01, `inches: ${o.size} ${p.id}`)));
  console.log('✓ a chart in inches gives the same pieces as the same chart in centimetres');
}
{
  // a chart that cannot work is refused, in words
  const bad = (patch, re, msg) => {
    const c = JSON.parse(JSON.stringify(T.chart)); patch(c);
    const r = G.build({ sizes: ['M'], chart: c, unit: 'cm', fabric: fab });
    assert(!r.success && re.test(r.error + JSON.stringify(r.checks)), `${msg}: ${r.success ? 'built' : r.error}`);
  };
  bad((c) => { delete c.chest.M; }, /chest is missing/, 'no chest');
  bad((c) => { c.shoulder.M = 60; }, /narrower than the chest/, 'shoulder wider than chest');
  bad((c) => { c.neck_w.M = 44; }, /leaves no shoulder/, 'neck as wide as the shoulder');
  bad((c) => { c.sleeve_l.M = 8; }, /too short to hold a cap/, 'a sleeve too short for its cap');
  bad((c) => { c.armhole.M = 5; }, /shorter than the step/, 'an armhole shorter than its run');
  assert(!G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: { ...fab, shrink_len_pct: 40 } }).success, 'a 40 % shrinkage is refused');
  assert(!G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, ratio: { M: 0 } }).success, 'an empty size ratio is refused');
  // a chart that gives only the chest and the length is completed, and says so
  const lean = G.build({ sizes: ['M'], chart: { chest: { M: 52 }, length: { M: 70 } }, unit: 'cm', fabric: fab });
  assert(lean.success && lean.checks.some((c) => /not in the chart, taken as/.test(c.text)), 'a short chart is completed with stated assumptions');
  console.log('✓ unusable charts are refused in words; a chart of two figures is completed, and the assumptions are listed');
}
{
  // a pasted chart: tab separated, inch fractions, the names a spec sheet uses
  const paste = ['POM\tS\tM\tL', '1/2 Chest (1" below armhole)\t20 1/2\t21 1/2\t22 1/2', 'Body Length (HPS)\t27\t28\t29', 'Across Shoulder\t17 1/2\t18 1/2\t19 1/2', 'Armhole Straight\t9 1/4\t9 3/4\t10 1/4', 'Neck Width\t7\t7 1/4\t7 1/2', 'Front Neck Drop\t3\t3 1/4\t3 1/2', 'Sleeve Length\t8\t8 1/2\t9', 'Bicep\t7 1/4\t7 3/4\t8 1/4', 'Sleeve Opening\t6 1/4\t6 3/4\t7 1/4', 'Hem Width\t20 1/2\t21 1/2\t22 1/2', 'Mystery measure\t1\t2\t3'].join('\n');
  const q = G.parseChart(paste);
  assert(q.success && q.unit === 'in' && q.sizes.join() === 'S,M,L', 'sizes and unit read');
  ['chest', 'length', 'shoulder', 'armhole', 'neck_w', 'neck_df', 'sleeve_l', 'bicep', 'sleeve_o', 'hem'].forEach((k) => assert(q.chart[k], `${k} was found`));
  near(q.chart.chest.S, 20.5, 1e-9, 'a mixed fraction'); near(q.chart.armhole.M, 9.75, 1e-9, 'three quarters');
  assert(q.unmapped.includes('Mystery measure'), 'a line it does not know is reported');
  const built = G.build({ sizes: q.sizes, chart: q.chart, unit: q.unit, fabric: fab });
  assert(built.success, built.error);
  assert(!G.parseChart('only one line').success, 'a chart needs a header and a line');
  console.log('✓ a pasted spec sheet (inch fractions, its own names) is read into a chart that builds a garment');
}
{
  // 400 random charts: nothing throws, every outline is simple, every number is a number, the marker never overlaps
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let built = 0, refused = 0;
  for (let k = 0; k < 400; k++) {
    const c = JSON.parse(JSON.stringify(T.chart)), sizes = ['M'];
    Object.keys(c).forEach((key) => { c[key].M = +(c[key].M * (0.7 + rnd() * 0.6)).toFixed(1); });
    if (rnd() < 0.15) delete c.shoulder.M;
    const f = { gsm: 120 + rnd() * 200, width_cm: 140 + rnd() * 60, shrink_len_pct: rnd() * 12 - 2, shrink_wid_pct: rnd() * 12 - 2, rib_stretch_pct: 10 + rnd() * 40 };
    const r = G.build({ sizes, chart: c, unit: 'cm', fabric: f, ease_cm: rnd() * 2 - 0.5, orient: rnd() < 0.3 ? 'one_way' : 'both' });
    assert(typeof r.success === 'boolean');
    if (!r.success) { refused++; assert(r.error && r.error.length > 10, 'a refusal has words'); continue; }
    built++;
    const flat = JSON.stringify(r);
    assert(!/NaN|Infinity|null,null/.test(flat.replace(/"width_in":null|"wpc":null|"cpc":null|"name":""/g, '')), `chart ${k}: a number is not a number`);
    r.by_size.forEach((o) => o.pieces.forEach((p) => { assert(p.simple, `chart ${k}: ${p.id} is not simple`); assert(p.cut_area_cm2 > 0); }));
    const polys = r.marker.pieces.map((q) => q.poly);
    for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
      const A = polys[i], B = polys[j], xs = A.map((q) => q[0]), ys = A.map((q) => q[1]);
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1.3) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 1.3) assert(!(inside(A, x, y) && inside(B, x, y)), `chart ${k}: pieces ${i} and ${j} overlap`);
    }
    assert(r.consumption.efficiency_pct > 35 && r.consumption.efficiency_pct <= 100, `chart ${k}: efficiency ${r.consumption.efficiency_pct}`);
  }
  assert(built > 150, `${built} charts built`);
  console.log(`✓ 400 random charts: ${built} built, ${refused} refused in words, none threw; every outline simple, every figure finite, no marker overlap`);
}
{
  // the drawing measures what the chart says, in every size
  for (const o of R.by_size) { assert(o.measured.length >= 12, 'the pattern is measured'); o.measured.forEach((x) => assert(x.ok && Math.abs(x.diff) <= 0.02, `size ${o.size}: ${x.key} drawn ${x.pattern}, chart ${x.chart}`)); }
  // an edit: the shoulder tip 1 cm out and the underarm 0.5 cm in, on the front of M: the drawing says so, the cap follows the armhole, the other sizes do not move
  const ed = { M: { front: { move: { 2: [1, 0], 3: [-0.5, 0] } } } };
  const E = G.build({ sizes: T.sizes, chart: T.chart, unit: 'cm', fabric: fab, edits: ed });
  const eM = E.by_size.find((o) => o.size === 'M'), bM = R.by_size.find((o) => o.size === 'M');
  const ms = (o, k) => o.measured.find((x) => x.key === k);
  near(ms(eM, 'shoulder').pattern - ms(bM, 'shoulder').pattern, 2, 0.02, 'the shoulder is 2 cm wider across');
  near(ms(eM, 'chest').pattern - ms(bM, 'chest').pattern, -1, 0.02, 'the chest is 1 cm narrower');
  assert(!ms(eM, 'shoulder').ok && !ms(eM, 'chest').ok, 'and the chart says it is off');
  assert(E.checks.some((c) => c.size === 'M' && /off the chart/.test(c.text)), 'in words');
  assert(Math.abs(eM.derived.armhole_front - bM.derived.armhole_front) > 0.1, 'the armhole changed');
  near(eM.derived.cap_len, (eM.derived.armhole_front + eM.derived.armhole_back) / 2 + 0.5, 0.02, 'the cap is solved against the edited armhole');
  ['S', 'L', 'XL'].forEach((z) => assert.deepStrictEqual(E.by_size.find((o) => o.size === z).pieces.map((p) => p.cut), R.by_size.find((o) => o.size === z).pieces.map((p) => p.cut), `size ${z} did not move`));
  // an edit survives a change of the chart: the chart's chest +2 moves the base, the edit stays on top of it
  const t2 = JSON.parse(JSON.stringify(T.chart)); t2.chest.M += 2;
  const E2 = G.build({ sizes: T.sizes, chart: t2, unit: 'cm', fabric: fab, edits: ed }).by_size.find((o) => o.size === 'M');
  near(ms(E2, 'chest').pattern - ms(E2, 'chest').chart, -1, 0.02, 'after the chart changed the edit is still -1 cm on the chest');
  // a point on the centre line stays on it; a handle edit changes the neckline and the band follows
  const ax = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, edits: { M: { front: { move: { 0: [3, 0] } } } } }).by_size[0].edit.front.anchors[0];
  assert.strictEqual(ax.x, 0, 'an anchor on the centre line stays on it');
  const hn = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, edits: { M: { front: { hout: { 0: [3, 0] } } } } }).by_size[0], h0 = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab }).by_size[0];
  assert(hn.derived.neck_front !== h0.derived.neck_front && Math.abs(hn.derived.band_len - hn.derived.neck_len / 1.25) < 0.02, 'a handle edit changes the neckline and the band is cut to it');
  console.log('✓ edits: an anchor move shows in the measurements and the checks, the cap follows the armhole, other sizes stay, the edit survives a chart change, the centre line holds, the band follows the neckline');
}
{
  // a manual piece: an anchor deleted takes the piece off the chart
  const base = R.by_size.find((o) => o.size === 'M'), man = JSON.parse(JSON.stringify(base.edit.front.anchors)); man.splice(4, 1);
  const Mn = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, edits: { M: { front: { manual: { anchors: man, sym: true } } } } }).by_size[0];
  assert(Mn.edit.front.manual && Mn.pieces.find((p) => p.id === 'front').simple, 'the front is manual and still a piece');
  const t3 = JSON.parse(JSON.stringify(T.chart)); t3.chest.M += 4;
  const Mn2 = G.build({ sizes: ['M'], chart: t3, unit: 'cm', fabric: fab, edits: { M: { front: { manual: { anchors: man, sym: true } } } } }).by_size[0];
  assert.deepStrictEqual(Mn2.pieces.find((p) => p.id === 'front').finished, Mn.pieces.find((p) => p.id === 'front').finished, 'a chart change does not move a manual piece');
  console.log('✓ a manual piece stays a piece and no longer follows the chart');
}
{
  // a zipper: full = the front in two halves with a facing; partial = a slit and a placket
  const full = G.build({ sizes: T.sizes, chart: T.chart, unit: 'cm', fabric: fab, zipper: { on: true, kind: 'full' } }), fM = full.by_size.find((o) => o.size === 'M');
  const ids = fM.pieces.map((p) => p.id).sort();
  assert.deepStrictEqual(ids, ['back', 'band', 'facing', 'front_l', 'front_r', 'sleeve'], 'a full zipper cuts the front in halves and adds a facing');
  const fr = fM.pieces.find((p) => p.id === 'front_r'), fl = fM.pieces.find((p) => p.id === 'front_l');
  near(fr.cut_area_cm2, fl.cut_area_cm2, 0.2, 'the halves are mirrors');
  assert(fM.pieces.find((p) => p.id === 'facing').qty === 2, 'two facings');
  assert(fr.labels.includes('cf'), 'the centre front is a seam');
  const base = R.by_size.find((o) => o.size === 'M').pieces.find((p) => p.id === 'front');
  assert(fr.cut_area_cm2 * 2 > base.cut_area_cm2 && fr.cut_area_cm2 * 2 < base.cut_area_cm2 * 1.1, 'two halves with centre-front allowance are a little more than the whole front');
  const z = fM.zipper;
  assert(z.on && z.standard_cm >= z.opening_cm && G.ZIP_STANDARD.includes(z.standard_cm) && z.trim_cm >= 0, 'a catalogue length at least as long as the opening');
  near(z.opening_cm, fM.m.length - fM.m.neck_df, 0.06, 'the opening runs from the neck seam to the hem fold');
  assert(full.bom.some((b) => /Zipper/.test(b.item)) && fM.sewing.operations.some((o) => o.seam === 'cf'), 'the zipper is in the bill of materials and the sewing order');
  assert(fM.sewing.sam.minutes > R.by_size.find((o) => o.size === 'M').sewing.sam.minutes, 'and in the sewing time');
  assert(fM.shape.front.length > 50 && fM.shape.front.some(([x]) => x < 0) && fM.shape.front.some(([x]) => x > 0), 'the whole front is kept for the 3D garment');
  const part = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, zipper: { on: true, kind: 'partial', length_cm: 20 } }).by_size[0];
  assert(part.pieces.some((p) => p.id === 'placket') && part.pieces.find((p) => p.id === 'front').marks.length === 1 && part.zipper.opening_cm === 20 && part.zipper.standard_cm === 20, 'a quarter zip: the front is slit, a placket is added, a 20 cm zipper');
  assert(!G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab }).by_size[0].zipper.on, 'no zipper unless asked for');
  console.log('✓ zipper: a full one halves the front and adds a facing; a quarter-zip slits it and adds a placket; a catalogue length, the bill of materials, the sewing order and time follow');
}
{
  // seams: the type decides the thread and the allowance decides the cut; a hem takes no allowance
  const def = R.by_size.find((o) => o.size === 'M'), sw = def.sewing;
  assert(sw.thread_m > 40 && sw.thread_m < 110, `a tee takes ${sw.thread_m} m of thread`);
  assert(sw.seams.every((s) => s.thread_m >= 0 && s.sewn_cm >= 0) && sw.operations.length === 8, 'every seam has a length and thread; eight operations');
  const alt = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, seams: { side: { type: '301', allowance: 0.6 }, hem: { type: '602', allowance: 5 } } }), a = alt.by_size[0];
  assert(a.sewing.thread_m < sw.thread_m, 'a lockstitch side seam takes less thread than a 4-thread overlock');
  assert.strictEqual(alt.seams.hem.allowance, 0, 'a hem takes no allowance (its depth is in the drawing)');
  near(def.pieces[0].cut_w - a.pieces[0].cut_w, 0.8, 0.06, 'a 0.6 cm side allowance cuts the front 0.8 cm narrower than 1.0 cm');
  assert(G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, seams: { side: { type: 'nonsense' } } }).seams.side.type === '514', 'an unknown stitch type is ignored');
  // the notches: the front has six, the sleeve's cap is marked for the front (one) and the back (two)
  assert(def.pieces[0].notches.length === 6 && def.pieces[2].notches.filter((n) => n.label === 'cap').length === 3, 'notches on the seams');
  // the armhole joins edges that differ by the ease
  const ar = sw.seams.find((s) => s.id === 'armhole'); near(ar.diff_cm, 4 * 0.5, 0.1, 'the sleeve set is 0.5 cm of ease on each of four edges');
  console.log(`✓ seams: ${sw.thread_m} m of thread on a tee from the stitch types, the allowance cuts the piece, a hem has none, notches on the seams, the sleeve set carries its ease`);
}
{
  // 300 random edits: nothing throws, a refusal has words, a success is finite, and an outline that crosses itself is always reported
  let seed = 99; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const anchors = R.by_size.find((o) => o.size === 'M').edit, ids = ['front', 'back', 'sleeve', 'band'];
  let ok = 0, refused = 0;
  for (let k = 0; k < 300; k++) {
    const e = {};
    ids.forEach((id) => { if (rnd() < 0.6) { const n = anchors[id].anchors.length, mv = {}, hi = {}, ho = {}; for (let j = 0; j < 1 + Math.floor(rnd() * 3); j++) { const i = Math.floor(rnd() * n); mv[i] = [(rnd() - 0.5) * 6, (rnd() - 0.5) * 6]; if (rnd() < 0.4) ho[i] = [(rnd() - 0.5) * 6, (rnd() - 0.5) * 6]; if (rnd() < 0.3) hi[i] = [(rnd() - 0.5) * 6, (rnd() - 0.5) * 6]; } e[id] = { move: mv, hin: hi, hout: ho }; } });
    const r = G.build({ sizes: ['M'], chart: T.chart, unit: 'cm', fabric: fab, edits: { M: e }, zipper: rnd() < 0.3 ? { on: true, kind: rnd() < 0.5 ? 'full' : 'partial' } : undefined, seams: rnd() < 0.3 ? { side: { type: '602', allowance: rnd() * 2 } } : undefined });
    if (!r.success) { refused++; assert(r.error && r.error.length > 10); continue; }
    ok++;
    assert(!/NaN|Infinity/.test(JSON.stringify(r)), `edit ${k}: a number is not a number`);
    r.by_size[0].pieces.forEach((p) => assert(p.cut_area_cm2 > 0));
    if (r.checks.some((c) => c.level === 'error')) continue;
    r.by_size[0].pieces.forEach((p) => assert(p.simple, `edit ${k}: ${p.id} not simple but not reported`));
  }
  assert(ok > 100, `${ok} edited builds`);
  console.log(`✓ 300 random edits (anchors, handles, zipper, seams): ${ok} built, ${refused} refused in words, none threw, no NaN, a crossing outline is always reported`);
}
{
  // a sweatshirt: rib cuffs and a rib hem replace the folded hems; every figure of the chart still comes back; the rib parts have seams that match
  ['tee', 'longsleeve', 'sweatshirt'].forEach((kind) => {
    const T2 = G.template(['S', 'M', 'L', 'XL'], 'cm', kind), r = G.build({ sizes: T2.sizes, chart: T2.chart, unit: 'cm', fabric: fab });
    assert(r.success, `${kind}: ${r.error}`);
    r.by_size.forEach((o) => { o.measured.forEach((m) => near(m.pattern, m.chart, 0.02, `${kind} ${o.size} ${m.key}`)); o.pieces.forEach((p) => assert(p.simple, `${kind} ${p.name} is simple`)); assert(o.sewing.seams.every((s) => s.match), `${kind} ${o.size}: every seam matches`); });
    const ids = r.by_size[1].pieces.map((p) => p.id);
    if (kind === 'sweatshirt') { assert(ids.includes('cuff') && ids.includes('hemband'), 'a sweatshirt has its rib cuff and hem band'); assert(r.seams.sleeve_hem.type === '514' && r.seams.sleeve_hem.allowance > 0, 'the rib is sewn on like a seam, not folded'); assert(r.bom.some((b) => /Rib \(neck, cuffs, hem\)/.test(b.item)), 'the bill of materials says where the rib goes'); assert(r.by_size[1].pieces.find((p) => p.id === 'cuff').rib && !r.marker.pieces.some((p) => p.piece === 'cuff'), 'the rib is not on the marker of the main fabric'); }
    else assert(!ids.includes('cuff'), `${kind} has no rib cuff`);
  });
  console.log('✓ the tee family: a tee, a long-sleeve tee and a sweatshirt (rib cuffs and hem) all build, every figure comes back, the rib parts are sewn on and kept off the main marker');
}
console.log('Garment pattern tests passed');

