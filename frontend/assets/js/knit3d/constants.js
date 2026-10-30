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
// Keyhole-shaped, as in a real jersey loop: narrow feet (squeezed through the
// head of the loop below), legs widening to their maximum around mid-height
// (where neighbouring wales' legs touch — a closed fabric, not a lattice),
// then narrowing into a ROUND head that tucks behind the lower legs of the
// loop above. The old profile kept widening all the way up into a flat head
// ±0.46 wide, so neighbouring heads met edge to edge and every course read
// as one straight horizontal rod across the face.
//
// Depth: feet sit back (behind the shoulders of the loop below), the legs
// swing forward in front of that lower loop's head (the real over/under
// intermesh), and the head drops back again behind the legs above. Only
// the crown tip of each head peeks out in the V-notch of the loop above it,
// which is exactly what a macro photo of a jersey face shows.
export const LOOP = {
  footHalf:     0.16,  footY:     -0.50, footZ:     -0.10,
  lowLegHalf:   0.26,  lowLegY:   -0.18, lowLegZ:    0.20,
  legHalf:      0.36,  legY:       0.18, legZ:       0.24,   // widest — touches the next wale
  shoulderHalf: 0.32,  shoulderY:  0.48, shoulderZ:  0.10,
  headHalf:     0.22,  headSideY:  0.68, headSideZ: -0.08,
  headY:        0.80,  headZ:     -0.12,                     // crown, behind the legs above
  sinkerY:     -0.62,  sinkerZ:   -0.20,                     // ∪ below the feet, at the back
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

// ── 3-thread fleece: FACE yarn (plain knit, see LOOP above) + a separate
//    BINDING/FLEECY yarn that ties in with a periodic tuck and floats behind
//    the rest of the time. The floats are the real yarn that finishing
//    brushes into the raised nap — see topology-builder.js's fleece branch
//    and knit-renderer.js `_addPile`, which samples pile fibres along them
//    instead of scattering them over an unrelated flat plane. ──
// NEGATIVE: +z is toward the viewer (the technical face). At +0.55 the
// fleecy yarn's tucks and floats were built IN FRONT of the face, laid across
// it like a chain-link lattice, and the pile rooted on the wrong side.
export const FLEECE_BIND_DEPTH = -0.30; // float layer, directly behind the face
export const FLEECE_TUCK_Z     = -0.12; // tuck: caught into the back of the face loop
export const FLEECE_BINDER_Z   = -0.16; // plated binder: same loops, one yarn-width behind the face
export const FLEECE_TUCK_EVERY = 4;     // fallback only — the engine's real feed sequence wins

// ── Pointelle / eyelet mesh (ধাপ ২ transfer stitch) ──
// A hole is a transferred (omitted) loop. The yarn that would have formed it is
// carried across the back (TRANSFER_Z, hidden behind the backing) so the eyelet
// reads as an open dark gap, and the loops ringing the hole lean AWAY from it.
export const TRANSFER_Z = -0.34;      // transfer float sits behind the backing plane
export const HOLE_PUSH  = 0.12;       // how far ring loops lean away from a hole
export const HOLE_PUSH_Z = 0.04;      // ring loops lift slightly (opens the eyelet)

// ── Opaque backing (gives the swatch body; valleys & eyelets read dark, not
//    see-through). Sits just behind the loop heads. ──
// The plane stays INSIDE the loop field (insets in stitch units) — any margin
// beyond the loops shows as a flat dark slab around the swatch once tilted.
export const BACKING = { z: -0.05, shade: 0.42, insetX: 0.7, insetY: 1.25 };

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
