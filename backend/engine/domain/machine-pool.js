/**
 * Learning across mills without sharing anything a mill would mind sharing.
 *
 * A mill that opts in contributes ONE number per structure (and per yarn-count band for
 * weight): how far its rolls fall from the Studio's prediction, as a mean of ln(measured ÷
 * predicted). Never a roll, a design, a machine, a name or a quantity — and what comes back
 * is the same kind of number from OTHER mills, used only to start a new machine off nearer
 * the truth than the factory records alone.
 *
 * The protections are in the rule, and each one is a test (tests/studio_pool.test.js):
 *
 *   k ≥ 5          a cell is used only when at least 5 different accounts have rolls in it
 *   own excluded   the account asking is never part of the number it receives
 *   capped         an account counts once per cell, by its mean — however many rolls it has —
 *                  and only from cells where it has at least 2 rolls (the last 20 of a structure)
 *   median         the cell's number is the MEDIAN of the accounts' means, so one odd mill
 *                  cannot drag it, and two cannot either until five have joined
 *   bounded        the number is clamped (weight ±10 %, width ±8 %) whatever the rolls say
 *   weighed        it enters the machine's own learning as a prior worth a/(a+5) of the
 *                  machine's K rolls (machine-learning.js), and any roll the machine logs
 *                  itself outweighs it more and more
 *
 * Not differential privacy: k-anonymity on a clamped median, which is the honest name for it.
 * Whether it HELPS cannot be measured until mills contribute: tools/studio-pool-check.js shows
 * on the factory records that it does no harm when mills agree with the model, recovers a bias
 * the mills share, and stays neutral when their biases are their own.
 */
'use strict';

const MIN_ACCOUNTS = 5, MIN_ROLLS = 2, CAP = 20, K_ACC = 5;
const BAND = Math.log(1.2);                         // a count band is ±~9 % wide — the same breadth the machine rule uses
const CLAMP = { gsm: 0.10, width: 0.08 };           // |ln factor| the pool may ever ask for

const bandOf = (ne) => (ne > 0 ? Math.round(Math.log(ne) / BAND) : null);
const okRatio = (v) => v > 0.5 && v < 2;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const clampLn = (v, c) => Math.max(-c, Math.min(c, v));
/** How much of the machine's K rolls' worth the pool is worth, from how many mills stand behind it. */
const weight = (accounts) => accounts / (accounts + K_ACC);

/**
 * rows: [{ user, group, ne, gsm_ratio, width_ratio }] — each account's most recent rolls (the repository
 * keeps the last CAP per account and structure). Returns the per-account sums, which is all the rest needs.
 */
function aggregate(rows) {
  const cells = { gsm: new Map(), width: new Map() };
  const add = (m, key, user, l) => {
    let c = m.get(key); if (!c) m.set(key, c = new Map());
    const u = c.get(user) || { sum: 0, n: 0 }; u.sum += l; u.n++; c.set(user, u);
  };
  const seen = new Map();
  for (const r of rows || []) {
    if (!r || r.user == null || typeof r.group !== 'string') continue;
    const k = `${r.user}|${r.group}`, c = seen.get(k) || 0;
    if (c >= CAP) continue; seen.set(k, c + 1);               // belt and braces: the cap holds even if the query changes
    if (okRatio(r.width_ratio)) add(cells.width, r.group, r.user, Math.log(r.width_ratio));
    const b = bandOf(r.ne);
    if (b != null && okRatio(r.gsm_ratio)) add(cells.gsm, `${r.group}|${b}`, r.user, Math.log(r.gsm_ratio));
  }
  return cells;
}

function cellFactor(accounts, user, clamp) {
  const means = [];
  let rolls = 0;
  for (const [u, s] of accounts) if (u !== user && s.n >= MIN_ROLLS) { means.push(s.sum / s.n); rolls += s.n; }
  if (means.length < MIN_ACCOUNTS) return null;
  return { f: Math.round(Math.exp(clampLn(median(means), clamp)) * 10000) / 10000, a: means.length, n: rolls };
}

/** What one account is told: the cells with ≥ 5 OTHER accounts, as a small table. */
function tableFor(cells, user) {
  const out = { gsm: [], width: [] };
  for (const [g, accs] of cells.width) { const c = cellFactor(accs, user, CLAMP.width); if (c) out.width.push({ group: g, ...c }); }
  for (const [key, accs] of cells.gsm) {
    const c = cellFactor(accs, user, CLAMP.gsm); if (!c) continue;
    const i = key.lastIndexOf('|'); out.gsm.push({ group: key.slice(0, i), band: +key.slice(i + 1), ...c });
  }
  const by = (a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : (a.band || 0) - (b.band || 0));
  out.gsm.sort(by); out.width.sort(by);
  return out.gsm.length || out.width.length ? out : null;
}

/** A table as the engine receives it, whoever sent it: shape-checked, bounded, and held to the same k. */
function cleanTable(t) {
  if (!t || typeof t !== 'object') return null;
  const clean = (arr, clamp, banded) => (Array.isArray(arr) ? arr.slice(0, 600) : []).filter((e) => e && typeof e.group === 'string' && e.group.length <= 40 && +e.f > 0.5 && +e.f < 2 && Number.isInteger(+e.a) && +e.a >= MIN_ACCOUNTS && (!banded || Number.isInteger(+e.band)))
    .map((e) => ({ group: e.group, ...(banded ? { band: +e.band } : {}), f: Math.exp(clampLn(Math.log(+e.f), clamp)), a: +e.a, n: Math.max(0, Math.round(+e.n) || 0) }));
  const gsm = clean(t.gsm, CLAMP.gsm, true), width = clean(t.width, CLAMP.width, false);
  return gsm.length || width.length ? { gsm, width } : null;
}

/** The pool's number for this structure and count: { gsm: {f, a, n}|null, width: {f, a, n}|null }. */
function lookup(table, group, ne) {
  if (!table) return { gsm: null, width: null };
  const b = bandOf(ne);
  return {
    gsm: b == null ? null : (table.gsm || []).find((e) => e.group === group && e.band === b) || null,
    width: (table.width || []).find((e) => e.group === group) || null,
  };
}

/** For the account's own screen: which structures the pool covers, and by how many mills. Nothing finer. */
function coverage(table) {
  const g = new Map();
  for (const e of [...(table ? table.width : []), ...(table ? table.gsm : [])]) g.set(e.group, Math.max(g.get(e.group) || 0, e.a));
  return [...g].map(([group, accounts]) => ({ group, accounts })).sort((a, b) => b.accounts - a.accounts);
}

module.exports = { aggregate, tableFor, cleanTable, lookup, coverage, bandOf, weight, MIN_ACCOUNTS, MIN_ROLLS, CAP, K_ACC, CLAMP };
