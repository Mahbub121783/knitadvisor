// Open access: the admin's switch that lets anyone use the tools without an account.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const oa = require('../services/open-access');

console.log('--- Running Open Access Tests ---');

// keep whatever state a developer had, and put it back at the end
const saved = fs.existsSync(oa.FILE) ? fs.readFileSync(oa.FILE, 'utf8') : null;
const restore = () => { try { if (saved == null) fs.unlinkSync(oa.FILE); else fs.writeFileSync(oa.FILE, saved); } catch (_) {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.use('/api/account', require('../routes/account'));
app.use('/api', require('../routes/api'));

const origLog = console.log; const quiet = (...a) => { if (!/PostgreSQL|History|ApiKey|record failed/i.test(a.join(' '))) origLog(...a); };
console.error = console.warn = () => {};

const server = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, body: j };
  };
  try {
    // 1. off: nothing changes
    oa.set({ enabled: false });
    await wait(3100);
    let r = await call('POST', '/api/calculate', { fabric: 'single_jersey', gsm: 180 });
    assert.strictEqual(r.status, 401); assert.strictEqual(r.body.code, 'AUTH_REQUIRED');
    assert.strictEqual((await call('GET', '/api/auth/me')).status, 401, 'signed out is still a 401 when closed');
    assert.strictEqual((await call('GET', '/api/open-access')).body.active, false);
    quiet('  Closed: the engine still asks for sign-in');

    // 2. on: the tools answer a guest
    oa.set({ enabled: true, until: new Date(Date.now() + 3600e3).toISOString(), label: 'Open Innovation', scopes: ['calculator', 'carbon', 'studio', 'costing', 'scan', 'yarn'], per_hour: 300 });
    await wait(3100);
    r = await call('POST', '/api/calculate', { fabric: 'single_jersey', gsm: 180, composition: '100% Cotton' });
    assert.strictEqual(r.status, 200, 'a guest calculates: ' + JSON.stringify(r.body).slice(0, 200));
    r = await call('POST', '/api/carbon', { gsm: 180, composition: '100% Cotton' });
    assert.strictEqual(r.status, 200); assert(r.body.total_co2e_per_kg_fabric > 0);
    const me = await call('GET', '/api/auth/me');
    assert.strictEqual(me.status, 200); assert.strictEqual(me.body.guest, true); assert.strictEqual(me.body.user, null);
    const pub = (await call('GET', '/api/open-access')).body;
    assert.strictEqual(pub.active, true); assert.strictEqual(pub.label, 'Open Innovation'); assert(pub.tools.length === 6);
    quiet('  Open: a guest calculates and gets a carbon footprint; /me answers "guest"');

    // 3. saving and accounts stay closed, with a code that does not bounce the visitor to sign-in
    r = await call('PUT', '/api/studio/designs', { name: 'x' });
    assert.strictEqual(r.status, 401); assert.strictEqual(r.body.code, 'GUEST_LOCKED');
    r = await call('GET', '/api/account/dashboard');
    assert.strictEqual(r.body.code, 'GUEST_LOCKED');
    r = await call('POST', '/api/cost-sheet/sheets', {});
    assert.notStrictEqual(r.status, 200);
    quiet('  Saving, the account and the dashboard stay behind sign-in (GUEST_LOCKED)');

    // 4. scopes are honoured
    oa.set({ scopes: ['carbon'] });
    await wait(3100);
    assert.strictEqual((await call('POST', '/api/calculate', { fabric: 'single_jersey', gsm: 180 })).body.code, 'GUEST_LOCKED');
    assert.strictEqual((await call('POST', '/api/carbon', { gsm: 180 })).status, 200);
    quiet('  Only the tools picked in the panel are open');

    // 5. the hourly ceiling per visitor
    oa.set({ per_hour: 10 });
    await wait(3100);
    let last = null;
    for (let i = 0; i < 12; i++) last = await call('POST', '/api/carbon', { gsm: 180 });
    assert.strictEqual(last.status, 429); assert.strictEqual(last.body.code, 'GUEST_RATE');
    quiet('  A visitor past the hourly ceiling is held');

    // 6. it switches itself off at the end time
    oa.set({ per_hour: 300, until: new Date(Date.now() + 1500).toISOString() });
    await wait(4200);
    assert.strictEqual((await call('POST', '/api/carbon', { gsm: 180 })).body.code, 'AUTH_REQUIRED', 'past the end time it is closed again');
    assert.throws(() => oa.set({ enabled: true, until: new Date(Date.now() - 1000).toISOString() }), /past/);
    assert.throws(() => oa.set({ per_hour: 1 }), /between/);
    quiet('  It closes itself at the end time; a past end time and a silly limit are refused');

    // 7. usage is counted, with no address stored
    const st = oa.stats();
    assert(st.calls >= 5 && st.visitors >= 1 && st.by_tool.find((t) => t.id === 'carbon').calls >= 5);
    const day = st.day, raw = fs.readFileSync(path.join(path.dirname(oa.FILE), `open-access-${day}.jsonl`), 'utf8');
    assert(!/127\.0\.0\.1/.test(raw), 'the visitor address is hashed, never written');
    quiet(`  Usage counted: ${st.calls} calls from ${st.visitors} visitor(s), addresses hashed`);
    quiet('\nAll Open Access Tests Passed!');
  } catch (e) {
    origLog('FAILED:', e && e.stack || e); process.exitCode = 1;
  } finally {
    restore();
    try { const d = oa.stats().day; fs.unlinkSync(path.join(path.dirname(oa.FILE), `open-access-${d}.jsonl`)); } catch (_) {}
    server.close(); setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
  }
});
