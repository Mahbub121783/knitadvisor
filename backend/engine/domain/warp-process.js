/**
 * Warp knitting — beyond the loop: the wet route, the cloth in every state, the guide-bar drive, the open area and the feasibility gates.
 *
 * warp-studio.js answers "what does this lapping knit": runner, weight, width, beams. This module answers the rest of what a warp-knit mill asks of a design,
 * from the SAME answer (nothing here re-derives the loop):
 *
 *   chemistry   the wet route the cloth's fibres need (pre-set, scour, acid or disperse dyeing, softening): yarn-chemistry-engine.js on the fibre mix of the bars
 *   states      the cloth off the machine, relaxed (greige), finished and after washing: wales, courses, weight and width of each
 *   drive       every guide bar course by course: overlap, underlap, shog in mm, the pattern-chain links; the speed the shogging allows
 *   open area   the share of the cloth the light passes through (nets, powernet, spacer faces)
 *   gates       cohesion, yarn against gauge, drive, fibres against the route, elastane, bar balance, finishing: pass / warn / fatal
 *
 * Law = arithmetic on the lapping and the machine; modelled = a typical figure for the class of machine or cloth (said so on the figure).
 */
'use strict';
const CHEMY = require('./yarn-chemistry-engine');
const PDIM = require('./process-dimensions');

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const CHEM_FIBRE = { nylon_filament: 'nylon', nylon_mono: 'nylon', polyester_filament: 'polyester', polyester_spun: 'polyester', polyester_mono: 'polyester', elastane: 'elastane', polypropylene: 'polypropylene', cotton: 'cotton', viscose: 'viscose' };
// the shog a machine class is rated at its top speed for (needle spaces, modelled); a longer shog runs slower, in proportion to 1 / √shog
const REF_SHOG = { tricot: 2, raschel: 3, double_raschel: 3 };
const SHOG_WINDOW = 0.5;          // the share of a machine cycle the guide bars have to shog in (modelled)

/** the fibre mix of the cloth, by mass share of its bars, in the chemistry engine's names */
function mixOf(a) {
  const mix = {};
  a.bars.forEach((b) => { const k = CHEM_FIBRE[b.fibre_id]; if (k) mix[k] = (mix[k] || 0) + (b.pct || 0); });
  const t = Object.values(mix).reduce((s, v) => s + v, 0) || 1;
  Object.keys(mix).forEach((k) => { mix[k] = r1((mix[k] / t) * 100); });
  return mix;
}

// ── the wet route ─────────────────────────────────────────────────────────
function chemistry(a, input) {
  const o = (input && input.chemistry) || {}, shade = CHEMY.DEPTHS.includes(o.shade) ? o.shade : CHEMY.DEPTHS.includes((input.look || {}).shade) ? input.look.shade : 'medium';
  const mix = mixOf(a);
  const lead = a.bars.slice().sort((x, y) => y.pct - x.pct)[0];
  // the chemistry engine takes up to four fibres: a cloth of more is routed on its four largest, and the rest is said
  const ranked = Object.entries(mix).sort((x, y) => y[1] - x[1]), kept = Object.fromEntries(ranked.slice(0, 4)), omitted = ranked.slice(4);
  const keptTotal = Object.values(kept).reduce((t, v) => t + v, 0) || 1;
  const routeMix = omitted.length ? Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, r1((v / keptTotal) * 100)])) : mix;
  let p;
  try { p = CHEMY.profileOf(routeMix, Math.max(1, lead.tex), { filament: a.bars.some((b) => b.filament), shade, heatset: o.heatset, process: o.process, liquor_ratio: o.liquor_ratio }); } catch (e) { if (e instanceof CHEMY.ChemError) return { success: false, error: e.message }; throw e; }
  if (!p) return null;
  return {
    success: true, shade, fibres: mix,
    route: p.route.steps.map((s) => ({ id: s.id, label: s.label, t_c: s.t_c, ph: s.ph, time_min: s.time_min, chemicals: (s.chemicals || []).map((c) => c.name + ' ' + c.g_per_l + ' g/l'), purpose: s.purpose, note: s.note })),
    total_time_min: p.route.total_time_min,
    dyes: ((p.recipe && p.recipe.dyes) || []).map((d) => ({ class: d.class_label || d.class, owf_pct: d.owf_on_yarn_pct, fixation_pct: d.fixation_pct && d.fixation_pct.value, by_fibre: (d.by_fibre || []).map((f) => ({ fibre: f.label, share_pct: f.share_pct, owf_pct: f.owf_pct })) })),
    liquor_ratio: p.recipe && p.recipe.liquor_ratio ? p.recipe.liquor_ratio.value : null,
    fastness: p.fastness && p.fastness.overall ? p.fastness.overall : null, fastness_risks: p.fastness && p.fastness.risks ? p.fastness.risks : [],
    warnings: (p.warnings || []).concat(omitted.length ? [{ level: 'warn', text: `The route is worked out for the four largest fibres; ${omitted.map(([k, v]) => v + ' % ' + k).join(', ')} is not in it: check that fibre's own route (dye class, heat-set limit) separately.` }] : []),
    basis: 'the yarn chemistry engine on the fibre mix of the bars: typical conventions for the order, temperature, pH and dye amounts; a lab dip replaces them',
  };
}

// ── the cloth in every state ─────────────────────────────────────────────
/**
 * Finished is the state the Studio solves (the published tricot and locknit data). The others are placed against it:
 *   greige     off the machine, relaxed, before it is set: narrower than finished (a heat-set widens it back out), the more so with elastane
 *              (published elastic locknit: ≈330 cm on the machine, 140–150 cm relaxed greige, widened 20–30 % in pre-setting)
 *   after wash residual shrinkage of the finished cloth, by fibre class, moved by the route (process-dimensions.js)
 */
function states(a, mix, route) {
  const F = a.fabric, M = a.machine;
  const el = (mix.elastane || 0) > 0, cellulosic = (mix.cotton || 0) + (mix.viscose || 0) >= 50;
  const widen = el ? 0.26 : 0.06, lengthen = el ? 0.08 : 0.03;
  const base = el ? { length_pct: -3.0, width_pct: -4.0 } : cellulosic ? { length_pct: -5.0, width_pct: -4.0 } : { length_pct: -1.5, width_pct: -1.5 };
  let pd = null;
  try { pd = PDIM.analyse({ fibres: mix, steps: (route || []).map((s) => ({ id: s.id, label: s.label, t_c: s.t_c, ph: s.ph, chemicals: s.chemicals })), shade: null, finishes: [], base }); } catch (e) { pd = null; }
  const after = pd ? pd.after_wash : { length_pct: base.length_pct, width_pct: base.width_pct };
  const dens = (w, c) => F.gsm * ((w * c) / (F.wpc * F.cpc));
  const row = (state, label, wpc, cpc, basis) => ({ state, label, wpc: r2(wpc), cpc: r2(cpc), gsm: Math.round(dens(wpc, cpc)), width_in: r1(F.width_in * F.wpc / wpc), basis });
  const wpcM = M.gauge / 2.54;
  const out = [
    row('machine', 'On the machine (knitted, under take-down)', wpcM, M.cpc_machine, 'law: the needle pitch and the quality set on the machine'),
    row('greige', 'Greige (off the machine, relaxed, before it is set)', F.wpc * (1 + widen), F.cpc * (1 + lengthen), 'modelled: the set widens the cloth back out; elastane relaxes the most'),
    row('finished', 'Finished (set, dyed, finished)', F.wpc, F.cpc, 'the state the Studio solves'),
    row('washed', 'After washing (home laundering)', F.wpc / (1 + after.width_pct / 100), F.cpc / (1 + after.length_pct / 100), 'estimate: residual shrinkage by fibre class, moved by the wet route'),
  ];
  return { states: out, after_wash: { length_pct: after.length_pct, width_pct: after.width_pct }, route_effects: pd ? pd.changes : [], basis: 'finished solved; machine is law; greige and washed are typical figures for the class of cloth: a before / after reading of one lot replaces them' };
}

// ── the guide-bar drive ──────────────────────────────────────────────────
function drive(a, input) {
  const M = a.machine, step = +((input.machine || {}).notation_step) === 2 ? 2 : 1, p = M.pitch_mm, ref = REF_SHOG[M.type] || 2;
  let maxU = 0, maxBar = 0, links = 0;
  const bars = a.lapping.map((l, bi) => {
    const P = l.pairs, n = P.length;
    const courses = P.map(([x, y], k) => {
      const [nx] = P[(k + 1) % n], o = Math.abs(y - x), u = Math.abs(nx - y);
      return { course: k + 1, from: x, to: y, overlap: o, underlap: u, shog_mm: r2(u * p), chain: [step === 2 ? x * 2 : x, step === 2 ? y * 2 : y] };
    });
    const mu = Math.max(...courses.map((c) => c.underlap));
    if (mu >= maxU) { maxU = mu; maxBar = l.bar; }
    links += 2 * n;
    return {
      bar: l.bar, courses, chain_links: 2 * n, max_underlap: mu, travel_per_repeat_mm: r1(courses.reduce((t, c) => t + c.shog_mm + c.overlap * p, 0)),
      chain: courses.map((c) => c.chain.join('-')).join(' '),
    };
  });
  const rated = (M.speed_range && M.speed_range[1]) || M.speed_cpm;
  const allowed = maxU > ref ? Math.round(rated * Math.sqrt(ref / maxU)) : rated;
  const meanMmS = maxU > 0 && M.speed_cpm > 0 ? r1((maxU * p) / (SHOG_WINDOW * 60 / M.speed_cpm)) : 0;
  return {
    bars, chain_links_total: links, longest_shog_needles: maxU, longest_shog_mm: r2(maxU * p), longest_shog_bar: maxBar,
    speed_cpm: M.speed_cpm, rated_top_cpm: rated, speed_allowed_cpm: allowed, speed_ok: M.speed_cpm <= allowed, mean_shog_speed_mm_s: meanMmS,
    basis: `law: shog = underlap × needle pitch; two chain links per course per bar. modelled: the class is rated at its top speed for a ${ref}-needle shog and a longer one runs slower in proportion to 1/√shog (a guide bar's peak acceleration grows with the distance and the square of the speed); the shog has ${SHOG_WINDOW * 100} % of the cycle`,
  };
}

// ── open area ────────────────────────────────────────────────────────────
/**
 * The light passes where no yarn lies. Yarn laid per cm² of finished cloth × its flat width (a multifilament spreads to ≈2.2 × its diameter, a monofilament or a
 * spun yarn does not) is the cover; the yarn layers overlap at random, so the open share is e^(−cover). A model, not a measurement: for nets and powernets
 * the part-threaded needles' holes decide, and this is then an order of magnitude.
 */
function openArea(a) {
  const F = a.fabric, W_cm = F.width_in * 2.54;
  let cover = 0;
  a.bars.forEach((b) => {
    const ends = b.ends / W_cm, spread = b.filament && !b.mono ? 2.2 : 1.0, lcFed = (b.mm_per_course / (b.draft || 1)) / 10;
    cover += ends * F.cpc * lcFed * ((b.d_mm / 10) * spread);
  });
  const eyelets = Math.exp(-cover);
  // cells (a needle at a course) where no bar forms a loop: the holes of a net. A loop fills its cell; an empty cell lets the light through
  let empty = 0;
  if (a.structure.beds === 1) {
    const P = a.lapping.map((l) => l.pairs), thr = a.bars.map((b) => b.threading || 'X');
    const rep = P.reduce((t, x) => { const g = (u, v) => (v ? g(v, u % v) : u); return (t / g(t, x.length)) * x.length; }, 1);
    if (rep <= 96) {
      let cells = 0, loops = 0;
      for (let n = 16; n < 40; n++) for (let k = 0; k < rep; k++) {
        cells++;
        const filled = P.some((pairs, bi) => {
          const T = thr[bi].length, [x, y] = pairs[k % pairs.length];
          if (x === y) return false;
          const at = Math.min(x, y);                                    // the loop's needle, from the guide that put it there: guide g loops on needle at + g
          const g = n - at;
          return thr[bi][((g % T) + T) % T] === 'X';
        });
        if (filled) loops++;
      }
      empty = cells ? 1 - loops / cells : 0;
    }
  }
  const open = (empty * 0.8 + (1 - empty) * eyelets) * 100;
  const kind = open < 5 ? 'closed' : open < 25 ? 'semi-open' : 'open (net-like)';
  return { open_area_pct: r1(open), cover: r2(cover), empty_cells_pct: r1(empty * 100), kind, basis: 'estimate: the loopless cells of the repeat (the holes of a net) plus the eyelets of the loops, from the random overlap of the yarn laid per cm² × its flat width; not measured on a lightbox' };
}

// ── the gates ────────────────────────────────────────────────────────────
function gates(a, input, ch, dr) {
  const rules = [], M = a.machine, p = M.pitch_mm, mix = ch && ch.fibres ? ch.fibres : mixOf(a);
  const rule = (id, name, gate, status, text, basis) => rules.push({ id, name, gate, status, text, basis: basis || 'law' });
  const errs = a.checks.filter((c) => c.level === 'error');
  const cohesion = errs.filter((c) => /not joined|no bar makes a loop|inlays|separate pieces|nothing joins|not held together|not knitted at that course/.test(c.text));
  rule('W-01', 'Cohesion', 1, cohesion.length ? 'fatal' : 'pass', cohesion.length ? cohesion[0].text : 'Every course forms loops, the wales are joined sideways and any inlay is held by a bar in front of it.');
  const maxU = dr.longest_shog_needles;
  rule('W-02', 'Shog within the machine', 1, errs.some((c) => /shogs/.test(c.text)) ? 'fatal' : 'pass', errs.some((c) => /shogs/.test(c.text)) ? errs.find((c) => /shogs/.test(c.text)).text : `The longest underlap is ${maxU} needle${maxU === 1 ? '' : 's'} (${dr.longest_shog_mm} mm): within what a ${M.type.replace('_', ' ')} guide bar shogs.`);
  // yarn against gauge
  const thick = a.bars.filter((b) => b.d_mm / p > (M.type === 'tricot' ? 0.28 : 0.36) && !b.mono), thin = a.bars.filter((b) => b.d_mm / p < 0.04 && !b.mono);
  rule('W-03', 'Yarn against gauge', 2, thick.length ? 'warn' : 'pass', thick.length ? `Bar ${thick.map((b) => b.bar).join(', ')}: the yarn is ${r2(thick[0].d_mm / p * 100)} % of the ${r2(p)} mm needle pitch: the loops crowd the needle, the compound needle and the guides run tight. Use a finer yarn or a coarser gauge.` : thin.length ? `Fine yarn for E${M.gauge} (bar ${thin.map((b) => b.bar).join(', ')}): the cloth will be open and the loops lie loose.` : `Every yarn sits well in the ${r2(p)} mm needle pitch.`, 'practice');
  // the drive against the speed
  rule('W-04', 'Drive against speed', 2, dr.speed_ok ? 'pass' : 'warn', dr.speed_ok ? `${M.speed_cpm} courses/min is within the ${dr.speed_allowed_cpm} this class allows for a ${maxU}-needle shog.` : `${M.speed_cpm} courses/min is above the ${dr.speed_allowed_cpm} a ${maxU}-needle shog allows (bar ${dr.longest_shog_bar}, modelled): the guide bar cannot shog that far that fast. Slow the machine or shorten the underlap.`, 'modelled');
  // fibres against the route
  const hs = ch && ch.route ? ch.route.find((s) => s.id === 'heatset') : null;
  const pp = (mix.polypropylene || 0) > 0, ela = (mix.elastane || 0) > 0, ny = (mix.nylon || 0) > 0, pe = (mix.polyester || 0) > 0;
  if (pp && (ela || (hs && hs.t_c >= 150))) rule('W-05', 'Fibres against the route', 3, 'fatal', `Polypropylene melts at about 165 °C but ${ela ? 'the elastane needs setting at 170–190 °C' : `the route heat-sets at ${hs.t_c} °C`}: the polypropylene would fuse. Set below 150 °C, or leave polypropylene out of a set cloth.`, 'practice');
  else if (ny && pe) rule('W-05', 'Fibres against the route', 3, 'warn', 'Nylon and polyester in one cloth need two dye classes (acid and disperse): the nylon stains the polyester and the reverse. Dye the yarns separately, or choose one class and accept a mock shade.', 'practice');
  else rule('W-05', 'Fibres against the route', 3, 'pass', ch && ch.success ? `The route (${ch.route.map((s) => s.label).join(' → ')}) suits ${Object.entries(mix).map(([k, v]) => v + ' % ' + k).join(', ')}.` : 'No route problem found.', 'practice');
  // elastane
  const eb = a.bars.filter((b) => b.fibre_id === 'elastane');
  if (eb.length) {
    const bad = eb.find((b) => b.draft && (b.draft > 3.6 || b.draft < 1.6));
    const share = mix.elastane || 0;
    rule('W-06', 'Elastane', 3, bad ? 'warn' : share < 4 ? 'warn' : 'pass', bad ? `Bar ${bad.bar}: a total draft of ${bad.draft} is outside the 1.6–3.6 an elastane is usually fed at (modelled): it breaks or does not recover.` : share < 4 ? `Only ${r1(share)} % elastane: little power and poor recovery; 8–20 % is usual for a power-stretch cloth.` : `${r1(share)} % elastane at a draft of ${eb[0].draft}: within the usual range; it needs setting at 170–190 °C.`, 'practice');
  } else rule('W-06', 'Elastane', 3, 'na', 'No elastane in the cloth.', 'practice');
  // balance of the bars: runner of the front against the back
  if (a.bars.length >= 2 && a.structure.beds === 1) {
    const f = a.bars[0], bk = a.bars[a.bars.length - 1], ratio = f.runner_mm_per_rack / Math.max(1, bk.runner_mm_per_rack);
    const odd = ratio < 0.55 || ratio > 2.4;
    rule('W-07', 'Bar balance', 2, odd ? 'warn' : 'pass', odd ? `The front bar runs ${Math.round(f.runner_mm_per_rack)} mm per rack against ${Math.round(bk.runner_mm_per_rack)} for the back: a ratio of ${r2(ratio)}. Far from the usual 0.7–2 the loops lean and the cloth curls or skews.` : `Front runner ${Math.round(f.runner_mm_per_rack)} mm per rack, back ${Math.round(bk.runner_mm_per_rack)} (ratio ${r2(ratio)}): balanced.`, 'practice');
  } else rule('W-07', 'Bar balance', 2, 'na', 'One bar, or a double-needle-bar cloth: the faces balance on their own beds.', 'practice');
  // finishing: how far the set must widen the cloth
  const gx = a.fabric.relax.kw, st = a.states ? a.states.states : null;
  const wd = st ? st.find((s) => s.state === 'greige') : null;
  if (wd) {
    const widen = (a.fabric.width_in / wd.width_in - 1) * 100;
    rule('W-08', 'Finishing width', 3, widen > 35 ? 'warn' : 'pass', widen > 35 ? `The set has to widen the greige cloth ${Math.round(widen)} % to reach ${a.fabric.width_in}": more than a stenter or a heat-setting frame usually gives, and the edges will pull. Aim for a narrower finished width.` : `The set widens the greige cloth about ${Math.round(widen)} % to ${a.fabric.width_in}" (modelled).`, 'modelled');
  }
  // an open structure with pressed-off needles in a cloth that should be closed
  rule('W-09', 'Closed cloth', 2, a.checks.some((c) => c.level === 'warn' && /hole or a dropped stitch/.test(c.text)) ? 'warn' : 'pass', a.checks.some((c) => /hole or a dropped stitch/.test(c.text)) ? a.checks.find((c) => /hole or a dropped stitch/.test(c.text)).text : 'No needle is left without a loop in a closed cloth.');
  const fatal = rules.filter((r) => r.status === 'fatal'), warn = rules.filter((r) => r.status === 'warn');
  return { rules, verdict: fatal.length ? 'fatal' : warn.length ? 'warn' : 'pass', export_locked: fatal.length > 0 || !a.ok_to_knit, counts: { fatal: fatal.length, warn: warn.length, pass: rules.filter((r) => r.status === 'pass').length, na: rules.filter((r) => r.status === 'na').length } };
}

/** everything beyond the loop, from one warp analysis; each part is recorded, not swallowed, if it fails */
function analyse(a, input) {
  const faults = [];
  const guard = (name, fn) => { try { return fn(); } catch (e) { faults.push({ engine: name, error: String((e && e.message) || e).slice(0, 160) }); return null; } };
  const ch = guard('chemistry', () => chemistry(a, input));
  const mix = (ch && ch.fibres) || mixOf(a);
  const st = guard('states', () => states(a, mix, ch && ch.route));
  const dr = guard('drive', () => drive(a, input));
  const oa = guard('open_area', () => openArea(a));
  const gt = dr ? guard('gates', () => gates({ ...a, states: st }, input, ch, dr)) : null;
  return { chemistry: ch, states: st, drive: dr, open_area: oa, gates: gt, faults };
}

module.exports = { analyse, chemistry, states, drive, openArea, gates, mixOf, REF_SHOG, CHEM_FIBRE };
