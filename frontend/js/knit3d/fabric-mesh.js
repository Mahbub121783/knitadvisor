// KnitAdvisor · knit3d — yarn paths → renderable tube meshes.
//
// Each course path becomes ONE smooth centripetal Catmull-Rom tube (continuous
// along the whole course), with a small rounded cap at each open selvedge end so
// no hollow tube mouths show. All tubes share one yarn material (cheap, and lets
// the wireframe / colour controls act globally).

import * as THREE from 'three';
import { hash2 } from './noise.js?v=20260608g';

// Staple/natural fibres get slub (thick-thin) + nep; smooth filament stays even.
const NATURAL = new Set(['cotton', 'linen', 'hemp', 'wool', 'viscose', 'modal', 'acrylic']);

// Thickness profile along a yarn (0..1): low-freq slubs + rare sharp neps.
function slubProfile(t, phase) {
  const s = Math.sin((t * 7.3 + phase) * Math.PI * 2) * 0.55
          + Math.sin((t * 13.1 + phase * 1.7) * Math.PI * 2) * 0.30;
  let v = s * 0.11;                                   // ±~11% slub
  const np = Math.sin((t * 41.0 + phase * 3.1) * Math.PI * 2);
  if (np > 0.95) v += 0.5 * (np - 0.95);             // occasional nep bump
  return v;
}

// Displace each tube ring outward by the slub profile (stable per path).
function applySlub(geo, curve, tubular, radial, phase) {
  const pos = geo.attributes.position;
  const c = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    curve.getPointAt(i / tubular, c);
    const scale = 1 + slubProfile(i / tubular, phase);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      const x = pos.getX(idx), y = pos.getY(idx), z = pos.getZ(idx);
      pos.setXYZ(idx, c.x + (x - c.x) * scale, c.y + (y - c.y) * scale, c.z + (z - c.z) * scale);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * Yarn tube radius in SCENE units, from real yarn geometry tied to stitch pitch.
 *   tex = 590.5 / Ne ;  yarn dia (mm) ≈ 0.0444·√tex  (cotton packing)
 *   wale spacing (mm) = 10 / wales-per-cm
 *   radius = ½ · (dia / waleSpacing) · PITCH_X · coverGain   (overlap for cover)
 * So a fat yarn at fine gauge fully covers; a thin yarn at coarse gauge reads
 * open — i.e. loose vs dense fabrics actually look different. Falls back to a
 * count-only estimate when density is absent.
 */
export function yarnRadius(countNe, tf, density) {
  const ne = countNe || 30;
  const t = typeof tf === 'number' ? tf : 14;
  const tex = (density && density.tex) || (590.5 / ne);
  const diaMm = 0.0444 * Math.sqrt(tex);          // physical yarn diameter
  const tfGain = 1 + (t - 14) * 0.012;             // tighter → fuller coverage
  let r;
  if (density && density.wpc > 0) {
    const waleSpacingMm = 10 / density.wpc;        // real wale pitch
    r = 0.5 * (diaMm / waleSpacingMm) * 1.0 /* PITCH_X */ * 1.30 * tfGain;
  } else {
    r = (0.165 + (30 - ne) * 0.0020) * tfGain;     // count-only fallback
  }
  return Math.max(0.10, Math.min(r, 0.30));
}

/**
 * @param {{points: THREE.Vector3[]}[]} paths
 * @param {THREE.Material} material
 * @param {object} opts { radius, radialSegments }
 * @returns {THREE.Group}
 */
export function buildFabricMesh(paths, material, opts = {}) {
  const radius = opts.radius != null ? opts.radius : 0.18;
  const radial = opts.radialSegments || 7;
  const shadows = !!opts.shadows;
  // slub/nep only for natural fibres, and only on the capable (shadow) tier
  const slub = shadows && NATURAL.has(opts.fiberType || 'cotton');
  const group = new THREE.Group();
  const cap = new THREE.SphereGeometry(radius * 0.96, 6, 5);

  let pi = 0;
  for (const path of paths) {
    if (!path.points || path.points.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(path.points, false, 'centripetal', 0.5);
    // ~3 tubular segments per control-point span → smooth yet light.
    const tubular = Math.min(Math.max(48, path.points.length * 3), 4000);
    const geo = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
    if (slub) applySlub(geo, curve, tubular, radial, hash2(pi, 1));
    geo.computeTangents();   // anisotropic specular runs along the yarn
    const mesh = new THREE.Mesh(geo, material);
    if (shadows) { mesh.castShadow = true; mesh.receiveShadow = true; }
    group.add(mesh);

    // round off the two open ends (selvedge) so no hollow mouth is visible
    const a = path.points[0], b = path.points[path.points.length - 1];
    const ca = new THREE.Mesh(cap, material); ca.position.copy(a);
    const cb = new THREE.Mesh(cap, material); cb.position.copy(b);
    if (shadows) { ca.castShadow = cb.castShadow = true; }
    group.add(ca); group.add(cb);
    pi++;
  }
  return group;
}
