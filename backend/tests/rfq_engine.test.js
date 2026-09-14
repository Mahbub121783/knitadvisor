const assert = require('assert');
const {
  generateReferenceCode, validateBuyer, validateLineItem, validateRfqSubmission,
  isValidStatus, REF_CODE_ALPHABET, MAX_LINE_ITEMS,
} = require('../engine/domain/rfq-engine');

console.log('--- Running RFQ Engine Tests ---');

// ============================================================================
// 1. Reference code generation — correct shape, no ambiguous characters,
//    and actually random (not the same code twice in a row by construction).
// ============================================================================
{
  const codes = new Set();
  for (let i = 0; i < 200; i++) codes.add(generateReferenceCode());
  assert.strictEqual(codes.size, 200, '200 generated codes should all be unique (collision probability is astronomically low at this alphabet/length)');
  for (const code of codes) {
    assert.match(code, /^RFQ-[A-Z0-9]{6}$/, `Code "${code}" should match RFQ-XXXXXX shape`);
    for (const ch of code.replace('RFQ-', '')) {
      assert(REF_CODE_ALPHABET.includes(ch), `Character "${ch}" should be from the ambiguity-free alphabet`);
    }
    assert(!/[0O1IL]/.test(code.replace('RFQ-', '')), `Code "${code}" should never contain visually-ambiguous 0/O/1/I/L`);
  }
  console.log('  Reference codes: correct shape, unique, no ambiguous characters');
}

// ============================================================================
// 2. Buyer validation.
// ============================================================================
{
  assert.strictEqual(validateBuyer({ buyer_name: 'A', buyer_email: 'a@b.com' }).ok, false, 'Name under 2 chars should fail');
  assert.strictEqual(validateBuyer({ buyer_name: 'Jane Doe', buyer_email: 'not-an-email' }).ok, false, 'Malformed email should fail');
  assert.strictEqual(validateBuyer({ buyer_name: 'Jane Doe', buyer_email: 'jane@buyer.com' }).ok, true);
  assert.strictEqual(validateBuyer({ buyer_name: 'Jane Doe', buyer_email: 'jane@buyer.com', message: 'x'.repeat(2001) }).ok, false, 'Over-length message should fail');
  console.log('  Buyer validation OK');
}

// ============================================================================
// 3. Line item validation.
// ============================================================================
{
  assert.strictEqual(validateLineItem({ fabric_id: 'single_jersey', gsm: 180 }, 0).ok, true);
  assert.strictEqual(validateLineItem({ gsm: 180 }, 0).ok, false, 'Missing fabric_id should fail');
  assert.strictEqual(validateLineItem({ fabric_id: 'single_jersey', gsm: 30 }, 0).ok, false, 'GSM below 60 should fail');
  assert.strictEqual(validateLineItem({ fabric_id: 'single_jersey', gsm: 180, order_quantity: -5 }, 0).ok, false, 'Negative order_quantity should fail');
  assert.strictEqual(validateLineItem({ fabric_id: 'single_jersey', gsm: 180, target_price_usd: -1 }, 0).ok, false, 'Negative target_price_usd should fail');
  assert.strictEqual(validateLineItem({ fabric_id: 'single_jersey', gsm: 180, target_price_usd: 0 }, 0).ok, true, 'Zero target_price_usd should be allowed (buyer with no fixed target)');
  console.log('  Line item validation OK');
}

// ============================================================================
// 4. Full submission validation — buyer + line items combined, item-count bounds.
// ============================================================================
{
  const good = validateRfqSubmission({
    buyer_name: 'Jane Doe', buyer_email: 'jane@buyer.com',
    line_items: [{ fabric_id: 'single_jersey', gsm: 180 }],
  });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.line_item_count, 1);

  const noItems = validateRfqSubmission({ buyer_name: 'Jane Doe', buyer_email: 'jane@buyer.com', line_items: [] });
  assert.strictEqual(noItems.ok, false);
  assert(noItems.errors.some(e => /at least one line item/i.test(e)));

  const tooMany = validateRfqSubmission({
    buyer_name: 'Jane Doe', buyer_email: 'jane@buyer.com',
    line_items: Array.from({ length: MAX_LINE_ITEMS + 1 }, () => ({ fabric_id: 'single_jersey', gsm: 180 })),
  });
  assert.strictEqual(tooMany.ok, false);
  assert(tooMany.errors.some(e => /too many line items/i.test(e)));

  const mixedBad = validateRfqSubmission({
    buyer_name: 'Jane Doe', buyer_email: 'jane@buyer.com',
    line_items: [{ fabric_id: 'single_jersey', gsm: 180 }, { fabric_id: 'interlock', gsm: 10 }],
  });
  assert.strictEqual(mixedBad.ok, false, 'One bad line item among good ones should fail the whole submission');
  assert(mixedBad.errors.some(e => e.startsWith('Line 2:')), 'Error should be attributable to the specific failing line');

  console.log('  Full submission validation OK (item-count bounds, per-line attribution)');
}

// ============================================================================
// 5. Status validation.
// ============================================================================
{
  assert.strictEqual(isValidStatus('pending'), true);
  assert.strictEqual(isValidStatus('quoted'), true);
  assert.strictEqual(isValidStatus('made_up_status'), false);
  console.log('  Status validation OK');
}

console.log('\nAll RFQ Engine Tests Passed!');
