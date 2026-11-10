// The API over real HTTP: /api/v1 rewritten to /api, the key gate in front of the real engine routes.
// The key store is replaced by an in-memory one; everything else — the router, requireUser, the plan limiter, the engines — is the real thing.
const assert = require('assert');
const http = require('http');
const express = require('express');
const R = require('../db/repositories/api-key-repo');
console.log('--- Running API Key HTTP Tests ---');

const good = R.generateKey();
const state = { month: 0, win: {}, rec: [], key: { id: 5, name: 'ERP', prefix: good.prefix, plan: 'beta', monthly_limit: 3, per_min_limit: 50, status: 'active', allowed_ips: null, expires_at: null,
  user_id: 9, email: 'x@y.z', username: 'x', full_name: 'X', company: 'Y', is_paid: false, student_status: null, student_expires_at: null, email_verified: true, two_factor: null, user_disabled: false } };
Object.assign(R.keys, {
  findByHash: async (h) => (h === good.hash ? { ...state.key } : null),
  hitWindow: async (b, k) => { const id = b + k; state.win[id] = (state.win[id] || 0) + 1; return { count: state.win[id], window_start: new Date() }; },
  hitMonth: async (id, limit) => (state.month >= limit ? null : ++state.month),
  record: async (id, err) => { state.rec.push([id, err]); },
  usage: async () => ({ month_calls: state.month, days: [{ day: '2026-11-10', calls: state.month, errors: 0 }] }),
});

const app = express();
// as server.js does: /api/v1/x is /api/x, a browser's preflight is answered, then the v1 surface asks for the key
app.use((req, res, next) => {
  if (req.url.startsWith('/api/v1/')) { req.url = '/api' + req.url.slice('/api/v1'.length); req.viaV1 = true; }
  if (req.viaV1 && req.method === 'OPTIONS') return require('../middleware/api-key-auth').preflight(req, res);
  next();
});
app.use(express.json({ limit: '256kb' }));
app.use('/api', require('../middleware/api-key-auth').v1Surface);
app.use('/api/account', require('../routes/account'));   // as in the real server, the account router sits beside the engines
app.use('/api', require('../routes/api'));

const call = (port, method, p, { key, body, headers } = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(headers || {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, body: j, text: b }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  try {
    // no key: the API says so (the website's own /api/calculate asks for a sign-in)
    let r = await call(port, 'POST', '/api/v1/calculate', { body: { fabric: 'single_jersey', gsm: 160 } });
    assert.strictEqual(r.status, 401); assert.strictEqual(r.body.code, 'API_KEY_REQUIRED');

    // a key: the real calculator answers
    r = await call(port, 'POST', '/api/v1/calculate', { key: good.key, body: { fabric: 'single_jersey', gsm: 160, composition: '100% Cotton' } });
    assert.strictEqual(r.status, 200, r.text.slice(0, 300));
    assert(r.body.success && r.body.yarn, 'the engine ran for the key');
    assert.strictEqual(r.headers['x-quota-limit'], '3'); assert.strictEqual(r.headers['x-quota-remaining'], '2'); assert.strictEqual(r.headers['x-ratelimit-limit'], '50');

    // the same key on the Studio and costing engines (the same route, a different engine)
    r = await call(port, 'POST', '/api/v1/studio/warp/analyse', { key: good.key, body: { machine: { type: 'tricot', gauge: 28 }, bars: [{ notation: '1-0/1-2//', yarn: { count: 40, unit: 'denier', fibre: 'nylon_filament' } }, { notation: '1-2/1-0//', yarn: { count: 40, unit: 'denier', fibre: 'nylon_filament' } }], target: { gsm: 110 } } });
    assert.strictEqual(r.status, 200, r.text.slice(0, 200)); assert(r.body.success && r.body.fabric.gsm === 110);
    assert.strictEqual(r.headers['x-quota-remaining'], '1');

    // what the key says about itself
    r = await call(port, 'GET', '/api/v1/usage', { key: good.key });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.limits.monthly_calls, 3); assert.strictEqual(r.body.this_month.calls, 3); assert.strictEqual(r.body.this_month.remaining, 0);
    assert.strictEqual(r.body.key.prefix, good.prefix);

    // the month is used up: stopped, with the date
    r = await call(port, 'POST', '/api/v1/calculate', { key: good.key, body: { fabric: 'single_jersey', gsm: 160 } });
    assert.strictEqual(r.status, 429); assert.strictEqual(r.body.code, 'QUOTA_EXCEEDED'); assert(r.body.resets_at);

    // never the account or saved work, even with a valid key
    state.month = 0;
    for (const [m, p] of [['GET', '/api/v1/studio/designs'], ['GET', '/api/v1/account/security'], ['POST', '/api/v1/account/password'], ['GET', '/api/v1/cost-sheet/sheets'], ['POST', '/api/v1/studio/warp/cost']]) {
      r = await call(port, m, p, { key: good.key, body: m === 'POST' ? {} : undefined });
      assert.strictEqual(r.status, 404, `${m} ${p}: ${r.status}`); assert.strictEqual(r.body.code, 'NOT_IN_API');
    }
    assert.strictEqual(state.month, 0, 'refused endpoints cost no quota');

    // the engines the website serves openly are a sold, metered copy under /api/v1
    r = await call(port, 'POST', '/api/convert', { body: { value: 30, from: 'ne', to: 'tex' } });
    assert.notStrictEqual(r.status, 401, 'the website\'s own /api/convert stays open');
    r = await call(port, 'POST', '/api/v1/convert', { body: { value: 30, from: 'ne', to: 'tex' } });
    assert.strictEqual(r.status, 401); assert.strictEqual(r.body.code, 'API_KEY_REQUIRED');
    r = await call(port, 'POST', '/api/v1/convert', { key: good.key, body: { value: 30, from: 'ne', to: 'tex' } });
    assert.notStrictEqual(r.status, 401, r.text.slice(0, 200)); assert.strictEqual(r.headers['x-quota-remaining'], '2', 'a call to an open engine is counted');
    state.month = 0;

    // a web page: preflight for any site, the real call held to the key's sites
    r = await call(port, 'OPTIONS', '/api/v1/calculate', { headers: { Origin: 'https://erp.mill.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.strictEqual(r.status, 204); assert.strictEqual(r.headers['access-control-allow-origin'], 'https://erp.mill.com'); assert(/authorization/i.test(r.headers['access-control-allow-headers']));
    r = await call(port, 'POST', '/api/v1/convert', { key: good.key, headers: { Origin: 'https://erp.mill.com' }, body: { value: 30, from: 'ne', to: 'tex' } });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'ORIGIN_NOT_ALLOWED'); assert(!r.headers['access-control-allow-origin']);
    state.key.allowed_origins = ['https://erp.mill.com'];
    r = await call(port, 'POST', '/api/v1/convert', { key: good.key, headers: { Origin: 'https://erp.mill.com' }, body: { value: 30, from: 'ne', to: 'tex' } });
    assert.notStrictEqual(r.status, 403); assert.strictEqual(r.headers['access-control-allow-origin'], 'https://erp.mill.com'); assert(/X-Quota-Remaining/.test(r.headers['access-control-expose-headers']));
    r = await call(port, 'POST', '/api/v1/convert', { key: good.key, headers: { Origin: 'https://evil.example' }, body: { value: 30, from: 'ne', to: 'tex' } });
    assert.strictEqual(r.status, 403); assert(!r.headers['access-control-allow-origin']);
    state.key.allowed_origins = null; state.month = 0;

    // a wrong key, and a key sent in X-API-Key
    r = await call(port, 'POST', '/api/v1/calculate', { key: 'ka_live_' + 'z'.repeat(43), body: { fabric: 'single_jersey', gsm: 160 } });
    assert.strictEqual(r.status, 401); assert.strictEqual(r.body.code, 'INVALID_API_KEY');
    r = await call(port, 'POST', '/api/v1/calculate', { headers: { 'X-API-Key': good.key }, body: { fabric: 'single_jersey', gsm: 160 } });
    assert.strictEqual(r.status, 200);

    // suspended: stopped at once
    state.key.status = 'suspended';
    r = await call(port, 'POST', '/api/v1/calculate', { key: good.key, body: { fabric: 'single_jersey', gsm: 160 } });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'KEY_SUSPENDED');

    // the catalogue is public and is the list the gate enforces
    r = await call(port, 'GET', '/api/v1/catalogue');
    assert.strictEqual(r.status, 200); assert(r.body.endpoints.length >= 25 && r.body.plans.pro.monthly_calls === 100000 && r.body.base_url === '/api/v1');
    assert(r.body.endpoints.every((e) => e.path.startsWith('/api/v1/')));

    // the day tally is written for the calls that got through
    await new Promise((x) => setTimeout(x, 50));
    assert(state.rec.length >= 3 && state.rec.every((x) => x[0] === 5));
    console.log('API key HTTP tests passed');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { server.close(); setTimeout(() => process.exit(process.exitCode || 0), 50).unref(); }
});
