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
  classifyShadeByDepth,
} = require('./composition-engine');

const colorEngine = require('./color-engine');

const {
  validateStitchLength,
  getCompositionReference,
  lookupByGSM,
  FAB_BUCKET_ALIAS,
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
const { matchFactory, recommendCountFromGSM } = require('./factory-match');
const { matchRiskAssessment } = require('./risk-assessment');
const { gaugeFromBulkData, estimateProcessLoss, greyRequirementForFinished } = require('./production-data');
const { analyzeWetProcessing, greigeGsmTarget, resolveFamily } = require('./wet-processing-engine');
const { applyFabricPhysics } = require('./fabric-physics');

// ============================================================
// MAIN CALCULATE FUNCTION
// ============================================================
function calculate(params) {
  const startTime = Date.now();
  const trace = [];
  const warnings = [];

  // --- 1. Validate & normalize inputs ---
  const { fabric, gsm, dia, gauge, rpm, efficiency, stitch_length, feeders, composition, color_shade,
          color_input,
          target_width, yarn_type, twist_multiplier, finishing_route,
          fiber_grade, spinning_system, yarn_form, slub_thickness, slub_length_cm, slub_spacing_cm,
          denier, filaments, elastane_denier, elastane_pct, dyeing_method,
          light_source, illuminant, shade_depth_pct } = normalizeParams(params);

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

  // --- 1.55. Precise Color Engine resolution (optional, separate from shade mode) ---
  // The "Color Engine" input lets the user pick an EXACT color (TCX / hex / name).
  // It drives the realistic visualization AND — when no color_shade mode is given —
  // it derives the shade tier so the rest of the system (SL, grey-GSM, dyeing) still works.
  let colorResolved = null;
  if (color_input) {
    try {
      colorResolved = colorEngine.getColorPreview(color_input);
    } catch (_) { colorResolved = null; }
  }

  // Effective shade mode: explicit color_shade wins; otherwise derive from the resolved color.
  let effectiveShade = color_shade;
  if (!effectiveShade && colorResolved && colorResolved.shade_tier) {
    effectiveShade = colorResolved.shade_tier;
  }
  // Continuous dye-depth (%OWF) overrides the 6-tier button entirely when given.
  const useDepth = shade_depth_pct !== null && shade_depth_pct !== undefined && !isNaN(shade_depth_pct);

  // --- 1.6. Color shade analysis + SL adjustment ---
  let colorResult = null;
  if (useDepth || effectiveShade) {
    colorResult = useDepth ? classifyShadeByDepth(shade_depth_pct) : classifyColorShade(effectiveShade);
    if (useDepth) effectiveShade = colorResult.shade; // nearest tier — still needed by family-keyed lookups below
    // Combined SL: composition_factor × shade_factor
    const compSLBefore = compModifiers.sl_factor || 1.0;
    compModifiers.sl_factor = parseFloat((compSLBefore * colorResult.sl_factor).toFixed(4));
    const wetFam = resolveFamily(fabricDef.id, fabricDef.category);
    if (useDepth) {
      // Continuous mode: trust the %OWF-interpolated grey-GSM directly — the
      // whole point of giving a real dye-recipe % instead of a button is to
      // NOT snap to one of 6 buckets, so don't let the discrete real-data
      // lookup below (keyed by the nearest tier) override it.
      colorResult.grey_gsm_target = parseFloat((gsm * colorResult.grey_gsm_factor).toFixed(1));
    } else {
      // Grey GSM: what to knit before dyeing. Single source of truth shared with the
      // Wet-Processing Critical Path card (wet-processing-engine.js) — both used to run
      // independent formulas (a flat dye-mass-only factor here vs. an area-shrinkage +
      // dye-add-on model there) and could disagree by several GSM for the same shade.
      const greigeForShade = greigeGsmTarget(gsm, wetFam, effectiveShade, dyeing_method);
      colorResult.grey_gsm_target = greigeForShade
        ? greigeForShade.grey_gsm_target
        : parseFloat((gsm * colorResult.grey_gsm_factor).toFixed(1));
      colorResult.grey_gsm_factor = parseFloat((colorResult.grey_gsm_target / gsm).toFixed(4));
      if (greigeForShade) colorResult.gsm_adjustment_pct = greigeForShade.dye_add_on_pct;
    }
    colorResult.finish_gsm_target = gsm;
    colorResult.comp_sl_factor = compSLBefore;
    colorResult.combined_sl_factor = compModifiers.sl_factor;
    trace.push({ step: '1.6', action: 'color_shade', result: colorResult, sl_factor_combined: compModifiers.sl_factor });
    const adjSign = colorResult.gsm_adjustment_pct >= 0 ? '+' : '';
    warnings.push(
      `${colorResult.shade.toUpperCase()} shade${useDepth ? ` (${colorResult.owf_pct}% OWF)` : ''}: SET GREY GSM = ${colorResult.grey_gsm_target} g/m² (finish target: ${gsm} g/m², dye uptake ${adjSign}${colorResult.gsm_adjustment_pct}%). SL set ${colorResult.sl_direction} (factor ×${colorResult.sl_factor}).`
    );
  }

  // --- 1.65. Fabric optical physics (dye × fibre × construction × finish × light) ---
  // Reflectance shifts so the rendered colour reads as the REAL dyed/finished cloth
  // (drives the 3D/2D visualization material + colour). Always attached so the
  // viewer can use sheen/roughness/shadow even in shade-only mode.
  let fabricPhysics = null;
  {
    const SHADE_HEX = {
      black: '#1a1a1a', dark_navy: '#1f2d5c', dark: '#1f2d5c', navy: '#1f2d5c',
      light_medium: '#3f7fc4', medium: '#3f7fc4', light: '#9cc2e6',
      fluorescent: '#b6ff1a', white_melange: '#eceae4', white: '#eceae4',
      melange: '#8c8c8c', heather: '#8c8c8c', grey: '#8c8c8c', gray: '#8c8c8c',
    };
    const baseHex = (colorResolved && colorResolved.hex)
      || SHADE_HEX[(effectiveShade || '').toString().toLowerCase()] || '#3f7fc4';

    // map fabric id → CONSTRUCTION_PHYSICS key
    const fid = `${fabric || ''} ${(fabricDef && fabricDef.name) || ''}`.toLowerCase();
    let constructionId = 'single_jersey';
    if (/interlock|double\s*jersey|ponte/.test(fid)) constructionId = 'interlock';
    else if (/waffle|thermal/.test(fid)) constructionId = 'waffle';
    else if (/pique|piqu|lacoste|honeycomb/.test(fid)) constructionId = 'pique';
    else if (/fleece|polar|velour/.test(fid)) constructionId = 'fleece';
    else if (/terry|loopback|loop\s*knit/.test(fid)) constructionId = 'french_terry';
    else if (/2\s*[x×]\s*2|wide\s*rib/.test(fid)) constructionId = 'rib_2x2';
    else if (/rib/.test(fid)) constructionId = 'rib_1x1';

    // map finishing_route → FINISH_PHYSICS key
    const fr = (finishing_route || '').toString().toLowerCase();
    let finishId = 'none';
    if (/vintage/.test(fr)) finishId = 'vintage_wash';
    else if (/peach|sueded|brush/.test(fr)) finishId = 'peach_finish';
    else if (/enzyme|garment\s*wash|wash|bio/.test(fr)) finishId = 'enzyme_wash';

    const lightSource = (light_source || illuminant || 'D65');
    // use the already-parsed fibre map ({cotton:60,polyester:40}) so blends shift correctly
    const compForPhysics = (parsedComp && parsedComp.fibers) ? parsedComp.fibers : composition;
    try {
      fabricPhysics = applyFabricPhysics(baseHex, compForPhysics, constructionId, finishId, lightSource);
    } catch (_) { fabricPhysics = null; }
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
    factoryLookup = lookupByGSM(factoryRef, gsm, resolveFamily(fabricDef.id, fabricDef.category));
    // Not every fabric family has real sampled data for every composition —
    // getCompositionReference() falls back to the 100%-cotton reference when
    // it doesn't (e.g. no real cotton-viscose or poly-dominant RIB records
    // exist). That fallback is silent at the data layer; surface it here so
    // (a) calculateCount() below knows to still apply the composition
    // modifier on top of the cotton baseline instead of returning raw cotton
    // numbers for a majority-polyester or viscose-blend fabric, and (b) the
    // user sees why.
    if (factoryRef._fallback_from) {
      factoryLookup.blend_fallback = true;
      warnings.push(`No real factory sample data for a ${factoryRef._fallback_from.replace(/_/g, ' ')} ${fabricDef.name} — using the 100% cotton reference as a base, adjusted for composition. Treat count/SL as indicative for this blend.`);
    }
    trace.push({ step: '1.8', action: 'factory_lookup', result: factoryLookup });
  }

  // --- 2. Calculate yarn count (with composition modifiers) ---
  const countResult = calculateCount(fabric, gsm, fabricDef, compModifiers, factoryLookup, parsedComp, composition);
  trace.push({ step: 2, action: 'count', ...countResult.trace });
  if (countResult.warning) warnings.push(countResult.warning);

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
      // Apply the combined composition × shade SL factor on top of the factory
      // base SL so colour shade (dark = looser, light = tighter) changes the SL.
      const slFactor = compModifiers.sl_factor || 1.0;
      const baseSl = factoryLookup.sl;
      const sl_mm = parseFloat((baseSl * slFactor).toFixed(3));
      const sl_cm = sl_mm / 10;
      llResult = {
        ll_mm: sl_mm,
        ll_cm: parseFloat(sl_cm.toFixed(5)),
        multiplier: fabricDef.ll_multiplier || 1.0,
        multiplier_source: 'FACTORY_R_D_RECORD',
        base_sl_mm: baseSl,
        sl_factor_applied: slFactor,
        trace: {
          formula: `Factory R&D base SL ${baseSl} mm × SL-factor ${slFactor} (composition+shade)`,
          result: `${sl_mm.toFixed(3)} mm (${sl_cm.toFixed(5)} cm)`,
          note: slFactor !== 1.0
            ? `Factory base ${baseSl} mm adjusted by ${slFactor}× for composition/shade → ${sl_mm} mm.`
            : 'Using verified factory R&D stitch length directly for maximum accuracy.',
          composition_sl_factor: slFactor,
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
    rndValidation = validateStitchLength(fabric, gsm, llResult.ll_mm, gauge, countResult.count_rounded, parsedComp, resolveFamily(fabricDef.id, fabricDef.category));
    if (rndValidation && rndValidation.valid === false) {
      warnings.push(`Calculated stitch length (${llResult.ll_mm} mm) differs from factory R&D data (${rndValidation.factory_sl} mm) by ${rndValidation.deviation_pct}%.`);
    }
  }

  // --- 3.55 EXPLICIT SL-BY-SHADE TABLE (factory concern: dark vs medium vs light) ---
  // Everyone on the floor asks "dark color e SL koto, light e koto?". So instead
  // of one SL we DECLARE all three shades side-by-side off the same neutral base.
  // Neutral base = the composition-adjusted SL with the colour-shade factor removed.
  let slByShade = null;
  if (llResult.ll_mm > 0) {
    // Remove whatever shade factor was applied to ll_mm to get the colour-neutral base.
    const appliedShadeFactor = colorResult ? (colorResult.sl_factor || 1.0) : 1.0;
    const neutralBaseSl = llResult.ll_mm / appliedShadeFactor;          // mm, colour-neutral
    // Same wet-processing model as the "Color Shade Impact" card and the
    // Wet-Processing Critical Path card — one grey-GSM number everywhere.
    const wetFamShades = resolveFamily(fabricDef.id, fabricDef.category);
    const rows = ['black','dark_navy','light_medium','fluorescent','white_melange','melange'].map(s => {
      const sp = classifyColorShade(s);
      const sl = parseFloat((neutralBaseSl * sp.sl_factor).toFixed(3));
      const greige = greigeGsmTarget(gsm, wetFamShades, s, dyeing_method);
      const greyGsm = greige ? greige.grey_gsm_target : parseFloat((gsm * sp.grey_gsm_factor).toFixed(1));
      return {
        shade: s,
        sl_mm: sl,
        sl_cm: parseFloat((sl / 10).toFixed(4)),
        sl_factor: sp.sl_factor,
        sl_direction: sp.sl_direction,
        grey_gsm: greyGsm,
        finished_gsm: gsm,
        dye_gain_pct: greige ? greige.dye_add_on_pct : sp.gsm_adjustment_pct,
        dyeing_tier: sp.dyeing_tier,
      };
    });
    // Map legacy shade names to 6-tier for selected_shade
    const shadeAliasMap = { dark:'dark_navy', medium:'light_medium', light:'white_melange', white:'white_melange' };
    const selectedShade6 = colorResult ? (shadeAliasMap[colorResult.shade] || colorResult.shade) : null;
    slByShade = {
      neutral_base_sl_mm: parseFloat(neutralBaseSl.toFixed(3)),
      selected_shade: selectedShade6,
      rows,
      note: 'DARK is knit LOOSER (longer SL) because dye adds mass; LIGHT/white is knit TIGHTER (shorter SL) since bleach adds almost no mass. All three are tuned to deliver the SAME finished GSM.',
      reference: 'SL spread derived from factory grey→finish dye-uptake data (dark ≈ +4% mass, medium ≈ +1.5%, light ≈ +0.5%).',
    };
    trace.push({ step: '3.55', action: 'sl_by_shade', result: rows.map(r => `${r.shade}:${r.sl_mm}mm`).join(' · ') });
  }

  // --- 3.6 Calculate Tightness Factor (TF) ---
  let tfResult = null;
  if (countResult.count_ne > 0 && llResult.ll_cm > 0) {
    // Determine TF limits for the fabric's real structural family via the same
    // FAB_BUCKET_ALIAS used for factory-data lookup (single_jersey/heavy_jersey/
    // rib/pique/interlock/waffle/fleece/terry) — NOT the coarse `category` field
    // (only 4 distinct values: single_jersey/rib/interlock/warp_knit). Matching
    // against `category` used to silently misroute every pile structure (terry,
    // fleece_2/3_thread, french_terry — all category:'single_jersey') and every
    // waffle/cardigan/milano variant (all category:'rib') to a limit band tuned
    // for plain jersey/rib instead of their own — terry/fleece's ground-yarn-only
    // TF runs far lower than a plain structure's, so this made the vast majority
    // of REAL terry/fleece production look falsely "too loose".
    const categoryKey = FAB_BUCKET_ALIAS[fabricDef.id] || 'default';
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
      // Cross-check the cover-factor gauge against what bulk factory bookings
      // actually use (mills run far finer than the cover-factor lower bound).
      const bulk = gaugeFromBulkData(fabricDef.category, countResult.count_ne);
      if (bulk) {
        const theory = optimalMachine.optimal_gauge;
        optimalMachine.bulk_data_gauge = {
          factory_gauge: bulk.gg,
          theory_gauge: theory,
          family: bulk.family,
          agrees: Math.abs(bulk.gg - theory) <= 2,
          note: Math.abs(bulk.gg - theory) <= 2
            ? `Bulk-production bookings confirm ~${bulk.gg} GG for ${countResult.count_ne}s — matches the cover-factor ${theory} GG.`
            : `Cover-factor gives ${theory} GG, but real bulk bookings for ${countResult.count_ne}s ${bulk.family} fabric run ~${bulk.gg} GG (modern loose/lycra fabrics knit finer). Use ${bulk.gg} GG to match buyer-approved hand-feel.`,
          source: 'Knitting Master File (5000+ bookings).',
        };
      }
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

  // --- 6.0e Real risk-assessment match (50 real production job records) ---
  // Same fibre-family classification used everywhere else real data is bucketed.
  let riskMatch = null;
  let riskCalibration = null;
  if (fabricDef.category !== 'warp_knit') {
    const fib = parsedComp ? (parsedComp.fibers || {}) : {};
    let riskComp = 'cotton';
    if (/modal/i.test(composition || '')) riskComp = 'modal';
    else if ((fib.viscose || 0) >= 15) riskComp = 'viscose';
    else if ((fib.polyester || 0) > 0 && (fib.polyester || 0) >= (fib.cotton || 0)) riskComp = 'pc';
    else if ((fib.polyester || 0) > 0) riskComp = 'cvc';

    riskMatch = matchRiskAssessment({
      construction: resolveFamily(fabricDef.id, fabricDef.category),
      comp: riskComp,
      gsm,
    });
    if (riskMatch && riskMatch.ok && riskMatch.show) {
      const s = riskMatch.matched.shrinkage;
      if (s.length && s.width) {
        // Source records shrinkage as signed (L=-6% = "shrank 6%"); the app's
        // model uses unsigned magnitude throughout.
        riskCalibration = { shrinkage_length: Math.abs(s.length.value_pct), shrinkage_width: Math.abs(s.width.value_pct) };
      }
      trace.push({ step: '6.0e', action: 'risk_assessment_match', result: `${riskMatch.matched.name} · dist ${riskMatch.distance} · ${riskMatch.confidence}` });
    }
  }

  // --- 6.1 Predictive Quality ---
  const qualityResult = predictQuality({
    fabric: fabricDef.id,
    category: fabricDef.category,
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
    // Real matched production job's measured shrinkage overrides the formula
    // prediction when a close (high-confidence) match exists — see step 6.0e.
    calibration: riskCalibration,
  });
  if (qualityResult.warnings && qualityResult.warnings.length) {
    qualityResult.warnings.forEach(w => warnings.push(w));
  }
  if (riskMatch && riskMatch.ok) {
    qualityResult.risk_match = riskMatch;
  }
  trace.push({ step: '6.1', action: 'quality_prediction', shrinkage: qualityResult.shrinkage, spirality: qualityResult.spirality });

  // --- 6.1b Finished width prediction (grey open width × width shrinkage) ---
  // Gives a specific FINISHED dia/width instead of a range, per factory request.
  if (optimalMachine && optimalMachine.ok && optimalMachine.dia && optimalMachine.dia.open_width_in) {
    const wShrink = qualityResult.shrinkage ? qualityResult.shrinkage.widthwise_pct : 0;
    const greyW = optimalMachine.dia.open_width_in;
    const finishedW = parseFloat((greyW * (1 - wShrink / 100)).toFixed(1));
    optimalMachine.finished_width = {
      grey_open_width_in: greyW,
      width_shrinkage_pct: wShrink,
      finished_open_width_in: finishedW,
      finished_open_width_cm: parseFloat((finishedW * 2.54).toFixed(1)),
      note: `Grey ${greyW}" open width − ${wShrink}% width shrinkage → ~${finishedW}" finished (deliver to buyer).`,
    };
  }

  // --- 6.1c Factory R&D data match (real greige→finish records) ---
  let factoryMatch = null;
  if (fabricDef.category !== 'warp_knit' && countResult.count_ne) {
    // Map composition → fibre class used by the dataset.
    const fib = parsedComp ? (parsedComp.fibers || {}) : { cotton: 100 };
    let compClass = 'cotton';
    if ((fib.polyester || 0) > 50) compClass = 'pc';
    else if ((fib.polyester || 0) >= 20) compClass = 'cvc';
    else if ((fib.modal || 0) >= 30) compClass = 'modal';
    else if ((fib.viscose || 0) >= 50) compClass = 'viscose';
    const seg = colorResult ? colorResult.shade : 'medium';
    factoryMatch = matchFactory({
      fabric: fabricDef.id,
      count_ne: countResult.count_ne,
      gsm,
      gauge: gauge || (optimalMachine && optimalMachine.ok ? optimalMachine.optimal_gauge : null),
      dia,
      color_segment: seg,
      comp: compClass,
    });
    if (factoryMatch && factoryMatch.ok) {
      factoryMatch.count_recommendation = recommendCountFromGSM(fabricDef.id, gsm, compClass);
      trace.push({ step: '6.1c', action: 'factory_match', result: `SL ${factoryMatch.prediction.stitch_length_mm}mm · finish ${factoryMatch.prediction.finished_gsm} GSM · ${factoryMatch.confidence} (${factoryMatch.confidence_pct}%)` });
    }
  }

  // --- 6.1d Process loss (grey booking → finished delivery), bulk-data model ---
  // Infer wet/mechanical processes from the fabric + finishing route so the
  // floor knows how much extra grey to book. (Knitting Master File loss column.)
  let processLoss = null;
  {
    const seg = colorResult ? colorResult.shade : 'medium';
    const procs = [];
    const cat = fabricDef.category || '';
    const fid = fabricDef.id || '';
    if (cat === 'fleece' || /fleece|terry/.test(fid)) procs.push('brush');
    if (finishing_route === 'garment_wash' || /wash/.test(finishing_route || '')) procs.push('garment_wash');
    if (finishing_route === 'peach' || /peach|sueded/.test(finishing_route || '')) procs.push('peach');
    processLoss = estimateProcessLoss(seg, procs);
    // Worked example: grey to book for 100 kg finished.
    processLoss.example_100kg = greyRequirementForFinished(100, seg, procs);
    trace.push({ step: '6.1d', action: 'process_loss', result: `${processLoss.loss_pct}% grey→finish (${seg}${procs.length ? ' + ' + procs.join('+') : ''})` });
  }

  // --- 6.1e Wet-Processing Critical Path (greige GSM + machine-wise problems) ---
  // Fabrication + GSM based critical path: what grey GSM to knit before dyeing,
  // and the machine-by-machine problem/cause/solution/remedy for this fabric,
  // shade and dyeing method. The expert "explain the whole critical path" answer.
  let wetProcessing = null;
  if (fabricDef.category !== 'warp_knit' && gsm) {
    const fib = parsedComp ? (parsedComp.fibers || {}) : { cotton: 100 };
    const wpProcs = [];
    const cat2 = fabricDef.category || '';
    const fid2 = fabricDef.id || '';
    if (cat2 === 'fleece' || /fleece|terry/.test(fid2)) wpProcs.push('brush');
    if (finishing_route === 'garment_wash' || /wash/.test(finishing_route || '')) wpProcs.push('garment_wash');
    if (finishing_route === 'peach' || /peach|sueded/.test(finishing_route || '')) wpProcs.push('peach');
    wetProcessing = analyzeWetProcessing({
      fabric: fabricDef.id,
      category: fabricDef.category,
      finish_gsm: gsm,
      shade: colorResult ? colorResult.shade : 'medium',
      dyeing_method: dyeing_method,
      fibers: fib,
      spinning: spinning_system || (yarnExpertise ? yarnExpertise.spinning_system : null),
      processes: wpProcs,
    });
    if (wetProcessing && wetProcessing.ok) {
      trace.push({ step: '6.1e', action: 'wet_processing', result: `Grey ${wetProcessing.greige.grey_gsm_target} g/m² → finish ${gsm} · ${wetProcessing.machine_critical_path.length} machine stages · ${wetProcessing.dyeing_method}` });
    }
  }

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
    // Explicit mill yarn type + footnote surcharge options (SM price list)
    yarn_type: params.yarn_price_type || null,
    white: !!params.yarn_white,
    organic: !!params.yarn_organic,
    organic_type: params.yarn_organic_type || 'gots',
    slub: !!params.yarn_slub || (yarn_form === 'slub'),
    siro: !!params.yarn_siro,
    ecovero: !!params.yarn_ecovero,
    at_sight: !!params.yarn_at_sight,
    yarn_form,
    feeder_type: params.feeder_type || null, // 'ff' (full feeder) | 'hf' (half feeder, default) — lycra rib knitting-cost tier
  });
  trace.push({ step: '6.2', action: 'costing', total_usd_per_kg: costResult.cost_breakdown_usd.total_per_kg });

  // --- 6.3 Dynamic Pattern & Structural Adaptation ---
  const patternResult = getEnginePattern(fabricDef.id, gsm, gauge, composition);
  trace.push({ step: '6.3', action: 'generate_pattern', result: patternResult ? 'SUCCESS' : 'FAILED' });

  // --- 6.4 Production Critical Path Analysis (CPA) ---
  // CPA always runs: when the user omits machine specs, fall back to the
  // OPTIMAL machine (single Dia × Gauge) so the analysis is never empty.
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
    // fallbacks + enrichment
    optimal: optimalMachine && optimalMachine.ok ? optimalMachine : null,
    yarnUster: yarnExpertise && yarnExpertise.uster ? yarnExpertise.uster : null,
    yarnTorqueType: yarnExpertise ? yarnExpertise.quality_engine_yarn_type : null,
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
      color_input: color_input || null,
      effective_shade: effectiveShade || null,
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

    // Precise color from the Color Engine (exact hex/name/family/temperature/shade_tier).
    // Drives the realistic fabric visualization. Null when the user only picked a shade mode.
    color_resolved: colorResolved ? {
      hex: colorResolved.hex,
      rgb: colorResolved.rgb,
      hsl: colorResolved.hsl,
      lab: colorResolved.lab || null,
      name: colorResolved.name,
      family: colorResolved.family,
      temperature: colorResolved.temperature,
      shade_tier: colorResolved.shade_tier,
      tcx_code: colorResolved.tcx_code || null,
      tcx_label: colorResolved.tcx_label || null,
      scotdic_label: colorResolved.scotdic_label || null,
      bros_label: colorResolved.bros_label || null,
      archroma_label: colorResolved.archroma_label || null,
      nearest_tcx: colorResolved.nearest_tcx || null,
      source: 'color_engine',
      derived_shade: !color_shade,
    } : null,

    // Optical physics: dye × fibre × construction × finish × illuminant.
    // rendered_color.hex = how the dye actually reads on this finished cloth;
    // physics.{specular_sheen,roughness,shadow_depth,texture_modifier} drive the
    // 3D/2D material. Computed by fabric-physics engine.
    fabric_physics: fabricPhysics,

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

    sl_by_shade: slByShade,

    wet_processing: (wetProcessing && wetProcessing.ok) ? wetProcessing : null,

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
      risk_match:           qualityResult.risk_match || null,
    } : null,

    // Real factory R&D data match (greige→finish records)
    factory_prediction: (factoryMatch && factoryMatch.ok) ? factoryMatch : null,

    // Bulk-production process loss (grey booking → finished delivery)
    process_loss: processLoss,

    costing: costResult ? {
      raw_material_per_kg_usd:  costResult.cost_breakdown_usd.raw_material.with_waste_per_kg,
      knitting_per_kg_usd:      costResult.cost_breakdown_usd.knitting,
      dyeing_per_kg_usd:        costResult.cost_breakdown_usd.dyeing.per_kg,
      finishing_per_kg_usd:     costResult.cost_breakdown_usd.finishing,
      total_per_kg_usd:         costResult.cost_breakdown_usd.total_per_kg,
      margin_scenarios:         costResult.margin_scenarios,
      fiber_detail:             costResult.cost_breakdown_usd.raw_material.fiber_detail,
      // Mill yarn pricing detail (SM price list)
      yarn_type_label:          costResult.yarn.type_label,
      yarn_base_price_usd:      costResult.yarn.base_price_usd,
      yarn_surcharges:          costResult.yarn.surcharges,
      yarn_final_price_usd:     costResult.yarn.final_price_usd,
      yarn_price_source:        costResult.yarn.source,
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
    color_input: p.color_input ? String(p.color_input).trim() : null,
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
    // Wet-processing critical path: dyeing method (reactive default)
    dyeing_method: p.dyeing_method ? String(p.dyeing_method).trim() : null,
    // Continuous dye-depth override (% OWF) — replaces the 6-tier shade
    // button with a real dye-concentration value when provided.
    shade_depth_pct: (p.shade_depth_pct !== undefined && p.shade_depth_pct !== null && p.shade_depth_pct !== '')
      ? parseFloat(p.shade_depth_pct) : null,
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

    // Build elastane declaration string — denier/feed tiers mirror
    // composition-engine.js's getCompositionModifiers() exactly, up through
    // the power-mesh/foundation tier (>22%), so the printed yarn declaration
    // never disagrees with the denier the count/SL calculation actually used.
    if (elastanePct > 0) {
      let elDen = 40;
      if (elastanePct <= 3) elDen = 20;
      else if (elastanePct <= 10) elDen = 40;
      else if (elastanePct <= 22) elDen = 70;
      else elDen = 140;
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
    } else if (fabricId !== 'heavy_jersey' && num >= 6 && num <= 14) {
      // Below ~14 Ne, a single cotton yarn is weak/hairy and uncommon on its
      // own — mills commonly ply a finer yarn instead (e.g. heavy sweater-
      // weight rib at 10/1 is usually really 20/2). Surface the equivalent
      // 2-ply spec as an alternative, same convention already used for
      // heavy_jersey above.
      const doubleCount = num * 2;
      baseDecl += ` [or ${doubleCount}/1 × 2 Ply]`;
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

  // Multi-yarn fabrics (terry, fleece, french_terry) — checked BEFORE the
  // generic factory-knowledge lookup below. These structures need a separate
  // ground+loop(+binder) declaration and feed calculateConsumption()'s
  // Ground/Loop-count parsing (regex against count_display) — the generic
  // single-count factory lookup would silently produce a single-yarn
  // declaration with no "Ground"/"Loop" substrings and break that downstream
  // calc, even though COMPOSITION_REFERENCE now also has entries for these
  // fabrics' real fab bucket (used for their SL, not their count/declaration).
  if (fabricDef.count_formula && fabricDef.count_formula.type === 'multi_yarn') {
    return lookupMultiYarnCount(fabricId, gsm, fabricDef, parsedComp, rawInputStr);
  }

  // If factory knowledge has an exact/interpolated count, prefer it
  if (factoryLookup && factoryLookup.count_ne) {
    // Real matched-composition data already reflects that blend's true
    // count/GSM relationship — applying the generic composition modifier on
    // top would double-correct. But when the lookup had to FALL BACK to the
    // 100%-cotton reference because no real data exists for this fabric's
    // actual blend (factoryLookup.blend_fallback, set in calculate() from
    // getCompositionReference()'s _fallback_from), the raw number is a pure-
    // cotton number wearing a blend's clothes — apply the modifier so a
    // majority-polyester or viscose-heavy fabric doesn't come back identical
    // to 100% cotton.
    const fCount = factoryLookup.blend_fallback ? factoryLookup.count_ne * countFactor : factoryLookup.count_ne;
    const count_rounded = roundToStandardCount(fCount); // snap to standard commercial sizes
    const advanced_display = generateYarnDeclaration(parsedComp, count_rounded, rawInputStr, fabricId);
    return {
      count_ne: count_rounded,
      count_ne_exact: parseFloat(fCount.toFixed(2)),
      count_display: advanced_display,
      count_rounded,
      source: factoryLookup.source || 'FACTORY_KNOWLEDGE',
      trace: {
        formula: factoryLookup.blend_fallback
          ? `Factory knowledge lookup (GSM=${gsm}, 100% cotton reference × composition factor ${countFactor} — no real sample data for this blend)`
          : `Factory knowledge lookup (GSM=${gsm}, composition-aware)`,
        result: `${fCount.toFixed(2)} Ne → snapped to standard ${count_rounded}/1 Ne`,
        source: factoryLookup.source,
        composition_factor: countFactor,
        blend_fallback: !!factoryLookup.blend_fallback,
      }
    };
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
  // This linear model is only trustworthy near the GSM span it was fit on —
  // outside that it can predict zero/negative Ne, which roundToStandardCount()
  // would otherwise silently floor to 6/1 with no indication anything was
  // wrong. Flag it instead so the caller can surface a warning.
  if (reg && reg.a !== undefined && reg.a !== null) {
    const count_base = reg.a * gsm + reg.b;
    const count_adjusted = count_base * countFactor;
    // Snap to standard commercial count
    const count_rounded = roundToStandardCount(count_adjusted);
    const advanced_display = generateYarnDeclaration(parsedComp, count_rounded, rawInputStr, fabricId);
    const outOfModelRange = count_adjusted < 6 || count_adjusted > 80;

    return {
      count_ne: count_rounded, // integer — decimal counts are not used in industry declarations
      count_ne_exact: parseFloat(count_adjusted.toFixed(2)), // exact value kept in trace only
      count_display: advanced_display,
      count_rounded,
      source: reg.source,
      warning: outOfModelRange
        ? `GSM ${gsm} pushes the ${fabricId.replace(/_/g, ' ')} count formula outside its reliable range (raw estimate ${count_adjusted.toFixed(1)} Ne, clamped to ${count_rounded}/1) — no factory sample data covers this GSM for this fabric; treat the count as indicative only.`
        : null,
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
        out_of_model_range: outOfModelRange,
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

/**
 * Interpolate/extrapolate a ground+loop yarn-count row for a target GSM from a
 * GSM_COUNT_LOOKUP multi-yarn table. Previously this just snapped to the
 * NEAREST table row regardless of distance — e.g. any GSM above the table's
 * last point (280/340) silently reused that edge row verbatim, no matter how
 * far off. Now it interpolates between the two bracketing rows, or — beyond
 * the table's range — extrapolates ground/loop count from the last segment's
 * slope (floored at a physically spinnable minimum) so heavy fabrics get a
 * reasoned estimate instead of a stale light-GSM recipe.
 */
function interpolateMultiYarnRow(table, gsm) {
  const sorted = [...table].sort((a, b) => a.gsm - b.gsm);
  const exact = sorted.find(r => r.gsm === gsm);
  if (exact) return { ...exact, source: 'PDF_VERIFIED' };

  let lower = null, upper = null;
  for (const r of sorted) {
    if (r.gsm <= gsm) lower = r;
    if (r.gsm > gsm && !upper) upper = r;
  }

  if (lower && upper) {
    const ratio = (gsm - lower.gsm) / (upper.gsm - lower.gsm);
    const nearest = ratio < 0.5 ? lower : upper;
    return {
      ...nearest,
      gsm,
      ground_count: Math.round((lower.ground_count + ratio * (upper.ground_count - lower.ground_count)) * 10) / 10,
      loop_count: (lower.loop_count && upper.loop_count)
        ? Math.round((lower.loop_count + ratio * (upper.loop_count - lower.loop_count)) * 10) / 10
        : nearest.loop_count,
      source: 'FACTORY_INTERPOLATED',
    };
  }

  // Beyond the table's range — extrapolate from the last real segment's slope.
  if (sorted.length >= 2) {
    const useUpperEnd = lower != null;
    const a = useUpperEnd ? sorted[sorted.length - 2] : sorted[0];
    const b = useUpperEnd ? sorted[sorted.length - 1] : sorted[1];
    const anchor = useUpperEnd ? b : a;
    const dGsm = gsm - anchor.gsm;
    const slopeGround = (b.ground_count - a.ground_count) / (b.gsm - a.gsm);
    const ground_count = Math.max(4, Math.round((anchor.ground_count + slopeGround * dGsm) * 10) / 10);
    let loop_count = anchor.loop_count;
    if (a.loop_count && b.loop_count) {
      const slopeLoop = (b.loop_count - a.loop_count) / (b.gsm - a.gsm);
      loop_count = Math.max(4, Math.round((anchor.loop_count + slopeLoop * dGsm) * 10) / 10);
    }
    return { ...anchor, gsm, ground_count, loop_count, source: 'FACTORY_EXTRAPOLATED' };
  }

  const only = sorted[0];
  return { ...only, source: 'FACTORY_NEAREST' };
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

  const best = interpolateMultiYarnRow(table, gsm);

  const result = {
    count_ne: best.ground_count || best.gsm,
    count_display: `Ground: ${generateYarnDeclaration(parsedComp, best.ground_count, rawInputStr)}`,
    count_rounded: best.ground_count,
    source: best.source,
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
    formula: `Multi-yarn lookup (GSM=${gsm}, ${best.source})`,
    result: result.count_display,
    source: best.source === 'PDF_VERIFIED' ? 'PDF_VERIFIED — GSMtoCountConversion.pdf p.1' : best.source,
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
