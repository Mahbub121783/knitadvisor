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
  if (f.topic === 'lustre') continue;          // an option, not a measurement of this cloth
  assert(/measured over only 50% of the blend/.test(f.claim),
    `${f.topic}: a claim computed from half a blend must say so in the CLAIM, not a footnote`);
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

console.log(`  ${fibreAdvisory({ cotton: 60, polyester: 40 }, sj).findings.length} findings on a 60/40 CVC single jersey`);
console.log(`  ${fibreAdvisory({ viscose: 100 }, sj).findings.length} on a viscose single jersey`);
console.log('\n✓ All fibre advisory tests passed.');
