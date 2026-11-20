/**
 * Fabric development sheet — the R&D person's whole job in one answer.
 *
 * The person gives what they know: the composition, the weight, the colour depth, the machine diameter, whether the cloth is brushed or peached,
 * and the needle design. Everything a development roll needs comes back on one sheet: what fabric it is, the yarn (and elastane on every or alternate
 * feeders), the machine set-up, the greige weight, the dyeing route with its chemicals, the finishing prescription and the finished cloth.
 *
 * The weight is solved PHYSICS-FIRST for a structure the factory records do not cover: the stitch length is the one at which the stitch-graph laws
 * (second-opinion.js, geometry-laws.js) weigh the target, not the one the nearest family's table gives. For a structure the records DO cover, the
 * family answer (cross-validated on 2,075 rolls) is used, and the laws are shown beside it. Every section carries its basis; nothing is called exact.
 * The only road to a tight number is a trial roll: the sheet says what to measure and where to enter it.
 */
'use strict';

const SO = require('./second-opinion');

class SheetError extends Error { constructor(m) { super(m); this.name = 'SheetError'; } }
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const SHADES = { white: 'white', light: 'light', medium: 'medium', dark: 'dark', navy: 'dark', black: 'dark', navy_black: 'dark', 'dark/navy': 'dark', 'light/medium': 'medium' };
const BRUSH = { none: 'none', no: 'none', back: 'back', face: 'face', peach: 'face', both: 'both' };
// what the records cannot see for a structure they do not cover: the physics-first answer was 12–16 % off in the floor-skip test (tools/floor-skip.js)
const LAWS_BAND = 0.14;

const clean = (inp) => JSON.parse(JSON.stringify(inp));

/** The design the sheet's answer is worked on, from the R&D inputs. */
function designOf(raw) {
  const d = raw && raw.design && typeof raw.design === 'object' ? clean(raw.design) : null;
  if (!d || !d.grid) throw new SheetError('Draw the needle design first: the sheet is worked out for that structure.');
  const comp = raw.composition;
  if (!comp) throw new SheetError('Give the composition, e.g. "95% CO 5% EL".');
  const gsm = +raw.gsm;
  if (!(gsm >= 60 && gsm <= 700)) throw new SheetError('Give the finished weight in GSM (60–700).');
  const shade = SHADES[String(raw.shade || 'medium').toLowerCase()];
  if (!shade) throw new SheetError('Colour depth is one of: white, light, medium, dark (navy / black).');
  const brush = BRUSH[String(raw.brush || 'none').toLowerCase()];
  if (!brush) throw new SheetError('Brushing is one of: none, back, face (peach), both.');
  const dia = raw.dia != null && raw.dia !== '' ? +raw.dia : null;
  if (dia != null && !(dia >= 8 && dia <= 60)) throw new SheetError('Machine diameter is 8–60 inches.');
  d.target = { ...(d.target || {}), gsm, composition: comp };
  if (+raw.width_in > 0) d.target.width_in = +raw.width_in;
  if (+raw.shrinkage_pct > 0) d.target.shrinkage_pct = +raw.shrinkage_pct;
  d.machine = { ...(d.machine || {}) };
  if (dia) d.machine.dia = dia;
  d.chemistry = { ...(d.chemistry || {}), enabled: true, shade };
  d.look = { ...(d.look && typeof d.look === 'object' ? d.look : {}), shade, ...(raw.colour && /^#[0-9a-f]{6}$/i.test(raw.colour) ? { colour: raw.colour } : {}) };
  d.finish = { ...(d.finish || {}), brush };
  d.hand = { ...(d.hand || {}), enabled: true };
  const pts = (Array.isArray(raw.vdq_points) ? raw.vdq_points : []).filter((p) => +p.reading > 0 && +p.course_length_m > 0).slice(0, 2).map((p) => ({ reading: +p.reading, course_length_m: +p.course_length_m }));
  if (pts.length) d.machine.vdq = { points: pts };
  return { design: d, shade, brush };
}

// the stitch length at which the stitch-graph laws weigh the target (fixed-point on gsm ∝ 1/sl)
function lawsSolve(design, analyse, start, pin) {
  let sl = start, last = null;
  design.machine = { ...design.machine, gauge: pin.gauge, dia: pin.dia };      // the machine and the yarn stay the ones chosen: the stitch length moves, nothing else
  design.yarn = { ...(design.yarn || {}), count: pin.ne, unit: 'ne' };
  const lo = start * 0.5, hi = start * 3;
  for (let k = 0; k < 12; k++) {
    const d = clean(design); d.machine = { ...d.machine, sl_mm: sl };
    const out = analyse(d); if (!out || !out.success) return null;
    const so = SO.forDesign(out._design || d, out);
    if (!so || so.status === 'incomplete' || !(so.gsm > 0)) return { ok: false, so, reason: so ? 'the laws do not cover every stitch of this design (' + (so.missing || []).join('; ') + ')' : 'no law answer for this design' };
    last = { sl, so, out };
    const ratio = so.gsm / design.target.gsm;
    if (Math.abs(ratio - 1) < 0.004) { last.converged = true; break; }
    sl = Math.min(hi, Math.max(lo, sl * Math.pow(ratio, 1 / 0.88)));        // the laws' weight falls as sl^-0.88 at a fixed gauge
  }
  return last ? { ok: last.converged === true, converged: !!last.converged, reason: last.converged ? null : 'the laws did not reach the target weight inside half to three times the family stitch length', ...last } : null;
}

const feedingWord = (every) => (every === 'alternate' ? 'half feeder: elastane on every second feeder' : 'full feeder: elastane on every feeder');

/**
 * build(raw, analyse) — raw: { design, composition, gsm, shade, brush, dia?, width_in?, shrinkage_pct?, colour? }; analyse: the Studio's analyse.
 */
function build(raw, analyse) {
  const { design, shade, brush } = designOf(raw);
  let out = analyse(clean(design));
  if (out && out.success === false && /no elastane in the probe/.test(out.error || '')) throw new SheetError('This design (a sinker-loop plush / terry) does not carry elastane in the Studio: give the composition without elastane.');
  if (!out || out.success === false) throw new SheetError(out && out.error ? out.error : 'The Studio could not work this design out.');
  const conf = out.structure.confidence || {};
  const recordBacked = conf.level === 'verified' || conf.level === 'calibrated';
  const family = out.structure.family;
  const familySl = out.fabric.sl_mm;
  // ── physics first for a structure the records do not cover ───────────────────────────────────────────────
  let weightPath = { path: 'family records', why: recordBacked ? `the structure is in the factory records (${conf.level})` : 'physics-first was not possible', laws: null, band_pct: recordBacked ? 5 : null };
  let designUsed = clean(design);
  if (!recordBacked && !out.plush && family !== 'plush') {
    const s = lawsSolve(clean(design), analyse, familySl, { gauge: out.machine.gauge, dia: out.machine.dia, ne: out.yarn.ground && out.yarn.ground.equivalents ? out.yarn.ground.equivalents.ne : null });
    // the laws are trusted only where their answer is a cloth the factory could knit: the tightness factor must sit inside the factory window of the family
    const tfw = out.fabric.tf_window, gTex = out.yarn.feeds && out.yarn.feeds[0] ? out.yarn.feeds[0].tex : null;
    const lawsTf = s && s.ok && gTex ? Math.sqrt(gTex) / (s.sl / 10) : null;
    const tfOk = !tfw || lawsTf == null || (lawsTf >= tfw.p5 * 0.92 && lawsTf <= tfw.p95 * 1.08);
    if (s && s.ok && !tfOk) s.reason = `the laws' stitch length ${r2(s.sl)} mm gives a tightness factor ${r1(lawsTf)}, outside the ${tfw.p5}–${tfw.p95} the factory knits this family at`;
    if (s && s.ok && tfOk && Math.abs(familySl / s.sl - 1) <= 0.30) {
      designUsed.machine = { ...designUsed.machine, sl_mm: s.sl, gauge: out.machine.gauge, dia: out.machine.dia };
      designUsed.yarn = { ...(designUsed.yarn || {}), count: out.yarn.ground.equivalents.ne, unit: 'ne' };
      const o2 = analyse(clean(designUsed));
      if (o2 && o2.success !== false) {
        const diff = (familySl / s.sl - 1) * 100;
        weightPath = { path: 'stitch-graph laws (physics first)', why: 'no factory records for this structure: the stitch length is the one at which the loop-geometry laws weigh the target', laws: { sl_mm: r2(s.sl), family_table_sl_mm: r2(familySl), difference_pct: r1(diff), laws_used: s.so.laws }, band_pct: Math.round(LAWS_BAND * 100) };
        out = o2;
        // the headline weight and width are the laws' own, not the family table's at this stitch length
        const f2 = o2.fabric;
        weightPath.scale = { gsm: s.so.gsm / f2.gsm, width: s.so.width_in / f2.width_open_in };
      }
    } else if (s && s.ok) {
      const diff = (familySl / s.sl - 1) * 100;
      weightPath = { path: 'family table kept; the two engines DISAGREE', why: `the laws want ${r2(s.sl)} mm and the family table ${r2(familySl)} mm (${r1(diff)} % apart)${tfOk ? '' : '; ' + s.reason}: the family table is kept and the band is the gap between them`, laws: { sl_mm: r2(s.sl), family_table_sl_mm: r2(familySl), difference_pct: r1(diff), laws_used: s.so.laws }, band_pct: Math.max(Math.round(LAWS_BAND * 100), Math.round(Math.abs(diff))) };
    } else if (s && s.reason) weightPath.why = 'family table kept: ' + s.reason;
    if (weightPath.band_pct == null) weightPath.band_pct = 25;        // a structure outside the records, and no physics answer to check it: the honest band is wide
  }
  const f = out.fabric, m = out.machine, ms = out.machine_setup || {};
  const states = (f.relaxation && f.relaxation.states) || [];
  const stateOf = (id) => states.find((s) => s.state === id) || null;
  const greige = stateOf('dry'), finished = stateOf('finished'), washed = states.find((s) => /full|home|wash/i.test(s.state)) || states[states.length - 1];
  const band = weightPath.band_pct;
  const kG = weightPath.scale ? weightPath.scale.gsm : 1, kW = weightPath.scale ? weightPath.scale.width : 1;
  const gsmRange = (g) => (band ? [Math.round(g * (1 - band / 100)), Math.round(g * (1 + band / 100))] : null);

  // ── yarn ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const el = out.composition_solve && out.composition_solve.solved ? out.composition_solve.solved.elastane : null;
  const feeds = (out.yarn.feeds || []).map((x) => ({ feed: x.feed, role: x.role, yarn: x.yarn, fibre: x.fibre, tex: x.tex, ne: r1(590.5 / x.tex), type: x.yarn_type, sl_mm: x.sl_mm, course_length_m: x.course_length_m, tension_cN: x.tension_cN }));

  // ── dyeing ───────────────────────────────────────────────────────────────────────────────────────────────────
  const ch = out.chemistry && out.chemistry.ground && out.chemistry.ground.success !== false ? out.chemistry.ground : null;
  const dyeing = ch ? {
    shade,
    route: ch.route.steps.map((s, i) => ({ step: i + 1, name: s.label, temp_c: s.t_c || null, time_min: s.time_min || null, ph: s.ph || null, chemicals: (s.chemicals || []).map((c) => ({ name: c.name || c, g_per_l: c.g_per_l != null ? c.g_per_l : null })) })),
    total_time_h: r1(ch.route.total_time_min / 60),
    liquor_ratio: ch.recipe && ch.recipe.liquor_ratio ? ch.recipe.liquor_ratio.value : null,
    dyes: ch.recipe && ch.recipe.dyes ? ch.recipe.dyes.map((d) => ({ class: d.class_label, owf_pct: d.owf_on_yarn_pct, kg_per_100kg: d.kg ? d.kg.value : null, fixation_pct: d.fixation_pct ? d.fixation_pct.value : null })) : [],
    strength_retained_pct: ch.strength && ch.strength.retained_pct != null ? ch.strength.retained_pct : null,
    basis: 'route and chemistry from the fibre-by-fibre engine; amounts typical for the depth (a lab dip sets the exact dose)',
  } : null;

  // ── finishing: a prescription from the route, the cloth's own shrinkage and its weight ─────────────────────
  const heatset = ch ? ch.route.steps.find((s) => /heat/i.test(s.label || s.id || '')) : null;
  const lycra = !!el || (out.composition_solve && (out.composition_solve.achieved || {}).elastane > 0) || /elastane/i.test(JSON.stringify(out.yarn.composition || []));
  const pol = /polyester|nylon/i.test(JSON.stringify(out.yarn.composition || [])) || (out.feasibility && out.feasibility.fibres && Object.keys(out.feasibility.fibres).some((k) => /polyester|nylon/.test(k)));
  const natW = f.width_open_in, finW = finished ? finished.width_in : natW;
  const lenShr = washed && finished ? r1(Math.abs(washed.length_pct - finished.length_pct)) : null;
  const gsmNow = (finished ? finished.gsm : f.gsm) * kG;
  // the route's effect on size beyond the usual route (process-dimensions.js, an estimate)
  const pd = out.process_dimensions || null;
  const washLen = pd ? pd.after_wash.length_pct : washed && finished ? washed.length_pct - finished.length_pct : null;
  const washWid = pd ? pd.after_wash.width_pct : washed && finished ? washed.width_pct - finished.width_pct : null;
  const limit = +raw.shrinkage_pct > 0 ? +raw.shrinkage_pct : 5;
  // the compaction that brings the residual length shrinkage under the buyer's limit: the cloth is shortened on the compactor by the excess
  const compactPct = washLen != null ? r1(Math.max(0, Math.abs(washLen) - limit + 0.5)) : null;
  const overfeed = washLen != null ? r1(Math.max(0, Math.min(15, Math.abs(washLen) - limit + 2.5))) : null;
  const fibresOut = out.feasibility && out.feasibility.fibres ? out.feasibility.fibres : {};
  const cellulosic = Object.keys(fibresOut).some((k) => /cotton|viscose|modal|linen|tencel/.test(k));
  const pickup = pol && !cellulosic ? 55 : pol ? 68 : 80;                                   // wet pick-up after the squeeze, % of the dry cloth weight (typical)
  const regain = cellulosic ? 8.5 : 2;
  const dryLoad = Math.round(gsmNow * Math.max(0, pickup - regain) / 100);               // grams of water to evaporate per m² (physics: pick-up less the regain the cloth keeps)
  const dryTemp = lycra || pol ? 170 : 140;
  const speed = gsmNow > 260 ? 15 : gsmNow > 180 ? 20 : 25;
  const finishing = {
    heat_set: heatset ? { temp_c: heatset.t_c, time_s: lycra ? 45 : 30, when: heatset.t_c && /before|pre/i.test(heatset.label || '') ? 'before dyeing' : 'after dyeing', basis: 'typical for the fibres; the route sets the temperature' } : null,
    stenter: {
      set_width_in: r1(finW * kW), temp_c: dryTemp, speed_m_min: speed, overfeed_pct: overfeed, pickup_pct: pickup, water_to_evaporate_g_m2: dryLoad,
      basis: 'width from the finished state; the water to evaporate is pick-up less regain (physics); temperature and speed are typical settings for this weight and fibres, overfeed is what brings the residual shrinkage under the limit (modelled): a first roll confirms them',
    },
    compaction: { target_cpc: f.cpc, shorten_pct: compactPct, limit_pct: limit, note: (out.checks.find((c) => /compact/i.test(c.text)) || {}).text || null },
    brushing: out.finish && brush !== 'none' ? { side: brush === 'face' ? 'face (peach)' : brush, passes: out.finish.passes, nap_mm: out.finish.nap_mm, weight_loss_pct: out.finish.fabric_loss_pct, basis: out.finish.basis } : null,
    shrinkage_after_wash_pct: washLen != null ? { length: r1(washLen), width: r1(washWid), usual_route: pd ? { length: pd.after_wash.base.length_pct, width: pd.after_wash.base.width_pct } : null, route_changes: pd ? pd.changes : [], basis: pd ? pd.basis : 'modelled' } : null,
  };
  // the order the cloth goes through the finishing house, each step with its numbers
  finishing.sequence = [
    ...(heatset && /before|pre/i.test(heatset.label || '') ? [{ step: 'Heat-set', params: `${finishing.heat_set.temp_c} °C, ${finishing.heat_set.time_s} s, pinned to ${r1(finW * kW)}"`, basis: 'typical' }] : []),
    { step: 'Wet processing', params: 'scour, dye, soap, soften as in the dyeing route', basis: 'engine' },
    { step: 'Squeeze / hydro-extract', params: `to about ${pickup} % pick-up`, basis: 'typical' },
    { step: 'Dry on the stenter', params: `${dryTemp} °C, ${speed} m/min, width ${r1(finW * kW)}", overfeed ${overfeed != null ? overfeed : '—'} %, ${dryLoad} g/m² of water to evaporate`, basis: 'physics (load), typical (settings)' },
    ...(heatset && !/before|pre/i.test(heatset.label || '') ? [{ step: 'Heat-set', params: `${finishing.heat_set.temp_c} °C, ${finishing.heat_set.time_s} s`, basis: 'typical' }] : []),
    { step: 'Compact', params: compactPct != null ? `shorten the cloth by ${compactPct} % so the wash shrinkage is under ${limit} % (finished ${f.cpc} courses/cm)` : 'to the finished density', basis: 'modelled' },
    ...(finishing.brushing ? [{ step: brush === 'face' ? 'Peach the face' : 'Brush', params: `${finishing.brushing.passes} passes, nap about ${finishing.brushing.nap_mm} mm, weight loss ${finishing.brushing.weight_loss_pct} %`, basis: 'modelled' }] : []),
    { step: 'Check', params: `weight ${Math.round(gsmNow)} g/m², width ${r1(finW * kW)}", length shrinkage after wash ${washLen != null ? r1(washLen) : '—'} %, width ${washWid != null ? r1(washWid) : '—'} %`, basis: 'targets' },
  ];

  // ── VDQ: the course length is physics; the pulley scale is the machine's own ─────────────────────────────
  const vdq = out.vdq ? { groups: out.vdq.groups.map((g) => ({ feeds: g.feeds, course_length_m: g.course_length_m, yarn_speed_m_min: g.yarn_speed_m_min, pulley_reading: g.vdq_reading != null ? g.vdq_reading : null })), pulley_method: out.vdq.method || null, note: out.vdq.method ? 'The pulley readings are worked out from your own reference setting' + ((design.machine.vdq && design.machine.vdq.points.length > 1) ? 's' : '') + ': ' + out.vdq.method + '.' : 'The quality-pulley scale is not the same on any two makes. Give one or two settings you already run (reading and the course length it makes) and the sheet turns every feeder\'s course length into a pulley reading.' } : null;

  const warns = (out.checks || []).filter((c) => c.level === 'error' || c.level === 'warn').map((c) => ({ level: c.level, text: c.text }));
  const verdict = out.feasibility ? out.feasibility.verdict : null;
  const sheet = {
    success: true,
    inputs: { composition: raw.composition, gsm: +raw.gsm, shade, brush, dia: m.dia, width_in: +raw.width_in || null, shrinkage_pct: +raw.shrinkage_pct || null },
    design: { bed: out.structure.bed, gating: out.structure.gating, feeds: out.structure.feeds, repeat: `${out.structure.feeds} feeds × ${out.structure.needles_per_repeat} needles`, roles: out.structure.roles_drawn, counts: out.structure.identity.counts, longest_float: out.structure.identity.longest_float, family: out.structure.family_label, transfers: (out.structure.identity.counts || {}).E + (out.structure.identity.counts || {}).R > 0, notes: (out.checks || []).filter((c) => c.level === 'note').slice(0, 6).map((c) => c.text) },
    fabric: { title: out.structure.identity.title, detail: out.structure.identity.detail, family: out.structure.family_label, matches: out.structure.match ? out.structure.match.name : null, confidence: conf.level, confidence_why: conf.why },
    weight_basis: weightPath,
    yarn: { feeds, composition: out.yarn.composition, composition_solved: out.composition_solve ? { target: out.composition_solve.target, achieved: out.composition_solve.achieved, held: out.composition_solve.held } : null, elastane: el ? { denier: el.denier, draft: el.draft, feeding: feedingWord(el.every), every: el.every } : null },
    machine: {
      type: ms.profile ? ms.profile.label : m.machine_label, gauge: m.gauge, dia: m.dia, needles: m.needles, feeders: m.feeders, rpm: m.rpm, efficiency_pct: m.efficiency_pct, kg_per_hour: m.kg_per_hour,
      stitch_length_mm: f.sl_mm, stitch_length_range_mm: f.sl_range_mm || null, tracks: out.setup ? out.setup.tracks : null, cam_chart: out.setup ? out.setup.cam_chart : null, vdq,
      sinker: ms.profile && ms.profile.sinker ? ms.profile.sinker.text : null,
    },
    greige: greige ? { gsm: Math.round(greige.gsm * kG), gsm_range: gsmRange(greige.gsm * kG), width_in: r1(greige.width_in * kW), wales_per_cm: greige.wpc, courses_per_cm: greige.cpc, note: 'off the machine, relaxed flat' } : { gsm: Math.round(f.gsm * kG), gsm_range: gsmRange(f.gsm * kG), width_in: r1(f.width_open_in * kW), wales_per_cm: f.wpc, courses_per_cm: f.cpc, note: 'this structure has no separate relaxed state in the Studio: its own weight and width are shown' },
    dyeing,
    finishing,
    finished: { gsm: Math.round((finished ? finished.gsm : f.gsm) * kG), gsm_range: gsmRange((finished ? finished.gsm : f.gsm) * kG), width_in: r1((finished ? finished.width_in : f.width_open_in) * kW), wales_per_cm: f.wpc, courses_per_cm: f.cpc, spirality_helix_deg: out.spirality ? out.spirality.helix_deg : null, thickness_mm: out.hand && out.hand.compression ? out.hand.compression.T0.value : null },
    verdict, export_locked: out.feasibility ? !!out.feasibility.export_locked : false, warnings: warns,
    accuracy: {
      weight: band ? `about ±${band} % until a trial roll is measured (${weightPath.path})` : `about ±${f.accuracy && f.accuracy.gsm ? r1(f.accuracy.gsm.typical_error_pct || 5) : 5} % (cross-validated on factory records)`,
      rule: 'No sheet is exact. Knit one roll, enter its stitch length, GSM and width (Trial rolls step): the Studio re-calibrates this structure to your machine and the band narrows.',
      measured_vs_modelled: 'Weight and width: measured on factory records, or physics-first. Shrinkage, dyeing amounts, finishing temperature / speed / overfeed, hand: modelled (typical). A roll confirms them.',
    },
    first_roll: ['Knit the sheet\'s stitch length; take 3 m of cloth off the machine.', 'Condition flat 24 h; weigh a 100 cm² cut and measure the width: this is the greige weight.', 'Enter the stitch length, GSM and width as a trial roll. Repeat after finishing for the finished state.'],
    design_used: designUsed,
  };
  Object.defineProperty(sheet, '_out', { value: out, enumerable: false });
  return sheet;
}

module.exports = { build, SheetError, SHADES, BRUSH, LAWS_BAND };
