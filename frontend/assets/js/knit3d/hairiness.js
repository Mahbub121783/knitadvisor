// KnitAdvisor · knit3d — yarn hairiness.
//
// A spun (staple) yarn is never a clean tube: fibre ends protrude from its
// surface and curl away from it. That halo is most of what makes cotton read
// as cotton in a macro photo, and it is absent from a smooth filament yarn —
// so the count scales with fibre type, from dense on wool/cotton to almost
// none on polyester/nylon/silk filament.
//
// One InstancedMesh: each hair is a short, slightly curled fibre rooted on a
// real yarn surface vertex, leaning out of the surface along the yarn's own
// direction (the way torn-out fibre ends trail the twist). Deterministic
// placement, so the swatch is identical between renders.

import * as THREE from 'three';
import { hash2 } from './noise.js?v=20260608g';

const HAIRINESS = {
  cotton: 1.0, wool: 1.3, linen: 0.8, hemp: 0.8, acrylic: 0.7,
  viscose: 0.45, modal: 0.45,
  polyester: 0.06, nylon: 0.06, silk: 0.05, spandex: 0.08,
};

// Unit fibre: length 1 along +y, gently curling out of plane.
export function fibreGeometry() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.04, 0.34, 0.0),
    new THREE.Vector3(0.15, 0.68, 0.05),
    new THREE.Vector3(0.32, 1.0, 0.12),
  ]);
  return new THREE.TubeGeometry(curve, 6, 0.011, 4, false);
}

/**
 * @param {THREE.BufferGeometry[]} tubes  yarn tube geometries (with normal + tangent)
 * @param {THREE.Material} material       an unlit-by-vertex-colour fibre material
 * @param {object} opts { radius, fiberType, totalLength }
 */
export function buildHairiness(tubes, material, opts) {
  const factor = HAIRINESS[opts.fiberType] != null ? HAIRINESS[opts.fiberType] : 1.0;
  const perUnit = 3.2 * factor;                                 // hairs per unit of yarn
  const count = Math.min(opts.maxCount || 14000, Math.round((opts.totalLength || 0) * perUnit));
  if (count < 20 || !tubes.length) return null;

  const geometry = fibreGeometry();
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3(), t = new THREE.Vector3(), dir = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const total = tubes.reduce((s, g) => s + g.attributes.position.count, 0);

  for (let i = 0; i < count; i++) {
    // pick a surface vertex uniformly across all tubes
    let pick = Math.floor(hash2(i, 31) * total);
    let geo = tubes[0];
    for (const g of tubes) {
      const c = g.attributes.position.count;
      if (pick < c) { geo = g; break; }
      pick -= c;
    }
    const pos = geo.attributes.position, nor = geo.attributes.normal, tan = geo.attributes.tangent;
    n.set(nor.getX(pick), nor.getY(pick), nor.getZ(pick));
    if (tan) t.set(tan.getX(pick), tan.getY(pick), tan.getZ(pick)); else t.set(1, 0, 0);
    // out of the surface, trailing along the yarn either way, plus scatter
    const lean = (hash2(i, 32) - 0.5) * 1.6;
    dir.copy(n).multiplyScalar(0.75)
      .addScaledVector(t, lean)
      .add(new THREE.Vector3(hash2(i, 33) - 0.5, hash2(i, 34) - 0.5, hash2(i, 35) - 0.5).multiplyScalar(0.5))
      .normalize();
    const len = opts.radius * (0.5 + Math.pow(hash2(i, 36), 2.2) * 2.4);  // mostly short, a few long
    dummy.position.set(pos.getX(pick), pos.getY(pick), pos.getZ(pick)).addScaledVector(n, -opts.radius * 0.08);
    dummy.quaternion.setFromUnitVectors(up, dir);
    spin.setFromAxisAngle(dir, hash2(i, 37) * Math.PI * 2);
    dummy.quaternion.premultiply(spin);
    dummy.scale.setScalar(len);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh, geometry };
}
