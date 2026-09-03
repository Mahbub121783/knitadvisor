// KnitAdvisor · knit3d — studio lighting.
//
// A soft 3-point + hemisphere rig tuned for ACES tone mapping so the dye reads
// as true colour and the yarn looks lit (not flat). A back rim light lets the
// purl / technical-back side read when the swatch is flipped.

import * as THREE from 'three';

// ── Metamerism / lightbox preview ──────────────────────────────────────────
// Two dyed lots can be a visual match under one light and visibly mismatched
// under another — the exact reason AATCC/ISO shade approval is done in a
// physical lightbox under a NAMED set of illuminants, not "the light in the
// room". D65 is the box's daylight tube and also, not by coincidence, sRGB's
// own white point (so it needs no tint at all here). TL84 is the cool-white
// fluorescent tube every European buyer's lightbox carries, notorious in the
// dyehouse for a slight GREEN cast that daylight doesn't show. Illuminant A
// is the warm incandescent/tungsten tube (also close to typical warm retail
// spotlighting), which pulls the same shade toward orange. Approximate sRGB
// tints, not spectral simulation — enough to show a shade behaving
// differently across the three the way a real lightbox does, not to replace
// one.
export const LIGHT_PRESETS = {
  d65:  { label: 'D65 Daylight',      hemi: 0xffffff, ground: 0x4a4f5a, key: 0xffffff, fill: 0xeef2ff, rim: 0xffffff },
  tl84: { label: 'TL84 Fluorescent',  hemi: 0xf1f8e4, ground: 0x424a3d, key: 0xecf9d4, fill: 0xe3f0cd, rim: 0xecf9d4 },
  a:    { label: 'Incandescent (A)',  hemi: 0xffe7c4, ground: 0x4a3d2f, key: 0xffd6a8, fill: 0xffe8cc, rim: 0xffd6a8 },
};
export const DEFAULT_LIGHT_PRESET = 'd65';
export const LIGHT_PRESET_ORDER = ['d65', 'tl84', 'a'];

// Returns the key/fill/rim lights so the renderer can (a) configure the key's
// shadow frustum once the fabric box is measured, and (b) re-side the whole
// 3-point rig when the swatch is flipped to its back — see
// knit-renderer.js `_setLightSide`. Without that re-siding, "front" is a
// proper studio 3-point setup but "back" only gets the rim's leftover 0.6
// intensity aimed the wrong way, which is why the flipped view used to read
// as near-black.
export function addStudioLighting(scene, withShadow) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x4a4f5a, 1.5);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-3, 5, 6);
  if (withShadow) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0006;
  }
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xeef2ff, 0.8);
  fill.position.set(4, -1, 3);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(0, 2, -5);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  return { key, fill, rim, hemi };
}

/** Re-tint the rig to a named illuminant (see LIGHT_PRESETS above). Position/
 *  intensity are untouched — only colour changes, exactly what swapping a
 *  lightbox's tube does to a real swatch. */
export function applyLightPreset(lights, presetKey) {
  const p = LIGHT_PRESETS[presetKey] || LIGHT_PRESETS[DEFAULT_LIGHT_PRESET];
  if (lights.hemi) { lights.hemi.color.setHex(p.hemi); lights.hemi.groundColor.setHex(p.ground); }
  if (lights.key)  lights.key.color.setHex(p.key);
  if (lights.fill) lights.fill.color.setHex(p.fill);
  if (lights.rim)  lights.rim.color.setHex(p.rim);
}

// Size the key light's orthographic shadow camera to cover the patch box.
export function configureShadowCamera(key, size) {
  if (!key || !key.shadow) return;
  const r = Math.max(size.x, size.y) * 0.7;
  const cam = key.shadow.camera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
  cam.near = 0.5; cam.far = r * 6;
  cam.updateProjectionMatrix();
}
