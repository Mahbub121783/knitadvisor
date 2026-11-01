// KnitAdvisor — yarn character: what the KIND of yarn does to the cloth.
//
// The yarn engine already knows a spinning system's strength, evenness and
// hairiness. This module turns the whole yarn choice — spinning system
// (carded, combed, compact, siro, open-end, air-jet), yarn form (single,
// 2-ply, slub, core-spun) and, where there is polyester, its form (spun
// staple, textured DTY, flat FDY filament) and lustre (bright, semi-dull,
// full-dull) — into ONE description used everywhere downstream: the numbers
// on the result page, the optics of the dyed cloth, the hairiness, gloss and
// bulk of the yarn drawn in the Realistic and 3D views.
//
// Relative to the reference: a combed ring-spun cotton single yarn = 1.00.
//
// MEASURED / SOURCED here: the spinning systems' strength, evenness,
// hairiness and torque come from the yarn engine tables (Uster Statistics
// based). MODELLED (stated on every effect): lustre by polyester type,
// staple-versus-filament surface, bulk, handle, and the knitting and
// finishing consequences. No source names leave this file.

'use strict';

// Hairiness-index base for a combed ring yarn in yarn-engine.js is 0.80.
const REF_HAIR = 0.80;

// Surface of each fibre as a SPUN yarn (protruding fibre ends), relative to
// cotton = 1. Filament yarns have none of it.
const SPUN_HAIR = {
  cotton: 1.0, wool: 1.3, linen: 0.8, hemp: 0.8, acrylic: 0.7,
  viscose: 0.45, modal: 0.45, tencel: 0.45, bamboo: 0.5,
  polyester: 0.6, nylon: 0.5, polypropylene: 0.5, silk: 0.35,
};
const FILAMENT_HAIR = 0.03;

// How each spinning system changes the yarn's size and look, beyond what the
// yarn engine's table carries. bulk = diameter against combed ring.
const SYSTEM_LOOK = {
  carded:       { bulk: 1.02, gloss: 0.88, handle: 'full, warm, a little coarse', pill: -0.35, lint: 'high' },
  combed:       { bulk: 1.00, gloss: 1.00, handle: 'clean, soft, even', pill: 0, lint: 'medium' },
  compact:      { bulk: 0.96, gloss: 1.15, handle: 'smooth, crisp, with a clean surface', pill: 0.4, lint: 'low' },
  siro:         { bulk: 0.98, gloss: 1.08, handle: 'smooth and strong, drapes well', pill: 0.25, lint: 'low' },
  siro_compact: { bulk: 0.95, gloss: 1.20, handle: 'very smooth and clean, the finest surface a ring frame gives', pill: 0.5, lint: 'very low' },
  open_end:     { bulk: 1.08, gloss: 0.80, handle: 'bulky, dry, a little harsh', pill: -0.15, lint: 'very high' },
  vortex:       { bulk: 1.04, gloss: 1.00, handle: 'crisp and dry, quick to dry', pill: 0.7, lint: 'low' },
};

// Yarn form: size and look.
const FORM_LOOK = {
  single:    { bulk: 1.00, ply: 1, label: 'single' },
  ply2:      { bulk: 1.06, ply: 2, label: '2-ply' },
  slub:      { bulk: 1.00, ply: 1, label: 'slub' },
  core_spun: { bulk: 0.98, ply: 1, label: 'core-spun' },
};

// Polyester. Lustre is set by the delustrant (titanium dioxide) in the
// polymer: none = bright, ~0.3 % = semi-dull, ~2 % = full-dull. The form
// then sets how much of that reaches the eye: a flat filament is a clean
// reflecting surface; a textured (DTY) yarn scatters it; a spun staple yarn
// hides it under fibre ends.
const POLY_LUSTRE = {
  bright:    { f: 1.00, label: 'bright', ti02: 'no delustrant' },
  semi_dull: { f: 0.62, label: 'semi-dull', ti02: '~0.3 % delustrant' },
  full_dull: { f: 0.30, label: 'full-dull', ti02: '~2 % delustrant' },
};
const POLY_FORM = {
  staple: { f: 0.60, rough: 0.18, hair: SPUN_HAIR.polyester, bulk: 1.0, label: 'spun staple', filament: false },
  dty:    { f: 0.72, rough: 0.08, hair: 0.10, bulk: 1.18, label: 'textured filament (DTY)', filament: true },
  fdy:    { f: 1.00, rough: 0.00, hair: FILAMENT_HAIR, bulk: 0.94, label: 'flat filament (FDY)', filament: true },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (n) => Math.round(n * 100) / 100;
const pctDiff = (v, ref) => Math.round((v / ref - 1) * 100);

const norm = (s) => String(s || '').toLowerCase().trim().replace(/[\s-]+/g, '_');

/**
 * What polyester is, when it is there. Returns null without polyester.
 * `explicit` = the user chose it; otherwise a stated default is used.
 */
function polyspec(fibers, args) {
  const share = Number((fibers || {}).polyester) || 0;
  if (!(share > 0)) return null;
  const cotton = Number((fibers || {}).cotton) || 0;
  let form = norm(args.poly_form);
  const formGiven = !!POLY_FORM[form];
  if (!formGiven) {
    // Blends with cotton are spun together, so the polyester is staple. A
    // 100 % polyester knit is most often a filament; with no choice and a
    // chosen spinning system, spun.
    form = (cotton > 0 || args.spinning_system || share < 100) ? 'staple' : 'dty';
    if (args.is_warp_knit) form = 'fdy';
  }
  let lustre = norm(args.poly_lustre);
  const lustreGiven = !!POLY_LUSTRE[lustre];
  if (!lustreGiven) lustre = 'semi_dull';
  return { share, form, lustre, formGiven, lustreGiven };
}

/**
 * @param {object} a
 *   spinKey, spin (SPINNING_SYSTEMS entry), form ('single'|'ply2'|'slub'|'core_spun'),
 *   fibers{}, countNe, gradeKey, poly_form, poly_lustre, spinning_system (as given),
 *   slub {thickness}, is_warp_knit
 */
function yarnCharacter(a = {}) {
  const spinKey = SYSTEM_LOOK[a.spinKey] ? a.spinKey : 'combed';
  const spin = a.spin || {};
  const sys = SYSTEM_LOOK[spinKey];
  const form = FORM_LOOK[a.form] ? a.form : 'single';
  const fibers = a.fibers || { cotton: 100 };
  const total = Object.values(fibers).reduce((s, v) => s + (Number(v) || 0), 0) || 100;
  const poly = polyspec(fibers, a);
  const pf = poly ? POLY_FORM[poly.form] : null;
  const pl = poly ? POLY_LUSTRE[poly.lustre] : null;

  // ── how hairy: fibre surface × spinning system ──────────────────────────
  const sysHair = (spin.hairiness_idx != null ? spin.hairiness_idx : REF_HAIR) / REF_HAIR;
  let fibreHair = 0;
  for (const [name, pct] of Object.entries(fibers)) {
    if (!pct || name === 'elastane' || name === 'spandex') continue;
    const w = pct / total;
    let h = SPUN_HAIR[name] != null ? SPUN_HAIR[name] : 0.8;
    if (name === 'polyester' && pf) h = pf.hair;
    fibreHair += w * h;
  }
  const allFilament = !!(poly && pf.filament && poly.share >= 95);
  // A filament yarn is not spun: the spinning system does not shape it.
  const hair = allFilament ? FILAMENT_HAIR : clamp(fibreHair * sysHair * (form === 'ply2' ? 0.85 : 1), 0.02, 2.2);

  // ── size ────────────────────────────────────────────────────────────────
  let bulk = (allFilament ? 1 : sys.bulk) * FORM_LOOK[form].bulk * (pf && poly.share >= 50 ? pf.bulk : 1);
  bulk = clamp(bulk, 0.85, 1.25);

  // ── lustre of the yarn surface (0 matt … 1 mirror) ──────────────────────
  // each fibre's own: cotton 0.12 (a little more when the surface is clean),
  // polyester by delustrant and form
  const sysGloss = allFilament ? 1 : sys.gloss;
  const fibreOptics = {};
  let lustre = 0, lShift = 0;
  for (const [name, pct] of Object.entries(fibers)) {
    if (!pct || name === 'elastane' || name === 'spandex') continue;
    const w = pct / total;
    if (name === 'polyester' && pf) {
      const sheen = clamp(0.15 + 0.80 * pl.f * pf.f * (allFilament ? 1 : 0.5 + 0.5 * sysGloss), 0.1, 0.97);
      const rough = clamp(0.12 + (1 - pl.f) * 0.30 + pf.rough, 0.1, 0.8);
      fibreOptics.polyester = { sheen: r2(sheen), roughness: r2(rough) };
      lustre += w * sheen;
      // a delustred fibre reads lighter and chalkier in a dark shade, a
      // bright one deeper
      lShift += w * (poly.lustre === 'bright' ? -1.2 : poly.lustre === 'full_dull' ? 2.2 : 0.4);
    } else {
      const base = { cotton: 0.10, wool: 0.15, linen: 0.05, hemp: 0.05, viscose: 0.70, modal: 0.65, tencel: 0.72, silk: 0.90, nylon: 0.85, acrylic: 0.50 }[name];
      lustre += w * (base != null ? base : 0.2) * (name === 'cotton' || name === 'wool' ? sysGloss : 1);
    }
  }
  // a hairy yarn scatters light and the cloth reads lighter and flatter
  lShift += (hair - 1) * 1.5;
  lustre = clamp(lustre, 0, 1);
  const lustreClass = lustre >= 0.75 ? 'bright, glassy' : lustre >= 0.5 ? 'lustrous' : lustre >= 0.28 ? 'soft sheen' : 'matt';

  // ── strength, evenness, torque, cost, versus combed ring ────────────────
  const refRkm = 18, refCost = 1.0, refTorque = 0.85;
  const rel = {
    strength_pct: allFilament ? null : pctDiff(spin.rkm || refRkm, refRkm),
    hairiness_pct: pctDiff(hair, 1),
    spirality_pct: allFilament ? null : (form === 'ply2' ? -74 : pctDiff((spin.torque_idx || refTorque), refTorque)),
    cost_pct: allFilament ? null : pctDiff(spin.cost_idx || refCost, refCost),
  };

  // ── pilling: shift on the 0-5 score ─────────────────────────────────────
  // a staple polyester anchors its pills (it is tough); a filament has no
  // fibre ends to form one
  const polyStaple = !!(poly && !pf.filament);
  const pillingDelta = (allFilament ? 0.4 : sys.pill) + (form === 'ply2' ? 0.3 : 0);

  // ── effects: what the user is told ──────────────────────────────────────
  const effects = [];
  const E = (area, text, kind) => effects.push({ area, text, kind: kind || 'note' });
  const sysLabel = spin.label || spinKey;
  if (!allFilament) {
    E('Strength', rel.strength_pct === 0 ? 'The reference: combed ring yarn.'
      : `${rel.strength_pct > 0 ? '+' : ''}${rel.strength_pct}% yarn strength against combed ring (${sysLabel}).`, rel.strength_pct < -10 ? 'warn' : 'good');
    E('Surface', hair < 0.7 ? `Clean surface: protruding fibre ends ${Math.abs(rel.hairiness_pct)}% fewer than combed ring — sharper stitch definition and a deeper-looking shade.`
      : hair > 1.15 ? `Hairy surface: ${rel.hairiness_pct}% more fibre ends than combed ring — a fuller, softer look that frosts in dark shades and sheds lint.`
      : 'Surface like a standard combed ring yarn.', hair > 1.3 ? 'warn' : 'note');
  } else {
    E('Surface', `A ${pf.label} yarn: continuous filament, no fibre ends, smooth to the eye and the hand.`, 'good');
  }
  E('Handle', allFilament
    ? (poly.form === 'dty' ? 'bulky and soft, a little stretch from the texturing' : 'smooth, cool, a little slippery')
    : `${sys.handle.charAt(0).toUpperCase() + sys.handle.slice(1)}${form === 'ply2' ? '; the plying adds body and a firmer hand' : ''}.`);
  if (rel.spirality_pct != null && rel.spirality_pct !== 0) E('Spirality', `${rel.spirality_pct > 0 ? '+' : ''}${rel.spirality_pct}% twist torque against combed ring${form === 'ply2' ? ' — a 2-ply balances the twist and almost removes it' : ''}.`, rel.spirality_pct > 8 ? 'warn' : 'good');
  E('Pilling', pillingDelta >= 0.3 ? 'Resists pilling better than a standard ring yarn.' : pillingDelta <= -0.2 ? 'Pills sooner than a combed yarn — plan a bio-polish.' : 'Standard pilling behaviour.', pillingDelta <= -0.2 ? 'warn' : 'note');
  if (polyStaple && poly.share >= 20) E('Pilling', 'The polyester in a spun yarn is tough and does not let a pill break away: it needs a bio-polish or an anti-pilling finish.', 'warn');
  if (rel.cost_pct != null && rel.cost_pct !== 0) E('Yarn cost', `${rel.cost_pct > 0 ? '+' : ''}${rel.cost_pct}% against combed ring (system conversion cost).`);
  E('Knitting', allFilament
    ? 'Runs fast and clean on the machine; hold the tension even and earth the frame against static.'
    : `Lint ${sys.lint}. ${spinKey === 'open_end' ? 'Needle-bed and sinker cleaning needs more attention; uneven places show in light shades.' : spinKey === 'carded' ? 'Clean the feeders often; a hairy yarn shows as streaks in a light shade.' : spinKey === 'compact' || spinKey === 'siro_compact' ? 'The most stable running: fewer breaks and a cleaner machine.' : spinKey === 'vortex' ? 'Stiff and low in stretch: keep the yarn tension low and the feeding positive.' : spinKey === 'siro' ? 'Few breaks and a clean machine; watch the doubling for twin-thread faults.' : 'Standard running.'}`);

  if (poly) {
    const polySheen = (fibreOptics.polyester || {}).sheen || 0.4;
    const polyClass = polySheen >= 0.75 ? 'glassy' : polySheen >= 0.5 ? 'lustrous' : polySheen >= 0.3 ? 'soft sheen' : 'matt';
    E('Polyester', `${poly.share}% ${pf.label}, ${pl.label} (${pl.ti02}): ${polyClass} on its own — a ${poly.lustre === 'bright' ? 'sharp, glassy shine that shows every yarn irregularity' : poly.lustre === 'full_dull' ? 'flat, cotton-like surface' : 'soft, natural-looking sheen'}.${!poly.formGiven ? ' Form assumed: ' + pf.label + '.' : ''}${!poly.lustreGiven ? ' Lustre assumed: semi-dull.' : ''}`, 'good');
    if (poly.lustre === 'bright' && !allFilament) E('Polyester', 'A bright staple polyester shines unevenly through the cotton: expect a bright, frosted face in dark shades.', 'warn');
    E('Dyeing', 'Polyester takes disperse dye at 130 °C (not reactive); a cotton blend needs a two-stage dyeing, polyester first and a reduction clearing before the cotton. ' + (poly.lustre === 'full_dull' ? 'A full-dull fibre looks lighter and chalkier in a dark shade: allow more dye.' : poly.lustre === 'bright' ? 'A bright fibre looks deeper than the same dye on a dull one: allow less dye.' : ''), 'note');
    E('Heat setting', `Heat-set at about ${allFilament ? '190' : '180'} °C to lock the size and the stability; a skipped heat-set shrinks and creases later.`);
  }
  if (form === 'ply2') E('Form', '2-ply: two strands twisted against the first twist. Torque is balanced, the surface is rounder and stronger, the yarn costs more and is a little larger.');
  if (form === 'slub') E('Form', 'Slub: thick-and-thin places by design. The cloth gets a mottled, hand-spun look; do not pick it for a plain cloth or a precise count.');
  if (form === 'core_spun') E('Form', 'Core-spun: an elastane filament wrapped in fibre. Stretch with a cotton face; the elastane stays out of sight.');

  // ── finishing the yarn asks for ─────────────────────────────────────────
  const process = [];
  if (hair > 1.15 && !allFilament) process.push('Singe or bio-polish: a hairy yarn needs the fibre ends taken off for a clean face and a pilling-resistant cloth.');
  if (polyStaple && poly.share >= 20) process.push('Bio-polish or an anti-pilling finish after dyeing.');
  if (poly) process.push('Heat-set before dyeing for stability.');
  if (spinKey === 'open_end') process.push('Open-end yarns take dye a little more slowly than ring yarns: allow a longer hold and a levelling agent.');
  if (spinKey === 'vortex') process.push('An air-jet yarn has a tight core and loose wrapper fibres: a silicone softener restores the hand.');
  if (poly && poly.lustre === 'bright' && !allFilament) process.push('Keep dyeing even: a bright staple shows every shade variation.');

  // ── warnings ────────────────────────────────────────────────────────────
  const warnings = [];
  if (spinKey === 'open_end' && (a.countNe || 0) > 30) warnings.push(`Open-end spinning is a coarse-count system: ${a.countNe}s is finer than it spins well.`);
  if ((spinKey === 'siro' || spinKey === 'siro_compact') && (a.countNe || 0) && (a.countNe < 16)) warnings.push('Siro spinning is meant for medium and fine counts: below about 16s the two strands are too coarse to gain from it.');
  if (poly && poly.share >= 20 && (spinKey === 'carded' || spinKey === 'open_end') && !allFilament) warnings.push('A carded or open-end yarn with this much polyester pills heavily: use combed, compact or siro, or plan a strong bio-polish.');
  if (allFilament && a.spinning_system) warnings.push('The spinning system does not apply to a filament yarn: its choice is ignored here.');

  // ── what the Realistic and 3D views draw ────────────────────────────────
  const look = {
    hairAbs: r2(hair),
    gloss: r2(sysGloss),
    bulk: r2(bulk),
    ply: FORM_LOOK[form].ply,
    slub: form === 'slub',
    filament: allFilament ? true : (poly && pf.filament && poly.share >= 50 ? true : false),
    dty: allFilament && poly.form === 'dty',
    lustre: r2(lustre),
    lustre_class: lustreClass,
  };

  return {
    system: { key: spinKey, label: sysLabel },
    form: { key: form, label: FORM_LOOK[form].label },
    polyester: poly ? { share: poly.share, form: poly.form, form_label: pf.label, lustre: poly.lustre, lustre_label: pl.label, assumed_form: !poly.formGiven, assumed_lustre: !poly.lustreGiven } : null,
    filament_only: allFilament,
    hair_factor: r2(hair),
    bulk: r2(bulk),
    gloss: r2(sysGloss),
    lustre: { index: r2(lustre), class: lustreClass },
    relative_to_combed_ring: rel,
    pilling_delta: pillingDelta,
    poly_staple: polyStaple,
    optics: { fibre: fibreOptics, l_shift: r2(lShift) },
    effects,
    process,
    warnings,
    look,
    basis: {
      sourced: ['spinning-system strength, evenness, hairiness and torque (yarn engine tables)'],
      modelled: ['lustre by polyester type and form', 'bulk of each system and form', 'handle, knitting and finishing consequences'],
    },
  };
}

module.exports = { yarnCharacter, polyspec, POLY_LUSTRE, POLY_FORM, SYSTEM_LOOK, FORM_LOOK };
