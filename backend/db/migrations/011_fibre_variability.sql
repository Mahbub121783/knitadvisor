-- ============================================================================
-- 011 — Variability: how much a fibre differs from itself
--
-- Chapter 14 is about the fact that a fibre is not one thing. Every figure
-- stored before this migration is a mean, and a mean says nothing about how
-- much the individual fibres in a sample differ from each other — which, for
-- cotton, turns out to be most of what matters.
--
--   cv_fineness            %   coefficient of variation between the individual
--   cv_breaking_load       %   fibres of one sample, Table 14.6, p.335
--   cv_tenacity            %
--   cv_breaking_extension  %
--   tenacity_sd        N/tex   standard deviation, Table 14.3, p.327
--
-- Cotton's tenacity varies 43% from fibre to fibre. Nylon's varies 7%. Six
-- times, between two fibres whose mean tenacities differ by less than a half.
-- That single comparison is behind most of what a spinner knows about the two:
-- why a cotton yarn needs more fibres in its cross-section before it comes out
-- even, why cotton yarn strength is always quoted with a CV and continuous
-- filament nylon is not, and why adding a synthetic to a cotton blend steadies
-- it out of proportion to how much was added.
--
-- THE WEAK-LINK EFFECT, which is why test length is now a condition
-- ----------------------------------------------------------------
-- A fibre breaks at its weakest place, so a longer specimen contains more
-- chances of a weak place and tests weaker. Table 14.1 measures the same cotton
-- at three lengths — 0.31 N/tex over 1 cm, 0.43 over 1 mm, 0.59 over 0.1 mm.
-- It nearly doubles. Nylon goes 0.47, 0.50, 0.54 and barely moves.
--
-- So a tenacity without a test length beside it is incomplete, and these rows
-- carry the length in `condition` for that reason. Chapter 13's figures are all
-- at 1 cm, which is what makes them comparable with each other — and worth
-- remembering when comparing them with a yarn tested over half a metre.
--
-- ONE COLUMN OF TABLE 14.3 IS DELIBERATELY ABSENT
-- -----------------------------------------------
-- It prints, for each cotton variety, the 1 mm tenacity CALCULATED from
-- Peirce's theory beside the one measured. The calculated column is not stored.
-- A figure derived from a model, filed in a measurement table, is how the model
-- ends up being cited as evidence for itself.
-- ============================================================================
ALTER TABLE fibre_properties DROP CONSTRAINT IF EXISTS fibre_properties_physical;
ALTER TABLE fibre_properties ADD CONSTRAINT fibre_properties_physical CHECK (
  CASE property
    WHEN 'density'            THEN coalesce(value, value_min) BETWEEN 0.5 AND 8.0
    WHEN 'specific_volume'    THEN coalesce(value, value_min) BETWEEN 0.1 AND 2.5
    WHEN 'moisture_regain'    THEN coalesce(value, value_min) BETWEEN 0 AND 100
    WHEN 'moisture_content'   THEN coalesce(value, value_max) BETWEEN 0 AND 100
    WHEN 'breaking_extension' THEN coalesce(value, value_max) BETWEEN 0 AND 1000

    WHEN 'tenacity'           THEN coalesce(value, value_min) BETWEEN 0.001 AND 6.0
    WHEN 'initial_modulus'    THEN coalesce(value, value_min) BETWEEN 0.0001 AND 600
    WHEN 'work_of_rupture'    THEN coalesce(value, value_min) BETWEEN 0.01 AND 2000
    WHEN 'yield_stress'       THEN coalesce(value, value_min) BETWEEN 0 AND 5000
    WHEN 'yield_strain'       THEN coalesce(value, value_max) BETWEEN 0 AND 200
    WHEN 'work_factor'        THEN coalesce(value, value_max) BETWEEN 0.05 AND 1.0

    WHEN 'tenacity_ratio'             THEN coalesce(value, value_min) BETWEEN 0.001 AND 10
    WHEN 'breaking_extension_ratio'   THEN coalesce(value, value_min) BETWEEN 0.001 AND 10
    WHEN 'work_of_rupture_ratio'      THEN coalesce(value, value_min) BETWEEN 0.001 AND 10
    WHEN 'initial_modulus_ratio'      THEN coalesce(value, value_min) BETWEEN 0.001 AND 10

    WHEN 'transverse_swelling_diameter' THEN coalesce(value, value_max) BETWEEN 0 AND 300
    WHEN 'transverse_swelling_area'     THEN coalesce(value, value_max) BETWEEN 0 AND 300
    WHEN 'axial_swelling'               THEN coalesce(value, value_max) BETWEEN 0 AND 300
    WHEN 'volume_swelling'              THEN coalesce(value, value_max) BETWEEN 0 AND 300

    -- A standard deviation is in the units of the thing it varies, so this is
    -- bounded like a tenacity. It cannot be negative.
    WHEN 'tenacity_sd'        THEN coalesce(value, value_min) BETWEEN 0 AND 6.0

    -- A coefficient of variation is a standard deviation over a mean. Above
    -- 100% the mean has stopped describing a quantity that cannot go below
    -- zero; the largest in the book is cotton's breaking load at 46%.
    WHEN 'cv_fineness'            THEN coalesce(value, value_min) BETWEEN 0 AND 100
    WHEN 'cv_breaking_load'       THEN coalesce(value, value_min) BETWEEN 0 AND 100
    WHEN 'cv_tenacity'            THEN coalesce(value, value_min) BETWEEN 0 AND 100
    WHEN 'cv_breaking_extension'  THEN coalesce(value, value_min) BETWEEN 0 AND 100
    ELSE true
  END);
