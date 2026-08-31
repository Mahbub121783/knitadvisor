-- ============================================================================
-- 013 — Optical properties, and one thing they turn out NOT to explain
--
--   refractive_index_parallel       1      light polarised along the fibre
--   refractive_index_perpendicular  1      light polarised across it
--   birefringence                   1      the difference, and it can be NEGATIVE
--   fibre_ellipticity               1      long axis over short axis of the section
--   lustre                          arb.   Adderley's relative scale
--   convolutions_per_cm             1/cm   cotton's natural twists
--
-- BIREFRINGENCE IS SIGNED
-- -----------------------
-- It is n(parallel) minus n(perpendicular), so it measures how well the polymer
-- chains line up with the fibre axis. Polyester reaches 0.188, four times
-- cotton's 0.046, and chapter 13 shows it correlating with cotton's tenacity
-- better than fineness does. Triacetate (-0.005) and Acrilan (-0.004) come out
-- NEGATIVE: their chains lie across the fibre rather than along it. That is a
-- real measurement and not a sign error, so this property is the one place in
-- this table where a value below zero has to be allowed.
--
-- WHAT LUSTRE IS, AND WHAT IT IS NOT
-- ----------------------------------
-- It would be natural to expect a lustrous fibre to be one that reflects more
-- light, and therefore to read lustre off the refractive index. It does not
-- work. Fresnel reflectance at normal incidence is ((n-1)/(n+1))², and across
-- every fibre in Table 24.3 that spans 0.036 to 0.053 — a factor of 1.46, where
-- the difference between a matte cotton and a lustrous silk is enormous. The
-- ordering is wrong too: cotton's mean index of 1.547 reflects slightly MORE
-- than nylon's 1.540.
--
-- Table 24.5 shows what lustre actually tracks, in cotton at least: the
-- ellipticity of the cross-section, and — the book is explicit — "no
-- correlation was found between lustre and fibre length, linear density,
-- diameter". American FGM at a/b = 3.07 measures 5.7; mercerised cotton at 1.47
-- measures 13.9. Mercerisation removes the convolutions and rounds the section,
-- and the lustre follows. Two and a half times, from geometry alone.
--
-- This is why the `sheen` constants in fabric-physics.js are left alone and
-- labelled as rendering parameters rather than being "corrected" from these
-- indices. The measurement is stored here; the appearance model is not claimed
-- to descend from it.
--
-- The fifteen cottons of Table 24.5 are fifteen VARIETIES, not fifteen fibres,
-- so they file under `cotton` with the variety in `condition`. The series is
-- the finding; no single row is.
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
    ELSE true
  END);
