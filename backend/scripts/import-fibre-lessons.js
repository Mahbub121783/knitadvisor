#!/usr/bin/env node
/**
 * IMPORT THE FIBRE LESSONS
 * ========================
 * Loads data/fibre-lessons.json — the section-by-section text of Morton &
 * Hearle, split on the book's own table of contents — into `fibre_lessons`.
 *
 *   node scripts/import-fibre-lessons.js            check only, write nothing
 *   node scripts/import-fibre-lessons.js --write    apply
 *
 * THE GATE
 * --------
 * Nothing is written until the checks below pass. They are not a formality:
 * this file is produced by a script that reconstructs reading order from block
 * coordinates, and every version of that script so far has been wrong in a way
 * that looked fine in the summary line. The first lost Appendix II entirely —
 * 0 characters, reported as "SPARSE" among 121 others. The second duplicated
 * 14% of the book across section boundaries.
 *
 * So the checks are anchored on content, not on counts: known sentences must
 * appear in the sections they belong to, and the chapter list must match the
 * book's own. A file that has drifted fails on those long before anyone reads
 * a wrong number out of it.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { query, close } = require('../db/client');

const FILE = path.join(__dirname, '..', 'data', 'fibre-lessons.json');
const WRITE = process.argv.includes('--write');

// The 25 chapters as the PDF outline gives them. If the extraction is ever
// re-run against a different file, or the outline is read differently, this
// disagrees immediately instead of importing a stranger's book.
const EXPECTED_CHAPTERS = [
  'An introduction to fibre structure', 'Testing and sampling',
  'Fibre fineness and transverse dimensions', 'Fibre length', 'Fibre density',
  'Thermal properties', 'Equilibrium absorption of water', 'Heats of sorption',
  'Rate of absorption of moisture', 'The retention of liquid water', 'Swelling',
  'Theories of moisture sorption', 'Tensile properties', 'The effects of variability',
  'Elastic recovery', 'Rheology', 'Directional effects', 'Thermomechanical responses',
  'Fibre breakage and fatigue', 'Theories of mechanical properties',
  'Dielectric properties', 'Electrical resistance', 'Static electricity',
  'Optical properties', 'Fibre friction',
];

// Sentences that must land in a named section. Chosen from pages carrying data
// the engine will later depend on, so a shift in the extraction shows up here
// rather than in a calculation.
const ANCHORS = [
  ['5.1', 'Fibre density plays a direct part in affecting the weight of fabrics'],
  ['5.3', 'Typical values of the densities and specific volumes of fibres'],
  // The density table itself, which is a floated object at the foot of the
  // page and is stored under its caption rather than under any section.
  ['Table 5.1', 'Cotton (lumen filled)'],
  ['Table 5.1', '1.55'],
  // Floated to the TOP of its page, which is how 44 tables were lost.
  ['Table 5.2', 'Para-aramid (Kevlar, Twaron)'],
  ['1.1.3', 'flexibility, fineness and a high ratio of length to thickness'],
  ['AII.2', 'Viscose CV'],
  ['AII.3', 'Polyester PES'],
];

const failures = [];
let passed = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) passed++; else failures.push(label + (detail ? ': ' + detail : ''));
  return ok;
};

function verify(payload) {
  const { source, lessons } = payload;
  console.log('\nGATE — the file must describe the book it claims to\n');

  check(source && source.key === 'morton_hearle_2008', 'the source key is the expected one', source && source.key);
  check(source.page_offset === 19, 'the page offset is 19', String(source.page_offset));
  check(source.pdf_pages === 765, 'the PDF is 765 pages', String(source.pdf_pages));
  check(lessons.length > 500, 'the outline produced a full set of lessons', lessons.length + ' lessons');

  // Chapters
  const chapters = [];
  for (const l of lessons) {
    if (l.chapter_no && !chapters[l.chapter_no]) chapters[l.chapter_no] = l.chapter_title;
  }
  const got = chapters.slice(1, 26);
  const same = got.length === 25 && got.every((t, i) => t === EXPECTED_CHAPTERS[i]);
  check(same, 'all 25 chapter titles match the book outline',
        same ? '' : got.map((t, i) => (t === EXPECTED_CHAPTERS[i] ? '' : `${i + 1}: "${t}"`)).filter(Boolean).join('; '));

  // Page arithmetic. The offset is the single constant that, if wrong, makes
  // every citation in this layer wrong while looking perfectly plausible.
  const badOffset = lessons.filter(l =>
    l.pdf_page_start > 19 && l.page_start !== l.pdf_page_start - 19);
  check(badOffset.length === 0, 'every body lesson numbers its printed page as pdf page minus 19',
        badOffset.length + ' disagree');
  const frontMatter = lessons.filter(l => l.pdf_page_start <= 19 && l.page_start !== null);
  check(frontMatter.length === 0, 'front matter carries no printed page number, because it is roman',
        frontMatter.length + ' have one');

  const outOfRange = lessons.filter(l =>
    l.pdf_page_start < 1 || l.pdf_page_end > 765 || l.pdf_page_end < l.pdf_page_start);
  check(outOfRange.length === 0, 'every page range is inside the book and correctly ordered',
        outOfRange.length + ' are not');

  // Extraction quality
  const kinds = {};
  lessons.forEach(l => { kinds[l.extraction] = (kinds[l.extraction] || 0) + 1; });
  check(Object.keys(kinds).every(k => ['CLEAN', 'SPARSE', 'FIGURE_HEAVY', 'CONTAINER', 'TABLE'].includes(k)),
        'extraction is always one of the four known kinds', JSON.stringify(kinds));
  check((kinds.SPARSE || 0) <= 10,
        'almost nothing came out sparse', (kinds.SPARSE || 0) + ' sparse');
  check((kinds.CLEAN || 0) >= 400,
        'most sections extracted cleanly', (kinds.CLEAN || 0) + ' clean');

  // 132 is the real count. The 140 this was first set to came from a run that
  // had 18 sentences beginning "Table 11.1 gives ..." filed as tables, so the
  // threshold was calibrated against the defect it was meant to guard.
  check((kinds.TABLE || 0) >= 125,
        'the printed tables were lifted out and kept in their own right', (kinds.TABLE || 0) + ' tables');

  // The check that would have caught the worst loss so far. Table captions are
  // numbered consecutively within a chapter, so a gap means a table went
  // missing — and 44 of them had, because a table floated to the TOP of a page
  // put its caption inside the running-head band and the filter deleted it.
  // Nothing about the totals looked wrong: 106 tables is a plausible number for
  // a 765-page book, and every anchor still passed because Table 5.1 survived.
  const byChapter = new Map();
  for (const l of lessons) {
    if (l.extraction !== 'TABLE') continue;
    const m = /^(\d+)\.(\d+)$/.exec(l.section_no || '');
    if (!m) continue;
    const ch = Number(m[1]);
    if (!byChapter.has(ch)) byChapter.set(ch, new Set());
    byChapter.get(ch).add(Number(m[2]));
  }
  const gaps = [];
  for (const [ch, nums] of [...byChapter].sort((a, b) => a[0] - b[0])) {
    const top = Math.max(...nums);
    for (let n = 1; n <= top; n++) if (!nums.has(n)) gaps.push(`${ch}.${n}`);
  }
  check(gaps.length === 0, 'table numbering runs unbroken in every chapter',
        gaps.length ? 'missing ' + gaps.join(', ') : `${byChapter.size} chapters`);

  // A number appearing twice means something that is not a table was read as
  // one. Every case so far has been a sentence — "Table 11.1 gives a collection
  // of values" — which is lifted out of its section AND filed under a number a
  // real table already holds, so it does damage at both ends. The gap check
  // above cannot see it, because a duplicate leaves no gap.
  const seenNumbers = new Map();
  for (const l of lessons) {
    if (l.extraction !== 'TABLE' || !l.section_no) continue;
    seenNumbers.set(l.section_no, (seenNumbers.get(l.section_no) || 0) + 1);
  }
  const duped = [...seenNumbers].filter(([, n]) => n > 1).map(([k]) => k);
  check(duped.length === 0, 'no table number is claimed twice',
        duped.length ? duped.join(', ') : `${seenNumbers.size} distinct tables`);

  // An equation block is short and full of digits, which is exactly what a
  // table row looks like, so one can be swallowed into the table above it.
  const withEq = lessons.filter(l =>
    l.extraction === 'TABLE' && /^\s*\(\d+\.\d+[a-z]?\)\s*$/m.test(l.body));
  check(withEq.length === 0, 'no equation was swallowed into a table',
        withEq.map(l => l.title.slice(0, 40)).join('; '));
  const lossy = lessons.filter(l => l.symbol_loss > 0);
  check(lossy.length < 100, 'few sections lost maths glyphs to the text layer',
        `${lossy.length} sections, worst ${Math.max(0, ...lessons.map(l => l.symbol_loss))} characters`);

  const badChars = lessons.filter(l => l.char_count !== l.body.length);
  check(badChars.length === 0, 'the stated character count is the actual one', badChars.length + ' differ');

  // Content anchors — the check that actually catches a shifted extraction.
  for (const [section, sentence] of ANCHORS) {
    const l = lessons.find(x => x.title.startsWith(section));
    check(!!l && l.body.includes(sentence),
          `"${sentence.slice(0, 46)}..." is in section ${section}`,
          l ? (l.body.includes(sentence) ? '' : `found section but not the text (${l.char_count} chars)`) : 'section missing');
  }

  // Boundary duplication. Some overlap is unavoidable where a heading cannot be
  // located, but a third of the book appearing twice would mean the boundary
  // logic has stopped working.
  let dup = 0;
  const total = lessons.reduce((s, l) => s + l.char_count, 0);
  for (let i = 0; i + 1 < lessons.length; i++) {
    const a = lessons[i], b = lessons[i + 1];
    if (a.pdf_page_end !== b.pdf_page_start || !a.body || !b.body) continue;
    const bl = new Set(b.body.split('\n'));
    for (const line of a.body.split('\n')) if (line.trim() && bl.has(line)) dup += line.length;
  }
  const pct = (dup / total) * 100;
  check(pct < 5, 'boundary overlap stays under 5% of the text', pct.toFixed(1) + '%');
  check(total > 1200000, 'the whole book came through', total.toLocaleString('en-US') + ' characters');

  return failures.length === 0;
}

async function write(payload) {
  const { lessons } = payload;
  const src = await query('SELECT key FROM reference_sources WHERE key = $1', ['morton_hearle_2008']);
  if (!src.length) throw new Error('reference_sources has no morton_hearle_2008 row — run migration 006 first.');

  let inserted = 0, updated = 0;
  for (const l of lessons) {
    const r = await query(
      `INSERT INTO fibre_lessons
         (source_key, chapter_no, chapter_title, section_no, title, level,
          pdf_page_start, pdf_page_end, page_start, page_end,
          body, char_count, symbol_loss, extraction, figure_pages)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (source_key, pdf_page_start, title) DO UPDATE SET
         body = EXCLUDED.body, char_count = EXCLUDED.char_count,
         symbol_loss = EXCLUDED.symbol_loss,
         extraction = EXCLUDED.extraction, figure_pages = EXCLUDED.figure_pages,
         pdf_page_end = EXCLUDED.pdf_page_end, page_end = EXCLUDED.page_end
       RETURNING (xmax = 0) AS is_insert`,
      [l.source_key, l.chapter_no, l.chapter_title, l.section_no, l.title, l.level,
       l.pdf_page_start, l.pdf_page_end, l.page_start, l.page_end,
       l.body, l.char_count, l.symbol_loss, l.extraction, l.figure_pages]
    );
    if (r[0] && r[0].is_insert) inserted++; else updated++;
  }
  return { inserted, updated };
}

(async () => {
  const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  console.log('Fibre lessons — %s', path.relative(process.cwd(), FILE));
  console.log('%s, %s (%s)', payload.source.title, payload.source.author, payload.source.edition);

  const ok = verify(payload);
  console.log('\n' + '─'.repeat(60));
  if (!ok) {
    console.log(`GATE FAILED — ${passed} passed, ${failures.length} failed\n`);
    failures.forEach(f => console.log('  ✗ ' + f));
    console.log('\nNothing will be imported.');
    process.exitCode = 1;
    return;
  }
  console.log(`GATE PASSED — all ${passed} checks.`);

  if (!WRITE) {
    console.log('\nDry run. Re-run with --write to import.');
    return;
  }
  const { inserted, updated } = await write(payload);
  console.log(`\nImported: ${inserted} new, ${updated} updated.`);

  const [{ count }] = await query('SELECT count(*)::int AS count FROM fibre_lessons');
  const [{ chars }] = await query('SELECT coalesce(sum(char_count),0)::bigint AS chars FROM fibre_lessons');
  console.log(`fibre_lessons now holds ${count} lessons, ${Number(chars).toLocaleString('en-US')} characters.`);
})()
  .catch(err => { console.error('\n[Import] ' + err.message); process.exitCode = 1; })
  .finally(() => close());
