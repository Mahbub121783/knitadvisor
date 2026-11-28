/**
 * What is kept of one request, for judging the engines' accuracy — pure, no I/O.
 *
 *   toolFor(method, path)   which tool a request used, or null when it is not recorded (accounts, sign-in, saved
 *                           designs and pictures are never recorded)
 *   cleanInput(tool, body)  the request, without secrets, contact details, pictures or a buyer's prices, kept small
 *   summarise(tool, out)    the headline of the answer the person saw: counts, stitch lengths, gauge, weight, who
 *                           answered (work orders, loop model or engine), warnings
 */
'use strict';

const RECORDED = /^(calculate|striper|quality|cost|cost-sheet|carbon|garment|garment-costing|fabric-consumption|techpack|woven|parse|convert|weft|yarn|faults|dyeing|studio|assistant|scan|demo)(\/|$)/;
// saved things, uploads and settings: not questions put to an engine
const NEVER = /^(studio\/(designs|pool|floor\/machines|jacquard\/from-image)|cost-sheet\/sheets|garment\/(presets|spec\/read)|scan\/(debug|board|sessions|photo)|academy)(\/|$)/;
/** Tools that answer every change on screen: changes seconds apart are one visit, kept at where it ended. */
const LIVE = /^(studio\/|garment\/build|cost-sheet\/analyse|carbon|convert|weft)/;

function toolFor(method, path) {
  if (String(method).toUpperCase() !== 'POST') return null;
  const p = String(path || '').replace(/^\/+|\/+$/g, '').replace(/\/\d+(?=\/|$)/g, '');
  return RECORDED.test(p) && !NEVER.test(p) ? p.slice(0, 60) : null;
}
const isLive = (tool) => LIVE.test(tool);

const SECRET = /pass(word)?$|passwd|secret|token|otp|cookie|authorization|api_?key|session/i;
const CONTACT = /e-?mail|phone|mobile|whats_?app|address|contact_?(name|person)/i;
// a costing or a garment pack names a buyer and its money: none of that judges a fabric answer
const COMMERCIAL = /buyer|supplier|vendor|brand|customer|client|merchandiser|style_?(name|no|number|ref)|order_?(no|ref)|price|fob|margin|commission|overhead|profit|picture|image|logo|^notes?$/i;
const MAX_STRING = 300, MAX_ARRAY = 60, MAX_DEPTH = 8, MAX_KEYS = 80, MAX_BYTES = 12000;

function walk(v, depth, drop, limits) {
  if (v === null || v === undefined || typeof v === 'boolean') return v ?? null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (/^data:[a-z]+\//i.test(v)) return `(data, ${v.length} characters)`;
    return v.length > limits.string ? `${v.slice(0, limits.string)}…(${v.length} characters)` : v;
  }
  if (typeof v !== 'object') return null;
  if (Buffer.isBuffer(v)) return `(file, ${v.length} bytes)`;
  if (depth >= limits.depth) return '(deeper)';
  if (Array.isArray(v)) {
    const out = v.slice(0, limits.array).map((x) => walk(x, depth + 1, drop, limits));
    if (v.length > limits.array) out.push(`(${v.length - limits.array} more)`);
    return out;
  }
  const out = {};
  for (const k of Object.keys(v).slice(0, MAX_KEYS)) {
    if (SECRET.test(k) || CONTACT.test(k) || (drop && drop.test(k))) { out[k] = '(not kept)'; continue; }
    if (k === '__proto__') continue;
    out[k] = walk(v[k], depth + 1, drop, limits);
  }
  return out;
}

function cleanInput(tool, body) {
  const drop = /^(cost-sheet|garment|garment-costing|techpack)/.test(tool) ? COMMERCIAL : null;
  let limits = { string: MAX_STRING, array: MAX_ARRAY, depth: MAX_DEPTH };
  if (body === undefined || body === null) return {};
  let out = walk(typeof body === 'object' ? body : { value: body }, 0, drop, limits);
  for (const tighter of [{ string: 120, array: 20, depth: 5 }, { string: 60, array: 6, depth: 3 }]) {
    if (JSON.stringify(out).length <= MAX_BYTES) return out;
    limits = tighter; out = walk(body, 0, drop, limits);
  }
  const bytes = JSON.stringify(out).length;
  return bytes <= MAX_BYTES ? out : { too_large: true, keys: Object.keys(body || {}).slice(0, 30), bytes };
}

const num = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.round(+v * 1000) / 1000 : undefined);
const text = (v, n = 160) => (v === undefined || v === null || v === '' ? undefined : String(v).slice(0, n));
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));
const answeredBy = (r) => (!r ? 'engine' : r.model ? 'loop model' : 'work orders');
const recipeOf = (r) => (r ? compact({ cloth: r.cloth, ne: r.face && r.face.ne, sl: r.sl, gauge: r.gauge, orders: r.model ? undefined : r.orders }) : undefined);

function calculatorSummary(o) {
  const kp = o.knit_plan || {}, m = kp.machine || {}, y = o.yarn || {}, c = o.costing || {};
  return compact({
    fabric: o.fabric && o.fabric.id, gsm: num(o.input && o.input.gsm), composition: text(o.input && o.input.composition),
    count: text(y.count_display), ne: num(y.count_ne), gauge: num(m.gauge), dia: num(m.dia),
    sl_mm: num(o.loop_length && o.loop_length.value_mm) ?? num(kp.stitch_length && kp.stitch_length.used_mm),
    yarns: o.fleece && Array.isArray(o.fleece.yarns) ? o.fleece.yarns.map((x) => compact({ role: x.role, ne: num(x.ne), sl_mm: num(x.sl_mm) })) : undefined,
    by: answeredBy(o.recipe), recipe: recipeOf(o.recipe), source: text(y.source_confidence && y.source_confidence.label, 80),
    fabric_usd_kg: num(c.total_per_kg_usd), kg_day: num(kp.production && kp.production.kg_per_day),
    warnings: (o.warnings || []).slice(0, 8).map((w) => text(w, 200)),
  });
}

function studioSummary(o) {
  const f = o.fabric || {}, m = o.machine || {}, y = o.yarn || {}, s = o.structure || {};
  return compact({
    structure: text((s.match && s.match.name) || (s.identity && s.identity.title)), family: text(s.family, 30), confidence: text(s.confidence && s.confidence.level, 20),
    gsm: num(f.gsm), target_gsm: num(f.target_gsm), sl_mm: num(f.sl_mm), tf: num(f.tf), cpc: num(f.cpc), wpc: num(f.wpc), width_in: num(f.width_open_in),
    gauge: num(m.gauge), dia: num(m.dia), count: text(y.ground && y.ground.count, 40),
    yarns: (y.feeds || []).slice(0, 12).map((x) => compact({ role: x.role, yarn: text(x.yarn, 60), sl_mm: num(x.sl_mm) })),
    composition: o.composition_solve && o.composition_solve.achieved,
    by: answeredBy(o.recipe), recipe: recipeOf(o.recipe), knittable: o.ok_to_knit,
    warnings: (o.checks || []).filter((c) => c.level === 'warn' || c.level === 'error').slice(0, 8).map((c) => text(`${c.level}: ${c.text}`, 200)),
  });
}

/** Any other tool: the answer's plain figures, two levels deep. */
function plainSummary(o) {
  const out = {}; let n = 0;
  const take = (prefix, v, depth) => {
    for (const [k, x] of Object.entries(v)) {
      if (n >= 40 || SECRET.test(k) || CONTACT.test(k) || /trace|html|svg|pdf|image|data|sources?$|formulas?$/i.test(k)) continue;
      if (typeof x === 'number' || typeof x === 'boolean') { out[prefix + k] = x; n++; } else if (typeof x === 'string' && x.length <= 160) { out[prefix + k] = x; n++; } else if (x && typeof x === 'object' && !Array.isArray(x) && depth < 1) take(`${prefix}${k}.`, x, depth + 1);
    }
  };
  take('', o, 0);
  return out;
}

function summarise(tool, out) {
  if (!out || typeof out !== 'object') return {};
  if (out.success === false || (out.error && out.success !== true)) return compact({ error: text(out.error, 300), code: text(out.code, 40) });
  try {
    if (tool === 'calculate' && out.yarn) return calculatorSummary(out);
    if (tool === 'studio/analyse' && out.fabric) return studioSummary(out);
    const s = plainSummary(out);
    return JSON.stringify(s).length > 4000 ? { keys: Object.keys(out).slice(0, 30) } : s;
  } catch (err) { return { summary_failed: String(err.message).slice(0, 120) }; }
}

class FeedbackError extends Error {}
const VERDICTS = ['right', 'close', 'wrong'];
const FEEDBACK_TOOLS = ['calculate', 'studio/analyse'];
const ACTUAL = { count: 80, sl: 60, gauge: 20, dia: 20, gsm: 20, yarn: 120 };

/** A person's verdict on an answer, with what their floor runs where they say. */
function validateFeedback(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!FEEDBACK_TOOLS.includes(b.tool)) throw new FeedbackError('Say which answer this is about.');
  if (!VERDICTS.includes(b.verdict)) throw new FeedbackError('Choose right, close or wrong.');
  const actual = {};
  for (const [k, n] of Object.entries(ACTUAL)) {
    const v = b.actual && b.actual[k];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    actual[k] = String(v).trim().slice(0, n);
  }
  const note = String(b.note || '').trim().slice(0, 1000) || null;
  if (b.verdict === 'wrong' && !note && !Object.keys(actual).length) throw new FeedbackError('Tell us what your floor runs, or what is wrong, so it can be corrected.');
  return {
    tool: b.tool, verdict: b.verdict, actual, note,
    input: cleanInput(b.tool, b.input && typeof b.input === 'object' ? b.input : {}),
    shown: cleanInput(b.tool, b.shown && typeof b.shown === 'object' ? b.shown : {}),
  };
}

module.exports = { toolFor, isLive, cleanInput, summarise, validateFeedback, FeedbackError, VERDICTS, MAX_BYTES };
