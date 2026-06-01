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

const { FABRIC_DERIVATIVES, LL_MULTIPLIERS_COMPLETE } = require('./fabric-derivatives');
const { parseComposition } = require('./composition-engine');

// ============================================================
// CONSTANTS
// ============================================================
const YARDS_PER_METER = 1.0936;
const METERS_PER_KG_FORMULA = (ne) => ne * 1693.6; // 1 Ne = Ne × 1693.6 m/kg (standard)

// ============================================================
// MAIN STRIPER CALCULATE FUNCTION
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

  // --- 2. Machine Geometry ---
  const needles = Math.round(gauge * dia * Math.PI); // N = G × π × D
  const pitch_mm = 25.4 / gauge;
  const circumference_mm = needles * pitch_mm;
  const circumference_cm = circumference_mm / 10;

  trace.push({
    step: 1,
    action: 'machine_geometry',
    formula: 'N = G × π × D',
    calculation: `N = ${gauge} × π × ${dia} = ${needles}`,
    needles,
    pitch_mm: parseFloat(pitch_mm.toFixed(4)),
    circumference_cm: parseFloat(circumference_cm.toFixed(2)),
  });

  // --- 3. Get Fabric Definition & Base Stitch Length ---
  const fabricDef = FABRIC_DERIVATIVES.find(f => f.id === fabric);
  const llData = LL_MULTIPLIERS_COMPLETE[fabric];

  // Base SL formula: SL(mm) = (multiplier × 1257.77) / (Ne × GSM) × 10
  // Or use user override
  let baseSL_mm = params.stitch_length ? parseFloat(params.stitch_length) : null;
  if (!baseSL_mm && llData) {
    baseSL_mm = (llData.m * 1257.77) / (30 * gsm) * 10; // estimate with Ne=30 placeholder
    baseSL_mm = parseFloat(baseSL_mm.toFixed(3));
  }
  if (!baseSL_mm || baseSL_mm <= 0) baseSL_mm = 2.8; // industry fallback

  trace.push({
    step: 2,
    action: 'base_stitch_length',
    value_mm: baseSL_mm,
    source: params.stitch_length ? 'USER_INPUT' : (llData ? 'FORMULA_DERIVED' : 'FALLBACK'),
  });

  // --- 4. Courses Per mm ---
  // CPI (courses per inch) = 25.4 / SL_mm
  const courses_per_mm = 1 / baseSL_mm; // approximation for course height ≈ SL
  // In reality, course height ≈ SL × row_factor, typically 0.7–0.9 for S/J
  const row_factor = fabric.includes('rib') ? 0.60 : fabric.includes('interlock') ? 0.55 : 0.72;
  const course_height_mm = baseSL_mm * row_factor;
  const courses_per_mm_actual = 1 / course_height_mm;

  trace.push({
    step: 3,
    action: 'course_density',
    formula: 'course_height = SL × row_factor',
    calculation: `${baseSL_mm} × ${row_factor} = ${course_height_mm.toFixed(3)} mm/course`,
    courses_per_mm: parseFloat(courses_per_mm_actual.toFixed(4)),
    courses_per_cm: parseFloat((courses_per_mm_actual * 10).toFixed(2)),
    courses_per_inch: parseFloat((courses_per_mm_actual * 25.4).toFixed(2)),
  });

  // --- 5. Production Speed ---
  // Courses/min = RPM × feeders_per_rev
  // feeders_per_rev ≈ (dia × π × gauge × 0.075) — empirical for standard circular
  const feeders_theoretical = Math.round(dia * Math.PI * gauge * 0.075);
  const courses_per_min = rpm * feeders_theoretical * (efficiency / 100);
  const courses_per_hour = courses_per_min * 60;

  trace.push({
    step: 4,
    action: 'production_speed',
    feeders: feeders_theoretical,
    courses_per_min: parseFloat(courses_per_min.toFixed(1)),
    courses_per_hour: parseFloat(courses_per_hour.toFixed(0)),
  });

  // --- 6. Process Each Stripe ---
  const stripeResults = [];
  let totalRepeatHeight_mm = 0;
  let totalYarnWeight_g = 0;
  const colorSummary = {}; // aggregate by color across repeats

  for (let i = 0; i < stripesInput.length; i++) {
    const s = stripesInput[i];
    const color = s.color || `Color_${i + 1}`;
    const height_mm = parseFloat(s.height_mm);
    const rawComposition = s.composition || params.composition || '100% Cotton';
    const parsedComp = parseComposition(rawComposition);

    if (!height_mm || isNaN(height_mm) || height_mm <= 0) {
      warnings.push(`Stripe ${i + 1} (${color}): invalid height_mm, skipping.`);
      continue;
    }

    // Override SL per stripe if specified
    let sl = s.stitch_length ? parseFloat(s.stitch_length) : baseSL_mm;
    const ch = sl * row_factor; // course height for this stripe
    
    // Determine yarn count
    let countNe = s.count_ne ? parseFloat(s.count_ne) : null;
    if (!countNe) {
      // Estimate from GSM and fabric type using simplified regression
      countNe = estimateCountFromGSM(fabric, gsm);
    }

    // Courses for this stripe
    const courses = Math.ceil(height_mm / ch);
    // Round up to nearest even (machines often require even number of feeder rounds)
    const coursesEven = courses % 2 === 0 ? courses : courses + 1;

    // Actual height after rounding
    const actualHeight_mm = coursesEven * ch;

    // Yarn length per course per needle (meters)
    // L_course = N × SL_mm / 1000
    const yarnPerCourse_m = (needles * sl) / 1000;

    // Total yarn length for this stripe
    const yarnLength_m = yarnPerCourse_m * coursesEven;

    // Yarn weight for this stripe
    // W = (L_m / (Ne × 1693.6)) × 1000 grams
    const metersPerKg = METERS_PER_KG_FORMULA(countNe);
    const yarnWeight_g = (yarnLength_m / metersPerKg) * 1000;

    // Feeder assignment
    const feedersAssigned = s.feeders ? parseInt(s.feeders) : estimateFeedersForColor(i, stripesInput.length, feeders_theoretical);

    // GSM contribution from this stripe (as fraction of total height)
    const gsmContrib = gsm; // GSM is constant across stripes in same fabric type

    // Accumulate
    totalRepeatHeight_mm += actualHeight_mm;
    totalYarnWeight_g += yarnWeight_g;

    if (!colorSummary[color]) {
      colorSummary[color] = {
        color,
        composition: rawComposition,
        count_ne: countNe,
        total_courses: 0,
        total_yarn_length_m: 0,
        total_yarn_weight_g: 0,
        stripe_count: 0,
      };
    }
    colorSummary[color].total_courses += coursesEven;
    colorSummary[color].total_yarn_length_m += yarnLength_m;
    colorSummary[color].total_yarn_weight_g += yarnWeight_g;
    colorSummary[color].stripe_count += 1;

    // Composition breakdown
    const compBreakdown = buildCompositionBreakdown(parsedComp, yarnWeight_g);

    stripeResults.push({
      index: i + 1,
      color,
      composition: rawComposition,
      count_ne: parseFloat(countNe.toFixed(1)),
      count_display: `${Math.round(countNe)}/1 (${rawComposition})`,
      feeders: feedersAssigned,

      height: {
        requested_mm: parseFloat(height_mm.toFixed(2)),
        actual_mm: parseFloat(actualHeight_mm.toFixed(2)),
        actual_cm: parseFloat((actualHeight_mm / 10).toFixed(3)),
        actual_inches: parseFloat((actualHeight_mm / 25.4).toFixed(3)),
      },

      stitch_length_mm: parseFloat(sl.toFixed(3)),
      course_height_mm: parseFloat(ch.toFixed(4)),
      courses: coursesEven,

      yarn: {
        yarn_per_course_m: parseFloat(yarnPerCourse_m.toFixed(4)),
        total_length_m: parseFloat(yarnLength_m.toFixed(2)),
        total_length_yards: parseFloat((yarnLength_m * YARDS_PER_METER).toFixed(2)),
        weight_g: parseFloat(yarnWeight_g.toFixed(3)),
        weight_kg: parseFloat((yarnWeight_g / 1000).toFixed(5)),
      },

      time_to_knit: {
        courses_per_min: parseFloat(courses_per_min.toFixed(1)),
        time_sec: parseFloat((coursesEven / courses_per_min * 60).toFixed(1)),
        time_min: parseFloat((coursesEven / courses_per_min).toFixed(3)),
      },

      composition_breakdown: compBreakdown,

      formula_trace: {
        courses: `courses = ceil(${height_mm}mm / ${ch.toFixed(4)}mm) = ${courses} → rounded to ${coursesEven}`,
        yarn_per_course: `L_course = ${needles} needles × ${sl}mm SL / 1000 = ${yarnPerCourse_m.toFixed(4)}m`,
        total_yarn: `L_total = ${yarnPerCourse_m.toFixed(4)} × ${coursesEven} courses = ${yarnLength_m.toFixed(2)}m`,
        weight: `W = (${yarnLength_m.toFixed(2)}m / (${countNe.toFixed(1)} × 1693.6)) × 1000 = ${yarnWeight_g.toFixed(2)}g`,
      },
    });
  }

  // --- 7. Color Summary ---
  const colorSummaryList = Object.values(colorSummary).map(c => {
    const pct = totalYarnWeight_g > 0 ? (c.total_yarn_weight_g / totalYarnWeight_g) * 100 : 0;
    return {
      color: c.color,
      composition: c.composition,
      count_ne: parseFloat(c.count_ne.toFixed(1)),
      stripe_count: c.stripe_count,
      total_courses: c.total_courses,
      yarn_length_m: parseFloat(c.total_yarn_length_m.toFixed(2)),
      yarn_weight_g: parseFloat(c.total_yarn_weight_g.toFixed(2)),
      yarn_weight_kg: parseFloat((c.total_yarn_weight_g / 1000).toFixed(4)),
      consumption_pct: parseFloat(pct.toFixed(2)),
    };
  }).sort((a, b) => b.consumption_pct - a.consumption_pct);

  // --- 8. Repeat Summary ---
  const repeatSummary = {
    total_stripes: stripeResults.length,
    total_height_mm: parseFloat(totalRepeatHeight_mm.toFixed(2)),
    total_height_cm: parseFloat((totalRepeatHeight_mm / 10).toFixed(3)),
    total_height_inches: parseFloat((totalRepeatHeight_mm / 25.4).toFixed(3)),
    total_courses: stripeResults.reduce((s, r) => s + r.courses, 0),
    total_yarn_weight_g: parseFloat(totalYarnWeight_g.toFixed(2)),
    total_yarn_weight_kg: parseFloat((totalYarnWeight_g / 1000).toFixed(4)),
    time_per_repeat_sec: parseFloat((stripeResults.reduce((s, r) => s + r.time_to_knit.time_sec, 0)).toFixed(1)),
  };

  repeatSummary.time_per_repeat_min = parseFloat((repeatSummary.time_per_repeat_sec / 60).toFixed(2));
  repeatSummary.repeats_per_hour = parseFloat((3600 / repeatSummary.time_per_repeat_sec).toFixed(1));

  // --- 9. Per-Garment Calculation (optional) ---
  let garmentResult = null;
  if (garmentLength && garmentWidth) {
    const garmentHeight_mm = garmentLength * 10;
    const garmentWidth_mm = garmentWidth * 10;
    const repeatsNeeded = garmentHeight_mm / totalRepeatHeight_mm;
    const garmentYarnTotal_g = totalYarnWeight_g * repeatsNeeded;
    // Factor in fabric width: the fabric tube = circumference. If garment width > tube, can't single tube.
    const tubeWidth_cm = circumference_cm / 2; // tubular fabric opened = half circumference
    const tubeWarning = garmentWidth > tubeWidth_cm
      ? `⚠ Garment width (${garmentWidth}cm) exceeds tube open-width (${tubeWidth_cm.toFixed(1)}cm). Use a larger diameter machine.`
      : null;

    garmentResult = {
      garment_length_cm: garmentLength,
      garment_width_cm: garmentWidth,
      tube_open_width_cm: parseFloat(tubeWidth_cm.toFixed(1)),
      repeats_needed: parseFloat(repeatsNeeded.toFixed(2)),
      yarn_per_garment_g: parseFloat(garmentYarnTotal_g.toFixed(2)),
      yarn_per_garment_kg: parseFloat((garmentYarnTotal_g / 1000).toFixed(4)),
      yarn_per_color: colorSummaryList.map(c => ({
        color: c.color,
        weight_g: parseFloat((c.yarn_weight_g * repeatsNeeded).toFixed(2)),
        weight_kg: parseFloat(((c.yarn_weight_g / 1000) * repeatsNeeded).toFixed(4)),
      })),
      width_warning: tubeWarning,
    };
    if (tubeWarning) warnings.push(tubeWarning);
  }

  // --- 10. Feeder Map ---
  // Show which feeder positions are mapped to which color
  const feederMap = buildFeederMap(stripeResults, feeders_theoretical);

  // --- 11. Final Response ---
  return {
    success: true,
    response_ms: Date.now() - startTime,

    machine: {
      fabric,
      gsm,
      gauge,
      dia,
      rpm,
      efficiency_pct: efficiency,
      needles,
      pitch_mm: parseFloat(pitch_mm.toFixed(4)),
      circumference_cm: parseFloat(circumference_cm.toFixed(2)),
      feeders_theoretical,
    },

    stitch_length: {
      base_mm: baseSL_mm,
      course_height_mm: parseFloat((baseSL_mm * row_factor).toFixed(4)),
      courses_per_cm: parseFloat((1 / (baseSL_mm * row_factor) * 10).toFixed(2)),
      courses_per_inch: parseFloat((1 / (baseSL_mm * row_factor) * 25.4).toFixed(2)),
    },

    stripes: stripeResults,

    color_summary: colorSummaryList,

    repeat_summary: repeatSummary,

    feeder_map: feederMap,

    garment: garmentResult,

    warnings,
    formula_trace: trace,
  };
}

// ============================================================
// HELPERS
// ============================================================

/** Estimate Ne count from GSM and fabric type using regression. */
function estimateCountFromGSM(fabricId, gsm) {
  const regressions = {
    single_jersey:   { a: -0.141, b: 50.22 },
    rib_1x1:         { a: -0.123, b: 54.57 },
    rib_2x2:         { a: -0.108, b: 56.62 },
    interlock:       { a: -0.206, b: 80.56 },
    pique_single:    { a: -0.146, b: 57.16 },
    fleece_2_thread: { a: -0.100, b: 44.00 },
    fleece_3_thread: { a: -0.100, b: 44.00 },
    french_terry:    { a: -0.100, b: 44.00 },
  };
  const reg = regressions[fabricId] || regressions.single_jersey;
  const ne = reg.a * gsm + reg.b;
  return Math.max(8, Math.min(80, ne)); // clamp to realistic range
}

/** Distribute feeders among colors as evenly as possible. */
function estimateFeedersForColor(colorIndex, totalColors, totalFeeders) {
  const basePerColor = Math.floor(totalFeeders / totalColors);
  const extra = totalFeeders % totalColors;
  return colorIndex < extra ? basePerColor + 1 : basePerColor;
}

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

/** Build a physical feeder assignment map. */
function buildFeederMap(stripeResults, totalFeeders) {
  const map = [];
  let feederPos = 1;
  for (const stripe of stripeResults) {
    const assignedFeeders = [];
    for (let f = 0; f < stripe.feeders; f++) {
      assignedFeeders.push(feederPos);
      feederPos = feederPos > totalFeeders ? 1 : feederPos + 1;
    }
    map.push({
      color: stripe.color,
      stripe_index: stripe.index,
      feeders: assignedFeeders,
      feeder_count: stripe.feeders,
    });
  }
  return map;
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
