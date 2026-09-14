/**
 * RFQ (Request For Quotation) repository.
 */
const { query, queryOne, transaction } = require('../client');

/**
 * Creates an RFQ + its line items in one transaction. `lineItems` must
 * already carry their computed reference_fabric_price_usd/
 * reference_fob_price_usd/reference_calc_snapshot — this repo only persists,
 * it never calls the calculation engines itself (see routes/rfq.js).
 */
async function create({ referenceCode, buyer, lineItems, ipHash }) {
  return transaction(async (txQuery) => {
    // transaction()'s callback receives a (text, params) -> rows[] function,
    // already unwrapped from the raw pg client — not a client with .query()
    // returning {rows: [...]}. See db/client.js's transaction().
    const [rfqRow] = await txQuery(
      `INSERT INTO rfq_requests
         (reference_code, buyer_name, buyer_email, buyer_company, buyer_country, buyer_phone, message, ip_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, reference_code, created_at`,
      [
        referenceCode,
        buyer.buyer_name.trim(),
        buyer.buyer_email.trim(),
        buyer.buyer_company?.trim() || null,
        buyer.buyer_country?.trim() || null,
        buyer.buyer_phone?.trim() || null,
        buyer.message?.trim() || null,
        ipHash || null,
      ]
    );
    const rfqId = rfqRow.id;

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      await txQuery(
        `INSERT INTO rfq_line_items
           (rfq_id, line_number, fabric_id, fabric_name, gsm, composition, garment_type,
            garment_weight_g, order_quantity, target_price_usd,
            reference_fabric_price_usd, reference_fob_price_usd, reference_calc_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          rfqId, i + 1, item.fabric_id, item.fabric_name, item.gsm, item.composition || null,
          item.garment_type || null, item.garment_weight_g || null, item.order_quantity || null,
          item.target_price_usd ?? null,
          item.reference_fabric_price_usd ?? null, item.reference_fob_price_usd ?? null,
          item.reference_calc_snapshot ? JSON.stringify(item.reference_calc_snapshot) : null,
        ]
      );
    }

    return rfqRow;
  });
}

async function getByReferenceCode(referenceCode) {
  const rfq = await queryOne('SELECT * FROM rfq_requests WHERE reference_code = $1', [referenceCode]);
  if (!rfq) return null;
  const lineItems = await query('SELECT * FROM rfq_line_items WHERE rfq_id = $1 ORDER BY line_number', [rfq.id]);
  return { ...rfq, line_items: lineItems };
}

async function getById(id) {
  const rfq = await queryOne('SELECT * FROM rfq_requests WHERE id = $1', [id]);
  if (!rfq) return null;
  const lineItems = await query('SELECT * FROM rfq_line_items WHERE rfq_id = $1 ORDER BY line_number', [rfq.id]);
  return { ...rfq, line_items: lineItems };
}

/** Paged listing for the admin panel. */
async function list({ page = 1, limit = 25, status, search } = {}) {
  const where = [];
  const params = [];

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const p = params.length;
    where.push(`(buyer_name ILIKE $${p} OR buyer_email ILIKE $${p} OR reference_code ILIKE $${p})`);
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [{ count }] = await query(`SELECT count(*)::int AS count FROM rfq_requests ${clause}`, params);
  const rows = await query(
    `SELECT r.*, count(li.id)::int AS line_item_count
     FROM rfq_requests r LEFT JOIN rfq_line_items li ON li.rfq_id = r.id
     ${clause}
     GROUP BY r.id
     ORDER BY r.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );

  return { rows, total: count, page, pages: Math.ceil(count / limit) };
}

async function updateStatus(id, status, adminNotes) {
  const setQuotedAt = status === 'quoted' ? ', quoted_at = now()' : '';
  return queryOne(
    `UPDATE rfq_requests SET status = $1, admin_notes = COALESCE($2, admin_notes) ${setQuotedAt}
     WHERE id = $3 RETURNING *`,
    [status, adminNotes ?? null, id]
  );
}

async function updateLineItemQuote(lineItemId, { quotedPriceUsd, quotedNotes }) {
  return queryOne(
    `UPDATE rfq_line_items SET quoted_price_usd = $1, quoted_notes = $2 WHERE id = $3 RETURNING *`,
    [quotedPriceUsd ?? null, quotedNotes ?? null, lineItemId]
  );
}

async function counts() {
  const rows = await query('SELECT status, count(*)::int AS n FROM rfq_requests GROUP BY status');
  const out = { pending: 0, under_review: 0, quoted: 0, accepted: 0, rejected: 0, expired: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

module.exports = {
  create, getByReferenceCode, getById, list, updateStatus, updateLineItemQuote, counts,
};
