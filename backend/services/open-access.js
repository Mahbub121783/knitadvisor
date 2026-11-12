/**
 * ============================================================================
 * OPEN ACCESS — a switch in the admin panel that lets anyone use the tools
 * without an account, for an event, until a time the admin sets
 * ============================================================================
 *
 * Built for an exhibition day: visitors at the stand (and anyone the stand's QR
 * code reaches) use the calculator, the carbon footprint, the Studio, the
 * costing sheet, the scan and the yarn price desk straight away. When it is
 * off, nothing about the site changes.
 *
 * WHAT A GUEST CAN AND CANNOT DO
 *   - Every tool that COMPUTES is open, by scope (the admin picks the scopes).
 *   - Nothing a guest does is saved to anyone's account. A guest is user id 0,
 *     which no account has, so every "my designs / my sheets / my machines"
 *     read comes back empty and history is never written.
 *   - Saving, the account pages, API keys and the admin stay behind sign-in.
 *     A guest asking for one gets code GUEST_LOCKED (not AUTH_REQUIRED), so
 *     the page explains instead of throwing the visitor out to a sign-in form.
 *   - A guest has no daily quota; instead each address has an hourly ceiling,
 *     set in the panel, so one script cannot eat the event.
 *
 * WHERE THE SWITCH LIVES
 * A small JSON file in backend/tmp, not the database: every Passenger worker
 * reads the same file (checked every few seconds), it needs no migration, and
 * a deploy does not touch it (the FTP sync only deletes files it uploaded).
 * It switches itself off at the end time even if nobody remembers to.
 *
 * Usage is appended to one line-per-call log per day, with the address
 * reduced to a salted hash: enough to count visitors, not to identify them.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'tmp');
const FILE = path.join(DIR, 'open-access.json');
const logFile = (day) => path.join(DIR, `open-access-${day}.jsonl`);

const SCOPES = {
  calculator: { label: 'Fabric calculator and full result', routes: [
    ['POST', /^\/api\/(calculate|striper|quality|cost|garment-costing|fabric-consumption|techpack\/generate|woven\/calculate|parse)$/]] },
  carbon: { label: 'Carbon footprint', routes: [['POST', /^\/api\/carbon$/]] },
  studio: { label: 'Fabric Studio', routes: [
    ['GET', /^\/api\/studio\/(templates|designs|floor\/machines|calibration|pool)$/],
    ['POST', /^\/api\/studio\/(compile|invent|analyse|graph|yarn|fibre|process|twin|export|warp\/analyse)$/]] },
  costing: { label: 'Costing sheet', routes: [['GET', /^\/api\/cost-sheet\/(options|sheets)$/], ['POST', /^\/api\/cost-sheet\/(analyse|pdf)$/]] },
  scan: { label: 'Fabric scan', routes: [['POST', /^\/api\/scan\/analyse$/]] },
  yarn: { label: 'Yarn price desk', routes: [['GET', /^\/api\/yarn-prices\/desk$/]] },
};
const DEFAULTS = { enabled: false, until: null, label: 'Open Innovation', message: 'Use KnitAdvisor free today — no account needed.', scopes: Object.keys(SCOPES), per_hour: 300 };

let cache = { at: 0, mtime: 0, state: { ...DEFAULTS } };

function read() {
  const now = Date.now();
  if (now - cache.at < 3000) return cache.state;
  cache.at = now;
  try {
    const st = fs.statSync(FILE);
    if (st.mtimeMs !== cache.mtime) {
      cache.mtime = st.mtimeMs;
      cache.state = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    }
  } catch (_) { cache.state = { ...DEFAULTS }; }
  return cache.state;
}

function active(state) {
  const s = state || read();
  return !!s.enabled && (!s.until || Date.now() < Date.parse(s.until));
}

/** Which scope (tool) a request belongs to, if open access covers it. */
function toolFor(method, route, state) {
  const s = state || read();
  for (const id of s.scopes || []) {
    const sc = SCOPES[id];
    if (sc && sc.routes.some(([m, re]) => m === method && re.test(route))) return id;
  }
  return null;
}

const GUEST = Object.freeze({ id: 0, guest: true, email: null, full_name: 'Guest', username: null, plan: 'guest', is_paid: false });
function guestUser() { return { ...GUEST }; }

// per-address hourly ceiling, counted in this worker (the global API limiter still applies on top)
const hits = new Map();
function rateOk(ip, perHour) {
  const now = Date.now(), k = String(ip || 'unknown');
  const h = (hits.get(k) || []).filter((t) => now - t < 3600e3);
  if (h.length >= Math.max(10, perHour || DEFAULTS.per_hour)) { hits.set(k, h); return false; }
  h.push(now); hits.set(k, h);
  if (hits.size > 5000) for (const [kk, v] of hits) { if (!v.length || now - v[v.length - 1] > 3600e3) hits.delete(kk); }
  return true;
}

const SALT = process.env.IP_HASH_SALT || 'ka-open-access';
const dhakaDay = (t) => new Date((t || Date.now()) + 6 * 3600e3).toISOString().slice(0, 10);
function visitor(req) {
  return crypto.createHash('sha256').update(SALT + dhakaDay() + (req.ip || '')).digest('hex').slice(0, 12);
}

/** One line per guest call: time, hashed visitor, tool, route, device class. */
function log(req, tool, route) {
  const ua = String(req.headers['user-agent'] || '');
  const line = JSON.stringify({ t: Date.now(), v: visitor(req), tool, r: route, d: /Mobi|Android|iPhone/i.test(ua) ? 'phone' : 'desktop' }) + '\n';
  fs.appendFile(logFile(dhakaDay()), line, () => {});
}

/** The admin's settings, checked and written atomically. */
function set(input) {
  const cur = read();
  const next = { ...cur };
  if (typeof input.enabled === 'boolean') {
    if (input.enabled && !cur.enabled) next.started_at = new Date().toISOString();
    if (!input.enabled && cur.enabled) next.ended_at = new Date().toISOString();
    next.enabled = input.enabled;
  }
  if ('until' in input) {
    const u = input.until ? Date.parse(input.until) : null;
    if (input.until && !Number.isFinite(u)) throw new Error('The end time is not a valid date.');
    if (u && u <= Date.now() && next.enabled) throw new Error('The end time is already past.');
    next.until = u ? new Date(u).toISOString() : null;
  }
  if (typeof input.label === 'string') next.label = input.label.trim().slice(0, 60) || DEFAULTS.label;
  if (typeof input.message === 'string') next.message = input.message.trim().slice(0, 200) || DEFAULTS.message;
  if (Array.isArray(input.scopes)) {
    next.scopes = input.scopes.filter((s) => SCOPES[s]);
    if (!next.scopes.length && next.enabled) throw new Error('Pick at least one tool to open.');
  }
  if (input.per_hour != null) {
    const n = parseInt(input.per_hour, 10);
    if (!(n >= 10 && n <= 5000)) throw new Error('The hourly limit must be between 10 and 5000 calls per visitor.');
    next.per_hour = n;
  }
  next.updated_at = new Date().toISOString();
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, FILE);
  cache = { at: 0, mtime: 0, state: cache.state };
  return read();
}

/** What any visitor may know: is it open, until when, what for. */
function publicStatus() {
  const s = read();
  if (!active(s)) return { active: false };
  return { active: true, label: s.label, message: s.message, until: s.until, tools: (s.scopes || []).map((id) => ({ id, label: SCOPES[id] ? SCOPES[id].label : id })) };
}

/** Usage for the admin: today's calls (Dhaka day), visitors, tools, hours, the latest calls. */
function stats() {
  const day = dhakaDay();
  let rows = [];
  try { rows = fs.readFileSync(logFile(day), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); } catch (_) {}
  const now = Date.now(), by = {}, hours = new Array(24).fill(0), visitors = new Set(), recent = new Set(), devices = { phone: 0, desktop: 0 };
  for (const r of rows) {
    by[r.tool] = (by[r.tool] || 0) + 1;
    hours[new Date(r.t + 6 * 3600e3).getUTCHours()]++;
    visitors.add(r.v);
    if (now - r.t < 10 * 60e3) recent.add(r.v);
    devices[r.d === 'phone' ? 'phone' : 'desktop']++;
  }
  const s = read();
  return {
    day, calls: rows.length, visitors: visitors.size, active_now: recent.size, devices,
    by_tool: Object.keys(SCOPES).map((id) => ({ id, label: SCOPES[id].label, calls: by[id] || 0 })),
    hours, latest: rows.slice(-25).reverse().map((r) => ({ t: new Date(r.t).toISOString(), tool: r.tool, route: r.r, device: r.d, visitor: r.v.slice(0, 6) })),
    state: { ...s, active: active(s) }, scopes: Object.keys(SCOPES).map((id) => ({ id, label: SCOPES[id].label })),
  };
}

module.exports = { read, active, toolFor, guestUser, rateOk, log, set, publicStatus, stats, SCOPES, FILE };
