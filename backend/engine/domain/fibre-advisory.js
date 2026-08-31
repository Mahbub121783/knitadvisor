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
  fibreVariability, weakLinkSensitivity,
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

function finding(o) {
  if (!o.claim || !o.mechanism || !o.action || !o.evidence) return null;
  return o;
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
  const weak = weakLinkSensitivity(fibers);
  const pill = pillingIndex(fibers);
  const hand = handleIndex(fibers);
  const struct = structureFreedom(ctx);

  const findings = [];
  const push = f => { const v = finding(f); if (v) findings.push(v); };

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
        topic: 'wet processing', severity: 'info',
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
  if (fric && fric.stick_slip_ratio != null && fric.stick_slip_ratio >= 1.3) {
    push({
      topic: 'knitting tension', severity: 'moderate',
      claim: `This yarn will run in grabs and releases rather than smoothly `
        + `(static friction is ${fric.stick_slip_ratio}× kinetic).`,
      mechanism: 'Starting a slide takes more force than continuing one, and the bigger that gap '
        + 'the more the yarn sticks, breaks free and overshoots. Tension at the needle varies '
        + 'with it, and stitch length varies with the tension — which shows up as barré or as '
        + 'GSM drifting across the roll.',
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
  if ((fibers.cotton || 0) >= 50 && ctx.mercerised !== true) {
    push({
      topic: 'lustre', severity: 'info',
      claim: 'Mercerising under tension would raise this fabric\'s lustre by roughly two and a '
        + 'half times.',
      mechanism: 'Cotton lustre tracks one thing — how flat the fibre\'s cross-section is. '
        + 'Adderley measured lustre 5.7 at an axis ratio of 3.07 and 13.9 at 1.47, and found no '
        + 'correlation at all with fibre length, linear density or diameter. Caustic removes the '
        + 'convolutions and rounds the section, and the lustre follows.',
      action: 'Mercerise under maintained clip or chain tension. Without tension the fibre swells '
        + 'and relaxes back to a flat section, the caustic is spent and no lustre arrives — which '
        + 'is the usual cause of "mercerised but no shine".',
      evidence: [{ table: 'Table 24.5', page: 706 }],
      confidence: 'measured',
    });
  }

  // ── What is NOT known ──────────────────────────────────────────────────
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
  findings.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

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
      pilling: pill,
      handle: hand,
      recovery: rec,
      friction: fric,
      variability: vary,
      weak_link: weak,
      mechanics: mech,
    },
    findings,
    // A reader must be able to tell "no risk found" from "never looked".
    not_known: gaps,
    headline: findings.length
      ? findings[0].claim
      : 'Nothing in the measured properties flags a risk for this construction.',
    source: SOURCE,
  };
}

module.exports = { fibreAdvisory, pillingIndex, handleIndex, structureFreedom };
