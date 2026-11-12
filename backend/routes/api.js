/**
 * KnitAdvisor API Routes
 * 
 * POST /api/calculate  — Main calculation (GSM + fabric → full spec)
 * POST /api/convert    — Unit conversion
 * GET  /api/fabrics    — All fabric types list
 * GET  /api/pattern/:slug — K/T/M pattern for a fabric
 */
const express = require('express');
const { requireUser } = require('../middleware/user-auth');
const { enforceDailyLimit } = require('../middleware/plan-limit');
const userRepo = require('../db/repositories/user-repo');
const { buildHistoryEntry } = require('../engine/domain/calc-history');
const crypto = require('crypto');
const router = express.Router();

const { calculate, getAllFabrics, ENGINE_INPUTS } = require('../engine/index');
const { analyzeShadeSpec } = require('../engine/domain/shade-spec');
const { dyeingCharge } = require('../engine/domain/wet-cost-model');
const { UnitConverter, FabricWeightFormulas, YarnCountFormulas, WeftCalculators } = require('../engine/formulas');
const { FAULTS_DATABASE, diagnoseFaults } = require('../engine/domain/faults-engine');
const providerManager = require('../ai/provider-manager-v2');
const { getPattern } = require('../engine/domain/pattern-engine');
const { calculateWoven, listWovenFabrics } = require('../engine/domain/woven-engine');
const { listDyeingRecipes, getDyeingRecipe, matchDyeingRecipe, calculateDyeingCost } = require('../engine/domain/dyeing-engine');
const { diagnoseDyeingFaults, listDyeingFaults, getDyeingKnowledge } = require('../engine/domain/dyeing-faults-engine');
const { getDyeingTheory, getDyeClass, getMachine, getProcessFlow } = require('../engine/domain/dyeing-theory-engine');
const { DEFAULT_EXCHANGE_RATES } = require('../engine/domain/costing-engine');
const { isWovenId } = require('../engine/catalog/woven-derivatives');
const { calculateStriper, validateStriperInput } = require('../engine/domain/striper-engine');
const { calculateGarmentCosting } = require('../engine/domain/garment-costing-engine');
const { calculateFabricConsumption } = require('../engine/domain/fabric-consumption-engine');
const { GARMENT_CATALOG } = require('../engine/catalog/garment-operations');
const { predictQuality } = require('../engine/domain/quality-engine');
const { calculateCost, SM_PRICE_MATRIX, YARN_TYPE_CATALOG, SM_SURCHARGES } = require('../engine/domain/costing-engine');
const { parseComposition } = require('../engine/domain/composition-engine');
const { GLOSSARY, BASIC_ELEMENTS, FORMATION_CYCLES, QUIZ_QUESTIONS } = require('../engine/domain/academy-engine');
const colorEngine = require('../engine/domain/color-engine');
const { buildTechPackContent } = require('../engine/domain/techpack-content-builder');
const { renderTechPackPdf } = require('../engine/domain/techpack-pdf-renderer');
const fabricStudio = require('../engine/domain/fabric-studio');
const knitMachine = require('../engine/domain/knit-machine');
const warpStudio = require('../engine/domain/warp-studio');
const studioRepo = require('../db/repositories/studio-repo');

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
//
// AND IT WAS FORGOTTEN. Every chapter of fibre science added after v4 was
// shipped, deployed and verified on the production machine while the site went
// on serving answers computed before any of it existed: `node -e` there gave
// seventeen findings and the same calculation over HTTP gave eight, from
// byte-identical files. Thirty-day cache, no bump, no symptom.
//
// So it is no longer a string anyone has to remember. It is the deployed build,
// read from tmp/restart.txt, which the deploy writes and nothing else touches —
// see engine/version.js for what that costs and why it is worth it.
const { ENGINE_VERSION } = require('../engine/version');
const yarnPrices = require('../db/repositories/yarn-price-repo');
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

// A signed-in user's calculations are kept as their history. Fire-and-forget: a
// failure to record must never fail the calculation it describes.
function recordHistory(req, body, result) {
  if (!req.user) return;
  const entry = buildHistoryEntry(ENGINE_INPUTS, body, result);
  if (!entry) return;
  userRepo.calculations.record(req.user.id, entry)
    .catch(err => console.error('[History] record failed:', err.message));
}

// ============================================================
// POST /api/calculate
// ============================================================
router.post('/calculate', requireUser, enforceDailyLimit, async (req, res) => {
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
  // The price list is part of the answer, so it has to be part of the key.
  // Results are cached for thirty days; without this, a sync that moved cotton
  // three per cent would leave every cached costing quoting the old figure
  // until the next deploy — which is precisely the failure that had answers
  // from a dead engine being served for a month, arriving by a different door.
  const priceStamp = yarnPrices.stamp();
  const cacheKey = crypto.createHash('md5')
    .update(ENGINE_VERSION + '|' + priceStamp + '|' + cacheInput).digest('hex');

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

    recordHistory(req, body, memResult);
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

    recordHistory(req, body, dbResult);
    return res.json(dbResult);
  }

  // Cache miss — calculate
  // The lookup is handed in rather than reached for inside the engine, so the
  // engine keeps working with no database behind it.
  engineParams.live_prices = yarnPrices.feed();
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

  recordHistory(req, body, result);
  res.json(result);
});

// ============================================================
// POST /api/striper
// ============================================================
router.post('/striper', requireUser, enforceDailyLimit, (req, res) => {
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
router.post('/quality', requireUser, enforceDailyLimit, (req, res) => {
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
router.post('/cost', requireUser, enforceDailyLimit, (req, res) => {
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
    const result = calculateCost({ ...body, gsm, parsedComp,
      live_prices: yarnPrices.feed() });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/garment-types — Available garment types for CMT costing
// ============================================================
// ============================================================
// POST /api/carbon — the carbon footprint on its own: one fabric, the
// strongest ways to cut it, and a what-if with the levers the reader picks.
// Cheap (a few thousand passes of a closed-form model), so it is not counted
// against the daily calculation limit; it is rate-limited instead.
// ============================================================
const { calculateCarbonFootprint } = require('../engine/domain/carbon-footprint-engine');
const { parseComposition: parseCompositionText } = require('../engine/domain/composition-engine');
const carbonLimiter = createRateLimiter({ name: 'carbon', max: 90, windowMs: 60 * 1000, message: 'Too many carbon requests. Please wait a minute.' });
router.post('/carbon', requireUser, carbonLimiter, (req, res) => {
  try {
    const b = req.body || {};
    const composition = String(b.composition || '100% cotton').slice(0, 120);
    const pc = parseCompositionText(composition);
    const gsm = parseFloat(b.gsm);
    if (!(gsm >= 40 && gsm <= 800)) return res.status(400).json({ success: false, error: 'GSM must be between 40 and 800.' });
    const loss = b.process_loss_pct === '' || b.process_loss_pct == null ? null : parseFloat(b.process_loss_pct);
    const garment = b.garment_weight_g === '' || b.garment_weight_g == null ? null : parseFloat(b.garment_weight_g);
    const out = calculateCarbonFootprint({
      fibers: pc && pc.fibers, raw_composition: composition, gsm,
      fabric_family: b.fabric_family === 'woven' ? 'woven' : 'knit',
      shade: String(b.shade || 'medium').slice(0, 30), dyeing_method: b.dyeing_method ? String(b.dyeing_method).slice(0, 20) : null,
      process_loss_pct: Number.isFinite(loss) ? Math.min(40, Math.max(0, loss)) : null,
      spinning_system: b.spinning_system ? String(b.spinning_system).slice(0, 20) : null,
      country: String(b.country || 'bangladesh').slice(0, 30), boiler_fuel: b.boiler_fuel ? String(b.boiler_fuel).slice(0, 20) : null,
      finishing: b.finishing ? String(b.finishing).slice(0, 40) : null,
      garment_weight_g: Number.isFinite(garment) && garment > 0 && garment < 5000 ? garment : null,
      transport: Array.isArray(b.transport) ? b.transport.slice(0, 6) : null,
      apply_levers: Array.isArray(b.apply_levers) ? b.apply_levers.slice(0, 20).map(String) : null,
    });
    if (!out.success) return res.status(400).json(out);
    res.json({ ...out, composition_read: pc ? pc.display : null });
  } catch (err) {
    console.error('[carbon]', err);
    res.status(500).json({ success: false, error: 'The carbon footprint could not be worked out.' });
  }
});

// ============================================================
// GET /api/yarn-prices/desk — where every yarn price comes from today: the
// sources and whether they answered, the table as the costing resolves it,
// the move since each quote, six countries, and the buying basis.
// ============================================================
router.get('/yarn-prices/desk', requireUser, (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, ...require('../services/yarn-desk').desk() });
  } catch (err) {
    console.error('[yarn-desk]', err);
    res.status(500).json({ success: false, error: 'The yarn price desk could not be read.' });
  }
});

router.get('/garment-types', (req, res) => {
  res.json(Object.entries(GARMENT_CATALOG).map(([id, g]) => ({
    id,
    name: g.name,
    name_bn: g.name_bn,
    benchmark_sam: g.benchmark_sam,
    benchmark_source: g.benchmark_source,
  })));
});

// ============================================================
// POST /api/garment-costing — Full Cut-Make-Trim + Fabric FOB estimate
//
// Three stages: the existing fabric-level costing engine (same as /api/cost,
// requires garment_weight_g so it can produce a per-garment fabric cost),
// then the fabric-consumption/cutting-allowance engine (grosses that NET
// fabric cost up to what the factory actually has to buy — marker loss,
// rejection/damage, roll-end remnants, GSM-tolerance buffer, plus amortized
// sample/development yardage), then the CMT labor/trim engine on the result
// — so the caller gets a complete Fabric(net+gross) + Cut + Make + Trim +
// Overhead + Profit breakdown instead of having to stitch calls together.
// ============================================================
router.post('/garment-costing', requireUser, enforceDailyLimit, (req, res) => {
  const body = req.body || {};
  const gsm = parseFloat(body.gsm);
  const garmentWeightG = parseFloat(body.garment_weight_g);

  if (!gsm || isNaN(gsm)) {
    return res.status(400).json({ error: 'gsm is required (fabric GSM, feeds the fabric-cost half of this calculation)' });
  }
  if (!garmentWeightG || isNaN(garmentWeightG)) {
    return res.status(400).json({
      error: 'garment_weight_g is required — the finished garment\'s fabric weight in grams (e.g. ~180g for a basic adult-M crew tee). This is what turns a per-kg fabric price into a per-garment fabric cost.',
      example: {
        fabric: 'single_jersey', gsm: 180, gauge: 24, count_ne: 30,
        composition: '100% Cotton', color_shade: 'medium', currency: 'USD',
        garment_weight_g: 180,
        garment_type: 'basic_tshirt',
        wage_grade: 3,
        line_efficiency_pct: 60,
        addons: [],
        order_quantity: 5000,
      },
    });
  }
  if (!body.garment_type || !GARMENT_CATALOG[String(body.garment_type).toLowerCase().trim()]) {
    return res.status(400).json({
      error: `garment_type is required. Valid options: ${Object.keys(GARMENT_CATALOG).join(', ')}`,
    });
  }

  try {
    // ---- Stage 1: fabric cost (reuses the same real engine /api/cost uses) ----
    const parsedComp = body.composition ? parseComposition(body.composition) : null;
    const fabricResult = calculateCost({
      ...body, gsm, parsedComp, garment_weight_g: garmentWeightG,
      live_prices: yarnPrices.feed(),
    });

    if (!fabricResult || !fabricResult.garment) {
      return res.status(500).json({ error: 'Fabric costing did not return a per-garment figure — check garment_weight_g and fabric inputs.' });
    }

    // ---- Stage 2: fabric consumption — gross NET fabric cost up to what the
    //      cutting room actually buys (marker loss, rejection, remnants, GSM
    //      buffer, amortized sample/development yardage). ----
    const consumption = calculateFabricConsumption({
      net_garment_weight_g: garmentWeightG,
      fabric_cost_per_kg_usd: fabricResult.cost_breakdown_usd.total_per_kg,
      garment_type: body.garment_type,
      order_quantity: body.order_quantity,
      marker_cutting_loss_pct: body.marker_cutting_loss_pct,
      rejection_damage_pct: body.rejection_damage_pct,
      end_bit_remnant_pct: body.end_bit_remnant_pct,
      gsm_tolerance_buffer_pct: body.gsm_tolerance_buffer_pct,
      sample_development_overrides: body.sample_development_overrides,
    });

    if (!consumption.success) {
      return res.status(400).json(consumption);
    }

    // ---- Stage 3: Cut-Make-Trim + overhead + profit, on the GROSS fabric cost ----
    const garmentCosting = calculateGarmentCosting({
      ...body,
      fabric_cost_per_garment_usd: consumption.fabric_cost_per_garment_usd,
    });

    if (!garmentCosting.success) {
      return res.status(400).json(garmentCosting);
    }

    res.json({
      success: true,
      fabric_costing: fabricResult,
      fabric_consumption: consumption,
      garment_costing: garmentCosting,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/fabric-consumption — Standalone cutting-room consumption/
// allowance calculator (marker loss, rejection, remnants, GSM buffer, and
// amortized sample/development yardage), usable without running the full
// CMT costing flow — e.g. for a bulk fabric-requirement/booking estimate.
// ============================================================
router.post('/fabric-consumption', requireUser, enforceDailyLimit, (req, res) => {
  const body = req.body || {};
  const result = calculateFabricConsumption({
    net_garment_weight_g: body.net_garment_weight_g,
    fabric_cost_per_kg_usd: body.fabric_cost_per_kg_usd,
    garment_type: body.garment_type,
    order_quantity: body.order_quantity,
    marker_cutting_loss_pct: body.marker_cutting_loss_pct,
    rejection_damage_pct: body.rejection_damage_pct,
    end_bit_remnant_pct: body.end_bit_remnant_pct,
    gsm_tolerance_buffer_pct: body.gsm_tolerance_buffer_pct,
    sample_development_overrides: body.sample_development_overrides,
  });

  if (!result.success) {
    return res.status(400).json({
      ...result,
      example: {
        net_garment_weight_g: 180,
        fabric_cost_per_kg_usd: 4.20,
        garment_type: 'basic_tshirt',
        order_quantity: 5000,
      },
    });
  }
  res.json(result);
});

// ============================================================
// POST /api/techpack/generate — Fabric Technical Data Sheet (PDF export)
//
// Takes the exact same inputs as /api/calculate (garment_weight_g/
// garment_type optional, for a Garment CMT & FOB section) and streams back
// a PDF built from that SAME calculate() result — never a second,
// separately-computed set of numbers. No response caching here (unlike
// /api/calculate): this is a one-off binary export, not a repeatedly-polled
// read, and pdfkit generation is pure in-process drawing (fast, no external
// calls), so there is nothing worth caching.
// ============================================================
router.post('/techpack/generate', requireUser, enforceDailyLimit, (req, res) => {
  const body = req.body || {};
  const fabric = body.fabric;
  const gsm = body.gsm ? parseFloat(body.gsm) : null;

  if (!fabric || !gsm) {
    return res.status(400).json({
      error: 'fabric and gsm are required',
      example: { fabric: 'single_jersey', gsm: 180, gauge: 24, dia: 30, composition: '100% Cotton' },
    });
  }

  try {
    // Same canonical-input forwarding as /api/calculate (see ENGINE_INPUTS'
    // own doc comment) — every field calculate() knows how to read, forwarded
    // uniformly, so this route can never silently drop an input /api/calculate
    // itself would have honoured.
    const engineParams = {};
    for (const field of ENGINE_INPUTS) {
      if (body[field] !== undefined) engineParams[field] = body[field];
    }
    engineParams.fabric = fabric;
    engineParams.gsm = gsm;
    engineParams.efficiency = body.efficiency || 85;
    engineParams.live_prices = yarnPrices.feed();

    const result = calculate(engineParams);
    if (result.error) {
      return res.status(400).json(result);
    }

    const content = buildTechPackContent(result);
    if (!content.ok) {
      return res.status(500).json({ error: content.error });
    }

    const doc = renderTechPackPdf(content);
    const safeName = (result.fabric.id || 'fabric').replace(/[^a-z0-9_-]/gi, '');
    const filename = `KnitAdvisor-TechPack-${safeName}-${result.input.gsm}gsm.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('[TechPack] generate failed:', err.message);
    res.status(500).json({ error: 'Could not generate the tech pack PDF.' });
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
    sett: f.sett,
    nominal_gsm: f.nominal_gsm,
    sett_source: f.sett_source,
    has_structure: f.has_structure,
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
router.post('/woven/calculate', requireUser, enforceDailyLimit, (req, res) => {
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
// GET /api/dyeing/recipes — the real, cost-verified recipes dyeing-engine.js
// can match against a shade tier. costing-engine.js already surfaces a match
// automatically inside /api/calculate's cost_breakdown_usd.dyeing; these
// standalone endpoints are for a dedicated recipe browser (dyeing.html), not
// part of the main calculate flow.
// ============================================================
router.get('/dyeing/recipes', (req, res) => res.json(listDyeingRecipes()));

// GET /api/dyeing/recipes/:id — one full recipe card, every step, by its own
// id (not shade-matched) — for viewing a specific recipe directly.
router.get('/dyeing/recipes/:id', (req, res) => {
  const recipe = getDyeingRecipe(req.params.id);
  if (!recipe) return res.status(404).json({ success: false, error: 'UNKNOWN_RECIPE' });
  res.json({ success: true, recipe });
});

// POST /api/dyeing/calculate — either:
//   { recipe_id, fabric_qty_kg? }  cost ONE SPECIFIC recipe directly, no
//                                  shade matching — for "browse this exact
//                                  card" in the recipe library, so the
//                                  frontend never re-implements the costing
//                                  formula (or its exchange rate) itself.
//   { shade_tier | color_input, is_two_part?, fabric_qty_kg? }  match a
//                                  shade (given directly, or resolved from a
//                                  color_input via the same color engine
//                                  /api/calculate uses) to a real recipe.
// Returns matched:false (never a guess) when no recipe covers the request.
router.post('/dyeing/calculate', (req, res) => {
  try {
    const { recipe_id, shade_tier, color_input, is_two_part, fabric_qty_kg } = req.body || {};
    const qty = fabric_qty_kg && fabric_qty_kg > 0 ? Number(fabric_qty_kg) : 1;

    if (recipe_id) {
      const recipe = getDyeingRecipe(recipe_id);
      if (!recipe) return res.status(404).json({ success: false, error: 'UNKNOWN_RECIPE' });
      const cost = calculateDyeingCost({ recipe, fabric_qty_kg: qty, bdt_per_usd: DEFAULT_EXCHANGE_RATES.BDT });
      return res.json({ success: true, matched: true, recipe: { ...recipe, match_quality: 'direct' }, cost });
    }

    let resolvedShade = shade_tier || null;
    let colorPreview = null;
    if (!resolvedShade && color_input) {
      colorPreview = colorEngine.getColorPreview(color_input);
      resolvedShade = colorPreview && colorPreview.shade_tier;
    }
    if (!resolvedShade) {
      return res.status(400).json({ success: false, error: 'SHADE_REQUIRED', message: 'Provide recipe_id, shade_tier, or a resolvable color_input.' });
    }

    const matched = matchDyeingRecipe({ shade_tier: resolvedShade, is_two_part: !!is_two_part });
    if (!matched) {
      return res.json({ success: true, matched: false, shade_tier: resolvedShade, color_preview: colorPreview, recipe: null });
    }

    const cost = calculateDyeingCost({ recipe: matched, fabric_qty_kg: qty, bdt_per_usd: DEFAULT_EXCHANGE_RATES.BDT });
    res.json({ success: true, matched: true, shade_tier: resolvedShade, color_preview: colorPreview, recipe: matched, cost });
  } catch (err) {
    console.error('[Dyeing] calculate failed:', err);
    res.status(500).json({ success: false, error: 'DYEING_CALCULATION_FAILED', message: err.message });
  }
});

// ============================================================
// GET /api/dyeing/faults — the dyeing-floor fault knowledge base (wet
// processing/rope-dyeing faults), separate from the knitting FAULTS_DATABASE
// above. See dyeing-faults-engine.js's header for its source and scope.
// ============================================================
router.get('/dyeing/faults', (req, res) => {
  res.json({ success: true, faults: listDyeingFaults() });
});

// POST /api/dyeing/faults/diagnose — { symptoms: string[] } free-text terms
// matched against fault name/causes/remedies, same scoring shape as
// /api/faults/diagnose.
router.post('/dyeing/faults/diagnose', (req, res) => {
  try {
    const { symptoms } = req.body || {};
    res.json({ success: true, diagnosed: diagnoseDyeingFaults(symptoms || []) });
  } catch (err) {
    console.error('[Dyeing Faults Diagnose] failed:', err);
    res.status(500).json({ success: false, error: 'DIAGNOSIS_FAILED', message: err.message });
  }
});

// GET /api/dyeing/knowledge — the QC checklist, floor checkpoints, and salt
// comparison reference.
router.get('/dyeing/knowledge', (req, res) => {
  res.json({ success: true, ...getDyeingKnowledge() });
});

// ============================================================
// GET /api/dyeing/theory — dye-class chemistry, machine theory, full
// process-flow charts and fastness-testing theory. See dyeing-theory-
// engine.js's header for scope/status.
// ============================================================
router.get('/dyeing/theory', (req, res) => {
  res.json({ success: true, ...getDyeingTheory() });
});

router.get('/dyeing/theory/dye-class/:key', (req, res) => {
  const dyeClass = getDyeClass(req.params.key);
  if (!dyeClass) return res.status(404).json({ success: false, error: 'UNKNOWN_DYE_CLASS' });
  res.json({ success: true, dye_class: dyeClass });
});

router.get('/dyeing/theory/machine/:key', (req, res) => {
  const machine = getMachine(req.params.key);
  if (!machine) return res.status(404).json({ success: false, error: 'UNKNOWN_MACHINE' });
  res.json({ success: true, machine });
});

router.get('/dyeing/theory/process-flow/:key', (req, res) => {
  const flow = getProcessFlow(req.params.key);
  if (!flow) return res.status(404).json({ success: false, error: 'UNKNOWN_PROCESS_FLOW' });
  res.json({ success: true, process_flow: flow });
});

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

router.post('/parse', requireUser, enforceDailyLimit, parseLimiter, async (req, res) => {
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
const noPages = (v) => (Array.isArray(v) ? v.map(noPages) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'page' && k !== 'pages').map(([k, x]) => [k, noPages(x)])) : v);
// ============================================================
// ============================================================
router.get('/academy/content', (req, res) => {
  res.json({
    success: true,
    // the book pages the content was checked against stay here (no page reference leaves the API)
    glossary: noPages(GLOSSARY),
    basic_elements: noPages(BASIC_ELEMENTS),
    formation_cycles: noPages(FORMATION_CYCLES)
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

// GET /api/color/shade-check?shade=&composition=&melange_type=&melange_pct=&white_type=&neon=&color=&dye_band=
// The calculator's live check: what this shade is on these fibres, whether
// the composition fits, and what the cloth will look like.
router.get('/color/shade-check', (req, res) => {
  const q = (k) => (req.query[k] == null ? '' : String(req.query[k]).slice(0, 120).trim());
  const shade = q('shade').toLowerCase();
  if (!shade) return res.status(400).json({ error: 'shade query param is required' });
  try {
    const comp = q('composition');
    const parsed = comp ? parseComposition(comp) : null;
    let colorHex = null;
    const color = q('color');
    if (color) {
      try { const c = colorEngine.getColorPreview(color); colorHex = c && c.hex ? c.hex : null; } catch (_) { colorHex = null; }
    }
    const spec = analyzeShadeSpec({
      shade,
      fibers: parsed && parsed.fibers ? parsed.fibers : { cotton: 100 },
      melange_type: q('melange_type').toLowerCase() || null,
      melange_pct: q('melange_pct') ? parseFloat(q('melange_pct')) : null,
      white_type: q('white_type').toLowerCase() || null,
      neon: q('neon').toLowerCase() || null,
      colorHex,
    });
    // What the dyehouse will charge for this: band x fibre route, per kg grey
    let dyeing = null;
    try {
      const d = dyeingCharge({
        shade: spec && spec.costing_shade ? spec.costing_shade : shade,
        spec, colorHex,
        dyeBand: q('dye_band').toLowerCase() || null,
        fibers: parsed && parsed.fibers ? parsed.fibers : { cotton: 100 },
      });
      dyeing = { per_kg: d.per_kg, band: d.band, band_label: d.band_label, band_what: d.band_what, how: d.how,
        special: d.special, route: d.route, route_label: d.route_label, lines: d.lines, range: d.range };
    } catch (_) { dyeing = null; }
    res.json({ success: true, composition: parsed ? parsed.display : '100% Cotton (assumed)', spec, dyeing });
  } catch (err) {
    res.status(500).json({ error: 'Shade check failure', detail: err.message });
  }
});

// GET /api/charges/vendors — who can be chosen to price knitting and dyeing
// ============================================================
// Fabric studio: a new weft structure drawn needle by needle
// ============================================================
//
// Live: the page re-asks on every edit, so it is outside the daily
// calculation limit (the /api rate limiter still applies). Signed-in only,
// like the calculator it sits beside.
router.get('/studio/templates', requireUser, (req, res) => {
  res.json({ success: true, templates: fabricStudio.listTemplates(), fibres: fabricStudio.FIBRES, limits: fabricStudio.LIMITS, machines: knitMachine.list(),
    warp: { templates: warpStudio.TEMPLATES, machines: Object.fromEntries(Object.entries(warpStudio.MACHINES).map(([k, m]) => [k, { label: m.label, gauges: m.gauges, bars: m.bars, speed: m.speed, use: m.use, beds: m.beds }])), fibres: Object.fromEntries(Object.entries(warpStudio.FIBRES).map(([k, f]) => [k, f.label])) } });
});

// ── The API as sold ──────────────────────────────────────────────────────
const apiCatalogue = require('../engine/domain/api-catalogue');
const apiKeyRepo = require('../db/repositories/api-key-repo');
// what a key may call, the plans, and how to authenticate (public: it is the documentation's data)
router.get('/catalogue', async (req, res) => {
  let priced = {};
  try { (await require('../db/repositories/api-order-repo').prices.list()).forEach((p) => { priced[p.plan] = { price_per_month: +p.price, currency: p.currency }; }); } catch (_) { /* prices are optional here */ }
  res.json({ success: true, version: 'v1', base_url: '/api/v1', auth: 'Authorization: Bearer <your key>  (or X-API-Key: <your key>)  AND  X-User-Email: <the email of the account that owns the key>  AND, for a key registered to a website, X-Website: <that website> (a browser sends its own Origin)',
    plans: Object.fromEntries(Object.entries(apiCatalogue.PLANS).map(([k, p]) => [k, { label: p.label, monthly_calls: p.monthly, calls_per_minute: p.per_min, ...(priced[k] || {}) }])), endpoints: apiCatalogue.publicList() });
});
// the key's own plan and use
router.get('/usage', requireUser, async (req, res) => {
  if (!req.apiKey) return res.status(400).json({ success: false, code: 'API_KEY_REQUIRED', error: 'Call this with an API key: it reports that key.' });
  try {
    const u = await apiKeyRepo.keys.usage(req.apiKey.id);
    res.json({ success: true, key: { name: req.apiKey.name, prefix: req.apiKey.prefix, plan: req.apiKey.plan }, limits: { monthly_calls: req.apiKey.limits.monthly, calls_per_minute: req.apiKey.limits.per_min },
      this_month: { calls: u.month_calls, remaining: Math.max(0, req.apiKey.limits.monthly - u.month_calls), resets_at: require('../middleware/api-key-auth').nextReset() }, last_30_days: u.days });
  } catch (err) {
    console.error('[api] usage failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not read the usage.' });
  }
});

// Warp knitting: guide-bar lapping, threading and yarns -> runner, weight, width, production, checks.
router.post('/studio/warp/analyse', requireUser, (req, res) => {
  try {
    const out = warpStudio.analyse(req.body || {});
    res.status(out.success ? 200 : 400).json(out);
  } catch (err) {
    console.error('[studio] warp analyse failed:', err);
    res.status(500).json({ success: false, error: 'The studio could not analyse this warp design.' });
  }
});

// Costing is done in the Calculator, on a design saved from the Studio (the Studio never prices a design).
router.post('/studio/warp/cost', requireUser, async (req, res) => {
  try {
    const id = parseInt((req.body || {}).design_id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Choose a saved warp design.' });
    const row = (await studioRepo.designs.list(req.user.id)).find((d) => d.id === id);
    const w = row && row.design && row.design.tech === 'warp' ? row.design.warp : null;
    if (!w) return res.status(404).json({ success: false, error: 'That warp design was not found in your account.' });
    const a = warpStudio.analyse({ machine: w.machine, bars: w.bars.map((b) => ({ notation: b.notation, threading: b.threading, yarn: b.yarn })), target: w.target, beams: w.beams });
    if (!a.success) return res.status(400).json({ success: false, error: a.error });
    const prices = (req.body || {}).prices || {};
    const cost = warpStudio.costOf(a, prices);
    res.json({
      success: true, name: row.name, structure: a.structure, machine: { label: a.machine.label, gauge: a.machine.gauge },
      fabric: { gsm: a.fabric.gsm, width_in: a.fabric.width_in, wpc: a.fabric.wpc, cpc: a.fabric.cpc },
      bars: a.bars.map((b) => ({ bar: b.bar, notation: b.notation, yarn: b.yarn, fibre: b.fibre, kg_per_1000m: b.kg_per_1000m })),
      ok_to_knit: a.ok_to_knit, cost,
    });
  } catch (err) {
    console.error('[studio] warp cost failed:', err);
    res.status(500).json({ success: false, error: 'Could not cost this design.' });
  }
});

// A machine set-up (needle set-out + cam chart) compiled into needle notation.
router.post('/studio/compile', requireUser, (req, res) => {
  try {
    const b = req.body || {};
    const P = knitMachine.PROFILES[b.profile] ? { ...knitMachine.PROFILES[b.profile], id: b.profile } : null;
    const out = knitMachine.compile({ setout: b.setout || {}, cams: Array.isArray(b.cams) ? b.cams.slice(0, 48) : [] }, P);
    res.status(out.grid ? 200 : 400).json({ success: !!out.grid, ...out });
  } catch (err) {
    console.error('[studio] compile failed:', err);
    res.status(500).json({ success: false, error: 'Could not compile this set-up.' });
  }
});

// The answer depends only on the design and the reference data loaded at
// boot, so identical designs (every user who opens the same template, every
// undo back to a state already seen) are served from memory: a small LRU of
// the serialised answer.
const studioCache = new Map();
const STUDIO_CACHE_MAX = 4000;
// Design from a goal: the Studio searches needle programmes itself (studio-invent.js). Bounded per call
// (evaluations and time), limited per address, at most two searches at once per worker, and the same
// goal is answered from memory — so a busy hour cannot stall the engine for everyone else.
const studioInvent = require('../engine/domain/studio-invent');
const inventLimiter = createRateLimiter({ name: 'studio_invent', max: 8, windowMs: 60 * 1000, message: 'Too many design searches — wait a minute.' });
const inventCache = new Map();
let inventRunning = 0;
router.post('/studio/invent', requireUser, inventLimiter, async (req, res) => {
  let body, key;
  try {
    // the machine the design is for: its learned profile (and the pool's numbers) weigh every candidate, and its gauge / diameter fill in what the goal left open
    const { floor_machine_id, floor: _f, ...goal } = req.body || {};
    const ff = await floorFor(req.user.id, floor_machine_id);
    if (ff.notFound) return res.status(404).json({ success: false, error: 'Floor machine not found.' });
    body = goal;
    if (ff.floor) body.floor = ff.floor;
    if (ff.machine) {
      const mm = { ...(goal.machine || {}) };
      for (const k of ['gauge', 'dia']) if (!(+mm[k] > 0) && +ff.machine[k] > 0) mm[k] = +ff.machine[k];
      body.machine = mm;
    }
    key = crypto.createHash('sha1').update(JSON.stringify(studioInvent.cleanGoal(body))).digest('hex');
  } catch (err) {
    if (err instanceof studioInvent.InventError) return res.status(400).json({ success: false, error: err.message });
    console.error('[studio] invent goal failed:', err);
    return res.status(400).json({ success: false, error: 'Could not read the goal.' });
  }
  if (inventCache.has(key)) { const v = inventCache.get(key); inventCache.delete(key); inventCache.set(key, v); return res.json({ ...v, cached: true }); }
  if (inventRunning >= 2) return res.status(503).json({ success: false, code: 'BUSY', error: 'The design search is busy right now - try again in a few seconds.' });
  inventRunning++;
  try {
    const out = studioInvent.invent(body, { maxEvals: 320, timeMs: 3500 });
    inventCache.set(key, out);
    if (inventCache.size > 100) inventCache.delete(inventCache.keys().next().value);
    res.json(out);
  } catch (err) {
    if (err instanceof studioInvent.InventError) return res.status(400).json({ success: false, error: err.message });
    console.error('[studio] invent failed:', err);
    res.status(500).json({ success: false, error: 'The design search failed.' });
  } finally { inventRunning--; }
});

// Floor machines and their logged rolls (migration 043): the Studio learns each machine's own
// bias, structure by structure (engine/domain/machine-learning.js). Private to the account.
const floorRepo = require('../db/repositories/floor-repo');
// The pool (migration 044): mills that opt in share one clamped number per structure, and receive the
// same from the others - only from cells where 5 other accounts stand behind it (engine/domain/machine-pool.js).
const poolRepo = require('../db/repositories/pool-repo');
const secondOpinion = require('../engine/domain/second-opinion');
const floorFail = (res, err, what) => {
  if (err instanceof floorRepo.FloorError) return res.status(400).json({ success: false, error: err.message });
  console.error(`[studio] ${what} failed:`, err);
  res.status(500).json({ success: false, error: `Could not ${what}.` });
};
const idOf = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

// Join or leave the pool, and see what it covers. Leaving takes the account's rolls out of every number at once.
router.get('/studio/pool', requireUser, async (req, res) => {
  try { res.json({ success: true, ...(await poolRepo.status(req.user.id)), min_mills: poolRepo.MIN_ACCOUNTS }); } catch (err) { floorFail(res, err, 'read the pool'); }
});
router.put('/studio/pool', requireUser, async (req, res) => {
  try {
    if (typeof (req.body || {}).join !== 'boolean') return res.status(400).json({ success: false, error: 'Say whether to join or leave.' });
    await (req.body.join ? poolRepo.members.join(req.user.id) : poolRepo.members.leave(req.user.id));
    res.json({ success: true, ...(await poolRepo.status(req.user.id)), min_mills: poolRepo.MIN_ACCOUNTS });
  } catch (err) { floorFail(res, err, 'update the pool'); }
});

router.get('/studio/floor/machines', requireUser, async (req, res) => {
  try { res.json({ success: true, machines: await floorRepo.machines.list(req.user.id) }); } catch (err) { floorFail(res, err, 'load your machines'); }
});
router.post('/studio/floor/machines', requireUser, async (req, res) => {
  try { res.json({ success: true, machine: await floorRepo.machines.create(req.user.id, req.body || {}) }); } catch (err) { floorFail(res, err, 'add the machine'); }
});
router.delete('/studio/floor/machines/:id', requireUser, async (req, res) => {
  const id = idOf(req.params.id); if (!id) return res.status(400).json({ success: false, error: 'Invalid id.' });
  try {
    if (!(await floorRepo.machines.remove(req.user.id, id))) return res.status(404).json({ success: false, error: 'Machine not found.' });
    res.json({ success: true });
  } catch (err) { floorFail(res, err, 'remove the machine'); }
});
router.get('/studio/floor/machines/:id/rolls', requireUser, async (req, res) => {
  const id = idOf(req.params.id); if (!id) return res.status(400).json({ success: false, error: 'Invalid id.' });
  try {
    const m = await floorRepo.machines.get(req.user.id, id);
    if (!m) return res.status(404).json({ success: false, error: 'Machine not found.' });
    res.json({ success: true, machine: m, rolls: await floorRepo.rolls.forMachine(req.user.id, id) });
  } catch (err) { floorFail(res, err, 'load the rolls'); }
});
/**
 * Log a roll knitted on a floor machine: { machine_id, design (the Studio design it was knitted to),
 * roll: { sl_mm, gsm, width_in, ne?, gauge?, dia?, shade?, knitted_on? } }. The Studio predicts the
 * cloth at exactly the roll's settings, with no learning applied, and the roll is stored with that
 * prediction — measured ÷ predicted is what the machine's profile learns from.
 */
router.post('/studio/floor/rolls', requireUser, async (req, res) => {
  const b = req.body || {};
  const mid = idOf(b.machine_id); if (!mid) return res.status(400).json({ success: false, error: 'Choose the machine the roll was knitted on.' });
  const r = b.roll || {};
  try {
    const m = await floorRepo.machines.get(req.user.id, mid);
    if (!m) return res.status(404).json({ success: false, error: 'Machine not found.' });
    const design = b.design && typeof b.design === 'object' ? b.design : null;
    if (!design) return res.status(400).json({ success: false, error: 'Send the design the roll was knitted to.' });
    const y = design.yarn || {};
    const ne = +r.ne > 0 ? +r.ne : (+y.count > 0 && String(y.unit || 'ne').toLowerCase() === 'ne' ? +y.count : null);
    const roll = { sl_mm: r.sl_mm, gsm: r.gsm, width_in: r.width_in, ne, gauge: +r.gauge > 0 ? +r.gauge : m.gauge, dia: +r.dia > 0 ? +r.dia : (m.dia != null ? +m.dia : null) };
    if (!(+roll.width_in > 0)) roll.width_in = null;
    // the prediction at the roll's own settings: run as a one-roll calibration, which reports the model's figures
    const { floor: _f, floor_machine_id: _fm, calibration: _c, ...plain } = design;
    const out = fabricStudio.analyse({ ...plain, calibration: { rolls: [{ ...roll, width_in: roll.width_in || 60 }] } });
    if (!out.success) return res.status(400).json({ success: false, error: out.error || 'The Studio could not read this design.' });
    const p = out.fabric.calibration && out.fabric.calibration.rolls[0];
    if (!p) return res.status(400).json({ success: false, error: 'This structure is weighed on its own model (plush), not on machine rolls.' });
    const row = await floorRepo.rolls.add(req.user.id, mid, {
      group_key: out.structure.group, structure: out.structure.match ? out.structure.match.id : 'new',
      design_name: b.design_name ? String(b.design_name).slice(0, 80) : null, ne, sl_mm: +roll.sl_mm, gauge: roll.gauge, dia: roll.dia,
      shade: ['white', 'light', 'medium', 'dark', 'black'].includes(r.shade) ? r.shade : null,
      gsm: +roll.gsm, width_in: roll.width_in ? +roll.width_in : null, gsm_model: p.model_gsm, width_model: roll.width_in ? p.model_width_in : null,
      knitted_on: /^\d{4}-\d{2}-\d{2}$/.test(r.knitted_on || '') ? r.knitted_on : null,
    });
    poolRepo.invalidate();
    res.json({ success: true, roll: row, off_gsm_pct: Math.round((+roll.gsm / p.model_gsm - 1) * 1000) / 10, off_width_pct: roll.width_in ? Math.round((+roll.width_in / p.model_width_in - 1) * 1000) / 10 : null });
  } catch (err) { floorFail(res, err, 'log the roll'); }
});
router.delete('/studio/floor/rolls/:id', requireUser, async (req, res) => {
  const id = idOf(req.params.id); if (!id) return res.status(400).json({ success: false, error: 'Invalid id.' });
  try {
    if (!(await floorRepo.rolls.remove(req.user.id, id))) return res.status(404).json({ success: false, error: 'Roll not found.' });
    poolRepo.invalidate();
    res.json({ success: true });
  } catch (err) { floorFail(res, err, 'delete the roll'); }
});

/**
 * What the Studio knows about THIS account's machine for a design: the named floor machine's rolls (the
 * account's own) and, for a member of the pool, the pool's numbers for new structures. Both go in with the
 * design - and so into the cache key. A caller can never supply either itself.
 */
async function floorFor(userId, machineId) {
  const fm = idOf(machineId);
  let m = null, rolls = [], pool = null;
  if (fm) {
    m = await floorRepo.machines.get(userId, fm);
    if (!m) return { notFound: true };
    rolls = floorRepo.asLearning(await floorRepo.rolls.forMachine(userId, fm));
  }
  try { if (await poolRepo.members.isMember(userId)) pool = await poolRepo.tableFor(userId); } catch (err) { console.error('[studio] pool unavailable:', err.message); }
  if (!m && !pool) return { floor: null, machine: null };
  return { floor: { name: m ? m.name : null, rolls, ...(pool ? { pool } : {}) }, machine: m };
}

// One answer for a design, from memory when the same design was answered before.
async function studioAnswer(userId, input) {
  const { floor_machine_id, floor: _f, ...rest } = input || {};
  const body = rest;
  const ff = await floorFor(userId, floor_machine_id);
  if (ff.notFound) return { status: 404, body: JSON.stringify({ success: false, error: 'Floor machine not found.' }) };
  if (ff.floor) body.floor = ff.floor;
  const floor = ff.machine ? ff.machine.name : null;
  const key = JSON.stringify(body);
  let hit = key.length < 32768 ? studioCache.get(key) : null;
  if (hit) { studioCache.delete(key); studioCache.set(key, hit); }
  else {
    const out = fabricStudio.analyse(body);
    // a second opinion from the stitches themselves (brick laws, no family table) — never allowed to break the answer
    if (out.success) { try { out.fabric.second_opinion = secondOpinion.forDesign(body, out); } catch (err) { console.error('[studio] second opinion failed:', err.message); } }
    hit = { status: out.success ? 200 : 400, body: JSON.stringify(out) };
    if (key.length < 32768) {
      studioCache.set(key, hit);
      if (studioCache.size > STUDIO_CACHE_MAX) studioCache.delete(studioCache.keys().next().value);
    }
  }
  return { ...hit, floor };
}

router.post('/studio/analyse', requireUser, async (req, res) => {
  try {
    const hit = await studioAnswer(req.user.id, req.body);
    res.status(hit.status).type('application/json').send(hit.body);
  } catch (err) {
    console.error('[studio] analyse failed:', err);
    res.status(500).json({ success: false, error: 'The studio could not analyse this structure.' });
  }
});

// Part 0 - the stitch graph: the interlocking of any weft or warp design, as the machine makes it
// (engine/domain/stitch-graph.js). Pure logic, no data; every later part reads it.
const stitchGraph = require('../engine/domain/stitch-graph');
router.post('/studio/graph', requireUser, (req, res) => {
  try {
    const b = req.body || {};
    const g = stitchGraph.fromDesign(b.design || {});
    const { passes, ...rest } = g;
    res.json({ success: true, ...rest, wales: stitchGraph.wales(g), ...(b.full ? { passes } : {}) });
  } catch (err) {
    if (err instanceof stitchGraph.GraphError) return res.status(400).json({ success: false, error: err.message });
    console.error('[studio] graph failed:', err);
    res.status(500).json({ success: false, error: 'Could not build the stitch graph.' });
  }
});

// Parts 1-2 - fibre and yarn as engine parts: every number with its unit and where it came from
// (measured, law, blend, bound, typical), and the test that replaces each typical one (engine/domain/materials.js).
const materials = require('../engine/domain/materials');
router.post('/studio/yarn', requireUser, (req, res) => {
  try {
    const b = req.body || {};
    res.json({ success: true, yarn: materials.yarn(b.yarn || b) });
  } catch (err) {
    if (err instanceof materials.MaterialError) return res.status(400).json({ success: false, error: err.message });
    console.error('[studio] yarn failed:', err);
    res.status(500).json({ success: false, error: 'Could not work out the yarn.' });
  }
});
router.post('/studio/fibre', requireUser, (req, res) => {
  try {
    const b = req.body || {};
    res.json({ success: true, fibre: materials.fibre(b.fibres || b.composition || 'cotton', b.tests || {}) });
  } catch (err) {
    if (err instanceof materials.MaterialError) return res.status(400).json({ success: false, error: err.message });
    console.error('[studio] fibre failed:', err);
    res.status(500).json({ success: false, error: 'Could not work out the fibre.' });
  }
});

// Parts 3-5 - machine, stitch formation, consumption, read off the stitch graph and the yarn part
// (engine/domain/knitting-parts.js): knock-over depth, knitting tension, hook fill, course length, runners.
const knittingParts = require('../engine/domain/knitting-parts');
const yarnSpecOf = (y) => {
  const o = y || {}, f = String(o.fibre || 'cotton');
  const base = f.replace(/_(filament|spun|mono)$/, '');
  const spinning = o.spinning || (/mono/.test(f) ? 'mono' : /filament/.test(f) ? 'filament' : f === 'elastane' ? 'elastane' : o.type === 'carded' ? 'carded' : o.type === 'compact' ? 'compact' : o.type === 'open_end' ? 'open_end' : 'combed');
  return { count: o.count, unit: o.unit || 'ne', ply: o.ply, fibres: base, spinning, filaments: o.filaments || (spinning === 'mono' ? 1 : undefined), tests: o.tests };
};
router.post('/studio/process', requireUser, (req, res) => {
  try {
    const d = (req.body || {}).design || {};
    const g = stitchGraph.fromDesign(d);
    const m = d.machine || {};
    if (Array.isArray(d.bars)) {
      const yarns = d.bars.map((b) => materials.yarn(yarnSpecOf(b.yarn)));
      const mach = knittingParts.machine({ ...m, type: m.type }, g);
      return res.json({ success: true, machine: mach, formation: knittingParts.formation(g, yarns, mach, null), consumption: knittingParts.consumption(g, yarns, mach, null, { cpc: +m.cpc || +((req.body || {}).cpc) }) });
    }
    const yarn = materials.yarn(yarnSpecOf(d.yarn));
    const mach = knittingParts.machine(m, g);
    const sl = { sl_mm: +m.sl_mm };
    res.json({ success: true, machine: mach, formation: knittingParts.formation(g, yarn, mach, sl), consumption: knittingParts.consumption(g, yarn, mach, sl, { draft: (d.elastane || {}).draft }) });
  } catch (err) {
    if (err instanceof stitchGraph.GraphError || err instanceof materials.MaterialError || err instanceof knittingParts.PartError) return res.status(400).json({ success: false, error: err.message });
    console.error('[studio] process failed:', err);
    res.status(500).json({ success: false, error: 'Could not work out the knitting.' });
  }
});

// Calibration measurements (migration 045): relaxed sizes, load-extension, recovery on one cloth, kept with the design and
// what the Studio predicted for it, and compared with that prediction at once (engine/domain/calibration-intake.js).
const calibration = require('../engine/domain/calibration-intake');
const calibrationRepo = require('../db/repositories/calibration-repo');
const calFail = (res, err, what) => {
  if (err instanceof calibration.CalibrationError) return res.status(400).json({ success: false, error: err.message });
  console.error(`[studio] ${what} failed:`, err);
  res.status(500).json({ success: false, error: `Could not ${what}.` });
};
router.get('/studio/calibration', requireUser, async (req, res) => {
  try {
    const rows = await calibrationRepo.list(req.user.id);
    res.json({ success: true, records: rows.map((r) => ({ id: r.id, design_name: r.design_name, group: r.group_key, saved: r.created_at, comparison: calibration.compare(r.predicted, r.measured) })) });
  } catch (err) { calFail(res, err, 'load your calibration records'); }
});
router.get('/studio/calibration/export.csv', requireUser, async (req, res) => {
  try {
    const rows = await calibrationRepo.list(req.user.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="calibration-measurements.csv"');
    res.send(calibration.csv(rows.map((r) => ({ ...r, design_name: r.design_name || '' }))));
  } catch (err) { calFail(res, err, 'export your calibration records'); }
});
router.post('/studio/calibration', requireUser, async (req, res) => {
  try {
    const b = req.body || {};
    const measured = calibration.cleanMeasured(b.measured);
    const hit = await studioAnswer(req.user.id, b.design);
    if (hit.status !== 200) return res.status(hit.status).type('application/json').send(hit.body);
    const out = JSON.parse(hit.body);
    const predicted = calibration.snapshot(out);
    const { floor_machine_id: _m, floor: _f, ...design } = b.design || {};
    const row = await calibrationRepo.add(req.user.id, {
      design_name: String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null, group_key: out.structure.group, structure: out.structure.match ? out.structure.match.id : 'new',
      design, predicted, measured,
    });
    res.json({ success: true, id: row.id, comparison: calibration.compare(predicted, measured) });
  } catch (err) { calFail(res, err, 'save the calibration'); }
});
router.delete('/studio/calibration/:id', requireUser, async (req, res) => {
  const id = idOf(req.params.id); if (!id) return res.status(400).json({ success: false, error: 'Invalid id.' });
  try {
    if (!(await calibrationRepo.remove(req.user.id, id))) return res.status(404).json({ success: false, error: 'Record not found.' });
    res.json({ success: true });
  } catch (err) { calFail(res, err, 'delete the record'); }
});

// The yarn twin: the drawn knit as interlocked yarn, its shape solved inside the Studio's own predicted cell
// (engine/domain/yarn-twin.js). CPU-bound (up to ~1.5 s), so it is limited per address, the same design is
// answered from memory, and designs it cannot model are refused up front.
const yarnTwin = require('../engine/domain/yarn-twin');
const twinLimiter = createRateLimiter({ name: 'studio_twin', max: 12, windowMs: 60 * 1000, message: 'Too many yarn-model requests - wait a minute.' });
const twinCache = new Map();
router.post('/studio/twin', requireUser, twinLimiter, async (req, res) => {
  try {
    const hit = await studioAnswer(req.user.id, (req.body || {}).design);
    if (hit.status !== 200) return res.status(hit.status).type('application/json').send(hit.body);
    const out = JSON.parse(hit.body);
    const pre = yarnTwin.walesOf(out);
    if (!pre.wales) return res.json({ success: true, supported: false, reason: pre.reason });
    const key = crypto.createHash('sha1').update(hit.body).digest('hex');
    let v = twinCache.get(key);
    if (v) { twinCache.delete(key); twinCache.set(key, v); }
    else {
      v = yarnTwin.twin(out, { timeMs: 1500 });
      twinCache.set(key, v);
      if (twinCache.size > 200) twinCache.delete(twinCache.keys().next().value);
    }
    res.json({ success: true, ...v });
  } catch (err) {
    console.error('[studio] twin failed:', err);
    res.status(500).json({ success: false, error: 'The yarn model could not be built.' });
  }
});

// Machine files for a design: the set-up sheet (PDF), the needle programme as a bitmap (PNG / BMP)
// and the cam chart (CSV) — drawn from the same answer the page shows (engine/domain/machine-export.js).
const machineExport = require('../engine/domain/machine-export');
const exportLimiter = createRateLimiter({ name: 'studio_export', max: 30, windowMs: 60 * 1000, message: 'Too many exports — wait a minute.' });
router.post('/studio/export', requireUser, exportLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const hit = await studioAnswer(req.user.id, b.design);
    if (hit.status !== 200) return res.status(hit.status).type('application/json').send(hit.body);
    const out = JSON.parse(hit.body);
    const fmt = ['pdf', 'png', 'bmp', 'csv', 'calib'].includes(b.format) ? b.format : 'pdf';
    const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const slug = machineExport.slug(name || (out.structure.match && out.structure.match.name));
    if (fmt === 'calib') {
      const doc = machineExport.calibrationSheet(out, { name });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="CalibrationSheet-${slug}.pdf"`);
      doc.pipe(res); doc.end();
      return;
    }
    if (fmt === 'pdf') {
      const doc = machineExport.sheet(out, { name, floor: hit.floor });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="SetupSheet-${slug}.pdf"`);
      doc.pipe(res); doc.end();
      return;
    }
    if (fmt === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="CamChart-${slug}.csv"`);
      return res.send(machineExport.csv(out, name));
    }
    const bed = b.bed === 'D' ? 'D' : 'C';
    const scope = b.scope === 'revolution' ? 'revolution' : 'repeat';
    const scale = Math.min(16, Math.max(1, parseInt(b.scale, 10) || 1));
    const P = machineExport.programme(out, bed, scope);
    if (P.W * scale * P.H * scale > 16e6) return res.status(400).json({ success: false, error: 'That bitmap would be too large — use a smaller scale.' });
    res.setHeader('Content-Type', fmt === 'png' ? 'image/png' : 'image/bmp');
    res.setHeader('Content-Disposition', `attachment; filename="Programme-${slug}-${bed === 'C' ? 'cylinder' : 'dial'}-${scope}.${fmt}"`);
    res.send(fmt === 'png' ? machineExport.png(P, scale) : machineExport.bmp(P, scale));
  } catch (err) {
    if (err instanceof machineExport.ExportError) return res.status(400).json({ success: false, error: err.message });
    console.error('[studio] export failed:', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Could not make the machine file.' });
  }
});

router.get('/studio/designs', requireUser, async (req, res) => {
  try {
    res.json({ success: true, designs: await studioRepo.designs.list(req.user.id) });
  } catch (err) {
    console.error('[studio] list designs failed:', err);
    res.status(500).json({ success: false, error: 'Could not load your saved designs.' });
  }
});

router.put('/studio/designs', requireUser, async (req, res) => {
  try {
    const row = await studioRepo.designs.save(req.user.id, req.body);
    res.json({ success: true, design: row });
  } catch (err) {
    if (err instanceof studioRepo.DesignError) return res.status(400).json({ success: false, error: err.message });
    console.error('[studio] save design failed:', err);
    res.status(500).json({ success: false, error: 'Could not save the design.' });
  }
});

router.delete('/studio/designs/:id', requireUser, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
  try {
    const removed = await studioRepo.designs.remove(req.user.id, id);
    if (!removed) return res.status(404).json({ success: false, error: 'Design not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[studio] delete design failed:', err);
    res.status(500).json({ success: false, error: 'Could not delete the design.' });
  }
});

// ── Garment cost sheet (buyer quotation format) ─────────────────────────────
const costSheet = require('../engine/domain/cost-sheet');
const costSheetRepo = require('../db/repositories/cost-sheet-repo');

router.get('/cost-sheet/options', requireUser, (req, res) => {
  res.json({ success: true, ...costSheet.options() });
});

// A design saved in the Fabric Studio (warp or weft), as a fabric shell for the sheet (the Studio never prices; the sheet does).
router.post('/cost-sheet/shell-from-studio', requireUser, async (req, res) => {
  try {
    const id = parseInt((req.body || {}).design_id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Choose a saved Studio design.' });
    const row = (await studioRepo.designs.list(req.user.id)).find((d) => d.id === id);
    if (!row || !row.design) return res.status(404).json({ success: false, error: 'That design was not found in your account.' });
    const d = row.design;
    let a, built;
    if (d.tech === 'warp') {
      const w = d.warp;
      a = warpStudio.analyse({ machine: w.machine, bars: w.bars.map((b) => ({ notation: b.notation, threading: b.threading, yarn: b.yarn })), target: w.target, beams: w.beams });
      if (!a.success) return res.status(400).json({ success: false, error: a.error });
      if (!a.ok_to_knit) return res.status(400).json({ success: false, error: 'This design does not knit as drawn — fix it in the Studio first.' });
      built = costSheet.shellFromWarp(a, row.name);
    } else {
      a = require('../engine/domain/fabric-studio').analyse(require('../engine/domain/studio-weft-input').weftPayload(d));
      if (!a.success) return res.status(400).json({ success: false, error: a.error || 'The Studio could not read this design.' });
      if (!a.ok_to_knit) return res.status(400).json({ success: false, error: 'This design does not knit as drawn — fix it in the Studio first.' });
      built = costSheet.shellFromWeft(a, row.name);
    }
    res.json({ success: true, tech: d.tech === 'warp' ? 'warp' : 'weft', ...built });
  } catch (err) {
    console.error('[cost-sheet] studio shell failed:', err);
    res.status(500).json({ success: false, error: 'Could not bring in that design.' });
  }
});

router.post('/cost-sheet/analyse', requireUser, (req, res) => {
  try {
    const out = costSheet.analyse(req.body || {}, { live: yarnPrices.feed() });
    res.status(out.success ? 200 : 400).json(out);
  } catch (err) {
    console.error('[cost-sheet] analyse failed:', err);
    res.status(500).json({ success: false, error: 'The cost sheet could not be calculated.' });
  }
});

// The sheet as a PDF quotation — from the same analyse() result the page shows.
router.post('/cost-sheet/pdf', requireUser, (req, res) => {
  try {
    const input = req.body || {};
    const out = costSheet.analyse(input, { live: yarnPrices.feed() });
    if (!out.success) return res.status(400).json(out);
    const doc = require('../engine/domain/cost-sheet-pdf').render(out, input);
    const safe = String((out.header || {}).style || 'sheet').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 40) || 'sheet';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Costing-${safe}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('[cost-sheet] pdf failed:', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Could not make the PDF.' });
  }
});

router.get('/cost-sheet/sheets', requireUser, async (req, res) => {
  try { res.json({ success: true, sheets: await costSheetRepo.sheets.list(req.user.id) }); }
  catch (err) { console.error('[cost-sheet] list failed:', err); res.status(500).json({ success: false, error: 'Could not load your saved sheets.' }); }
});

router.get('/cost-sheet/sheets/:id', requireUser, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
  try {
    const row = await costSheetRepo.sheets.get(req.user.id, id);
    if (!row) return res.status(404).json({ success: false, error: 'Sheet not found.' });
    res.json({ success: true, sheet: row });
  } catch (err) { console.error('[cost-sheet] get failed:', err); res.status(500).json({ success: false, error: 'Could not open the sheet.' }); }
});

router.put('/cost-sheet/sheets', requireUser, async (req, res) => {
  try { res.json({ success: true, sheet: await costSheetRepo.sheets.save(req.user.id, req.body) }); }
  catch (err) {
    if (err instanceof costSheetRepo.SheetSaveError) return res.status(400).json({ success: false, error: err.message });
    console.error('[cost-sheet] save failed:', err);
    res.status(500).json({ success: false, error: 'Could not save the sheet.' });
  }
});

router.delete('/cost-sheet/sheets/:id', requireUser, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
  try {
    const removed = await costSheetRepo.sheets.remove(req.user.id, id);
    if (!removed) return res.status(404).json({ success: false, error: 'Sheet not found.' });
    res.json({ success: true });
  } catch (err) { console.error('[cost-sheet] delete failed:', err); res.status(500).json({ success: false, error: 'Could not delete the sheet.' }); }
});

router.get('/charges/vendors', (req, res) => {
  const book = require('../engine/domain/charge-book');
  res.json({ vendors: book.listVendors().filter((v) => v.active).map((v) => ({ code: v.code, name: v.name, kind: v.kind, is_default: !!v.is_default })) });
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
