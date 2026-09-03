// KnitAdvisor · woven3d — plain/twill/satin weave topology.
//
// Unlike knit — a different topology per construction (rib/interlock/warp-
// knit/mesh all thread the yarn differently) — every weave family reduces to
// the SAME two-yarn-family orthogonal interlacement: plain, any n/m twill,
// satin, warp rib, honeycomb all differ only in WHICH cells the warp lifts
// over the weft, never in the topology itself. One builder therefore covers
// the whole family; only the boolean design grid changes between them.
//
// `grid[pick][end] === true` means the warp END is lifted OVER the weft PICK
// at that crossing — pattern-renderer.js's own convention (WOVEN_INK.warpUp,
// buildClothPreviewSVG), reused rather than re-derived so the loom-plan
// diagram and this 3-D render can never disagree about which thread is on
// top for the same fabric.

import * as THREE from 'three';

const mod = (n, m) => ((n % m) + m) % m;

/**
 * @param {object} opts
 *   grid                 boolean[pick][end]
 *   repeatEnds, repeatPicks
 *   ends, picks          how many threads to actually build (tiled repeat)
 *   pitch                { end, pick } — scene units (mm) between thread centres
 *   amplitude            how far a thread rises/dips at a crossing (mm) —
 *                        driven by the real yarn diameter, not a fixed constant
 * @returns {{ warpPaths, weftPaths }} — each {points: THREE.Vector3[]}[],
 *   ready for knit3d/fabric-mesh.js's buildFabricMesh (generic tube builder,
 *   not knit-specific — reused as-is rather than duplicated).
 */
export function buildWeavePaths(opts) {
  const { grid, repeatEnds, repeatPicks, ends, picks, pitch, amplitude } = opts;
  const amp = amplitude != null ? amplitude : 0.16;
  const warpUp = (pick, end) => !!(grid[mod(pick, repeatPicks)] || [])[mod(end, repeatEnds)];

  // One control point PER CROSSING along each thread, alternating +amp/-amp
  // as the grid dictates — a Catmull-Rom tube through these points gives the
  // smooth over/under undulation every weave diagram implies (the "crimp"
  // curve), with no extra interpolation code needed.
  const warpPaths = [];
  for (let e = 0; e < ends; e++) {
    const x = e * pitch.end;
    const pts = [];
    for (let p = 0; p < picks; p++) {
      pts.push(new THREE.Vector3(x, (p + 0.5) * pitch.pick, warpUp(p, e) ? amp : -amp));
    }
    if (!pts.length) continue;
    // pad a selvedge point at each end so the tube doesn't stop mid-cell
    pts.unshift(new THREE.Vector3(x, pts[0].y - pitch.pick * 0.5, pts[0].z));
    pts.push(new THREE.Vector3(x, pts[pts.length - 1].y + pitch.pick * 0.5, pts[pts.length - 1].z));
    warpPaths.push({ points: pts });
  }

  const weftPaths = [];
  for (let p = 0; p < picks; p++) {
    const y = (p + 0.5) * pitch.pick;
    const pts = [];
    for (let e = 0; e < ends; e++) {
      // the weft occupies the OPPOSITE plane of the warp at the same crossing
      pts.push(new THREE.Vector3((e + 0.5) * pitch.end, y, warpUp(p, e) ? -amp : amp));
    }
    if (!pts.length) continue;
    pts.unshift(new THREE.Vector3(pts[0].x - pitch.end * 0.5, y, pts[0].z));
    pts.push(new THREE.Vector3(pts[pts.length - 1].x + pitch.end * 0.5, y, pts[pts.length - 1].z));
    weftPaths.push({ points: pts });
  }

  return { warpPaths, weftPaths };
}
