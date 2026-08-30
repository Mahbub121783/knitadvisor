-- ============================================================================
-- 006 — Fibre physical properties
--
-- Source: W. E. Morton and J. W. S. Hearle, "Physical Properties of Textile
-- Fibres", 4th edition, Woodhead Publishing (2008), ISBN 978-1-84569-220-9.
-- 765 PDF pages. Page numbers stored below are the BOOK's printed pages; the
-- PDF page is the book page + 19 for the body. (The front matter is numbered
-- in roman and the offset does not apply to it.)
--
-- WHY A PROPERTY-KEYED TABLE AND NOT A COLUMN PER PROPERTY
-- --------------------------------------------------------
-- The obvious schema is one row per fibre with columns for density, regain,
-- tenacity and so on. That is what the engine has today — FIBER_PROPERTIES in
-- yarn-engine.js, ten fibres wide and three properties deep — and it is why
-- this migration exists. The book measures around forty distinct quantities
-- across twenty-five chapters, so a column-per-property table would need
-- altering for every chapter read, and every value that is a range, or a curve,
-- or measured under two different humidities, would have nowhere to go.
--
-- More importantly, the hard-coded table cannot say what it does not know.
-- Table 5.1 of this book gives cotton as 1.55 g/cm3 dry and 1.52 at 65% r.h.;
-- viscose as 1.52 dry and 1.49 at 65%. The engine stores 1.52 for both — the
-- 65% figure for cotton and the DRY figure for viscose, with nothing on either
-- row to say which condition it came from. Two values that look alike, mean
-- different things, and cannot be told apart. A condition is not metadata about
-- a measurement; it is part of the measurement, so it gets its own columns.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- calculate() does not read these tables. It is still synchronous, still fed by
-- the boot-time frozen snapshot, and still knit-only. This is a reference layer:
-- it is where a value's provenance lives so the constants in code can be
-- checked against it and corrected deliberately, not a new runtime dependency
-- in the middle of a deterministic calculation.
--
-- PROVENANCE
-- ----------
-- Every measured row carries the page it was read from and the reference
-- numbers the book itself cites. `quality` says how it was obtained — read out
-- of a printed table, read out of running text, or derived — because those are
-- not equally trustworthy and a reader should not have to guess which is which.
-- ============================================================================


-- ============================================================================
-- SOURCE REGISTRY — widen it for a domain it did not anticipate
-- ============================================================================

-- 005 constrained `domain` to the surfaces that existed then. Fibre physics
-- sits under all of them: the same regain figure bears on a knitted GSM, a
-- woven crimp and a dyehouse liquor ratio.
ALTER TABLE reference_sources DROP CONSTRAINT IF EXISTS reference_sources_domain;
ALTER TABLE reference_sources ADD CONSTRAINT reference_sources_domain
  CHECK (domain IN ('woven', 'weft_knit', 'warp_knit', 'yarn', 'fibre',
                    'colour', 'finishing', 'mixed'));


-- ============================================================================
-- FIBRE IDENTITY
-- ============================================================================

-- One row per fibre the book treats. Kept separate from `fibre_properties` so
-- that naming — which is a mess in this industry, where "rayon", "viscose" and
-- "viscose rayon" are the same thing and "acetate" is not — is settled once
-- instead of at every measurement.
CREATE TABLE fibres (
  slug           text PRIMARY KEY,
  name           text NOT NULL,
  name_bn        text,
  -- The book's own grouping: almost the whole general textile market is met by
  -- six polymer types (p.4), with the high-performance and specialist fibres
  -- treated separately.
  generic_class  text NOT NULL,
  origin         text NOT NULL,
  polymer        text,
  aliases        text[] NOT NULL DEFAULT '{}',
  -- Set where an engine constant already exists for this fibre, so the two can
  -- be compared. NULL means the engine has never had a value for it.
  engine_key     text,
  page           smallint,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fibres_origin CHECK (origin IN ('natural', 'regenerated', 'synthetic', 'inorganic')),
  CONSTRAINT fibres_class CHECK (generic_class IN (
    'cellulose', 'protein', 'polyamide', 'polyester', 'polyolefin', 'vinyl',
    'elastomer', 'carbon', 'inorganic', 'high_performance', 'other')),
  CONSTRAINT fibres_page_in_book CHECK (page IS NULL OR page BETWEEN 1 AND 746)
);

CREATE INDEX fibres_class_idx ON fibres (generic_class);
CREATE INDEX fibres_name_trgm ON fibres USING gin (name gin_trgm_ops);


-- ============================================================================
-- MEASURED PROPERTIES
-- ============================================================================

-- One row per (fibre, property, condition). The condition columns are typed
-- rather than folded into a text note, because "density at 65% r.h." is a
-- question the system needs to answer by query, not by reading prose.
--
-- A value may be a single figure, a range, or both — the book prints "1.14" for
-- nylon and "5-50%" for the breaking extension of textile fibres generally, and
-- flattening a range to its midpoint would invent a precision the book does not
-- claim.
CREATE TABLE fibre_properties (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fibre_slug     text NOT NULL REFERENCES fibres(slug) ON DELETE CASCADE,
  property       text NOT NULL,
  value          numeric(12,4),
  value_min      numeric(12,4),
  value_max      numeric(12,4),
  unit           text NOT NULL,

  -- Measurement conditions. NULL means the book did not state one, which is
  -- itself worth recording: it is the difference between "measured dry" and
  -- "condition unknown".
  condition      text,
  temperature_c  numeric(6,2),
  rh_pct         numeric(5,2),
  method         text,

  -- Where it came from and how far to trust it.
  source_key     text NOT NULL REFERENCES reference_sources(key),
  page           smallint NOT NULL,
  table_ref      text,
  book_refs      text,
  quality        text NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- The same fibre and property may be measured at several conditions, but not
  -- twice at the same one from the same page.
  CONSTRAINT fibre_properties_unique
    UNIQUE (fibre_slug, property, condition, page),

  CONSTRAINT fibre_properties_quality CHECK (quality IN (
    'BOOK_TABLE',     -- read out of a printed table
    'BOOK_TEXT',      -- stated in running text
    'BOOK_FIGURE',    -- read off a plotted figure, so approximate
    'DERIVED')),      -- computed here from other stored values

  -- A row has to say something: a point value, a range, or both.
  CONSTRAINT fibre_properties_has_value CHECK (
    value IS NOT NULL OR (value_min IS NOT NULL AND value_max IS NOT NULL)),
  CONSTRAINT fibre_properties_range_ordered CHECK (
    value_min IS NULL OR value_max IS NULL OR value_min <= value_max),

  CONSTRAINT fibre_properties_rh_physical CHECK (
    rh_pct IS NULL OR rh_pct BETWEEN 0 AND 100),
  -- Liquid nitrogen to well past any fibre's decomposition point. Wide on
  -- purpose: this is here to catch a units slip, not to second-guess the book.
  CONSTRAINT fibre_properties_temp_physical CHECK (
    temperature_c IS NULL OR temperature_c BETWEEN -200 AND 1200),
  CONSTRAINT fibre_properties_page_in_book CHECK (page BETWEEN 1 AND 746),

  -- Physical sanity per property, in the units this table stores. The factory
  -- import taught that a bad value is far cheaper to reject at write time than
  -- to find later in a calculation: no textile fibre is lighter than expanded
  -- foam or denser than steel, and a regain over 100% would mean the water
  -- outweighs the fibre.
  CONSTRAINT fibre_properties_physical CHECK (
    CASE property
      WHEN 'density'           THEN coalesce(value, value_min) BETWEEN 0.5 AND 8.0
      WHEN 'specific_volume'   THEN coalesce(value, value_min) BETWEEN 0.1 AND 2.5
      WHEN 'moisture_regain'   THEN coalesce(value, value_min) BETWEEN 0 AND 100
      WHEN 'moisture_content'  THEN coalesce(value, value_max) BETWEEN 0 AND 100
      WHEN 'breaking_extension' THEN coalesce(value, value_max) BETWEEN 0 AND 1000
      ELSE true
    END)
);

CREATE INDEX fibre_properties_lookup ON fibre_properties (fibre_slug, property);
CREATE INDEX fibre_properties_property ON fibre_properties (property);
CREATE INDEX fibre_properties_page ON fibre_properties (source_key, page);

COMMENT ON COLUMN fibre_properties.book_refs IS
  'The reference numbers the book itself cites for this value, e.g. "[4, 9-11]". A value the book took from elsewhere is one indirection further from measurement, and the reader should be able to see that.';
COMMENT ON COLUMN fibre_properties.condition IS
  'The condition as the book words it ("dry", "65% r.h."). The typed columns beside it carry the same thing in a queryable form; both are kept because the book wording is the citation.';


-- ============================================================================
-- PROPERTY CURVES
-- ============================================================================

-- Several of the properties that matter most are not numbers at all. Moisture
-- regain is a curve against relative humidity, and it does not even retrace
-- itself: the absorption and desorption branches differ, which is the hysteresis
-- the book spends chapter 7 on. Storing "cotton = 7.5%" throws away everything
-- except one point on one branch — and that single figure is what the engine
-- uses today to weigh a garment.
CREATE TABLE fibre_property_curves (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fibre_slug     text NOT NULL REFERENCES fibres(slug) ON DELETE CASCADE,
  property       text NOT NULL,
  x_name         text NOT NULL,
  x_unit         text NOT NULL,
  y_unit         text NOT NULL,
  branch         text,
  condition      text,
  temperature_c  numeric(6,2),
  source_key     text NOT NULL REFERENCES reference_sources(key),
  page           smallint NOT NULL,
  figure_ref     text,
  quality        text NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fibre_curves_unique UNIQUE (fibre_slug, property, branch, page),
  CONSTRAINT fibre_curves_branch CHECK (
    branch IS NULL OR branch IN ('absorption', 'desorption', 'mean', 'single')),
  CONSTRAINT fibre_curves_quality CHECK (quality IN ('BOOK_TABLE', 'BOOK_FIGURE', 'DERIVED')),
  CONSTRAINT fibre_curves_page_in_book CHECK (page BETWEEN 1 AND 746)
);

CREATE TABLE fibre_curve_points (
  curve_id  bigint NOT NULL REFERENCES fibre_property_curves(id) ON DELETE CASCADE,
  x         numeric(12,4) NOT NULL,
  y         numeric(12,4) NOT NULL,
  PRIMARY KEY (curve_id, x)
);

COMMENT ON TABLE fibre_curve_points IS
  'Points are stored rather than a fitted equation. A fit is an interpretation; the points are what was published, and any fit can be recomputed from them.';


-- ============================================================================
-- LESSONS — the book itself, section by section
-- ============================================================================

-- The reason for keeping the prose and not only the numbers: most of this book
-- is not tables. It is the reasoning that says which measurement applies when,
-- and a stored figure without it invites exactly the mistake this migration
-- opens by describing — using a dry density where a conditioned one belongs.
--
-- One row per entry in the book's own table of contents, so the division is the
-- author's rather than one invented here. `body` is the extracted text of that
-- section, kept verbatim.
CREATE TABLE fibre_lessons (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_key      text NOT NULL REFERENCES reference_sources(key),
  chapter_no      smallint,
  chapter_title   text,
  section_no      text,
  title           text NOT NULL,
  level           smallint NOT NULL,
  pdf_page_start  smallint NOT NULL,
  pdf_page_end    smallint NOT NULL,
  page_start      smallint,
  page_end        smallint,
  body            text NOT NULL,
  char_count      integer NOT NULL,
  -- Characters the PDF text layer could not decode, almost all of them from
  -- the maths font. They cluster in the sections that carry equations, which
  -- is where a missing glyph changes the meaning and not just the look, so the
  -- count is stored per lesson: a reader seeing a high number here knows to
  -- open the page image rather than trust the text below.
  symbol_loss     smallint NOT NULL DEFAULT 0,
  -- What the text layer gave up. A section whose pages are mostly figures is
  -- recorded as such rather than being silently short.
  extraction      text NOT NULL,
  figure_pages    smallint[] NOT NULL DEFAULT '{}',
  search          tsvector GENERATED ALWAYS AS (
                    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
                  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fibre_lessons_unique UNIQUE (source_key, pdf_page_start, title),
  CONSTRAINT fibre_lessons_pages_ordered CHECK (pdf_page_end >= pdf_page_start),
  -- CONTAINER is not a defect: a heading with subsections beneath it holds
  -- only its own title, and lumping those in with SPARSE would bury the real
  -- extraction failures among 84 sections that were never going to have a body.
  -- TABLE is a floated table lifted out of the prose. A table is anchored to
  -- the foot of a page rather than to its own section — Table 5.1 sits below
  -- the opening paragraph of 5.4 while the section that cites it is 5.3 — so
  -- position cannot assign it and it is kept under its own caption instead.
  CONSTRAINT fibre_lessons_extraction CHECK (extraction IN ('CLEAN', 'SPARSE', 'FIGURE_HEAVY', 'CONTAINER', 'TABLE')),
  CONSTRAINT fibre_lessons_level CHECK (level BETWEEN 1 AND 4)
);

CREATE INDEX fibre_lessons_search_idx ON fibre_lessons USING gin (search);
CREATE INDEX fibre_lessons_title_trgm ON fibre_lessons USING gin (title gin_trgm_ops);
CREATE INDEX fibre_lessons_chapter_idx ON fibre_lessons (source_key, chapter_no, section_no);


-- ============================================================================
-- TOUCH TRIGGERS
-- ============================================================================
CREATE TRIGGER fibres_touch BEFORE UPDATE ON fibres
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fibre_properties_touch BEFORE UPDATE ON fibre_properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fibre_lessons_touch BEFORE UPDATE ON fibre_lessons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- THE SOURCE ITSELF
-- ============================================================================
INSERT INTO reference_sources (key, title, author, publisher, year, identifier,
                               domain, page_offset, scope_note, archived_at)
VALUES (
  'morton_hearle_2008',
  'Physical Properties of Textile Fibres',
  'W. E. Morton and J. W. S. Hearle',
  'Woodhead Publishing',
  2008,
  'ISBN 978-1-84569-220-9 (4th edition)',
  'fibre',
  19,
  'Fibre properties only. The authors say so themselves in the first preface: it was conceived as the first of a trilogy and the companion volumes on yarns and fabrics were never written. So it carries nothing on yarn structure, knit loop geometry or fabric construction — do not go looking here for the Munden constants or a K/T/M grid. Within fibres it is thorough: 25 chapters covering fineness, length, density, thermal behaviour, six chapters on moisture, eight on mechanical properties, and chapters on dielectric, electrical, optical and frictional behaviour.',
  -- Deliberately NOT in the repository: .gitignore excludes *.pdf and the file
  -- is 32 MB. So anyone holding only the repo cannot re-open p.165 and check a
  -- density for themselves, and this column has to say so rather than imply a
  -- file that is not there. What the repo does carry is the full extracted text
  -- in fibre_lessons, which is the next best thing and is where the checks in
  -- scripts/import-fibre-lessons.js do their work.
  'NOT IN REPO — local file "Physical properties of textile fibres.pdf" (765 pp, 32 MB) in the working directory. Extracted text is in fibre_lessons.'
)
ON CONFLICT (key) DO NOTHING;
