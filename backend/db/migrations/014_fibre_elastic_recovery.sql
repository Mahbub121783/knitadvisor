-- ============================================================================
-- 014 — Elastic recovery, which is what "it went out of shape" means
--
--   elastic_recovery  %   the fraction of an imposed extension that comes back
--
-- A garment is not pulled once to breaking. It is pulled a few per cent,
-- thousands of times, at the elbow and the knee and the seat. What decides
-- whether it still fits is not tenacity but how much of each pull is returned,
-- and the fibres separate on that in an order no strength table predicts.
--
-- Table 15.2 measures it at three extensions and two humidities, and it is
-- stored at every one of them rather than averaged, because the COLLAPSE
-- between a 1% pull and a 5% one is the finding:
--
--                  1%    5%   10%      (60% r.h.)
--   Nylon          90    89    89      barely moves
--   Wool           99    69    51
--   Polyester      98    65    51
--   Cotton         91    52     -      falls off a cliff
--   Viscose        67    32    23      never came back at all
--
-- A cotton tee fits in the shop and not after a week because at 1% extension it
-- recovers 91% and at the strains a body actually imposes it recovers 52%. A
-- single averaged "recovery" per fibre would erase precisely that.
--
-- WHAT THIS TABLE CANNOT SAY
-- --------------------------
-- It was published in 1950 and there is no elastane in it. An elastomer at 3-5%
-- governs a fabric's recovery completely, so a verdict computed from the other
-- 95% would not merely be incomplete, it would be backwards — it would call a
-- stretch jersey a bagging risk. The engine reports the measured fibres and
-- withholds the verdict when an elastomer is present.
--
-- Table 15.1 comes with it: the yield point, beyond which recovery stops being
-- complete, read two ways. The book observes that the stress-strain values run
-- higher than the recovery ones, and every row bears it out, which is what the
-- reader checks each row against.
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

    WHEN 'tenacity_sd'        THEN coalesce(value, value_min) BETWEEN 0 AND 6.0
    WHEN 'cv_fineness'            THEN coalesce(value, value_min) BETWEEN 0 AND 100
    WHEN 'cv_breaking_load'       THEN coalesce(value, value_min) BETWEEN 0 AND 100
    WHEN 'cv_tenacity'            THEN coalesce(value, value_min) BETWEEN 0 AND 100
    WHEN 'cv_breaking_extension'  THEN coalesce(value, value_min) BETWEEN 0 AND 100

    WHEN 'friction_static'           THEN coalesce(value, value_max) BETWEEN 0 AND 2.0
    WHEN 'friction_kinetic'          THEN coalesce(value, value_max) BETWEEN 0 AND 2.0
    WHEN 'friction_crossed_fibres'   THEN coalesce(value, value_max) BETWEEN 0 AND 2.0
    WHEN 'friction_parallel_fibres'  THEN coalesce(value, value_max) BETWEEN 0 AND 2.0
    WHEN 'friction_over_guide'       THEN coalesce(value, value_max) BETWEEN 0 AND 2.0

    -- Light does not travel faster inside a fibre than in vacuum, so an index
    -- is above 1; nothing organic here reaches 2. Polyester is the highest at
    -- 1.725.
    WHEN 'refractive_index_parallel'      THEN coalesce(value, value_min) BETWEEN 1.0 AND 2.0
    WHEN 'refractive_index_perpendicular' THEN coalesce(value, value_min) BETWEEN 1.0 AND 2.0
    -- The one signed property in this table. See the note above.
    WHEN 'birefringence'      THEN coalesce(value, value_min) BETWEEN -0.5 AND 0.5
    -- A ratio of a long axis to a short one cannot be under 1.
    WHEN 'fibre_ellipticity'  THEN coalesce(value, value_min) BETWEEN 1.0 AND 10.0
    WHEN 'lustre'             THEN coalesce(value, value_min) BETWEEN 0 AND 100
    WHEN 'convolutions_per_cm' THEN coalesce(value, value_min) BETWEEN 0 AND 100
    -- A recovery is the fraction of an imposed extension that comes back.
    WHEN 'elastic_recovery'   THEN coalesce(value, value_min) BETWEEN 0 AND 100
    ELSE true
  END);
