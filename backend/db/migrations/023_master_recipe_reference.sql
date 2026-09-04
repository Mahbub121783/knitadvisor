-- ============================================================================
-- 023 — Master recipe reference: a second, unattributed factory's cards
--
-- Reuses dyeing_recipes / dyeing_recipe_chemicals from 021 (same citation/
-- audit role, same Pattern B — dyeing-engine.js requires
-- backend/data/master-recipe-reference.json directly, never reads these
-- tables at request time). A new reference_sources row (key
-- MASTER_RECIPE_OCTOBER) distinguishes it from the Mozammel cards; author is
-- NULL because the source file states no company anywhere in it (checked the
-- "PREPARED BY :"/"CHECKED BY:" lines — both blank).
--
-- Two small additive columns, both because this source's layout genuinely
-- differs from the Mozammel cards (see extract-master-recipe-reference.js's
-- header):
--   dyeing_recipes.cost_gaps jsonb — this source has several chemicals with
--     no resolvable price anywhere in its own catalog (a real gap in the
--     source, not an extraction bug); recorded per recipe as
--     [{commercial_name, required_qty_kg, reason}], mirroring how
--     dye_cost_included discloses Mozammel's missing dye cost, generalized
--     because this source's gaps aren't limited to dye chemicals.
--   dyeing_recipe_chemicals.topping_tk numeric — this source has a genuine
--     second cost component per row (a "topping" dose on top of the main
--     dosing) that the Mozammel cards do not; defaults to 0, which is exactly
--     correct for every existing Mozammel row.
-- ============================================================================

INSERT INTO reference_sources (key, title, author, publisher, year, identifier, domain, scope_note)
VALUES (
  'MASTER_RECIPE_OCTOBER',
  'Internal dyeing recipe & costing cards',
  NULL,
  NULL,
  NULL,
  NULL,
  'dyeing',
  'Second factory source, company not stated in the file. 34 real recipe cards covering white/black/dark_navy/light_medium/fluorescent shades on cotton, CVC/PC, viscose/modal and specialty (lurex, snow yarn, etc.) substrates. Shade-depth-percentage sheets, turquoise/green shades, and a handful of unidentifiable sheets were deliberately excluded rather than guessed at. No process time or bath-count data is available for this source.'
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE dyeing_recipes ADD COLUMN IF NOT EXISTS cost_gaps jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dyeing_recipe_chemicals ADD COLUMN IF NOT EXISTS topping_tk numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN dyeing_recipes.cost_gaps IS
  'Chemicals this recipe actually doses but whose price could not be resolved anywhere in the source workbook''s own catalog — disclosed, never guessed. Empty for every Mozammel recipe.';
COMMENT ON COLUMN dyeing_recipe_chemicals.topping_tk IS
  'A second cost component (a "topping" dose on top of the main dosing) used by the master-recipe source only; always 0 for Mozammel recipes.';
