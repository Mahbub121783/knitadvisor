-- ============================================================================
-- 021 — Dyeing reference: real factory recipe cards, as a citation layer
--
-- Source: 6 real dyeing recipe cards from Alim Knit (BD) Ltd's own working
-- spreadsheet ("DYEING NEW PROCESS BY MOZAMMEL SIR"), each a full pretreatment
-- + dyeing + soaping + softening cost card with live Excel formulas for
-- required chemical quantity, price, and cost per kg. This is the same status
-- as the woven layer (005/006): a citation/audit/search surface, not something
-- calculate() reads. dyeing-engine.js requires backend/data/dyeing-reference
-- .json directly at module load (Pattern B, same as woven-derivatives.js) —
-- these tables exist so the 6 recipes are queryable and auditable elsewhere,
-- e.g. later admin tooling, not as the engine's live data path.
--
-- WHY shade_tiers IS AN ARRAY, NOT A SINGLE COLUMN
-- -------------------------------------------------
-- 4 of the 6 real sheets write "Navy / Black" as ONE color label in the
-- source cell — the factory does not distinguish the two for these recipes,
-- and the same chemical costing applies to both. A singular shade_tier column
-- would force an arbitrary pick between 'dark_navy' and 'black' and silently
-- drop coverage of whichever wasn't chosen. Kept as the two-element array the
-- source actually implies.
--
-- WHY COST IS STORED IN TAKA, NOT CONVERTED HERE
-- ------------------------------------------------
-- Converting at import time would bake a point-in-time FX rate into what
-- should be a durable, re-auditable factory quote — the same principle
-- country-costs.js states for its own prices ("every figure carries its
-- source and its date"). Conversion happens only where the number is used
-- (dyeing-engine.js, at calculation time), against whatever exchange rate is
-- live for that request.
--
-- WHAT THIS DOES NOT COVER (see dyeing-reference.json's own scope_warning)
-- --------------------------------------------------------------------------
-- Only 2 White and 4 Navy/Black jersey/CVC-jersey recipes from one factory's
-- cards. The 4 coloured recipes' cost_per_kg_tk excludes the reactive dye
-- itself (its dosing is job-specific and left blank in the source) — that is
-- recorded per recipe as dye_cost_included, never silently presented as an
-- all-in cost. No shade outside these 6 has a real recipe; the engine must
-- fall through to the existing price-list estimate for anything else.
-- ============================================================================

ALTER TABLE reference_sources DROP CONSTRAINT IF EXISTS reference_sources_domain;
ALTER TABLE reference_sources ADD CONSTRAINT reference_sources_domain
  CHECK (domain IN ('woven', 'weft_knit', 'warp_knit', 'yarn', 'fibre',
                    'colour', 'finishing', 'mixed', 'dyeing'));

CREATE TABLE dyeing_recipes (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipe_key         text NOT NULL UNIQUE,       -- matches dyeing-reference.json's recipe id
  source_key         text NOT NULL REFERENCES reference_sources(key),
  sheet_name         text NOT NULL,
  buyer              text,
  color_label        text NOT NULL,              -- raw source text, e.g. "Navy / Black"
  shade_tiers        text[] NOT NULL,             -- one or more of color-engine.js's SHADE_TIERS
  composition_tag    text,                        -- raw "F.Type" text, e.g. "cvc jersey"; null for White
  fabric_qty_kg      numeric NOT NULL,
  ml_ratio           numeric NOT NULL,
  water_l            numeric NOT NULL,
  cost_per_kg_tk     numeric NOT NULL,
  total_bath_count   integer,
  total_time_min     integer,
  dye_cost_included  boolean NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dyeing_recipes_positive CHECK (
    fabric_qty_kg > 0 AND ml_ratio > 0 AND water_l > 0 AND cost_per_kg_tk > 0
  )
);

CREATE TRIGGER dyeing_recipes_touch BEFORE UPDATE ON dyeing_recipes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN dyeing_recipes.dye_cost_included IS
  'False for the 4 coloured recipes: their REACTIVE DYES rows are job-specific templates left blank in the source, so cost_per_kg_tk covers pretreatment/neutralisation/auxiliary chemicals only, not the dye itself.';

CREATE TABLE dyeing_recipe_chemicals (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipe_id         integer NOT NULL REFERENCES dyeing_recipes(id) ON DELETE CASCADE,
  step_order        integer NOT NULL,
  stage             text,               -- sparse: the source's own "steps" column, blank on continuation rows
  functional_name   text,
  commercial_name   text,
  dosing            numeric NOT NULL DEFAULT 0,
  dosing_basis      text,               -- 'liquor_gpl' | 'percent_owf' | 'other' | null (see extract-dyeing-reference.js)
  unit_price_tk     numeric NOT NULL DEFAULT 0,
  required_qty_kg   numeric NOT NULL DEFAULT 0,
  price_tk          numeric NOT NULL DEFAULT 0,
  remarks           text,
  time_min          numeric NOT NULL DEFAULT 0,

  CONSTRAINT dyeing_recipe_chemicals_unique UNIQUE (recipe_id, step_order),
  CONSTRAINT dyeing_recipe_chemicals_basis CHECK (dosing_basis IS NULL OR dosing_basis IN ('liquor_gpl', 'percent_owf', 'other'))
);

CREATE INDEX IF NOT EXISTS dyeing_recipe_chemicals_recipe
  ON dyeing_recipe_chemicals (recipe_id, step_order);

COMMENT ON COLUMN dyeing_recipe_chemicals.dosing_basis IS
  'Read from the source cell''s OWN formula, not assumed — this file mixes liquor-ratio and %owf dosing. ''other'' includes one known broken source formula (White (chori bonmax), softener row), transcribed as-is rather than corrected.';
