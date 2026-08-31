/**
 * KnitAdvisor — Yarn Expertise Engine v1.0
 * =========================================
 *
 * The yarn IS the fabric. Count alone (e.g. "30/1") tells you almost nothing —
 * a 30/1 Supima compact-combed yarn and a 30/1 recycled open-end yarn produce
 * completely different fabrics in strength, evenness, pilling, spirality, hand,
 * and price. This engine models the THREE axes that define a real yarn:
 *
 *   1. FIBER GRADE      — staple quality + origin/sustainability
 *                         (Supima/Pima ELS → Giza → Combed Upland → Carded
 *                          Upland → Recycled; plus BCI/Organic/CmiA labels)
 *   2. SPINNING SYSTEM  — how the fibres are assembled into yarn
 *                         (Compact → Combed Ring → Carded Ring → Open-End/Rotor
 *                          → Air-Jet/Vortex)
 *   3. YARN FORM        — single / plied / slub / core-spun
 *
 * From these it derives the real engineering properties factories specify:
 *   • Tenacity (RKM, cN/tex) and CSP (count-strength product)
 *   • Evenness (U% / CVm) and Imperfections (IPI)
 *   • Hairiness and residual torque (drives spirality)
 *   • Maximum spinnable count for the grade (spinning limit)
 *   • Quality rank, price index, and end-use suitability
 *
 * Blends are handled by fibre DENSITY + regain physics so the count↔GSM
 * relationship is grounded, not guessed. Slub/fancy yarns carry an effective
 * (resultant) count distinct from their base count.
 *
 * Sources: Klein "Manual of Textile Technology" (The Technology of Short-Staple
 * Spinning); Uster Statistics 2018; Lord "Handbook of Yarn Production";
 * Supima/Pima fibre data; ASTM D2256/D1907; mill QC practice (BD/India RMG).
 *
 * Deterministic. No AI. No randomness.
 */

'use strict';

const { usterProfile } = require('./uster-engine');

// ============================================================
// 1. FIBER GRADE TAXONOMY  (cotton quality hierarchy + sustainability labels)
//    rank: 1 = finest/strongest. staple_mm = typical upper-half mean length.
//    max_count = practical fine-spin limit (Ne) for this fibre on a ring frame.
//    strength_idx / evenness_idx: 1.00 = standard combed Upland reference.
//    price_idx: relative raw-fibre cost (combed Upland virgin = 1.00).
// ============================================================
const FIBER_GRADES = {
  supima: {
    label: 'Supima / Pima (ELS)', rank: 1, staple_mm: 36, micronaire: '3.8–4.2',
    max_count: 200, strength_idx: 1.30, evenness_idx: 1.18, price_idx: 2.6,
    sustainability: 'Premium US ELS, traceable', combable: true,
    note: 'Extra-long staple. Spins the finest, strongest, most lustrous yarns. Used for premium 60s–200s.',
  },
  giza: {
    label: 'Egyptian Giza (ELS)', rank: 1, staple_mm: 35, micronaire: '3.8–4.3',
    max_count: 180, strength_idx: 1.28, evenness_idx: 1.16, price_idx: 2.8,
    sustainability: 'Egyptian ELS, luxury', combable: true,
    note: 'Giza 45/87/96. Luxury ELS for fine combed counts and high-end shirting/jersey.',
  },
  combed_upland: {
    label: 'Combed Upland', rank: 3, staple_mm: 29, micronaire: '4.0–4.7',
    max_count: 80, strength_idx: 1.00, evenness_idx: 1.00, price_idx: 1.00,
    sustainability: 'Conventional', combable: true,
    note: 'The industry workhorse for quality knits. Combing removes short fibres → cleaner, stronger yarn.',
  },
  carded_upland: {
    label: 'Carded Upland', rank: 5, staple_mm: 27, micronaire: '4.2–4.9',
    max_count: 40, strength_idx: 0.86, evenness_idx: 0.84, price_idx: 0.82,
    sustainability: 'Conventional', combable: false,
    note: 'No combing — retains short fibres. Hairier, weaker, cheaper. Good for coarse/medium counts.',
  },
  bci: {
    label: 'BCI Cotton', rank: 3, staple_mm: 29, micronaire: '4.0–4.7',
    max_count: 80, strength_idx: 1.00, evenness_idx: 1.00, price_idx: 1.03,
    sustainability: 'Better Cotton Initiative (mass-balance)', combable: true,
    note: 'A SOURCING standard, not a fibre grade — properties match conventional Upland of equal staple. Combable.',
  },
  organic: {
    label: 'Organic Cotton', rank: 4, staple_mm: 28, micronaire: '4.0–4.8',
    max_count: 60, strength_idx: 0.96, evenness_idx: 0.95, price_idx: 1.35,
    sustainability: 'GOTS/OCS certified', combable: true,
    note: 'Certified organic. Slightly more variable staple than conventional; price premium for certification.',
  },
  cmia: {
    label: 'Cotton made in Africa', rank: 4, staple_mm: 28, micronaire: '4.1–4.8',
    max_count: 60, strength_idx: 0.97, evenness_idx: 0.96, price_idx: 1.05,
    sustainability: 'CmiA mass-balance', combable: true,
    note: 'African sustainability sourcing standard. Properties ≈ conventional Upland.',
  },
  recycled: {
    label: 'Recycled Cotton', rank: 7, staple_mm: 18, micronaire: 'n/a',
    max_count: 20, strength_idx: 0.55, evenness_idx: 0.60, price_idx: 0.70,
    sustainability: 'Mechanical/post-consumer recycled', combable: false,
    note: 'Fibres broken/shortened during recycling → weak, uneven, coarse-count only. Almost always blended with virgin cotton/PET (20–50%) for spinnability.',
  },
};
const DEFAULT_FIBER_GRADE = 'combed_upland';

// ============================================================
// 2. SPINNING SYSTEM TAXONOMY
//    rkm = tenacity in cN/tex (RKM). u_pct = Uster evenness (lower=better).
//    hairiness_idx, torque_idx (drives spirality), count range, cost factor.
//    Source: Uster Statistics 2018 medians; Klein; Lawrence "Advances in Yarn Spinning".
// ============================================================
const SPINNING_SYSTEMS = {
  compact: {
    label: 'Compact (ring)', rkm: 20, u_pct: 9.0, hairiness_idx: 0.55, torque_idx: 0.60,
    count_min: 20, count_max: 120, cost_idx: 1.20,
    note: 'Condensed fibre bundle before twist → lowest hairiness, highest strength. Best for fine premium counts.',
  },
  combed: {
    label: 'Combed (ring)', rkm: 18, u_pct: 9.8, hairiness_idx: 0.80, torque_idx: 0.85,
    count_min: 16, count_max: 100, cost_idx: 1.00,
    note: 'Combed sliver, ring spun. Standard for quality jersey/interlock. Strong, even.',
  },
  carded: {
    label: 'Carded (ring)', rkm: 16, u_pct: 11.5, hairiness_idx: 1.00, torque_idx: 1.00,
    count_min: 6, count_max: 40, cost_idx: 0.85,
    note: 'Carded sliver, ring spun. Reference for hairiness/torque. Medium/coarse counts.',
  },
  open_end: {
    label: 'Open-End (Rotor)', rkm: 13, u_pct: 11.0, hairiness_idx: 0.70, torque_idx: 0.65,
    count_min: 6, count_max: 30, cost_idx: 0.70,
    note: 'Rotor spun — bulkier, weaker (~-20% vs ring) but cheap & fast. Denim, fleece, sweat. Lower torque → less spirality.',
  },
  vortex: {
    label: 'Air-Jet / Vortex (MVS)', rkm: 15, u_pct: 10.5, hairiness_idx: 0.30, torque_idx: 0.32,
    count_min: 20, count_max: 60, cost_idx: 0.95,
    note: 'Air-jet (Murata Vortex). Very low hairiness, near torque-free → minimal spirality & pilling. Excellent for CVC/poly blends.',
  },
};
const DEFAULT_SPINNING = { fine: 'combed', medium: 'combed', coarse: 'carded' };

// ============================================================
// 3. FIBER DENSITY + REGAIN  (blend GSM/diameter physics)
//
//    density  g/cm³, AT 65% r.h. — not dry. Fabric weight is measured on
//             conditioned cloth and GSM is quoted on conditioned cloth, so a
//             dry density would be the wrong number for a calculation about
//             cloth as it is sold. The two differ by up to 2% (cotton is 1.55
//             dry and 1.52 conditioned), which is exactly enough to look
//             plausible while being wrong.
//    regain   % at 65% RH.
//    rkm      NOT a tenacity. It is a dimensionless strength index relative to
//             cotton = 1.00, multiplied against SPINNING_SYSTEMS.rkm (which IS
//             cN/tex) at line ~269. The name collides with that one; the two
//             are used correctly today, but read the multiplication before
//             changing either.
//    tensile  The measured single-FIBRE mechanics, added below. These are not
//             the same thing as `rkm` and do not replace it — see the note on
//             the tensile block itself for why a yarn's strength ratio is not
//             its fibre's strength ratio.
//
//    SOURCE — density: Morton & Hearle, "Physical Properties of Textile
//    Fibres", 4th edn (2008), Table 5.1, printed p.165. Every figure below is
//    the 65% r.h. column of that table, and
//    scripts/check-engine-against-book.js compares them against the extracted
//    measurements in data/fibre-properties.json so the two cannot drift.
//
//    SOURCE — regain: still "textile fibre handbooks (ASTM D1909)", with no
//    edition and no page. Chapter 7 of the same book gives regain properly and
//    has not been read yet; these figures are not yet checkable.
// ============================================================
//
// ============================================================
// 3b. WHAT THE FIBRE DOES WHEN IT IS PULLED, AND WHEN IT IS WET
//
//    tenacity   N/tex    specific stress at break
//    extension  %        how far it stretches getting there
//    modulus    N/tex    slope at the origin: stiffness, and the nearest
//                        measured thing there is to fabric handle
//    wet        { ten, ext, mod }   each value WET divided by the same value at
//                        65% r.h. — so 1.00 means water changes nothing
//    hot_wet    { ten, ext, mod }   wet at 95 C divided by wet at 20 C, which
//                        is the difference between a rinse and a dyebath
//    swelling   { area, axial, volume }  the percentage each grows by when the
//                        fibre is immersed in water, as [low, high]. The range
//                        is a DISAGREEMENT BETWEEN LABORATORIES, not one
//                        laboratory's uncertainty: Table 11.1 collects several
//                        workers' published figures side by side and the text
//                        above it says they diverge. Area is the figure to use
//                        — the book's section 11.2.3 says diameter swelling is
//                        meaningless for a fibre whose cross-section is not
//                        round, and acetate proves it by swelling more in
//                        diameter than in area. Only five fibres have it;
//                        Table 11.1 predates most synthetics.
//
//    SOURCE: Morton & Hearle 4th edn, Table 13.1 (p.290), Table 13.2 (p.292)
//    and Table 13.7 (p.312), extracted by coordinate and verified against the
//    book's own identity — work of rupture = work factor x tenacity x
//    extension — for every row. scripts/check-engine-against-book.js compares
//    what is below against data/fibre-properties.json on every run.
//
//    WHICH GRADE. These tables give a row per grade, not per fibre, and the
//    grades differ by more than the fibres do: nylon 6.6 runs 0.37 N/tex as
//    staple and 0.66 as high-tenacity filament. Where the book offers a choice
//    the APPAREL grade is taken, since that is what this engine calculates —
//    cotton Uppers, viscose Fibro (staple), wool Botany 64s (merino), Terylene
//    and nylon 6.6 medium-tenacity, Orlon 42 staple. The other grades are
//    stored in the reference layer under their own names.
//
//    WHY THIS DOES NOT REPLACE rkm. It is tempting to set rkm to the ratio of
//    these tenacities and be done: cotton 0.32, polyester 0.47, so 1.47. That
//    would be wrong. rkm multiplies a YARN tenacity, and a yarn is weaker than
//    the fibres in it by a translation efficiency that depends on fibre length,
//    fineness, friction and twist — none of which are the same across fibres.
//    Wool is the clearest case: its fibre tenacity is a third of cotton's, but
//    a worsted yarn reaches about half a cotton yarn's strength, because long
//    coarse fibres translate better into yarn than short fine ones. Replacing
//    rkm with the fibre ratio would have made every wool prediction 30% too
//    weak while looking better sourced. So rkm keeps its own provenance and
//    this block sits beside it, measured and separate.
// ============================================================
const FIBER_PROPERTIES = {
  cotton:    { density: 1.52, regain: 7.5,  rkm: 1.00,     // Table 5.1 p.165
               tensile: { tenacity: 0.32, extension: 7.1, modulus: 5.0,
                          grade: 'Uppers', page: 290, table: 'Table 13.1',
                          // Cotton is one of the two fibres in the book that
                          // get STRONGER wet. The cellulose swells, more chains
                          // share the load, and the fibre gains 11%. It is why
                          // cotton survives rope dyeing at tensions that would
                          // damage a rayon.
                          wet: { ten: 1.11, ext: 1.11, mod: 0.33 },
                          hot_wet: { ten: 1.00, ext: 1.00, mod: 1.00 } },
               swelling: { area: [21, 42], axial: null, volume: null,
                           page: 240, table: 'Table 11.1' } },
  polyester: { density: 1.39, regain: 0.4,  rkm: 1.25,     // was 1.38 — Table 5.1 gives 1.39
               tensile: { tenacity: 0.47, extension: 15.0, modulus: 10.6,
                          grade: 'Terylene, medium-tenacity', page: 292, table: 'Table 13.2',
                          // Water does nothing to it. Heat does: at 95 C wet it
                          // keeps 42% of its modulus and stretches 40% further,
                          // which is the whole reason polyester is heat-set.
                          wet: { ten: 1.00, ext: 1.00, mod: 1.00 },
                          hot_wet: { ten: 0.72, ext: 1.40, mod: 0.42 } } },
  viscose:   { density: 1.49, regain: 13.0, rkm: 0.60,     // was 1.52, which is the DRY figure
               tensile: { tenacity: 0.21, extension: 15.7, modulus: 6.5,
                          grade: 'Fibro, staple', page: 290, table: 'Table 13.1',
                          // The most consequential four numbers in this file.
                          // Wet viscose keeps half its strength and THREE PER
                          // CENT of its initial modulus: mechanically it is a
                          // different fibre in the dyehouse from the one that
                          // was knitted. Under any tension at all it extends,
                          // and it sets in whatever shape it dried in.
                          wet: { ten: 0.50, ext: 1.58, mod: 0.03 },
                          hot_wet: { ten: 0.90, ext: 1.03, mod: 0.80 } },
               // It roughly doubles in cross-section. Against 3.7-4.8% along
               // its length: the anisotropy is what a knit shows as width
               // movement while the length broadly holds.
               swelling: { area: [50, 114], axial: [3.7, 4.8], volume: [74, 127],
                           page: 240, table: 'Table 11.1' } },
  nylon:     { density: 1.14, regain: 4.2,  rkm: 1.40,     // Table 5.1 p.165
               tensile: { tenacity: 0.48, extension: 20.0, modulus: 3.0,
                          grade: 'nylon 6.6, medium-tenacity', page: 292, table: 'Table 13.2',
                          wet: { ten: 0.80, ext: 1.05, mod: 0.82 },
                          hot_wet: { ten: 0.79, ext: 1.76, mod: 0.21 } },
               swelling: { area: [1.6, 3.2], axial: [2.7, 2.9], volume: [8.1, 11.0],
                           page: 240, table: 'Table 11.1' } },
  wool:      { density: 1.31, regain: 16.0, rkm: 0.50,     // Table 5.1 p.165
               tensile: { tenacity: 0.11, extension: 42.5, modulus: 2.3,
                          grade: 'Botany 64s (merino)', page: 290, table: 'Table 13.1',
                          wet: { ten: 0.69, ext: 1.33, mod: 0.40 },
                          hot_wet: { ten: 0.55, ext: 1.37, mod: 0.50 } },
               swelling: { area: [25, 26], axial: null, volume: [36, 41],
                           page: 240, table: 'Table 11.1' } },
  acrylic:   { density: 1.19, regain: 1.5,  rkm: 0.70,     // was 1.17 — Table 5.1 gives 1.19
               tensile: { tenacity: 0.27, extension: 25.0, modulus: 6.2,
                          grade: 'Orlon 42, staple', page: 292, table: 'Table 13.2',
                          // Cold water leaves acrylic alone entirely. Boiling
                          // water does not: it keeps a FIFTIETH of its modulus
                          // and stretches more than four times as far. Acrylic
                          // is dyed near the boil, and this is why it comes out
                          // of the machine to whatever length it was held at.
                          wet: { ten: 0.84, ext: 1.08, mod: 1.00 },
                          hot_wet: { ten: 0.35, ext: 4.26, mod: 0.02 } } },

  // UNSOURCED. Table 5.1 has no row for any of these four, and the closest
  // rows are not substitutes: modal is a high-wet-modulus viscose and lyocell
  // (Tencel) an organic-solvent one, so both are near viscose rayon but the
  // book does not say how near, and bamboo is usually a viscose-route fibre
  // sold under its own name. Assigning viscose's 1.49 to them would turn a
  // guess into a citation. The values below are what the engine has always
  // used; they stay until a source is found, and the checker lists them as
  // unsourced every time it runs.
  // ---- Added once chapter 13 gave them a full set of measurements --------
  //
  // The composition parser has been able to name silk, polypropylene and
  // polyethylene for some time, but a named fibre with no properties is worse
  // than an unnamed one: it was recognised, weighed at nothing and reported as
  // unweighed on every blend that contained it.
  //
  // These three have every figure the engine needs from the book itself.
  // `rkm` — the dimensionless YARN strength index — is the exception and is
  // deliberately absent rather than invented: it is a property of spun yarn,
  // not of fibre, and nothing in this book measures it. blendPhysical()
  // averages it over the fibres that have one and reports the rest, so a blend
  // containing silk still gets a sourced density and regain.
  silk:      { density: 1.34, regain: 10.0,                // Table 5.1 p.165, Table 7.3 p.188
               tensile: { tenacity: 0.38, extension: 23.4, modulus: 7.3,
                          grade: 'silk', page: 290, table: 'Table 13.1',
                          wet: { ten: 0.92, ext: 1.63, mod: 0.25 },
                          hot_wet: { ten: 0.71, ext: 0.96, mod: 0.67 } },
               swelling: { area: [19, 19], axial: [1.3, 1.6], volume: [30, 32],
                           page: 240, table: 'Table 11.1' } },
  // Regain is not in Table 7.3. Polypropylene is a hydrocarbon with no polar
  // group for water to attach to, and the book's own chapter 7 explains regain
  // in exactly those terms, so zero is the physics rather than a placeholder —
  // but it is still not a measurement, and it is marked as such here.
  polypropylene: { density: 0.91, regain: 0.0, regain_assumed: true,  // Table 5.1 p.165
               tensile: { tenacity: 0.65, extension: 17.0, modulus: 7.1,
                          grade: 'Ulstron', page: 292, table: 'Table 13.2',
                          // Water does nothing at all — all four ratios are
                          // 1.00 — but at 95 C it keeps a fifth of its modulus
                          // and stretches 2.5 times as far, which is why
                          // polypropylene is finished cool.
                          wet: { ten: 1.00, ext: 1.00, mod: 1.00 },
                          hot_wet: { ten: 0.45, ext: 2.47, mod: 0.21 } } },
  polyethylene: { density: 0.95, regain: 0.0, regain_assumed: true,   // Table 5.1 p.165
               tensile: { tenacity: 0.34, extension: 10.0, modulus: 4.4,
                          grade: 'Courlene X3, high density', page: 292, table: 'Table 13.2',
                          wet: null, hot_wet: null } },
  //
  // NOT ADDED, and worth naming so nobody looks for them twice: flax (linen),
  // jute, hemp and ramie. The book gives all four a regain and a full set of
  // tensile properties, but chapter 5 has no bast fibre in it at all — no
  // density, and therefore nothing the GSM and yarn-diameter arithmetic can
  // use. Borrowing cotton's 1.52 because both are cellulose would be an
  // inference presented as a citation. Linen stays reported as unweighed until
  // a density with a source turns up.
  //
  // Chapter 13 changes this list by exactly one entry. The polyurethane
  // elastomer of Table 13.2 IS elastane, so elastane now has measured
  // mechanics even though its density and regain are still unsourced. The
  // figures are unlike anything else in the book — it breaks at 540% where
  // nylon breaks at 20, and its modulus is 0.0071 N/tex against polyester's
  // 10.6, four orders of magnitude apart — which is the arithmetic behind
  // every elastane rule of thumb on a knitting floor.
  //
  // The other three stay unsourced. The nearest measured relative to modal is
  // polynosic (0.26 N/tex, 7% extension, 13.2 N/tex modulus, p.292), and it is
  // deliberately NOT copied here: polynosic is one class of high-wet-modulus
  // rayon and modal is the generic name for the family, so they are relatives,
  // not the same fibre, and borrowing the figures would turn a resemblance
  // into a citation. It is recorded in the reference layer under its own name
  // for anyone who wants to reason from it explicitly.
  modal:     { density: 1.52, regain: 12.5, rkm: 0.85 },
  tencel:    { density: 1.50, regain: 11.5, rkm: 1.05 },
  bamboo:    { density: 1.50, regain: 13.0, rkm: 0.55 },
  elastane:  { density: 1.20, regain: 1.0,  rkm: 0.80,
               tensile: { tenacity: 0.0309, extension: 540.0, modulus: 0.0071,
                          grade: 'polyurethane elastomer', page: 292, table: 'Table 13.2',
                          // Table 13.7 does not list an elastomer, so what
                          // water does to it is not known from this book and is
                          // not guessed at here.
                          wet: null, hot_wet: null } },
};

// ============================================================
// HELPERS
// ============================================================
function neToTex(ne) { return ne > 0 ? 590.5 / ne : null; }

/** Ashenhurst yarn diameter (inch) = 1/(28·√Ne) for cotton; scaled by fibre density. */
function yarnDiameterMm(ne, blendDensity) {
  if (!ne || ne <= 0) return null;
  const d_in_cotton = 1 / (28 * Math.sqrt(ne));
  const densityScale = Math.sqrt(1.52 / (blendDensity || 1.52)); // lighter fibre → bulkier → larger d
  return parseFloat((d_in_cotton * 25.4 * densityScale).toFixed(4));
}

/**
 * The measured mechanics of a blend, and the two things a blend average hides.
 *
 * Returns null when no component of the blend has measured mechanics, rather
 * than substituting cotton, because "no data" and "behaves like cotton" are
 * different statements and only one of them is true.
 *
 * WHAT IS AVERAGED AND WHAT IS NOT
 * --------------------------------
 * The wet and hot-wet ratios are averaged by mass and reported as figures. That
 * is defensible: they describe how much each fibre softens, and half a yarn
 * softening is half a yarn's worth of softening.
 *
 * Tenacity is NOT reported as a blend figure, and this is the important part.
 * A blend does not break at the mass-weighted average of its components'
 * strengths, because the components do not break together. The one with the
 * SHORTER breaking extension reaches its limit first and fails while the other
 * is still well below its own breaking stress, so at the moment of first
 * failure the tougher fibre is contributing only the fraction of its strength
 * it has developed by then. In a cotton/polyester yarn cotton breaks at 7.1%
 * and polyester at 15%, so the cotton goes first and the polyester is carrying
 * perhaps half of what it could — which is why the strength of a poly/cotton
 * blend does not rise in a straight line with polyester content and why the
 * middle of the range is the weak part of it.
 *
 * Working that curve out properly needs the load-sharing treatment in the
 * book's chapter 20, which has not been read. So this returns the mass-weighted
 * value explicitly labelled as an UPPER BOUND, together with which fibre gives
 * way first and how far apart the extensions are. A named limit is worth more
 * than a confident number that is wrong in the middle of every blend anyone
 * actually knits.
 */
function blendMechanics(fibers) {
  if (!fibers) return null;

  let mass = 0;
  const parts = [];
  const unmeasured = [];
  for (const [name, pct] of Object.entries(fibers)) {
    if (!pct) continue;
    const p = FIBER_PROPERTIES[name];
    if (!p || !p.tensile) { unmeasured.push(name); continue; }
    // `swelling` sits beside `tensile` on the fibre, not inside it: they come
    // from different chapters measured on different apparatus, and nesting one
    // in the other would imply they were taken together.
    parts.push({ name, pct, t: p.tensile, s: p.swelling });
    mass += pct;
  }
  if (!parts.length) return null;

  const mean = pick => parts.reduce((a, x) => a + pick(x.t) * x.pct, 0) / mass;
  const wetMean = (group, key) => {
    // A fibre with no measured behaviour in water must not be silently read as
    // 1.00, which would say water leaves it alone. It is dropped from the mean
    // and named instead.
    const known = parts.filter(x => x.t[group]);
    if (!known.length) return null;
    const w = known.reduce((a, x) => a + x.pct, 0);
    return round3(known.reduce((a, x) => a + x.t[group][key] * x.pct, 0) / w);
  };

  // Swelling, over the fibres that have it. A fibre with no measured swelling
  // is excluded and named, for the same reason it is excluded from the wet
  // ratios: absent is not zero.
  const swollen = parts.filter(x => x.s && x.s.area);
  const swellWeight = swollen.reduce((a, x) => a + x.pct, 0);
  const swellArea = swellWeight
    ? [round3(swollen.reduce((a, x) => a + x.s.area[0] * x.pct, 0) / swellWeight),
       round3(swollen.reduce((a, x) => a + x.s.area[1] * x.pct, 0) / swellWeight)]
    : null;

  const weakest = parts.reduce((a, x) => (x.t.extension < a.t.extension ? x : a), parts[0]);
  const strongest = parts.reduce((a, x) => (x.t.extension > a.t.extension ? x : a), parts[0]);
  const spread = strongest.t.extension / weakest.t.extension;

  return {
    // Mass-weighted, and an upper bound rather than a prediction. See above.
    tenacity_upper_bound_n_tex: round3(mean(t => t.tenacity)),
    extension_pct: round3(mean(t => t.extension)),
    modulus_n_tex: round3(mean(t => t.modulus)),

    // Which fibre gives way first, and by how much the components disagree
    // about when that is. A spread near 1 means they break together and the
    // average is close to right; a spread of 2 or more means it is not.
    breaks_first: parts.length > 1 ? weakest.name : null,
    breaks_first_at_pct: parts.length > 1 ? weakest.t.extension : null,
    extension_spread: parts.length > 1 ? round3(spread) : null,
    blend_average_reliable: parts.length === 1 || spread < 1.5,

    wet: {
      tenacity: wetMean('wet', 'ten'),
      extension: wetMean('wet', 'ext'),
      modulus: wetMean('wet', 'mod'),
    },
    hot_wet: {
      tenacity: wetMean('hot_wet', 'ten'),
      extension: wetMean('hot_wet', 'ext'),
      modulus: wetMean('hot_wet', 'mod'),
    },

    // Fibre cross-sectional area in water, and what that does to the yarn's
    // DIAMETER, which is the form a knitter can use. The conversion is
    // geometric — a diameter grows as the square root of an area — and it
    // assumes the yarn's packing factor is unchanged, which is an
    // approximation: fibres that swell also press on each other and the yarn
    // does not expand quite that freely. It is stated as an upper bound for
    // the same reason the blend tenacity is.
    swelling_area_pct: swellArea,
    // Rounded to whole per cent on purpose. The input range is a disagreement
    // between laboratories spanning more than two to one, so "22.474" would
    // claim a precision that no part of the chain has.
    yarn_diameter_gain_pct: swellArea
      ? [Math.round((Math.sqrt(1 + swellArea[0] / 100) - 1) * 100),
         Math.round((Math.sqrt(1 + swellArea[1] / 100) - 1) * 100)]
      : null,
    swelling_covered_pct: round3(swellWeight),
    no_swelling_data: parts.filter(x => !(x.s && x.s.area)).map(x => x.name),

    measured_pct: round3(mass),
    unmeasured,
    no_wet_data: parts.filter(x => !x.t.wet).map(x => x.name),
    sources: parts.map(x => `${x.name}: ${x.t.grade}, ${x.t.table} p.${x.t.page}`),
    source: 'Morton & Hearle, Physical Properties of Textile Fibres, 4th edn, Tables 13.1, 13.2 and 13.7.',
  };
}

function round3(n) { return n == null ? null : parseFloat(n.toFixed(3)); }

/** Blend-weighted density & regain from a fibers{} map (percentages). */
function blendPhysical(fibers) {
  const cottonDefault = { density: 1.52, regain: 7.5, rkm_idx: 1.0,
                          unweighed: [], weighed_pct: 0, assumed: true };
  if (!fibers) return cottonDefault;

  let wsum = 0, dsum = 0, rsum = 0, rkm = 0, rkmWeight = 0;
  const unweighed = [];
  const assumedRegain = [];
  const noStrengthIndex = [];
  for (const [f, pct] of Object.entries(fibers)) {
    const p = FIBER_PROPERTIES[f];
    if (!pct) continue;
    if (!p) { unweighed.push(f); continue; }
    wsum += pct; dsum += p.density * pct; rsum += p.regain * pct;
    // The strength index is a property of spun yarn and is not in the book, so
    // a fibre may have a sourced density and no index at all. Averaging it as
    // though it were zero would drag every blend containing silk towards
    // "weak"; averaging over the fibres that have one, and saying which did
    // not, keeps the two facts separate.
    if (typeof p.rkm === 'number') { rkm += p.rkm * pct; rkmWeight += pct; }
    else noStrengthIndex.push(f);
    if (p.regain_assumed) assumedRegain.push(f);
  }
  if (wsum === 0) return { ...cottonDefault, unweighed };

  // A fibre with no row in FIBER_PROPERTIES used to be skipped and the rest
  // renormalised, so "70% cotton 30% linen" came out with cotton's density
  // exactly — the linen simply vanished and nothing said so. The parser can now
  // name silk, linen, polypropylene and polyethylene, none of which have
  // properties here yet, so the omission is reported instead of hidden.
  return {
    density: parseFloat((dsum / wsum).toFixed(3)),
    regain:  parseFloat((rsum / wsum).toFixed(2)),
    rkm_idx: rkmWeight > 0 ? parseFloat((rkm / rkmWeight).toFixed(3)) : 1.0,
    rkm_from_pct: parseFloat(rkmWeight.toFixed(1)),
    no_strength_index: noStrengthIndex,
    regain_assumed_for: assumedRegain,
    unweighed,
    weighed_pct: parseFloat(wsum.toFixed(1)),
    assumed: false,
  };
}

/**
 * Density-grounded count factor for blends.
 * At fixed knit geometry, GSM ∝ Tex (linear density). But blends change the
 * achievable packing: lighter, bulkier fibres (poly, nylon) let the loop pack
 * less mass per cm² at the same count, so a slightly FINER count is needed to
 * hit a heavy GSM target; denser cellulosics behave like cotton. We express
 * this as a small multiplier centred on cotton.
 */
function blendCountFactor(fibers) {
  const phys = blendPhysical(fibers);
  // Reference cotton density 1.52. Each 0.1 g/cm³ lighter → ~3% finer count target.
  const factor = 1 + (1.52 - phys.density) * 0.30;
  return { factor: parseFloat(factor.toFixed(3)), density: phys.density, regain: phys.regain };
}

// ============================================================
// 4. SLUB / FANCY YARN — effective (resultant) count
//    A slub yarn has periodic thick places. Its RESULTANT count is coarser
//    than the base count by the extra mass the slubs add.
//    resultant_Ne = base_Ne / (1 + slub_mass_fraction)
// ============================================================
function slubEffectiveCount(baseNe, opts = {}) {
  // slub thickness multiplier (e.g. 2.0 = slub is 2× base thickness),
  // slub length & spacing in cm → mass fraction added over a repeat.
  const thick = opts.slub_thickness || 1.8;   // typical 1.5–3×
  const slubLen = opts.slub_length_cm || 4;   // cm of thick place
  const spacing = opts.slub_spacing_cm || 20; // cm base between slubs
  const repeat = slubLen + spacing;
  const extraMass = ((thick - 1) * slubLen) / repeat; // fractional extra mass
  const resultant = baseNe / (1 + extraMass);
  return {
    base_ne: baseNe,
    resultant_ne: parseFloat(resultant.toFixed(2)),
    extra_mass_pct: parseFloat((extraMass * 100).toFixed(1)),
    params: { slub_thickness: thick, slub_length_cm: slubLen, slub_spacing_cm: spacing },
    note: `Slub adds ${(extraMass * 100).toFixed(1)}% mass → declare base ${baseNe}s but knit/cost as effective ${resultant.toFixed(1)}s. Use slub-attachment on the spinning frame; expect uneven cover by design.`,
  };
}

// ============================================================
// 5. MAIN — analyse a fully specified yarn
// ============================================================
/**
 * @param {object} args
 * @param {number} args.count_ne
 * @param {object} [args.fibers]          composition fibers{} map
 * @param {string} [args.fiber_grade]     key of FIBER_GRADES
 * @param {string} [args.spinning_system] key of SPINNING_SYSTEMS
 * @param {string} [args.yarn_form]       'single' | 'ply2' | 'slub' | 'core_spun'
 * @param {object} [args.slub]            slub params if yarn_form==='slub'
 */
function analyzeYarn(args = {}) {
  const countNe = parseFloat(args.count_ne) || null;
  const fibers  = args.fibers || { cotton: 100 };

  // Resolve fibre grade (default combed Upland). Recycled forced if requested.
  const gradeKey = FIBER_GRADES[args.fiber_grade] ? args.fiber_grade : DEFAULT_FIBER_GRADE;
  const grade = FIBER_GRADES[gradeKey];

  // Resolve spinning system — auto by count if not given.
  let spinKey = args.spinning_system;
  if (!SPINNING_SYSTEMS[spinKey]) {
    if (!countNe)        spinKey = DEFAULT_SPINNING.medium;
    else if (countNe >= 40) spinKey = 'combed';
    else if (countNe >= 20) spinKey = 'combed';
    else                  spinKey = 'carded';
    // recycled / coarse → open-end is typical
    if (gradeKey === 'recycled') spinKey = 'open_end';
  }
  const spin = SPINNING_SYSTEMS[spinKey];

  const phys = blendPhysical(fibers);
  const diameter_mm = yarnDiameterMm(countNe, phys.density);
  const tex = neToTex(countNe);

  // Spinning limit check — can this grade+system reach this count?
  const maxCount = Math.min(grade.max_count, spin.count_max);
  const minCount = spin.count_min;
  let spinnable = true, spinWarning = null;
  if (countNe && countNe > maxCount) {
    spinnable = false;
    spinWarning = `Count ${countNe}s exceeds the spinning limit for ${grade.label} on a ${spin.label} system (max ~${maxCount}s). Use a finer fibre grade (e.g. ${grade.rank > 2 ? 'combed/compact ELS' : 'Supima compact'}) or a finer system.`;
  } else if (countNe && countNe < minCount) {
    spinWarning = `Count ${countNe}s is coarser than typical for ${spin.label} (min ~${minCount}s). Open-end/rotor is the economical choice for coarse counts.`;
  }

  // Tenacity (RKM) — system base × fibre-blend strength × grade strength.
  const rkm = parseFloat((spin.rkm * phys.rkm_idx * grade.strength_idx).toFixed(1));
  // CSP (count-strength product, approx) — calibrated so combed 30s ≈ 2430.
  // CSP = lea-strength(lbf) × Ne; here proxied from RKM. Real value is count-
  // dependent, so treat as an indicative band, not a lab figure.
  const csp = countNe ? Math.round(rkm * countNe * 4.5) : null;
  // Evenness U% — system base / grade evenness (better grade → lower U%).
  const u_pct = parseFloat((spin.u_pct / grade.evenness_idx).toFixed(1));

  // Torque (spirality driver) — system torque × form factor. Maps to quality-engine yarn_type.
  let formKey, torque = spin.torque_idx;
  const form = (args.yarn_form || 'single').toLowerCase();
  if (form === 'ply2' || form === 'ply_2') { torque *= 0.26; formKey = 'ply_2'; }
  else if (form === 'core_spun')           { torque *= 0.9;  formKey = 'single_' + (spinKey === 'carded' ? 'carded' : 'combed'); }
  else { // single — map system to quality-engine torque bucket
    formKey = spinKey === 'compact' ? 'single_compact'
            : spinKey === 'combed'  ? 'single_combed'
            : spinKey === 'carded'  ? 'single_carded'
            : spinKey === 'open_end'? 'single_open_end'
            : spinKey === 'vortex'  ? 'single_vortex'
            : 'single_combed';
  }

  // Quality rank (1 best .. 7) and price index (fibre × system).
  const quality_rank = grade.rank;
  const price_idx = parseFloat((grade.price_idx * spin.cost_idx).toFixed(2));

  // Pilling tendency note (hairiness × short-fibre content).
  const pilling_tendency = parseFloat((spin.hairiness_idx * (2 - grade.evenness_idx)).toFixed(2));

  // Slub handling
  let slub = null;
  if (form === 'slub') {
    slub = slubEffectiveCount(countNe, args.slub || {});
  }

  // Uster Statistics profile — count-grounded evenness, IPI, hairiness, USP.
  const uster = usterProfile({
    count_ne: countNe,
    spinning_system: spinKey,
    grade_key: gradeKey,
  });
  // Prefer Uster's count-grounded U% over the flat system value.
  const u_final = (uster && uster.ok && uster.u_pct != null) ? uster.u_pct : u_pct;
  if (uster && uster.ok && uster.fibre_count_flag) {
    spinWarning = spinWarning ? spinWarning : uster.fibre_count_flag;
  }

  return {
    ok: true,
    count_ne: countNe,
    tex: tex ? parseFloat(tex.toFixed(2)) : null,
    diameter_mm,
    fiber_grade: { key: gradeKey, ...grade },
    spinning_system: { key: spinKey, ...spin },
    yarn_form: form,
    blend_physical: phys,
    properties: {
      tenacity_rkm: rkm,
      tenacity_rating: rkm >= 18 ? 'High' : rkm >= 15 ? 'Good' : rkm >= 12 ? 'Average' : 'Low',
      csp,
      evenness_u_pct: u_final,
      evenness_rating: u_final <= 9.5 ? 'Excellent' : u_final <= 11 ? 'Good' : u_final <= 13 ? 'Average' : 'Poor',
      hairiness_h: uster && uster.ok ? uster.hairiness_h : null,
      hairiness_idx: spin.hairiness_idx,
      torque_idx: parseFloat(torque.toFixed(2)),
      pilling_tendency,
    },
    uster: uster && uster.ok ? uster : null,
    quality_rank,
    price_index: price_idx,
    spinnable,
    spinning_limit: { min: minCount, max: maxCount },
    quality_engine_yarn_type: formKey,   // feeds spirality torque model
    slub,
    warnings: spinWarning ? [spinWarning] : [],
    test_standards: 'Strength ASTM D2256/D1907 · Evenness Uster (ASTM D1425) · CSP ASTM D1578',
    note: `${grade.label} · ${spin.label} · ${form}. ${grade.note}`,
  };
}

// ============================================================
// 6. RECOMMEND the right yarn grade/system for a target count + fabric
// ============================================================
function recommendYarnGrade(countNe, fabricCategory) {
  if (!countNe) return null;
  let system, grade, reason;

  if (countNe >= 60) {
    system = 'compact'; grade = 'supima';
    reason = 'Very fine count — requires ELS fibre (Supima/Giza) on a compact system to reach this fineness with adequate strength.';
  } else if (countNe >= 40) {
    system = 'combed'; grade = 'combed_upland';
    reason = 'Fine count — must be combed to remove short fibres; compact recommended for premium hand.';
  } else if (countNe >= 20) {
    system = 'combed'; grade = 'combed_upland';
    reason = 'Medium count — combed Upland is the quality standard for jersey/interlock.';
  } else if (countNe >= 10) {
    system = 'carded'; grade = 'carded_upland';
    reason = 'Coarse-medium count — carded Upland is economical and sufficient; open-end for sweat/fleece.';
  } else {
    system = 'open_end'; grade = 'carded_upland';
    reason = 'Coarse count — open-end/rotor is the fast, economical choice (denim, heavy fleece).';
  }

  // Fleece/terry loops & sweat often use OE for bulk.
  if (['fleece', 'terry'].some(k => (fabricCategory || '').includes(k))) {
    if (countNe < 24) { system = 'open_end'; reason += ' Fleece/terry loop benefits from bulky open-end yarn.'; }
  }

  return { recommended_grade: grade, recommended_system: system, reason, grade_label: FIBER_GRADES[grade].label, system_label: SPINNING_SYSTEMS[system].label };
}

module.exports = {
  blendMechanics,
  analyzeYarn,
  recommendYarnGrade,
  blendCountFactor,
  blendPhysical,
  slubEffectiveCount,
  yarnDiameterMm,
  FIBER_GRADES,
  SPINNING_SYSTEMS,
  FIBER_PROPERTIES,
};
