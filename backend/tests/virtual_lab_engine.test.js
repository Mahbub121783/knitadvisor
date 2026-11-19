// The virtual lab (air permeability, thermal resistance, a hundred rolls) and the matching collar and cuff.
'use strict';
const assert = require('assert');
const L = require('../engine/domain/virtual-lab-engine');
const S = require('../engine/domain/fabric-studio');

console.log('--- Running Virtual Lab Tests ---');
const jersey = { wpc: 14.5, cpc: 19, loop_mm: 2.75, yarn_d_mm: 0.19, gsm: 150, thickness_mm: 0.55 };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m || ''} ${a} vs ${b} (±${tol})`);

{
  const r = L.analyse(jersey);
  assert(r.success);
  near(r.air.air_permeability.value, 700, 2, 'the reference 30s jersey reads 700 mm/s');
  assert(r.air.through_holes.value > 0 && r.air.through_fibre.value > 0);
  near(r.air.through_holes.value + r.air.through_fibre.value, r.air.air_permeability.value, 2);
  near(r.air.cfm.value, r.air.air_permeability.value * 0.19685, 0.2);
  assert(r.air.air_permeability.range[0] < 700 && r.air.air_permeability.range[1] > 700);
  // a jersey keeps a few tenths of a clo per cloth, not several
  assert(r.thermal.clo.value > 0.03 && r.thermal.clo.value < 0.15, `jersey clo ${r.thermal.clo.value}`);
  near(r.thermal.rct.value / 0.155, r.thermal.clo.value, 0.006);
  console.log('✓ the reference jersey reads 700 mm/s and', r.thermal.clo.value, 'clo; holes and fibre flow add up');
}
{
  // directions: a tighter, thicker cloth passes less air; a thicker cloth is warmer; a heavier cloth of the same thickness is denser
  const open = L.analyse({ ...jersey, wpc: 12, cpc: 16, loop_mm: 3.1, gsm: 140 }), tight = L.analyse({ ...jersey, wpc: 17, cpc: 22, loop_mm: 2.4, gsm: 210 });
  assert(tight.air.air_permeability.value < 700 && open.air.air_permeability.value > tight.air.air_permeability.value, 'tighter loops, less air');
  const thick = L.analyse({ ...jersey, thickness_mm: 1.1, gsm: 300 }), thin = L.analyse(jersey);
  assert(thick.thermal.rct.value > 1.7 * thin.thermal.rct.value, 'twice the thickness, about twice the resistance');
  const nap = L.analyse({ ...jersey, gsm: 200, nap_mm: 1.5, brushed: 'back' });
  assert(nap.thermal.rct.value > 2 * thin.thermal.rct.value && nap.air.air_permeability.value < thin.air.air_permeability.value, 'a raised nap is warmer and passes less air');
  const closed = L.analyse({ wpc: 13, cpc: 30, loop_mm: 3.7, yarn_d_mm: 0.2, gsm: 340, thickness_mm: 0.62, nap_mm: 1.2, loop_d_mm: 0.3, brushed: 'back', layers: 2 });
  assert(closed.air.through_fibre.value > 10 * closed.air.through_holes.value, 'a closed fleece passes its air through the fibre mass, not holes');
  assert(closed.air.air_permeability.value > 50, 'and still reads a believable value, not zero');
  const pp = L.analyse({ ...jersey, fibres: { polypropylene: 100 } }), co = L.analyse(jersey);
  assert(pp.thermal.fibre_fraction.value > co.thermal.fibre_fraction.value, 'a light fibre fills more of the volume at the same weight');
  console.log('✓ directions: tighter less air; thicker warmer; nap warms and blocks; a closed fleece breathes through its fibre');
}
{
  // end use
  const tee = L.analyse({ ...jersey, end_use: 'summer_tee' }), fleece = L.analyse({ wpc: 13, cpc: 30, loop_mm: 3.7, yarn_d_mm: 0.2, gsm: 340, thickness_mm: 0.62, nap_mm: 1.2, loop_d_mm: 0.3, brushed: 'back', end_use: 'summer_tee' });
  assert(tee.end_use.fits.find((x) => x.id === 'summer_tee').fits && !fleece.end_use.fits.find((x) => x.id === 'summer_tee').fits);
  assert(fleece.warnings.some((w) => /Summer T-shirt/.test(w.text)), 'a fleece for a summer tee is warned');
  assert(fleece.end_use.fits.find((x) => x.id === 'sweatshirt').fits || fleece.end_use.fits.find((x) => x.id === 'winter').fits);
  console.log('✓ end use: a jersey fits a summer tee; a brushed fleece does not');
}
{
  // SPC: seeded, consistent with its own arithmetic
  const a = L.analyse(jersey), b = L.analyse(jersey);
  assert.deepStrictEqual(a.spc.gsm.histogram, b.spc.gsm.histogram, 'the same cloth gives the same hundred rolls');
  const g = a.spc.gsm;
  const sig = Math.sqrt(0.8 ** 2 + (0.01 / 2.75 * 100) ** 2 + 1.0 ** 2);
  near(g.sigma_pct.value, sig, 0.02, 'σ from the three spreads in quadrature');
  near(g.cp.value, 5 / (3 * sig), 0.02, 'Cp = ±spec ÷ 3σ');
  assert(g.cpk_untried.value < g.cpk_centred.value, 'a machine set up untried is less capable');
  assert(g.in_spec_untried_pct.value < g.in_spec_pct.value);
  // a sample of 100 rolls sits near its theory
  near(g.sigma.value / g.mean.value * 100, sig, 0.45, 'the 100 simulated rolls');
  const rolls = L.analyse({ ...jersey, rolls: 1000 });
  near(rolls.spc.gsm.sigma.value / rolls.spc.gsm.mean.value * 100, sig, 0.15, '1000 rolls are closer');
  assert.strictEqual(rolls.spc.rolls, 1000);
  assert.strictEqual(g.histogram.counts.reduce((t, x) => t + x, 0), 100);
  // tighter spreads, higher capability; a wider spec, higher capability
  const tight = L.analyse({ ...jersey, cv_count: 0.4, cv_finish: 0.5, tol_sl_mm: 0.015 }), wide = L.analyse({ ...jersey, spec_pct: 8 });
  assert(tight.spc.gsm.cp.value > 2 * g.cp.value * 0.9 && tight.spc.word !== 'not capable');
  near(wide.spc.gsm.cp.value, g.cp.value * 8 / 5, 0.02);
  const bad = L.analyse({ ...jersey, cv_count: 3, cv_finish: 3 });
  assert(bad.spc.gsm.cpk_centred.value < 1 && bad.warnings.some((w) => /Cp/.test(w.text)) && bad.spc.word === 'not capable');
  // shade: a dark shade is steadier than a white
  const dark = L.analyse({ ...jersey, shade: 'dark' }), white = L.analyse({ ...jersey, shade: 'white' });
  assert(dark.spc.shade.mean_delta_e.value < white.spc.shade.mean_delta_e.value);
  console.log('✓ SPC: seeded; σ in quadrature; Cp = spec ÷ 3σ; untried set-up less capable; 100 and 1000 rolls near theory');
}
{
  assert.throws(() => L.analyse({ wpc: 14 }), /loops per cm/);
  assert.throws(() => L.analyse(null), /loops per cm/);
  assert.strictEqual(L.catalogue().end_uses.length, 6);
  // 300 random cloths are finite and bounded
  let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < 300; i++) {
    const r = L.analyse({ wpc: 6 + rnd() * 16, cpc: 8 + rnd() * 30, loop_mm: 1.8 + rnd() * 4, yarn_d_mm: 0.1 + rnd() * 0.5, gsm: 60 + rnd() * 500, thickness_mm: 0.3 + rnd() * 2.5, nap_mm: rnd() < 0.3 ? rnd() * 3 : 0, layers: 1 + Math.floor(rnd() * 2), fibres: { cotton: 60, polyester: 40 }, shade: ['white', 'medium', 'dark'][i % 3], rolls: 50 });
    const walk = (o) => { if (typeof o === 'number') assert(Number.isFinite(o)); else if (o && typeof o === 'object') Object.values(o).forEach(walk); };
    walk(r);
    assert(r.air.air_permeability.value >= 0 && r.thermal.clo.value > 0);
  }
  console.log('✓ bad input in words; 300 random cloths finite and bounded');
}
{
  // in the Studio: only on request; follows the cloth state; the trim is worked out by the Studio itself
  const base = { bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 180 }, machine: {}, look: { shade: 'dark' } };
  const off = S.analyse(base);
  assert.strictEqual(off.lab, null); assert.strictEqual(off.trim, null);
  const on = S.analyse({ ...base, lab: { enabled: true, end_use: 'summer_tee' } });
  assert(on.lab && on.lab.success && on.lab.end_use.selected === 'summer_tee');
  const dry = S.analyse({ ...base, lab: { enabled: true }, state: 'dry' }), full = S.analyse({ ...base, lab: { enabled: true }, state: 'full' });
  assert(dry.lab.air.air_permeability.value > full.lab.air.air_permeability.value, 'as knitted passes more air than after washing');
  const fleece = S.analyse({ bed: 'single', grid: { C: [['K', 'K', 'K', 'K'], ['M', 'M', 'M', 'T']], D: null }, feeds: [{ role: 'ground' }, { role: 'loop' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, yarns: { loop: { fibre: 'cotton', type: 'carded', count: 12, unit: 'ne' } }, target: { gsm: 300 }, machine: {}, finish: { brush: 'back' }, lab: { enabled: true } });
  assert(fleece.lab.thermal.clo.value > on.lab.thermal.clo.value * 3, 'a brushed fleece is far warmer than a jersey');
  const t = S.analyse({ ...base, trim: { enabled: true } });
  assert(t.trim && t.trim.collar && t.trim.cuff, t.trim && JSON.stringify(t.trim.collar));
  assert(t.trim.collar.ok_to_knit && t.trim.cuff.ok_to_knit, 'both bands knit as drawn');
  assert(t.trim.collar.elastane_pct > 1 && t.trim.collar.gauge > 0 && t.trim.collar.gsm > 0);
  assert(Math.abs(t.trim.collar.gsm / t.fabric.gsm - 1.25) < 0.1, 'the collar is about 1.25 × the body weight');
  assert(Math.abs(t.trim.cuff.gsm / t.fabric.gsm - 1.35) < 0.1);
  assert.strictEqual(t.trim.dye_sync.same_route, false, 'the trim has elastane, the body none: not the same bath');
  assert(/own bath/.test(t.trim.notes[0]));
  const el = S.analyse({ ...base, elastane: { denier: 40, draft: 2.6 }, trim: { enabled: true } });
  assert(/both carry elastane/.test(el.trim.notes[0]));
  console.log('✓ in the Studio: off by default; follows the cloth state; fleece is warmer; the collar and cuff are lycra ribs ×1.25 / ×1.35 of the body');
}
console.log('Virtual lab tests passed');
