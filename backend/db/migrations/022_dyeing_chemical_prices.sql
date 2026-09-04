-- ============================================================================
-- 022 — Dyeing chemical prices: an editable, dated override layer
--
-- The 021 dyeing reference (dyeing_recipes / dyeing_recipe_chemicals) is a
-- frozen citation of one factory's Excel cards — its unit_price_tk values
-- carry no date and can only change by re-extracting the source file. This
-- table is the fix: a small, admin-editable price-per-chemical table with a
-- real updated_at, read once at boot into an in-memory snapshot (Pattern A,
-- same shape as engine/reference/index.js and the yarn-price repository) so
-- calculateDyeingCost() stays synchronous — an edit here takes effect via an
-- explicit reload() call from the admin route, never a live DB read at
-- request time.
--
-- Backfilled from the CURRENT dyeing_recipe_chemicals prices with
-- updated_at = NULL — that NULL is itself honest: it means "this is still
-- the original value extracted from the source file, no human has confirmed
-- it since." Only a row an admin has actually edited gets a real date.
--
-- NOT backfilled: 5 of the 37 named/priced chemicals (checked directly
-- against dyeing-reference.json before writing this migration) appear at
-- GENUINELY DIFFERENT prices across different recipe cards — e.g. "Masquol
-- P210" at 40, 20, and 256 Tk/kg in three different recipes. There is no
-- single real price to backfill for these; picking one (lowest, first-seen,
-- whatever) would silently discard the other real data points and, once an
-- admin later edited that name, would unify recipes that were never actually
-- priced the same. Recipes using one of these 5 chemicals simply keep using
-- their own recipe-specific price (today's exact behaviour, no override
-- applies) until an admin explicitly adds one — the admin UI must show these
-- as "no single price on record" rather than silently offering an edit box
-- pre-filled with a guess.
-- ============================================================================

CREATE TABLE dyeing_chemical_prices (
  chemical_name   text PRIMARY KEY,
  unit_price_tk   numeric NOT NULL CHECK (unit_price_tk > 0),
  updated_at      timestamptz
);

CREATE TRIGGER dyeing_chemical_prices_touch BEFORE UPDATE ON dyeing_chemical_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN dyeing_chemical_prices.updated_at IS
  'NULL means this price has never been edited via the admin panel — it is still the original value extracted from the source Excel file, with no known date. A real timestamp means an admin confirmed/changed it on that date.';

INSERT INTO dyeing_chemical_prices (chemical_name, unit_price_tk, updated_at)
SELECT commercial_name, MIN(unit_price_tk), NULL
FROM dyeing_recipe_chemicals
WHERE commercial_name IS NOT NULL AND unit_price_tk > 0
GROUP BY commercial_name
HAVING COUNT(DISTINCT unit_price_tk) = 1
ON CONFLICT (chemical_name) DO NOTHING;
