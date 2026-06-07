// KnitAdvisor · knit3d — WARP knit topology (tricot / raschel).
//
// Warp knitting is fundamentally different from weft (ধাপ ১ warp mechanism):
// every needle is fed by its OWN warp end, and the guide bar SHOGS sideways
// (overlap on the needle + underlap across the back) so each end zig-zags
// between adjacent wales course by course. The result is vertical loop chains
// linked by diagonal underlaps on the technical back — the classic tricot look.
//
// We model one continuous strand PER WARP END:
//   course c → form a loop on needle (e + lap(c)); a 1-0/1-2 closed lap gives the
//   zig-zag. Between courses the yarn runs as an UNDERLAP float at the back.
// For warp NET / powernet, laps are periodically skipped → open eyelets.

import * as THREE from 'three';
import { knitLoop } from './loop-geometry.js?v=20260608d';
import { stitchJitter } from './noise.js?v=20260608d';
import { PITCH_X, PITCH_Y, JITTER, PATCH } from './constants.js?v=20260608d';

const UNDERLAP_Z = -0.30;   // underlaps run across the technical back

// A closed-lap tricot zig-zag: alternate the needle the end laps onto.
function lap(c) { return c % 2; }            // 0,1,0,1 … → 1-0/0-1 movement

export function buildWarpPaths(opts = {}) {
  const ends = opts.ends || PATCH.wales;
  const courses = opts.courses || PATCH.courses;
  const net = !!opts.net;                    // powernet / marquisette → skip laps
  const paths = [];

  for (let e = 0; e < ends; e++) {
    const points = [];
    let prevFoot = null;
    for (let c = 0; c < courses; c++) {
      // a net opens holes by periodically missing the lap (no loop this course)
      const miss = net && ((c % 4 === 3) && ((e + Math.floor(c / 4)) % 3 === 0));

      const wale = e + lap(c);
      const cx = wale * PITCH_X;
      const cy = c * PITCH_Y;
      const jit = stitchJitter(e, c, JITTER);

      if (miss) {
        // underlap float straight up at the back (leaves an eyelet)
        const fx = cx + jit.x;
        if (prevFoot) points.push(new THREE.Vector3((prevFoot.x + fx) / 2, cy - PITCH_Y * 0.5, UNDERLAP_Z));
        prevFoot = new THREE.Vector3(fx, cy, UNDERLAP_Z);
        points.push(prevFoot);
        continue;
      }

      const loop = knitLoop({
        cx, cy, heldExtra: 0, zBase: 0, mirror: false, jitter: jit, sinker: false,
      });

      // underlap: diagonal back float from the previous loop's foot to this one
      if (prevFoot) {
        const first = loop[0];
        points.push(new THREE.Vector3(
          (prevFoot.x + first.x) / 2,
          (prevFoot.y + first.y) / 2,
          UNDERLAP_Z,
        ));
      }
      for (const pt of loop) points.push(pt);
      prevFoot = loop[loop.length - 1];   // right foot
    }
    if (points.length > 1) paths.push({ points });
  }
  return { paths };
}
