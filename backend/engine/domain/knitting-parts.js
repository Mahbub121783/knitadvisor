/**
 * Parts 3–5 — the machine, how it forms each stitch, and the yarn each stitch takes.
 *
 * They read the stitch graph (part 0: which needle does what at every course, and what is held in each hook)
 * and the yarn (part 2: diameter, friction, strength), and return numbers in the same form as the other parts:
 * { value, unit, basis }, basis = law | typical | measured (a setting the mill gave).
 *
 * PART 3 · MACHINE   needle pitch and needles per bed (law), needle and sinker thickness and the trick gap,
 *                    feeders, speed, the cylinder's surface speed and the needle's vertical speed on the cam
 *                    (law: v_needle = v_surface · tan α), feed system and input tension; on a warp machine the
 *                    guide bars, the shog limit and the courses per minute.
 * PART 4 · FORMATION the knock-over depth that forms the loop (the crossed-belt geometry of the yarn over the
 *                    sinkers and under the hook — or hook to hook on a double bed), the wrap angle, the yarn
 *                    tension at the feeder eye and round the needles the yarn still slides on (capstan: T = T_in · e^{μ Σθ}),
 *                    the safety against the yarn's weak places, and how full each hook gets where loops are held
 *                    (the graph knows how many). On a warp machine: lap type and the shog each underlap needs.
 * PART 5 · CONSUMPTION the yarn every stitch takes, from the graph: a knit loop is the loop length set; a tuck
 *                    about 0.7 of it (typical, the test named); a single-bed float the straight run across the
 *                    needles it misses; a pile loop twice the pile height more; elastane delivered short by its
 *                    draft. Course length per feeder per revolution (what the yarn-length meter reads), and for
 *                    warp the runner per 480 courses of each bar from its overlaps and underlaps.
 */
'use strict';

const KM = require('./knit-machine');
const KF = require('./knit-formation');
const Wp = require('./warp-studio');

class PartError extends Error {}
const round = (v) => (typeof v !== 'number' ? v : Math.abs(v) >= 100 ? Math.round(v * 10) / 10 : Math.abs(v) >= 1 ? Math.round(v * 1000) / 1000 : +v.toPrecision(4));
const V = (value, unit, basis, extra) => (value == null || Number.isNaN(value) ? null : { value: round(value), unit, basis, ...(extra || {}) });
const val = (x) => (x && typeof x === 'object' ? x.value : x);

// typical values, each named and replaceable
const T_IN = { positive: 3, storage: 4 };     // cN — yarn tension into the feeder (measure with a tensiometer)
const CAM_ANGLE = 50;                           // degrees — stitch cam angle
const ZONE_NEEDLES = { positive: 1, storage: 2 };   // needles the yarn still slides round while a loop is drawn (positive feed meters it; a storage feed robs back)
const FEEDER_WRAP = Math.PI / 2;                 // the yarn's turn at the feeder eye
const SQUEEZE = 0.8;                             // a yarn pressed in the hook takes about 0.8 of its free diameter
const HOOK_OPENING = 0.6;                       // inner hook width as a share of the needle pitch
const TUCK_SHARE = 0.7;                         // a tuck's yarn as a share of a knit loop's
const CV_STRENGTH = 0.09;                       // single-end strength CV of a spun yarn

// ── PART 3: MACHINE ─────────────────────────────────────────────────────────────────────────────
/**
 * @param spec  { gauge, dia (in, circular), width_in (flat / warp), feeders, rpm, profile, feed: 'positive'|'storage',
 *                input_tension_cN, cam_angle_deg, needle_mm, sinker_mm, dial_gap_mm, timing, type (warp), courses_per_min }
 * @param graph the stitch graph of the design
 */
function machine(spec, graph) {
  const s = spec || {};
  const E = +s.gauge;
  if (!(E >= 3 && E <= 60)) throw new PartError('Give the machine gauge (needles per inch).');
  const p = 25.4 / E;
  const warp = /^warp/.test(graph.technique);
  const out = { technique: graph.technique, gauge: V(E, 'needles/inch', 'measured'), pitch: V(p, 'mm', 'law', { rule: '25.4 ÷ gauge' }) };
  if (warp) {
    const type = Wp.MACHINES[s.type] ? s.type : graph.machine || 'tricot', M = Wp.MACHINES[type];
    const width = +s.width_in > 0 ? +s.width_in : type === 'tricot' ? 130 : 136;
    const cpm = +s.courses_per_min > 0 ? V(+s.courses_per_min, 'courses/min', 'measured') : V((M.speed[0] + M.speed[1]) / 2, 'courses/min', 'typical', { test: 'the machine display' });
    return { ...out, type, label: M.label, needle: M.needle, beds: M.beds, bars: (graph.bars || []).length, bars_range: M.bars, shog_limit: V(M.shog, 'needle spaces', 'typical'),
      width: V(width, 'in', +s.width_in > 0 ? 'measured' : 'typical'), needles: V(Math.round(width * E), 'per bar', 'law'), speed: cpm };
  }
  const flat = graph.technique === 'weft-flat';
  const dbl = graph.beds.length > 1;
  const prof = KM.PROFILES[s.profile] || (dbl ? (graph.gating === 'interlock' ? KM.PROFILES.interlock_dj || KM.PROFILES.rib_dj : KM.PROFILES.rib_dj) : KM.PROFILES.sj_4track) || {};
  const dia = +s.dia > 0 ? +s.dia : null;
  if (!flat && !dia) throw new PartError('Give the cylinder diameter (inches).');
  const needles = flat ? Math.round((+s.width_in > 0 ? +s.width_in : 60) * E) : Math.round(Math.PI * dia * E);
  const R = graph.period.courses;
  const fpi = prof.fpi || (dbl ? 2 : 3);
  const feeders = +s.feeders > 0 ? V(+s.feeders, 'feeders', 'measured') : flat ? V(Math.max(1, Math.min(R, 3)), 'systems', 'typical') : V(Math.max(R, Math.round((fpi * dia) / R) * R), 'feeders', 'typical', { rule: `${fpi} per inch of diameter, a whole number of repeats` });
  const rpm = +s.rpm > 0 ? V(+s.rpm, 'rpm', 'measured') : flat ? null : V((prof.sf || 900) / dia, 'rpm', 'typical', { rule: 'the speed factor of this class ÷ diameter' });
  const surface = rpm ? (Math.PI * dia * 25.4 * val(rpm)) / 60000 : null;            // m/s
  const alpha = +s.cam_angle_deg > 0 ? +s.cam_angle_deg : CAM_ANGLE;
  const tn = +s.needle_mm > 0 ? +s.needle_mm : KF.CONST.TN * p, ts = +s.sinker_mm > 0 ? +s.sinker_mm : KF.CONST.TS * p;
  const feed = s.feed === 'storage' ? 'storage' : 'positive';
  return {
    ...out, label: prof.label || null, beds: graph.beds, gating: graph.gating, flat,
    dia: dia ? V(dia, 'in', 'measured') : null, needles: V(needles, 'per bed', 'law', { rule: flat ? 'width × gauge' : 'π × diameter × gauge' }),
    feeders, rpm, surface_speed: surface ? V(surface, 'm/s', 'law', { rule: 'π · D · rpm' }) : null,
    cam_angle: V(alpha, '°', +s.cam_angle_deg > 0 ? 'measured' : 'typical'),
    needle_speed: surface ? V(surface * Math.tan((alpha * Math.PI) / 180), 'm/s', 'law', { rule: 'surface speed × tan(cam angle): how fast the needle rises and falls' }) : null,
    needle_thickness: V(tn, 'mm', +s.needle_mm > 0 ? 'measured' : 'typical'), sinker_thickness: dbl ? null : V(ts, 'mm', +s.sinker_mm > 0 ? 'measured' : 'typical'),
    trick_gap: V(p - tn, 'mm', 'law', { rule: 'pitch − needle thickness: the room the yarn passes through' }),
    hook_opening: V(HOOK_OPENING * p, 'mm', 'typical', { test: 'the needle maker\'s hook dimension' }),
    feed, input_tension: V(+s.input_tension_cN > 0 ? +s.input_tension_cN : T_IN[feed], 'cN', +s.input_tension_cN > 0 ? 'measured' : 'typical', { test: 'a yarn tensiometer at the feeder' }),
    dial_gap: dbl ? V(+s.dial_gap_mm > 0 ? +s.dial_gap_mm : KF.CONST.GAP, 'mm', +s.dial_gap_mm > 0 ? 'measured' : 'typical') : null,
    timing: dbl ? (s.timing === 'synchronised' ? 'synchronised' : 'delayed') : null,
    speed_limit: rpm && prof.sf ? { typical_max_rpm: V(prof.sf / dia * 1.1, 'rpm', 'typical'), over: val(rpm) > (prof.sf / dia) * 1.1 } : null,
  };
}

// ── helpers on the graph ──────────────────────────────────────────────────────────────────────────
const courseIndex = (g) => { const m = new Map(); for (const p of g.passes) if (!m.has(p.course)) m.set(p.course, p); return m; };
/** How many loops a needle holds just before course c (the old loop and any tucks since). */
function heldAt(g, needle, c) {
  const R = g.period.courses;
  return g.loops.filter((L) => L.needle === needle).reduce((n, L) => {
    // a loop of this repeat, or the same loop one repeat earlier
    for (const sh of [0, -R]) { const born = L.course + sh, gone = L.cast_off == null ? Infinity : L.cast_off + sh; if (born < c && gone >= c) return n + 1; }
    return n;
  }, 0);
}

// ── PART 4: FORMATION ─────────────────────────────────────────────────────────────────────────────
/**
 * @param graph  the stitch graph
 * @param yarns  part-2 yarn per feed (array, one per course of the repeat) or one for all
 * @param mach   part-3 machine
 * @param loops  { sl_mm } or [sl_mm per feed] — the loop length set
 */
function formation(graph, yarns, mach, loops) {
  const checks = [];
  const add = (level, code, text) => checks.push({ level, code, text });
  if (/^warp/.test(graph.technique)) {
    // lap type and the shog each step needs, against the bar's limit
    const steps = (graph.bars || []).map((b) => {
      const mine = graph.passes.filter((p) => p.yarn === graph.yarns.find((y) => y.source.bar === b.n).id);
      const shog = Math.max(0, ...mine.map((p) => p.underlap.needles + (p.overlap ? p.overlap.width : 0)));
      if (shog > val(mach.shog_limit)) add('error', 'shog', `Bar ${b.n} shogs ${shog} needle spaces in one course: more than this class of machine moves (${val(mach.shog_limit)}).`);
      return { bar: b.n, laps: { open: mine.filter((p) => p.lap === 'open').length, closed: mine.filter((p) => p.lap === 'closed').length, inlay: mine.filter((p) => !p.overlap).length }, max_shog: V(shog, 'needle spaces', 'law') };
    });
    return { bars: steps, checks };
  }
  const R = graph.period.courses, byCourse = courseIndex(graph);
  const yarnOf = (f) => (Array.isArray(yarns) ? yarns[f] || yarns[0] : yarns);
  const slOf = (f) => (Array.isArray(loops) ? +loops[f] || +loops[0] : +(loops && loops.sl_mm));
  const dbl = graph.beds.length > 1, E = val(mach.gauge), p = val(mach.pitch);
  const positive = mach.feed !== 'storage';
  const form = positive ? 1 + KF.CONST.FORM_OVER : 1 / (1 - KF.CONST.ROB_STORAGE);
  const feeds = [];
  for (let c = 0; c < R; c++) {
    const pass = byCourse.get(c); if (!pass) continue;
    const y = yarnOf(c), sl = slOf(c);
    if (!(sl > 0)) throw new PartError(`Feed ${c + 1}: give the loop length (stitch length).`);
    const delta = val(y.diameter), mu = val(y.friction.yarn_on_metal), Fb = val(y.strength.breaking_load) * 100;   // cN
    const knits = pass.visits.filter((v) => v.act === 'K'), tucks = pass.visits.filter((v) => v.act === 'T');
    if (!knits.length && !tucks.length) continue;
    const g = KF.geometry(dbl, graph.gating, E, delta, val(mach.dial_gap));
    const res = KF.depthFor(sl * form, g);
    // wrap per needle: single bed — the crossed belt wraps the hook by 2θ and the sinker by 2θ; double bed — the hook by π − 2·atan(h/s)
    let wrap = null;
    if (res.d != null && !res.short) {
      if (!dbl) { const vx = g.p / 2, vy = res.d - g.rn - g.rs, D = Math.hypot(vx, vy), th = Math.atan2(vy, vx) - Math.acos((g.rn + g.rs) / D) + Math.PI / 2; wrap = 4 * th; }
      else { const s2 = Math.hypot(res.d, res.d + g.gap); wrap = Math.PI - 2 * Math.atan(g.h / s2); }
    }
    const tIn = val(mach.input_tension);
    const zone = ZONE_NEEDLES[positive ? 'positive' : 'storage'];
    const peak = wrap != null ? tIn * Math.exp(mu * (FEEDER_WRAP + wrap * zone)) : null;
    const weak = Fb * (1 - 2.33 * CV_STRENGTH);                                      // the yarn's weak places: 1 in 100 lengths
    // hook fill: every loop held in the hook plus the new yarn, against the hook's opening
    let worst = { fill: 0, needle: null, loops: 0 };
    for (const v of [...knits, ...tucks]) {
      const n = heldAt(graph, v.needle, c) + 1, fill = (n * SQUEEZE * delta) / (HOOK_OPENING * p);
      if (fill > worst.fill) worst = { fill, needle: v.needle, loops: n };
    }
    const row = {
      feed: c + 1, sl_mm: V(sl, 'mm', 'measured'), formed_mm: V(sl * form, 'mm', 'law', { rule: positive ? 'positive feed: the cam forms a little over what is fed' : 'storage feed: part of the loop is robbed back' }),
      knock_over_depth: res.d == null ? null : V(res.d, 'mm', 'law', { rule: dbl ? 'hook to hook between the beds' : 'crossed belt over the sinkers and under the hook' }),
      wrap_per_needle: wrap == null ? null : V((wrap * 180) / Math.PI, '°', 'law'),
      peak_tension: peak == null ? null : V(peak, 'cN', 'law', { rule: `capstan: input × e^(μ Σθ) — the feeder eye and ${zone} needle${zone > 1 ? 's' : ''} the yarn still slides round (typical)` }),
      safety: peak == null ? null : V(weak / peak, '× weak-place strength', 'law'),
      hook_fill: V(worst.fill, 'of the hook', 'law', { loops: worst.loops, needle: worst.needle }),
    };
    if (res.short) add('error', 'loop_too_short', `Feed ${c + 1}: a ${round(sl)} mm loop is shorter than the yarn wrapping the hook and sinkers at ${E} GG — the needle cannot knock over.`);
    else if (res.d == null) add('error', 'loop_too_long', `Feed ${c + 1}: a ${round(sl)} mm loop needs more needle travel than a stitch cam gives at ${E} GG.`);
    if (peak != null && weak / peak < 6) add('warn', 'tension', `Feed ${c + 1}: the yarn reaches about ${round(peak)} cN in the knitting zone against ${round(weak)} cN at its weak places (safety ${round(weak / peak)}×) — expect yarn breaks and holes; lower the input tension, wax the yarn or lengthen the loop.`);
    // the hook's size is typical, not measured: these are warnings, never a refusal
    if (worst.fill > 1) add('warn', 'hook_overload', `Feed ${c + 1}: ${worst.needle} holds ${worst.loops} yarns in its hook — on a typical hook for ${E} GG that is more than it takes even squeezed (${Math.round(worst.fill * 100)} %): risk of press-offs and broken latches. Check against the needle maker's hook size.`);
    else if (worst.fill > 0.85) add('warn', 'hook_full', `Feed ${c + 1}: ${worst.needle}'s hook is about ${Math.round(worst.fill * 100)} % full (${worst.loops} yarns) — tucks may fail to clear with a fuller yarn.`);
    feeds.push(row);
  }
  return { feeds, checks, constants: { zone_needles: V(ZONE_NEEDLES[positive ? 'positive' : 'storage'], '', 'typical'), squeeze: V(SQUEEZE, '× diameter', 'typical'), hook_opening: V(HOOK_OPENING, '× pitch', 'typical'), strength_cv: V(CV_STRENGTH, '', 'typical', { test: 'single-end tensile tester (CV)' }) } };
}

// ── PART 5: CONSUMPTION ───────────────────────────────────────────────────────────────────────────
/**
 * @param opts { tuck_share, pile_height_mm, draft (elastane), cpc (warp: courses per cm on the machine) }
 */
function consumption(graph, yarns, mach, loops, opts = {}) {
  const yarnOf = (f) => (Array.isArray(yarns) ? yarns[f] || yarns[0] : yarns);
  if (/^warp/.test(graph.technique)) {
    const cpc = +opts.cpc;
    if (!(cpc > 0)) throw new PartError('Give the courses per cm the warp machine knits (its quality setting).');
    const p = val(mach.pitch), c = 10 / cpc;
    const bars = (graph.bars || []).map((b) => {
      const y0 = graph.yarns.find((y) => y.source.bar === b.n);
      const delta = val(yarnOf(b.n - 1).diameter), rn = (0.45 * p + delta) / 2;
      const mine = graph.passes.filter((x) => x.yarn === y0.id);
      let sum = 0;
      for (const x of mine) {
        const o = x.overlap ? x.overlap.width : 0, u = x.underlap.needles;
        sum += (o ? 2 * c + Math.PI * rn + Math.max(0, o - 1) * p + (u === 0 ? Math.PI * delta : 0) : 0) + Math.sqrt((u * p) ** 2 + c * c);
      }
      const perCourse = sum / mine.length;
      return { bar: b.n, per_course: V(perCourse, 'mm', 'law', { rule: 'overlap 2c + π rn + (o − 1) p, underlap √((u p)² + c²)' }), runner: V(perCourse * 480, 'mm per 480 courses', 'law') };
    });
    return { bars };
  }
  const R = graph.period.courses, N = graph.period.needles, p = val(mach.pitch), byCourse = courseIndex(graph);
  const tuck = +opts.tuck_share > 0 ? +opts.tuck_share : TUCK_SHARE;
  const pileH = +opts.pile_height_mm > 0 ? +opts.pile_height_mm : 2.0;
  const slOf = (f) => (Array.isArray(loops) ? +loops[f] || +loops[0] : +(loops && loops.sl_mm));
  const scale = val(mach.needles) / N;                                                  // repeats round the machine
  const feeds = [];
  for (let c = 0; c < R; c++) {
    const pass = byCourse.get(c); if (!pass) continue;
    const sl = slOf(c);
    let k = 0, t = 0, floatMm = 0, pile = 0;
    pass.visits.forEach((v) => { if (v.act === 'K') k++; else if (v.act === 'T') t++; });
    for (const sp of pass.spans) {
      if (sp.kind === 'float') floatMm += sp.float_needles * p;                         // a float runs straight across the needles it misses
      if (sp.kind === 'pile') pile += 2 * pileH;
    }
    const perRepeat = k * sl + t * tuck * sl + floatMm + pile;
    const yarnIds = graph.passes.filter((x) => x.course === c).map((x) => x.yarn);
    const row = {
      feed: c + 1, knit: k, tuck: t,
      per_repeat: V(perRepeat, 'mm', 'law'),
      course_length: V((perRepeat * scale) / 1000, 'm per revolution', 'law', { rule: 'what a yarn-length meter reads at this feeder' }),
      parts: { loops: V(k * sl, 'mm', 'law'), tucks: t ? V(t * tuck * sl, 'mm', 'typical', { share: tuck, test: 'yarn-length meter on a tuck feed' }) : null, floats: floatMm ? V(floatMm, 'mm', 'law') : null, pile: pile ? V(pile, 'mm', 'typical', { pile_height_mm: pileH }) : null },
      yarns: yarnIds,
    };
    const el = graph.yarns.find((y) => yarnIds.includes(y.id) && y.role === 'elastane');
    if (el) { const dr = +opts.draft > 0 ? +opts.draft : 2.6; row.elastane_delivered = V((perRepeat * scale) / 1000 / dr, 'm per revolution', 'law', { rule: `the course length ÷ the draft (${dr})` }); }
    feeds.push(row);
  }
  return { feeds, tuck_share: V(tuck, '× a knit loop', +opts.tuck_share > 0 ? 'measured' : 'typical') };
}

module.exports = { machine, formation, consumption, heldAt, PartError, CONST: { T_IN, CAM_ANGLE, ZONE_NEEDLES, FEEDER_WRAP, SQUEEZE, HOOK_OPENING, TUCK_SHARE, CV_STRENGTH } };
