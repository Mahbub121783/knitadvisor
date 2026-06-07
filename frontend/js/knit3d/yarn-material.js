// KnitAdvisor · knit3d — physically-based yarn material (ধাপ ৩).
//
// A spun yarn is not a smooth plastic tube: it has a helical twist, fibre fuzz,
// and a soft cloth sheen. We drive a MeshPhysicalMaterial with:
//   • a procedural TWIST bump map (diagonal S/Z helix + fibre speckle),
//   • per-fibre sheen / roughness / anisotropy / clearcoat,
//   • an optional PHYSICS override (specular_sheen, roughness, texture_modifier)
//     from the engine so the finished hand-feel (peach fuzz, enzyme frosting,
//     polyester gloss) actually shows.

import * as THREE from 'three';

// Per-fibre optics. sheen = the fuzzy fibre HALO (high on staple fibres like
// cotton/wool/linen, low on smooth filament like polyester/silk). Smooth shiny
// fibres instead get low roughness + clearcoat.
const FIBER = {
  cotton:    { roughness: 0.84, sheen: 1.0,  anisotropy: 0.35, clearcoat: 0.0,  bump: 0.020 },
  polyester: { roughness: 0.42, sheen: 0.35, anisotropy: 0.70, clearcoat: 0.30, bump: 0.008 },
  nylon:     { roughness: 0.38, sheen: 0.35, anisotropy: 0.75, clearcoat: 0.35, bump: 0.008 },
  viscose:   { roughness: 0.55, sheen: 0.65, anisotropy: 0.55, clearcoat: 0.12, bump: 0.014 },
  modal:     { roughness: 0.55, sheen: 0.65, anisotropy: 0.55, clearcoat: 0.12, bump: 0.014 },
  silk:      { roughness: 0.28, sheen: 0.45, anisotropy: 0.90, clearcoat: 0.20, bump: 0.006 },
  linen:     { roughness: 0.90, sheen: 0.95, anisotropy: 0.18, clearcoat: 0.0,  bump: 0.028 },
  hemp:      { roughness: 0.92, sheen: 0.95, anisotropy: 0.15, clearcoat: 0.0,  bump: 0.030 },
  wool:      { roughness: 0.82, sheen: 1.0,  anisotropy: 0.20, clearcoat: 0.0,  bump: 0.024 },
  acrylic:   { roughness: 0.50, sheen: 0.60, anisotropy: 0.50, clearcoat: 0.10, bump: 0.012 },
  spandex:   { roughness: 0.50, sheen: 0.40, anisotropy: 0.30, clearcoat: 0.10, bump: 0.010 },
};
const SMOOTH = new Set(['polyester', 'nylon', 'silk']);

// Procedural twist + fuzz texture, used as a bump map.
function twistTexture(synthetic, fuzz) {
  const w = 128, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);

  const step = 8;
  for (let i = -h; i < w + h; i += step) {
    ctx.strokeStyle = '#5d5d5d'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
    ctx.strokeStyle = '#a8a8a8'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(i + 3, 0); ctx.lineTo(i + h + 3, h); ctx.stroke();
  }
  if (!synthetic) {
    const n = Math.round(3000 * fuzz);
    for (let k = 0; k < n; k++) {
      const v = 100 + (Math.random() * 56 | 0);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1.3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.repeat.set(8, 2);
  return tex;
}

/** Set a material's colour from an {r,g,b} 0–255 triple in sRGB. */
export function setYarnColorRGB(material, rgb) {
  material.color.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, THREE.SRGBColorSpace);
  if (material.sheenColor) {
    material.sheenColor.copy(material.color).lerp(new THREE.Color(1, 1, 1), 0.55);
  }
}

/** Set a material's colour from a #rrggbb hex string (colour-space consistent). */
export function setYarnColorHex(material, hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  setYarnColorRGB(material, { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 });
}

/**
 * @param {object} opts { dyed:{r,g,b}, fiberType, physics? }
 *   physics: { specular_sheen, roughness, texture_modifier }
 * @returns {{ material: THREE.MeshPhysicalMaterial, textures: THREE.Texture[] }}
 */
export function createYarnMaterial(opts) {
  const fiber = opts.fiberType || 'cotton';
  const f = FIBER[fiber] || FIBER.cotton;
  const synthetic = SMOOTH.has(fiber);
  const phys = opts.physics || null;

  let roughness = f.roughness;
  let clearcoat = f.clearcoat;
  let bump = f.bump;
  let fuzz = synthetic ? 0.4 : 1.0;
  let sheen = f.sheen;

  // engine physics overrides (real measured-ish optics + finish hand-feel)
  if (phys) {
    if (typeof phys.roughness === 'number') roughness = phys.roughness;
    if (typeof phys.specular_sheen === 'number') clearcoat = Math.max(clearcoat, phys.specular_sheen * 0.4);
    switch (phys.texture_modifier) {
      case 'micro_fuzz': sheen = Math.min(1, sheen + 0.25); roughness = Math.min(1, roughness + 0.06); bump *= 1.6; fuzz = 1.3; break; // peach finish
      case 'frosting':   roughness = Math.min(1, roughness + 0.04); bump *= 1.2; break;                                            // enzyme wash
      case 'faded':      sheen = Math.max(0, sheen - 0.2); break;                                                                  // vintage wash
      case 'fuzz':       sheen = Math.min(1, sheen + 0.2); fuzz = 1.3; break;                                                       // fleece
      default: break;
    }
  }

  const material = new THREE.MeshPhysicalMaterial({
    roughness,
    metalness: 0.0,
    sheen,
    sheenRoughness: synthetic ? 0.45 : 0.9,
    anisotropy: f.anisotropy,
    anisotropyRotation: 0,
    clearcoat,
    clearcoatRoughness: 0.55,
  });
  material.sheenColor = new THREE.Color(1, 1, 1);
  setYarnColorRGB(material, opts.dyed || { r: 120, g: 124, b: 134 });

  const twist = twistTexture(synthetic, fuzz);
  material.bumpMap = twist;
  material.bumpScale = bump;

  return { material, textures: [twist] };
}
