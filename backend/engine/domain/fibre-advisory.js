/**
 * ============================================================================
 * FIBRE ADVISORY — the reference layer, reasoning.
 * ============================================================================
 *
 * Everything extracted from Morton & Hearle so far reached the user through
 * exactly one door: the wet-processing report. A merchandiser calculating a
 * fabric never saw any of it. This module is the other door, and it is not a
 * dump of the stored numbers — it is the reasoning across them.
 *
 * WHAT MAKES A FINDING WORTH PRINTING
 * -----------------------------------
 * Four things, and a finding missing any of them is not emitted:
 *
 *   claim       what will happen to THIS fabric, not what is true of the fibre
 *   mechanism   why, in terms of the measurement — a claim without a mechanism
 *               is memorisation, and memorisation is what this must never do
 *   action      what to change; a finding nobody can act on is a fact, not advice
 *   evidence    the table and printed page it comes from
 *
 * CONDITIONAL, NOT RECITED
 * ------------------------
 * The same blend gets different findings in a single jersey and in an
 * interlock, at 120 g/m² and at 240, with elastane and without. A rule that
 * fires regardless of context is reciting; the guards below are the point of
 * the module, not overhead around it.
 *
 * SILENCE IS A RESULT
 * -------------------
 * Where the book has no measurement, this says so by name and stops. The
 * `silent_on` list is part of the output for exactly that reason: a reader must
 * be able to tell "no risk found" from "never looked". Modal, Tencel and bamboo
 * carry almost nothing here, and that is reported rather than filled in from
 * viscose because they are near it.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It will not average across fibres that have no measurement and present the
 * result as the blend's. It will not turn a fibre property into a fabric
 * property without saying which step made the leap. And where a fibre governs
 * an outcome but predates the measurement — elastane in a 1950 recovery table —
 * it withholds the verdict instead of computing one from what is left.
 */

const {
  FIBER_PROPERTIES, blendMechanics, blendFriction, blendRecovery,
  fibreVariability, weakLinkSensitivity, moistureEconomics, yieldTension,
  blendDirectional, blendCyclic, blendThermal, heatCeiling, staticRisk,
  dryingLoad, flexFatigue, fibreAnisotropy, curveShape, molecularOrientation,
  jointStrength, stretchResistance, humidityLeverage, wetJamming, wetToughness, mercerisingGain,
} = require('./yarn-engine');

const SOURCE = 'Morton & Hearle, Physical Properties of Textile Fibres, 4th edn (2008), '
  + 'as extracted into the fibre reference layer. Every finding cites its table and '
  + 'printed page.';

const round1 = v => (v == null ? null : Math.round(v * 10) / 10);
const round2 = v => (v == null ? null : Math.round(v * 100) / 100);

// Fabric families, by how much they let a stitch move. A single jersey has one
// yarn path per loop and nothing opposing it; an interlock has two interlocking
// beds that lock each other; a rib sits between. The same fibre bags visibly in
// the first and hardly at all in the third, so recovery findings are scaled by
// this rather than issued flat.
const STRUCTURE_FREEDOM = {
  single_jersey: 1.00, jersey: 1.00, lacoste: 0.92, pique: 0.90,
  terry: 0.95, fleece: 0.95, single_lacoste: 0.92, double_lacoste: 0.88,
  rib: 0.75, interlock: 0.60, double_knit: 0.62, ottoman: 0.70,
  woven: 0.35, warp_knit: 0.55,
};

function structureFreedom(ctx) {
  const id = String(ctx.fabricId || '').toLowerCase();
  const cat = String(ctx.category || '').toLowerCase();
  for (const key of Object.keys(STRUCTURE_FREEDOM)) {
    if (id.includes(key)) return { value: STRUCTURE_FREEDOM[key], matched: key };
  }
  if (STRUCTURE_FREEDOM[cat] != null) return { value: STRUCTURE_FREEDOM[cat], matched: cat };
  return { value: 0.85, matched: null };
}

const article = name => {
  const w = name.replace(/_/g, ' ');
  return (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
};

/**
 * Every finding declares what it is ABOUT, and the two are held to different
 * standards.
 *
 *   scope 'fabric'  a claim about the cloth in front of the user. Computed over
 *                   part of a blend, it must say so in the claim itself, because
 *                   "this fabric grows 48%" is false when half the blend was
 *                   never measured.
 *   scope 'fibre'   a claim about one named fibre, or an option to consider.
 *                   "Cotton's strength is set by its weak points" is true of
 *                   cotton whatever else is in the yarn, and appending a
 *                   coverage caveat to it would be noise pretending to be rigour.
 *
 * The distinction is real and worth keeping: over-qualifying is its own way of
 * being unhelpful, and a report where every sentence hedges is one nobody reads.
 */
/**
 * Where each finding belongs on the page.
 *
 * This module used to emit eight findings and a flat list sorted by severity
 * was the right shape for it. It now emits up to twenty-five, and at that
 * length a flat list stops being a report and becomes a wall: a reader who
 * wants to know whether the fabric will dye evenly has to read the mechanics
 * to find out.
 *
 * The grouping is by the QUESTION being answered, not by the chapter the
 * measurement came from — a merchandiser thinks in "will it hold its shape",
 * not in "chapter 17". Severity still orders within a group, so the worst
 * thing in each area is the first thing read there.
 *
 * A topic missing from this map is not an error; it falls to the end under
 * "Other", and the test below names any that land there so a new finding
 * cannot quietly go homeless.
 */
const THEMES = [
  ['Strength and how it fails', [
    'blend strength', 'knit strength', 'energy at break', 'transverse weakness',
    'fibre damage sensitivity', 'joins and knots', 'flex fatigue', 'pilling',
  ]],
  ['Shape, stretch and handle', [
    'shape retention', 'wear growth', 'stretch resistance', 'handle',
    'spirality', 'twist liveliness',
  ]],
  ['Water, dye and colour', [
    'wet processing', 'wet strength', 'wet toughness', 'wet jamming', 'dye uptake',
    'lustre', 'felting',
  ]],
  ['Heat and moisture', [
    'heat setting', 'heat ageing', 'temperature ceiling', 'thermal comfort',
    'warmth when damp', 'drying load',
  ]],
  ['On the floor', [
    'knitting tension', 'yarn tension', 'static', 'humidification',
    'yarn evenness', 'yarn costing', 'GSM measurement',
  ]],
];

const THEME_OF = (() => {
  const m = {};
  THEMES.forEach(([name, topics], i) => topics.forEach(t => { m[t] = { name, i }; }));
  return m;
})();

function finding(o) {
  if (!o.claim || !o.mechanism || !o.action || !o.evidence) return null;
  const t = THEME_OF[o.topic] || { name: 'Other', i: THEMES.length };
  return { scope: 'fabric', ...o, theme: t.name, theme_order: t.i };
}

/**
 * A claim computed over part of a blend must say so IN THE CLAIM.
 *
 * Putting the coverage in a `confidence` field further down is not enough: the
 * claim is the sentence that gets read, quoted and acted on, and a number
 * derived from half a blend and stated flatly is exactly the confident
 * half-knowledge this module exists to avoid. A 50/50 cotton-modal is not "48%
 * growth"; it is "48% growth for the cotton half, and the modal half is
 * unknown", and those are different pieces of advice.
 */
function qualify(claim, pct, missing) {
  if (pct == null || pct >= 90 || !missing || !missing.length) return claim;
  return claim.replace(/\.$/, '')
    + ` — but this is measured over only ${round1(pct)}% of the blend; `
    + `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not covered, `
    + `so treat it as describing the measured part and not the fabric.`;
}

/**
 * Pilling, derived rather than declared.
 *
 * A pill forms in two stages and only the second one distinguishes the fibres.
 * First, fibre ends work to the surface and entangle — every staple yarn does
 * this. Then the pill either wears off, or it does not, and what decides that
 * is whether the fibres anchoring it break. The work of rupture is precisely
 * the energy needed to break a fibre, so it is the quantity that governs it:
 *
 *   cotton      10.7 mN/tex     the anchors snap, the pill leaves
 *   wool        30.9
 *   polyester   53              the anchors hold, the pill stays
 *   nylon       76
 *
 * That is the whole of why polyester and poly-cotton pill and pure cotton does
 * not, and it comes out of Table 13.1 and 13.2 without a single fitted
 * constant. The engine's own `pilling_tendency` is a per-spinning-system guess
 * with no source; this sits beside it and says where its number comes from.
 *
 * The blend case is the interesting one and the arithmetic is NOT a mean. A
 * poly-cotton pills because the polyester holds the pill on — the cotton in it
 * does nothing to help. So the governing figure is the TOUGHEST fibre present
 * in meaningful quantity, weighted by how much of it there is.
 */
function pillingIndex(fibers) {
  const parts = [];
  const unmeasured = [];
  for (const [name, pct] of Object.entries(fibers || {})) {
    if (!pct) continue;
    const t = (FIBER_PROPERTIES[name] || {}).tensile;
    if (!t || t.work_of_rupture == null) { unmeasured.push(name); continue; }
    parts.push({ name, pct, wor: t.work_of_rupture, page: t.page, table: t.table });
  }
  if (!parts.length) return null;

  // The fibre that anchors the pill is the toughest one there is enough of.
  // Below about a tenth of the blend a fibre cannot form a continuous anchoring
  // network, so it is noted but not allowed to govern.
  const structural = parts.filter(p => p.pct >= 10);
  const pool = structural.length ? structural : parts;
  const anchor = pool.reduce((a, b) => (b.wor > a.wor ? b : a));
  const trace = parts.filter(p => p.pct < 10 && p.wor > anchor.wor);

  return {
    anchor_fibre: anchor.name,
    anchor_work_of_rupture: anchor.wor,
    anchor_pct: anchor.pct,
    // Cotton is the reference because it is the fibre everyone has handled and
    // knows does not pill.
    index_vs_cotton: round2(anchor.wor / FIBER_PROPERTIES.cotton.tensile.work_of_rupture),
    band: anchor.wor >= 60 ? 'severe' : anchor.wor >= 35 ? 'high'
        : anchor.wor >= 18 ? 'moderate' : 'low',
    ignored_below_10pct: trace.map(p => `${p.name} ${p.pct}%`),
    unmeasured,
    evidence: { table: anchor.table, page: anchor.page },
  };
}

/**
 * Handle — how stiff the cloth will feel — from the initial modulus.
 *
 * The initial modulus is the slope of the stress-strain curve at the origin,
 * which is the resistance a fibre offers to the FIRST small deformation. That
 * is what a hand feels when it crushes a fabric, and it separates fibres that a
 * strength figure does not:
 *
 *   nylon        2.6 N/tex     soft, drapes
 *   wool         2.3
 *   cotton       5.0
 *   polyester   10.6 N/tex     crisp, springy
 *
 * This is a FIBRE property and a fabric's handle is not only its fibre — GSM,
 * tightness and finish all move it. So the output is named an indication, and
 * the finding says which step is the leap.
 */
function handleIndex(fibers) {
  const parts = [];
  const unmeasured = [];
  for (const [name, pct] of Object.entries(fibers || {})) {
    if (!pct) continue;
    const t = (FIBER_PROPERTIES[name] || {}).tensile;
    if (!t || t.modulus == null) { unmeasured.push(name); continue; }
    parts.push({ name, pct, mod: t.modulus, page: t.page, table: t.table });
  }
  if (!parts.length) return null;
  const w = parts.reduce((a, p) => a + p.pct, 0);
  const mod = parts.reduce((a, p) => a + p.mod * p.pct, 0) / w;
  return {
    modulus_n_tex: round2(mod),
    from_pct: round1(w),
    band: mod >= 9 ? 'crisp' : mod >= 5.5 ? 'firm' : mod >= 3 ? 'soft' : 'very soft',
    unmeasured,
    evidence: { table: parts[0].table, page: parts[0].page },
  };
}

/**
 * The whole advisory.
 *
 * @param {object} fibers  {cotton: 95, elastane: 5}
 * @param {object} ctx     { fabricId, category, gsm, has_elastane, elastane_pct,
 *                           spinning, mercerised, end_use }
 */
function fibreAdvisory(fibers, ctx = {}) {
  if (!fibers || !Object.keys(fibers).length) {
    return { ok: false, reason: 'no composition was given, so nothing can be said' };
  }

  const named = Object.entries(fibers).filter(([, p]) => p > 0);

  // Coverage is per PROPERTY, not per fibre, and the difference is the whole
  // point. Modal has a density and a regain, so a fibre-level check calls it
  // "measured" — and then every finding below silently declines to fire and the
  // reader is handed a clean report about a fabric nothing was known about.
  // "No risk found" and "never looked" must not print the same.
  const NEEDED = ['tensile', 'recovery', 'friction', 'swelling', 'variability'];
  const depth = named.map(([n, pct]) => {
    const row = FIBER_PROPERTIES[n] || {};
    const has = NEEDED.filter(f => row[f]);
    return { name: n, pct, has, none: has.length === 0, scalarsOnly: !!row.density && !has.length };
  });
  const measured = depth.filter(d => !d.none).map(d => [d.name, d.pct]);
  const silentOn = depth.filter(d => d.none).map(d => d.name);
  const coveredPct = measured.reduce((a, [, p]) => a + p, 0);

  // A fabric where nothing of substance is known must say so first and loudest,
  // rather than returning an empty findings list that reads like a clean bill.
  if (!measured.length) {
    return {
      ok: true,
      coverage: { measured_pct: 0, measured: [], silent_on: silentOn,
                  structure_matched: structureFreedom(ctx).matched,
                  structure_freedom: structureFreedom(ctx).value },
      indices: {}, findings: [],
      not_known: [`${silentOn.join(', ')} — the reference layer has no tensile, recovery, `
        + `friction, swelling or variability measurement for `
        + `${silentOn.length > 1 ? 'any of these' : 'this fibre'}. `
        + `Nothing below was suppressed; nothing was ever available.`],
      headline: `No measured fibre properties for ${silentOn.join(', ')} — this fabric cannot `
        + `be advised on from the book, and no verdict is implied by the silence.`,
      source: SOURCE,
    };
  }

  const mech = blendMechanics(fibers);
  const fric = blendFriction(fibers);
  const rec = blendRecovery(fibers, 60);
  const vary = fibreVariability(fibers);
  // weakLinkSensitivity takes a single fibre key, not a blend. Passing the map
  // returned null for every fabric, so this index was dead from the day it was
  // added — present in the output, always empty, and nothing said so.
  const weakEach = Object.entries(fibers)
    .filter(([, pct]) => pct > 0)
    .map(([name, pct]) => ({ name, pct, w: weakLinkSensitivity(name) }))
    .filter(x => x.w);
  // The blend behaves like its MOST weak-link-sensitive component: a chain
  // breaks at its weakest link whatever the other links are made of.
  const weak = weakEach.length
    ? { ...weakEach.reduce((a, b) => (b.w.gain_to_0_1mm_pct > a.w.gain_to_0_1mm_pct ? b : a)).w,
        governed_by: weakEach.reduce((a, b) =>
          (b.w.gain_to_0_1mm_pct > a.w.gain_to_0_1mm_pct ? b : a)).name,
        unmeasured: Object.keys(fibers).filter(n =>
          fibers[n] > 0 && !weakEach.some(x => x.name === n)) }
    : null;
  const moist = moistureEconomics(fibers);
  const dir = blendDirectional(fibers);
  const cyc = blendCyclic(fibers);
  const therm = blendThermal(fibers);
  const heat = heatCeiling(fibers);
  // ctx.floor_rh is the humidity the knitting or finishing floor actually
  // runs at. Without it there is a threshold but no verdict.
  const stat = staticRisk(fibers, ctx.floor_rh);
  const dry = dryingLoad(fibers);
  const flex = flexFatigue(fibers);
  const aniso = fibreAnisotropy(fibers);
  const shape = curveShape(fibers);
  const orient = molecularOrientation(fibers);
  const joint = jointStrength(fibers);
  const stretch = stretchResistance(fibers);
  const humid = humidityLeverage(fibers);
  const jam = wetJamming(fibers, ctx);
  const tough = wetToughness(fibers);
  const merc = mercerisingGain(fibers);
  const yld = ctx.count_ne ? yieldTension(fibers, ctx.count_ne) : null;
  const pill = pillingIndex(fibers);
  const hand = handleIndex(fibers);
  const struct = structureFreedom(ctx);
  // A loom is not a knitting machine and a woven fabric has no cam. The same
  // physics reaches the reader in the words of the process actually in front of
  // them, decided once here rather than assumed in each finding.
  const isWoven = String(ctx.category || '').toLowerCase() === 'woven'
    || /woven/.test(String(ctx.fabricId || '').toLowerCase());
  const mc = isWoven
    ? { topic: 'yarn tension', place: 'at the reed and healds',
        symptom: 'width and length drifting off the loom state',
        fix: 'measure the running warp tension before re-setting the let-off' }
    : { topic: 'knitting tension', place: 'at the needle',
        symptom: '"loop length right on the machine, wrong on the table"',
        fix: 'measure the running tension before re-cutting the cam' };

  const findings = [];
  // The wet-processing card reports the same fibre mechanics from the process
  // side, so when it is on the page these topics would appear twice, worded
  // differently — which reads as a bug and makes a reader wonder which number
  // to believe. They are handed over rather than repeated, and the handover is
  // recorded so nothing disappears without trace. When there is no wet card —
  // a woven quality, or a calculation with no dyeing route — the advisory
  // carries them itself.
  const DEFER_TO_WET_CARD = ['wet processing', 'wet strength', 'wet toughness',
                             'felting'];
  const deferred = [];
  const push = f => {
    const v = finding(f);
    if (!v) return;
    if (ctx.wet_card_present && DEFER_TO_WET_CARD.includes(v.topic)) {
      deferred.push(v.topic);
      return;
    }
    findings.push(v);
  };

  // ── 1. Will it go out of shape? ────────────────────────────────────────
  // Recovery is a fibre property; bagging is a garment outcome. The step
  // between them is the structure, so it is applied and named.
  if (rec && rec.from_5pct) {
    const growth = 100 - rec.from_5pct.recovery;
    const effective = growth * struct.value;
    // Calibrated against the fabric everybody has handled. A cotton single
    // jersey leaves about 48% of a 5% stretch behind, and it is the most-made
    // fabric on earth — calling that "severe" every time would be crying wolf
    // and would bury the viscose at 68% that genuinely is. So cotton jersey
    // lands on 'high' and the band above it is reserved for worse.
    const band = rec.withheld_because ? null
      : effective >= 60 ? 'severe' : effective >= 42 ? 'high'
      : effective >= 25 ? 'moderate' : 'low';
    if (rec.withheld_because) {
      push({
        topic: 'shape retention', severity: 'info',
        claim: 'No bagging verdict is given for this fabric.',
        mechanism: `The measured recovery of the rest of the blend is ${rec.from_5pct.recovery}% `
          + `from a 5% stretch, but ${rec.withheld_because}. Computing a verdict from the `
          + 'other fibres would not be merely incomplete — it would be backwards, because an '
          + 'elastomer at a few per cent is what makes a stretch fabric recover at all.',
        action: 'Judge recovery from the elastane specification and a stretch-and-recovery '
          + 'test (ASTM D2594 or the buyer\'s protocol), not from the base fibre.',
        evidence: [{ table: 'Table 15.2', page: 344 }],
        confidence: 'withheld',
      });
    } else {
      push({
        topic: 'shape retention', severity: band === 'severe' ? 'severe'
          : band === 'high' ? 'high' : band === 'moderate' ? 'moderate' : 'info',
        claim: qualify(`About ${round1(effective)}% of a 5% stretch will not come back`
          + `${struct.matched ? ` in ${article(struct.matched)}` : ''}.`,
          rec.from_5pct.from_pct, rec.unmeasured),
        mechanism: `The fibres in this blend recover ${rec.from_5pct.recovery}% from a 5% `
          + `extension, so ${round1(growth)}% of it stays. Recovery falls off steeply with `
          + `how far the fibre is pulled — this blend returns `
          + `${rec.from_1pct ? rec.from_1pct.recovery : '?'}% from a 1% stretch and `
          + `${rec.from_5pct.recovery}% from a 5% one — which is why a garment fits on the `
          + `shelf and not after a week's wear. The structure carries `
          + `${Math.round(struct.value * 100)}% of the fibre's behaviour through to the fabric.`,
        action: band === 'severe' || band === 'high'
          ? 'Expect visible bagging at elbows, knees and seat. Tighten the structure, raise the '
            + 'tightness factor, or put elastane in if the buyer will accept it.'
          : 'Shape retention is acceptable for this construction; hold the tightness factor.',
        evidence: [{ table: 'Table 15.2', page: 344 }],
        confidence: rec.from_5pct.from_pct >= 95 ? 'measured'
          : `measured over ${rec.from_5pct.from_pct}% of the blend`,
      });
    }
  }

  // ── 2. Will it pill? ───────────────────────────────────────────────────
  if (pill && pill.band !== 'low') {
    push({
      topic: 'pilling', severity: pill.band === 'severe' ? 'high' : pill.band === 'high' ? 'moderate' : 'info',
      claim: qualify(`Pills that form will tend to STAY on the surface — roughly `
        + `${pill.index_vs_cotton}× as persistent as on an all-cotton fabric.`,
        // An unmeasured fibre could be tougher than the anchor found here, in
        // which case the real figure is HIGHER, not lower. Either way the claim
        // must not be stated flatly.
        100 - pill.unmeasured.reduce((a, n) => a + (fibers[n] || 0), 0), pill.unmeasured),
      mechanism: `Every staple yarn works fibre ends to the surface; what decides whether the `
        + `pill wears off is whether the fibres anchoring it break. The energy needed to break `
        + `a fibre is its work of rupture, and here the anchor is ${pill.anchor_fibre} at `
        + `${pill.anchor_work_of_rupture} mN/tex against cotton's `
        + `${FIBER_PROPERTIES.cotton.tensile.work_of_rupture}. The strongest fibre governs, not `
        + `the average: the cotton in a poly-cotton does nothing to release a pill the polyester `
        + `is holding on.`,
      action: pill.band === 'severe'
        ? 'Specify a low-hairiness yarn (compact or air-jet), singe or biopolish, and set a '
          + 'pilling standard (ISO 12945-2) in the tech pack rather than discovering it at '
          + 'inspection.'
        : 'Keep yarn hairiness down and confirm against ISO 12945-2 before bulk.',
      evidence: [{ table: pill.evidence.table, page: pill.evidence.page }],
      confidence: pill.unmeasured.length ? `${pill.unmeasured.join(', ')} not measured` : 'measured',
    });
  }

  // ── 3. Which fibre fails first? ────────────────────────────────────────
  // Only worth saying when the blend actually has a mismatch; a single fibre
  // blend has no weak partner and the finding would be noise.
  if (mech && mech.breaks_first && mech.blend_average_reliable === false) {
    const first = FIBER_PROPERTIES[mech.breaks_first].tensile;
    push({
      topic: 'blend strength', severity: 'moderate',
      claim: `The ${mech.breaks_first} breaks first, at ${first.extension}% extension, and the `
        + `blend cannot be as strong as its mass average suggests.`,
      mechanism: `The fibres in this blend reach their breaking extensions at very different `
        + `points. When the ${mech.breaks_first} has broken, the load it was carrying transfers `
        + `to what is left, so the blend fails before the stronger fibre has been fully loaded. `
        + `The mass-weighted figure of ${mech.tenacity_upper_bound_n_tex} N/tex is therefore an `
        + `UPPER BOUND and not a prediction.`,
      action: 'Do not quote blend strength from a weighted average. Test the actual yarn, and '
        + 'where strength is critical move the blend ratio towards the lower-extension fibre '
        + 'or match the two extensions more closely.',
      evidence: [{ table: 'Tables 13.1 and 13.2', page: first.page }],
      confidence: 'measured',
    });
  }

  // ── 4. Wet processing, only when it is actually going to be wet ────────
  if (mech && mech.wet && ctx.wet_processed !== false) {
    if (mech.wet.modulus != null && mech.wet.modulus <= 0.35) {
      push({
        topic: 'wet processing', severity: mech.wet.modulus <= 0.10 ? 'severe' : 'high',
        claim: qualify(`In water this fabric keeps only `
          + `${Math.round(mech.wet.modulus * 100)}% of its stiffness.`,
          mech.measured_pct, [...(mech.unmeasured || []), ...(mech.no_wet_data || [])]),
        mechanism: `Initial modulus is what resists the first small deformation. Wet, this blend `
          + `retains ${Math.round(mech.wet.modulus * 100)}% of it, so the fabric goes limp and `
          + `whatever tension the machine puts on it pulls the loops out of shape — which is why `
          + `a viscose knit comes out of the dyehouse longer and narrower than it went in.`,
        action: 'Run open-width rather than rope, keep batch weight and winch tension down, and '
          + 'set the width on the stenter from a wet-relaxed sample, not a dry one.',
        evidence: [{ table: 'Table 13.7', page: 312 }],
        confidence: mech.no_wet_data && mech.no_wet_data.length
          ? `no wet data for ${mech.no_wet_data.join(', ')}` : 'measured',
      });
    }
    if (mech.wet.tenacity != null && mech.wet.tenacity >= 1.02) {
      push({
        topic: 'wet strength', severity: 'info',
        claim: qualify(`This fabric is ${Math.round((mech.wet.tenacity - 1) * 100)}% STRONGER `
          + `wet than dry.`,
          mech.measured_pct, [...(mech.unmeasured || []), ...(mech.no_wet_data || [])]),
        mechanism: 'Cellulose fibres gain strength when wet because water lets the molecular '
          + 'chains share load more evenly. It is the reason cotton survives rope dyeing and '
          + 'high-agitation washing that would destroy a viscose of the same construction.',
        action: 'No special handling needed for wet strength; the dimensional risk is a separate '
          + 'question and is judged on modulus and swelling.',
        evidence: [{ table: 'Table 13.7', page: 312 }],
        confidence: 'measured',
      });
    }
  }

  // ── 5. Felting — the one change that cannot be undone ──────────────────
  if (fric && fric.felting) {
    const f = fric.felting;
    push({
      topic: 'felting', severity: f.pct_of_blend >= 50 ? 'severe' : f.pct_of_blend >= 20 ? 'high' : 'moderate',
      claim: `${f.pct_of_blend}% ${f.fibre} makes this fabric liable to felt in any wet, `
        + `agitated process.`,
      mechanism: `Wool's friction depends on which way the fibre moves: `
        + `${f.with_scales_static} to start a slide with the scales and `
        + `${f.against_scales_static} against them, a factor of ${f.directional_ratio}. `
        + `Agitation therefore lets each fibre travel root-first and not tip-first, so the mass `
        + `ratchets inwards and locks. No other fibre in the book has a directional friction, `
        + `which is why no other fibre felts — and unlike shrinkage it does not relax back.`,
      action: 'Keep the bath cool and mechanical action low, avoid rope handling, and specify a '
        + 'shrink-resist (chlorine-Hercosett or equivalent) if the garment must be machine '
        + 'washed.',
      evidence: [{ table: 'Tables 25.3 and 25.6', page: 719 }],
      confidence: 'measured',
    });
  }

  // ── 6. Running the yarn: stick-slip and guides ─────────────────────────
  if (!ctx.wet_card_present && fric && fric.stick_slip_ratio != null && fric.stick_slip_ratio >= 1.3) {
    push({
      topic: mc.topic, severity: 'moderate',
      claim: `This yarn will run in grabs and releases rather than smoothly `
        + `(static friction is ${fric.stick_slip_ratio}× kinetic).`,
      mechanism: `Starting a slide takes more force than continuing one, and the bigger that gap `
        + `the more the yarn sticks, breaks free and overshoots. Tension ${mc.place} varies with `
        + `it, and so does the length of yarn laid in — which shows up as barré or as GSM `
        + `drifting across the roll.`,
      action: `Run over ceramic or a fibre pulley rather than steel or porcelain`
        + `${fric.hard_guide_penalty ? ` — the hard guides cost about ${fric.hard_guide_penalty}× `
          + `the tension here` : ''}. Keep the yarn path short and check stitch-length variation `
        + `before adjusting the machine.`,
      evidence: [{ table: 'Tables 25.3 and 25.6', page: 719 }],
      confidence: fric.stick_slip_from_pct >= 100 ? 'measured'
        : `measured over ${fric.stick_slip_from_pct}% of the blend`,
    });
  }

  // ── 7. How even can this yarn possibly be? ─────────────────────────────
  if (vary && vary.cv_tenacity != null) {
    const severe = vary.cv_tenacity >= 25;
    push({
      topic: 'yarn evenness', severity: severe ? 'moderate' : 'info',
      claim: `The fibre itself varies by ${vary.cv_tenacity}% in strength, which is the floor `
        + `below which no spinning system can take the yarn.`,
      mechanism: 'Uster figures describe what a spinning frame adds to the variation already '
        + 'present in the fibre. This is that starting variation, measured fibre by fibre, and '
        + 'no amount of combing or compacting removes it.',
      action: severe
        ? 'Expect a wider strength distribution than a synthetic blend of the same count; set '
          + 'CSP limits from the fibre, not from a generic table, and hold lot-to-lot mixing tight.'
        : 'Fibre variability is not the limiting factor here; evenness will be set by the '
          + 'spinning system.',
      evidence: [{ table: 'Table 14.6', page: 335 }],
      confidence: vary.unmeasured && vary.unmeasured.length
        ? `${vary.unmeasured.join(', ')} not measured` : 'measured',
    });
  }

  // ── 8. Handle ──────────────────────────────────────────────────────────
  if (hand) {
    push({
      topic: 'handle', severity: 'info',
      claim: qualify(`The fibre contributes a ${hand.band} handle `
        + `(initial modulus ${hand.modulus_n_tex} N/tex).`,
        hand.from_pct, hand.unmeasured),
      mechanism: 'Initial modulus is the resistance to the first small deformation, which is '
        + 'what a hand feels when it crushes cloth. Polyester at 10.6 N/tex feels crisp and '
        + 'springy; nylon at 2.6 and wool at 2.3 drape softly at the same weight.',
      action: 'This is the fibre\'s contribution only — GSM, tightness factor and finishing move '
        + 'handle at least as much. Treat it as the starting point a softener or a tighter '
        + 'structure works against, not as the finished hand.',
      evidence: [{ table: hand.evidence.table, page: hand.evidence.page }],
      confidence: hand.from_pct >= 95 ? 'measured'
        : `measured over ${hand.from_pct}% of the blend`,
    });
  }

  // ── 9. Mercerising, where it applies ───────────────────────────────────
  // Only where it is still an open choice. Repeating it on a fabric already
  // specified as mercerised is recitation, and recitation is the failure mode
  // this module exists to avoid.
  if ((fibers.cotton || 0) >= 50 && ctx.mercerised !== true && merc) {
    push({
      topic: 'lustre', severity: 'info', scope: 'fibre',
      claim: `Mercerising under tension would raise this fabric's lustre by about `
        + `${round1(merc.multiple)} times.`,
      mechanism: `Cotton lustre tracks one thing — how flat the fibre's cross-section is. `
        + `Adderley measured lustre ${merc.lustre_flat} at an axis ratio of ${merc.from_ratio} `
        + `and ${merc.lustre_round} at ${merc.to_ratio}, which is where the `
        + `${round1(merc.multiple)} comes from, and found no correlation at all with fibre `
        + 'length, linear density or diameter — so the premium paid for staple length buys '
        + 'something other than shine. Caustic removes the convolutions and rounds the section: '
        + `the same table has the three mercerised samples at ${merc.mercerised_ratio[0]}–`
        + `${merc.mercerised_ratio[1]} against ${merc.raw_ratio[0]}–${merc.raw_ratio[1]} raw, `
        + 'and the lustre follows the section.',
      action: 'Mercerise under maintained clip or chain tension. Without tension the fibre swells '
        + 'and relaxes back to a flat section, the caustic is spent and no lustre arrives — which '
        + 'is the usual cause of "mercerised but no shine".',
      evidence: [{ table: 'Table 24.5', page: 706 }],
      confidence: 'measured',
    });
  }

  // ── 10. What the moisture costs ────────────────────────────────────────
  // Not a fabric fault — an accounting one, and it is systematic and in one
  // direction, which is exactly why it gets written off as waste.
  if (moist && moist.invoice_over_conditioned_pct != null
      && moist.invoice_over_conditioned_pct >= 0.3) {
    push({
      topic: 'yarn costing', severity: 'moderate',
      claim: qualify(`Yarn invoiced at the ${moist.commercial_allowance_pct}% commercial `
        + `allowance weighs about ${moist.invoice_over_conditioned_pct}% more than the same `
        + `fibre conditioned in your store.`,
        moist.covered_pct, [...moist.unmeasured, ...moist.no_allowance_published]),
      mechanism: `Yarn is traded at a conventional allowance fixed by standard — `
        + `${moist.commercial_allowance_pct}% here — while the fibre at 65% r.h. actually holds `
        + `less. A tonne invoiced at the allowance carries `
        + `${round2(1000 / (1 + moist.commercial_allowance_pct / 100))} kg of dry fibre, and `
        + `conditioned at its real regain that same fibre weighs under a tonne. No process `
        + `caused the difference and nothing was spilled, which is precisely why it ends up `
        + `booked as waste.`,
      action: 'Reconcile yarn receipts at a stated regain rather than as-weighed, and carry '
        + `${moist.invoice_over_conditioned_pct}% as a costing line rather than in the process `
        + 'loss figure — otherwise it hides real waste of the same size.',
      evidence: [{ table: 'Table 7.3', page: 188 }],
      confidence: moist.no_allowance_published.length
        ? `the book publishes no allowance for ${moist.no_allowance_published.join(', ')}`
        : 'measured',
    });
  }

  // GSM disputes between two competent labs usually come down to this.
  if (moist && moist.hysteresis_pct != null && moist.hysteresis_pct >= 0.8 && ctx.gsm) {
    const grams = round2(ctx.gsm * moist.hysteresis_pct / 100);
    push({
      topic: 'GSM measurement', severity: 'info',
      claim: qualify(`A GSM cut taken straight off the stenter can read about ${grams} g/m² `
        + `heavier than the same cloth conditioned up from dry.`,
        moist.covered_pct, moist.unmeasured),
      mechanism: `A fibre coming DOWN to 65% r.h. from wet holds more water than the same fibre `
        + `coming UP to it from dry — ${moist.hysteresis_pct}% more here. Every fabric that has `
        + `been through a dyehouse is on the wet side of that hysteresis, so two labs can both `
        + `condition correctly and still disagree by this much.`,
      action: 'Specify the conditioning branch, not just the atmosphere, when a GSM is contested '
        + '(ISO 139: pre-dry, then condition up from dry). Do not chase this as a process fault.',
      evidence: [{ table: 'Table 7.3', page: 188 }],
      confidence: `measured over ${moist.covered_pct}% of the blend`,
    });
  }

  // ── 11. How hard the yarn can be pulled before the loop stops coming back
  // Needs the count, because a stress only becomes a tension a knitter can set
  // on the machine once there is a linear density to multiply it by.
  if (yld) {
    push({
      topic: mc.topic, severity: 'info',
      claim: `Past roughly ${round1(yld.fibre_ceiling_cn)} cN of yarn tension at `
        + `${yld.count_ne} Ne, extension stops coming back — and that is an UPPER bound, `
        + `so the yarn's real limit is lower.`,
      mechanism: `Above its yield stress a fibre no longer recovers fully: whatever is imposed `
        + `past that point stays. This blend yields where its weakest component does — `
        + `${yld.governed_by} at ${yld.yield_stress_mn_tex} mN/tex, reached at only `
        + `${yld.yield_strain_pct}% extension — because once that fibre has passed its yield `
        + `point the deformation is taken, whatever the others are still doing. At `
        + `${yld.tex} tex that stress is ${round1(yld.fibre_ceiling_cn)} cN. The figure is the `
        + `FIBRE's: a yarn is twisted, so the fibres sit at an angle to the load and only part `
        + `of their strength reaches the yarn. The book does not measure that translation, so `
        + `no factor is applied — the number is a ceiling the yarn cannot exceed, not the yarn's `
        + `own limit.`,
      action: `This is the mechanism behind ${mc.symptom}: tension past yield is not stored in `
        + `the cloth, it is spent. Keep tension well under the figure above, and if relaxed `
        + `dimensions keep drifting, ${mc.fix}.`,
      evidence: [{ table: yld.evidence.table, page: yld.evidence.page }],
      confidence: yld.unmeasured.length
        ? `no yield point for ${yld.unmeasured.join(', ')}; the ceiling is set by the measured fibres`
        : 'upper bound — fibre yield, not yarn yield',
    });
  }

  // ── 12. How much of the yarn's strength is decided by its worst spot ───
  // A fibre tested over 1 cm is weaker than the same fibre tested over 0.1 mm,
  // because a longer specimen contains more chances of a flaw. How much weaker
  // is a measure of how far a fibre's strength is governed by its faults rather
  // than by its substance — and the fibres are not alike in it at all.
  if (weak && weak.gain_to_0_1mm_pct >= 40) {
    push({
      topic: 'fibre damage sensitivity', severity: 'moderate', scope: 'fibre',
      claim: `${weak.governed_by}'s strength is set by its weak points, not its substance — `
        + `${weak.gain_to_0_1mm_pct}% stronger when tested short enough to miss them.`,
      mechanism: `Over a 1 cm gauge ${weak.governed_by} breaks at ${weak.at_1cm_n_tex} N/tex; `
        + `over 0.1 mm, where a specimen is too short to contain a flaw, it reaches `
        + `${weak.at_0_1mm_n_tex}. The difference is not experimental scatter — it is the `
        + `strength the fibre would have if it had no weak spots. Nylon gains only 15% on the `
        + `same test, so its strength really is its substance.`,
      action: 'Mechanical damage in blowroom and carding costs this fibre far more than it '
        + 'would a synthetic, because it adds weak points to a fibre already governed by them. '
        + 'Keep beater speeds and card settings gentle, and expect short-term CV and yarn '
        + 'breaks — not average strength — to be the figure that moves.',
      evidence: [{ table: 'Table 14.1', page: 324 }],
      confidence: weak.unmeasured.length
        ? `no weak-link data for ${weak.unmeasured.join(', ')}` : 'measured',
    });
  }

  // ── 13. Spirality, on a single jersey where it actually shows ──────────
  // A rib or an interlock is balanced by its own second bed, so residual torque
  // has far less to work on. Issuing this on every fabric would be reciting.
  if (dir && dir.torsional_rigidity && struct.value >= 0.85) {
    push({
      topic: 'spirality',
      severity: dir.spirality_band === 'high' ? 'high'
              : dir.spirality_band === 'moderate' ? 'moderate' : 'info',
      // Stated in the measured quantity rather than as a ratio to cotton: on an
      // all-cotton fabric the ratio is 1 and "1x as stiff as cotton" is a
      // sentence that says nothing. The comparison belongs in the mechanism,
      // where the anchors are given both ways.
      claim: qualify(`Torsional rigidity ${dir.torsional_rigidity.value} mN mm2/tex2 — `
        + `${dir.spirality_band}-risk for spirality in this structure.`,
        dir.torsional_rigidity.from_pct, dir.unmeasured),
      mechanism: `A single jersey spirals because the yarn's residual torque is never fully `
        + `taken out, and how much torque a yarn holds depends on how stiff its fibres are in `
        + `twisting. This blend measures ${dir.torsional_rigidity.value} mN mm2/tex2 against `
        + `cotton's 0.16 and nylon's 0.041 — which is why cotton jersey spirality is a standing `
        + `complaint and nylon's is not.`,
      action: dir.spirality_band === 'low'
        ? 'Torque is not the limiting factor here; if the fabric still spirals, look at yarn '
          + 'twist direction and feeder balance rather than at the fibre.'
        : 'Balance twist direction across feeders (alternate S and Z), consider a low-torque '
          + 'yarn — air-jet or compact — and put the spirality limit in the tech pack rather '
          + 'than discovering it after wash testing.',
      evidence: [{ table: 'Table 17.2', page: 421 }],
      confidence: 'the fibre half of the quantity; yarn twist is the other half and this book '
        + 'does not measure it',
    });
  }

  // ── 14. What the loop itself costs ─────────────────────────────────────
  if (dir && dir.loop_strength && dir.loop_strength.lost_pct >= 12 && struct.value >= 0.5) {
    const L = dir.loop_strength;
    push({
      topic: 'knit strength', severity: L.lost_pct >= 30 ? 'high' : 'moderate',
      claim: qualify(`In a loop this yarn holds only ${L.pct_of_straight}% of the strength it `
        + `shows pulled straight — ${L.lost_pct}% is lost to the geometry alone.`,
        L.from_pct, dir.unmeasured),
      mechanism: `A yarn in a knitted fabric is not straight: it is bent round a needle and `
        + `pulled, and the outside of that bend carries far more than its share. The blend `
        + `gives up as much as its most loop-sensitive component, ${L.governed_by}, because `
        + `that is where it breaks. Every tenacity figure quoted anywhere else in this report `
        + `is a straight-pull figure.`,
      action: 'Do not size knitting tension or seam strength from straight-pull yarn data for '
        + 'this blend. Where strength matters, test the yarn in a loop (ASTM D2256 loop '
        + 'method) rather than deriving it.',
      evidence: [{ table: 'Table 17.3', page: 425 }],
      confidence: 'measured',
    });
  }

  // ── 15. Bagging after a fortnight, not after one pull ──────────────────
  if (cyc && cyc.band !== 'low') {
    push({
      topic: 'wear growth', severity: cyc.band === 'high' ? 'moderate' : 'info',
      claim: qualify(`Under repeated 2% stretching this blend has grown `
        + `${cyc.growth_by_cycle_10_pct}% by the tenth cycle`
        + `${cyc.growth_by_cycle_1000_pct != null
            ? ` and ${cyc.growth_by_cycle_1000_pct}% by the thousandth` : ''}.`,
        cyc.from_pct, cyc.unmeasured),
      mechanism: `Elastic recovery describes one pull. A garment is pulled a few per cent `
        + `thousands of times, and what accumulates is a different quantity: nylon grows 0.28% `
        + `by cycle 10 and cotton 1.98%, seven times, from identical treatment. This blend `
        + `sits at ${cyc.vs_cotton}x cotton.`,
      action: 'Judge shape retention over repeated wear rather than from a single '
        + 'stretch-and-release test. Where the buyer specifies growth after wash and wear, '
        + 'this is the quantity that governs it.',
      evidence: [{ table: 'Table 16.1', page: 369 }],
      confidence: 'measured',
    });
  }

  // ── 16. Heat setting, where the fibre contracts ────────────────────────
  if (therm && therm.contracting_fibres.length) {
    const many = therm.contracting_fibres.length > 1;
    push({
      topic: 'heat setting', severity: 'moderate', scope: 'fibre',
      claim: `${therm.contracting_fibres.join(' and ')} — heated, `
        + `${many ? 'these fibres get' : 'this fibre gets'} SHORTER, not longer.`,
      mechanism: 'Nylon and polyester have a negative coefficient of linear expansion, unlike '
        + 'every natural fibre here, which lengthen. That contraction is the whole basis of '
        + 'heat setting: the cloth is stabilised at temperature in the dimensions it is held '
        + 'in. It is also why a polyester fabric leaves the stenter narrower than it arrived '
        + 'if the width is not held.',
      action: 'Set the stenter width from a heat-relaxed sample, hold that width through the '
        + 'setting zone, and set before dyeing rather than after so the shade is not disturbed '
        + 'by the shrinkage.',
      evidence: [{ table: 'Table 6.5', page: 176 }],
      confidence: 'measured',
    });
  }

  // ── 17. Warmth, and the honest size of the fibre's contribution ────────
  if (therm && therm.conductivity_mw_mk) {
    const c = therm.conductivity_mw_mk;
    push({
      topic: 'thermal comfort', severity: 'info',
      claim: qualify(`Packed solid, these fibres conduct ${c.value} mW/(m K) against still `
        + `air's ${therm.still_air_mw_mk}.`, c.from_pct, therm.unmeasured),
      mechanism: 'Wool conducts 54 and cotton 71 at the same packing, so wool is genuinely '
        + 'warmer at equal weight and not only because it traps more air. But every fibre here '
        + 'is within three times still air, which is the more important half: most of a '
        + "fabric's warmth is the air held in it, so construction and thickness move warmth "
        + 'far more than the choice of fibre does.',
      action: 'Specify warmth through thickness, bulk and structure — a raised or fleeced back '
        + 'holds more air — and treat the fibre as the secondary lever it is.',
      evidence: [{ table: 'Table 6.2', page: 173 }],
      confidence: 'measured',
    });
  }

  // ── 18. The temperature ceiling, and who pays for it ───────────────────
  if (heat && heat.lowest_melting) {
    const L = heat.lowest_melting;
    const endured = heat.non_melting.length;
    push({
      topic: 'temperature ceiling',
      severity: L.celsius <= 180 ? 'high' : 'moderate',
      claim: qualify(`Nothing in this fabric can be set or dried above about `
        + `${heat.working_ceiling_c} °C — ${L.fibre} melts at ${L.celsius} °C.`,
        // An unmeasured fibre could melt LOWER than anything here, which would
        // make this ceiling too high — the dangerous direction — so the caveat
        // is not optional on this one.
        100 - heat.unmeasured.reduce((a, n) => a + (fibers[n] || 0), 0), heat.unmeasured),
      mechanism: `A blend is limited by its LOWEST melting point, not its average or its `
        + `majority. The ceiling above leaves a working margin below the melt because a fibre `
        + `softens and loses its set long before it flows`
        + (endured
            ? `. And ${heat.non_melting.join(', ')} ${endured > 1 ? 'do' : 'does'} not melt at `
              + `all — cellulosic and protein fibres decompose instead — so the temperature `
              + `chosen for the synthetic is ENDURED by ${endured > 1 ? 'them' : 'it'}, never `
              + `shared`
            : '')
        + '.',
      action: `Set the stenter below ${heat.working_ceiling_c} °C and confirm on a swatch. `
        + 'Generic fibre names are not settings: nylon 6 melts at 215 °C and nylon 6.6 at 260, '
        + 'so the yarn specification has to say which.',
      evidence: [{ table: 'Table 18.1', page: 463 }],
      // The margin is a mill convention, not a measurement, and says so.
      confidence: 'the melting point is measured; the 40 °C working margin is a convention',
    });
  }

  // ── 19. What the heat costs the fibre that cannot melt ─────────────────
  if (heat && heat.most_heat_damaged && heat.most_heat_damaged.retained_130c_80d <= 60) {
    const W = heat.most_heat_damaged;
    push({
      topic: 'heat ageing', severity: W.retained_130c_80d <= 20 ? 'high' : 'moderate',
      scope: 'fibre',
      claim: `Held at 130 °C, the ${W.fibre} in this fabric keeps only `
        + `${W.retained_130c_80d}% of its strength after eighty days.`,
      mechanism: 'Melting is the ceiling; this is the slow damage well below it, and it is the '
        + 'more useful question because a fabric is never held at its melting point but is '
        + 'held for hours at 100 to 130 °C in drying, setting and storage. The ordering here '
        + 'is not the melting-point ordering: polyester keeps 75% over the same eighty days '
        + 'and glass keeps everything.',
      action: 'Keep drying and setting dwell times short rather than only keeping the '
        + 'temperature down — the damage is cumulative in both. Where a hot route is '
        + 'unavoidable, test tensile strength on the finished cloth rather than assuming the '
        + 'yarn figure survived it.',
      evidence: [{ table: 'Table 18.3', page: 479 }],
      confidence: 'measured at 80 days, which is far longer than any finishing dwell — read it '
        + 'as an ordering between fibres rather than as a prediction for one pass',
    });
  }

  // ── 20. Static, which is a race and not a property ─────────────────────
  if (stat) {
    const S = stat;
    const known = S.floor_rh_pct != null;
    push({
      topic: 'static', scope: 'fibre',
      severity: !known ? 'info' : S.at_risk ? (S.margin_pct <= -30 ? 'high' : 'moderate') : 'info',
      claim: known
        ? (S.at_risk
            ? `At ${S.floor_rh_pct}% r.h. this fabric will hold a charge — the `
              + `${S.governed_by} in it needs ${S.threshold_rh_pct}% before it leaks away.`
            : `At ${S.floor_rh_pct}% r.h. charge leaks away faster than it builds; `
              + `${S.governed_by} needs only ${S.threshold_rh_pct}%.`)
        : `Charge only leaks away from this fabric above ${S.threshold_rh_pct}% r.h., set by `
          + `the ${S.governed_by} in it.`,
      mechanism: 'Static is not something a fibre has — it is a race between charge arriving '
        + 'and charge leaking away, and the leak is electrical resistance, which in a textile '
        + 'is almost entirely a question of how much water the fibre is holding. Cellulosics '
        + 'reach the threshold at 30% r.h., which is below any working floor, and synthetics '
        + 'at 85%, which is above every one. The blend is governed by its WORST fibre: the '
        + 'charge sits on whatever will not let it go, and a conductive fibre beside an '
        + 'insulating one does not drain it.',
      action: known && S.at_risk
        ? `Raise the floor humidity toward ${S.threshold_rh_pct}% where the process allows, or `
          + 'rely on the finish — the book measures stripping the spin finish off acrylic and '
          + 'polyester moving the threshold from 85% to 95% r.h., so the finish and not the '
          + 'polymer is what carries the charge away. Do not scour an antistatic off and then '
          + 'wonder where the problem came from.'
        : 'No humidity control is needed on this account; if static still appears, look at the '
          + 'machine parts and the finish rather than the fibre.',
      evidence: [{ table: 'Table 22.1', page: 647 }],
      confidence: known ? 'measured'
        : 'no floor humidity was given, so the threshold is reported and the verdict withheld',
    });
  }

  // ── 21. What the dryer has to evaporate ────────────────────────────────
  // Only where the fabric is actually going to be wet. A dyed fabric always is;
  // a caller who says otherwise is taken at their word.
  if (dry && dry.water_after_extraction_pct && ctx.wet_processed !== false) {
    const W = dry.water_after_extraction_pct;
    const heavy = dry.vs_cotton != null && dry.vs_cotton >= 1.5;
    push({
      topic: 'drying load', severity: heavy ? 'moderate' : 'info',
      claim: qualify(`After the hydro-extractor this fabric still holds ${W.value}% of its own `
        + `dry weight in water`
        + (dry.vs_cotton != null ? ` — ${dry.vs_cotton}x what a cotton fabric holds` : '')
        + '.', W.from_pct, dry.unmeasured),
      mechanism: 'Everything else about moisture here is vapour; this is liquid water still in '
        + 'the cloth when it reaches the dryer, and it is what the dryer has to evaporate. '
        + 'After centrifuging, viscose carries 103% of its dry weight and cotton 48% — the '
        + 'same machine at the same setting delivering more than twice the water.'
        + (dry.force_sensitive.length
            ? ` And ${dry.force_sensitive.join('; ')}: that water sits BETWEEN the fibres `
              + 'rather than inside them, so mechanical force removes it where a pressure '
              + 'difference cannot.'
            : ''),
      action: heavy
        ? 'Size dryer time and gas from this figure, not from a cotton baseline, and check '
          + 'that the extractor is doing its share before adding heat — the cheapest water to '
          + 'remove is the water taken out mechanically.'
        : 'Drying load is unremarkable for this blend; a cotton baseline will hold.',
      evidence: [{ table: 'Table 10.1', page: 231 }],
      confidence: 'measured on yarn packages, so a fabric will differ with construction; the '
        + 'ORDERING between fibres is what carries over',
    });
  }

  // ── 22. Warm when damp ─────────────────────────────────────────────────
  if (dry && dry.heat_released_kj_kg && dry.heat_released_kj_kg.value >= 60) {
    const H = dry.heat_released_kj_kg;
    push({
      // Distinct from 'thermal comfort', which is conduction. This is the
      // fibre actually releasing energy as it takes water up, and printing both
      // under one heading made a reader think one of them was a repeat.
      topic: 'warmth when damp', scope: 'fibre',
      severity: 'info',
      claim: qualify(`Moving from a heated room to a damp day, a kilogram of this blend gives `
        + `out about ${H.value} kJ of heat.`, H.from_pct, dry.unmeasured),
      mechanism: 'A fibre taking up water releases heat as the water binds to the polymer. '
        + 'Over the swing from 40% to 70% r.h., wool releases 159 kJ/kg and polyester 4 — '
        + 'forty times. That is the measured basis of a garment feeling warm when you come in '
        + 'from the cold and damp: it is actually warming, not merely insulating. Viscose, at '
        + '168 kJ/kg, does it better than wool, which nobody advertises.',
      action: 'This is a real comfort property and it is worth claiming, but it is transient — '
        + 'it lasts while the fibre is taking water up, not afterwards. Do not confuse it with '
        + 'insulation, which is thickness and trapped air.',
      evidence: [{ table: 'Table 8.5', page: 200 }],
      confidence: 'measured',
    });
  }

  // ── 23. The fold ───────────────────────────────────────────────────────
  if (flex) {
    push({
      topic: 'flex fatigue', severity: 'info',
      claim: qualify(`At a fold this fabric survives about `
        + `${flex.cycles.toLocaleString('en-GB')} bends, set by the ${flex.governed_by} in it.`,
        flex.from_pct, flex.unmeasured),
      mechanism: 'Abrasion wears a fabric from the outside; flex fatigue breaks it from the '
        + 'inside, at a crease, and that is what finishes a collar, a cuff or a knee long '
        + 'before anything has worn through. Nylon 6 survives 35,825 bends, nylon 6.6 104,807 '
        + 'and polyester 194,616 — an ordering neither tenacity nor abrasion resistance '
        + 'predicts. The blend is governed by its weakest component, because a fold fails '
        + 'where the first fibres in it fail.',
      action: 'Where a garment has a permanent crease — a collar, a placket, a pleat — judge it '
        + 'on this rather than on tensile strength, and set a flex or edge-abrasion test '
        + 'rather than a tensile one.'
        + (flex.cv_pct != null
            ? ` Design to about ${flex.design_cycles.toLocaleString('en-GB')} rather than the `
              + `mean: the scatter is ${flex.cv_pct}% and the distribution is skewed, so the `
              + `median is already lower at ${flex.median_cycles.toLocaleString('en-GB')} and a `
              + 'useful fraction of fibres fail below that again.'
            : ''),
      evidence: [{ table: 'Table 19.4', page: 534 }],
      confidence: 'measured on single fibres over a pin, so it ranks fibres rather than '
        + 'predicting a garment',
    });
  }

  // -- 24. Torque the yarn is holding -------------------------------------
  // Only where twist is actually stored. A woven fabric is stabilised by its
  // own interlacing and a heavy interlock by its two needle beds; a light
  // single jersey has nothing opposing the yarn and it will turn.
  if (aniso && aniso.measured && aniso.worst_ratio >= 6) {
    const free = structureFreedom(ctx);
    const loose = free.value >= 0.75;
    push({
      topic: 'twist liveliness',
      severity: loose && ctx.category !== 'woven' ? 'moderate' : 'info',
      claim: qualify(`The ${aniso.governed_by} in this yarn resists a pull about `
        + `${round1(aniso.worst_ratio)} times harder than it resists a twist, so the twist put `
        + `in at spinning is stored as torque rather than absorbed.`, aniso.from_pct,
        aniso.unmeasured.concat(aniso.no_shear_modulus)),
      mechanism: 'Table 17.2 measures the same fibre twice: E, the stiffness in tension, and G, '
        + 'the stiffness in shear. In a material with no grain those are locked together at '
        + 'E/G = 2(1+v), about 2.6 — so everything above 2.6 is a direct measure of molecules '
        + `lying along the fibre axis. This blend runs at ${round1(aniso.worst_ratio)}, `
        + `${round1(aniso.excess)} times isotropic. Polypropylene sits at 3.2 and is barely `
        + 'anisotropic; nylon reaches 11, and one nylon in the table has a shear modulus of '
        + '0.033 kN/mm² — twenty-five times below wool. A fibre that resists being pulled and '
        + 'not being twisted gives the twist back the moment the yarn is slack.'
        + (aniso.worst_ratio_span
            ? ` The table prints a range for ${aniso.governed_by}, and across it the ratio runs `
              + `${aniso.worst_ratio_span[0]} to ${aniso.worst_ratio_span[1]} — those are `
              + 'different fibres sold under one name, and the supply matters.'
            : ''),
      action: loose && ctx.category !== 'woven'
        ? 'Expect snarling at the creel and liveliness in the loop. Steam-set or vacuum-set the '
          + 'yarn before knitting rather than relying on relaxation afterwards, and treat this '
          + 'as a separate cause of spirality from twist multiplier alone — the twist level can '
          + 'be right and the fibre still lively.'
        : 'The structure holds the torque here, so it will not show as spirality — but it is '
          + 'still there, and it will show if the same yarn goes into a lighter single jersey.',
      evidence: [{ table: 'Table 17.2', page: 421 }],
      confidence: 'measured on single fibres; the yarn-level torque also depends on twist '
        + 'multiplier and setting, which this does not know',
    });
  }

  // -- 25. Weak across, strong along -------------------------------------
  // The first version of this claimed FIBRILLATION and fired on polyester,
  // which does not fibrillate. Both numerical conditions were satisfied and the
  // conclusion was still wrong: whether transverse weakness comes out as
  // lengthwise splitting depends on whether the fibre is built from
  // microfibrils, and Table 17.2 does not measure that. So the finding claims
  // the weakness, which is measured, and names the limit rather than crossing it.
  if (aniso && aniso.measured && aniso.skin_core.length && aniso.worst_ratio >= 6) {
    push({
      topic: 'transverse weakness',
      severity: 'info',
      claim: `${aniso.skin_core.join(' and ')} here ${aniso.skin_core.length > 1 ? 'are' : 'is'} `
        + `about ${round1(aniso.worst_ratio)} times weaker across the axis than along it, with a `
        + 'skin stiffer than the core — so rubbing damage starts as a lengthwise split at the '
        + 'surface rather than as material worn away.',
      mechanism: 'Two measurements in Table 17.2 line up. E/G says the chains run along the axis '
        + 'and are held across it only by weak secondary forces. The bending modulus against the '
        + 'tensile modulus says where the stiffness sits: bending is carried by the OUTSIDE of '
        + 'the fibre, so a bending modulus above the tensile one means a skin stiffer than the '
        + 'core — viscose reads 10 GPa in bending against 8.7 in tension. A split starts at that '
        + 'skin and runs down the axis, and wet is worse because water has already loosened what '
        + 'holds the fibre across. WHERE THIS STOPS: whether the split becomes visible '
        + 'fibrillation depends on the fibre being built from microfibrils, which is a '
        + 'morphology this table does not measure. The cellulosics do it; melt-spun polyester '
        + 'and nylon satisfy the same two numbers and craze instead. Do not read this as a '
        + 'fibrillation prediction — read it as the reason abrasion here is a surface-splitting '
        + 'failure and not a surface-wearing one.',
      action: 'Test wet rub and wet abrasion rather than dry, and keep mechanical action in wet '
        + 'processing low — long soft-flow cycles at high liquor movement are where it shows. On '
        + 'a cellulosic, expect frosting on the crown of the yarn; on a melt-spun fibre, expect '
        + 'gloss loss instead of splitting.',
      evidence: [{ table: 'Table 17.2', page: 421 }],
      confidence: 'the transverse weakness is measured; which visible failure it becomes is not '
        + 'in this table and is stated as a limit rather than a prediction',
    });
  }

  // -- 26. The shape of the curve, not its end ----------------------------
  if (shape) {
    const tough = shape.work_factor >= 0.6;
    const brittle = shape.work_factor < 0.48;
    push({
      topic: 'energy at break', severity: 'info',
      claim: qualify(`This blend's stress-strain curve has a work factor of `
        + `${shape.work_factor} against 0.5 for a straight line, so it ${shape.band}.`,
        shape.from_pct, shape.unmeasured),
      mechanism: 'Tenacity says where the curve stops and extension says how far along it got; '
        + 'neither says what the fabric does in between, and that is what a wearer feels. Table '
        + '13.1 prints work of rupture divided by (breaking load x breaking extension), which is '
        + 'exactly 0.5 for a straight line to break. Cotton reads 0.46 and wool 0.64 — and those '
        + 'are the same two fibres whose yield points this engine already knows, cotton at 1% '
        + 'strain and wool at 4%, wool then carrying load for another forty per cent. The work '
        + 'factor and the yield point are one fact measured twice, which is why they agree.',
      action: tough
        ? 'This fabric absorbs a snatch load rather than transmitting it: seams and trims will '
          + 'take the shock before the ground fabric does, so specify seam strength against the '
          + 'fabric rather than assuming the fabric is the weak point.'
        : brittle
          ? 'Most of the work is done close to break, so the fabric gives little warning: it '
            + 'feels firm right up to failure. Do not read a firm handle as a strong fabric, and '
            + 'test bursting strength rather than inferring it from stiffness.'
          : 'The curve is close to linear, so stiffness and strength scale together here and a '
            + 'handle judgement is a fair proxy for strength.',
      evidence: [{ table: 'Table 13.1', page: 290 }],
      confidence: 'measured on single fibres; a yarn adds twist and a fabric adds structure, '
        + 'both of which flatten the curve further',
    });
  }

  // -- 27. How a dye gets in ----------------------------------------------
  if (orient) {
    const hi = orient.most_oriented;
    push({
      topic: 'dye uptake',
      severity: orient.dye_rate_split ? 'moderate' : 'info',
      claim: qualify(orient.dye_rate_split
        ? `The fibres here differ in molecular orientation by ${orient.spread} in birefringence `
          + `(${hi.fibre} ${hi.birefringence} against ${orient.least_oriented.fibre} `
          + `${orient.least_oriented.birefringence}), so they will not take up dye at the same `
          + 'rate and one bath will give two shades.'
        : `This blend's molecular orientation is ${hi.band} at ${orient.blend_birefringence} `
          + 'birefringence, which sets how hard a dye has to work to get in.',
        orient.from_pct, orient.unmeasured),
      mechanism: 'Table 24.3 measures the refractive index twice — light polarised along the '
        + 'fibre and across it — and the difference is a direct measure of how far the molecules '
        + 'lie along the axis. Orientation is the same thing as a tight ordered structure, and a '
        + 'dye molecule has to push into one. The single column explains the whole dyeing '
        + 'hierarchy without a dyeing table: acrylic reads 0.000 and wool 0.010, and both take '
        + 'dye at the boil; cotton reads 0.046 and needs alkali and time; polyester reads 0.188, '
        + 'three times anything else, and takes no water-soluble dye at all. The cellulose pair '
        + 'is the practical one — viscose is 0.020 against cotton 0.046, less than half as '
        + 'oriented, so it takes the same reactive dye faster and darker in the same bath.',
      action: orient.dye_rate_split
        ? 'Do not expect a solid shade from one bath. Either dye to a deliberate two-tone, or '
          + 'compensate: a slower dye, a longer migration hold, or separate dye classes chosen '
          + 'so the less-oriented fibre is not the one carrying the depth. Check the shade on '
          + 'BOTH fibres in the lab dip, not on the blend average.'
        : hi.birefringence >= 0.10
          ? 'Disperse dye at 130 C or with a carrier — nothing water-soluble will enter this '
            + 'structure. Budget the energy for it rather than the cotton cycle.'
          : 'The structure is open enough for ordinary exhaust dyeing; orientation is not the '
            + 'constraint on shade depth here.',
      evidence: [{ table: 'Table 24.3', page: 702 }],
      confidence: 'birefringence measures orientation, and orientation is one of the things that '
        + 'sets dye rate — fibre fineness and finish also matter and are not in this figure',
    });
  }

  // -- 28. Two kinds of failure at a join ---------------------------------
  if (joint && joint.bend_sensitive.length) {
    const b = joint.bend_sensitive[0];
    push({
      topic: 'joins and knots', severity: 'info',
      claim: `${b.fibre} keeps ${b.knot}% of its strength in a knot but only ${b.loop}% in a `
        + 'loop, so what it cannot take is being bent round a small radius, not being gripped.',
      mechanism: 'Table 17.3 tests the same fibre two ways and the pair says more than either '
        + 'alone. A loop is a sharp bend plus tension; a knot is a bend plus tension plus '
        + `transverse pressure — strictly the harder test. Where the knot nevertheless holds `
        + `better, as it does here by ${b.gap} points, the fibre is failing on bend radius. `
        + 'Those two failures look identical in a broken package and have opposite fixes.',
      action: 'If yarn is breaking at the knotter or the splicer, open the bend radius rather '
        + 'than dropping tension — dropping tension will not help. The same reasoning applies at '
        + 'the needle: a small loop radius is the same test.',
      evidence: [{ table: 'Table 17.3', page: 425 }],
      confidence: 'measured on single fibres by Berry and by Bohringer and Schieber; the '
        + 'workers do not always agree, and the book prints both',
    });
  }

  // -- 29. How hard the fabric fights being stretched ---------------------
  if (stretch) {
    const hard = stretch.work_hardening.filter(h => h.rise_pct >= 20);
    push({
      topic: 'stretch resistance', severity: 'info',
      claim: qualify(`Holding this fabric at 2% extension takes about `
        + `${stretch.stress_for_2pct_mn_tex} mN/tex — ${stretch.band}.`,
        stretch.from_pct, stretch.unmeasured),
      mechanism: 'The growth figures this report already gives are the permanent set left after '
        + 'cycling, and on their own they are unreadable, because growth is measured at whatever '
        + 'stress the fibre needed to reach 2% in the first place. Table 16.1 prints that stress '
        + 'and it spans a factor of ten: wool 25 mN/tex, viscose and nylon 51, cotton 68, silk '
        + '108, flax 263. The pair that settles it is viscose and nylon — identical at 51 mN/tex, '
        + 'and they grow 1.79% and 0.28%. Equal stiffness, six times the permanent set, so how a '
        + 'fabric feels and how it recovers are independent and a handle judgement cannot stand '
        + 'in for a recovery test.'
        + (hard.length
            ? ` And the stress needed CLIMBS with cycling — ${hard.map(h => h.fibre + ' by '
              + round1(h.rise_pct) + '% between cycle 10 and cycle 1000').join(', ')} — so the `
              + 'fabric is being work-hardened as it is worn.'
            : ''),
      action: 'Use this as the take-down tension the fabric will fight on the machine, and for a '
        + 'stretch garment as the recovery power the wearer feels. Where it is low, the fabric '
        + 'moves easily and will also sag easily; where it is high, expect it to resist being '
        + 'laid flat and to hold a crease from the roll.',
      evidence: [{ table: 'Table 16.1', page: 369 }],
      confidence: 'measured on single fibres at 2% imposed extension; a knitted loop reaches far '
        + 'higher local strains than that',
    });
  }

  // -- 30. What humidifying actually buys ---------------------------------
  // Only where there IS a static problem to spend money on. The threshold
  // finding answers whether there is one; this answers what fixing it costs,
  // and printing the cost of a problem nobody has is noise.
  if (humid && stat && stat.at_risk === true) {
    push({
      topic: 'humidification', severity: 'moderate',
      claim: qualify(`On this blend one percentage point of extra regain takes the resistance `
        + `down about ${humid.fold_per_point}-fold, so ${humid.band}.`,
        humid.from_pct, humid.unmeasured),
      mechanism: 'Resistance against moisture is a straight line on log-log axes, and Table 22.1 '
        + 'prints its SLOPE — which is not the same for every fibre, and that is the whole reason '
        + 'the column exists. Flax runs 10.6 and silk 17.6, so the same humidifier buys nearly '
        + 'twice as much on a protein fibre as on a bast one. The other column separates two '
        + 'things that are otherwise confounded: at a FIXED 10% moisture, cotton reads 5.3 and '
        + 'wool 10.4 — five decades apart at the same water content. Wool is not merely wetter '
        + 'than cotton, it conducts far worse at equal wetness, and no amount of humidifying '
        + 'closes that gap.'
        + (humid.intrinsic.length
            ? ' Here: ' + humid.intrinsic.map(i => i.fibre + ' ' +
                i.log_resistance_at_10pct_moisture + ' log ohm').join(', ') + '.'
            : ''),
      action: humid.slope >= 15
        ? 'Humidification is the right lever on this blend — raising the floor is cheaper than '
          + 'topical antistat and it does not wash out. Size it from this slope rather than from '
          + 'a rule of thumb.'
        : 'Humidification alone will move this less than expected. Plan on a spin finish or '
          + 'topical antistat as well, and put the humidity budget where the slope is steepest.',
      evidence: [{ table: 'Table 22.1', page: 647 }],
      confidence: 'the fit is over a wide moisture range and the slope is taken as constant '
        + 'near 8% regain, which is where it is being used',
    });
  }

  // -- 31. Nowhere left to swell ------------------------------------------
  if (jam && jam.diameter_gain_pct >= 10) {
    const woven = ctx.category === 'woven';
    push({
      topic: 'wet jamming',
      severity: woven && jam.jams_when_wet === true ? 'moderate' : 'info',
      claim: qualify(`In water the fibres here gain about ${jam.diameter_gain_pct}% on their `
        + `DIAMETER (${jam.worst.fibre} up to ${Array.isArray(jam.worst.span) ? jam.worst.span[1] : jam.worst.span}%)`
        + (jam.cover_factor_wet != null
            ? `, which takes the cover factor from ${jam.cover_factor_dry} to about `
              + `${jam.cover_factor_wet} against a jamming point of ${jam.cover_ceiling} for `
              + `this weave — so wet it ${jam.jams_when_wet ? 'jams' : 'still has room'}`
            : '')
        + '.', jam.from_pct, jam.unmeasured),
      mechanism: 'Area swelling is the right figure for how much water a fibre takes into '
        + 'itself; diameter swelling is the figure for what happens to everything packed around '
        + 'it, and Table 11.1 prints both. Nylon gains 2% on diameter and viscose up to 52%. In '
        + 'a slack knitted structure that simply pushes the loops apart and the fabric relaxes. '
        + 'In a woven at a high cover factor there is nowhere for it to go — the yarns jam '
        + 'against each other, the cloth cannot take up any more in width, and the strain goes '
        + 'into crimp and out as length. That is the mechanism of wet shrinkage: not the fibre '
        + 'getting shorter, which it barely does, but the fabric running out of room sideways. '
        + 'The jamming point belongs to the cloth, not to a constant: a satin intersects less '
        + 'than a plain weave and can be set closer before it runs out of room, so the same '
        + 'swelling is a problem in one construction and not in the other.',
      action: woven
        ? 'Set the loom cover factor with the WET figure in mind, not the dry one, and expect the '
          + 'shrinkage to appear in the warp direction. If the wet cover factor crosses the '
          + 'jamming point, pre-shrink before cutting rather than after.'
        : 'A knitted structure has the slack to absorb this, so it shows as relaxation shrinkage '
          + 'rather than jamming. Take the dimensions after a wet relax, never off the machine.',
      evidence: [{ table: 'Table 11.1', page: 240 }],
      confidence: 'measured on fibres immersed in water; a yarn swells by roughly the same '
        + 'fraction because the packing does not change, but the fabric depends on construction',
    });
  }

  // -- 32. What water does to the energy, not the strength ----------------
  // The wet card reports the process side of Table 13.7, so where it is on the
  // page this is handed over rather than printed twice.
  const disagrees = tough && tough.strength_disagrees.length ? tough.strength_disagrees : [];
  if (tough && ctx.wet_processed !== false &&
      (tough.wet_ratio <= 0.9 || tough.reverses.length || disagrees.length)) {
    const drop = Math.round((1 - tough.wet_ratio) * 100);
    push({
      topic: 'wet toughness',
      severity: tough.wet_ratio <= 0.7 ? 'high'
              : (tough.wet_ratio <= 0.9 || tough.reverses.length) ? 'moderate' : 'info',
      claim: qualify(tough.wet_ratio <= 0.9
        ? `Wet, this fabric absorbs about ${drop}% less energy before it breaks than it does dry.`
        : disagrees.length
          ? `This report also says this fabric is STRONGER wet, and both are true: `
            + `${disagrees.map(d => d.fibre + ' gains '
                + Math.round((d.strength - 1) * 100) + '% in strength and still loses '
                + Math.round((1 - d.toughness) * 100) + '% of its toughness').join('; ')}.`
          : `Wet at 20 C this fabric toughens, and then loses it again in a hot bath.`,
        tough.from_pct, tough.unmeasured)
        + (tough.reverses.length
            ? ` ${tough.reverses.map(r => r.fibre + ' reverses outright — ' + r.at_20c
                + ' of its dry toughness wet at 20 C, ' + r.at_95c + ' at 95 C').join('; ')}.`
            : ''),
      mechanism: 'Three columns of Table 13.7 were already driving the wet advice here: what '
        + 'water does to strength, to extension and to stiffness. The fourth is the one that '
        + 'decides whether a wet fabric survives being handled, because a fabric fails when it '
        + 'runs out of ENERGY to absorb, not when it runs out of any one of those. Cotton is the '
        + 'case that proves the column is needed: cotton gets 11% STRONGER wet and still loses 8% '
        + 'of its toughness, because its stiffness collapses to a third at the same moment. Read '
        + 'the strength column alone and a wet cotton fabric looks tougher than a dry one. Wool '
        + 'loses a third and viscose 31%. Silk is the trap — 31% tougher wet at 20 C and a third '
        + 'LESS tough once the bath reaches 95 C, so a route judged at room temperature gets silk '
        + 'exactly backwards.',
      action: 'Set the mechanical severity of the wet route from this rather than from wet '
        + 'strength: it is the number that says how much a batch, a winch or a squeeze roller can '
        + 'do to the cloth before it damages it. Where the fabric reverses between 20 C and 95 C, '
        + 'judge the hot stage on its own figure and not on a cold trial.',
      evidence: [{ table: 'Table 13.7', page: 312 }],
      confidence: 'measured on single fibres; a fabric also has its structure to absorb energy, '
        + 'so the RATIO carries over better than the absolute level',
    });
  }

  // -- What is NOT known --------------------------------------------------
  const gaps = [];
  if (silentOn.length) {
    gaps.push(`${silentOn.join(', ')} — the book carries no measurements for `
      + `${silentOn.length > 1 ? 'these' : 'this'}, so nothing above describes `
      + `${silentOn.length > 1 ? 'them' : 'it'}`);
  }
  if (mech && mech.no_wet_data && mech.no_wet_data.length) {
    gaps.push(`wet behaviour of ${mech.no_wet_data.join(', ')} — Table 13.7 has no row for `
      + `${mech.no_wet_data.length > 1 ? 'them' : 'it'}`);
  }
  if (rec && rec.unmeasured && rec.unmeasured.length) {
    gaps.push(`elastic recovery of ${rec.unmeasured.join(', ')} — Table 15.2 predates `
      + `${rec.unmeasured.length > 1 ? 'them' : 'it'}`);
  }
  if (pill && pill.unmeasured.length) {
    gaps.push(`pilling behaviour of ${pill.unmeasured.join(', ')}`);
  }

  const order = { severe: 0, high: 1, moderate: 2, info: 3 };
  // Theme first, then severity within it: the worst thing in each area is the
  // first thing read there.
  findings.sort((a, b) => (a.theme_order - b.theme_order) ||
    ((order[a.severity] ?? 9) - (order[b.severity] ?? 9)));

  return {
    ok: true,
    coverage: {
      measured_pct: round1(coveredPct),
      measured: measured.map(([n]) => n),
      silent_on: silentOn,
      structure_matched: struct.matched,
      structure_freedom: struct.value,
    },
    indices: {
      moisture: moist,
      directional: dir,
      cyclic: cyc,
      thermal: therm,
      heat: heat,
      static: stat,
      drying: dry,
      flex_fatigue: flex,
      anisotropy: aniso,
      curve_shape: shape,
      orientation: orient,
      joints: joint,
      stretch_resistance: stretch,
      humidity_leverage: humid,
      wet_jamming: jam,
      wet_toughness: tough,
      yield_tension: yld,
      pilling: pill,
      handle: hand,
      recovery: rec,
      friction: fric,
      variability: vary,
      weak_link: weak,
      mechanics: mech,
    },
    findings,
    // Not hidden — handed over. A reader who wonders why felting is missing from
    // a wool fabric's list can see that it was reported next door.
    deferred_to_wet_processing: [...new Set(deferred)],
    // A reader must be able to tell "no risk found" from "never looked".
    not_known: gaps,
    headline: findings.length
      ? findings[0].claim
      : deferred.length
        ? `The fibre risks for this fabric are reported on the wet-processing card `
          + `(${[...new Set(deferred)].join(', ')}).`
        : 'Nothing in the measured properties flags a risk for this construction.',
    source: SOURCE,
  };
}

module.exports = { fibreAdvisory, pillingIndex, handleIndex, structureFreedom };
