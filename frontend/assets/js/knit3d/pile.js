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
  // 3-thread fleece (topology-builder.js `fleeceFloatAnchors`): root the nap
  // at the binding/fleecy yarn's real float positions instead of scattering
  // it uniformly over the whole patch — see knit-renderer.js `_addPile`.
  const anchors = bounds.anchors || null;
  // A believable brushed nap needs many fibres PER STITCH, not a sprinkling
  // across the whole patch — the old 2200 cap meant a ~36×44-stitch swatch
  // (~1000+ sq. units) got diluted to ~2 fibres/unit², reading as a handful
  // of pale specks on bare backing instead of dense fuzz. Modern GPUs render
  // tens of thousands of 5-segment cylinder instances trivially, so raise the
  // ceiling to match real pile density instead of a performance guess.
  // Several torn fibres per float (a real brushed float frays into a small
  // tuft, not one strand) when anchored; otherwise the old per-area density.
  // Thinner fibres (see the geometry below) cover less visual area each, so
  // a believable tuft needs more of them per float than the old thick-blade
  // version did — real brushed fleece is a near-solid fuzzy mat, not visible
  // tufts with gaps between them.
  const fibersPerAnchor = Math.max(4, Math.min(9, Math.round(density / 2)));
  const count = anchors && anchors.length
    ? Math.min(anchors.length * fibersPerAnchor, 18000)
    : Math.max(400, Math.min(Math.round(w * h * density), 14000));

  let geometry;
  if (kind === 'loop') {
    geometry = new THREE.TorusGeometry(radius * 1.1, radius * 0.42, 6, 10);
  } else {
    // A single brushed-out fibre is TEASED OUT of the yarn it was torn from —
    // a fine filament, not a scaled-down copy of the yarn itself. The old
    // 0.55·radius base / 4.2·radius length made each strand nearly as wide
    // and as long as a full stitch once you could actually zoom in close
    // enough to see it (the realism pass raised that zoom limit) — angular
    // 5-facet cones that size read as rigid blades, not soft fuzz, which is
    // exactly the "trees" artefact flagged against the reference photos.
    // Thinner, shorter, one more radial facet for a rounder silhouette.
    const len = radius * 1.7 * lengthScale;
    geometry = new THREE.CylinderGeometry(radius * 0.035, radius * 0.22, len, 6, 1, true);
    geometry.translate(0, len * 0.5, 0);
  }

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  // Wide enough that neighbouring floats' fibre clouds OVERLAP — a real
  // brushed nap merges into a continuous mat, it does not read as separate
  // tufts with visible gaps between each float's anchor point.
  const jitterXY = radius * 2.8;
  for (let i = 0; i < count; i++) {
    const rx = hash2(i, 1), ry = hash2(i, 2), ra = hash2(i, 3), rb = hash2(i, 4), rl = hash2(i, 5);
    const rz = hash2(i, 6), rc = hash2(i, 7);
    let x, y, zBase;
    if (anchors && anchors.length) {
      const a = anchors[i % anchors.length];
      x = a.x + (hash2(i, 8) - 0.5) * jitterXY;
      y = a.y + (hash2(i, 9) - 0.5) * jitterXY;
      zBase = a.z;
    } else {
      x = bounds.minX + rx * w;
      y = bounds.minY + ry * h;
      zBase = bounds.z;
    }
    // Real torn-loop fibre bases sit at a RANGE of depths (not one flat sheet),
    // so the nap reads as a volumetric layer rather than a paper-thin card —
    // this also hides any seam where the backing plane sits behind the pile.
    const z = zBase - (rz * radius * 2.2);
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
