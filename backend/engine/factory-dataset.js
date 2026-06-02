/**
 * KnitAdvisor — Factory R&D Calibration Dataset
 * =============================================
 *
 * Curated, representative records extracted from a real factory ERP R&D Master
 * File (2700+ greige→finish rows, Bangladesh knitting/RMG, 2022). The raw file
 * contains many duplicates, collars/tapes/AOP variants and incomplete rows; this
 * dataset captures the SYSTEMATIC relationships across the parameter space so a
 * nearest-neighbour engine (factory-match.js) can return data-grounded values.
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

const FACTORY_RECORDS = [
  // ───────────────────────── SINGLE JERSEY · 100% COTTON ─────────────────────────
  { fab:'single_jersey', comp:'cotton', ne:30, spin:'combed', g:24, dia:26, gsm:150, seg:'light',  sl:2.65, fdia:64, fgsm:145 },
  { fab:'single_jersey', comp:'cotton', ne:30, spin:'combed', g:24, dia:30, gsm:150, seg:'dark',   sl:2.65, fdia:60, fgsm:155 },
  { fab:'single_jersey', comp:'cotton', ne:30, spin:'combed', g:24, dia:30, gsm:150, seg:'medium', sl:2.65, fdia:62, fgsm:156 },
  { fab:'single_jersey', comp:'cotton', ne:28, spin:'combed', g:24, dia:30, gsm:160, seg:'medium', sl:2.70, fdia:65, fgsm:150 },
  { fab:'single_jersey', comp:'cotton', ne:28, spin:'combed', g:28, dia:26, gsm:160, seg:'medium', sl:2.60, fdia:60, fgsm:155 },
  { fab:'single_jersey', comp:'cotton', ne:24, spin:'combed', g:24, dia:26, gsm:180, seg:'dark',   sl:2.85, fdia:60, fgsm:175 },
  { fab:'single_jersey', comp:'cotton', ne:24, spin:'combed', g:24, dia:26, gsm:180, seg:'light',  sl:2.85, fdia:56, fgsm:180 },
  { fab:'single_jersey', comp:'cotton', ne:24, spin:'carded', g:24, dia:30, gsm:180, seg:'dark',   sl:2.85, fdia:67, fgsm:182 },
  { fab:'single_jersey', comp:'cotton', ne:32, spin:'combed', g:24, dia:26, gsm:140, seg:'medium', sl:2.60, fdia:56, fgsm:132 },
  { fab:'single_jersey', comp:'cotton', ne:32, spin:'combed', g:28, dia:28, gsm:140, seg:'light',  sl:2.60, fdia:64, fgsm:137 },
  { fab:'single_jersey', comp:'cotton', ne:32, spin:'combed', g:24, dia:30, gsm:140, seg:'medium', sl:2.60, fdia:63, fgsm:130 },
  { fab:'single_jersey', comp:'cotton', ne:20, spin:'combed', g:24, dia:30, gsm:200, seg:'dark',   sl:2.90, fdia:69, fgsm:205 },
  { fab:'single_jersey', comp:'cotton', ne:20, spin:'combed', g:24, dia:32, gsm:200, seg:'medium', sl:2.95, fdia:72, fgsm:190 },
  { fab:'single_jersey', comp:'cotton', ne:26, spin:'carded', g:24, dia:26, gsm:160, seg:'dark',   sl:2.75, fdia:58, fgsm:156 },
  { fab:'single_jersey', comp:'cotton', ne:26, spin:'carded', g:24, dia:26, gsm:160, seg:'light',  sl:2.80, fdia:57, fgsm:150 },
  { fab:'single_jersey', comp:'cotton', ne:26, spin:'carded', g:24, dia:26, gsm:160, seg:'medium', sl:2.75, fdia:56, fgsm:154 },
  { fab:'single_jersey', comp:'cotton', ne:22, spin:'carded', g:24, dia:26, gsm:190, seg:'dark',   sl:2.90, fdia:64, fgsm:220 },
  { fab:'single_jersey', comp:'cotton', ne:18, spin:'carded', g:22, dia:36, gsm:220, seg:'light',  sl:3.10, fdia:77, fgsm:226 },
  { fab:'single_jersey', comp:'cotton', ne:34, spin:'carded', g:24, dia:30, gsm:160, seg:'medium', sl:2.70, fdia:60, fgsm:156 },
  { fab:'single_jersey', comp:'cotton', ne:16, spin:'rotor',  g:20, dia:30, gsm:240, seg:'medium', sl:3.00, fdia:69, fgsm:230 },
  { fab:'single_jersey', comp:'cotton', ne:12, spin:'rotor',  g:20, dia:36, gsm:220, seg:'medium', sl:4.30, fdia:75, fgsm:210 },

  // ───────────────── SINGLE JERSEY · COTTON + LYCRA (full/half feed) ─────────────────
  { fab:'single_jersey', comp:'cotton', ne:32, spin:'combed_lycra', g:28, dia:26, gsm:190, seg:'light',  sl:2.90, fdia:58, fgsm:189 },
  { fab:'single_jersey', comp:'cotton', ne:30, spin:'carded_lycra', g:28, dia:26, gsm:200, seg:'dark',   sl:2.90, fdia:63, fgsm:216 },
  { fab:'single_jersey', comp:'cotton', ne:34, spin:'combed_lycra', g:28, dia:26, gsm:180, seg:'medium', sl:2.90, fdia:64, fgsm:175 },
  { fab:'single_jersey', comp:'cotton', ne:40, spin:'combed_lycra', g:28, dia:26, gsm:160, seg:'medium', sl:2.85, fdia:58, fgsm:156 },
  { fab:'single_jersey', comp:'cotton', ne:36, spin:'combed_lycra', g:28, dia:26, gsm:160, seg:'dark',   sl:2.90, fdia:60, fgsm:175 },
  { fab:'single_jersey', comp:'cotton', ne:30, spin:'carded_lycra', g:28, dia:28, gsm:200, seg:'light',  sl:3.00, fdia:65, fgsm:190 },

  // ───────────────────── SINGLE JERSEY · CVC / PC / MODAL / VISCOSE ─────────────────────
  { fab:'single_jersey', comp:'cvc',     ne:30, spin:'combed', g:28, dia:26, gsm:150, seg:'medium', sl:2.70, fdia:62, fgsm:150 },
  { fab:'single_jersey', comp:'cvc',     ne:30, spin:'combed', g:28, dia:26, gsm:150, seg:'dark',   sl:2.80, fdia:63, fgsm:156 },
  { fab:'single_jersey', comp:'cvc',     ne:24, spin:'combed', g:24, dia:30, gsm:185, seg:'light',  sl:2.85, fdia:68, fgsm:188 },
  { fab:'single_jersey', comp:'cvc',     ne:22, spin:'combed', g:24, dia:30, gsm:185, seg:'medium', sl:2.95, fdia:70, fgsm:190 },
  { fab:'single_jersey', comp:'cvc',     ne:32, spin:'combed', g:28, dia:28, gsm:140, seg:'medium', sl:2.65, fdia:57, fgsm:135 },
  { fab:'single_jersey', comp:'pc',      ne:40, spin:'combed', g:28, dia:28, gsm:130, seg:'medium', sl:2.45, fdia:58, fgsm:130 },
  { fab:'single_jersey', comp:'pc',      ne:22, spin:'combed', g:24, dia:28, gsm:200, seg:'medium', sl:2.85, fdia:64, fgsm:200 },
  { fab:'single_jersey', comp:'pc',      ne:26, spin:'combed', g:24, dia:30, gsm:180, seg:'medium', sl:2.75, fdia:67, fgsm:182 },
  { fab:'single_jersey', comp:'modal',   ne:36, spin:'combed_lycra', g:18, dia:34, gsm:210, seg:'medium', sl:2.80, fdia:54, fgsm:210 },
  { fab:'single_jersey', comp:'viscose', ne:30, spin:'combed_lycra', g:28, dia:32, gsm:200, seg:'light',  sl:2.95, fdia:73, fgsm:207 },
  { fab:'single_jersey', comp:'viscose', ne:34, spin:'combed_lycra', g:28, dia:26, gsm:160, seg:'light',  sl:2.90, fdia:56, fgsm:185 },

  // ─────────────────────────────── RIB (1x1 / 2x1 / 2x2) ───────────────────────────────
  { fab:'rib', comp:'cotton', ne:30, spin:'combed_lycra', g:18, dia:30, gsm:260, seg:'medium', sl:2.65, fdia:62, fgsm:256 },
  { fab:'rib', comp:'cotton', ne:28, spin:'carded_lycra', g:18, dia:42, gsm:290, seg:'dark',   sl:2.65, fdia:50, fgsm:278 },
  { fab:'rib', comp:'cotton', ne:32, spin:'combed_lycra', g:18, dia:42, gsm:220, seg:'light',  sl:2.60, fdia:47, fgsm:195 },
  { fab:'rib', comp:'cotton', ne:30, spin:'combed_lycra', g:18, dia:42, gsm:230, seg:'light',  sl:2.95, fdia:52, fgsm:235 },
  { fab:'rib', comp:'cotton', ne:30, spin:'combed_lycra', g:18, dia:42, gsm:230, seg:'medium', sl:2.95, fdia:51, fgsm:237 },
  { fab:'rib', comp:'cotton', ne:26, spin:'carded_lycra', g:18, dia:34, gsm:320, seg:'dark',   sl:2.85, fdia:70, fgsm:290 },
  { fab:'rib', comp:'cotton', ne:26, spin:'carded_lycra', g:18, dia:34, gsm:320, seg:'medium', sl:2.85, fdia:68, fgsm:280 },
  { fab:'rib', comp:'cotton', ne:40, spin:'combed_lycra', g:18, dia:42, gsm:200, seg:'light',  sl:2.60, fdia:53, fgsm:186 },
  { fab:'rib', comp:'cotton', ne:40, spin:'combed_lycra', g:18, dia:42, gsm:200, seg:'medium', sl:2.60, fdia:55, fgsm:188 },
  { fab:'rib', comp:'cotton', ne:20, spin:'combed_lycra', g:18, dia:30, gsm:200, seg:'dark',   sl:2.90, fdia:69, fgsm:200 },
  { fab:'rib', comp:'cotton', ne:24, spin:'carded_lycra', g:18, dia:32, gsm:300, seg:'medium', sl:2.80, fdia:63, fgsm:292 },
  { fab:'rib', comp:'cvc',    ne:26, spin:'combed_lycra', g:18, dia:36, gsm:340, seg:'dark',   sl:2.95, fdia:47, fgsm:275 },

  // ─────────────────────────────────────── PIQUE ───────────────────────────────────────
  { fab:'pique', comp:'cotton', ne:22, spin:'combed', g:24, dia:28, gsm:240, seg:'light',  sl:2.75, fdia:78, fgsm:245 },
  { fab:'pique', comp:'cotton', ne:24, spin:'carded', g:24, dia:30, gsm:220, seg:'dark',   sl:2.65, fdia:80, fgsm:205 },
  { fab:'pique', comp:'cotton', ne:22, spin:'carded', g:24, dia:28, gsm:220, seg:'medium', sl:2.65, fdia:74, fgsm:210 },
  { fab:'pique', comp:'cotton', ne:24, spin:'carded', g:24, dia:30, gsm:200, seg:'light',  sl:2.65, fdia:83, fgsm:198 },
  { fab:'pique', comp:'cotton', ne:24, spin:'combed', g:24, dia:30, gsm:200, seg:'medium', sl:2.65, fdia:86, fgsm:188 },
  { fab:'pique', comp:'cotton', ne:28, spin:'carded', g:24, dia:30, gsm:180, seg:'medium', sl:2.55, fdia:80, fgsm:178 },

  // ───────────────────────────────────── INTERLOCK ─────────────────────────────────────
  { fab:'interlock', comp:'cotton', ne:44, spin:'combed', g:24, dia:34, gsm:190, seg:'medium', sl:2.80, fdia:65, fgsm:175 },
  { fab:'interlock', comp:'cotton', ne:42, spin:'combed', g:24, dia:34, gsm:190, seg:'medium', sl:2.70, fdia:71, fgsm:191 },
  { fab:'interlock', comp:'cotton', ne:40, spin:'combed', g:24, dia:34, gsm:220, seg:'light',  sl:2.70, fdia:61, fgsm:205 },
  { fab:'interlock', comp:'cotton', ne:32, spin:'carded', g:24, dia:34, gsm:240, seg:'medium', sl:2.85, fdia:64, fgsm:254 },
  { fab:'interlock', comp:'cotton', ne:36, spin:'combed', g:24, dia:34, gsm:200, seg:'medium', sl:2.85, fdia:59, fgsm:197 },
  { fab:'interlock', comp:'cotton', ne:30, spin:'combed', g:24, dia:34, gsm:250, seg:'medium', sl:2.85, fdia:59, fgsm:286 },

  // ──────────────────────────── FLEECE (3-thread, brushed) ────────────────────────────
  { fab:'fleece', comp:'cvc',    ne:34, spin:'combed', g:20, dia:34, gsm:260, seg:'dark',   sl:4.45, fdia:74, fgsm:275 },
  { fab:'fleece', comp:'cvc',    ne:34, spin:'combed', g:20, dia:34, gsm:280, seg:'light',  sl:4.45, fdia:74, fgsm:280 },
  { fab:'fleece', comp:'cotton', ne:34, spin:'carded', g:20, dia:34, gsm:260, seg:'dark',   sl:4.45, fdia:75, fgsm:265 },
  { fab:'fleece', comp:'cotton', ne:30, spin:'carded', g:20, dia:34, gsm:280, seg:'dark',   sl:4.45, fdia:74, fgsm:282 },
  { fab:'fleece', comp:'cvc',    ne:34, spin:'combed', g:20, dia:34, gsm:240, seg:'medium', sl:4.45, fdia:72, fgsm:250 },
  { fab:'fleece', comp:'cvc',    ne:30, spin:'combed', g:20, dia:34, gsm:280, seg:'light',  sl:4.50, fdia:74, fgsm:285 },

  // ──────────────────────────── TERRY / FRENCH TERRY ────────────────────────────
  { fab:'terry', comp:'cvc',    ne:34, spin:'combed', g:20, dia:32, gsm:260, seg:'medium', sl:4.45, fdia:72, fgsm:265 },
  { fab:'terry', comp:'cotton', ne:30, spin:'combed', g:20, dia:30, gsm:300, seg:'medium', sl:4.50, fdia:70, fgsm:305 },
  { fab:'terry', comp:'cotton', ne:32, spin:'combed', g:20, dia:34, gsm:270, seg:'dark',   sl:4.45, fdia:78, fgsm:280 },
  { fab:'terry', comp:'cotton', ne:32, spin:'combed', g:20, dia:34, gsm:280, seg:'light',  sl:4.45, fdia:80, fgsm:275 },
  { fab:'terry', comp:'cotton', ne:34, spin:'combed', g:20, dia:34, gsm:260, seg:'light',  sl:4.45, fdia:82, fgsm:270 },

  // ─────────────────────────────────────── WAFFLE ───────────────────────────────────────
  { fab:'waffle', comp:'cotton', ne:34, spin:'carded', g:18, dia:34, gsm:200, seg:'light',  sl:2.70, fdia:67, fgsm:180 },
  { fab:'waffle', comp:'cotton', ne:34, spin:'carded', g:18, dia:34, gsm:200, seg:'medium', sl:2.70, fdia:66, fgsm:192 },
  { fab:'waffle', comp:'cotton', ne:30, spin:'combed', g:18, dia:42, gsm:180, seg:'light',  sl:2.60, fdia:54, fgsm:190 },
  { fab:'waffle', comp:'cotton', ne:40, spin:'combed', g:18, dia:42, gsm:180, seg:'light',  sl:2.60, fdia:54, fgsm:190 },

  // ─────────────────────────── HEAVY JERSEY (single-bed, heavy) ───────────────────────────
  { fab:'heavy_jersey', comp:'cotton', ne:22, spin:'combed', g:20, dia:34, gsm:280, seg:'medium', sl:4.00, fdia:82, fgsm:268 },
  { fab:'heavy_jersey', comp:'cotton', ne:20, spin:'combed', g:20, dia:32, gsm:200, seg:'medium', sl:2.95, fdia:73, fgsm:190 },
  { fab:'heavy_jersey', comp:'cotton', ne:30, spin:'combed', g:20, dia:30, gsm:250, seg:'medium', sl:3.50, fdia:69, fgsm:245 },
  { fab:'heavy_jersey', comp:'cotton', ne:24, spin:'combed', g:16, dia:36, gsm:250, seg:'medium', sl:3.70, fdia:72, fgsm:274 },
];

// Fabric-category aliases → dataset `fab` key (so calculator fabric IDs map in).
const FAB_ALIAS = {
  single_jersey: 'single_jersey', sj: 'single_jersey',
  rib_1x1: 'rib', rib_2x2: 'rib', lycra_rib_1x1: 'rib', lycra_rib_2x2: 'rib', rib: 'rib',
  pique_single: 'pique', lacoste_single: 'pique', pique: 'pique',
  interlock: 'interlock', ponte_di_roma: 'interlock',
  fleece_2_thread: 'fleece', fleece_3_thread: 'fleece', fleece_diagonal: 'fleece', fleece: 'fleece',
  french_terry: 'terry', terry_fabric: 'terry', terry: 'terry',
  waffle: 'waffle',
  heavy_jersey: 'heavy_jersey',
};

module.exports = { FACTORY_RECORDS, FAB_ALIAS };
