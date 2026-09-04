/**
 * KnitAdvisor — Master Recipe Reference Extractor (2nd factory source)
 * ======================================================================
 *
 * Parses "NEW MASTER RECIPE -Octorber (2).xlsx" (66 sheets, source company
 * not stated anywhere in the file — checked the "PREPARED BY :"/"CHECKED BY:"
 * signature lines, both blank) into backend/data/master-recipe-reference.json,
 * a SECOND snapshot dyeing-engine.js requires alongside dyeing-reference.json
 * (Pattern B — no DB at request time; see that file's header for why).
 *
 * DIFFERENT LAYOUT FROM THE MOZAMMEL FILE — confirmed by direct inspection,
 * not assumed to match:
 *   Header:  D9 = shade label, D10 = fabrication/GSM tag, J6 = fabric qty
 *            (kg), J7 = M:L ratio, J8 = J6*J7 (water, L).
 *   Table (row 13 to the "PREPARED BY :" row, column B):
 *            B = dosing amount, C = unit ('GPL' | '%'), D = chemical name,
 *            E = qty formula, F = literal "KG", G = rate/kg (a MIX of live
 *            VLOOKUP(name, local P:Q catalog, 2, FALSE) and hardcoded stale
 *            numbers — never trusted directly, see buildCatalog()),
 *            H = E*G, I = topping cost (=G*J), J = topping-qty flag.
 *            A row with ONLY column B filled (no C/D/E) is a STAGE LABEL
 *            (e.g. "PRE TREATMENT (98'C X 30 MIN)"), not a chemical — carried
 *            as `stage` on the next real row, same idea as the Mozammel
 *            file's sparse stage column, just laid out as its own row here.
 *   No time/temperature or bath-count columns exist — that information is
 *   embedded as free text inside stage labels, not structured data. Recorded
 *   as null, never estimated.
 *
 * SHADE MAPPING — deliberately narrower than "every sheet with a D9 value".
 * Of 66 sheets, only sheets whose D9 text contains an unambiguous colour
 * word (WHITE / BLACK / DARK / DK+EX DK / LT+MED / ALL COLOUR / ANY / a
 * fluorescent mention) are mapped, per SHADE_TIER_MAP below — hand-reviewed
 * from the real D9 values, not inferred by a live regex at extraction time.
 * Deliberately EXCLUDED (recorded in EXCLUDED_D9_VALUES so a brand-new,
 * truly unrecognised D9 still throws rather than silently vanishing):
 *   - bare shade-DEPTH percentages with no colour word (e.g. "0.1-1.5%",
 *     "SHADE(2.1--3.0)%") — mapping a % threshold to a tier needs a real
 *     dyeing-chemistry convention this project does not have confirmed yet
 *     (the same "shade% dosing curve" the user said needs their reference
 *     book, still pending).
 *   - turquoise/green ("ALL TURQISE+GREEN", "TURQUISE") — none of this
 *     app's 6 SHADE_TIERS represent a hue family; forcing one would
 *     misclassify rather than describe.
 *   - "0084" (PIGMENT DYEING) — a code, not shade text.
 *   - "RFD/ONLY SCOURING" — pretreatment-only but not literally labelled a
 *     shade the way the Mozammel White sheets are.
 * Also excluded structurally: sheets with no D9/J6/J7 at all (different
 * layout — yarn-dyeing, trims, woven — not this shade-recipe template) and,
 * unchanged from the plan, MC WASH / STRIPPING (recipe template reused for
 * non-shade-specific chemistry) and the 3 reference-chart sheets.
 *
 * Run manually whenever the source spreadsheet changes:
 *   node backend/scripts/extract-master-recipe-reference.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const XLSX_PATH = path.join(__dirname, '..', '..', 'NEW MASTER RECIPE -Octorber (2).xlsx');
const OUT_PATH = path.join(__dirname, '..', 'data', 'master-recipe-reference.json');

// Not recipes at all — different layout (charts/equipment) or explicitly
// out of scope (non-shade-specific chemistry reusing the recipe template).
const EXCLUDED_SHEETS = new Set([
  'dye,Salt, soda chart', 'M C CAPACITY UNIT-2', 'winch speed',
  'MC WASH', 'STRIPPING',
]);

// Hand-reviewed from the real D9 values found in every structurally-valid
// sheet (see this file's header) — never inferred live. Exact trimmed-string
// match; anything not here AND not in EXCLUDED_D9_VALUES throws.
const SHADE_TIER_MAP = {
  'ALL COLOUR':  ['black', 'dark_navy', 'light_medium', 'white_melange', 'fluorescent', 'melange'],
  'ANY COLOUR':  ['black', 'dark_navy', 'light_medium', 'white_melange', 'fluorescent', 'melange'],
  'ANY':         ['black', 'dark_navy', 'light_medium', 'white_melange', 'fluorescent', 'melange'],
  'WHITE':       ['white_melange'],
  'LT+MED':      ['light_medium'],
  'LT+MED(0.1-1.5)%': ['light_medium'],
  'LY-SPECIAL LT+MED WITHOUT YELLOW': ['light_medium'],
  'DK+EX DK':    ['dark_navy'],
  'DK+EX.DK':    ['dark_navy'],
  'DARK':        ['dark_navy'],
  'DARK COLOUR': ['dark_navy'],
  'DK+EX DK+BLACK': ['dark_navy', 'black'],
  'black':       ['black'],
  'BLACK':       ['black'],
  'CVC+PC 1 P.Poly(Flourecent': ['fluorescent'],
};

// Deliberately unmapped — see file header for why each is excluded rather
// than guessed. Listed explicitly so a NEW, unrecognised D9 value (a real
// workbook change) still throws instead of silently being skipped too.
const EXCLUDED_D9_VALUES = new Set([
  'RFD/ONLY SCOURING', '0.1-1.5%', 'SHADE 1.51 & ABOVE',
  'ALL TURQISE+GREEN', 'SHADE(0.1--2.0)%', 'SHADE(2.1--3.0)%',
  'SHADE(3.1--ABOVE)%', 'PR-SCO 2.P POLY/SH(0.1--0.5)%',
  'PR-SCO 2.P POLY/SH(0.5--0.9)%', 'PR-BIO 2.P POLY/SH(0.91--2)%',
  'PR-BIO 2.P POLY/SH(2.1-3.0)%', 'SHADE(UPTO-1.0)%',
  'SHADE(1.1&ABOVE)%', '0084', 'TURQUISE',
]);

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
// The source is inconsistent about chemical-name casing across sheets (e.g.
// "Crosprep HES" vs "CROSPREP HES" for the literal same product) — matched
// case-insensitively for price lookup ONLY; each recipe's own step still
// stores its own commercial_name exactly as that sheet authored it.
function normalizeName(name) {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

function slugify(name) {
  return name.toLowerCase().trim()
    .replace(/[%()]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Classify an E-column (qty) cell's own formula. Two bases, same idea as
// extract-dyeing-reference.js, but this file's %-basis stores dosing as a
// raw percent NUMBER (e.g. 1 = 1%), not a fraction — normalized to a
// fraction below so calculateDyeingCost()'s existing formula (fabric_qty *
// dosing) works unchanged for both sources.
function classifyDosingBasis(eCell) {
  const f = eCell && eCell.f;
  if (!f) return null;
  // Both factor orders appear across sheets (e.g. "RE PROSSES DRY" row 16
  // uses J8*B16/1000 while most sheets use B14*J8/1000) — multiplication is
  // commutative, same relationship either way. Missing this once already
  // silently misclassified real rows in the Mozammel extractor; caught here
  // by re-checking every "other"-classified row's numbers against a live
  // fabric-quantity scale, same discipline.
  if (/^\+?(B\d+\*J8|J8\*B\d+)\/1000$/.test(f)) return 'liquor_gpl';
  if (/^\+?(B\d+\*J6|J6\*B\d+)\/100$/.test(f)) return 'percent_owf';
  // One cell only ("GSM-(140-180) SJ-DK+E.DK" row 22, Acetic Acid): formula is
  // B22*J7/1000 — J7 is the bare M:L ratio, not J8 (=J6*J7, water), so this
  // silently loses the fabric-quantity factor. Invisible in the source's own
  // display only because that sheet's J6 happens to equal 1; caught by a
  // scale-invariance check (qty=1 vs qty=1000 gave different cost/kg) the
  // same way the Mozammel softener typo was. Confirmed a one-off (occurs
  // exactly once in the whole workbook) and corrected to the same J8-based
  // formula every other liquor_gpl row in this file uses.
  if (/^\+?B\d+\*J7\/1000$/.test(f)) return 'liquor_gpl';
  return 'other';
}

/**
 * ONE chemical price catalog merged from every recipe-template sheet's own
 * local P:Q columns (each sheet carries a near-complete copy, but not always
 * an IDENTICAL one — "MELL OVER DYED" is missing "CROSPREP HES" entirely,
 * present and consistently priced at 279 Tk/kg on 18 other sheets — so a
 * per-sheet-only catalog would wrongly refuse to cost a real row that every
 * other sheet prices the same way). Scanned once from the raw P:Q cells,
 * never from a G-column formula/value (some G cells are live VLOOKUPs into
 * this range, some are hardcoded and stale — e.g. "ALL S-J WHITE" hardcodes
 * Crossprep HES at 273 while the catalog agrees everywhere else at 279).
 * A name with DIFFERENT prices across sheets is recorded as a conflict, not
 * silently resolved — verify-master-recipe-rules.js checks that no actually-
 * costed row depends on one.
 */
function buildGlobalCatalog(wb) {
  const byName = new Map(); // key -> Map(price -> occurrence count)
  for (const sheetName of wb.SheetNames) {
    if (EXCLUDED_SHEETS.has(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const nameCell = ws[XLSX.utils.encode_cell({ r, c: 15 })]; // P
      const priceCell = ws[XLSX.utils.encode_cell({ r, c: 16 })]; // Q
      const name = str(nameCell);
      if (!name || name === '-') continue;
      const price = priceCell && typeof priceCell.v === 'number' ? priceCell.v : null;
      if (price === null) continue;
      const key = normalizeName(name);
      if (!byName.has(key)) byName.set(key, new Map());
      const counts = byName.get(key);
      counts.set(price, (counts.get(price) || 0) + 1);
    }
  }

  const catalog = {};
  const conflicts = {};
  for (const [name, counts] of byName) {
    const entries = [...counts.entries()]; // [price, count]
    if (entries.length === 1) { catalog[name] = entries[0][0]; continue; }

    const total = entries.reduce((s, [, c]) => s + c, 0);
    const nonZero = entries.filter(([p]) => p > 0);
    // Two documented, evidence-based resolutions — never a blind pick:
    //   1. One candidate is literally 0 alongside a real positive price. 0 is
    //      never a valid Tk/kg price (same rule dyeing_chemical_prices'
    //      CHECK enforces) — it is a placeholder row, not a second real
    //      price, so the positive one wins.
    //   2. One price accounts for an overwhelming majority (>=90%) of every
    //      sheet's own catalog copy, with a single outlier sheet — e.g.
    //      "Acetic Acid" agrees at 67.106 Tk/kg on 60 of 61 sheets, with only
    //      "White Doracord" carrying a stale 54.18. That is one sheet's
    //      catalog not having been updated, not a genuine second price.
    if (nonZero.length === 1 && entries.length === 2) {
      catalog[name] = nonZero[0][0];
      console.warn(`  [catalog] "${name}": resolved 0-vs-${nonZero[0][0]} Tk/kg — 0 is a placeholder, not a real price.`);
      continue;
    }
    const majority = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (majority[1] / total >= 0.9) {
      catalog[name] = majority[0];
      const outliers = entries.filter(e => e !== majority).map(([p, c]) => `${p} (${c}x)`).join(', ');
      console.warn(`  [catalog] "${name}": resolved to majority ${majority[0]} Tk/kg (${majority[1]}/${total} sheets); outlier(s) ${outliers} treated as stale.`);
      continue;
    }
    conflicts[name] = entries.map(([p]) => p).sort((a, b) => a - b);
  }
  return { catalog, conflicts };
}

function extractSheet(wb, sheetName, { catalog, conflicts }) {
  const ws = wb.Sheets[sheetName];
  const shadeLabel = str(ws['D9']);
  if (!shadeLabel) throw new Error(`Sheet "${sheetName}": no D9 shade label — should have been caught by the structural filter`);

  if (EXCLUDED_D9_VALUES.has(shadeLabel)) return null; // deliberately out of scope, see file header
  const shadeTiers = SHADE_TIER_MAP[shadeLabel];
  if (!shadeTiers) {
    throw new Error(
      `Sheet "${sheetName}": shade label "${shadeLabel}" is neither in SHADE_TIER_MAP nor ` +
      `EXCLUDED_D9_VALUES — a new/changed value in the source. Add it explicitly, do not guess.`
    );
  }

  const fabricQtyKg = num(ws['J6']);
  const mlRatio = num(ws['J7']);
  const waterL = num(ws['J8']);
  const fabricationTag = str(ws['D10']);

  const steps = [];
  const costGaps = []; // costed rows whose price could not be resolved — disclosed, never guessed
  let currentStage = null;
  let row = 13;
  const MAX_ROW = 200;
  for (; row <= MAX_ROW; row++) {
    const bCell = ws['B' + row];
    const bStr = str(bCell);
    if (bStr && /^prepared by/i.test(bStr)) break;

    const cCell = ws['C' + row], dCell = ws['D' + row], eCell = ws['E' + row];
    const hasC = !!cCell, hasD = !!dCell, hasE = !!eCell;
    if (!hasC && !hasD && !hasE) {
      if (bStr) currentStage = bStr; // stage label row
      continue;
    }

    const dosingRaw = num(bCell);
    const unit = str(cCell);
    const name = str(dCell);
    const dosingBasis = classifyDosingBasis(eCell);
    const additionFlag = num(ws['J' + row]); // topping qty flag

    let dosing = dosingRaw;
    let requiredQtyKg;
    if (dosingBasis === 'liquor_gpl') {
      requiredQtyKg = fabricQtyKg * mlRatio * dosingRaw / 1000;
    } else if (dosingBasis === 'percent_owf') {
      dosing = dosingRaw / 100; // normalize raw percent -> fraction, matching dyeing-reference.json's convention
      requiredQtyKg = fabricQtyKg * dosing;
    } else {
      requiredQtyKg = num(eCell);
    }

    // Placeholder slot (name "-" or blank, zero dosing) — job-specific,
    // left blank in the source. Contributes 0 cost, never a guessed price.
    const isPlaceholder = (!name || name === '-') && !(requiredQtyKg > 0);

    // A costed row (required_qty_kg > 0) whose price cannot be safely
    // resolved — either the name isn't in the merged catalog at all, or the
    // catalog disagrees with itself across sheets for that name — is a real
    // gap in the SOURCE data, not something to guess through. It is recorded
    // per recipe (cost_gaps) and priced at 0, exactly like Mozammel's
    // dye_cost_included handles a genuinely missing cost component: disclosed,
    // never silently absorbed into a total that then reads as complete.
    let unitPriceTk = 0;
    if (!isPlaceholder) {
      const key = normalizeName(name);
      if (key in catalog) {
        unitPriceTk = catalog[key];
      } else if (requiredQtyKg > 0) {
        const reason = key in conflicts
          ? `conflicting prices ${conflicts[key].join('/')} Tk/kg across different sheets`
          : 'not in the merged price catalog at all';
        costGaps.push({ commercial_name: name, required_qty_kg: requiredQtyKg, reason });
      }
    }

    const priceTk = requiredQtyKg * unitPriceTk;
    const toppingTk = unitPriceTk * additionFlag;

    steps.push({
      step_order: steps.length + 1,
      stage: currentStage,
      commercial_name: name,
      dosing,
      dosing_basis: dosingBasis,
      unit_hint: unit, // 'GPL' | '%' as literally shown in column C — cross-checked against dosing_basis by the verify script
      unit_price_tk: unitPriceTk,
      required_qty_kg: requiredQtyKg,
      price_tk: priceTk,
      topping_tk: toppingTk,
    });
    currentStage = null; // only attaches to the row immediately after a label
  }
  if (row > MAX_ROW) throw new Error(`Sheet "${sheetName}": never found a "PREPARED BY" row within ${MAX_ROW} rows`);

  const costPerKgTk = steps.reduce((s, x) => s + x.price_tk + x.topping_tk, 0) / fabricQtyKg;

  return {
    id: slugify(sheetName),
    sheet_name: sheetName,
    color_label: shadeLabel,
    shade_tiers: shadeTiers,
    fabrication_tag: fabricationTag,
    fabric_qty_kg: fabricQtyKg,
    ml_ratio: mlRatio,
    water_l: waterL,
    cost_per_kg_tk: costPerKgTk,
    cost_complete: costGaps.length === 0,
    cost_gaps: costGaps,
    total_bath_count: null,   // not tracked in this source
    total_time_min: null,     // not tracked in this source — see file header
    steps,
  };
}

function run() {
  const wb = XLSX.readFile(XLSX_PATH);
  const globalCatalog = buildGlobalCatalog(wb);
  console.log(`Merged price catalog: ${Object.keys(globalCatalog.catalog).length} chemicals with one consistent ` +
    `price, ${Object.keys(globalCatalog.conflicts).length} with conflicting prices across sheets.`);

  const recipes = [];
  const skipped = [];

  for (const sheetName of wb.SheetNames) {
    if (EXCLUDED_SHEETS.has(sheetName)) { skipped.push([sheetName, 'reference chart / non-shade chemistry']); continue; }
    const ws = wb.Sheets[sheetName];
    const d9 = ws['D9'], j6 = ws['J6'], j7 = ws['J7'];
    const structurallyValid = d9 && d9.v != null && j6 && typeof j6.v === 'number' && j7 && typeof j7.v === 'number';
    if (!structurallyValid) { skipped.push([sheetName, 'different layout (no D9/J6/J7)']); continue; }

    const recipe = extractSheet(wb, sheetName, globalCatalog);
    if (recipe === null) { skipped.push([sheetName, `excluded shade label "${str(ws['D9'])}"`]); continue; }
    recipes.push(recipe);
  }

  // recipe ids must be unique — a collision would silently merge two real
  // sheets under one id.
  const ids = new Set();
  for (const r of recipes) {
    if (ids.has(r.id)) throw new Error(`Duplicate recipe id "${r.id}" (sheet "${r.sheet_name}") — slugify collision, needs a manual id.`);
    ids.add(r.id);
  }

  const out = {
    source: {
      key: 'MASTER_RECIPE_OCTOBER',
      title: 'Internal dyeing recipe & costing cards',
      author: null, // not stated anywhere in the file — see this file's header
      publisher: null,
      year: null,
      identifier: null,
      domain: 'dyeing',
      scope_warning:
        `Covers ${recipes.length} real recipe cards from a second, unattributed factory workbook. ` +
        'No process time/temperature or bath-count data is available for this source (embedded as ' +
        'free text in stage labels, not structured) — total_time_min/total_bath_count are null, never ' +
        'estimated. Shade-depth-percentage sheets, turquoise/green shades, and a handful of ' +
        'unidentifiable sheets were deliberately left out rather than guessed at — see this ' +
        "extractor's own header comment for the full list and reasoning.",
    },
    recipes,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${recipes.length} recipes to ${OUT_PATH}`);
  console.log(`Skipped ${skipped.length} sheets:`);
  for (const [name, reason] of skipped) console.log(`  - ${JSON.stringify(name)}: ${reason}`);
}

run();
