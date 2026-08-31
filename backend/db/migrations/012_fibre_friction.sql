-- ============================================================================
-- 012 — Friction, which is what holds a fabric together at all
--
-- Chapter 3 states it plainly: "a fabric is a discontinuous solid, which is
-- held together by friction and utilises the strength of the millions of
-- separate fibres." Every other property stored here describes a fibre on its
-- own. This one describes two surfaces touching, and without it the fabric in
-- the engine is a collection of fibres that have no reason to stay together.
--
--   friction_static           1   the force needed to START a slide
--   friction_kinetic          1   the force needed to KEEP it going
--   friction_crossed_fibres   1   fibre over fibre at an angle
--   friction_parallel_fibres  1   fibre over fibre lying along it
--   friction_over_guide       1   yarn running over a machine part
--
-- All dimensionless: a force divided by a force.
--
-- WHY THESE ROWS CARRY A COUNTERFACE IN `condition`
-- ------------------------------------------------
-- Friction is not a property of a fibre. There is no such thing as "the
-- friction of wool" — only the friction of wool on wool, or wool on rayon, or
-- wool on a steel guide, and they are 0.13, 0.11 and something else again. So
-- `fibre_slug` is the fibre being rubbed and `condition` names what it is being
-- rubbed against. A query for wool's friction gets every contact it was
-- measured in, and none of them pretends the counterface was not there.
--
-- WOOL FELTS BECAUSE ITS FRICTION HAS A DIRECTION
-- -----------------------------------------------
-- Wool on wool with the scales: 0.13 static. Against them: 0.61. Nearly five
-- times, from the same fibre in the same contact, differing only in which way
-- it is moving. Under agitation it can therefore slide one way and not the
-- other, so it ratchets root-first and the mass consolidates. That is felting,
-- entire, in two numbers — and no other fibre in the book has a directional
-- friction at all, which is why no other fibre felts.
--
-- It survives the counterface too: wool on rayon is 0.11 with the scales and
-- 0.39 against, wool on nylon 0.26 and 0.43. The direction is in the wool, not
-- in the pair.
--
-- STICK-SLIP
-- ----------
-- Static friction always exceeds kinetic, and the gap between them is how
-- violently a yarn grabs and releases as it runs. Nylon on nylon is 0.47 and
-- 0.40, a ratio of 1.18. Wool against its scales is 0.61 and 0.38, a ratio of
-- 1.61. Unsteady tension at the needle is unsteady stitch length, so the ratio
-- is worth having beside the friction itself.
--
-- GUIDE MATERIAL
-- --------------
-- Steel and porcelain give a higher friction than a fibre pulley or ceramic for
-- every yarn in Table 25.6(b), without exception. The size of the penalty is
-- fibre-dependent and not a flat factor: comparing the best hard guide with the
-- worst soft one it runs from 1.08 for viscose to 1.90 for bright acetate,
-- which at 0.38 over steel against 0.19 over a pulley is exactly double.
-- Between pulley and ceramic there is no consistent winner, and nothing here
-- should be read as saying there is.
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

    -- A coefficient of friction is not bounded by 1 in general — rubber on
    -- rubber exceeds it — but nothing in a textile contact comes near 2. The
    -- highest in the book is wool against its own scales at 0.61, so a figure
    -- above 2 is a units slip and not a surprising fibre.
    WHEN 'friction_static'           THEN coalesce(value, value_max) BETWEEN 0 AND 2.0
    WHEN 'friction_kinetic'          THEN coalesce(value, value_max) BETWEEN 0 AND 2.0
    WHEN 'friction_crossed_fibres'   THEN coalesce(value, value_max) BETWEEN 0 AND 2.0
    WHEN 'friction_parallel_fibres'  THEN coalesce(value, value_max) BETWEEN 0 AND 2.0
    WHEN 'friction_over_guide'       THEN coalesce(value, value_max) BETWEEN 0 AND 2.0
    ELSE true
  END);
