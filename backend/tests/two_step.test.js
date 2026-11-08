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
