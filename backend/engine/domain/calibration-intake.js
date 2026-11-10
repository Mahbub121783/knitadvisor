/**
 * Calibration measurements: what a mill measures on ONE cloth so the Studio's modelled figures can be fitted to it.
 *
 * The Studio's relaxed dimensions, residual shrinkage and stretch are modelled (family constants carried to
 * the structure); the yarn model needs measured load–extension curves to fix its friction. Both are
 * calibrated from the same small set of measurements, taken on the same piece of cloth:
 *
 *   states    wales/cm, courses/cm, GSM and open width after each relaxation (dry, wet, finished, fully relaxed)
 *   stress    force (N per 5 cm) at fixed strains, course and wale direction, first loading
 *   recovery  length left after 1 and 30 minutes, per direction (growth)
 *   thickness at light pressure
 *
 * This file only validates, compares and flattens them. The comparison is made against what the Studio
 * predicted for the same design AT THE TIME, stored with the record — so it stays true after the Studio changes.
 */
'use strict';

class CalibrationError extends Error {}

const STATES = ['dry', 'wet', 'finished', 'full'];
const STATE_LABEL = { dry: 'Dry relaxed', wet: 'Wet relaxed', finished: 'Finished', full: 'Fully relaxed (5 washes, tumble dried)' };
const QUANT = { wpc: [2, 60], cpc: [2, 80], gsm: [30, 900], width_in: [10, 120] };
const STRAINS = [5, 10, 20, 30, 40, 50];
const MAX_PER_USER = 200;

const num = (v, lo, hi, what) => {
  if (v == null || v === '') return null;
  const n = +v;
  if (!Number.isFinite(n) || n < lo || n > hi) throw new CalibrationError(`${what} must be between ${lo} and ${hi}.`);
  return Math.round(n * 1000) / 1000;
};

function cleanMeasured(b) {
  const m = { states: {}, stress: { course: [], wale: [] }, recovery: {}, thickness_mm: null, note: null };
  for (const s of STATES) {
    const src = ((b || {}).states || {})[s] || {}, row = {};
    for (const [k, [lo, hi]] of Object.entries(QUANT)) { const v = num(src[k], lo, hi, `${STATE_LABEL[s]} ${k}`); if (v != null) row[k] = v; }
    if (Object.keys(row).length) m.states[s] = row;
  }
  for (const dir of ['course', 'wale']) {
    const pts = (((b || {}).stress || {})[dir] || []).slice(0, 12);
    for (const p of pts) {
      const e = num(p.e, 0.5, 200, 'A strain'), n = num(p.n, 0, 5000, 'A force');
      if (e != null && n != null) m.stress[dir].push({ e, n });
    }
    m.stress[dir].sort((x, y) => x.e - y.e);
  }
  for (const k of ['course_1min_pct', 'course_30min_pct', 'wale_1min_pct', 'wale_30min_pct']) {
    const v = num(((b || {}).recovery || {})[k], 50, 250, `Recovery ${k}`); if (v != null) m.recovery[k] = v;
  }
  m.thickness_mm = num((b || {}).thickness_mm, 0.05, 20, 'Thickness');
  m.note = (b || {}).note ? String(b.note).slice(0, 300) : null;
  const any = Object.keys(m.states).length || m.stress.course.length || m.stress.wale.length || Object.keys(m.recovery).length || m.thickness_mm != null;
  if (!any) throw new CalibrationError('Enter at least one measurement.');
  return m;
}

/** What the Studio said for this design, kept with the record: the relaxation states, the finished figures, the cell. */
function snapshot(out) {
  const f = out.fabric || {};
  const states = {};
  for (const s of ((f.relaxation || {}).states || [])) states[s.state] = { wpc: s.wpc, cpc: s.cpc, gsm: s.gsm, width_in: s.width_in };
  return {
    states, residual: (f.relaxation || {}).residual || null, sl_mm: f.sl_mm, gsm: f.gsm, width_open_in: f.width_open_in, wpc: f.wpc, cpc: f.cpc,
    yarn: out.yarn && out.yarn.ground ? { count: out.yarn.ground.count, d_mm: out.yarn.ground.d_mm, fibre: out.yarn.ground.fibre } : null,
    machine: { gauge: (out.machine || {}).gauge, dia: (out.machine || {}).dia }, group: (out.structure || {}).group, accuracy_level: (f.accuracy || {}).level || null,
  };
}

/** Measured against predicted, per state and quantity, in per cent of the prediction. */
function compare(predicted, measured) {
  const rows = [];
  for (const s of STATES) for (const [k, v] of Object.entries(measured.states[s] || {})) {
    const p = ((predicted.states || {})[s] || {})[k];
    rows.push({ state: s, quantity: k, measured: v, predicted: p == null ? null : p, off_pct: p > 0 ? Math.round((v / p - 1) * 1000) / 10 : null });
  }
  // residual shrinkage the measurements imply, finished → fully relaxed, against the Studio's range
  const fin = measured.states.finished, full = measured.states.full;
  const shrink = {};
  if (fin && full && fin.cpc > 0 && full.cpc > 0) shrink.length_pct = Math.round((1 - fin.cpc / full.cpc) * 1000) / 10;
  if (fin && full && fin.wpc > 0 && full.wpc > 0) shrink.width_pct = Math.round((1 - fin.wpc / full.wpc) * 1000) / 10;
  if (shrink.length_pct != null || shrink.width_pct != null) shrink.predicted = predicted.residual || null;
  return { rows, shrinkage: Object.keys(shrink).length ? shrink : null };
}

/** All of an account's records as one tidy CSV: a row per measured number. */
function csv(records) {
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const L = [['record', 'saved', 'design', 'structure_group', 'kind', 'key', 'strain_pct', 'measured', 'studio_predicted'].join(',')];
  for (const r of records) {
    const base = [r.id, r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at, r.design_name, r.group_key];
    const add = (kind, key, e, v, p) => L.push([...base, kind, key, e, v, p].map(cell).join(','));
    const m = r.measured || {}, pr = r.predicted || {};
    for (const s of STATES) for (const [k, v] of Object.entries((m.states || {})[s] || {})) add('state', `${s}.${k}`, '', v, ((pr.states || {})[s] || {})[k]);
    for (const dir of ['course', 'wale']) for (const p of ((m.stress || {})[dir] || [])) add('force_n_per_5cm', dir, p.e, p.n, '');
    for (const [k, v] of Object.entries(m.recovery || {})) add('recovery_pct', k, '', v, '');
    if (m.thickness_mm != null) add('thickness_mm', '', '', m.thickness_mm, '');
  }
  return '﻿' + L.join('\r\n') + '\r\n';
}

module.exports = { cleanMeasured, snapshot, compare, csv, CalibrationError, STATES, STATE_LABEL, STRAINS, MAX_PER_USER };
