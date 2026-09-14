/**
 * RFQ (Request For Quotation) — public buyer-facing routes.
 *
 * POST /api/rfq/submit          — buyer submits a multi-item quote request
 * GET  /api/rfq/status/:code    — buyer checks status with their reference code
 *
 * Admin-side management (list/detail/status update/set quoted price) lives
 * in routes/admin.js beside the app's other adminAuth-gated screens, not
 * here — this file is the public surface only.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { calculate, ENGINE_INPUTS, getAllFabrics } = require('../engine/index');
const { validateRfqSubmission, generateReferenceCode } = require('../engine/domain/rfq-engine');
const rfqRepo = require('../db/repositories/rfq-repo');
const { createRateLimiter } = require('../middleware/rate-limiter');
const yarnPrices = require('../db/repositories/yarn-price-repo');

const submitLimiter = createRateLimiter({
  name: 'rfq-submit',
  max: 5,
  windowMs: 60 * 60 * 1000,
  message: 'Too many quote requests — please wait before submitting another.',
});
const statusLimiter = createRateLimiter({
  name: 'rfq-status',
  max: 30,
  windowMs: 60 * 60 * 1000,
  message: 'Too many status checks — please wait a moment.',
});

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
}

/** Computes ONE line item's reference price using the exact same engine the
 * rest of the app uses, then freezes the result — never recomputed later. */
function priceLineItem(item) {
  const fabricDef = getAllFabrics().find(f => f.id === item.fabric_id);
  if (!fabricDef) return { ok: false, error: `Unknown fabric_id "${item.fabric_id}".` };

  const engineParams = {};
  for (const field of ENGINE_INPUTS) {
    if (item[field] !== undefined) engineParams[field] = item[field];
  }
  engineParams.fabric = item.fabric_id;
  engineParams.gsm = parseFloat(item.gsm);
  engineParams.live_prices = (key, ne, country) => yarnPrices.lookup(key, ne, undefined, { country });

  const result = calculate(engineParams);
  if (result.error) return { ok: false, error: result.error };

  return {
    ok: true,
    fabric_name: result.fabric.name,
    reference_fabric_price_usd: result.costing ? result.costing.total_per_kg_usd : null,
    reference_fob_price_usd: result.garment_costing ? result.garment_costing.cmt.summary.fob_total_usd : null,
    reference_calc_snapshot: {
      fabric: result.fabric, costing: result.costing, garment_costing: result.garment_costing,
    },
  };
}

router.post('/submit', submitLimiter, async (req, res) => {
  const body = req.body || {};
  const validation = validateRfqSubmission(body);
  if (!validation.ok) {
    return res.status(400).json({ success: false, errors: validation.errors });
  }

  try {
    const pricedItems = [];
    for (const item of body.line_items) {
      const priced = priceLineItem(item);
      if (!priced.ok) {
        return res.status(400).json({ success: false, errors: [`Fabric "${item.fabric_id}": ${priced.error}`] });
      }
      pricedItems.push({
        fabric_id: item.fabric_id,
        fabric_name: priced.fabric_name,
        gsm: parseFloat(item.gsm),
        composition: item.composition || null,
        garment_type: item.garment_type || null,
        garment_weight_g: item.garment_weight_g ? parseFloat(item.garment_weight_g) : null,
        order_quantity: item.order_quantity ? parseInt(item.order_quantity, 10) : null,
        target_price_usd: item.target_price_usd != null ? parseFloat(item.target_price_usd) : null,
        reference_fabric_price_usd: priced.reference_fabric_price_usd,
        reference_fob_price_usd: priced.reference_fob_price_usd,
        reference_calc_snapshot: priced.reference_calc_snapshot,
      });
    }

    // Retry on the astronomically unlikely event of a reference-code
    // collision (unique constraint) rather than trusting randomness alone.
    let created = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const referenceCode = generateReferenceCode();
      try {
        created = await rfqRepo.create({
          referenceCode,
          buyer: body,
          lineItems: pricedItems,
          ipHash: hashIp(req.ip),
        });
      } catch (err) {
        if (!/duplicate key/i.test(err.message) || attempt === 4) throw err;
      }
    }

    res.json({
      success: true,
      reference_code: created.reference_code,
      line_item_count: pricedItems.length,
    });
  } catch (err) {
    console.error('[RFQ] submit failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not submit the quote request — please try again.' });
  }
});

router.get('/status/:code', statusLimiter, async (req, res) => {
  try {
    const rfq = await rfqRepo.getByReferenceCode(String(req.params.code || '').toUpperCase().trim());
    if (!rfq) {
      return res.status(404).json({ success: false, error: 'No quote request found for that reference code.' });
    }

    // Buyer-facing view: hide the full raw calc snapshot (internal audit
    // detail, not something to expose over an unauthenticated lookup) and
    // the ip_hash — return only what a buyer needs to see.
    res.json({
      success: true,
      reference_code: rfq.reference_code,
      status: rfq.status,
      created_at: rfq.created_at,
      quoted_at: rfq.quoted_at,
      line_items: rfq.line_items.map(li => ({
        line_number: li.line_number,
        fabric_name: li.fabric_name,
        gsm: li.gsm,
        garment_type: li.garment_type,
        order_quantity: li.order_quantity,
        target_price_usd: li.target_price_usd,
        quoted_price_usd: li.quoted_price_usd,
        quoted_notes: li.quoted_notes,
      })),
    });
  } catch (err) {
    console.error('[RFQ] status lookup failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not look up that reference code.' });
  }
});

module.exports = router;
