-- ============================================================================
-- 008 — A NULL condition must still collide with itself
--
-- 006 gave fibre_properties this:
--
--   CONSTRAINT fibre_properties_unique UNIQUE (fibre_slug, property, condition, page)
--
-- which does not do what it reads like. In a UNIQUE constraint PostgreSQL
-- treats NULLs as distinct from one another, so two rows that are identical
-- except that both have condition IS NULL do not conflict. The importer's
-- ON CONFLICT ... DO UPDATE therefore never fired for them, and every re-run
-- inserted a second copy instead of updating the first.
--
-- It showed up immediately in production: Tables 5.2 and 5.3 state no
-- condition, so all 24 of their fibres carry NULL, and a re-import after a
-- failed first attempt left 121 rows where the file has 108 — 13 duplicates,
-- all of them in the NULL-condition tables.
--
-- NULL is the right value there. The book prints one figure for those fibres
-- and names no humidity, and "unknown" is a different statement from "dry" or
-- from any sentinel string invented to dodge this. So the fix is to index the
-- coalesced value rather than to change what is stored.
--
-- PostgreSQL 15 added UNIQUE NULLS NOT DISTINCT, which would say this directly.
-- This server is on 13, so it is a unique index over an expression instead —
-- the same guarantee, reached the long way round.
-- ============================================================================

-- Keep the most recently written row for each key and drop the rest. `id` is an
-- identity column, so the highest id is the latest write, which is the one the
-- last import intended.
DELETE FROM fibre_properties a
 USING fibre_properties b
 WHERE a.fibre_slug = b.fibre_slug
   AND a.property   = b.property
   AND a.page       = b.page
   AND coalesce(a.condition, '') = coalesce(b.condition, '')
   AND a.id < b.id;

ALTER TABLE fibre_properties DROP CONSTRAINT IF EXISTS fibre_properties_unique;

CREATE UNIQUE INDEX fibre_properties_unique
  ON fibre_properties (fibre_slug, property, (coalesce(condition, '')), page);

COMMENT ON INDEX fibre_properties_unique IS
  'Unique over the coalesced condition, because a plain UNIQUE treats NULLs as distinct and would let an unstated-condition row be inserted again on every import. Upserts must target this expression: ON CONFLICT (fibre_slug, property, (coalesce(condition, '''')), page).';
