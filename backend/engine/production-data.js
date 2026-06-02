/**
 * KnitAdvisor — Bulk Production Conventions
 * =========================================
 *
 * Systematic relationships extracted from a real factory **Knitting Master
 * File** (5000+ bulk-production booking rows, Bangladesh RMG, multi-buyer:
 * NEXT, LPP, Carrefour, Schoeffel, Diadora, Signet, Accolade, OTCF, etc.).
 *
 * That file records, for every production booking, the parameters a knitter
 * actually committed to the floor — yarn count, the MACHINE GAUGE (GG) and
 * cylinder DIA chosen, the finished open width (F/DIA), the finished GSM, the
 * colour segment, and the realised **process loss %** ("Fo Wise Process Loss").
 *
 * Two signals here are NOT derivable from textbook theory and are the whole
 * point of mining bulk data:
 *
 *   1. REAL GAUGE CONVENTIONS.  Cover-factor theory (NPI ≈ 4.25·√Ne) predicts
 *      ~21 GG for 24s cotton.  Bangladesh mills actually run 30–36 GG for the
 *      same count — modern loose/lycra fabrics are knit far finer than the
 *      classic tight-fabric cover-factor lower bound.  These tables capture
 *      what factories DO, not what the lower-bound formula allows.
 *
 *   2. PROCESS LOSS by colour + wet-process.  Dark shades, AOP prints, garment
 *      wash and brushing each add characteristic weight/area loss between grey
 *      booking and finished delivery.  The system had no model for this.
 *
 * Deterministic. No AI.
 */

'use strict';

// ============================================================
// 1. MACHINE GAUGE CONVENTIONS  (count → modal GG actually booked)
// ============================================================
// Modal machine gauge (needles/inch) per yarn count, read off the bulk file
// by fabric family. Single-bed families (SJ/lacoste/pique/fleece/terry/heavy)
// share the SJ table; rib/interlock are finer-gauge double-bed.
//
// Values are the COMMONEST booked gauge for that count (not the rare extremes).
// Counts between table points are linearly interpolated.

const GAUGE_CONVENTION = {
  // Single-bed: single jersey, lacoste, pique, fleece, terry, heavy jersey
  single: [
    { ne: 16, gg: 28 },
    { ne: 18, gg: 30 },
    { ne: 20, gg: 32 },
    { ne: 22, gg: 32 },
    { ne: 24, gg: 32 },
    { ne: 26, gg: 32 },
    { ne: 28, gg: 34 },
    { ne: 30, gg: 34 },
    { ne: 32, gg: 36 },
    { ne: 34, gg: 36 },
    { ne: 36, gg: 38 },
    { ne: 40, gg: 38 },
  ],
  // Double-bed rib: 1x1 / 2x1 / 2x2 / 3x3 — booked very fine in this file
  rib: [
    { ne: 18, gg: 34 },
    { ne: 20, gg: 38 },
    { ne: 24, gg: 40 },
    { ne: 26, gg: 42 },
    { ne: 28, gg: 42 },
    { ne: 30, gg: 42 },
    { ne: 32, gg: 42 },
    { ne: 34, gg: 44 },
    { ne: 36, gg: 44 },
    { ne: 40, gg: 44 },
  ],
  // Interlock / double-face — high gauge double-bed
  interlock: [
    { ne: 20, gg: 34 },
    { ne: 24, gg: 34 },
    { ne: 28, gg: 36 },
    { ne: 30, gg: 36 },
    { ne: 36, gg: 36 },
    { ne: 40, gg: 38 },
    { ne: 44, gg: 38 },
  ],
};

function familyKey(category) {
  if (category === 'rib' || /rib|cardigan|milano/.test(category || '')) return 'rib';
  if (category === 'interlock') return 'interlock';
  return 'single';
}

/**
 * Data-grounded gauge for a count, interpolated from the bulk-file convention.
 * @param {string} category fabric category
 * @param {number} ne       yarn count (Ne)
 * @returns {object|null}   { gg, family, anchor_low, anchor_high }
 */
function gaugeFromBulkData(category, ne) {
  if (!ne || ne <= 0) return null;
  const fam = familyKey(category);
  const tbl = GAUGE_CONVENTION[fam];
  // Clamp to ends
  if (ne <= tbl[0].ne) return { gg: tbl[0].gg, family: fam, anchor_low: tbl[0], anchor_high: tbl[0] };
  if (ne >= tbl[tbl.length - 1].ne) {
    const last = tbl[tbl.length - 1];
    return { gg: last.gg, family: fam, anchor_low: last, anchor_high: last };
  }
  // Linear interpolation between the two surrounding anchors
  for (let i = 0; i < tbl.length - 1; i++) {
    const a = tbl[i], b = tbl[i + 1];
    if (ne >= a.ne && ne <= b.ne) {
      const t = (ne - a.ne) / (b.ne - a.ne);
      const gg = Math.round(a.gg + t * (b.gg - a.gg));
      return { gg, family: fam, anchor_low: a, anchor_high: b };
    }
  }
  return null;
}

// ============================================================
// 2. PROCESS LOSS  ("Fo Wise Process Loss %" — grey booking → finished)
// ============================================================
// Base solid-dye loss by colour segment (median of the bulk-file column).
const PROCESS_LOSS_BASE = {
  light:  11.0,
  medium: 12.5,
  dark:   14.0,
};

// Additive process modifiers (each wet/mechanical process adds loss).
// AOP (all-over print) dominates; garment wash, brushing, peaching add less.
const PROCESS_LOSS_MODIFIER = {
  aop:          4.5,   // all-over print (reactive/discharge/pigment)
  garment_wash: 2.5,   // G/Wash, acid wash, enzyme
  brush:        1.5,   // brushed fleece face
  peach:        1.0,   // peach/emery finish
  singe:        0.5,   // singeing
};

/**
 * Estimate floor process loss % from grey booking to finished delivery.
 * @param {string} segment   light | medium | dark
 * @param {string[]} [processes]  any of: aop, garment_wash, brush, peach, singe
 * @returns {object} { loss_pct, base, modifiers, note }
 */
function estimateProcessLoss(segment, processes = []) {
  const seg = PROCESS_LOSS_BASE[segment] != null ? segment : 'medium';
  let loss = PROCESS_LOSS_BASE[seg];
  const applied = [];
  (processes || []).forEach(p => {
    if (PROCESS_LOSS_MODIFIER[p] != null) {
      loss += PROCESS_LOSS_MODIFIER[p];
      applied.push({ process: p, add_pct: PROCESS_LOSS_MODIFIER[p] });
    }
  });
  loss = parseFloat(loss.toFixed(1));
  return {
    loss_pct: loss,
    base_pct: PROCESS_LOSS_BASE[seg],
    segment: seg,
    modifiers: applied,
    note: applied.length
      ? `Base ${PROCESS_LOSS_BASE[seg]}% (${seg}) + ${applied.map(a => `${a.process} ${a.add_pct}%`).join(' + ')} = ${loss}% grey→finished process loss.`
      : `${loss}% typical grey→finished process loss for ${seg} solid dye (bulk-data median).`,
    source: 'Knitting Master File — "Fo Wise Process Loss %" column (5000+ bookings).',
  };
}

/**
 * Convert a target FINISHED fabric weight into the GREY booking quantity the
 * floor must knit, using the process-loss model. Practical mill planning value.
 * @param {number} finishedKg
 * @param {string} segment
 * @param {string[]} [processes]
 */
function greyRequirementForFinished(finishedKg, segment, processes = []) {
  if (!finishedKg || finishedKg <= 0) return null;
  const lp = estimateProcessLoss(segment, processes);
  const greyKg = parseFloat((finishedKg / (1 - lp.loss_pct / 100)).toFixed(2));
  return {
    finished_kg: finishedKg,
    grey_kg: greyKg,
    extra_kg: parseFloat((greyKg - finishedKg).toFixed(2)),
    process_loss_pct: lp.loss_pct,
    note: `Book ${greyKg} kg grey to deliver ${finishedKg} kg finished (${lp.loss_pct}% process loss).`,
  };
}

module.exports = {
  GAUGE_CONVENTION,
  gaugeFromBulkData,
  PROCESS_LOSS_BASE,
  PROCESS_LOSS_MODIFIER,
  estimateProcessLoss,
  greyRequirementForFinished,
  familyKey,
};
