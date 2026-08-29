/**
 * Input ranges
 *
 * The physically sensible band for every input the engine accepts. These are
 * the bounds a knitting floor would recognise, not arbitrary guards.
 *
 * Part of the calculation formula section — see index.js.
 */
'use strict';

// ============================================================
// SECTION 13: COMPLETE SPEC — VALIDATION RANGES
// ============================================================
const VALIDATION_RANGES = {
  gsm:         { min: 80,   max: 500,  unit: 'g/m²' },
  count_ne:    { min: 6,    max: 80,   unit: 'Ne' },
  count_den:   { min: 20,   max: 600,  unit: 'D' },
  gauge:       { min: 8,    max: 36,   unit: 'needles/inch' },
  dia_inches:  { min: 8,    max: 60,   unit: 'inches' },
  rpm:         { min: 5,    max: 45,   unit: 'rev/min' },
  sl_mm:       { min: 1.5,  max: 8.0,  unit: 'mm' },
  efficiency:  { min: 50,   max: 98,   unit: '%' },
  feeders:     { min: 12,   max: 192,  unit: 'count' },
};

function validate(param, value) {
  const range = VALIDATION_RANGES[param];
  if (!range) return { ok: true };
  if (value < range.min || value > range.max)
    return { ok: false, msg: `${param} must be ${range.min}–${range.max} ${range.unit}, got ${value}` };
  return { ok: true };
}

module.exports = { VALIDATION_RANGES, validate };
