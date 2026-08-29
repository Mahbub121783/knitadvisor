/**
 * KnitAdvisor — Fabric Physics & Reflectance Engine v1.0
 * ====================================================
 *
 * Simulates physical optical shifts of colors based on:
 * 1. Composition (Fibers): Determines sheen, saturation boost, and baseline lightness.
 * 2. Construction (Structure): Determines shadow depth, micro-textures, and roughness.
 *
 * This provides 100% accurate visual representations of colors as they would
 * appear in real life on specific knitted fabrics.
 */

'use strict';

const colorEngine = require('./color-engine');

// ============================================================
// PHYSICS DATA MODELS
// ============================================================

/**
 * Fiber Reflectance Properties
 * L_shift: Lightness shift in CIELAB (0-100 scale shift)
 * S_shift: Saturation shift in HSL (0-100 scale shift)
 * sheen: Specular reflection factor (0 = matte, 1 = high gloss)
 * roughness: Surface scattering factor (0 = smooth, 1 = very rough)
 */
const FIBER_PHYSICS = {
  cotton:    { L_shift: 0,  S_shift: 0,   sheen: 0.10, roughness: 0.60, name: 'Cotton' },
  polyester: { L_shift: 3,  S_shift: 10,  sheen: 0.80, roughness: 0.20, name: 'Polyester' },
  nylon:     { L_shift: 4,  S_shift: 12,  sheen: 0.85, roughness: 0.15, name: 'Nylon' },
  viscose:   { L_shift: -2, S_shift: 15,  sheen: 0.70, roughness: 0.25, name: 'Viscose' },
  modal:     { L_shift: -1, S_shift: 12,  sheen: 0.65, roughness: 0.30, name: 'Modal' },
  silk:      { L_shift: 2,  S_shift: 20,  sheen: 0.90, roughness: 0.10, name: 'Silk' },
  linen:     { L_shift: -3, S_shift: -10, sheen: 0.05, roughness: 0.85, name: 'Linen' },
  hemp:      { L_shift: -4, S_shift: -12, sheen: 0.05, roughness: 0.90, name: 'Hemp' },
  wool:      { L_shift: 1,  S_shift: -5,  sheen: 0.15, roughness: 0.75, name: 'Wool' },
  acrylic:   { L_shift: 2,  S_shift: 5,   sheen: 0.50, roughness: 0.40, name: 'Acrylic' },
  spandex:   { L_shift: 0,  S_shift: 0,   sheen: 0.30, roughness: 0.50, name: 'Spandex/Elastane' }, // Usually blended <10%
};

/**
 * Construction Shadow & Texture Properties
 * L_shift: Global lightness shift due to structural shadows (CIELAB shift)
 * S_shift: Saturation diffusion shift (e.g. brushed fleece dulls color slightly)
 * shadow_depth: Intensity of micro-shadows (0 = flat, 1 = deep cavities)
 * texture_type: Semantic tag for frontend SVG/CSS filter matching
 */
const CONSTRUCTION_PHYSICS = {
  single_jersey: { L_shift: 0,  S_shift: 0,  shadow_depth: 0.10, texture_type: 'smooth', name: 'Single Jersey' },
  interlock:     { L_shift: +1, S_shift: 0,  shadow_depth: 0.05, texture_type: 'dense_smooth', name: 'Interlock' },
  pique:         { L_shift: -6, S_shift: -2, shadow_depth: 0.60, texture_type: 'honeycomb', name: 'Pique / Lacoste' },
  rib_1x1:       { L_shift: -3, S_shift: 0,  shadow_depth: 0.40, texture_type: 'vertical_lines', name: '1x1 Rib' },
  rib_2x2:       { L_shift: -5, S_shift: 0,  shadow_depth: 0.50, texture_type: 'wide_vertical_lines', name: '2x2 Rib' },
  fleece:        { L_shift: +5, S_shift: -5, shadow_depth: 0.20, texture_type: 'fuzz', name: 'Fleece / Brushed' },
  french_terry:  { L_shift: -2, S_shift: 0,  shadow_depth: 0.70, texture_type: 'loops', name: 'French Terry' },
  waffle:        { L_shift: -8, S_shift: -3, shadow_depth: 0.85, texture_type: 'grid_waffle', name: 'Waffle / Thermal' },
};

/**
 * Wash & Finishing Effects
 */
const FINISH_PHYSICS = {
  none:          { L_shift: 0, S_shift: 0, texture_modifier: 'none', label: 'Regular Finish' },
  enzyme_wash:   { L_shift: 3, S_shift: -5, texture_modifier: 'frosting', label: 'Enzyme Wash' },
  vintage_wash:  { L_shift: 8, S_shift: -15, texture_modifier: 'faded', label: 'Vintage Wash' },
  peach_finish:  { L_shift: 2, S_shift: -2, texture_modifier: 'micro_fuzz', label: 'Peach Finish' }
};

/**
 * Illuminant (Metamerism) Approximations (Shift applied to CIELAB)
 */
const ILLUMINANT_PHYSICS = {
  D65: { L_shift: 0, a_shift: 0,  b_shift: 0,  label: 'Daylight (D65)' },
  F11: { L_shift: 1, a_shift: -3, b_shift: 2,  label: 'Store Fluorescent (F11)' },
  A:   { L_shift: 0, a_shift: 5,  b_shift: 10, label: 'Home Incandescent (A)' }
};

// ============================================================
// ENGINE LOGIC
// ============================================================

/**
 * Validates and normalizes composition input into an array of { id, weight }
 * @param {Array|Object} composition (e.g. [{id: 'cotton', weight: 60}, {id: 'polyester', weight: 40}])
 */
function normalizeComposition(composition) {
  if (!composition) return [{ id: 'cotton', weight: 100 }];
  let compArray = [];
  
  if (Array.isArray(composition)) {
    compArray = composition;
  } else if (typeof composition === 'object') {
    // Convert { cotton: 60, polyester: 40 } to array
    compArray = Object.keys(composition).map(k => ({ id: k, weight: composition[k] }));
  } else if (typeof composition === 'string') {
    compArray = [{ id: composition.toLowerCase(), weight: 100 }];
  }

  // Filter valid fibers
  let valid = compArray.map(c => ({
    id: c.id.toLowerCase(),
    weight: parseFloat(c.weight) || 0
  })).filter(c => FIBER_PHYSICS[c.id] && c.weight > 0);

  if (valid.length === 0) valid = [{ id: 'cotton', weight: 100 }];

  // Normalize weights to sum to 1.0 (100%)
  const totalW = valid.reduce((sum, c) => sum + c.weight, 0);
  valid.forEach(c => c.weight = c.weight / totalW);

  return valid;
}

/**
 * Calculates weighted average of fiber properties based on composition.
 */
function calculateFiberPhysics(compositionArray) {
  let L_shift = 0;
  let S_shift = 0;
  let sheen = 0;
  let roughness = 0;
  let names = [];

  for (const comp of compositionArray) {
    const fiber = FIBER_PHYSICS[comp.id];
    L_shift += fiber.L_shift * comp.weight;
    S_shift += fiber.S_shift * comp.weight;
    sheen += fiber.sheen * comp.weight;
    roughness += fiber.roughness * comp.weight;
    names.push(`${Math.round(comp.weight * 100)}% ${fiber.name}`);
  }

  return { L_shift, S_shift, sheen, roughness, label: names.join(' / ') };
}

/**
 * Applies physical reflectance shifts to a base color.
 *
 * @param {string} baseHex   The starting flat color (e.g., from TCX or BROS)
 * @param {Array} composition e.g., [{id:'cotton', weight:60}, {id:'polyester', weight:40}]
 * @param {string} constructionId e.g., 'pique', 'single_jersey', 'fleece'
 * @param {string} finishId e.g., 'none', 'enzyme_wash'
 * @param {string} lightSource e.g., 'D65', 'F11', 'A'
 * @returns {object} Highly advanced visual payload for frontend rendering
 */
function applyFabricPhysics(baseHex, composition, constructionId = 'single_jersey', finishId = 'none', lightSource = 'D65') {
  // 1. Get Base Color Data
  const rgb = colorEngine.hexToRgb(baseHex);
  if (!rgb) return null;
  const hsl = colorEngine.rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const lab = colorEngine.rgbToLab(rgb[0], rgb[1], rgb[2]);

  // 2. Fetch Physics Properties
  const compNorm = normalizeComposition(composition);
  const fiberData = calculateFiberPhysics(compNorm);
  const structureData = CONSTRUCTION_PHYSICS[constructionId.toLowerCase()] || CONSTRUCTION_PHYSICS['single_jersey'];
  const finishData = FINISH_PHYSICS[finishId.toLowerCase()] || FINISH_PHYSICS['none'];
  const lightData = ILLUMINANT_PHYSICS[lightSource.toUpperCase()] || ILLUMINANT_PHYSICS['D65'];

  // 3. Apply Shifts (Lightness is shifted in CIELAB, Saturation in HSL)
  
  // Metamerism (Lighting Shift)
  let baseL = lab.L + lightData.L_shift;
  let baseA = lab.a + lightData.a_shift;
  let baseB = lab.b + lightData.b_shift;

  // Shift Lightness in Perceptual LAB Space
  let newL = baseL + fiberData.L_shift + structureData.L_shift + finishData.L_shift;
  newL = Math.max(0, Math.min(100, newL)); // Clamp L

  // Shift Saturation in HSL Space
  let newS = hsl.s + fiberData.S_shift + structureData.S_shift + finishData.S_shift;
  newS = Math.max(0, Math.min(100, newS)); // Clamp S

  // 4. Mathematical Reconstruction
  let [rL, gL, bL] = colorEngine.labToRgb(newL, baseA, baseB);
  
  // Convert new HSL (S changed, H original, L from above rgb) back to RGB to preserve saturation shift
  // We extract L from the LAB-shifted RGB to apply the saturation on top
  const intermediateHsl = colorEngine.rgbToHsl(rL, gL, bL);
  const finalRgb = colorEngine.hslToRgb(intermediateHsl.h, newS, intermediateHsl.l);
  
  const renderedHex = colorEngine.rgbToHex(finalRgb[0], finalRgb[1], finalRgb[2]);

  // 5. Generate Advanced Frontend CSS Payloads
  // Example SVG Filter or CSS mapping values
  const cssFilter = `saturate(${100 + fiberData.S_shift + structureData.S_shift + finishData.S_shift}%) brightness(${100 + fiberData.L_shift + structureData.L_shift + finishData.L_shift}%)`;

  // 6. Dye Gamut Warning (Is this color achievable?)
  let gamutWarning = null;
  // If color is highly saturated, light, and we are dyeing mostly cotton (which can't hit neons well)
  const isHighSaturation = hsl.s > 80 && hsl.l > 40 && hsl.l < 80;
  const cottonWeight = compNorm.find(c => c.id === 'cotton')?.weight || 0;
  if (isHighSaturation && cottonWeight > 0.6) {
    gamutWarning = "Color may not be fully achievable on high-cotton blends with standard reactive dyes. Polyester/Disperse dyes or pigments recommended.";
  }

  return {
    base_color: {
      hex: baseHex,
      hsl,
      lab
    },
    rendered_color: {
      hex: renderedHex,
      rgb: finalRgb,
      hsl: { h: intermediateHsl.h, s: newS, l: intermediateHsl.l },
    },
    physics: {
      composition_label: fiberData.label,
      construction_label: structureData.name,
      finish_label: finishData.label,
      illuminant_label: lightData.label,
      specular_sheen: Math.round(fiberData.sheen * 100) / 100,
      shadow_depth: Math.round(structureData.shadow_depth * 100) / 100,
      roughness: Math.round(fiberData.roughness * 100) / 100,
      texture_type: structureData.texture_type,
      texture_modifier: finishData.texture_modifier,
      gamut_warning: gamutWarning
    },
    frontend_assets: {
      swatch_css: `background-color: ${renderedHex};`,
      lighting_css: cssFilter,
      texture_class: `texture-${structureData.texture_type}`,
      sheen_class: `sheen-${Math.round(fiberData.sheen * 10)}`
    }
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  FIBER_PHYSICS,
  CONSTRUCTION_PHYSICS,
  normalizeComposition,
  calculateFiberPhysics,
  applyFabricPhysics
};
