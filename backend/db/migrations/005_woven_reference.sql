-- ============================================================================
-- 005 — Woven reference data
--
-- Source: N. Gokarneshan, "Fabric Structure and Design", New Age International
-- (2005), ISBN 978-81-224-2307-5. Page numbers stored below are the BOOK's
-- printed pages; the PDF page is the book page + 13.
--
-- WHY THIS IS A SEPARATE SET OF TABLES, NOT ROWS IN `fabrics`
-- ----------------------------------------------------------
-- `fabrics` holds knitted structures. Every column on it — data_bucket,
-- gsm_range, gauge_range, ll_multiplier, the count regression — describes a
-- loop-formed cloth, and the joins off it (factory_records, calibration) carry
-- loop-length measurements. A woven cloth has none of those properties: it has
-- no gauge, no stitch length, no tightness factor. Forcing plain weave into
-- that table would mean a row where most columns are NULL and the few that are
-- populated mean something different from every other row.
--
-- So the woven catalogue lives beside the knit one rather than inside it. The
-- calculation engine does not read these tables at all — calculate() is still
-- knit-only, still synchronous, still fed by the frozen boot snapshot. What
-- these tables give the system is a reference and search surface for a domain
-- it previously had nothing in.
--
-- PROVENANCE
-- ----------
-- Every row carries `page`. Nothing was imported that could not be checked:
-- scripts/verify-woven-rules.js re-derives the book's satin move-number table
-- from its own stated rules, recomputes each worked example, and reproduces the
-- colour-and-weave figures, before any of this is written.
-- ============================================================================


-- ============================================================================
-- WEAVE STRUCTURES
-- ============================================================================

-- The 22 weave structures the book describes, one row per structure. Detail
-- that varies by weave family (characteristics, construction methods, wadding
-- rules) is kept in `payload` rather than in columns nothing else would use.
CREATE TABLE woven_weaves (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  family          text NOT NULL,
  loom_equipment  text,
  draft           text,
  repeat_ends     smallint,
  repeat_picks    smallint,
  end_uses        text[],
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  page            smallint NOT NULL,
  source          text NOT NULL DEFAULT 'BOOK_GOKARNESHAN_2005',
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT woven_weaves_page_in_book CHECK (page BETWEEN 1 AND 139),
  CONSTRAINT woven_weaves_repeat_sane  CHECK (
    (repeat_ends IS NULL OR repeat_ends BETWEEN 1 AND 64) AND
    (repeat_picks IS NULL OR repeat_picks BETWEEN 1 AND 64))
);

CREATE INDEX woven_weaves_family_idx ON woven_weaves (family);
CREATE INDEX woven_weaves_name_trgm  ON woven_weaves USING gin (name gin_trgm_ops);

CREATE TRIGGER woven_weaves_touch BEFORE UPDATE ON woven_weaves
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- CONSTRUCTIONAL PARTICULARS
-- ============================================================================

-- The measured cloth specifications the book prints: Appendix II's comparative
-- table plus the richer per-chapter "standard quality particulars", which carry
-- crimp, tuft density and pile height that the appendix omits.
--
-- Counts stay TEXT. The book writes them as the trade does — "2/14s & 36s",
-- "60 tex two fold", "2/20s - 2/30s" — and parsing those into a number would
-- either lose the fold and the range or invent precision the source never had.
-- The engine's own count conversion works on Ne and is not applied here.
--
-- Densities are stored as min/max where the book gives a range and as a single
-- value where it gives one; a range is NOT collapsed to its midpoint, because a
-- midpoint is a number nobody measured.
CREATE TABLE woven_constructions (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cloth               text NOT NULL,
  weave_slug          text NOT NULL REFERENCES woven_weaves (slug) ON UPDATE CASCADE,
  ends_per_inch       numeric(7,2),
  ends_per_inch_max   numeric(7,2),
  picks_per_inch      numeric(7,2),
  picks_per_inch_max  numeric(7,2),
  picks_per_cm        numeric(7,2),
  warp_count          text,
  weft_count          text,
  material            text,
  measurements        jsonb NOT NULL DEFAULT '{}'::jsonb,
  page                smallint NOT NULL,
  source_table        text,
  source              text NOT NULL DEFAULT 'BOOK_GOKARNESHAN_2005',
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT woven_constructions_unique UNIQUE (cloth, page),
  CONSTRAINT woven_constructions_page_in_book CHECK (page BETWEEN 1 AND 139),

  -- The failure mode that put 143148 and 264256 into factory_records was two
  -- readings concatenated by a bad parse. The highest density this book prints
  -- is 520 picks/inch (twill back velveteen, p.77, and it says so explicitly),
  -- so anything past 600 is a parse artefact, not a cloth.
  CONSTRAINT woven_constructions_density_physical CHECK (
    (ends_per_inch      IS NULL OR ends_per_inch      BETWEEN 1 AND 600) AND
    (ends_per_inch_max  IS NULL OR ends_per_inch_max  BETWEEN 1 AND 600) AND
    (picks_per_inch     IS NULL OR picks_per_inch     BETWEEN 1 AND 600) AND
    (picks_per_inch_max IS NULL OR picks_per_inch_max BETWEEN 1 AND 600) AND
    (picks_per_cm       IS NULL OR picks_per_cm       BETWEEN 1 AND 250)),

  -- A max below its min is a transcription error, not a range.
  CONSTRAINT woven_constructions_range_ordered CHECK (
    (ends_per_inch_max  IS NULL OR ends_per_inch  IS NULL OR ends_per_inch_max  >= ends_per_inch) AND
    (picks_per_inch_max IS NULL OR picks_per_inch IS NULL OR picks_per_inch_max >= picks_per_inch))
);

CREATE INDEX woven_constructions_weave_idx ON woven_constructions (weave_slug);
CREATE INDEX woven_constructions_cloth_trgm ON woven_constructions USING gin (cloth gin_trgm_ops);

CREATE TRIGGER woven_constructions_touch BEFORE UPDATE ON woven_constructions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- STRUCTURAL RULES
-- ============================================================================

-- The relations that are actually computable: satin move numbers, the broken
-- twill skip N/2-1, the Brighton float, the twill-angle bands, the pile and
-- shrinkage limits. These are stored so they are queryable and auditable, but
-- the executable copies live in engine/formulas/woven.js — for the same reason
-- the knit formulas do. A relation in a database makes an outage change the
-- answer instead of merely delaying it.
CREATE TABLE woven_rules (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         text NOT NULL UNIQUE,
  payload     jsonb NOT NULL,
  page        smallint NOT NULL,
  verified    boolean NOT NULL DEFAULT false,
  source      text NOT NULL DEFAULT 'BOOK_GOKARNESHAN_2005',
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT woven_rules_page_in_book CHECK (page BETWEEN 1 AND 139)
);

COMMENT ON COLUMN woven_rules.verified IS
  'true when scripts/verify-woven-rules.js reproduces this rule from the book''s own worked example or printed table, rather than only transcribing it.';

CREATE TRIGGER woven_rules_touch BEFORE UPDATE ON woven_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- COLOUR AND WEAVE EFFECTS
-- ============================================================================

-- Chapter 15's named effects. Each is a triple of (weave, warping order,
-- wefting order) that the book says produces a particular visual result, and
-- engine/formulas/woven.js can render each one to check that it does.
CREATE TABLE woven_colour_effects (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  weave           text NOT NULL,
  warping_order   text NOT NULL,
  wefting_order   text NOT NULL,
  description     text,
  reproduced      boolean NOT NULL DEFAULT false,
  note            text,
  page            smallint NOT NULL,
  source          text NOT NULL DEFAULT 'BOOK_GOKARNESHAN_2005',
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT woven_colour_effects_page_in_book CHECK (page BETWEEN 1 AND 139)
);

COMMENT ON COLUMN woven_colour_effects.note IS
  'Where the book''s text and its figure disagree, what the discrepancy is and which one reproduces the named effect.';

CREATE TRIGGER woven_colour_effects_touch BEFORE UPDATE ON woven_colour_effects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- GLOSSARY
-- ============================================================================

-- 73 fabric terms. Trigram indexed on the term because the point of a glossary
-- is that someone half-remembers the word — "gaberdine", "gabardine",
-- "gabardeen" should all reach the same row.
CREATE TABLE woven_glossary (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  term        text NOT NULL UNIQUE,
  definition  text NOT NULL,
  page        smallint NOT NULL,
  source      text NOT NULL DEFAULT 'BOOK_GOKARNESHAN_2005',
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT woven_glossary_page_in_book CHECK (page BETWEEN 1 AND 139)
);

CREATE INDEX woven_glossary_term_trgm ON woven_glossary USING gin (term gin_trgm_ops);
CREATE INDEX woven_glossary_def_trgm  ON woven_glossary USING gin (definition gin_trgm_ops);

CREATE TRIGGER woven_glossary_touch BEFORE UPDATE ON woven_glossary
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- SOURCE REGISTRY
-- ============================================================================

-- The 27 PDF_VERIFIED values already in the engine cite files that are not in
-- the repository, so nobody can re-check them today. This table exists so that
-- does not happen again: every book-derived row above names a source, and the
-- source itself is described here with enough detail to find the exact edition.
CREATE TABLE reference_sources (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key           text NOT NULL UNIQUE,
  title         text NOT NULL,
  author        text,
  publisher     text,
  year          smallint,
  identifier    text,
  domain        text NOT NULL,
  page_offset   smallint NOT NULL DEFAULT 0,
  scope_note    text,
  archived_at   text,
  added_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reference_sources_domain CHECK (domain IN ('woven', 'weft_knit', 'warp_knit', 'yarn', 'colour', 'finishing', 'mixed'))
);

COMMENT ON COLUMN reference_sources.page_offset IS
  'PDF page minus book page. Add this to a stored `page` to find it in the scanned file.';
COMMENT ON COLUMN reference_sources.scope_note IS
  'What the source does NOT cover, so a later reader does not go looking in it for something that was never there.';
COMMENT ON COLUMN reference_sources.archived_at IS
  'Where the source file itself is kept. NULL means the citation cannot currently be re-checked.';
