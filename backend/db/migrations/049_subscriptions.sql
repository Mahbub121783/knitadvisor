-- ============================================================================
-- 049 — Subscriptions the admin manages by hand
--
-- Until now an account was free, a verified student, or "paid" (a switch with
-- no end date). This adds named plans the admin can edit, a subscription on the
-- account (plan, start, end, an optional daily limit of its own), a history of
-- every change, and the one permission that is not a size of plan: answers from
-- the factory work orders.
--
-- app_plans       daily_limit NULL = unlimited; default_days NULL = no end date;
--                 rank orders the plans, so a change reads as a promotion or a
--                 demotion. 'free' and 'edu' also set the limits of accounts
--                 with no subscription (free) and of verified students (edu).
--
-- app_users       plan_code NULL = no subscription: the account is a verified
--                 student or free, as before. A subscription past plan_expires_at
--                 counts as none. plan_code 'free' is a deliberate demotion that
--                 holds even for a verified student.
--
-- The old is_paid switch is carried into the 'unlimited' plan; it is not used
-- for new changes.
-- ============================================================================

CREATE TABLE app_plans (
  code          text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  name          text NOT NULL,
  daily_limit   integer CHECK (daily_limit IS NULL OR daily_limit >= 0),
  default_days  integer CHECK (default_days IS NULL OR default_days BETWEEN 1 AND 3660),
  rank          integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_plans (code, name, daily_limit, default_days, rank) VALUES
  ('free',         'Free',                 5,    NULL, 0),
  ('edu',          'Education (student)',  30,   365,  10),
  ('floor',        'Floor',                50,   30,   20),
  ('mill',         'Mill',                 NULL, 30,   30),
  ('buying_house', 'Buying House',         NULL, 30,   40),
  ('unlimited',    'Unlimited',            NULL, NULL, 50);

ALTER TABLE app_users ADD COLUMN plan_code text REFERENCES app_plans(code);
ALTER TABLE app_users ADD COLUMN plan_started_at timestamptz;
ALTER TABLE app_users ADD COLUMN plan_expires_at timestamptz;
ALTER TABLE app_users ADD COLUMN plan_daily_limit integer CHECK (plan_daily_limit IS NULL OR plan_daily_limit >= 0);
ALTER TABLE app_users ADD COLUMN plan_note text;
ALTER TABLE app_users ADD COLUMN factory_access boolean NOT NULL DEFAULT false;
CREATE INDEX idx_app_users_plan ON app_users (plan_code, plan_expires_at) WHERE plan_code IS NOT NULL;

CREATE TABLE app_subscription_events (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  admin          text NOT NULL,
  action         text NOT NULL,
  from_plan      text,
  to_plan        text,
  expires_at     timestamptz,
  daily_limit    integer,
  factory_access boolean,
  note           text
);
CREATE INDEX idx_subscription_events_user ON app_subscription_events (user_id, at DESC);

UPDATE app_users SET plan_code = 'unlimited', plan_started_at = now() WHERE is_paid;
INSERT INTO app_subscription_events (user_id, admin, action, to_plan, note)
  SELECT id, 'migration', 'assign', 'unlimited', 'carried over from the old paid switch' FROM app_users WHERE is_paid;
-- is_paid is left as it is: the code still running while this is applied reads only that switch. The new code reads
-- the subscription first, and clears the switch the first time the admin changes the account.
