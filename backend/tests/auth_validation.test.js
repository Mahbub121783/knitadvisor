const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  validateSignup, validateLogin, validateIdentifier, validateForgotPassword, validateResetPassword,
  validateUsernameChange, usernameProblem, normalizeEmail, safeNextPath,
  PASSWORD_MIN, PASSWORD_MAX, USERNAME_MIN, USERNAME_MAX,
} = require('../engine/domain/auth-validation');
const { readCookie, hashToken, newToken, COOKIE_NAME } = require('../middleware/user-auth');
const { hashPassword, verifyPassword } = require('../middleware/password');

// A password meeting the real strength rule (>= PASSWORD_MIN chars, 3+ of
// lower/upper/digit/symbol) for test cases where the password itself isn't
// what's under test.
function strongPw(n) {
  const base = 'Aa1_';
  return (base + 'x'.repeat(Math.max(0, n - base.length))).slice(0, Math.max(n, base.length));
}
let usernameSeq = 0;
function uname() { return 'user' + (usernameSeq++); } // format-valid placeholder when the username itself isn't under test

console.log('--- Running Customer Auth Tests ---');

// ── Sign-up validation ──────────────────────────────────────────────────────
{
  const ok = validateSignup({ email: '  Mill@Example.COM ', username: 'rahim_uddin', password: 'correct-horse-9', full_name: ' Rahim Uddin ', company: ' ABC Knit ' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.value.email, 'mill@example.com', 'email is trimmed and lower-cased');
  assert.strictEqual(ok.value.username, 'rahim_uddin');
  assert.strictEqual(ok.value.full_name, 'Rahim Uddin');
  assert.strictEqual(ok.value.company, 'ABC Knit');

  assert.strictEqual(validateSignup({ email: 'a@b.co', username: uname(), password: strongPw(PASSWORD_MIN), full_name: 'Ab' }).value.company, null, 'company is optional');
  const planOf = (p) => validateSignup({ email: 'a@b.co', username: uname(), password: strongPw(PASSWORD_MIN), full_name: 'Ab', plan_interest: p }).value.plan_interest;
  assert.strictEqual(planOf('mill'), 'mill');
  assert.strictEqual(planOf('enterprise'), null, 'unknown plan is dropped, not rejected');
  assert.strictEqual(planOf(undefined), null);

  const bad = (over) => validateSignup({ email: 'a@b.co', username: uname(), password: strongPw(PASSWORD_MIN), full_name: 'Ab', ...over });
  assert.strictEqual(bad({ email: 'nope' }).ok, false, 'malformed email');
  assert.strictEqual(bad({ email: 'a@b' }).ok, false, 'email needs a dotted domain');
  assert.strictEqual(bad({ password: 'x'.repeat(PASSWORD_MIN - 1) }).ok, false, 'password too short');
  assert.strictEqual(bad({ password: 'x'.repeat(PASSWORD_MAX + 1) }).ok, false, 'password too long');
  assert.strictEqual(bad({ email: 'same.same.same@x.io', password: 'same.same.same@x.io' }).ok, false, 'password equal to email');
  assert.strictEqual(bad({ full_name: 'A' }).ok, false, 'name too short');
  assert.strictEqual(bad({ company: 'c'.repeat(161) }).ok, false, 'company too long');
  assert.strictEqual(bad({ username: 'ab' }).ok, false, 'username too short');
  assert.strictEqual(validateSignup(undefined).ok, false, 'no body');
  assert.strictEqual(validateSignup({ email: ['a@b.co'], username: uname(), password: 12345678901, full_name: 'Ab' }).ok, false, 'non-string password is rejected, not coerced');
  console.log('  Sign-up validation OK');
}

// ── Password strength — long is not enough, needs 3 of 4 character classes ──
{
  const bad = (pw) => validateSignup({ email: 'a@b.co', username: uname(), password: pw, full_name: 'Ab' });
  assert.strictEqual(bad('aaaaaaaaaa').ok, false, 'all-lowercase, 10 chars, still rejected');
  assert.strictEqual(bad('AAAAAAAAAA').ok, false, 'all-uppercase, 10 chars, still rejected');
  assert.strictEqual(bad('1234567890').ok, false, 'all-digits, 10 chars, still rejected');
  assert.strictEqual(bad('aaaaaaaaaA').ok, false, 'only 2 classes (lower+upper), still rejected');
  assert.strictEqual(bad('aaaaaaaaA1').ok, true, '3 classes (lower+upper+digit) is enough');
  assert.strictEqual(bad('aaaaaaaa-1').ok, true, '3 classes (lower+digit+symbol) is enough');
  assert.strictEqual(
    validateSignup({ email: 'a@b.co', username: uname(), password: 'aaaaaaaaaa', full_name: 'Ab' }).errors[0],
    'Password must include at least 3 of: lowercase letters, uppercase letters, numbers, symbols.'
  );
  console.log('  Password strength rule OK (3-of-4 character classes, not just length)');
}

// ── Username format ──────────────────────────────────────────────────────────
{
  assert.strictEqual(usernameProblem('rahim_uddin'), null);
  assert.strictEqual(usernameProblem('r.uddin99'), null);
  assert.strictEqual(usernameProblem('a'.repeat(USERNAME_MIN)), null, `exactly ${USERNAME_MIN} chars is enough`);
  assert.strictEqual(usernameProblem('a'.repeat(USERNAME_MAX)), null, `exactly ${USERNAME_MAX} chars is allowed`);
  assert(usernameProblem('a'.repeat(USERNAME_MIN - 1)), 'too short');
  assert(usernameProblem('a'.repeat(USERNAME_MAX + 1)), 'too long');
  assert(usernameProblem('bad name'), 'space not allowed');
  assert(usernameProblem('bad@name'), '@ not allowed — this is exactly what keeps identifiers unambiguous');
  assert(usernameProblem('_leading'), 'cannot start with an underscore');
  assert(usernameProblem('trailing.'), 'cannot end with a period');
  assert(usernameProblem('admin'), 'reserved name rejected');
  assert(usernameProblem('ADMIN'), 'reserved check is case-insensitive');
  assert(usernameProblem(''), 'empty rejected');
  assert(usernameProblem(null), 'non-string rejected');
  console.log('  Username format rule OK');
}

// ── Identifier resolution (login/forgot accept either email or username) ────
{
  const asEmail = validateIdentifier('  Mill@Example.COM ');
  assert.strictEqual(asEmail.ok, true);
  assert.strictEqual(asEmail.value.kind, 'email');
  assert.strictEqual(asEmail.value.identifier, 'mill@example.com');

  const asUsername = validateIdentifier('Rahim_Uddin');
  assert.strictEqual(asUsername.ok, true);
  assert.strictEqual(asUsername.value.kind, 'username');
  assert.strictEqual(asUsername.value.identifier, 'Rahim_Uddin', 'username case is preserved, only email is lower-cased');

  assert.strictEqual(validateIdentifier('').ok, false);
  assert.strictEqual(validateIdentifier('a@b').ok, false, 'has an @ so it is judged as an email, and a bad one');
  assert.strictEqual(validateIdentifier('ab').ok, false, 'too short to be a username');
  console.log('  Identifier (email-or-username) resolution OK');
}

// ── Sign-in validation ──────────────────────────────────────────────────────
{
  assert.strictEqual(validateLogin({ identifier: 'A@B.co', password: 'pw' }).value.identifier, 'a@b.co');
  assert.strictEqual(validateLogin({ identifier: 'rahim_uddin', password: 'pw' }).value.identifier, 'rahim_uddin', 'login by username works');
  assert.strictEqual(validateLogin({ email: 'a@b.co', password: 'pw' }).ok, true, 'legacy {email} body still accepted');
  assert.strictEqual(validateLogin({ identifier: '', password: 'pw' }).ok, false);
  assert.strictEqual(validateLogin({ identifier: 'a@b.co' }).ok, false);
  assert.strictEqual(validateLogin({ identifier: 'a@b.co', password: 'x'.repeat(PASSWORD_MAX + 1) }).ok, false, 'oversized password never reaches scrypt');
  assert.strictEqual(normalizeEmail(null), '');
  console.log('  Sign-in validation OK');
}

// ── Forgot-password / reset-password accept email or username ───────────────
{
  assert.strictEqual(validateForgotPassword({ identifier: 'rahim_uddin' }).ok, true);
  assert.strictEqual(validateForgotPassword({ email: 'a@b.co' }).ok, true, 'legacy {email} body still accepted');
  assert.strictEqual(validateForgotPassword({ identifier: '' }).ok, false);

  const okByUsername = validateResetPassword({ identifier: 'rahim_uddin', code: '123456', new_password: strongPw(PASSWORD_MIN) });
  assert.strictEqual(okByUsername.ok, true);
  assert.strictEqual(okByUsername.value.identifier, 'rahim_uddin');

  const okByEmail = validateResetPassword({ identifier: 'A@B.co', code: '123456', new_password: strongPw(PASSWORD_MIN) });
  assert.strictEqual(okByEmail.ok, true);
  assert.strictEqual(okByEmail.value.identifier, 'a@b.co');

  assert.strictEqual(validateResetPassword({ identifier: 'a@b.co', code: '12345', new_password: strongPw(PASSWORD_MIN) }).ok, false, 'bad code format');
  // The email-equality password rule only applies when the identifier IS the
  // email — a username can't be compared against a password meaningfully.
  assert.strictEqual(
    validateResetPassword({ identifier: 'same@same.io', code: '123456', new_password: 'same@same.io' }).ok, false,
    'password equal to the email identifier is still rejected'
  );
  console.log('  Forgot/reset-password identifier handling OK');
}

// ── Self-service username change ─────────────────────────────────────────────
{
  assert.strictEqual(validateUsernameChange({ username: ' new_handle ' }).value.username, 'new_handle');
  assert.strictEqual(validateUsernameChange({ username: 'ab' }).ok, false);
  assert.strictEqual(validateUsernameChange({}).ok, false);
  console.log('  Username-change validation OK');
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
