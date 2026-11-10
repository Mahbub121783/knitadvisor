/**
 * The API as sold: plans, and the engine endpoints an API key may call.
 *
 * A key never reaches the account itself (password, sessions, saved designs,
 * AI-quota routes, the scanner's phone pairing) — only the stateless engines
 * below. `path` is the route under /api; a customer calls the same path under
 * /api/v1 (server.js rewrites /api/v1/x to /api/x before routing).
 *
 * EVERY endpoint under /api/v1 needs a key and the email of its owner (X-User-Email) — that is what is sold. Some of the
 * engines (`web_open: true`) are also open on the website at /api/x, with no
 * account, because the web pages use them that way; /api/v1/x is the metered
 * copy of the same code. Anything under /api/v1 that is not listed here, or
 * /api/v1/catalogue (the documentation's data), is refused.
 * The list is the contract: an endpoint added to a route file is not in the API
 * until it is added here.
 */
'use strict';

// monthly calls, calls per minute. A custom figure goes on the key itself.
const PLANS = {
  beta:     { label: 'Beta (free trial)', monthly: 1000,    per_min: 30 },
  starter:  { label: 'Starter',           monthly: 10000,   per_min: 60 },
  pro:      { label: 'Pro',               monthly: 100000,  per_min: 180 },
  business: { label: 'Business',          monthly: 1000000, per_min: 600 },
  custom:   { label: 'Custom',            monthly: 100000,  per_min: 120 },
};

const G = {
  calc: 'Fabric calculator', studio: 'Fabric Studio', cost: 'Costing', dye: 'Dyeing', yarn: 'Yarn and units', woven: 'Woven', ref: 'Reference data',
};

// the last argument: true when the website's own route needs a sign-in (requireUser), false when it is open there
const E = (method, path, group, summary, signedIn, extra) => ({ method, path, group, summary, web_open: !signedIn, ...(extra || {}) });
const ENDPOINTS = [
  E('POST', '/calculate',                G.calc,   'Weft-knit fabric calculation: yarn, machine, stitch length, shrinkage, cost from one spec', true),
  E('POST', '/weft/calculate',           G.calc,   'Weft loop length, production and yarn per fabric', false),
  E('POST', '/striper',                  G.calc,   'Stripe sequence and striper plan', true),
  E('POST', '/quality',                  G.calc,   'Fabric quality check against the factory records', true),
  E('POST', '/fabric-consumption',       G.calc,   'Fabric consumption for a garment', true),
  E('POST', '/techpack/generate',        G.calc,   'Tech-pack content for a fabric calculation', true),
  E('GET',  '/usage',                    G.ref,    'This key: its plan, limits, calls this month and the last 30 days', true),
  E('GET',  '/fabrics',                  G.ref,    'The fabric catalogue', false),
  E('GET',  '/pattern/:slug',            G.ref,    'A knit, tuck and miss pattern, feeder by feeder', false),

  E('GET',  '/studio/templates',         G.studio, 'Starting structures, machines and warp templates', true),
  E('POST', '/studio/analyse',           G.studio, 'Weft design: checks, cam set-out, yarn per feeder, GSM, width, stitch length', true),
  E('POST', '/studio/invent',           G.studio, 'Design from a goal: knittable structures that meet a weight and the qualities asked for, ranked, with settings and accuracy', true),
  E('POST', '/studio/compile',           G.studio, 'A machine set-out and cam chart compiled into needle notation', true),
  E('POST', '/studio/warp/analyse',      G.studio, 'Warp design: lapping, runner, GSM, width, beams, production, checks', true),

  E('POST', '/cost',                     G.cost,   'Fabric cost', true),
  E('POST', '/garment-costing',          G.cost,   'Cut-make-trim and fabric FOB estimate', true),
  E('GET',  '/garment-types',            G.cost,   'Garment types for costing', false),
  E('GET',  '/cost-sheet/options',       G.cost,   'Yarn types, fabrics and shades the costing sheet prices', true),
  E('POST', '/cost-sheet/analyse',       G.cost,   'Buyer quotation by size: yarn, knitting, dyeing, finishing, CM, FOB', true),
  E('POST', '/cost-sheet/pdf',           G.cost,   'The costing sheet as a PDF', true),
  E('GET',  '/charges/vendors',          G.cost,   'Charge-book vendors', false),
  E('GET',  '/fiber-prices',             G.cost,   'Fibre reference prices', false),
  E('GET',  '/yarn-types',               G.cost,   'Yarn types and their reference prices', false),

  E('POST', '/woven/calculate',          G.woven,  'Woven fabric calculation', true),
  E('GET',  '/woven/fabrics',            G.woven,  'The woven fabric catalogue', false),

  E('POST', '/dyeing/calculate',         G.dye,    'Dyeing recipe, process and cost', false),
  E('GET',  '/dyeing/recipes',           G.dye,    'Dyeing recipes', false),
  E('GET',  '/dyeing/recipes/:id',       G.dye,    'One dyeing recipe', false),
  E('POST', '/dyeing/faults/diagnose',   G.dye,    'Dyeing fault diagnosis', false),
  E('GET',  '/faults',                   G.ref,    'Knit fault catalogue', false),
  E('POST', '/faults/diagnose',          G.ref,    'From a symptom to its cause and remedy', false),

  E('POST', '/convert',                  G.yarn,   'Count systems, GSM, length and weight conversion', false),
  E('POST', '/yarn/ply',                 G.yarn,   'Plied yarn count', false),
  E('POST', '/yarn/thread-length',       G.yarn,   'Sewing thread length', false),
];

const toRegex = (p) => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+') + '/?$');
ENDPOINTS.forEach((e) => { e.re = toRegex(e.path); e.id = `${e.method} /api/v1${e.path}`; });

/** The endpoint a request is, or null — what a key may call. `path` is the route path under /api. */
function matchEndpoint(method, path) {
  const m = String(method || '').toUpperCase();
  return ENDPOINTS.find((e) => e.method === m && e.re.test(String(path || ''))) || null;
}

/** A plan's limits, with the key's own figures winning. */
function limitsFor(key) {
  const p = PLANS[key.plan] || PLANS.custom;
  return { monthly: key.monthly_limit != null ? key.monthly_limit : p.monthly, per_min: key.per_min_limit != null ? key.per_min_limit : p.per_min };
}

/** The public face of the list: no regexes. */
function publicList() {
  return ENDPOINTS.map((e) => ({ id: e.id, method: e.method, path: `/api/v1${e.path}`, group: e.group, summary: e.summary, key_required: true }));
}

module.exports = { PLANS, ENDPOINTS, matchEndpoint, limitsFor, publicList };
