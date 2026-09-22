-- ============================================================================
-- 030 — Usernames
--
-- Email-only sign-in was the whole ask when accounts (027) shipped; the
-- product has since grown real users who would rather type a short handle
-- than remember which of several inboxes they registered with. This adds a
-- second, always-unique identifier that works alongside email everywhere
-- email worked before (login; nowhere else — activation/reset codes still
-- only ever go to the real email on file, a username is not an inbox).
--
-- username_changed_at backs the 60-day change cooldown enforced in
-- routes/account.js (self-service only — an admin override in routes/admin.js
-- bypasses it, matching how disable/email/password already work there).
-- ============================================================================

ALTER TABLE app_users ADD COLUMN username text;
ALTER TABLE app_users ADD COLUMN username_changed_at timestamptz;

-- Backfill every pre-existing account (there is no "skip verification" path
-- for a column going NOT NULL) from the local part of its email, lowercased
-- and stripped to the same charset the app enforces, de-duplicated with a
-- numeric suffix on collision.
DO $$
DECLARE
  r RECORD;
  base text;
  candidate text;
  suffix int;
BEGIN
  FOR r IN SELECT id, email FROM app_users WHERE username IS NULL ORDER BY id LOOP
    base := lower(regexp_replace(split_part(r.email, '@', 1), '[^a-zA-Z0-9_.]', '', 'g'));
    IF length(base) < 3 THEN base := base || 'usr'; END IF;
    base := left(base, 30);
    candidate := base;
    suffix := 0;
    WHILE EXISTS (SELECT 1 FROM app_users WHERE lower(username) = lower(candidate)) LOOP
      suffix := suffix + 1;
      candidate := left(base, 30 - length(suffix::text) - 1) || '_' || suffix::text;
    END LOOP;
    UPDATE app_users SET username = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE app_users ALTER COLUMN username SET NOT NULL;
ALTER TABLE app_users ADD CONSTRAINT chk_app_users_username_format CHECK (username ~ '^[A-Za-z0-9_.]{3,30}$');
CREATE UNIQUE INDEX uq_app_users_username ON app_users (lower(username));
