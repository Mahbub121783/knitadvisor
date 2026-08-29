/**
 * THE CALCULATION FORMULA SECTION
 * ===============================
 *
 * Every published formula the engine can apply, and nothing else. No database,
 * no network, no I/O, no state — give these the same numbers and they return
 * the same answer forever. That is what makes the whole product's central
 * claim checkable rather than asserted.
 *
 * WHAT LIVES HERE vs. WHAT DOES NOT
 * ---------------------------------
 *   here            a relation between quantities, from a textbook, a standard,
 *                   or a fitted regression, with its source named
 *   engine/domain/  reasoning that *chooses* which relation applies, weighs
 *                   sources against each other, and writes the warnings
 *   database        measurement — the factory records, colour books and prices
 *                   that the relations are applied to (see engine/reference/)
 *
 * The split matters because these three change for different reasons and at
 * different speeds. A formula changes when the literature is corrected, which
 * is almost never. Reasoning changes when the floor teaches us something.
 * Measurement changes every time the mill sends a new file.
 *
 * MODULES
 * -------
 *   units.js          length / weight / area / count-system conversion
 *   yarn.js           Ne-Tex-denier arithmetic, cover factor, tightness factor
 *   gsm-count.js      GSM to count regressions and lookup tables
 *   loop-length.js    stitch length from count and GSM
 *   machine.js        needles, feeders, pitch, gauge relations
 *   production.js     kg/hr for spun and filament yarn
 *   fabric-weight.js  GSM from a swatch, weight from GSM, fibre split
 *   efficiency.js     machine efficiency and loss
 *   validation.js     the physically sensible band for every input
 *   weft.js           courses, wales, stitch density
 *
 * This index re-exports the flat surface the engine has always imported, so
 * `require('../formulas')` keeps resolving here after the split. New code
 * should reach for the specific module instead — `require('../formulas/yarn')`
 * says what it depends on.
 */
'use strict';

const units        = require('./units');
const yarn         = require('./yarn');
const gsmCount     = require('./gsm-count');
const loopLength   = require('./loop-length');
const machine      = require('./machine');
const production   = require('./production');
const fabricWeight = require('./fabric-weight');
const efficiency   = require('./efficiency');
const validation   = require('./validation');
const weft         = require('./weft');

module.exports = {
  // units.js
  UNITS:                    units.UNITS,
  UnitConverter:            units.UnitConverter,
  // yarn.js
  YarnCountFormulas:        yarn.YarnCountFormulas,
  TIGHTNESS_LIMITS:         yarn.TIGHTNESS_LIMITS,
  // gsm-count.js
  GSM_COUNT_REGRESSION:     gsmCount.GSM_COUNT_REGRESSION,
  GSM_COUNT_LOOKUP:         gsmCount.GSM_COUNT_LOOKUP,
  MASTER_LOOKUP:            gsmCount.MASTER_LOOKUP,
  calcCountFromGSM:         gsmCount.calcCountFromGSM,
  calcGSMFromCount:         gsmCount.calcGSMFromCount,
  // loop-length.js
  LOOP_LENGTH_MULTIPLIERS:  loopLength.LOOP_LENGTH_MULTIPLIERS,
  BOOK_K_CONSTANTS:         loopLength.BOOK_K_CONSTANTS,
  calcLoopLength:           loopLength.calcLoopLength,
  // machine.js
  MachineFormulas:          machine.MachineFormulas,
  // production.js
  ProductionFormulas:       production.ProductionFormulas,
  // fabric-weight.js
  FabricWeightFormulas:     fabricWeight.FabricWeightFormulas,
  calcFiberPercentage:      fabricWeight.calcFiberPercentage,
  // efficiency.js
  EfficiencyFormulas:       efficiency.EfficiencyFormulas,
  // validation.js
  VALIDATION_RANGES:        validation.VALIDATION_RANGES,
  PHYSICAL_BOUNDS:          validation.PHYSICAL_BOUNDS,
  validate:                 validation.validate,
  validateInputs:           validation.validateInputs,
  // weft.js
  WeftCalculators:          weft.WeftCalculators,

  // Namespaced access for new code.
  units, yarn, gsmCount, loopLength, machine, production,
  fabricWeight, efficiency, validation, weft,
};
