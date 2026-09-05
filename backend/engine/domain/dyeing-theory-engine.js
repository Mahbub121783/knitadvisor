/**
 * KnitAdvisor — Dyeing Theory Engine
 * ====================================
 *
 * The "why", not the "what": dye-class chemistry, machine theory, full
 * process flow charts, and fastness-testing theory — general textile
 * wet-processing curriculum knowledge, the same status as academy-engine.js's
 * knitting theory (a textbook-level knowledge base, not tied to one external
 * source and never carrying an outbound citation — see knitadvisor-no-source-
 * links). Complements, and cross-references, dyeing-engine.js's real recipe
 * cards and dyeing-faults-engine.js's fault/QC layer.
 *
 * Pattern B, same as dyeing-engine.js: a synchronous require() of a static
 * JSON snapshot, no database, no network.
 */
'use strict';

const theory = require('../../data/dyeing-theory.json');

/** All 7 dye classes (Reactive, Disperse, Vat, Direct, Acid, Basic/Cationic, Sulphur). */
function listDyeClasses() {
  return theory.dye_classes;
}

/** One dye class by key, or null if unknown. */
function getDyeClass(key) {
  return theory.dye_classes.find(d => d.key === key) || null;
}

/** All 6 machine types (Jet, Winch/Soft-Flow, Jigger, Pad-Batch, Pad-Steam, Beam). */
function listMachines() {
  return theory.machines;
}

/** One machine type by key, or null if unknown. */
function getMachine(key) {
  return theory.machines.find(m => m.key === key) || null;
}

/** All 5 full process flow charts (step-by-step, with notes). */
function listProcessFlows() {
  return theory.process_flows;
}

/** One process flow by key, or null if unknown. */
function getProcessFlow(key) {
  return theory.process_flows.find(p => p.key === key) || null;
}

/** Fastness-testing theory: grey scales and the four standard test types. */
function getFastnessTheory() {
  return theory.fastness;
}

/** Everything at once, for a single theory browser page/endpoint. */
function getDyeingTheory() {
  return {
    dye_classes: listDyeClasses(),
    machines: listMachines(),
    process_flows: listProcessFlows(),
    fastness: getFastnessTheory(),
  };
}

module.exports = {
  listDyeClasses,
  getDyeClass,
  listMachines,
  getMachine,
  listProcessFlows,
  getProcessFlow,
  getFastnessTheory,
  getDyeingTheory,
};
