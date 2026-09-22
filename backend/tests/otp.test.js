const assert = require('assert');
const { issueCode, hashCode, isValidCodeFormat, checkCode, CODE_LENGTH, MAX_ATTEMPTS } = require('../engine/domain/otp');
const { validateVerifyCode, validateResetPassword, validateEmailOnly } = require('../engine/domain/auth-validation');

console.log('--- Running One-Time Code Tests ---');

// ── issueCode ───────────────────────────────────────────────────────────────
{
  const a = issueCode();
  assert.strictEqual(a.code.length, CODE_LENGTH);
  assert(/^\d+$/.test(a.code), 'code must be digits only');
  assert.strictEqual(a.hash, hashCode(a.code));
  assert.notStrictEqual(a.hash, a.code, 'the hash must never equal the plaintext');
  assert(a.expiresAt instanceof Date && a.expiresAt.getTime() > Date.now());
  const b = issueCode();
  assert.notStrictEqual(a.code, b.code, 'two issued codes should not collide in a quick check (probabilistic, but 1e6 space)');
  console.log('  issueCode: 6 digits, hash != plaintext, future expiry');
}

// ── isValidCodeFormat ────────────────────────────────────────────────────────
{
  assert.strictEqual(isValidCodeFormat('123456'), true);
  assert.strictEqual(isValidCodeFormat('000000'), true);
  for (const bad of ['12345', '1234567', '12345a', '', null, undefined, 123456, ' 123456']) {
    assert.strictEqual(isValidCodeFormat(bad), false, `${JSON.stringify(bad)} must be rejected`);
  }
  console.log('  isValidCodeFormat rejects anything but exactly 6 digits');
}

// ── checkCode ────────────────────────────────────────────────────────────────
{
  const now = Date.now();
  const fresh = (code) => ({ code_hash: hashCode(code), attempts: 0, expires_at: new Date(now + 60000), consumed_at: null });

  assert.deepStrictEqual(checkCode('123456', null), { ok: false, reason: 'not_found' });

  const row = fresh('482913');
  assert.deepStrictEqual(checkCode('482913', row), { ok: true });
  assert.strictEqual(checkCode('482914', row).reason, 'mismatch');
  assert.strictEqual(checkCode('482913', { ...row, consumed_at: new Date() }).reason, 'consumed');
  assert.strictEqual(checkCode('482913', { ...row, expires_at: new Date(now - 1000) }).reason, 'expired');
  assert.strictEqual(checkCode('482913', { ...row, attempts: MAX_ATTEMPTS }).reason, 'too_many_attempts');
  assert.strictEqual(checkCode('not-a-code', row).reason, 'mismatch', 'a malformed guess must not throw or bypass the length compare');
  console.log('  checkCode: ok, mismatch, consumed, expired, and attempt-capped all distinguished');
}

// ── Route-facing validators built on top of otp.js ──────────────────────────
{
  assert.strictEqual(validateEmailOnly({ email: 'A@B.co' }).value.email, 'a@b.co');
  assert.strictEqual(validateEmailOnly({ email: 'nope' }).ok, false);

  const okVerify = validateVerifyCode({ email: 'A@B.co', code: '123456' });
  assert.strictEqual(okVerify.ok, true);
  assert.strictEqual(okVerify.value.email, 'a@b.co');
  assert.strictEqual(validateVerifyCode({ email: 'a@b.co', code: '12345' }).ok, false);
  assert.strictEqual(validateVerifyCode({ email: 'a@b.co', code: '123456; DROP TABLE' }).ok, false);

  const okReset = validateResetPassword({ email: 'a@b.co', code: '654321', new_password: 'a-good-long-password' });
  assert.strictEqual(okReset.ok, true);
  assert.strictEqual(validateResetPassword({ email: 'a@b.co', code: '654321', new_password: 'short' }).ok, false);
  assert.strictEqual(validateResetPassword({ email: 'a@b.co', code: 'abcdef', new_password: 'a-good-long-password' }).ok, false);
  console.log('  validateVerifyCode / validateResetPassword / validateEmailOnly OK');
}

console.log('\nAll One-Time Code Tests Passed!');
