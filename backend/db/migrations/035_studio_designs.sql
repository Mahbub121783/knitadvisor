-- ============================================================================
-- 035 — Fabric Studio designs, kept per account
--
-- A design drawn in the Fabric Studio (the K/T/M/- programme for cylinder and
-- dial, the yarn on every feeder, the target and the machine, and the trial
-- rolls the mill measured for it) used to live in one browser's localStorage:
-- one device, gone with the site data. The rolls are the valuable part — they
-- are the mill's own cloth, and they turn an estimate into a verified figure —
-- so they must survive a new laptop.
--
-- The design is stored as the page wrote it (jsonb), not split into columns:
-- the page is the only writer and reader, and the shape will keep growing.
-- Private to the account (an R&D design is the factory's know-how); sharing is
-- the exported file. One name per account, case-insensitive: saving under an
-- existing name replaces it.
-- ============================================================================

CREATE TABLE studio_designs (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  design      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_studio_designs_name ON studio_designs (user_id, lower(name));
CREATE INDEX idx_studio_designs_recent ON studio_designs (user_id, updated_at DESC);
