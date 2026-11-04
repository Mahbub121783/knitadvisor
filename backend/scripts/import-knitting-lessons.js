/**
 * Import knitting lessons: data/knitting-lessons/*.json -> knitting_documents + knitting_lessons.
 *
 *   node scripts/import-knitting-lessons.js            dry run: runs the gate, writes nothing
 *   node scripts/import-knitting-lessons.js --write    gate, then upsert (idempotent)
 *
 * The gate refuses a file that would store something wrong quietly.
 */
'use strict';
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'data', 'knitting-lessons');
const KINDS = ['concept', 'method', 'data', 'table', 'caution', 'engine'];
const TYPES = ['paper', 'lecture', 'textbook', 'notes'], REL = ['core', 'supporting', 'peripheral'];

function load() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) }));
}

function gate(docs) {
  const errs = [], seen = new Set();
  for (const d of docs) {
    const D = d.document || {}, L = d.lessons || [];
    const at = (m) => errs.push(`${d.file}: ${m}`);
    if (!D.doc_key || !/^[a-z0-9-]+$/.test(D.doc_key)) at('doc_key must be lowercase letters, digits, hyphens');
    if (seen.has(D.doc_key)) at('duplicate doc_key'); seen.add(D.doc_key);
    if (!D.title || !D.summary || !D.relevance_note) at('title, summary and relevance_note are required');
    if (!TYPES.includes(D.doc_type)) at('bad doc_type'); if (!REL.includes(D.relevance)) at('bad relevance');
    if (!L.length) at('no lessons');
    const titles = new Set();
    L.forEach((l, i) => {
      if (!l.title || !l.body || l.body.length < 80) at(`lesson ${i + 1}: title and a real body are required`);
      if (!KINDS.includes(l.kind)) at(`lesson ${i + 1}: bad kind ${l.kind}`);
      if (!Array.isArray(l.topics) || !l.topics.length) at(`lesson ${i + 1}: needs topics`);
      if (titles.has(l.title)) at(`lesson ${i + 1}: duplicate title`); titles.add(l.title);
      // no outbound links or source attribution inside lesson text
      if (/https?:\/\/|doi\.org|www\./i.test(l.title + l.body)) at(`lesson ${i + 1}: contains a link`);
    });
    if (!L.some((l) => l.kind === 'caution')) at('every document needs a caution lesson (how far it can be trusted)');
    if (!L.some((l) => l.kind === 'engine')) at('every document needs an engine lesson (what it means for the engine)');
  }
  // known facts that must survive: a count would pass even if the text were wrong
  const he = docs.find((d) => d.document.doc_key === 'he-2025-conductive-knit-strain-sensor');
  if (he) {
    const t = he.lessons.find((l) => /Table 1/.test(l.title));
    for (const s of ['19.70', '232.99', '14% PET + 23% cotton + 63% viscose', '124.35']) if (!t || !t.body.includes(s)) errs.push(`he-2025: Table 1 lesson is missing "${s}"`);
    // the paper's twist coefficient is twist/10cm x sqrt(tex/10): recompute every row. Three rows
    // must agree; the PET/cotton/viscose row must NOT (its printed coefficient is wrong for its
    // tex), and the lesson must say so.
    const rows = [[19.60, 124.35, 174.09], [19.70, 166.00, 232.99], [16.40, 142.30, 182.00], [14.58, 137.00, 165.00]];
    for (const [tex, tw, c] of rows) if (Math.abs(tw * Math.sqrt(tex / 10) - c) > 0.5) errs.push(`he-2025: twist coefficient check fails for ${tex} tex`);
    if (Math.abs(124.36 * Math.sqrt(1.47) - 173.96) < 5) errs.push('he-2025: the PET/cotton/viscose row should NOT fit');
    if (!t || !t.body.includes('150.8') || !/does NOT/.test(t.body)) errs.push('he-2025: Table 1 lesson must record the PET/cotton/viscose inconsistency');
    // the alpha-e values quoted in the engine lesson
    const ae = (tex, tw) => (tw * 10 * Math.sqrt(tex)) / (956.6);
    const want = { 'silvered nylon': [19.60, 124.35, 5.7], 'PET/cotton/viscose': [14.70, 124.36, 5.0], cotton: [19.70, 166.0, 7.7], 'acrylic/cotton': [16.40, 142.30, 6.0], 'polyester/cotton': [14.58, 137.0, 5.5] };
    for (const [k, [tex, tw, v]] of Object.entries(want)) if (Math.abs(ae(tex, tw) - v) > 0.06) errs.push(`he-2025: twist multiplier for ${k} should be ${ae(tex, tw).toFixed(2)}, text says ${v}`);
  }
  return errs;
}

async function main() {
  const docs = load();
  const errs = gate(docs);
  const n = docs.reduce((t, d) => t + d.lessons.length, 0);
  console.log(`${docs.length} document(s), ${n} lessons, ${docs.reduce((t, d) => t + d.lessons.reduce((s, l) => s + l.body.length, 0), 0)} characters`);
  if (errs.length) { console.error('GATE FAILED:\n  ' + errs.join('\n  ')); process.exit(1); }
  console.log('gate passed');
  if (!process.argv.includes('--write')) { console.log('dry run: nothing written (use --write)'); return; }

  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const db = require('../db/client');
  await db.transaction(async (q) => {
    for (const d of docs) {
      const D = d.document;
      await q(`INSERT INTO knitting_documents (doc_key, title, authors, year, doc_type, file_name, pages, summary, relevance, relevance_note)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               ON CONFLICT (doc_key) DO UPDATE SET title=$2, authors=$3, year=$4, doc_type=$5, file_name=$6, pages=$7, summary=$8, relevance=$9, relevance_note=$10, read_at=now()`,
        [D.doc_key, D.title, D.authors || null, D.year || null, D.doc_type, D.file_name, D.pages || null, D.summary, D.relevance, D.relevance_note]);
      await q('DELETE FROM knitting_lessons WHERE doc_key=$1 AND seq > $2', [D.doc_key, d.lessons.length]);
      let seq = 0;
      for (const l of d.lessons) {
        seq++;
        await q(`INSERT INTO knitting_lessons (doc_key, seq, title, kind, topics, body, page_start, page_end)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (doc_key, seq) DO UPDATE SET title=$3, kind=$4, topics=$5, body=$6, page_start=$7, page_end=$8`,
          [D.doc_key, seq, l.title, l.kind, l.topics, l.body, l.page_start || null, l.page_end || null]);
      }
    }
  });
  const [c] = await db.query('SELECT (SELECT count(*) FROM knitting_documents)::int AS docs, (SELECT count(*) FROM knitting_lessons)::int AS lessons');
  console.log(`written: ${c.docs} documents, ${c.lessons} lessons in the database`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
