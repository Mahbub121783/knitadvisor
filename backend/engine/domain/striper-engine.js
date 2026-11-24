/**
 * KnitAdvisor — Auto-Striper Engine v1.0
 *
 * Calculates complete stripe sequence data for Auto-Striper machines.
 * Supports: yarn quantity per color, courses per stripe, feeder assignment,
 *           GSM per stripe, composition-aware blending, roll changeover,
 *           full body weight estimation, and repeat-level analysis.
 *
 * Input:
 *   fabric          — 'single_jersey' | 'rib_1x1' | etc.
 *   gsm             — finished fabric GSM
 *   gauge           — machine gauge (GG)
 *   dia             — machine diameter (inches)
 *   rpm             — machine RPM
 *   efficiency      — machine efficiency % (default 85)
 *   stitch_length   — optional override stitch length (mm)
 *   garment_length  — optional finished garment length in cm (for per-garment calc)
 *   garment_width   — optional finished garment width in cm (for per-garment calc)
 *   stripes         — array of stripe objects:
 *     { color, height_mm, composition, count_ne, feeders? }
 *
 * Output:
 *   Complete stripe specification with mathematical proof per stripe.
 */

const { parseComposition } = require('./composition-engine');
const FS = require('./fabric-studio');
const STR = require('./stripe-engineering');

// ============================================================
// CONSTANTS
// ============================================================
const YARDS_PER_METER = 1.0936;
const METERS_PER_KG_FORMULA = (ne) => ne * 1693.09; // 1 Ne = 1.69309 km per kg (840 yd per lb)
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ============================================================
// MAIN STRIPER CALCULATE FUNCTION
//
// The cloth under the stripe is the Fabric Studio's (stitch length, course density, needles, feeders, yarn per feed), so a stripe
// here and a stripe in the Studio are the same figures. Stripe widths in mm become whole courses (stripe-engineering.js fitSpec:
// the repeat keeps its length, no stripe under one course); the feeders, fingers and cones come from knitting the machine round.
// ============================================================
function calculateStriper(params) {
  const startTime = Date.now();
  const warnings = [];
  const trace = [];

  // --- 1. Normalize & Validate Inputs ---
  const fabric = (params.fabric || 'single_jersey').toLowerCase().trim();
  const gsm = parseFloat(params.gsm);
  const gauge = parseFloat(params.gauge) || 24;
  const dia = parseFloat(params.dia) || 30;
  const rpm = parseFloat(params.rpm) || 25;
  const efficiency = parseFloat(params.efficiency) || 85;
  const garmentLength = params.garment_length ? parseFloat(params.garment_length) : null;
  const garmentWidth = params.garment_width ? parseFloat(params.garment_width) : null;
  const stripesInput = params.stripes || [];

  if (!gsm || isNaN(gsm)) return { error: 'gsm is required', code: 'MISSING_GSM' };
  if (!stripesInput || stripesInput.length === 0) return { error: 'stripes array is required', code: 'MISSING_STRIPES' };
  if (stripesInput.length > 64) return { error: 'Maximum 64 stripes per repeat', code: 'TOO_MANY_STRIPES' };

  // --- 2. The cloth under the stripe: the Studio, for this fabric, weight, gauge and diameter ---
  const templates = FS.listTemplates();
  const tpl = templates.find((t) => t.id === fabric) || null;
  if (!tpl) warnings.push(`Fabric "${fabric}" is not one of the Studio's structures: a plain single jersey is used for the cloth.`);
  const base = tpl || templates.find((t) => t.id === 'single_jersey');
  const firstNe = parseFloat(params.count_ne) || parseFloat((stripesInput.find((x) => parseFloat(x.count_ne)) || {}).count_ne) || null;
  const input = {
    bed: base.bed === 'double' ? 'double' : 'single', gating: base.bed === 'double' ? base.gating : undefined,
    grid: { C: base.grid.C.map((r) => r.join('')), D: base.grid.D ? base.grid.D.map((r) => r.join('')) : null },
    feeds: (base.roles || []).map((r) => ({ role: r })),
    yarn: firstNe ? { fibre: 'cotton', count: firstNe, unit: 'ne' } : undefined,
    target: { gsm },
    machine: { gauge, dia, rpm, efficiency, ...(parseFloat(params.stitch_length) > 0 ? { sl_mm: parseFloat(params.stitch_length) } : {}), ...(parseInt(params.feeders_total, 10) > 0 ? { feeders: parseInt(params.feeders_total, 10) } : {}) },
  };
  let cloth;
  try { cloth = FS.analyse(input); } catch (e) { return { error: 'The cloth could not be worked out: ' + e.message, code: 'CLOTH_ERROR' }; }
  if (!cloth || !cloth.success) return { error: 'The cloth could not be worked out: ' + ((cloth && cloth.error) || 'unknown'), code: 'CLOTH_ERROR' };
  const fin = (cloth.fabric.relaxation && cloth.fabric.relaxation.states.find((x) => x.state === 'finished')) || { cpc: cloth.fabric.cpc, width_in: cloth.fabric.width_open_in };
  const needles = cloth.machine.needles, feeders = cloth.machine.feeders, baseSL = cloth.fabric.sl_mm;
  const cpf = cloth.structure.courses_per_feed || 1, F = cloth.structure.feeds || 1;
  const interlock = cloth.structure.gating === 'interlock';
  const feedYarn = cloth.yarn.feeds;
  const lenPerFeed = feedYarn.reduce((t, f) => t + (+f.course_length_m || 0), 0) / feedYarn.length;   // m of yarn one feed pass lays, mean over the design's feeds
  const baseTex = feedYarn[0] ? +feedYarn[0].tex : null;
  const circumference_cm = cloth.fabric.width_open_in * 2.54;

  trace.push({ step: 1, action: 'cloth_from_studio', formula: 'Fabric Studio: stitch length, courses per cm, needles and feeders for this fabric, weight, gauge and diameter',
    needles, feeders, sl_mm: baseSL, courses_per_cm_finished: fin.cpc, source: cloth.fabric.sl_source });
  if (parseFloat(params.stitch_length) > 0) trace.push({ step: 2, action: 'stitch_length', source: 'USER_INPUT', value_mm: parseFloat(params.stitch_length) });

  // --- 3. Stripes → whole courses: widths asked in mm of FINISHED cloth ---
  const colourLetter = {};
  const letterOf = (name) => { if (!(name in colourLetter)) colourLetter[name] = LETTERS[Object.keys(colourLetter).length] || '?'; return colourLetter[name]; };
  const runsIn = [];
  stripesInput.forEach((x, i) => {
    const h = parseFloat(x.height_mm), color = x.color || `Color_${i + 1}`;
    if (!h || isNaN(h) || h <= 0) { warnings.push(`Stripe ${i + 1} (${color}): invalid height_mm, skipping.`); return; }
    runsIn.push({ colour: letterOf(color), name: color, value: h, unit: 'mm', src: x, i });
  });
  if (!runsIn.length) return { error: 'No stripe has a usable height_mm', code: 'MISSING_STRIPES' };
  let fit;
  try { fit = STR.fitSpec(runsIn, { cpc: fin.cpc, cpf, unit_feeds: interlock ? 2 : 1 }); } catch (e) { return { error: e.message, code: 'STRIPE_FIT' }; }
  const seq = []; fit.runs.forEach((x) => { for (let k = 0; k < x.feeds; k++) seq.push(x.colour); });
  trace.push({ step: 3, action: 'widths_to_courses', formula: 'courses = mm × courses per cm ÷ 10, whole courses, the repeat keeps its length', repeat_asked_mm: fit.repeat_asked_mm, repeat_mm: fit.repeat_mm });

  // --- 4. The machine: feeders, fingers, cones; heights in every state ---
  const states = ((cloth.fabric.relaxation && cloth.fabric.relaxation.states) || [{ state: 'finished', label: 'Finished', cpc: fin.cpc, width_in: cloth.fabric.width_open_in }]).map((x) => ({ state: x.state, label: x.label, cpc: x.cpc, width_in: x.width_in }));
  const se = STR.analyse({ seq, F, feeders, gating: cloth.structure.gating, cpf, states, selected: 'finished', rpm, eff: efficiency / 100, striper: 0, panel_cm: garmentLength, fit, width_cm: circumference_cm });
  if (se && se.checks) se.checks.filter((c) => c.level === 'warn').forEach((c) => warnings.push(c.text));

  // --- 5. Each stripe: yarn from the course length the Studio gives, the stripe's own count ---
  const courses_per_min = feeders * cpf * rpm * (efficiency / 100);
  const stripeResults = [], colorSummary = {};
  let totalRepeatHeight_mm = 0, totalYarnWeight_g = 0;
  const carriers = se && se.machine.cones ? se.machine.cones.by_colour : {};
  fit.runs.forEach((x, k) => {
    const r = runsIn[k], s = r.src, color = r.name;
    const rawComposition = s.composition || params.composition || '100% Cotton';
    const parsedComp = parseComposition(rawComposition);
    const countNe = parseFloat(s.count_ne) || firstNe || (baseTex ? 590.54 / baseTex : null);
    if (!countNe) warnings.push(`Stripe ${k + 1} (${color}): no yarn count, weight skipped.`);
    const sl = parseFloat(s.stitch_length) > 0 ? parseFloat(s.stitch_length) : baseSL;
    const faceCourses = x.feeds * cpf, ch = 10 / fin.cpc;                       // course height of the finished cloth
    const yarnLength_m = x.feeds * lenPerFeed * (sl / baseSL);
    const yarnWeight_g = countNe ? (yarnLength_m / METERS_PER_KG_FORMULA(countNe)) * 1000 : 0;
    totalRepeatHeight_mm += x.mm; totalYarnWeight_g += yarnWeight_g;
    if (!colorSummary[color]) colorSummary[color] = { color, composition: rawComposition, count_ne: countNe || 0, total_courses: 0, total_yarn_length_m: 0, total_yarn_weight_g: 0, stripe_count: 0 };
    colorSummary[color].total_courses += faceCourses; colorSummary[color].total_yarn_length_m += yarnLength_m; colorSummary[color].total_yarn_weight_g += yarnWeight_g; colorSummary[color].stripe_count += 1;
    const timeMin = faceCourses / courses_per_min;
    stripeResults.push({
      index: k + 1, color, composition: rawComposition, count_ne: countNe ? parseFloat(countNe.toFixed(1)) : null, count_display: countNe ? `${Math.round(countNe)}/1 (${rawComposition})` : null,
      feeders: carriers[x.colour] != null ? carriers[x.colour] : 0,
      height: { requested_mm: x.asked_mm, actual_mm: parseFloat(x.mm.toFixed(2)), actual_cm: parseFloat((x.mm / 10).toFixed(3)), actual_inches: parseFloat((x.mm / 25.4).toFixed(3)), error_mm: x.error_mm, error_pct: x.error_pct },
      stitch_length_mm: parseFloat(sl.toFixed(3)), course_height_mm: parseFloat(ch.toFixed(4)), courses: parseFloat(faceCourses.toFixed(2)), feeds: x.feeds,
      yarn: { yarn_per_course_m: parseFloat(((lenPerFeed / (cpf || 1)) * (sl / baseSL)).toFixed(4)), total_length_m: parseFloat(yarnLength_m.toFixed(2)), total_length_yards: parseFloat((yarnLength_m * YARDS_PER_METER).toFixed(2)), weight_g: parseFloat(yarnWeight_g.toFixed(3)), weight_kg: parseFloat((yarnWeight_g / 1000).toFixed(5)) },
      time_to_knit: { courses_per_min: parseFloat(courses_per_min.toFixed(1)), time_sec: parseFloat((timeMin * 60).toFixed(1)), time_min: parseFloat(timeMin.toFixed(3)) },
      composition_breakdown: buildCompositionBreakdown(parsedComp, yarnWeight_g),
      formula_trace: {
        courses: `${x.feeds} feed${x.feeds === 1 ? '' : 's'} = ${faceCourses} face courses (asked ${x.asked_mm} mm ÷ ${ch.toFixed(4)} mm per course, whole courses, the repeat keeps its length)`,
        yarn_per_course: `one feed lays ${lenPerFeed.toFixed(4)} m (needles × stitch length, from the Studio)`,
        total_yarn: `L_total = ${lenPerFeed.toFixed(4)} m × ${x.feeds} feeds = ${yarnLength_m.toFixed(2)} m`,
        weight: countNe ? `W = ${yarnLength_m.toFixed(2)} m ÷ (${countNe.toFixed(1)} Ne × 1693.09 m/kg) = ${yarnWeight_g.toFixed(2)} g` : null,
      },
    });
  });

  const colorSummaryList = Object.values(colorSummary).map((c) => {
    const pct = totalYarnWeight_g > 0 ? (c.total_yarn_weight_g / totalYarnWeight_g) * 100 : 0;
    return {
      color: c.color, composition: c.composition, count_ne: parseFloat(c.count_ne.toFixed(1)), stripe_count: c.stripe_count, total_courses: parseFloat(c.total_courses.toFixed(2)),
      yarn_length_m: parseFloat(c.total_yarn_length_m.toFixed(2)), yarn_weight_g: parseFloat(c.total_yarn_weight_g.toFixed(2)), yarn_weight_kg: parseFloat((c.total_yarn_weight_g / 1000).toFixed(4)), consumption_pct: parseFloat(pct.toFixed(2)),
    };
  }).sort((a, b) => b.consumption_pct - a.consumption_pct);

  const timeRepeatSec = stripeResults.reduce((t, r) => t + r.time_to_knit.time_sec, 0);
  const repeatSummary = {
    total_stripes: stripeResults.length, total_height_mm: parseFloat(totalRepeatHeight_mm.toFixed(2)), total_height_cm: parseFloat((totalRepeatHeight_mm / 10).toFixed(3)), total_height_inches: parseFloat((totalRepeatHeight_mm / 25.4).toFixed(3)),
    total_courses: parseFloat(stripeResults.reduce((t, r) => t + r.courses, 0).toFixed(2)), total_feeds: fit.feeds, total_yarn_weight_g: parseFloat(totalYarnWeight_g.toFixed(2)), total_yarn_weight_kg: parseFloat((totalYarnWeight_g / 1000).toFixed(4)),
    asked_height_mm: fit.repeat_asked_mm, height_error_mm: fit.repeat_error_mm,
    time_per_repeat_sec: parseFloat(timeRepeatSec.toFixed(1)), time_per_repeat_min: parseFloat((timeRepeatSec / 60).toFixed(2)), repeats_per_hour: timeRepeatSec > 0 ? parseFloat((3600 / timeRepeatSec).toFixed(1)) : null,
  };

  // --- 6. Per-garment (optional): the panel is cut to whole repeats; the tube's open width is the cloth's own ---
  let garmentResult = null;
  if (garmentLength && garmentWidth) {
    const repeatsNeeded = garmentLength / (totalRepeatHeight_mm / 10);
    const garmentYarnTotal_g = totalYarnWeight_g * repeatsNeeded;
    const tubeWidth_cm = circumference_cm / 2;   // a tube lying flat is half the open width
    const tubeWarning = garmentWidth > tubeWidth_cm ? `Garment width (${garmentWidth} cm) exceeds the flat tube width (${tubeWidth_cm.toFixed(1)} cm) of this cloth. Use a larger diameter machine.` : null;
    garmentResult = {
      garment_length_cm: garmentLength, garment_width_cm: garmentWidth, tube_open_width_cm: parseFloat(tubeWidth_cm.toFixed(1)), repeats_needed: parseFloat(repeatsNeeded.toFixed(2)),
      panel: se ? se.panel : null,
      yarn_per_garment_g: parseFloat(garmentYarnTotal_g.toFixed(2)), yarn_per_garment_kg: parseFloat((garmentYarnTotal_g / 1000).toFixed(4)),
      yarn_per_color: colorSummaryList.map((c) => ({ color: c.color, weight_g: parseFloat((c.yarn_weight_g * repeatsNeeded).toFixed(2)), weight_kg: parseFloat(((c.yarn_weight_g / 1000) * repeatsNeeded).toFixed(4)) })),
      width_warning: tubeWarning,
    };
    if (tubeWarning) warnings.push(tubeWarning);
  }

  // --- 7. Feeder map: the feeders each colour is threaded on ---
  const feederMap = Object.keys(colourLetter).map((name) => {
    const L = colourLetter[name], fixed = se && se.machine.threading;
    return fixed ? { color: name, feeders: se.machine.threading.filter((t) => t.yarn === L).map((t) => t.feeder), feeder_count: carriers[L] || 0 }
      : { color: name, feeders: [], feeder_count: carriers[L] || 0, note: 'striper: the colour sits on a finger of several feeders, see engineering.machine.schedule' };
  });

  return {
    success: true, response_ms: Date.now() - startTime,
    machine: { fabric, gsm, gauge, dia, rpm, efficiency_pct: efficiency, needles, pitch_mm: parseFloat((25.4 / gauge).toFixed(4)), circumference_cm: parseFloat(((needles * 25.4) / gauge / 10).toFixed(2)), feeders_theoretical: feeders, feeders, method: se ? se.machine.method : null, fingers_needed: se ? se.machine.fingers_needed : null, cones: se ? se.machine.cones.total : null },
    stitch_length: { base_mm: baseSL, course_height_mm: parseFloat((10 / fin.cpc).toFixed(4)), courses_per_cm: parseFloat(fin.cpc.toFixed(2)), courses_per_inch: parseFloat((fin.cpc * 2.54).toFixed(2)), basis: cloth.fabric.sl_source },
    stripes: stripeResults, color_summary: colorSummaryList, repeat_summary: repeatSummary, feeder_map: feederMap, garment: garmentResult,
    engineering: se, warnings, formula_trace: trace,
  };
}

// ============================================================
// HELPERS
// ============================================================

/** Build fiber weight breakdown from composition and yarn weight. */
function buildCompositionBreakdown(parsedComp, totalWeight_g) {
  if (!parsedComp || !parsedComp.fibers) return null;
  const breakdown = {};
  for (const [fiber, pct] of Object.entries(parsedComp.fibers)) {
    breakdown[fiber] = {
      pct,
      weight_g: parseFloat(((pct / 100) * totalWeight_g).toFixed(3)),
    };
  }
  return breakdown;
}

// ============================================================
// VALIDATE STRIPER INPUT (for API)
// ============================================================
function validateStriperInput(body) {
  const errors = [];
  if (!body.gsm) errors.push('gsm is required');
  if (!body.gauge) errors.push('gauge is required');
  if (!body.stripes || !Array.isArray(body.stripes) || body.stripes.length === 0) {
    errors.push('stripes array is required');
  } else {
    body.stripes.forEach((s, i) => {
      if (!s.color) errors.push(`stripe[${i}].color is required`);
      if (!s.height_mm || parseFloat(s.height_mm) <= 0) errors.push(`stripe[${i}].height_mm must be > 0`);
    });
  }
  return errors;
}

module.exports = { calculateStriper, validateStriperInput };
