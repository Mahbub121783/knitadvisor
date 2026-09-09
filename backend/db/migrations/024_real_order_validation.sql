-- ============================================================================
-- 024 — Real-order validation: closing the loop the engine never had
--
-- Every formula in this engine is checked against a textbook, a PDF, or a
-- factory sample AT THE TIME IT WAS WRITTEN — but nothing ever came back
-- afterwards to check a prediction against what a real mill actually did with
-- a real order. That gap matters most exactly where the catalogue is weakest
-- (see fabric-derivatives.js's ESTIMATED tag and source-confidence.js): there
-- is no feedback loop that would ever tell us whether "Estimated" and
-- "Factory data (exact match)" actually differ in real-world error, or by
-- how much.
--
-- This table is the raw material for that loop: an admin-entered historical
-- order — the spec as it was calculated (spec_input, the same JSON shape the
-- engine's calculate() takes) alongside what the mill actually used/produced.
-- It deliberately does NOT store the engine's prediction at entry time — the
-- prediction is re-computed live every time a record is read (see
-- engine/domain/validation-scoring.js), so a record scored today and a record
-- scored after the next formula change are always compared against the
-- CURRENT engine, not a stale snapshot. That is also why there is no
-- "predicted_*" column here: a stored prediction would silently go stale the
-- first time a formula improved.
-- ============================================================================

CREATE TABLE real_order_validations (
  id                serial PRIMARY KEY,
  fabric_id         text NOT NULL,
  spec_input        jsonb NOT NULL,   -- full calculate() params: {fabric, gsm, composition, gauge, dia, ...}

  -- What the mill actually used/produced for this order. At least one of the
  -- three must be given — a row with none of them compares nothing.
  actual_count_ne   numeric,
  actual_sl_mm      numeric,
  actual_gsm        numeric,

  mill_name         text,             -- free text; whichever mill/buyer this came from, if the admin wants to track it
  order_ref         text,             -- admin's own PO/reference number, for finding the source document again
  notes             text,

  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT real_order_validations_has_actual CHECK (
    actual_count_ne IS NOT NULL OR actual_sl_mm IS NOT NULL OR actual_gsm IS NOT NULL
  )
);

CREATE INDEX real_order_validations_fabric_idx ON real_order_validations (fabric_id);
CREATE INDEX real_order_validations_created_idx ON real_order_validations (created_at DESC);

COMMENT ON TABLE real_order_validations IS
  'Admin-entered real mill order outcomes, used to score the engine''s live predictions against reality. See engine/domain/validation-scoring.js.';
COMMENT ON COLUMN real_order_validations.spec_input IS
  'The exact params object calculate() takes (fabric, gsm, composition, ...) — re-run live at read time, never cached, so scores always reflect the current engine.';
