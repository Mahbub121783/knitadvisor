// KnitAdvisor · knit3d — geometric constants for the loop/yarn model.
//
// All distances are in "stitch units": one wale = PITCH_X, one course = PITCH_Y.
// The loop is authored once here as a textbook needle loop so that every
// construction (jersey / rib / interlock / piqué) reuses the exact same anatomy.
//
// Coordinate frame (local, before wale/course offset):
//   +x → toward the next wale (right)
//   +y → toward the next course (up, the grain / wale direction)
//   +z → toward the viewer (technical face)
//
// DEPTH (the part that makes it read as real knit):
//   On the technical face you see the two LEGS as a "V" — so the legs are the
//   FRONTMOST yarn (+z). The HEAD arch is pulled back toward centre, and the
//   FEET recede to the back (−z) so that the FEET of the loop in the course
//   ABOVE thread BEHIND this loop's head/legs — the real over/under intermesh.

export const PITCH_X = 1.0;   // wale spacing
export const PITCH_Y = 0.92;  // course spacing — loop height (~1.28) > pitch ⇒ ~0.36 overlap = intermesh

// ── Knit needle-loop profile (local units) ──
export const LOOP = {
  footHalf:  0.14,   // x of the two feet (loop bottom converges to a soft point)
  legHalf:   0.30,   // x partway up the legs
  headHalf:  0.46,   // x of the shoulders/head (wide top of the V — overlaps neighbours)
  footY:    -0.58,   // y of the feet (loop bottom)
  legY:     -0.16,   // y of the lower leg
  shoulderY: 0.34,   // y where the legs turn into the head arch
  headY:     0.70,   // y of the head crown (loop top)
  // depth profile — legs forward (visible V), head centred, feet back
  footZ:    -0.22,   // feet recede (back) → thread behind the head below
  legZ:      0.26,   // legs are the FRONTMOST point (the knit "V" you see)
  shoulderZ: 0.16,   // shoulders still forward
  headZ:     0.00,   // head crown pulled back to centre (behind the legs)
  sinkerY:  -0.66,   // sinker dips just below the feet
  sinkerZ:  -0.12,   // sinker sits behind, with the feet
};

// ── Tuck (held, not knocked over): a shallow cup that sits BEHIND the held loop ──
export const TUCK = {
  cupY:   0.06,
  cupZ:  -0.22,
  sideX:  0.22,
  sideY: -0.12,
  sideZ: -0.14,
};

// ── Miss/float: yarn passes straight across the back of the held loop ──
export const MISS = {
  spanX:  0.22,
  y:     -0.50,
  z:     -0.24,
};

// ── Construction tuning ──
export const RIB_PITCH_SCALE = 0.80;  // rib draws in so knit ridges stand proud
export const RIB_DEPTH       = 0.28;  // front/back bed separation for rib corrugation
export const INTERLOCK_DEPTH = 0.40;  // front/back bed separation — beds must NOT interpenetrate
export const INTERLOCK_GAIT  = 0.5;   // back bed offset by half a wale (rib gaiting)

// ── Pointelle / eyelet mesh (ধাপ ২ transfer stitch) ──
// A hole is a transferred (omitted) loop. The yarn that would have formed it is
// carried across the back (TRANSFER_Z, hidden behind the backing) so the eyelet
// reads as an open dark gap, and the loops ringing the hole lean AWAY from it.
export const TRANSFER_Z = -0.34;      // transfer float sits behind the backing plane
export const HOLE_PUSH  = 0.12;       // how far ring loops lean away from a hole
export const HOLE_PUSH_Z = 0.04;      // ring loops lift slightly (opens the eyelet)

// ── Opaque backing (gives the swatch body; valleys & eyelets read dark, not
//    see-through). Sits just behind the loop heads. ──
export const BACKING = { z: -0.05, shade: 0.42, pad: 1.2 };

// ── Planned imperfection (ধাপ ৪): subtle per-stitch deviation so the patch
//    reads as real cloth, not a perfect CG lattice. Kept small on purpose. ──
export const JITTER = { x: 0.045, y: 0.045, z: 0.030 };

// Patch size — fine gauge so the swatch reads as real cloth (not a few fat
// loops). Different beds use fewer wales/courses to balance the heavier geometry.
export const PATCH = {
  wales: 36, courses: 44,        // single-bed (jersey / piqué / mesh / pointelle)
  ribWales: 28,
  interlockWales: 24, interlockCourses: 34,
};
