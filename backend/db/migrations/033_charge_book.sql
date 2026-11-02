-- ============================================================================
-- 033 — Charge book: knitting & dyeing charges, per vendor
--
-- The factory's charge sheet (knitting above/below 30s, dyeing one-part and
-- two-part by shade) is the price the costing is built on. It lives here, not
-- in code, so a price change, a new fabric or a second dyehouse is a row, not a
-- deploy. Read once into an in-memory snapshot (engine/domain/charge-book.js);
-- an admin write reloads it.
--
--   charge_vendors   who quotes (the factory's own sheet, an outside knitter or
--                    dyehouse). A vendor may be DERIVED from another at ±%, so a
--                    new quote is one line, not 346 rows.
--   charge_items     a priced thing: a fabric group + variant (e.g. "RIB 2 x 2
--                    Viscose — Elastane Half Feeder"). New fabrics = new items.
--   charge_rates     one row per vendor × item: the 12 prices.
--   charge_history   every change, with who and why.
--   charge_gaps      what the engine asked for and the book could not answer —
--                    the to-do list that keeps the book complete.
-- A NULL price means "not offered" (the sheet's 0.00), never zero.
-- ============================================================================
CREATE TABLE IF NOT EXISTS charge_vendors (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'vendor',        -- own | knitter | dyehouse | vendor
  currency      TEXT NOT NULL DEFAULT 'USD',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  derived_from  TEXT REFERENCES charge_vendors(code) ON DELETE SET NULL,
  adjust_pct    NUMERIC(7,3) NOT NULL DEFAULT 0,
  valid_from    DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS charge_vendors_one_default ON charge_vendors (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS charge_items (
  item_key    TEXT PRIMARY KEY,
  group_name  TEXT NOT NULL,
  variant     TEXT NOT NULL DEFAULT '',
  label       TEXT NOT NULL,
  elastane    TEXT,                                     -- ff | hf | null
  stripe      TEXT,                                     -- engineering | feeder | null
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charge_items_group ON charge_items (group_name);

CREATE TABLE IF NOT EXISTS charge_rates (
  vendor_code        TEXT NOT NULL REFERENCES charge_vendors(code) ON DELETE CASCADE,
  item_key           TEXT NOT NULL REFERENCES charge_items(item_key) ON DELETE CASCADE,
  knit_above30       NUMERIC(8,3),
  knit_below30       NUMERIC(8,3),
  dye1_black         NUMERIC(8,3), dye1_dark_navy NUMERIC(8,3), dye1_light_medium NUMERIC(8,3),
  dye1_neon          NUMERIC(8,3), dye1_white_melange NUMERIC(8,3),
  dye2_black         NUMERIC(8,3), dye2_dark_navy NUMERIC(8,3), dye2_light_medium NUMERIC(8,3),
  dye2_neon          NUMERIC(8,3), dye2_white_melange NUMERIC(8,3),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         TEXT,
  PRIMARY KEY (vendor_code, item_key)
);

CREATE TABLE IF NOT EXISTS charge_history (
  id          BIGSERIAL PRIMARY KEY,
  vendor_code TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  field       TEXT NOT NULL,
  old_value   NUMERIC(8,3),
  new_value   NUMERIC(8,3),
  note        TEXT,
  changed_by  TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charge_history_item ON charge_history (item_key, changed_at DESC);

CREATE TABLE IF NOT EXISTS charge_gaps (
  id          BIGSERIAL PRIMARY KEY,
  gap_key     TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,                             -- no_group | no_variant | no_price | no_vendor_item
  fabric_id   TEXT,
  group_name  TEXT,
  variant     TEXT,
  detail      TEXT,
  hits        INTEGER NOT NULL DEFAULT 1,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved    BOOLEAN NOT NULL DEFAULT FALSE
);
