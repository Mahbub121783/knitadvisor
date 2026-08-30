/**
 * WOVEN ENGINE
 * ============
 * Composes the woven layer into one answer: catalog row + weave specification
 * in, structure design and cloth numbers out.
 *
 * It is deliberately shaped like calculate() — synchronous, no network, no
 * await, no database — for the same reason calculate() is: a construction that
 * depends on what a server felt like returning is not a construction anyone can
 * check. Everything it needs is either in the catalog or derived from the rules
 * in engine/formulas/woven*.js.
 *
 * It is NOT part of calculate(). A woven cloth and a knitted one share no term,
 * so merging them would mean a result object where half the fields are null and
 * the reader has to know which half. They are two calls.
 */
'use strict';

const woven = require('../formulas/woven');
const design = require('../formulas/woven-design');
const cloth = require('../formulas/woven-cloth');
const { WOVEN_DERIVATIVES, buildWeaveGrid, getWovenFabric } = require('../catalog/woven-derivatives');

const num = (v, fallback = null) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The crimp the book prints for this cloth, where it prints one. Kept in a
 * single place so the dropdown's nominal GSM and the calculated GSM cannot
 * disagree — a fabric that weighs 732 g in the list and 809 g on the result
 * page is a bug the reader has no way to resolve.
 */
function bookCrimpFor(fabric) {
  const p = fabric.pile || {};
  return {
    warp: p.warp_crimp_pct != null ? p.warp_crimp_pct
        : (fabric.sett && fabric.sett.warp_crimp_pct != null ? fabric.sett.warp_crimp_pct : null),
    weft: p.weft_crimp_pct != null ? p.weft_crimp_pct
        : (fabric.sett && fabric.sett.weft_crimp_pct != null ? fabric.sett.weft_crimp_pct : null),
  };
}

// ─────────────────────────────────────────────────────────────
// STRUCTURE DESIGN
// ─────────────────────────────────────────────────────────────

/**
 * The four plans a weaver sets a loom from — design, draft, peg plan, denting —
 * plus the float geometry that follows from the design.
 *
 * The draft and peg plan are checked against the design before they are
 * returned. They cannot disagree by construction, so a failure here means the
 * derivation itself is broken, and the right response is to return no plans
 * rather than plans that do not weave the cloth on the screen.
 */
function structureDesign(fabric, { epi = null, endsPerDent = 2 } = {}) {
  const built = buildWeaveGrid(fabric.weave);

  if (!built.grid) {
    return {
      grid: null,
      grid_status: built.grid_status,
      note: built.note || null,
      page: built.page || fabric.book_page || null,
      figure: built.figure || null,
      // Everything the book DOES give about how this weave is set up survives
      // the missing grid, so the row is still worth showing.
      draft_hint: fabric.draft_hint || null,
      available: false,
    };
  }

  const grid = built.grid;
  const draft = design.deriveDraft(grid);
  const peg = design.derivePegPlan(grid, draft);
  const rebuilt = design.expandPlan(draft, peg);
  const consistent = design.gridsEqual(grid, rebuilt);

  if (!consistent) {
    return {
      grid,
      grid_status: 'DERIVATION_FAILED',
      available: false,
      note: 'The draft and peg plan derived from this design do not re-weave it. The plans are withheld rather than shown, because a plan that does not reproduce its own design would mis-set a loom.',
    };
  }

  const floats = design.analyseFloats(grid);

  return {
    available: true,
    grid_status: built.grid_status,
    notation: built.notation || null,
    grid,                                   // picks x ends, true = warp up
    repeat_ends: floats.repeat_ends,
    repeat_picks: floats.repeat_picks,
    draft,
    peg_plan: peg,
    denting: epi ? design.dentingPlan(floats.repeat_ends, epi, endsPerDent) : null,
    floats,
    verified: 'draft + peg plan re-expand to the design exactly',
    source: built.source || 'DERIVED',
    page: built.page || fabric.book_page || null,
  };
}

// ─────────────────────────────────────────────────────────────
// THE CALCULATION
// ─────────────────────────────────────────────────────────────

function calculateWoven(params = {}) {
  const fabric = getWovenFabric(params.fabric_id);
  if (!fabric) {
    return { success: false, error: 'UNKNOWN_WOVEN_FABRIC', fabric_id: params.fabric_id || null };
  }

  // The catalog sett is a starting point, not a constraint — a merchandiser
  // quotes the quality in front of them, not the one in the book.
  const epi = num(params.epi, fabric.sett.epi);
  const ppi = num(params.ppi, fabric.sett.ppi);
  const warpRaw = params.warp_count || fabric.sett.warp_count;
  const weftRaw = params.weft_count || fabric.sett.weft_count;
  const warp = cloth.parseCount(warpRaw);
  const weft = cloth.parseCount(weftRaw);

  if (!(epi > 0 && ppi > 0) || !warp || !weft) {
    return { success: false, error: 'INCOMPLETE_CONSTRUCTION',
             message: 'A woven quality needs ends per inch, picks per inch and both yarn counts.' };
  }

  const endsPerDent = num(params.ends_per_dent, 2);
  const structure = structureDesign(fabric, { epi, endsPerDent });
  // Where no grid exists the float ratio cannot be counted, so the cloth
  // arithmetic falls back to the plain-weave baseline of 1 and says so.
  const averageFloat = structure.available ? structure.floats.average_float : 1;

  const bookCrimp = bookCrimpFor(fabric);
  const warpCrimpPct = num(params.warp_crimp_pct, bookCrimp.warp);
  const weftCrimpPct = num(params.weft_crimp_pct, bookCrimp.weft);
  const weight = cloth.clothWeight({
    epi, ppi, warpNe: warp.resultant_ne, weftNe: weft.resultant_ne,
    warpCrimpPct, weftCrimpPct, averageFloat,
  });

  // Cover factor describes threads lying in one plane. A pile cloth's picks
  // include the pile, which stands out of that plane, so the formula does not
  // apply and returning a number would be worse than returning none.
  const pilePicks = !!(fabric.pile && fabric.pile.picks_include_pile);
  const cover = pilePicks ? null : cloth.coverFactor({
    epi, ppi, warpNe: warp.resultant_ne, weftNe: weft.resultant_ne, averageFloat,
  });

  const angle = fabric.family === 'twill' || fabric.family === 'rearranged_twill'
    ? woven.twillAngle(epi, ppi) : null;

  const widthInch = num(params.width_inch, null);
  const lengthM = num(params.length_m, null);
  const use = widthInch && lengthM ? cloth.consumption({
    epi, ppi, warpNe: warp.resultant_ne, weftNe: weft.resultant_ne,
    widthInch, lengthM, averageFloat,
    warpCrimpPct, weftCrimpPct,
    wastagePct: num(params.wastage_pct, 3),
  }) : null;

  const notes = [];
  if (fabric.sett.source === 'USER_SUPPLIED') notes.push(fabric.sett.note || 'The sett shown is a working default, not one of the book’s constructions.');
  if (fabric.sett.note && fabric.sett.source === 'BOOK_VERIFIED') notes.push(fabric.sett.note);
  if (!structure.available) notes.push(structure.note);
  if (pilePicks) notes.push('Cover factor is not reported: the picks per inch include pile picks, which do not lie in the ground plane the formula describes.');
  if (warp.ambiguous || weft.ambiguous) notes.push(`The book prints more than one yarn for this cloth (warp "${warpRaw}", weft "${weftRaw}"). The first was taken; confirm which is actually on the beam.`);
  if (structure.denting && structure.denting.warning) notes.push(structure.denting.warning);

  return {
    success: true,
    fabric: {
      id: fabric.id, name: fabric.name, name_bn: fabric.name_bn || null,
      category: 'woven', family: fabric.family, weave_slug: fabric.weave_slug,
      end_uses: fabric.end_uses || [], characteristics: fabric.characteristics || [],
      book_page: fabric.book_page || null,
    },
    construction: {
      ends_per_inch: epi, picks_per_inch: ppi,
      warp_count: warpRaw, weft_count: weftRaw,
      warp_resultant_ne: Math.round(warp.resultant_ne * 100) / 100,
      weft_resultant_ne: Math.round(weft.resultant_ne * 100) / 100,
      material: fabric.sett.material || null,
      sett_source: fabric.sett.source,
      sett_page: fabric.sett.page || null,
    },
    structure,
    weight,
    cover,
    twill_angle: angle,
    consumption: use,
    pile: fabric.pile || null,
    notes: notes.filter(Boolean),
    source: 'Gokarneshan, Fabric Structure and Design (2005), with the mass and cover relations labelled separately on each block.',
  };
}

// ─────────────────────────────────────────────────────────────
// LISTING
// ─────────────────────────────────────────────────────────────

/**
 * The dropdown entries. A woven row carries its construction rather than a GSM
 * band, because that is how a woven quality is actually named — "56 x 44,
 * 8s/6s" says more to a merchandiser than a weight range does. The nominal GSM
 * is computed from that construction, so the label is a consequence of the row
 * rather than a second number that could drift away from it.
 */
function listWovenFabrics() {
  return WOVEN_DERIVATIVES.map(f => {
    const warp = cloth.parseCount(f.sett.warp_count);
    const weft = cloth.parseCount(f.sett.weft_count);
    const built = buildWeaveGrid(f.weave);
    const af = built.grid ? design.analyseFloats(built.grid).average_float : 1;
    const crimp = bookCrimpFor(f);
    const w = (f.sett.epi && f.sett.ppi && warp && weft)
      ? cloth.clothWeight({ epi: f.sett.epi, ppi: f.sett.ppi,
                            warpNe: warp.resultant_ne, weftNe: weft.resultant_ne, averageFloat: af,
                            warpCrimpPct: crimp.warp, weftCrimpPct: crimp.weft })
      : null;
    return {
      id: f.id,
      name: f.name,
      name_bn: f.name_bn || null,
      category: 'woven',
      family: f.family,
      construction: f.sett.epi && f.sett.ppi ? `${f.sett.epi}×${f.sett.ppi}, ${f.sett.warp_count}/${f.sett.weft_count}` : null,
      nominal_gsm: w ? w.gsm : null,
      sett_source: f.sett.source,
      has_structure: built.grid_status === 'GENERATED',
      grid_status: built.grid_status,
      book_page: f.book_page || null,
    };
  });
}

module.exports = { calculateWoven, structureDesign, listWovenFabrics };
