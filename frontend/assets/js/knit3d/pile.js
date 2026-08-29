// KnitAdvisor · knit3d — pile / brushed / terry back surface.
//
// Fleece and (loop-back) terry have a raised pile on the technical BACK that the
// flat loop field can't express. We add it as one InstancedMesh sitting behind
// the fabric so it reads when the swatch is flipped:
//   • fleece / velour → short tapered FIBRES (brushed nap)
//   • french terry    → small uncut LOOPS
// Deterministic placement (hash) so the swatch is stable between renders.

import * as THREE from 'three';
import { hash2 } from './noise.js?v=20260608g';

/**
 * @param {'brush'|'loop'} kind
 * @param {{minX,maxX,minY,maxY,z}} bounds  back-surface placement window
 * @param {THREE.Material} material
 * @param {object} opts { radius, density, lengthScale }
 *   radius       : fibre/loop thickness, driven by the LOOP yarn's own count
 *                  (not the face yarn) — see knit-renderer.js `_addPile`.
 *   density      : strands per unit² — driven by fabric weight (GSM) so a
 *                  heavier fleece reads with a fuller nap than a light one.
 *   lengthScale  : fibre length multiplier (velour is sheared short & dense;
 *                  plain fleece nap is longer and looser).
 * @returns {{ mesh: THREE.InstancedMesh, geometry: THREE.BufferGeometry }}
 */
export function buildPile(kind, bounds, material, opts = {}) {
  const radius = opts.radius != null ? opts.radius : 0.16;
  const lengthScale = opts.lengthScale != null ? opts.lengthScale : 1.0;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const density = opts.density || 4.0;                  // strands per unit²
  // A believable brushed nap needs many fibres PER STITCH, not a sprinkling
  // across the whole patch — the old 2200 cap meant a ~36×44-stitch swatch
  // (~1000+ sq. units) got diluted to ~2 fibres/unit², reading as a handful
  // of pale specks on bare backing instead of dense fuzz. Modern GPUs render
  // tens of thousands of 5-segment cylinder instances trivially, so raise the
  // ceiling to match real pile density instead of a performance guess.
  const count = Math.max(400, Math.min(Math.round(w * h * density), 14000));

  let geometry;
  if (kind === 'loop') {
    geometry = new THREE.TorusGeometry(radius * 1.1, radius * 0.42, 6, 10);
  } else {
    // tapered fibre: thin tip, thicker base, along +Y; base at origin
    const len = radius * 4.2 * lengthScale;
    geometry = new THREE.CylinderGeometry(radius * 0.10, radius * 0.55, len, 5, 1, true);
    geometry.translate(0, len * 0.5, 0);
  }

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const rx = hash2(i, 1), ry = hash2(i, 2), ra = hash2(i, 3), rb = hash2(i, 4), rl = hash2(i, 5);
    const rz = hash2(i, 6), rc = hash2(i, 7);
    const x = bounds.minX + rx * w;
    const y = bounds.minY + ry * h;
    // Real torn-loop fibre bases sit at a RANGE of depths (not one flat sheet),
    // so the nap reads as a volumetric layer rather than a paper-thin card —
    // this also hides any seam where the backing plane sits behind the pile.
    const z = bounds.z - (rz * radius * 2.2);
    dummy.position.set(x, y, z);
    if (kind === 'loop') {
      // small loop facing the back, slight random roll
      dummy.rotation.set(Math.PI / 2 + (rb - 0.5) * 0.5, (ra - 0.5) * 0.6, 0);
      dummy.scale.setScalar(0.7 + rl * 0.6);
    } else {
      // Hair points mostly toward the back (−z) but with WIDE, chaotic tilt —
      // real brushed nap is torn out at all angles, not combed flat. A narrow
      // tilt range makes every fibre nearly edge-on to a camera looking
      // straight down −z (the "flip to back" view), so the pile reads as
      // near-invisible specks instead of a dense fuzzy mat. Wider tilt +
      // a full-circle roll fixes that from every viewing angle.
      dummy.rotation.set(-Math.PI / 2 + (ra - 0.5) * 2.6, (rc - 0.5) * 2.6, (rb - 0.5) * 2.6);
      dummy.scale.setScalar(0.65 + rl * 0.9);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh, geometry };
}
