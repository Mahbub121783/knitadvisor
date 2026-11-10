/**
 * Published warp-knit constructions used to check the warp studio
 * (tests/studio_warp_literature.test.js, tools/warp-audit.js). Every number
 * is as printed in the source; the conversions are noted.
 *
 *   NYLON TRICOT — US 4,015,451 / US 4,020,654 (Examples I–V): 30-denier
 *   nylon (10 or 18 filaments), fully threaded 2-bar tricot, E28 (Example I)
 *   and E32. Lappings as the patents define them:
 *     Jersey           front 2-3/1-0, back 1-0/1-2
 *     Delaware         front 2-3/1-0, back 1-0/0-1
 *     Modified Jersey  front 1-0/2-3, back 2-3/1-0
 *   runner  inches per rack (480 courses), front / back
 *   quality inches of fabric per rack on the machine → courses/inch = 480 / quality
 *   counts  wales × courses per inch; weight oz/yd² (× 33.906 = g/m²)
 *
 *   ELASTIC LOCKNIT — US 9,347,157 / EP 2,804,972 (Table 1): E32, 130",
 *   front 2-3/1-0 PTT 50 d/24 f, back 1-0/1-2 spandex 40 d; run-in mm/rack
 *   for each bar, knit density courses/cm, spandex total draft (beam draft
 *   1.7 included). Greige width 140–150 cm off 330 cm; pre-heat-set widens
 *   20–30 %; basis weight 180–250 g/m².
 */
'use strict';

const STITCH = {
  jersey: ['2-3/1-0//', '1-0/1-2//'],
  delaware: ['2-3/1-0//', '1-0/0-1//'],
  modified_jersey: ['1-0/2-3//', '2-3/1-0//'],
};

// [id, gauge, stitch, runner front, runner back (in/rack), quality (in), greige W, C, oz, finished W, C, oz]
const NYLON_TRICOT = [
  ['I-A', 28, 'modified_jersey', 72.5, 57.5, 8, 39, 51, 2.22, 45, 41, 1.85],
  ['I-B', 28, 'modified_jersey', 72.5, 55, 10, 39, 53, 2.25, 45, 45, 2.12],
  ['I-C', 28, 'jersey', 70, 56.25, 10, 40, 50, 2.15, 46, 44, 2.18],
  ['II-A', 32, 'jersey', 58, 42, 8, 41, 60, 2.07, 46, 62, 2.45],
  ['II-B', 32, 'delaware', 50, 36.5, 6, 34, 86, 2.22, 42, 85, 2.64],
  ['II-C', 32, 'delaware', 48, 36, 5.5, 35, 95, 2.33, 40, 93, 2.72],
  ['III-C', 32, 'delaware', 60, 41, 8, 35, 65, 1.94, 36, 65, 2.05],
  ['III-D', 32, 'jersey', 63, 46, 9.75, 44, 50, 2.10, 38, 50, 1.61],
  ['IV-A', 32, 'delaware', 64, 39, 7.75, 34, 64, 1.88, 36, 70, 2.30],
  ['IV-B', 32, 'jersey', 60.75, 43.5, 7.75, 39, 60, 2.20, 47, 62, 2.48],
  ['IV-C', 32, 'delaware', 68, 42, 9, 32, 56, 1.74, 35, 62, 2.17],
  ['IV-D', 32, 'delaware', 58, 34.25, 6.88, 32, 74, 2.03, 34, 87, 2.73],
  ['V-A', 32, 'delaware', 64, 39, 7.75, 37, 67, 2.29, 41, 82, 3.07],
  ['V-B', 32, 'jersey', 60.75, 43.5, 7.75, 36, 64, 2.28, 48, 66, 2.68],
  ['V-C', 32, 'delaware', 68, 42, 9, 37, 60, 2.07, 41, 70, 2.65],
].map(([id, gauge, stitch, rf, rb, q, gW, gC, gOz, fW, fC, fOz]) => ({
  id, gauge, stitch, notations: STITCH[stitch], denier: 30,
  runner_mm: [rf * 25.4, rb * 25.4], cpc_machine: 480 / q / 2.54,
  greige: { wpc: gW / 2.54, cpc: gC / 2.54, gsm: gOz * 33.906 },
  finished: { wpc: fW / 2.54, cpc: fC / 2.54, gsm: fOz * 33.906 },
}));

// [run-in PTT, run-in spandex (mm/rack), courses/cm, spandex total draft]
const ELASTIC_LOCKNIT = [
  [1550, 750, 25, 2.6], [1450, 700, 30, 2.6], [1500, 700, 30, 2.7], [1400, 650, 25, 2.8], [1650, 750, 18, 2.8], [1450, 620, 30, 3.0],
  [1540, 650, 20, 3.0], [1550, 650, 25, 3.0], [1550, 650, 25, 3.0], [1580, 620, 20, 3.3], [1580, 600, 25, 3.4], [1400, 530, 30, 3.4],
  [1400, 500, 30, 3.6], [1500, 530, 30, 3.6], [1450, 510, 25, 3.6], [1645, 530, 18, 4.0],
].map(([ptt, sp, cpc, td], k) => ({
  id: `E${k + 1}`, gauge: 32, notations: ['2-3/1-0//', '1-0/1-2//'], front: { denier: 50, fibre: 'polyester_filament' }, back: { denier: 40, fibre: 'elastane' },
  runin_mm: [ptt, sp], cpc_machine: cpc, total_draft: td, beam_draft: 1.7,
}));

module.exports = { NYLON_TRICOT, ELASTIC_LOCKNIT, STITCH };
