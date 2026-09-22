-- ============================================================================
-- 031 — Plans, daily usage limits, and student verification
--
-- Until now every signed-in account had identical, unlimited access to the
-- engine — fine while the product was free, wrong now that it is commercial
-- with no billing yet. This adds three things:
--
--   app_users.is_paid            — admin-set only (there is no payment
--                                   gateway yet). An unlimited-use account.
--   app_users.student_status /
--   app_users.student_expires_at — cached on the user row so every engine
--                                   request can resolve the plan with no
--                                   join. Mirrors the newest row in
--                                   app_student_verifications; kept in sync
--                                   by application code whenever that table
--                                   changes, the same "cache the current
--                                   state, keep the history elsewhere"
--                                   split already used for username/email.
--
--   university_domains  — admin-curated allow-list. A university only grants
--                          instant auto-approval if ITS OWN real domain is in
--                          this table, matched by exact equality — never a
--                          suffix/wildcard match. That is deliberate: a
--                          disposable "edu-like" domain someone registers
--                          themselves never appears here unless an admin adds
--                          it by hand, which is the actual fraud control.
--
--   app_student_verifications — one row per verification attempt: which
--                          university (or free-text "other"), the university
--                          email and whether it was proven (a mailed code,
--                          same mechanic as activation/reset), the uploaded
--                          document's path, and its status. Status values
--                          mirror app_users.student_status exactly so
--                          "current state = latest row's status" needs no
--                          translation.
--
--   app_user_daily_usage — one row per user per Asia/Dhaka calendar day,
--                          incremented with a single atomic UPDATE so
--                          concurrent requests across Passenger workers
--                          cannot both win a read-modify-write race.
-- ============================================================================

ALTER TABLE app_users ADD COLUMN is_paid boolean NOT NULL DEFAULT false;
ALTER TABLE app_users ADD COLUMN student_status text NOT NULL DEFAULT 'none'
  CHECK (student_status IN ('none', 'pending', 'active', 'rejected', 'revoked', 'expired'));
ALTER TABLE app_users ADD COLUMN student_expires_at timestamptz;

CREATE TABLE university_domains (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  -- Matched by exact equality against the part of an email after '@',
  -- lower-cased. Never a suffix match — see the header.
  domain      text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_university_domains_domain ON university_domains (lower(domain));

CREATE TABLE app_student_verifications (
  id                          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  university_id               integer REFERENCES university_domains(id) ON DELETE SET NULL,
  -- Copied at submit time so this record still reads correctly even if the
  -- allow-list row is later renamed or removed.
  university_name             text NOT NULL,
  student_email                text,
  student_email_verified_at    timestamptz,
  document_path                text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'rejected', 'revoked', 'expired')),
  decided_at                   timestamptz,
  -- 'auto' for the automatic domain+code+document path, or the admin's
  -- username for a manual approve/reject/revoke.
  decided_by                   text,
  reason                       text,
  expires_at                   timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_student_verifications_user ON app_student_verifications (user_id, created_at DESC);
CREATE INDEX idx_student_verifications_status ON app_student_verifications (status);

CREATE TABLE app_user_daily_usage (
  user_id     integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  usage_date  date NOT NULL,
  count       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

-- app_user_codes.purpose needs a third value for university-email codes,
-- which reuse the exact same issue/mail/check mechanic as activation and
-- password reset. The constraint from migration 029 was never explicitly
-- named, so it is located by inspecting the column it covers rather than by
-- guessing Postgres's auto-generated name.
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
  CHECK (purpose IN ('activation', 'password_reset', 'student_email'));
