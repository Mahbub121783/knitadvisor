-- ============================================================================
-- 018 — The heat moisture releases, the water a machine leaves, and the fold
--
--   heat_of_sorption      kJ/kg    released going from 40% to 70% r.h.
--   water_retained        %        as a regain, after suction or centrifuging
--   flex_fatigue_life     cycles   bends survived before failure
--
-- WARM WHEN DAMP, MEASURED (ch 8, Table 8.5, p.200). A fibre taking up water
-- gives out heat. Over the swing from a heated room to a damp day, a kilogram
-- of wool releases 159 kJ and a kilogram of polyester releases 4 — forty times.
-- That is the measured basis of a claim usually made by assertion: a wool
-- garment feels warm coming in from the cold because it is actually warming.
-- And VISCOSE BEATS WOOL at 168 kJ, which is worth storing precisely because
-- nobody sells viscose on warmth.
--
-- WHAT THE DRYER HAS TO PAY FOR (ch 10, Table 10.1, p.231). Everything else
-- about moisture in this book is vapour; this is liquid water, still in the
-- cloth after the hydro-extractor. After centrifuging, viscose carries 103% of
-- its own weight and cotton carries 48%. Same machine, same setting, more than
-- twice the water into the dryer.
--
-- Wool is the second lesson: 133% left by suction and 45% by centrifuging. The
-- water wool holds is BETWEEN the fibres rather than in them, so mechanical
-- force throws it out where a pressure difference cannot. Centrifuging leaves
-- no more than suction in any row of the table, which is what the reader holds
-- each row to.
--
-- THE FOLD (ch 19, Table 19.4, p.534). Abrasion wears a fabric from outside;
-- flex fatigue breaks it from inside, at a crease, and that is what finishes a
-- collar or a knee long before anything wears through. Nylon 6 survives 35,825
-- bends, nylon 6.6 104,807, polyester 194,616 — five times, and not the
-- ordering that tenacity or abrasion resistance would predict.
--
-- The lower bound of 1000 on that column is not cosmetic. The book sets these
-- numbers with a thousands SPACE, so a reader taking tokens as it finds them
-- stores 35 and then 825, and a fatigue life of thirty-five thousand becomes
-- thirty-five — which sits quite plausibly beside a bending strain of 16.1 and
-- would never be questioned. The constraint makes that particular thousandfold
-- error impossible to store.
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
    -- Chapter 22. Resistance is stored as its base-ten logarithm because it
    -- spans eight orders of magnitude across these fibres.
    WHEN 'log_resistance'                   THEN coalesce(value, value_min) BETWEEN 0 AND 25
    WHEN 'log_resistance_at_10pct_moisture' THEN coalesce(value, value_min) BETWEEN 0 AND 25
    WHEN 'resistance_moisture_slope'        THEN coalesce(value, value_min) BETWEEN 0 AND 50
    WHEN 'rh_for_static_threshold'          THEN coalesce(value, value_min) BETWEEN 0 AND 100
    -- Chapter 8. Absorbing water RELEASES heat, so this is positive; the most
    -- absorbent fibre in the book holds about a fifth of its weight, which puts
    -- a few hundred kilojoules per kilogram at the ceiling.
    WHEN 'heat_of_sorption'      THEN coalesce(value, value_min) BETWEEN 0 AND 500
    -- Chapter 10. Retained water as a REGAIN, so it may exceed 100%: loose wool
    -- holds a third more than its own weight after suction.
    WHEN 'water_retained'        THEN coalesce(value, value_min) BETWEEN 0 AND 400
    -- Chapter 19. Six-figure cycle counts. The lower bound is the real check:
    -- the book sets these with a thousands SPACE, and a reader that does not
    -- join it stores 35 where the page says 35,825.
    WHEN 'flex_fatigue_life'     THEN coalesce(value, value_min) BETWEEN 1000 AND 10000000
    WHEN 'flex_bending_strain'   THEN coalesce(value, value_min) BETWEEN 0 AND 100
    WHEN 'flex_specific_stress'  THEN coalesce(value, value_min) BETWEEN 0 AND 2000
    WHEN 'fibre_linear_density'  THEN coalesce(value, value_min) BETWEEN 0 AND 1000
    WHEN 'cv_flex_fatigue_life'  THEN coalesce(value, value_min) BETWEEN 0 AND 200
    ELSE true
  END);
