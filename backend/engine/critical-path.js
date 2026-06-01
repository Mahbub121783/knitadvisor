/**
 * KnitAdvisor — Knitting Production Critical Path Analysis (CPA) Engine
 * 
 * Performs master-level technical checks for circular and double-bed knitting
 * including hook collision indices, spirality skewness, cam timing, take-down
 * tension requirements, and safe mechanical speed limits.
 */

const { UnitConverter } = require('./formulas');

function analyzeCriticalPath(params) {
  const {
    fabricId,
    category,
    gsm,
    countNe,
    loopLengthMm,
    dia,
    gauge,
    feeders,
    rpm,
    composition,
    yarnType,
  } = params;

  const steps = [];
  const warnings = [];

  // 1. Yarn-to-Needle Slot Clearance & Collision Index
  let yarnDiaMm = null;
  let slotWidthMm = null;
  let collisionIndex = null;
  let clearanceStatus = 'UNKNOWN';
  let clearanceRecommendation = '';

  if (countNe && countNe > 0 && gauge && gauge > 0) {
    // Outer yarn diameter in mm: D = 25.4 / (28 * sqrt(Ne))
    yarnDiaMm = parseFloat((25.4 / (28 * Math.sqrt(countNe))).toFixed(4));
    
    // Slot width (pitch clearing space) in mm: W = (0.6 / G) * 25.4
    slotWidthMm = parseFloat(((0.6 / gauge) * 25.4).toFixed(4));
    
    // Collision index for double thread thickness passing through slot
    collisionIndex = parseFloat(((2 * yarnDiaMm) / slotWidthMm).toFixed(3));

    if (collisionIndex > 0.85) {
      clearanceStatus = 'CRITICAL_TIGHT';
      clearanceRecommendation = `Yarn is too thick for machine gauge ${gauge} GG. High risk of needle collisions, butt breakage, and high knitting tension. Recommend reducing count to at least ${Math.round(countNe * 1.3)}/1 Ne or moving to a coarser ${Math.max(14, gauge - 4)} GG machine.`;
      warnings.push(`CPA: Yarn-to-Slot clearance index (${collisionIndex}) is critical. High risk of needle breakage.`);
    } else if (collisionIndex < 0.35) {
      clearanceStatus = 'WARNING_LOOSE';
      clearanceRecommendation = `Yarn is too thin for machine gauge ${gauge} GG. Risk of drop stitches, needle marks, pinholes, and poor fabric stability. Recommend increasing count to at least ${Math.round(countNe * 0.75)}/1 Ne or moving to a finer ${gauge + 4} GG machine.`;
      warnings.push(`CPA: Yarn-to-Slot clearance index (${collisionIndex}) is too loose. Risk of drop stitches.`);
    } else {
      clearanceStatus = 'SAFE';
      clearanceRecommendation = `Yarn diameter (${yarnDiaMm} mm) fits safely inside needle slot clearing space (${slotWidthMm} mm). Clearance index: ${collisionIndex}.`;
    }
  }

  // 2. Torque & Spirality Skewness Angle
  let spiralityAngle = null;
  let spiralityRisk = 'UNKNOWN';
  let spiralityMitigation = '';

  const isSingleBed = ['single_jersey'].includes(category);
  if (isSingleBed && dia && gauge && feeders) {
    // Pitch feed angle factor
    const pitchFactor = feeders / (dia * gauge);
    
    // Torque factor based on yarn type / process
    let torqueFactor = 1.0;
    const descLower = (composition || '').toLowerCase() + ' ' + (yarnType || '').toLowerCase();
    
    if (descLower.includes('carded')) torqueFactor = 1.4;
    else if (descLower.includes('combed')) torqueFactor = 1.1;
    else if (descLower.includes('polyester') || descLower.includes('poly') || descLower.includes('viscose')) torqueFactor = 0.7;
    else if (descLower.includes('cvc')) torqueFactor = 1.25;
    else if (descLower.includes('pc')) torqueFactor = 0.9;
    
    if (descLower.includes('vortex') || descLower.includes('open end') || descLower.includes('oe')) {
      torqueFactor *= 0.75;
    }

    // Spirality angle estimate (empirical scaling)
    spiralityAngle = parseFloat((pitchFactor * torqueFactor * 4.5 * 10).toFixed(2));

    if (spiralityAngle > 7.0) {
      spiralityRisk = 'HIGH';
      spiralityMitigation = `Feeder pitch angle is high (${spiralityAngle}° skewness). Twist-balancing is CRITICAL. Plated cotton must alternate S-twist and Z-twist yarns on adjacent feeders, or use finishing compactors and twist-set heat setting.`;
      warnings.push(`CPA: High fabric spirality risk (${spiralityAngle}° skewness). Twist-balancing required.`);
    } else if (spiralityAngle > 4.0) {
      spiralityRisk = 'MEDIUM';
      spiralityMitigation = `Moderate spirality risk (${spiralityAngle}° skewness). Balanced take-up tension and standard wash relaxation finishing are recommended.`;
    } else {
      spiralityRisk = 'LOW';
      spiralityMitigation = `Low spirality risk (${spiralityAngle}° skewness). Feeder angle is balanced. Fabric twist is naturally stable.`;
    }
  } else if (!isSingleBed) {
    spiralityAngle = 0.0;
    spiralityRisk = 'LOW';
    spiralityMitigation = 'Double-bed structures are balanced and have no spirality risk due to opposing loop loops locking the torque.';
  }

  // 3. Cam Timing & Robbing Indexes
  let optimalTiming = 'Synchronized';
  let timingAdvantage = 'Normal operation';
  let sinkerSetting = 'Normal / Standard push point';
  let gatingType = 'N/A';

  const isDoubleBed = ['rib', 'interlock'].includes(category);
  if (isDoubleBed) {
    gatingType = category === 'interlock' ? 'Interlock Gating (groove-to-groove aligned)' : 'Rib Gating (offset interleaved)';
    
    // Evaluate Tightness Factor (TF) to recommend timing
    let tf = null;
    if (countNe && countNe > 0 && loopLengthMm && loopLengthMm > 0) {
      const tex = UnitConverter.neToTex(countNe);
      tf = Math.round((Math.sqrt(tex) / (loopLengthMm / 10)) * 100) / 100;
    }

    if (tf && tf > 15.5) {
      optimalTiming = 'Delayed Timing';
      timingAdvantage = `High tightness factor (${tf}) requires dial needles to draw loops after cylinder needles. This lets dial rob yarn from cylinder, reducing loop stress by up to 30% to prevent yarn snap.`;
      sinkerSetting = 'Late Setting (holds loop tension down)';
    } else {
      optimalTiming = 'Synchronized Timing';
      timingAdvantage = 'Low tightness allows simultaneous loop drawing, maximizing bulk, fabric stretch, and loop shape.';
      sinkerSetting = 'Standard / Early Setting';
    }
  } else {
    gatingType = 'Single Bed (Cylinder only)';
    optimalTiming = 'Cylinder Cam Timing';
    timingAdvantage = 'Standard sinker loop formation control.';
    sinkerSetting = 'Sinker push point set to match stitch drawing depth.';
  }

  // 4. Take-down Tension Recommendations
  let tensionGPerNeedle = null;
  let totalTakedownLoadKg = null;
  let needlesCount = null;

  if (gsm && gsm > 0 && dia && dia > 0 && gauge && gauge > 0) {
    needlesCount = Math.round(Math.PI * dia * gauge);
    
    let baseTension = 0.012; // SJ
    if (category === 'rib') baseTension = 0.022;
    else if (category === 'interlock') baseTension = 0.026;

    // Grams per needle based on density and bed friction
    tensionGPerNeedle = parseFloat((gsm * baseTension * 0.08).toFixed(3));
    
    // Total machine take-down weight load in kg
    totalTakedownLoadKg = parseFloat(((tensionGPerNeedle * needlesCount) / 1000).toFixed(2));
  }

  // 5. Maximum Running Speed Limits
  let maxRPM = null;
  let rpmStatus = 'SAFE';
  let rpmWarning = '';

  if (dia && dia > 0 && gauge && gauge > 0) {
    // RPM max empirical base: 16500 / (dia * sqrt(G))
    let rpmBase = 16500 / (dia * Math.sqrt(gauge));
    
    // Delayed timing places high stress on needle butts, restrict by 10%
    if (optimalTiming === 'Delayed Timing') {
      rpmBase *= 0.90;
    }
    
    maxRPM = Math.round(rpmBase);

    if (rpm && rpm > maxRPM) {
      rpmStatus = 'EXCEEDS_SAFE_LIMIT';
      rpmWarning = `Machine RPM (${rpm}) exceeds safe mechanical threshold of ${maxRPM} RPM for this gauge/diameter. Running at this speed will accelerate needle butt fracture, latch wear, and cause yarn tension breaks.`;
      warnings.push(`CPA: Machine RPM exceeds safe running speed limit (${maxRPM} RPM).`);
    } else {
      rpmStatus = 'SAFE';
      rpmWarning = `RPM (${rpm || 'not specified'}) is within the safe mechanical ceiling of ${maxRPM} RPM.`;
    }
  }

  return {
    clearance: {
      yarn_diameter_mm: yarnDiaMm,
      slot_width_mm: slotWidthMm,
      collision_index: collisionIndex,
      status: clearanceStatus,
      recommendation: clearanceRecommendation,
    },
    spirality: {
      angle_degrees: spiralityAngle,
      risk: spiralityRisk,
      mitigation: spiralityMitigation,
    },
    setup: {
      gating_type: gatingType,
      cam_timing: optimalTiming,
      timing_advantage: timingAdvantage,
      sinker_setting: sinkerSetting,
      tension_g_per_needle: tensionGPerNeedle,
      total_load_kg: totalTakedownLoadKg,
      active_needles: needlesCount,
    },
    speed: {
      max_rpm: maxRPM,
      status: rpmStatus,
      warning: rpmWarning,
    },
    warnings,
  };
}

module.exports = {
  analyzeCriticalPath,
};
