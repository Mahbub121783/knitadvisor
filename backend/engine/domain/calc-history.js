/**
 * Builds a calculation-history entry from a request and its engine result.
 * Pure — no database, no I/O — so it can be tested without either.
 *
 * Only the engine's own canonical inputs (ENGINE_INPUTS) are stored, never the
 * raw request body: the body can carry anything, and what makes a calculation
 * reproducible is exactly the set of fields the engine reads.
 */
const crypto = require('crypto');

// Stable across key order, so {a:1,b:2} and {b:2,a:1} are the same calculation.
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function pick(obj, path) {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string[]} engineInputs  the engine's canonical input list
 * @param {object}   body          the request body
 * @param {object}   result        the engine result (already successful)
 * @returns {object|null}          null when there is nothing worth keeping
 */
function buildHistoryEntry(engineInputs, body, result) {
  if (!body || !result || result.error || !body.fabric) return null;
  const gsm = num(body.gsm);
  if (gsm == null || gsm <= 0) return null;

  const params = {};
  for (const f of engineInputs) {
    const v = body[f];
    if (v === undefined || v === null || v === '' || typeof v === 'function') continue;
    params[f] = v;
  }
  params.fabric = String(body.fabric);
  params.gsm = gsm;

  const summary = {
    yarn_count: pick(result, ['yarn', 'count_display']) || null,
    fabric_price_usd_per_kg: num(pick(result, ['costing', 'total_per_kg_usd'])),
    kg_per_day: num(pick(result, ['production', 'kg_per_day'])),
    loop_length_mm: num(pick(result, ['loop_length', 'value_mm'])),
    fob_usd: num(pick(result, ['garment_costing', 'cmt', 'summary', 'fob_total_usd'])),
  };
  for (const k of Object.keys(summary)) if (summary[k] === null) delete summary[k];

  return {
    params_hash: crypto.createHash('sha1').update(stableStringify(params)).digest('hex'),
    fabric_id: params.fabric,
    fabric_name: pick(result, ['fabric', 'name']) || null,
    gsm,
    composition: typeof params.composition === 'string' ? params.composition.slice(0, 200) : null,
    params,
    summary,
  };
}

module.exports = { buildHistoryEntry, stableStringify };
