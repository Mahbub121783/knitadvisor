/**
 * KnitAdvisor — Flat V-bed compiler: what a flat knitting machine makes of the needle programme the Studio has drawn.
 *
 * A flat machine has two needle beds in an inverted V (front and back), a carriage that runs along them knitting one course per system per
 * pass, and — unlike a circular machine — it can transfer loops from one bed to the other, shift (rack) one bed against the other, and knit
 * pieces to shape. The loops are the same loops, so the weight, density and yarn per loop are the Studio's own; the machine around them is different:
 *
 *   YARN ENVELOPE     the knitting yarn (plies, and a plated back yarn, added) must fit the needle: tex ≤ 24000 ÷ GG² (typical); too thick
 *                     and the hook or the sinker cannot close on it
 *   TRANSFERS         a loop moved to the other bed (R) or to the next needle (E) is stretched and must survive it: a yarn that
 *                     breaks at under 6 % elongation will not stand many; a transfer further than 2 needles needs a yarn that gives
 *   RACKING           the back bed shifted ±1 to ±6 needles for cables, racked ribs and shaping: the loops held on the shifted bed are
 *                     stretched sideways; how far a yarn allows by its elongation
 *   WIDTH             needles = width × gauge; the finished width of a panel follows the wales per cm of the cloth
 *   PRODUCTION        courses per hour from the carriage speed and the length of travel, per system, at the machine's efficiency
 *   PROGRAMME         the passes in order: direction, yarn carrier, what each bed does
 *
 * Basis: law = the arithmetic of needles, passes and mass; typical = the envelope, the transfer and racking limits and the efficiency, which a
 * machine maker's data sheet and a trial panel replace. No outside source is named.
 */
'use strict';
const BY = require('./blend-yarn-engine');

class VbedError extends Error { constructor(m) { super(m); this.name = 'VbedError'; } }

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V = (value, unit, basis, extra) => (value == null || !Number.isFinite(value) ? null : { value, unit, basis, ...(extra || {}) });

const GAUGE = [5, 18], ENVELOPE = 24000;
const CARRIER = { ground: 1, face: 1, binder: 2, loop: 3, plate: 4 };

function elongationOf(fibres, tex, spinning) {
  try {
    const mix = Object.fromEntries(Object.entries(fibres || { cotton: 100 }).filter(([k]) => BY.FIB[k]));
    if (!Object.keys(mix).length) return null;
    const r = BY.analyse({ fibres: mix, count: { value: clamp(tex, 2, 120), unit: 'tex' }, spinning: spinning && BY.GEO[spinning] ? spinning : undefined });
    return r.tensile.elongation_at_break.value;
  } catch (e) { return null; }
}

/** compile(out, input, extra) — out: the Studio answer; input: the design; extra: { plate_tex, fibres, spinning } */
function compile(out, input, extra) {
  const ex = extra || {};
  const vb = (input && input.vbed) || {};
  const st = out.structure || {}, fab = out.fabric || {}, yarn = out.yarn || {};
  const C = st.beds && st.beds.C, D = st.beds && st.beds.D;
  if (!C) throw new VbedError('Draw a needle programme first.');
  const F = C.length, W = C[0].length, nb = D ? 2 : 1;
  const feeds = yarn.feeds || [];
  const checks = [];
  const add = (level, text, extra2) => checks.push({ level, text, ...(extra2 || {}) });

  // the knitting yarn of the thickest feed, with its plies and any plated back yarn
  const knitFeeds = feeds.map((f, i) => ({ f, i, knits: [C, D].filter(Boolean).some((g) => g[i] && (g[i].includes('K') || g[i].includes('T'))) })).filter((x) => x.knits);
  const plated = (x) => !!x.f.plated;
  const texOf = (x) => (+x.f.tex || 0) + (plated(x) ? +ex.plate_tex || 0 : 0);
  const thick = knitFeeds.reduce((m, x) => (texOf(x) > m.tex ? { tex: texOf(x), i: x.i, plated: plated(x) } : m), { tex: 0, i: -1, plated: false });
  // the gauge: the one asked for, else the finest whose envelope the thickest yarn fits
  const rec = clamp(Math.floor(Math.sqrt(ENVELOPE / Math.max(thick.tex, 1))), GAUGE[0], GAUGE[1]);
  const asked = +vb.gauge > 0 ? +vb.gauge : null;
  const GG = asked || rec;
  if (GG < GAUGE[0] || GG > GAUGE[1]) add('error', `${GG} GG is outside what a flat V-bed knits (${GAUGE[0]}-${GAUGE[1]} GG).`);
  const env = ENVELOPE / (GG * GG);
  const fits = thick.tex <= env;
  const gaugeNeeded = thick.tex > 0 ? Math.floor(Math.sqrt(ENVELOPE / thick.tex)) : null;
  if (!fits) add(thick.tex > env * 1.25 ? 'error' : 'warn', `The knitting yarn of feed ${thick.i + 1} is ${r1(thick.tex)} tex${thick.plated ? ' (the face and the plated back yarn together)' : ''}: more than the ${r1(env)} tex a ${GG} GG needle takes (${ENVELOPE} ÷ GG²).${gaugeNeeded ? ` Use ${gaugeNeeded} GG or coarser, or a finer yarn.` : ''}`, { rule: 'U-04' });
  else add('ok', `Knitting yarn ${r1(thick.tex)} tex against a ${r1(env)} tex envelope at ${GG} GG.`, { rule: 'U-04' });

  // transfers
  let E = 0, R = 0;
  for (const [g, bed] of [[C, 'C'], [D, 'D']]) if (g) g.forEach((row) => row.forEach((x) => { if (x === 'E') E++; if (x === 'R') R++; }));
  const elong = elongationOf(ex.fibres, thick.tex || 20, ex.spinning);
  const transfers = E + R;
  if (transfers) {
    if (elong != null && elong < 6) add('warn', `${transfers} loop transfer${transfers > 1 ? 's' : ''} per repeat, and the yarn breaks at ${r1(elong)} % elongation: under about 6 % a yarn does not stand the stretch of a transfer. Use a finer or more elastic yarn, or plate it with a filament.`, { rule: 'transfer' });
    else add('note', `${transfers} loop transfer${transfers > 1 ? 's' : ''} per repeat (${R} to the other bed, ${E} to the next needle): each is a stretch of one needle pitch or less${elong != null ? `; the yarn gives ${r1(elong)} %` : ''}.`, { rule: 'transfer' });
  }
  // racking
  const rack = Math.round(+vb.rack || 0);
  const rackMax = elong == null ? 4 : elong >= 12 ? 6 : elong >= 8 ? 4 : 2;
  if (rack) {
    if (!D) add('warn', 'Racking shifts the back bed against the front: a single-bed design has no back bed to rack.', { rule: 'rack' });
    else if (Math.abs(rack) > 6) add('error', `Racking by ${Math.abs(rack)} needles: a flat V-bed racks at most ±6.`, { rule: 'rack' });
    else if (Math.abs(rack) > rackMax) add('warn', `Racking by ${Math.abs(rack)} needles stretches the held loops further than this yarn gives${elong != null ? ` (${r1(elong)} % elongation allows about ${rackMax})` : ''}: expect dropped stitches and broken ends. Rack less, or use a more elastic yarn.`, { rule: 'rack' });
    else add('ok', `Racking by ${Math.abs(rack)} needle${Math.abs(rack) > 1 ? 's' : ''} is within what the yarn gives (up to about ${rackMax}).`, { rule: 'rack' });
  }
  // tucks in a row are the Studio's own (checks of the analysis): the flat machine takes at most 3 loops in one hook
  // width and production
  const widthIn = clamp(+vb.width_in > 0 ? +vb.width_in : 52, 20, 90);
  const needles = Math.round(widthIn * GG);
  const workC = C[0].map((_, j) => (C.some((r) => r[j] === 'K' || r[j] === 'T') ? 1 : 0)).reduce((t, v) => t + v, 0) / W;
  const workD = D ? D[0].map((_, j) => (D.some((r) => r[j] === 'K' || r[j] === 'T') ? 1 : 0)).reduce((t, v) => t + v, 0) / W : 0;
  const wales = needles * (workC + workD);
  const wpc = +fab.wpc || 0;
  const panelIn = wpc > 0 ? wales / (wpc * 2.54) : null;
  const speed = clamp(+vb.speed_m_s > 0 ? +vb.speed_m_s : 1.2, 0.4, 1.6), systems = clamp(Math.round(+vb.systems) || 2, 1, 4);
  const eff = clamp((+vb.efficiency > 0 ? +vb.efficiency : 65) / 100, 0.2, 0.95);
  const travelM = (needles / GG) * 0.0254 + 0.15;
  const passTime = travelM / speed;
  const coursesH = (3600 / passTime) * systems * eff;
  const perNeedle = feeds.reduce((t, f) => t + (+f.share || 0) * (+f.sl_mm || 0) * (+f.tex || 0), 0) / Math.max(1, F);      // mm·tex per needle per course, mean over the repeat
  const massCourse = (wales * perNeedle) / 1e6;                        // g
  const kgH = (coursesH * massCourse) / 1000;
  if (speed > 1.4 && GG >= 14) add('note', `A carriage speed of ${r2(speed)} m/s at ${GG} GG is the top of the range: expect more yarn breaks on a fine gauge. 1.0-1.2 m/s is the usual running speed.`, { rule: 'speed' });
  // the programme: one pass per feed, the carriage alternating direction
  const program = Array.from({ length: F }, (_, i) => {
    const f = feeds[i] || {};
    const front = C[i].join(''), back = D ? D[i].join('') : null;
    const tr = [...C[i], ...(D ? D[i] : [])].filter((x) => x === 'E' || x === 'R').length;
    return { pass: i + 1, direction: i % 2 === 0 ? 'left → right' : 'right → left', carrier: (ex.carriers && ex.carriers[i]) || CARRIER[f.role] || 1, role: f.role || 'ground', yarn: f.yarn || null, stitch_mm: f.sl_mm || null, stitch_ratio: f.sl_mm ? r2(f.sl_mm / (25.4 / GG)) : null, front, back, transfers: tr };
  });
  const errors = checks.filter((c) => c.level === 'error').length;
  return {
    success: true,
    machine: { class: 'flat V-bed', gauge: GG, gauge_recommended: rec, gauge_source: asked ? 'your setting' : 'the finest gauge the thickest yarn fits', needle_pitch_mm: r2(25.4 / GG), bed_width_in: widthIn, needles_per_bed: needles, systems, carriage_speed_m_s: r2(speed), efficiency_pct: Math.round(eff * 100) },
    envelope: { yarn_tex: V(r1(thick.tex), 'tex of the thickest knitting yarn', 'law', { feed: thick.i + 1, plated: thick.plated }), limit_tex: V(r1(env), 'tex', 'typical', { formula: `${ENVELOPE} ÷ GG²` }), fits, gauge_needed: gaugeNeeded, elongation_pct: elong != null ? V(r1(elong), '% at break', 'blend') : null },
    transfers: { to_other_bed: R, to_next_needle: E, racking: rack },
    panel: { wales: Math.round(wales), finished_width_in: panelIn != null ? V(r1(panelIn), 'in, finished', 'estimate') : null, note: 'The cloth is the Studio\'s: its density and weight come from the factory records of circular fabric, so a flat-knitted panel is an estimate until a trial panel is weighed.' },
    production: { courses_per_hour: V(Math.round(coursesH), 'courses/h', 'estimate'), pass_seconds: r2(passTime), kg_per_hour: V(r3(kgH), 'kg/h', 'estimate'), travel_m: r2(travelM), formula: 'courses/h = 3600 ÷ pass time × systems × efficiency; pass time = (bed length + 0.15 m) ÷ speed' },
    program,
    checks,
    ok_to_knit: errors === 0,
    basis: { law: ['needles = width × gauge', 'courses per hour from the carriage speed and the travel', 'the mass of the loops'], typical: ['the yarn envelope 24000 ÷ GG²', 'the transfer and racking limits by elongation', 'the machine efficiency'], replaced_by: 'the machine maker\'s data sheet and a weighed trial panel' },
  };
}

function catalogue() { return { gauges: GAUGE, envelope: `${ENVELOPE} ÷ GG²`, defaults: { width_in: 52, speed_m_s: 1.2, systems: 2, efficiency_pct: 65, rack: 0 }, carriers: CARRIER }; }

module.exports = { compile, catalogue, VbedError, GAUGE, ENVELOPE };
