/**
 * Admin API: AI Provider Management
 * Endpoints for managing providers, API keys, models, and strategies
 */
const express = require('express');
const router = express.Router();
const { query: dbQuery } = require('../config/database');
const providerMgr = require('../ai/provider-manager-v2');

// ── Middleware: require auth ──────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(adminAuth);

// ── GET /api/admin/providers ──────────────────────────────────────────────────
// List all providers with their keys and models
router.get('/providers', async (req, res) => {
  try {
    const providers = await providerMgr.getProviders();

    const withDetails = await Promise.all(
      providers.map(async (p) => ({
        ...p,
        keys: await providerMgr.getApiKeysInfo(p.id),
        models: await providerMgr.getModelsInfo(p.id),
      }))
    );

    res.json(withDetails);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/strategy ──────────────────────────────────────────────────
// Get current strategy
router.get('/strategy', async (req, res) => {
  try {
    const strategy = await providerMgr.getStrategy();
    res.json({ strategy });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/strategy ────────────────────────────────────────────────
// Set strategy (priority | round_robin | weighted | fastest)
router.post('/strategy', async (req, res) => {
  try {
    const { strategy } = req.body;
    const valid = ['priority', 'round_robin', 'weighted', 'fastest'];
    if (!valid.includes(strategy)) {
      return res.status(400).json({ error: 'Invalid strategy' });
    }
    await dbQuery(
      "INSERT INTO ai_provider_config (cfg_key, cfg_value) VALUES ('strategy', ?) ON DUPLICATE KEY UPDATE cfg_value = ?",
      [strategy, strategy]
    );
    res.json({ strategy });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/providers/:id/keys ───────────────────────────────────────
// Add or update API key for a provider
router.post('/providers/:id/keys', async (req, res) => {
  try {
    const { id } = req.params;
    const { api_key, key_index } = req.body;

    if (!api_key || !api_key.trim()) {
      return res.status(400).json({ error: 'API key required' });
    }

    await providerMgr.addApiKey(parseInt(id), api_key.trim(), key_index || 1);

    const keys = await providerMgr.getApiKeysInfo(parseInt(id));
    res.json({ message: 'API key added', keys });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/providers/:id/keys ────────────────────────────────────────
// Get API keys info for a provider (redacted)
router.get('/providers/:id/keys', async (req, res) => {
  try {
    const { id } = req.params;
    const keys = await providerMgr.getApiKeysInfo(parseInt(id));
    // Redact actual keys
    const redacted = keys.map(k => ({
      ...k,
      api_key_preview: '••••••••'
    }));
    res.json(redacted);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/admin/providers/:providerId/keys/:keyId ──────────────────────
// Disable an API key
router.delete('/providers/:providerId/keys/:keyId', async (req, res) => {
  try {
    const { keyId } = req.params;
    await providerMgr.toggleKeyActive(parseInt(keyId), false);
    res.json({ message: 'API key disabled' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/providers/:id/models ────────────────────────────────────
// Add model to a provider
router.post('/providers/:id/models', async (req, res) => {
  try {
    const { id } = req.body;
    const { model_name } = req.body;

    if (!model_name || !model_name.trim()) {
      return res.status(400).json({ error: 'Model name required' });
    }

    await providerMgr.addModel(parseInt(id), model_name.trim());

    const models = await providerMgr.getModelsInfo(parseInt(id));
    res.json({ message: 'Model added', models });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/providers/:id/models ────────────────────────────────────
// Get models for a provider
router.get('/providers/:id/models', async (req, res) => {
  try {
    const { id } = req.params;
    const models = await providerMgr.getModelsInfo(parseInt(id));
    res.json(models);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/admin/providers/:providerId/models/:modelId ─────────────────
// Disable a model
router.delete('/providers/:providerId/models/:modelId', async (req, res) => {
  try {
    const { modelId } = req.params;
    await providerMgr.toggleModelActive(parseInt(modelId), false);
    res.json({ message: 'Model disabled' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/reset-daily-stats ────────────────────────────────────────
// Reset daily token/failure counters (call daily or on demand)
router.post('/reset-daily-stats', async (req, res) => {
  try {
    await providerMgr.resetDailyStats();
    res.json({ message: 'Daily stats reset' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
