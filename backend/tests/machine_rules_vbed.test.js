// Phase E: the speed rule from the yarn's CSP, the elastane draft window, a metallised film yarn, and the flat V-bed compiler.
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const FY = require('../engine/domain/fancy-yarn-engine');
const VB = require('../engine/domain/vbed-compiler');

console.log('--- Running Machine Rules and V-bed Tests ---');
const base = { bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 180 }, machine: {} };
const run = (extra) => S.analyse({ ...base, ...(extra || {}) });
const rule = (r, id) => r.feasibility.rules.find((x) => x.id === id);
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m || ''} ${a} vs ${b} (±${tol})`);

{
  // U-14: the CSP is worked out from the yarn's force; the cap is min(35, CSP/85 × 30/dia)
  const r = run();
  const u = rule(r, 'U-14');
  assert.strictEqual(u.status, 'pass');
  assert(u.value && u.value.csp > 1800 && u.value.csp < 3500, `a 30s combed cotton CSP ≈ 2000-3000 (${u.value && u.value.csp})`);
  near(u.value.cap_rpm, Math.min(35, (u.value.csp / 85) * (30 / r.machine.dia)), 0.2, 'the cap formula');
  assert(/estimated from the yarn/.test(u.text));
  // a CSP given by the mill wins, and a weak yarn at a high speed is warned
  const weak = run({ yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne', csp: 1500 }, machine: { rpm: 30 } });
  assert.strictEqual(rule(weak, 'U-14').status, 'warn');
  assert(/1500 CSP yarn \(given\)/.test(rule(weak, 'U-14').text));
  assert(rule(weak, 'U-14').repair.changes[0].field === 'machine.rpm' && rule(weak, 'U-14').repair.changes[0].to < 30);
  // a filament yarn has no CSP: only the machine's own speed limit is checked
  const fil = run({ yarn: { fibre: 'polyester_filament', type: 'dty', count: 150, unit: 'denier' } });
  assert(!fil.feasibility.rules.find((x) => x.id === 'U-14').value, 'no CSP for a filament yarn');
  console.log('✓ U-14: CSP estimated from the breaking force (', u.value.csp, '), cap', u.value.cap_rpm, 'RPM; a given weak CSP warns with a repair');
}
{
  // elastane draft window 2.0-4.2
  const el = (d) => run({ elastane: { denier: 40, draft: d } });
  assert.strictEqual(rule(el(2.8), 'U-19').status, 'pass');
  const slack = el(1.6), over = el(4.6);
  assert.strictEqual(rule(slack, 'U-19').status, 'warn'); assert(/slack/.test(rule(slack, 'U-19').text));
  assert.strictEqual(rule(over, 'U-19').status, 'warn'); assert(/over-drawn/.test(rule(over, 'U-19').text));
  const ch = rule(over, 'U-19').repair.changes[0];
  assert(ch.field === 'elastane.draft' && ch.to > 2 && ch.to < 4.2);
  console.log('✓ U-19: elastane draft 2.8× passes; 1.6× is slack, 4.6× over-drawn, each with a repair into the window');
}
{
  // plating tension window (U-16) from the Studio input
  const plated = { feeds: [{ role: 'ground', plate: true }], yarns: { plate: { fibre: 'polyester_filament', type: 'fdy', count: 75, unit: 'denier' } } };
  assert.strictEqual(rule(run({ ...plated, plating: { tension_ratio: 1.4 } }), 'U-16').status, 'pass');
  assert.strictEqual(rule(run({ ...plated, plating: { tension_ratio: 0.9 } }), 'U-16').status, 'warn');
  assert.strictEqual(rule(run(plated), 'U-16').status, 'not_checked');
  console.log('✓ U-16: a back/face tension of 1.4 passes, 0.9 warns, none given is not checked');
}
{
  // metallic (Lurex) film yarn
  const m = FY.analyse({ form: 'lurex', params: { width_mm: 0.37, thickness_um: 12 } });
  near(m.count.resultant_tex, 6.2, 0.1, 'tex = width × thickness × 1.4');
  near(m.count.film_denier, m.count.resultant_tex * 9, 0.3);
  assert(m.tensile.tenacity.value > 20 && m.tensile.tenacity.value < 35);
  assert(m.look.sheen > 3 && m.look.hair === 0, 'a metallic sparkles and has no hairs');
  assert(m.knitting.notes.some((n) => /plate/i.test(n)) && m.knitting.notes.some((n) => /alkali|caustic/i.test(n)));
  assert(m.warnings.some((w) => /plated with a carrier|knit it plated/i.test(w.text)));
  const wide = FY.analyse({ form: 'lurex', params: { width_mm: 0.74, thickness_um: 12 } });
  near(wide.count.resultant_tex / m.count.resultant_tex, 2, 0.02, 'twice the width, twice the tex');
  assert(wide.knitting.finest_gauge.value < m.knitting.finest_gauge.value, 'a wider ribbon needs a coarser gauge');
  assert(FY.catalogue().forms.some((f) => f.id === 'lurex'));
  // in the Studio: a plated metallic film over a cotton ground; a caustic scour is warned, a ground film is warned
  const plated = { feeds: [{ role: 'ground', plate: true }], yarns: { plate: { fibre: 'polyester_filament', type: 'fdy', count: 56, unit: 'denier' } }, fancy: { plate: { enabled: true, form: 'lurex', params: { width_mm: 0.37, thickness_um: 12 } } } };
  const r = run({ ...plated, chemistry: { enabled: true, shade: 'medium' } });
  assert(r.success && r.fancy && r.fancy.plate && r.fancy.plate.identity.form === 'lurex');
  assert.strictEqual(rule(r, 'U-09').status, 'warn', 'a cotton scour has caustic: it attacks the aluminium');
  assert(/metallised film/.test(rule(r, 'U-09').text));
  const alone = run({ yarn: { fibre: 'polyester_filament', type: 'fdy', count: 56, unit: 'denier' }, fancy: { ground: { enabled: true, form: 'lurex', params: { width_mm: 0.37, thickness_um: 12 } } } });
  assert(alone.success, alone.error);
  assert.strictEqual(rule(alone, 'U-07').status, 'warn'); assert(/never|as the ground/i.test(rule(alone, 'U-07').text));
  console.log('✓ metallic film: tex from the film, sparkle and no hair; a caustic scour and a ground film are warned');
}
{
  // flat V-bed compiler
  const off = run();
  assert.strictEqual(off.vbed, null);
  const on = run({ vbed: { enabled: true, gauge: 14 } });
  assert(on.vbed && on.vbed.success);
  assert.strictEqual(on.vbed.machine.gauge, 14);
  assert.strictEqual(on.vbed.machine.needle_pitch_mm, 1.81);
  near(on.vbed.envelope.limit_tex.value, 24000 / 196, 0.1);
  assert(on.vbed.envelope.fits && on.vbed.ok_to_knit);
  assert.strictEqual(on.vbed.machine.needles_per_bed, 52 * 14);
  // the fabric is knitted at the machine's gauge
  assert.strictEqual(on.machine.gauge, 14);
  // production: courses/h from the carriage; kg/h in a believable flat-bed range
  const p = on.vbed.production;
  near(p.courses_per_hour.value, (3600 / ((52 * 14 / 14 * 0.0254 + 0.15) / 1.2)) * 2 * 0.65, 2);
  assert(p.kg_per_hour.value > 0.05 && p.kg_per_hour.value < 1.5, `flat-bed production ${p.kg_per_hour.value} kg/h`);
  const slow = run({ vbed: { enabled: true, gauge: 14, speed_m_s: 0.6 } }), four = run({ vbed: { enabled: true, gauge: 14, systems: 4 } });
  assert(slow.vbed.production.kg_per_hour.value < on.vbed.production.kg_per_hour.value && four.vbed.production.kg_per_hour.value > on.vbed.production.kg_per_hour.value * 1.9);
  // the programme: one pass per feed, alternating direction
  const rib = S.listTemplates().find((t) => t.id === 'lycra_rib_1x1');
  const f = S.analyse({ bed: 'double', gating: 'rib', grid: rib.grid, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, elastane: { denier: 40, draft: 2.8 }, target: { gsm: 280 }, machine: {}, vbed: { enabled: true, gauge: 12 } });
  assert.strictEqual(on.vbed.program.length, 1); assert.strictEqual(f.vbed.program[0].back, 'K');
  assert.strictEqual(f.vbed.panel.wales, Math.round(52 * 12 * 2), 'a 1×1 rib knits every needle of both beds');
  console.log('✓ V-bed: knitted at the machine gauge; envelope 24000 ÷ GG²; courses/h from the carriage; production', p.kg_per_hour.value, 'kg/h; 4 systems ≈ 2× 2 systems');
}
{
  // the envelope: a thick yarn at a fine gauge is refused, with the gauge it needs
  const coarse = run({ yarn: { fibre: 'cotton', type: 'combed', count: 6, unit: 'ne' }, vbed: { enabled: true, gauge: 18 } });
  assert(coarse.success, coarse.error);
  assert(!coarse.vbed.envelope.fits && !coarse.vbed.ok_to_knit);
  assert.strictEqual(rule(coarse, 'U-04').status, 'fatal');
  assert(/flat V-bed/.test(rule(coarse, 'U-04').text));
  const fix = rule(coarse, 'U-04').repair.changes[0];
  assert.strictEqual(fix.field, 'vbed.gauge'); assert(fix.to < 18 && fix.to >= 5);
  assert.strictEqual(coarse.feasibility.export_locked, true);
  const fixed = run({ yarn: { fibre: 'cotton', type: 'combed', count: 6, unit: 'ne' }, vbed: { enabled: true, gauge: fix.to } });
  assert(fixed.vbed.envelope.fits, 'the repaired gauge fits');
  // a plated back yarn counts toward the needle
  const pl = run({ feeds: [{ role: 'ground', plate: true }], yarns: { plate: { fibre: 'polyester_filament', type: 'fdy', count: 150, unit: 'denier' } }, vbed: { enabled: true, gauge: 14 } });
  assert(pl.vbed.envelope.yarn_tex.value > 19.7 + 16 && pl.vbed.envelope.yarn_tex.plated);
  // the recommended gauge is the finest that fits
  const auto = run({ yarn: { fibre: 'cotton', type: 'combed', count: 20, unit: 'ne' }, vbed: { enabled: true } });
  assert.strictEqual(auto.vbed.machine.gauge, auto.vbed.machine.gauge_recommended, 'no gauge asked: the recommended one is used');
  assert(auto.vbed.machine.gauge_recommended >= 5 && auto.vbed.machine.gauge_recommended <= 18);
  console.log('✓ V-bed: an 18 GG needle refuses a 6s cotton (FATAL, locks the export) and names the gauge it takes; a plated yarn counts; the auto gauge is the finest that fits');
}
{
  // transfers, racking, circular-only rules
  const rib = S.listTemplates().find((t) => t.id === 'lycra_rib_1x1');
  const ribIn = { bed: 'double', gating: 'rib', grid: rib.grid, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, elastane: { denier: 40, draft: 2.8 }, target: { gsm: 280 }, machine: {} };
  const ok = S.analyse({ ...ribIn, vbed: { enabled: true, gauge: 12, rack: 2 } }), over = S.analyse({ ...ribIn, vbed: { enabled: true, gauge: 12, rack: 5 } }), impossible = S.analyse({ ...ribIn, vbed: { enabled: true, gauge: 12, rack: 8 } });
  assert(ok.vbed.checks.some((c) => c.rule === 'rack' && c.level === 'ok'));
  assert(over.vbed.checks.some((c) => c.rule === 'rack' && c.level === 'warn'));
  assert(over.feasibility.gates.gate3.other.some((t) => /flat V-bed/.test(t)) && over.feasibility.gates.gate3.status === 'warn');
  assert(impossible.vbed.checks.some((c) => c.rule === 'rack' && c.level === 'error') && !impossible.vbed.ok_to_knit);
  assert.strictEqual(impossible.feasibility.gates.gate3.status, 'fatal');
  const single = run({ vbed: { enabled: true, gauge: 14, rack: 2 } });
  assert(single.vbed.checks.some((c) => c.rule === 'rack' && /no back bed/.test(c.text)));
  // the circular-only rules are not applicable on a flat machine
  assert.strictEqual(rule(ok, 'U-05').status, 'na'); assert.strictEqual(rule(ok, 'U-14').status, 'na');
  // a design with transfers (pointelle) counts them
  const pt = S.listTemplates().find((t) => t.id === 'pointelle_eyelet');
  const pe = S.analyse({ bed: pt.bed, gating: pt.gating, grid: pt.grid, feeds: pt.roles.map((r) => ({ role: r })), yarn: { fibre: 'cotton', count: 40, unit: 'ne' }, target: { gsm: 125 }, machine: {}, vbed: { enabled: true, gauge: 14 } });
  assert(pe.success, pe.error);
  assert(pe.vbed.transfers.to_next_needle + pe.vbed.transfers.to_other_bed > 0 && pe.vbed.checks.some((c) => c.rule === 'transfer'));
  assert.throws(() => VB.compile({ structure: {} }, {}), /needle programme/);
  assert(VB.catalogue().gauges[0] === 5);
  console.log('✓ V-bed: racking within the yarn passes, beyond it warns, past ±6 is FATAL; no back bed to rack on a single bed; transfers are counted; circular rules are n/a');
}
console.log('Machine rules and V-bed tests passed');
