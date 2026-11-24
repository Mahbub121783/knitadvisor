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
console.log('Garment pattern tests passed');
