// Fabric scan: the loop counter on photographed synthetic swatches, the fault
// finder, and the reverse engine on the factory's own fabrics.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const FE = path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'scan');
const KS = require(path.join(FE, 'fabric-scan-core.js'));
const SY = require(path.join(FE, 'fabric-scan-synth.js'));
const R = require('../engine/domain/fabric-reverse');
console.log('--- Running Fabric Scan Tests ---');

const shoot = (o) => { const p = SY.photo({ KAScan: KS, width: 1700, height: 1350, pxPerMm: 15, ...o }, KS.CARD); return KS.analysePhoto(p.rgba, p.w, p.h); };
const near = (a, b, tol, what) => assert(Math.abs(a / b - 1) <= tol, `${what}: ${a.toFixed(3)} vs ${b} (±${tol * 100}%)`);

// the card is found and the window flattened at a known scale
{
  const H = KS.homography([[0, 0], [10, 0], [10, 10], [0, 10]], [[100, 50], [300, 60], [290, 260], [95, 250]]);
  const p = KS.apply(H, 10, 10);
  assert(Math.abs(p[0] - 290) < 1e-6 && Math.abs(p[1] - 260) < 1e-6, 'homography maps the corners');
}

// counting: jersey, rib, interlock — tilted, rotated, blurred, noisy, unevenly lit
for (const [o, tol] of [
  [{ structure: 'single_jersey', wpc: 15, cpc: 20.5, seed: 3, rotate: 4, tilt: 0.08, blur: 2, noise: 0.04, light: 0.4 }, 0.015],
  [{ structure: 'rib', wpc: 11, cpc: 18, seed: 5, rotate: -5, colour: [140, 30, 40] }, 0.015],
  [{ structure: 'interlock', wpc: 16, cpc: 16, seed: 9, colour: [30, 30, 35], light: 0.3 }, 0.015],
]) {
  const r = shoot(o);
  assert(!r.error, `${o.structure}: ${r.error}`);
  near(r.wpc, o.wpc, tol, `${o.structure} wales/cm`);
  near(r.cpc, o.cpc, tol, `${o.structure} courses/cm`);
  assert(r.faults.length === 0, `${o.structure}: no faults on clean cloth, saw ${JSON.stringify(r.faults)}`);
}

// piqué: the wales still count right through the tuck cells, and the repeat shows
{
  const r = shoot({ structure: 'pique', wpc: 11, cpc: 26, seed: 21 });
  near(r.wpc, 11, 0.015, 'piqué wales/cm');
  assert(r.features.repeat > 0.15, 'the tuck repeat is seen');
  assert.strictEqual(KS.suggest(r.features)[0].structure, 'pique', 'and suggested as piqué');
}

// real cloth: wrinkles, hairiness and the card lying beside the fabric (window not cut)
{
  const r = shoot({ structure: 'single_jersey', wpc: 16, cpc: 21.5, seed: 31, wrinkle: 0.35, fuzz: 0.3, light: 0.5, blur: 2, width: 1800, height: 1500 });
  near(r.wpc, 16, 0.015, 'wrinkled, hairy wales'); near(r.cpc, 21.5, 0.02, 'wrinkled, hairy courses');
  const u = shoot({ structure: 'interlock', wpc: 15, cpc: 15, seed: 34, uncut: true, cardY: 0.66, pxPerMm: 11, width: 1800, height: 1500, wrinkle: 0.3, fuzz: 0.2 });
  assert.strictEqual(u.card.fabric_at, 'above', 'the fabric beside the card is found');
  near(u.wpc, 15, 0.015, 'beside-the-card wales'); near(u.cpc, 15, 0.02, 'beside-the-card courses');
}

// faults: a hole and a needle line, each found once and where they are
{
  const r = shoot({ structure: 'single_jersey', wpc: 17, cpc: 23, seed: 17, rotate: 0, tilt: 0, faults: [{ type: 'hole', x: 30, y: 28, r: 0.9 }, { type: 'needle_line', wale: 40 }] });
  const hole = r.faults.find((f) => f.type === 'hole_or_slub'), line = r.faults.find((f) => f.type === 'needle_line');
  assert(hole && line && r.faults.length === 2, JSON.stringify(r.faults));
  assert(Math.abs(hole.x_mm + KS.CARD.sample[0] - 30) < 1.5 && Math.abs(hole.y_mm + KS.CARD.sample[0] - 28) < 1.5, 'the hole is where it was put');
}

// no card in the picture: said plainly, not guessed
{
  const g = new Uint8ClampedArray(800 * 600 * 4).fill(180);
  assert(/four black squares/.test(KS.analysePhoto(g, 800, 600).error));
  // four dark marks on grey cloth are not the card: the paper between them must be white
  const p = SY.photo({ KAScan: KS, width: 1700, height: 1350, pxPerMm: 15, structure: 'single_jersey', wpc: 14, cpc: 19, seed: 2 }, KS.CARD);
  const grey = new Uint8ClampedArray(p.rgba);
  for (let i = 0; i < grey.length; i += 4) for (let c = 0; c < 3; c++) if (grey[i + c] > 140) grey[i + c] = Math.round(grey[i + c] * 0.5);
  const fake = KS.analysePhoto(grey, p.w, p.h);
  assert(fake.error && fake.code === 'no_card', 'grey "paper" is not the card: ' + (fake.error || 'card found'));
}

// no card at all: the fabric fills the frame, turned 30 degrees; counted on its own axes, the scale given
{
  const p = SY.photo({ KAScan: KS, structure: 'single_jersey', wpc: 14, cpc: 19, seed: 5, pxPerMm: 9, width: 1300, height: 1300, uncut: true, cardY: -2, angle: 30, blur: 1, noise: 0.03, light: 0.3, wrinkle: 0.2, fuzz: 0.2 }, KS.CARD);
  assert.strictEqual(KS.analysePhoto(p.rgba, p.w, p.h).code, 'no_card');
  const r = KS.analyseFree(p.rgba, p.w, p.h, { pxPerMm: 9, source: 'assumed' });
  assert(!r.error, r.error);
  near(r.wpc, 14, 0.12, 'no-card wales'); near(r.cpc, 19, 0.2, 'no-card courses');
  assert.strictEqual(r.kind.kind, 'knit');
  assert.strictEqual(r.scale.source, 'assumed');
  assert(r.card === null && r.colour && r.colour.reference === 'camera, no white card');
  // a plain surface has no repeat: said so, not guessed
  const flat = new Uint8ClampedArray(900 * 900 * 4).fill(150);
  const fr = KS.analyseFree(flat, 900, 900, { pxPerMm: 9 });
  assert(fr.error || fr.kind.kind === 'none', 'a blank surface is not read as a fabric');
}

// colour against the card's white
{
  const r = shoot({ structure: 'single_jersey', wpc: 14, cpc: 19, seed: 4, colour: [30, 50, 140], light: 0 });
  assert(r.colour && r.colour.lab[2] < -10, `a navy swatch reads blue: ${JSON.stringify(r.colour)}`);
}

// the reverse engine: a known jersey comes back as it was knitted
{
  const o = R.reverse({ structure: 'single_jersey', wpc: 14.2, cpc: 19.5, gsm: 160, composition: '100% cotton', colour_hex: '#1f2a44' });
  assert(o.stitch_length.mm > 2.6 && o.stitch_length.mm < 2.8, `stitch length ${o.stitch_length.mm}`);
  assert.strictEqual(o.count.nearest, 28);
  assert.strictEqual(o.count.source, 'calculated');
  assert.strictEqual(o.full_params.color_input, '#1f2a44');
  const est = R.reverse({ structure: 'single_jersey', wpc: 14.2, cpc: 19.5 });
  assert.strictEqual(est.count.source, 'estimated', 'no GSM: the count is an estimate and says so');
  assert(est.gsm.range[0] < est.gsm.value && est.gsm.range[1] > est.gsm.value);
  const fl = R.reverse({ structure: 'fleece', wpc: 12, cpc: 16, gsm: 300 });
  assert(!fl.count && /loop yarn/.test(fl.notes.join(' ')), 'fleece: no count from GSM, and why');
  assert.throws(() => R.reverse({ structure: 'single_jersey', wpc: 2 }), /between 4 and 40/);
  // on the factory's own fabrics: stitch length back within a few percent, count within ~1–2 Ne
  const sc = R.selfCheck();
  assert(sc.single_jersey.n > 1000 && sc.single_jersey.stitch_length_median_err_pct <= 4 && sc.single_jersey.count_median_err_ne <= 1.5, JSON.stringify(sc.single_jersey));
  assert(sc.interlock.stitch_length_median_err_pct <= 4 && sc.pique.stitch_length_median_err_pct <= 4);
}

// the scan tables
{
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/040_fabric_scans.sql'), 'utf8');
  assert(/CREATE TABLE fabric_scans/.test(sql) && /CREATE TABLE scan_pairs/.test(sql));
}
console.log('Fabric scan tests passed');
