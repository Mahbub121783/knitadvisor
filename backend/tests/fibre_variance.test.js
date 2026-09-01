const assert = require('assert');
const engine = require('../engine');

console.log('--- Running Fibre Advisory Variance Tests ---');

// ============================================================================
// IS IT READING THE FABRIC, OR RECITING THE FIBRE?
//
// This suite exists because the answer used to be "reciting". Run over 360
// fabrics — eight compositions x five structures x three weights x three
// counts — twenty-four of twenty-seven topics printed a sentence that did not
// change when the structure, the GSM or the count changed, and six printed one
// sentence whatever was asked. The engine had computed a tightness factor and
// a stitch length at step 3.6 and handed the advisory neither.
//
// Half the fix was to pass them. The other half was to admit that some topics
// genuinely ARE fibre facts — polyester melts at 260 C in a jersey and in a
// fleece — and to label those rather than print them under a heading claiming
// the engine had looked at the fabric.
//
// So the contract has two directions, and both are enforced here:
//   scope 'fabric'  MUST change when the fabric changes
//   scope 'fibre'   MUST NOT — if it does, it was mislabelled
// ============================================================================

const base = { composition: '60% Cotton 40% Polyester', dia: 34, gauge: 24,
               color_shade: 'dark_navy' };
const adv = (o) => engine.calculate({ ...base, ...o }).fibre_advisory;
const text = f => `${f.claim} || ${f.mechanism} || ${f.action}`;
const byTopic = a => new Map(a.findings.map(f => [f.topic, f]));

// Same blend, same count. Only the cloth differs: a light slack jersey against
// a heavy interlock. Anything that claims to be about the fabric has to notice.
const light = byTopic(adv({ fabric: 'single_jersey', gsm: 120 }));
const heavy = byTopic(adv({ fabric: 'interlock', gsm: 260 }));
const shared = [...light.keys()].filter(t => heavy.has(t));

assert(shared.length >= 15, `only ${shared.length} topics fired on both fabrics`);

const frozen = [];
const moved = [];
for (const t of shared) {
  (text(light.get(t)) === text(heavy.get(t)) ? frozen : moved).push(t);
}

// ── Direction 1: a 'fabric' finding that never moves is mislabelled ────────
for (const t of frozen) {
  assert.strictEqual(light.get(t).scope, 'fibre',
    `"${t}" is declared scope '${light.get(t).scope}' but prints the identical paragraph on a ` +
    '120 g/m2 single jersey and a 260 g/m2 interlock. Either give it the cloth\'s numbers or ' +
    'add it to BLEND_SCOPE_TOPICS — printing a fibre constant under a heading that says ' +
    '"this fabric" is how a reader learns the page is not reading their input.');
}

// ── Direction 2: a 'fibre' finding that moves is also mislabelled ──────────
for (const t of moved) {
  assert.strictEqual(light.get(t).scope, 'fabric',
    `"${t}" is declared scope 'fibre' but its text changed between two fabrics — it is not a ` +
    'blend constant and must not be filed as reference material');
}

// ── The cloth actually reaches the findings that need it ──────────────────
// Named individually, because these are the ones whose whole value is that
// they know the structure. A regression here is silent: the sentence still
// reads well, it just stops being about the reader's fabric.
for (const t of ['pilling', 'knit strength', 'spirality', 'wet jamming']) {
  if (!light.has(t) || !heavy.has(t)) continue;
  assert(text(light.get(t)) !== text(heavy.get(t)),
    `"${t}" must respond to the structure — it is the reason the tightness factor is passed in`);
  assert(/TF \d/.test(text(light.get(t))),
    `"${t}" should state the tightness factor it reasoned from, so the reader can check it`);
}

// ── Blend strength must respond to the RATIO ──────────────────────────────
// A 60/40 CVC and a 35/65 PC used to be handed the same sentence. They are not
// the same fabric: one breaks when its cotton does, the other is already being
// carried by its polyester.
{
  const sj = { fabric: 'single_jersey', gsm: 180 };
  const cvc = byTopic(adv({ ...sj, composition: '60% Cotton 40% Polyester' })).get('blend strength');
  const pc = byTopic(adv({ ...sj, composition: '35% Cotton 65% Polyester' })).get('blend strength');
  assert(cvc && pc, 'blend strength must fire on both CVC and PC');
  assert.notStrictEqual(cvc.claim, pc.claim,
    'a 40% polyester blend and a 65% polyester blend do not have the same strength story');
  assert(/40% polyester/.test(cvc.claim) && /65% polyester/.test(pc.claim),
    'the claim must name the ratio it was computed at');

  // Hamburger's model: the crossover is the WEAKEST mix of two fibres, so the
  // shortfall against the mass average has to peak near it rather than rising
  // or falling monotonically with the ratio. If it ever goes monotonic the
  // model has been replaced by an interpolation.
  const shortfall = pct => {
    const f = byTopic(adv({ ...sj, composition: `${100 - pct}% Cotton ${pct}% Polyester` }))
      .get('blend strength');
    const m = f && f.claim.match(/([\d.]+)% short/);
    return m ? parseFloat(m[1]) : null;
  };
  const [a20, a55, a90] = [20, 55, 90].map(shortfall);
  assert(a20 != null && a55 != null && a90 != null, 'the shortfall must be stated at every ratio');
  assert(a55 > a20 && a55 > a90,
    `the weakest mix must be in the middle, not at an end — got ${a20}% / ${a55}% / ${a90}%`);
}

// ── The drying load is a dyehouse quantity, not a percentage ──────────────
{
  const l = byTopic(adv({ fabric: 'single_jersey', gsm: 120 })).get('drying load');
  const h = byTopic(adv({ fabric: 'single_jersey', gsm: 260 })).get('drying load');
  if (l && h) {
    const grams = f => { const m = f.claim.match(/about (\d+) g of/); return m ? +m[1] : null; };
    assert(grams(l) && grams(h) && grams(h) > grams(l),
      'a heavier fabric carries more water per square metre, and the claim must say so');
  }
}

// ── A caller with no structure gets the fibre statement, not invented detail ─
// The woven engine calls in with a composition and nothing else. It must not
// produce a sentence quoting a tightness factor that was never supplied.
{
  const { fibreAdvisory } = require('../engine/domain/fibre-advisory');
  const bare = fibreAdvisory({ cotton: 100 }, { fabricId: 'single_jersey', category: 'single_jersey' });
  assert(bare.ok);
  for (const f of bare.findings) {
    assert(!/TF (undefined|null|NaN)/.test(text(f)),
      `"${f.topic}" printed a tightness factor it was never given`);
  }
}

console.log(`  ${shared.length} topics fire on both fabrics: ${moved.length} move with the ` +
            `cloth, ${frozen.length} are blend constants and say so`);
console.log('\nAll fibre advisory variance tests passed.');
