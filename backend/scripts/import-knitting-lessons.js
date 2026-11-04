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
  // Nayen: facts that must survive, and the worked examples recomputed
  const ny = docs.find((d) => d.document.doc_key === 'nayen-knitting-calculations');
  if (ny) {
    const all = ny.lessons.map((l) => l.body).join(' ');
    for (const f of ['G x G / 18', 'G x G / 8.4', '26.55', '15.74', '21.55', '334.9', '73.64', '45.3697', '0.836']) if (!all.includes(f)) errs.push(`nayen: lessons are missing "${f}"`);
    const kg = (nd, feeders, sl, rpm, ne, eff) => (nd * feeders * sl * rpm * 60 / 1000 * 1.0936 / (840 * ne) * 0.4536 * eff);
    if (Math.abs(kg(2260, 90, 4, 26, 24, 0.85) - 26.55) > 0.05) errs.push('nayen: example 07 does not recompute to 26.55');
    const fil = 2286 * 120 * 4.5 * 30 * 60 / 1000 * 75 / 9000 / 1000 * 0.85;
    if (Math.abs(fil - 15.74) > 0.02) errs.push('nayen: example 08 does not recompute to 15.74');
    const fleece = kg(1696, 60, 4.5, 28, 26, 0.85) + kg(1696, 30, 2.5, 28, 16, 0.85);
    if (Math.abs(fleece - 21.55) > 0.1) errs.push(`nayen: example 09 recomputes to ${fleece.toFixed(2)}, not 21.55`);
    if (Math.abs(280 / 0.836 - 334.9) > 0.1) errs.push('nayen: 10 OSY should be 334.9 GSM');
    if (Math.abs(9000 * 4500 / 550000 - 73.64) > 0.01) errs.push('nayen: denier example should be 73.64');
    // the double-bed rule the engine disagrees with: G x G / 15.3 for 3.91 x sqrt(Ne)
    if (Math.abs(1 / (3.91 * 3.91) - 1 / 15.29) > 0.001) errs.push('nayen: 3.91 x sqrt(Ne) should be G x G / 15.3');
  }
  const all_ = (k) => { const d = docs.find((x) => x.document.doc_key === k); return d ? d.lessons.map((l) => l.body).join(' ') : null; };
  // Iyer: pitch table is 25.4/E, production examples recompute, Ne conversions
  const iy = all_('iyer-circular-knitting-ch9-10');
  if (iy) {
    for (const [t, e] of [[16.93, 1.5], [12.7, 2], [2.12, 12], [1.41, 18], [1.06, 24], [0.91, 28], [0.64, 40], [0.58, 44]]) {
      if (Math.abs(25.4 / e - t) > 0.011) errs.push(`iyer: pitch ${t} is not 25.4/${e}`);
      if (!iy.includes(`${t.toFixed(2)} = E${e}`)) errs.push(`iyer: pitch table is missing ${t.toFixed(2)} = E${e}`);
    }
    const L = (S, n, eta, fpc, MR) => (S * n * 60 * eta) / (fpc * MR * 100), B = (D, E, MS) => (D * 3.14 * E) / (MS * 100);
    const ex1 = L(96, 35, 0.85, 1, 18) * B(30, 28, 13) * 125 / 1000;
    if (Math.abs(L(96, 35, 0.85, 1, 18) - 95.2) > 0.05 || Math.abs(ex1 - 24.2) > 0.1) errs.push('iyer: example 1 does not recompute');
    if (Math.abs(L(96, 31, 0.85, 2, 17) - 44.6) > 0.05 || Math.abs(L(96, 31, 0.85, 2, 17) * 1.9 * 100 / 1000 - 8.5) > 0.1) errs.push('iyer: example 2 does not recompute');
    if (Math.abs(L(96, 23, 0.8, 3, 12) - 29.4) > 0.05) errs.push('iyer: example 3 does not recompute');
    for (const [dtex, ne] of [[300, 19.7], [194, 30.4], [150, 39.4], [125, 47.2], [63, 93.7]]) {
      if (Math.abs(590.5 / (dtex / 10) - ne) > 0.1) errs.push(`iyer: ${dtex} dtex is Ne ${(590.5 / (dtex / 10)).toFixed(1)}, text says ${ne}`);
      if (!iy.includes(String(ne))) errs.push(`iyer: Ne ${ne} missing`);
    }
    for (const f of ['up to 4.8', 'up to 2.0', '0.5 to 0.7', '3 to 6 cN', '65 percent', '2.6 to 2.8', '95.2', '24.2']) if (!iy.includes(f)) errs.push(`iyer: missing "${f}"`);
  }
  // Dassanayaka: tightness factors worked out in the lessons
  const te = all_('dassanayaka-2024-knit-parameters-teng');
  if (te) {
    const tf = (tex, mm) => Math.sqrt(tex) / (mm / 10);
    for (const v of [tf(50, 3.0), tf(50, 3.6), tf(50, 4.0), tf(50, 5.0), tf(35, 3.6), tf(65, 3.6), tf(70, 3.6), tf(105, 3.6), tf(140, 3.6)]) if (!te.includes(v.toFixed(1))) errs.push(`dassanayaka: TF ${v.toFixed(1)} is missing`);
    for (const f of ['98.20', '91.92', '106.2', '259.76', '44.46', '95.23', '98.06', '99.76']) if (!te.includes(f)) errs.push(`dassanayaka: missing ${f}`);
  }
  // deepKnit: the four numeric limits
  const dk = all_('scheidt-2020-deepknit-machine-code');
  if (dk) for (const f of ['three loops per needle', 'seven courses', 'two loops', 'four needles']) if (!dk.includes(f)) errs.push(`deepknit: missing "${f}"`);
  // slit tube open width = pi x d
  const am = all_('amsaveni-knitting-slides');
  if (am) { if (Math.abs(Math.PI * 30 - 94.2) > 0.05 || !am.includes('94 inches')) errs.push('amsaveni: slit tube width'); }
  // rib/interlock lecture: the sequences must be present
  const ri = all_('anon-rib-interlock-lecture');
  if (ri) for (const f of ['half cardigan', 'Full cardigan', 'Swiss double piqué', 'French double piqué', '30 to 40 percent']) if (!ri.toLowerCase().includes(f.toLowerCase())) errs.push(`rib lecture: missing "${f}"`);
  const lec = docs.find((d) => d.document.doc_key === 'anon-knitting-basics-lecture');
  if (lec) {
    const all = lec.lessons.map((l) => l.body).join(' ');
    for (const f of ['latch needle', 'compound needle', 'sinker', 'weft purl', 'work of rupture']) if (!all.toLowerCase().includes(f)) errs.push(`lecture: lessons are missing "${f}"`);
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
