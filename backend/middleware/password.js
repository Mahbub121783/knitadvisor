/**
 * Admin password hashing.
 *
 * Passwords were previously stored as bare SHA-256 with no salt. SHA-256 is a
 * fast hash built for throughput, which is exactly the wrong property here: a
 * commodity GPU tries billions of candidates per second, and without a salt one
 * rainbow table covers every account at once. scrypt is memory-hard and salted
 * per password, so each guess costs real RAM and no work carries between users.
 *
 * Node ships scrypt in core, so this needs no dependency (bcrypt/argon2 would
 * pull in a native build step that cPanel's Node venv makes awkward to install).
 *
 * Stored format:  scrypt$<N>$<saltHex>$<hashHex>
 * Legacy format:  <64 hex chars>            (unsalted SHA-256)
 *
 * verifyPassword() still accepts the legacy format so nobody is locked out on
 * deploy; callers should upgrade the row on a successful legacy login.
 */
const crypto = require('crypto');

const SCRYPT_COST = 16384; // N — ~16 MB per hash, ~50-100 ms
const KEY_LEN = 32;
const SALT_LEN = 16;

function hashPassword(plaintext) {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(plaintext, salt, KEY_LEN, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function isLegacyHash(stored) {
  return typeof stored === 'string' && /^[0-9a-f]{64}$/i.test(stored);
}

function verifyPassword(plaintext, stored) {
  if (!stored || typeof stored !== 'string') return false;

  if (isLegacyHash(stored)) {
    const legacy = crypto.createHash('sha256').update(plaintext).digest('hex');
    return timingSafeEqualHex(legacy, stored);
  }

  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = parseInt(parts[1], 10);
  if (!Number.isFinite(cost) || cost < 1024) return false;

  let salt, expected;
  try {
    salt = Buffer.from(parts[2], 'hex');
    expected = Buffer.from(parts[3], 'hex');
  } catch { return false; }
  if (!salt.length || expected.length !== KEY_LEN) return false;

  const actual = crypto.scryptSync(plaintext, salt, KEY_LEN, { N: cost });
  return crypto.timingSafeEqual(actual, expected);
}

// Both sides are fixed-width hex here, but compare through timingSafeEqual so a
// wrong password can't be narrowed down byte by byte from response timing.
function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function generatePassword(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = { hashPassword, verifyPassword, isLegacyHash, generatePassword };
