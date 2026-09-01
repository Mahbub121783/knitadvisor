-- ============================================================================
-- 019 — Live yarn quotes, beside the price list rather than instead of it
--
-- The costing engine has run on a typed matrix headed "Factory-Approved
-- Reference Price List — Updated May 2026". By 1 September 2026 it had drifted:
-- against the market quotes of 29 August it is 3% high on cotton and 5-7% high
-- on CVC and PC. On a ten-tonne order that is real money, and nothing in the
-- system could tell anyone the list had gone stale, because a typed constant
-- has no date attached to it.
--
-- WHAT THIS TABLE IS FOR. Every row is one quote as PUBLISHED: the price, the
-- currency and unit it was printed in, and the date the publisher put on it.
-- Nothing is converted on the way in. Conversion needs an exchange rate, an
-- exchange rate is itself a dated number, and folding one dated number into
-- another at write time destroys the ability to say later which rate was used.
-- The normalised USD/kg figure is stored alongside, with the rate that produced
-- it, so a price can always be traced back to what was actually on the page.
--
-- WHY THE PUBLISHED DATE AND THE FETCH TIME ARE SEPARATE COLUMNS. They answer
-- different questions and confusing them is the whole failure mode here. The
-- fetch time says when we last looked; the quote date says how old the number
-- is. A feed that has stopped updating still gives a fresh fetch time forever,
-- and a system that reports the fetch time as "last updated" would show a green
-- timestamp over a price that had not moved in a year.
--
-- WHY QUOTES ARE APPENDED AND NOT UPDATED. A costing quoted to a buyer last
-- month was quoted at last month's yarn price, and when that is questioned the
-- answer has to be reconstructable. Overwriting in place makes every past
-- costing unexplainable. The unique key is therefore (source, item_key,
-- quoted_on), so the same day's quote cannot land twice but a new day always
-- adds a row.
--
-- PostgreSQL 13 here, so no UNIQUE NULLS NOT DISTINCT — every column in the
-- key is NOT NULL and a missing count is stored as 0 rather than NULL.
-- ============================================================================

CREATE TABLE IF NOT EXISTS yarn_price_quotes (
  id               BIGSERIAL PRIMARY KEY,

  -- Who published it. Kept as a column rather than assumed, because the
  -- engine must keep working when the feed is swapped for another one.
  source           TEXT        NOT NULL,

  -- WHICH LIST. The publisher prints two on one page and they are different
  -- prices for different trades, not one price in two currencies:
  --
  --   lc_usd     imported yarn against a letter of credit, quoted USD per kg
  --   local_bdt  the domestic cash market, quoted taka per pound
  --
  -- On 29 August 2026, 20Ne PC was $2.75 on the first and $2.12/kg on the
  -- second — twenty-three per cent apart, and both correct. Merging them was
  -- the first version of this table and the gate caught it: prices stopped
  -- rising with count, because the two lists were interleaved.
  --
  -- It also removes the exchange rate from the costing path entirely. The
  -- engine's matrix is denominated USD/kg, so it reads the lc_usd list, which
  -- needs no conversion at all.
  market           TEXT        NOT NULL CHECK (market IN ('lc_usd', 'local_bdt')),

  -- The engine's own matrix key this quote answers to ('carded_regular'), and
  -- the count in Ne. 0 means the item has no count — spandex, filament denier.
  item_key         TEXT        NOT NULL,
  count_ne         NUMERIC(6,2) NOT NULL DEFAULT 0,

  -- Exactly as the publisher printed it, before any arithmetic.
  raw_label        TEXT        NOT NULL,
  price            NUMERIC(12,4) NOT NULL CHECK (price > 0),
  currency         TEXT        NOT NULL CHECK (currency IN ('USD', 'BDT')),
  unit             TEXT        NOT NULL CHECK (unit IN ('KG', 'LB')),

  -- The same quote in the engine's working unit, and the rate that got it
  -- there. A converted figure with no rate beside it cannot be audited.
  price_usd_kg     NUMERIC(12,4) NOT NULL CHECK (price_usd_kg > 0),
  fx_bdt_per_usd   NUMERIC(10,4),
  fx_source        TEXT,

  -- The date on the page, and when we read it. Never the same question.
  quoted_on        DATE        NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The publisher's own day-on-day change, kept because it is a free check:
  -- a quote that moves while the feed says it did not has been misread.
  percent_change   NUMERIC(8,3),

  CONSTRAINT yarn_price_quotes_unique UNIQUE (source, market, item_key, count_ne, quoted_on)
);

-- The engine's only read pattern: newest quote for one item.
CREATE INDEX IF NOT EXISTS yarn_price_quotes_lookup
  ON yarn_price_quotes (market, item_key, count_ne, quoted_on DESC);

-- The admin panel's read pattern: what happened on the last sync.
CREATE INDEX IF NOT EXISTS yarn_price_quotes_fetched
  ON yarn_price_quotes (fetched_at DESC);


-- ============================================================================
-- One row per attempt, successful or not.
--
-- A sync that fails silently is worse than one that never ran, because the
-- quotes stay in place and go on looking current. This is the table the admin
-- panel reads to answer "when did this last actually work", which is a
-- different question from "when did it last run".
-- ============================================================================
CREATE TABLE IF NOT EXISTS yarn_price_syncs (
  id             BIGSERIAL PRIMARY KEY,
  source         TEXT        NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  ok             BOOLEAN     NOT NULL DEFAULT false,
  -- 'manual' when someone pressed the button, 'schedule' when the cron ran it.
  trigger        TEXT        NOT NULL DEFAULT 'schedule',
  rows_seen      INTEGER     NOT NULL DEFAULT 0,
  rows_stored    INTEGER     NOT NULL DEFAULT 0,
  rows_rejected  INTEGER     NOT NULL DEFAULT 0,
  -- The newest quote date the feed carried. If this stops moving, the feed has
  -- stopped updating even though the sync keeps succeeding.
  newest_quote   DATE,
  -- Why rows were rejected, in full. A rejection with no reason recorded is a
  -- silent data loss.
  rejections     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  error          TEXT
);

CREATE INDEX IF NOT EXISTS yarn_price_syncs_recent
  ON yarn_price_syncs (started_at DESC);
