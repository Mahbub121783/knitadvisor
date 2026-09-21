const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  validateSignup, validateLogin, normalizeEmail, safeNextPath, PASSWORD_MIN, PASSWORD_MAX,
} = require('../engine/domain/auth-validation');
const { readCookie, hashToken, newToken, COOKIE_NAME } = require('../middleware/user-auth');
const { hashPassword, verifyPassword } = require('../middleware/password');

console.log('--- Running Customer Auth Tests ---');

// ── Sign-up validation ──────────────────────────────────────────────────────
{
  const ok = validateSignup({ email: '  Mill@Example.COM ', password: 'correct-horse-9', full_name: ' Rahim Uddin ', company: ' ABC Knit ' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.value.email, 'mill@example.com', 'email is trimmed and lower-cased');
  assert.strictEqual(ok.value.full_name, 'Rahim Uddin');
  assert.strictEqual(ok.value.company, 'ABC Knit');

  assert.strictEqual(validateSignup({ email: 'a@b.co', password: 'x'.repeat(PASSWORD_MIN), full_name: 'Ab' }).value.company, null, 'company is optional');
  const planOf = (p) => validateSignup({ email: 'a@b.co', password: 'x'.repeat(PASSWORD_MIN), full_name: 'Ab', plan_interest: p }).value.plan_interest;
  assert.strictEqual(planOf('mill'), 'mill');
  assert.strictEqual(planOf('enterprise'), null, 'unknown plan is dropped, not rejected');
  assert.strictEqual(planOf(undefined), null);

  const bad = (over) => validateSignup({ email: 'a@b.co', password: 'x'.repeat(PASSWORD_MIN), full_name: 'Ab', ...over });
  assert.strictEqual(bad({ email: 'nope' }).ok, false, 'malformed email');
  assert.strictEqual(bad({ email: 'a@b' }).ok, false, 'email needs a dotted domain');
  assert.strictEqual(bad({ password: 'x'.repeat(PASSWORD_MIN - 1) }).ok, false, 'password too short');
  assert.strictEqual(bad({ password: 'x'.repeat(PASSWORD_MAX + 1) }).ok, false, 'password too long');
  assert.strictEqual(bad({ email: 'same.same.same@x.io', password: 'same.same.same@x.io' }).ok, false, 'password equal to email');
  assert.strictEqual(bad({ full_name: 'A' }).ok, false, 'name too short');
  assert.strictEqual(bad({ company: 'c'.repeat(161) }).ok, false, 'company too long');
  assert.strictEqual(validateSignup(undefined).ok, false, 'no body');
  assert.strictEqual(validateSignup({ email: ['a@b.co'], password: 12345678901, full_name: 'Ab' }).ok, false, 'non-string password is rejected, not coerced');
  console.log('  Sign-up validation OK');
}

// ── Sign-in validation ──────────────────────────────────────────────────────
{
  assert.strictEqual(validateLogin({ email: 'A@B.co', password: 'pw' }).value.email, 'a@b.co');
  assert.strictEqual(validateLogin({ email: '', password: 'pw' }).ok, false);
  assert.strictEqual(validateLogin({ email: 'a@b.co' }).ok, false);
  assert.strictEqual(validateLogin({ email: 'a@b.co', password: 'x'.repeat(PASSWORD_MAX + 1) }).ok, false, 'oversized password never reaches scrypt');
  assert.strictEqual(normalizeEmail(null), '');
  console.log('  Sign-in validation OK');
}

// ── Open-redirect guard ─────────────────────────────────────────────────────
{
  assert.strictEqual(safeNextPath('/result.html'), '/result.html');
  assert.strictEqual(safeNextPath('/app.html?recalc=1'), '/app.html?recalc=1');
  for (const evil of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/\\evil.example', '', null, undefined, '/a b', '/x?y=<script>']) {
    assert.strictEqual(safeNextPath(evil), '/app.html', `${JSON.stringify(evil)} must fall back to the default`);
  }
  console.log('  next-path redirect guard OK');
}

// ── Cookie + token plumbing ─────────────────────────────────────────────────
{
  assert.strictEqual(readCookie(`a=1; ${COOKIE_NAME}=abc123; b=2`, COOKIE_NAME), 'abc123');
  assert.strictEqual(readCookie('a=1', COOKIE_NAME), null);
  assert.strictEqual(readCookie(undefined, COOKIE_NAME), null);
  assert.strictEqual(readCookie(`${COOKIE_NAME}=%E0%A4%A`, COOKIE_NAME), null, 'malformed escape must not throw');
  assert.strictEqual(readCookie(`x${COOKIE_NAME}=nope`, COOKIE_NAME), null, 'a cookie whose name merely ends the same is not ours');

  const { rawToken, tokenHash } = newToken();
  assert.strictEqual(rawToken.length, 64);
  assert.strictEqual(tokenHash, hashToken(rawToken));
  assert.notStrictEqual(tokenHash, rawToken, 'only the hash is stored');
  assert.notStrictEqual(newToken().rawToken, rawToken, 'tokens are random');
  console.log('  Cookie/token helpers OK');
}

// ── Password hashing round-trip (the format the DB CHECK requires) ──────────
{
  const h = hashPassword('a-long-enough-password');
  assert(h.startsWith('scrypt$'), 'app_users.password_hash CHECK requires the scrypt$ prefix');
  assert.strictEqual(verifyPassword('a-long-enough-password', h), true);
  assert.strictEqual(verifyPassword('a-long-enough-passworD', h), false);
  console.log('  Password hash format OK');
}

// ── The gate covers the engine and only the engine ──────────────────────────
// Derived from routes/api.js so a new engine endpoint added without
// requireUser fails here instead of silently shipping open.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'api.js'), 'utf8');
  const routes = [...src.matchAll(/router\.(get|post)\(\s*'([^']+)'([^\n]*)/g)]
    .map(m => ({ path: m[2], gated: /requireUser/.test(m[3]) }));

  const MUST_BE_GATED = ['/calculate', '/striper', '/quality', '/cost', '/garment-costing',
    '/fabric-consumption', '/techpack/generate', '/woven/calculate', '/parse'];
  for (const p of MUST_BE_GATED) {
    const r = routes.find(x => x.path === p);
    assert(r, `${p} not found in routes/api.js — did the route move?`);
    assert(r.gated, `${p} runs the calculation engine and must sit behind requireUser`);
  }
  const MUST_STAY_PUBLIC = ['/convert', '/fabrics', '/dyeing/recipes', '/academy/content', '/color/popular'];
  for (const p of MUST_STAY_PUBLIC) {
    const r = routes.find(x => x.path === p);
    assert(r, `${p} not found in routes/api.js`);
    assert(!r.gated, `${p} is a public reference tool and must not require sign-in`);
  }
  console.log(`  Engine gate verified across ${routes.length} routes in api.js`);
}

console.log('\nAll Customer Auth Tests Passed!');
