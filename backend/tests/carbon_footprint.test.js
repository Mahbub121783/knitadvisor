const assert = require('assert');
const { calculateCarbonFootprint: calc, detectVariant } = require('../engine/domain/carbon-footprint-engine');
const M = require('../engine/catalog/carbon-model');

console.log('--- Running Carbon Footprint Engine v2 Tests ---');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || 'mismatch'}: ${a} vs ${b}`);

// 1. bad input fails cleanly
{
  assert.strictEqual(calc({}).success, false);
  assert.strictEqual(calc({ gsm: -10 }).success, false);
  assert.strictEqual(calc({ gsm: 180, fibers: { cotton: 0 } }).success, false);
  console.log('  Bad input handled without throwing');
}

// 2. default composition
{
  const r = calc({ gsm: 180 });
  assert(r.success && r.warnings.some(w => /assuming 100% cotton/i.test(w)) && r.fiber_breakdown[0].fiber === 'cotton');
  console.log('  No composition → 100% cotton with a warning');
}

// 3. INDEPENDENT hand calculation of the whole chain (medium shade, reactive, cotton, Bangladesh, gas)
{
  const r = calc({ gsm: 180, fibers: { cotton: 100 }, shade: 'medium', dyeing_method: 'reactive', process_loss_pct: 12.5, country: 'bangladesh', boiler_fuel: 'natural_gas' });
  const grey = 1 / 0.875, yarn = grey / (1 - 0.02), fibre = yarn / (1 - 0.07), grid = 0.61;
  const fibreCo2 = fibre * M.FIBRES.cotton.central;
  const spin = yarn * M.MILL.spinning_kwh_per_kg.central * grid;
  const form = grey * M.MILL.knit_kwh_per_kg.central * grid;
  const heat = T => 8 * 4.186 * (T - 28) / 3600;
  const bathsTh = heat(95) + heat(80) + heat(60) + heat(50) + heat(95) + heat(70);   // scour, hot rinse, dye, neutralise, soap, warm rinse
  const fuelPerTh = (1 / 0.85) * 1.25;
  const bathCo2 = bathsTh * grey * fuelPerTh * 0.202;
  const chem = 0.02 * 0.59 * grey;
  const dryTh = (0.55 + 0.70) * (2257 / 3600) / 0.45;
  const dryCo2 = dryTh * fuelPerTh * 0.202;
  const wetElec = grey * 0.60 * grid;
  const finElec = (47.5 / (25 * 60 * 1.6 * 0.18) + 0.20) * grid;
  const expected = fibreCo2 + spin + form + bathCo2 + chem + dryCo2 + wetElec + finElec;
  near(r.total_co2e_per_kg_fabric, expected, 0.01, 'whole-chain hand calculation');
  near(r.stages.find(s => s.id === 'fibre').co2e_per_kg_fabric, fibreCo2, 0.002, 'fibre stage');
  near(r.stages.find(s => s.id === 'spinning').co2e_per_kg_fabric, spin, 0.002, 'spinning stage');
  near(r.wet_processing.bath_heat_kwh_th_per_kg, bathsTh, 0.002, 'bath heat');
  console.log(`  Whole chain matches an independent hand calculation: ${r.total_co2e_per_kg_fabric} kg CO2e/kg`);
}

// 4. structure of the answer
{
  const r = calc({ gsm: 200, fibers: { cotton: 60, polyester: 40 }, shade: 'dark_navy' });
  near(r.stages.reduce((s, x) => s + x.share_pct, 0), 100, 0.1, 'stage shares sum to 100');
  near(r.stages.reduce((s, x) => s + x.co2e_per_kg_fabric, 0), r.total_co2e_per_kg_fabric, 0.01, 'stages sum to total');
  near(r.fiber_co2e_per_kg_fabric + r.processing.co2e_per_kg_fabric, r.total_co2e_per_kg_fabric, 0.01, 'fibre + processing = total');
  near(r.total_co2e_per_m2_fabric, r.total_co2e_per_kg_fabric * 0.2, 1e-3, 'per m2');
  const sc = r.scopes_if_integrated_mill; near(sc.scope1_fuel + sc.scope2_electricity + sc.scope3_other, r.total_co2e_per_kg_fabric, 0.01, 'scopes sum to total');
  const mb = r.mass_balance.per_kg_finished; assert(mb.grey_fabric_kg > 1 && mb.yarn_kg > mb.grey_fabric_kg && mb.fibre_kg > mb.yarn_kg, 'each stage upstream needs more mass');
  const d = r.data_quality.share_of_total_by_tier_pct; near(Object.values(d).reduce((a, b) => a + b, 0), 100, 0.2, 'tier shares sum to 100');
  console.log('  Stages, scopes, mass balance and data tiers all add up');
}

// 5. range is ordered and contains the central value; deterministic
{
  for (const p of [{ fibers: { cotton: 100 } }, { fibers: { polyester: 100 } }, { fibers: { wool: 100 } }, { fibers: { cotton: 95, elastane: 5 } }, { fibers: { tencel: 100 } }]) {
    const r = calc({ gsm: 180, shade: 'medium', ...p }), g = r.range;
    assert(g.low <= g.p5 && g.p5 <= g.p50 && g.p50 <= g.p95 && g.p95 <= g.high, 'range ordered: ' + JSON.stringify(g));
    assert(g.low <= g.central && g.central <= g.high);
    assert(g.p5 <= g.central && g.central <= g.p95, `central inside P5-P95 for ${JSON.stringify(p)}: ${JSON.stringify(g)}`);
  }
  assert.deepStrictEqual(calc({ gsm: 180, fibers: { cotton: 100 } }).range, calc({ gsm: 180, fibers: { cotton: 100 } }).range, 'same input, same range');
  console.log('  Range is ordered, contains the central value, and is reproducible');
}

// 6. physics responds the right way
{
  const base = { gsm: 180, fibers: { cotton: 100 }, shade: 'medium' };
  const b = calc(base);
  assert(calc({ ...base, shade: 'black' }).total_co2e_per_kg_fabric > b.total_co2e_per_kg_fabric, 'extra soaping for dark shades');
  assert(calc({ ...base, shade: 'white' }).wet_processing.baths.some(x => /Scour and bleach/.test(x.bath)), 'white is bleached');
  assert(calc({ ...base, gsm: 300 }).wet_processing.stenter_kwh_per_kg < b.wet_processing.stenter_kwh_per_kg, 'heavier fabric gives lower stenter kWh per kg');
  assert(calc({ ...base, boiler_fuel: 'coal' }).total_co2e_per_kg_fabric > b.total_co2e_per_kg_fabric, 'coal boiler emits more than gas');
  const bio = calc({ ...base, boiler_fuel: 'biomass' });
  assert(bio.total_co2e_per_kg_fabric < b.total_co2e_per_kg_fabric && bio.biogenic_co2_kg_per_kg_fabric > 0, 'biomass: fossil falls, biogenic reported');
  assert(calc({ ...base, country: 'india' }).total_co2e_per_kg_fabric > calc({ ...base, country: 'turkiye' }).total_co2e_per_kg_fabric, 'a dirtier grid gives a higher total');
  assert(calc({ ...base, process_loss_pct: 20 }).total_co2e_per_kg_fabric > b.total_co2e_per_kg_fabric, 'higher process loss needs more input mass');
  const poly = calc({ gsm: 180, fibers: { polyester: 100 }, shade: 'medium', dyeing_method: 'reactive' });
  assert.strictEqual(poly.wet_processing.dyeing_class, 'disperse');
  assert(poly.warnings.some(w => /disperse/i.test(w)), 'reactive on polyester is corrected and said');
  assert(poly.wet_processing.baths.some(x => x.temp_c === 130), 'disperse bath at 130 C');
  const pig = calc({ ...base, dyeing_method: 'pigment' });
  assert(pig.wet_processing.baths.length < b.wet_processing.baths.length, 'pigment skips the dye and soaping baths');
  assert(calc({ ...base, fabric_family: 'woven' }).stages.find(s => s.id === 'formation').name === 'Weaving');
  console.log('  Bath heat, drying, boiler fuel, grid, process loss and dye class all respond correctly');
}

// 7. primary data replaces the model and is labelled
{
  const base = { gsm: 180, fibers: { cotton: 100 }, shade: 'medium' };
  const m = calc(base), p = calc({ ...base, primary: { spinning_kwh_per_kg: 2.0 } });
  assert(p.stages.find(s => s.id === 'spinning').data_tier === 'PRIMARY');
  assert(p.stages.find(s => s.id === 'spinning').co2e_per_kg_fabric < m.stages.find(s => s.id === 'spinning').co2e_per_kg_fabric);
  const g = calc({ ...base, primary: { grid_ef_kg_per_kwh: 0.3 } });
  assert(g.total_co2e_per_kg_fabric < m.total_co2e_per_kg_fabric);
  console.log('  Primary meter data overrides the model and is labelled PRIMARY');
}

// 8. fibres: variants, blends, unmodelled, baseline
{
  const conv = calc({ gsm: 180, fibers: { cotton: 100 }, raw_composition: '100% Cotton' });
  assert.strictEqual(conv.vs_conventional_cotton_baseline.pct_difference, 0);
  const org = calc({ gsm: 180, fibers: { cotton: 100 }, raw_composition: '100% Organic Cotton' });
  assert(org.fiber_co2e_per_kg_fabric < conv.fiber_co2e_per_kg_fabric && org.fiber_breakdown[0].variant === 'organic' && org.vs_conventional_cotton_baseline.direction === 'lower');
  const v = calc({ gsm: 180, fibers: { polyester: 100 }, shade: 'medium' }), rc = calc({ gsm: 180, fibers: { polyester: 100 }, shade: 'medium', raw_composition: 'Recycled Polyester' });
  assert(rc.fiber_co2e_per_kg_fabric < v.fiber_co2e_per_kg_fabric * 0.5);
  const cff = calc({ gsm: 180, fibers: { polyester: 100 }, shade: 'medium', raw_composition: 'Recycled Polyester', recycled_method: 'cff' });
  assert(cff.fiber_co2e_per_kg_fabric > rc.fiber_co2e_per_kg_fabric && cff.fiber_co2e_per_kg_fabric < v.fiber_co2e_per_kg_fabric, 'CFF sits between cut-off and virgin');
  const blend = calc({ gsm: 200, fibers: { cotton: 60, polyester: 35, elastane: 5 } });
  const mass = blend.mass_balance.per_kg_finished.fibre_kg;
  const sum = M.FIBRES.cotton.central * 0.6 + M.FIBRES.polyester.central * 0.35 + M.FIBRES.elastane.central * 0.05;
  near(blend.fiber_co2e_per_kg_fabric, sum * mass, 0.01, 'blend weighting × fibre mass');
  const silk = calc({ gsm: 180, fibers: { cotton: 80, silk: 20 } });
  assert(silk.warnings.some(w => /understates/i.test(w)) && silk.fiber_breakdown.find(f => f.fiber === 'silk').modeled === false);
  assert(calc({ gsm: 180, fibers: { cotton: 100 } }).alternative_dataset.total_co2e_per_kg_fabric > conv.total_co2e_per_kg_fabric, 'the second dataset family is higher for cotton');
  console.log('  Variants, CFF, blends, unmodelled fibres and the baseline behave');
}

// 9. transport and garment
{
  const base = { gsm: 180, fibers: { cotton: 100 }, shade: 'medium' };
  const sea = calc({ ...base, transport: [{ mode: 'sea', km: 8000 }] }), air = calc({ ...base, transport: [{ mode: 'air_long', km: 8000 }] });
  near(sea.stages.find(s => s.id === 'transport').co2e_per_kg_fabric, 8000 * 0.015 / 1000, 0.001, 'sea tonne-km');
  assert(air.total_co2e_per_kg_fabric > sea.total_co2e_per_kg_fabric + 4, 'air is far worse than sea');
  const g = calc({ ...base, garment_weight_g: 180, thread_g: 5, polybag_g: 8 });
  near(g.per_garment.fabric_kg_consumed, 0.18 / (1 - 0.125), 1e-3, 'cut waste');
  near(g.per_garment.total_co2e_kg, g.per_garment.fabric_kg_consumed * g.total_co2e_per_kg_fabric + 0.005 * 2.58 + 0.008 * 2.96, 0.002, 'garment total');
  assert.strictEqual(calc(base).per_garment, null);
  console.log('  Transport legs and garment cut-waste, thread and polybag add correctly');
}

// 10. unknown country falls back loudly; every country has a note
{
  const r = calc({ gsm: 180, fibers: { cotton: 100 }, country: 'narnia' });
  assert(r.warnings.some(w => /narnia/i.test(w) && /Bangladesh/i.test(w)));
  assert.strictEqual(r.processing.grid_emission_factor_kg_co2_per_kwh, M.GRID.bangladesh.central);
  for (const c of Object.keys(M.GRID)) { const x = calc({ gsm: 180, fibers: { cotton: 100 }, country: c }); assert(x.success && x.processing.grid_factor_source); }
  assert(calc({ gsm: 180, fibers: { cotton: 100 }, country: 'pakistan' }).warnings.some(w => /not an official figure/i.test(w)));
  console.log('  Unknown country falls back with a warning; every modelled country carries its source note');
}

// 11. factor tables are well formed (this is what a future update must keep true)
{
  const tri = (t, name) => { assert(Number.isFinite(t.low) && Number.isFinite(t.central) && Number.isFinite(t.high), name + ' numeric'); assert(t.tier, name + ' has a tier'); };
  for (const [k, t] of Object.entries(M.FIBRES)) { tri(t, 'fibre ' + k); assert(t.low <= t.central && t.central <= t.high, 'fibre order ' + k); }
  for (const [k, t] of Object.entries(M.GRID)) { tri(t, 'grid ' + k); assert(t.low <= t.central && t.central <= t.high, 'grid order ' + k); }
  for (const t of [M.MILL.spinning_kwh_per_kg, M.MILL.knit_kwh_per_kg, M.MILL.weave_kwh_per_kg, M.LIQUOR_RATIO, M.BOILER.plant_overhead, ...Object.values(M.MILL.spin_waste)]) tri(t, 'mill');
  for (const t of Object.values(M.TRANSPORT)) tri(t, 'transport');
  assert(M.FACTOR_SET.version);
  console.log('  Every factor is a {low, central, high} triple with a tier and a version');
}

// 12. detectVariant
{
  assert.strictEqual(detectVariant('cotton', '100% BCI Cotton').key, 'organic');
  assert.strictEqual(detectVariant('cotton', '95% Cotton 5% Elastane'), null);
  assert.strictEqual(detectVariant('polyester', 'Recycled Polyester 100%').key, 'recycled');
  assert.strictEqual(detectVariant('viscose', 'Organic Viscose'), null);
  console.log('  Variant detection correct, no false positives');
}

console.log('\nAll Carbon Footprint Engine Tests Passed!');
