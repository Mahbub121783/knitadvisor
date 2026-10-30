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

// ── Yarn surface tile ──────────────────────────────────────────────────────
// One tile = exactly ONE helix turn of yarn: u runs along the yarn, v once
// around its circumference. fabric-mesh.js scales every tube's u by its own
// arc length / twistPitch(), so a stroke drawn corner-to-corner here wraps
// the real yarn as a helix at the real twist angle.
//
// The old texture repeated ~8 times across a whole COURSE (100+ units of
// yarn), so the helix was stretched ~30x into stripes running parallel to the
// yarn — the "grooved plastic pipe" look up close.
//
// The tile holds individual FIBRES (raised strokes along the helix, staple =
// short and irregular, filament = long and straight) over two soft helical
// grooves, and paints the same fibres into an ALBEDO tile: real dyed fibres
// never take up dye identically, which is a large part of why yarn reads as
// yarn and not as a uniformly painted surface.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function paintYarnTile(hctx, actx, size, synthetic, fuzz, dir, fine) {
  const R = rng(fine ? 7919 : 104729);
  hctx.fillStyle = '#7a7a7a'; hctx.fillRect(0, 0, size, size);
  actx.fillStyle = '#efefef'; actx.fillRect(0, 0, size, size);
  // Tile-seamless stroke: repeat at every neighbouring tile offset.
  const stroke = (ctx, x0, y0, x1, y1) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.beginPath(); ctx.moveTo(x0 + ox, y0 + oy); ctx.lineTo(x1 + ox, y1 + oy); ctx.stroke();
    }
  };
  // Two broad, soft helical grooves per turn — what reads as "twisted" from
  // normal viewing distance, before individual fibres are resolvable.
  hctx.lineCap = 'round';
  for (let g = 0; g < 2; g++) {
    hctx.strokeStyle = 'rgba(40,40,40,0.55)';
    hctx.lineWidth = size * 0.11;
    const x0 = g * size / 2;
    stroke(hctx, x0, 0, x0 + dir * size, size);
  }
  // Individual fibres along the helix.
  const n = fine ? (synthetic ? 700 : 1500) : (synthetic ? 140 : 300);
  const angleJitter = synthetic ? 0.04 : 0.16;
  for (let k = 0; k < n; k++) {
    const x0 = R() * size, y0 = R() * size;
    const len = size * (synthetic ? 0.45 + R() * 0.45 : 0.12 + R() * 0.32);
    const a = Math.PI / 4 + (R() - 0.5) * angleJitter * Math.PI;
    const x1 = x0 + dir * Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
    const lw = (fine ? size / 512 : size / 128) * (synthetic ? 0.9 + R() * 0.6 : 0.7 + R() * 1.1);
    const hv = 150 + (R() * 90 | 0);
    hctx.strokeStyle = `rgba(${hv},${hv},${hv},${synthetic ? 0.55 : 0.75})`;
    hctx.lineWidth = lw * 1.6;
    stroke(hctx, x0, y0, x1, y1);
    const av = synthetic ? 228 + (R() * 27 | 0) : 205 + (R() * 50 | 0);
    actx.strokeStyle = `rgba(${av},${av},${av},0.85)`;
    actx.lineWidth = lw * 1.6;
    stroke(actx, x0, y0, x1, y1);
  }
  // Fibre-end speckle on staple yarns (fuzz) — tiny broken ends.
  if (!synthetic) {
    const m = Math.round((fine ? 900 : 220) * fuzz);
    for (let k = 0; k < m; k++) {
      const v = 160 + (R() * 80 | 0);
      hctx.fillStyle = `rgb(${v},${v},${v})`;
      const s = fine ? 1.2 : 1;
      hctx.fillRect(R() * size, R() * size, s, s);
    }
  }
}

// Normal map (Sobel of the heightfield) + albedo variation map, one tile each.
// `resolution`/`fine` build the CLOSE-UP tier — swapped in by knit-renderer.js
// `_applyLod` only once the camera is close enough to resolve single fibres.
function yarnSurfaceTextures(synthetic, fuzz, twist, resolution, fine) {
  const size = resolution || 128;
  const dir = (twist && twist.dir === 's') ? -1 : 1;     // Z = +slope, S = −slope
  const hc = document.createElement('canvas'); hc.width = hc.height = size;
  const ac = document.createElement('canvas'); ac.width = ac.height = size;
  paintYarnTile(hc.getContext('2d'), ac.getContext('2d'), size, synthetic, fuzz, dir, !!fine);
  const src = hc.getContext('2d').getImageData(0, 0, size, size).data;
  const H = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;

  const out = document.createElement('canvas'); out.width = out.height = size;
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  const strength = fine ? 3.2 : 2.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
      const dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1) || 1;
      const i = (y * size + x) * 4;
      img.data[i]     = (dx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const normal = new THREE.CanvasTexture(out);
  normal.colorSpace = THREE.NoColorSpace;     // normal maps must NOT be sRGB-decoded
  const albedo = new THREE.CanvasTexture(ac);
  albedo.colorSpace = THREE.SRGBColorSpace;
  for (const t of [normal, albedo]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { normal, albedo };
}

/**
 * Length of yarn (scene units) for ONE full twist turn. A spun yarn's twist
 * angle is independent of its count: tan θ = π·d·TPmm with TPI = tm·√Ne and
 * d = 0.907/√Ne mm, so tan θ = 0.1122·tm (tm 3.8 → 23°). The pitch then
 * follows from the rendered circumference: P = 2πr / tan θ.
 */
export function twistPitch(radius, twist) {
  const tm = (twist && twist.tm) || 3.8;
  return (2 * Math.PI * radius) / Math.max(0.12, 0.1122 * tm);
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
    // Finish effects (peach, mercerise, …) are applied at runtime by
    // applyYarnLook, because they switch off in the As-Knit (greige) state.
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

  // Two detail tiers: the normal viewing-distance map (cheap, built first so
  // it is on screen immediately), and a bigger, finer one — individual
  // staple/filament fibres, not just the yarn's own twist — that only gets
  // assigned to the material once the camera is actually close enough
  // (knit-renderer.js `_applyLod`) to make the extra resolution visible.
  const far = yarnSurfaceTextures(synthetic, fuzz, opts.twist, 128, false);
  const near = yarnSurfaceTextures(synthetic, fuzz, opts.twist, 512, true);
  material.normalMap = far.normal;
  material.map = far.albedo;
  const ns = Math.max(0.35, Math.min(bump * 40, 1.5));  // per-fibre relief strength
  material.normalScale = new THREE.Vector2(ns, ns);
  material.userData.baseNormalScale = ns;               // LOD swaps around this
  material.userData.normalFar = far.normal;
  material.userData.normalNear = near.normal;
  material.userData.albedoFar = far.albedo;
  material.userData.albedoNear = near.albedo;
  // The unfinished optics, which applyYarnLook offsets from.
  material.userData.base = {
    roughness, sheen, clearcoat, sheenRoughness: material.sheenRoughness,
  };
  material.userData.lookNormal = 1;

  // Melange fibre mask (dye-shader.js): one random value per fibre, along
  // the same helix as the fibres in the albedo tile.
  const melField = melangeField(256, (opts.twist && opts.twist.dir === 's') ? -1 : 1, synthetic);

  return { material, melField, textures: [far.normal, near.normal, far.albedo, near.albedo, melField] };
}

/**
 * Apply a finish look (finish-profile.js) on top of the unfinished optics.
 * Safe to call repeatedly (As-Knit ↔ Finished).
 */
export function applyYarnLook(material, look) {
  const b = material.userData.base;
  if (!b || !look) return;
  material.roughness = Math.max(0.05, Math.min(1, b.roughness + look.rough));
  material.sheen = Math.max(0, Math.min(1, b.sheen + look.sheen));
  material.clearcoat = Math.max(0, Math.min(1, b.clearcoat + look.clearcoat));
  material.sheenRoughness = look.sheenRough != null ? look.sheenRough : b.sheenRoughness;
  if (look.sheenTint != null) material.sheenColor.copy(material.color).lerp(new THREE.Color(1, 1, 1), look.sheenTint);
  material.userData.lookNormal = look.normal;
  const ns = material.userData.baseNormalScale * (material.userData.lodK || 1) * look.normal;
  material.normalScale.set(ns, ns);
}

// Per-fibre random values for the melange mask, drawn as dense, fully
// overlapping fibre strokes along the twist helix (one tile = one twist turn,
// as in paintYarnTile). Unfiltered by mipmaps: an averaged value would no
// longer be any fibre's value.
function melangeField(size, dir, synthetic) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const R = rng(65537);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  // A yarn cross-section holds ~100 fibres: on the visible half of the tile
  // they are ~1-2 % of the circumference wide each.
  const n = synthetic ? 2600 : 4200;
  for (let k = 0; k < n; k++) {
    const x0 = R() * size, y0 = R() * size;
    const len = size * (synthetic ? 0.45 + R() * 0.45 : 0.12 + R() * 0.32);
    const a = Math.PI / 4 + (R() - 0.5) * (synthetic ? 0.04 : 0.16) * Math.PI;
    const x1 = x0 + dir * Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
    const v = (R() * 256) | 0;
    ctx.strokeStyle = `rgb(${v},${v},${v})`;
    ctx.lineWidth = (size / 256) * (1.6 + R() * 1.6);
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.beginPath(); ctx.moveTo(x0 + ox, y0 + oy); ctx.lineTo(x1 + ox, y1 + oy); ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}
