// KnitAdvisor · knit3d — pointelle / eyelet hole patterns (transfer stitch).
//
// A pointelle hole is a loop transferred to a neighbouring needle, leaving an
// open eyelet. We model the motif as a boolean field isHole(w,c) plus a
// displacement field so the loops ringing each hole lean away from it (which is
// what opens the eyelet in a real transfer-stitch fabric).
//
// Motifs are chosen from the construction's holeShape:
//   'hex'/'chevron'  → zig-zag chevron eyelet field  (cf. the teal reference)
//   'diamond'        → vertical diamond eyelet columns (cf. the pink reference)
//   'round'/other    → a regular scattered eyelet grid (airtex / net)

import { HOLE_PUSH, HOLE_PUSH_Z } from './constants.js?v=20260608e';

const mod = (n, m) => ((n % m) + m) % m;

// Zig-zag chevron lines of eyelets.
function chevron(w, c) {
  const PW = 12;            // chevron horizontal repeat (one full V)
  const PH = 10;            // chevron vertical repeat
  const half = PW / 2;
  // triangle wave 0..half over the course direction → the V apex travels in x
  const tri = Math.abs(mod(c, PH) / PH * PW - half);
  const x = mod(w, PW);
  // place eyelets on the two arms of the V (a dotted chevron, not a solid line)
  return Math.abs(x - tri) < 0.6 || Math.abs((PW - x) - tri) < 0.6;
}

// Vertical columns of diamond-shaped eyelet clusters.
function diamondCols(w, c) {
  const COL = 6;            // a diamond column every 6 wales
  const PH = 10;            // a diamond every 10 courses
  const cw = mod(w, COL);
  if (cw > 2) return false;          // only near the column centre (cw 0..2)
  const cc = mod(c, PH);
  // diamond outline: centre dash (cw 1) tall, side dots (cw 0/2) at mid height
  if (cw === 1) return cc === 0 || cc === 1 || cc === 2;
  return cc === 1;                    // the two shoulders of the diamond
}

// Regular scattered eyelet grid.
function grid(w, c) {
  const S = 5;
  return mod(w, S) === 2 && mod(c, S) === 2;
}

function motifFor(holeShape) {
  if (holeShape === 'diamond') return diamondCols;
  if (holeShape === 'round') return grid;
  return chevron;            // hex / default
}

/** Build a hole-test + displacement helper for a construction. */
export function makePointelle(holeShape) {
  const fn = motifFor(holeShape);
  const isHole = (w, c) => fn(w, c);

  // Loops adjacent to a hole are pushed away from it (sum over 8 neighbours),
  // which opens the eyelet instead of letting the loop close the gap.
  const displacement = (w, c) => {
    let dx = 0, dy = 0, dz = 0;
    for (let ow = -1; ow <= 1; ow++) {
      for (let oc = -1; oc <= 1; oc++) {
        if (!ow && !oc) continue;
        if (!fn(w + ow, c + oc)) continue;
        const len = Math.hypot(ow, oc) || 1;
        dx -= (ow / len) * HOLE_PUSH;
        dy -= (oc / len) * HOLE_PUSH;
        dz += HOLE_PUSH_Z;
      }
    }
    return { x: dx, y: dy, z: dz };
  };

  return { isHole, displacement };
}
