-- ============================================================================
-- 046 — Emerging Textiles dashboard
--
-- The subscription's API key is entered on the admin dashboard, not in a file: it is kept sealed (AES-256-GCM, the key from
-- API_KEY_ENCRYPTION_SECRET) and only its last four characters are ever shown. The tables the subscription exposes are listed
-- in et_tables (what each one is, where it sits on the publisher's menu, whether it feeds costing) and the latest copy of each
-- is kept in et_snapshots so the dashboard shows the whole table, not just the one price costing reads.
-- ============================================================================

CREATE TABLE et_settings (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  api_key_sealed text,
  key_last4      text,
  base_url       text,
  saved_at       timestamptz,
  tested_at      timestamptz,
  test_ok        boolean,
  test_note      text
);
INSERT INTO et_settings (id) VALUES (1);

CREATE TABLE et_tables (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  catalogue_id   text,                      -- the slot on the publisher's menu this table fills (engine/catalog/et-catalogue.js), or null for a table added by hand
  category       text NOT NULL,             -- cotton | polyester | viscose | nylon | wool | apparel
  title          text NOT NULL,
  dataset        text NOT NULL,
  sheet          text NOT NULL,
  country        text,
  mapping        jsonb,                     -- { item_key, count_ne } or { columns: [{ column, item_key, count_ne }] }: present = feeds costing
  enabled        boolean NOT NULL DEFAULT true,
  added_at       timestamptz NOT NULL DEFAULT now(),
  last_fetched_at timestamptz,
  last_ok        boolean,
  last_error     text,
  UNIQUE (dataset, sheet)
);
CREATE INDEX et_tables_category ON et_tables (category);

CREATE TABLE et_snapshots (
  table_id    integer PRIMARY KEY REFERENCES et_tables(id) ON DELETE CASCADE,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  header      jsonb NOT NULL,
  rows        jsonb NOT NULL,
  row_count   integer NOT NULL
);
