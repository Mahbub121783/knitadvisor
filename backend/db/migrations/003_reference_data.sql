-- ============================================================================
-- 003 — Reference data
--
-- Everything the calculation engine READS but never writes: the fabric
-- catalogue, the real factory records, the composition curves, the risk jobs,
-- the colour books, the yarn price matrix, and the calibration constants.
--
-- Why these move into PostgreSQL and the formulas do not
-- ------------------------------------------------------
-- The engine's defining property is that it is deterministic and synchronous:
-- calculate() contains no await, imports nothing that reaches the network, and
-- returns the same answer for the same inputs forever. A formula in a database
-- would destroy that — every calculation would need a round trip, and a
-- database outage would stop the calculator instead of merely stopping the
-- logging. So formulas stay in code, under engine/formulas/.
--
-- Reference DATA is a different thing. It is not logic; it is measurement. It
-- changes when the factory sends a new R&D file or the mill reprices yarn, and
-- those changes should not require a deploy. Putting it here makes it
-- editable, auditable (every table carries source + updated_at), queryable
-- (2,201 records are worth an index), and searchable — the colour books get
-- trigram indexes so a mis-typed shade name still finds its colour.
--
-- The engine still never queries at calculate() time. engine/reference/ loads
-- these tables ONCE at boot into a frozen in-memory snapshot, and falls back to
-- the seed JSON in backend/data/ if the database is unreachable. So the
-- database is the source of truth, and the engine keeps its zero-latency,
-- zero-dependency read path.
-- ============================================================================

-- pg_trgm powers the fuzzy colour/fabric search. It is enabled at the server
-- level by the host; CREATE EXTENSION here is idempotent and a no-op when the
-- extension is already present.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ============================================================================
-- FABRIC CATALOGUE
-- ============================================================================

-- The 60 knittable structures the engine can spec. `data_bucket` is the join
-- onto the real sampled data below: several catalogue fabrics share one bucket
-- because the source R&D file does not distinguish e.g. 1x1 from 2x2 rib.
-- A NULL bucket means "no real samples exist for this fabric" and is only
-- correct for warp knit, which is denier-based and never uses these curves.
CREATE TABLE fabrics (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  name_bn         text,
  category        text NOT NULL,
  data_bucket     text,
  machine_type    text,
  -- Deferrable because derivatives reference their base and the catalogue is
  -- imported in one transaction, not in dependency order.
  base_fabric     text REFERENCES fabrics(id) ON DELETE SET NULL
                    DEFERRABLE INITIALLY DEFERRED,
  gsm_min         numeric(6,1),
  gsm_max         numeric(6,1),
  gauge_min       smallint,
  gauge_max       smallint,
  typical_gauge   smallint,
  ll_multiplier   numeric(6,3),
  ll_source       text,
  count_formula   jsonb NOT NULL DEFAULT '{}'::jsonb,
  structure       jsonb NOT NULL DEFAULT '{}'::jsonb,
  machine_note    text,
  typical_machines text,
  appearance      text,
  machine_speed   text,
  uses            text,
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fabrics_gsm_range_sane
    CHECK (gsm_min IS NULL OR gsm_max IS NULL OR gsm_min < gsm_max),
  CONSTRAINT fabrics_gauge_range_sane
    CHECK (gauge_min IS NULL OR gauge_max IS NULL OR gauge_min <= gauge_max),
  -- Warp knit is the only category allowed to have no sampled bucket. Anything
  -- else with a NULL bucket is the lacoste_double class of bug: it silently
  -- loses its factory reference and falls back to generic tightness limits.
  CONSTRAINT fabrics_bucket_required_for_weft
    CHECK (data_bucket IS NOT NULL OR category = 'warp_knit')
);

CREATE INDEX fabrics_category_idx ON fabrics (category) WHERE is_active;
CREATE INDEX fabrics_bucket_idx   ON fabrics (data_bucket) WHERE is_active;
CREATE INDEX fabrics_name_trgm    ON fabrics USING gin (name gin_trgm_ops);
CREATE INDEX fabrics_name_bn_trgm ON fabrics USING gin (name_bn gin_trgm_ops);

CREATE TRIGGER fabrics_touch BEFORE UPDATE ON fabrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- REAL FACTORY RECORDS
-- ============================================================================

-- 2,201 greige→finish rows from the factory ERP R&D master file. This is the
-- measurement the whole provenance ladder rests on: every FACTORY_EXACT and
-- FACTORY_INTERPOLATED answer traces back to rows here.
CREATE TABLE factory_records (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fab_bucket    text        NOT NULL,
  composition   text        NOT NULL,
  count_ne      numeric(6,2) NOT NULL,
  spin_system   text,
  gauge         smallint,
  dia           numeric(5,1),
  grey_gsm      numeric(6,1) NOT NULL,
  colour_seg    text,
  stitch_len_mm numeric(6,3) NOT NULL,
  finish_dia    numeric(6,1),
  finish_gsm    numeric(6,1),
  source_file   text,
  imported_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT factory_records_count_sane  CHECK (count_ne  BETWEEN 1 AND 200),
  CONSTRAINT factory_records_gsm_sane    CHECK (grey_gsm  BETWEEN 30 AND 1200),
  CONSTRAINT factory_records_sl_sane     CHECK (stitch_len_mm BETWEEN 0.5 AND 20),
  CONSTRAINT factory_records_colour_seg  CHECK (colour_seg IS NULL OR colour_seg IN ('light','medium','dark'))
);

CREATE INDEX factory_records_lookup_idx
  ON factory_records (fab_bucket, composition, grey_gsm);
CREATE INDEX factory_records_gsm_idx
  ON factory_records (grey_gsm);


-- ============================================================================
-- COMPOSITION REFERENCE CURVES
-- ============================================================================

-- factory_records collapsed into the count/SL curve the engine actually reads:
-- one row per (bucket, composition, GSM) with the sample count behind it. This
-- is a derived table — rebuild it from factory_records rather than editing by
-- hand — but it is stored rather than a view because the engine snapshots it at
-- boot and a view would re-aggregate 2,201 rows on every restart.
CREATE TABLE composition_reference (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fab_bucket    text         NOT NULL,
  composition   text         NOT NULL,
  gsm           numeric(6,1) NOT NULL,
  count_ne      numeric(6,2) NOT NULL,
  count_display text,
  gauge         smallint,
  stitch_len_mm numeric(6,3) NOT NULL,
  sample_count  integer      NOT NULL DEFAULT 1,
  updated_at    timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT composition_reference_unique UNIQUE (fab_bucket, composition, gsm),
  CONSTRAINT composition_reference_samples CHECK (sample_count > 0)
);

CREATE INDEX composition_reference_curve_idx
  ON composition_reference (fab_bucket, composition, gsm);

CREATE TRIGGER composition_reference_touch BEFORE UPDATE ON composition_reference
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- RISK ASSESSMENT JOBS
-- ============================================================================

-- 50 real production jobs with their documented risks, special instructions and
-- measured shrinkage. Small and thin, which is why the matcher only surfaces a
-- hit when it is genuinely close.
CREATE TABLE risk_records (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name       text NOT NULL,
  fab_bucket     text NOT NULL,
  composition    text NOT NULL,
  gsm            numeric(6,1),
  payload        jsonb NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX risk_records_match_idx ON risk_records (fab_bucket, composition, gsm);

CREATE TRIGGER risk_records_touch BEFORE UPDATE ON risk_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- COLOUR BOOKS
-- ============================================================================

-- Pantone TCX, SCOTDIC, BROS melange and Archroma in one table, separated by
-- `book`. The trigram index is the point: name search was a plain substring
-- scan, so "navi blu" and "turkoise" returned nothing at all, and even a
-- correct "black" ranked Blackberry Wine (a pink) first because it happened to
-- start with the query. similarity() ranks by how close the whole name is.
CREATE TABLE colour_book (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  book        text NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL,
  hex         char(7) NOT NULL,
  family      text,
  is_popular  boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT colour_book_unique UNIQUE (book, code),
  CONSTRAINT colour_book_hex_shape CHECK (hex ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT colour_book_known CHECK (book IN ('tcx','scotdic','bros','archroma'))
);

CREATE INDEX colour_book_name_trgm ON colour_book USING gin (name gin_trgm_ops);
CREATE INDEX colour_book_code_trgm ON colour_book USING gin (code gin_trgm_ops);
CREATE INDEX colour_book_family_idx ON colour_book (book, family);

CREATE TRIGGER colour_book_touch BEFORE UPDATE ON colour_book
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- YARN PRICES
-- ============================================================================

-- The mill reference price list. This is the table most likely to change
-- without a code change — yarn reprices monthly — which is the clearest single
-- argument for reference data living in the database at all.
CREATE TABLE yarn_prices (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  yarn_type     text NOT NULL,
  count_ne      numeric(5,1) NOT NULL,
  price_usd_kg  numeric(8,3) NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'USD',
  price_list    text NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT yarn_prices_unique UNIQUE (yarn_type, count_ne, effective_from),
  CONSTRAINT yarn_prices_positive CHECK (price_usd_kg > 0)
);

CREATE INDEX yarn_prices_lookup_idx ON yarn_prices (yarn_type, count_ne, effective_from DESC);

CREATE TRIGGER yarn_prices_touch BEFORE UPDATE ON yarn_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- CALIBRATION CONSTANTS
-- ============================================================================

-- Numbers that are neither formula nor measurement but calibration: the
-- tightness-factor bands per family, the GSM→count regression coefficients, the
-- loop-length multipliers and book K constants. They are tuned against the real
-- data (the TF bands are percentiles of factory_records) and re-tuned when the
-- data grows, so they belong beside the data rather than inside the formulas.
CREATE TABLE calibration (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  source      text,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calibration_unique UNIQUE (kind, key),
  CONSTRAINT calibration_known_kind CHECK (kind IN (
    'tightness_limits', 'gsm_count_regression', 'loop_length_multiplier',
    'book_k_constant', 'gsm_count_lookup'
  ))
);

CREATE INDEX calibration_kind_idx ON calibration (kind);

CREATE TRIGGER calibration_touch BEFORE UPDATE ON calibration
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- KNITTING FAULTS
-- ============================================================================

CREATE TABLE knitting_faults (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  category    text,
  payload     jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knitting_faults_name_trgm ON knitting_faults USING gin (name gin_trgm_ops);

CREATE TRIGGER knitting_faults_touch BEFORE UPDATE ON knitting_faults
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- SNAPSHOT FRESHNESS
-- ============================================================================

-- One row per reference table, stamped by the importer. engine/reference/ reads
-- this at boot to log what it loaded, and the admin panel uses it to show
-- whether the running process is serving stale reference data after an import.
CREATE TABLE reference_versions (
  table_name  text PRIMARY KEY,
  row_count   integer NOT NULL,
  checksum    char(64) NOT NULL,
  source      text,
  imported_at timestamptz NOT NULL DEFAULT now()
);
