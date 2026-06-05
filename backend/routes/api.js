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

const { calculate, getAllFabrics } = require('../engine/calculator');
const { UnitConverter, FabricWeightFormulas, YarnCountFormulas, WeftCalculators } = require('../engine/formulas');
const { FAULTS_DATABASE, diagnoseFaults } = require('../engine/faults-engine');
const providerManager = require('../ai/provider-manager-v2');
const { getPattern } = require('../engine/pattern-engine');
const { calculateStriper, validateStriperInput } = require('../engine/striper-engine');
const { predictQuality } = require('../engine/quality-engine');
const { calculateCost, SM_PRICE_MATRIX, YARN_TYPE_CATALOG, SM_SURCHARGES } = require('../engine/costing-engine');
const { parseComposition } = require('../engine/composition-engine');
const { GLOSSARY, BASIC_ELEMENTS, FORMATION_CYCLES, QUIZ_QUESTIONS } = require('../engine/academy-engine');
const colorEngine = require('../engine/color-engine');

const memCache = require('../cache/memory-cache');
const dbCache = require('../cache/db-cache');
const { logQuery } = require('../middleware/logger');
const { query: dbQuery } = require('../config/database');

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

  // Normalize cache key (includes composition + color for unique caching)
  const cacheInput = `${fabric}_${gsm}_${body.composition||''}_${body.color_shade||''}_${body.color_input||''}_${body.dia||''}_${body.gauge||''}_${body.rpm||''}_${body.efficiency||85}_${body.denier||''}_${body.filaments||''}_${body.elastane_denier||''}_${body.elastane_pct||''}`;
  const cacheKey = crypto.createHash('md5').update(cacheInput).digest('hex');

  // L1 — memory cache
  const memResult = memCache.get(cacheKey);
  if (memResult) {
    memResult.from_cache = 'memory';
    memResult.response_ms = Date.now() - startTime;

    // Log async (don't wait)
    logQuery(dbQuery, {
      input_text: JSON.stringify(body),
      input_type: 'form',
      parsed_fabric: fabric,
      parsed_gsm: gsm,
      response_ms: memResult.response_ms,
      from_cache: true,
      cache_key: cacheKey,
      ip: req.ip,
      user_agent: req.get('user-agent'),
    }).catch(() => {});

    return res.json(memResult);
  }

  // L2 — DB cache
  const dbResult = await dbCache.get(cacheKey);
  if (dbResult) {
    dbResult.from_cache = 'database';
    dbResult.response_ms = Date.now() - startTime;
    memCache.set(cacheKey, dbResult); // promote to L1

    logQuery(dbQuery, {
      input_text: JSON.stringify(body),
      input_type: 'form',
      parsed_fabric: fabric,
      parsed_gsm: gsm,
      response_ms: dbResult.response_ms,
      from_cache: true,
      cache_key: cacheKey,
      ip: req.ip,
      user_agent: req.get('user-agent'),
    }).catch(() => {});

    return res.json(dbResult);
  }

  // Cache miss — calculate
  const result = calculate({
    fabric,
    gsm,
    composition:     body.composition,
    color_shade:     body.color_shade,
    color_input:     body.color_input,
    dia:             body.dia,
    gauge:           body.gauge,
    rpm:             body.rpm,
    efficiency:      body.efficiency,
    stitch_length:   body.stitch_length,
    feeders:         body.feeders,
    // Warp knit parameters
    denier:          body.denier,
    filaments:       body.filaments,
    elastane_denier: body.elastane_denier,
    elastane_pct:    body.elastane_pct,
  });

  if (result.error) {
    return res.status(400).json(result);
  }

  result.from_cache = false;
  result.response_ms = Date.now() - startTime;

  // Cache the result (L1 + L2)
  memCache.set(cacheKey, result);
  dbCache.set(cacheKey, result).catch(() => {});

  // Log async
  logQuery(dbQuery, {
    input_text: JSON.stringify(body),
    input_type: 'form',
    parsed_fabric: fabric,
    parsed_gsm: gsm,
    parsed_dia: body.dia || null,
    parsed_gauge: body.gauge || null,
    result_json: result,
    response_ms: result.response_ms,
    from_cache: false,
    cache_key: cacheKey,
    ip: req.ip,
    user_agent: req.get('user-agent'),
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
  if (isNaN(v)) return res.status(400).json({ error: 'value must be a number' });

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
router.get('/fabrics', (req, res) => {
  const fabrics = getAllFabrics();
  const cat = req.query.category;
  if (cat) {
    return res.json(fabrics.filter(f => f.category === cat));
  }
  res.json(fabrics);
});

// ============================================================
// GET /api/pattern/:slug
// ============================================================
router.get('/pattern/:slug', (req, res) => {
  const gsm = req.query.gsm ? parseFloat(req.query.gsm) : null;
  const gauge = req.query.gauge ? parseFloat(req.query.gauge) : null;
  const composition = req.query.composition || null;

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
  const dbStats = await dbCache.stats();
  res.json({
    memory_cache: memStats,
    db_cache: dbStats,
    fabric_count: getAllFabrics().length,
  });
});

// ============================================================
// POST /api/parse (AI Natural Language)
// ============================================================
router.post('/parse', async (req, res) => {
  const { text } = req.body || {};
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const parsed = await providerManager.parse(text);
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
