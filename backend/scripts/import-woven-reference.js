#!/usr/bin/env node
/**
 * Import the woven reference extracted from Gokarneshan (2005) into PostgreSQL.
 *
 *   node scripts/import-woven-reference.js            # dry run — reports only
 *   node scripts/import-woven-reference.js --apply    # write
 *
 * Source: backend/data/woven-reference.json
 * Target: reference_sources, woven_weaves, woven_constructions, woven_rules,
 *         woven_colour_effects, woven_glossary   (migration 005)
 *
 * The import REFUSES TO RUN until scripts/verify-woven-rules.js passes. That
 * script re-derives the book's own satin table from its own stated rules and
 * recomputes every worked example; if the extraction has drifted from the book,
 * nothing reaches the database. This is the gate the factory-records import did
 * not have when it wrote four concatenated GSM readings.
 *
 * Idempotent — every insert is ON CONFLICT DO UPDATE.
 */
'use strict';

require('dotenv').config();
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');
const { transaction, query, close } = require('../db/client');

const APPLY = process.argv.includes('--apply');
const REF = require('../data/woven-reference.json');

const sha = obj => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');

// ---------------------------------------------------------------- the gate
function verifyOrRefuse() {
  const script = path.join(__dirname, 'verify-woven-rules.js');
  try {
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
    console.log('[gate] verify-woven-rules.js passed — the extraction still reproduces the book\n');
    return true;
  } catch (err) {
    console.error('[gate] verify-woven-rules.js FAILED. Nothing will be imported.\n');
    console.error(String(err.stdout || '') + String(err.stderr || ''));
    return false;
  }
}

// ---------------------------------------------------------------- shaping
// The book prints some densities as a single figure and some as a range. A
// range is kept as a range: collapsing "92 - 132 ends/inch" to 112 would put a
// number in the database that nobody ever measured.
function densities(c) {
  return {
    epi:     c.ends_per_inch      ?? c.ends_per_inch_min      ?? null,
    epi_max: c.ends_per_inch_max  ?? null,
    ppi:     c.picks_per_inch     ?? c.picks_per_inch_min     ?? null,
    ppi_max: c.picks_per_inch_max ?? null,
    ppcm:    c.picks_per_cm       ?? null,
  };
}

// Everything the book measured that is not a thread density: crimp, tuft
// counts, pile heights, shrinkage, wire densities, yarn lengths.
const MEASUREMENT_KEYS = [
  'tufts_per_sq_inch', 'weft_crimp_pct', 'weft_contraction_pct', 'width_shrinkage_pct',
  'pile_warp_m_per_100cm', 'ground_warp_m_per_100cm', 'wires_per_inch', 'wires_per_inch_min',
  'wires_per_inch_max', 'pile_height_mm_min', 'pile_height_mm_max', 'ground_warp_crimp_pct',
  'extra_warp_crimp_pct_min', 'extra_warp_crimp_pct_max', 'ends_per_mail_eye',
  'double_ends_per_inch', 'picks_note', 'ends_note', 'note',
];
function measurements(c) {
  const out = {};
  for (const k of MEASUREMENT_KEYS) if (c[k] !== undefined) out[k] = c[k];
  return out;
}

// Which rules the verification script actually reproduces from the book, as
// opposed to merely transcribing. Only these get verified = true.
const VERIFIED_RULES = new Set([
  'satin_move_numbers', 'broken_twill_skip', 'brighton_honeycomb_float',
  'twill_angle', 'weave_repeat_size', 'corkscrew_constraints',
]);

// Chapter 15's recipes, and what happened when each was rendered.
const EFFECT_NOTES = {
  hairline: {
    reproduced: true,
    note: "The book's text on p.125 says '1 dark and 4 light', but Fig 15.7 shows D L D L on both axes. Only the 1-and-1 colouring (with the weft phase offset by one) produces the solid one-thread vertical lines the section defines; the printed 1-and-4 does not. Treated as a typo in the text, with the figure taken as correct.",
  },
};

// ---------------------------------------------------------------- import
async function run() {
  if (!verifyOrRefuse()) { await close(); process.exit(1); }

  const counts = {};
  const plan = [];

  const src = REF.source;
  plan.push(['reference_sources', 1]);
  plan.push(['woven_weaves', REF.weaves.length]);
  plan.push(['woven_constructions', REF.constructions.length]);
  plan.push(['woven_rules', Object.keys(REF.rules).length]);
  plan.push(['woven_colour_effects', REF.colour_weave_effects.length]);
  plan.push(['woven_glossary', REF.glossary.length]);

  console.log(`Source : ${src.citation_prefix}`);
  console.log(`Domain : ${src.domain}   (PDF page = book page + 13)`);
  console.log(`Scope  : ${src.scope_warning}\n`);
  for (const [t, n] of plan) console.log(`  ${String(n).padStart(4)}  ${t}`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.');
    await close();
    return;
  }

  console.log('');
  await transaction(async q => {
    // ---- source registry -------------------------------------------------
    await q(
      `INSERT INTO reference_sources (key, title, author, publisher, year, identifier, domain, page_offset, scope_note, archived_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (key) DO UPDATE SET
         title=EXCLUDED.title, author=EXCLUDED.author, publisher=EXCLUDED.publisher,
         year=EXCLUDED.year, identifier=EXCLUDED.identifier, domain=EXCLUDED.domain,
         page_offset=EXCLUDED.page_offset, scope_note=EXCLUDED.scope_note`,
      ['BOOK_GOKARNESHAN_2005', src.title, src.author, src.publisher, src.year,
       'ISBN ' + src.isbn13, src.domain, 13, src.scope_warning, null]
    );
    counts.reference_sources = 1;

    // ---- weaves ----------------------------------------------------------
    for (const w of REF.weaves) {
      const payload = { ...w };
      for (const k of ['slug', 'name', 'family', 'loom_equipment', 'draft',
                       'repeat_ends', 'repeat_picks', 'end_uses', 'page']) delete payload[k];
      await q(
        `INSERT INTO woven_weaves (slug, name, family, loom_equipment, draft, repeat_ends, repeat_picks, end_uses, payload, page)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, family=EXCLUDED.family, loom_equipment=EXCLUDED.loom_equipment,
           draft=EXCLUDED.draft, repeat_ends=EXCLUDED.repeat_ends, repeat_picks=EXCLUDED.repeat_picks,
           end_uses=EXCLUDED.end_uses, payload=EXCLUDED.payload, page=EXCLUDED.page`,
        [w.slug, w.name, w.family, w.loom_equipment ?? null, w.draft ?? null,
         w.repeat_ends ?? null, w.repeat_picks ?? null, w.end_uses ?? null,
         JSON.stringify(payload), w.page]
      );
    }
    counts.woven_weaves = REF.weaves.length;

    // ---- constructions ---------------------------------------------------
    for (const c of REF.constructions) {
      const d = densities(c);
      await q(
        `INSERT INTO woven_constructions
           (cloth, weave_slug, ends_per_inch, ends_per_inch_max, picks_per_inch,
            picks_per_inch_max, picks_per_cm, warp_count, weft_count, material,
            measurements, page, source_table)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (cloth, page) DO UPDATE SET
           weave_slug=EXCLUDED.weave_slug, ends_per_inch=EXCLUDED.ends_per_inch,
           ends_per_inch_max=EXCLUDED.ends_per_inch_max, picks_per_inch=EXCLUDED.picks_per_inch,
           picks_per_inch_max=EXCLUDED.picks_per_inch_max, picks_per_cm=EXCLUDED.picks_per_cm,
           warp_count=EXCLUDED.warp_count, weft_count=EXCLUDED.weft_count,
           material=EXCLUDED.material, measurements=EXCLUDED.measurements,
           source_table=EXCLUDED.source_table`,
        [c.cloth, c.weave_slug, d.epi, d.epi_max, d.ppi, d.ppi_max, d.ppcm,
         c.warp_count ?? null, c.weft_count ?? null, c.material ?? null,
         JSON.stringify(measurements(c)), c.page, c.table ?? null]
      );
    }
    counts.woven_constructions = REF.constructions.length;

    // ---- rules -----------------------------------------------------------
    for (const [key, rule] of Object.entries(REF.rules)) {
      await q(
        `INSERT INTO woven_rules (key, payload, page, verified)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (key) DO UPDATE SET
           payload=EXCLUDED.payload, page=EXCLUDED.page, verified=EXCLUDED.verified`,
        [key, JSON.stringify(rule), rule.page, VERIFIED_RULES.has(key)]
      );
    }
    counts.woven_rules = Object.keys(REF.rules).length;

    // ---- colour and weave effects ---------------------------------------
    for (const e of REF.colour_weave_effects) {
      const meta = EFFECT_NOTES[e.slug] || { reproduced: true, note: null };
      await q(
        `INSERT INTO woven_colour_effects
           (slug, name, weave, warping_order, wefting_order, description, reproduced, note, page)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, weave=EXCLUDED.weave, warping_order=EXCLUDED.warping_order,
           wefting_order=EXCLUDED.wefting_order, description=EXCLUDED.description,
           reproduced=EXCLUDED.reproduced, note=EXCLUDED.note, page=EXCLUDED.page`,
        [e.slug, e.name, e.weave, e.warping_order, e.wefting_order,
         e.description ?? null, meta.reproduced, meta.note, e.page]
      );
    }
    counts.woven_colour_effects = REF.colour_weave_effects.length;

    // ---- glossary --------------------------------------------------------
    for (const g of REF.glossary) {
      await q(
        `INSERT INTO woven_glossary (term, definition, page)
         VALUES ($1,$2,$3)
         ON CONFLICT (term) DO UPDATE SET
           definition=EXCLUDED.definition, page=EXCLUDED.page`,
        [g.term, g.definition, g.page]
      );
    }
    counts.woven_glossary = REF.glossary.length;

    // ---- freshness stamps ------------------------------------------------
    const stamps = {
      woven_weaves: REF.weaves,
      woven_constructions: REF.constructions,
      woven_rules: REF.rules,
      woven_colour_effects: REF.colour_weave_effects,
      woven_glossary: REF.glossary,
    };
    for (const [table, data] of Object.entries(stamps)) {
      await q(
        `INSERT INTO reference_versions (table_name, row_count, checksum, source)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (table_name) DO UPDATE SET
           row_count=EXCLUDED.row_count, checksum=EXCLUDED.checksum,
           source=EXCLUDED.source, imported_at=now()`,
        [table, counts[table], sha(data), 'BOOK_GOKARNESHAN_2005']
      );
    }
  });

  for (const [t, n] of Object.entries(counts)) console.log(`  wrote ${String(n).padStart(4)}  ${t}`);

  // ---- read back -------------------------------------------------------
  const [check] = await query(`
    SELECT (SELECT count(*) FROM woven_weaves)          AS weaves,
           (SELECT count(*) FROM woven_constructions)   AS constructions,
           (SELECT count(*) FROM woven_rules)           AS rules,
           (SELECT count(*) FROM woven_rules WHERE verified) AS verified_rules,
           (SELECT count(*) FROM woven_colour_effects)  AS effects,
           (SELECT count(*) FROM woven_glossary)        AS glossary`);
  console.log('\nIn the database now:');
  console.log(`  ${check.weaves} weaves · ${check.constructions} constructions · ` +
              `${check.rules} rules (${check.verified_rules} reproduced from the book) · ` +
              `${check.effects} colour effects · ${check.glossary} glossary terms`);

  await close();
}

run().catch(async err => { console.error('\nimport failed:', err.message); await close(); process.exit(1); });
