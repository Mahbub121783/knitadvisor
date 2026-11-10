// Learning from every roll: a floor machine's logged rolls correct the Studio for that machine,
// structure by structure — and the rule is the one the factory records showed to help.
const assert = require('assert');
console.log('--- Running Studio Floor-Learning Tests ---');

const ML = require('../engine/domain/machine-learning');
const F = require('../engine/domain/fabric-studio');
const floorRepo = require('../db/repositories/floor-repo');

// 1. the rule: no rolls → no effect; rolls shrink towards "no effect" by K; other structures don't count
const sd0 = { p10: -0.06, p90: 0.06 };
let p = ML.learnProfile([], { group: 'single_jersey', ne: 30, gsmCV: sd0, widthCV: sd0 });
assert.strictEqual(p.gsm_factor, 1); assert.strictEqual(p.width_factor, 1); assert.strictEqual(p.n, 0);
const ten = Array.from({ length: 10 }, () => ({ group: 'single_jersey', ne: 30, gsm_ratio: 1.05, width_ratio: 0.95 }));
p = ML.learnProfile(ten, { group: 'single_jersey', ne: 30, gsmCV: sd0, widthCV: sd0 });
assert(Math.abs(Math.log(p.gsm_factor) - (10 * Math.log(1.05)) / (10 + ML.K)) < 1e-9, 'factor = exp(Σ ln r ÷ (n + K))');
assert(p.width_factor < 1 && p.width_factor > 0.95, 'width learned, shrunk');
assert(p.gsm_sd < ML.sigmaFromCV(sd0) * 1.1, 'consistent rolls do not widen the range');
const two = ML.learnProfile(ten.slice(0, 2), { group: 'single_jersey', ne: 30, gsmCV: sd0, widthCV: sd0 });
assert(Math.abs(two.gsm_factor - 1) < Math.abs(p.gsm_factor - 1), 'two rolls move it less than ten');
assert.strictEqual(ML.learnProfile(ten, { group: 'rib_1x1', ne: 30, gsmCV: sd0, widthCV: sd0 }).n, 0, 'another structure teaches nothing');
const farCount = ML.learnProfile(ten, { group: 'single_jersey', ne: 40, gsmCV: sd0, widthCV: sd0 });
assert.strictEqual(farCount.n_gsm, 0, 'GSM is learned only from rolls within ±10% of the count');
assert(farCount.n_width === 10, '… width from every roll of the structure');
const many = [...Array.from({ length: 30 }, () => ({ group: 'single_jersey', ne: 30, gsm_ratio: 0.8, width_ratio: 1.2 })), ...ten];
assert(Math.abs(ML.learnProfile(many, { group: 'single_jersey', ne: 30, gsmCV: sd0, widthCV: sd0 }).gsm_factor - p.gsm_factor) < 1e-12, 'only the last 10 rolls count');
assert.strictEqual(ML.withinPct(0.05, 1e9), 100);
const [lo, hi] = ML.band(100, 0.05); assert(lo < 100 && hi > 100 && Math.abs(lo * hi - 10000) < 1e-6);

// 2. the engine: rolls passed with the design move the answer and say how many back it up
const base = { bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { count: 30, unit: 'ne', fibre: 'cotton' }, machine: { gauge: 24, dia: 30, sl_mm: 2.7 }, target: {} };
const plain = F.analyse(base);
assert(plain.success && plain.structure.group === 'single_jersey', 'the design says which group its rolls are filed under');
assert.strictEqual(plain.fabric.accuracy.supported_by_rolls, 0);
const rolls = Array.from({ length: 6 }, () => ({ group: 'single_jersey', ne: 30, gsm_ratio: 1.06, width_ratio: 0.94 }));
const learned = F.analyse({ ...base, floor: { name: 'M-07', rolls } });
assert.strictEqual(learned.fabric.accuracy.level, 'machine');
assert.strictEqual(learned.fabric.accuracy.supported_by_rolls, 6);
assert(learned.fabric.gsm > plain.fabric.gsm && learned.fabric.width_open_in < plain.fabric.width_open_in, 'heavier and narrower, as the rolls were');
assert(learned.fabric.gsm < plain.fabric.gsm * 1.06, 'but shrunk: six rolls do not move it all the way');
assert(/M-07/.test(learned.fabric.ks_basis), 'the constant says where the correction came from');
const other = F.analyse({ ...base, floor: { name: 'M-07', rolls: rolls.map((r) => ({ ...r, group: 'rib_1x1' })) } });
assert.strictEqual(other.fabric.gsm, plain.fabric.gsm, 'rolls of another structure leave this one alone');
const junk = F.analyse({ ...base, floor: { name: 'x', rolls: [{ group: 'single_jersey', gsm_ratio: 9 }, null, 'a'] } });
assert.strictEqual(junk.fabric.gsm, plain.fabric.gsm, 'implausible rolls are dropped');
// the design's own trial rolls still win over the machine's profile
const both = F.analyse({ ...base, floor: { name: 'M-07', rolls }, calibration: { rolls: [{ sl_mm: 2.7, gsm: 150, width_in: 64, ne: 30, gauge: 24, dia: 30 }] } });
assert.notStrictEqual(both.fabric.accuracy.level, 'machine');

// 3. a roll is logged against the model at its own settings (what the route stores)
const probe = F.analyse({ ...base, calibration: { rolls: [{ sl_mm: 2.9, gsm: 140, width_in: 66, ne: 30, gauge: 24, dia: 30 }] } });
const pr = probe.fabric.calibration.rolls[0];
assert(pr.model_gsm > 0 && pr.model_width_in > 0 && pr.model_gsm < plain.fabric.gsm, 'model figures at the roll\'s longer stitch');

// 4. stenter setting: mass conserved, the engine's own GSM untouched
const st = F.analyse({ ...base, finish: { set_width_in: 70 } });
assert.strictEqual(st.fabric.gsm, plain.fabric.gsm);
assert(Math.abs(st.fabric.stenter.gsm_at_set - plain.fabric.gsm * st.fabric.stenter.natural_width_in / 70) <= 1);
assert(/modelled/.test(st.fabric.stenter.basis));
assert.strictEqual(plain.fabric.stenter, null);
assert(!F.analyse({ ...base, finish: { set_width_in: 500 } }).success, 'a silly width is refused');

// 5. machine input is checked before it reaches the database
assert.throws(() => floorRepo.cleanMachine({ name: '', kind: 'single' }), floorRepo.FloorError);
assert.throws(() => floorRepo.cleanMachine({ name: 'M1', kind: 'flat' }), floorRepo.FloorError);
assert.throws(() => floorRepo.cleanMachine({ name: 'M1', kind: 'rib', gauge: 90 }), floorRepo.FloorError);
assert.deepStrictEqual(floorRepo.cleanMachine({ name: '  M  1 ', kind: 'rib', gauge: '18', dia: '34' }), { name: 'M 1', kind: 'rib', gauge: 18, dia: 34, feeders: null, note: null });
assert.deepStrictEqual(floorRepo.asLearning([{ group_key: 'single_jersey', ne: '30.00', gsm: '150.0', gsm_model: '144.0', width_in: null, width_model: null }]),
  [{ group: 'single_jersey', ne: 30, gsm_ratio: 150 / 144, width_ratio: null }]);

console.log('Studio floor-learning tests passed');
