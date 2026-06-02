/**
 * KnitAdvisor Server — Entry Point
 * Runs on cPanel Node.js App
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const emergencyRoutes = require('./routes/emergency');
const rateLimiter = require('./middleware/rate-limiter');
const { testConnection } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiter on API routes
app.use('/api', rateLimiter);

// ============================================================
// ROUTES
// ============================================================

// API routes
app.use('/api', apiRoutes);

// Admin routes
app.use('/admin', adminRoutes);

// Emergency routes (for critical fixes when SSH unavailable)
app.use('/emergency', emergencyRoutes);

// Static frontend (served by Express in dev, Apache in production)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// SPA fallback — serve index.html for frontend routes
app.get('*', (req, res) => {
  // Don't serve HTML for API routes
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ============================================================
// START
// ============================================================
async function start() {
  console.log('===========================================');
  console.log('  KnitAdvisor Server v1.0');
  console.log('===========================================');

  // Test DB connection
  const dbOk = await testConnection();
  if (!dbOk) {
    console.warn('[WARN] Database not available. Running without DB cache + logging.');
    console.warn('[WARN] Calculation engine will still work (in-memory only).');
  }

  app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
    console.log(`[Server] API: http://localhost:${PORT}/api`);
    console.log(`[Server] Health: http://localhost:${PORT}/health`);
    console.log('===========================================');
  });
}

start();

module.exports = app; // for testing
