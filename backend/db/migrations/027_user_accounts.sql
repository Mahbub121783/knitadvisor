-- ============================================================================
-- 027 — Customer accounts
--
-- Until now the only login in this app was the single admin_users row. The
-- calculator was open to anyone with the URL, which is right for a free tool
-- and wrong for a commercial product: there was no way to know who was using
-- it, to limit it, or to reach them. These tables are the customer side of
-- that — deliberately separate from admin_users/admin_sessions, because a
-- customer session must never be able to reach /admin and an admin token has
-- no business being accepted by the customer gate.
--
-- Sessions mirror admin_sessions: only a SHA-256 of the random token is
-- stored, so a database read does not hand out live logins, and expiry is
-- enforced in SQL rather than trusted to application code.
-- ============================================================================

CREATE TABLE app_users (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email          text NOT NULL,
  full_name      text NOT NULL,
  company        text,
  -- Which plan the person said they want at sign-up. Captured because there is
  -- no billing yet: it is the only signal for who to talk to first. Not an
  -- entitlement — nothing in the app reads it to allow or refuse anything.
  plan_interest  text CHECK (plan_interest IN ('floor', 'mill', 'buying_house')),
  -- scrypt$<N>$<salt>$<key> from middleware/password.js. The CHECK refuses
  -- anything else, so a bug that stored a plaintext or an unsalted hash fails
  -- at the INSERT instead of sitting in the table.
  password_hash  text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  disabled       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
-- Emails compare case-insensitively: "Mill@X.com" and "mill@x.com" are one
-- person. Enforced on lower(email) so it holds no matter which code path
-- inserts.
CREATE UNIQUE INDEX uq_app_users_email ON app_users (lower(email));

CREATE TABLE app_user_sessions (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX idx_app_user_sessions_user ON app_user_sessions (user_id);
CREATE INDEX idx_app_user_sessions_expires ON app_user_sessions (expires_at);
