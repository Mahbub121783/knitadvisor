-- ============================================================================
-- 042 — API: self-service orders, plan prices, and per-key browser origins
--
-- allowed_origins  A key used from a web page (not a server) says which sites may
--                  call with it; the request's Origin is checked against this list.
-- api_settings     Small admin-edited texts (how to pay).
-- api_plan_prices  What a plan costs per month, set by the admin. A plan with no
--                  price here cannot be bought on the site (nothing is invented).
-- api_orders       A customer asks for a plan for N months and says how they paid
--                  (a bKash / Nagad / bank transaction id). The admin checks the
--                  payment and marks it paid; the customer then creates the key
--                  themselves, once, from their account. A paid order for an
--                  existing key (renew_key_id) extends that key instead.
--                  The amount is the price at the time of the order.
-- ============================================================================

ALTER TABLE api_keys ADD COLUMN allowed_origins text[];

CREATE TABLE api_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_plan_prices (
  plan        text PRIMARY KEY,
  price       numeric(12,2) NOT NULL CHECK (price >= 0),
  currency    text NOT NULL DEFAULT 'USD',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_orders (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  plan          text NOT NULL,
  months        integer NOT NULL CHECK (months BETWEEN 1 AND 24),
  renew_key_id  integer REFERENCES api_keys(id) ON DELETE SET NULL,
  amount        numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency      text NOT NULL,
  method        text NOT NULL,
  payment_ref   text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
  note          text,
  key_id        integer REFERENCES api_keys(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  issued_at     timestamptz
);
CREATE INDEX idx_api_orders_user ON api_orders (user_id, created_at DESC);
CREATE INDEX idx_api_orders_status ON api_orders (status, created_at DESC);
-- one payment reference is one payment: the same transaction id cannot back two orders
CREATE UNIQUE INDEX uq_api_orders_payment ON api_orders (lower(method), lower(payment_ref)) WHERE status IN ('pending', 'paid');
