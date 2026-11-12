// Fabric identification: knitted or woven, the weave and its threads, read off photographed synthetic cloth;
// the family evidence; and the woven reverse engine that turns the reading into a construction.
//
// What is asserted is what the reader does reliably on these swatches. The woven reader's weak spots are
// known and left un-asserted on purpose (and said here so nobody mistakes them for passing cases):
//   - 2/2 against 3/1 on a plain-coloured 4-thread twill: the lattice (repeat 4, the hand) is right, the
//     warp share of the crossings is not always;
//   - oxford (ends in pairs) reads as plain at half the ends;
//   - a 5-end satin at 44 ends/cm and 13-15 px/mm is at the edge of resolution and reads as a 3-twill;
//   - the drawn knitted swatches show no loop legs (their V legs merge at this scale), so the leg test,
//     which carries the decision on real knitted photos, does not fire on most of them.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const FE = path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'scan');
const KS = require(path.join(FE, 'fabric-scan-core.js'));
const SY = require(path.join(FE, 'fabric-scan-synth.js'));
const WR = require('../engine/domain/woven-reverse');
console.log('--- Running Fabric Identification Tests ---');

const W = SY.WEAVES;
const near = (a, b, tol, what) => assert(Math.abs(a / b - 1) <= tol, `${what}: ${a.toFixed(3)} vs ${b} (±${tol * 100}%)`);
const free = (o, P = 15) => {
  const p = SY.photo({ KAScan: KS, seed: 5, pxPerMm: P, width: 1100, height: 900, uncut: true, cardY: -3, blur: 1, noise: 0.025, light: 0.25, colour: [205, 200, 195], ...o }, KS.CARD);
  return KS.analyseFree(p.rgba, p.w, p.h, { pxPerMm: P, source: 'test' });
};

// ── the weave lattice: plain and twills, both hands, straight and turned ─────
{
  for (const ang of [0, 12]) {
    const r = free({ weave: W.plain, epc: 30, ppc: 28, angle: ang });
    assert(r.woven && r.woven.ok, 'plain: a woven reading');
    assert.strictEqual(r.woven.weave.cls, 'plain', `plain at ${ang}°: read ${r.woven.weave.name}`);
    near(r.woven.ends_per_cm, 30, 0.06, `plain ends at ${ang}°`); near(r.woven.picks_per_cm, 28, 0.12, `plain picks at ${ang}°`);
    assert(Math.abs(r.woven.axes_deg - ang) < 4.5, `plain axes ${r.woven.axes_deg} at ${ang}°`);
    assert.deepStrictEqual(r.woven.matrix.map((row) => row.join('')).sort(), ['01', '10'], 'plain diagram is a checkerboard');

    const t = free({ weave: W.twill21, epc: 30, ppc: 22, angle: ang });
    assert.strictEqual(t.woven.weave.cls, 'twill', `2/1 twill at ${ang}°: read ${t.woven.weave.name}`);
    assert.strictEqual(t.woven.weave.repeat, 3, '2/1 twill repeats on 3 threads');
    assert.strictEqual(t.woven.weave.hand, 'LH', '2/1 twill as drawn rises to the left');
    assert.strictEqual(t.woven.weave.notation, '2/1', `2/1 twill notation at ${ang}°: ${t.woven.weave.notation}`);
    near(t.woven.ends_per_cm, 30, 0.06, `twill ends at ${ang}°`);
    // every row of the diagram is the row above moved by one end
    const M = t.woven.matrix;
    for (let j = 1; j < M.length; j++) {
      const a = M[j - 1].join(''), b = M[j].join('');
      assert(b === a.slice(1) + a[0] || b === a.slice(-1) + a.slice(0, -1), 'a twill diagram steps one end per pick');
    }
  }
  // a 4-thread twill: the lattice and hand are read whatever the notation
  for (const [w, hand] of [[W.twill31L, 'LH'], [W.twill22, 'LH']]) {
    const r = free({ weave: w, epc: 27, ppc: 18, angle: 12 });
    assert.strictEqual(r.woven.weave.cls, 'twill'); assert.strictEqual(r.woven.weave.repeat, 4, 'a 4-thread twill'); assert.strictEqual(r.woven.weave.hand, hand);
  }
  // basket and sateen
  const b = free({ weave: W.basket22, epc: 24, ppc: 22, angle: 12 });
  assert.strictEqual(b.woven.weave.cls, 'basket', 'basket: ' + b.woven.weave.name);
  const s = free({ weave: W.sateen5, epc: 30, ppc: 40, angle: 0 });
  assert.strictEqual(s.woven.weave.cls, 'satin', 'sateen: ' + s.woven.weave.name); assert.strictEqual(s.woven.weave.face, 'weft', 'sateen shows the weft');
  console.log('✓ weave lattice, hand, notation and thread counts');
}

// ── denim: indigo ends over white picks — the colours read the crossings, the family is not in doubt ─────
{
  const r = free({ weave: W.twill31, epc: 28, ppc: 17, angle: 12, warpColour: [40, 60, 120], weftColour: [225, 225, 215] });
  assert(KS.yarnColours(r.two_tone), 'two yarn colours seen');
  assert.strictEqual(r.woven.read_by, 'colour', 'crossings read by colour');
  assert.strictEqual(r.woven.weave.notation, '3/1'); assert.strictEqual(r.woven.weave.hand, 'RH', 'denim is a right-hand twill');
  assert.strictEqual(r.woven.weave.face, 'warp');
  near(r.woven.ends_per_cm, 28, 0.05, 'denim ends');
  assert.strictEqual(r.identity.family, 'woven'); assert(r.identity.denim_like, 'denim recognised');
  assert.strictEqual(r.identity.best.category, 'Denim');
  // one colour shaded is not two yarn colours
  assert(!KS.yarnColours({ two_tone: true, dark: { chroma: 20, hue: 30 }, light: { chroma: 42, hue: 34 } }), 'shade on one red is one colour');
  assert(KS.yarnColours({ two_tone: true, dark: { chroma: 26, hue: 265 }, light: { chroma: 4, hue: 90 } }), 'indigo beside white is two');
  console.log('✓ denim: colour reading, 3/1 RH, warp face, family');
}

// ── the family: woven cloth is called woven; a clearly woven photo skips the knit reader's angle search ─────
{
  for (const [o, ang] of [[{ weave: W.plain, epc: 30, ppc: 28 }, 0], [{ weave: W.twill21, epc: 30, ppc: 22 }, 0], [{ weave: W.twill22, epc: 26, ppc: 24 }, 12], [{ weave: W.basket22, epc: 24, ppc: 22 }, 12]]) {
    // 15 px/mm is what a phone gives at 10 cm (a 2400 px photo); at 13 px/mm a 30-end 2/1 twill (4.3 px per end)
    // aliases into a false leg pattern — a known limit, not asserted
    const r = free({ ...o, angle: ang }, 15);
    assert.strictEqual(r.identity.family, 'woven', `woven called ${r.identity.family} (p ${r.identity.p_woven})`);
    assert(r.identity.evidence.length >= 3 && r.identity.evidence.every((e) => e.why && e.weight >= 0), 'every family item has a reason');
  }
  // the knitted swatches keep their loop count: the fast woven path does not take them
  const knits = [['single_jersey', 14, 19], ['rib', 11, 16], ['interlock', 18, 24], ['pique', 13, 20]];
  for (const [st, wpc, cpc] of knits) {
    const p = SY.photo({ KAScan: KS, structure: st, wpc, cpc, seed: 5, pxPerMm: 13, width: 900, height: 800, uncut: true, cardY: -3, blur: 1, noise: 0.03, light: 0.3 }, KS.CARD);
    const r = KS.analyseFree(p.rgba, p.w, p.h, { pxPerMm: 13, source: 'test' });
    assert(r.lattice && r.features, `${st}: the knit reading is complete`);
    assert(r.identity.p_woven < 0.85, `${st}: not taken as clearly woven (${r.identity.p_woven})`);
    if (st !== 'pique') near(r.wpc, wpc, 0.1, st + ' wales');   // (the tuck swatch reads two wales as one with or without this change)
  }
  // loop legs, where they show (the tuck swatch), are decisive
  const pq = SY.photo({ KAScan: KS, structure: 'pique', wpc: 13, cpc: 20, seed: 5, pxPerMm: 13, width: 900, height: 800, uncut: true, cardY: -3, blur: 1, noise: 0.03, light: 0.3 }, KS.CARD);
  const rp = KS.analyseFree(pq.rgba, pq.w, pq.h, { pxPerMm: 13, source: 'test' });
  assert(rp.legs && rp.legs.legs, 'pique: loop legs seen'); assert.strictEqual(rp.identity.family, 'knit');
  // a blank surface: no legs, no lattice, no family claim beyond "not read"
  const flat = new Uint8ClampedArray(900 * 900 * 4).fill(150);
  const fr = KS.analyseFree(flat, 900, 900, { pxPerMm: 9 });
  assert(fr.error || fr.kind.kind === 'none', 'a blank surface is not read as a fabric');
  console.log('✓ family: wovens called woven, knits keep their count, legs decide');
}

// ── the identity arithmetic itself ─────
{
  const wv = { ok: true, confidence: 'high', ends_per_cm: 40, picks_per_cm: 26, weave: { cls: 'plain', name: 'Plain weave 1/1', score: 9, runner_up: { id: 'twill3R', score: 4 } } };
  const legs = { line: 0.12, amp: 0.15, score: 0.15, legs: true, none: false };
  const a = KS.identify({ kind: { kind: 'knit' }, woven: wv, legs, knit_read: { ok: true, regularity: 0.6, ratio: 1.3 }, knit_suggest: [{ structure: 'single_jersey', p: 0.8, why: 'x' }, { structure: 'rib', p: 0.2, why: 'y' }] });
  assert.strictEqual(a.family, 'knit', 'loop legs outweigh a thread lattice');
  assert.strictEqual(a.best.family, 'knit'); assert.strictEqual(a.best.category, 'Single jersey');
  const b = KS.identify({ kind: { kind: 'woven' }, woven: wv, legs: { line: 0.01, amp: 0.01, score: 0.004, legs: false }, knit_read: { ok: true, regularity: 0.5, ratio: 0.9 }, knit_suggest: [] });
  assert.strictEqual(b.family, 'woven'); assert.strictEqual(b.best.category, 'Poplin / shirting', 'a fine plain weave is a shirting');
  const sum = b.candidates.reduce((t, c) => t + c.p, 0);
  assert(Math.abs(sum - 1) < 0.02, 'candidate probabilities add to one: ' + sum);
  assert(Math.abs(b.p_woven + b.p_knit - 1) < 1e-6);
  console.log('✓ identity: evidence adds as log-odds, best follows the family');
}

// ── the woven reverse engine ─────
{
  const denim = { weave: { cls: 'twill', repeat: 4, notation: '3/1', hand: 'RH', name: '3/1 twill, RH' }, ends_per_cm: 28, picks_per_cm: 17, denim: true };
  const e = WR.reverse(denim);
  assert.strictEqual(e.quality.id, 'woven_denim');
  assert.strictEqual(e.counts.warp.source, 'ESTIMATED');
  near(e.measured.epi, 71.1, 0.01, 'EPI from ends/cm');
  // the estimate keeps the standard denim's warp cover factor: 56 ends of 8s -> K = 19.8
  near(e.measured.epi / Math.sqrt(e.counts.warp.ne), 56 / Math.sqrt(8), 0.02, 'warp cover carried over');
  const g = WR.reverse({ ...denim, gsm: 400 });
  assert.strictEqual(g.counts.warp.source, 'CALCULATED');
  near(g.gsm.value, 400, 0.02, 'counts solved to land on the GSM');
  near(g.counts.warp.ne / g.counts.weft.ne, 8 / 6, 0.05, 'warp/weft ratio of the standard quality');
  const s = WR.reverse({ ...denim, warp_count: '10s', weft_count: '12s' });
  assert.strictEqual(s.counts.warp.ne, 10); assert.strictEqual(s.counts.weft.source, 'SUPPLIED');
  assert(s.notes.some((n) => /right-hand/.test(n)), 'the twill direction is reported');
  assert.strictEqual(WR.reverse({ weave: { cls: 'plain' }, ends_per_cm: 44, picks_per_cm: 26 }).quality.id, 'woven_plain_shirting');
  assert.strictEqual(WR.reverse({ weave: { cls: 'plain' }, ends_per_cm: 20, picks_per_cm: 18 }).quality.id, 'woven_sheeting');
  assert.strictEqual(WR.reverse({ weave: { cls: 'twill', notation: '2/2', angle_deg: 66, repeat: 4 }, ends_per_cm: 42, picks_per_cm: 22 }).quality.id, 'woven_gabardine');
  assert.strictEqual(WR.reverse({ weave: { cls: 'satin', repeat: 5, face: 'weft' }, ends_per_cm: 25, picks_per_cm: 40 }).quality.id, 'woven_sateen_5');
  assert.throws(() => WR.reverse({ weave: { cls: 'plain' }, ends_per_cm: 2, picks_per_cm: 20 }), WR.WovenReverseError);
  assert.throws(() => WR.reverse({ weave: { cls: 'leno' }, ends_per_cm: 20, picks_per_cm: 20 }), WR.WovenReverseError);
  console.log('✓ woven reverse: quality, counts from cover / GSM / given, sources');
}

// ── any ID-1 card (bank card, NID) laid on the cloth sets the scale exactly ─────
{
  // a card drawn on the photographed cloth: 85.6 x 53.98 mm, rounded corners, some print, turned
  const paint = (p, P, o) => {
    const w = 85.6 * P, h = 53.98 * P, rr = 3.18 * P, th = o.rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), cx = o.cx * p.w, cy = o.cy * p.h;
    const inside = (u, v) => { const ax = Math.abs(u) - (w / 2 - rr), ay = Math.abs(v) - (h / 2 - rr); return ax > 0 && ay > 0 ? Math.hypot(ax, ay) <= rr : Math.abs(u) <= w / 2 && Math.abs(v) <= h / 2; };
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      let acc = 0, col = [0, 0, 0];
      for (let q = 0; q < 4; q++) {
        const dx = x + 0.25 + (q & 1) * 0.5 - cx, dy = y + 0.25 + (q >> 1) * 0.5 - cy, u = dx * c + dy * s, v = -dx * s + dy * c;
        if (!inside(u, v)) continue;
        acc++; const fu = u / w + 0.5, fv = v / h + 0.5;
        let k = o.base; if (fv > 0.6 && fv < 0.66 && fu > 0.08 && fu < 0.7) k = k.map((z) => z * 0.3);           // a line of print
        if (o.chip && fu > 0.1 && fu < 0.24 && fv > 0.35 && fv < 0.55) k = [200, 170, 90];
        col = col.map((z, i) => z + k[i]);
      }
      if (!acc) continue;
      const i = (y * p.w + x) * 4, a = acc / 4;
      for (let ch = 0; ch < 3; ch++) p.rgba[i + ch] = p.rgba[i + ch] * (1 - a) + (col[ch] / acc) * a;
    }
  };
  const P = 14, shot = (fo) => SY.photo({ KAScan: KS, seed: 4, pxPerMm: P, width: 2400, height: 1800, uncut: true, cardY: -3, blur: 1, noise: 0.025, light: 0.25, colour: [205, 200, 195], ...fo }, KS.CARD);
  for (const [fo, card, pos, truth] of [
    [{ structure: 'rib', wpc: 11, cpc: 16 }, { base: [25, 45, 110], chip: true }, [0.68, 0.6, -12], [11, 16]],
    [{ weave: W.twill31, epc: 28, ppc: 17, warpColour: [40, 60, 120], weftColour: [225, 225, 215] }, { base: [235, 238, 230] }, [0.3, 0.5, 6], [28, 17]],
  ]) {
    const p = shot(fo); paint(p, P, { cx: pos[0], cy: pos[1], rot: pos[2], ...card });
    const card0 = KS.detectIdCard(p.rgba, p.w, p.h, KS.toGray(p.rgba, p.w, p.h));
    assert(card0, 'the card is found'); near(card0.pxPerMm, P, 0.02, 'card scale');
    // the free analysis, told a WRONG scale (10 px/mm), corrects itself from the card
    const r = KS.analyseFree(p.rgba, p.w, p.h, { pxPerMm: 10, source: 'assumed' });
    assert.strictEqual(r.scale.source, 'id-card'); assert(r.card && r.card.type === 'id');
    const got = r.family === 'woven' ? [r.woven.ends_per_cm, r.woven.picks_per_cm] : [r.wpc, r.cpc];
    near(got[0], truth[0], 0.07, 'count with the card'); near(got[1], truth[1], 0.1, 'second count with the card');
  }
  // no card: none is invented
  for (const fo of [{ structure: 'single_jersey', wpc: 14, cpc: 19 }, { weave: W.plain, epc: 30, ppc: 28, colour: [235, 235, 230] }]) {
    const p = shot(fo); assert.strictEqual(KS.detectIdCard(p.rgba, p.w, p.h, KS.toGray(p.rgba, p.w, p.h)), null, 'no card in a plain cloth photo');
  }
  console.log('✓ ID-1 card: found, exact scale, counts right at a wrong assumed scale, none invented');
}

// ── the fabric recogniser: the shipped weights, the plain-JS engine, and its place in the evidence ─────
{
  const FN = require(path.join(FE, 'fabric-net.js'));
  const MD = path.join(__dirname, '..', '..', 'frontend', 'assets', 'models');
  const meta = JSON.parse(fs.readFileSync(path.join(MD, 'fabric-id-v1.json'), 'utf8'));
  const buf = fs.readFileSync(path.join(MD, 'fabric-id-v1.bin'));
  assert.strictEqual(buf.length, meta.floats * 2, 'the half-float weights are all there');
  const net = FN.fromBuffers(meta, FN.weights(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
  const p = SY.photo({ KAScan: KS, seed: 5, pxPerMm: 15, width: 1100, height: 900, uncut: true, cardY: -3, blur: 1, noise: 0.025, light: 0.25, weave: W.twill31, epc: 28, ppc: 17, angle: 12, warpColour: [40, 60, 120], weftColour: [225, 225, 215] }, KS.CARD);
  const r = KS.analyseFree(p.rgba, p.w, p.h, { pxPerMm: 15, source: 'test' });
  assert(r._crop && r._id, 'the result says where the recogniser should look');
  const m = net.classify(p.rgba, p.w, p.h, [r._crop]);
  for (const head of ['family', 'knit', 'weave', 'side']) {
    const sum = Object.values(m[head]).reduce((t, v) => t + v, 0);
    assert(Math.abs(sum - 1) < 0.01, head + ' is a probability distribution');
  }
  assert(m.family.woven > 0.5, 'a photographed denim is woven to the recogniser too: ' + m.family.woven);
  KS.reidentify(r, m);
  assert(r.identity.evidence.some((e) => /recogniser/.test(e.why)), 'its verdict is listed with the evidence');
  assert.strictEqual(r.identity.family, 'woven');
  // weight: one confident recogniser verdict cannot, alone, outvote three measured items against it
  const wv = { ok: true, confidence: 'high', ends_per_cm: 30, picks_per_cm: 25, weave: { cls: 'plain', name: 'Plain weave 1/1', score: 9 } };
  const knitty = KS.identify({ kind: { kind: 'knit' }, woven: wv, legs: { line: 0.15, amp: 0.2, score: 0.2, legs: true }, knit_read: { ok: true, regularity: 0.85, ratio: 1.3 }, knit_suggest: [], model: { family: { knit: 0.05, woven: 0.95 } } });
  assert.strictEqual(knitty.family, 'knit', 'measured loop legs and a clean loop lattice still decide');
  console.log('✓ recogniser: shipped weights load, distributions sum to one, its verdict joins the evidence at a bounded weight');
}

console.log('--- Fabric Identification Tests passed ---');
