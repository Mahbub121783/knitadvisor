/**
 * Fuzzy search over the reference tables.
 *
 * WHY THIS IS A ROUTE AND NOT AN ENGINE FUNCTION
 * ----------------------------------------------
 * Search is the one part of this product that genuinely wants a database.
 * The colour picker searches 1,910 Pantone names, and the in-code implementation
 * it replaces was a substring scan: `name.toLowerCase().includes(query)`. That
 * has two failure modes a knitter hits constantly.
 *
 *   A typo returns nothing at all. "navi blu", "turkoise" and "burgandy" each
 *   produced an empty dropdown — not a near miss, zero rows.
 *
 *   A correct spelling ranks wrongly. Scoring put `startsWith` above `contains`
 *   with no similarity measure, so "black" returned Blackberry Wine — a pink —
 *   because it starts with the query and sorts early by Pantone code, while
 *   Jet Black scored lower as a mere substring match.
 *
 * pg_trgm fixes both by measuring how much of the whole name the query actually
 * accounts for. "black" now returns Jet Black (0.600) ahead of Black Iris
 * (0.545); "navi blu" returns Navy Blue.
 *
 * These endpoints do not participate in a calculation. They help a user find
 * the right input; once found, the deterministic engine takes over unchanged.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db/client');
const { createRateLimiter } = require('../middleware/rate-limiter');

// Typing in a search box fires a request per keystroke (debounced), so this
// needs far more headroom than a calculate call, while still bounding a script.
const searchLimiter = createRateLimiter({
  name: 'search',
  max: 120,
  message: 'Too many search requests — slow down and try again shortly.',
});

const MAX_TERM = 64;
const clampLimit = (v, def, max) => Math.min(Math.max(parseInt(v, 10) || def, 1), max);

// Below this, trigram overlap is coincidence rather than a near-match. Tuned
// against the real books: "burgandy"→Burgundy scores 0.50 and "turkoise"→
// Turquoise 0.46, so 0.15 keeps genuine typos while dropping noise.
const MIN_SIMILARITY = 0.15;

function term(req) {
  const q = (req.query.q || '').toString().trim().slice(0, MAX_TERM);
  return q.length >= 2 ? q : null;
}

// ============================================================
// GET /api/search/colours?q=navi+blu&book=tcx&limit=12
// ============================================================
router.get('/colours', searchLimiter, async (req, res) => {
  const q = term(req);
  if (!q) return res.json({ success: true, query: null, results: [] });

  const book = ['tcx', 'scotdic', 'bros', 'archroma'].includes(req.query.book)
    ? req.query.book : null;
  const limit = clampLimit(req.query.limit, 12, 48);

  try {
    // An exact code match ("19-4052") should win outright regardless of how the
    // trigram score falls — someone typing a Pantone code knows what they want.
    const rows = await query(
      `SELECT book, code, name, hex, family,
              GREATEST(similarity(name, $1), similarity(code, $1)) AS score,
              (upper(replace(code,'-','')) = upper(replace($1,'-',''))) AS exact_code
         FROM colour_book
        WHERE ($2::text IS NULL OR book = $2)
          AND (GREATEST(similarity(name, $1), similarity(code, $1)) >= $3
               OR upper(replace(code,'-','')) = upper(replace($1,'-','')))
        ORDER BY exact_code DESC, score DESC, name
        LIMIT $4`,
      [q, book, MIN_SIMILARITY, limit]
    );

    res.json({
      success: true,
      query: q,
      book: book || 'all',
      results: rows.map(r => ({
        book: r.book,
        code: r.code,
        name: r.name,
        hex: r.hex,
        family: r.family,
        label: r.book === 'tcx' ? `PANTONE ${r.code} TCX` : r.code,
        match: r.exact_code ? 'exact_code' : 'similar',
        score: Number(r.score),
      })),
    });
  } catch (err) {
    // Search is a convenience, not the product. If the database is down the
    // colour box should go quiet, not error the page the user is filling in.
    console.error('[Search] colours failed:', err.message);
    res.json({ success: true, query: q, results: [], degraded: true });
  }
});

// ============================================================
// GET /api/search/fabrics?q=interlok&limit=8
// ============================================================
router.get('/fabrics', searchLimiter, async (req, res) => {
  const q = term(req);
  if (!q) return res.json({ success: true, query: null, results: [] });
  const limit = clampLimit(req.query.limit, 8, 30);

  try {
    // Bangla names are matched too, so "সিঙ্গেল" finds single jersey. The id is
    // included because "single_jersey" is what a returning user often types.
    const rows = await query(
      `SELECT id, name, name_bn, category, data_bucket, gsm_min, gsm_max,
              GREATEST(
                similarity(name, $1),
                similarity(coalesce(name_bn,''), $1),
                similarity(replace(id,'_',' '), $1)
              ) AS score
         FROM fabrics
        WHERE is_active
          AND GREATEST(
                similarity(name, $1),
                similarity(coalesce(name_bn,''), $1),
                similarity(replace(id,'_',' '), $1)
              ) >= $2
        ORDER BY score DESC, sort_order
        LIMIT $3`,
      [q, MIN_SIMILARITY, limit]
    );

    res.json({
      success: true,
      query: q,
      results: rows.map(r => ({
        id: r.id,
        name: r.name,
        name_bn: r.name_bn,
        category: r.category,
        gsm_range: r.gsm_min == null ? null
          : { min: Number(r.gsm_min), max: Number(r.gsm_max) },
        has_factory_data: !!r.data_bucket,
        score: Number(r.score),
      })),
    });
  } catch (err) {
    console.error('[Search] fabrics failed:', err.message);
    res.json({ success: true, query: q, results: [], degraded: true });
  }
});

// ============================================================
// GET /api/search/faults?q=hols
// ============================================================
router.get('/faults', searchLimiter, async (req, res) => {
  const q = term(req);
  if (!q) return res.json({ success: true, query: null, results: [] });
  const limit = clampLimit(req.query.limit, 8, 20);

  try {
    const rows = await query(
      `SELECT slug, name, category, payload, similarity(name, $1) AS score
         FROM knitting_faults
        WHERE similarity(name, $1) >= $2
        ORDER BY score DESC
        LIMIT $3`,
      [q, MIN_SIMILARITY, limit]
    );
    res.json({
      success: true,
      query: q,
      results: rows.map(r => ({
        slug: r.slug, name: r.name, category: r.category,
        description: r.payload && r.payload.description ? r.payload.description : null,
        score: Number(r.score),
      })),
    });
  } catch (err) {
    console.error('[Search] faults failed:', err.message);
    res.json({ success: true, query: q, results: [], degraded: true });
  }
});

// ============================================================
// GET /api/search/woven?q=gaberdeen&limit=10
// ============================================================
//
// One endpoint across THREE tables on purpose. The woven reference from
// Gokarneshan (2005) splits a term over `woven_glossary`, `woven_weaves` and
// `woven_constructions` depending on how the book treated it, and the split is
// not something a user can be expected to know: "huckaback" has a whole chapter
// and so is a weave row with no glossary entry, while "gabardine" only ever
// appears in the glossary. A search that hit one table would silently miss the
// other half of the book.
//
// Each row carries the book page it came from, because a reference that cannot
// be re-checked is worth much less than one that can.
router.get('/woven', searchLimiter, async (req, res) => {
  const q = term(req);
  if (!q) return res.json({ success: true, query: null, results: [] });
  const limit = clampLimit(req.query.limit, 10, 30);

  try {
    // MIN_SIMILARITY matters more here than anywhere else in this file. Measured
    // against these 73 terms, the PostgreSQL default of 0.3 drops
    // "gaberdeen"→Gabardine (0.176) and "hessain"→Hessian cloth (0.222) — both
    // the ordinary way a knitter mis-spells them — while 0.15 keeps both.
    const rows = await query(
      `WITH hits AS (
         SELECT 'glossary' AS kind, term AS label, definition AS detail,
                NULL::text AS family, page, similarity(term, $1) AS score
           FROM woven_glossary
          WHERE similarity(term, $1) >= $2

         UNION ALL

         SELECT 'weave', name, payload->>'definition', family, page,
                GREATEST(similarity(name, $1), similarity(replace(slug,'_',' '), $1))
           FROM woven_weaves
          WHERE GREATEST(similarity(name, $1), similarity(replace(slug,'_',' '), $1)) >= $2

         UNION ALL

         SELECT 'construction', cloth,
                concat_ws(' · ', warp_count, weft_count, material),
                weave_slug, page, similarity(cloth, $1)
           FROM woven_constructions
          WHERE similarity(cloth, $1) >= $2
       )
       SELECT * FROM hits ORDER BY score DESC, label LIMIT $3`,
      [q, MIN_SIMILARITY, limit]
    );

    res.json({
      success: true,
      query: q,
      source: 'Gokarneshan, Fabric Structure and Design (2005)',
      results: rows.map(r => ({
        kind: r.kind,
        label: r.label,
        detail: r.detail,
        family: r.family,
        page: r.page,
        // The scan is paginated 13 ahead of the printed page, so give both
        // rather than making the reader remember the offset.
        pdf_page: r.page + 13,
        score: Number(r.score),
      })),
    });
  } catch (err) {
    console.error('[Search] woven failed:', err.message);
    res.json({ success: true, query: q, results: [], degraded: true });
  }
});

// ============================================================
// GET /api/search/fibre?q=
// ============================================================
//
// The fibre reference layer holds 728 lessons and 740 measurements out of
// Morton & Hearle, and until now there was no way to ask it anything. The
// advisory reasons about a fabric you are calculating; this answers a question
// you simply have.
//
// Three kinds of hit, deliberately kept apart rather than blended into one
// relevance score:
//
//   measurement  a number, with its condition, unit and printed page. This is
//                what someone usually wants and it is returned first.
//   fibre        the fibre itself, for "what is polynosic".
//   lesson       the book's own prose, full-text ranked.
//
// Measurements are matched on the FIBRE's name, not the property's, because
// "cotton tenacity" should find cotton's tenacity and not every tenacity in the
// book. The property is filtered separately when the query names one.
router.get('/fibre', searchLimiter, async (req, res) => {
  const q = term(req);
  if (!q) return res.json({ success: true, query: null, results: [] });
  const limit = clampLimit(req.query.limit, 12, 40);

  // "cotton tenacity" is two things: a fibre and a property. Splitting them
  // lets the query answer the actual question instead of ranking every row
  // that happens to contain either word.
  const PROPERTY_WORDS = {
    tenacity: 'tenacity', strength: 'tenacity', tensile: 'tenacity',
    modulus: 'initial_modulus', stiffness: 'initial_modulus',
    extension: 'breaking_extension', elongation: 'breaking_extension',
    density: 'density', regain: 'moisture_regain', moisture: 'moisture_regain',
    friction: 'friction_%', recovery: 'elastic_recovery', elastic: 'elastic_recovery',
    swelling: '%swelling%', lustre: 'lustre', refractive: 'refractive_%',
    birefringence: 'birefringence', yield: 'yield_%', pilling: 'work_of_rupture',
    toughness: 'work_of_rupture',
  };
  const words = q.toLowerCase().split(/\s+/);
  const propLike = words.map(w => PROPERTY_WORDS[w]).find(Boolean) || null;
  const fibreTerm = words.filter(w => !PROPERTY_WORDS[w]).join(' ').trim() || q;

  try {
    const [measurements, fibres, lessons] = await Promise.all([
      query(
        `SELECT f.name, f.slug, p.property, p.value, p.value_min, p.value_max,
                p.unit, p.condition, p.page, p.table_ref, p.note,
                similarity(f.name, $1) AS score
           FROM fibre_properties p
           JOIN fibres f ON f.slug = p.fibre_slug
          WHERE similarity(f.name, $1) >= $2
            AND ($3::text IS NULL OR p.property LIKE $3)
          ORDER BY score DESC, f.name, p.property, p.condition
          LIMIT $4`,
        [fibreTerm, MIN_SIMILARITY, propLike, limit]
      ),
      query(
        `SELECT slug, name, generic_class, origin, polymer, page,
                similarity(name, $1) AS score
           FROM fibres
          WHERE similarity(name, $1) >= $2
          ORDER BY score DESC LIMIT 8`,
        [fibreTerm, MIN_SIMILARITY]
      ),
      // Full text over the book's own prose. websearch_to_tsquery takes what a
      // person actually types — quoted phrases, OR, a leading minus — instead
      // of throwing on the punctuation that plainto_ would swallow silently.
      query(
        `SELECT chapter_no, chapter_title, section_no, title, page_start, page_end,
                pdf_page_start, char_count,
                ts_headline('english', body, websearch_to_tsquery('english', $1),
                            'MaxWords=42, MinWords=18, MaxFragments=2, FragmentDelimiter=" … "') AS snippet,
                ts_rank(search, websearch_to_tsquery('english', $1)) AS score
           FROM fibre_lessons
          WHERE search @@ websearch_to_tsquery('english', $1)
          ORDER BY score DESC, char_count DESC
          LIMIT $2`,
        [q, limit]
      ),
    ]);

    const span = r => (r.value != null ? String(r.value)
                     : `${r.value_min}–${r.value_max}`);

    res.json({
      success: true,
      query: q,
      // What the query was understood to be asking. A user who types "cotton
      // tenacity" and gets densities should be able to see why.
      understood_as: { fibre: fibreTerm, property: propLike || 'any' },
      source: 'Morton & Hearle, Physical Properties of Textile Fibres, 4th edn (2008)',
      measurements: measurements.map(r => ({
        fibre: r.name, slug: r.slug, property: r.property,
        value: span(r), unit: r.unit, condition: r.condition,
        page: r.page, pdf_page: r.page + 19, table: r.table_ref, note: r.note,
        score: Number(r.score),
      })),
      fibres: fibres.map(r => ({
        slug: r.slug, name: r.name, generic_class: r.generic_class,
        origin: r.origin, polymer: r.polymer,
        page: r.page, pdf_page: r.page + 19, score: Number(r.score),
      })),
      lessons: lessons.map(r => ({
        chapter: r.chapter_no, chapter_title: r.chapter_title,
        section: r.section_no, title: r.title,
        page_start: r.page_start, page_end: r.page_end,
        pdf_page: r.pdf_page_start, chars: r.char_count,
        snippet: r.snippet, score: Number(r.score),
      })),
    });
  } catch (err) {
    console.error('[Search] fibre failed:', err.message);
    res.json({ success: true, query: q, measurements: [], fibres: [], lessons: [], degraded: true });
  }
});

module.exports = router;
