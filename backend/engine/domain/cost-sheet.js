/**
 * KnitAdvisor — Garment cost sheet (buyer quotation format)
 * =========================================================
 *
 * The quotation sheet a knit garment factory sends a buyer: fabric shells,
 * trims, embellishment, wash, CM, packaging, testing and the commission /
 * profit mark-up, costed SIZE BY SIZE for the sizes the user declares.
 *
 * Every conversion price comes from the system unless the user types their
 * own, and each one says where it came from and how old it is:
 *
 *   yarn            the market quote for that yarn and count (live feed), else
 *                   the dated reference list — the same chain as the calculator
 *   knitting, dyeing  the charge book (vendor sheet) for the fabric, count and shade
 *   finishing       the wet-cost model's finishing lines for the fabric
 *   process loss    the wet-cost model's loss for the shade band and fibres
 *
 * Fabric price per kg, two ways — both shown, the user picks which to quote:
 *   sheet     (yarn + yarn dyeing + knitting + dyeing + finishing) × (1 + loss)
 *             — the usual buyer-sheet arithmetic
 *   exact     the same ÷ (1 − loss): the finished kilo has to carry the cost of
 *             every grey kilo bought for it. At 20 % loss the sheet form is
 *             1.20×, the exact form 1.25× — about 4 % of the fabric cost.
 *
 * Per size: Σ shells (fabric price × consumption) + trims + embellishment +
 * wash + CM + packaging + testing = subtotal; × (1 + Σ mark-ups) = FOB per
 * piece; × pack of = FOB per pack; × 12 = per dozen.
 *
 * On top: order mix (size ratio × quantity → weighted FOB, order value, fabric
 * and yarn to book), target price per size (margin left or the gap), and what
 * a 10 % move in yarn, dyeing or consumption does to the FOB.
 */
'use strict';

const costing = require('./costing-engine');
const chargeBook = require('./charge-book');
const wet = require('./wet-cost-model');
const { parseComposition } = require('./composition-engine');
const studio = require('./fabric-studio');
const fleece = require('./fleece-engine');
const plush = require('./terry-engine');

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;
const num = (v) => (v === '' || v == null || !Number.isFinite(+v) ? null : +v);
const pos = (v) => { const n = num(v); return n != null && n >= 0 ? n : null; };

class SheetError extends Error {}
const LIMITS = { sizes: 12, shells: 8, lines: 30 };
const SHADES = ['white', 'light_medium', 'dark_navy', 'black', 'neon', 'melange'];

function sizesOf(input) {
  const raw = Array.isArray(input.sizes) ? input.sizes.map((s) => String(s || '').trim()).filter(Boolean) : [];
  if (!raw.length) throw new SheetError('Declare at least one size (e.g. 3Y-6Y, S, M, L).');
  if (raw.length > LIMITS.sizes) throw new SheetError(`At most ${LIMITS.sizes} sizes on one sheet.`);
  if (new Set(raw.map((s) => s.toLowerCase())).size !== raw.length) throw new SheetError('Each size must be named once.');
  return raw.map((s) => s.slice(0, 20));
}

// a value per size: one number for all, or an array with one per size
function perSize(v, n, what) {
  if (Array.isArray(v)) {
    const out = v.slice(0, n).map((x) => pos(x));
    while (out.length < n) out.push(null);   // a size with no figure is 0, and the sheet says so
    return out.map((x) => (x == null ? 0 : x));
  }
  const x = pos(v);
  if (v != null && v !== '' && x == null) throw new SheetError(`${what}: enter a number of 0 or more.`);
  return Array(n).fill(x == null ? 0 : x);
}

// ── the count a fabric of this GSM is knitted with ──────────────────────
// The Fabric Studio's setting search on the fabric's own needle programme:
// every commercial count on every gauge that suits it, kept inside the
// factory's tightness-factor window, gauge fit and hook load, nearest the
// factory median. Memoised: the same fabric and GSM come back on every keystroke.
const autoCache = new Map();
const STUDIO_FIBRE = { cotton: 'cotton', polyester: 'polyester_spun', viscose: 'viscose', modal: 'modal' };
function autoCount(fabricId, gsm, fiber) {
  if (!(gsm >= 60)) return null;
  const key = `${fabricId}|${Math.round(gsm)}|${fiber || ''}`;
  if (autoCache.has(key)) return autoCache.get(key);
  let out = null;
  const t = studio.listTemplates().find((x) => x.id === fabricId);
  if (t) {
    const r = studio.analyse({ bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((role) => ({ role })), yarn: { fibre: STUDIO_FIBRE[fiber] || 'cotton' }, target: { gsm }, machine: {} });
    if (r.success && r.yarn && r.yarn.ground) {
      const best = r.solver && r.solver.options && r.solver.options[0];
      const ne = Math.round(590.5 / r.yarn.ground.tex);
      out = { count: ne, label: `auto: ${ne}s for ${Math.round(gsm)} GSM ${fabricId.replace(/_/g, ' ')}${best ? ` (${best.gauge} GG, ${best.sl_mm} mm stitch)` : ''}`, reachable: !r.solver || r.solver.verdict.level === 'ok' };
    }
  }
  if (autoCache.size > 500) autoCache.clear();
  autoCache.set(key, out);
  return out;
}

// ── the yarns a fabric is knitted from, by role ─────────────────────────
// A fleece is three yarns (face, binder, loop) in the shares the factory's
// real orders show, a plush is ground + pile, an elastane rib is cotton +
// spandex in the declared blend. Costing one count at the whole fabric's
// weight prices it wrong; each role is priced at its own count and share.
const FLEECY = ['fleece_2_thread', 'fleece_3_thread', 'fleece_diagonal', 'french_terry'];
const PLUSH = ['terry_fabric', 'velour_plush'];
const DOUBLE = /rib|interlock|milano|cardigan|ponte|eight_lock|gabardine|poplin|swiss|french_double|bourrelet|texipique|pique_interlock|blister_single|relief/;

// the spun row that prices a yarn of this blend (shares of the non-elastane part)
function spunKey(f, ne) {
  const T = Object.entries(f).filter(([k]) => !/elastane|spandex|lycra/.test(k)).reduce((t, [, v]) => t + v, 0) || 100;
  const c = (f.cotton || 0) / T, py = (f.polyester || 0) / T, v = ((f.viscose || 0) + (f.bamboo || 0)) / T, mo = (f.modal || 0) / T;
  if (c >= 0.95) return ne >= 20 ? 'combed_regular' : 'carded_regular';
  if (py >= 0.95) return 'polyester_spun';
  if (v + mo >= 0.95) return 'viscose_regular';
  if (mo >= 0.4 && c >= 0.4) return 'cotton_modal_50_50';
  if (v >= 0.4 && c >= 0.4) return 'cotton_viscose_50_50';
  if (py >= 0.55 && v >= 0.25) return 'pv_65_35';
  if (py >= 0.55) return 'pc_65_35';
  if (c >= 0.7) return 'cvc_80_20';
  return 'cvc_60_40';
}
const filamentKey = (den) => ['filament_75d', 'filament_100d', 'filament_150d'].reduce((b, k) => (Math.abs(+k.match(/\d+/)[0] - den) < Math.abs(+b.match(/\d+/)[0] - den) ? k : b), 'filament_75d');
const spandexKey = (den) => ['spandex_20d', 'spandex_30d', 'spandex_40d', 'spandex_70d'].reduce((b, k) => (Math.abs(+k.match(/\d+/)[0] - den) < Math.abs(+b.match(/\d+/)[0] - den) ? k : b), 'spandex_40d');

function autoYarns(sh, fibers, comp) {
  const fabricId = String(sh.fabric || 'single_jersey');
  const gsm = pos(sh.gsm);
  if (!(gsm >= 60)) return null;
  const el = comp && comp.elastane_pct ? +comp.elastane_pct : 0;
  // a yarn named in a role line: "30/1 cotton", "150D polyester filament", "14/1 CVC 60/40"
  const fromLine = (y, role) => {
    const label = String(y.label || '');
    if (y.denier || /filament/i.test(label)) {
      const den = +y.denier || Math.round(5315 / (+y.ne || 35));
      return { role, type: filamentKey(den), share_pct: +y.share_pct, label };
    }
    const ne = Math.round(+y.ne);
    const f = /cvc|pc|poly/i.test(label) && !/^\d+\/1 (100% )?cotton/i.test(label) ? fibers : { cotton: 100 };
    return { role, type: spunKey(f, ne), count: ne, share_pct: +y.share_pct, label };
  };
  try {
    if (FLEECY.includes(fabricId)) {
      const r = fleece.analyzeFleece({ fabricId, gsm, gauge: 20, composition: comp });
      const lines = (r && r.yarns || []).filter((y) => y.role !== 'elastane' && +y.share_pct > 0).map((y) => fromLine(y, y.role));
      if (lines.length) return { lines, basis: 'fleece engine: face, binder and loop counts and shares from the factory\'s real fleece and terry orders' };
    }
    if (PLUSH.includes(fabricId)) {
      const r = plush.analyzePlushTerry({ fabricId, gsm, gauge: 20, composition: comp, cut: fabricId === 'velour_plush' });
      const lines = (r && r.yarns || []).filter((y) => y.role !== 'elastane' && +y.share_pct > 0).map((y) => fromLine(y, y.role === 'pile' ? 'pile' : 'ground'));
      if (lines.length) return { lines, basis: 'plush model: ground and pile plated at the factory terry tightness' };
    }
  } catch (_) { /* fall through to the single-yarn plan */ }
  // one spun yarn at the studio's count, plus the declared elastane as spandex
  const auto = autoCount(fabricId, gsm, 'cotton');
  if (!auto) return null;
  const lines = [{ role: 'ground', type: spunKey(fibers, auto.count), count: auto.count, share_pct: Math.round((100 - el) * 10) / 10 }];
  if (el > 0) lines.push({ role: 'elastane', type: spandexKey(DOUBLE.test(fabricId) ? 40 : 20), share_pct: el });
  return { lines, basis: auto.label + (el ? ` + ${el}% spandex as declared` : '') };
}

// ── system prices ─────────────────────────────────────────────────────────
function yarnLine(y, live, i, shell, auto) {
  const key = String(y.type || '');
  const row = costing.SM_PRICE_MATRIX[key];
  if (!row) throw new SheetError(`${shell}: yarn ${i + 1} — choose a yarn type.`);
  const share = pos(y.share_pct);
  if (!(share > 0)) throw new SheetError(`${shell}: yarn ${i + 1} — give its share of the fabric (%).`);
  const denier = row.price !== undefined;
  const typed = pos(y.count);
  // an empty count is the fabric's own: worked out from the fabric and its GSM
  const count = denier ? (row.denier || null) : typed > 0 ? typed : auto ? auto.count : null;
  if (!denier && !(count > 0)) throw new SheetError(`${shell}: yarn ${i + 1} (${row.label}) — give the count (Ne), or the fabric's GSM to choose it automatically.`);
  if (!denier && !(typed > 0) && !auto) throw new SheetError(`${shell}: yarn ${i + 1} — give the count (Ne).`);
  const countSource = denier ? null : typed > 0 ? { kind: 'yours', label: 'your count' } : { kind: 'system', label: auto.label };
  // the system's price is worked out even when one is typed, so the page can
  // always offer it back
  const own = pos(y.price);
  const r = costing.resolveYarnPrice(key, count || 0, live, 'BD');
  const ps = r.price_source;
  const sysSource = r.price == null ? null : ps.kind.startsWith('market')
    ? { kind: 'market', label: `market quote ${ps.last_updated}${ps.freshness === 'stale' ? ' (stale)' : ''}`, date: ps.last_updated }
    : { kind: 'reference', label: `reference list ${ps.last_updated}`, date: ps.last_updated };
  let price, source;
  if (own != null && own > 0) { price = own; source = { kind: 'yours', label: 'your price' }; }
  else {
    if (r.price == null) throw new SheetError(`${shell}: no price for ${row.label}${count ? ` ${count}s` : ''} — type the price.`);
    price = r.price; source = sysSource;
  }
  return { role: y.role || null, type: key, label: row.label, count: denier ? null : count, count_source: countSource, denier: denier ? row.denier : null, share_pct: share, price: r4(price), source,
    system_price: r.price == null ? null : r4(r.price), system_source: sysSource, fiber: row.fiber };
}

function shellPrices(sh, live, idx) {
  const name = String(sh.name || `Shell ${idx + 1}`).slice(0, 60);
  const comp0 = parseComposition(sh.composition || '100% cotton');
  const fibers0 = comp0 && comp0.fibers && Object.keys(comp0.fibers).length ? comp0.fibers : { cotton: 100 };
  let plan = null;
  if (sh.yarn_mode === 'auto') {
    plan = autoYarns(sh, fibers0, comp0);
    if (!plan) throw new SheetError(`${name}: give the fabric's GSM so its yarns can be worked out, or switch to your own yarns.`);
  }
  const yarnsIn = plan ? plan.lines.map((l) => ({ ...l, auto_line: true })) : (Array.isArray(sh.yarns) ? sh.yarns : []).slice(0, 6);
  // the main (largest-share, spun) yarn sets the fibre the count is chosen for
  const lead = yarnsIn.filter((y) => costing.SM_PRICE_MATRIX[y.type] && costing.SM_PRICE_MATRIX[y.type].price === undefined).sort((a, b) => (pos(b.share_pct) || 0) - (pos(a.share_pct) || 0))[0];
  const auto = pos(sh.gsm) ? autoCount(String(sh.fabric || 'single_jersey'), pos(sh.gsm), lead && costing.SM_PRICE_MATRIX[lead.type].fiber) : null;
  const yarns = yarnsIn.map((y, i) => {
    const line = yarnLine(y, live, i, name, auto);
    if (y.auto_line && line.count) line.count_source = { kind: 'system', label: plan.basis };
    return line;
  });
  if (!yarns.length) throw new SheetError(`${name}: add at least one yarn.`);
  const shareTot = yarns.reduce((t, y) => t + y.share_pct, 0);
  if (Math.abs(shareTot - 100) > 0.6) throw new SheetError(`${name}: yarn shares add up to ${r2(shareTot)}%, not 100%.`);
  const yarnPrice = yarns.reduce((t, y) => t + y.price * y.share_pct / 100, 0);

  const comp = parseComposition(sh.composition || yarns.map((y) => `${y.share_pct}% ${y.fiber || 'cotton'}`).join(' '));
  const fibers = comp && comp.fibers && Object.keys(comp.fibers).length ? comp.fibers : { cotton: 100 };
  // the knitting tier follows the face / ground yarn, not a fleece's coarse loop
  const counted = yarns.filter((y) => y.count);
  const mainCount = (counted.find((y) => y.role === 'face' || y.role === 'ground') || counted.sort((a, b) => b.share_pct - a.share_pct)[0] || {}).count || 30;
  const shade = SHADES.includes(sh.shade) ? sh.shade : 'light_medium';
  const fabricId = String(sh.fabric || 'single_jersey');
  const notes = [];

  const q = chargeBook.quote({
    fabricId, fibers, countNe: mainCount, shade: shade === 'white' ? 'white_melange' : shade === 'melange' ? 'white_melange' : shade,
    twoPart: !!sh.two_part, stripeType: sh.stripe === 'engineering' || sh.stripe === 'feeder' ? sh.stripe : null,
    feederType: sh.elastane_feed === 'ff' ? 'ff' : 'hf', brushed: !!sh.brushed,
  });
  if (q.ok && q.notes && q.notes.length) notes.push(...q.notes);
  const sys = (v, label) => (v == null ? null : { value: r4(v), source: { kind: 'system', label } });
  // a warp design from the Studio: the charge book is a circular-knit sheet, so it has no knitting rate for warp
  // goods (it would quietly price a locknit as single jersey) — the knitting price is the user's to type
  const isWarp = !!sh.warp;
  const knitSys = !isWarp && q.ok && q.knit ? sys(q.knit.usd, `charge book · ${q.vendor.name} · ${q.knit.tier}`) : null;
  if (isWarp) {
    const at = notes.findIndex((n) => /is not on the charge sheet/.test(n));
    if (at > -1) notes.splice(at, 1);
    notes.push("Warp knitting has no rate in the charge book: type the knitting price per kg. Dyeing is the charge book's figure for this fibre and shade and finishing the finishing model's — check both against your dyehouse for warp goods.");
  }
  const dyeSys = q.ok && q.dye ? sys(q.dye.usd, `charge book · ${q.vendor.name} · ${q.dye.tier.replace('_', '/')} ${q.dye.part}-part`) : null;

  const fin = wet.finishingCharge({ fibers, fabricId, gsm: pos(sh.gsm), brushed: !!sh.brushed, surfaceFinish: sh.surface_finish || '' });
  const finSys = sys(fin.per_kg, `finishing model · ${fin.lines.map((l) => l.item.split(' — ')[0]).join(' + ')}`);
  const loss = wet.processLoss({
    segment: shade === 'black' || shade === 'dark_navy' ? 'dark' : shade === 'white' || shade === 'melange' ? 'light' : 'medium',
    chem: shade === 'white' ? 'bleach' : shade === 'melange' ? 'scour' : 'dye', fibers, twoPart: !!sh.two_part,
    processes: [sh.aop ? 'aop' : null, sh.brushed ? 'brush' : null].filter(Boolean),
  });
  const lossSys = { value: r2(loss.loss_pct), source: { kind: 'system', label: `loss model · ${loss.segment} shades` } };

  // a typed price wins and says so; otherwise the system's, or 0 with a note
  const pick = (own, sysv, what) => {
    const o = pos(own);
    if (o != null && own !== '') return { value: o, source: { kind: 'yours', label: 'your price' } };
    if (sysv) return sysv;
    notes.push(`No system price for ${what} — type it.`);
    return { value: 0, source: { kind: 'missing', label: 'not priced' } };
  };
  const knit = pick(sh.knit_price, knitSys, 'knitting');
  const dye = pick(sh.dye_price, dyeSys, 'dyeing');
  const finish = pick(sh.finish_price, finSys, 'finishing');
  const yarnDye = { value: pos(sh.yarn_dye_price) || 0, source: { kind: pos(sh.yarn_dye_price) ? 'yours' : 'none', label: pos(sh.yarn_dye_price) ? 'your price' : 'none' } };
  const aop = { value: pos(sh.aop_price) || 0, source: { kind: pos(sh.aop_price) ? 'yours' : 'none', label: pos(sh.aop_price) ? 'your price' : 'none' } };
  const lossPick = pos(sh.loss_pct) != null && sh.loss_pct !== ''
    ? { value: pos(sh.loss_pct), source: { kind: 'yours', label: 'your figure' } } : lossSys;
  if (lossPick.value >= 60) throw new SheetError(`${name}: process loss must be under 60%.`);

  const base = yarnPrice + yarnDye.value + knit.value + dye.value + finish.value + aop.value;
  const L = lossPick.value / 100;
  const sheetKg = base * (1 + L), exactKg = base / (1 - L);
  return {
    name, application: String(sh.application || '').slice(0, 80), composition: comp ? comp.display : '', fabric: fabricId, warp: isWarp,
    gsm: pos(sh.gsm), shade, yarns,
    prices: {
      yarn: { value: r4(yarnPrice), source: { kind: 'blend', label: yarns.map((y) => `${y.share_pct}% ${y.label.replace(/^100% /, '')}${y.count ? ' ' + y.count + 's' : ''} @ $${y.price} (${y.source.label})`).join(' + ') } },
      yarn_dyeing: yarnDye, knitting: knit, dyeing: dye, finishing: finish, aop, loss_pct: lossPick,
    },
    system: { knitting: knitSys, dyeing: dyeSys, finishing: finSys, loss_pct: lossSys, charge_item: q.ok ? q.item.label : null, alternatives: q.ok ? q.alternatives.slice(0, 4) : [] },
    base_per_kg: r4(base), sheet_per_kg: r4(sheetKg), exact_per_kg: r4(exactKg), notes, auto_count: auto,
    yarn_mode: plan ? 'auto' : 'manual', yarn_plan_basis: plan ? plan.basis : null,
  };
}

function lines(list, n, what) {
  return (Array.isArray(list) ? list : []).slice(0, LIMITS.lines)
    .map((l, i) => ({ name: String(l.name || `${what} ${i + 1}`).slice(0, 60), values: perSize(l.values != null ? l.values : l.value, n, `${what} "${l.name || i + 1}"`) }))
    .filter((l) => l.name);
}
const sumLines = (ls, n) => Array.from({ length: n }, (_, k) => ls.reduce((t, l) => t + l.values[k], 0));

// ── the sheet ─────────────────────────────────────────────────────────────
function build(input, opts = {}) {
  const sizes = sizesOf(input);
  const n = sizes.length;
  const method = input.loss_method === 'exact' ? 'exact' : 'sheet';
  const shellsIn = Array.isArray(input.shells) ? input.shells.slice(0, LIMITS.shells) : [];
  if (!shellsIn.length) throw new SheetError('Add at least one fabric shell.');

  const shells = shellsIn.map((sh, i) => {
    const p = shellPrices(sh, opts.live, i);
    const unit = sh.consumption_unit === 'dozen' ? 'dozen' : 'pc';
    const cons = perSize(sh.consumption, n, `${p.name} consumption`).map((c) => (unit === 'dozen' ? c / 12 : c));
    const kg = method === 'exact' ? p.exact_per_kg : p.sheet_per_kg;
    return { ...p, consumption_kg_pc: cons.map(r4), price_per_kg: kg, cost: cons.map((c) => r4(c * kg)) };
  });
  const fabric = Array.from({ length: n }, (_, k) => shells.reduce((t, s) => t + s.cost[k], 0));

  const trims = lines(input.trims, n, 'Trim');
  const emb = lines(input.embellishments, n, 'Embellishment');
  const wash = lines(input.washes, n, 'Wash');
  const pack = lines(input.packaging, n, 'Packaging');
  const testing = perSize(input.testing, n, 'Testing');

  // CM per piece = SMV × cost per minute ÷ line efficiency. SMV is the
  // industrial engineer's figure, typed per size; any size's CM can be typed
  // over (a buyer-agreed CM, a sub-contract price) and then that figure is used.
  const cmIn = input.cm || {};
  const smv = perSize(cmIn.smv, n, 'SMV');
  const cpm = pos(cmIn.cpm);
  const eff = pos(cmIn.efficiency_pct);
  if (eff != null && (eff < 20 || eff > 100)) throw new SheetError('Line efficiency must be between 20% and 100%.');
  const effK = eff ? eff / 100 : 1;
  const overrideIn = cmIn.override != null ? cmIn.override : cmIn.direct;      // 'direct' kept for saved sheets
  const override = Array.isArray(overrideIn) ? overrideIn.slice(0, n).map((v) => (v === '' || v == null ? null : pos(v)))
    : overrideIn != null && overrideIn !== '' ? Array(n).fill(pos(overrideIn)) : Array(n).fill(null);
  while (override.length < n) override.push(null);
  const cmFromSmv = smv.map((v) => (cpm ? v * cpm / effK : 0));
  const cm = cmFromSmv.map((v, k) => (override[k] != null ? override[k] : v));
  const cmBasis = cm.map((_, k) => (override[k] != null ? 'typed' : smv[k] > 0 ? 'smv' : 'none'));
  if (cmBasis.some((b, k) => b === 'none' && smv[k] === 0) && smv.some((v) => v > 0) && !(cpm > 0)) throw new SheetError('CM: give the cost per minute (CPM), or type CM per piece.');
  if (smv.some((v) => v > 0) && !(cpm > 0) && cmBasis.some((b) => b === 'smv')) throw new SheetError('CM: give the cost per minute (CPM), or type CM per piece.');

  const markups = (Array.isArray(input.markups) ? input.markups : []).slice(0, 10)
    .map((m) => ({ name: String(m.name || 'Mark-up').slice(0, 60), pct: pos(m.pct) || 0, kind: ['commission', 'profit', 'other'].includes(m.kind) ? m.kind : /profit|margin/i.test(m.name || '') ? 'profit' : /comm|agent|ccl|buying/i.test(m.name || '') ? 'commission' : 'other' }))
    .filter((m) => m.pct > 0);
  const markPct = markups.reduce((t, m) => t + m.pct, 0);
  if (markPct >= 100) throw new SheetError('Mark-ups add up to 100% or more.');
  const compound = input.markup_mode === 'on_price';           // margin on the selling price: ÷ (1 − Σ)
  const packOf = Math.max(1, Math.round(pos(input.pack_of) || 1));

  const T = (f) => Array.from({ length: n }, (_, k) => f(k));
  const trimT = sumLines(trims, n), embT = sumLines(emb, n), washT = sumLines(wash, n), packT = sumLines(pack, n);
  const subtotal = T((k) => fabric[k] + trimT[k] + embT[k] + washT[k] + cm[k] + packT[k] + testing[k]);
  const fob = T((k) => (compound ? subtotal[k] / (1 - markPct / 100) : subtotal[k] * (1 + markPct / 100)));
  const target = Array.isArray(input.target_fob) || input.target_fob != null ? perSize(input.target_fob, n, 'Target FOB') : Array(n).fill(0);

  const kindPct = (kd) => markups.filter((m) => m.kind === kd).reduce((t, m) => t + m.pct, 0);
  const cPct = kindPct('commission'), pPct = kindPct('profit'), oPct = kindPct('other');
  // each mark-up's money: its share of what the whole mark-up adds
  const moneyOf = (pct, k) => (markPct ? (fob[k] - subtotal[k]) * pct / markPct : 0);
  const perSizeOut = sizes.map((size, k) => ({
    size,
    cm_basis: cmBasis[k], smv: smv[k], cm_from_smv: r4(cmFromSmv[k]),
    markups: markups.map((m) => ({ name: m.name, kind: m.kind, pct: m.pct, usd: r4(moneyOf(m.pct, k)) })),
    commission: r4(moneyOf(cPct, k)), profit: r4(moneyOf(pPct, k)), other_markup: r4(moneyOf(oPct, k)),
    // profit as a share of the price the buyer pays, and as a mark-up on cost
    profit_margin_pct: fob[k] ? r2(moneyOf(pPct, k) / fob[k] * 100) : 0,
    profit_on_cost_pct: subtotal[k] ? r2(moneyOf(pPct, k) / subtotal[k] * 100) : 0,
    gross_margin_pct: fob[k] ? r2((fob[k] - subtotal[k]) / fob[k] * 100) : 0,
    // what the factory keeps once the commission is paid
    factory_net: r4(fob[k] - moneyOf(cPct, k)),
    // the profit % (with the other mark-ups unchanged) that lands exactly on the target
    profit_pct_at_target: target[k] && subtotal[k]
      ? r2(compound ? (1 - subtotal[k] / target[k]) * 100 - (cPct + oPct) : (target[k] / subtotal[k] - 1) * 100 - (cPct + oPct)) : null,
    fabric: r4(fabric[k]), trims: r4(trimT[k]), embellishment: r4(embT[k]), wash: r4(washT[k]), cm: r4(cm[k]), packaging: r4(packT[k]), testing: r4(testing[k]),
    subtotal: r4(subtotal[k]), markup: r4(fob[k] - subtotal[k]), fob_pc: r4(fob[k]), fob_pack: r4(fob[k] * packOf), fob_dozen: r2(fob[k] * 12),
    fabric_share_pct: r2(subtotal[k] ? fabric[k] / subtotal[k] * 100 : 0),
    target: target[k] || null,
    // against a target: what is left for the factory, or how far it is over
    target_gap: target[k] ? r4(target[k] - fob[k]) : null,
    margin_at_target_pct: target[k] ? r2((target[k] - subtotal[k]) / target[k] * 100) : null,
  }));

  // what moves the price: each input up 10 % (consumption +5 %), FOB change per size
  const sens = (label, dFab, dOther = () => 0) => ({ label, per_size: sizes.map((_, k) => r4(((subtotal[k] + dFab(k) + dOther(k)) * (compound ? 1 / (1 - markPct / 100) : 1 + markPct / 100)) - fob[k])) });
  const shellPart = (k, field) => shells.reduce((t, s) => {
    const f = method === 'exact' ? 1 / (1 - s.prices.loss_pct.value / 100) : 1 + s.prices.loss_pct.value / 100;
    return t + s.consumption_kg_pc[k] * s.prices[field].value * f;
  }, 0);
  const sensitivity = [
    sens('Yarn +10%', (k) => 0.1 * shellPart(k, 'yarn')),
    sens('Dyeing +10%', (k) => 0.1 * shellPart(k, 'dyeing')),
    sens('Knitting +10%', (k) => 0.1 * shellPart(k, 'knitting')),
    sens('Consumption +5%', (k) => 0.05 * fabric[k]),
    sens('CM +10%', () => 0, (k) => 0.1 * cm[k]),
  ];

  // order: size ratio × quantity → weighted FOB, value, fabric and yarn to book
  let order = null;
  const qty = Math.round(pos((input.order || {}).quantity) || 0);
  if (qty > 0) {
    const ratio = perSize((input.order || {}).ratio, n, 'Size ratio');
    const rt = ratio.reduce((t, r) => t + r, 0) || n;
    const share = ratio.map((r) => (rt ? (r || (ratio.every((x) => !x) ? 1 : 0)) / (ratio.every((x) => !x) ? n : rt) : 1 / n));
    const pcs = share.map((s) => Math.round(qty * s));
    const value = pcs.reduce((t, p, k) => t + p * fob[k], 0);
    order = {
      quantity: qty, pieces_by_size: sizes.map((s, k) => ({ size: s, pieces: pcs[k] })),
      weighted_fob_pc: r4(value / Math.max(1, pcs.reduce((t, p) => t + p, 0))), value: r2(value),
      cost: r2(pcs.reduce((t, p, k) => t + p * subtotal[k], 0)),
      commission: r2(pcs.reduce((t, p, k) => t + p * moneyOf(cPct, k), 0)),
      profit: r2(pcs.reduce((t, p, k) => t + p * moneyOf(pPct, k), 0)),
      fabric: shells.map((s) => {
        const fin = pcs.reduce((t, p, k) => t + p * s.consumption_kg_pc[k], 0);
        const grey = fin / (1 - s.prices.loss_pct.value / 100);
        return { shell: s.name, finished_kg: r2(fin), grey_kg: r2(grey), yarn_kg: s.yarns.map((y) => ({ yarn: `${y.label}${y.count ? ' ' + y.count + 's' : ''}`, kg: r2(grey * y.share_pct / 100) })) };
      }),
    };
  }

  // a size left without consumption or CM prices low without saying so
  const warnings = [];
  shells.forEach((s) => { const miss = sizes.filter((_, k) => !(s.consumption_kg_pc[k] > 0)); if (miss.length) warnings.push(`${s.name}: no consumption for ${miss.join(', ')}.`); });
  const noCm = sizes.filter((_, k) => !(cm[k] > 0)); if (noCm.length) warnings.push(`No CM for ${noCm.join(', ')}.`);
  shells.forEach((s) => s.notes.forEach((t) => warnings.push(`${s.name}: ${t}`)));

  const rate = pos(input.exchange_rate) || costing.DEFAULT_EXCHANGE_RATES.BDT;
  return {
    success: true,
    header: input.header || {},
    sizes, pack_of: packOf, loss_method: method, markup_mode: compound ? 'on_price' : 'on_cost',
    shells,
    trims, embellishments: emb, washes: wash, packaging: pack,
    testing: testing.map(r4), cm: { smv, cpm, efficiency_pct: eff || 100, per_size: cm.map(r4), from_smv: cmFromSmv.map(r4), basis: cmBasis },
    markups, markup_pct: r2(markPct),
    per_size: perSizeOut,
    sensitivity, order, warnings,
    bdt: { rate, fob_pc: perSizeOut.map((p) => r2(p.fob_pc * rate)) },
    method_note: method === 'sheet'
      ? 'Fabric price per kg = (yarn + yarn dyeing + knitting + dyeing + finishing + AOP) × (1 + loss) — the usual buyer-sheet arithmetic. The exact form ÷ (1 − loss) is shown beside each shell.'
      : 'Fabric price per kg = (yarn + yarn dyeing + knitting + dyeing + finishing + AOP) ÷ (1 − loss): every grey kilo bought is carried by the finished kilos.',
  };
}

function analyse(input, opts = {}) {
  try { return build(input || {}, opts); }
  catch (e) {
    if (e instanceof SheetError) return { success: false, error: e.message };
    throw e;
  }
}

function options() {
  const yarns = Object.entries(costing.SM_PRICE_MATRIX).map(([k, v]) => ({ key: k, label: v.label, fiber: v.fiber, denier: v.price !== undefined ? v.denier || null : null }));
  const fabrics = Object.keys(chargeBook.GROUP_MAP);
  return { yarns, fabrics, shades: SHADES, limits: LIMITS, bdt_rate: costing.DEFAULT_EXCHANGE_RATES.BDT };
}

// ── a Fabric Studio warp design as a fabric shell ─────────────────────────
// The Studio designs the fabric; the sheet prices it. The design's own analysis gives the
// weight, the composition (each bar's share of the fabric weight) and the yarn of each bar;
// the price book needs the nearest catalogue fabric and the nearest priced yarn, and says so.
const WARP_FIBRE = { nylon_filament: 'nylon', polyester_filament: 'polyester', polyester_mono: 'polyester', nylon_mono: 'nylon', elastane: 'elastane', polypropylene: 'polypropylene', cotton: 'cotton', polyester_spun: 'polyester', viscose: 'viscose' };
const nearestKey = (keys, den) => keys.reduce((b, k) => (Math.abs(+k.match(/(\d+)d$/)[1] - den) < Math.abs(+b.match(/(\d+)d$/)[1] - den) ? k : b), keys[0]);
/**
 * @param a     warp-studio analyse() result of the design
 * @param name  the design's name
 * @returns { shell, notes }  a shell for the sheet's fabric list, and what was matched
 */
function shellFromWarp(a, name) {
  const notes = [];
  const sn = String((a.structure && a.structure.name) || '');
  let fabric = 'tricot_plain', nearest = 'plain tricot';
  if (a.structure && a.structure.beds === 2) { fabric = 'spacer_fabric'; nearest = 'spacer fabric'; }
  else if (/Powernet|Elastic raschel|Net/i.test(sn)) { fabric = 'powernet'; nearest = 'powernet'; }
  else if (/Locknit/i.test(sn)) { fabric = 'locknit'; nearest = 'locknit'; }
  else if (/Sharkskin/i.test(sn)) { fabric = 'sharkskin_tricot'; nearest = 'sharkskin'; }
  else if (!/Full tricot/i.test(sn)) notes.push(`"${sn || 'This structure'}" has no knitting charge of its own in the rate book: priced as plain tricot. Type the knitting price if you know it.`);
  notes.unshift(`Priced as the catalogue's ${nearest}.`);
  const rowsOf = costing.SM_PRICE_MATRIX;
  const keysOf = (fiber) => Object.keys(rowsOf).filter((k) => rowsOf[k].price !== undefined && rowsOf[k].fiber === fiber);
  const filaments = Object.keys(rowsOf).filter((k) => /^filament_\d+d$/.test(k));
  const yarns = a.bars.map((b) => {
    const den = b.tex * 9;
    const f = Object.keys(WARP_FIBRE).find((k) => b.fibre === (require('./warp-studio').FIBRES[k] || {}).label) || 'nylon_filament';
    let type, count = '';
    if (f === 'elastane') type = nearestKey(keysOf('elastane'), den);
    else if (f === 'nylon_filament' || f === 'nylon_mono') type = nearestKey(keysOf('nylon'), den);
    else if (f === 'polyester_filament' || f === 'polyester_mono' || f === 'polypropylene') type = nearestKey(filaments, den);
    else { type = f === 'cotton' ? 'combed_regular' : f === 'viscose' ? 'viscose_regular' : 'polyester_spun'; count = Math.round(590.5 / b.tex); }
    const row = rowsOf[type];
    if (row && row.denier && Math.abs(row.denier - den) / den > 0.25) notes.push(`GB${b.bar}: ${Math.round(den)} D priced as the nearest listed yarn, ${row.label} (${row.denier} D) — type your own price if it differs.`);
    return { role: `GB${b.bar}`, type, count, share_pct: b.pct, price: '' };
  });
  // bars of the same priced yarn are one yarn line (the sheet holds at most six)
  const merged = [];
  yarns.forEach((y) => {
    const m = merged.find((x) => x.type === y.type && x.count === y.count);
    if (m) { m.share_pct += y.share_pct; m.role += `+${y.role}`; } else merged.push({ ...y });
  });
  yarns.length = 0; merged.forEach((y) => yarns.push(y));
  // shares of the fabric weight must add to 100
  const tot = yarns.reduce((t, y) => t + y.share_pct, 0) || 1;
  yarns.forEach((y) => { y.share_pct = Math.round((y.share_pct / tot) * 1000) / 10; });
  const drift = Math.round((100 - yarns.reduce((t, y) => t + y.share_pct, 0)) * 10) / 10;
  if (yarns.length) yarns[0].share_pct = Math.round((yarns[0].share_pct + drift) * 10) / 10;
  const byFibre = {};
  const totBars = a.bars.reduce((t, b) => t + b.pct, 0) || 1;
  a.bars.forEach((b) => {
    const f = Object.keys(WARP_FIBRE).find((k) => b.fibre === (require('./warp-studio').FIBRES[k] || {}).label) || 'nylon_filament';
    byFibre[WARP_FIBRE[f]] = (byFibre[WARP_FIBRE[f]] || 0) + (b.pct / totBars) * 100;
  });
  const composition = Object.entries(byFibre).sort((x, y) => y[1] - x[1]).map(([f, p]) => `${Math.round(p * 10) / 10}% ${f}`).join(' ');
  return {
    shell: { name: String(name || 'Warp fabric').slice(0, 60), application: `Studio design · ${sn || 'warp knit'} · E${a.machine.gauge}`, fabric, composition, gsm: Math.max(60, Math.min(800, a.fabric.gsm)),
      shade: 'light_medium', two_part: false, stripe: '', brushed: false, aop: false, yarn_mode: 'manual', warp: true, yarns,
      yarn_dye_price: '', knit_price: '', dye_price: '', finish_price: '', aop_price: '', loss_pct: '', consumption_unit: 'pc', consumption: [] },
    notes,
  };
}

module.exports = { analyse, options, LIMITS, SheetError, shellFromWarp };
