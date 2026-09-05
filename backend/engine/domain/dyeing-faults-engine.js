/**
 * KnitAdvisor — Dyeing Faults & Process-Knowledge Engine
 * ========================================================
 *
 * Same shape as faults-engine.js (which covers KNITTING faults), but for
 * wet-processing/dyeing floor faults, plus two supporting knowledge blocks
 * (a shade-variation QC checklist and a salt/electrolyte comparison) that
 * don't fit the fault-diagnosis shape but come from the same source set.
 *
 * SOURCE: backend/data/dyeing-knowledge.json — a curated, own-words summary
 * of researched industry articles, each entry carrying its own internal-only
 * source_key. Every function here strips that key before returning (see
 * dropSourceKey below and knitadvisor-no-source-links) — no external site
 * name or URL is ever part of this module's output. Independent of dyeing-
 * engine.js's recipe/costing layer: this module is diagnostic/advisory
 * knowledge, not a cost input, and calculateDyeingCost() never reads it.
 */
'use strict';

const knowledge = require('../../data/dyeing-knowledge.json');

const DYEING_FAULTS_DATABASE = knowledge.faults;

// dyeing-knowledge.json keeps research provenance (title/url/publisher) for
// OUR OWN internal audit trail only — see knitadvisor-no-source-links: no
// external site name, article title, or URL may ever reach an API response
// or a rendered page. `dropSourceKey` strips the internal-only `source_key`
// field and returns nothing in its place — not even a link-free "Textile
// Learner" attribution — so nothing about where an entry was researched is
// visible outside this file.
function dropSourceKey(entry) {
  const { source_key, ...rest } = entry;
  return rest;
}

/**
 * Rule-based dyeing fault diagnosis, same scoring approach as
 * faults-engine.js's diagnoseFaults(): free-text symptom keywords matched
 * against each fault's name/causes/remedies, scored, sorted by confidence.
 *
 * @param {Array<string>} selectedSymptoms — free-text or id-like tokens,
 *   e.g. ["shade variation", "patchy", "rope"]
 * @returns {Array<Object>} diagnosed faults with confidence, sorted descending
 */
function diagnoseDyeingFaults(selectedSymptoms = []) {
  const terms = selectedSymptoms.map(s => String(s).toLowerCase().trim()).filter(Boolean);
  if (!terms.length) return [];

  const haystack = fault => [
    fault.name,
    ...fault.causes,
    ...fault.remedies,
  ].join(' | ').toLowerCase();

  const results = [];
  for (const fault of DYEING_FAULTS_DATABASE) {
    const text = haystack(fault);
    let score = 0;
    const matches = [];
    for (const term of terms) {
      if (!term) continue;
      if (fault.name.toLowerCase().includes(term)) { score += 3; matches.push(`name matched "${term}"`); continue; }
      if (text.includes(term)) { score += 1; matches.push(`cause/remedy matched "${term}"`); }
    }
    if (score > 0) {
      const confidence = Math.min(100, Math.round((score / (terms.length * 3)) * 100));
      results.push({ ...dropSourceKey(fault), confidence, matches });
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence);
}

/** Full fault list — for a browser UI. */
function listDyeingFaults() {
  return DYEING_FAULTS_DATABASE.map(dropSourceKey);
}

/** The five-stage shade-variation prevention checklist (with numeric QC targets). */
function getShadeVariationChecklist() {
  return dropSourceKey(knowledge.qc_framework);
}

/** The floor-level checking/control-points checklist. */
function getProcessCheckpoints() {
  return dropSourceKey(knowledge.process_checkpoints);
}

/** The common-salt vs Glauber-salt vs vacuum-salt electrolyte comparison. */
function getSaltComparison() {
  return dropSourceKey(knowledge.salt_comparison);
}

/** Everything at once, for a single "knowledge" endpoint/page. */
function getDyeingKnowledge() {
  return {
    faults: listDyeingFaults(),
    qc_framework: getShadeVariationChecklist(),
    process_checkpoints: getProcessCheckpoints(),
    salt_comparison: getSaltComparison(),
  };
}

module.exports = {
  DYEING_FAULTS_DATABASE,
  diagnoseDyeingFaults,
  listDyeingFaults,
  getShadeVariationChecklist,
  getProcessCheckpoints,
  getSaltComparison,
  getDyeingKnowledge,
};
