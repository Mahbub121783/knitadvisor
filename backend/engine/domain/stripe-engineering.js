/**
 * Engineering stripe — from the repeat to the machine, the cloth and the garment panel.
 *
 * An engineering stripe is a stripe whose widths are designed (A12 B4 C2 B4 …), knitted on a circular machine whose feeders change yarn
 * (stripers) or keep one yarn each (feeder stripe). This module answers, for ONE stripe and ONE machine, everything a knitter, a planner and a cutter ask:
 *
 *   repeat      the smallest repeat the stripe really has (A1 B1 A1 B1 is A1 B1), its runs, and how it meets the design's own repeat
 *   fit         stripe widths given in mm or cm become whole courses (largest remainder: the repeat keeps its length, every stripe is at least one course,
 *               an interlock stripe stays a whole number of courses), with the error each stripe carries
 *   heights     every stripe in mm on the machine, wet, finished and after washing (the cloth's own relaxation states)
 *   machine     feeder stripe or striper: the yarn each feeder carries over the revolutions, the finger each yarn sits on, the cones to hang,
 *               how many feeders never change yarn, and how many yarn changes the striper makes per revolution and per hour
 *   options     other feeder counts that would make it a feeder stripe (no stripers), other repeat sizes that divide the feeders, with their error in mm
 *   geometry    a circular machine with n feeders knits a helix of n courses: how far the stripe line runs out of square across the open width
 *   panel       a garment panel cut to a whole number of stripe repeats, so the stripes match at the seams
 *   calibrate   a measured stripe repeat on a finished trial roll replaces the modelled course density
 *
 * Pure functions: no Studio dependency. The Studio (fabric-studio.js) hands the numbers in. Every figure is arithmetic on its inputs; the course density
 * it rests on is the Studio's (measured in the factory records, modelled for new structures, replaced by your own roll).
 */
'use strict';

class StripeError extends Error { constructor(m) { super(m); this.name = 'StripeError'; } }
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;
const divisors = (n) => { const d = []; for (let i = 1; i * i <= n; i++) if (n % i === 0) { d.push(i); if (i * i !== n) d.push(n / i); } return d.sort((a, b) => a - b); };
const MAX_FEEDS = 2000;

// ── reading what the person typed ─────────────────────────────────────────
/** "A12 B4 C2" (feeds), "A6mm B2.5mm", "A1.2cm B4" → [{colour, value, unit}] ; unit is '' (feeds), 'mm' or 'cm' */
function parseSpec(text) {
  const up = String(text == null ? '' : text).toUpperCase(), re = /([A-F])\s*(\d+(?:\.\d+)?)\s*(MM|CM)?/g, runs = [];
  let m;
  while ((m = re.exec(up)) && runs.length < 400) {
    const unit = (m[3] || '').toLowerCase(), v = parseFloat(m[2]);
    if (!(v > 0)) continue;
    runs.push({ colour: m[1], value: unit ? v : Math.max(1, Math.round(v)), unit });
  }
  return { runs, has_units: runs.some((r) => r.unit) };
}
const specText = (runs) => runs.map((r) => r.colour + r.feeds).join(' ');

/**
 * Widths in mm (or cm) → whole feeds. Exact units = mm × cpc ÷ 10 ÷ courses-per-feed ÷ unitFeeds; floors, then the remainder goes to the largest fractions so the repeat keeps
 * its total length. Runs typed in feeds stay as typed. unitFeeds is 2 on an interlock (one course takes two feeds), so a stripe never ends in half a course.
 */
function fitSpec(runs, o) {
  const cpc = +o.cpc, cpf = +o.cpf > 0 ? +o.cpf : 1, unit = o.unit_feeds > 1 ? o.unit_feeds : 1;
  if (!(cpc > 0)) throw new StripeError('The course density of the cloth is not known yet, so a width in mm cannot become courses.');
  const mmOf = (r) => (r.unit === 'cm' ? r.value * 10 : r.value);
  const idx = runs.map((r, i) => i).filter((i) => runs[i].unit);
  const exact = runs.map((r) => (r.unit ? (mmOf(r) * cpc / 10) / cpf / unit : r.value / unit));
  const units = runs.map((r, i) => (r.unit ? Math.max(1, Math.round(exact[i])) : Math.max(1, Math.round(exact[i]))));
  const want = Math.max(idx.length, Math.round(idx.reduce((t, i) => t + exact[i], 0)));
  // the repeat keeps its length (a panel fits a whole number of repeats) AND two stripes asked for the same width stay the same width:
  // stripes of one colour and width move together; when no such move reaches the length, the remainders are shared out run by run
  const keyOf = (i) => runs[i].colour + '|' + runs[i].unit + '|' + exact[i].toFixed(4);
  const keys = [...new Set(idx.map(keyOf))].map((k) => ({ k, at: idx.filter((i) => keyOf(i) === k) }));
  let done = false;
  const drift0 = idx.reduce((t, i) => t + units[i], 0) - want;
  if (drift0 === 0) done = true;
  else if (keys.length <= 9) {
    let best = null;
    const moves = new Array(keys.length).fill(0);
    const walk = (j, drift, cost) => {
      if (j === keys.length) {
        if (drift === 0 && (best === null || cost < best.cost - 1e-12)) best = { cost, moves: moves.slice() };
        return;
      }
      for (const d of [0, -1, 1]) {
        const u = units[keys[j].at[0]] + d;
        if (u < 1) continue;
        moves[j] = d;
        const e = exact[keys[j].at[0]];
        walk(j + 1, drift + d * keys[j].at.length, cost + keys[j].at.length * ((u - e) / e) ** 2);
      }
      moves[j] = 0;
    };
    walk(0, drift0, 0);
    if (best) { keys.forEach((kk, j) => kk.at.forEach((i) => { units[i] += best.moves[j]; })); done = true; }
  }
  if (!done) {
    for (const i of idx) units[i] = Math.max(1, Math.floor(exact[i] + 1e-9));
    let have = idx.reduce((t, i) => t + units[i], 0);
    const order = (asc) => idx.slice().sort((a, b) => (asc ? 1 : -1) * ((exact[a] - units[a]) - (exact[b] - units[b])));
    for (const i of order(false)) { if (have >= want) break; units[i]++; have++; }
    for (const i of order(true)) { if (have <= want) break; if (units[i] > 1) { units[i]--; have--; } }
  }
  const out = runs.map((r, i) => {
    const feeds = units[i] * unit, mm = feeds * cpf * 10 / cpc, asked = r.unit ? mmOf(r) : null;
    return { colour: r.colour, asked_mm: asked != null ? r2(asked) : null, feeds, courses: r2(feeds * cpf), mm: r2(mm), error_mm: asked != null ? r2(mm - asked) : null, error_pct: asked != null ? r1((mm / asked - 1) * 100) : null };
  });
  const askedTot = out.reduce((t, x) => t + (x.asked_mm != null ? x.asked_mm : x.mm), 0), gotTot = out.reduce((t, x) => t + x.mm, 0);
  const total = out.reduce((t, x) => t + x.feeds, 0);
  if (total > MAX_FEEDS) throw new StripeError(`That repeat is ${total} feeds: the Studio holds a stripe up to ${MAX_FEEDS}.`);
  return { runs: out, feeds: total, sequence: specText(out), repeat_asked_mm: r2(askedTot), repeat_mm: r2(gotTot), repeat_error_mm: r2(gotTot - askedTot) };
}

// ── the repeat ────────────────────────────────────────────────────────────
/** the smallest period of a sequence: A B A B → A B (every feeder and every check then sees the real repeat) */
function reduce(seq) {
  const N = seq.length;
  for (const p of divisors(N)) if (p < N && seq.every((x, i) => x === seq[i % p])) return { seq: seq.slice(0, p), period: p, reduced: true, factor: N / p, from: N };
  return { seq: seq.slice(), period: N, reduced: false, factor: 1, from: N };
}
/** runs round the cycle: the last run joins the first when they are the same colour */
function cyclicRuns(seq) {
  const runs = [];
  seq.forEach((c) => { if (runs.length && runs[runs.length - 1].colour === c) runs[runs.length - 1].feeds++; else runs.push({ colour: c, feeds: 1 }); });
  if (runs.length > 1 && runs[0].colour === runs[runs.length - 1].colour) { runs[0].feeds += runs.pop().feeds; }
  return runs;
}

/** the repeat as it is typed, from its first feed: AAABBA → A3 B2 A1 */
function linearText(seq) { const out = []; seq.forEach((c) => { if (out.length && out[out.length - 1].c === c) out[out.length - 1].n++; else out.push({ c, n: 1 }); }); return out.map((x) => x.c + x.n).join(' '); }

// ── the machine side ──────────────────────────────────────────────────────
/**
 * Feed pass p = revolution × feeders + feeder knits seq[p mod N]. A feeder sees one yarn if N divides the feeders (after reduction); otherwise it
 * changes between the yarns at stride gcd(N, feeders). The yarn a feeder carries over a whole cycle, its finger, its changes.
 */
function feederPlan(seq, feeders, rpm, eff) {
  const N = seq.length, g = gcd(N, feeders), R = N / g;       // revolutions in one full cycle of the stripe round the machine
  const per = [], revChanges = new Array(R).fill(0), cones = {};
  let maxF = 1, coneTotal = 0, changesCycle = 0;
  const keep = feeders * R <= 40000;
  for (let k = 0; k < feeders; k++) {
    const cols = new Array(R);
    for (let r = 0; r < R; r++) cols[r] = seq[(k + r * feeders) % N];
    const set = [...new Set(cols)];
    let ch = 0;
    if (R > 1) for (let r = 0; r < R; r++) if (cols[r] !== cols[(r + 1) % R]) { ch++; revChanges[r]++; }
    per.push({ feeder: k + 1, colours: set, fingers: set.length, changes: ch, by_rev: keep ? cols.join('') : null });
    set.forEach((c) => { cones[c] = (cones[c] || 0) + 1; });
    maxF = Math.max(maxF, set.length); coneTotal += set.length; changesCycle += ch;
  }
  const perRev = R > 0 ? changesCycle / R : 0;
  const speed = rpm > 0 ? rpm * 60 * (eff > 0 ? eff : 1) : null;
  return {
    method: maxF === 1 ? 'feeder stripe' : 'striper', revolutions_per_repeat: maxF === 1 ? null : R, cycle_revolutions: R, fingers_needed: maxF,
    fixed_feeders: per.filter((p) => p.fingers === 1).length, changing_feeders: per.filter((p) => p.fingers > 1).length,
    cones_total: coneTotal, cones_by_colour: cones, per,
    changes: { per_cycle: changesCycle, per_revolution: r2(perRev), peak_in_one_revolution: Math.max(0, ...revChanges), per_hour: speed ? Math.round(perRev * speed) : null },
  };
}

// ── options ───────────────────────────────────────────────────────────────
/** apportion `total` units over weights (each at least 1) by largest remainder */
function apportion(weights, total) {
  const s = weights.reduce((t, w) => t + w, 0) || 1, exact = weights.map((w) => (w / s) * total), u = exact.map((x) => Math.max(1, Math.floor(x + 1e-9)));
  let have = u.reduce((t, x) => t + x, 0);
  const asc = (dir) => u.map((_, i) => i).sort((a, b) => dir * ((exact[a] - u[a]) - (exact[b] - u[b])));
  for (const i of asc(-1)) { if (have >= total) break; u[i]++; have++; }
  for (const i of asc(1)) { if (have <= total) break; if (u[i] > 1) { u[i]--; have--; } }
  return have === total ? u : null;
}
/** other repeat sizes that divide the feeders (so every feeder keeps one yarn and no striper is needed): the runs scaled to fit, the error each takes in mm */
function snapRepeats(runs, feeders, o) {
  const N = runs.reduce((t, r) => t + r.feeds, 0), unit = o.unit_feeds > 1 ? o.unit_feeds : 1, out = [];
  for (const d of divisors(feeders)) {
    if (d === N || d % unit || d < runs.length * unit || d > Math.max(6, 2.2 * N) || d < N / 2.2) continue;
    const u = apportion(runs.map((r) => r.feeds), d / unit);
    if (!u) continue;
    const per = runs.map((r, i) => {
      const f = u[i] * unit, mm0 = r.feeds * o.cpf * 10 / o.cpc, mm1 = f * o.cpf * 10 / o.cpc;
      return { colour: r.colour, feeds: f, mm: r2(mm1), error_mm: r2(mm1 - mm0), error_pct: r1((mm1 / mm0 - 1) * 100) };
    });
    out.push({ feeds: d, runs: per, sequence: specText(per), max_error_mm: r2(Math.max(...per.map((x) => Math.abs(x.error_mm)))), max_error_pct: r1(Math.max(...per.map((x) => Math.abs(x.error_pct)))), repeat_mm: r2(d * o.cpf * 10 / o.cpc) });
  }
  return out.sort((a, b) => a.max_error_pct - b.max_error_pct || Math.abs(a.feeds - N) - Math.abs(b.feeds - N)).slice(0, 4);
}
/** feeder counts near this machine's that make the stripe a feeder stripe */
function feederCounts(N, F, n0, o) {
  const out = [], lo = Math.ceil(n0 * 0.5), hi = Math.floor(n0 * 1.5), step = lcm(N, F);
  for (let n = Math.ceil(lo / step) * step; n <= hi; n += step) {
    if (n === n0) continue;
    out.push({ feeders: n, stripe_repeats_round: n / N, relative_output: r2(n / n0), tilt_mm: o.tiltOf(n) });
  }
  return out.sort((a, b) => Math.abs(a.feeders - n0) - Math.abs(b.feeders - n0)).slice(0, 3);
}

// ── geometry ──────────────────────────────────────────────────────────────
/**
 * n feeders lay n courses in one revolution while the cloth moves on: every course is one turn of a helix n courses long. When the tube is slit open the
 * course (and so every stripe edge) runs `courses_per_rev` courses out of square from one side to the other: a staircase of one course at each feeder.
 */
function tilt(feeds_per_rev, cpf, cpc, width_cm) {
  const courses = feeds_per_rev * cpf, mm = courses * 10 / cpc;
  return { courses_per_rev: r2(courses), mm: r2(mm), deg: width_cm > 0 ? r2(Math.atan(mm / (width_cm * 10)) * 180 / Math.PI) : null, width_cm: width_cm > 0 ? r1(width_cm) : null, step_courses_per_feeder: 1 };
}

// ── the garment panel ─────────────────────────────────────────────────────
/** a panel length in cm and the stripe repeat in cm: whole repeats on either side, and how far each is from the length asked */
function panelPlan(panel_cm, repeat_cm) {
  if (!(panel_cm > 0) || !(repeat_cm > 0)) return null;
  const exact = panel_cm / repeat_cm, lo = Math.max(1, Math.floor(exact)), hi = Math.ceil(exact);
  const cut = (k) => ({ repeats: k, length_cm: r1(k * repeat_cm), off_cm: r1(k * repeat_cm - panel_cm) });
  const a = cut(lo), b = cut(hi), best = Math.abs(a.off_cm) <= Math.abs(b.off_cm) ? a : b;
  return { panel_cm, repeat_cm: r2(repeat_cm), repeats_exact: r2(exact), shorter: a, longer: b, nearest: best, whole: Math.abs(exact - Math.round(exact)) < 0.02 };
}

// ── a measured trial ──────────────────────────────────────────────────────
/** the person measured the stripe on a finished trial roll: { repeat_mm } (the full repeat), { cpc } or { courses, mm }. Returns the factor on the modelled heights. */
function calibration(measured, predictedRepeatMm, predictedCpc) {
  if (!measured || typeof measured !== 'object') return null;
  let factor = null, how = null;
  if (+measured.repeat_mm > 0) { factor = +measured.repeat_mm / predictedRepeatMm; how = `the full repeat measured ${r1(+measured.repeat_mm)} mm on the finished roll`; }
  else if (+measured.cpc > 0) { factor = predictedCpc / +measured.cpc; how = `${r1(+measured.cpc)} courses per cm counted on the finished roll`; }
  else if (+measured.courses > 0 && +measured.mm > 0) { factor = (+measured.mm / +measured.courses) / (10 / predictedCpc); how = `${+measured.courses} courses measured ${r1(+measured.mm)} mm on the finished roll`; }
  if (!factor || !(factor > 0.5 && factor < 2)) return factor ? { error: `That measurement is ${r1((factor - 1) * 100)} % from the model: check the count and the unit before it is used.` } : null;
  return { factor: r3(factor), vs_model_pct: r1((factor - 1) * 100), how };
}

// ── the whole analysis ────────────────────────────────────────────────────
/**
 * p: { seq: [colour per feed], F: design feeds, feeders, gating: 'single'|'rib'|'interlock', cpf: face courses per feed, states: [{state,label,cpc,width_in}],
 *      selected: 'finished', rpm, eff (0–1), striper: fingers on the machine, panel_cm, measured, fit (what fitSpec gave), width_cm }
 */
function analyse(p) {
  const seq0 = p.seq || [];
  if (!seq0.length) return null;
  const red = reduce(seq0), seq = red.seq, N = seq.length, F = Math.max(1, p.F || 1), feeders = p.feeders, cpf = +p.cpf > 0 ? +p.cpf : 1;
  const unit = p.gating === 'interlock' ? 2 : 1;
  const states = (p.states || []).filter((s) => s && s.cpc > 0);
  if (!states.length || !(feeders > 0)) return null;
  const sel = states.find((s) => s.state === p.selected) || states.find((s) => s.state === 'finished') || states[0];
  const colours = [...new Set(seq)].sort();
  const runs = cyclicRuns(seq);
  const checks = [];
  const add = (level, text, tag) => checks.push({ level, text, tag: tag || null });

  // the calibration first: it scales every height
  const predRepeat = N * cpf * 10 / sel.cpc;
  const cal = calibration(p.measured, predRepeat, sel.cpc);
  if (cal && cal.error) add('warn', cal.error);
  const k = cal && cal.factor ? cal.factor : 1, cpcOf = (s) => s.cpc / k;

  // heights in every state
  const heights = states.map((s) => {
    const c = cpcOf(s);
    return { state: s.state, label: s.label || s.state, cpc: r2(c), repeat_mm: r1(N * cpf * 10 / c), repeat_cm: r2(N * cpf / c), runs: runs.map((x) => ({ colour: x.colour, feeds: x.feeds, courses: r2(x.feeds * cpf), mm: r2(x.feeds * cpf * 10 / c) })) };
  });
  const H = heights.find((h) => h.state === sel.state);
  const width_cm = p.width_cm > 0 ? p.width_cm : (sel.width_in ? sel.width_in * 2.54 : 0);

  // how the stripe meets the design's own repeat
  const comb = lcm(F, N);
  const repeat = {
    feeds: N, from_feeds: red.from, reduced: red.reduced, factor: red.factor, colours, runs: H.runs, sequence: seq.join(''), text: linearText(seq),
    combined_feeds: comb, combined_courses: r2(comb * cpf), combined_mm: r1(comb * cpf * 10 / H.cpc), design_feeds: F,
    interlock_courses: unit === 2 ? N / 2 : null,
  };
  if (red.reduced) add('note', `The stripe repeats itself ${red.factor} times: its repeat is ${N} feed${N === 1 ? '' : 's'} (${specText(runs)}), not ${red.from}. The feeders and the checks work from the real repeat.`);
  if (F > 1 && comb > N) add('note', `The design repeats every ${F} feeds and the stripe every ${N}: together they repeat every ${comb} feeds (${r1(comb * cpf * 10 / H.cpc)} mm of ${sel.state === 'finished' ? 'finished ' : ''}cloth).`);

  // an interlock course is two feeds: a stripe edge inside a course shows both yarns in one row
  if (unit === 2) {
    let at = 0; const odd = [];
    runs.forEach((x) => { if (at % 2) odd.push(x.colour); at += x.feeds; });
    if (odd.length || N % 2) add('warn', `On an interlock one course takes two feeds, but a stripe edge falls on an odd feed (${runs.filter((x) => x.feeds % 2).map((x) => x.colour + x.feeds).join(', ') || 'the repeat is odd'}): the two yarns of that course are different, which shows as a broken edge. Give every stripe an even number of feeds.`);
    else add('ok', 'Every stripe edge falls between two interlock courses.');
  }

  // the machine
  const plan = feederPlan(seq, feeders, p.rpm, p.eff);
  // the design's own repeat must also come round whole on the feeders, or the feeders cannot keep one yarn each
  if (plan.method === 'feeder stripe' && feeders % F) { plan.method = 'striper'; plan.revolutions_per_repeat = plan.cycle_revolutions; }
  const fingersAvail = p.striper || 0;
  const machine = {
    method: plan.method, feeders, fingers_needed: plan.fingers_needed, fingers_available: fingersAvail || null,
    revolutions_per_repeat: plan.revolutions_per_repeat, cycle_revolutions: plan.cycle_revolutions,
    fixed_feeders: plan.fixed_feeders, changing_feeders: plan.changing_feeders,
    cones: { total: plan.cones_total, by_colour: plan.cones_by_colour },
    changes: plan.changes,
    threading: plan.method === 'feeder stripe' ? plan.per.slice(0, 96).map((x) => ({ feeder: x.feeder, yarn: x.colours[0] })) : null,
    schedule: plan.method === 'striper' ? { revolutions: plan.cycle_revolutions, feeders: plan.per.slice(0, 48).map((x) => ({ feeder: x.feeder, fingers: x.colours, by_revolution: x.by_rev ? (x.by_rev.length > 72 ? x.by_rev.slice(0, 72) + '…' : x.by_rev) : null, changes: x.changes })) } : null,
  };
  if (plan.method === 'striper') {
    if (fingersAvail && plan.fingers_needed > fingersAvail) add('error', `A feeder must change between ${plan.fingers_needed} yarns but the stripers have ${fingersAvail} fingers.`, 'machine');
    else if (!fingersAvail) add('error', `A feeder must change between ${plan.fingers_needed} yarns: the machine needs stripers (yarn changers) with at least ${plan.fingers_needed} fingers.`, 'machine');
    else add('ok', `Striper: ${plan.changing_feeders} of ${feeders} feeders change yarn (up to ${plan.fingers_needed} yarns on one), the other ${plan.fixed_feeders} keep one yarn; ${plan.cones_total} cones to hang; the stripe takes ${plan.cycle_revolutions} revolution${plan.cycle_revolutions === 1 ? '' : 's'} to come round.`, 'machine');
    if (plan.changes.peak_in_one_revolution > 0.6 * feeders && feeders > 8) add('note', `In the busiest revolution ${plan.changes.peak_in_one_revolution} of ${feeders} feeders change yarn at once: ask the striper builder what speed that allows (the engine does not know the changer's limit).`);
  } else add('ok', `Feeder stripe: every feeder keeps one yarn, ${feeders / N} stripe repeat${feeders / N === 1 ? '' : 's'} round the machine, ${plan.cones_total} cones to hang.`, 'machine');

  // geometry: the helix
  const perRevFeeds = feeders, geo = tilt(perRevFeeds, cpf, H.cpc, width_cm);
  const narrowest = Math.min(...runs.map((x) => x.feeds * cpf * 10 / H.cpc));
  geo.note = `${feeders} feeders lay ${geo.courses_per_rev} courses in one revolution, so each course is one turn of a helix ${geo.courses_per_rev} courses long: across the ${geo.width_cm ? geo.width_cm + ' cm ' : ''}open width every stripe edge falls ${geo.mm} mm${geo.deg != null ? ' (' + geo.deg + '°)' : ''}, in steps of one course at each feeder. The stripes stay parallel and keep their width; a panel cut square to the roll edge shows them tilted, so cut along the stripe where the panel must be square to it, and expect a step of ${geo.mm} mm where a tube is sewn up.`;
  geo.narrowest_mm = r2(narrowest);
  if (geo.mm >= 5) add('note', `Across the open width the stripe edges fall ${geo.mm} mm (${geo.deg}°) because ${feeders} feeders knit a ${geo.courses_per_rev}-course helix. A panel cut square to the roll edge has tilted stripes: cut along the stripe where it must be square, or use fewer feeders.`, 'geo');
  const tiltOf = (n) => r2((n * cpf * 10) / H.cpc);

  // options
  const o = { cpc: H.cpc, cpf, unit_feeds: unit, tiltOf };
  const options = { feeder_counts: [], repeats: [] };
  if (plan.method === 'striper') {
    options.feeder_counts = feederCounts(N, F, feeders, o);
    options.repeats = snapRepeats(runs.map((x) => ({ colour: x.colour, feeds: x.feeds })), feeders, o);
    if (options.feeder_counts.length) { const f = options.feeder_counts[0]; add('note', `${f.feeders} feeders (instead of ${feeders}) would make this a feeder stripe with your stripes exactly as drawn: no stripers, ${f.stripe_repeats_round} stripe repeat${f.stripe_repeats_round === 1 ? '' : 's'} round the machine${f.relative_output < 1 ? ` (${Math.round((1 - f.relative_output) * 100)} % fewer courses per revolution)` : ''}.`); }
    if (options.repeats.length) {
      const b = options.repeats[0];
      if (b.max_error_pct <= 15) add('note', `Without stripers on ${feeders} feeders: a ${b.feeds}-feed repeat (${b.sequence}) keeps every feeder on one yarn; the biggest change to a stripe is ${Math.abs(b.max_error_mm)} mm (${Math.abs(b.max_error_pct)} %).`);
      else add('note', `No repeat that divides the ${feeders} feeders keeps your stripes within 15 % (the nearest, ${b.sequence}, moves one by ${Math.abs(b.max_error_pct)} %): change the feeders or use stripers.`);
    }
  }

  // production
  const feedsPerHour = p.rpm > 0 ? feeders * p.rpm * 60 * (p.eff > 0 ? p.eff : 1) : null;
  const production = feedsPerHour ? {
    repeats_per_hour: r1(feedsPerHour / N), seconds_per_repeat: r2(3600 * N / feedsPerHour), cloth_m_per_hour: r1((feedsPerHour * cpf / H.cpc) / 100),
    basis: 'feeders × rpm × efficiency ÷ the feeds of one repeat; the cloth length at the selected state',
  } : null;

  // the fit (widths asked in mm)
  const fit = p.fit || null;
  if (fit) {
    const worst = Math.max(0, ...fit.runs.filter((x) => x.error_pct != null).map((x) => Math.abs(x.error_pct)));
    if (worst > 8) add('warn', `Some stripes cannot be made to the width asked: the biggest is ${r1(worst)} % off (${fit.runs.filter((x) => x.error_pct != null).sort((a, b) => Math.abs(b.error_pct) - Math.abs(a.error_pct))[0].colour}, ${fit.runs.filter((x) => x.error_pct != null).sort((a, b) => Math.abs(b.error_pct) - Math.abs(a.error_pct))[0].error_mm} mm) because a course is ${r2(10 / sel.cpc * cpf * unit)} mm tall.`);
    else add('ok', `Widths in mm became whole courses: the repeat is ${fit.repeat_mm} mm (asked ${fit.repeat_asked_mm} mm), the worst stripe is ${r1(worst)} % off.`, 'fit');
  }

  // the garment panel
  const panel = p.panel_cm > 0 ? panelPlan(+p.panel_cm, H.repeat_cm) : null;
  if (panel) {
    if (panel.whole) add('ok', `A ${panel.panel_cm} cm panel is ${panel.repeats_exact} stripe repeats: the stripes match at the seams.`, 'panel');
    else add('note', `A ${panel.panel_cm} cm panel is ${panel.repeats_exact} repeats: cut ${panel.nearest.length_cm} cm (${panel.nearest.repeats} repeats, ${panel.nearest.off_cm > 0 ? '+' : ''}${panel.nearest.off_cm} cm) so the stripes match, or ${panel.shorter.length_cm} / ${panel.longer.length_cm} cm.`, 'panel');
  }

  if (cal && cal.factor) add('ok', `Heights corrected to your trial: ${cal.how}, ${cal.vs_model_pct > 0 ? '+' : ''}${cal.vs_model_pct} % against the model.`, 'cal');

  return {
    success: true, state: sel.state, state_label: sel.label || sel.state,
    repeat, heights, machine, geometry: geo, options, production, fit, panel,
    calibration: cal && cal.factor ? { ...cal, basis: 'measured on your finished trial roll' } : null,
    checks,
    basis: {
      law: ['stripe height = courses × 10 ÷ courses per cm (arithmetic)', 'feeder pass number = revolution × feeders + feeder; it knits the yarn at that place in the repeat (arithmetic)', 'a feeder keeps one yarn when the repeat divides the feeders', `${feeders} feeders lay a ${r1(geo.courses_per_rev)}-course helix (geometry)`],
      typical: ['the courses per cm of each state come from the cloth\'s relaxation states (the factory records place the finished state)'],
      estimate: ['the heights after washing follow the modelled residual shrinkage', 'a changer\'s speed limit is the machine builder\'s: the engine counts changes, it does not claim a limit'],
      replaced_by: 'a stripe repeat measured on your finished trial roll (stripes.measured)',
    },
  };
}

/** a few stripes people draw, as repeats in feeds */
function presets() {
  return [
    { id: 'breton', name: 'Breton (1 × 1)', text: 'A1 B1', note: 'one course of each colour' },
    { id: 'two_two', name: '2 × 2', text: 'A2 B2' },
    { id: 'pin', name: 'Pin stripe', text: 'A12 B1', note: 'a single course of B between wide A bands' },
    { id: 'graded', name: 'Graded bands', text: 'A2 B2 A4 B2 A6 B2 A4 B2', note: 'the A band grows and shrinks' },
    { id: 'engineered_3', name: 'Three colours, balanced', text: 'A8 B4 C2 B4', note: 'wide A, then B, a thin C and B again' },
    { id: 'barcode', name: 'Bar code', text: 'A1 B2 A3 B1 A2 B3 A1 B1' },
  ];
}
/** a repeat read out and back: A B C → A B C B (a mirror repeat), or the same scaled */
function mirror(runs) { if (runs.length < 3) return runs.slice(); return runs.concat(runs.slice(1, -1).reverse()); }
function scale(runs, f) { return runs.map((r) => ({ ...r, feeds: Math.max(1, Math.round(r.feeds * f)) })); }

module.exports = { StripeError, parseSpec, fitSpec, reduce, cyclicRuns, feederPlan, snapRepeats, feederCounts, tilt, panelPlan, calibration, analyse, presets, mirror, scale, specText, MAX_FEEDS };
