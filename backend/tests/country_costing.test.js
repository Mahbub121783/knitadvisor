const assert = require('assert');
const { calculateCost } = require('../engine/domain/costing-engine');
const cc = require('../engine/catalog/country-costs');
const engine = require('../engine');

console.log('--- Running Country Costing Tests ---');

// ============================================================================
// Switching country moves the YARN price and nothing else. Knitting, dyeing
// and finishing are price-list figures and stay that list's numbers wherever
// the fabric is costed.
//
// The yarn moves by one of three routes, in order: that country's own live
// quote if any source carries it; failing that the anchor's live quote scaled
// by the published power-tariff ratio; failing that the fixed reference list.
//
// This suite exists to keep those three distinguishable, and labelled.
// ============================================================================

const BASE = { gsm: 180, composition: '100% Cotton', count_ne: 30,
               fabric: 'single_jersey', color_shade: 'dark_navy', order_qty_kg: 1000 };
const total = r => {
  const b = r.cost_breakdown_usd;
  return b.total_per_kg;
};

// ── Every country carries a source and a date, or it is not offered ────────
for (const c of cc.listCountries()) {
  assert(c.tariff.source && c.tariff.source.length > 20,
    `${c.name}: a tariff with no source must not be offered`);
  assert(/^\d{4}(-\d{2})?( FY)?$/.test(c.tariff.as_of),
    `${c.name}: "${c.tariff.as_of}" is not a date`);
  assert(c.tariff.url && /^https:\/\//.test(c.tariff.url),
    `${c.name}: the source must be checkable`);
  // A tariff outside this band is not an industrial tariff and almost certainly
  // means the exchange rate beside it is wrong — which is the failure mode a
  // hand-maintained FX figure actually has.
  assert(c.tariff.us_cents_kwh > 2 && c.tariff.us_cents_kwh < 40,
    `${c.name}: ${c.tariff.us_cents_kwh} US cents/kWh is not an industrial tariff — check the ` +
    `exchange rate of ${c.tariff.fx_per_usd} per USD`);
}

// ── The fibre does not move with a power tariff ────────────────────────────
// This is the whole point of the model and the easiest thing to get wrong. If
// yarn ever moved as much as the tariff did, the cotton would be being treated
// as if it were made of electricity.
for (const c of cc.listCountries()) {
  if (c.is_anchor) continue;
  const v = c.vs_anchor;
  const tariffMove = Math.abs(1 - v.tariff_ratio);
  const yarnMove = Math.abs(1 - v.yarn_ratio);
  assert(yarnMove < tariffMove * 0.5,
    `${c.name}: yarn moved ${(yarnMove * 100).toFixed(1)}% on a ${(tariffMove * 100).toFixed(1)}% ` +
    'tariff move — the fibre is a world commodity and must not follow local power');

  // The knitting and dyeing ratios are still computed and still have to be
  // internally consistent — a dyehouse boils water, a knitting machine turns a
  // cylinder — but nothing applies them to a costing any more. They are kept
  // because they are the reasoning behind the yarn ratio, and because deleting
  // the arithmetic would make the yarn figure look like an assertion.
  assert(Math.abs(1 - v.dyeing_ratio) > Math.abs(1 - v.knitting_ratio),
    `${c.name}: dyeing must be more tariff-sensitive than knitting — it is heat, not motion`);
  assert(Math.abs(1 - v.dyeing_ratio) > Math.abs(1 - v.yarn_ratio),
    `${c.name}: dyeing must be more tariff-sensitive than yarn`);
}

// ── Cheaper power must not make a fabric dearer ────────────────────────────
{
  const anchor = calculateCost({ ...BASE, country: 'BD' });
  for (const c of cc.listCountries()) {
    if (c.is_anchor) continue;
    const r = calculateCost({ ...BASE, country: c.code });
    const cheaperPower = c.tariff.us_cents_kwh < anchor.country.tariff.us_cents_kwh;
    assert(cheaperPower === (total(r) < total(anchor)),
      `${c.name}: power is ${cheaperPower ? 'cheaper' : 'dearer'} than the anchor but the fabric ` +
      `came out $${total(r)} against $${total(anchor)}`);
  }
}

// ── The anchor is unchanged from before this existed ───────────────────────
// A country feature that quietly moved Bangladesh's own numbers would have
// broken every existing costing.
{
  const withCountry = calculateCost({ ...BASE, country: 'BD' });
  const without = calculateCost({ ...BASE });
  assert.strictEqual(total(withCountry), total(without),
    'the anchor must cost exactly the same with and without the country named');
  assert.strictEqual(withCountry.country.is_anchor, true);
  assert.strictEqual(withCountry.yarn.price_source.kind,
                     without.yarn.price_source.kind,
                     'and it must not relabel the anchor\'s own price as modelled');
}

// ── The three links, in order ──────────────────────────────────────────────
// 1. a live quote for that country  2. the anchor's live quote, scaled
// 3. the fixed reference list. The third is what makes the first two safe to
// attempt: a price feed that can take a costing down with it is a feed nobody
// should connect.
{
  const feed = (key, ne, country) => {
    if (key !== 'carded_regular' || Number(ne) !== 30) return null;
    if (country === 'BD') {
      return { price_usd_kg: 3.25, quoted_on: '2026-08-29', age_days: 3,
               as_published: '$3.25 per KG', label: '30/s Card',
               source: 'texbazar', country: 'BD' };
    }
    if (country === 'IN') {
      return { price_usd_kg: 3.02, quoted_on: '2026-08-30', age_days: 2,
               as_published: '$3.02 per KG', label: '30s IN',
               source: 'emergingtextiles', country: 'IN' };
    }
    return null;
  };
  const at = (country, live) => calculateCost({ ...BASE, count_ne: 30, yarn_type: 'carded_regular',
                                                country, live_prices: live });

  // LINK 1 — the country has its own quote, from either source. It is used
  // as-is and never scaled: a real Indian quote beats an Indian price modelled
  // from a Bangladeshi one, which is the entire reason for a second source.
  const inOwn = at('IN', feed);
  assert.strictEqual(inOwn.yarn.base_price_usd, 3.02);
  assert.strictEqual(inOwn.yarn.price_source.kind, 'market');
  assert.strictEqual(inOwn.yarn.price_source.for_country, 'IN');

  // LINK 2 — no Vietnamese quote, so the anchor's live quote is scaled. It must
  // be modelled from the LIVE 3.25 and not from the four-month-old list.
  const vn = at('VN', feed);
  assert.strictEqual(vn.yarn.price_source.kind, 'modelled_country',
    'a yarn price scaled to another country is modelled, not quoted');
  assert.strictEqual(vn.yarn.price_source.modelled_from.country, 'BD');
  assert.strictEqual(vn.yarn.price_source.modelled_from.price, 3.25,
    'link 2 must scale the LIVE anchor quote, not the reference list');
  assert(vn.yarn.base_price_usd < 3.25 && vn.yarn.base_price_usd > 3.0);

  // LINK 3 — no feed at all. The fixed list answers and keeps its own label:
  // scaling a four-month-old number does not turn it into a market price.
  const noFeed = at('VN', null);
  assert.strictEqual(noFeed.yarn.price_source.kind, 'reference_list');
  assert(noFeed.yarn.price_source.country_adjusted,
    'the dropdown still has to mean something with no feed connected');
  assert(noFeed.yarn.base_price_usd > vn.yarn.base_price_usd,
    'and the stale list should read higher than the live quote it replaces');

  assert(/modelled/.test(vn.country.method.confidence));
  assert(vn.country.method.not_modelled.includes('labour cost'),
    'the model must name what it does NOT cover — labour is the biggest omission');
}

// ── Only the yarn follows the country ──────────────────────────────────────
// Knitting, dyeing and finishing are price-list figures and stay that list's
// numbers wherever the fabric is costed. An earlier version scaled all three by
// a power tariff, which was a model standing in for data in the middle of a
// costing.
{
  const bd = calculateCost({ ...BASE, country: 'BD' });
  for (const c of cc.listCountries()) {
    const r = calculateCost({ ...BASE, country: c.code });
    assert.strictEqual(r.cost_breakdown_usd.knitting.per_kg,
                       bd.cost_breakdown_usd.knitting.per_kg,
                       `${c.name}: knitting must not move with the country`);
    assert.strictEqual(r.cost_breakdown_usd.dyeing.per_kg,
                       bd.cost_breakdown_usd.dyeing.per_kg,
                       `${c.name}: dyeing must not move with the country`);
    assert.strictEqual(r.cost_breakdown_usd.finishing,
                       bd.cost_breakdown_usd.finishing,
                       `${c.name}: finishing must not move with the country`);
  }
}

// ── An unknown country falls back and SAYS so ──────────────────────────────
{
  const r = calculateCost({ ...BASE, country: 'ZZ' });
  assert.strictEqual(r.country.code, cc.ANCHOR);
  assert.strictEqual(r.country.fell_back_from, 'ZZ');
  assert(r.warnings.some(w => /ZZ/.test(w) && /costed as/.test(w)),
    'costing Vietnam at Bangladeshi rates under a Vietnamese heading is the failure to avoid');
}

// ── A user override is not overwritten by the country ──────────────────────
// Someone who types their own dyeing rate has said what it is; scaling their
// number by a tariff ratio would be the engine arguing with its user.
{
  const r = calculateCost({ ...BASE, country: 'VN', dyeing_cost: 1.11, knitting_cost: 0.22 });
  assert.strictEqual(r.cost_breakdown_usd.dyeing.per_kg, 1.11);
  assert.strictEqual(r.cost_breakdown_usd.knitting.per_kg, 0.22);
}

// ── It reaches calculate(), and the country is part of the cache key ───────
{
  const { ENGINE_INPUTS } = require('../engine/index');
  assert(ENGINE_INPUTS.includes('country'),
    'the route derives the cache key from ENGINE_INPUTS — without country in it, switching ' +
    'country returns whichever country was calculated first for those inputs');

  const bd = engine.calculate({ fabric: 'single_jersey', gsm: 180, composition: '100% Cotton',
                                dia: 34, gauge: 24, color_shade: 'dark_navy', country: 'BD' });
  const vn = engine.calculate({ fabric: 'single_jersey', gsm: 180, composition: '100% Cotton',
                                dia: 34, gauge: 24, color_shade: 'dark_navy', country: 'VN' });
  assert(vn.costing.total_per_kg_usd < bd.costing.total_per_kg_usd);
  assert(Array.isArray(bd.costing.countries_available) &&
         bd.costing.countries_available.length >= 5,
    'the page builds its dropdown from this list');
  assert(bd.costing.countries_available.some(c => c.is_anchor),
    'and one of them must be the anchor, or the page cannot mark which is quoted');
}

// ── The size of the effect is worth stating, and worth checking ────────────
// If this ever comes out at 30% the model has gone wrong: these countries buy
// cotton in the same market and the tariff spread is under two to one.
{
  const bd = total(calculateCost({ ...BASE, country: 'BD' }));
  const vn = total(calculateCost({ ...BASE, country: 'VN' }));
  const gap = (bd - vn) / bd;
  assert(gap > 0.02 && gap < 0.20,
    `Bangladesh to Vietnam came out ${(gap * 100).toFixed(1)}% — outside the range a power ` +
    'tariff difference alone can explain');
  console.log(`  Bangladesh $${bd.toFixed(3)} -> Vietnam $${vn.toFixed(3)}/kg, ` +
              `${(gap * 100).toFixed(1)}% — mostly dyeing, barely the yarn`);
}

console.log(`  ${cc.listCountries().length} countries, each with a sourced and dated tariff`);
console.log('\nAll country costing tests passed.');
