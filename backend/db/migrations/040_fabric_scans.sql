-- ============================================================================
-- 040 — Fabric scans
--
-- A phone photographs a swatch under the scan card; the loops are counted on
-- the phone, the knitting spec is worked out here. Each scan is kept for its
-- account (measurements and result, a small flattened thumbnail, never the
-- original photo). A pair links a phone to a signed-in screen for a short
-- while, so a scan shows on the big screen without signing in on the phone.
-- ============================================================================

CREATE TABLE fabric_scans (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  structure   text NOT NULL,
  result      jsonb NOT NULL,
  thumb       text,
  via_pair    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fabric_scans_user ON fabric_scans (user_id, created_at DESC);

CREATE TABLE scan_pairs (
  code        text PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  last_scan   integer REFERENCES fabric_scans(id) ON DELETE SET NULL,
  scans       integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_scan_pairs_user ON scan_pairs (user_id, created_at DESC);
