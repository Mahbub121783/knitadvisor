-- ============================================================================
-- 029 — Email verification and password reset codes
--
-- Signup was open with no proof the email address is real or belongs to the
-- person signing up — a customer login is worth locking down once it gates a
-- real product, not just a free calculator. This adds:
--
--   app_users.email_verified   — an account cannot sign in until true
--   app_user_codes             — one table for both purposes ('activation'
--                                 and 'password_reset'), because they are the
--                                 same mechanic: a 6-digit code, mailed out,
--                                 checked, consumed once, expires soon.
--
-- Codes are stored hashed (SHA-256), the same reasoning as admin_sessions and
-- app_user_sessions storing a token hash rather than the live value — a
-- database read must not hand out something that still works.
-- ============================================================================

ALTER TABLE app_users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;

-- Grandfather in every account that already existed under the old,
-- verification-free signup — they already reached the product; the new
-- DEFAULT false only takes effect for rows inserted from here on.
UPDATE app_users SET email_verified = true;

CREATE TABLE app_user_codes (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  purpose      text NOT NULL CHECK (purpose IN ('activation', 'password_reset')),
  code_hash    text NOT NULL,
  -- Wrong-guess counter. A 6-digit code is only ~1M possibilities; without a
  -- cap an attacker with the reset endpoint open could brute-force it within
  -- its own expiry window.
  attempts     integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- The live lookup is always "the newest unconsumed code for this user and
-- purpose" — indexed for that shape rather than by id.
CREATE INDEX idx_app_user_codes_lookup ON app_user_codes (user_id, purpose, created_at DESC);
