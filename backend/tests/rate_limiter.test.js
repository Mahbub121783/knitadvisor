const assert = require('assert');
const path = require('path');

console.log('--- Running Rate Limiter Tests ---');

// The real SQL needs PostgreSQL, which the engine suites deliberately never
// require. What this suite pins down is the middleware's behaviour around it,
// using an in-memory stand-in with the same counting rule the UPSERT applies.
// The SQL itself is exercised against the live database during deploy.
const dbClientPath = require.resolve(path.join(__dirname, '..', 'db', 'client.js'));
const store = new Map();
let failNext = false;
function fakeQuery(sql, params) {
  if (failNext) { failNext = false; return Promise.reject(new Error('connection refused (simulated)')); }
  const [bucket, key, windowSecs] = params;
  const id = bucket + '|' + key;
  const now = Date.now();
  let row = store.get(id);
  if (!row || row.window_start.getTime() < now - windowSecs * 1000) {
    row = { count: 1, window_start: new Date(now) };
  } else {
    row = { count: row.count + 1, window_start: row.window_start };
  }
  store.set(id, row);
  return Promise.resolve([{ count: row.count, window_start: row.window_start }]);
}
require.cache[dbClientPath] = { id: dbClientPath, filename: dbClientPath, loaded: true, exports: { query: fakeQuery }, children: [], paths: [] };

const { createRateLimiter } = require('../middleware/rate-limiter');

function run(limiter, ip) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {}, body: null,
      set(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve({ res: this, passed: false }); return this; },
    };
    const req = { ip };
    limiter(req, res, () => resolve({ res, passed: true }));
  });
}

(async () => {
  // ── counts up to max, then refuses with Retry-After ───────────────────────
  {
    const limiter = createRateLimiter({ name: 'test-login', max: 3, windowMs: 60 * 1000, message: 'slow down' });
    for (let i = 1; i <= 3; i++) {
      const r = await run(limiter, '10.0.0.1');
      assert.strictEqual(r.passed, true, `hit ${i} should pass`);
    }
    const blocked = await run(limiter, '10.0.0.1');
    assert.strictEqual(blocked.passed, false, 'hit 4 must be refused');
    assert.strictEqual(blocked.res.statusCode, 429);
    assert.strictEqual(blocked.res.body.error, 'slow down');
    const ra = Number(blocked.res.headers['Retry-After']);
    assert(ra >= 1 && ra <= 60, `Retry-After should be within the window, got ${ra}`);
    console.log('  counts to max, then 429 with a Retry-After inside the window');
  }

  // ── buckets are independent per name and per IP ─────────────────────────────
  {
    const a = createRateLimiter({ name: 'test-a', max: 1, windowMs: 60 * 1000 });
    const b = createRateLimiter({ name: 'test-b', max: 1, windowMs: 60 * 1000 });
    assert.strictEqual((await run(a, '10.0.0.2')).passed, true);
    assert.strictEqual((await run(a, '10.0.0.2')).passed, false, 'same bucket + IP is exhausted');
    assert.strictEqual((await run(b, '10.0.0.2')).passed, true, 'a different bucket is untouched');
    assert.strictEqual((await run(a, '10.0.0.3')).passed, true, 'a different IP is untouched');
    console.log('  buckets and IPs count independently');
  }

  // ── a store outage fails OPEN, never 500s the request ──────────────────────
  {
    const limiter = createRateLimiter({ name: 'test-outage', max: 1, windowMs: 60 * 1000 });
    failNext = true;
    const r = await run(limiter, '10.0.0.4');
    assert.strictEqual(r.passed, true, 'with the store down the request must be allowed through');
    console.log('  store outage allows the request through (logged, not a 500)');
  }

  console.log('--- All Rate Limiter Tests Passed ---');
})().catch((e) => { console.error(e); process.exit(1); });
