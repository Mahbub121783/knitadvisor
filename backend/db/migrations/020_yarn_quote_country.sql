-- ============================================================================
-- 020 — A quote belongs to a country
--
-- The first version of this table had one source, and that source publishes
-- Bangladeshi prices only, so the country was implicit and nobody had to say
-- it. With a second source that quotes India, Pakistan, China, Turkey and
-- Vietnam, implicit becomes wrong: an Indian quote and a Bangladeshi one for
-- 30Ne carded are different prices, and without this column they collide on
-- the unique key exactly the way BCI collided with plain carded — silently, at
-- the INSERT, keeping whichever arrived first.
--
-- Existing rows are all texbazar and all Bangladeshi, so backfilling them to
-- 'BD' is a statement of fact rather than an assumption.
--
-- WHY IT IS PART OF THE UNIQUE KEY. Two countries quoting the same product on
-- the same day is the normal case, not the exception, and it is the whole point
-- of having a second source. Leaving the key alone would have made the second
-- source's data destroy the first's, one row at a time, with nothing to show
-- for it but a lower row count nobody would look at.
-- ============================================================================

ALTER TABLE yarn_price_quotes
  ADD COLUMN IF NOT EXISTS country TEXT;

UPDATE yarn_price_quotes SET country = 'BD' WHERE country IS NULL;

ALTER TABLE yarn_price_quotes
  ALTER COLUMN country SET NOT NULL,
  ALTER COLUMN country SET DEFAULT 'BD';

-- The old key, dropped and rebuilt with the country in it.
ALTER TABLE yarn_price_quotes
  DROP CONSTRAINT IF EXISTS yarn_price_quotes_unique;

ALTER TABLE yarn_price_quotes
  ADD CONSTRAINT yarn_price_quotes_unique
  UNIQUE (source, country, market, item_key, count_ne, quoted_on);

-- The engine reads by country now, so the index leads with it.
DROP INDEX IF EXISTS yarn_price_quotes_lookup;
CREATE INDEX IF NOT EXISTS yarn_price_quotes_lookup
  ON yarn_price_quotes (country, market, item_key, count_ne, quoted_on DESC);

-- ============================================================================
-- The sync log stops being about one publisher.
--
-- `source` on a run row used to name the only source there was. A run now
-- covers several, so it carries 'merged' and the per-source detail goes in a
-- JSON column — because "the run worked" and "every source worked" are
-- different answers, and a dashboard that cannot tell them apart will show a
-- green tick over a source that has been failing for a month.
-- ============================================================================
ALTER TABLE yarn_price_syncs
  ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'::jsonb;
