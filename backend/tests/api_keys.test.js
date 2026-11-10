// The API as sold: key format, what a key may call, plans and limits, and every way the gate says no.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../db/repositories/api-key-repo');
const C = require('../engine/domain/api-catalogue');
const { createGate, createV1Surface, preflight, nextReset } = require('../middleware/api-key-auth');
const O = require('../db/repositories/api-order-repo');
console.log('--- Running API Key Tests ---');

// ── the key ──────────────────────────────────────────────────────────────
{
  const g = R.generateKey();
  assert(R.KEY_RE.test(g.key), g.key);
  assert.strictEqual(g.key.length, 8 + 43);
  assert.strictEqual(g.hash, R.hashKey(g.key));
  assert.strictEqual(g.prefix, g.key.slice(0, 15));
  assert.notStrictEqual(R.generateKey().key, g.key, 'keys are random');
  assert(!g.hash.includes(g.key.slice(8)), 'only a hash is kept');
  const req = (h) => ({ headers: h });
  assert.strictEqual(R.keyFromRequest(req({ authorization: 'Bearer ' + g.key })), g.key);
  assert.strictEqual(R.keyFromRequest(req({ authorization: 'bearer ' + g.key })), g.key);
  assert.strictEqual(R.keyFromRequest(req({ 'x-api-key': g.key })), g.key);
  assert.strictEqual(R.keyFromRequest(req({})), null);
  assert.strictEqual(R.keyFromRequest(req({ authorization: 'Bearer something-else' })), null, 'only ka_ keys are keys');
}

// ── what a key may call ─────────────────────────────────────────────────
{
  const m = (method, p) => C.matchEndpoint(method, p);
  assert(m('POST', '/calculate') && m('POST', '/studio/analyse') && m('POST', '/studio/warp/analyse') && m('POST', '/cost-sheet/analyse'));
  assert(m('GET', '/pattern/single-jersey') && m('GET', '/dyeing/recipes/abc') && m('GET', '/usage'));
  assert(!m('GET', '/calculate'), 'the method matters');
  // the account itself, saved work, AI-quota and phone-pairing routes are not part of the API
  for (const p of ['/account/password', '/account/api-keys', '/auth/login', '/studio/designs', '/cost-sheet/sheets', '/cost-sheet/sheets/3', '/studio/warp/cost', '/cost-sheet/shell-from-studio', '/parse', '/scan/pair', '/assistant/ask', '/admin/api/users']) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) assert(!m(method, p), `${method} ${p} must not be callable with a key`);
  }
  assert(!m('POST', '/calculate/../account/password'), 'no path tricks');
  // every endpoint's id names the versioned path, and the public list leaks no regex
  C.ENDPOINTS.forEach((e) => assert(e.id === `${e.method} /api/v1${e.path}` && /^\/[a-z]/.test(e.path)));
  assert(!JSON.stringify(C.publicList()).includes('re"'));
  assert(C.publicList().length >= 25 && C.publicList().every((e) => e.key_required), 'every API endpoint needs a key');
  assert(C.ENDPOINTS.some((e) => e.web_open) && C.ENDPOINTS.some((e) => !e.web_open), 'some engines are open on the website, some are not');
  // web_open says what the WEBSITE's own route is: signed-in only (false) or open to anyone (true). The API copy needs a key either way.
  const src = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
  for (const e of C.ENDPOINTS) {
    const needle = `router.${e.method.toLowerCase()}('${e.path}'`;
    const at = src.indexOf(needle);
    assert(at > -1, `route for ${e.id} exists`);
    const line = src.slice(at, src.indexOf('\n', at));
    assert.strictEqual(/requireUser/.test(line), !e.web_open, `${e.id}: web_open must match the route's requireUser`);
  }
}

// ── plans and limits ────────────────────────────────────────────────────
{
  assert.deepStrictEqual(C.limitsFor({ plan: 'pro', monthly_limit: null, per_min_limit: null }), { monthly: 100000, per_min: 180 });
  assert.deepStrictEqual(C.limitsFor({ plan: 'pro', monthly_limit: 250000, per_min_limit: 400 }), { monthly: 250000, per_min: 400 }, "the key's own figures win");
  assert(C.PLANS.beta.monthly < C.PLANS.starter.monthly && C.PLANS.starter.monthly < C.PLANS.pro.monthly && C.PLANS.pro.monthly < C.PLANS.business.monthly);
  assert.strictEqual(R.cleanIps(''), null);
  assert.deepStrictEqual(R.cleanIps('203.0.113.5, 198.51.100.7\n2001:db8::1'), ['203.0.113.5', '198.51.100.7', '2001:db8::1']);
  assert.throws(() => R.cleanIps('999.1.1.1'), /not an IP/);
  assert.throws(() => R.cleanIps('hello'), /not an IP/);
  assert.throws(() => R.cleanIps(new Array(21).fill('1.1.1.1')), /At most 20/);
  assert.strictEqual(nextReset(new Date('2026-11-10T10:00:00Z')), '2026-11-30T18:00:00.000Z', 'the month rolls over at Dhaka midnight (UTC+6)');
  assert.strictEqual(nextReset(new Date('2026-12-31T19:00:00Z')), '2027-01-31T18:00:00.000Z', 'a call at 01:00 on 1 January Dhaka time is in January: it resets on 1 February');
}

// ── websites a key may be used from ─────────────────────────────────────
{
  assert.deepStrictEqual(R.cleanOrigins('https://erp.mill.com, https://ERP.mill.com/ ,http://localhost:3000'), ['https://erp.mill.com', 'http://localhost:3000']);
  assert.strictEqual(R.cleanOrigins(''), null);
  for (const bad of ['https://*.mill.com', 'http://mill.com', 'https://mill.com/app', 'mill.com', 'javascript:alert(1)']) assert.throws(() => R.cleanOrigins(bad), /site|https/, bad);
  assert.throws(() => R.cleanOrigins(new Array(11).fill(0).map((_, i) => `https://s${i}.example.com`)), /At most 10/);
}

// ── orders: what a plan costs, and what is refused ──────────────────────
{
  const prices = [{ plan: 'starter', price: '29.50', currency: 'USD' }, { plan: 'pro', price: 99, currency: 'USD' }];
  const ok = O.priceOrder({ plan: 'starter', months: 3, method: 'bkash', payment_ref: ' TX 8H2K9 ' }, prices, []);
  assert.deepStrictEqual([ok.amount, ok.currency, ok.months, ok.payment_ref, ok.renew_key_id], [88.5, 'USD', 3, 'TX 8H2K9', null], 'the amount is price x months, to the cent');
  assert.strictEqual(O.priceOrder({ plan: 'pro', months: 1, method: 'bank', payment_ref: 'REF12345', renew_key_id: '7' }, prices, [7, 9]).renew_key_id, 7, 'a renewal names one of their own keys');
  const no = (b, re) => assert.throws(() => O.priceOrder(b, prices, [7]), re, JSON.stringify(b));
  no({ plan: 'business', months: 1, method: 'bkash', payment_ref: 'abcd1234' }, /not for sale/);
  no({ plan: 'beta', months: 1, method: 'bkash', payment_ref: 'abcd1234' }, /not for sale/);
  no({ plan: 'pro', months: 0, method: 'bkash', payment_ref: 'abcd1234' }, /1 to 24/);
  no({ plan: 'pro', months: 25, method: 'bkash', payment_ref: 'abcd1234' }, /1 to 24/);
  no({ plan: 'pro', months: 1.5, method: 'bkash', payment_ref: 'abcd1234' }, /1 to 24/);
  no({ plan: 'pro', months: 1, method: 'cash-in-hand', payment_ref: 'abcd1234' }, /how you paid/);
  no({ plan: 'pro', months: 1, method: 'bkash', payment_ref: 'ab' }, /transaction id/);
  no({ plan: 'pro', months: 1, method: 'bkash', payment_ref: 'x'.repeat(61) }, /transaction id/);
  no({ plan: 'pro', months: 1, method: 'bkash', payment_ref: 'abcd1234', renew_key_id: 8 }, /not on your account/);
  assert(O.METHODS.bkash && O.METHODS.nagad && O.METHODS.bank);
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/042_api_orders_origins.sql'), 'utf8');
  assert(/ADD COLUMN allowed_origins text\[\]/.test(sql) && /CREATE TABLE api_orders/.test(sql) && /status IN \('pending', 'paid', 'rejected', 'cancelled'\)/.test(sql));
  assert(/UNIQUE INDEX uq_api_orders_payment[\s\S]*WHERE status IN \('pending', 'paid'\)/.test(sql), 'one transaction id backs one order');
  const orepo = fs.readFileSync(path.join(__dirname, '../db/repositories/api-order-repo.js'), 'utf8');
  assert(/WHERE id = \$1 AND user_id = \$2 AND status = 'paid' AND key_id IS NULL AND issued_at IS NULL/.test(orepo), 'a key is claimed once, atomically');
  assert(/status = 'pending' RETURNING id, user_id, plan/.test(orepo), 'only a pending order can be decided');
}

// ── the gate ────────────────────────────────────────────────────────────
(async () => {
  const good = R.generateKey();
  const baseKey = { id: 7, name: 'ERP', prefix: good.prefix, plan: 'beta', monthly_limit: null, per_min_limit: null, status: 'active', allowed_ips: null, expires_at: null,
    user_id: 42, email: 'buyer@mill.example', username: 'buyer', full_name: 'Buyer', company: 'Mill', is_paid: false, student_status: null, student_expires_at: null, email_verified: true, two_factor: null, user_disabled: false };
  const mk = (over, state) => {
    const st = state || { month: 0, win: {}, fail: 0, recorded: [] };
    const repo = {
      findByHash: async (h) => (h === good.hash ? { ...baseKey, ...(over || {}) } : null),
      hitWindow: async (bucket, key) => { const k = bucket + key; if (bucket === 'apikey_fail') { st.fail++; return { count: st.fail, window_start: new Date() }; } st.win[k] = (st.win[k] || 0) + 1; return { count: st.win[k], window_start: new Date() }; },
      hitMonth: async (id, limit) => (st.month >= limit ? null : ++st.month),
      record: async (id, err) => { st.recorded.push([id, err]); },
    };
    return { gate: createGate(repo, { now: () => new Date('2026-11-10T10:00:00Z') }), st };
  };
  const OWNER_EMAIL = 'buyer@mill.example';
  const run = async (gate, { method = 'POST', p = '/calculate', ip = '203.0.113.5', key = good.key, email = OWNER_EMAIL } = {}) => {
    const req = { method, path: p, ip, headers: email ? { 'x-user-email': email } : {} }, headers = {};
    let code = null, body = null, nextCalled = false, finish = null;
    const res = { statusCode: 200, set(k, v) { headers[k] = v; return this; }, status(c) { code = c; this.statusCode = c; return this; }, json(b) { body = b; return this; }, on(e, f) { if (e === 'finish') finish = f; } };
    await gate(req, res, () => { nextCalled = true; }, key);
    return { req, res, code, body, headers, nextCalled, finish };
  };

  // ok: acts as the owner, with the quota headers
  const { gate, st } = mk();
  let r = await run(gate);
  assert(r.nextCalled && r.req.user.id === 42 && r.req.apiKey.id === 7 && r.req.apiKey.endpoint === 'POST /api/v1/calculate');
  assert.strictEqual(r.headers['X-Quota-Limit'], '1000'); assert.strictEqual(r.headers['X-Quota-Remaining'], '999'); assert.strictEqual(r.headers['X-RateLimit-Limit'], '30'); assert.strictEqual(r.headers['X-RateLimit-Remaining'], '29');
  assert.strictEqual(r.headers['X-Quota-Reset'], '2026-11-30T18:00:00.000Z');
  r.res.statusCode = 200; r.finish(); await new Promise((x) => setImmediate(x));
  assert.deepStrictEqual(st.recorded, [[7, false]], 'the day tally is written after the answer');
  r.res.statusCode = 422; r.finish(); await new Promise((x) => setImmediate(x));
  assert.deepStrictEqual(st.recorded[1], [7, true], 'an error answer is counted as one');

  // not an API endpoint: refused before the database is touched
  let touched = false;
  const spy = createGate({ findByHash: async () => { touched = true; return null; }, hitWindow: async () => ({ count: 1 }), hitMonth: async () => 1, record: async () => {} });
  r = await run(spy, { p: '/account/password' });
  assert(r.code === 403 && r.body.code === 'ENDPOINT_NOT_IN_API' && !touched && !r.nextCalled);
  r = await run(spy, { p: '/studio/designs', method: 'GET' });
  assert(r.code === 403 && !touched, 'saved designs are not reachable with a key');

  // the key and the account email must belong together
  r = await run(mk().gate, { email: null });
  assert(r.code === 401 && r.body.code === 'EMAIL_REQUIRED' && !r.nextCalled, 'a key with no email is refused');
  r = await run(mk().gate, { email: 'someone.else@mill.example' });
  assert(r.code === 401 && r.body.code === 'EMAIL_MISMATCH' && !r.nextCalled, "another account's email is refused");
  assert(!/buyer@mill/.test(JSON.stringify(r.body)), "the refusal does not tell the real owner's email");
  r = await run(mk().gate, { email: '  BUYER@Mill.Example ' });
  assert(r.nextCalled, 'case and spaces in the email do not matter');
  r = await run(mk().gate, { email: '' });
  assert(r.body.code === 'EMAIL_REQUIRED');
  const stm = mk(); let em;
  for (let i = 0; i < 22; i++) em = await run(stm.gate, { email: 'guess' + i + '@x.example' });
  assert(em.code === 429 && em.body.code === 'TOO_MANY_BAD_KEYS', 'guessing emails against a key is slowed too');
  assert.strictEqual(stm.st.month, 0, 'a refused email costs no quota');
  // a wrong key is "invalid key" whatever email it comes with, so the email check is no way to probe keys
  r = await run(mk().gate, { key: 'ka_live_' + 'q'.repeat(43), email: 'whoever@x.example' });
  assert(r.body.code === 'INVALID_API_KEY');
  r = await run(mk().gate, { key: 'ka_live_' + 'q'.repeat(43), email: null });
  assert(r.body.code === 'INVALID_API_KEY', 'a bad key is a bad key even with no email');

  // bad keys
  r = await run(mk().gate, { key: 'ka_live_' + 'x'.repeat(43) });
  assert(r.code === 401 && r.body.code === 'INVALID_API_KEY' && !r.nextCalled);
  r = await run(mk().gate, { key: 'ka_garbage' });
  assert(r.code === 401 && r.body.code === 'INVALID_API_KEY');
  const flood = mk(); let last;
  for (let i = 0; i < 22; i++) last = await run(flood.gate, { key: 'ka_live_' + 'y'.repeat(43) });
  assert(last.code === 429 && last.body.code === 'TOO_MANY_BAD_KEYS', 'guessing keys is slowed');
  assert.strictEqual((await run(mk({ status: 'revoked' }).gate)).body.code, 'KEY_REVOKED');
  assert.strictEqual((await run(mk({ status: 'suspended' }).gate)).body.code, 'KEY_SUSPENDED');
  assert.strictEqual((await run(mk({ expires_at: '2026-01-01T00:00:00Z' }).gate)).body.code, 'KEY_EXPIRED');
  assert.strictEqual((await run(mk({ expires_at: '2027-01-01T00:00:00Z' }).gate)).nextCalled, true, 'a key not yet expired works');
  assert.strictEqual((await run(mk({ user_disabled: true }).gate)).body.code, 'ACCOUNT_DISABLED');

  // allowed IPs: the customer's own servers only (an IPv4-mapped address is the same address)
  const ipGate = mk({ allowed_ips: ['203.0.113.5'] }).gate;
  assert.strictEqual((await run(ipGate, { ip: '198.51.100.9' })).body.code, 'IP_NOT_ALLOWED');
  assert((await run(ipGate, { ip: '203.0.113.5' })).nextCalled);
  assert((await run(ipGate, { ip: '::ffff:203.0.113.5' })).nextCalled);

  // the website: a browser's Origin, or X-Website from a server; the key, the email and the website must belong together
  const SITE = 'https://erp.mill.com';
  const sites = () => mk({ allowed_origins: [SITE] });
  const runWith = async (gate, { origin, website, email = OWNER_EMAIL, ip = '203.0.113.5' } = {}) => {
    const hd = { 'x-user-email': email }; if (origin) hd.origin = origin; if (website) hd['x-website'] = website;
    const req = { method: 'POST', path: '/calculate', ip, headers: hd };
    const headers = {}; let code = null, body = null, nextCalled = false;
    const res = { statusCode: 200, set(k, v) { headers[k] = v; return this; }, status(c) { code = c; return this; }, json(b) { body = b; return this; }, on() {} };
    await gate(req, res, () => { nextCalled = true; }, good.key);
    return { code, body, headers, nextCalled };
  };
  // from a browser: the page's Origin is checked, and the answer carries CORS for that site only
  let b1 = await runWith(sites().gate, { origin: SITE });
  assert(b1.nextCalled && b1.headers['Access-Control-Allow-Origin'] === SITE && b1.headers.Vary === 'Origin' && /X-Quota-Remaining/.test(b1.headers['Access-Control-Expose-Headers']));
  b1 = await runWith(sites().gate, { origin: 'https://evil.example' });
  assert(b1.code === 401 && b1.body.code === 'WEBSITE_MISMATCH' && !b1.nextCalled && !b1.headers['Access-Control-Allow-Origin'], 'another website is refused, with no CORS grant');
  b1 = await runWith(mk().gate, { origin: SITE });
  assert(b1.code === 401 && b1.body.code === 'WEBSITE_MISMATCH' && /server key/.test(b1.body.error), 'a key with no website refuses any browser call');
  // from a server: the key is registered to a website, so the call must name it
  b1 = await runWith(sites().gate, {});
  assert(b1.code === 401 && b1.body.code === 'WEBSITE_REQUIRED' && !b1.nextCalled, 'a key registered to a website needs the website with it');
  b1 = await runWith(sites().gate, { website: SITE });
  assert(b1.nextCalled && !b1.headers['Access-Control-Allow-Origin'], 'a server naming the right website is accepted (no CORS: it is not a browser)');
  b1 = await runWith(sites().gate, { website: '  HTTPS://ERP.MILL.COM/ ' });
  assert(b1.nextCalled, 'case, spaces and a trailing slash do not matter');
  b1 = await runWith(sites().gate, { website: 'https://other.mill.com' });
  assert(b1.code === 401 && b1.body.code === 'WEBSITE_MISMATCH' && !b1.nextCalled && b1.body.your_website === 'https://other.mill.com', 'the wrong website is refused');
  assert((await runWith(mk().gate, {})).nextCalled, 'a key with no website registered needs none');
  assert((await runWith(mk().gate, { website: 'https://anything.example' })).nextCalled, 'a website sent to a key that has none is ignored');
  // all three: a wrong email is refused before the website is looked at, and neither uses quota; wrong sites are slowed like wrong emails
  b1 = await runWith(sites().gate, { website: SITE, email: 'x@y.example' });
  assert(b1.body.code === 'EMAIL_MISMATCH');
  const sg = sites(); let sr;
  for (let i = 0; i < 22; i++) sr = await runWith(sg.gate, { website: 'https://guess' + i + '.example' });
  assert(sr.code === 429 && sr.body.code === 'TOO_MANY_BAD_KEYS' && sg.st.month === 0, 'guessing websites is slowed and costs no quota');
  // a revoked key registered to a website still says revoked once key, email and website agree
  assert((await runWith(mk({ status: 'revoked', allowed_origins: [SITE] }).gate, { website: SITE })).body.code === 'KEY_REVOKED');

  // per minute: the 31st call of a beta key
  const rate = mk(); let rr;
  for (let i = 0; i < 31; i++) rr = await run(rate.gate);
  assert(rr.code === 429 && rr.body.code === 'RATE_LIMITED' && rr.headers['Retry-After'] && rr.body.retry_after_seconds >= 1);
  assert.strictEqual(rate.st.month, 30, 'a call refused for rate is not counted against the month');

  // per month: stops at the limit, with the reset date; the key's own figure beats the plan
  const q = mk({ monthly_limit: 3, per_min_limit: 100 }); let qr;
  for (let i = 0; i < 3; i++) { qr = await run(q.gate); assert(qr.nextCalled); }
  qr = await run(q.gate);
  assert(qr.code === 429 && qr.body.code === 'QUOTA_EXCEEDED' && qr.body.quota === 3 && qr.body.resets_at === '2026-11-30T18:00:00.000Z' && qr.headers['X-Quota-Remaining'] === '0' && !qr.nextCalled);

  // a counter that cannot be read stops the call (a paid API does not go unmetered)
  const down = createGate({ findByHash: async () => { throw new Error('db down'); }, hitWindow: async () => ({ count: 1 }), hitMonth: async () => 1, record: async () => {} });
  const dr = await run(down);
  assert(dr.code === 503 && dr.body.code === 'API_UNAVAILABLE' && !dr.nextCalled);

  // ── wiring ──────────────────────────────────────────────────────────
  const ua = fs.readFileSync(path.join(__dirname, '../middleware/user-auth.js'), 'utf8');
  assert(/keyFromRequest\(req\)/.test(ua) && /api-key-auth'\)\.gate/.test(ua), 'requireUser hands key requests to the gate');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(/\/api\/v1\//.test(server) && /req\.url = '\/api'/.test(server), '/api/v1 is /api');
  const { enforceDailyLimit } = require('../middleware/plan-limit');
  let went = false; const pr = { apiKey: { id: 1 } };
  await enforceDailyLimit(pr, {}, () => { went = true; });
  assert(went && pr.plan === 'api', 'an API key has its own plan, not the web daily limit');
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/041_api_keys.sql'), 'utf8');
  assert(/CREATE TABLE api_keys/.test(sql) && /UNIQUE INDEX uq_api_keys_hash ON api_keys \(key_hash\)/.test(sql) && !/key\s+text/.test(sql), 'only a hash is stored');
  assert(/status IN \('active', 'suspended', 'revoked'\)/.test(sql) && /api_key_usage/.test(sql) && /PRIMARY KEY \(key_id, period\)/.test(sql));
  const repo = fs.readFileSync(path.join(__dirname, '../db/repositories/api-key-repo.js'), 'utf8');
  assert(/WHERE api_key_usage\.calls < \$2/.test(repo), 'the monthly quota is one atomic statement');

  // ── the /api/v1 surface: a key for EVERY listed endpoint, nothing unlisted, the catalogue open ──
  const v1 = (over) => { const m = mk(over); return { surf: createV1Surface(m.gate), st: m.st }; };
  const runV1 = async (surf, { method = 'POST', p = '/convert', key = null, via = true } = {}) => {
    const req = { method, path: p, ip: '203.0.113.5', viaV1: via, headers: key ? { authorization: 'Bearer ' + key, 'x-user-email': OWNER_EMAIL } : {} };
    let code = null, body = null, nextCalled = false;
    const res = { statusCode: 200, set() { return this; }, status(c) { code = c; return this; }, json(b) { body = b; return this; }, on() {} };
    await surf(req, res, () => { nextCalled = true; });
    return { req, code, body, nextCalled };
  };
  let vr = await runV1(v1().surf, { p: '/convert' });
  assert(vr.code === 401 && vr.body.code === 'API_KEY_REQUIRED' && !vr.nextCalled, 'an engine the website serves openly still needs a key under /api/v1');
  vr = await runV1(v1().surf, { p: '/convert', key: good.key });
  assert(vr.nextCalled && vr.req.apiKey && vr.req.user.id === 42, 'with a key it runs, counted and acting as the owner');
  vr = await runV1(v1().surf, { p: '/auth/login' });
  assert(vr.code === 404 && vr.body.code === 'NOT_IN_API', 'nothing unlisted is reachable under /api/v1');
  vr = await runV1(v1().surf, { p: '/studio/designs', method: 'GET', key: good.key });
  assert(vr.code === 404 && vr.body.code === 'NOT_IN_API');
  vr = await runV1(v1().surf, { p: '/catalogue', method: 'GET' });
  assert(vr.nextCalled && !vr.req.apiKey, 'the documentation data is open');
  vr = await runV1(v1().surf, { p: '/convert', via: false });
  assert(vr.nextCalled, 'the website\'s own /api/convert is untouched');
  // the browser's preflight carries no key: answered for the asking site
  const pf = { headers: { origin: 'https://erp.mill.com' } }, ph = {}; let pcode = null;
  preflight(pf, { set(k, v) { ph[k] = v; return this; }, status(c) { pcode = c; return this; }, end() {} });
  assert(pcode === 204 && ph['Access-Control-Allow-Origin'] === 'https://erp.mill.com' && /Authorization/.test(ph['Access-Control-Allow-Headers']) && /X-User-Email/.test(ph['Access-Control-Allow-Headers']) && ph['Access-Control-Allow-Methods'] === 'GET, POST, OPTIONS');

  console.log('API key tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
