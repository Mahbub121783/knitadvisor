/**
 * API plan orders (migration 042): a customer asks for a plan for N months and says how they paid;
 * the admin checks the payment and marks the order paid; the customer then creates the key themselves,
 * once, from their account (or, for a renewal, the existing key is extended).
 *
 * No payment gateway is connected: money moves by bKash / Nagad / bank transfer and the transaction id
 * is the evidence. `decide(id, 'paid')` is the one place a gateway's confirmation would call.
 */
'use strict';
const { query, queryOne } = require('../client');
const { keys, KeyError } = require('./api-key-repo');

const METHODS = { bkash: 'bKash', nagad: 'Nagad', bank: 'Bank transfer', other: 'Other' };
const MAX_PENDING = 5;

const prices = {
  list() { return query('SELECT plan, price, currency, updated_at FROM api_plan_prices ORDER BY price'); },
  async set(plan, price, currency, catalogue) {
    if (!catalogue.PLANS[plan] || plan === 'beta') throw new KeyError('Unknown plan, or a plan that is not sold (the beta is given, not bought).');
    if (price === null || price === '') {
      await query('DELETE FROM api_plan_prices WHERE plan = $1', [plan]);
      return { plan, price: null };
    }
    const p = +price;
    if (!Number.isFinite(p) || p < 0 || p > 1e7) throw new KeyError('The price must be a number from 0 up.');
    const cur = String(currency || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw new KeyError('The currency is a 3-letter code, e.g. USD or BDT.');
    return queryOne(
      `INSERT INTO api_plan_prices (plan, price, currency) VALUES ($1, $2, $3)
       ON CONFLICT (plan) DO UPDATE SET price = EXCLUDED.price, currency = EXCLUDED.currency, updated_at = now() RETURNING plan, price, currency`,
      [plan, p, cur]
    );
  },
};

const settings = {
  async get(key) { const r = await queryOne('SELECT value FROM api_settings WHERE key = $1', [key]); return r ? r.value : ''; },
  async set(key, value) {
    const v = String(value || '').slice(0, 1500);
    if (!v.trim()) { await query('DELETE FROM api_settings WHERE key = $1', [key]); return ''; }
    await query('INSERT INTO api_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [key, v]);
    return v;
  },
};

/** The order as the customer wrote it, checked against the prices: what it costs, or why not. Pure. */
function priceOrder(body, priceRows, ownedKeyIds) {
  const b = body || {};
  const plan = String(b.plan || '');
  const row = (priceRows || []).find((r) => r.plan === plan);
  if (!row) throw new KeyError('That plan is not for sale yet — ask KnitAdvisor for a quote.');
  const months = +b.months;
  if (!Number.isInteger(months) || months < 1 || months > 24) throw new KeyError('Choose 1 to 24 months.');
  const method = String(b.method || '');
  if (!METHODS[method]) throw new KeyError('Choose how you paid.');
  const ref = String(b.payment_ref || '').replace(/\s+/g, ' ').trim();
  if (ref.length < 4 || ref.length > 60) throw new KeyError('Write the transaction id or payment reference (4 to 60 characters) so the payment can be found.');
  let renew = null;
  if (b.renew_key_id != null && b.renew_key_id !== '') {
    renew = parseInt(b.renew_key_id, 10);
    if (!Number.isInteger(renew) || !(ownedKeyIds || []).includes(renew)) throw new KeyError('That key is not on your account.');
  }
  const amount = Math.round(+row.price * months * 100) / 100;
  return { plan, months, method, payment_ref: ref, renew_key_id: renew, amount, currency: row.currency, note: b.note ? String(b.note).slice(0, 200) : null };
}

const orders = {
  async create(userId, body, catalogue) {
    const [rows, mine, pending] = await Promise.all([
      prices.list(),
      query("SELECT id FROM api_keys WHERE user_id = $1 AND status <> 'revoked'", [userId]),
      queryOne("SELECT count(*)::int AS n FROM api_orders WHERE user_id = $1 AND status = 'pending'", [userId]),
    ]);
    if (pending.n >= MAX_PENDING) throw new KeyError(`You already have ${MAX_PENDING} orders waiting for a payment check. Wait for those first.`);
    const o = priceOrder(body, rows, mine.map((k) => k.id));
    if (!catalogue.PLANS[o.plan]) throw new KeyError('Unknown plan.');
    try {
      return await queryOne(
        `INSERT INTO api_orders (user_id, plan, months, renew_key_id, amount, currency, method, payment_ref, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, plan, months, renew_key_id, amount, currency, method, payment_ref, status, created_at`,
        [userId, o.plan, o.months, o.renew_key_id, o.amount, o.currency, o.method, o.payment_ref, o.note]
      );
    } catch (e) {
      if (e.code === '23505') throw new KeyError('That payment reference is already on another order. If it is yours, wait for it to be checked.');
      throw e;
    }
  },

  listForUser(userId) {
    return query(
      `SELECT o.id, o.plan, o.months, o.amount, o.currency, o.method, o.payment_ref, o.status, o.note, o.created_at, o.decided_at, o.issued_at, o.key_id, o.renew_key_id, k.prefix AS key_prefix
         FROM api_orders o LEFT JOIN api_keys k ON k.id = COALESCE(o.key_id, o.renew_key_id) WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
      [userId]
    );
  },

  listAll(status) {
    return query(
      `SELECT o.id, o.plan, o.months, o.amount, o.currency, o.method, o.payment_ref, o.status, o.note, o.created_at, o.decided_at, o.issued_at, o.key_id, o.renew_key_id, u.email, u.full_name, u.company
         FROM api_orders o JOIN app_users u ON u.id = o.user_id WHERE ($1::text IS NULL OR o.status = $1) ORDER BY (o.status = 'pending') DESC, o.created_at DESC LIMIT 300`,
      [status || null]
    );
  },

  async cancel(userId, id) {
    const rows = await query("UPDATE api_orders SET status = 'cancelled', decided_at = now() WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id", [id, userId]);
    if (!rows.length) throw new KeyError('Only an order still waiting for its payment check can be cancelled.');
  },

  /** The admin's decision on a pending order. Paid + a key to renew: that key is extended now. */
  async decide(id, status, note, catalogue) {
    if (!['paid', 'rejected'].includes(status)) throw new KeyError('An order is marked paid or rejected.');
    const o = await queryOne(
      "UPDATE api_orders SET status = $2, note = COALESCE($3, note), decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id, user_id, plan, months, renew_key_id",
      [id, status, note ? String(note).slice(0, 200) : null]
    );
    if (!o) throw new KeyError('That order is not waiting for a decision.');
    if (status === 'paid' && o.renew_key_id) {
      const k = await queryOne(
        `UPDATE api_keys SET plan = $2, status = CASE WHEN status = 'suspended' THEN 'active' ELSE status END,
                expires_at = GREATEST(COALESCE(expires_at, now()), now()) + make_interval(months => $3::int),
                monthly_limit = $4, per_min_limit = $5
          WHERE id = $1 AND status <> 'revoked' RETURNING id, expires_at`,
        [o.renew_key_id, o.plan, o.months, catalogue.PLANS[o.plan].monthly, catalogue.PLANS[o.plan].per_min]
      );
      if (k) await query('UPDATE api_orders SET key_id = $2, issued_at = now() WHERE id = $1', [id, o.renew_key_id]);
      else await query("UPDATE api_orders SET note = COALESCE(note || ' · ', '') || 'the key to renew is revoked: issue a new one' WHERE id = $1", [id]);
    }
    return o;
  },

  /** A paid order → its key, created once, by the customer. Claimed atomically so a double click makes one key. */
  async issueKey(userId, id, name, catalogue) {
    const claim = await queryOne(
      "UPDATE api_orders SET issued_at = now() WHERE id = $1 AND user_id = $2 AND status = 'paid' AND key_id IS NULL AND issued_at IS NULL RETURNING id, plan, months",
      [id, userId]
    );
    if (!claim) throw new KeyError('This order is not paid yet, or its key has already been created.');
    try {
      const exp = new Date(); exp.setMonth(exp.getMonth() + claim.months);
      const key = await keys.createForUser(userId, { name: name || 'API key', plan: claim.plan, expires_at: exp.toISOString() }, catalogue);
      await query('UPDATE api_orders SET key_id = $2 WHERE id = $1', [id, key.id]);
      return key;
    } catch (e) {
      await query('UPDATE api_orders SET issued_at = NULL WHERE id = $1 AND key_id IS NULL', [id]);   // let them try again
      throw e;
    }
  },
};

module.exports = { prices, settings, orders, priceOrder, METHODS, MAX_PENDING };
