/**
 * KnitAdvisor Calculator — Main Orchestrator v2.0
 * 
 * Takes { fabric, gsm, composition?, color_shade?, dia?, gauge?, rpm?, efficiency?, stitch_length? }
 * Returns complete spec with every calculation + formula_trace
 * 
 * Now composition-aware: accepts Cotton, CVC, PC, Cotton/Elastane,
 * 3-component blends (55% Cotton + 40% Polyester + 5% Elastane), etc.
 * 
 * 100% deterministic. No AI. No randomness.
 * Same input → same output, every time.
 */

const {
  UnitConverter,
  YarnCountFormulas,
  GSM_COUNT_REGRESSION,
  GSM_COUNT_LOOKUP,
  LOOP_LENGTH_MULTIPLIERS,
  MachineFormulas,
  ProductionFormulas,
  FabricWeightFormulas,
  VALIDATION_RANGES,
  TIGHTNESS_LIMITS,
  validate,
  BOOK_K_CONSTANTS,
} = require('./formulas');

const {
  FABRIC_DERIVATIVES,
  GSM_COUNT_REGRESSION_COMPLETE,
  LL_MULTIPLIERS_COMPLETE,
} = require('./fabric-derivatives');

const {
  parseComposition,
  getCompositionModifiers,
  classifyColorShade,
} = require('./composition-engine');

const {
  validateStitchLength,
  getCompositionReference,
  lookupByGSM,
} = require('./factory-knowledge');

const { predictQuality } = require('./quality-engine');
const { calculateCost }  = require('./costing-engine');
const {
  denierToGSM,
  gsmToDenier,
  lookupGSMRange,
  calculateCourseLength,
  calculateStitchDensity,
  calculateProduction: calculateWarpProduction,
  calculateYarnConsumption: calculateWarpConsumption,
  calculateElasticBlend,
  calculateWarpKnitSpec,
} = require('./warp-knit-formulas');

const { getPattern: getEnginePattern } = require('./pattern-engine');
const { analyzeCriticalPath } = require('./critical-path');
const { recommendMachine } = require('./machine-optimizer');
const { analyzeYarn, recommendYarnGrade } = require('./yarn-engine');

// ============================================================
// MAIN CALCULATE FUNCTION
// ============================================================
function calculate(params) {
  const startTime = Date.now();
  const trace = [];
  const warnings = [];

  // --- 1. Validate & normalize inputs ---
  const { fabric, gsm, dia, gauge, rpm, efficiency, stitch_length, feeders, composition, color_shade,
          target_width, yarn_type, twist_multiplier, finishing_route,
          fiber_grade, spinning_system, yarn_form, slub_thickness, slub_length_cm, slub_spacing_cm,
          denier, filaments, elastane_denier, elastane_pct } = normalizeParams(params);

  if (!fabric) return { error: 'fabric is required', code: 'MISSING_FABRIC' };
  if (!gsm) return { error: 'gsm is required', code: 'MISSING_GSM' };

  // Find fabric definition
  const fabricDef = FABRIC_DERIVATIVES.find(f => f.id === fabric);
  if (!fabricDef) return { error: `Unknown fabric: ${fabric}`, code: 'UNKNOWN_FABRIC' };

  // Validate GSM range
  if (fabricDef.gsm_range) {
    if (gsm < fabricDef.gsm_range.min || gsm > fabricDef.gsm_range.max) {
      warnings.push(`GSM ${gsm} is outside the validated range [${fabricDef.gsm_range.min}–${fabricDef.gsm_range.max}] for ${fabricDef.name}. Results may be less accurate.`);
    }
  }
  trace.push({ step: 1, action: 'validate', input: { fabric, gsm, composition: composition || null }, result: 'OK', warnings: warnings.length ? [...warnings] : undefined });

  // --- 1.5. Parse composition ---
  const parsedComp = composition ? parseComposition(composition) : null;
  const compModifiers = getCompositionModifiers(parsedComp, fabric);
  trace.push({ step: '1.5', action: 'composition', parsed: parsedComp ? parsedComp.display : '100% Cotton (default)', modifiers: compModifiers });

  // --- 1.6. Color shade analysis + SL adjustment ---
  let colorResult = null;
  if (color_shade) {
    colorResult = classifyColorShade(color_shade);
    // Combined SL: composition_factor × shade_factor
    const compSLBefore = compModifiers.sl_factor || 1.0;
    compModifiers.sl_factor = parseFloat((compSLBefore * colorResult.sl_factor).toFixed(4));
    // Grey GSM: what to knit before dyeing
    colorResult.grey_gsm_target = parseFloat((gsm * colorResult.grey_gsm_factor).toFixed(1));
    colorResult.finish_gsm_target = gsm;
    colorResult.comp_sl_factor = compSLBefore;
    colorResult.combined_sl_factor = compModifiers.sl_factor;
    trace.push({ step: '1.6', action: 'color_shade', result: colorResult, sl_factor_combined: compModifiers.sl_factor });
    const adjSign = colorResult.gsm_adjustment_pct >= 0 ? '+' : '';
    warnings.push(
      `${colorResult.shade.toUpperCase()} shade: SET GREY GSM = ${colorResult.grey_gsm_target} g/m² (finish target: ${gsm} g/m², dye uptake ${adjSign}${colorResult.gsm_adjustment_pct}%). SL set ${colorResult.sl_direction} (factor ×${colorResult.sl_factor}).`
    );
  }

  // --- 1.7. Warp knit specific handling ---
  // Note: warp knit machines are FLAT (not circular). gauge = needles/inch; rpm = courses/min for these.
  let warpKnitSpec = null;
  if (fabricDef.category === 'warp_knit') {
    warpKnitSpec = calculateWarpKnitSpec({
      fabricId: fabric,
      gsm,
      denier:         denier || null,
      filaments:      filaments || 34,
      gauge:          gauge || null,
      courseSpeed:    rpm || null,       // rpm input used as courses/min for warp knit
      workWidth_cm:   dia ? dia * 2.54 : 150,  // dia field repurposed as working width in inches
      fabricArea_m2:  1,
      elastaneDenier: elastane_denier || 0,
      elastanePct:    elastane_pct || 0,
      efficiency:     efficiency || 85,
    });
    trace.push({ step: '1.7', action: 'warp_knit_analysis',
      denier_estimated: warpKnitSpec.denier_estimated,
      gsm_range: warpKnitSpec.calculations.gsm_range,
      stitch_density: warpKnitSpec.calculations.stitch_density,
    });
  }

  // --- 1.8. Factory knowledge lookup (composition-aware) ---
  const factoryRef = getCompositionReference(fabric, parsedComp);
  let factoryLookup = null;
  if (factoryRef && fabricDef.category !== 'warp_knit') {
    factoryLookup = lookupByGSM(factoryRef, gsm);
    trace.push({ step: '1.8', action: 'factory_lookup', result: factoryLookup });
  }

  // --- 2. Calculate yarn count (with composition modifiers) ---
  const countResult = calculateCount(fabric, gsm, fabricDef, compModifiers, factoryLookup, parsedComp, composition);
  trace.push({ step: 2, action: 'count', ...countResult.trace });

  // --- 2.5. Yarn Expertise Engine (grade, spinning system, strength, evenness) ---
  let yarnExpertise = null, yarnRecommendation = null;
  if (countResult.count_ne && fabricDef.category !== 'warp_knit') {
    yarnExpertise = analyzeYarn({
      count_ne: countResult.count_ne,
      fibers: parsedComp ? parsedComp.fibers : { cotton: 100 },
      fiber_grade,
      spinning_system,
      yarn_form,
      slub: { slub_thickness, slub_length_cm, slub_spacing_cm },
    });
    yarnRecommendation = recommendYarnGrade(countResult.count_ne, fabricDef.category);
    trace.push({
      step: '2.5',
      action: 'yarn_expertise',
      result: `${yarnExpertise.fiber_grade.label} · ${yarnExpertise.spinning_system.label} · RKM ${yarnExpertise.properties.tenacity_rkm} · U% ${yarnExpertise.properties.evenness_u_pct}`,
    });
    if (yarnExpertise.warnings && yarnExpertise.warnings.length) {
      yarnExpertise.warnings.forEach(w => warnings.push(w));
    }
  }

  // --- 3. Calculate loop length (skip for warp knit, use course length instead) ---
  let llResult = null;
  if (fabricDef.category !== 'warp_knit') {
    if (factoryLookup && factoryLookup.sl) {
      const sl_mm = factoryLookup.sl;
      const sl_cm = sl_mm / 10;
      llResult = {
        ll_mm: parseFloat(sl_mm.toFixed(3)),
        ll_cm: parseFloat(sl_cm.toFixed(5)),
        multiplier: fabricDef.ll_multiplier || 1.0,
        multiplier_source: 'FACTORY_R_D_RECORD',
        trace: {
          formula: `Factory R&D Record lookup (GSM=${gsm}, Count=${countResult.count_rounded})`,
          result: `${sl_mm.toFixed(3)} mm (${sl_cm.toFixed(5)} cm)`,
          note: 'Using verified factory R&D stitch length directly for maximum accuracy.',
          composition_sl_factor: compModifiers.sl_factor || 1.0,
        }
      };
      trace.push({ step: 3, action: 'loop_length', ...llResult.trace });
    } else {
      llResult = calculateLoopLength(fabric, countResult.count_ne, gsm, compModifiers);
      trace.push({ step: 3, action: 'loop_length', ...llResult.trace });
    }
  } else {
    // For warp knit, use course length from warpKnitSpec (calculateCourseLength(gauge, fabricId))
    if (gauge && warpKnitSpec?.calculations?.course_length) {
      const cl = warpKnitSpec.calculations.course_length;
      llResult = {
        ll_mm: cl.value,
        ll_cm: parseFloat((cl.value / 10).toFixed(4)),
        multiplier: null,
        multiplier_source: 'Course length (warp knit)',
        is_course_length: true,
        trace: { formula: cl.formula || 'Course length from lapping geometry', result: cl.value + ' mm' }
      };
      trace.push({ step: 3, action: 'course_length', value_mm: cl.value, formula: cl.formula });
    } else if (gauge) {
      const cl = calculateCourseLength(gauge, fabric);
      if (cl) {
        llResult = {
          ll_mm: cl.value,
          ll_cm: parseFloat((cl.value / 10).toFixed(4)),
          multiplier: null,
          multiplier_source: 'Course length (warp knit)',
          is_course_length: true,
          trace: { formula: cl.formula, result: cl.value + ' mm' }
        };
      } else {
        llResult = { ll_mm: null, ll_cm: null, is_course_length: true, trace: { formula: 'N/A', result: 'Gauge required for course length' } };
      }
      trace.push({ step: 3, action: 'course_length', result: cl ? cl.value + ' mm' : 'N/A' });
    } else {
      llResult = { ll_mm: null, ll_cm: null, is_course_length: true, trace: { formula: 'N/A — gauge not provided', result: 'Enter gauge for course length' } };
      trace.push({ step: 3, action: 'course_length', result: 'Gauge not provided' });
    }
  }

  // --- 3.1 Yarn Consumption (Dynamic Weight %) ---
  const consumptionResult = calculateConsumption(fabric, countResult);
  if (consumptionResult) {
    trace.push({ step: 3.1, action: 'yarn_consumption', result: consumptionResult.percentages });
  }

  // --- 3.2 Fleece Functional Properties (Research Model) ---
  const fleecePerformanceResult = generateFleeceProperties(fabric, parsedComp);

  // --- 3.5 Cross-Validate Stitch Length with R&D Data ---
  let rndValidation = null;
  if (llResult.ll_mm > 0) {
    rndValidation = validateStitchLength(fabric, gsm, llResult.ll_mm, gauge, countResult.count_rounded, parsedComp);
    if (rndValidation && rndValidation.valid === false) {
      warnings.push(`Calculated stitch length (${llResult.ll_mm} mm) differs from factory R&D data (${rndValidation.factory_sl} mm) by ${rndValidation.deviation_pct}%.`);
    }
  }

  // --- 3.6 Calculate Tightness Factor (TF) ---
  let tfResult = null;
  if (countResult.count_ne > 0 && llResult.ll_cm > 0) {
    // Determine TF limits for the category
    let categoryKey = 'default';
    if (fabricDef.id === 'heavy_jersey') categoryKey = 'heavy_jersey';
    else if (fabricDef.category.includes('single_jersey')) categoryKey = 'single_jersey';
    if (fabricDef.category.includes('rib')) categoryKey = 'rib';
    if (fabricDef.category.includes('interlock')) categoryKey = 'interlock';
    if (fabricDef.category.includes('fleece') || fabricDef.category.includes('terry')) categoryKey = 'fleece';
    
    const baseLimits = TIGHTNESS_LIMITS[categoryKey] || TIGHTNESS_LIMITS.default;
    let dynamicLimits = { ...baseLimits };
    
    // Expand limits based on synthetic composition
    if (parsedComp) {
      if (parsedComp.fibers.polyester >= 50) {
        dynamicLimits.min -= 1.5;
        dynamicLimits.max += 1.5;
      } else if (parsedComp.fibers.polyester >= 30) {
        dynamicLimits.min -= 1.0;
        dynamicLimits.max += 1.0;
      }
      if (parsedComp.has_elastane) {
        dynamicLimits.min -= 2.0;
        dynamicLimits.max += 2.0;
      }
    }

    const tex = UnitConverter.neToTex(countResult.count_ne);
    const tf = YarnCountFormulas.calcTightnessFactor(tex, llResult.ll_cm);
    
    tfResult = { value: tf, tex: parseFloat(tex.toFixed(2)), category: categoryKey, limits: dynamicLimits };
    let expert_analysis = null;
    
    if (tf) {
      trace.push({ step: '3.6', action: 'tightness_factor', result: `TF = ${tf} (Tex: ${tex.toFixed(2)})` });
      
      let status = "KNITTABLE";
      if (tf < dynamicLimits.min) {
        status = "UNKNITTABLE_LOOSE";
        warnings.push(`CRITICAL: Structure is UN-KNITTABLE (Too loose). Tightness Factor ${tf} is below absolute minimum ${dynamicLimits.min}.`);
        expert_analysis = {
           status: "critical",
           cause: "Fabric structure is too loose. The loops cannot hold their shape and the fabric will likely tear or collapse.",
           solutions: [
              "Use a thicker yarn (lower Ne count).",
              "Use a finer gauge machine (higher G) to increase needle density.",
              "Blend in strong synthetics like Polyester or Elastane to provide structural integrity.",
              "If GSM is very low, this fabric structure may simply be inappropriate for this weight."
           ]
        };
      } else if (tf > dynamicLimits.max) {
        status = "UNKNITTABLE_TIGHT";
        warnings.push(`CRITICAL: Structure is UN-KNITTABLE (Too tight). Tightness Factor ${tf} exceeds absolute maximum ${dynamicLimits.max}.`);
        expert_analysis = {
           status: "critical",
           cause: "Fabric structure is too tight. Needles will break, yarn will snap during knitting, or the machine will jam.",
           solutions: [
              "Use a finer yarn (higher Ne count).",
              "Use a coarser gauge machine (lower G) to provide more space between needles.",
              "Add 5% Elastane to prevent yarn breakage under high tension.",
              "If GSM is very high, consider using a double-bed structure instead of single-bed."
           ]
        };
      } else if (tf < dynamicLimits.ideal_min) {
        status = "WARNING_LOOSE";
        warnings.push(`Fabric will be very loose/flimsy. Tightness Factor ${tf} is below ideal minimum ${dynamicLimits.ideal_min}.`);
        expert_analysis = {
           status: "warning",
           cause: "Fabric is physically knittable but structurally very loose.",
           solutions: [
              "Expect high shrinkage and poor dimensional stability after washing.",
              "Consider compacting heavily during finishing.",
              "To improve quality, lower the machine gauge or use slightly thicker yarn."
           ]
        };
      } else if (tf > dynamicLimits.ideal_max) {
        status = "WARNING_TIGHT";
        warnings.push(`Fabric will be very stiff/hard. Tightness Factor ${tf} exceeds ideal maximum ${dynamicLimits.ideal_max}.`);
        expert_analysis = {
           status: "warning",
           cause: "Fabric is physically knittable but structurally very stiff/boardy.",
           solutions: [
              "Expect harsh hand-feel and low stretchability.",
              "Use enzyme wash or heavy silicon softeners during finishing to improve hand-feel.",
              "To improve quality naturally, use a finer yarn or a coarser machine gauge."
           ]
        };
      }
      
      tfResult.status = status;
      tfResult.expert_analysis = expert_analysis;
    }
  }

  // --- 4. Machine recommendations ---
  const machineResult = calculateMachine(fabricDef, countResult.count_ne, dia, gauge);
  trace.push({ step: 4, action: 'machine', ...machineResult.trace });

  // --- 4.1 Optimal SINGLE Dia + SINGLE Gauge (expert request) ---
  let optimalMachine = null;
  if (fabricDef.category !== 'warp_knit' && countResult.count_ne > 0) {
    optimalMachine = recommendMachine({
      fabricDef,
      count_ne: countResult.count_ne,
      tex: tfResult ? tfResult.tex : null,
      tf: tfResult ? tfResult.value : null,
      tfStatus: tfResult ? tfResult.status : null,
      tfLimits: tfResult ? { ideal_min: tfResult.limits && tfResult.limits.min, ideal_max: tfResult.limits && tfResult.limits.max } : null,
      targetWidthInches: target_width,
    });
    if (optimalMachine && optimalMachine.ok) {
      trace.push({
        step: '4.1',
        action: 'optimal_machine',
        result: optimalMachine.summary,
        formula: optimalMachine.gauge.formula,
      });
    }
  }

  // --- 5. Production (only if machine specs provided) ---
  let productionResult = null;
  if (dia && gauge && rpm) {
    const eff = efficiency || 85;
    const sl = stitch_length || (llResult.ll_mm > 0 ? llResult.ll_mm : null);
    const f = feeders || machineResult.feeders_theoretical;
    if (sl && f) {
      productionResult = calculateProduction(
        fabricDef, dia, gauge, f, sl, rpm, countResult.count_ne, eff, countResult
      );
      trace.push({ step: 5, action: 'production', ...productionResult.trace });
    }
  }

  // --- 6. Unit conversions ---
  const osy = FabricWeightFormulas.gsmToOsy(gsm);
  trace.push({ step: 6, action: 'gsm_to_osy', formula: `OSY = ${gsm} × 0.836 / 28.35`, result: osy });

  // --- 6.1 Predictive Quality ---
  const qualityResult = predictQuality({
    fabric: fabricDef.id,
    gsm,
    stitch_length: llResult.ll_mm > 0 ? llResult.ll_mm : 2.8,
    tightness_factor: tfResult ? tfResult.value : 14.0,
    count_ne: countResult.count_ne || 30,
    parsedComp,
    // v2.0 dominant-driver inputs — fall back to the yarn engine's detected
    // spinning-system torque bucket when the user didn't explicitly pick one.
    yarn_type: yarn_type || (yarnExpertise ? yarnExpertise.quality_engine_yarn_type : null),
    twist_multiplier,
    finishing_route,
  });
  if (qualityResult.warnings && qualityResult.warnings.length) {
    qualityResult.warnings.forEach(w => warnings.push(w));
  }
  trace.push({ step: '6.1', action: 'quality_prediction', shrinkage: qualityResult.shrinkage, spirality: qualityResult.spirality });

  // --- 6.2 Financial Costing ---
  // For warp knit: convert denier to Ne equivalent for costing (1 denier = 5315/denier Ne approx)
  let costCountNe = countResult.count_ne;
  if (fabricDef.category === 'warp_knit') {
    const effectiveDenier = (denier || (warpKnitSpec?.denier_estimated) || 70);
    costCountNe = parseFloat((5315 / effectiveDenier).toFixed(2)); // denier → Ne equiv for cost calc
  }
  const costResult = calculateCost({
    fabric: fabricDef.id,
    gsm,
    count_ne: costCountNe || 30,
    gauge: gauge || fabricDef.typical_gauge || 24,
    color_shade: color_shade,
    parsedComp,
    is_warp_knit: fabricDef.category === 'warp_knit',
    denier: fabricDef.category === 'warp_knit' ? (denier || warpKnitSpec?.denier_estimated || 70) : null,
  });
  trace.push({ step: '6.2', action: 'costing', total_usd_per_kg: costResult.cost_breakdown_usd.total_per_kg });

  // --- 6.3 Dynamic Pattern & Structural Adaptation ---
  const patternResult = getEnginePattern(fabricDef.id, gsm, gauge, composition);
  trace.push({ step: '6.3', action: 'generate_pattern', result: patternResult ? 'SUCCESS' : 'FAILED' });

  // --- 6.4 Production Critical Path Analysis (CPA) ---
  const cpaResult = analyzeCriticalPath({
    fabricId: fabricDef.id,
    category: fabricDef.category,
    gsm,
    countNe: countResult.count_ne,
    loopLengthMm: llResult ? llResult.ll_mm : null,
    dia,
    gauge,
    feeders: feeders || machineResult.feeders_theoretical,
    rpm,
    composition,
    yarnType: countResult.count_display,
  });
  if (cpaResult && cpaResult.warnings && cpaResult.warnings.length) {
    warnings.push(...cpaResult.warnings);
  }
  trace.push({ step: '6.4', action: 'critical_path_analysis', warnings_count: cpaResult?.warnings?.length || 0 });

  // --- 7. Build response ---
  const response = {
    success: true,
    response_ms: Date.now() - startTime,

    fabric: {
      id: fabricDef.id,
      name: fabricDef.name,
      name_bn: fabricDef.name_bn || null,
      category: fabricDef.category,
      machine_type: fabricDef.machine_type,
      is_multi_yarn: !!(fabricDef.count_formula && fabricDef.count_formula.type === 'multi_yarn'),
    },

    input: {
      gsm,
      composition: composition || null,
      color_shade: color_shade || null,
      dia: dia || null,
      gauge: gauge || null,
      rpm: rpm || null,
      efficiency: efficiency || 85,
      target_width: target_width || null,
      stitch_length: stitch_length || null,
    },

    composition: parsedComp ? {
      parsed: parsedComp.display,
      fibers: parsedComp.fibers,
      type: parsedComp.type,
      dominant: parsedComp.dominant,
      has_elastane: parsedComp.has_elastane,
      elastane_pct: parsedComp.elastane_pct,
      lycra_denier: compModifiers.lycra_denier,
      feed_type: compModifiers.feed_type,
      modifiers: {
        count_factor: compModifiers.count_factor,
        sl_factor: compModifiers.sl_factor,
        gsm_offset: compModifiers.gsm_offset,
      },
      notes: compModifiers.notes,
    } : {
      parsed: '100% Cotton (assumed)',
      fibers: { cotton: 100 },
      type: 'pure',
      dominant: 'cotton',
      has_elastane: false,
      elastane_pct: 0,
      lycra_denier: null,
      feed_type: null,
      modifiers: { count_factor: 1, sl_factor: 1, gsm_offset: 0 },
      notes: ['No composition specified — assuming 100% Cotton'],
    },

    color: colorResult || null,

    yarn: {
      count_ne: countResult.count_ne,           // integer (industry standard)
      count_ne_exact: countResult.count_ne_exact || null, // raw calculated float, for reference
      count_display: countResult.count_display,
      count_rounded: countResult.count_rounded,
      source: countResult.source,
      // Elastane separate declaration (when composition includes elastane)
      elastane_denier_declared: (() => {
        if (!parsedComp || !parsedComp.has_elastane) return null;
        const ePct = parsedComp.elastane_pct || 0;
        if (ePct <= 3) return 20;       // 20D for ≤3%
        if (ePct <= 8) return 40;       // 40D for ≤8%
        return 70;                       // 70D for >8%
      })(),
      elastane_pct: parsedComp?.elastane_pct || null,
      // Multi-yarn (terry, fleece)
      yarn2_ne: countResult.yarn2_ne || null,
      yarn2_display: countResult.yarn2_display || null,
      binder_denier: countResult.binder_denier || null,
      // Warp knit extras
      is_warp_knit: fabricDef.category === 'warp_knit',
      denier_input: denier || null,
      denier_estimated: (fabricDef.category === 'warp_knit' && warpKnitSpec) ? warpKnitSpec.denier_estimated : null,
      filaments_input: (fabricDef.category === 'warp_knit') ? (filaments || 34) : null,
      // Yarn Expertise Engine output
      expertise: yarnExpertise,
      recommendation: yarnRecommendation,
    },
    
    yarn_consumption: consumptionResult || null,
    fleece_performance: fleecePerformanceResult || null,

    loop_length: {
      value_mm: llResult.ll_mm,
      value_cm: llResult.ll_cm,
      multiplier: llResult.multiplier,
      multiplier_source: llResult.multiplier_source,
      is_course_length: llResult.is_course_length || false,
      rnd_validation: rndValidation,
    },

    machine: {
      gauge_recommended: machineResult.gauge_range,
      gauge_optimal: machineResult.gauge_optimal,
      dia_recommended: machineResult.dia_range,
      needles: machineResult.needles,
      feeders_theoretical: machineResult.feeders_theoretical,
      pitch_mm: machineResult.pitch_mm,
      suitable_count_for_gauge: machineResult.suitable_count,
      // Single optimal Dia + Gauge recommendation (expert request)
      optimal: optimalMachine && optimalMachine.ok ? optimalMachine : null,
    },
    
    physical_constraints: tfResult ? {
      tightness_factor: tfResult.value,
      tex: tfResult.tex,
      status: tfResult.status,
      expert_analysis: tfResult.expert_analysis,
    } : null,

    factory_reference: factoryLookup ? {
      count_ne: factoryLookup.count_ne,
      count_display: factoryLookup.count_display,
      gauge: factoryLookup.gauge,
      sl: factoryLookup.sl,
      source: factoryLookup.source,
      interpolated: factoryLookup.interpolated,
    } : null,

    grammage: {
      gsm,
      osy: osy,
    },

    production: productionResult ? {
      kg_per_hour: productionResult.kg_per_hour,
      kg_per_shift: productionResult.kg_per_shift,
      kg_per_day: productionResult.kg_per_day,
    } : null,

    quality_prediction: qualityResult ? {
      shrinkage:            qualityResult.shrinkage,
      spirality:            qualityResult.spirality,
      pilling:              qualityResult.pilling,
      bursting_strength:    qualityResult.bursting_strength,
      dimensional_stability: qualityResult.dimensional_stability,
      wash_fastness:        qualityResult.wash_fastness,
      finishing_recommendations: qualityResult.finishing_recommendations,
      model_meta:           qualityResult.model_meta,
    } : null,

    costing: costResult ? {
      raw_material_per_kg_usd:  costResult.cost_breakdown_usd.raw_material.with_waste_per_kg,
      knitting_per_kg_usd:      costResult.cost_breakdown_usd.knitting,
      dyeing_per_kg_usd:        costResult.cost_breakdown_usd.dyeing.per_kg,
      finishing_per_kg_usd:     costResult.cost_breakdown_usd.finishing,
      total_per_kg_usd:         costResult.cost_breakdown_usd.total_per_kg,
      margin_scenarios:         costResult.margin_scenarios,
      fiber_detail:             costResult.cost_breakdown_usd.raw_material.fiber_detail,
    } : null,

    // Warp knit specific data
    warp_knit: warpKnitSpec ? {
      denier_estimated: warpKnitSpec.denier_estimated,
      gsm_range: warpKnitSpec.calculations.gsm_range,
      stitch_density: warpKnitSpec.calculations.stitch_density,
      course_length: warpKnitSpec.calculations.course_length,
      production: warpKnitSpec.calculations.production,
      yarn_consumption: warpKnitSpec.calculations.yarn_consumption,
      guide_bars: warpKnitSpec.calculations.guide_bars,
      machine_speed_reference: warpKnitSpec.calculations.machine_speed_reference,
      elastic_blend: warpKnitSpec.calculations.elastic_blend,
    } : null,

    pattern: patternResult || null,
    critical_path: cpaResult || null,

    warnings,
    formula_trace: trace,
  };

  return response;
}

// ============================================================
// STEP CALCULATIONS
// ============================================================

function normalizeParams(p) {
  return {
    fabric: (p.fabric || '').toLowerCase().trim(),
    gsm: p.gsm ? parseFloat(p.gsm) : null,
    composition: p.composition ? String(p.composition).trim() : null,
    color_shade: p.color_shade ? String(p.color_shade).trim() : null,
    dia: p.dia ? parseFloat(p.dia) : null,
    gauge: p.gauge ? parseFloat(p.gauge) : null,
    rpm: p.rpm ? parseFloat(p.rpm) : null,
    efficiency: p.efficiency ? parseFloat(p.efficiency) : null,
    stitch_length: p.stitch_length ? parseFloat(p.stitch_length) : null,
    feeders: p.feeders ? parseInt(p.feeders) : null,
    // Optional finished open-width target (inches) → drives optimal Dia
    target_width: p.target_width ? parseFloat(p.target_width) : null,
    // Quality v2.0 dominant-driver inputs (optional)
    yarn_type: p.yarn_type ? String(p.yarn_type).trim() : null,
    twist_multiplier: p.twist_multiplier ? parseFloat(p.twist_multiplier) : null,
    finishing_route: p.finishing_route ? String(p.finishing_route).trim() : null,
    // Yarn Expertise inputs (optional)
    fiber_grade: p.fiber_grade ? String(p.fiber_grade).trim() : null,
    spinning_system: p.spinning_system ? String(p.spinning_system).trim() : null,
    yarn_form: p.yarn_form ? String(p.yarn_form).trim() : null,
    slub_thickness: p.slub_thickness ? parseFloat(p.slub_thickness) : null,
    slub_length_cm: p.slub_length_cm ? parseFloat(p.slub_length_cm) : null,
    slub_spacing_cm: p.slub_spacing_cm ? parseFloat(p.slub_spacing_cm) : null,
    // Warp knit parameters
    denier: p.denier ? parseFloat(p.denier) : null,
    filaments: p.filaments ? parseInt(p.filaments) : 34,
    elastane_denier: p.elastane_denier ? parseFloat(p.elastane_denier) : null,
    elastane_pct: p.elastane_pct ? parseFloat(p.elastane_pct) : null,
  };
}

function generateYarnDeclaration(parsedComp, countStrOrNumber, rawInputStr = '', fabricId = '') {
  if (!countStrOrNumber) return '';
  const inputStrLower = ((parsedComp && parsedComp.parsed) ? parsedComp.parsed : '').toLowerCase() + ' ' + String(countStrOrNumber).toLowerCase() + ' ' + String(rawInputStr).toLowerCase();

  let processStr = '';
  if (inputStrLower.includes('vortex')) processStr = 'Vortex';
  else if (inputStrLower.includes('slub')) processStr = 'Slub';
  else if (inputStrLower.includes('compact')) processStr = 'Compact';
  else if (inputStrLower.includes('combed')) processStr = 'Combed';
  else if (inputStrLower.includes('carded')) processStr = 'Carded';

  // Elastane/spandex is always declared separately as denier — never folded into base yarn compName.
  // Build compName from non-elastane fibers only.
  let compName = '100% Cotton';
  let elastaneStr = null; // e.g. "40D Elastane (Half-feed)"

  if (parsedComp) {
    const fibers = parsedComp.fibers || {};
    const elastanePct = fibers.elastane || 0;

    // Build elastane declaration string from composition modifiers data
    // We derive denier from elastane_pct: 3% → 20D, 5% → 40D, 8%+ → 70D
    if (elastanePct > 0) {
      // Denier selection mirrors composition-engine.js modifiers
      let elDen = 40;
      if (elastanePct <= 3) elDen = 20;
      else if (elastanePct <= 8) elDen = 40;
      else elDen = 70;
      // Feed type: ≤5% = half-feed, >5% = full-feed (industry convention)
      const feedType = elastanePct <= 5 ? 'Half-feed' : 'Full-feed';
      elastaneStr = `${elDen}D Elastane (${feedType})`;
    }

    // Build base fiber name WITHOUT elastane
    const c = fibers.cotton || 0;
    const p = fibers.polyester || 0;
    const v = fibers.viscose || 0;
    const modal = fibers.modal || 0;

    // Non-elastane total %
    const baseTotal = c + p + v + modal + (fibers.tencel || 0) + (fibers.bamboo || 0) + (fibers.nylon || 0);

    if (elastanePct > 0 && baseTotal > 0) {
      // Recalculate base fiber percentages excluding elastane for display
      if (c > 0 && p === 0 && v === 0 && modal === 0) {
        compName = `${Math.round(c)}% Cotton`;
      } else if (c > 0 && p > 0) {
        compName = c >= p ? `${Math.round(c)}/${Math.round(p)} CVC` : `${Math.round(p)}/${Math.round(c)} PC`;
      } else if (c > 0 && v > 0) {
        compName = `${Math.round(c)}/${Math.round(v)} Cotton/Viscose`;
      } else if (c > 0 && modal > 0) {
        compName = `${Math.round(c)}/${Math.round(modal)} Cotton/Modal`;
      } else {
        // generic — exclude elastane from display
        const parts = Object.entries(fibers)
          .filter(([f, pct]) => f !== 'elastane' && pct > 0)
          .sort((a, b) => b[1] - a[1]);
        compName = parts.map(([f, pct]) => `${Math.round(pct)}% ${f.charAt(0).toUpperCase() + f.slice(1)}`).join('/');
      }
    } else if (parsedComp.type !== 'pure') {
      if (c > 0 && p > 0 && (c + p >= 90)) {
        compName = c >= p ? `${c}/${p} CVC` : `${p}/${c} PC`;
      } else if (c > 0 && v > 0 && (c + v >= 90)) {
        compName = `${c}/${v} Cotton/Viscose`;
      } else {
        compName = parsedComp.display.replace(' + ', '/').replace(/%/g, '');
      }
    } else {
      compName = `100% ${parsedComp.dominant.charAt(0).toUpperCase() + parsedComp.dominant.slice(1)}`;
    }
  }

  function formatYarn(numStr) {
    // Always use integer count — decimal counts don't exist in industry
    const num = Math.round(parseFloat(numStr));
    let finalProcess = processStr;
    if (!finalProcess) {
      if (parsedComp && parsedComp.dominant === 'polyester' && parsedComp.type === 'pure') {
        finalProcess = 'Spun';
      } else if (num >= 36) {
        finalProcess = 'Compact';
      } else if (num < 20) {
        finalProcess = 'Carded';
      } else {
        finalProcess = 'Combed';
      }
    }
    let baseDecl = `${num}/1 (${compName} ${finalProcess})`;
    if (fabricId === 'heavy_jersey' && num >= 6 && num <= 20) {
      const doubleCount = num * 2;
      baseDecl += ` [or ${doubleCount}/1 × 2 Double-end]`;
    }
    baseDecl = baseDecl.trim();
    return elastaneStr ? `${baseDecl} + ${elastaneStr}` : baseDecl;
  }

  if (typeof countStrOrNumber === 'number' || !isNaN(countStrOrNumber)) {
    return formatYarn(countStrOrNumber);
  }

  const parts = String(countStrOrNumber).split('+').map(p => p.trim());
  const formattedParts = parts.map(part => {
    if (part.includes('D') || part.toLowerCase().includes('binder') || part.toLowerCase().includes('lycra')) {
      if (!part.includes('Polyester') && !part.includes('Elastane')) {
        return part.replace('Binder', 'Binder (Polyester Filament)').replace('Lycra', 'Elastane');
      }
      return part;
    }

    const match = part.match(/(\d+)\/S/i) || part.match(/(\d+)\/1/i);
    if (match) {
      const countNum = Math.round(parseFloat(match[1]));
      const num = countNum;
      let finalProcess = processStr;
      if (!finalProcess) {
        if (parsedComp && parsedComp.dominant === 'polyester' && parsedComp.type === 'pure') finalProcess = 'Spun';
        else if (num >= 36) finalProcess = 'Compact';
        else if (num < 20) finalProcess = 'Carded';
        else finalProcess = 'Combed';
      }
      const baseDecl = `${num}/1 (${compName} ${finalProcess})`.trim();
      const formatted = elastaneStr ? `${baseDecl} + ${elastaneStr}` : baseDecl;
      let label = part.split(' ')[0];
      if (label.match(/^\d+/)) label = '';
      else label = label + ' ';
      return `${label}${formatted}`;
    }

    return part;
  });

  return formattedParts.join(' + ');
}

function calculateConsumption(fabricId, countResult) {
  if (!['fleece_2_thread', 'fleece_3_thread', 'fleece_diagonal', 'french_terry', 'terry_fabric'].includes(fabricId)) return null;

  let groundNe = countResult.count_ne || 30;
  let loopNe = countResult.yarn2_ne;
  let binderNe = countResult.binder_denier ? (5315 / countResult.binder_denier) : null;
  
  if (!loopNe && countResult.count_display) {
    const loopMatch = countResult.count_display.match(/Loop.*?(\d+)\/1/i) || countResult.count_display.match(/Loop.*?(\d+)\/S/i);
    if (loopMatch) loopNe = parseInt(loopMatch[1]);
    
    const binderMatch = countResult.count_display.match(/(\d+)D/i);
    if (binderMatch) binderNe = 5315 / parseInt(binderMatch[1]);

    const groundMatch = countResult.count_display.match(/Ground.*?(\d+)\/1/i) || countResult.count_display.match(/Ground.*?(\d+)\/S/i);
    if (groundMatch) groundNe = parseInt(groundMatch[1]);
  }

  if (!loopNe) return null; 
  
  let platedRatio = 0;
  
  // Standard SL ratios per needle from PDF 220289760-Fleece-Fabrics.pdf
  let faceSl, backSl, platedSl;

  if (fabricId === 'fleece_2_thread') {
    faceSl = 2.8;
    backSl = 1.4;
    platedSl = 0;
  } else {
    // 3-thread and french_terry
    faceSl = 4.5;
    backSl = 1.55;
    platedSl = 3.6;
  }

  const faceRatio = faceSl / groundNe;
  const backRatio = backSl / loopNe;

  if (fabricId !== 'fleece_2_thread') {
    if (binderNe) {
      platedRatio = platedSl / binderNe;
    } else if (countResult.count_display && countResult.count_display.includes('Plated')) {
      binderNe = 34; // default if spun plated yarn
      platedRatio = platedSl / binderNe;
    }
  }

  const totalRatio = faceRatio + platedRatio + backRatio;
  
  const result = {
    face_ground_pct: parseFloat(((faceRatio / totalRatio) * 100).toFixed(2)),
    fleece_loop_pct: parseFloat(((backRatio / totalRatio) * 100).toFixed(2)),
  };

  if (platedRatio > 0) {
    result.tie_in_binder_pct = parseFloat(((platedRatio / totalRatio) * 100).toFixed(2));
  }

  return {
    source: '220289760-Fleece-Fabrics.pdf',
    method: fabricId === 'fleece_2_thread' ? 'dynamic_sl_to_count_ratio (2-yarn)' : 'dynamic_sl_to_count_ratio (3-yarn)',
    percentages: result
  };
}

function generateFleeceProperties(fabricId, parsedComp) {
  if (!['fleece_2_thread', 'fleece_3_thread', 'fleece_diagonal', 'french_terry', 'terry_fabric'].includes(fabricId)) return null;

  let backFiber = 'cotton'; // default
  if (parsedComp && parsedComp.fibers) {
    const fibers = Object.keys(parsedComp.fibers).map(k => k.toLowerCase());
    if (fibers.includes('tencel') || fibers.includes('lyocell')) {
      backFiber = 'tencel';
    } else if (fibers.includes('bamboo')) {
      backFiber = 'bamboo';
    }
  }

  const isThreeThread = fabricId === 'fleece_3_thread' || fabricId === 'fleece_diagonal'; 

  let properties = {};

  if (backFiber === 'tencel') {
    properties = {
      inlay_fiber: 'Tencel (Lyocell)',
      bursting_strength: {
        rating: 'Excellent (Maximum)',
        value_notes: 'Tencel fibers maintain 85% of dry strength when wet, yielding the highest bursting strength among cellulosic fleeces.'
      },
      water_vapor_permeability: {
        rating: 'Excellent (~27 g/m²/24hr)',
        value_notes: 'High vapor transmission due to the hydrophilic nano-fibrils of Tencel, dramatically improving breathability.'
      },
      moisture_absorption: {
        immersion_time: 'Very Fast (~20-24s)',
        water_gain: 'Moderate (~190% gain)',
        notes: 'Enables quick moisture draw from skin; ideal for active sportswear.'
      },
      fabric_stiffness: {
        flexural_rigidity: 'Medium (Soft hand-feel)',
        notes: 'Lower stiffness than cotton, providing comfortable drapability.'
      },
      spirality_risk: {
        rating: 'Low Risk (~3% body twist)',
        notes: 'Low snarling tendency and life twist in Tencel yarn reduces fabric spirality significantly compared to cotton.'
      },
      dimensional_stability: {
        lengthwise_shrinkage: isThreeThread ? 'High Stability (~7%)' : 'Moderate (~7.2%)',
        widthwise_shrinkage: isThreeThread ? 'Very Low (~0.5%)' : 'Low (~0.5%)',
        notes: isThreeThread 
          ? 'Brushing/raising process cancels inlay yarn shrinkage influence. High overall stability.' 
          : 'Low thickness of 2-thread fleece makes lengthwise stability sensitive to regenerated cellulosic fiber expansion.'
      }
    };
  } else if (backFiber === 'bamboo') {
    properties = {
      inlay_fiber: 'Bamboo Viscose',
      bursting_strength: {
        rating: 'Moderate',
        value_notes: 'Bamboo fibers have lower crystallinity, which slightly decreases bursting strength compared to cotton and Tencel.'
      },
      water_vapor_permeability: {
        rating: 'Very Good (~23 g/m²/24hr)',
        value_notes: 'Micro-gaps and voids in bamboo fiber cross-sections permit high vapor permeability.'
      },
      moisture_absorption: {
        immersion_time: 'Fast (~27s)',
        water_gain: 'Low (~140% gain)',
        notes: 'Absorbs water quickly and releases it rapidly; feels cool and dry.'
      },
      fabric_stiffness: {
        flexural_rigidity: 'Least Stiff (Maximum drape/softness)',
        notes: 'Bamboo has low flexural rigidity and bending modulus, yielding the softest hand-feel.'
      },
      spirality_risk: {
        rating: 'Lowest Risk (~2% body twist)',
        notes: 'Least snarling tendency. The bulkiness of 3-thread fleece further restricts fabric rotation.'
      },
      dimensional_stability: {
        lengthwise_shrinkage: isThreeThread ? 'High Stability (~7%)' : 'Moderate (~5.5%)',
        widthwise_shrinkage: isThreeThread ? 'Very Low (~0.9%)' : 'Low (~0.9%)',
        notes: isThreeThread
          ? 'Raising/brushing cancels inlay shrinkage influence. High overall stability.'
          : 'Bamboo inlay yarn increases lengthwise shrinkage compared to cotton.'
      }
    };
  } else {
    // Cotton
    properties = {
      inlay_fiber: 'Cotton (Standard)',
      bursting_strength: {
        rating: 'Good',
        value_notes: 'Standard cotton provides stable mechanical strength, but lower than Tencel.'
      },
      water_vapor_permeability: {
        rating: 'Low (~13-14 g/m²/24hr)',
        value_notes: 'Cotton fibers have a compact structure and lower vapor permeability, increasing sweat retention.'
      },
      moisture_absorption: {
        immersion_time: 'Slow (~70s)',
        water_gain: 'High (~250% gain)',
        notes: 'Takes longer to absorb moisture due to low amorphous speed, but holds a high percentage of water once wet.'
      },
      fabric_stiffness: {
        flexural_rigidity: 'Stiffest (Stiff hand-feel)',
        notes: 'Cotton fibers have high bending rigidity and surface hairiness, creating friction and hardness.'
      },
      spirality_risk: {
        rating: 'Medium Risk (~5-7% body twist)',
        notes: 'Higher snarling tendency in cotton fibers can cause twisting/skewness after wet processing.'
      },
      dimensional_stability: {
        lengthwise_shrinkage: isThreeThread ? 'High Stability (~7%)' : 'Good (~2.0%)',
        widthwise_shrinkage: isThreeThread ? 'Very Low (~1.0%)' : 'Low (~1.5%)',
        notes: 'Cotton inlay offers standard, predictable shrinkage profiles.'
      }
    };
  }

  return {
    scientific_source: 'Hakam et al. (2025) - Mansoura Engineering Journal (Vol. 50)',
    properties
  };
}

function roundToStandardCount(countNe) {
  if (!countNe) return countNe;
  const standardCounts = [6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 50, 60, 80];
  let closest = standardCounts[0];
  let minDiff = Math.abs(countNe - closest);
  for (let i = 1; i < standardCounts.length; i++) {
    const diff = Math.abs(countNe - standardCounts[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = standardCounts[i];
    }
  }
  return closest;
}

function calculateCount(fabricId, gsm, fabricDef, compModifiers = {}, factoryLookup = null, parsedComp = null, rawInputStr = '') {
  const reg = GSM_COUNT_REGRESSION_COMPLETE[fabricId];
  const countFactor = compModifiers.count_factor || 1.0;

  // If factory knowledge has an exact/interpolated count, prefer it
  if (factoryLookup && factoryLookup.count_ne) {
    const fCount = factoryLookup.count_ne;
    const count_rounded = roundToStandardCount(fCount); // snap to standard commercial sizes
    const advanced_display = generateYarnDeclaration(parsedComp, count_rounded, rawInputStr, fabricId);
    return {
      count_ne: count_rounded,
      count_ne_exact: parseFloat(fCount.toFixed(2)),
      count_display: advanced_display,
      count_rounded,
      source: factoryLookup.source || 'FACTORY_KNOWLEDGE',
      trace: {
        formula: `Factory knowledge lookup (GSM=${gsm}, composition-aware)`,
        result: `${fCount.toFixed(2)} Ne → snapped to standard ${count_rounded}/1 Ne`,
        source: factoryLookup.source,
        composition_factor: countFactor,
      }
    };
  }

  // Multi-yarn fabrics (terry, fleece, french_terry) — use lookup
  if (fabricDef.count_formula && fabricDef.count_formula.type === 'multi_yarn') {
    return lookupMultiYarnCount(fabricId, gsm, fabricDef, parsedComp, rawInputStr);
  }

  // Warp knit — no Ne count applicable
  if (fabricDef.category === 'warp_knit') {
    return {
      count_ne: null,
      count_display: 'Denier-based (warp knit)',
      count_rounded: null,
      source: 'N/A — warp knit uses denier system',
      trace: { formula: 'N/A for warp knit', result: 'Use denier specification' }
    };
  }

  // Regression formula: Count = (a × GSM + b) × composition_factor
  if (reg && reg.a !== undefined && reg.a !== null) {
    const count_base = reg.a * gsm + reg.b;
    const count_adjusted = count_base * countFactor;
    // Snap to standard commercial count
    const count_rounded = roundToStandardCount(count_adjusted);
    const advanced_display = generateYarnDeclaration(parsedComp, count_rounded, rawInputStr, fabricId);

    return {
      count_ne: count_rounded, // integer — decimal counts are not used in industry declarations
      count_ne_exact: parseFloat(count_adjusted.toFixed(2)), // exact value kept in trace only
      count_display: advanced_display,
      count_rounded,
      source: reg.source,
      trace: {
        formula: countFactor !== 1.0
          ? `Count = (${reg.a} × ${gsm} + ${reg.b}) × ${countFactor}`
          : `Count = ${reg.a} × ${gsm} + ${reg.b}`,
        calculation: countFactor !== 1.0
          ? `= ${count_base.toFixed(3)} × ${countFactor} = ${count_adjusted.toFixed(4)}`
          : `= ${(reg.a * gsm).toFixed(3)} + ${reg.b} = ${count_adjusted.toFixed(4)}`,
        result: `${count_adjusted.toFixed(2)} Ne → snapped to standard ${count_rounded}/1 Ne`,
        source: reg.source,
        composition_factor: countFactor,
      }
    };
  }

  return {
    count_ne: null,
    count_display: 'No formula available',
    count_rounded: null,
    source: 'NONE',
    trace: { formula: 'No regression data', result: 'Not calculable' }
  };
}

function lookupMultiYarnCount(fabricId, gsm, fabricDef, parsedComp = null, rawInputStr = '') {
  // Find the closest GSM match in lookup
  const lookupTables = {
    terry_fabric: GSM_COUNT_LOOKUP.terry_table,
    fleece_2_thread: GSM_COUNT_LOOKUP.fleece_2_thread_table,
    fleece_3_thread: GSM_COUNT_LOOKUP.fleece_3_thread_table,
    fleece_diagonal: GSM_COUNT_LOOKUP.fleece_3_thread_table,
    french_terry: GSM_COUNT_LOOKUP.fleece_3_thread_table, // same structure
  };

  const table = lookupTables[fabricId];
  if (!table || table.length === 0) {
    return {
      count_ne: null, count_display: 'No lookup data', count_rounded: null,
      source: 'NONE', trace: { formula: 'Lookup miss', result: 'No data' }
    };
  }

  // Find closest or interpolate
  let best = table[0];
  let bestDist = Math.abs(gsm - best.gsm);
  for (const row of table) {
    const dist = Math.abs(gsm - row.gsm);
    if (dist < bestDist) { best = row; bestDist = dist; }
  }

  const result = {
    count_ne: best.ground_count || best.gsm,
    count_display: `Ground: ${generateYarnDeclaration(parsedComp, best.ground_count, rawInputStr)}`,
    count_rounded: best.ground_count,
    source: 'PDF_VERIFIED',
  };

  if (best.loop_count) {
    result.yarn2_ne = best.loop_count;
    result.yarn2_display = `Loop: ${generateYarnDeclaration(parsedComp, best.loop_count, rawInputStr)}`;
    result.count_display = `Ground: ${generateYarnDeclaration(parsedComp, best.ground_count, rawInputStr)} + Loop: ${generateYarnDeclaration(parsedComp, best.loop_count, rawInputStr)}`;
  }
  
  if (best.yarn2_ne) {
    // Spun tie-in yarn instead of denier binder
    result.count_display += ` + Plated: ${generateYarnDeclaration(parsedComp, best.yarn2_ne, rawInputStr)}`;
  } else if (best.binder_denier) {
    result.binder_denier = best.binder_denier;
    result.count_display += ` + Binder ${best.binder_denier}D`;
  }

  result.trace = {
    formula: `Lookup table (GSM=${gsm}, matched GSM=${best.gsm})`,
    result: result.count_display,
    source: 'PDF_VERIFIED — GSMtoCountConversion.pdf p.1'
  };

  return result;
}

function calculateLoopLength(fabricId, count_ne, gsm, compModifiers = {}) {
  const llData = LL_MULTIPLIERS_COMPLETE[fabricId];
  const slFactor = compModifiers.sl_factor || 1.0;

  if (!llData || !llData.m || !count_ne || count_ne <= 0) {
    return {
      ll_mm: null, ll_cm: null,
      multiplier: null, multiplier_source: 'N/A',
      trace: { formula: 'N/A', result: 'Cannot calculate (missing count or multiplier)' }
    };
  }

  // Check if we have an exact research K value from 'Understanding Textile for Marchandiser'
  if (BOOK_K_CONSTANTS[fabricId] !== undefined) {
    const kVal = BOOK_K_CONSTANTS[fabricId];
    const ll_mm_base = kVal / (count_ne * gsm);
    const ll_mm = ll_mm_base * slFactor;
    const ll_cm = ll_mm / 10;

    return {
      ll_mm: parseFloat(ll_mm.toFixed(3)),
      ll_cm: parseFloat(ll_cm.toFixed(5)),
      multiplier: llData.m,
      multiplier_source: 'Understanding Textile for Marchandiser p.512',
      trace: {
        formula: slFactor !== 1.0
          ? `LL = ${kVal} / (${count_ne} × ${gsm}) × ${slFactor}`
          : `LL = ${kVal} / (${count_ne} × ${gsm})`,
        calculation: `= ${kVal} / ${(count_ne * gsm).toFixed(2)}${slFactor !== 1.0 ? ' × ' + slFactor : ''}`,
        result: `${ll_mm.toFixed(3)} mm  (${ll_cm.toFixed(5)} cm)`,
        note: 'Stitch length calculated using exact K constant from textile reference book.',
        composition_sl_factor: slFactor,
      }
    };
  }

  // Fallback to multiplier method
  // Formula: LL (cm) = 1257.765 × multiplier / (Count × GSM) × sl_factor
  // Convert to mm: × 10
  const ll_cm_base = (1257.765 * llData.m) / (count_ne * gsm);
  const ll_cm = ll_cm_base * slFactor;
  const ll_mm = ll_cm * 10;

  return {
    ll_mm: parseFloat(ll_mm.toFixed(3)),
    ll_cm: parseFloat(ll_cm.toFixed(5)),
    multiplier: llData.m,
    multiplier_source: llData.source,
    trace: {
      formula: slFactor !== 1.0
        ? `LL = 1257.765 × ${llData.m} / (${count_ne} × ${gsm}) × ${slFactor} × 10`
        : `LL = 1257.765 × ${llData.m} / (${count_ne} × ${gsm}) × 10`,
      calculation: `= ${(1257.765 * llData.m).toFixed(3)} / ${(count_ne * gsm)}${slFactor !== 1.0 ? ' × ' + slFactor : ''} × 10`,
      result: `${ll_mm.toFixed(3)} mm  (${ll_cm.toFixed(5)} cm)`,
      note: 'Formula base gives cm; ×10 for mm. Ref gauge: ' + (llData.gauge_ref || '—'),
      composition_sl_factor: slFactor,
    }
  };
}

function calculateMachine(fabricDef, count_ne, dia, gauge) {
  const result = {
    gauge_range: {
      min: fabricDef.gauge_range ? fabricDef.gauge_range.min : null,
      max: fabricDef.gauge_range ? fabricDef.gauge_range.max : null,
    },
    gauge_optimal: fabricDef.typical_gauge || null,
    dia_range: getDiaRange(fabricDef.category),
    needles: null,
    feeders_theoretical: null,
    pitch_mm: null,
    suitable_count: null,
    trace: {},
  };

  // If gauge given, calculate pitch and suitable count
  const g = gauge || fabricDef.typical_gauge;
  if (g) {
    result.pitch_mm = parseFloat((25.4 / g).toFixed(4));

    // Suitable count for this gauge
    const isSingle = ['single_jersey'].includes(fabricDef.category);
    result.suitable_count = isSingle
      ? parseFloat(((g * g) / 18).toFixed(2))
      : parseFloat(((g * g) / 15.3).toFixed(2));
  }

  // If dia given (or use mid-range default)
  const d = dia || null;
  if (d && g) {
    const needleCalc = MachineFormulas.calcNeedles(d, g);
    result.needles = needleCalc.rounded;
    result.feeders_theoretical = MachineFormulas.calcFeedersTheoretical(d);
  } else if (g) {
    // Use mid of dia range for theoretical values
    const diaRange = result.dia_range;
    const midDia = diaRange ? Math.round((diaRange.min + diaRange.max) / 2) : null;
    if (midDia) {
      result.feeders_theoretical = MachineFormulas.calcFeedersTheoretical(midDia);
    }
  }

  result.trace = {
    formula: d && g
      ? `Needles = π × ${d} × ${g} = ${result.needles}; Feeders = ${d} × 3 = ${result.feeders_theoretical}`
      : 'Using recommended ranges (dia/gauge not specified)',
    result: `Gauge ${result.gauge_range.min}–${result.gauge_range.max} GG, Dia ${result.dia_range.min}–${result.dia_range.max}"`,
  };

  return result;
}

function getDiaRange(category) {
  const ranges = {
    single_jersey: { min: 20, max: 40 },
    rib: { min: 18, max: 36 },
    interlock: { min: 20, max: 38 },
    warp_knit: { min: null, max: null },
  };
  return ranges[category] || { min: 20, max: 40 };
}

function calculateProduction(fabricDef, dia, gauge, feeders, sl_mm, rpm, count_ne, efficiency, countResult) {
  // Check if filament (denier) or cotton (Ne)
  const isFilament = fabricDef.category === 'warp_knit' || !count_ne;

  if (!count_ne || count_ne <= 0) {
    return {
      kg_per_hour: null, kg_per_shift: null, kg_per_day: null,
      trace: { formula: 'Cannot calculate — count not available', result: 'N/A' }
    };
  }

  const kgHr = ProductionFormulas.cotton_per_hour(dia, gauge, feeders, sl_mm, rpm, count_ne, efficiency);

  return {
    kg_per_hour: kgHr,
    kg_per_shift: parseFloat((kgHr * 8).toFixed(2)),
    kg_per_day: parseFloat((kgHr * 24).toFixed(2)),
    trace: {
      formula: `P = (π×${dia}×${gauge}×${feeders}×${sl_mm}×${rpm}×60×${efficiency/100}) / (10×2.54×36×840×${count_ne}×2.2046)`,
      result: `${kgHr} kg/hr → ${(kgHr*8).toFixed(2)} kg/shift → ${(kgHr*24).toFixed(2)} kg/day`,
    }
  };
}

// ============================================================
// GET ALL FABRICS LIST (for dropdown)
// ============================================================
function getAllFabrics() {
  return FABRIC_DERIVATIVES.map(f => ({
    id: f.id,
    name: f.name,
    name_bn: f.name_bn || null,
    category: f.category,
    gsm_range: f.gsm_range ? [f.gsm_range.min, f.gsm_range.max] : null,
    gauge_range: f.gauge_range ? [f.gauge_range.min, f.gauge_range.max] : null,
    is_multi_yarn: !!(f.count_formula && f.count_formula.type === 'multi_yarn'),
    is_warp: f.category === 'warp_knit',
  }));
}

// ============================================================
// GET PATTERN FOR A FABRIC
// ============================================================
function getPattern(fabricId) {
  const f = FABRIC_DERIVATIVES.find(d => d.id === fabricId);
  if (!f) return null;

  const s = f.structure;
  if (!s) return null;

  const result = {
    fabric_id: f.id,
    fabric_name: f.name,
    pattern_type: s.type === 'warp_knit' ? 'warp' : (s.beds && s.beds.includes('dial') ? 'double' : 'single'),
    courses_per_repeat: s.courses_per_repeat || 1,
    wales_per_repeat: s.wales_per_repeat || 1,
  };

  // Extract pattern grid
  if (s.pattern) {
    if (s.pattern.C) {
      result.pattern_cylinder = s.pattern.C;
      result.pattern_dial = s.pattern.D;
    } else {
      result.pattern_cylinder = s.pattern;
      result.pattern_dial = null;
    }
  }

  // Cam
  result.cam = s.cam || [];

  // Needle
  if (s.needle_arrangement) {
    result.needle_butt_pattern = s.needle_arrangement.butt_pattern || 'standard';
    result.needle_description = s.needle_arrangement.description || '';
  }

  // Notes
  result.note = s.note || null;
  result.appearance = f.appearance || null;

  return result;
}

module.exports = {
  calculate,
  getAllFabrics,
  getPattern,
};
