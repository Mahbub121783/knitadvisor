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

module.exports = router;
