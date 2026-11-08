/**
 * Authenticator-app codes (TOTP, RFC 6238: HMAC-SHA1, 30 s steps, 6 digits) —
 * the same codes Google Authenticator, Microsoft Authenticator and Authy show.
 * Pure Node crypto, no dependency.
 *
 * The shared secret is stored encrypted (AES-256-GCM). The key is derived from
 * API_KEY_ENCRYPTION_SECRET with its own salt, so a database read alone never
 * yields a secret that could mint codes.
 */
const crypto = require('crypto');

const STEP = 30, DIGITS = 6, WINDOW = 1;   // accept the step before and after: clocks drift
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const s = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function newSecret() { return base32Encode(crypto.randomBytes(20)); }

function codeAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * @returns {number|null} the time step the code matched (store it as
 *   totp_last_step so the same code cannot be used again), or null.
 */
function verify(secret, code, lastStep = null, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const t = Math.floor(now / 1000 / STEP);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = t + d;
    if (lastStep != null && step <= lastStep) continue;
    const a = Buffer.from(codeAt(secret, step)), b = Buffer.from(String(code));
    if (crypto.timingSafeEqual(a, b)) return step;
  }
  return null;
}

function otpauthUri(secret, account, issuer = 'KnitAdvisor') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
}

let key = null;
function cipherKey() {
  if (key) return key;
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) throw new Error('API_KEY_ENCRYPTION_SECRET is missing — two-step secrets cannot be stored.');
  key = crypto.scryptSync(secret, 'knitadvisor-totp-v1', 32);
  return key;
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

function open(sealed) {
  const [v, iv, tag, enc] = String(sealed || '').split('.');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

module.exports = { newSecret, codeAt, verify, otpauthUri, seal, open, base32Encode, base32Decode, STEP };
