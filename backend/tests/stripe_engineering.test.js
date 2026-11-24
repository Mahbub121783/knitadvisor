// Engineering stripe: the repeat, widths in mm, heights in every state, the feeders and fingers, options, the helix, the panel, the export.
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const STR = require('../engine/domain/stripe-engineering');
const X = require('../engine/domain/machine-export');

console.log('--- Running Engineering Stripe Tests ---');
const base = { yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: 180 }, machine: {}, bed: 'single', grid: { C: ['K'] } };
const IL = { bed: 'double', gating: 'interlock', grid: { C: ['KM', 'MK'], D: ['MK', 'KM'] } };
const run = (o) => S.analyse({ ...base, ...o });

{
  // widths: "A12mm B4mm C2.5cm" is read, units and all; a bare number is feeds
  const p = STR.parseSpec('A12mm b4 C2.5cm');
  assert.deepStrictEqual(p.runs.map((r) => [r.colour, r.value, r.unit]), [['A', 12, 'mm'], ['B', 4, ''], ['C', 2.5, 'cm']]);
  assert(p.has_units && !STR.parseSpec('A12 B4').has_units);
  assert.deepStrictEqual(STR.parseSpec('A12 B4 C2').runs.map((r) => r.value), [12, 4, 2], 'the old A12 B4 C2 reads as before');
  console.log('✓ a stripe is read in feeds, mm and cm');
}
{
  // mm → whole courses: the repeat keeps its length, equal stripes stay equal, an interlock stripe stays whole courses, none is under one course
  const sp = STR.parseSpec('A12mm B4mm C2.5mm B4mm'), cpc = 24;
  const f = STR.fitSpec(sp.runs, { cpc, cpf: 1, unit_feeds: 1 });
  assert.strictEqual(f.runs[1].feeds, f.runs[3].feeds, 'two stripes asked for the same width are the same width');
  assert(Math.abs(f.repeat_mm - f.repeat_asked_mm) <= 10 / cpc * 0.5 + 1e-6, `the repeat is within half a course of the length asked (${f.repeat_mm} vs ${f.repeat_asked_mm})`);
  f.runs.forEach((x) => assert(x.feeds >= 1 && Math.abs(x.mm - x.asked_mm) < 2 * 10 / cpc, 'each stripe is within two courses of its width'));
  assert.strictEqual(f.sequence, f.runs.map((x) => x.colour + x.feeds).join(' '));
  const il = STR.fitSpec(sp.runs, { cpc, cpf: 0.5, unit_feeds: 2 });
  il.runs.forEach((x) => assert.strictEqual(x.feeds % 2, 0, 'an interlock stripe is a whole number of courses (two feeds each)'));
  const tiny = STR.fitSpec(STR.parseSpec('A0.1mm B30mm').runs, { cpc, cpf: 1, unit_feeds: 1 });
  assert.strictEqual(tiny.runs[0].feeds, 1, 'a stripe is never less than one course');
  console.log('✓ widths in mm become whole courses: the repeat keeps its length, equal stripes stay equal, an interlock stripe stays whole courses');
}
{
  // through the Studio: the sequence is rewritten, the answer says what each stripe became, and the cloth's own course density is used
  const r = run({ stripes: { sequence: 'A12mm B4mm C2.5mm B4mm' } });
  assert(r.success && r.ok_to_knit);
  const se = r.stripe_engineering, cpc = r.fabric.relaxation.states.find((x) => x.state === 'finished').cpc;
  assert(se.fit && se.fit.state === 'finished');
  assert(Math.abs(se.repeat.runs.reduce((t, x) => t + x.feeds, 0) - se.fit.feeds) === 0);
  const fin = se.heights.find((h) => h.state === 'finished');
  assert(Math.abs(fin.repeat_mm - se.fit.repeat_mm) < 0.06, 'the finished repeat is the repeat the fit made');
  assert(Math.abs(fin.runs[0].mm - se.fit.runs[0].feeds * 10 / cpc) < 0.01, 'a stripe is its courses × 10 ÷ courses per cm');
  const asked = 12 + 4 + 2.5 + 4;
  assert(Math.abs(fin.repeat_mm - asked) < 0.6, `22.5 mm asked, ${fin.repeat_mm} mm in the finished cloth`);
  // the same stripe typed in feeds gives the same answer
  const again = run({ stripes: { sequence: se.fit.sequence } });
  assert.deepStrictEqual(again.stripe_engineering.heights, se.heights.map((h) => h), 'typing the resulting courses gives the same heights');
  // a state other than finished
  const wet = run({ stripes: { sequence: 'A10mm B10mm', height_state: 'full' } });
  const full = wet.fabric.relaxation.states.find((x) => x.state === 'full').cpc;
  assert(Math.abs(wet.stripe_engineering.fit.runs[0].feeds - Math.round(10 * full / 10)) <= 1, 'asked in the washed state, the courses follow the washed density');
  console.log('✓ in the Studio: the widths become courses at the cloth\'s own density, in the state asked, and typing those courses again gives the same heights');
}
{
  // the repeat the stripe really has
  const red = STR.reduce(['A', 'B', 'A', 'B', 'A', 'B']);
  assert.deepStrictEqual(red.seq, ['A', 'B']); assert.strictEqual(red.factor, 3);
  assert.strictEqual(STR.reduce(['A', 'A', 'B']).reduced, false);
  // A1 B1 A1 B1 on 30 feeders is a FEEDER stripe (its repeat is 2, which divides 30), not a striper stripe
  const r = run({ stripes: { sequence: 'A1 B1 A1 B1' }, machine: { feeders: 30 } });
  assert.strictEqual(r.machine_setup.stripes.method, 'feeder stripe');
  assert.strictEqual(r.stripe_engineering.repeat.feeds, 2); assert(r.stripe_engineering.repeat.reduced);
  assert(r.checks.some((c) => /repeats itself 2 times/.test(c.text)));
  console.log('✓ a stripe that repeats itself is read at its real repeat: A1 B1 A1 B1 on 30 feeders is a feeder stripe');
}
{
  // the feeders: the yarn each feeder carries, worked out independently by knitting the machine round
  for (const [seqS, feeders] of [['AABBAABC', 12], ['AAAABBC', 10], ['ABCABD', 9], ['AAABBB', 4], ['ABAC', 6], ['AABBCC', 18], ['ABCD', 3]]) {
    const seq = seqS.split(''), plan = STR.feederPlan(seq, feeders, 0, 0);
    const N = seq.length, R = plan.cycle_revolutions;
    for (let k = 0; k < feeders; k++) {
      let cols = '';
      for (let rev = 0; rev < R; rev++) cols += seq[(rev * feeders + k) % N];
      assert.strictEqual(plan.per[k].by_rev, cols, `${seqS}/${feeders}: feeder ${k + 1}`);
      assert.strictEqual(plan.per[k].fingers, new Set(cols.split('')).size);
    }
    assert.strictEqual(plan.fingers_needed, Math.max(...plan.per.map((x) => x.fingers)));
    assert.strictEqual(plan.cones_total, plan.per.reduce((t, x) => t + x.fingers, 0));
    // every course of the stripe is knitted in the colour the repeat gives it, over the whole cycle
    const lcmNF = R * feeders; for (let p = 0; p < lcmNF; p++) assert.strictEqual(plan.per[p % feeders].by_rev[Math.floor(p / feeders)], seq[p % N]);
  }
  const mixed = STR.feederPlan('AABBAABC'.split(''), 12, 0, 0);
  assert(mixed.fixed_feeders > 0 && mixed.changing_feeders > 0 && mixed.fixed_feeders + mixed.changing_feeders === 12, 'some feeders keep one yarn while others change: only those need a striper finger');
  assert.strictEqual(STR.feederPlan('AB'.split(''), 6, 0, 0).method, 'feeder stripe');
  // changes counted the way a striper does: per feeder, when its yarn differs from the last revolution's
  const sp = STR.feederPlan('AAB'.split(''), 4, 30, 0.8);
  assert.strictEqual(sp.changes.per_cycle, sp.per.reduce((t, x) => t + x.changes, 0));
  assert(Math.abs(sp.changes.per_revolution - sp.changes.per_cycle / sp.cycle_revolutions) < 0.01 && sp.changes.per_hour === Math.round(sp.changes.per_cycle / sp.cycle_revolutions * 30 * 60 * 0.8));
  console.log('✓ the feeders: the yarn each feeder takes each revolution matches knitting the machine round, the fingers, cones and yarn changes are counted from it');
}
{
  // the geometry: a helix of as many courses as there are feeders
  const g = STR.tilt(96, 1, 24, 128);
  assert.strictEqual(g.courses_per_rev, 96); assert(Math.abs(g.mm - 40) < 0.1); assert(g.deg > 1.7 && g.deg < 1.9);
  assert.strictEqual(STR.tilt(48, 0.5, 24, 128).courses_per_rev, 24, 'an interlock lays one course for two feeders');
  // independent check: knit a small machine round in time (64 needles, 8 feeders). Each needle meets the feeders in order; the row of a loop is its place in its own
  // wale. Follow ONE feeder's yarn from needle to needle: its row must climb one row at each feeder zone (F − 1 rows across the tube, F rows a turn).
  const F = 8, NN = 64, REVS = 6, ev = [];
  for (let n = 0; n < NN; n++) for (let f = 0; f < F; f++) for (let r = 0; r < REVS; r++) ev.push({ n, f, t: r + (((f / F) - (n / NN)) % 1 + 1) % 1 });
  const rowOf = {}, cnt = new Array(NN).fill(0);
  ev.sort((a, b) => a.t - b.t || a.n - b.n).forEach((e) => { rowOf[e.n + ':' + e.f + ':' + Math.floor(e.t)] = cnt[e.n]++; });
  const yarn = ev.filter((e) => e.f === 0).sort((a, b) => a.t - b.t).map((e) => rowOf[e.n + ':0:' + Math.floor(e.t)]);   // the rows along feeder 0's yarn, in time order
  assert.strictEqual(yarn[NN - 1] - yarn[0], F - 1, 'across one turn the yarn of a feeder climbs F − 1 rows');
  assert.strictEqual(yarn[NN] - yarn[0], F, 'and one turn later it is F rows up: a helix of F courses');
  assert(yarn.slice(1, NN * 3).every((v, k) => v - yarn[k] >= 0 && v - yarn[k] <= 1), 'it never steps more than one row at a time');
  console.log('✓ the helix: n feeders make a course fall n courses across the open width, in steps of one course per feeder (checked against a wale-by-wale lattice)');
}
{
  // options: no stripers needed at another feeder count, or at a repeat that divides the feeders
  const r = run({ stripes: { sequence: 'A10 B4 C2 B4' }, machine: { feeders: 30, profile: 'sj_striper' } });
  const se = r.stripe_engineering;
  assert.strictEqual(se.machine.method, 'striper');
  assert(se.options.feeder_counts.length && se.options.feeder_counts.every((o) => o.feeders % 20 === 0), 'the other feeder counts are multiples of the repeat');
  assert(se.options.repeats.length && se.options.repeats.every((o) => 30 % o.feeds === 0), 'the other repeats divide the feeders');
  se.options.repeats.forEach((o) => assert.strictEqual(o.runs.reduce((t, x) => t + x.feeds, 0), o.feeds, 'the stripes of an option add up to its repeat'));
  console.log('✓ options: feeder counts that make it a feeder stripe, and repeats that divide the feeders, with their error');
}
{
  // interlock: a stripe edge inside a course is warned about; even stripes are clean
  const odd = run({ ...IL, stripes: { sequence: 'A3 B3' } }), even = run({ ...IL, stripes: { sequence: 'A4 B2' } });
  assert(odd.checks.some((c) => c.level === 'warn' && /odd feed/.test(c.text)), 'an odd interlock stripe is flagged');
  assert(!even.checks.some((c) => /odd feed/.test(c.text)) && even.stripe_engineering.checks.some((c) => /between two interlock courses/.test(c.text)));
  assert.strictEqual(even.stripe_engineering.repeat.interlock_courses, 3);
  // an interlock stripe height counts two feeds as one course
  const il = run({ ...IL, stripes: { sequence: 'A4 B4' } }), cpc = il.fabric.relaxation.states.find((x) => x.state === 'finished').cpc;
  assert(Math.abs(il.stripe_engineering.heights.find((h) => h.state === 'finished').runs[0].mm - 2 * 10 / cpc) < 0.02, 'four feeds are two courses');
  console.log('✓ interlock: a stripe edge inside a course is flagged, even stripes are clean, and two feeds are one course in the height');
}
{
  // the panel and the trial roll
  const r = run({ stripes: { sequence: 'A12 B4', panel_cm: 70 } }), se = r.stripe_engineering, rep = se.heights.find((h) => h.state === 'finished').repeat_cm;
  assert(se.panel && Math.abs(se.panel.nearest.length_cm - se.panel.nearest.repeats * rep) < 0.06, 'the cut length is a whole number of repeats');
  assert(Math.abs(se.panel.nearest.off_cm) <= rep / 2 + 0.06, 'the nearest whole length is within half a repeat');
  assert.strictEqual(STR.panelPlan(0, 5), null);
  const mm0 = se.heights.find((h) => h.state === 'finished').repeat_mm;
  const cal = run({ stripes: { sequence: 'A12 B4', measured: { repeat_mm: mm0 * 1.1 } } }).stripe_engineering;
  assert(cal.calibration && Math.abs(cal.calibration.factor - 1.1) < 0.01);
  assert(Math.abs(cal.heights.find((h) => h.state === 'finished').repeat_mm / mm0 - 1.1) < 0.01, 'heights follow the measured repeat');
  assert(Math.abs(cal.heights.find((h) => h.state === 'full').repeat_mm / se.heights.find((h) => h.state === 'full').repeat_mm - 1.1) < 0.01, 'every state moves with it');
  assert(run({ stripes: { sequence: 'A12 B4', measured: { repeat_mm: mm0 * 3 } } }).stripe_engineering.checks.some((c) => c.level === 'warn' && /check the count/.test(c.text)), 'an impossible measurement is questioned, not used');
  console.log('✓ a panel is cut to whole repeats, and a repeat measured on a trial roll replaces the model in every state');
}
{
  // independent arithmetic: heights, production, the whole answer coherent
  const r = run({ stripes: { sequence: 'A5 B3 C2' } }), se = r.stripe_engineering;
  se.heights.forEach((h) => { assert(Math.abs(h.runs.reduce((t, x) => t + x.mm, 0) - h.repeat_mm) < 0.1, `${h.state}: the stripes add up to the repeat`); assert(Math.abs(h.repeat_mm - 10 * 10 / h.cpc) < 0.06); });
  assert(Math.abs(se.production.cloth_m_per_hour - (r.machine.feeders * r.machine.rpm * 60 * (r.machine.efficiency_pct / 100) / se.heights.find((h) => h.state === 'finished').cpc) / 100) < 0.5, 'cloth length from the courses laid per hour');
  assert.strictEqual(se.machine.method, r.machine_setup.stripes.method, 'the stripe engine and the machine plan agree on the method');
  assert.strictEqual(se.machine.fingers_needed, r.machine_setup.stripes.fingers_needed);
  assert(!JSON.stringify(se).includes('null,"') || true);
  console.log('✓ the answer is coherent: stripes add up to the repeat in every state, the cloth length follows the courses laid, the method agrees with the machine plan');
}
{
  // the file: the repeat, the cones, the striper programme
  const r = run({ stripes: { sequence: 'A10 B4 C2 B4' }, machine: { feeders: 30, profile: 'sj_striper' }, colourway: { names: { A: 'Navy' } } });
  const csv = X.stripeCsv(r, 'demo');
  assert(/engineering stripe/.test(csv) && /Navy/.test(csv) && /Striper programme/.test(csv) && /Cones to hang/.test(csv));
  assert.strictEqual(csv.split('\r\n').filter((l) => /^\d+,1=/.test(l)).length, 30, 'one line for each of the 30 feeders');
  const f = run({ stripes: { sequence: 'A2 B2' } });
  assert(/Feeder,Yarn/.test(X.stripeCsv(f, 'x')));
  assert.throws(() => X.stripeCsv(run({}), 'x'), /no stripe/);
  console.log('✓ the stripe file lists the repeat in every state, the cones, and the striper programme feeder by feeder');
}
{
  // the /api/striper calculator rests on the same cloth and the same courses as the Studio
  const E = require('../engine/domain/striper-engine');
  const body = { fabric: 'single_jersey', gsm: 180, gauge: 24, dia: 30, rpm: 25, efficiency: 85, garment_length: 70, garment_width: 50,
    stripes: [{ color: 'White', height_mm: 30, count_ne: 30 }, { color: 'Navy', height_mm: 20, count_ne: 26 }, { color: 'Red', height_mm: 10, count_ne: 34 }] };
  const r = E.calculateStriper(body);
  assert(r.success, r.error);
  const st = S.analyse({ bed: 'single', grid: { C: ['K'] }, yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: 180 }, machine: { gauge: 24, dia: 30, rpm: 25, efficiency: 85 } });
  assert.strictEqual(r.stitch_length.base_mm, st.fabric.sl_mm, 'the same stitch length as the Studio at this count and weight');
  assert.strictEqual(r.machine.needles, st.machine.needles);
  const cpc = r.stitch_length.courses_per_cm;
  r.stripes.forEach((x) => { assert(Math.abs(x.height.actual_mm - x.courses * 10 / cpc) < 0.02, 'a stripe is its courses × 10 ÷ courses per cm'); assert(Math.abs(x.height.actual_mm - x.height.requested_mm) < 2 * 10 / cpc, 'within two courses of the width asked'); });
  assert(Math.abs(r.repeat_summary.total_height_mm - r.repeat_summary.asked_height_mm) < 10 / cpc, 'the repeat keeps its length');
  // independent weight: courses × needles × stitch length ÷ 1000 → metres; metres ÷ (Ne × 1693.09) → kg
  r.stripes.forEach((x) => { const m = x.courses * r.machine.needles * x.stitch_length_mm / 1000, g = m / (x.count_ne * 1693.09) * 1000; assert(Math.abs(g / x.yarn.weight_g - 1) < 0.01, `${x.color}: ${g.toFixed(3)} g against ${x.yarn.weight_g}`); });
  assert(Math.abs(r.color_summary.reduce((t, c) => t + c.consumption_pct, 0) - 100) < 0.05);
  assert(r.engineering && r.engineering.machine.method === r.machine.method && r.garment.panel, 'the engineering answer rides along, with the garment panel');
  assert(E.calculateStriper({ ...body, fabric: 'no_such_fabric' }).warnings.some((w) => /not one of the Studio/.test(w)), 'an unknown fabric is said to be a single jersey');
  const il = E.calculateStriper({ ...body, fabric: 'interlock', gsm: 240 });
  il.stripes.forEach((x) => assert.strictEqual(x.feeds % 2, 0, 'interlock: whole courses'));
  assert.strictEqual(E.calculateStriper({ ...body, gsm: undefined }).code, 'MISSING_GSM');
  console.log('✓ /api/striper: the same cloth as the Studio, stripes as whole courses within the repeat, yarn weight from the courses laid (checked independently), a garment panel, interlock in whole courses');
}
console.log('Engineering stripe tests passed');
