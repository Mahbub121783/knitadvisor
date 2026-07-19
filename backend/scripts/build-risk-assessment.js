/**
 * KnitAdvisor — Fabric Risk Assessment Builder
 * ==============================================
 *
 * Parses Accurate_Fabric_Risk_Assessment.md (50 real production job records —
 * composition, GSM, measured shrinkage L/W/T, documented fabric risks, special
 * production instructions, real process routes, and finishing remarks) into
 * backend/data/risk-assessment.json.
 *
 * This is genuinely different data from factory-records.json (which covers
 * greige→finish GSM/count/SL). This dataset is about what goes WRONG and how
 * real mills handled it for a specific composition+construction+GSM — used to
 * calibrate the shrinkage prediction model (quality-engine.js already accepts
 * a `calibration` override) and to surface real documented risk factors.
 *
 * Run manually whenever the source .md changes:
 *   node backend/scripts/build-risk-assessment.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parseComposition } = require('../engine/composition-engine');

const MD_PATH = path.join(__dirname, '..', '..', 'Accurate_Fabric_Risk_Assessment.md');
const OUT_PATH = path.join(__dirname, '..', 'data', 'risk-assessment.json');

// ============================================================
// FIELD PARSERS
// ============================================================

// Entry title (e.g. "Single jersey (Baby  Fleece)", "Double Jersey (Ottoman Rib)")
// → one of the 8 real structural buckets factory-match.js already uses.
function mapConstruction(title) {
  const t = title.toLowerCase();
  if (/terry/.test(t)) return 'terry';
  if (/fleece/.test(t)) return 'fleece';
  if (/waffle|waffel/.test(t)) return 'waffle';
  if (/rib/.test(t)) return 'rib';
  if (/interlock/.test(t)) return 'interlock';
  if (/pique/.test(t)) return 'pique';
  return 'single_jersey'; // plain / jacquard-jersey / double-face / crape variants
}

// Same dominant-fibre classification as build-factory-dataset.js's
// mapComposition() — one rule applied everywhere real composition text is
// bucketed, so this dataset and the factory dataset agree.
function mapComposition(raw) {
  const lower = String(raw || '').toLowerCase();
  if (/modal/.test(lower)) return 'modal';
  const parsed = parseComposition(raw);
  const f = (parsed && parsed.fibers) || {};
  const cotton = f.cotton || 0;
  const poly = f.polyester || 0;
  const viscose = f.viscose || 0; // parseComposition folds modal/tencel/lyocell differently; raw check above catches modal
  if (viscose >= 15) return 'viscose';
  if (poly > 0 && poly >= cotton) return 'pc';
  if (poly > 0) return 'cvc';
  return 'cotton';
}

// Best-effort primary (ground/face) yarn Ne — these fields are highly
// irregular (multi-yarn, denier, "Not Specified"); only used as a soft
// distance signal, never required.
function parsePrimaryNe(raw) {
  if (!raw) return null;
  const s = String(raw);
  const m = s.match(/(\d+(?:\.\d+)?)\s*\/\s*1\b/) || s.match(/(\d+(?:\.\d+)?)\s*[sS]\b/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return (v > 0 && v < 100) ? v : null;
}

// L / W / T shrinkage, from free text like "Shrinkage;L=-6%,W=-7%,T=5%" or
// "Shrinkage Limits: L -5.6%, W-7.2%, and Spirality 6%." — tolerant of the
// dataset's inconsistent spacing/punctuation.
function parseShrinkageAxis(text, letter) {
  const re = new RegExp(letter + '\\s*=?\\s*(-?\\d+(?:\\.\\d+)?)\\s*(?:\\u00b1\\s*(\\d+(?:\\.\\d+)?))?\\s*%?', 'i');
  const m = text.match(re);
  if (!m) return null;
  return { value_pct: parseFloat(m[1]), tolerance_pct: m[2] ? parseFloat(m[2]) : null };
}

// Canonical risk-tag vocabulary — normalizes the dataset's inconsistent
// phrasing/typos ("Enzymre sensitive", "Creasemark", "Hole problem", …) to a
// fixed set so the same tag from different entries reads identically.
const RISK_CANON = [
  [/enzym\w*\s*sensitiv\w*/i, 'Enzyme Sensitive'],
  [/creas/i, 'Crease Mark'],
  [/hole/i, 'Hole Risk'],
  [/heat\s*set/i, 'Heat-Set Sensitivity'],
  [/hairiness|surface\s*hairy|surface$/i, 'Hairiness'],
  [/pilling/i, 'Pilling'],
  [/snagging/i, 'Snagging'],
  [/shade/i, 'Shade Variation'],
  [/bursting/i, 'Bursting Strength Risk'],
  [/rubbing/i, 'Rubbing / Crocking'],
  [/poor\s*recovery/i, 'Poor Recovery'],
  [/creep\s*spot/i, 'Creep Spot'],
  [/fiber\s*sensitivity|fibre\s*sensitivity/i, 'Fibre Sensitivity'],
  [/y\/d\s*program/i, 'Yarn-Dye Program Risk'],
  [/gsm/i, 'GSM Variation'],
  [/high\s*risk|risky\s*order/i, 'High-Risk Order'],
  [/brightness/i, 'Brightness / Whiteness Risk'],
  [/harsh/i, 'Harsh Hand-feel Risk'],
  [/shrinkage/i, 'Shrinkage'],
];
function normalizeRiskTag(raw) {
  const s = raw.trim();
  if (!s) return null;
  for (const [re, canon] of RISK_CANON) {
    if (re.test(s)) return canon;
  }
  return null; // drop unrecognized fragments (e.g. garbled "Risk Issuse analysis")
}

function parseRiskTags(raw) {
  const parts = String(raw || '').split(/,\s*|\s{2,}/).map(s => s.trim()).filter(Boolean);
  const tags = parts.map(normalizeRiskTag).filter(Boolean);
  return [...new Set(tags)];
}

// Bullet/paragraph blocks in the source are single "*"-prefixed lines that
// often concatenate several distinct facts separated by long whitespace runs
// (an artifact of a table→markdown conversion). Split on both newlines and
// 3+-space runs, then clean.
function splitBlock(raw) {
  if (!raw) return [];
  return raw
    .split(/\n/)
    .flatMap(line => line.split(/\s{3,}/))
    .map(s => s.replace(/^\*\s*/, '').trim())
    .filter(s => s.length > 1 && s !== '*');
}

function extractSection(block, header) {
  const re = new RegExp(header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n([\\s\\S]*?)(?=\\n###|\\n---|$)');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

// ============================================================
// MAIN
// ============================================================
function build() {
  const md = fs.readFileSync(MD_PATH, 'utf8');
  const entryBlocks = md.split(/\n## Entry \d+: /).slice(1); // first slice is the doc header

  const out = [];
  const unmappedRiskFragments = new Set();

  entryBlocks.forEach((block, i) => {
    const titleMatch = block.match(/^(.+)/);
    const title = titleMatch ? titleMatch[1].trim() : `Entry ${i + 1}`;

    const composition = (block.match(/\*\*Composition:\*\*\s*(.+)/) || [, ''])[1].trim();
    const gsm = parseFloat((block.match(/\*\*GSM:\*\*\s*(\d+)/) || [, ''])[1]);
    const yarnCountRaw = (block.match(/\*\*Yarn Count:\*\*\s*(.+)/) || [, ''])[1].trim();
    const slRaw = (block.match(/\*\*Stitch Length:\*\*\s*(.+)/) || [, ''])[1].trim();
    const fabricRiskRaw = (block.match(/\*\*Fabric Risk:\*\*\s*(.+)/) || [, ''])[1].trim();

    const instructionsRaw = extractSection(block, '### 📋 Special Instructions');
    const routeRaw = extractSection(block, '### ⚙️ Process Route');
    const remarksRaw = extractSection(block, '### 💬 Remarks & Quality Notes');

    if (!gsm) return; // unusable without GSM

    const construction = mapConstruction(title);
    const comp = mapComposition(composition);
    const ne = parsePrimaryNe(yarnCountRaw);

    const shrinkage = {
      length: parseShrinkageAxis(instructionsRaw, 'L'),
      width: parseShrinkageAxis(instructionsRaw, 'W'),
      thickness: parseShrinkageAxis(instructionsRaw, 'T'),
    };

    // Raw fragments that failed canonicalization, for the coverage report.
    String(fabricRiskRaw).split(/,\s*|\s{2,}/).map(s => s.trim()).filter(Boolean).forEach(f => {
      if (!normalizeRiskTag(f)) unmappedRiskFragments.add(f);
    });

    const routeSeq = routeRaw
      .replace(/^\*\s*/, '')
      .replace(/\*\*Sequence:\*\*/, '')
      .split(/➔|→/)
      .map(s => s.trim())
      .filter(Boolean);

    out.push({
      id: i + 1,
      name: title,
      construction,
      comp,
      composition_raw: composition,
      gsm,
      ne,
      yarn_count_raw: yarnCountRaw,
      stitch_length_raw: slRaw,
      risk_tags: parseRiskTags(fabricRiskRaw),
      shrinkage,
      special_instructions: splitBlock(instructionsRaw),
      process_route: routeSeq,
      remarks: splitBlock(remarksRaw),
    });
  });

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 0));

  console.log(`\nRisk-assessment build — ${MD_PATH}`);
  console.log(`  Entries parsed: ${out.length} / ${entryBlocks.length}`);
  const byConstruction = {};
  out.forEach(r => { byConstruction[r.construction] = (byConstruction[r.construction] || 0) + 1; });
  console.log('  By construction:', JSON.stringify(byConstruction));
  const withShrinkage = out.filter(r => r.shrinkage.length && r.shrinkage.width).length;
  console.log(`  With both L+W shrinkage parsed: ${withShrinkage} / ${out.length}`);
  const withTags = out.filter(r => r.risk_tags.length > 0).length;
  console.log(`  With at least 1 recognized risk tag: ${withTags} / ${out.length}`);
  if (unmappedRiskFragments.size) {
    console.log(`  Unrecognized risk fragments (dropped, not shown to users):`, [...unmappedRiskFragments].join(' | '));
  }
  console.log(`\n  Wrote ${out.length} records → ${OUT_PATH}\n`);
}

build();
