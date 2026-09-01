/**
 * ============================================================================
 * YARN PRICE SYNC — the costing matrix stops being a typed constant
 * ============================================================================
 *
 * The costing engine ran on a matrix headed "Factory-Approved Reference Price
 * List — Updated May 2026". Measured against the market on 29 August 2026 it
 * was 3% high on cotton and 5-7% high on CVC and PC, and nothing in the system
 * could say so, because a number typed into a source file carries no date.
 *
 * This fetches the published daily list, maps it onto the engine's own matrix
 * keys, and stores every quote with the date the publisher put on it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not replace the matrix. The feed prints nine counts — 7, 10, 12, 16,
 * 20, 24, 30, 34, 40 — and the engine costs fifteen. The seven it never prints
 * (14, 18, 22, 26, 28, 32, 36) are the ones a merchandiser asks for most often,
 * and inventing them would be the worst possible outcome: a made-up number
 * wearing a live-price badge. Where there is a quote it is used and labelled;
 * where there is not, the matrix answers and says so.
 *
 * THE TRAP IN THIS FEED
 * ---------------------
 * It prints TWO price lists on one page, and they are not one list in two
 * currencies — they are different trades:
 *
 *   lc_usd     imported yarn against a letter of credit, quoted USD per kg
 *   local_bdt  the domestic cash market, quoted taka per pound
 *
 * On 29 August 2026, 20Ne PC was $2.75 on the first and $2.12/kg on the second.
 * Twenty-three per cent apart, and both correct. The first version of this file
 * merged them on the assumption that a currency was just a currency, and its
 * own gate caught it: prices stopped rising with count, because two lists were
 * interleaved into one series.
 *
 * That is also why the exchange rate below is not on the costing path. The
 * engine's matrix is denominated USD/kg and reads the lc_usd list, which needs
 * no conversion at all; the taka figures are converted only so the two lists
 * can be shown side by side.
 *
 * AND THE ONE THAT MATTERS MORE
 * -----------------------------
 * "Daily" is the publisher's word for it. On 1 September 2026 every row on the
 * page was dated 29 August. A sync that reported its own fetch time as "last
 * updated" would show a fresh green timestamp over a three-day-old price, and
 * over a one-year-old price just as happily. The quote date and the fetch time
 * are kept apart everywhere in this file for that reason.
 */

const { query, queryOne } = require('../db/client');

const SOURCE = 'texbazar';
const URL = 'https://texbazar.com/daily-price';

// Seven days, as asked. The publisher moves prices most weekdays, so this is
// not chasing every tick — it is keeping the list from going months stale.
const REFRESH_DAYS = 7;

// Pounds to kilograms. Exact by definition, not a market figure.
const LB_PER_KG = 2.20462262185;

/**
 * Taka per dollar — used for DISPLAY of the local list, never for costing.
 *
 * Held here as a declared constant rather than fetched, and that is a real
 * limitation stated plainly: it means the taka-denominated rows carry an
 * exchange-rate error that grows as the rate moves. It is recorded with every
 * converted row (`fx_bdt_per_usd`, `fx_source`) so the size of that error is
 * always recoverable, and so a later version can re-derive the USD figures
 * without re-fetching the quotes.
 *
 * The costing engine reads the lc_usd list, which is already in dollars per
 * kilogram, so nothing it quotes depends on this number.
 */
const FX = {
  bdt_per_usd: 122.5,
  source: 'declared constant, Bangladesh Bank interbank mid-rate, September 2026',
  as_of: '2026-09-01',
};

// ── The feed's vocabulary, mapped onto the engine's ────────────────────────
//
// The engine's matrix keys are the authority; this is a translation table and
// nothing more. An unmapped row is REJECTED and reported, never guessed at:
// "20/s Compact" is not "20/s Combed" and costing one as the other would be a
// silent error worth several cents a kilo.
//
// Order matters — the first pattern that matches wins, so the more specific
// ones (slub, siro, white) come before the plain ones they contain.
const MAP = [
  // 100% cotton
  [/^(\d+)\/s\s+combed\s+slub$/i, 'carded_slub', 'combed slub is priced as slub'],
  [/^(\d+)\/s\s+card\s+slub$/i, 'carded_slub'],
  [/^(\d+)\/s\s+combed\s*\(bci\)$/i, 'combed_regular', 'BCI combed carries no separate matrix row'],
  [/^(\d+)\/s\s+combed$/i, 'combed_regular'],
  [/^(\d+)\/s\s+card$/i, 'carded_regular'],
  [/^(\d+)\/s\s+carded$/i, 'carded_regular'],
  // Blends
  [/^(\d+)\/s\s+cvc$/i, 'cvc_60_40'],
  [/^(\d+)\/s\s+pc$/i, 'pc_65_35'],
  // Regenerated
  [/^(\d+)\/s\s+viscos(e)?$/i, 'viscose_regular'],
];

// Rows the feed carries that the engine has no matrix row for. Listed by name
// so they are skipped QUIETLY and on purpose, rather than appearing every week
// in the rejection report as though something were broken.
const NOT_COSTED = [
  /mélange|melange/i,      // the engine has no melange row
  /rotor|oe$/i,            // open-end, not in the matrix
  /vortex/i,
  /dty|fdy|poy|monofilament/i, // filament is priced by denier, not by Ne
  /spandex|lycra/i,            // ditto
  /rubber/i,
];

/**
 * Pull the published list.
 *
 * The page is server-rendered, so the quotes arrive inside the HTML as JSON and
 * no browser is needed. That is also the fragile part: this is reading another
 * site's markup, and it will break the day they change it. It breaks LOUDLY —
 * a parse that finds nothing throws rather than storing an empty list, because
 * an empty sync that reports success would quietly freeze every price.
 */
async function fetchRaw(fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(URL, {
    headers: {
      // Identifying the caller is the minimum courtesy when reading someone
      // else's page on a schedule.
      'User-Agent': 'KnitAdvisor/1.0 (+https://knitadvisor.onlinetextileschool.com) yarn-price-sync',
      'Accept': 'text/html',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${URL} returned HTTP ${res.status}`);
  return res.text();
}

/**
 * Lift the quote objects out of the page.
 *
 * They sit in the framework's serialised payload, escaped inside JS string
 * literals, so the escaping is undone first and then the objects are matched
 * whole. Matching whole objects rather than scraping field by field is what
 * keeps a price from being paired with the wrong count.
 */
function parse(html) {
  const un = html.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const found = un.match(/\{"id":\d+,[^{}]*?"price":"[^"]*"[^{}]*?\}/g) || [];
  const seen = new Set();
  const rows = [];
  for (const raw of found) {
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    if (o.id == null || seen.has(o.id)) continue;
    seen.add(o.id);
    if (!o.count || !o.price || !o.unit || !o.date) continue;
    rows.push(o);
  }
  if (!rows.length) {
    throw new Error('the page was fetched but no quotes could be read from it — the ' +
      'publisher has probably changed their markup, and storing nothing would have ' +
      'frozen every price while reporting success');
  }
  return rows;
}

/** '$$ 3.60' -> { amount: 3.6, currency: 'USD' };  '৳ 124.00' -> BDT. */
function readPrice(s) {
  const amount = Number(String(s).replace(/[^0-9.]/g, ''));
  if (!(amount > 0)) return null;
  // The taka sign is U+09F3. Anything with a dollar sign is USD; everything
  // else in this feed is taka. A row matching neither is refused rather than
  // assumed, because assuming is how a taka price becomes a dollar price.
  if (/\$/.test(s)) return { amount, currency: 'USD' };
  if (/[৳৲]|BDT|Tk/i.test(s)) return { amount, currency: 'BDT' };
  return null;
}

function readUnit(s) {
  if (/^kg$/i.test(String(s).trim())) return 'KG';
  if (/lb|pound/i.test(String(s))) return 'LB';
  return null;
}

/** Everything to USD per kilogram, with the arithmetic left visible. */
function toUsdKg(amount, currency, unit) {
  let usd = amount;
  let fx = null;
  if (currency === 'BDT') {
    fx = FX.bdt_per_usd;
    usd = amount / fx;
  }
  // A price per pound buys fewer kilograms, so the per-kilo figure is HIGHER.
  const perKg = unit === 'LB' ? usd * LB_PER_KG : usd;
  return { price_usd_kg: Number(perKg.toFixed(4)), fx };
}

/**
 * One published row, translated — or a reason it was not.
 *
 * Rejections are returned rather than thrown so that one unreadable row cannot
 * discard the ninety that were fine, and so the reasons reach the admin panel
 * instead of a log nobody opens.
 */
function translate(o) {
  const label = String(o.count).trim();

  if (NOT_COSTED.some(re => re.test(label))) {
    return { skip: true, label, why: 'the engine has no matrix row for this product' };
  }

  let key = null;
  let note = null;
  let countNe = 0;
  for (const [re, mapped, n] of MAP) {
    const m = label.match(re);
    if (!m) continue;
    key = mapped;
    note = n || null;
    countNe = m[1] ? Number(m[1]) : 0;
    break;
  }
  if (!key) {
    return { reject: true, label, why: 'no matrix key matches this description' };
  }

  const p = readPrice(o.price);
  if (!p) return { reject: true, label, why: `price "${o.price}" has no readable currency` };
  const unit = readUnit(o.unit);
  if (!unit) return { reject: true, label, why: `unit "${o.unit}" is neither kg nor pound` };

  const { price_usd_kg, fx } = toUsdKg(p.amount, p.currency, unit);

  // Which of the two lists this row belongs to. The publisher does not label
  // them in the payload, but it does not need to: the LC list is quoted in
  // dollars per kilogram and the local cash list in taka per pound, and no row
  // has ever mixed them.
  const market = p.currency === 'USD' ? 'lc_usd' : 'local_bdt';

  // A yarn price outside this band is not a yarn price. Cotton has not traded
  // below a dollar or above twenty in the life of this business, and the band
  // is what catches a decimal point read in the wrong place — the one error
  // that produces a perfectly plausible-looking number.
  if (!(price_usd_kg >= 0.5 && price_usd_kg <= 25)) {
    return { reject: true, label,
      why: `${p.amount} ${p.currency}/${unit} works out at $${price_usd_kg}/kg, which is not a ` +
           'yarn price — a misread decimal or the wrong currency' };
  }

  const quotedOn = String(o.date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(quotedOn)) {
    return { reject: true, label, why: `date "${o.date}" is not a date` };
  }

  return {
    row: {
      source: SOURCE,
      market,
      item_key: key,
      count_ne: countNe,
      raw_label: `${label} — ${o.type || ''}`.trim().replace(/\s+—\s*$/, ''),
      price: p.amount,
      currency: p.currency,
      unit,
      price_usd_kg,
      fx_bdt_per_usd: fx,
      fx_source: fx ? FX.source : null,
      quoted_on: quotedOn,
      percent_change: typeof o.percent === 'number' ? o.percent : null,
    },
    note,
  };
}

/**
 * The gate. Nothing reaches the price table without passing it.
 *
 * This exists for the same reason the fibre extraction has one: a price that is
 * wrong in a plausible direction is worse than no price, because it will be
 * quoted to a customer. These are the checks that catch a feed that has been
 * restructured underneath us while still parsing cleanly.
 */
function gate(allRows) {
  const problems = [];

  // Every comparison below is WITHIN one list. Comparing across them is what
  // the first version did, and an LC price held against a local cash price
  // looks exactly like a feed that has been misread.
  for (const market of [...new Set(allRows.map(r => r.market))]) {
    problems.push(...gateOneMarket(allRows.filter(r => r.market === market), market));
  }
  if (allRows.length < 60) {
    problems.push(`only ${allRows.length} rows translated across both lists; the page normally ` +
      'carries about ninety costable ones, so it has probably been restructured');
  }
  return problems;
}

function gateOneMarket(rows, market) {
  const problems = [];
  const where = m => `${market}: ${m}`;

  // A count-bearing yarn must have a count in the range yarn is spun in.
  for (const r of rows) {
    if (r.count_ne && !(r.count_ne >= 4 && r.count_ne <= 120)) {
      problems.push(where(`${r.raw_label}: ${r.count_ne} Ne is outside the spinnable range`));
    }
  }

  // Finer yarn costs more, always: more drafting, more ends down, more waste.
  // A family where price falls as the count rises has had its columns crossed.
  const byKey = {};
  for (const r of rows) {
    if (!r.count_ne) continue;
    (byKey[r.item_key] = byKey[r.item_key] || []).push(r);
  }
  for (const [key, list] of Object.entries(byKey)) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.count_ne - b.count_ne);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (last.price_usd_kg <= first.price_usd_kg) {
      problems.push(where(`${key}: ${last.count_ne}Ne at $${last.price_usd_kg} is no dearer ` +
        `than ${first.count_ne}Ne at $${first.price_usd_kg} — finer yarn always costs more`));
    }
  }

  // Combed costs more than carded at the same count. It is an extra process
  // removing 15-20% of the fibre; there is no market in which it does not.
  for (const r of rows.filter(x => x.item_key === 'combed_regular')) {
    const carded = rows.find(x => x.item_key === 'carded_regular' && x.count_ne === r.count_ne);
    if (carded && r.price_usd_kg <= carded.price_usd_kg) {
      problems.push(where(`${r.count_ne}Ne: combed at $${r.price_usd_kg} is not dearer than ` +
        `carded at $${carded.price_usd_kg} — combing removes a fifth of the fibre and cannot ` +
        'be cheaper'));
    }
  }

  // Cotton costs more than the polyester blends of the same count, because
  // polyester is the cheaper fibre and the blend dilutes the cotton.
  for (const r of rows.filter(x => x.item_key === 'carded_regular')) {
    for (const blend of ['cvc_60_40', 'pc_65_35']) {
      const b = rows.find(x => x.item_key === blend && x.count_ne === r.count_ne);
      if (b && b.price_usd_kg > r.price_usd_kg) {
        problems.push(where(`${r.count_ne}Ne: ${blend} at $${b.price_usd_kg} is dearer than ` +
          `100% cotton at $${r.price_usd_kg} — the blend contains the cheaper fibre`));
      }
    }
  }

  // All quotes on one page should carry one date. A mixed page means the
  // publisher has left stale rows in among fresh ones and they cannot be
  // treated as one list.
  const dates = [...new Set(rows.map(r => r.quoted_on))];
  if (dates.length > 2) {
    problems.push(where(`the list carries ${dates.length} different quote dates ` +
      `(${dates.join(', ')}), so it is not one day's list`));
  }

  return problems;
}

/**
 * Fetch, translate, gate, store.
 *
 * @param {object} opts
 *   trigger  'manual' | 'schedule'
 *   force    run even if the last successful sync was inside the window
 *   fetchImpl injected in tests so nothing reaches the network
 */
async function syncYarnPrices(opts = {}) {
  const trigger = opts.trigger === 'manual' ? 'manual' : 'schedule';

  // The scheduled run is a no-op inside the window. The manual button is not:
  // someone pressing it has a reason, and making them wait a week is the
  // behaviour that gets a feature called broken.
  if (!opts.force && trigger === 'schedule') {
    const last = await queryOne(
      `SELECT started_at FROM yarn_price_syncs
        WHERE ok = true AND source = $1
        ORDER BY started_at DESC LIMIT 1`, [SOURCE]);
    if (last) {
      const days = (Date.now() - new Date(last.started_at).getTime()) / 86400000;
      if (days < REFRESH_DAYS) {
        return { ok: true, skipped: true, reason:
          `last successful sync was ${days.toFixed(1)} days ago; the window is ${REFRESH_DAYS}` };
      }
    }
  }

  const started = await queryOne(
    `INSERT INTO yarn_price_syncs (source, trigger) VALUES ($1, $2) RETURNING id`,
    [SOURCE, trigger]);
  const syncId = started.id;

  const fail = async (err) => {
    await query(
      `UPDATE yarn_price_syncs SET finished_at = now(), ok = false, error = $2 WHERE id = $1`,
      [syncId, String(err && err.message ? err.message : err).slice(0, 2000)]);
    return { ok: false, sync_id: syncId, error: String(err && err.message ? err.message : err) };
  };

  let published;
  try {
    published = parse(await fetchRaw(opts.fetchImpl));
  } catch (e) {
    return fail(e);
  }

  const rows = [];
  const rejections = [];
  let skipped = 0;
  for (const o of published) {
    const t = translate(o);
    if (t.skip) { skipped++; continue; }
    if (t.reject) { rejections.push({ label: t.label, why: t.why }); continue; }
    rows.push(t.row);
  }

  const problems = gate(rows);
  if (problems.length) {
    // A failing gate stores NOTHING. Half a price list is not a price list, and
    // the previous quotes are better than a partial new one.
    await query(
      `UPDATE yarn_price_syncs
          SET finished_at = now(), ok = false, rows_seen = $2, rows_rejected = $3,
              rejections = $4, error = $5
        WHERE id = $1`,
      [syncId, published.length, rejections.length,
       JSON.stringify(rejections), 'GATE FAILED — ' + problems.join(' | ')]);
    return { ok: false, sync_id: syncId, gate_failed: problems, stored: 0 };
  }

  let stored = 0;
  for (const r of rows) {
    // ON CONFLICT DO NOTHING: re-running on the same day is idempotent, and the
    // first read of a day's list is the one kept.
    const res = await query(
      `INSERT INTO yarn_price_quotes
         (source, market, item_key, count_ne, raw_label, price, currency, unit,
          price_usd_kg, fx_bdt_per_usd, fx_source, quoted_on, percent_change)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (source, market, item_key, count_ne, quoted_on) DO NOTHING
       RETURNING id`,
      [r.source, r.market, r.item_key, r.count_ne, r.raw_label, r.price, r.currency, r.unit,
       r.price_usd_kg, r.fx_bdt_per_usd, r.fx_source, r.quoted_on, r.percent_change]);
    if (res.length) stored++;
  }

  const newest = rows.map(r => r.quoted_on).sort().pop();
  await query(
    `UPDATE yarn_price_syncs
        SET finished_at = now(), ok = true, rows_seen = $2, rows_stored = $3,
            rows_rejected = $4, newest_quote = $5, rejections = $6
      WHERE id = $1`,
    [syncId, published.length, stored, rejections.length, newest,
     JSON.stringify(rejections)]);

  return {
    ok: true, sync_id: syncId, trigger,
    published: published.length,
    costable: rows.length,
    stored,
    not_costed: skipped,
    rejected: rejections,
    newest_quote: newest,
  };
}

module.exports = {
  syncYarnPrices,
  // Exported for the tests, which must be able to exercise the translation and
  // the gate without a network call.
  parse, translate, gate, gateOneMarket, toUsdKg, readPrice, readUnit,
  SOURCE, URL, REFRESH_DAYS, FX, MAP, NOT_COSTED,
};
