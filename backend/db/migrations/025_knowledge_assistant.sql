-- ============================================================================
-- 025 — Knowledge Assistant: RAG chunk store + usage ledger
--
-- Tier 2 item 1: a natural-language Q&A layer over knowledge this app already
-- has — fibre advisory findings (Morton & Hearle citations), dyeing fault
-- diagnosis + remediation text, dyeing theory, wet-processing critical-path
-- notes, academy glossary, woven reference notes, and the garment CMT/
-- consumption sourcing notes — currently reachable only through the specific
-- structured form each of those lives behind.
--
-- WHY `vector` HAS NO `CREATE EXTENSION` HERE
-- --------------------------------------------
-- pgvector is an UNTRUSTED extension on this host (unlike pg_trgm, which
-- migration 003 enables itself): only a superuser can `CREATE EXTENSION
-- vector`, and the app's own migration role cannot. It was already enabled by
-- the host (PutulHost, via support ticket) and independently verified working
-- — HNSW/IVFFlat indexes build, halfvec/sparsevec types present — as of
-- 2026-08-30 (see memory knitadvisor-postgres-extensions). If a future host
-- migration lands on a database where that ticket was never filed, this
-- migration fails loudly at CREATE TABLE with "type vector does not exist" —
-- correct behaviour: there is no way to silently automate a superuser grant.
--
-- WHY 1024 DIMENSIONS
-- --------------------
-- Embeddings come from Voyage AI's voyage-4-lite (Matryoshka Representation
-- Learning — the first N values of its native 2048-dim vector are themselves
-- a valid, independently-useful embedding at N=256/512/1024). 1024 is the
-- quality/storage balance point for a knowledge base this size (low hundreds
-- of chunks, not millions) — requested explicitly via `output_dimension:
-- 1024` on every embed call in knowledge-assistant-engine.js, which is also
-- WHERE the dimension is enforced; nothing here checks it matches at write
-- time beyond the column's own fixed width.
--
-- WHY A TRIGRAM INDEX SITS BESIDE THE VECTOR INDEX
-- --------------------------------------------------
-- Pure semantic search misses exact textile terminology a trigram match
-- catches directly (a query for "pique" should find the "pique" chunk even
-- when the embedding drifts toward a general knit-structure neighbourhood).
-- The retrieval engine blends both rather than trusting vector search alone.
-- ============================================================================

CREATE TABLE knowledge_chunks (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Which internal engine/domain this chunk was extracted from — an engine
  -- module name (fibre_advisory, dyeing_faults, dyeing_theory, academy,
  -- woven_reference, wet_processing, garment_costing), never an external URL
  -- (this app never renders outbound source links on the frontend).
  source_module   text NOT NULL,
  -- The specific topic/fault/fabric id within that module, so an answer can
  -- point back to something re-derivable from the live engine, not just a
  -- frozen copy of text that can drift from the source it was built from.
  source_ref      text,
  title           text NOT NULL,
  content         text NOT NULL,
  -- SHA-256 of `content`, so the indexing script can skip re-embedding a
  -- chunk whose text has not changed since the last run (embeddings cost
  -- real money — see build-knowledge-index.js).
  content_hash    char(64) NOT NULL,
  embedding       vector(1024),
  embedding_model text NOT NULL DEFAULT 'voyage-4-lite',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_module, source_ref)
);

CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_knowledge_chunks_content_trgm ON knowledge_chunks
  USING gin (content gin_trgm_ops);

-- ============================================================================
-- USAGE LEDGER
--
-- This is the first feature in the app with real per-request external $ cost
-- (embeddings + generation both bill per token). Every other engine here is
-- free, synchronous, in-process math — this one needs its spend visible and
-- boundable, not just rate-limited at the HTTP layer. The admin panel reads
-- this table directly; there is no separate counter to keep in sync.
-- ============================================================================
CREATE TABLE assistant_queries (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question          text NOT NULL,
  answer_preview    text,               -- first ~200 chars, for the admin log — not the full answer
  sources_used      jsonb,              -- [{source_module, source_ref, title}, ...]
  chunks_retrieved  integer NOT NULL DEFAULT 0,
  embedding_tokens  integer,
  input_tokens      integer,
  output_tokens     integer,
  cost_usd_estimate numeric(10,6),
  -- false when the model said "not covered in my knowledge base" rather than
  -- answering from the retrieved chunks — tracked separately from a plain
  -- error so low-coverage TOPICS are visible, not just outright failures.
  grounded          boolean,
  response_ms       integer,
  ip_hash           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_assistant_queries_created_at ON assistant_queries (created_at);
