-- ============================================================================
-- 016 — What heat does: the ceiling, and the slow damage below it
--
--   melting_point          degree C   where the fibre stops being a fibre
--   strength_retained_pct  %          of ORIGINAL strength, after long exposure
--
-- THE CEILING IS NOT ONE NUMBER PER GENERIC NAME. Nylon 6 melts at 215 C and
-- nylon 6.6 at 260 — the same generic fibre, forty-five degrees apart — so
-- "nylon" is not a stenter setting. Polypropylene melts at 170, below where
-- polyester is normally set, so the two cannot share a frame at all.
--
-- AND MOST FIBRES HAVE NO MELTING POINT. The line printed under Table 18.1 is
-- as important as the table: "Cellulosic and protein fibres decompose before
-- melting". Cotton, wool, silk and the rayons do not melt, they char. So a
-- setting temperature chosen for the synthetic in a blend is ENDURED by the
-- natural fibre, never shared with it — and that is what Table 18.3 measures.
--
-- SLOW HEAT IS THE MORE USEFUL QUESTION. A fabric is not held at its melting
-- point; it is held for hours at 100 to 130 C in drying, setting and storage.
-- Over eighty days at 130 C:
--
--   Glass       100%      Polyester    75%      Acrylic  55%
--   Viscose      32%      Nylon        13%      Linen    12%
--   Cotton       10%
--
-- That ordering is not the melting-point ordering, and it is the one that
-- decides whether a blend survives a hot finishing route. Damage accumulates in
-- both directions — longer is never kinder, and hotter is never kinder — and
-- every row obeys both, so the reader holds them to it. Four columns of the
-- same quantity at four conditions is exactly the shape that gets read out of
-- order without anybody noticing.
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
    -- Chapter 17: bending and twisting, per tex squared so a fibre's stiffness
    -- can be compared independently of how fine it happens to be.
    WHEN 'specific_flexural_rigidity'  THEN coalesce(value, value_min) BETWEEN 0 AND 10
    WHEN 'specific_torsional_rigidity' THEN coalesce(value, value_min) BETWEEN 0 AND 10
    WHEN 'fibre_shape_factor'   THEN coalesce(value, value_min) BETWEEN 0 AND 1.5
    WHEN 'bending_modulus'      THEN coalesce(value, value_min) BETWEEN 0 AND 1000
    WHEN 'tensile_modulus_gpa'  THEN coalesce(value, value_min) BETWEEN 0 AND 1000
    WHEN 'shear_modulus'        THEN coalesce(value, value_min) BETWEEN 0 AND 100
    -- A looped or knotted yarn cannot be stronger than the same yarn pulled
    -- straight, so these are percentages that cannot exceed 100.
    WHEN 'loop_strength_pct'    THEN coalesce(value, value_max) BETWEEN 0 AND 100
    WHEN 'knot_strength_pct'    THEN coalesce(value, value_max) BETWEEN 0 AND 100

    -- Chapter 16: what repeated loading leaves behind.
    WHEN 'cyclic_extension_growth_pct' THEN coalesce(value, value_max) BETWEEN 0 AND 50
    WHEN 'cyclic_stress_mn_tex' THEN coalesce(value, value_min) BETWEEN 0 AND 2000

    -- Chapter 6. Conductivity is positive and of the order of still air, which
    -- the book gives as 25 mW/(m K).
    WHEN 'thermal_conductivity'  THEN coalesce(value, value_min) BETWEEN 0 AND 500
    -- Linear expansion is SIGNED and that is the whole point of storing it:
    -- nylon and polyester CONTRACT on heating while everything else lengthens.
    -- A positive-only bound here would have silently reversed the physics
    -- behind heat setting.
    WHEN 'linear_expansion_axial' THEN coalesce(value, value_min) BETWEEN -100 AND 100
    -- Chapter 18. No textile fibre melts below 100 C or above 400; the highest
    -- in the book is cellulose triacetate at 300.
    WHEN 'melting_point'         THEN coalesce(value, value_min) BETWEEN 80 AND 400
    -- A percentage of the fibre's ORIGINAL strength: heat does not make a fibre
    -- stronger over eighty days.
    WHEN 'strength_retained_pct' THEN coalesce(value, value_max) BETWEEN 0 AND 100
    ELSE true
  END);
