// The yarn twin: knit-only repeats are modelled as interlocked yarn inside the Studio's own cell; the rest is refused, not faked.
const assert = require('assert');
console.log('--- Running Yarn Twin Tests ---');
const F = require('../engine/domain/fabric-studio');
const T = require('../engine/domain/yarn-twin');

const run = (id, gauge) => {
  const t = F.listTemplates().find((x) => x.id === id);
  const o = F.analyse({ bed: t.bed, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })), yarn: { count: 30, unit: 'ne', fibre: 'cotton' }, machine: { gauge, dia: 30, sl_mm: 2.7 }, target: {} });
  assert(o.success, `${id}: ${o.error}`);
  return o;
};

for (const [id, g, wales, doubles] of [['single_jersey', 24, 1, false], ['rib_1x1', 18, 2, true], ['rib_2x2', 18, 4, true]]) {
  const o = run(id, g), w = T.twin(o, { timeMs: 700 });
  assert(w.supported, `${id} is modelled`);
  assert.strictEqual(w.wales.length, wales);
  // the cell is the Studio's prediction, in yarn diameters: width per repeat, and the course pitch
  const d = o.yarn.ground.d_mm, cols = o.structure.beds.C[0].length;
  assert(Math.abs(w.cell.Lx - cols * (o.fabric.width_open_in * 25.4 / o.machine.needles) / d) < 0.01, 'cell width = the Studio\'s width per repeat');
  assert(Math.abs(w.cell.Ly - (10 / o.fabric.cpc) / d) < 0.01, 'cell height = the Studio\'s course pitch');
  // yarn cannot pass through yarn: the closest two non-neighbouring yarns stay about one diameter apart
  assert(w.fit.closest_yarns_d > 0.85, `${id}: closest yarns ${w.fit.closest_yarns_d}`);
  assert.strictEqual(w.nodes.length, w.fit.nodes);
  const zs = w.nodes.map((p) => p[2]);
  const spread = Math.max(...zs) - Math.min(...zs);
  assert(doubles ? spread > 2.5 : spread < 2.6, `${id}: a rib has two layers (front and back), jersey one — spread ${spread}`);
  assert(/not re-derived/.test(w.basis), 'it says the dimensions are the Studio\'s, not its own');
}

// refused, with the reason, rather than approximated
assert.strictEqual(T.twin(run('pique_single', 24)).supported, false);
assert(/feeds differ|tuck|miss/i.test(T.twin(run('pique_single', 24)).reason));
assert.strictEqual(T.twin(run('interlock', 18)).supported, false);
assert.strictEqual(T.walesOf(run('lacoste_single', 24)).wales, undefined);
const bad = JSON.parse(JSON.stringify(run('single_jersey', 24))); bad.yarn.ground.d_mm = 0;
assert.strictEqual(T.twin(bad).supported, false);
const far = run('single_jersey', 24); far.fabric.sl_mm = 20;
assert.strictEqual(T.twin(far).supported, false, 'a loop outside what the model is built for is refused');
console.log('Yarn twin tests passed');
