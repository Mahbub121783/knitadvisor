-- ============================================================================
-- 034 — Knitting lessons: what the reading folder teaches, kept as lessons
--
-- A growing library of knitting references (papers, lecture notes, textbooks),
-- read one at a time and stored as short, findable lessons — each with the
-- plain claim, the numbers behind it, and an honest note on how far it can be
-- trusted and what it means for the engine. Same idea as fibre_lessons, but
-- written by reading rather than split from a book's outline.
--
--   knitting_documents  one row per document read: what it is, how relevant it
--                       is to the engine, and what it can and cannot calibrate.
--   knitting_lessons    the lessons, each tagged by topic and typed
--                       (concept | method | data | table | caution | engine).
--
-- Internal only: the citation lives here so a lesson can be traced back to its
-- source, and is never shown on the site or in an API response.
-- ============================================================================
CREATE TABLE IF NOT EXISTS knitting_documents (
  doc_key        text PRIMARY KEY,
  title          text NOT NULL,
  authors        text,
  year           smallint,
  doc_type       text NOT NULL,                 -- paper | lecture | textbook | notes
  file_name      text NOT NULL,
  pages          smallint,
  summary        text NOT NULL,
  relevance      text NOT NULL,                 -- core | supporting | peripheral
  relevance_note text NOT NULL,                 -- why, and what it can / cannot calibrate
  read_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knitting_documents_type CHECK (doc_type IN ('paper', 'lecture', 'textbook', 'notes')),
  CONSTRAINT knitting_documents_relevance CHECK (relevance IN ('core', 'supporting', 'peripheral'))
);

CREATE TABLE IF NOT EXISTS knitting_lessons (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_key     text NOT NULL REFERENCES knitting_documents(doc_key) ON DELETE CASCADE,
  seq         smallint NOT NULL,
  title       text NOT NULL,
  kind        text NOT NULL,
  topics      text[] NOT NULL DEFAULT '{}',
  body        text NOT NULL,
  page_start  smallint,
  page_end    smallint,
  search      tsvector GENERATED ALWAYS AS (
                to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || array_to_string(topics, ' '))
              ) STORED,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knitting_lessons_unique UNIQUE (doc_key, seq),
  CONSTRAINT knitting_lessons_kind CHECK (kind IN ('concept', 'method', 'data', 'table', 'caution', 'engine'))
);

CREATE INDEX IF NOT EXISTS knitting_lessons_search_idx ON knitting_lessons USING gin (search);
CREATE INDEX IF NOT EXISTS knitting_lessons_topics_idx ON knitting_lessons USING gin (topics);
CREATE INDEX IF NOT EXISTS knitting_lessons_title_trgm ON knitting_lessons USING gin (title gin_trgm_ops);

CREATE TRIGGER knitting_lessons_touch BEFORE UPDATE ON knitting_lessons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
