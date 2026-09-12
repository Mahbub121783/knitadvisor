/**
 * KnitAdvisor — Bangladesh RMG Minimum Wage Board (2023 Gazette)
 * ================================================================
 *
 * Source: Bangladesh Minimum Wage Board gazette notification, December 2023,
 * covering the Ready-Made Garment (RMG) sector. Reported consistently across
 * The Daily Star, The Business Standard, Dhaka Tribune and bdnews24 — the
 * board collapsed the earlier 5-tier structure into 5 grades (numbered 1
 * highest to 5 lowest) with a Tk 12,500/month floor at Grade 5. In force
 * through 2026; no newer gazette had superseded it as of this file's
 * creation (2026-09-13) — CONFIRM against a fresh source before relying on
 * this for a real quotation if it has been more than ~1 year since then.
 *
 * Each grade's `gross_bdt` is basic pay + house rent + medical + other
 * allowances, i.e. what actually appears as the worker's monthly gross before
 * overtime — this is the number a Cost-of-Making (CM) calculation should
 * divide by, not the bare "basic" figure alone (basic is shown for
 * reference/provident-fund-style calculations, which this engine doesn't do).
 *
 * WHAT THIS DOES NOT MODEL (same "say so, don't guess" convention as
 * engine/catalog/country-costs.js): overtime premium, festival bonus,
 * attendance/production incentive bonus, employer PF contribution, or any
 * factory paying above the legal floor for a compliant/premium line (many
 * export-oriented factories do, especially for buyers auditing wages) — the
 * wage board sets a FLOOR, not what every line actually pays.
 */

const BD_WAGE_GRADES = [
  {
    grade: 1,
    role_typical: 'Senior/skilled machine operator, quality checker',
    basic_bdt: 8200,
    gross_bdt: 14750,
    source: 'GOVT_GAZETTE',
  },
  {
    grade: 2,
    role_typical: 'Machine operator (experienced)',
    basic_bdt: 7800,
    gross_bdt: 14150,
    source: 'GOVT_GAZETTE',
  },
  {
    grade: 3,
    role_typical: 'Machine operator (general) — treated as this engine\'s default "typical operator"',
    basic_bdt: 7400,
    gross_bdt: 13500,
    source: 'GOVT_GAZETTE',
  },
  {
    grade: 4,
    role_typical: 'Junior operator / finishing',
    basic_bdt: 7050,
    gross_bdt: 13025,
    source: 'GOVT_GAZETTE',
  },
  {
    grade: 5,
    role_typical: 'Helper / entry-level (legal floor)',
    basic_bdt: 6700,
    gross_bdt: 12500,
    source: 'GOVT_GAZETTE',
  },
];

// Standard working-time assumption used to turn a monthly wage into a
// per-minute cost. 8 hours/day, 6-day week (one weekly rest day) = 26
// working days in a 30/31-day month — the generic assumption used across the
// sourced CM-formula worked examples (onlineclothingstudy.com, ordnur.com),
// consistent with the Bangladesh Labour Act 2006's standard 8-hour working
// day. A specific factory's actual calendar (holidays, Ramadan hours, etc.)
// will differ — this is a MODEL for costing/quoting, not a payroll figure.
const STANDARD_WORKING_DAYS_PER_MONTH = 26;
const STANDARD_SHIFT_HOURS = 8;
const STANDARD_WORKING_MINUTES_PER_MONTH = STANDARD_WORKING_DAYS_PER_MONTH * STANDARD_SHIFT_HOURS * 60; // 12,480

// Typical sewing-line efficiency for basic knit garments in Bangladesh RMG.
// Published studies show a wide real range: 43% (an unimproved line, before
// line-balancing) up to 82% (after improvement) in one documented case study,
// with 60% cited elsewhere as typical for basic knit polo production — 60%
// is used here as the DEFAULT, not a claimed universal constant. A specific
// factory's true efficiency should always override it when known.
const DEFAULT_LINE_EFFICIENCY_PCT = 60;
const LINE_EFFICIENCY_SOURCE_NOTE =
  'INDUSTRY_TYPICAL — real range documented 43-82%; 60% is a typical basic-knit-line default, not this factory\'s measured number';

function getWageGrade(grade) {
  return BD_WAGE_GRADES.find(g => g.grade === grade) || BD_WAGE_GRADES.find(g => g.grade === 3);
}

module.exports = {
  BD_WAGE_GRADES,
  STANDARD_WORKING_DAYS_PER_MONTH,
  STANDARD_SHIFT_HOURS,
  STANDARD_WORKING_MINUTES_PER_MONTH,
  DEFAULT_LINE_EFFICIENCY_PCT,
  LINE_EFFICIENCY_SOURCE_NOTE,
  getWageGrade,
};
