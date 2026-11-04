// Fabric studio: a drawn structure weighed on the factory's own constants,
// checked the way the knitting floor would find out.
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const { CAL, buildKnitPlan } = require('../engine/domain/knit-plan');
const { FACTORY_RECORDS } = require('../engine/catalog/factory-dataset');
const { FABRIC_DERIVATIVES } = require('../engine/catalog/fabric-derivatives');
console.log('--- Running Fabric Studio Tests ---');

const T = S.listTemplates();
const tpl = (id) => T.find((t) => t.id === id);
const run = (id, x = {}) => {
  const t = tpl(id);
  return S.analyse({ bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((role) => ({ role })), ...x });
};

// 1. every catalogue weft structure loads and analyses
assert(T.length >= 60, `templates: ${T.length}`);
for (const t of T) {
  const r = run(t.id, { yarn: { ne: 30 }, target: { gsm: 200 } });
  assert(r.success, `${t.id}: ${r.error}`);
  // only the jacquard-width pointelles need more than a 4-track cylinder
  const errs = r.checks.filter((c) => c.level === 'error');
  if (!/pointelle_(chevron|diagonal)/.test(t.id)) assert.strictEqual(errs.length, 0, `${t.id}: ${errs.map((c) => c.text).join(' / ')}`);
}

// 2. the anchor structure IS the measured fit: GSM = Ks × tex ÷ (10 ℓ)
{
  const r = run('single_jersey', { yarn: { ne: 30 }, machine: { sl_mm: 2.7 } });
  const ks = CAL.ks['single_jersey|P'].med;
  assert.strictEqual(r.structure.confidence.level, 'calibrated');
  assert(Math.abs(r.fabric.gsm - (ks * 590.5 / 30) / 2.7) <= 1, `gsm ${r.fabric.gsm}`);
}

// 3. against the factory's own single-jersey rows: stitch length for the GSM
{
  const e = [];
  for (const rec of FACTORY_RECORDS) {
    if (rec.fab !== 'single_jersey' || /lycra/.test(rec.spin || '') || !(rec.ne > 0 && rec.sl > 0 && rec.fgsm > 0)) continue;
    const r = run('single_jersey', { yarn: { ne: rec.ne }, target: { gsm: rec.fgsm } });
    e.push(Math.abs(r.fabric.sl_mm / rec.sl - 1) * 100);
  }
  e.sort((a, b) => a - b);
  assert(e[e.length >> 1] < 6, `single jersey SL median error ${e[e.length >> 1]}%`);
}

// 4. the same answer as the calculator's knitting plan for a catalogue fabric
{
  const f = FABRIC_DERIVATIVES.find((x) => x.id === 'lacoste_single');
  const kp = buildKnitPlan({ fabricDef: f, countNe: 24, gsm: 210, gauge: 24, dia: 30 });
  const r = run('lacoste_single', { yarn: { ne: 24 }, target: { gsm: 210 }, machine: { gauge: 24, dia: 30 } });
  assert.strictEqual(r.structure.confidence.level, 'calibrated');
  assert(Math.abs(r.fabric.sl_mm / kp.stitch_length.used_mm - 1) < 0.02, `SL ${r.fabric.sl_mm} vs ${kp.stitch_length.used_mm}`);
  assert(Math.abs(r.fabric.width_open_in / kp.fabric.finished_width_in - 1) < 0.03, `width ${r.fabric.width_open_in} vs ${kp.fabric.finished_width_in}`);
  // two tracks; knit feeders take more yarn than knit-tuck feeders → two quality belts
  assert.strictEqual(r.setup.tracks.C.count, 2);
  assert.strictEqual(r.vdq.groups.length, 2);
}

// 5. solver: no count given → a count the factory would use for 180 GSM jersey
{
  const r = run('single_jersey', { target: { gsm: 180 } });
  assert(r.solver && r.solver.options.length >= 2);
  const ne = 590.5 / r.yarn.ground.tex;
  assert(ne >= 18 && ne <= 26, `solved ${ne}s`);
}

// 6. a rib's out-of-action needles are not cloth: 2×2 rib = 1×1 rib stitch length
{
  const a = run('rib_1x1', { yarn: { ne: 30 }, target: { gsm: 220 } });
  const b = run('rib_2x2', { yarn: { ne: 30 }, target: { gsm: 220 } });
  assert(Math.abs(a.fabric.sl_mm - b.fabric.sl_mm) < 0.05, `${a.fabric.sl_mm} vs ${b.fabric.sl_mm}`);
  assert(b.fabric.width_open_in < a.fabric.width_open_in * 0.75, '2x2 knits on two-thirds of the needles');
}

// 7. checks the machine would otherwise find
{
  const clash = S.analyse({ bed: 'double', gating: 'interlock', grid: { C: ['KK'], D: ['KK'] }, yarn: { ne: 30 }, target: { gsm: 200 } });
  assert(clash.checks.some((c) => c.level === 'error' && /face each other/.test(c.text)), 'interlock clash');
  assert.strictEqual(clash.ok_to_knit, false);
  const tracks = S.analyse({ grid: { C: ['KTMK', 'TKKM', 'MKTK'] }, yarn: { ne: 30 }, target: { gsm: 180 }, machine: { tracks_cyl: 2 } });
  assert(tracks.checks.some((c) => c.level === 'error' && /needs 4 needle tracks/.test(c.text)), 'track count');
  const feeders = run('lacoste_single', { yarn: { ne: 24 }, target: { gsm: 210 }, machine: { feeders: 90 } });
  assert(feeders.checks.some((c) => c.level === 'error' && /not a whole number/.test(c.text)), 'feeders multiple');
  const held = S.analyse({ grid: { C: ['K', 'T', 'T', 'T', 'T', 'T'] }, yarn: { ne: 30 }, target: { gsm: 200 } });
  assert(held.checks.some((c) => c.level === 'warn' && /tucks 5 times/.test(c.text)), 'tuck run');
  const nothing = S.analyse({ grid: { C: ['KM', 'KM'] }, yarn: { ne: 30 }, target: { gsm: 160 } });
  assert(nothing.success);
  const bad = S.analyse({ grid: { C: ['KX'] }, yarn: { ne: 30 }, target: { gsm: 160 } });
  assert(!bad.success && /Use K, T, M or -/.test(bad.error));
}

// 8. elastane by mass balance: 20 D at draft 2.6 in 30s, full plating
{
  const r = run('single_jersey', { yarn: { ne: 30 }, target: { gsm: 190 }, elastane: { denier: 20, draft: 2.6 } });
  const el = r.yarn.composition.find((c) => /elastane/.test(c.part));
  const expect = (20 / 9 / 2.6) / (590.5 / 30 + 20 / 9 / 2.6) * 100;
  assert(Math.abs(el.pct - expect) < 0.15, `elastane ${el.pct}% vs ${expect}%`);
}

// 9. VDQ: two reference settings → a straight line through both
{
  const r = run('lacoste_single', { yarn: { ne: 24 }, target: { gsm: 210 }, machine: { gauge: 24, dia: 30, vdq: { points: [{ reading: 100, course_length_m: 5 }, { reading: 120, course_length_m: 6 }] } } });
  r.vdq.groups.forEach((g) => assert(Math.abs(g.vdq_reading - (100 + 20 * (g.course_length_m - 5))) < 0.02));
}

// 10. the double piqués drawn with both beds rising open on rib gating
assert.strictEqual(tpl('swiss_double_pique').gating, 'rib');
assert.strictEqual(tpl('interlock').gating, 'interlock');
assert.strictEqual(tpl('ponte_di_roma').gating, 'interlock');

console.log('Fabric studio tests passed');
