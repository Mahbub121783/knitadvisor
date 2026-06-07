// KnitAdvisor · knit3d — yarn paths → renderable tube meshes.
//
// Each course path becomes ONE smooth centripetal Catmull-Rom tube (continuous
// along the whole course), with a small rounded cap at each open selvedge end so
// no hollow tube mouths show. All tubes share one yarn material (cheap, and lets
// the wireframe / colour controls act globally).

import * as THREE from 'three';

/** Yarn tube radius from yarn count & tightness (finer/looser → thinner). */
export function yarnRadius(countNe, tf) {
  const ne = countNe || 30;
  const t = typeof tf === 'number' ? tf : 14;
  let r = 0.165 + (30 - ne) * 0.0020;   // finer yarn → thinner (fine-gauge default)
  r *= 1 + (t - 14) * 0.010;             // tighter → fuller coverage
  return Math.max(0.12, Math.min(r, 0.24));
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
  const group = new THREE.Group();
  const cap = new THREE.SphereGeometry(radius * 0.96, 6, 5);

  for (const path of paths) {
    if (!path.points || path.points.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(path.points, false, 'centripetal', 0.5);
    // ~3 tubular segments per control-point span → smooth yet light.
    const tubular = Math.min(Math.max(48, path.points.length * 3), 4000);
    const geo = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
    geo.computeTangents();   // anisotropic specular runs along the yarn
    group.add(new THREE.Mesh(geo, material));

    // round off the two open ends (selvedge) so no hollow mouth is visible
    const a = path.points[0], b = path.points[path.points.length - 1];
    const ca = new THREE.Mesh(cap, material); ca.position.copy(a); group.add(ca);
    const cb = new THREE.Mesh(cap, material); cb.position.copy(b); group.add(cb);
  }
  return group;
}
