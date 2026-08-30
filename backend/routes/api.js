/**
 * KnitAdvisor API Routes
 * 
 * POST /api/calculate  — Main calculation (GSM + fabric → full spec)
 * POST /api/convert    — Unit conversion
 * GET  /api/fabrics    — All fabric types list
 * GET  /api/pattern/:slug — K/T/M pattern for a fabric
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { calculate, getAllFabrics, ENGINE_INPUTS } = require('../engine/index');
const { UnitConverter, FabricWeightFormulas, YarnCountFormulas, WeftCalculators } = require('../engine/formulas');
const { FAULTS_DATABASE, diagnoseFaults } = require('../engine/domain/faults-engine');
const providerManager = require('../ai/provider-manager-v2');
const { getPattern } = require('../engine/domain/pattern-engine');
const { calculateWoven, listWovenFabrics } = require('../engine/domain/woven-engine');
const { isWovenId } = require('../engine/catalog/woven-derivatives');
const { calculateStriper, validateStriperInput } = require('../engine/domain/striper-engine');
const { predictQuality } = require('../engine/domain/quality-engine');
const { calculateCost, SM_PRICE_MATRIX, YARN_TYPE_CATALOG, SM_SURCHARGES } = require('../engine/domain/costing-engine');
const { parseComposition } = require('../engine/domain/composition-engine');
const { GLOSSARY, BASIC_ELEMENTS, FORMATION_CYCLES, QUIZ_QUESTIONS } = require('../engine/domain/academy-engine');
const colorEngine = require('../engine/domain/color-engine');

const memCache = require('../cache/memory-cache');
const { resultCache } = require('../db/repositories/cache-repo');

// Cached results are keyed on the inputs alone, and the DB cache holds them for
// 30 days. That means a calculation-engine fix does not reach anyone whose exact
// inputs were already cached — the rib, colour and shrinkage corrections shipped
// recently would each have been served the pre-fix numbers for a month. Bump
// this whenever engine output changes for the same inputs; it partitions the key
// space so old entries are simply never looked up again (and expire on their own).
//
// v3: three inputs that the route silently dropped now reach the engine
// (shade_depth_pct, the illuminant pair, yarn_organic_type). Any entry cached
// under v2 was computed as if they were absent, so those keys must not be
// reused even though the inputs hash the same way today.
//
// v4: the tightness-factor bands were recalibrated and the TF itself is now
// computed against the count its stitch length was measured with. Same inputs,
// different verdict — a v3 entry can still report UNKNITTABLE for a
// construction that now reads KNITTABLE. This is exactly the case the version
// prefix exists for, and it is easy to forget: changing a CONSTANT the engine
// reads changes engine output just as surely as changing its code.
const ENGINE_VERSION = 'v4';
const logsRepo = require('../db/repositories/logs-repo');
const { createRateLimiter } = require('../middleware/rate-limiter');
const { query: dbQuery } = require('../db/client');

// Unsalted MD5 of an IP is not pseudonymisation: IPv4 is only 4 billion values,
// so the digest can be reversed exhaustively. The salt is what makes it one-way
// in practice; without one configured, a per-process random value at least
// keeps the logs from being a lookup table.
const IP_HASH_SALT = process.env.IP_HASH_SALT || crypto.randomBytes(16).toString('hex');
function hashIp(ip) {
  return ip ? crypto.createHash('sha256').update(IP_HASH_SALT + ip).digest('hex').slice(0, 32) : null;
}

// ============================================================
// POST /api/calculate
// ============================================================
router.post('/calculate', async (req, res) => {
  const startTime = Date.now();
  const body = req.body || {};

  let fabric = body.fabric;
  let gsm = body.gsm ? parseFloat(body.gsm) : null;

  // Basic validation
  if (!fabric || !gsm) {
    return res.status(400).json({
      error: 'fabric and gsm are required',
      example: { fabric: 'single_jersey', gsm: 180 },
    });
  }

  // Both the engine params and the cache key are derived from the engine's own
  // canonical input list. They used to be two hand-maintained arrays that had
  // to agree with each other and with normalizeParams(), and they had drifted:
  // a field missing from the params list is silently ignored by the engine, and
  // a field missing from the key makes two genuinely different requests collide
  // on one cached answer. Deriving both from ENGINE_INPUTS makes the two
  // impossible to desynchronise — adding an input to the engine forwards it and
  // keys on it with no change here.
  const engineParams = {};
  for (const field of ENGINE_INPUTS) {
    if (body[field] !== undefined) engineParams[field] = body[field];
  }
  engineParams.fabric = fabric;
  engineParams.gsm = gsm;
  // Normalise the one input that has a default, so "omitted" and "sent as 85"
  // are the same cache entry rather than two entries holding the same answer.
  engineParams.efficiency = body.efficiency || 85;

  const cacheInput = ENGINE_INPUTS
    .map(f => (engineParams[f] == null ? '' : engineParams[f]))
    .join('_');
  const cacheKey = crypto.createHash('md5').update(ENGINE_VERSION + '|' + cacheInput).digest('hex');

  // L1 — memory cache
  const memResult = memCache.get(cacheKey);
  if (memResult) {
    memResult.from_cache = 'memory';
    memResult.response_ms = Date.now() - startTime;

    // Log async (don't wait)
    logsRepo.record({
      input_text: JSON.stringify(body),
      input_type: 'form',
      parsed_fabric: fabric,
      parsed_gsm: gsm,
      response_ms: memResult.response_ms,
      from_cache: true,
      cache_key: cacheKey,
      ip_hash: hashIp(req.ip),
      user_agent: (req.get('user-agent') || '').slice(0, 200),
    }).catch(() => {});

    return res.json(memResult);
  }

  // L2 — DB cache
  const dbResult = await resultCache.get(cacheKey);
  if (dbResult) {
    dbResult.from_cache = 'database';
    dbResult.response_ms = Date.now() - startTime;
    memCache.set(cacheKey, dbResult); // promote to L1

    logsRepo.record({
      input_text: JSON.stringify(body),
      input_type: 'form',
      parsed_fabric: fabric,
      parsed_gsm: gsm,
      response_ms: dbResult.response_ms,
      from_cache: true,
      cache_key: cacheKey,
      ip_hash: hashIp(req.ip),
      user_agent: (req.get('user-agent') || '').slice(0, 200),
    }).catch(() => {});

    return res.json(dbResult);
  }

  // Cache miss — calculate
  const result = calculate(engineParams);

  if (result.error) {
    return res.status(400).json(result);
  }

  result.from_cache = false;
  result.response_ms = Date.now() - startTime;

  // Cache the result (L1 + L2)
  memCache.set(cacheKey, result);
  resultCache.set(cacheKey, result).catch(() => {});

  // Log async
  logsRepo.record({
    input_text: JSON.stringify(body),
    input_type: 'form',
    parsed_fabric: fabric,
    parsed_gsm: gsm,
    parsed_dia: body.dia || null,
    parsed_gauge: body.gauge || null,
    response_ms: result.response_ms,
    from_cache: false,
    cache_key: cacheKey,
    ip_hash: hashIp(req.ip),
    user_agent: (req.get('user-agent') || '').slice(0, 200),
  }).catch(() => {});

  res.json(result);
});

// ============================================================
// POST /api/striper
// ============================================================
router.post('/striper', (req, res) => {
  const body = req.body || {};

  const validationErrors = validateStriperInput(body);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validationErrors,
      example: {
        fabric: 'single_jersey',
        gsm: 180,
        gauge: 24,
        dia: 30,
        rpm: 25,
        efficiency: 85,
        composition: '100% Cotton',
        garment_length: 70,
        garment_width: 50,
        stripes: [
          { color: 'White',  height_mm: 30, composition: '100% Cotton',         count_ne: 30 },
          { color: 'Navy',   height_mm: 20, composition: '60% Cotton 40% Poly',  count_ne: 26 },
          { color: 'Red',    height_mm: 10, composition: '100% Cotton',          count_ne: 34 },
        ]
      }
    });
  }

  try {
    const result = calculateStriper(body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// POST /api/quality — Predictive Shrinkage, Spirality & Quality
// ============================================================
router.post('/quality', (req, res) => {
  const body = req.body || {};
  const gsm = parseFloat(body.gsm);
  if (!gsm || isNaN(gsm)) {
    return res.status(400).json({
      error: 'gsm is required',
      example: {
        fabric: 'single_jersey',
        gsm: 180,
        stitch_length: 2.8,
        tightness_factor: 14.2,
        count_ne: 30,
        composition: '60% Cotton 40% Polyester',
      }
    });
  }
  try {
    const parsedComp = body.composition ? parseComposition(body.composition) : null;
    const result = predictQuality({ ...body, gsm, parsedComp });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/cost — Financial Raw Material Costing
// ============================================================
router.post('/cost', (req, res) => {
  const body = req.body || {};
  const gsm = parseFloat(body.gsm);
  if (!gsm || isNaN(gsm)) {
    return res.status(400).json({
      error: 'gsm is required',
      example: {
        fabric: 'single_jersey',
        gsm: 180,
        gauge: 24,
        count_ne: 30,
        color_shade: 'medium',
        currency: 'BDT',
        composition: '60% Cotton 40% Polyester',
        yarn_prices: { cotton: 3.80, polyester: 1.50 },
        garment_weight_g: 220,
      }
    });
  }
  try {
    const parsedComp = body.composition ? parseComposition(body.composition) : null;
    const result = calculateCost({ ...body, gsm, parsedComp });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/fiber-prices — Reference fiber prices
// ============================================================
router.get('/fiber-prices', (req, res) => {
  res.json({
    currency: 'USD',
    unit: 'per kg',
    note: 'Reference benchmark prices from KnitAdvisor certified industry-verified database (May 2026). Pass yarn_type and count_ne to POST /api/cost for exact pricing.',
    surcharge_rules: SM_SURCHARGES,
    yarn_types: YARN_TYPE_CATALOG,
  });
});

// ============================================================
// GET /api/yarn-types — Full yarn type catalog
// ============================================================
router.get('/yarn-types', (req, res) => {
  const category = req.query.category;
  let catalog = Object.entries(YARN_TYPE_CATALOG).map(([key, val]) => ({
    key,
    ...val,
    available_counts: Object.keys(SM_PRICE_MATRIX[key] || {})
      .filter(k => !isNaN(k))
      .map(Number)
      .sort((a, b) => a - b),
  }));
  if (category) {
    catalog = catalog.filter(c => c.category.toLowerCase() === category.toLowerCase());
  }
  res.json({ total: catalog.length, yarn_types: catalog });
});




// ============================================================
// POST /api/convert
// ============================================================
router.post('/convert', (req, res) => {
  const { value, from, to, category } = req.body || {};

  if (value === undefined || !from || !to) {
    return res.status(400).json({ error: 'value, from, and to are required' });
  }

  const v = parseFloat(value);
  if (!Number.isFinite(v)) return res.status(400).json({ error: 'value must be a finite number' });

  // Every conversion here is a ratio with the input in the denominator or a
  // physical quantity, so zero and negatives have no meaning. Left unchecked,
  // 0 produced Infinity, which JSON.stringify writes as null — the endpoint
  // answered HTTP 200 with "result": null instead of reporting bad input, and
  // a negative count came back as a negative Tex.
  const isYarn = category === 'yarn' || from === 'gauge' || from === 'pitch';
  if (v <= 0 && (isYarn || category === 'weight' || category === 'length' || from === 'gsm' || from === 'osy')) {
    return res.status(400).json({ error: 'value must be greater than zero' });
  }

  try {
    let result, formula;

    // Grammage
    if ((from === 'gsm' && to === 'osy') || (from === 'osy' && to === 'gsm')) {
      result = from === 'gsm' ? FabricWeightFormulas.gsmToOsy(v) : FabricWeightFormulas.osyToGsm(v);
      formula = from === 'gsm' ? 'GSM × 0.836 / 28.35' : 'OSY × 28.35 / 0.836';
    }
    // Yarn count
    else if (
      category === 'yarn' ||
      ['ne', 'nm', 'tex', 'denier', 'den', 'dtex', 'mtex', 'ktex', 'jute', 'nek', 'nel', 'new', 'ysw', 'dewsbury'].includes(from.toLowerCase()) &&
      ['ne', 'nm', 'tex', 'denier', 'den', 'dtex', 'mtex', 'ktex', 'jute', 'nek', 'nel', 'new', 'ysw', 'dewsbury'].includes(to.toLowerCase())
    ) {
      result = YarnCountFormulas.convertYarnCount(v, from, to);
      formula = `Yarn count: ${from} → ${to}`;
    }
    // Length
    else if (category === 'length') {
      result = UnitConverter.convertLength(v, from, to);
      formula = `${from} → meters → ${to}`;
    }
    // Weight
    else if (category === 'weight') {
      result = UnitConverter.convertWeight(v, from, to);
      formula = `${from} → grams → ${to}`;
    }
    // Gauge ↔ Pitch
    else if (from === 'gauge' && to === 'pitch') {
      result = 25.4 / v;
      formula = '25.4 / gauge';
    } else if (from === 'pitch' && to === 'gauge') {
      result = 25.4 / v;
      formula = '25.4 / pitch_mm';
    }
    else {
      return res.status(400).json({ error: `Unknown conversion: ${from} → ${to}` });
    }

    // Guard the output too: an unforeseen input combination reaching a divide
    // must surface as an error, never as a silent null in a numeric field.
    if (!Number.isFinite(result)) {
      return res.status(400).json({ error: `Conversion ${from} → ${to} is undefined for value ${v}` });
    }

    res.json({
      input: v,
      from,
      to,
      result: parseFloat(result.toFixed(6)),
      formula,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
// GET /api/fabrics
// ============================================================
//
// Knit and woven qualities come from two separate catalogs and are merged
// only here, at the edge, where the difference stops mattering: to someone
// filling in a form they are all just "a fabric you can pick". Below this
// line they stay apart, because a woven cloth has no gauge, no stitch length
// and no course or wale, and a shared row would have to leave half its
// columns null and hope the reader knows which half.
//
// A woven row carries `construction` ("56x44, 8s/6s") where a knit row
// carries `gsm_range`, because that is how each kind of quality is actually
// named in a buyer's email.
router.get('/fabrics', (req, res) => {
  const knit = getAllFabrics();
  const woven = listWovenFabrics().map(f => ({
    id: f.id,
    name: f.name,
    name_bn: f.name_bn,
    category: 'woven',
    family: f.family,
    gsm_range: null,
    gauge_range: null,
    is_multi_yarn: false,
    is_warp: false,
    is_woven: true,
    construction: f.construction,
    nominal_gsm: f.nominal_gsm,
    sett_source: f.sett_source,
    has_structure: f.has_structure,
    book_page: f.book_page,
  }));
  const fabrics = [...knit, ...woven];
  const cat = req.query.category;
  if (cat) {
    return res.json(fabrics.filter(f => f.category === cat));
  }
  res.json(fabrics);
});

// ============================================================
// POST /api/woven/calculate
// ============================================================
//
// A separate call from /calculate rather than a branch inside it. The knit
// engine answers "what yarn and machine give me this GSM"; the woven engine
// answers "what does this construction weigh and how is it set up on a loom".
// They share no input beyond the fabric name, so one endpoint would be two
// endpoints wearing one URL.
router.post('/woven/calculate', (req, res) => {
  try {
    const result = calculateWoven(req.body || {});
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[Woven] calculate failed:', err);
    res.status(500).json({ success: false, error: 'WOVEN_CALCULATION_FAILED', message: err.message });
  }
});

// ============================================================
// GET /api/woven/fabrics
// ============================================================
router.get('/woven/fabrics', (req, res) => res.json(listWovenFabrics()));

// ============================================================
// GET /api/pattern/:slug
// ============================================================
router.get('/pattern/:slug', (req, res) => {
  const gsm = req.query.gsm ? parseFloat(req.query.gsm) : null;
  const gauge = req.query.gauge ? parseFloat(req.query.gauge) : null;
  const composition = req.query.composition || null;

  // A woven id answers with its loom plans instead of a K/T/M grid. The
  // `fabric_type` discriminator is the same mechanism warp knit already uses,
  // so the renderer picks the right drawing without the caller knowing which
  // catalog the id came from.
  if (isWovenId(req.params.slug)) {
    const r = calculateWoven({ fabric_id: req.params.slug });
    if (!r.success) return res.status(404).json({ error: `Pattern not found for: ${req.params.slug}` });
    return res.json({
      fabric_type: 'woven',
      fabric_id: r.fabric.id,
      fabric_name: r.fabric.name,
      family: r.fabric.family,
      weave_slug: r.fabric.weave_slug,
      construction: r.construction,
      structure: r.structure,
      weight: r.weight,
      cover: r.cover,
      twill_angle: r.twill_angle,
      characteristics: r.fabric.characteristics,
      end_uses: r.fabric.end_uses,
      book_page: r.fabric.book_page,
      notes: r.notes,
    });
  }

  const pattern = getPattern(req.params.slug, gsm, gauge, composition);
  if (!pattern) {
    return res.status(404).json({ error: `Pattern not found for: ${req.params.slug}` });
  }
  res.json(pattern);
});

// ============================================================
// GET /api/stats (public — basic cache stats)
// ============================================================
router.get('/stats', async (req, res) => {
  const memStats = memCache.stats();
  const dbStats = await resultCache.stats();
  res.json({
    memory_cache: memStats,
    db_cache: dbStats,
    fabric_count: getAllFabrics().length,
  });
});

// ============================================================
// POST /api/parse (AI Natural Language)
// ============================================================
// Unlike every other endpoint here, this one costs money on each call: it
// forwards to paid AI providers. Public and unauthenticated it was a way for
// anyone to burn the account's provider quota, so it gets its own much tighter
// budget than general API browsing, plus a length cap — a natural-language
// fabric query is a sentence, and the body limit alone allowed far more.
const MAX_PARSE_CHARS = 500;
const parseLimiter = createRateLimiter({
  name: 'ai-parse',
  max: 20,
  windowMs: 60 * 1000,
  message: 'Too many natural-language queries. Please wait a minute.',
});

router.post('/parse', parseLimiter, async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > MAX_PARSE_CHARS) {
    return res.status(400).json({ error: `text must be ${MAX_PARSE_CHARS} characters or fewer` });
  }

  try {
    const parsed = await providerManager.parse(text.trim());
    res.json(parsed);
  } catch (err) {
    console.error('[Parse Error]', err.message);
    res.status(502).json({ error: 'Natural-language parsing is unavailable right now.' });
  }
});

// ============================================================
// POST /api/yarn/ply
// ============================================================
router.post('/yarn/ply', (req, res) => {
  const { yarns, system } = req.body || {};
  if (!yarns || !Array.isArray(yarns) || yarns.length === 0 || !system) {
    return res.status(400).json({ error: 'yarns (array of numbers) and system are required' });
  }
  try {
    const numericYarns = yarns.map(y => {
      const parsed = parseFloat(y);
      if (isNaN(parsed)) throw new Error('All yarn counts must be valid numbers');
      return parsed;
    });
    const result = YarnCountFormulas.calcPlyCount(numericYarns, system);
    res.json({
      yarns: numericYarns,
      system,
      result: parseFloat(result.toFixed(6)),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
// POST /api/yarn/thread-length
// ============================================================
router.post('/yarn/thread-length', (req, res) => {
  const { count, system, weight_g, length_m, action } = req.body || {};
  if (count === undefined || !system || !action) {
    return res.status(400).json({ error: 'count, system, and action are required' });
  }
  const numericCount = parseFloat(count);
  if (isNaN(numericCount)) return res.status(400).json({ error: 'count must be a number' });

  try {
    if (action === 'length') {
      if (weight_g === undefined) return res.status(400).json({ error: 'weight_g is required for action: length' });
      const w = parseFloat(weight_g);
      if (isNaN(w)) return res.status(400).json({ error: 'weight_g must be a number' });
      const length = YarnCountFormulas.calcConeLength(numericCount, system, w);
      res.json({
        count: numericCount,
        system,
        weight_g: w,
        result: parseFloat(length.toFixed(4)),
        unit: 'meters',
        formula: system.toLowerCase() === 'ne' ? 'Count × Weight(g) × 1.6933' : (system.toLowerCase() === 'nm' ? 'Count × Weight(g)' : '(Weight(g) × 1000) / Tex')
      });
    } else if (action === 'weight') {
      if (length_m === undefined) return res.status(400).json({ error: 'length_m is required for action: weight' });
      const l = parseFloat(length_m);
      if (isNaN(l)) return res.status(400).json({ error: 'length_m must be a number' });
      const weight = YarnCountFormulas.calcConeWeight(numericCount, system, l);
      res.json({
        count: numericCount,
        system,
        length_m: l,
        result: parseFloat(weight.toFixed(4)),
        unit: 'grams',
        formula: system.toLowerCase() === 'ne' ? 'Length(m) / (Count × 1.6933)' : (system.toLowerCase() === 'nm' ? 'Length(m) / Count' : '(Length(m) × Tex) / 1000')
      });
    } else {
      res.status(400).json({ error: "action must be 'length' or 'weight'" });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
// POST /api/weft/calculate
// ============================================================
router.post('/weft/calculate', (req, res) => {
  const body = req.body || {};
  const results = {};
  const formulas = {};

  const dia = parseFloat(body.dia);
  const rpm = parseFloat(body.rpm);
  const feeders = parseFloat(body.feeders);
  const efficiency = parseFloat(body.efficiency);
  const feeders_per_course = parseFloat(body.feeders_per_course) || 1;
  const courses_per_cm = parseFloat(body.courses_per_cm);
  const wales_per_cm = parseFloat(body.wales_per_cm);
  const gauge = parseFloat(body.gauge);
  const gsm = parseFloat(body.gsm);
  const count_ne = parseFloat(body.count_ne);
  const sl_cm = parseFloat(body.sl_cm);
  const loop_length_cm = parseFloat(body.loop_length_cm);
  const k_constant = parseFloat(body.k_constant);
  const tex = parseFloat(body.tex);

  try {
    // 1. Knitting Speed
    if (!isNaN(dia) && !isNaN(rpm)) {
      results.knitting_speed = WeftCalculators ? 0.00133 * dia * rpm : MachineFormulas.calcKnittingSpeed(dia, rpm);
      formulas.knitting_speed = "V = 0.00133 × Diameter × RPM";
    }
    // 2. System Density
    if (!isNaN(feeders) && !isNaN(dia)) {
      results.system_density = feeders / dia;
      formulas.system_density = "SD = Feeders / Diameter";
    }
    // 3. Speed Factor
    if (!isNaN(feeders) && !isNaN(rpm)) {
      results.speed_factor = feeders * rpm;
      formulas.speed_factor = "SF = Feeders × RPM";
    }
    // 4. Running Meters
    if (!isNaN(rpm) && !isNaN(feeders) && !isNaN(efficiency) && !isNaN(courses_per_cm)) {
      const eff = efficiency / 100;
      results.running_meters_hr = (rpm * feeders * eff * 60) / (feeders_per_course * courses_per_cm * 100);
      formulas.running_meters_hr = "L = (RPM × Feeders × Efficiency × 60) / (Feeders_per_course × Courses/cm × 100)";
    }
    // 5. Open Width
    if (!isNaN(dia) && !isNaN(gauge) && !isNaN(wales_per_cm)) {
      results.open_width_m = (Math.PI * dia * gauge) / (wales_per_cm * 100);
      formulas.open_width_m = "W_B = (π × Diameter × Gauge) / (Wales/cm × 100)";
    }
    // 6. Production Weight (from running meters)
    if (results.running_meters_hr && results.open_width_m && !isNaN(gsm)) {
      results.production_kg_hr_m = (results.running_meters_hr * results.open_width_m * gsm) / 1000;
      formulas.production_kg_hr_m = "P_kg = (L × W_B × GSM) / 1000";
    }
    // 7. Production Weight Direct Ne (yarn weight method)
    if (!isNaN(rpm) && !isNaN(feeders) && !isNaN(dia) && !isNaN(gauge) && !isNaN(sl_cm) && !isNaN(efficiency) && !isNaN(count_ne)) {
      const eff = efficiency / 100;
      const factor = 0.00001112598;
      results.production_kg_hr_ne = (rpm * feeders * (dia * gauge * sl_cm) * eff * Math.PI * factor) / count_ne;
      formulas.production_kg_hr_ne = "P_kg = (RPM × Feeders × Diameter × Gauge × SL_cm × Efficiency × π × 0.00001112598) / Ne";
    }
    // 8. Stitch Density
    if (!isNaN(loop_length_cm) && !isNaN(k_constant)) {
      results.stitch_density = k_constant / (loop_length_cm * loop_length_cm);
      formulas.stitch_density = "Stitch Density = K / (LoopLength_cm^2)";
    }
    // 9. Cover Factor
    if (!isNaN(tex) && !isNaN(loop_length_cm)) {
      results.cover_factor = Math.sqrt(tex) / loop_length_cm;
      formulas.cover_factor = "Cover Factor = sqrt(Tex) / LoopLength_cm";
    }
    // 10. GSM from Stitch Density
    if (!isNaN(loop_length_cm) && !isNaN(tex)) {
      const density = results.stitch_density || (k_constant ? k_constant / (loop_length_cm * loop_length_cm) : null);
      if (density) {
        results.gsm_from_structure = (density * loop_length_cm * tex) / 10;
        formulas.gsm_from_structure = "GSM = (Stitch Density × LoopLength_cm × Tex) / 10";
      }
    }
    // 11. Gauge match from Tex
    if (!isNaN(tex)) {
      results.optimum_gauge_sj = 2.54 * Math.sqrt(1650 / tex);
      results.optimum_gauge_dj = 2.54 * Math.sqrt(1400 / tex);
      formulas.optimum_gauge_sj = "Gauge_SJ = 2.54 × sqrt(1650 / Tex)";
      formulas.optimum_gauge_dj = "Gauge_DJ = 2.54 × sqrt(1400 / Tex)";
    }
    // 12. Tex match from Gauge
    if (!isNaN(gauge)) {
      results.optimum_tex_sj = (1650 * 2.54 * 2.54) / (gauge * gauge);
      results.optimum_tex_dj = (1400 * 2.54 * 2.54) / (gauge * gauge);
      formulas.optimum_tex_sj = "Tex_SJ = (1650 × 2.54^2) / Gauge^2";
      formulas.optimum_tex_dj = "Tex_DJ = (1400 × 2.54^2) / Gauge^2";
    }

    // Format results to standard float decimals
    Object.keys(results).forEach(k => {
      if (typeof results[k] === 'number') {
        results[k] = parseFloat(results[k].toFixed(4));
      }
    });

    res.json({
      success: true,
      inputs: body,
      results,
      formulas
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/faults
// ============================================================
router.get('/faults', (req, res) => {
  res.json({ success: true, faults: FAULTS_DATABASE });
});

// ============================================================
// POST /api/faults/diagnose
// ============================================================
router.post('/faults/diagnose', (req, res) => {
  const { symptoms, conditions } = req.body || {};
  try {
    const diagnosed = diagnoseFaults(symptoms || [], conditions || {});
    res.json({ success: true, diagnosed });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/academy/content
// ============================================================
router.get('/academy/content', (req, res) => {
  res.json({
    success: true,
    glossary: GLOSSARY,
    basic_elements: BASIC_ELEMENTS,
    formation_cycles: FORMATION_CYCLES
  });
});

// ============================================================
// GET /api/academy/quiz
// ============================================================
router.get('/academy/quiz', (req, res) => {
  const sanitizedQuestions = QUIZ_QUESTIONS.map(q => ({
    id: q.id,
    question: q.question,
    options: q.options,
    page: q.page
  }));
  res.json({ success: true, questions: sanitizedQuestions });
});

// ============================================================
// POST /api/academy/quiz/verify
// ============================================================
router.post('/academy/quiz/verify', (req, res) => {
  const { questionId, choice } = req.body || {};
  const question = QUIZ_QUESTIONS.find(q => q.id === questionId);
  if (!question) {
    return res.status(404).json({ success: false, error: 'Question not found' });
  }
  const isCorrect = choice === question.answer;
  res.json({
    success: true,
    correct: isCorrect,
    correctAnswer: question.options[question.answer],
    correctAnswerIndex: question.answer,
    explanation: question.explanation,
    page: question.page
  });
});

// ============================================================
// COLOR ENGINE ROUTES
// GET  /api/color/preview?input=...   — full viz-ready data for any color input
// GET  /api/color/popular             — popular Bangladesh knitwear colors
// GET  /api/color/search?q=...        — search TCX by name/family
// ============================================================
router.get('/color/preview', (req, res) => {
  const input = (req.query.input || '').toString().trim();
  if (!input) return res.status(400).json({ error: 'input query param is required' });
  try {
    const preview = colorEngine.getColorPreview(input);
    if (!preview) return res.status(404).json({ error: 'Color not recognised', input });
    res.json({ success: true, input, color: preview });
  } catch (err) {
    res.status(500).json({ error: 'Color engine failure', detail: err.message });
  }
});

router.get('/color/popular', (req, res) => {
  try {
    res.json({ success: true, colors: colorEngine.getPopularColors() });
  } catch (err) {
    res.status(500).json({ error: 'Color engine failure', detail: err.message });
  }
});

router.get('/color/search', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const family = (req.query.family || '').toString().trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 12, 48);
  try {
    let results = [];
    if (family) results = colorEngine.searchByFamily(family, limit);
    else if (q) results = colorEngine.searchByName(q, limit);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: 'Color engine failure', detail: err.message });
  }
});

module.exports = router;
