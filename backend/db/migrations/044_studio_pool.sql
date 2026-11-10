-- ============================================================================
-- 044 — The pool: mills that choose to learn from each other, sharing one number
--
-- A mill that opts in contributes, per structure (and per yarn-count band for
-- weight), the mean of ln(measured ÷ predicted) over its own recent rolls —
-- computed from its studio_floor_rolls when the pool is read, never copied
-- anywhere. Nothing is stored here but who has opted in, so leaving the pool
-- (the row deleted) takes the mill's rolls out of every number at once, and
-- the pool holds nothing that could be handed over.
--
-- What a mill receives (engine/domain/machine-pool.js): only cells where at
-- least 5 OTHER accounts have contributed, the median of their means, clamped.
-- ============================================================================

CREATE TABLE studio_pool_members (
  user_id    integer PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now()
);
