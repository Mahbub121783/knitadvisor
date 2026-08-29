// KnitAdvisor · knit3d — deterministic hash noise.
//
// Per-stitch micro-deviation must be STABLE (same swatch every render) yet look
// random, so we use a hash of the integer (wale, course) coordinates rather than
// Math.random(). This gives the "hand-made / real machine" feel from ধাপ ৪
// without animating or flickering between paints.

/** Deterministic pseudo-random in [0,1) from two coordinates + a channel salt. */
export function hash2(x, y, salt = 0) {
  const n = Math.sin((x + salt * 0.137) * 127.1 + (y + salt * 0.911) * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** A small signed jitter vector for a stitch, scaled by per-axis amplitudes. */
export function stitchJitter(w, c, amp) {
  return {
    x: (hash2(w, c, 1) - 0.5) * 2 * amp.x,
    y: (hash2(w, c, 2) - 0.5) * 2 * amp.y,
    z: (hash2(w, c, 3) - 0.5) * 2 * amp.z,
  };
}
