/**
 * KnitAdvisor — Carbon Footprint Engine (v2, stage-based)
 * =======================================================
 *
 * Cradle-to-gate CO2e of 1 kg of FINISHED fabric, built stage by stage from the
 * same specification the rest of the engine already solved:
 *
 *   fibre → spinning → knitting / weaving → wet processing → finishing
 *                                                         (→ transport → garment)
 *
 * WHAT MAKES IT AN ENGINE RATHER THAN A LOOKUP
 *  - MASS BALANCE.  The kilogram of finished fabric needs more grey fabric
 *    (wet-processing loss), more yarn (formation loss) and more fibre
 *    (spinning waste). Each stage's energy is charged on the mass that
 *    actually passes through it.
 *  - PHYSICS.  Wet-processing heat is not a flat 16 kWh: baths are heated from
 *    feed water (Q = L·cp·ΔT), fabric is dried by evaporating the water it
 *    carries (latent heat 2257 kJ/kg ÷ dryer efficiency), steam comes from a
 *    boiler of stated efficiency burning a stated fuel. Electricity and fuel are
 *    separate, because a kWh of steam heat and a kWh of grid power do not emit
 *    alike.
 *  - RANGES.  Every uncertain input is {low, central, high}. The engine reports
 *    the deterministic central value, the all-low and all-high bounds, a seeded
 *    Monte-Carlo P5/P50/P95, and a one-at-a-time tornado so a reader can see
 *    which assumption the answer actually hangs on.
 *  - PRIMARY DATA.  A mill's own meter readings (params.primary) replace the
 *    modelled figure for that stage and are labelled PRIMARY.
 *  - NO FALSE PRECISION.  The output is a screening estimate with a range. It
 *    is not a certified LCA, and says what it leaves out.
 *
 * Pure function: no DB, no network. All figures live in catalog/carbon-model.js.
 */
'use strict';

const M = require('../catalog/carbon-model');

const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const r4 = v => Math.round(v * 10000) / 10000;

// ── helpers ─────────────────────────────────────────────────────────────
function detectVariant(fiberKey, rawText) {
  const text = String(rawText || '').toLowerCase();
  const v = M.VARIANTS[fiberKey];
  if (!v) return null;
  if (v.organic && /organic|bci|ic-?2|cmia|bio\s*cotton/.test(text)) return { key: 'organic', multiplier: v.organic.mult, alt: v.organic.alt, note: v.organic.note, confidence: 'ESTIMATED' };
  if (v.recycled && /recycl|re-?cycled|regenerated|rpet/.test(text)) return { key: 'recycled', multiplier: v.recycled.mult, alt: v.recycled.alt, note: v.recycled.note, confidence: 'ESTIMATED' };
  return null;
}

function shadeClass(s) {
  const t = String(s || '').toLowerCase();
  if (/white|ecru|optic|bleach/.test(t)) return 'white';
  if (/black/.test(t)) return 'black';
  if (/dark|navy|deep/.test(t)) return 'dark';
  if (/pastel|light/.test(t)) return 'light';
  return 'medium';
}
function spinClass(sys, fibresPoly) {
  const t = String((sys && (sys.id || sys.label || sys.name)) || sys || '').toLowerCase();
  if (/comb/.test(t)) return 'combed';
  if (/open|rotor|\boe\b/.test(t)) return 'open_end';
  if (fibresPoly >= 0.9) return 'synthetic';
  return 'carded';
}

// seeded RNG so the same specification always gives the same range
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function tri(rnd, lo, c, hi) {
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  if (b - a < 1e-12) return c;
  const u = rnd(), f = (c - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

// ── input normalisation ─────────────────────────────────────────────────
function normalise(p) {
  const warnings = [];
  const gsm = parseFloat(p.gsm);
  if (!Number.isFinite(gsm) || gsm <= 0) return { error: 'gsm is required (fabric weight per square meter — it sets stenter throughput and the per-m² figure).' };

  let fibres = (p.fibers && Object.keys(p.fibers).length) ? p.fibers : { cotton: 100 };
  if (!p.fibers) warnings.push('No composition supplied — assuming 100% cotton.');
  const total = Object.values(fibres).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  if (total <= 0) return { error: 'Composition percentages must sum to more than 0.' };
  const share = {};
  for (const [k, v] of Object.entries(fibres)) { const x = (parseFloat(v) || 0) / total; if (x > 0) share[k] = x; }

  const cell = ['cotton', 'viscose', 'tencel', 'modal', 'linen'].reduce((s, k) => s + (share[k] || 0), 0);
  const poly = share.polyester || 0;

  const family = /woven/i.test(p.fabric_family || '') ? 'woven' : 'knit';
  const shade = shadeClass(p.shade);
  const route = (p.process_route || []).join(' | ').toLowerCase();

  let method = String(p.dyeing_method || '').toLowerCase();
  if (!['reactive', 'pigment', 'disperse', 'garment_wash'].includes(method)) method = poly >= 0.5 ? 'disperse' : 'reactive';
  if (method === 'reactive' && poly >= 0.5) { method = 'disperse'; warnings.push('The composition is mostly polyester, so disperse dyeing at 130 °C is assumed instead of reactive.'); }

  const country = M.COUNTRY_ALIASES[String(p.country || 'bangladesh').toLowerCase()] || String(p.country || 'bangladesh').toLowerCase();
  let gridKey = M.GRID[country] ? country : 'bangladesh';
  if (!M.GRID[country]) warnings.push(`No grid factor for "${p.country}" — Bangladesh's was used. Supply primary.grid_ef_kg_per_kwh for a real figure.`);
  if (M.GRID[gridKey].verified === 'none') warnings.push(`The grid factor for ${gridKey} is a range from project and academic estimates, not an official figure.`);

  const fuel = M.FUELS[p.boiler_fuel] ? p.boiler_fuel : 'natural_gas';
  const lossPct = Number.isFinite(parseFloat(p.process_loss_pct)) ? parseFloat(p.process_loss_pct) : 12.5;

  const flags = {
    bleach: shade === 'white' || shade === 'light' || /bleach/.test(route),
    heat_set: poly > 0.1 || /heat-?set/.test(route) || !!p.heat_set,
    mercerise: /mercer/.test(route) || /mercer/i.test(String(p.finishing || '')) || !!p.mercerised,
    brushed: /brush|fleece|raise|peach|napp/i.test(String(p.finishing || '') + ' ' + String(p.surface || '') + ' ' + route) || !!p.brushed,
  };

  return {
    warnings, gsm, share, cell, poly, family, shade, method, country: gridKey, fuel, lossPct, flags,
    raw: p.raw_composition || '', spinSys: spinClass(p.spinning_system, poly),
    primary: p.primary || {}, recycledMethod: p.recycled_method === 'cff' ? 'cff' : 'cutoff', cffA: Math.min(0.8, Math.max(0.2, parseFloat(p.cff_a) || 0.5)),
    transport: Array.isArray(p.transport) ? p.transport : [],
    garment: p.garment_weight_g ? { g: parseFloat(p.garment_weight_g), thread_g: parseFloat(p.thread_g) || 0, polybag_g: parseFloat(p.polybag_g) || 0, cut: p.cut_waste_pct != null ? parseFloat(p.cut_waste_pct) / 100 : null } : null,
  };
}

// ── the model: one pass for a given way of choosing each uncertain value ─
// pick(key, tri) returns the value to use for that input.
function run(inp, pick, opts = {}) {
  const P = inp.primary;
  const SC = inp.sc || {};                         // a reduction lever's settings; {} for the base case
  const val = (key, t, primaryKey) => (primaryKey && Number.isFinite(parseFloat(P[primaryKey]))) ? parseFloat(P[primaryKey]) : pick(key, t);
  const usedPrimary = new Set();
  const mark = (stage, primaryKey) => { if (primaryKey && Number.isFinite(parseFloat(P[primaryKey]))) usedPrimary.add(stage); };

  const gridTri = M.GRID[inp.country];
  const grid = val('grid', gridTri, 'grid_ef_kg_per_kwh');
  // the mill's own electricity (knitting, dyeing, finishing) can be partly solar; the spinner's cannot
  const solar = Math.min(0.9, Math.max(0, SC.solar_share || 0));
  const gridMill = grid * (1 - solar) + M.PV_EF * solar;
  const fuelEf = (Number.isFinite(parseFloat(P.fuel_ef_kg_per_kwh)) ? parseFloat(P.fuel_ef_kg_per_kwh) : M.FUELS[inp.fuel].ef);

  // mass flow per 1 kg finished
  const wetLoss = Math.min(0.5, Math.max(0, inp.lossPct / 100));
  const grey = 1 / (1 - wetLoss);
  const formLoss = val('formation_loss', M.MILL.formation_loss);
  const yarn = grey / (1 - formLoss);
  // natural fibres lose what the spinning system loses; synthetic staple loses little.
  const synShare = ['polyester', 'nylon', 'acrylic', 'elastane'].reduce((a, k) => a + (inp.share[k] || 0), 0);
  const natSys = inp.spinSys === 'synthetic' ? 'carded' : inp.spinSys;
  const spinWaste = (1 - synShare) * (synShare < 1 ? val('spin_waste', M.MILL.spin_waste[natSys]) : 0)
                  + synShare * val('spin_waste_syn', M.MILL.spin_waste.synthetic);
  const fibreKg = yarn / (1 - spinWaste);

  // fibre
  let fibreEf = 0; const fibreRows = []; let unmodeled = false;
  for (const [f, s] of Object.entries(inp.share)) {
    if (M.UNMODELED.includes(f) || !M.FIBRES[f]) { unmodeled = true; fibreRows.push({ fiber: f, share: s, modeled: false }); continue; }
    const t = M.FIBRES[f];
    const variant = detectVariant(f, inp.raw);
    const hasOverride = P.fibre_ef && Number.isFinite(parseFloat(P.fibre_ef[f]));
    let ev;
    if (hasOverride) { ev = parseFloat(P.fibre_ef[f]); usedPrimary.add('fibre'); }
    else if (opts.altFibre) ev = variant ? variant.alt : t.alt;
    else {
      ev = pick('fibre:' + f, t);
      if (variant) {
        if (variant.key === 'recycled' && inp.recycledMethod === 'cff') ev = inp.cffA * (ev * variant.multiplier) + (1 - inp.cffA) * ev;
        else ev = ev * variant.multiplier;
      }
    }
    fibreEf += s * ev;
    fibreRows.push({ fiber: f, share: s, variant: variant ? variant.key : null, ef: ev, modeled: true, note: variant ? variant.note : t.note, tier: hasOverride ? 'PRIMARY' : t.tier });
  }
  const fibreCo2 = fibreKg * fibreEf;

  // spinning
  const spinKwh = val('spin_kwh', M.MILL.spinning_kwh_per_kg, 'spinning_kwh_per_kg'); mark('spinning', 'spinning_kwh_per_kg');
  const spinCo2 = yarn * spinKwh * grid;

  // formation
  const formT = inp.family === 'woven' ? M.MILL.weave_kwh_per_kg : M.MILL.knit_kwh_per_kg;
  const formKwh = val('form_kwh', formT, 'formation_kwh_per_kg'); mark('formation', 'formation_kwh_per_kg');
  const formCo2 = grey * formKwh * gridMill;

  // wet processing — bath heat
  const lr = SC.lr || val('liquor_ratio', M.LIQUOR_RATIO);
  const feedC = SC.feed_water_c || M.PHYS.feed_water_c;
  const seq = []; const f = inp.flags;
  seq.push(f.bleach ? 'scour_bleach' : 'scour', 'hot_rinse');
  if (f.bleach) seq.push('neutralise');
  if (f.mercerise) seq.push('merc_wash');
  if (inp.method !== 'pigment') {
    const dyed = inp.shade !== 'white';
    if (inp.poly >= 0.1) {
      seq.push(dyed ? 'disperse_dye' : 'oba', 'warm_rinse');
      if (dyed && inp.shade !== 'light') seq.push('reduction', 'warm_rinse');
    }
    if (inp.cell >= 0.1 || inp.poly < 0.1) {
      seq.push(dyed ? 'reactive_dye' : 'oba', 'neutralise', 'soap');
      if (inp.shade === 'dark' || inp.shade === 'black') seq.push('soap');
      seq.push('warm_rinse');
    }
  }
  let bathKwhTh = 0; const bathList = [];
  for (const b of seq) {
    const name = M.BATHS[b][0], T = (SC.temps && SC.temps[b]) || M.BATHS[b][1];
    const q = lr * M.PHYS.cp_water_kj_per_kg_k * Math.max(0, T - feedC) / 3600;
    bathKwhTh += q; bathList.push({ bath: name, temp_c: T, kwh_th_per_kg: r3(q) });
  }
  const boilerEff = SC.boiler_eff ? Math.max(SC.boiler_eff, val('boiler_eff', M.BOILER.efficiency, 'boiler_efficiency')) : val('boiler_eff', M.BOILER.efficiency, 'boiler_efficiency');
  const overhead = SC.overhead ? Math.min(SC.overhead, val('plant_overhead', M.BOILER.plant_overhead)) : val('plant_overhead', M.BOILER.plant_overhead);
  const primaryThermal = Number.isFinite(parseFloat(P.wet_thermal_fuel_kwh_per_kg));
  if (primaryThermal) usedPrimary.add('wet_processing'), usedPrimary.add('finishing');
  const fuelPerThermal = (1 / boilerEff) * overhead;
  const bathFuelKwh = primaryThermal ? parseFloat(P.wet_thermal_fuel_kwh_per_kg) * grey * 0.6 : bathKwhTh * grey * fuelPerThermal;
  let bathCo2 = bathFuelKwh * fuelEf;

  // chemicals with a published factor
  const chem = [];
  const chemUse = (k) => val('chem:' + k, M.CHEMICALS[k].use);
  if (f.bleach) chem.push(['h2o2_50', chemUse('h2o2_50')]);
  chem.push(['naoh_50', chemUse('naoh_50')]);
  if (f.mercerise) chem.push(['naoh_merc', chemUse('naoh_merc')]);
  let chemCo2 = 0; const chemList = [];
  for (const [k, use] of chem) { const c = use * M.CHEMICALS[k].ef * grey; chemCo2 += c; chemList.push({ chemical: M.CHEMICALS[k].label, kg_per_kg_grey: r3(use), co2e: r4(c) }); }

  // drying and finishing — thermal
  const latentKwh = M.PHYS.latent_heat_kj_per_kg / 3600;
  const dEff = SC.dry_eff ? Math.max(SC.dry_eff, val('dry_eff', M.DRYING.efficiency)) : val('dry_eff', M.DRYING.efficiency);
  const w1 = SC.pickup_hydro ? Math.min(SC.pickup_hydro, val('pickup_hydro', M.DRYING.pickup_hydro)) : val('pickup_hydro', M.DRYING.pickup_hydro);
  const w2 = SC.pickup_pad ? Math.min(SC.pickup_pad, val('pickup_pad', M.DRYING.pickup_pad)) : val('pickup_pad', M.DRYING.pickup_pad);
  let dryKwhTh = (w1 + w2) * latentKwh / dEff;
  if (f.heat_set) dryKwhTh += val('heat_set', M.DRYING.heat_set_kwh_th_per_kg);
  if (inp.method === 'pigment') dryKwhTh += val('cure', M.DRYING.cure_kwh_th_per_kg);
  const dryFuelKwh = primaryThermal ? parseFloat(P.wet_thermal_fuel_kwh_per_kg) * 0.4 : dryKwhTh * fuelPerThermal;
  const dryCo2 = dryFuelKwh * fuelEf;

  // wet-processing electricity
  const dyeElec = val('dye_elec', M.ELECTRIC.dye_machine_kwh_per_kg, 'wet_electricity_kwh_per_kg'); mark('wet_processing', 'wet_electricity_kwh_per_kg');
  const stP = val('stenter_p', M.ELECTRIC.stenter_power_kw), stV = val('stenter_v', M.ELECTRIC.stenter_speed_m_min), stW = M.ELECTRIC.stenter_width_m.central;
  const stenterKwh = stP / (stV * 60 * stW * inp.gsm / 1000);          // kW ÷ kg/h
  const anc = val('anc_elec', M.ELECTRIC.ancillary_kwh_per_kg) + (f.brushed ? val('brush_elec', M.ELECTRIC.brushing_kwh_per_kg) : 0);
  const wetElecCo2 = grey * dyeElec * gridMill;
  const finElecCo2 = (stenterKwh + anc) * gridMill;

  // transport
  let transCo2 = 0; const legs = [];
  for (const leg of inp.transport) {
    const t = M.TRANSPORT[leg.mode]; const km = parseFloat(leg.km);
    if (!t || !(km > 0)) continue;
    const ef = pick('transport:' + leg.mode, t);
    const c = km * ef / 1000;                                             // per kg
    transCo2 += c; legs.push({ mode: leg.mode, km, co2e: r4(c) });
  }

  const biogenic = (M.FUELS[inp.fuel].biogenic || 0) * (bathFuelKwh + dryFuelKwh);
  const elecKwh = yarn * spinKwh + grey * formKwh + grey * dyeElec + stenterKwh + anc;
  const fuelKwh = bathFuelKwh + dryFuelKwh;

  const stages = [
    { id: 'fibre',      name: 'Fibre production',        co2e: fibreCo2, scope: 'Scope 3 · purchased fibre', tier: usedPrimary.has('fibre') ? 'PRIMARY' : 'SOURCED' },
    { id: 'spinning',   name: 'Spinning',                co2e: spinCo2,  scope: 'Scope 2 · electricity',     tier: usedPrimary.has('spinning') ? 'PRIMARY' : 'SOURCED', kwh_elec: yarn * spinKwh },
    { id: 'formation',  name: inp.family === 'woven' ? 'Weaving' : 'Knitting', co2e: formCo2, scope: 'Scope 2 · electricity', tier: usedPrimary.has('formation') ? 'PRIMARY' : (inp.family === 'woven' ? 'MODELLED' : 'SOURCED'), kwh_elec: grey * formKwh },
    { id: 'wet',        name: 'Pre-treatment and dyeing', co2e: bathCo2 + chemCo2 + wetElecCo2, scope: 'Scope 1 fuel · Scope 2 electricity', tier: usedPrimary.has('wet_processing') ? 'PRIMARY' : 'MODELLED', kwh_fuel: bathFuelKwh, kwh_elec: grey * dyeElec },
    { id: 'finishing',  name: 'Drying and finishing',     co2e: dryCo2 + finElecCo2, scope: 'Scope 1 fuel · Scope 2 electricity', tier: usedPrimary.has('finishing') ? 'PRIMARY' : 'MODELLED', kwh_fuel: dryFuelKwh, kwh_elec: stenterKwh + anc },
  ];
  if (transCo2 > 0) stages.push({ id: 'transport', name: 'Transport', co2e: transCo2, scope: 'Scope 3 · freight', tier: 'SOURCED' });

  const total = stages.reduce((s, x) => s + x.co2e, 0);
  const scope1 = (bathFuelKwh + dryFuelKwh) * fuelEf;
  const scope2 = yarn * spinKwh * grid + (grey * formKwh + grey * dyeElec + stenterKwh + anc) * gridMill;
  return {
    total, stages, fibreRows, fibreCo2, fibreEf, unmodeled,
    mass: { finished_kg: 1, grey_kg: grey, yarn_kg: yarn, fibre_kg: fibreKg, wet_loss: wetLoss, formation_loss: formLoss, spin_waste: spinWaste },
    energy: { elec_kwh: elecKwh, fuel_kwh: fuelKwh, thermal_kwh_th: bathKwhTh * grey + dryKwhTh, grid, fuel_ef: fuelEf, boiler_eff: boilerEff, overhead },
    detail: { spinKwh, formKwh, grid, gridMill, solar, lr, feedC, fuelPerThermal, bathFuelKwh, dryFuelKwh, dryKwhTh, w1, w2, dEff, dyeElec, stenterKwh, anc, chemCo2, bathCo2, dryCo2, fuelEf, n_baths: seq.length },
    wet: { liquor_ratio: lr, baths: bathList, bath_kwh_th_per_kg: bathKwhTh, drying_kwh_th_per_kg: dryKwhTh, drying_efficiency: dEff, water_evaporated_kg: w1 + w2, stenter_kwh_per_kg: stenterKwh, chemicals: chemList },
    transport: legs, biogenic,
    scopes: { scope1, scope2, scope3: total - scope1 - scope2 },
  };
}

const KEYS_GROUP = {
  'Fibre emission factor': k => k.startsWith('fibre:'),
  'Grid emission factor': k => k === 'grid',
  'Spinning energy and waste': k => k === 'spin_kwh' || k.startsWith('spin_waste'),
  'Knitting / weaving energy': k => k === 'form_kwh' || k === 'formation_loss',
  'Bath heating (liquor ratio)': k => k === 'liquor_ratio',
  'Drying and heat-setting': k => ['dry_eff', 'pickup_hydro', 'pickup_pad', 'heat_set', 'cure'].includes(k),
  'Boiler efficiency and plant losses': k => k === 'boiler_eff' || k === 'plant_overhead',
  'Machine electricity': k => ['dye_elec', 'stenter_p', 'stenter_v', 'anc_elec', 'brush_elec'].includes(k),
  'Chemicals': k => k.startsWith('chem:'),
};

function estimate(inp) {
  const central = run(inp, (k, t) => t.central);
  const low = run(inp, (k, t) => t.low);
  const high = run(inp, (k, t) => t.high);

  // tornado: one group at its low and high, everything else central
  const tornado = Object.entries(KEYS_GROUP).map(([name, match]) => {
    const lo = run(inp, (k, t) => match(k) ? t.low : t.central).total;
    const hi = run(inp, (k, t) => match(k) ? t.high : t.central).total;
    return { driver: name, low: lo, high: hi, swing: Math.abs(hi - lo) };
  }).filter(t => t.swing > 1e-6).sort((a, b) => b.swing - a.swing);

  // Monte Carlo, triangular(low, central, high), seeded by the specification
  const seed = Math.floor(inp.gsm * 7 + Object.keys(inp.share).join('').length * 131 + inp.lossPct * 17 + (inp.country.length * 97));
  const rnd = mulberry32(seed);
  const N = 2000, xs = new Array(N);
  for (let i = 0; i < N; i++) xs[i] = run(inp, (k, t) => tri(rnd, t.low, t.central, t.high)).total;
  xs.sort((a, b) => a - b);
  const pct = q => xs[Math.min(N - 1, Math.max(0, Math.round(q * (N - 1))))];

  const alt = run(inp, (k, t) => t.central, { altFibre: true });
  const fuels = {};
  for (const fk of Object.keys(M.FUELS)) fuels[fk] = r2(run({ ...inp, fuel: fk }, (k, t) => t.central).total);
  return { central, low, high, tornado, mc: { p5: pct(0.05), p50: pct(0.5), p95: pct(0.95), n: N }, alt, fuels };
}

// ── reduction levers: the same model re-run with one change ────────────
const central = (k, t) => t.central;
function withLever(inp, L) {
  const x = { ...inp, sc: { ...(inp.sc || {}) } };
  const set = L.set || {};
  for (const k of ['feed_water_c', 'lr', 'boiler_eff', 'overhead', 'pickup_hydro', 'pickup_pad', 'dry_eff', 'solar_share']) if (set[k] != null) x.sc[k] = set[k];
  if (set.temps) x.sc.temps = { ...(x.sc.temps || {}), ...set.temps };
  if (set.loss_delta) x.lossPct = Math.max(2, inp.lossPct + set.loss_delta);
  if (set.fuel) x.fuel = set.fuel;
  if (L.variant) x.raw = (inp.raw || '') + (L.variant === 'organic' ? ' organic cotton' : ' recycled polyester');
  return x;
}
function leverApplies(inp, id, L) {
  if (L.only_from && !L.only_from.includes(inp.fuel)) return false;
  if (L.fibre) {
    if (!(inp.share[L.fibre] > 0)) return false;
    const v = detectVariant(L.fibre, inp.raw);
    if (v && v.key === L.variant) return false;                  // already sourced that way
  }
  if (id === 'low_liquor' && M.LIQUOR_RATIO.central <= (L.set.lr + 0.5)) return false;
  if (id === 'rft' && inp.lossPct <= 5) return false;
  return true;
}
const MILL_PATH = ['heat_recovery', 'low_liquor', 'steam', 'dewater', 'stenter', 'low_temp', 'solar', 'rft', 'fuel_gas'];
const FIBRE_PATH = ['organic_cotton', 'recycled_poly'];
function combine(inp, ids) {
  let x = inp;
  for (const id of ids) { const L = M.LEVERS[id]; if (L && leverApplies(inp, id, L)) x = withLever(x, L); }
  return x;
}
function levers(inp, base) {
  const rows = [];
  for (const [id, L] of Object.entries(M.LEVERS)) {
    if (!leverApplies(inp, id, L)) continue;
    const r = run(withLever(inp, L), central);
    const saving = base.total - r.total;
    if (saving < 0.005) continue;
    const water = (base.detail.n_baths * base.detail.lr * base.mass.grey_kg) - (r.detail.n_baths * r.detail.lr * r.mass.grey_kg);
    rows.push({
      id, name: L.name, how: L.how, change: L.change, note: L.note || null, capex: L.capex, tier: 'MODELLED',
      kind: L.fibre ? 'fibre' : /^fuel_/.test(id) ? 'fuel' : 'mill',
      new_total: r2(r.total), saving_kg_per_kg: r3(saving), saving_pct: r2(saving / base.total * 100),
      saving_kg_per_tonne: Math.round(saving * 1000), saving_g_per_tshirt: Math.round(saving * M.EQUIVALENTS.tshirt_fabric_kg * 1000),
      fuel_kwh_saved_per_kg: r3(base.energy.fuel_kwh - r.energy.fuel_kwh), elec_kwh_saved_per_kg: r3(base.energy.elec_kwh - r.energy.elec_kwh),
      water_l_saved_per_kg: water > 0.05 ? r2(water) : 0,
    });
  }
  rows.sort((a, b) => b.saving_kg_per_kg - a.saving_kg_per_kg);
  const mill = run(combine(inp, MILL_PATH), central), all = run(combine(combine(inp, MILL_PATH), FIBRE_PATH), central);
  const used = (ids) => ids.filter(id => rows.some(r => r.id === id));
  return {
    levers: rows,
    pathway: {
      now: r2(base.total),
      best_practice_mill: { total: r2(mill.total), cut_pct: r2((base.total - mill.total) / base.total * 100), levers: used(MILL_PATH) },
      plus_preferred_fibre: { total: r2(all.total), cut_pct: r2((base.total - all.total) / base.total * 100), levers: used(MILL_PATH.concat(FIBRE_PATH)) },
      note: 'Each step re-runs the whole model with the levers together, so savings that overlap (less water also means less heat) are not counted twice.',
    },
  };
}

// ── benchmark: where this fabric sits among typical fabrics modelled the same way ─
const COHORT = new Map();
const COHORT_FIBRES = [{ cotton: 100 }, { cotton: 95, elastane: 5 }, { cotton: 60, polyester: 40 }, { cotton: 35, polyester: 65 }, { polyester: 100 }, { viscose: 95, elastane: 5 }];
const COHORT_SHADES = ['white', 'light', 'medium', 'dark', 'black'];
function cohort(country, family, fuel) {
  const key = country + '|' + family + '|' + fuel;
  if (COHORT.has(key)) return COHORT.get(key);
  const xs = [];
  for (const fibers of COHORT_FIBRES) for (const shade of COHORT_SHADES) for (const gsm of [140, 160, 180, 200, 240, 280]) {
    const n = normalise({ gsm, fibers, shade, country, boiler_fuel: fuel, fabric_family: family });
    if (!n.error) xs.push(run(n, central).total);
  }
  xs.sort((a, b) => a - b);
  COHORT.set(key, xs);
  return xs;
}
function grade(inp, total) {
  const xs = cohort(inp.country, inp.family, inp.fuel);
  const higher = xs.filter(v => v > total + 1e-9).length;          // fabrics with a higher footprint
  const pctLower = xs.length ? higher / xs.length * 100 : null;
  const rank = 100 - pctLower;                                      // 0 = cleanest
  const letter = rank <= 20 ? 'A' : rank <= 40 ? 'B' : rank <= 60 ? 'C' : rank <= 80 ? 'D' : 'E';
  return { letter, lower_than_pct: r2(pctLower), cohort_n: xs.length, cohort_median: r2(xs[Math.floor(xs.length / 2)]),
    cohort: `${xs.length} typical ${inp.family} fabrics (cotton, cotton-elastane, CVC, PC, polyester, viscose; white to black; 140-280 GSM) made in ${inp.country} with the same boiler fuel, run through this same model`,
    scale: 'A = cleanest fifth · B · C · D · E = heaviest fifth' };
}

// ── the working, step by step, with the numbers in ─────────────────────
function calcSteps(inp, c) {
  const d = c.detail, m = c.mass, f = (v, n = 3) => Number(v).toFixed(n);
  const fibreTxt = c.fibreRows.filter(x => x.modeled).map(x => `${Math.round(x.share * 100)}% ${x.fiber} × ${f(x.ef, 2)}`).join(' + ');
  const wetElec = (m.grey_kg * d.dyeElec + d.stenterKwh + d.anc);
  const extraDry = c.wet.drying_kwh_th_per_kg - (d.w1 + d.w2) * 2257 / 3600 / d.dEff;
  return [
    { n: 1, title: 'Mass balance: what 1 kg of finished fabric starts as',
      formula: `grey = 1 ÷ (1 − ${f(m.wet_loss)}) = ${f(m.grey_kg)} kg · yarn = grey ÷ (1 − ${f(m.formation_loss)}) = ${f(m.yarn_kg)} kg · fibre = yarn ÷ (1 − ${f(m.spin_waste)}) = ${f(m.fibre_kg)} kg`,
      result: null },
    { n: 2, title: 'Fibre production', formula: `${f(m.fibre_kg)} kg fibre × (${fibreTxt}) kg CO2e per kg`, result: r3(c.fibreCo2) },
    { n: 3, title: 'Spinning electricity', formula: `${f(m.yarn_kg)} kg yarn × ${f(d.spinKwh, 2)} kWh/kg × ${f(d.grid)} kg CO2/kWh grid`, result: r3(c.stages[1].co2e) },
    { n: 4, title: (inp.family === 'woven' ? 'Weaving' : 'Knitting') + ' electricity', formula: `${f(m.grey_kg)} kg grey × ${f(d.formKwh, 2)} kWh/kg × ${f(d.gridMill)} kg CO2/kWh`, result: r3(c.stages[2].co2e) },
    { n: 5, title: 'Heating the baths (physics)', formula: `Σ over ${d.n_baths} baths: liquor ${f(d.lr, 1)} kg × 4.186 kJ/kg·K × (bath °C − ${d.feedC} °C) ÷ 3600 = ${f(c.wet.bath_kwh_th_per_kg)} kWh heat per kg grey · × ${f(m.grey_kg)} kg ÷ boiler ${f(c.energy.boiler_eff, 2)} × steam losses ${f(c.energy.overhead, 2)} = ${f(d.bathFuelKwh)} kWh fuel × ${f(d.fuelEf)} kg CO2/kWh`, result: r3(d.bathCo2) },
    { n: 6, title: 'Drying (physics)', formula: `${f(d.w1 + d.w2, 2)} kg water to evaporate × 2257 kJ/kg ÷ 3600 ÷ dryer efficiency ${f(d.dEff, 2)}${extraDry > 1e-6 ? ` + ${f(extraDry)} heat-set or cure` : ''} = ${f(d.dryKwhTh)} kWh heat → ${f(d.dryFuelKwh)} kWh fuel × ${f(d.fuelEf)}`, result: r3(d.dryCo2) },
    { n: 7, title: 'Dyeing and finishing electricity', formula: `(${f(m.grey_kg)} × ${f(d.dyeElec, 2)} dyeing machine + ${f(d.stenterKwh)} stenter at ${inp.gsm} GSM + ${f(d.anc, 2)} other) kWh × ${f(d.gridMill)}`, result: r3(wetElec * d.gridMill) },
    { n: 8, title: 'Process chemicals (peroxide, caustic)', formula: 'kg used per kg grey × published factor per kg of chemical', result: r3(d.chemCo2) },
    { n: 9, title: 'Total', formula: 'the sum of the stages above' + (c.transport.length ? ' plus the transport legs' : ''), result: r3(c.total) },
  ];
}

/**
 * @param {object} params
 *   fibers, raw_composition, gsm (required)
 *   fabric_family       'knit' | 'woven'
 *   shade, dyeing_method, process_route[], finishing, surface, process_loss_pct
 *   spinning_system, country, boiler_fuel
 *   transport:[{mode,km}], garment_weight_g, thread_g, polybag_g, cut_waste_pct
 *   primary:{ spinning_kwh_per_kg, formation_kwh_per_kg, wet_electricity_kwh_per_kg,
 *             wet_thermal_fuel_kwh_per_kg, grid_ef_kg_per_kwh, boiler_efficiency, fibre_ef:{cotton:..} }
 */
function calculateCarbonFootprint(params = {}) {
  const inp = normalise(params);
  if (inp.error) return { success: false, error: inp.error };
  const warnings = inp.warnings.slice();

  const E = estimate(inp);
  const c = E.central;
  if (c.unmodeled) warnings.push('One or more fibres in the blend have no sourced emission factor and are excluded, so the total understates the true figure.');
  if (inp.share.elastane) warnings.push('Elastane is modelled as a blended fibre; it is usually a small share of the mass.');

  const total = c.total;
  const shareOf = x => total > 0 ? x / total : 0;
  const stages = c.stages.map(s => ({
    id: s.id, name: s.name, co2e_per_kg_fabric: r3(s.co2e), share_pct: r2(shareOf(s.co2e) * 100),
    scope: s.scope, data_tier: s.tier,
    kwh_electricity: s.kwh_elec != null ? r3(s.kwh_elec) : undefined, kwh_fuel: s.kwh_fuel != null ? r3(s.kwh_fuel) : undefined,
  }));

  // share of the total by data tier
  const tierShare = {};
  for (const s of c.stages) tierShare[s.tier] = (tierShare[s.tier] || 0) + shareOf(s.co2e) * 100;
  Object.keys(tierShare).forEach(k => { tierShare[k] = r2(tierShare[k]); });

  // same specification as 100% conventional cotton → the baseline
  const baseInp = { ...inp, share: { cotton: 1 }, raw: '', cell: 1, poly: 0, primary: {} };
  baseInp.spinSys = inp.spinSys === 'synthetic' ? 'carded' : inp.spinSys;
  const baseTotal = run(baseInp, (k, t) => t.central).total;
  const vs = baseTotal > 0 ? ((total - baseTotal) / baseTotal) * 100 : null;

  // per-garment
  let perGarment = null;
  if (inp.garment && inp.garment.g > 0) {
    const cut = inp.garment.cut != null ? inp.garment.cut : M.GARMENT.cut_waste.central;
    const fabricKg = (inp.garment.g / 1000) / (1 - cut);
    const fab = fabricKg * total;
    const thread = (inp.garment.thread_g / 1000) * M.GARMENT.thread_ef;
    const bag = (inp.garment.polybag_g / 1000) * M.GARMENT.polybag_ef;
    perGarment = { garment_weight_g: inp.garment.g, cut_waste_pct: r2(cut * 100), fabric_kg_consumed: r4(fabricKg), fabric_co2e_kg: r4(fab), thread_co2e_kg: r4(thread), polybag_co2e_kg: r4(bag), total_co2e_kg: r4(fab + thread + bag) };
  }

  const fibreBreakdown = c.fibreRows.map(r => r.modeled ? {
    fiber: r.fiber, pct: r2(r.share * 100), variant: r.variant, co2e_per_kg_fiber: r3(r.ef),
    contribution_co2e_per_kg_fabric: r3(r.share * r.ef * c.mass.fibre_kg), confidence: r.tier, note: r.note, modeled: true,
  } : { fiber: r.fiber, pct: r2(r.share * 100), modeled: false });

  const g = M.GRID[inp.country];
  const processingCo2 = total - c.fibreCo2;

  // what to do about it, where it sits, and what it means
  const L = levers(inp, c);
  const gr = grade(inp, total);
  const EQ = M.EQUIVALENTS, tee = total * EQ.tshirt_fabric_kg;
  const byCountry = Object.keys(M.GRID).map(k => ({ country: k, total: r2(run({ ...inp, country: k }, central).total), grid: M.GRID[k].central, this: k === inp.country }))
    .sort((a, b) => a.total - b.total);
  const waterL = c.detail.n_baths * c.detail.lr * c.mass.grey_kg;

  // what if: the levers the reader switched on, run together
  let whatIf = null;
  if (Array.isArray(params.apply_levers) && params.apply_levers.length) {
    let ids = params.apply_levers.filter(id => M.LEVERS[id] && leverApplies(inp, id, M.LEVERS[id]));
    if (ids.includes('fuel_biomass')) ids = ids.filter(id => id !== 'fuel_gas');          // one boiler fuel at a time
    const x = run(combine(inp, ids), central);
    whatIf = {
      levers: ids, total: r2(x.total), cut_kg_per_kg: r3(total - x.total), cut_pct: r2((total - x.total) / total * 100),
      per_tshirt_kg: r3(x.total * EQ.tshirt_fabric_kg), order_10000_tshirts_t: r2(x.total * EQ.tshirt_fabric_kg * 10),
      grade: grade(inp, x.total).letter,
      stages: x.stages.map(st => ({ id: st.id, name: st.name, co2e_per_kg_fabric: r3(st.co2e) })),
      water_l_per_kg: r2(x.detail.n_baths * x.detail.lr * x.mass.grey_kg), energy_mj_per_kg: r2((x.energy.elec_kwh + x.energy.fuel_kwh) * 3.6),
    };
  }
  const sens = E.tornado.slice(0, 6).map(t => ({ driver: t.driver, low: r2(t.low), high: r2(t.high), swing: r2(t.swing) }));
  const top = sens[0];

  return {
    success: true,
    engine: { version: 2, factor_set: M.FACTOR_SET.version, ghg_basis: M.FACTOR_SET.ghg_basis },
    warnings,
    scope: 'cradle-to-gate: fibre, spinning, ' + (inp.family === 'woven' ? 'weaving' : 'knitting') + ', wet processing and finishing' + (c.transport.length ? ', plus the transport legs supplied' : '') + '. Excludes use phase and end of life.',
    functional_unit: '1 kg of finished fabric',

    // headline figures (field names kept for existing readers)
    total_co2e_per_kg_fabric: r2(total),
    total_co2e_per_m2_fabric: r4(total * inp.gsm / 1000),
    fiber_co2e_per_kg_fabric: r3(c.fibreCo2),
    fiber_breakdown: fibreBreakdown,
    processing: {
      energy_kwh_per_kg: r2(c.energy.elec_kwh + c.energy.fuel_kwh),
      electricity_kwh_per_kg: r2(c.energy.elec_kwh),
      fuel_kwh_per_kg: r2(c.energy.fuel_kwh),
      grid_emission_factor_kg_co2_per_kwh: c.energy.grid,
      grid_factor_source: g.note,
      co2e_per_kg_fabric: r3(processingCo2),
    },
    per_garment: perGarment,
    vs_conventional_cotton_baseline: {
      baseline_co2e_per_kg: r2(baseTotal), pct_difference: vs == null ? null : r2(vs),
      direction: vs == null ? null : (Math.abs(vs) < 0.05 ? 'equal' : vs < 0 ? 'lower' : 'higher'),
    },

    // what makes it an engine
    range: {
      low: r2(E.low.total), central: r2(total), high: r2(E.high.total),
      p5: r2(E.mc.p5), p50: r2(E.mc.p50), p95: r2(E.mc.p95), monte_carlo_runs: E.mc.n,
      note: 'low/high set every uncertain input to its low or high value at once; P5-P95 samples them independently, so it is the narrower and more realistic band.',
    },
    alternative_dataset: { total_co2e_per_kg_fabric: r2(E.alt.total), fiber_co2e_per_kg_fabric: r3(E.alt.fibreCo2), note: 'Same mill model with the fibre factors replaced by the mid-points of a second, independent set of published ranges. The gap to the headline is dataset disagreement, not mill behaviour.' },
    stages,
    mass_balance: { per_kg_finished: { grey_fabric_kg: r3(c.mass.grey_kg), yarn_kg: r3(c.mass.yarn_kg), fibre_kg: r3(c.mass.fibre_kg) }, wet_processing_loss_pct: r2(c.mass.wet_loss * 100), formation_loss_pct: r2(c.mass.formation_loss * 100), spinning_waste_pct: r2(c.mass.spin_waste * 100), spinning_system: inp.spinSys },
    wet_processing: {
      dyeing_class: (inp.method !== 'pigment' && inp.poly >= 0.1 && inp.cell >= 0.1) ? 'disperse + reactive (two-bath)' : inp.method, shade_class: inp.shade, liquor_ratio: r2(c.wet.liquor_ratio),
      baths: c.wet.baths, bath_heat_kwh_th_per_kg: r3(c.wet.bath_kwh_th_per_kg),
      water_evaporated_kg_per_kg: r3(c.wet.water_evaporated_kg), drying_heat_kwh_th_per_kg: r3(c.wet.drying_kwh_th_per_kg), drying_efficiency: c.wet.drying_efficiency,
      stenter_kwh_per_kg: r3(c.wet.stenter_kwh_per_kg), chemicals: c.wet.chemicals,
      fuel: inp.fuel, boiler_efficiency: c.energy.boiler_eff, plant_overhead: c.energy.overhead,
    },
    scopes_if_integrated_mill: { scope1_fuel: r3(c.scopes.scope1), scope2_electricity: r3(c.scopes.scope2), scope3_other: r3(c.scopes.scope3) },
    biogenic_co2_kg_per_kg_fabric: r3(c.biogenic),
    transport: c.transport,
    sensitivity: { drivers: sens, most_influential: top ? top.driver : null, boiler_fuel: E.fuels, note: 'Each driver moved alone between its low and high value, everything else at central.' },
    data_quality: { share_of_total_by_tier_pct: tierShare, tiers: { PRIMARY: 'your own meter data', SOURCED: 'a published figure', MODELLED: 'a typical-practice figure with a stated range' } },
    not_modelled: M.NOT_MODELLED,
    grade: gr,
    equivalents: {
      per_kg: { car_km: r2(total / EQ.car_km) },
      per_tshirt: { fabric_kg: EQ.tshirt_fabric_kg, co2e_kg: r3(tee), car_km: r2(tee / EQ.car_km), tree_days: Math.round(tee / (EQ.tree_year / 365)) },
      order_10000_tshirts_t: r2(tee * 10000 / 1000),
      note: 'For scale only: an average petrol car about 0.17 kg CO2e per km; a mature tree takes up about 22 kg CO2 a year; a basic T-shirt about 0.2 kg of fabric with its cutting waste.',
    },
    reduction: L,
    what_if: whatIf,
    by_country: byCountry,
    water: { bath_fill_l_per_kg: r2(waterL), baths: c.detail.n_baths, liquor_ratio: r2(c.detail.lr), note: 'Water to fill the baths (liquor ratio × baths × grey fabric per kg finished). Overflow rinsing and washing down add to it.' },
    energy_intensity: { electricity_kwh_per_kg: r2(c.energy.elec_kwh), fuel_kwh_per_kg: r2(c.energy.fuel_kwh), total_mj_per_kg: r2((c.energy.elec_kwh + c.energy.fuel_kwh) * 3.6) },
    calc_steps: calcSteps(inp, c),
    inputs_used: { gsm: inp.gsm, family: inp.family, country: inp.country, boiler_fuel: inp.fuel, dyeing_class: inp.method, shade_class: inp.shade, flags: inp.flags, process_loss_pct: inp.lossPct },
  };
}

module.exports = { calculateCarbonFootprint, detectVariant };
