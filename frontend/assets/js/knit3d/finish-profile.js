// KnitAdvisor · knit3d — what a finish and a dyeing method do to the cloth.
//
// One table, read by the yarn material, the hairiness layer, the macro
// cloth, the dye shader and the fabric body, so every view of a finish agrees.
// The finish id is the engine's (fabric_physics.physics.finish_id); the dye
// method is the wet-processing route (reactive / disperse / pigment /
// discharge / garment_wash).
//
//   hair, hairLen   protruding-fibre count and length multipliers
//                   (peach: many, very short; singeing burns them off)
//   rough, sheen,   material deltas: mercerising adds lustre (smoother,
//   clearcoat       more specular), silicone a soft sheen, resin goes matte
//   sheenRough      the velvet rim's spread, when the finish sets it
//   normal          relief multiplier (a sanded or raised surface softens it)
//   bendK, crease   bending stiffness multiplier, and fold-radius multiplier
//                   (resin: much stiffer, but creases sharply)
//   fade            how far exposed high points lighten (worn / washed)
//   sheenTint       how far the sheen rim goes toward white: raised fibre
//                   ends scatter light, giving the pale "bloom" a peached or
//                   brushed fabric has at grazing angles
//   lift            a raised surface's overall lightening (the fibre layer
//                   above the knit scatters back light that would otherwise
//                   enter the dyed yarn) — the engine's own L shift for the
//                   finish is in the base colour; this is the cloth-level part

export const FINISH_LOOK = {
  none:         { hair: 1.0,  hairLen: 1.0,  rough: 0,     sheen: 0,     clearcoat: 0,    sheenRough: null, normal: 1.0,  bendK: 1.0,  crease: 1.0,  fade: 0,    sheenTint: 0.55 },
  peach_finish: { hair: 3.6,  hairLen: 0.55, rough: 0.06,  sheen: 0.3,   clearcoat: 0,    sheenRough: 0.35, normal: 0.6,  bendK: 0.80, crease: 1.0,  fade: 0,    sheenTint: 0.9, lift: 0.07 },
  brushed:      { hair: 3.2,  hairLen: 0.9,  rough: 0.08,  sheen: 0.25,  clearcoat: 0,    sheenRough: 0.5,  normal: 0.55, bendK: 0.85, crease: 1.0,  fade: 0,    sheenTint: 0.85, lift: 0.08 },
  enzyme_wash:  { hair: 0.3,  hairLen: 0.8,  rough: 0.04,  sheen: -0.1,  clearcoat: 0,    sheenRough: null, normal: 1.0,  bendK: 0.90, crease: 1.0,  fade: 0.10, sheenTint: 0.5 },
  vintage_wash: { hair: 0.8,  hairLen: 0.9,  rough: 0.05,  sheen: -0.2,  clearcoat: 0,    sheenRough: null, normal: 1.0,  bendK: 0.85, crease: 1.0,  fade: 0.35, sheenTint: 0.55 },
  silicone:     { hair: 0.8,  hairLen: 1.0,  rough: -0.10, sheen: 0.1,   clearcoat: 0.05, sheenRough: 0.5,  normal: 0.9,  bendK: 0.65, crease: 1.0,  fade: 0,    sheenTint: 0.6 },
  mercerized:   { hair: 0.35, hairLen: 1.0,  rough: -0.20, sheen: -0.3,  clearcoat: 0.2,  sheenRough: null, normal: 0.85, bendK: 1.05, crease: 1.0,  fade: 0,    sheenTint: 0.45 },
  singed:       { hair: 0.08, hairLen: 1.0,  rough: -0.05, sheen: -0.25, clearcoat: 0,    sheenRough: null, normal: 1.0,  bendK: 1.0,  crease: 1.0,  fade: 0,    sheenTint: 0.45 },
  resin:        { hair: 0.9,  hairLen: 1.0,  rough: 0.05,  sheen: -0.2,  clearcoat: 0,    sheenRough: null, normal: 1.1,  bendK: 1.8,  crease: 0.45, fade: 0,    sheenTint: 0.5 },
};

// Pigment sits ON the fibre surface (bound by a binder), so it wears and
// washes off the exposed high points first, and reads slightly chalky; a
// garment wash wears the whole piece. Reactive / disperse dye goes INTO the
// fibre and stays even.
export const DYE_LOOK = {
  reactive:     { fade: 0,    chalk: 0,    rough: 0 },
  disperse:     { fade: 0,    chalk: 0,    rough: 0 },
  discharge:    { fade: 0,    chalk: 0,    rough: 0 },
  pigment:      { fade: 0.22, chalk: 0.12, rough: 0.05 },
  garment_wash: { fade: 0.30, chalk: 0.05, rough: 0.03 },
};

// Raw (undyed, unfinished) fibre colour — the greige cloth off the machine.
export const GREIGE_HEX = {
  cotton: '#e8e0cc', linen: '#cfc3a6', hemp: '#cbbf9f', wool: '#e6dcc4', silk: '#ece4cf',
  viscose: '#ebe7dc', modal: '#ebe7dc',
  polyester: '#ecebe7', nylon: '#ecebe7', acrylic: '#ecebe7', spandex: '#ecebe7',
};

/** The combined look for a finished fabric (finish + dye method). */
export function finishedLook(finishId, dyeMethod) {
  const f = FINISH_LOOK[finishId] || FINISH_LOOK.none;
  const d = DYE_LOOK[dyeMethod] || DYE_LOOK.reactive;
  return {
    ...f,
    rough: f.rough + d.rough,
    fade: Math.min(0.6, f.fade + d.fade),
    chalk: d.chalk,
  };
}

/** Greige: no finish, no dye effects. */
export function greigeLook() {
  return { ...FINISH_LOOK.none, chalk: 0 };
}
