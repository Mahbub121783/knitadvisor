/**
 * KnitAdvisor — Factory R&D Calibration Dataset
 * =============================================
 *
 * The FULL parsed dataset from the real factory ERP R&D Master File (2711
 * greige→finish rows, Bangladesh knitting/RMG, 2022 — "New ERP R&D Master
 * File-2022.xlsx" at the repo root). Loaded from backend/data/factory-records.json,
 * built by backend/scripts/build-factory-dataset.js.
 *
 * The raw file contains ~510 rows that aren't usable body-fabric records
 * (collar/cuff/tape/drawstring trims, or missing GSM/yarn-count/stitch-length/
 * finished-GSM) — those are dropped by the build script (see its printed
 * coverage report), leaving ~2200 real, usable greige→finish records for the
 * nearest-neighbour engine (factory-match.js) to search — not a hand-picked
 * illustrative sample.
 *
 * Each record links the inputs a knitter sets to the measured outputs:
 *   inputs  : fabric category, fibre class, yarn count, spinning, gauge, dia,
 *             target/grey GSM, colour segment
 *   outputs : body stitch length (mm), finished open width / dia (inch),
 *             finished GSM (after dyeing + finishing)
 *
 * Field keys (compact to keep the table readable):
 *   fab  : single_jersey | rib | pique | interlock | fleece | terry | waffle | heavy_jersey
 *   comp : cotton | cvc | pc | modal | viscose      (dominant fibre class)
 *   ne   : yarn count (Ne); for multi-yarn structures = the ground/face count
 *   spin : combed | carded | compact | rotor | slub | combed_lycra | carded_lycra
 *   g    : machine gauge (needles/inch)
 *   dia  : machine cylinder diameter (inch)
 *   gsm  : target / grey GSM
 *   seg  : dark | medium | light   (colour segment — drives dye-uptake GSM gain)
 *   sl   : body stitch length (mm)  — the ground-loop SL for multi-yarn fabrics
 *   fdia : finished open width (inch)  — what the fabric measures after finishing
 *   fgsm : finished GSM (after dyeing + compacting)
 *
 * Source: factory ERP R&D Master File 2022. Real measured data.
 */

'use strict';

const FACTORY_RECORDS = require('../data/factory-records.json');

// Fabric-category aliases → dataset `fab` key (so calculator fabric IDs map in).
// Expanded to cover the full fabric-derivatives catalogue, mapping each
// structure to its nearest data-bearing family.
const FAB_ALIAS = {
  // single-bed plain & structured → single_jersey
  single_jersey: 'single_jersey', sj: 'single_jersey',
  plated_jersey: 'single_jersey', single_jacquard: 'single_jersey',
  single_cross_tuck: 'single_jersey', knitted_twill: 'single_jersey',
  knitted_crepe: 'single_jersey', mock_rib: 'single_jersey',
  pointelle: 'single_jersey', pointelle_eyelet: 'single_jersey', pointelle_chevron: 'single_jersey',
  blister_single: 'single_jersey', relief_single: 'single_jersey',
  // rib family (incl. cardigan/milano interlock-rib structures)
  rib_1x1: 'rib', rib_2x2: 'rib', rib_2x1: 'rib', rib_3x3: 'rib', rib_3x2: 'rib', rib_4x1: 'rib',
  lycra_rib_1x1: 'rib', lycra_rib_2x2: 'rib', rib: 'rib',
  half_cardigan: 'rib', full_cardigan: 'rib', half_milano: 'rib', full_milano: 'rib',
  drop_needle_rib: 'rib',
  // pique / lacoste
  pique_single: 'pique', pique_double: 'pique', lacoste_single: 'pique', lacoste_double: 'pique',
  lacoste_pique: 'pique', texipique: 'pique', pique: 'pique',
  // interlock & double-knit family
  interlock: 'interlock', ponte_di_roma: 'interlock', eight_lock: 'interlock',
  swiss_double_pique: 'interlock', french_double_pique: 'interlock',
  gabardine_double: 'interlock', poplin_double: 'interlock', bourrelet: 'interlock',
  // fleece / terry
  fleece_2_thread: 'fleece', fleece_3_thread: 'fleece', fleece_diagonal: 'fleece', fleece: 'fleece',
  french_terry: 'terry', terry_fabric: 'terry', terry: 'terry',
  // misc
  waffle: 'waffle',
  heavy_jersey: 'heavy_jersey',
};

module.exports = { FACTORY_RECORDS, FAB_ALIAS };
