/**
 * Source confidence
 * ==================
 *
 * The yarn-count formula (and, by the same tags, the stitch-length data) that
 * answers a request comes from one of several places with very different
 * evidentiary weight: a real factory sample at this exact GSM, a published
 * textbook formula, or — for most of the 166-structure catalogue — a
 * structural guess with no direct data behind it at all (tagged 'ESTIMATED'
 * in fabric-derivatives.js; see the comment there on what that tag means).
 *
 * Those raw tags used to reach the result page as bare text ("ESTIMATED",
 * "FACTORY_INTERPOLATED") with no explanation — technically honest (nothing
 * was hidden) but useless to a merchandiser who has no reason to know what
 * the words mean or how much weight to put on them. This module is the one
 * place that turns a raw source tag into something a reader can act on:
 * a short label, a confidence tier for colour-coding, and a plain-English
 * note. engine/index.js attaches its output to yarn.source_confidence; it is
 * not itself a formula, so it lives in domain/, not formulas/.
 *
 * Ranked worst→best because that is the order a reader should be able to
 * scan a legend in; TIER_RANK exists so the frontend can sort/threshold
 * without re-encoding this list.
 */
'use strict';

const TIERS = {
  none: {
    rank: 0, label: 'No source', badge: 'none',
    note: 'No formula or factory data exists for this fabric/GSM combination. The engine could not calculate this value.',
  },
  not_applicable: {
    rank: -1, label: 'N/A', badge: 'neutral',
    note: 'This fabric does not use an Ne count at all (e.g. warp knit is specified by denier), so no confidence tier applies.',
  },
  estimated: {
    rank: 1, label: 'Estimated', badge: 'estimated',
    note: 'No published formula or factory sample exists for this exact structure. This number is extrapolated from its structural relationship to a verified base fabric (e.g. a rib variant scaled from 1×1 rib) — a reasonable starting point, not a measured value. Confirm with a lab dip / trial knit before bulk production.',
  },
  factory_nearest: {
    rank: 2, label: 'Factory data (nearest match)', badge: 'derived',
    note: 'Based on the single closest real factory sample for this fabric family, at a different GSM than requested. Treat as indicative.',
  },
  factory_extrapolated: {
    rank: 2, label: 'Factory data (extrapolated)', badge: 'derived',
    note: 'Real factory samples exist for this fabric family, but this GSM falls outside the range they cover — the trend is projected beyond measured data.',
  },
  lookup_derived: {
    rank: 3, label: 'Derived from published table', badge: 'derived',
    note: 'Regression-fitted from a published industry lookup table rather than a formula printed directly for this structure. Grounded in real reference data, one step removed from it.',
  },
  factory_interpolated: {
    rank: 4, label: 'Factory data (interpolated)', badge: 'verified',
    note: 'Real factory samples bracket this exact GSM on both sides; this value is interpolated between two measured points.',
  },
  pdf_verified: {
    rank: 5, label: 'Verified — published reference', badge: 'verified',
    note: 'Matches a formula published for this exact structure in a cited industry reference (see source below).',
  },
  factory_exact: {
    rank: 5, label: 'Factory data (exact match)', badge: 'verified',
    note: 'A real factory production record matches this fabric and GSM directly.',
  },
  // Generic fallback for factory-sourced values that arrive without one of
  // the specific EXACT/INTERPOLATED/EXTRAPOLATED/NEAREST tags above (e.g.
  // the bare 'FACTORY_KNOWLEDGE' default). Deliberately NOT the same tier as
  // factory_interpolated — claiming "interpolated between two measured
  // points" for a source that never said so would be a confidence claim the
  // data doesn't support.
  factory_data: {
    rank: 3, label: 'Factory data', badge: 'derived',
    note: 'Based on real factory production records for this fabric family, not a published formula — but without a documented exact/interpolated/extrapolated distinction for this specific value.',
  },
};

/**
 * Map a raw `source` string (as stored on countResult.source /
 * factoryLookup.source throughout engine/index.js) to its confidence tier.
 * Unrecognised strings fall back to a neutral, non-claiming tier rather than
 * silently inheriting a confidence label they were never rated for.
 *
 * @param {string} rawSource
 * @param {{familyAlias?: string}} [opts] - When the fabric's real data was
 *   read from a broader structural family bucket (FAB_BUCKET_ALIAS in
 *   factory-knowledge.js — e.g. cable_rib borrowing the shared 'rib'
 *   family's samples) rather than samples specific to this exact fabric ID,
 *   pass the bucket name here so a factory-sourced note says so instead of
 *   implying the sample was measured for this precise structure.
 */
function classifySource(rawSource, opts = {}) {
  const s = String(rawSource || '');
  const familyAlias = opts.familyAlias || null;

  let key;
  if (!s || s === 'NONE') key = 'none';
  else if (s.startsWith('N/A')) key = 'not_applicable';
  else if (s === 'ESTIMATED') key = 'estimated';
  else if (s === 'LOOKUP_DERIVED') key = 'lookup_derived';
  else if (s.startsWith('PDF_VERIFIED')) key = 'pdf_verified';
  else if (s === 'FACTORY_EXACT') key = 'factory_exact';
  else if (s === 'FACTORY_INTERPOLATED') key = 'factory_interpolated';
  else if (s === 'FACTORY_EXTRAPOLATED') key = 'factory_extrapolated';
  else if (s === 'FACTORY_NEAREST') key = 'factory_nearest';
  else if (s === 'FACTORY_KNOWLEDGE' || /factory/i.test(s) || /knitting master file/i.test(s)) key = 'factory_data';
  else key = null;

  if (!key) {
    return {
      tier: 'unclassified', rank: 2, label: 'Reference data', badge: 'derived',
      note: 'Sourced from the engine\'s reference data; not yet mapped to a confidence tier.',
      raw: s || null,
    };
  }

  const t = TIERS[key];
  let note = t.note;
  if (familyAlias && key.startsWith('factory')) {
    note += ` (Shared with the rest of the "${familyAlias.replace(/_/g, ' ')}" family — this specific structure wasn't sampled on its own; GSM/count generally tracks closely within a structural family, but a distinctive derivative can differ.)`;
  }
  return { tier: key, rank: t.rank, label: t.label, badge: t.badge, note, raw: s || null, family_alias: familyAlias };
}

module.exports = { TIERS, classifySource };
