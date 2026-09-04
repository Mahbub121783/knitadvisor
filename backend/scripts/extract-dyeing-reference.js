/**
 * KnitAdvisor — Dyeing Reference Extractor
 * ==========================================
 *
 * One-time (re-runnable) ETL: parses the real factory dyeing recipe cards
 * ("DYEING NEW PROCESS BY MOZAMMEL SIR (1).xlsx", Alim Knit (BD) Ltd) into
 * backend/data/dyeing-reference.json, the snapshot dyeing-engine.js requires
 * directly (Pattern B — same as woven-derivatives.js / composition-reference
 * .json: a static file the synchronous engine reads, never a live DB query).
 *
 * Source has 7 sheets; the 7th ("Sheet1") is empty and is explicitly skipped,
 * not silently dropped. Every sheet shares one column layout, hand-verified
 * cell-by-cell before writing this script:
 *   Header:  B3 =TODAY() (not a real recipe date — never stored), B5 color
 *            label, D5 composition/"F.Type" (blank on the 2 White sheets),
 *            H3 fabric qty (kg), H4 M:L ratio, H5 water (L, = H3*H4),
 *            D6 cost/kg in Tk (= SUM(all step prices)/H3).
 *   Table (row 9 to the "Total No. Of Bath" row): A=stage label (sparse —
 *            blank on continuation rows), B=Functional Name, C=commercial
 *            chemical name, E=dosing, F=unit price (Tk), G=price (Tk, always
 *            = H*F, confirmed uniform across every row in every sheet),
 *            H=required qty (kg), I=remarks, J=time (min). Column D is an
 *            unused spacer in every sheet — confirmed empty across all 6.
 *
 *            CRITICAL — the required-qty formula is NOT uniform. Inspecting
 *            every H-column cell's actual formula (not just its value) found
 *            THREE distinct dosing bases mixed within these sheets:
 *              'liquor_gpl'   H = fabric_qty * ml_ratio * dosing / 1000
 *                             (equivalently H5*dosing/1000, since H5=H3*H4)
 *                             — most pretreatment/bath chemicals.
 *              'percent_owf'  H = fabric_qty * dosing
 *                             — enzymes, OBA, and the reactive/disperse dyes
 *                             (their dosing is stored as a plain fraction,
 *                             e.g. 0.004 for "0.400%", NOT grams per litre).
 *              'broken_ref'   ONE cell (White (chori bonmax) H32, softener
 *                             row): formula was `H2*H3*E32/1000`. H2 is BLANK
 *                             in this workbook — not a header this template
 *                             ever defines (H3=fabric_qty, H4=ml_ratio,
 *                             H5=water) — so the row's own Required-Qty/Price
 *                             sat at 0.00 in the source file itself, silently
 *                             dropping a real chemical's cost. This is now
 *                             CORRECTED at extraction time, not transcribed
 *                             blindly, on the strength of three independent
 *                             pieces of evidence, not a guess:
 *                               1. every OTHER liquor_gpl row in this exact
 *                                  sheet uses H3*H4*E../1000 (rows 10,11,13,
 *                                  18,19,20) — H2 is a one-off, off-by-one
 *                                  mistype of H4.
 *                               2. the SAME chemical (MH Soft / Formosoft
 *                                  NNC), SAME dosing value (1), SAME unit
 *                                  price (256 Tk/kg) appears in the sibling
 *                                  "Other White" sheet with a working
 *                                  H3*H4*E../1000 formula.
 *                               3. applying that formula here reproduces
 *                                  EXACTLY that sibling row's numbers —
 *                                  required_qty=1.785kg, price=456.96 Tk —
 *                                  not a new invented figure.
 *                             classifyDosingBasis() below detects this exact
 *                             broken formula shape and reclassifies it as
 *                             'liquor_gpl'; extractSheet() then recomputes
 *                             required_qty_kg/price_tk from the formula
 *                             instead of trusting the source's own (broken)
 *                             cached cell value — see the comment there.
 *            The basis is read directly from each cell's own formula string
 *            (`cell.f`), never assumed, and stored per step as `dosing_basis`
 *            so verify-dyeing-rules.js checks each row against the formula
 *            that row actually uses.
 *   Footer:  "Total No. Of Bath =N" row, then a "Required Dyeing Time" row
 *            whose J cell is the total minutes (also cross-checked against
 *            the sum of every step's time_min by verify-dyeing-rules.js).
 *
 * IMPORTANT, DISCLOSED HONESTLY (not glossed over): in the 4 coloured sheets
 * ("Both Part Dye 7.30", "Bio Sc Navy or Black", "One Bath Dye", "Heavy
 * Jersey Dyeing"), the REACTIVE DYES rows (Yellow/Red/Blue-Navy-Black) and a
 * few auxiliary rows (e.g. Glauber Salt, Soda Ash) have a BLANK dosing cell
 * in the source file — the actual dye % and some fixation-chemical doses are
 * job-specific and were left for the user to fill in per order, so their
 * Price/Required-Qty are genuinely 0.00 in the sheet's own arithmetic. That
 * means these 4 recipes' cost_per_kg_tk covers PRETREATMENT + NEUTRALISATION
 * + AUXILIARY chemicals only — NOT the reactive dye itself. Only the 2 White
 * recipes (bleach/OBA only, no dye stage) have a genuinely complete cost.
 * This is recorded per-recipe as `dye_cost_included` and restated in the
 * top-level scope_warning — never silently presented as an all-in cost.
 *
 * Run manually whenever the source spreadsheet changes:
 *   node backend/scripts/extract-dyeing-reference.js
 *
 * Output is consumed by verify-dyeing-rules.js (must pass before any import)
 * and by dyeing-engine.js (require()'d directly, Pattern B).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const XLSX_PATH = path.join(__dirname, '..', '..', 'DYEING NEW PROCESS BY MOZAMMEL SIR (1).xlsx');
const OUT_PATH = path.join(__dirname, '..', 'data', 'dyeing-reference.json');

// Hand-maintained, not inferred — this is a 6-row table across 6 sheets, and
// the whole point of the woven layer's "concatenated GSM" lesson is that
// guessing a classification like this is exactly where extraction quietly
// breaks. If the sheet ever uses a color label not listed here, extraction
// MUST fail loudly rather than default to something plausible-looking.
const SHADE_TIER_MAP = {
  'White': ['white_melange'],
  'Navy / Black': ['dark_navy', 'black'],
};

const SHEETS = [
  { name: 'White (chori bonmax)', id: 'white_chori_bonmax' },
  { name: 'Other White', id: 'other_white' },
  { name: 'Both Part Dye 7.30', id: 'both_part_dye_cvc' },
  { name: 'Bio Sc Navy or Black', id: 'bio_sc_navy_black' },
  { name: 'One Bath Dye', id: 'one_bath_dye' },
  { name: 'Heavy Jersey Dyeing', id: 'heavy_jersey_dyeing' },
];

function num(cell) {
  if (!cell) return 0;
  const v = typeof cell.v === 'number' ? cell.v : parseFloat(cell.v);
  return isFinite(v) ? v : 0;
}

function str(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  const s = String(cell.v).trim();
  return s.length ? s : null;
}

// Classify a Required-Qty cell's OWN formula — never assumed uniformly, since
// this file mixes liquor-ratio dosing with %owf dosing (and has one broken
// cell). See the file header comment for the full explanation.
function classifyDosingBasis(hCell) {
  const f = hCell && hCell.f;
  if (!f) return null; // no formula at all (row has no Required-Qty, e.g. a pure process-instruction row)
  // H3*H4*E.../1000 appears with the two factors in BOTH orders across the
  // 6 sheets (H3*H4*... and H4*H3*...) — multiplication is commutative, both
  // are the same relationship, and a naive one-order regex silently
  // misclassified 3 real liquor_gpl rows as 'other' the first time this was
  // written (caught by the scale-invariance check, not by inspection).
  if (/^(H3\*H4|H4\*H3)\*E\d+\/1000$/.test(f) || /^H5\*E\d+\/1000$/.test(f)) return 'liquor_gpl';
  if (/^H3\*E\d+$/.test(f)) return 'percent_owf';
  // The one known broken cell (White (chori bonmax) H32): H2*H3*E../1000,
  // where H2 is blank. Corrected to liquor_gpl — see the file header comment
  // for the three-part evidence (sheet's own formula pattern + identical
  // sibling row in "Other White" + reproduces that sibling's exact numbers).
  if (/^H2\*H3\*E\d+\/1000$/.test(f)) return 'liquor_gpl';
  return 'other';
}

function extractSheet(wb, meta) {
  const ws = wb.Sheets[meta.name];
  if (!ws) throw new Error(`Sheet "${meta.name}" not found in ${XLSX_PATH}`);

  const colorLabel = str(ws['B5']);
  const shadeTiers = SHADE_TIER_MAP[colorLabel];
  if (!shadeTiers) {
    throw new Error(
      `Sheet "${meta.name}": color label "${colorLabel}" has no entry in SHADE_TIER_MAP. ` +
      `Add it explicitly — do not guess.`
    );
  }

  const fabricQtyKg = num(ws['H3']);
  const mlRatio = num(ws['H4']);
  const waterL = num(ws['H5']);
  const compositionTag = str(ws['D5']);

  // A recipe "includes" dye cost only if at least one step whose Functional
  // Name is "REACTIVE DYES" (or the stage is a dyeing stage AND a chemical
  // name is one of the 3 primary colors) has non-zero dosing. In every one
  // of the 4 coloured sheets, all such rows are blank/zero — checked below
  // rather than assumed, so this stays correct if a future sheet fills them.
  let dyeRowsSeen = 0, dyeRowsCosted = 0;

  const steps = [];
  let row = 9;
  const MAX_ROW = 200; // safety bound; every real sheet ends well before this
  for (; row <= MAX_ROW; row++) {
    const aCell = ws['A' + row];
    const aVal = str(aCell);
    if (aVal && /^total no\.? of bath/i.test(aVal)) break;
    // A completely empty row (no A/B/C/E/F/G/H/I/J at all) inside the table
    // is a real spacer the source uses between stages — keep it out of the
    // extracted steps rather than storing a null row.
    const hasAny = ['A', 'B', 'C', 'E', 'F', 'G', 'H', 'I', 'J'].some(c => ws[c + row]);
    if (!hasAny) continue;

    const functionalName = str(ws['B' + row]);
    const commercialName = str(ws['C' + row]);
    const dosingRaw = num(ws['E' + row]);
    const unitPriceTk = num(ws['F' + row]);
    const dosingBasis = classifyDosingBasis(ws['H' + row]);

    // For liquor_gpl/percent_owf rows, recompute required_qty/price from the
    // formula's own inputs rather than trusting the source cell's cached
    // value — the two are mathematically identical for every correctly-
    // working row, and this is what makes the one broken_ref correction above
    // take effect (its cached H/G values are the stale, pre-correction 0s).
    // 'other'/null rows have no formula to recompute from, so their cached
    // values are kept as the source's own arithmetic, transcribed as-is.
    let requiredQtyKg, priceTk;
    if (dosingBasis === 'liquor_gpl') {
      requiredQtyKg = fabricQtyKg * mlRatio * dosingRaw / 1000;
      priceTk = requiredQtyKg * unitPriceTk;
    } else if (dosingBasis === 'percent_owf') {
      requiredQtyKg = fabricQtyKg * dosingRaw;
      priceTk = requiredQtyKg * unitPriceTk;
    } else {
      requiredQtyKg = num(ws['H' + row]);
      priceTk = num(ws['G' + row]);
    }

    if (/^reactive dyes$/i.test(functionalName || '')) {
      dyeRowsSeen++;
      if (dosingRaw > 0) dyeRowsCosted++;
    }

    steps.push({
      step_order: steps.length + 1,
      stage: aVal,
      functional_name: functionalName,
      commercial_name: commercialName,
      // "dosing" is g/L when dosing_basis is 'liquor_gpl', a plain fraction
      // of fabric weight (e.g. 0.004 = 0.4%owf) when 'percent_owf' — the
      // field is named generically because its UNIT depends on dosing_basis;
      // never divide/multiply it without checking that field first.
      dosing: dosingRaw,
      dosing_basis: dosingBasis,
      unit_price_tk: unitPriceTk,
      required_qty_kg: requiredQtyKg,
      price_tk: priceTk,
      remarks: str(ws['I' + row]),
      time_min: num(ws['J' + row]),
    });
  }
  if (row > MAX_ROW) throw new Error(`Sheet "${meta.name}": never found a "Total No. Of Bath" row within ${MAX_ROW} rows`);

  // The row right after "Total No. Of Bath =N" is "Required Dyeing Time",
  // whose J cell is the total minutes — the same total verify-dyeing-rules.js
  // cross-checks against the sum of every step's own time_min.
  const totalBathMatch = /=\s*(\d+)/.exec(str(ws['A' + row]) || '');
  const totalBathCount = totalBathMatch ? parseInt(totalBathMatch[1], 10) : null;
  const totalTimeMin = num(ws['J' + (row + 1)]);

  const dyeCostIncluded = dyeRowsSeen === 0 ? true : dyeRowsCosted > 0;

  // cost_per_kg_tk = SUM(step price_tk) / fabric_qty_kg — computed from the
  // (possibly corrected) step data, not read from the sheet's own D6 cell.
  // D6 is itself just SUM(source G column)/H3 in Excel, so it inherits any
  // broken cell's stale price — cross-checked below instead of trusted, which
  // is exactly how the white_chori_bonmax softener correction gets surfaced
  // in the total rather than staying invisible in an unused D6 read.
  const costPerKgTk = steps.reduce((sum, s) => sum + s.price_tk, 0) / fabricQtyKg;
  const sourceD6 = num(ws['D6']);
  if (Math.abs(costPerKgTk - sourceD6) > 1e-3 * Math.max(1, costPerKgTk)) {
    console.warn(
      `  [${meta.id}] computed cost_per_kg_tk (${costPerKgTk.toFixed(4)}) differs from the source ` +
      `sheet's own D6 total (${sourceD6.toFixed(4)}) — expected only for a row-level correction ` +
      `documented in this script's header; if unexpected, investigate before importing.`
    );
  }

  return {
    id: meta.id,
    sheet_name: meta.name,
    color_label: colorLabel,
    shade_tiers: shadeTiers,
    composition_tag: compositionTag,
    fabric_qty_kg: fabricQtyKg,
    ml_ratio: mlRatio,
    water_l: waterL,
    cost_per_kg_tk: costPerKgTk,
    total_bath_count: totalBathCount,
    total_time_min: totalTimeMin,
    dye_cost_included: dyeCostIncluded,
    steps,
  };
}

function run() {
  const wb = XLSX.readFile(XLSX_PATH);
  const recipes = SHEETS.map(meta => extractSheet(wb, meta));

  const out = {
    source: {
      key: 'MOZAMMEL_DYEING_CARDS',
      title: 'Internal dyeing-cost recipe cards',
      author: 'Alim Knit (BD) Ltd',
      publisher: null,
      year: null,
      identifier: null,
      domain: 'dyeing',
      scope_warning:
        'Covers only 6 real recipe cards from one factory: 2 White (bleach/OBA, no dye stage — complete ' +
        'cost) and 4 "Navy / Black" (jersey and CVC-jersey; the 4 coloured recipes cover pretreatment, ' +
        'neutralisation and auxiliary chemicals ONLY — their reactive dye rows are job-specific templates ' +
        'left blank in the source, so cost_per_kg_tk EXCLUDES the dye itself for those 4; check ' +
        'dye_cost_included per recipe before treating a cost as all-in). No other shade, fibre, or GSM is ' +
        'covered — an unmatched request must fall back to the existing price-list estimate, never a guess.',
    },
    recipes,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${recipes.length} recipes to ${OUT_PATH}`);
  for (const r of recipes) {
    console.log(`  ${r.id}: ${r.color_label} / ${r.composition_tag || '(no composition tag)'} — ` +
      `${r.cost_per_kg_tk.toFixed(4)} Tk/kg, ${r.steps.length} steps, dye_cost_included=${r.dye_cost_included}`);
  }
}

run();
