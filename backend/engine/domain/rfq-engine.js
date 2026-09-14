/**
 * KnitAdvisor — RFQ (Request For Quotation) engine
 * ===================================================
 *
 * Pure validation + reference-code generation — no DB, no network, so the
 * submission-shape rules (what makes a buyer/line-item valid) are testable
 * on their own, same split as every other domain engine in this app.
 * Pricing itself is NOT computed here — the route calls the existing
 * calculate() + garment-costing engines per line item and freezes their
 * output; this file only decides whether a submission is well-formed enough
 * to attempt that.
 */

const crypto = require('crypto');

// Excludes visually-ambiguous characters (0/O, 1/I/L) — this code gets read
// aloud over the phone and typed back in by a buyer with no autocomplete.
const REF_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REF_CODE_LENGTH = 6;

const MAX_LINE_ITEMS = 20;
const MAX_MESSAGE_LENGTH = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateReferenceCode() {
  let code = 'RFQ-';
  for (let i = 0; i < REF_CODE_LENGTH; i++) {
    code += REF_CODE_ALPHABET[crypto.randomInt(REF_CODE_ALPHABET.length)];
  }
  return code;
}

function validateBuyer(buyer) {
  const errors = [];
  const name = (buyer?.buyer_name || '').trim();
  const email = (buyer?.buyer_email || '').trim();

  if (name.length < 2) errors.push('buyer_name is required (minimum 2 characters).');
  if (name.length > 200) errors.push('buyer_name is too long (maximum 200 characters).');
  if (!EMAIL_RE.test(email)) errors.push('buyer_email must be a valid email address.');
  if (buyer?.message && String(buyer.message).length > MAX_MESSAGE_LENGTH) {
    errors.push(`message is too long (maximum ${MAX_MESSAGE_LENGTH} characters).`);
  }
  if (buyer?.buyer_company && String(buyer.buyer_company).length > 200) errors.push('buyer_company is too long (maximum 200 characters).');
  if (buyer?.buyer_country && String(buyer.buyer_country).length > 100) errors.push('buyer_country is too long (maximum 100 characters).');
  if (buyer?.buyer_phone && String(buyer.buyer_phone).length > 40) errors.push('buyer_phone is too long (maximum 40 characters).');

  return { ok: errors.length === 0, errors };
}

function validateLineItem(item, index) {
  const errors = [];
  const label = `Line ${index + 1}`;

  if (!item || typeof item !== 'object') {
    return { ok: false, errors: [`${label}: must be an object.`] };
  }
  if (!item.fabric_id || typeof item.fabric_id !== 'string') errors.push(`${label}: fabric_id is required.`);

  const gsm = parseFloat(item.gsm);
  if (!Number.isFinite(gsm) || gsm < 60 || gsm > 500) errors.push(`${label}: gsm must be a number between 60 and 500.`);

  if (item.order_quantity != null) {
    const qty = parseInt(item.order_quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) errors.push(`${label}: order_quantity must be a positive whole number.`);
  }
  if (item.garment_weight_g != null) {
    const w = parseFloat(item.garment_weight_g);
    if (!Number.isFinite(w) || w <= 0) errors.push(`${label}: garment_weight_g must be a positive number.`);
  }
  if (item.target_price_usd != null) {
    const p = parseFloat(item.target_price_usd);
    if (!Number.isFinite(p) || p < 0) errors.push(`${label}: target_price_usd must be zero or a positive number.`);
  }
  if (item.composition && String(item.composition).length > 200) errors.push(`${label}: composition is too long (maximum 200 characters).`);

  return { ok: errors.length === 0, errors };
}

/** @param {object} body — { buyer_name, buyer_email, buyer_company?, buyer_country?, buyer_phone?, message?, line_items: [...] } */
function validateRfqSubmission(body) {
  const errors = [];
  const buyerCheck = validateBuyer(body || {});
  errors.push(...buyerCheck.errors);

  const lineItems = Array.isArray(body?.line_items) ? body.line_items : [];
  if (lineItems.length === 0) errors.push('At least one line item is required.');
  if (lineItems.length > MAX_LINE_ITEMS) errors.push(`Too many line items (maximum ${MAX_LINE_ITEMS}).`);

  lineItems.slice(0, MAX_LINE_ITEMS).forEach((item, i) => {
    const check = validateLineItem(item, i);
    errors.push(...check.errors);
  });

  return { ok: errors.length === 0, errors, line_item_count: lineItems.length };
}

const VALID_STATUSES = ['pending', 'under_review', 'quoted', 'accepted', 'rejected', 'expired'];

function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

module.exports = {
  generateReferenceCode,
  validateBuyer,
  validateLineItem,
  validateRfqSubmission,
  isValidStatus,
  VALID_STATUSES,
  REF_CODE_ALPHABET,
  REF_CODE_LENGTH,
  MAX_LINE_ITEMS,
  MAX_MESSAGE_LENGTH,
};
