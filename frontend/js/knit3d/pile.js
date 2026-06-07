// KnitAdvisor · knit3d — pile / brushed / terry back surface.
//
// Fleece and (loop-back) terry have a raised pile on the technical BACK that the
// flat loop field can't express. We add it as one InstancedMesh sitting behind
// the fabric so it reads when the swatch is flipped:
//   • fleece / velour → short tapered FIBRES (brushed nap)
//   • french terry    → small uncut LOOPS
// Deterministic placement (hash) so the swatch is stable between renders.

import * as THREE from 'three';
import { hash2 } from './noise.js?v=20260608f';

/**
 * @param {'brush'|'loop'} kind
 * @param {{minX,maxX,minY,maxY,z}} bounds  back-surface placement window
 * @param {THREE.Material} material
 * @param {object} opts { radius, density }
 * @returns {{ mesh: THREE.InstancedMesh, geometry: THREE.BufferGeometry }}
 */
export function buildPile(kind, bounds, material, opts = {}) {
  const radius = opts.radius != null ? opts.radius : 0.16;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const density = opts.density || 4.0;                  // strands per unit²
  const count = Math.max(120, Math.min(Math.round(w * h * density), 2200));

  let geometry;
  if (kind === 'loop') {
    geometry = new THREE.TorusGeometry(radius * 1.1, radius * 0.42, 6, 10);
  } else {
    // tapered fibre: thin tip, thicker base, along +Y; base at origin
    geometry = new THREE.CylinderGeometry(radius * 0.10, radius * 0.55, radius * 4.2, 5, 1, true);
    geometry.translate(0, radius * 2.1, 0);
  }

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const rx = hash2(i, 1), ry = hash2(i, 2), ra = hash2(i, 3), rb = hash2(i, 4), rl = hash2(i, 5);
    const x = bounds.minX + rx * w;
    const y = bounds.minY + ry * h;
    dummy.position.set(x, y, bounds.z);
    if (kind === 'loop') {
      // small loop facing the back, slight random roll
      dummy.rotation.set(Math.PI / 2 + (rb - 0.5) * 0.5, (ra - 0.5) * 0.6, 0);
      dummy.scale.setScalar(0.7 + rl * 0.6);
    } else {
      // hair points to the back (−z) with a random tilt → soft nap
      dummy.rotation.set(-Math.PI / 2 + (ra - 0.5) * 0.9, 0, (rb - 0.5) * 0.9);
      dummy.scale.setScalar(0.7 + rl * 0.8);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh, geometry };
}
