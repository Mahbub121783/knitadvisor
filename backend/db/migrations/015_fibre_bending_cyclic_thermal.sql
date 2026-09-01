-- ============================================================================
-- 015 — Bending, twisting, repeated loading, and heat
--
-- Three chapters that answer questions this engine has been answering from
-- constants with no source at all.
--
-- HOW MUCH WILL IT SPIRAL (ch 17, Table 17.2, p.421)
-- --------------------------------------------------
-- Torsional rigidity is the resistance to twisting, and a single jersey spirals
-- because the residual torque in the yarn is never fully taken out. Cotton at
-- 0.16 mN mm2/tex2 is four times as stiff in torsion as nylon at 0.041, which
-- is why cotton jersey spirality is a standing complaint and nylon's is not.
-- `torque_idx` in yarn-engine has always been a per-spinning-system guess.
--
-- Every row satisfies torsional < flexural, which is physics rather than
-- coincidence — the shear modulus of a solid is always below its tensile one —
-- so the reader holds every row to it. It is also the one mistake the table
-- invites, the two columns being the same units in the same format.
--
-- Tables 17.1 and 17.2 BOTH give flexural rigidity and DISAGREE: Finlayson puts
-- silk at 0.19 and the later work at 0.60. Both are stored under their own
-- pages. The disagreement is the honest state of the measurement.
--
-- WHAT A LOOP COSTS (ch 17, Table 17.3, p.425)
-- --------------------------------------------
-- A yarn in a knitted fabric is not straight. It is bent round a needle and
-- pulled, and the outside of that bend carries far more than its share. Table
-- 17.3 measures the strength of a looped yarn as a percentage of the same yarn
-- pulled straight: cotton keeps 91%, viscose keeps 58%. Every strength figure
-- this engine quotes is a straight-pull figure, and for a knit that is the
-- wrong geometry.
--
-- WHAT REPEATED LOADING LEAVES BEHIND (ch 16, Table 16.1, p.369)
-- --------------------------------------------------------------
-- Elastic recovery says what happens when a fabric is stretched once. A garment
-- is not stretched once. Cycling to 2% extension, nylon has accumulated 0.28%
-- by cycle 10 and cotton 1.98% — seven times, from identical treatment. That is
-- the difference between "it fits in the shop" and "it fits after a fortnight".
--
-- HEAT (ch 6, Tables 6.2 p.173 and 6.5 p.176)
-- -------------------------------------------
-- Nylon and polyester have a NEGATIVE coefficient of linear expansion: heated,
-- they get shorter, while every other fibre lengthens. That is why polyester
-- has to be heat set and why it leaves the stenter narrower than it arrived.
-- The book prints the minus as a separate word — "- 3" — and read naively it
-- becomes an empty cell followed by +3, reversing the physics in silence. This
-- is the one property in this table where a value below zero is the finding.
--
-- And packed to equal bulk density, cotton conducts 71 mW/(m K), wool 54, silk
-- 50 — so wool is warmer at equal weight, not only because it traps more air.
-- Still air is 25, which is the other half of the story: most of a fabric's
-- warmth is the air in it.
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
    ELSE true
  END);
