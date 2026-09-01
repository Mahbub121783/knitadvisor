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
 * This runs every configured price source, merges what they return, and stores
 * every quote with the date its publisher put on it.
 *
 * THE CHAIN, AND WHY IT HAS THREE LINKS
 * ------------------------------------
 *   1. a live quote from any connected source, freshest first
 *   2. failing that, the count read between two live quotes
 *   3. failing that, the fixed reference price list
 *
 * The third link is the one that makes the first two safe to attempt. A price
 * feed that can take the costing down with it is a feed nobody should connect,
 * so the fixed list is never removed and never stops being correct — it just
 * stops being the answer when something better is available, and says which it
 * was either way.
 *
 * MERGING TWO SOURCES. Where two sources quote the same item on the same day,
 * the tie is broken by SOURCE_PRIORITY below rather than by whichever happened
 * to be inserted first. Where they quote it on different days, the fresher one
 * wins regardless of priority: a better publisher's stale number is still a
 * stale number.
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

const emergingTextiles = require('./price-sources/emergingtextiles');

/**
 * Which source wins a tie on the same day.
 *
 * Lower is better. EmergingTextiles is placed first because it is a paid,
 * documented API covering many countries, against a free page scraped from
 * another company's markup — but the ordering only ever settles a same-day
 * tie, so a mistake here costs very little.
 */
const SOURCE_PRIORITY = { emergingtextiles: 1, texbazar: 2 };
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
  // Combed slub and card slub are 25-35 cents a kilo apart at every count, so
  // they are not one product with a note on it. The first version of this
  // mapped both to `carded_slub` on the reasoning that slub is slub, and the
  // identity check below caught it: ten rows claiming five identities, with the
  // insert silently keeping whichever landed first.
  //
  // `combed_slub` has no row in the engine's matrix, so nothing costs from it
  // yet; it is stored and shown rather than thrown away.
  [/^(\d+)\/s\s+combed\s+slub$/i, 'combed_slub'],
  [/^(\d+)\/s\s+card\s+slub$/i, 'carded_slub'],
  // BCI GETS ITS OWN KEYS, and the first version of this file got it wrong.
  //
  // "BCI combed" was mapped onto plain combed on the reasoning that Better
  // Cotton is a sourcing standard rather than a spinning route, so the yarn is
  // the same yarn. The page says otherwise: on 29 August 2026, 40/s carded was
  // $3.80 and 40/s carded BCI $3.70; 40/s combed $4.15 and BCI $3.95. They are
  // separately traded and separately priced.
  //
  // Mapping them together was therefore not a simplification, it was a
  // collision: two different prices claiming one identity, with the insert's
  // ON CONFLICT DO NOTHING silently keeping whichever arrived first.
  //
  // The costing engine has no BCI product today, so nothing looks these up and
  // they cost nothing to keep. They are stored and shown on the prices screen
  // rather than discarded, because throwing away real market data to avoid an
  // unused key is the worse trade — and the day the engine gains a BCI option
  // the history is already there.
  [/^(\d+)\/s\s+combed\s*\(bci\)$/i, 'combed_bci'],
  [/^(\d+)\/s\s+card\s*\(bci\)$/i, 'carded_bci'],
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
  /swing thread|sewing thread/i,  // plied, sold by ticket number, not a knitting yarn
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
  // Checked within each grade, because BCI combed must be held against BCI
  // carded — comparing it with the conventional row would be comparing two
  // separately traded products and the check would mean nothing.
  for (const [combedKey, cardedKey] of [['combed_regular', 'carded_regular'],
                                        ['combed_bci', 'carded_bci']])
  for (const r of rows.filter(x => x.item_key === combedKey)) {
    const carded = rows.find(x => x.item_key === cardedKey && x.count_ne === r.count_ne);
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
  // Two published rows must never claim one identity. Both times this has been
  // hit — BCI against plain, combed slub against card slub — every other check
  // passed: each price was plausible and each series was coherent. The loss
  // happens silently at the INSERT, where ON CONFLICT DO NOTHING keeps whichever
  // row arrived first, so it has to be caught before the insert.
  const claimed = new Map();
  for (const r of rows) {
    const id = `${r.item_key}/${r.count_ne}Ne`;
    const prev = claimed.get(id);
    if (prev && prev.raw_label !== r.raw_label) {
      problems.push(where(`"${prev.raw_label}" and "${r.raw_label}" both claim ${id} at ` +
        `$${prev.price_usd_kg} and $${r.price_usd_kg} — two products cannot share one key`));
    }
    claimed.set(id, r);
  }

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
/**
 * Every source, run independently.
 *
 * Independently is the point: one publisher changing their markup must not stop
 * the other from updating. A source that throws is recorded as failed and the
 * rest still store, because half a price list from a working source beats none.
 */
async function collectAll(opts = {}) {
  const results = [];

  // ── texbazar: a free public page, read from its markup ────────────────
  const tb = { source: SOURCE, configured: true, rows: [], rejected: [], skipped: 0 };
  try {
    const published = parse(await fetchRaw(opts.fetchImpl));
    tb.seen = published.length;
    for (const o of published) {
      const t = translate(o);
      if (t.skip) { tb.skipped++; continue; }
      if (t.reject) { tb.rejected.push({ label: t.label, why: t.why }); continue; }
      // Every texbazar row is a Bangladeshi price; the country is implicit in
      // the source and is made explicit here so the merge can key on it.
      tb.rows.push({ ...t.row, country: 'BD' });
    }
    const problems = gate(tb.rows);
    if (problems.length) {
      tb.ok = false;
      tb.error = 'GATE FAILED — ' + problems.join(' | ');
      // A failing gate stores NOTHING from this source. Half a price list is
      // not a price list, and last week's is better than a broken one.
      tb.rows = [];
    } else {
      tb.ok = true;
    }
  } catch (e) {
    tb.ok = false;
    tb.error = e.message;
    tb.rows = [];
  }
  results.push(tb);

  // ── emergingtextiles: a paid API, if a key has been configured ────────
  try {
    const et = await emergingTextiles.collect(opts);
    // Not configured is not a failure. A source that has never been connected
    // must not show as a red error every week, and must not be confused with
    // one that is connected and returning nothing.
    et.ok = et.configured ? !et.rejected.length || !!et.rows.length : null;
    et.seen = et.rows.length + et.rejected.length;
    results.push(et);
  } catch (e) {
    results.push({ source: emergingTextiles.SOURCE, configured: true, ok: false,
                   rows: [], rejected: [], error: e.message });
  }

  return results;
}

/**
 * Two sources' rows into one list.
 *
 * Fresher wins outright. Same day, the priority order settles it. Both are kept
 * in the database either way — the merge decides what the engine READS, not
 * what is stored, because a costing quoted last month has to stay explainable
 * and that needs the losing quote too.
 */
function mergeRows(all) {
  const best = new Map();
  const overlaps = [];
  for (const r of all) {
    const key = [r.country || 'BD', r.market, r.item_key, r.count_ne].join('|');
    const prev = best.get(key);
    if (!prev) { best.set(key, r); continue; }
    const fresher = r.quoted_on > prev.quoted_on;
    const sameDay = r.quoted_on === prev.quoted_on;
    const better = sameDay &&
      (SOURCE_PRIORITY[r.source] || 99) < (SOURCE_PRIORITY[prev.source] || 99);
    if (fresher || better) {
      overlaps.push({ key, kept: r.source, over: prev.source,
                      why: fresher ? 'fresher quote' : 'same day, higher priority source' });
      best.set(key, r);
    } else {
      overlaps.push({ key, kept: prev.source, over: r.source,
                      why: sameDay ? 'same day, higher priority source' : 'fresher quote' });
    }
  }
  return { rows: [...best.values()], overlaps };
}

async function syncYarnPrices(opts = {}) {
  const trigger = opts.trigger === 'manual' ? 'manual' : 'schedule';

  // The scheduled run is a no-op inside the window. The manual button is not:
  // someone pressing it has a reason, and making them wait a week is the
  // behaviour that gets a feature called broken.
  if (!opts.force && trigger === 'schedule') {
    const last = await queryOne(
      `SELECT started_at FROM yarn_price_syncs
        WHERE ok = true
        ORDER BY started_at DESC LIMIT 1`);
    if (last) {
      const days = (Date.now() - new Date(last.started_at).getTime()) / 86400000;
      if (days < REFRESH_DAYS) {
        return { ok: true, skipped: true, reason:
          `last successful sync was ${days.toFixed(1)} days ago; the window is ${REFRESH_DAYS}` };
      }
    }
  }

  // One row per RUN, not per source. Which sources took part is in the
  // per-source report the run returns and the dashboard prints.
  const started = await queryOne(
    `INSERT INTO yarn_price_syncs (source, trigger) VALUES ($1, $2) RETURNING id`,
    ['merged', trigger]);
  const syncId = started.id;


  const collected = await collectAll(opts);
  const merged = mergeRows(collected.flatMap(c => c.rows));

  // Every row every source returned, stored — not just the merged winners. A
  // costing quoted last month has to stay explainable, and that needs the
  // quote that lost the merge as much as the one that won it.
  const allRows = collected.flatMap(c => c.rows);

  const anyConfigured = collected.filter(c => c.configured);
  const anyWorked = anyConfigured.some(c => c.ok && c.rows.length);

  if (!anyWorked) {
    // Nothing usable came back. The previous quotes stay exactly where they
    // are and the fixed reference list goes on answering for anything they do
    // not cover — which is why this is recorded as a failed sync rather than
    // allowed to wipe the table.
    const why = anyConfigured.map(c => `${c.source}: ${c.error || c.reason || 'no rows'}`)
      .join(' | ') || 'no source is configured';
    await query(
      `UPDATE yarn_price_syncs
          SET finished_at = now(), ok = false, rows_seen = $2, rejections = $3,
              error = $4, sources = $5
        WHERE id = $1`,
      [syncId, collected.reduce((a, c) => a + (c.seen || 0), 0),
       JSON.stringify(collected.flatMap(c => c.rejected || [])), why.slice(0, 2000),
       JSON.stringify(sourceReport(collected))]);
    return { ok: false, sync_id: syncId, sources: sourceReport(collected), error: why, stored: 0 };
  }

  let stored = 0;
  for (const r of allRows) {
    const res = await query(
      `INSERT INTO yarn_price_quotes
         (source, country, market, item_key, count_ne, raw_label, price, currency, unit,
          price_usd_kg, fx_bdt_per_usd, fx_source, quoted_on, percent_change)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (source, country, market, item_key, count_ne, quoted_on) DO NOTHING
       RETURNING id`,
      [r.source, r.country || 'BD', r.market, r.item_key, r.count_ne, r.raw_label, r.price,
       r.currency, r.unit, r.price_usd_kg, r.fx_bdt_per_usd, r.fx_source, r.quoted_on,
       r.percent_change]);
    if (res.length) stored++;
  }

  const newest = allRows.map(r => r.quoted_on).sort().pop();
  const rejections = collected.flatMap(c =>
    (c.rejected || []).map(x => ({ ...x, source: c.source })));

  await query(
    `UPDATE yarn_price_syncs
        SET finished_at = now(), ok = true, rows_seen = $2, rows_stored = $3,
            rows_rejected = $4, newest_quote = $5, rejections = $6, sources = $8, error = $7
      WHERE id = $1`,
    [syncId, collected.reduce((a, c) => a + (c.seen || 0), 0), stored, rejections.length,
     newest, JSON.stringify(rejections),
     // A partial success is not a clean one. If one of two sources failed, the
     // row says so even though `ok` is true, because "it worked" and "all of it
     // worked" are different answers.
     collected.filter(c => c.configured && c.ok === false)
       .map(c => `${c.source}: ${c.error}`).join(' | ') || null,
     JSON.stringify(sourceReport(collected))]);

  return {
    ok: true, sync_id: syncId, trigger,
    sources: sourceReport(collected),
    published: collected.reduce((a, c) => a + (c.seen || 0), 0),
    costable: allRows.length,
    merged: merged.rows.length,
    overlaps: merged.overlaps,
    stored,
    not_costed: collected.reduce((a, c) => a + (c.skipped || 0), 0),
    rejected: rejections,
    newest_quote: newest,
  };
}

/** What each source did, in the shape the dashboard prints. */
function sourceReport(collected) {
  return collected.map(c => ({
    source: c.source,
    configured: c.configured,
    // null means "never connected" and is deliberately not false — a source
    // nobody has set up is not a source that is broken.
    ok: c.configured ? !!c.ok : null,
    rows: c.rows.length,
    rejected: (c.rejected || []).length,
    newest_quote: c.rows.length ? c.rows.map(r => r.quoted_on).sort().pop() : null,
    reason: c.reason || null,
    error: c.error || null,
  }));

}

module.exports = {
  syncYarnPrices,
  // Exported for the tests, which must be able to exercise the translation and
  // the gate without a network call.
  parse, translate, gate, gateOneMarket, toUsdKg, readPrice, readUnit,
  collectAll, mergeRows, sourceReport, SOURCE_PRIORITY,
  SOURCE, URL, REFRESH_DAYS, FX, MAP, NOT_COSTED,
};
