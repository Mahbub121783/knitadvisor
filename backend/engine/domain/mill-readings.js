/**
 * Mill readings — where an estimate becomes a measurement.
 *
 * Many numbers of the Studio are modelled and tagged "estimate" (thickness, air permeability, thermal resistance, the drape coefficient). They
 * stay estimates until the mill's own tester reads the same cloth. This module takes those readings — `input.readings` — and puts each one where
 * the estimate was: the number is replaced, its tag becomes "measured", the model's own figure is kept beside it and the gap is reported, so the
 * mill sees how far the model was on THIS cloth.
 *
 *   thickness_mm   ISO 5084   thickness of the finished cloth, mm          replaces the hand model's T0; feeds the packing gate (Φ), the
 *                                                                         virtual lab and the drape's hand numbers
 *   air_perm_mm_s  ISO 9237   air permeability at 100 Pa, mm/s            replaces the lab's value; the end-use verdict reads it
 *   rct            ISO 11092  thermal resistance Rct, m²·K/W              replaces the lab's value and the clo
 *   drape_dc_pct   Cusick     drape coefficient, %                        shown against the drape model on the drape run
 *
 * A reading is one cloth, one lot: it is never carried to another design. The Studio's weight has its own route for readings (trial rolls,
 * the floor profile); this module is for the numbers that had none.
 */
'use strict';

const SPEC = {
  thickness_mm: { label: 'Thickness', standard: 'ISO 5084', unit: 'mm', min: 0.1, max: 8 },
  air_perm_mm_s: { label: 'Air permeability', standard: 'ISO 9237, 100 Pa', unit: 'mm/s', min: 1, max: 6000 },
  rct: { label: 'Thermal resistance Rct', standard: 'ISO 11092', unit: 'm²·K/W', min: 0.001, max: 0.5 },
  drape_dc_pct: { label: 'Drape coefficient', standard: 'Cusick drape test', unit: '%', min: 5, max: 100 },
};
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => Math.round(x * 1000) / 1000;

/** The readings of an input, checked: { values: {key: number}, error: string|null }. Empty fields are not readings. */
function read(input) {
  const raw = input && input.readings && typeof input.readings === 'object' ? input.readings : null;
  const values = {};
  if (!raw) return { values, error: null };
  for (const k of Object.keys(raw)) {
    if (!own(SPEC, k)) return { values: {}, error: `"${k}" is not a reading the Studio takes. It takes: ${Object.keys(SPEC).join(', ')}.` };
    if (raw[k] == null || raw[k] === '') continue;
    const v = +raw[k], s = SPEC[k];
    if (!(v >= s.min && v <= s.max)) return { values: {}, error: `${s.label} ${raw[k]} ${s.unit} is outside ${s.min}–${s.max} ${s.unit}: check the unit (${s.standard}).` };
    values[k] = v;
  }
  return { values, error: null };
}

const tag = (x, measured, model, extra) => ({ ...x, value: measured, basis: 'measured', model_value: model, ...(extra || {}) });

/**
 * apply(out, values, est) — out: the Studio answer; est: { thickness_mm } the model's own thickness (before the reading replaced it).
 * Replaces the numbers in `out` and returns the list of what was applied (also left on out.readings).
 */
function apply(out, values, est) {
  const applied = [];
  const keys = Object.keys(values);
  if (!keys.length) { out.readings = null; return null; }
  const note = (key, model, measured, effect) => applied.push({ key, label: SPEC[key].label, standard: SPEC[key].standard, unit: SPEC[key].unit, model: model == null ? null : r3(model), measured: r3(measured), error_pct: model > 0 ? r1((model / measured - 1) * 100) : null, basis: 'measured at your mill', effect });
  if (values.thickness_mm != null) {
    const m = values.thickness_mm, model = est && est.thickness_mm > 0 ? est.thickness_mm : null;
    const h = out.hand && out.hand.compression;
    if (h && h.T0) {
      const ratio = model ? m / model : 1;
      h.T0 = tag(h.T0, r3(m), model); h.T0.unit = 'mm (measured, ISO 5084)';
      if (h.Tm) h.Tm = { ...h.Tm, value: r3(h.Tm.value * ratio), basis: 'estimate scaled to the measured thickness' };
      if (h.apparent_density && out.fabric && out.fabric.gsm) h.apparent_density = { ...h.apparent_density, value: r3(out.fabric.gsm / m / 1000) };
    }
    note('thickness_mm', model, m, 'the packing gate Φ, the lab and the hand numbers use it');
  }
  if (values.air_perm_mm_s != null) {
    const a = out.lab && out.lab.air && out.lab.air.air_permeability;
    note('air_perm_mm_s', a ? (a.model_value != null ? a.model_value : a.value) : null, values.air_perm_mm_s, a ? 'the lab and its end-use verdict read it' : 'recorded; turn the virtual lab on to use it');
  }
  if (values.rct != null) {
    const a = out.lab && out.lab.thermal && out.lab.thermal.rct;
    note('rct', a ? (a.model_value != null ? a.model_value : a.value) : null, values.rct, a ? 'the lab\'s clo and end-use verdict read it' : 'recorded; turn the virtual lab on to use it');
  }
  if (values.drape_dc_pct != null) note('drape_dc_pct', null, values.drape_dc_pct, 'compared with the drape model on the drape run');
  out.readings = { applied, note: 'Each reading replaces the model\'s number for THIS cloth and lot only. The model\'s own figure is kept beside it: the gap is how far the model was.' };
  return applied;
}

/** For the drape route: the Cusick reading beside the model's drape coefficient (a copy of the drape answer with the tag moved). */
function drapeCheck(drapeOut, values) {
  if (!values || values.drape_dc_pct == null || !drapeOut || !drapeOut.drape_coefficient) return drapeOut;
  const model = drapeOut.drape_coefficient.value, m = values.drape_dc_pct;
  return { ...drapeOut, drape_coefficient: { ...drapeOut.drape_coefficient, value: m, basis: 'measured', model_value: model, unit: '% (measured, Cusick)' }, reading: { key: 'drape_dc_pct', model, measured: m, error_pct: r1((model / m - 1) * 100), basis: 'measured at your mill', note: 'the model\'s own drape coefficient is kept as model_value' } };
}

function catalogue() { return { readings: Object.entries(SPEC).map(([key, s]) => ({ key, ...s })) }; }

module.exports = { read, apply, drapeCheck, catalogue, SPEC };
