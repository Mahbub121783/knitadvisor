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


