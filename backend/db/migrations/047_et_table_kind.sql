-- ============================================================================
-- 047 — Emerging Textiles: which form of the API a table is read through
--
-- The publisher gives each subscriber their own endpoints (there is no listing of them): by email on activation, and as an
-- API / Excel link on each table. Two forms exist: /api/sheets/{dataset}/{sheet} (JSON, key in the X-API-Key header) and
-- /api/csv/{dataset}/{sheet} (CSV, key as a query parameter). A pasted link keeps the form it came in.
-- ============================================================================

ALTER TABLE et_tables ADD COLUMN kind text NOT NULL DEFAULT 'sheets' CHECK (kind IN ('sheets', 'csv'));
