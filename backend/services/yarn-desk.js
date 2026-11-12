/**
 * The yarn price desk: where every yarn price in KnitAdvisor comes from today,
 * how it is brought to today, and what each country and each buying basis adds.
 *
 * It answers the question a visitor at a stand asks — "where do your yarn
 * prices come from?" — with the system's own state rather than a brochure: each
 * source with its role, its cadence and whether it answered at the last try;
 * the price table as the costing engine resolves it right now, with every
 * price's badge; and the arithmetic, with the numbers in.
 *
 * Sources are described by what they are (a dealer list, a commodity
 * benchmark), never by publisher: the user's rule is that no outside source is
 * named where a visitor sees it. Publishers and licences are in the admin view.
 */
'use strict';

const yarnPrices = require('../db/repositories/yarn-price-repo');
const costing = require('../engine/domain/costing-engine');
const countryCosts = require('../engine/catalog/country-costs');
const { fibreMix, POLY } = require('../engine/domain/yarn-nowcast');

const ITEMS = ['carded_regular', 'combed_regular', 'cvc_60_40', 'pc_65_35', 'polyester_spun', 'viscose_regular'];
const COUNTS = [20, 24, 26, 28, 30, 32, 34, 40];
const r4 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10000) / 10000);
const pct = (a, b) => (a && b ? Math.round((b / a - 1) * 1000) / 10 : null);

function desk() {
  const feed = yarnPrices.feed();
  const st = yarnPrices.status();
  const bs = yarnPrices.benchmarks.status();
  const B = yarnPrices.benchmarks;

  // 1. the sources, by role
  const lastSync = st.last_sync || null;
  const quoteDate = st.last_updated || null;
  const sources = [
    { id: 'bd_lc', kind: 'direct quote', country: 'BD', name: 'Bangladesh yarn market — imported yarn against LC',
      unit: 'USD per kg', cadence: 'published on weekdays; read daily, refreshed weekly',
      role: 'The price the costing starts from. Cotton, CVC, PC, polyester, viscose and more, by count.',
      last_quote: quoteDate, last_attempt: lastSync ? lastSync.at : null,
      status: !quoteDate ? 'none' : lastSync && lastSync.ok === false ? 'offline' : (st.age_days != null && st.age_days <= 10 ? 'ok' : 'old'),
      status_note: lastSync && lastSync.ok === false ? 'The dealer list did not answer at the last attempt; the last good quotes are kept and brought forward by the benchmarks below.' : null },
    { id: 'bd_local', kind: 'direct quote', country: 'BD', name: 'Bangladesh local cash market',
      unit: 'taka per pound', cadence: 'with the list above',
      role: 'Shown beside the LC list for comparison; never used for costing (it is a different trade).',
      last_quote: quoteDate, status: quoteDate ? 'kept' : 'none' },
    { id: 'cotton_daily', kind: 'benchmark', country: 'world', name: 'International cotton benchmark, daily',
      unit: 'cotton lint, USD per kg', cadence: 'every trading day; read every 6 hours',
      role: "Today's cotton level: moves every cotton and blended yarn from its quote date to today.",
      latest: bs.daily_cotton.latest_date, last_attempt: bs.daily_cotton.fetched_at || bs.daily_cotton.error_at,
      status: bs.daily_cotton.ok ? 'ok' : bs.daily_cotton.latest_date ? 'old' : 'offline' },
    { id: 'monthly', kind: 'benchmark', country: 'world', name: 'International commodity prices, monthly',
      unit: 'cotton USD per kg, crude oil USD per barrel', cadence: 'first days of each month; read daily',
      role: 'The cotton level on the day an old quote was taken, and crude oil, which moves polyester.',
      latest: bs.monthly.latest_month, last_attempt: bs.monthly.fetched_at || bs.monthly.error_at,
      status: bs.monthly.ok ? 'ok' : bs.monthly.latest_month ? 'old' : 'offline' },
    { id: 'tariff', kind: 'model', country: '6 countries', name: 'Industrial power tariffs',
      unit: 'US cents per kWh', cadence: 'when a regulator publishes a new tariff',
      role: 'Other countries are modelled from the Bangladesh price: energy is part of the spinning cost, the fibre is the same.',
      latest: countryCosts.listCountries().map((c) => c.tariff.as_of).sort().pop(), status: 'built in' },
    { id: 'reference', kind: 'fallback', country: 'BD', name: 'Reference price list',
      unit: 'USD per kg', cadence: 'compiled ' + costing.PRICE_LIST_DATE,
      role: 'Answers only where no quote exists; it is brought forward by the benchmarks too.', latest: costing.PRICE_LIST_DATE, status: 'built in' },
  ];

  // 2. how far the fibres have moved (derived changes only; no benchmark figure is republished)
  const now = { cotton: B.levelNow('cotton_usd_kg'), oil: B.levelNow('brent_usd_bbl') };
  const since = (iso) => {
    if (!iso) return null;
    const c = B.levelAt('cotton_usd_kg', iso), o = B.levelAt('brent_usd_bbl', iso);
    return { from: iso, cotton_pct: c && now.cotton ? pct(c.value, now.cotton.value) : null, oil_pct: o && now.oil ? pct(o.value, now.oil.value) : null,
      polyester_pct: o && now.oil ? Math.round((now.oil.value / o.value - 1) * POLY.oil_elasticity * 1000) / 10 : null };
  };
  const moves = { to: now.cotton ? now.cotton.on : null, since_last_quote: since(quoteDate), since_reference_list: since(costing.PRICE_LIST_DATE) };

  // 3. the table, exactly as the costing engine resolves it now (Bangladesh)
  const table = ITEMS.filter((k) => costing.SM_PRICE_MATRIX[k]).map((key) => {
    const row = costing.SM_PRICE_MATRIX[key];
    const mix = fibreMix(row);
    return {
      key, label: row.label, moved_by: mix.map((m) => m.fibre),
      prices: COUNTS.map((ne) => {
        const r = costing.resolveYarnPrice(key, ne, feed, 'BD');
        if (r.price == null) return { ne, price: null };
        const ps = r.price_source || {};
        return { ne, price: r4(r.price), kind: ps.kind, interpolated: ps.kind === 'market_interpolated',
          quoted_on: ps.kind && ps.kind.startsWith('market') ? ps.last_updated : null,
          quoted_price: ps.quoted_price != null ? r4(ps.quoted_price) : ps.listed_price != null ? r4(ps.listed_price) : null,
          moved: ps.nowcast ? r4(ps.nowcast.delta) : 0 };
      }),
    };
  });

  // 4. one yarn, six countries
  const base = costing.resolveYarnPrice('combed_regular', 30, feed, 'BD');
  const countries = countryCosts.listCountries().map((c) => {
    const pos = countryCosts.costPosition(c.code), ratio = c.is_anchor ? 1 : pos.vs_anchor.yarn_ratio;
    return { code: c.code, name: c.name, anchor: c.is_anchor, tariff_us_cents_kwh: c.tariff.us_cents_kwh, tariff_as_of: c.tariff.as_of,
      yarn_ratio: ratio, price: r4(base.price * ratio) };
  });

  // 5. buying basis: what the costing assumes unless told otherwise (no rate is invented
  // here; the page lets the reader enter freight, duty, LC charges and VAT and see each line)
  const landed = { default: costing.landedYarnPrice(base.price, { basis: 'bonded_export' }) };

  return {
    as_of: new Date().toISOString(), sources, moves, table, counts: COUNTS,
    example: { key: 'combed_regular', ne: 30, price: r4(base.price), price_source: { ...base.price_source, attribution: undefined } },
    countries, landed,
    rules: {
      quote_used_as_printed_days: 3, brought_forward_up_to_days: costing.NOWCAST_MAX_AGE_DAYS,
      interpolation_max_span_ne: yarnPrices.MAX_INTERPOLATION_SPAN_NE, polyester_oil_elasticity: POLY.oil_elasticity, polyester_staple_usd_kg: POLY.staple_usd_kg,
    },
  };
}

module.exports = { desk };
