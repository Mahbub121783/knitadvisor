// Sign-in: a code only with two-step on; authenticator codes; code mails.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
console.log('--- Running Two-Step Sign-in Tests ---');

process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || 'test-secret-for-two-step-only';
const totp = require('../engine/domain/totp');

// RFC 6238 test vector (SHA-1 secret "12345678901234567890", T = 59 s → 94287082)
const rfc = totp.base32Encode(Buffer.from('12345678901234567890'));
assert.strictEqual(totp.codeAt(rfc, 1), '287082');
assert.strictEqual(totp.codeAt(rfc, Math.floor(1111111109 / 30)), '081804');

// a fresh secret: the current code passes, a neighbouring step passes (clock
// drift), an old step and a replay do not, junk does not
{
  const s = totp.newSecret(), now = 1_700_000_000_000, t = Math.floor(now / 30000);
  assert.strictEqual(totp.verify(s, totp.codeAt(s, t), null, now), t);
  assert.strictEqual(totp.verify(s, totp.codeAt(s, t - 1), null, now), t - 1);
  assert.strictEqual(totp.verify(s, totp.codeAt(s, t - 3), null, now), null);
  assert.strictEqual(totp.verify(s, totp.codeAt(s, t), t, now), null, 'the same code twice is refused');
  assert.strictEqual(totp.verify(s, '12a456', null, now), null);
  // the stored form is sealed, and opens back to the same secret
  const sealed = totp.seal(s);
  assert(!sealed.includes(s) && totp.open(sealed) === s);
  assert(/^otpauth:\/\/totp\/KnitAdvisor%3Aa%40b\.com\?secret=[A-Z2-7]+&issuer=KnitAdvisor/.test(totp.otpauthUri(s, 'a@b.com')));
}

// code mails: the code in the subject, a written plain-text part, a whole HTML document
{
  const t = require('../mail/templates');
  for (const fn of ['activationEmail', 'passwordResetEmail', 'loginCodeEmail', 'studentEmailCodeEmail']) {
    const m = t[fn]({ fullName: 'Rahim', code: '042317' });
    assert(m.subject.startsWith('042317 '), `${fn}: code first in the subject`);
    assert(m.text.includes('042317') && m.text.includes('Hi Rahim'), `${fn}: plain-text part`);
    assert(/^<!doctype html>/.test(m.html) && m.html.includes('charset="utf-8"'), `${fn}: full document`);
  }
}

// sign-in rules, read from the route: an unverified email no longer blocks a
// password sign-in, and a code is only asked when two_factor is on
{
  const src = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  const login = src.slice(src.indexOf("router.post('/login'"), src.indexOf("router.post('/forgot-password'"));
  assert(!/EMAIL_NOT_VERIFIED/.test(login), 'login does not send unverified accounts to the code screen');
  assert(/two_factor \|\| 'off'/.test(login) && /if \(mode !== 'off'\)/.test(login), 'code only when two-step is on');
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/036_two_step.sql'), 'utf8');
  assert(/two_factor IN \('off', 'email', 'app'\)/.test(sql) && /'login'\)/.test(sql));
}

// code mails go out in the background: the response does not wait on SMTP
{
  const src = fs.readFileSync(path.join(__dirname, '../services/account-codes.js'), 'utf8');
  assert(/if \(opts\.wait\) return delivery;/.test(src));
}
console.log('Two-step sign-in tests passed');

// account security: guessable passwords refused, lockout, CSRF, devices, alerts
{
  const v = require('../engine/domain/auth-validation');
  const signup = (pw) => v.validateSignup({ email: 'rahim.uddin@mill.com', username: 'rahimu', password: pw, full_name: 'Rahim' });
  for (const pw of ['Password@123', 'Knitadvisor2026!', 'Qwerty#12345', 'Rahim.uddin#2026x']) assert(!signup(pw).ok, `${pw} refused`);
  for (const pw of ['Tr0ub4dor&3horse', 'Mill-Cotton-2026']) assert(signup(pw).ok, `${pw} accepted`);

  const repo = fs.readFileSync(path.join(__dirname, '../db/repositories/user-repo.js'), 'utf8');
  assert(/LOCK_AFTER = 8/.test(repo) && /locked_until = CASE WHEN failed_logins \+ 1 >= \$2/.test(repo), 'per-account lock');
  const auth = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  assert(/row\.locked_until && new Date\(row\.locked_until\) > new Date\(\)/.test(auth), 'a locked account stays locked for the right password');
  assert((auth.match(/wrongAttempt\(row, req/g) || []).length >= 3, 'wrong password, email code and app code all count');
  assert(/alertIfNewDevice/.test(fs.readFileSync(path.join(__dirname, '../services/security.js'), 'utf8')));
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(/did not come from KnitAdvisor/.test(server), 'cross-site state-changing API calls refused');
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/037_account_security.sql'), 'utf8');
  assert(/CREATE TABLE app_security_events/.test(sql) && /'email_change'\)/.test(sql));

  const t = require('../mail/templates');
  for (const fn of ['newSignInEmail', 'accountLockedEmail', 'emailChangedSelfEmail', 'accountDeletedEmail']) {
    const m = t[fn]({ fullName: 'R', device: 'Chrome on Windows', ip: '1.2.3.4', when: 'now', minutes: 15, newEmail: 'x@y.com' });
    assert(/never ask for your password/.test(m.text) && /never ask for your password/.test(m.html), `${fn}: anti-phishing line`);
  }
  const sec = require('../services/security');
  assert.strictEqual(sec.deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'), 'Chrome on Windows');
  assert.strictEqual(sec.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone / iPad');
}
console.log('Account security tests passed');
