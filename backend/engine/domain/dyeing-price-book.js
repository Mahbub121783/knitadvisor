/**
 * KnitAdvisor — Dyeing Chemical Price Book
 * ==========================================
 *
 * An editable, dated OVERRIDE layer on top of the frozen recipe prices in
 * dyeing-reference.json (021_dyeing_reference.sql / dyeing-engine.js). Same
 * shape as engine/reference/index.js and the yarn-price repository: load()
 * reads dyeing_chemical_prices (022_dyeing_chemical_prices.sql) ONCE into a
 * frozen in-memory map, get() reads that map synchronously — never the DB —
 * so calculateDyeingCost() stays a hard synchronous invariant. reload() is
 * called by the admin panel right after a price edit, so the change is live
 * immediately, no restart (same pattern as the yarn-price refresh button).
 *
 * If the database is unreachable, load() leaves the map empty rather than
 * throwing — every lookup then misses, and calculateDyeingCost() falls back
 * to each recipe's own original extracted price, which is exactly today's
 * behaviour. An override is a bonus when available, never a dependency.
 *
 * NOT every chemical in dyeing-reference.json has a row here: 5 of the 37
 * named/priced chemicals appear at genuinely different prices across
 * different recipe cards (e.g. "Masquol P210" at 40/20/256 Tk/kg in three
 * recipes) — see 022_dyeing_chemical_prices.sql's header. Those are left
 * out of the backfill on purpose; get() correctly returns undefined for
 * them until an admin deliberately adds a unified price.
 */
'use strict';

let snapshot = Object.freeze({});
let loadedAt = null;
let lastError = null;

/**
 * Load (or reload) the override map. Call once at boot, before the server
 * listens, and again from the admin panel after any price edit.
 */
async function load() {
  let db;
  try {
    db = require('../../db/client');
  } catch (err) {
    lastError = `db/client unavailable: ${err.message}`;
    snapshot = Object.freeze({});
    return snapshot;
  }

  try {
    const rows = await db.query('SELECT chemical_name, unit_price_tk, updated_at FROM dyeing_chemical_prices');
    const map = {};
    for (const r of rows) {
      map[r.chemical_name] = Object.freeze({
        unit_price_tk: Number(r.unit_price_tk),
        updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      });
    }
    snapshot = Object.freeze(map);
    loadedAt = new Date();
    lastError = null;
  } catch (err) {
    // Table may not exist yet on a checkout that hasn't run migration 022 —
    // degrade to "no overrides" rather than crashing boot.
    lastError = `dyeing_chemical_prices read failed: ${err.message}`;
    snapshot = Object.freeze({});
  }
  return snapshot;
}

/** Re-read from the database. Used by the admin panel right after a price edit. */
const reload = () => load();

/** @returns {{unit_price_tk:number, updated_at:string|null}|undefined} */
function get(chemicalName) {
  if (!chemicalName) return undefined;
  return snapshot[chemicalName];
}

const status = () => ({
  loaded_at: loadedAt,
  last_error: lastError,
  overrides: Object.keys(snapshot).length,
});

module.exports = { load, reload, get, status };
