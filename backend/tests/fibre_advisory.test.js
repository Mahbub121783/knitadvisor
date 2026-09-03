const assert = require('assert');
const { fibreAdvisory, pillingIndex, handleIndex, structureFreedom } =
  require('../engine/domain/fibre-advisory');
const { FIBER_PROPERTIES } = require('../engine/domain/yarn-engine');
const engine = require('../engine');

console.log('--- Running Fibre Advisory Tests ---');

const sj = { fabricId: 'single_jersey', category: 'single_jersey', gsm: 180 };
const il = { fabricId: 'interlock', category: 'interlock', gsm: 240 };

// ── Every finding is advice, never trivia ───────────────────────────────
// The four-part shape is what separates a professor from a textbook index. A
// claim with no mechanism is memorisation; a mechanism with no action is a
// lecture; either without a citation is an assertion. The engine drops any
// finding missing one, so nothing here can slip through as a bare statement.
for (const fibers of [{ cotton: 100 }, { cotton: 60, polyester: 40 }, { viscose: 100 },
                      { wool: 100 }, { nylon: 100 }, { cotton: 95, elastane: 5 }]) {
  for (const ctx of [sj, il]) {
    const a = fibreAdvisory(fibers, ctx);
    assert(a.ok, `${JSON.stringify(fibers)} returned nothing`);
    for (const f of a.findings) {
      assert(f.claim && f.mechanism && f.action, `${f.topic}: incomplete finding`);
      assert(Array.isArray(f.evidence) && f.evidence.length, `${f.topic}: no evidence`);
      for (const e of f.evidence) {
        assert(e.table && e.page, `${f.topic}: evidence without a table and page`);
        assert(e.page >= 1 && e.page <= 746, `${f.topic}: page ${e.page} is outside the book`);
      }
      assert(['severe', 'high', 'moderate', 'info'].includes(f.severity), f.topic);
    }
  }
}

// ── Conditional, not recited ────────────────────────────────────────────
// The same fibre must produce different advice in different fabrics, or the
// module is a lookup table wearing a coat.
const wSJ = fibreAdvisory({ cotton: 100 }, sj);
const wIL = fibreAdvisory({ cotton: 100 }, il);
const bagOf = a => a.findings.find(f => f.topic === 'shape retention');
assert(bagOf(wSJ).claim !== bagOf(wIL).claim,
  'cotton must not get identical shape advice in a single jersey and an interlock');
assert(['severe', 'high'].includes(bagOf(wSJ).severity),
  'a cotton single jersey does bag, and the report should say so');
assert(bagOf(wIL).severity === 'info' || bagOf(wIL).severity === 'moderate',
  'an interlock locks the loops, so the same fibre is a smaller problem');
assert(structureFreedom(sj).value > structureFreedom(il).value);

// Already-mercerised cotton must not be told to mercerise. Repeating advice
// that no longer applies is exactly the recitation this must avoid.
const plain = fibreAdvisory({ cotton: 100 }, sj);
const merc = fibreAdvisory({ cotton: 100 }, { ...sj, mercerised: true });
assert(plain.findings.some(f => f.topic === 'lustre'));
assert(!merc.findings.some(f => f.topic === 'lustre'),
  'a fabric already specified as mercerised should not be advised to mercerise');

// ── Silence must be distinguishable from safety ─────────────────────────
// Modal used to be the live case here (a density and a regain only, so a
// fibre-level coverage check called it "measured" and every rule quietly
// declined to fire). It carries real tensile/directional data now — see
// yarn-engine.js FIBER_PROPERTIES.modal, sourced from the book's Polynosic
// rows — so the example moves to tencel, which genuinely still has nothing:
// checked against the extraction and the lesson store under both
// "tencel"/"lyocell" and neither appears at all.
const tencel = fibreAdvisory({ tencel: 100 }, sj);
assert(tencel.ok);
assert.strictEqual(tencel.coverage.measured_pct, 0);
assert.strictEqual(tencel.findings.length, 0);
assert(tencel.not_known.length, 'a fabric with no measurements must say so');
assert(/no measured fibre properties/i.test(tencel.headline),
  'the headline itself must carry the ignorance, not just a footnote');

// Modal itself must now be the OPPOSITE case: real findings, not silence.
const modalKnown = fibreAdvisory({ modal: 100 }, sj);
assert(modalKnown.ok);
assert(modalKnown.coverage.measured_pct === 100,
  'modal now carries tensile data (Polynosic-sourced) and must count as measured');
assert(modalKnown.findings.length > 0,
  'a fully-measured 100% modal fabric must produce real findings, not an empty report');

// ── A half-known number must never be stated flatly ─────────────────────
const half = fibreAdvisory({ cotton: 50, tencel: 50 }, sj);
assert.strictEqual(half.coverage.measured_pct, 50);
for (const f of half.findings) {
  // A fibre-scoped claim names its own fibre — "cotton's strength is set by its
  // weak points" is true of the cotton whatever else is in the yarn — so a
  // coverage caveat there would be noise pretending to be rigour. Only claims
  // about the CLOTH have to carry it.
  if (f.scope === 'fibre') continue;
  assert(/measured over only 50% of the blend/.test(f.claim),
    `${f.topic}: a claim computed from half a blend must say so in the CLAIM, not a footnote`);
}
// And every finding must declare which it is, so the rule above cannot be
// escaped by forgetting to say.
for (const f of half.findings) {
  assert(['fabric', 'fibre'].includes(f.scope), `${f.topic}: undeclared scope`);
}

// ── Pilling, derived from the work of rupture ───────────────────────────
// The physics: a pill stays if the fibres anchoring it do not break, and the
// energy to break a fibre is its work of rupture. So the TOUGHEST fibre
// governs, not the average — the cotton in a poly-cotton does nothing to
// release a pill the polyester is holding.
const pcPill = pillingIndex({ cotton: 60, polyester: 40 });
assert.strictEqual(pcPill.anchor_fibre, 'polyester');
assert.strictEqual(pcPill.anchor_work_of_rupture, 53);
assert(pcPill.index_vs_cotton > 4, 'poly-cotton is several times more pill-persistent than cotton');
assert.strictEqual(pillingIndex({ cotton: 100 }).band, 'low',
  'pure cotton does not hold pills, and the model must agree with every hand that has felt one');
// A mass-weighted average would have put this at 27 mN/tex and called it
// "moderate", which is precisely the wrong answer.
assert(pcPill.anchor_work_of_rupture > (0.6 * 10.7 + 0.4 * 53),
  'the governing figure is the anchor fibre, not the blend mean');
// A trace fibre cannot form an anchoring network, so it is noted and excluded.
const trace = pillingIndex({ cotton: 97, nylon: 3 });
assert.strictEqual(trace.anchor_fibre, 'cotton');
assert(trace.ignored_below_10pct.some(x => /nylon/.test(x)),
  'the excluded fibre is named rather than silently dropped');

// ── Handle, from the initial modulus ────────────────────────────────────
assert.strictEqual(handleIndex({ polyester: 100 }).band, 'crisp');
assert.strictEqual(handleIndex({ wool: 100 }).band, 'very soft');
assert(handleIndex({ polyester: 100 }).modulus_n_tex >
       handleIndex({ nylon: 100 }).modulus_n_tex,
  'polyester at 10.6 N/tex is crisper than nylon at 3.0, which is what a hand reports');

// ── The work of rupture actually reached the engine ─────────────────────
// It was extracted, gated and stored for weeks before anything used it. This
// asserts the wiring, not the number.
for (const key of ['cotton', 'polyester', 'nylon', 'viscose', 'wool', 'silk', 'acrylic']) {
  assert(FIBER_PROPERTIES[key].tensile.work_of_rupture > 0,
    `${key} has no work of rupture on the engine's fibre table`);
}

// ── Elastane: withhold, do not compute ──────────────────────────────────
// Table 15.2 predates spandex. A verdict from the other 95% would call a
// stretch jersey a bagging risk, which is worse than saying nothing.
const stretch = fibreAdvisory({ cotton: 95, elastane: 5 }, { fabricId: 'rib_1x1', category: 'rib' });
const sr = stretch.findings.find(f => f.topic === 'shape retention');
assert.strictEqual(sr.severity, 'info');
assert(/No bagging verdict/.test(sr.claim));
assert(/elastane/.test(stretch.not_known.join(' ')));

// ── Felting fires only for wool ─────────────────────────────────────────
assert(fibreAdvisory({ wool: 100 }, il).findings.some(f => f.topic === 'felting'));
for (const f of [{ cotton: 100 }, { polyester: 100 }, { viscose: 100 }, { nylon: 100 }]) {
  assert(!fibreAdvisory(f, il).findings.some(x => x.topic === 'felting'),
    `${Object.keys(f)[0]} has no directional friction and must not be told it felts`);
}

// ── Severity ordering is calibrated against fabrics people have handled ──
// A cotton single jersey is the most-made fabric on earth. Calling it "severe"
// every time would bury the viscose that genuinely is.
assert.strictEqual(bagOf(fibreAdvisory({ viscose: 100 }, sj)).severity, 'severe');
assert.strictEqual(bagOf(fibreAdvisory({ cotton: 100 }, sj)).severity, 'high');
assert(['info', 'moderate'].includes(bagOf(fibreAdvisory({ nylon: 100 }, sj)).severity),
  'nylon recovers 89% from a 10% pull and must not be flagged');

// ── Findings are ordered worst-first WITHIN each theme ──────────────────
// The ordering was severity alone while this emitted eight findings. At
// twenty-five a flat list stopped being readable, so findings are grouped by
// the question they answer and severity orders inside the group — the worst
// thing in each area is still the first thing read there.
for (const fibers of [{ viscose: 100 }, { cotton: 60, polyester: 40 }, { wool: 100 }]) {
  const order = { severe: 0, high: 1, moderate: 2, info: 3 };
  const fs = fibreAdvisory(fibers, sj).findings;
  for (let i = 1; i < fs.length; i++) {
    assert(fs[i].theme_order >= fs[i - 1].theme_order, 'themes must stay in order');
    if (fs[i].theme_order !== fs[i - 1].theme_order) continue;
    assert(order[fs[i].severity] >= order[fs[i - 1].severity],
      `${fs[i].theme}: findings must be worst-first within a theme`);
  }
}

// ── It reaches the caller ───────────────────────────────────────────────
// The whole point: this used to leave the engine only through the
// wet-processing card, so a merchandiser calculating a fabric never saw it.
const r = engine.calculate({
  fabric: 'single_jersey', gsm: 180, composition: '60% Cotton 40% Polyester',
  dia: 34, gauge: 24,
});
assert(r.fibre_advisory && r.fibre_advisory.ok, 'calculate() must carry the advisory');
assert(r.fibre_advisory.findings.length >= 3);
assert((r.formula_trace || []).some(t => t.action === 'fibre_advisory'),
  'and it must appear in the trace, so the reasoning is followable');

// ── Moisture: the two figures that were stored and never used ───────────
// Commercial regain is what yarn is TRADED at; measured regain is what the
// fabric holds. Cotton is 8.5% against 7.5%, so a shipment invoiced at the
// allowance is about 0.9% heavier than the same fibre conditioned in the store.
// Nothing was spilled and no process caused it, which is why it gets booked as
// waste and hides real waste of the same size.
const { moistureEconomics } = require('../engine/domain/yarn-engine');
const mc = moistureEconomics({ cotton: 100 });
assert.strictEqual(mc.commercial_allowance_pct, 8.5);
assert(mc.invoice_over_conditioned_pct > 0.8 && mc.invoice_over_conditioned_pct < 1.1,
  `cotton's invoice-vs-conditioned gap should be about 0.9%, got ${mc.invoice_over_conditioned_pct}`);
// Viscose's allowance sits at the middle of its measured band, so there is no
// gap at all — the rule must not invent one.
assert.strictEqual(moistureEconomics({ viscose: 100 }).invoice_over_conditioned_pct, 0);
// The book refuses to publish a single allowance for polyester ("1.5 or 3"), so
// none is averaged in.
assert.strictEqual(moistureEconomics({ polyester: 100 }), null,
  'a fibre with no published allowance must not get one by averaging');
const blendM = moistureEconomics({ cotton: 60, polyester: 40 });
assert.strictEqual(blendM.covered_pct, 60);
assert(blendM.unmeasured.includes('polyester'));

const cost = fibreAdvisory({ cotton: 100 }, sj).findings.find(f => f.topic === 'yarn costing');
assert(cost && /commercial allowance/.test(cost.claim));
assert(/booked as waste/.test(cost.mechanism), 'the finding must say why it hides');
// And on a blend it must not state the cotton figure as the fabric's.
const costBlend = fibreAdvisory({ cotton: 60, polyester: 40 }, sj)
  .findings.find(f => f.topic === 'yarn costing');
assert(/measured over only 60%/.test(costBlend.claim));

// Hysteresis scales with the fabric's own GSM, so it needs one to speak.
const gsmF = fibreAdvisory({ cotton: 100 }, sj).findings.find(f => f.topic === 'GSM measurement');
// Quoted in this fabric's own units: 180 g/m2 x 0.9% = 1.62 g/m2.
assert(gsmF, "a cotton fabric with a GSM should get the hysteresis note");
const grams = parseFloat((gsmF.claim.match(/about ([\d.]+) g\/m/) || [])[1]);
assert(Math.abs(grams - 180 * 0.9 / 100) < 0.01,
  `the effect must be scaled to this fabric's GSM, got ${grams}`);
assert(!fibreAdvisory({ cotton: 100 }, { fabricId: 'single_jersey', category: 'single_jersey' })
  .findings.some(f => f.topic === 'GSM measurement'),
  'with no GSM given there is nothing to scale, so it says nothing');

// ── Yield point: the tension past which a loop stops coming back ────────
const { yieldTension } = require('../engine/domain/yarn-engine');
// A blend yields where its WEAKEST fibre does. Once the cotton in a poly-cotton
// has passed its yield point that deformation is taken, whatever the polyester
// is still doing — so an average would put the ceiling above the point where
// damage has already begun.
const yc = yieldTension({ cotton: 60, polyester: 40 }, 30);
assert.strictEqual(yc.governed_by, 'cotton');
assert.strictEqual(yc.yield_stress_mn_tex, 9);
assert(yc.fibre_ceiling_cn > 17 && yc.fibre_ceiling_cn < 18,
  `9 mN/tex at 19.68 tex is 17.7 cN, got ${yc.fibre_ceiling_cn}`);
// Nylon yields fourteen times higher than cotton, so the same tension that
// ruins one is nothing to the other.
assert(yieldTension({ nylon: 100 }, 30).fibre_ceiling_cn >
       10 * yieldTension({ cotton: 100 }, 30).fibre_ceiling_cn);
// The ceiling scales with the count, because a stress is not a tension until
// there is a linear density to multiply it by.
assert(yieldTension({ cotton: 100 }, 20).fibre_ceiling_cn >
       yieldTension({ cotton: 100 }, 30).fibre_ceiling_cn,
  'a coarser yarn carries more force at the same stress');
assert.strictEqual(yieldTension({ cotton: 100 }, null), null,
  'with no count there is no tension to quote, and none is invented');
assert.strictEqual(yc.is_upper_bound, true);

// The claim must say it is an upper bound. A yarn is twisted, so only part of
// the fibre's strength reaches it; the book does not measure that translation,
// so no factor is applied and the limitation is stated instead of hidden.
const yf = fibreAdvisory({ cotton: 100 }, { ...sj, count_ne: 30 })
  .findings.find(f => /stops coming back/.test(f.claim));
assert(yf, 'a fabric with a count should get the yield-tension finding');
assert(/UPPER bound/.test(yf.claim), 'the claim itself must carry the bound');
assert(/translation/.test(yf.mechanism), 'and the mechanism must name the step it cannot measure');
assert(!fibreAdvisory({ cotton: 100 }, sj).findings.some(f => /stops coming back/.test(f.claim)),
  'without a count there is nothing to quote and it stays silent');

// ── The same fact must not appear on two cards ──────────────────────────
// The wet-processing card reports these from the process side. Printed twice
// and worded differently they read as a bug, and a reader is left wondering
// which number to believe. So they are handed over — and the handover is
// recorded, because a finding that vanishes silently is worse than a repeated
// one.
const withWet = fibreAdvisory({ viscose: 100 }, { ...sj, wet_card_present: true });
const without = fibreAdvisory({ viscose: 100 }, sj);
assert(without.findings.some(f => f.topic === 'wet processing'));
assert(!withWet.findings.some(f => f.topic === 'wet processing'));
assert(withWet.deferred_to_wet_processing.includes('wet processing'),
  'a deferred topic must be named, not silently dropped');
// Felting too — and a woven quality, which has no wet card, must still get it.
const woolWet = fibreAdvisory({ wool: 100 }, { ...il, wet_card_present: true });
assert(woolWet.deferred_to_wet_processing.includes('felting'));
assert(fibreAdvisory({ wool: 100 }, { fabricId: 'woven_plain_shirting', category: 'woven' })
  .findings.some(f => f.topic === 'felting'),
  'with no wet card the advisory must carry felting itself');
// Everything else stays put.
for (const t of ['pilling', 'handle', 'shape retention']) {
  assert(withWet.findings.some(f => f.topic === t) === without.findings.some(f => f.topic === t),
    `${t} is not a wet-card topic and must not move`);
}

// ── A loom is not a knitting machine ────────────────────────────────────
const wovenAdv = fibreAdvisory({ cotton: 100 },
  { fabricId: 'woven_plain_shirting', category: 'woven', count_ne: 40, gsm: 120 });
const wovenTension = wovenAdv.findings.find(f => /stops coming back/.test(f.claim));
assert.strictEqual(wovenTension.topic, 'yarn tension');
assert(!/cam|needle|loop length/.test(wovenTension.action),
  'woven advice must not talk about cams, needles or loop length');
const knitTension = fibreAdvisory({ cotton: 100 }, { ...sj, count_ne: 30 })
  .findings.find(f => /stops coming back/.test(f.claim));
assert.strictEqual(knitTension.topic, 'knitting tension');
assert(/cam/.test(knitTension.action));

// A woven structure holds the yarn far more tightly than a loop does, so the
// same fibre must not be given the same shape-retention verdict in both.
assert(bagOf(wovenAdv).claim !== bagOf(fibreAdvisory({ cotton: 100 }, sj)).claim);

// ── The weak link, and the dead index that hid it ───────────────────────
// weakLinkSensitivity takes ONE fibre key, not a blend map. It was being called
// with the map, so it returned null for every fabric — the index was present in
// the output, permanently empty, and nothing said so. This asserts it is alive.
const wl = fibreAdvisory({ cotton: 100 }, sj).indices.weak_link;
assert(wl && wl.governed_by === 'cotton', 'the weak-link index must not be null');
assert.strictEqual(wl.gain_to_0_1mm_pct, 90);

// Cotton gains 90% when tested too short to contain a flaw; nylon gains 15%.
// So cotton's strength is its weak points and nylon's is its substance, and
// only one of them should be warned about mechanical damage in preparation.
assert(fibreAdvisory({ cotton: 100 }, sj)
  .findings.some(f => f.topic === 'fibre damage sensitivity'));
assert(!fibreAdvisory({ nylon: 100 }, sj)
  .findings.some(f => f.topic === 'fibre damage sensitivity'),
  'nylon gains only 15% and must not be told its strength is flaw-governed');
// A blend is governed by its MOST sensitive component, not the average.
assert.strictEqual(fibreAdvisory({ cotton: 60, polyester: 40 }, sj)
  .indices.weak_link.governed_by, 'cotton');

// ── Heat: the ceiling belongs to the LOWEST melting fibre ───────────────
const { heatCeiling } = require('../engine/domain/yarn-engine');
// A blend cannot be set above its lowest melting point, whatever the majority
// fibre would tolerate. Polypropylene at 170 stops a fabric being set where its
// polyester would want to be.
const pp = heatCeiling({ polyester: 60, polypropylene: 40 });
assert.strictEqual(pp.lowest_melting.fibre, 'polypropylene');
assert(pp.working_ceiling_c < heatCeiling({ polyester: 100 }).working_ceiling_c - 50,
  'the minority fibre lowers the ceiling for the whole blend');
// The margin below the melt is a mill convention, and the output says so rather
// than presenting it as measured.
assert.strictEqual(pp.working_ceiling_is_convention, true);
const heatF = fibreAdvisory({ polyester: 60, polypropylene: 40 }, sj)
  .findings.find(f => f.topic === 'temperature ceiling');
assert(/convention/.test(heatF.confidence),
  'the working margin must be labelled a convention, not a measurement');

// Cellulosics and proteins decompose rather than melt, so they must not have
// acquired a melting point — and the blend must say they ENDURE the setting
// temperature rather than sharing it.
const cvc = heatCeiling({ cotton: 60, polyester: 40 });
assert(cvc.non_melting.includes('cotton'));
assert.strictEqual(FIBER_PROPERTIES.cotton.heat.melting_c, null);
assert(/ENDURED/.test(fibreAdvisory({ cotton: 60, polyester: 40 }, sj)
  .findings.find(f => f.topic === 'temperature ceiling').mechanism));

// And the slow damage below the ceiling, which is the more useful question.
assert.strictEqual(cvc.most_heat_damaged.fibre, 'cotton');
assert.strictEqual(cvc.most_heat_damaged.retained_130c_80d, 10);
assert(fibreAdvisory({ cotton: 100 }, sj).findings.some(f => f.topic === 'heat ageing'));
assert(!fibreAdvisory({ polyester: 100 }, sj).findings.some(f => f.topic === 'heat ageing'),
  'polyester keeps 75% over the same eighty days and must not be flagged');

// ── The dryer, the fold, and warmth when damp ───────────────────────────
const { dryingLoad, flexFatigue } = require('../engine/domain/yarn-engine');
// Liquid water, not vapour: what the hydro-extractor leaves for the dryer to
// evaporate. Viscose delivers more than twice cotton's water on the same
// machine at the same setting.
const dl = dryingLoad({ viscose: 100 });
assert.strictEqual(dl.water_after_extraction_pct.value, 103);
assert(dl.vs_cotton > 2, `viscose should carry over twice cotton's water, got ${dl.vs_cotton}`);
// Wool's water sits between the fibres, not inside them, so force removes it
// where pressure cannot — and that gap is named rather than averaged away.
assert(dryingLoad({ wool: 100 }).force_sensitive.some(x => /wool/.test(x)));
assert.strictEqual(dryingLoad({ cotton: 100 }).force_sensitive.length, 0,
  "cotton's water is inside the fibre, so suction and spinning agree");

// A fold fails where its weakest fibres fail, so the blend takes the lowest.
assert.strictEqual(flexFatigue({ nylon6: 100 }), null,
  'nylon 6 is not an engine fibre, so there is nothing to report');
assert.strictEqual(flexFatigue({ nylon: 100 }).cycles, 104807);
assert.strictEqual(flexFatigue({ nylon: 50, polyester: 50 }).governed_by, 'nylon',
  'the fold is governed by the fibre that fails first, not the average');
// The thousands space, guarded at the engine as well as the extractor: a
// fatigue life under a thousand means "35 825" was read as 35.
for (const [k, row] of Object.entries(FIBER_PROPERTIES)) {
  const c = (row.moisture_energy || {}).flex_life_cycles;
  if (c != null) assert(c >= 1000, `${k}: ${c} cycles means the thousands space was lost`);
}

// Two different things must not share one heading: conduction is not the same
// as the heat released while taking water up, and printing both under "thermal
// comfort" made one look like a repeat of the other.
const woolAdv = fibreAdvisory({ wool: 100 }, sj);
const topics = woolAdv.findings.map(f => f.topic);
assert(topics.includes('thermal comfort') && topics.includes('warmth when damp'));
assert.strictEqual(new Set(topics).size, topics.length,
  'no two findings on one fabric may share a topic');

// ============================================================================
// The eight findings that came out of the columns that had been stored and
// never shipped.
// ============================================================================

const {
  fibreAnisotropy, curveShape, molecularOrientation, jointStrength,
  stretchResistance, humidityLeverage, wetJamming,
} = require('../engine/domain/yarn-engine');

// ── Anisotropy: the ratio, not the two moduli ──────────────────────────────
{
  const a = fibreAnisotropy({ polypropylene: 100 });
  assert(a.worst_ratio > 2.6 && a.worst_ratio < 4,
    `polypropylene should sit just above isotropic, got ${a.worst_ratio}`);
  const n = fibreAnisotropy({ nylon: 100 });
  assert(n.worst_ratio > a.worst_ratio,
    'nylon has the lowest shear modulus in the book and must come out more anisotropic ' +
    'than polypropylene');
  // The printed RANGE matters more than the mid-point here: Table 17.2 gives
  // nylon three types, and across them the ratio spans a factor of twenty-five.
  // Reporting only the mid-point would hide that these are different fibres
  // sold under one name.
  assert(n.worst_ratio_span && n.worst_ratio_span[1] / n.worst_ratio_span[0] > 10,
    'the nylon ratio span should be wide enough to be worth printing');

  // Cotton has no shear modulus in the book. It must be NAMED as uncomputable
  // rather than dropped, or a poly-cotton reads as if cotton had been included.
  const pc = fibreAnisotropy({ cotton: 60, polyester: 40 });
  assert(pc.no_shear_modulus.includes('cotton'),
    'cotton has no shear modulus printed and the absence must be reported');
  assert.strictEqual(pc.from_pct, 40,
    'the ratio is computed over the polyester only, and must say so');
}

// ── The claim that had to be narrowed ──────────────────────────────────────
// The first version of the transverse-weakness finding claimed FIBRILLATION,
// and polyester satisfied both numerical conditions — E/G of 7.3 and a bending
// modulus above its tensile modulus. Polyester does not fibrillate. The numbers
// were right and the conclusion drawn from them was wrong, which is exactly the
// failure this module exists to prevent, so the finding must not predict
// fibrillation from moduli alone.
{
  const f = fibreAdvisory({ polyester: 100 }, sj).findings
    .find(x => x.topic === 'transverse weakness');
  assert(f, 'polyester should still get the transverse-weakness finding');
  assert(!/fibrillat/i.test(f.claim),
    'the CLAIM must not say fibrillation — the moduli do not establish it');
  assert(/fibrillation/i.test(f.mechanism) && /does not measure/i.test(f.mechanism),
    'the mechanism must name fibrillation only to say where the measurement stops');
}

// ── Work factor: the shape of the curve, checked against the yield point ───
{
  const cotton = curveShape({ cotton: 100 });
  const wool = curveShape({ wool: 100 });
  assert(cotton.work_factor < 0.5 && wool.work_factor > 0.6,
    'cotton stiffens late and wool yields early — the two ends of Table 13.1');
  // The work factor and the yield point are the same fact measured twice, so
  // they must agree: the fibre that yields earlier is the one with the higher
  // work factor. If they ever disagree, one of them has been typed wrong.
  const yp = k => FIBER_PROPERTIES[k].yield_point.strain_pct;
  assert((wool.work_factor > cotton.work_factor) === (yp('wool') > yp('cotton')),
    'work factor and yield strain must rank the same two fibres the same way');
}

// ── Orientation: the pair that splits a shade ──────────────────────────────
{
  const o = molecularOrientation({ cotton: 50, viscose: 50 });
  assert(o.dye_rate_split,
    'cotton at 0.046 and viscose at 0.020 are the textbook two-shade blend');
  assert.strictEqual(o.least_oriented.fibre, 'viscose',
    'regenerated cellulose is LESS oriented than native, which is why it dyes deeper');
  // Polyester is three times anything else and that is what forces disperse
  // dyeing; a finding that did not reach that conclusion would be reciting.
  const pes = fibreAdvisory({ polyester: 100 }, sj).findings.find(x => x.topic === 'dye uptake');
  assert(/130 C|carrier/.test(pes.action),
    'the polyester dye finding must reach disperse dyeing, not just report a number');
}

// ── The join: two failures that look identical in a broken package ─────────
{
  const j = jointStrength({ viscose: 100 });
  assert(j.bend_sensitive.length === 1 && j.bend_sensitive[0].fibre === 'viscose',
    'viscose keeps 90% in a knot and 58% in a loop — bend radius, not grip');
  // Nylon is close on both, so it must NOT be flagged; a rule that fired for
  // every fibre with both numbers would be reciting the table.
  assert(jointStrength({ nylon: 100 }).bend_sensitive.length === 0,
    'nylon loses little either way and must not be flagged');
}

// ── Stretch resistance: stiffness and recovery are independent ─────────────
{
  const v = stretchResistance({ viscose: 100 });
  const n = stretchResistance({ nylon: 100 });
  assert.strictEqual(v.stress_for_2pct_mn_tex, n.stress_for_2pct_mn_tex,
    'viscose and nylon need the SAME 51 mN/tex to hold 2%');
  assert(FIBER_PROPERTIES.viscose.cyclic.growth_10 >
         FIBER_PROPERTIES.nylon.cyclic.growth_10 * 5,
    'and viscose still grows several times as much — equal stiffness, unequal recovery');
  // Every fibre with both columns work-hardens. A fibre that got easier to
  // stretch with cycling would mean the columns had been crossed.
  for (const h of stretchResistance({ wool: 100 }).work_hardening) {
    assert(h.rise_pct > 0, `${h.fibre} must need MORE stress by cycle 1000, not less`);
  }
}

// ── Humidification: only where there is a static problem to spend on ───────
{
  // Wool's threshold is 55% r.h.; on a floor at 40% it is at risk, so the
  // question "what will humidifying buy" is live.
  const atRisk = fibreAdvisory({ wool: 100 }, { ...sj, floor_rh: 40 }).findings
    .map(f => f.topic);
  assert(atRisk.includes('humidification'), 'a floor below the threshold should get the lever');
  // At 70% there is no problem, and costing a fix for a problem nobody has is
  // noise dressed as rigour.
  const safe = fibreAdvisory({ wool: 100 }, { ...sj, floor_rh: 70 }).findings
    .map(f => f.topic);
  assert(!safe.includes('humidification'),
    'with the floor above the threshold there is nothing to buy');
  const h = humidityLeverage({ silk: 100 });
  assert(h.slope > humidityLeverage({ linen: 100 }).slope,
    'humidity is a stronger lever on silk (17.6) than on flax (10.6)');
}

// ── Wet jamming: the same swelling, two constructions ──────────────────────
{
  const plain = wetJamming({ viscose: 100 }, { cover_factor: 25, cover_ceiling: 28 });
  const satin = wetJamming({ viscose: 100 }, { cover_factor: 25, cover_ceiling: 48 });
  assert.strictEqual(plain.cover_factor_wet, satin.cover_factor_wet,
    'the fibre swells by the same amount in both');
  assert(plain.jams_when_wet && !satin.jams_when_wet,
    'and only the plain weave runs out of room — the ceiling belongs to the cloth');
  // Nylon gains 2% on diameter. Firing this finding on nylon would be reciting.
  assert(!fibreAdvisory({ nylon: 100 }, sj).findings.some(f => f.topic === 'wet jamming'),
    'nylon gains 2% on diameter and must not get a swelling warning');
}

// ── The scatter that a mean lifetime hides ─────────────────────────────────
{
  const f = fibreAdvisory({ polyester: 100 }, sj).findings.find(x => x.topic === 'flex fatigue');
  assert(/Design to/.test(f.action) && /44%/.test(f.action),
    'a mean fatigue life must not be printed without its scatter');
}

// ── No two findings may share a heading, on ANY fabric ─────────────────────
// The first version of this checked wool alone, and wool fires neither wet
// branch — so a cotton-elastane rib printed two different findings under "wet
// processing" for as long as that card has existed.
for (const [name, fib, ctx] of [
  ['60/40 poly-cotton single jersey', { cotton: 60, polyester: 40 }, sj],
  ['95/5 cotton-elastane rib', { cotton: 95, elastane: 5 },
   { category: 'rib', gsm: 220, has_elastane: true, elastane_pct: 5 }],
  ['100% viscose woven', { viscose: 100 },
   { category: 'woven', gsm: 140, cover_factor: 25, cover_ceiling: 28, floor_rh: 40 }],
  ['100% wool interlock', { wool: 100 }, { category: 'interlock', gsm: 280, floor_rh: 40 }],
  ['50/50 cotton-modal single jersey', { cotton: 50, modal: 50 }, sj],
]) {
  const t = fibreAdvisory(fib, ctx).findings.map(f => f.topic);
  assert.strictEqual(new Set(t).size, t.length,
    `${name}: two findings share a heading — ${t.filter((x, i) => t.indexOf(x) !== i)}`);
}

// ── Wet toughness: the column that resolves a contradiction ────────────────
{
  const { wetToughness } = require('../engine/domain/yarn-engine');
  // Polyester's wet ratio is exactly 1.00 — water does nothing. Crossing 1.00
  // downward in the hot bath is not the same as toughening and then losing it,
  // and the first draft of this called polyester a reversal.
  assert.strictEqual(wetToughness({ polyester: 100 }).reverses.length, 0,
    'a ratio of exactly 1.00 is water doing nothing, not a gain to be lost');
  const silk = wetToughness({ silk: 100 });
  assert(silk.reverses.length === 1 && silk.reverses[0].at_20c > 1 &&
         silk.reverses[0].at_95c < 1,
    'silk toughens 31% wet at 20 C and loses it again at 95 C — the real reversal');

  // Cotton is the case that makes the column necessary: the engine has printed
  // "11% STRONGER wet" for months, and on its own that reads as good news.
  const c = fibreAdvisory({ cotton: 100 }, sj).findings;
  const wt = c.find(f => f.topic === 'wet toughness');
  const ws = c.find(f => f.topic === 'wet strength');
  assert(wt && ws, 'cotton must get both, because both are true');
  assert(/STRONGER wet, and both are true/.test(wt.claim),
    'and the toughness finding must reconcile them rather than contradict the other card');
  assert(wetToughness({ wool: 100 }).wet_ratio < wetToughness({ cotton: 100 }).wet_ratio,
    'wool loses a third of its toughness wet and cotton loses 8%');
}

// ── Every finding must have a home on the page ─────────────────────────────
// A new finding whose topic is missing from the theme map falls to "Other" and
// prints at the bottom under a heading that says nothing. That is easy to miss
// in review and hard to notice on the page, so it fails here instead.
{
  const homeless = new Set();
  for (const [fib, ctx] of [
    [{ cotton: 60, polyester: 40 }, sj],
    [{ cotton: 95, elastane: 5 }, { category: 'rib', gsm: 220, has_elastane: true, elastane_pct: 5 }],
    [{ viscose: 100 }, { category: 'woven', gsm: 140, cover_factor: 25, cover_ceiling: 28, floor_rh: 40 }],
    [{ wool: 100 }, { category: 'interlock', gsm: 280, floor_rh: 40 }],
    [{ silk: 100 }, sj], [{ nylon: 100 }, sj], [{ acrylic: 100 }, sj], [{ linen: 100 }, sj],
  ]) {
    for (const f of fibreAdvisory(fib, ctx).findings) {
      if (f.theme === 'Other') homeless.add(f.topic);
    }
  }
  assert.strictEqual(homeless.size, 0,
    `these topics have no theme and would print under "Other": ${[...homeless].join(', ')}`);
}

console.log(`  ${fibreAdvisory({ cotton: 60, polyester: 40 }, sj).findings.length} findings on a 60/40 CVC single jersey`);
console.log(`  ${fibreAdvisory({ viscose: 100 }, sj).findings.length} on a viscose single jersey`);
console.log('\n✓ All fibre advisory tests passed.');
