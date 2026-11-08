-- ============================================================================
-- 039 — Student verification, second generation
--
-- What 031 could not stop or see:
--   * one university email (or "name+1@" of it) verifying many accounts
--   * a document nobody read: any picture finished an automatic approval
--   * no way to resend a code, fix a mistyped email, re-apply or renew
--
-- This adds:
--   * student_email_norm — the address with any "+tag" removed, lower-cased;
--     unique among live (pending / active) applications
--   * the student's own ID, department and graduation year; the ID is unique
--     per university among live applications
--   * what the server read from the document (text, fields, scores), its
--     SHA-256 and a perceptual hash, so the same card on two accounts is seen
--   * a risk score with its reasons, and a post-approval review queue
--   * renewal links, reminder bookkeeping, a re-apply date after a rejection
--   * per-domain kind (student / staff / any), name aliases used to recognise
--     the university on a document, and where a row came from
--
-- Existing data is never changed in status. A live application that shares
-- its normalised email with an earlier live one keeps working, but is left
-- without student_email_norm and put in the review queue with the reason, so
-- an admin decides — the migration does not.
-- ============================================================================

ALTER TABLE app_student_verifications
  ADD COLUMN student_email_norm text,
  ADD COLUMN student_id         text,
  ADD COLUMN department         text,
  ADD COLUMN grad_year          integer,
  ADD COLUMN doc_mime           text,
  ADD COLUMN doc_sha256         text,
  ADD COLUMN doc_phash          text,
  ADD COLUMN doc_text           text,
  ADD COLUMN doc_check          jsonb,
  ADD COLUMN doc_state          text NOT NULL DEFAULT 'none',
  ADD COLUMN doc_checked_at     timestamptz,
  ADD COLUMN risk_score         integer,
  ADD COLUMN risk               jsonb,
  ADD COLUMN review_state       text NOT NULL DEFAULT 'none',
  ADD COLUMN reviewed_by        text,
  ADD COLUMN reviewed_at        timestamptz,
  ADD COLUMN apply_ip           text,
  ADD COLUMN apply_ua           text,
  ADD COLUMN renewal_of         integer REFERENCES app_student_verifications(id) ON DELETE SET NULL,
  ADD COLUMN reminder_sent_at   timestamptz,
  ADD COLUMN reapply_after      timestamptz,
  ADD COLUMN email_changes      integer NOT NULL DEFAULT 0;

ALTER TABLE app_student_verifications ADD CONSTRAINT student_doc_state_check
  CHECK (doc_state IN ('none', 'queued', 'checking', 'done', 'failed'));
ALTER TABLE app_student_verifications ADD CONSTRAINT student_review_state_check
  CHECK (review_state IN ('none', 'post_review', 'reviewed'));
ALTER TABLE app_student_verifications ADD CONSTRAINT student_grad_year_check
  CHECK (grad_year IS NULL OR grad_year BETWEEN 2000 AND 2100);

-- 'withdrawn': the applicant cancelled a pending application to start again
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'app_student_verifications'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%pending%' AND pg_get_constraintdef(oid) LIKE '%revoked%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE app_student_verifications DROP CONSTRAINT ' || quote_ident(c);
  END IF;
END $$;
ALTER TABLE app_student_verifications ADD CONSTRAINT app_student_verifications_status_check
  CHECK (status IN ('pending', 'active', 'rejected', 'revoked', 'expired', 'withdrawn'));

-- backfill: the earliest live application per normalised address owns it
WITH norm AS (
  SELECT id, status, created_at,
         lower(regexp_replace(trim(student_email), '\+[^@]*@', '@')) AS n
    FROM app_student_verifications WHERE student_email IS NOT NULL
), ranked AS (
  SELECT id, n, row_number() OVER (PARTITION BY n ORDER BY created_at, id) AS k
    FROM norm WHERE status IN ('pending', 'active')
)
UPDATE app_student_verifications v SET student_email_norm = r.n
  FROM ranked r WHERE v.id = r.id AND r.k = 1;

UPDATE app_student_verifications v
   SET review_state = 'post_review',
       risk = jsonb_build_object('reasons', jsonb_build_array('The same university email is on an earlier live application (found by migration 039).')),
       risk_score = 80
 WHERE v.student_email IS NOT NULL AND v.student_email_norm IS NULL AND v.status IN ('pending', 'active');

UPDATE app_student_verifications SET student_email_norm = lower(regexp_replace(trim(student_email), '\+[^@]*@', '@'))
 WHERE student_email IS NOT NULL AND student_email_norm IS NULL AND status NOT IN ('pending', 'active');

CREATE UNIQUE INDEX uq_student_email_live ON app_student_verifications (student_email_norm)
  WHERE status IN ('pending', 'active') AND student_email_norm IS NOT NULL;
CREATE UNIQUE INDEX uq_student_id_live ON app_student_verifications (university_id, lower(student_id))
  WHERE status IN ('pending', 'active') AND student_id IS NOT NULL AND university_id IS NOT NULL;
CREATE INDEX idx_student_doc_sha ON app_student_verifications (doc_sha256) WHERE doc_sha256 IS NOT NULL;
CREATE INDEX idx_student_apply_ip ON app_student_verifications (apply_ip, created_at DESC) WHERE apply_ip IS NOT NULL;
CREATE INDEX idx_student_review ON app_student_verifications (review_state) WHERE review_state = 'post_review';

-- ── universities: what a domain proves, and how the name reads on a card ──
ALTER TABLE university_domains
  ADD COLUMN kind    text NOT NULL DEFAULT 'any',
  ADD COLUMN aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN source  text NOT NULL DEFAULT 'admin';
ALTER TABLE university_domains ADD CONSTRAINT university_kind_check CHECK (kind IN ('student', 'staff', 'any'));

-- Well-known Bangladeshi universities, textile schools first. Marked 'seed' so
-- the admin page can ask for each to be confirmed; an existing row (any case)
-- is left exactly as the admin set it.
INSERT INTO university_domains (name, domain, kind, aliases, source) VALUES
  ('Bangladesh University of Textiles', 'butex.edu.bd', 'any', ARRAY['BUTEX', 'Bangladesh University of Textiles', 'বাংলাদেশ টেক্সটাইল বিশ্ববিদ্যালয়'], 'seed'),
  ('BGMEA University of Fashion and Technology', 'buft.edu.bd', 'any', ARRAY['BUFT', 'BGMEA University of Fashion'], 'seed'),
  ('National Institute of Textile Engineering and Research', 'niter.edu.bd', 'any', ARRAY['NITER', 'National Institute of Textile Engineering'], 'seed'),
  ('University of Dhaka', 'du.ac.bd', 'any', ARRAY['University of Dhaka', 'Dhaka University', 'ঢাকা বিশ্ববিদ্যালয়'], 'seed'),
  ('Bangladesh University of Engineering and Technology', 'buet.ac.bd', 'any', ARRAY['BUET', 'Bangladesh University of Engineering'], 'seed'),
  ('BRAC University', 'g.bracu.ac.bd', 'student', ARRAY['BRAC University', 'BRACU'], 'seed'),
  ('BRAC University', 'bracu.ac.bd', 'staff', ARRAY['BRAC University', 'BRACU'], 'seed'),
  ('North South University', 'northsouth.edu', 'any', ARRAY['North South University', 'NSU'], 'seed'),
  ('Independent University, Bangladesh', 'iub.edu.bd', 'any', ARRAY['Independent University', 'IUB'], 'seed'),
  ('American International University-Bangladesh', 'student.aiub.edu', 'student', ARRAY['American International University', 'AIUB'], 'seed'),
  ('East West University', 'std.ewubd.edu', 'student', ARRAY['East West University', 'EWU'], 'seed'),
  ('Daffodil International University', 'diu.edu.bd', 'any', ARRAY['Daffodil International University', 'DIU'], 'seed'),
  ('Ahsanullah University of Science and Technology', 'aust.edu', 'any', ARRAY['Ahsanullah University', 'AUST'], 'seed'),
  ('Shahjalal University of Science and Technology', 'student.sust.edu', 'student', ARRAY['Shahjalal University', 'SUST'], 'seed'),
  ('Jahangirnagar University', 'juniv.edu', 'any', ARRAY['Jahangirnagar University', 'জাহাঙ্গীরনগর বিশ্ববিদ্যালয়'], 'seed'),
  ('University of Rajshahi', 'ru.ac.bd', 'any', ARRAY['University of Rajshahi', 'Rajshahi University', 'রাজশাহী বিশ্ববিদ্যালয়'], 'seed'),
  ('Khulna University of Engineering & Technology', 'stud.kuet.ac.bd', 'student', ARRAY['Khulna University of Engineering', 'KUET'], 'seed'),
  ('Chittagong University of Engineering & Technology', 'student.cuet.ac.bd', 'student', ARRAY['Chittagong University of Engineering', 'CUET'], 'seed'),
  ('Southeast University', 'seu.edu.bd', 'any', ARRAY['Southeast University', 'SEU'], 'seed'),
  ('Bangladesh University of Business and Technology', 'bubt.edu.bd', 'any', ARRAY['Bangladesh University of Business', 'BUBT'], 'seed'),
  ('University of Asia Pacific', 'uap-bd.edu', 'any', ARRAY['University of Asia Pacific', 'UAP'], 'seed'),
  ('Primeasia University', 'primeasia.edu.bd', 'any', ARRAY['Primeasia University'], 'seed'),
  ('Green University of Bangladesh', 'green.edu.bd', 'any', ARRAY['Green University'], 'seed')
ON CONFLICT (lower(domain)) DO NOTHING;
