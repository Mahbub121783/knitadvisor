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
 * of four Textile Learner (textilelearner.net) articles, each entry carrying
 * its own source_key back to the article. This is deliberately NOT a mirror
 * of the site (it runs to ~400 dyeing posts across 27 pages) — see that
 * file's own "_note" for why the scope stops here. It is also independent of
 * dyeing-engine.js's recipe/costing layer: this module is diagnostic/advisory
 * knowledge, not a cost input, and calculateDyeingCost() never reads it.
 */
'use strict';

const knowledge = require('../../data/dyeing-knowledge.json');

const DYEING_FAULTS_DATABASE = knowledge.faults;

const SOURCES_BY_KEY = Object.fromEntries(knowledge.sources.map(s => [s.key, s]));

/** Attach the full source record (title/url/publisher) to any object carrying a source_key. */
function withSource(entry) {
  return { ...entry, source: SOURCES_BY_KEY[entry.source_key] || null };
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
      results.push({ ...withSource(fault), confidence, matches });
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence);
}

/** Full fault list, each with its source attached — for a browser UI. */
function listDyeingFaults() {
  return DYEING_FAULTS_DATABASE.map(withSource);
}

/** The five-stage shade-variation prevention checklist (with numeric QC targets), sourced. */
function getShadeVariationChecklist() {
  return withSource(knowledge.qc_framework);
}

/** The floor-level checking/control-points checklist, sourced. */
function getProcessCheckpoints() {
  return withSource(knowledge.process_checkpoints);
}

/** The common-salt vs Glauber-salt vs vacuum-salt electrolyte comparison, sourced. */
function getSaltComparison() {
  return withSource(knowledge.salt_comparison);
}

/** Everything at once, for a single "knowledge" endpoint/page. */
function getDyeingKnowledge() {
  return {
    sources: knowledge.sources,
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
