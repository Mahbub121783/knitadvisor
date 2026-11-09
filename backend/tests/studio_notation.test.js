// Fabric Studio: the notation is the source of truth. Every K / T / M / E / -
// must reach both 3D views unchanged and be drawn by the rules of weft
// knitting (Spencer, Knitting Technology; textbook loop formation):
//   knit  the new loop is drawn through the old one, back to front: legs in
//         front of the bed's face, feet behind it; one course tall
//   tuck  the needle takes the yarn but does not clear: an arch lying behind
//         the held loop on the technical back, not a loop
//   miss  the needle takes no yarn: a flat float behind the held loop
//   held  a loop held through n tucks or misses is n courses taller
//   E / - a transfer or an empty needle opens a hole (eyelet / ladder)
// checked on the loop diagram (studio-loop-geom.js), on the mapping to the
// real view (studio-cloth-map.js) and on the real view's own yarn paths
// (knit3d topology-builder.js).
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const studio = require('../engine/domain/fabric-studio');
const geom = require('../../frontend/assets/js/studio-loop-geom.js');
const map = require('../../frontend/assets/js/studio-cloth-map.js');
console.log('--- Running Studio Notation Tests ---');

const T = studio.listTemplates();
const tpl = (id) => T.find((x) => x.id === id);
const bedOf = (id, t) => (t.grid.D ? (/interlock|ponte/.test(id) ? 'interlock' : 'rib') : 'single');
const IDS = ['single_jersey', 'lacoste_single', 'single_cross_tuck', 'birds_eye', 'knitted_twill', 'accordion_tuck', 'pointelle',
  'rib_1x1', 'rib_2x2', 'half_cardigan', 'full_cardigan', 'half_milano', 'full_milano', 'interlock', 'swiss_double_pique', 'ponte_di_roma'];

// ── 1. the loop diagram ─────────────────────────────────────────────────
for (const id of IDS) {
  const t = tpl(id);
  const C = t.grid.C, D = t.grid.D || null;
  const g = geom.buildLoopPaths({ C, D, bed: bedOf(id, t), feeds: C.map(() => ({ role: 'ground' })), h: 0.75, courses: 6 * C.length, wales: 4 * C[0].length });
  const F = C.length, step = g.step;
  const act = (bed, j, c) => { const G = bed === 'C' ? C : D; return G[((c % F) + F) % F][((j % G[0].length) + G[0].length) % G[0].length]; };
  let n = 0;
  for (const co of g.courses) {
    if (co.course < F || co.course >= g.rows - 2 * F) continue;           // away from the swatch edges
    for (const st of co.stitches) {
      const s = st.bed === 'C' ? 1 : -1, z0 = g.bed === 'single' ? 0 : s * g.zc;
      const pts = co.points.slice(st.from, st.to + 1), dz = pts.map((p) => s * (p.z - z0));
      assert.strictEqual(st.act, act(st.bed, st.wale, co.course), `${id}: the diagram draws the cell that was drawn`);
      if (st.act === 'K') {
        assert(Math.max(...dz) > 0.1 && Math.min(...dz) < -0.1, `${id} F${st.feed + 1} n${st.needle}: a knit loop is drawn through the old one (legs in front, feet behind)`);
        let held = 0; for (let k = co.course + 1; act(st.bed, st.wale, k) !== 'K' && k < co.course + 3 * F; k++) held++;
        if (!st.transferred) {
          assert.strictEqual(st.held, held, `${id}: the loop is held through ${held} course(s)`);
          assert(Math.abs(st.top - (st.y0 + (held + 1) * step + 0.38 * g.h)) < 1e-6, `${id}: a held loop is as tall as it is held`);
        }
      } else if (st.act === 'T') {
        assert(Math.max(...dz) < 0, `${id} F${st.feed + 1}: a tuck lies behind the held loop`);
        assert(st.top > st.y0 + 0.5 * step, `${id}: a tuck is an arch up to the held loop's head`);
      } else if (st.act === 'M') {
        assert(Math.max(...dz) < 0, `${id}: a miss floats behind`);
        assert(st.top - st.y0 < 0.1 * g.h, `${id}: a float is flat, not a loop`);
      }
      n++;
    }
  }
  assert(n > 10, `${id}: stitches checked`);
}

// ── 2. the mapping to the real view: every cell, both beds, unchanged ──
const TOK = { K: 'knit', T: 'tuck', M: 'miss' };
for (const id of IDS) {
  const t = tpl(id), C = t.grid.C, D = t.grid.D || null;
  const cs = map.clothSpec({ bed: bedOf(id, t), C, D, feeds: C.map(() => ({ role: 'ground' })) });
  const type = cs.construction.type;
  for (let c = 0; c < 2 * C.length; c++) for (let w = 0; w < 2 * C[0].length; w++) {
    const cell = C[c % C.length][w % C[0].length];
    if (type === 'rib') continue;                                          // plain rib: knit / purl by set-out, below
    if (type === 'mesh') assert.strictEqual(cs.sample(w, c), cell === 'E' || cell === '-' ? 'miss' : cell === 'T' ? 'tuck' : 'knit', `${id}: eyelet at E`);
    else assert.strictEqual(cs.sample(w, c), TOK[cell] || 'miss', `${id} cylinder (${w},${c})`);
    if (D && type === 'interlock') assert.strictEqual(cs.sampleBack(w, c), TOK[D[c % D.length][w % D[0].length]] || 'miss', `${id} dial (${w},${c})`);
  }
}
{
  const kind = (id) => { const t = tpl(id); return map.clothSpec({ bed: bedOf(id, t), C: t.grid.C, D: t.grid.D, feeds: t.grid.C.map(() => ({ role: 'ground' })) }); };
  assert.strictEqual(kind('rib_1x1').construction.type, 'rib');
  assert.deepStrictEqual(kind('rib_2x2').construction.ribRepeat, { a: 2, b: 2 }, 'a 2×2 rib keeps its set-out');
  for (const id of ['half_cardigan', 'full_cardigan', 'half_milano', 'full_milano', 'swiss_double_pique']) {
    assert.strictEqual(kind(id).construction.type, 'interlock', `${id}: both beds' own programmes are drawn, not a plain rib`);
  }
  assert.strictEqual(kind('pointelle').construction.type, 'mesh', 'transfers open eyelets');
  assert.strictEqual(kind('pointelle').photo, false);
  const fl = map.clothSpec({ bed: 'single', C: tpl('fleece_3_thread').grid.C, feeds: [{ role: 'face' }, { role: 'binder' }, { role: 'loop' }, { role: 'face' }, { role: 'binder' }, { role: 'loop' }] });
  assert.deepStrictEqual(fl.pattern.feedYarns, ['face', 'binder', 'fleecy', 'face', 'binder', 'fleecy'], 'fleece: each feeder\'s yarn reaches the 3D');
}

// ── 3. the real view's own yarn paths (knit3d), measured stitch by stitch ──
{
  const ids = ['lacoste_single', 'birds_eye', 'half_cardigan', 'full_cardigan', 'half_milano', 'full_milano', 'interlock', 'swiss_double_pique', 'rib_1x1', 'pointelle'];
  const r = spawnSync(process.execPath, ['--import', './tests/helpers/knit3d-loader.mjs', 'tests/helpers/knit3d-notation-check.mjs', ...ids], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const ONE = out.lacoste_single.stats['knit/held0'].height, PITCH = out.lacoste_single.stats['knit/held1'].height - ONE;
  for (const [id, v] of Object.entries(out)) {
    for (const [k, x] of Object.entries(v.stats)) {
      const tok = k.replace(/^dial /, '').split('/')[0], held = +(k.split('/held')[1] || 0);
      if (tok === 'knit') {
        assert(x.front > 0.15 && x.back < -0.1, `${id} ${k}: drawn through the old loop`);
        assert(Math.abs(x.height - (ONE + held * PITCH)) < 0.05, `${id} ${k}: held ${held} course(s) → ${x.height}`);
      } else if (tok === 'tuck') {
        assert(x.front < 0 && x.height < ONE * 0.6, `${id} ${k}: a tuck arch behind the held loop`);
      } else if (tok === 'miss') {
        assert(x.front < 0 && x.height < 0.45, `${id} ${k}: a float (or eyelet carry) behind`);
      } else if (tok === 'purl') {
        assert(x.front < out.rib_1x1.stats['knit/held0'].front, `${id}: purl wales recede`);
      }
    }
  }
  const st = (id) => Object.keys(out[id].stats);
  assert(st('half_cardigan').includes('dial tuck') && !st('half_cardigan').includes('tuck'), 'half cardigan: one bed tucks');
  assert(st('full_cardigan').includes('dial tuck') && st('full_cardigan').includes('tuck'), 'full cardigan: both beds tuck');
  assert(st('half_milano').includes('dial miss'), 'half milano: the dial misses');
  assert(!st('interlock').includes('knit/held0'), 'interlock: each needle knits every other feed');
  assert(st('pointelle').includes('miss'), 'pointelle: the eyelets open');
}
console.log('Studio notation tests passed');
