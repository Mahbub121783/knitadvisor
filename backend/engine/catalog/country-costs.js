/**
 * ============================================================================
 * COUNTRY COST REFERENCE — why the same fabric costs different money elsewhere
 * ============================================================================
 *
 * Every price in this engine has been Bangladesh's: the yarn quotes come from a
 * Bangladeshi market list, and the knitting and dyeing rates come from a
 * Bangladeshi factory price list. That is correct and it is also invisible,
 * which is the problem — a student reading "$3.25/kg" has no way to know it is
 * a Bangladeshi number, and no way to see what makes it that number.
 *
 * WHAT THIS MODELS, AND WHAT IT REFUSES TO
 * ----------------------------------------
 * The tempting thing is a table of yarn prices by country. Every free source
 * for that is a B2B marketing page quoting a round number with no date and no
 * method, and putting one under a costing would be exactly the confident
 * half-knowledge this project exists to avoid.
 *
 * So it models the one driver that IS published, per country, with a date, by
 * regulators and utilities: the INDUSTRIAL ELECTRICITY TARIFF. And it models it
 * through a published structural fact rather than a guessed multiplier —
 * Bangladesh's own textile press puts energy at "nearly 30% of total production
 * costs in many textile and spinning units", which is the share the tariff acts
 * on.
 *
 * Everything else that differs between these countries — labour, cost of
 * capital, cotton import duty, freight, machinery vintage — is NOT modelled,
 * because no free source gives it per country with a date. That gap is stated
 * in the output rather than papered over, and it is the honest reason a
 * modelled price is a band and not a figure.
 *
 * THE LESSON THIS IS ACTUALLY FOR
 * -------------------------------
 * Cotton is a world commodity. The Cotlook A Index is one global price, so the
 * FIBRE in a kilogram of yarn costs about the same everywhere. What differs is
 * the CONVERSION — turning fibre into yarn, yarn into fabric, greige into dyed
 * cloth — and conversion is bought with electricity and labour.
 *
 * "Yarn is cheaper in Bangladesh" is something a student can memorise. WHY it
 * is cheaper, and by how much, and which of those numbers would have to move
 * before it stopped being true, is what they actually need.
 *
 * EVERY FIGURE CARRIES ITS SOURCE AND ITS DATE. A country with no sourced
 * tariff does not appear in the list at all — the same rule the fibre layer
 * uses when it declines to guess a measurement it does not have.
 */

'use strict';

// ── The anchor ─────────────────────────────────────────────────────────────
//
// Bangladesh is not "the default" for convenience. It is the only country here
// whose numbers in this engine are QUOTED rather than modelled: dated yarn
// quotes from a published market list, and a factory knitting and dyeing price
// list. Every other country is expressed as a difference from it, so the
// modelling is always visible as a difference and never hidden inside a total.
const ANCHOR = 'BD';

/**
 * How much of each conversion step is bought with electricity.
 *
 * Spinning: Bangladesh's own textile press, reporting the February 2026 tariff
 * rise, puts energy at "nearly 30% of total production costs in many textile
 * and spinning units". Production cost here means conversion — the cotton is
 * bought at a world price and is not made cheaper by a power tariff.
 *
 * Knitting is the least energy-hungry step: a circular knitting machine is a
 * few kilowatts and the cost is mostly labour and machine depreciation.
 *
 * Dyeing is the most: it is water heated to 60-130 C, held there, and then a
 * stenter drying the cloth. Steam and heat dominate, which is why a dyehouse
 * feels an energy tariff harder than a knitting floor does.
 *
 * These three shares are the model's main assumption. They are stated here as
 * values rather than buried as multipliers so they can be argued with.
 */
const ENERGY_SHARE = {
  spinning: 0.30,
  knitting: 0.15,
  dyeing:   0.45,
};

/**
 * What fraction of a yarn price is the fibre itself.
 *
 * Checked against this engine's own numbers rather than asserted: Bangladesh
 * 30Ne carded quotes at $3.25/kg (texbazar LC list, 29 Aug 2026) and the world
 * cotton price over that period runs near $1.90/kg equivalent, which puts the
 * fibre a little under 60% of the yarn. 0.58 is used, and the sensitivity is
 * mild — moving it to 0.55 or 0.62 changes a modelled country price by about a
 * cent.
 *
 * The reason it matters at all is directional: the fibre share does NOT respond
 * to a local power tariff, so getting it badly wrong would make every country
 * look more different than it is.
 */
const FIBRE_SHARE_OF_YARN = 0.58;

/**
 * Industrial electricity, as published, per country.
 *
 * `tariff_local` is the figure the regulator or utility published, in the unit
 * they published it in — never pre-converted, for the same reason yarn quotes
 * are stored as published: a converted number with the rate folded in cannot be
 * checked later.
 *
 * `fx_per_usd` is the rate used to bring it to US cents, carried beside it so
 * the conversion is auditable and so a stale rate is visible rather than baked
 * in. These are approximate market rates for September 2026 and are the softest
 * numbers in this file — which is why `confidence` says so.
 */
const COUNTRIES = {
  BD: {
    name: 'Bangladesh',
    name_bn: 'বাংলাদেশ',
    currency: 'BDT',
    tariff_local: 12.73,
    tariff_unit: 'BDT/kWh',
    fx_per_usd: 122.5,
    tariff_as_of: '2026-02',
    tariff_source: 'Bangladesh Energy Regulatory Commission retail tariff, small industry, '
      + 'as reported by The Business Standard, February 2026 (raised from Tk11.05)',
    tariff_url: 'https://www.tbsnews.net/bangladesh/energy/retail-power-tariff-hiked-tk152-amid-subsidy-cuts-1453181',
    // The only country in this file whose yarn, knitting and dyeing figures in
    // this engine are quoted rather than derived.
    anchor: true,
    notes: 'Yarn prices are dated market quotes; knitting and dyeing come from a factory '
      + 'price list. Every other country is a modelled difference from these.',
    // WORTH KNOWING BEFORE BELIEVING THE RANKING. This is the SMALL-INDUSTRY
    // retail tariff, and it comes out as the dearest power of the six here,
    // which will surprise anyone in the trade. Two reasons it may overstate
    // what a spinning mill actually pays: large consumers are on different
    // schedules, and many Bangladeshi mills run captive gas generation and
    // never buy this power at all. The comparison is therefore firmer for
    // knitting and dyeing units on grid supply than for integrated spinners.
    caveat: 'small-industry retail tariff; large mills are on other schedules and many run '
      + 'captive gas generation, so this overstates what an integrated spinner pays',
  },
  IN: {
    name: 'India',
    name_bn: 'ভারত',
    currency: 'INR',
    // States set their own tariffs and they differ; Tamil Nadu and Andhra
    // Pradesh are used because both are spinning states and both published a
    // FY2026 industrial figure. The spread between them is real and is carried
    // through to the output rather than averaged away.
    tariff_local: 7.10,
    tariff_local_range: [6.70, 7.50],
    tariff_unit: 'INR/kWh',
    fx_per_usd: 88.5,
    tariff_as_of: '2026 FY',
    tariff_source: 'State industrial tariffs FY2026 — Tamil Nadu Rs7.50/kWh and Andhra Pradesh '
      + 'Rs6.70/kWh, per Mercom India. Indian tariffs are set state by state, so this is a '
      + 'spinning-state range and not one national number',
    tariff_url: 'https://www.mercomindia.com/tamil-nadu-hikes-fy-2026-electricity-tariffs-by-3-16',
  },
  PK: {
    name: 'Pakistan',
    name_bn: 'পাকিস্তান',
    currency: 'PKR',
    tariff_local: 26.16,
    tariff_unit: 'PKR/kWh',
    fx_per_usd: 281,
    tariff_as_of: '2026-02',
    tariff_source: 'B2 medium industrial tariff notified February 2026, per Profit/Pakistan '
      + 'Today. Cut from a higher level after sustained pressure from the textile sector',
    tariff_url: 'https://profit.pakistantoday.com.pk/2026/02/17/govt-notifies-cuts-in-industrial-electricity-tariffs-by-up-to-rs4-58-unit-providing-relief-to-businesses',
  },
  CN: {
    name: 'China',
    name_bn: 'চীন',
    currency: 'CNY',
    tariff_local: 0.620,
    tariff_unit: 'CNY/kWh',
    fx_per_usd: 7.1,
    tariff_as_of: '2026-07',
    tariff_source: '36-city average industrial price, 35 kV and above, NDRC Price Monitoring '
      + 'Centre via CEIC, July 2026',
    tariff_url: 'https://www.ceicdata.com/en/china/price-monitoring-center-ndrc-36-city-monthly-avg-transaction-price-production-material/cn-usage-price-36-city-avg-electricity-for-industry-35-kv-and-above',
  },
  VN: {
    name: 'Vietnam',
    name_bn: 'ভিয়েতনাম',
    currency: 'VND',
    // Vietnam prices by time of day and the spread is wide — 843 off-peak
    // against 3,266 at peak. A spinning mill runs three shifts, so the
    // normal-hours rate is the fair single figure and the range is carried.
    tariff_local: 1811,
    tariff_local_range: [843, 3266],
    tariff_unit: 'VND/kWh',
    fx_per_usd: 26300,
    tariff_as_of: '2026-04',
    tariff_source: 'EVN manufacturing tariff at 110 kV and above, normal hours, effective '
      + 'April 2026. Vietnam prices by time of day: 843 off-peak, 1,811 normal, 3,266 peak',
    tariff_url: 'https://index.vn/en/news/vietnam-issues-new-peak-off-peak-and-normal-hour-electricity-tariff-schedule-for-national-grid-effective-22-april-2026',
  },
  TR: {
    name: 'Turkey',
    name_bn: 'তুরস্ক',
    currency: 'TRY',
    tariff_local: 3.90,
    tariff_unit: 'TRY/kWh',
    fx_per_usd: 42.5,
    tariff_as_of: '2026-04',
    tariff_source: 'Medium-voltage industrial rate from April 2026, per GMK Center',
    tariff_url: 'https://gmk.center/en/news/turkey-raises-electricity-and-gas-prices-from-april/',
  },
};

/** Published tariff brought to US cents per kilowatt-hour. */
function tariffUsCents(code) {
  const c = COUNTRIES[code];
  if (!c) return null;
  return Math.round((c.tariff_local / c.fx_per_usd) * 100 * 1000) / 1000;
}

/**
 * One country's cost position, relative to the anchor.
 *
 * Returns the RATIOS rather than finished prices, because the finished price
 * depends on the yarn, fabric and shade the caller is costing, and because a
 * ratio is the thing a reader can check against the two tariffs.
 */
function costPosition(code) {
  const c = COUNTRIES[code];
  if (!c) return null;
  const mine = tariffUsCents(code);
  const anchor = tariffUsCents(ANCHOR);
  if (mine == null || anchor == null) return null;

  const tariffRatio = mine / anchor;
  // Only the energy share of each step moves with the tariff. The rest —
  // labour, capital, chemicals, the fibre itself — is held at the anchor's
  // level, because no free source prices those per country with a date. That
  // is the model's main limitation and it is reported, not hidden.
  const step = share => 1 + share * (tariffRatio - 1);

  const round3 = v => Math.round(v * 1000) / 1000;
  return {
    code,
    name: c.name,
    name_bn: c.name_bn,
    is_anchor: code === ANCHOR,
    tariff: {
      local: c.tariff_local,
      unit: c.tariff_unit,
      local_range: c.tariff_local_range || null,
      us_cents_kwh: mine,
      fx_per_usd: c.fx_per_usd,
      as_of: c.tariff_as_of,
      source: c.tariff_source,
      url: c.tariff_url,
      caveat: c.caveat || null,
    },
    vs_anchor: {
      anchor: ANCHOR,
      anchor_us_cents_kwh: anchor,
      tariff_ratio: round3(tariffRatio),
      // The fibre in the yarn does not move with a local power tariff — cotton
      // is bought at a world price. Only the conversion does.
      yarn_conversion_ratio: round3(step(ENERGY_SHARE.spinning)),
      yarn_ratio: round3(FIBRE_SHARE_OF_YARN
        + (1 - FIBRE_SHARE_OF_YARN) * step(ENERGY_SHARE.spinning)),
      knitting_ratio: round3(step(ENERGY_SHARE.knitting)),
      dyeing_ratio: round3(step(ENERGY_SHARE.dyeing)),
    },
    method: {
      energy_share: ENERGY_SHARE,
      fibre_share_of_yarn: FIBRE_SHARE_OF_YARN,
      basis: 'Only the energy share of each step moves with the published industrial tariff. '
        + 'The fibre is a world commodity and does not move with it at all.',
      not_modelled: ['labour cost', 'cost of capital', 'cotton import duty',
                     'freight', 'machinery vintage', 'scale'],
      confidence: code === ANCHOR
        ? 'quoted — these are the engine\'s own market and factory figures'
        : 'modelled from a published tariff; treat it as a direction and a rough size, '
          + 'not as a quotation',
    },
  };
}

/** Every country, anchor first, then by how cheap the power is. */
function listCountries() {
  return Object.keys(COUNTRIES)
    .map(costPosition)
    .filter(Boolean)
    .sort((a, b) => (b.is_anchor - a.is_anchor)
      || (a.tariff.us_cents_kwh - b.tariff.us_cents_kwh));
}

module.exports = {
  COUNTRIES, ANCHOR, ENERGY_SHARE, FIBRE_SHARE_OF_YARN,
  tariffUsCents, costPosition, listCountries,
};
