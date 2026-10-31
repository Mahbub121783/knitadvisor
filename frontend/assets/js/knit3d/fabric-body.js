// KnitAdvisor · knit3d — the fabric as a physical body: thickness, loft and
// bending, from GSM, structure, fibre and finish.
//
// The engine reports neither thickness nor bending stiffness (its drape_band
// is a fibre-level label), so these are ESTIMATES from two standard
// relations, calibrated against typical published values for knits:
//
//   thickness  t = GSM / ρ_bulk
//     ρ_bulk is the fabric's apparent density, mostly set by its structure:
//     a brushed fleece is ~0.15 g/cm³ (half air), a single jersey ~0.30,
//     a warp knit ~0.40. Heavier fibres pack denser; elastane compacts.
//       160 GSM jersey  → ~0.53 mm      300 GSM fleece → ~2.0 mm
//       220 GSM interlock → ~0.67 mm    300 GSM terry  → ~1.3 mm
//
//   bending length  c = (B / W)^(1/3)      (Peirce cantilever)
//     B = K · t³ — bending rigidity grows with the CUBE of thickness, scaled
//     by how stiff the structure is per unit thickness (a pile or an open
//     rib is thick but soft); W = the fabric's weight per area.
//     c is how far the fabric holds itself out before drooping: it sets how
//     soft a fold is and how long and deep its drape waves are.
//       160 jersey ~1.6 cm   220 interlock ~2.0 cm   300 fleece ~2.5 cm
//
// Recovery (elastane) only shows when the fabric is stretched — that needs
// the interactive pull planned for later; here elastane just compacts and
// stiffens the fabric slightly, which is what it does at rest.

import { FINISH_LOOK } from './finish-profile.js?v=20260608g';

// Apparent density (g/cm³) and bending stiffness per thickness (relative to
// a single jersey) for each structure.
const STRUCTURE = {
  jersey:    { rho: 0.30, k: 1.00 },
  rib:       { rho: 0.26, k: 0.55 },
  interlock: { rho: 0.33, k: 1.25 },
  pique:     { rho: 0.28, k: 1.10 },
  waffle:    { rho: 0.19, k: 0.55 },
  terry:     { rho: 0.23, k: 0.45 },
  fleece:    { rho: 0.15, k: 0.20 },
  velour:    { rho: 0.18, k: 0.30 },
  mesh:      { rho: 0.27, k: 0.85 },
  warp:      { rho: 0.40, k: 1.30 },
};

// Bending stiffness of the fibre relative to cotton (viscose/modal drape,
// linen is boardy), and fibre density relative to cotton (packing).
const FIBRE = {
  cotton:    { k: 1.00, rho: 1.00 },
  polyester: { k: 1.10, rho: 0.91 },
  nylon:     { k: 0.90, rho: 0.75 },
  viscose:   { k: 0.60, rho: 1.00 },
  modal:     { k: 0.60, rho: 1.00 },
  silk:      { k: 0.70, rho: 0.88 },
  linen:     { k: 1.60, rho: 1.00 },
  hemp:      { k: 1.60, rho: 1.00 },
  wool:      { k: 0.80, rho: 0.86 },
  acrylic:   { k: 0.90, rho: 0.77 },
  spandex:   { k: 0.50, rho: 0.80 },
};

// Finishes change the hand: bendK scales stiffness (silicone 0.65 … resin
// 1.8), crease scales the fold radius (resin creases sharply, like paper).

// K for a single jersey, chosen so a 160 GSM cotton jersey (t ≈ 0.53 mm)
// lands on c ≈ 1.6 cm, a typical measured value.
const K_JERSEY = 4.3e4;            // N/m² (B = K·t³ per unit width)

export function structureKind(con) {
  if (!con) return 'jersey';
  const label = String(con.label || '').toLowerCase();
  if (con.base === 'warp' || con.type === 'tricot') return 'warp';
  if (con.type === 'fleece') return con.pile === 'velour' || label.includes('velour') ? 'velour' : 'fleece';
  if (con.type === 'terry') return 'terry';
  if (label.includes('waffle')) return 'waffle';
  if (STRUCTURE[con.type]) return con.type;
  return 'jersey';
}

/**
 * @param {object} o { gsm, construction, fiberType, elastanePct, physics,
 *                     countNe, loopNe }
 * @returns {{ kind, thicknessMm, bendingCm, foldRadiusCm, napMm, waveLenCm,
 *             waveAmpCm, softness }}
 */
export function fabricBody(o) {
  const gsm = Math.max(60, Math.min(700, Number(o.gsm) || 180));
  const kind = structureKind(o.construction);
  const s = STRUCTURE[kind];
  const f = FIBRE[o.fiberType] || FIBRE.cotton;
  const el = Math.max(0, Math.min(30, Number(o.elastanePct) || 0));
  const fin = FINISH_LOOK[o.physics && o.physics.finish_id] || FINISH_LOOK.none;
  const finishK = fin.bendK;

  const rho = s.rho * (0.85 + 0.15 * f.rho) * (1 + el * 0.012);   // g/cm³
  const tMm = gsm / (rho * 1000);
  const t = tMm / 1000;                                             // m
  const K = K_JERSEY * s.k * f.k * finishK * (1 + el * 0.01);
  const B = K * t * t * t;                                          // N·m
  const W = (gsm / 1000) * 9.81;                                    // N/m²
  const cCm = Math.cbrt(B / W) * 100;

  // Raised pile: the thickness above the knitted base (face + pile yarn).
  let napMm = 0;
  if (kind === 'fleece' || kind === 'velour' || kind === 'terry') {
    const dia = (ne) => 0.907 / Math.sqrt(ne || 30);
    const base = dia(o.countNe) + dia(o.loopNe || (o.countNe || 30) / 1.6);
    napMm = Math.max(0.2, tMm - base);
  }

  return {
    kind,
    thicknessMm: tMm,
    bendingCm: cCm,
    // A fold turned back under its own weight bends with a radius of about a
    // third of the bending length, and never tighter than the cloth is thick.
    foldRadiusCm: (0.32 * cCm) * fin.crease + 0.1 * tMm,
    napMm,
    // A cloth lying loose settles into waves a few bending lengths long.
    waveLenCm: 3.6 * cCm,
    waveAmpCm: 0.085 * 3.6 * cCm,
    softness: Math.max(0, Math.min(1, 1 - (cCm - 1.2) / 2)),          // 1 = very soft
  };
}

// ── Mechanics for the interactive cloth (cloth-physics.js) ─────────────────
// Stretch at a standard load and immediate recovery, per structure — again
// ESTIMATES, labelled as such wherever shown. The load is a 17.8 N (4 lbf)
// pull on a 7.6 cm (3 in) strip, the usual knit stretch-test load.
const F_STD = 17.8 / 0.076;                          // N per metre of width

// Width-wise stretch at that load for a medium-tight cotton fabric, and the
// lengthwise stretch as a fraction of it. A rib opens its purl wales and
// stretches furthest across; a warp knit and a fleece (the fleecy yarn
// holds the back) least.
const STRETCH = {
  jersey: 0.45, rib: 0.9, interlock: 0.35, pique: 0.38, waffle: 0.45,
  terry: 0.30, fleece: 0.28, velour: 0.30, mesh: 0.40, warp: 0.25,
};
const LENGTH_RATIO = { rib: 0.35, warp: 0.6 };

// Fibre recovery from 1 % strain (%), used when the engine reports none
// (its own value, from Morton & Hearle, wins — see fabricMechanics).
const FIBRE_RECOVERY_1PCT = {
  cotton: 91, linen: 84, hemp: 84, viscose: 82, modal: 85, wool: 99, silk: 92,
  polyester: 97, nylon: 99, acrylic: 95, spandex: 99,
};

// Layer-on-layer friction: fibre surface first, then the finish and any pile.
const FRICTION = {
  cotton: 0.55, linen: 0.6, hemp: 0.6, viscose: 0.45, modal: 0.45, wool: 0.65,
  silk: 0.25, polyester: 0.4, nylon: 0.35, acrylic: 0.5, spandex: 0.5,
};
const FINISH_FRICTION = {
  peach_finish: 0.3, brushed: 0.35, enzyme_wash: 0.05, vintage_wash: 0.05,
  silicone: -0.25, mercerized: -0.1, singed: -0.05, resin: 0.05,
};

/**
 * @param {object} o    same inputs as fabricBody, plus tf (tightness factor)
 *                      and fibreRecovery1 (engine's fibre recovery from 1 %)
 * @param {object} body fabricBody(o)
 */
export function fabricMechanics(o, body) {
  const kind = body.kind;
  const tf = Number(o.tf) || 14;
  const el = Math.max(0, Math.min(30, Number(o.elastanePct) || 0));
  const gsm = Math.max(60, Math.min(700, Number(o.gsm) || 180));

  // A tighter knit (higher tightness factor) has less loop slack to open.
  const tight = Math.pow(15 / Math.max(8, Math.min(22, tf)), 0.7);
  const elGain = 1 + Math.min(1.2, 0.15 * el);
  const stretchX = (STRETCH[kind] || 0.45) * tight * elGain;
  const stretchY = stretchX * (LENGTH_RATIO[kind] || 0.5);

  // Immediate recovery after release. Most of a knit's stretch is loop
  // deformation, which springs back against inter-yarn friction; the fibre's
  // own recovery sets how much of the rest stays as growth. Elastane pulls
  // the loops back almost completely.
  const r1 = Number.isFinite(o.fibreRecovery1)
    ? o.fibreRecovery1 : (FIBRE_RECOVERY_1PCT[o.fiberType] || 91);
  const loss = (0.10 + 1.1 * (1 - r1 / 100)) * Math.max(0.15, 1 - el / 6);
  const recovery = Math.max(0.5, Math.min(0.99, 1 - loss));

  const finishId = o.physics && o.physics.finish_id;
  let mu = (FRICTION[o.fiberType] || 0.5) + (FINISH_FRICTION[finishId] || 0);
  if (kind === 'fleece' || kind === 'velour' || kind === 'terry') mu += 0.25;   // pile grips
  mu = Math.max(0.15, Math.min(1, mu));

  const W = (gsm / 1000) * 9.81;                                     // N/m²
  const c = body.bendingCm / 100;                                    // m
  return {
    stretchX, stretchY, recovery,
    E2Dx: F_STD / stretchX, E2Dy: F_STD / stretchY,                  // N/m (secant)
    G2D: 0.12 * F_STD / stretchX,                                    // knits shear easily
    B: W * c * c * c,                                                // N·m, from the bending length
    massPerArea: gsm / 1000,                                         // kg/m²
    thicknessM: body.thicknessMm / 1000,
    frictionSelf: mu,
    frictionTable: Math.max(0.2, Math.min(0.9, mu * 0.9)),
  };
}
