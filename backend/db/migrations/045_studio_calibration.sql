-- ============================================================================
-- 045 — Calibration measurements: what a mill measures on one cloth
--
-- Relaxed dimensions in each state, force at fixed strains in both directions,
-- recovery and thickness (engine/domain/calibration-intake.js), saved with the
-- design as analysed and what the Studio predicted for it at that moment, so a
-- later fit (relaxation ratios, the yarn model's friction) can rebuild both.
-- Private to the account; deleting the account deletes the records.
-- ============================================================================

CREATE TABLE studio_calibration (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  design_name text,
  group_key   text NOT NULL,
  structure   text,
  design      jsonb NOT NULL,
  predicted   jsonb NOT NULL,
  measured    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_studio_calibration_user ON studio_calibration (user_id, created_at DESC);
