/**
 * KnitAdvisor — API Client
 * Centralized fetch wrapper for all backend endpoints
 */

const API_BASE = (() => {
  // In production: same origin (Node.js on port 3001, or proxied)
  // In dev: http://localhost:3001
  if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  return ''; // same-origin in production
})();

/**
 * Core fetch helper with error handling
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const defaults = {
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  };
  const config = { ...defaults, ...options };
  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, config);
  const data = await res.json();

  if (res.status === 401 && data && data.code === 'AUTH_REQUIRED' && window.kaSignInRedirect) {
    window.kaSignInRedirect();
  }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ============================================================
// POST /api/calculate
// params: { fabric, gsm, dia?, gauge?, rpm?, efficiency?, stitch_length?, feeders? }
// ============================================================
async function apiCalculate(params) {
  return apiFetch('/api/calculate', {
    method: 'POST',
    body: params,
  });
}

// ============================================================
// POST /api/woven/calculate
// params: { fabric_id, epi?, ppi?, warp_count?, weft_count?,
//           width_inch?, length_m?, ends_per_dent?, wastage_pct? }
//
// A separate endpoint from /api/calculate rather than a flag on it: the knit
// engine answers "what yarn and machine give me this GSM", the woven engine
// answers "what does this construction weigh and how is it set up on a loom".
// ============================================================
async function apiWovenCalculate(params) {
  return apiFetch('/api/woven/calculate', {
    method: 'POST',
    body: params,
  });
}

// ============================================================
// GET /api/dyeing/recipes, GET /api/dyeing/recipes/:id, POST /api/dyeing/calculate
// A separate endpoint from /api/calculate, same reasoning as woven above:
// this browses/costs a real factory dyeing recipe directly, independent of
// running a full fabric spec through the knit engine.
// ============================================================
async function apiDyeingRecipes() {
  return apiFetch('/api/dyeing/recipes');
}
async function apiDyeingRecipe(id) {
  return apiFetch(`/api/dyeing/recipes/${encodeURIComponent(id)}`);
}
async function apiDyeingCalculate(params) {
  return apiFetch('/api/dyeing/calculate', {
    method: 'POST',
    body: params,
  });
}
async function apiDyeingFaults() {
  return apiFetch('/api/dyeing/faults');
}
async function apiDyeingFaultsDiagnose(symptoms) {
  return apiFetch('/api/dyeing/faults/diagnose', {
    method: 'POST',
    body: { symptoms },
  });
}
async function apiDyeingKnowledge() {
  return apiFetch('/api/dyeing/knowledge');
}
async function apiDyeingTheory() {
  return apiFetch('/api/dyeing/theory');
}

// ============================================================
// POST /api/convert
// params: { value, from, to, category? }
// ============================================================
async function apiConvert(value, from, to, category) {
  return apiFetch('/api/convert', {
    method: 'POST',
    body: { value, from, to, category },
  });
}

// ============================================================
// GET /api/fabrics
// returns: array of { id, name, name_bn, category, gsm_range, gauge_range, ... }
// ============================================================
async function apiFabrics(category) {
  const qs = category ? `?category=${category}` : '';
  return apiFetch(`/api/fabrics${qs}`);
}

// ============================================================
// GET /api/pattern/:slug
// returns: { fabric_id, pattern_cylinder, pattern_dial, cam, ... }
// ============================================================
async function apiPattern(slug) {
  return apiFetch(`/api/pattern/${encodeURIComponent(slug)}`);
}

// ============================================================
// GET /api/stats
// ============================================================
async function apiStats() {
  return apiFetch('/api/stats');
}

// ============================================================
// GET /health
// ============================================================
async function apiHealth() {
  return apiFetch('/health');
}

// ============================================================
// POST /api/yarn/ply
// params: { yarns: [number], system: string }
// ============================================================
async function apiYarnPly(yarns, system) {
  return apiFetch('/api/yarn/ply', {
    method: 'POST',
    body: { yarns, system },
  });
}

// ============================================================
// POST /api/yarn/thread-length
// params: { count, system, weight_g?, length_m?, action: 'length'|'weight' }
// ============================================================
async function apiYarnThreadLength(params) {
  return apiFetch('/api/yarn/thread-length', {
    method: 'POST',
    body: params,
  });
}

// ============================================================
// POST /api/weft/calculate
// params: { dia, rpm, feeders, efficiency, feeders_per_course, courses_per_cm, ... }
// ============================================================
async function apiWeftCalculate(params) {
  return apiFetch('/api/weft/calculate', {
    method: 'POST',
    body: params,
  });
}

// ============================================================
// GET /api/faults
// ============================================================
async function apiFaultsList() {
  return apiFetch('/api/faults');
}

// ============================================================
// POST /api/faults/diagnose
// params: { symptoms: [string], conditions: object }
// ============================================================
async function apiFaultsDiagnose(symptoms, conditions = {}) {
  return apiFetch('/api/faults/diagnose', {
    method: 'POST',
    body: { symptoms, conditions },
  });
}

// ============================================================
// GET /api/academy/content
// ============================================================
async function apiAcademyContent() {
  return apiFetch('/api/academy/content');
}

// ============================================================
// GET /api/academy/quiz
// ============================================================
async function apiAcademyQuiz() {
  return apiFetch('/api/academy/quiz');
}

// ============================================================
// POST /api/academy/quiz/verify
// params: { questionId: string, choice: number }
// ============================================================
async function apiAcademyQuizVerify(questionId, choice) {
  return apiFetch('/api/academy/quiz/verify', {
    method: 'POST',
    body: { questionId, choice }
  });
}

// ============================================================
// GET /api/color/preview?input=...
// Resolves any color input (TCX / hex / SCOTDIC / name) → full viz data
// ============================================================
async function apiColorPreview(input) {
  return apiFetch(`/api/color/preview?input=${encodeURIComponent(input)}`);
}

// ============================================================
// GET /api/color/search?q=...  (name) or ?family=...
// ============================================================
async function apiColorSearch(q, limit = 12) {
  return apiFetch(`/api/color/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

// ============================================================
// GET /api/color/popular
// ============================================================
async function apiColorPopular() {
  return apiFetch('/api/color/popular');
}

// ============================================================
// POST /api/visualize  (internal — no external APIs)
// Generates viz path data for warp knit or large-repeat fabrics.
// For simple weft knit (<=8×8 repeat), FabricVisualizer generates
// path data client-side and does NOT call this endpoint.
// params: { fabric_id: string, result_object: object }
// ============================================================
async function apiVisualize(fabricId, resultObject) {
  return apiFetch('/api/visualize', {
    method: 'POST',
    body: { fabric_id: fabricId, result_object: resultObject },
  });
}

// ============================================================
// GET /api/viz-config/:fabric_id  (internal — reads your own DB)
// Returns viz_configs row for fabric, or { config: null, default: true }
// ============================================================
async function apiVizConfig(fabricId) {
  return apiFetch(`/api/viz-config/${encodeURIComponent(fabricId)}`);
}

// ============================================================
// POST /api/assistant/ask
// Knowledge Assistant (RAG) — answers grounded ONLY in KnitAdvisor's own
// reference data (fibre science, dyeing faults/theory, academy, garment
// costing methodology). Throws (via apiFetch) on 400/429/503 — the caller
// should show err.data?.error || err.message rather than a generic failure,
// since this endpoint's error text is specifically written to be shown.
// ============================================================
async function apiAssistantAsk(question) {
  return apiFetch('/api/assistant/ask', {
    method: 'POST',
    body: { question },
  });
}

// ============================================================
// POST /api/techpack/generate
// Returns a PDF binary, not JSON — bypasses apiFetch's JSON-only assumption
// and hands the caller a Blob to turn into a download.
// ============================================================
async function apiTechPackGenerate(params) {
  const res = await fetch(`${API_BASE}/api/techpack/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/pdf' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    let errData = {};
    try { errData = await res.json(); } catch { /* non-JSON error body */ }
    if (res.status === 401 && errData.code === 'AUTH_REQUIRED' && window.kaSignInRedirect) window.kaSignInRedirect();
    const err = new Error(errData.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = errData;
    throw err;
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match ? match[1] : 'KnitAdvisor-TechPack.pdf' };
}

// ============================================================
// POST /api/rfq/submit
// body: { buyer_name, buyer_email, buyer_company?, buyer_country?, buyer_phone?,
//         message?, line_items: [{ fabric_id, gsm, composition?, garment_type?,
//         garment_weight_g?, order_quantity?, target_price_usd? }, ...] }
// Throws (via apiFetch) with err.data.errors (array) on 400 validation failure.
// ============================================================
async function apiRfqSubmit(payload) {
  return apiFetch('/api/rfq/submit', { method: 'POST', body: payload });
}

// ============================================================
// GET /api/rfq/status/:code — public, no auth. Buyer-facing view only
// (quoted prices once set, never the internal reference calc snapshot).
// ============================================================
async function apiRfqStatus(code) {
  return apiFetch(`/api/rfq/status/${encodeURIComponent(code)}`);
}
