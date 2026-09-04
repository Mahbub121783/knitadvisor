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
 *              'broken_ref'   ONE cell only (White (chori bonmax) H32,
 *                             softener row): formula is `H2*H3*E32/1000`,
 *                             and H2 does not exist in this workbook — a
 *                             genuine typo in the source (should reference
 *                             H3*H4 like its siblings), which is WHY that
 *                             row's own Required-Qty/Price sits at 0.00 in
 *                             the source file itself. Transcribed exactly as
 *                             the source computes it — not "corrected" —
 *                             matching this project's standing rule to
 *                             faithfully reproduce a source's own arithmetic,
 *                             warts included, rather than silently fixing it.
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
  return 'other'; // includes the one known broken_ref cell (H2*H3*.../1000) — transcribed as-is, not re-derived
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
  const costPerKgTk = num(ws['D6']);
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
    const priceTk = num(ws['G' + row]);
    const requiredQtyKg = num(ws['H' + row]);
    const dosingBasis = classifyDosingBasis(ws['H' + row]);

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
