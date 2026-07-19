/**
 * KnitAdvisor — Factory Data Matching Engine
 * ==========================================
 *
 * Given the inputs a user enters (fabric, count, GSM, gauge, colour, fibre),
 * find the closest real factory R&D records and return data-grounded outputs:
 *   • body stitch length (mm)
 *   • finished open width / dia (inch)
 *   • finished GSM (after dyeing + compacting)
 *   • dye-uptake GSM gain (finish − grey, % of grey)
 *
 * Method: weighted k-nearest-neighbour over the curated FACTORY_RECORDS.
 * Records must match the fabric category; ebuyer-refthing else contributes a
 * distance. Predictions are an inverse-distance-weighted blend of the k
 * nearest matches, with a confidence score from how close the matches are.
 *
 * Deterministic. No AI.
 */

'use strict';

const { FACTORY_RECORDS, FAB_ALIAS } = require('./factory-dataset');

const TOTAL_RECORDS = FACTORY_RECORDS.length;

// Colour segment → ordinal (for distance) and dye GSM-gain direction.
const SEG_ORD = { light: 0, medium: 1, dark: 2 };

// Fibre-class compatibility distance (0 = same, higher = more different).
function compDistance(a, b) {
  if (a === b) return 0;
  // cotton/cvc/pc are cellulose-poly family; modal/viscose are cellulosic regenerated
  const family = { cotton: 'c', cvc: 'c', pc: 'c', modal: 'r', viscose: 'r' };
  return family[a] === family[b] ? 0.5 : 1.2;
}

/**
 * @param {object} q  query
 *   q.fabric (id), q.count_ne, q.gsm, q.gauge, q.dia, q.color_segment, q.comp
 * @param {number} [k=4]
 */
function matchFactory(q, k = 4) {
  const fabKey = FAB_ALIAS[(q.fabric || '').toLowerCase()] || null;
  if (!fabKey || !q.count_ne || !q.gsm) return { ok: false, reason: 'insufficient_query' };

  const seg = SEG_ORD[(q.color_segment || 'medium')] != null ? (q.color_segment || 'medium') : 'medium';
  const comp = ['cotton','cvc','pc','modal','viscose'].includes(q.comp) ? q.comp : 'cotton';

  // Score ebuyer-ref record in the same fabric category.
  const pool = FACTORY_RECORDS.filter(r => r.fab === fabKey);
  if (pool.length === 0) return { ok: false, reason: 'no_fabric_records' };

  const scored = pool.map(r => {
    const dCount = Math.abs(r.ne - q.count_ne) / 6;          // ~6 Ne ≈ 1 unit
    const dGsm   = Math.abs(r.gsm - q.gsm) / 40;             // ~40 GSM ≈ 1 unit
    const dGauge = (q.gauge != null && r.g != null) ? Math.abs(r.g - q.gauge) / 4 : 0; // ~4 GG ≈ 1 unit
    const dSeg   = Math.abs(SEG_ORD[r.seg] - SEG_ORD[seg]) * 0.5;
    const dComp  = compDistance(r.comp, comp);
    const dist = Math.sqrt(dCount*dCount + dGsm*dGsm + dGauge*dGauge + dSeg*dSeg + dComp*dComp);
    return { r, dist };
  }).sort((a, b) => a.dist - b.dist);

  const top = scored.slice(0, Math.min(k, scored.length));

  // Inverse-distance weights (add epsilon so an exact match doesn't divide by 0).
  // fdia is optional in the real dataset (~9% of records lack it) — track its own
  // weight sum so a missing value doesn't drag the average toward 0/NaN.
  let wSum = 0, wSumFdia = 0, sl = 0, fdia = 0, fgsm = 0, fgsmGainNum = 0;
  top.forEach(({ r, dist }) => {
    const w = 1 / (dist + 0.15);
    wSum += w;
    sl   += w * r.sl;
    fgsm += w * r.fgsm;
    fgsmGainNum += w * ((r.fgsm - r.gsm) / r.gsm); // fractional gain vs that record's grey
    if (r.fdia != null) {
      wSumFdia += w;
      fdia += w * r.fdia;
    }
  });

  const slPred   = parseFloat((sl / wSum).toFixed(3));
  const fdiaPred = wSumFdia > 0 ? parseFloat((fdia / wSumFdia).toFixed(1)) : null;
  const gainFrac = fgsmGainNum / wSum;                       // typical finish/grey gain
  // Apply the typical gain to the USER's target GSM for a finished-GSM estimate.
  const fgsmPred = parseFloat((q.gsm * (1 + gainFrac)).toFixed(0));

  // Confidence from the nearest match distance (closer → higher).
  const nearest = top[0].dist;
  let confidence = 'low', conf_pct = 55;
  if (nearest <= 0.6)      { confidence = 'buyer-ref_high'; conf_pct = 92; }
  else if (nearest <= 1.2) { confidence = 'high';      conf_pct = 84; }
  else if (nearest <= 2.0) { confidence = 'medium';    conf_pct = 72; }

  return {
    ok: true,
    fabric_key: fabKey,
    matched_count: top.length,
    nearest_distance: parseFloat(nearest.toFixed(3)),
    confidence, confidence_pct: conf_pct,
    prediction: {
      stitch_length_mm: slPred,
      finished_open_width_in: fdiaPred,
      finished_gsm: fgsmPred,
      dye_gsm_gain_pct: parseFloat((gainFrac * 100).toFixed(1)),
    },
    nearest_records: top.map(({ r, dist }) => ({
      fabric: r.fab, comp: r.comp, count_ne: r.ne, spin: r.spin, gauge: r.g, dia: r.dia,
      grey_gsm: r.gsm, color: r.seg, sl_mm: r.sl, finished_gsm: r.fgsm, finished_dia_in: r.fdia,
      distance: parseFloat(dist.toFixed(2)),
    })),
    dataset_size: TOTAL_RECORDS,
    source: `Factory ERP R&D Master File (${TOTAL_RECORDS.toLocaleString()} greige→finish records, 2022)`,
  };
}

/**
 * Recommend a yarn count for a target GSM + fabric, from the factory data.
 * (Addresses the "count selector accuracy" concern with real data.)
 */
function recommendCountFromGSM(fabric, gsm, comp = 'cotton') {
  const fabKey = FAB_ALIAS[(fabric || '').toLowerCase()] || null;
  if (!fabKey || !gsm) return null;
  const pool = FACTORY_RECORDS.filter(r => r.fab === fabKey);
  if (!pool.length) return null;
  // Weight by GSM closeness + fibrbuyer-ref.
  const scored = pool.map(r => ({
    r, w: 1 / (Math.abs(r.gsm - gsm) / 25 + compDistance(r.comp, comp) + 0.2),
  }));
  const wSum = scored.reduce((s, x) => s + x.w, 0);
  const ne = scored.reduce((s, x) => s + x.w * x.r.ne, 0) / wSum;
  return {
    recommended_count_ne: Math.round(ne),
    based_on: pool.length + ' factory records',
  };
}

module.exports = { matchFactory, recommendCountFromGSM };
