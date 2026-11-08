-- ============================================================================
-- 038 — Garment cost sheets, kept per account
--
-- A buyer quotation (sizes, fabric shells with their prices and sources, trims,
-- embellishment, wash, CM, packaging, mark-ups, the picture) is the factory's
-- commercial working: private to the account, one name per account (saving
-- under a name replaces it), stored as the page writes it. A sheet keeps its
-- last 10 versions so a revised quote can be compared with the one sent.
-- ============================================================================

CREATE TABLE cost_sheets (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sheet       jsonb NOT NULL,
  versions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_cost_sheets_name ON cost_sheets (user_id, lower(name));
CREATE INDEX idx_cost_sheets_recent ON cost_sheets (user_id, updated_at DESC);
