-- ============================================================================
-- 009 — Tensile properties, and the elastomer that broke the fibre classes
--
-- Chapter 13 of Morton & Hearle is the first chapter that measures what a
-- fibre DOES rather than what it is. Up to here the reference layer has held
-- density, specific volume and regain: three numbers that describe a fibre
-- sitting still. Tensile properties describe it being pulled apart, and they
-- are what a fabric is actually asked to survive.
--
-- Four quantities, all specific — that is, divided by linear density rather
-- than by area, because a fibre's cross-section is neither round nor constant
-- and its mass per unit length is what is really measured:
--
--   tenacity           N/tex     the specific stress it breaks at
--   breaking_extension %         how far it stretches before it does
--   work_of_rupture    mN/tex    the area under the stress-strain curve; the
--                                energy it absorbs on the way to breaking,
--                                which is toughness rather than strength
--   initial_modulus    N/tex     the slope at the origin; stiffness, and the
--                                nearest measured thing to fabric handle
--   yield_stress       mN/tex    where the curve turns over
--   yield_strain       %
--   work_factor        1         work of rupture as a fraction of tenacity x
--                                extension; the shape of the curve in one
--                                number
--
-- and then the ones with no equivalent anywhere in the engine today:
--
--   tenacity_ratio            1  wet against conditioned, and wet-hot against
--   breaking_extension_ratio  1  wet-cold. Table 13.7.
--   work_of_rupture_ratio     1
--   initial_modulus_ratio     1
--
-- The ratios are the reason this migration exists at all. Viscose rayon at
-- 65% r.h. and viscose rayon wet are, mechanically, two different fibres: it
-- keeps half its tenacity and THREE PER CENT of its initial modulus. A knit
-- made of it has no resistance to the tension a dyeing machine puts on it
-- while it is wet, which is why viscose single jersey comes back from the
-- dyehouse narrower and longer than it went in and why the same machine
-- settings that work for cotton do not work for it. The engine has never been
-- able to say that, because it has never had a number for it.
--
-- Cotton goes the other way — 1.11, stronger wet than dry — which is why it
-- survives rope dyeing, and polyester and polypropylene are flat at 1.00,
-- which is why they do not care.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Elastane finally has a class of its own.
--
-- 006 classified fibres into cellulose, protein, polyamide, polyester, vinyl,
-- polyolefin, high_performance, carbon, inorganic and other. Elastane went in
-- as 'other', which was defensible while the table held only densities.
--
-- It is not defensible now. Table 13.2 gives the polyurethane elastomer a
-- breaking extension of 540% against nylon's 20 and a tenacity of 0.031 N/tex
-- against nylon's 0.48 — an order of magnitude apart on both, in opposite
-- directions. Grouping that with PTFE and melamine under 'other' would make
-- any query that filters by class meaningless for the one fibre whose
-- mechanical behaviour is most unlike everything else in the book.
-- ---------------------------------------------------------------------------
ALTER TABLE fibres DROP CONSTRAINT IF EXISTS fibres_class;
ALTER TABLE fibres ADD CONSTRAINT fibres_class CHECK (generic_class IN (
  'cellulose', 'protein', 'polyamide', 'polyester', 'vinyl', 'polyolefin',
  'elastomer', 'high_performance', 'carbon', 'inorganic', 'other'));

-- ---------------------------------------------------------------------------
-- Physical bounds for the new properties.
--
-- These are set to reject a units slip, not to second-guess a measurement, so
-- each bound is an order of magnitude clear of the most extreme fibre the book
-- prints. The narrowest is work_factor, and that one is not a convention but a
-- definition: it is an area divided by the rectangle that encloses it, so it
-- cannot exceed 1. A value above 1 would mean the extraction had paired a work
-- of rupture with the wrong tenacity, which is exactly the failure this is here
-- to catch.
-- ---------------------------------------------------------------------------
ALTER TABLE fibre_properties DROP CONSTRAINT IF EXISTS fibre_properties_physical;
ALTER TABLE fibre_properties ADD CONSTRAINT fibre_properties_physical CHECK (
  CASE property
    WHEN 'density'            THEN coalesce(value, value_min) BETWEEN 0.5 AND 8.0
    WHEN 'specific_volume'    THEN coalesce(value, value_min) BETWEEN 0.1 AND 2.5
    WHEN 'moisture_regain'    THEN coalesce(value, value_min) BETWEEN 0 AND 100
    WHEN 'moisture_content'   THEN coalesce(value, value_max) BETWEEN 0 AND 100
    WHEN 'breaking_extension' THEN coalesce(value, value_max) BETWEEN 0 AND 1000

    -- PBO reaches 3.8 N/tex; rubber is 0.008.
    WHEN 'tenacity'           THEN coalesce(value, value_min) BETWEEN 0.001 AND 6.0
    -- Ultra-high-modulus carbon reaches 218 N/tex; rubber is 0.0026.
    WHEN 'initial_modulus'    THEN coalesce(value, value_min) BETWEEN 0.0001 AND 600
    WHEN 'work_of_rupture'    THEN coalesce(value, value_min) BETWEEN 0.01 AND 2000
    WHEN 'yield_stress'       THEN coalesce(value, value_min) BETWEEN 0 AND 5000
    WHEN 'yield_strain'       THEN coalesce(value, value_max) BETWEEN 0 AND 200
    WHEN 'work_factor'        THEN coalesce(value, value_max) BETWEEN 0.05 AND 1.0

    -- A ratio of two measurements of the same quantity. Acrylic's breaking
    -- extension in boiling water is 4.26 times its conditioned value and
    -- viscose keeps 0.02 of its initial modulus, so the band has to be wide;
    -- what it still catches is a percentage that was never divided by 100.
    WHEN 'tenacity_ratio'             THEN coalesce(value, value_min) BETWEEN 0.001 AND 10
    WHEN 'breaking_extension_ratio'   THEN coalesce(value, value_min) BETWEEN 0.001 AND 10
    WHEN 'work_of_rupture_ratio'      THEN coalesce(value, value_min) BETWEEN 0.001 AND 10
    WHEN 'initial_modulus_ratio'      THEN coalesce(value, value_min) BETWEEN 0.001 AND 10
    ELSE true
  END);

-- ---------------------------------------------------------------------------
-- What the reference layer now covers, corrected again.
--
-- 006 said the fibre layer holds "density, specific volume and regain" and 007
-- corrected its claim about fabric data. Both are now out of date: the layer
-- holds mechanical properties too, and the note that reads the scope should
-- say so rather than leaving a reader to infer it from the rows.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE fibre_properties IS
  'Measured single-fibre properties from Morton & Hearle, "Physical Properties of '
  'Textile Fibres", 4th edn 2008. One row per (fibre, property, condition, page). '
  'Chapter 5 gives density and specific volume, chapter 7 regain in its three '
  'distinct senses, chapter 13 the tensile properties and the wet/dry ratios. '
  'Every row cites the printed page of the measurement itself, not of the fibre. '
  'Values are stored exactly as printed: where the book''s own arithmetic does not '
  'close, the discrepancy is recorded in `note` and nothing is corrected to fit.';
