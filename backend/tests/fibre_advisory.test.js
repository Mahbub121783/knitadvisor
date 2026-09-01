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
// Modal has a density and a regain, so a fibre-level coverage check calls it
// "measured" and then every rule quietly declines to fire — handing back an
// empty, clean-looking report about a fabric nothing is known about. That is
// the most dangerous output this module could produce.
const modal = fibreAdvisory({ modal: 100 }, sj);
assert(modal.ok);
assert.strictEqual(modal.coverage.measured_pct, 0);
assert.strictEqual(modal.findings.length, 0);
assert(modal.not_known.length, 'a fabric with no measurements must say so');
assert(/no measured fibre properties/i.test(modal.headline),
  'the headline itself must carry the ignorance, not just a footnote');

// ── A half-known number must never be stated flatly ─────────────────────
const half = fibreAdvisory({ cotton: 50, modal: 50 }, sj);
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

// ── Findings are ordered worst-first ────────────────────────────────────
for (const fibers of [{ viscose: 100 }, { cotton: 60, polyester: 40 }, { wool: 100 }]) {
  const order = { severe: 0, high: 1, moderate: 2, info: 3 };
  const sev = fibreAdvisory(fibers, sj).findings.map(f => order[f.severity]);
  for (let i = 1; i < sev.length; i++) assert(sev[i] >= sev[i - 1], 'findings must be worst-first');
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

console.log(`  ${fibreAdvisory({ cotton: 60, polyester: 40 }, sj).findings.length} findings on a 60/40 CVC single jersey`);
console.log(`  ${fibreAdvisory({ viscose: 100 }, sj).findings.length} on a viscose single jersey`);
console.log('\n✓ All fibre advisory tests passed.');
