-- ============================================================================
-- 036 — Optional two-step sign-in
--
-- Sign-in used to fall into the email-code screen for any account whose
-- activation mail never arrived (late, or in spam): the code was asked for on
-- every login, which read as "login always wants a code". From here a code is
-- asked at sign-in only when the person turned on two-step verification:
--
--   two_factor = 'off'    password only (the default)
--             = 'email'  password + a 6-digit code mailed at each sign-in
--             = 'app'    password + the 6-digit code of an authenticator app
--                        (TOTP, RFC 6238) — works with no email at all
--
-- totp_secret / totp_pending are stored encrypted (AES-256-GCM, key from
-- API_KEY_ENCRYPTION_SECRET), never in the clear. totp_last_step stops one
-- app code being used twice.
-- ============================================================================

ALTER TABLE app_users ADD COLUMN two_factor text NOT NULL DEFAULT 'off'
  CHECK (two_factor IN ('off', 'email', 'app'));
ALTER TABLE app_users ADD COLUMN totp_secret text;
ALTER TABLE app_users ADD COLUMN totp_pending text;
ALTER TABLE app_users ADD COLUMN totp_last_step bigint;

-- sign-in codes reuse the activation / reset mechanic
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
  CHECK (purpose IN ('activation', 'password_reset', 'student_email', 'login'));
