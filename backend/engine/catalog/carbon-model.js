/**
 * KnitAdvisor — Carbon model data (v2)
 * ====================================
 *
 * Every number the carbon engine multiplies by lives here, never in the
 * engine. Each is a triple {low, central, high} so the engine can report a
 * range instead of a point, and carries a `tier`:
 *
 *   SOURCED   a published figure, quoted
 *   DERIVED   computed from physical constants (water heat capacity, latent
 *             heat of evaporation) — no judgement in it
 *   MODELLED  a typical-practice figure chosen by us; the range is our
 *             judgement of how far real mills stray from it
 *
 * The engine is a function of these tables and the user's inputs. To update
 * the model when a better figure appears, change it here and bump
 * FACTOR_SET.version — nothing else needs to move.
 *
 * What is deliberately NOT here: dyes, salt and auxiliaries (no defensible
 * per-kg factor sourced), effluent treatment, water supply, sizing chemicals,
 * use phase, end of life. The engine lists them under `not_modelled`.
 */
'use strict';

const FACTOR_SET = { version: '2026.11-v2', ghg_basis: 'IPCC AR6 GWP-100 (CO2e); fuel combustion CO2 only, CH4/N2O under 1% of it and not added' };

const T = (low, central, high, tier, note) => ({ low, central, high, tier, note });

// ── FIBRE PRODUCTION, kg CO2e per kg fibre, cradle-to-gate ───────────────
// central   : the single comparative LCA study (cotton, polyester, viscose,
//             lyocell on one methodology) plus corroborated figures
// alt       : mid-point of the industry-range table (a second, independent
//             dataset family) — reported alongside so the disagreement
//             between datasets is visible, not hidden
// low/high  : the span of the published figures
const FIBRES = {
  cotton:    { low: 1.5,  central: 2.8,  high: 8.0,  alt: 6.5,  tier: 'SOURCED',  note: 'Published conventional-cotton figures run from about 1.5 to 8 kg CO2e/kg depending on region, irrigation and system boundary.' },
  polyester: { low: 2.5,  central: 3.1,  high: 9.6,  alt: 11.9, tier: 'SOURCED',  note: 'Staple-fibre stage 3.1 (corroborated by a second database at 3.12); fibre-to-yarn industry figures run 9.6-14.2 on a wider boundary. The high bound takes the lower edge of those; the second dataset takes their mid-point.' },
  viscose:   { low: 4.0,  central: 5.9,  high: 10.1, alt: 5.5,  tier: 'SOURCED',  note: 'Published viscose figures run 4.0-10.1; forestry, pulping and carbon disulfide route.' },
  tencel:    { low: 2.0,  central: 6.1,  high: 7.5,  alt: 2.75, tier: 'SOURCED',  note: 'Lyocell: 6.1 in the comparative study, 2.0-3.5 in the closed-loop-solvent literature.' },
  modal:     { low: 4.0,  central: 5.9,  high: 10.1, alt: 5.5,  tier: 'MODELLED', note: 'No modal-specific figure; uses the viscose figure (modal is a high-wet-modulus viscose).' },
  nylon:     { low: 5.0,  central: 7.5,  high: 20.0, alt: 13.5, tier: 'SOURCED',  note: 'Nylon 6,6 7-20 with adipic-acid N2O the main driver; nylon 6 sits lower.' },
  elastane:  { low: 14.0, central: 20.0, high: 30.0, alt: 20.0, tier: 'MODELLED', note: 'Single-source figure; range is our judgement. Usually 2-8% of a knit, so its share of the total is small.' },
  acrylic:   { low: 15.0, central: 21.1, high: 25.0, alt: 21.1, tier: 'MODELLED', note: 'Single-source figure; range is our judgement.' },
  wool:      { low: 20.0, central: 55.0, high: 90.0, alt: 50.15, tier: 'SOURCED', note: 'Enteric methane dominates; published figures run 20-80 and cluster 60-90 for greasy and clean wool, depending on allocation and how much is counted as biogenic.' },
  linen:     { low: 0.52, central: 5.0,  high: 16.7, alt: 2.5,  tier: 'SOURCED',  note: 'Published linen figures span 0.5-16.7 because field-only and full processing boundaries are both in circulation.' },
};
// absolute figures used for named sourcing variants in the alt dataset
const VARIANTS = {
  cotton:    { organic:  { mult: 0.54, alt: 4.25, note: 'Organic/BCI-labelled cotton: 46% lower GWP than conventional (cotton LCA study, 2026); industry table 3.0-5.5.' } },
  polyester: { recycled: { mult: 0.30, alt: 2.5,  note: 'Mechanically recycled PET: about 70% below virgin; industry table 1.5-3.5.' } },
};
// fibres the table does not cover; the engine flags rather than guesses
const UNMODELED = ['silk', 'polypropylene', 'polyethylene', 'bamboo'];

// ── GRID ELECTRICITY, kg CO2 per kWh ────────────────────────────────────
// `basis` says what kind of average it is; `verified` says whether the figure
// was read from the issuing body or relayed by a secondary report.
const GRID = {
  bangladesh: { low: 0.412, central: 0.61, high: 0.62, tier: 'SOURCED', verified: 'primary',
    note: 'Department of Environment grid emission factor, FY2020-22 (0.61-0.62). The UNFCCC harmonised IFI default (0.412) is the lower bound.' },
  india:      { low: 0.70, central: 0.727, high: 0.76, tier: 'SOURCED', verified: 'secondary',
    note: 'CEA CO2 baseline database, FY2023-24 weighted average (0.727), relayed by a secondary report; confirm against the CEA release.' },
  china:      { low: 0.5306, central: 0.5366, high: 0.5856, tier: 'SOURCED', verified: 'secondary',
    note: 'MEE/NBS national average 0.5366 (2022); 0.5856 excludes non-fossil traded electricity; 0.5306 is the 2023 value. Regional grids differ widely (0.23-0.68).' },
  vietnam:    { low: 0.62, central: 0.681, high: 0.70, tier: 'SOURCED', verified: 'secondary',
    note: 'Grid emission factor for 2024 (0.681) from a university study with the environment ministry; the ministry publishes the official figure with a delay.' },
  turkiye:    { low: 0.438, central: 0.442, high: 0.474, tier: 'SOURCED', verified: 'secondary',
    note: 'Ministry of Energy 2022: generation 0.438, transmission-connected consumer 0.442, distribution-connected 0.474.' },
  pakistan:   { low: 0.40, central: 0.50, high: 0.60, tier: 'MODELLED', verified: 'none',
    note: 'No current national figure was found. Range spans published project and academic estimates (0.43-0.57). Supply your own grid factor for anything formal.' },
};
const COUNTRY_ALIASES = { bd: 'bangladesh', in: 'india', cn: 'china', vn: 'vietnam', tr: 'turkiye', turkey: 'turkiye', pk: 'pakistan' };

// ── THERMAL FUELS, kg CO2 per kWh of fuel (net calorific value) ─────────
// Natural gas 0.202 as published; the others from IPCC default carbon
// content per GJ (coal 94.6, fuel oil 77.4, diesel 74.1). Wood is carbon
// neutral in the fossil total and reported separately as biogenic.
const FUELS = {
  natural_gas: { ef: 0.202, biogenic: 0,     label: 'Natural gas' },
  coal:        { ef: 0.341, biogenic: 0,     label: 'Coal' },
  fuel_oil:    { ef: 0.279, biogenic: 0,     label: 'Fuel oil' },
  diesel:      { ef: 0.267, biogenic: 0,     label: 'Diesel' },
  biomass:     { ef: 0,     biogenic: 0.403, label: 'Biomass (wood)' },
};

// ── PHYSICAL CONSTANTS (DERIVED tier) ───────────────────────────────────
const PHYS = {
  cp_water_kj_per_kg_k: 4.186,
  latent_heat_kj_per_kg: 2257,        // evaporation at 100 C
  feed_water_c: 28,                   // ambient feed water, Bangladesh-type climate
};

// ── MILL ENERGY ─────────────────────────────────────────────────────────
const MILL = {
  spinning_kwh_per_kg: T(3.32, 3.5, 4.5, 'SOURCED', 'Modern spinning mill 3.32-3.62 kWh/kg yarn; the upper figure allows for finer counts and older plant.'),
  knit_kwh_per_kg:     T(0.09, 0.15, 0.30, 'SOURCED', 'Energy-saving compendium 0.09-0.20 kWh/kg; mill meters usually read higher, so the upper bound is widened.'),
  weave_kwh_per_kg:    T(0.5, 0.9, 1.5, 'MODELLED', 'Weaving is more intensive than knitting (air-jet and rapier looms); no sourced per-kg figure, range is our judgement.'),
  // loss of material at formation (knitting 1-3%)
  formation_loss:      T(0.01, 0.02, 0.03, 'SOURCED', 'Structural waste at knitting/weaving, 1-3% of mass.'),
  // fibre lost in spinning, by system
  spin_waste: {
    carded:   T(0.05, 0.07, 0.10, 'MODELLED', 'Carded ring/compact spinning: blowroom, card and flat waste.'),
    combed:   T(0.15, 0.20, 0.25, 'MODELLED', 'Combed adds comber noil on top of carded waste.'),
    open_end: T(0.07, 0.09, 0.12, 'MODELLED', 'Rotor spinning from lower-grade stock.'),
    synthetic: T(0.01, 0.03, 0.05, 'MODELLED', 'Synthetic staple: little waste.'),
  },
};

// ── WET PROCESSING (bath heating is DERIVED; sequences are MODELLED) ────
// Each bath: [name, temperature C, share of the liquor ratio]. Heat to raise
// L kg of water per kg fabric from feed to T:  Q = L x cp x (T - T0) / 3600  kWh.
const BATHS = {
  scour:        ['Scour', 95],
  scour_bleach: ['Scour and bleach', 95],
  hot_rinse:    ['Hot rinse', 80],
  neutralise:   ['Neutralise', 50],
  reactive_dye: ['Reactive dye bath', 60],
  soap:         ['Soaping', 95],
  warm_rinse:   ['Warm rinse', 70],
  disperse_dye: ['Disperse dye bath (130 C, pressurised)', 130],
  reduction:    ['Reduction clear', 80],
  oba:          ['Optical brightener bath', 60],
  merc_wash:    ['Mercerising wash', 80],
};
const LIQUOR_RATIO = T(6, 8, 10, 'MODELLED', 'Exhaust knit dyeing 1:6-1:10 for soft-flow and overflow machines.');

const DRYING = {
  // water carried into each drying pass, kg per kg fabric
  pickup_hydro: T(0.50, 0.55, 0.65, 'MODELLED', 'After hydro-extraction or squeezing.'),
  pickup_pad:   T(0.60, 0.70, 0.85, 'MODELLED', 'After the softener/finish pad.'),
  // thermal efficiency of drying: latent heat / heat supplied
  efficiency:   T(0.55, 0.45, 0.35, 'MODELLED', 'Stenter and relax dryers deliver roughly 4-6.5 MJ per kg of water evaporated against 2.26 MJ of latent heat.'),
  heat_set_kwh_th_per_kg: T(0.08, 0.15, 0.30, 'MODELLED', 'Extra hot-air demand to hold a synthetic blend at 190-195 C.'),
  cure_kwh_th_per_kg:     T(0.15, 0.25, 0.40, 'MODELLED', 'Pigment cure at about 150 C after the dry.'),
};

const ELECTRIC = {
  dye_machine_kwh_per_kg: T(0.40, 0.60, 1.00, 'MODELLED', 'Pumps, drives and circulation of a soft-flow dyeing machine.'),
  ancillary_kwh_per_kg:   T(0.10, 0.20, 0.35, 'MODELLED', 'Hydro-extractor, slitter, compactor, lighting.'),
  stenter_power_kw:       T(40, 47.5, 55, 'SOURCED', 'Stenter fans and chains 40-55 kWh per hour.'),
  stenter_speed_m_min:    T(32, 25, 18, 'MODELLED', 'Throughput falls as fabric gets heavier and wetter.'),
  stenter_width_m:        T(1.6, 1.6, 1.6, 'MODELLED', 'Open-width knit on the frame.'),
  brushing_kwh_per_kg:    T(0.25, 0.40, 0.60, 'MODELLED', 'Brushing, peaching or raising machines.'),
};

// boiler and plant losses
const BOILER = {
  efficiency: T(0.925, 0.85, 0.75, 'SOURCED', 'Industrial boiler thermal efficiency 75-92.6% by fuel, age and upkeep.'),
  plant_overhead: T(1.10, 1.25, 1.50, 'MODELLED', 'Steam distribution, condensate and idle losses between the boiler and the machine.'),
};

// chemicals with a published emission factor (kg CO2e per kg of product)
const CHEMICALS = {
  h2o2_50:   { ef: 1.135, use: T(0.02, 0.04, 0.06, 'MODELLED', 'kg of 50% H2O2 per kg fabric in a bleach bath'), label: 'Hydrogen peroxide (50%)' },
  naoh_50:   { ef: 0.59,  use: T(0.01, 0.02, 0.04, 'MODELLED', 'kg of 50% caustic per kg fabric in scour and neutralise'), label: 'Caustic soda (50%)' },
  naoh_merc: { ef: 0.59,  use: T(0.06, 0.10, 0.16, 'MODELLED', 'kg of 50% caustic per kg fabric lost to mercerising after recovery'), label: 'Caustic soda, mercerising' },
};

// ── TRANSPORT, kg CO2e per tonne-km, well-to-wheel ──────────────────────
const TRANSPORT = {
  sea:        T(0.010, 0.015, 0.020, 'SOURCED', 'Container ship'),
  rail_electric: T(0.011, 0.011, 0.011, 'SOURCED', 'Electric rail'),
  rail_diesel:   T(0.031, 0.031, 0.031, 'SOURCED', 'Diesel rail'),
  road:       T(0.107, 0.107, 0.107, 'SOURCED', 'Articulated lorry, 18-27 t'),
  air_long:   T(0.608, 0.608, 0.608, 'SOURCED', 'Air freight over 1500 km'),
  air_short:  T(1.516, 1.516, 1.516, 'SOURCED', 'Air freight under 1500 km'),
};

// ── GARMENT ─────────────────────────────────────────────────────────────
const GARMENT = {
  cut_waste: T(0.10, 0.125, 0.15, 'SOURCED', 'Pattern-cutting offcut 10-15% of fabric.'),
  thread_ef: 2.58,   // kg CO2e per kg polyester sewing thread
  polybag_ef: 2.96,  // kg CO2e per kg LDPE bag
};

// ── what the model leaves out, said once ────────────────────────────────
const NOT_MODELLED = [
  'Dyes, salt and most auxiliaries (no defensible per-kg factor)',
  'Effluent treatment and water supply',
  'Sizing chemicals (woven warp)',
  'Transport, unless legs are supplied',
  'Use phase, microfibre shedding and end of life',
  'Carbon removals in the crop (biogenic carbon is not netted off)',
];

module.exports = {
  FACTOR_SET, FIBRES, VARIANTS, UNMODELED, GRID, COUNTRY_ALIASES, FUELS, PHYS, MILL, BATHS, LIQUOR_RATIO,
  DRYING, ELECTRIC, BOILER, CHEMICALS, TRANSPORT, GARMENT, NOT_MODELLED,
};
