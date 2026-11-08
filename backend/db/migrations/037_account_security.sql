-- ============================================================================
-- 037 — Account security: devices, lockout, activity, self-service email change
--
--   app_user_sessions.ip / user_agent / last_seen_at
--       each signed-in device, so the account page can list them and sign
--       one out, and a sign-in from a device never seen before can be mailed
--       to the owner (the alert that catches a stolen password)
--   app_users.failed_logins / locked_until
--       per-account brute-force lock: the IP limiter alone does not stop a
--       guesser spread over many addresses
--   app_users.pending_email
--       a new address waiting for its code before it replaces the old one
--   app_security_events
--       the account's own security history (sign-ins, failures, two-step and
--       password changes), shown to its owner
-- ============================================================================

ALTER TABLE app_user_sessions ADD COLUMN ip text;
ALTER TABLE app_user_sessions ADD COLUMN user_agent text;
ALTER TABLE app_user_sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE app_users ADD COLUMN failed_logins integer NOT NULL DEFAULT 0;
ALTER TABLE app_users ADD COLUMN locked_until timestamptz;
ALTER TABLE app_users ADD COLUMN pending_email text;

CREATE TABLE app_security_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  ip          text,
  user_agent  text,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_app_security_events_user ON app_security_events (user_id, created_at DESC);

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'app_user_codes'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%purpose%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE app_user_codes DROP CONSTRAINT ' || quote_ident(c);
  END IF;
END $$;
ALTER TABLE app_user_codes ADD CONSTRAINT app_user_codes_purpose_check
  CHECK (purpose IN ('activation', 'password_reset', 'student_email', 'login', 'email_change'));
