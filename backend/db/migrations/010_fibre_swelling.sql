-- ============================================================================
-- 010 — Swelling, and a range that is a disagreement rather than an uncertainty
--
-- Chapter 13 said what water does to a fibre's strength and stiffness. Chapter
-- 11 says what it does to its size, and the two together are the whole of why
-- a wet fabric behaves unlike a dry one.
--
--   transverse_swelling_diameter  %   across the fibre, measured as a diameter
--   transverse_swelling_area      %   across the fibre, measured as an area
--   axial_swelling                %   along it
--   volume_swelling               %
--
-- The numbers are larger than most people expect. Viscose rayon swells 50-114%
-- in cross-sectional AREA and 74-127% by volume in water — it roughly doubles —
-- against 3.7-4.8% along its length. Cotton is 21-42% in area. Nylon is
-- 1.6-3.2%. That anisotropy, enormous across and negligible along, is the
-- mechanism a knitted fabric expresses as width movement while the length
-- broadly holds: the yarn gets thicker, the loop has to take it up, and the
-- structure gives way in the direction that has the least resistance.
--
-- This is NOT shrinkage and no query should read it as one. A fibre swelling
-- 50% in area makes the yarn thicker; how much of that reaches the cloth
-- depends on the structure, the tension and the drying. The engine's shrinkage
-- factors are unchanged. This says why shrinkage happens, not how much.
--
-- WHY THE RANGES ARE WIDE, WHICH MATTERS FOR ANYONE QUERYING THEM
-- ---------------------------------------------------------------
-- Everywhere else in this table a value_min/value_max pair is a range the book
-- printed as a range: one measurement, reported with its uncertainty. Table
-- 11.1 is not that. It collects results from several independent workers and
-- prints them side by side in one cell — viscose's volume swelling is nine
-- separate published figures, 74 through 127 — and the paragraph above the
-- table says plainly that "there are considerable discrepancies in the values
-- of a given quantity obtained by different people".
--
-- So the spread stored for these four properties is a disagreement between
-- laboratories, not the precision of one. Collapsing it to a mean would state a
-- confidence the source explicitly disclaims. Every individual figure is kept
-- in `note` so the range can always be taken apart again.
--
-- ONE ROW LOOKS IMPOSSIBLE AND IS NOT
-- -----------------------------------
-- Acetate swells 9-14% by diameter and only 6-8% by area. For a circular fibre
-- that cannot happen. Acetate is not circular, and section 11.2.3 says so
-- directly: diameter swelling "is not a sound way of expressing transverse
-- swelling of a fibre with an irregular cross-section, since it will vary
-- according to the position in which the 'diameter' is drawn". The row is
-- stored as printed. It is the book's own worked example of why the area
-- figure is the one to use.
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

    -- The largest in the book is viscose at 127% by volume. A fibre that
    -- swelled 300% would have to be a gel, so the ceiling is there to catch a
    -- ratio that was never turned into a percentage, not to judge a fibre.
    WHEN 'transverse_swelling_diameter' THEN coalesce(value, value_max) BETWEEN 0 AND 300
    WHEN 'transverse_swelling_area'     THEN coalesce(value, value_max) BETWEEN 0 AND 300
    WHEN 'axial_swelling'               THEN coalesce(value, value_max) BETWEEN 0 AND 300
    WHEN 'volume_swelling'              THEN coalesce(value, value_max) BETWEEN 0 AND 300
    ELSE true
  END);
