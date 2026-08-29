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

/**
 * The outer bound: values a knitting machine could not produce at all.
 *
 * VALIDATION_RANGES above is the TYPICAL band — useful for a warning, wrong as
 * a rejection. Its gsm floor of 80 already contradicts both the catalogue
 * (fabrics declaring ranges from 50 g/m²) and the form (which accepts 60), so
 * enforcing it would refuse work the rest of the system considers valid.
 *
 * These bounds come from the catalogue's own declared spans and the observed
 * span of the 2,201 factory records, widened to the nearest round number:
 *
 *   gsm     catalogue declares 50-600; records span 120-450
 *   gauge   catalogue declares 8-40;   records span 9-28
 *   dia     records span 26-44; large-diameter machines reach 60"
 *   sl_mm   records span 1.05-5.2
 *
 * Outside these, no fabric in the catalogue claims to exist. Before this
 * existed, only the browser bounded GSM, so a direct API call with gsm=5
 * returned a confident 44/1 at 2.65 mm — the lookup simply clamped to its
 * nearest data point and the answer looked exactly like a real one.
 */
const PHYSICAL_BOUNDS = {
  gsm:           { min: 30,  max: 900,  unit: 'g/m²' },
  gauge:         { min: 3,   max: 60,   unit: 'needles/inch' },
  dia:           { min: 4,   max: 80,   unit: 'inches' },
  rpm:           { min: 1,   max: 3000, unit: 'rev/min' },
  stitch_length: { min: 0.3, max: 30,   unit: 'mm' },
  efficiency:    { min: 1,   max: 100,  unit: '%' },
  feeders:       { min: 1,   max: 300,  unit: 'count' },
  target_width:  { min: 5,   max: 200,  unit: 'inches' },
  denier:        { min: 5,   max: 2000, unit: 'D' },
  elastane_pct:  { min: 0,   max: 50,   unit: '%' },
};

// VALIDATION_RANGES keys do not all match input field names; this maps the
// input a caller sends to the typical band that describes it, so the warning
// tier can reuse the existing table instead of restating it.
const TYPICAL_BAND_FOR_INPUT = {
  gsm: 'gsm', gauge: 'gauge', dia: 'dia_inches', rpm: 'rpm',
  stitch_length: 'sl_mm', efficiency: 'efficiency', feeders: 'feeders',
};

/**
 * Check every supplied input against both tiers.
 *
 * @returns {{ errors: string[], warnings: string[] }}
 *   errors   — physically impossible; the caller should refuse rather than answer
 *   warnings — unusual but producible; answer, and say so
 */
function validateInputs(params) {
  const errors = [];
  const warnings = [];

  for (const [field, bound] of Object.entries(PHYSICAL_BOUNDS)) {
    const raw = params[field];
    if (raw === null || raw === undefined || raw === '') continue;

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors.push(`${field} must be a number, got ${JSON.stringify(raw)}`);
      continue;
    }
    if (value < bound.min || value > bound.max) {
      errors.push(
        `${field} ${value} ${bound.unit} is outside anything knittable ` +
        `(${bound.min}–${bound.max} ${bound.unit}) — check the input.`
      );
      continue;
    }

    const typicalKey = TYPICAL_BAND_FOR_INPUT[field];
    const typical = typicalKey && VALIDATION_RANGES[typicalKey];
    if (typical && (value < typical.min || value > typical.max)) {
      warnings.push(
        `${field} ${value} ${bound.unit} is outside the usual production range ` +
        `(${typical.min}–${typical.max} ${typical.unit}). The calculation still runs, ` +
        `but treat the result as indicative.`
      );
    }
  }

  return { errors, warnings };
}

module.exports = { VALIDATION_RANGES, PHYSICAL_BOUNDS, validate, validateInputs };
