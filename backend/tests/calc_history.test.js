const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildHistoryEntry, stableStringify } = require('../engine/domain/calc-history');
const { ENGINE_INPUTS, calculate } = require('../engine/index');
const { validateProfile, validatePasswordChange } = require('../engine/domain/auth-validation');

console.log('--- Running Calculation History Tests ---');

// ── Same inputs, any key order, one identity ───────────────────────────────
{
  assert.strictEqual(stableStringify({ b: 2, a: { d: 4, c: 3 } }), stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
  const result = calculate({ fabric: 'single_jersey', gsm: 180, composition: '100% Cotton' });
  assert(result.success, 'engine result needed for the entry');

  const a = buildHistoryEntry(ENGINE_INPUTS, { fabric: 'single_jersey', gsm: 180, composition: '100% Cotton' }, result);
  const b = buildHistoryEntry(ENGINE_INPUTS, { composition: '100% Cotton', gsm: '180', fabric: 'single_jersey' }, result);
  assert.strictEqual(a.params_hash, b.params_hash, 'key order and "180" vs 180 must not create a second row');
  const c = buildHistoryEntry(ENGINE_INPUTS, { fabric: 'single_jersey', gsm: 181, composition: '100% Cotton' }, result);
  assert.notStrictEqual(a.params_hash, c.params_hash, 'a different GSM is a different calculation');
  console.log('  Identity: order-insensitive, value-sensitive');
}

// ── Only the engine's own inputs are kept ───────────────────────────────────
{
  const result = calculate({ fabric: 'single_jersey', gsm: 180 });
  const e = buildHistoryEntry(ENGINE_INPUTS, {
    fabric: 'single_jersey', gsm: 180, evil_field: 'x', live_prices: () => 1, composition: '',
  }, result);
  assert(!('evil_field' in e.params), 'unknown request fields must not be stored');
  assert(!('live_prices' in e.params), 'functions are never stored');
  assert(!('composition' in e.params), 'empty strings are dropped');
  assert.strictEqual(e.fabric_id, 'single_jersey');
  assert.strictEqual(e.gsm, 180);
  console.log('  Stores only whitelisted engine inputs');
}

// ── Summary is read from the real result shape, never invented ─────────────
{
  const body = { fabric: 'single_jersey', gsm: 180, composition: '100% Cotton', dia: 30, gauge: 24, rpm: 28 };
  const result = calculate(body);
  const e = buildHistoryEntry(ENGINE_INPUTS, body, result);
  assert.strictEqual(e.fabric_name, result.fabric.name);
  assert.strictEqual(e.summary.yarn_count, result.yarn.count_display);
  assert.strictEqual(e.summary.fabric_price_usd_per_kg, result.costing.total_per_kg_usd);
  assert.strictEqual(e.summary.kg_per_day, result.production.kg_per_day);
  assert.strictEqual(e.summary.loop_length_mm, result.loop_length.value_mm);
  assert(!('fob_usd' in e.summary), 'no garment inputs -> no FOB figure is fabricated');
  console.log('  Summary figures match the engine result exactly; absent ones are omitted');
}

// ── Nothing worth keeping -> null ──────────────────────────────────────────
{
  const result = calculate({ fabric: 'single_jersey', gsm: 180 });
  assert.strictEqual(buildHistoryEntry(ENGINE_INPUTS, { gsm: 180 }, result), null, 'no fabric');
  assert.strictEqual(buildHistoryEntry(ENGINE_INPUTS, { fabric: 'single_jersey', gsm: 0 }, result), null, 'no gsm');
  assert.strictEqual(buildHistoryEntry(ENGINE_INPUTS, { fabric: 'single_jersey', gsm: 180 }, { error: 'x' }), null, 'failed result');
  assert.strictEqual(buildHistoryEntry(ENGINE_INPUTS, null, result), null);
  console.log('  Unkeepable requests return null');
}

// ── Profile and password rules ─────────────────────────────────────────────
{
  assert.strictEqual(validateProfile({ full_name: ' Ab ', company: '' }).value.company, null);
  assert.strictEqual(validateProfile({ full_name: 'A' }).ok, false);
  assert.strictEqual(validateProfile({ full_name: 'Ab', company: 'c'.repeat(161) }).ok, false);

  const ok = validatePasswordChange({ current_password: 'old-password-1', new_password: 'new-password-22' }, 'a@b.co');
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(validatePasswordChange({ new_password: 'new-password-22' }, 'a@b.co').ok, false, 'current password required');
  assert.strictEqual(validatePasswordChange({ current_password: 'x', new_password: 'short' }, 'a@b.co').ok, false);
  assert.strictEqual(validatePasswordChange({ current_password: 'same-password-1', new_password: 'same-password-1' }, 'a@b.co').ok, false, 'must differ from current');
  assert.strictEqual(validatePasswordChange({ current_password: 'x', new_password: 'a@b.co' }, 'a@b.co').ok, false);
  console.log('  Profile and password-change rules OK');
}

// ── Every account route sits behind the gate ───────────────────────────────
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'account.js'), 'utf8');
  const useAt = src.indexOf('router.use(requireUser)');
  assert(useAt > -1, 'account router must apply requireUser to everything');
  const firstRoute = src.search(/router\.(get|post|patch|delete)\(/);
  assert(useAt < firstRoute, 'requireUser must be registered before the first route');
  assert(!/req\.(params|body|query)\.(user_?id|userId)/i.test(src), 'no route may take a user id from the request');
  console.log('  Account routes: gated, and keyed to req.user.id only');
}

console.log('\nAll Calculation History Tests Passed!');
