/**
 * One-time codes for email activation and password reset — pure, no I/O.
 *
 * A 6-digit code is generated with crypto.randomInt (not Math.random, which
 * is not cryptographically strong) and only its SHA-256 hash is ever meant to
 * reach the database — this module produces both from one call so a caller
 * cannot accidentally persist the plaintext.
 */
const crypto = require('crypto');

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;

function generateCode() {
  return crypto.randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/** @returns {{code: string, hash: string, expiresAt: Date}} */
function issueCode() {
  const code = generateCode();
  return { code, hash: hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000) };
}

/** Only digits, exactly CODE_LENGTH of them — rejects anything else before it reaches a DB compare. */
function isValidCodeFormat(input) {
  return typeof input === 'string' && new RegExp(`^\\d{${CODE_LENGTH}}$`).test(input);
}

/**
 * @param {string} submitted   the code the user typed
 * @param {{code_hash, attempts, expires_at, consumed_at}} row  the stored row, or null
 * @returns {{ok: boolean, reason?: 'not_found'|'consumed'|'expired'|'too_many_attempts'|'mismatch'}}
 */
function checkCode(submitted, row) {
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.consumed_at) return { ok: false, reason: 'consumed' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  if (!isValidCodeFormat(submitted)) return { ok: false, reason: 'mismatch' };

  const a = Buffer.from(hashCode(submitted), 'hex');
  const b = Buffer.from(row.code_hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

module.exports = { issueCode, hashCode, isValidCodeFormat, checkCode, CODE_LENGTH, CODE_TTL_MINUTES, MAX_ATTEMPTS };
