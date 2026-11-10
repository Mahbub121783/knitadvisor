-- ============================================================================
-- 043 — Floor machines and their logged rolls: the Studio learns each machine
--
-- A mill names its machines (gauge, diameter) and logs every roll it knits and
-- measures against one: the settings (count, stitch length, gauge, diameter),
-- the finished GSM and open width, and — computed by the Studio at the moment
-- the roll is logged — what the Studio predicted for exactly those settings.
-- The ratio measured ÷ predicted is what the Studio learns from (per machine,
-- per structure group; engine/domain/machine-learning.js), so each machine's
-- predictions move towards what it actually makes, and say how many rolls
-- support them.
--
-- Private to the account (a mill's machine performance is its know-how).
-- Removing a machine removes its rolls.
-- ============================================================================

CREATE TABLE studio_floor_machines (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('single', 'rib', 'interlock')),
  gauge       integer CHECK (gauge BETWEEN 5 AND 50),
  dia         numeric(5,1) CHECK (dia BETWEEN 8 AND 60),
  feeders     integer CHECK (feeders BETWEEN 1 AND 400),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_studio_floor_machines_name ON studio_floor_machines (user_id, lower(name));

CREATE TABLE studio_floor_rolls (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  machine_id   integer NOT NULL REFERENCES studio_floor_machines(id) ON DELETE CASCADE,
  group_key    text NOT NULL,                 -- the structure group the Studio weighed it in
  structure    text,                          -- the catalogue fabric it matched, or 'new'
  design_name  text,
  ne           numeric(6,2),
  sl_mm        numeric(5,3) NOT NULL,
  gauge        integer,
  dia          numeric(5,1),
  shade        text,
  gsm          numeric(6,1) NOT NULL,         -- measured, finished
  width_in     numeric(5,1),                  -- measured, finished open width
  gsm_model    numeric(6,1) NOT NULL,         -- the Studio's prediction for these settings, when logged
  width_model  numeric(5,1),
  knitted_on   date,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_studio_floor_rolls_machine ON studio_floor_rolls (machine_id, created_at);
