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
import { ShaderChunk } from 'three';

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
    // cloth: { wales per tile, courses per tile, tile width in cm, irregularity amplitude }
    uClothBias: { value: o.cloth && o.cloth.bias != null ? o.cloth.bias : 1.0 },
    uCloth: { value: o.cloth ? new THREE.Vector4(o.cloth.wales, o.cloth.courses, o.cloth.tileCm, o.cloth.amp) : new THREE.Vector4() },
  };
  const cloth = !!o.cloth;
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
      'uniform vec4 uCloth;', 'uniform float uClothBias;',
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
        ${cloth ? `
        // Yarn irregularity: no real yarn is even, so a knit is never one flat
        // shade. Each course is knitted from a slightly different stretch of
        // yarn (count CV), which shows as faint course-wise shade steps, and
        // the yarn's thick and thin places drift over centimetres as a cloud.
        // Both are zero-mean; course steps fade once a course is under a pixel.
        {
          float cId = floor(dyeUv.y * uCloth.y);
          float foot = length(vec2(dFdx(dyeUv.y), dFdy(dyeUv.y))) * uCloth.y;
          float course = (fract(sin(cId * 12.9898 + 4.1) * 43758.5453) - 0.5) * (1.0 - smoothstep(0.12, 0.3, foot));
          vec2 q = dyeUv * uCloth.z / 1.7;      // cloud cell ~1.7 cm
          vec2 i0 = floor(q), f0 = fract(q);
          f0 = f0 * f0 * (3.0 - 2.0 * f0);
          float n00 = fract(sin(dot(i0, vec2(127.1, 311.7))) * 43758.5453);
          float n10 = fract(sin(dot(i0 + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
          float n01 = fract(sin(dot(i0 + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
          float n11 = fract(sin(dot(i0 + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
          float cloud = mix(mix(n00, n10, f0.x), mix(n01, n11, f0.x), f0.y) - 0.5;
          diffuseColor.rgb *= 1.0 + uCloth.w * (0.9 * course + 1.1 * cloud);
        }` : ''}
        if (uMel > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, uMelLight * aoK, ${light});
        diffuseColor.rgb = mix(diffuseColor.rgb, uFadeColor * aoK, uFade * smoothstep(0.3, 0.95, ${expo}));
        float dyeLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dyeLum * 1.06), uChalk);
      }`);
    if (cloth) {
      // Normal-variance roughness (Toksvig): far away, a mipmap averages the
      // tilted normals of many yarns into a short vector. That lost relief is
      // not smoothness: it is many tiny facets, so it becomes roughness —
      // without this a cloth seen from a distance turns glossy like plastic.
      // Stitches near the pixel size alias into a false grid (wales ~3 px and
      // courses ~2 px at the default view beat against the pixel grid). Up to
      // +1 LOD bias filters the relief one octave earlier; the relief it removes
      // is not lost but turns into roughness through the Toksvig term below.
      // The bias only switches on where a stitch is under ~4 px, so the
      // relief stays sharp at closer zoom.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <uv_pars_fragment>', `#include <uv_pars_fragment>
        float clothBias() {
          #ifdef USE_MAP
            vec2 g = vMapUv * uCloth.xy;
            return uClothBias * smoothstep(0.2, 0.45, max(length(dFdx(g)), length(dFdy(g))));
          #else
            return 0.0;
          #endif
        }`)
        .replace('#include <normal_fragment_maps>', ShaderChunk.normal_fragment_maps.split('texture2D( normalMap, vNormalMapUv )').join('texture2D( normalMap, vNormalMapUv, clothBias() )'))
        .replace('#include <map_fragment>', ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, vMapUv, clothBias() * 0.5 )'));
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      #ifdef USE_NORMALMAP_TANGENTSPACE
      {
        vec3 tN = (texture2D(normalMap, vNormalMapUv, clothBias()).xyz * 2.0 - 1.0) * vec3(normalScale, 1.0);
        float tl = clamp(length(tN) / length(vec3(normalScale, 1.0)), 0.05, 1.0);
        float a = roughnessFactor * roughnessFactor;
        roughnessFactor = clamp(sqrt(sqrt(a * a + 2.5 * (1.0 - tl) / tl)), roughnessFactor, 1.0);
      }
      #endif`);
    }
  };
  material.customProgramCacheKey = () => `ka-dye-${exposure}-${melMode}${cloth ? '-cloth' : ''}`;
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
