-- ============================================================================
-- 007 — Correct the Morton & Hearle scope note
--
-- 006 recorded that this book "carries nothing on yarn structure, knit loop
-- geometry or fabric construction". The first two are right. The third is not,
-- and the error is exactly the kind the column exists to prevent.
--
-- Chapter 9, on the rate of moisture absorption, tests real fabrics and prints
-- their construction. Table 9.3 (p.220) gives four double jersey fabrics —
-- wool, cotton, acrylic and polypropylene — with fibre diameter, yarn tex,
-- fabric weight (272-287 g/m2), thickness, and the two diffusion coefficients
-- fitted to each. Chapter 10 does the same for liquid water retention.
--
-- A scope note that says "nothing here" is read as permission to stop looking.
-- Overstating it turns the note from a signpost into a wrong turn, so it is
-- corrected rather than left to be discovered by someone who trusted it.
--
-- The note is updated in a new migration rather than by editing 006, because
-- 006 has already run: db/migrate.js checksums applied files and would refuse
-- every later migration if one changed underneath it.
-- ============================================================================

UPDATE reference_sources
   SET scope_note =
     'Fibre properties. The authors say so in the first preface: it was conceived as the first of a trilogy and the companion volumes on yarns and fabrics were never written, so there is no yarn structure and no knit or woven construction theory here — do not look for Munden constants or a K/T/M grid. But it is not free of fabric DATA: the moisture-transport chapters test real cloth and print its construction, notably Table 9.3 (p.220), four double jersey fabrics in wool, cotton, acrylic and polypropylene at 272-287 g/m2 with fibre diameter, yarn tex, thickness and fitted diffusion coefficients. Within fibres it is thorough: 25 chapters covering fineness, length, density, thermal behaviour, six chapters on moisture, eight on mechanical properties, and chapters on dielectric, electrical, optical and frictional behaviour.'
 WHERE key = 'morton_hearle_2008';
