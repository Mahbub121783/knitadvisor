// KnitAdvisor · knit3d — dye effects in the yarn / cloth shader.
//
// Three effects a single flat colour can't show, injected into the standard
// physical material (so lighting, sheen and shadows are unchanged):
//
//   melange  a yarn spun from a MIX of dark and light fibres (grey melange,
//            white melange). The material colour is the dark fibre; a fibre
//            mask decides, fibre by fibre, which ones are light. Loop model:
//            the mask holds one random value per fibre and the shader keeps
//            the fraction `uMelF` of them light, so the mix stays exact when
//            the shade changes. Macro cloth: the mask is baked already
//            thresholded (see macro.js), so its mipmaps average correctly.
//   fade     exposed high points lighten toward a worn colour — pigment
//            (colour sits on the surface) and garment / vintage washes.
//            Exposure comes from the yarn layout (fabric-mesh.js aExposure)
//            or, on the macro cloth, from the same layout baked into a map.
//   chalk    pigment's slightly chalky, desaturated cast.
//
// All three are driven by uniforms, so switching As-Knit ↔ Finished or
// changing the shade needs no rebuild.

import * as THREE from 'three';

/**
 * @param {THREE.Material} material  a MeshStandard/PhysicalMaterial with a `map`
 * @param {object} o
 *   exposure : 'attr' (vertex attribute aExposure) | 'map' (o.expMap)
 *   melMode  : 'threshold' (mask = per-fibre random value) | 'direct' (mask = light fraction)
 * @returns the uniforms object (also at material.dyeUniforms)
 */
export function patchDye(material, o = {}) {
  const exposure = o.exposure || 'attr';
  const melMode = o.melMode || 'threshold';
  const u = {
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color(1, 1, 1) },
    uChalk: { value: 0 },
    uMel: { value: 0 },
    uMelF: { value: 0.5 },
    uMelLight: { value: new THREE.Color(1, 1, 1) },
    uMelMap: { value: o.melMap || null },
    uExpMap: { value: o.expMap || null },
  };
  // Not in userData: Material.clone() JSON-copies userData.
  material.dyeUniforms = u;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    if (exposure === 'attr') {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aExposure;\nvarying float vExposure;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvExposure = aExposure;');
    }
    const decl = [
      'uniform float uFade;', 'uniform vec3 uFadeColor;', 'uniform float uChalk;',
      'uniform float uMel;', 'uniform float uMelF;', 'uniform vec3 uMelLight;', 'uniform sampler2D uMelMap;',
      exposure === 'attr' ? 'varying float vExposure;' : 'uniform sampler2D uExpMap;',
    ].join('\n');
    const light = melMode === 'threshold'
      ? '1.0 - smoothstep(uMelF - 0.015, uMelF + 0.015, texture2D(uMelMap, dyeUv).r)'
      : 'texture2D(uMelMap, dyeUv).r';
    const expo = exposure === 'attr' ? 'vExposure' : 'texture2D(uExpMap, dyeUv).r';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + decl)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // local shading already in the colour (albedo tile x occlusion), so
        // a replacement colour keeps the same crevices
        float aoK = clamp(dot(diffuseColor.rgb / max(diffuse, vec3(1e-4)), vec3(1.0 / 3.0)), 0.0, 2.0);
        #ifdef USE_MAP
          vec2 dyeUv = vMapUv;
        #else
          vec2 dyeUv = vec2(0.0);
        #endif
        if (uMel > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, uMelLight * aoK, ${light});
        diffuseColor.rgb = mix(diffuseColor.rgb, uFadeColor * aoK, uFade * smoothstep(0.3, 0.95, ${expo}));
        float dyeLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dyeLum * 1.06), uChalk);
      }`);
  };
  material.customProgramCacheKey = () => `ka-dye-${exposure}-${melMode}`;
  material.needsUpdate = true;
  return u;
}

/**
 * Split a target melange shade into its two fibre colours and the light
 * fraction, so that the fibre mix averages back to the target (luminance-
 * exact, linear light). Dark fibres keep the target's hue at a deep shade;
 * light fibres are undyed raw white.
 */
export function melangeSplit(target, lightHex = '#ebe8e0') {
  const light = new THREE.Color(lightHex);
  const dark = target.clone().multiplyScalar(0.16);
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const f = Math.max(0.03, Math.min(0.97, (lum(target) - lum(dark)) / Math.max(1e-4, lum(light) - lum(dark))));
  return { dark, light, f };
}
