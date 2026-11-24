-- ============================================================================
-- 048 — Garment presets: a spec the user keeps
--
-- A garment spec (the sizes and measurement chart, tolerances, fabric, seams, zipper, trims and the spec sheet it was read from) saved under a name, to start
-- the Garment studio from. Private to the account; deleting the account deletes them.
-- ============================================================================

CREATE TABLE garment_presets (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  style       text NOT NULL DEFAULT 'tee',
  note        text,
  preset      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_garment_presets_user_name ON garment_presets (user_id, lower(name));
CREATE INDEX idx_garment_presets_user ON garment_presets (user_id, updated_at DESC);
