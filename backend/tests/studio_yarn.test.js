// Fabric Studio: yarns — every count system to tex, ply, filaments, yarn
// type (diameter), and one yarn per role (face / ground, binder, loop).
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
console.log('--- Running Studio Yarn Tests ---');

const base = { bed: 'single', grid: { C: ['K'] }, feeds: [{ role: 'ground' }], target: { gsm: 180 }, machine: {} };
const g = (yarn) => { const r = S.analyse({ ...base, yarn }); assert(r.success, r.error); return r.yarn.ground; };
const near = (a, b, t, m) => assert(Math.abs(a - b) <= t, `${m}: ${a} vs ${b}`);

// every system to tex
near(g({ count: 30, unit: 'ne' }).tex, 19.68, 0.01, 'Ne');
near(g({ count: 50, unit: 'nm' }).tex, 20, 0.01, 'Nm');
near(g({ count: 30, unit: 'tex' }).tex, 30, 0.01, 'tex');
near(g({ count: 167, unit: 'dtex', fibre: 'polyester_filament' }).tex, 16.7, 0.01, 'dtex');
near(g({ count: 150, unit: 'denier', fibre: 'polyester_filament' }).tex, 16.67, 0.01, 'denier');
near(g({ count: 40, unit: 'nw' }).tex, 22.15, 0.01, 'worsted');
near(g({ ne: 30 }).tex, 19.68, 0.01, 'the old {ne} form still reads');
// ply: 2/40s is two 40s singles = a 20s resultant
const ply = g({ count: 40, unit: 'ne', ply: 2 });
near(ply.tex, 29.53, 0.01, '2/40s'); assert(/^2\/40s/.test(ply.count));
// equivalents
const e = g({ count: 30, unit: 'ne' }).equivalents;
near(e.nm, 50.8, 0.05, 'Nm'); near(e.denier, 177.2, 0.1, 'D'); near(e.dtex, 196.8, 0.1, 'dtex');
// yarn type sets the diameter at a count: compact < combed < open-end; FDY < DTY
const d = (yarn) => g(yarn).d_mm;
assert(d({ count: 30, unit: 'ne', type: 'compact' }) < d({ count: 30, unit: 'ne', type: 'combed' }));
assert(d({ count: 30, unit: 'ne', type: 'combed' }) < d({ count: 30, unit: 'ne', type: 'open_end' }));
assert(d({ count: 150, unit: 'denier', fibre: 'polyester_filament', type: 'fdy' }) < d({ count: 150, unit: 'denier', fibre: 'polyester_filament', type: 'dty' }));
// a count outside the range says so, in the unit given
assert(/0.3 tex is outside/.test(S.analyse({ ...base, yarn: { count: 3, unit: 'denier', fibre: 'polyester_filament' } }).error));

// one yarn per role: face / binder / loop each as given, in any unit
{
  const f = (...r) => r.map((role) => ({ role }));
  const r = S.analyse({ bed: 'single', grid: { C: ['KKKK', 'KKKK', 'TMMM', 'KKKK', 'KKKK', 'MMTM'] }, feeds: f('face', 'binder', 'loop', 'face', 'binder', 'loop'), target: { gsm: 280 }, machine: {},
    yarn: { count: 30, unit: 'ne', fibre: 'cotton', type: 'compact' },
    yarns: { binder: { count: 75, unit: 'denier', fibre: 'polyester_filament', type: 'dty', filaments: 36 }, loop: { count: 10, unit: 'ne', fibre: 'cvc', type: 'open_end' } } });
  assert(r.success, r.error);
  assert.strictEqual(r.yarn.roles.binder.count, '75 D/36F');
  near(r.yarn.roles.loop.tex, 59.05, 0.01, 'loop');
  assert.strictEqual(r.yarn.roles.loop.source, 'your input');
  assert(r.yarn.feeds[1].yarn === '75 D/36F' && r.yarn.feeds[2].yarn === '10s Ne', 'each feeder takes its role\'s yarn');
  // a feeder's own count still wins over its role's
  const own = S.analyse({ bed: 'single', grid: { C: ['KK', 'KK'] }, feeds: [{ role: 'ground' }, { role: 'ground', yarn: { ne: 40 } }], yarn: { count: 30, unit: 'ne' }, target: { gsm: 160 }, machine: {} });
  assert.strictEqual(own.yarn.feeds[1].yarn, '40s Ne');
}
// a feeder's own count in any unit
{
  const r = S.analyse({ bed: 'single', grid: { C: ['KK', 'KK'] }, feeds: [{ role: 'ground' }, { role: 'ground', yarn: { count: 150, unit: 'denier' } }], yarn: { count: 30, unit: 'ne', fibre: 'polyester_filament', type: 'fdy' }, target: { gsm: 140 }, machine: {} });
  assert(r.success, r.error); assert.strictEqual(r.yarn.feeds[1].yarn, '150 D');
}
// yarn character: the kind of yarn reaches the fabric
{
  const j = (yarn, extra) => S.analyse({ ...base, yarn, ...(extra || {}) });
  const cp = j({ count: 30, unit: 'ne', type: 'compact' }), oe = j({ count: 30, unit: 'ne', type: 'open_end', fibre: 'cvc' });
  assert(cp.yarn.character.length === 1 && cp.yarn.character[0].effects.length > 3, 'effects per yarn');
  assert(cp.yarn.effects.pilling_grade > oe.yarn.effects.pilling_grade, 'compact pills less than open-end CVC');
  assert(cp.yarn.effects.strength_vs_combed_pct > 0 && oe.yarn.effects.strength_vs_combed_pct < 0, 'compact stronger, open-end weaker than combed ring');
  assert(oe.checks.some((c) => c.level === 'warn' && /pills heavily/.test(c.text)), 'the yarn engine warning reaches the checks');
  // a face brushing lowers the pilling grade
  assert(j({ count: 30, unit: 'ne', type: 'combed' }, { finish: { brush: 'face' } }).yarn.effects.pilling_grade < j({ count: 30, unit: 'ne', type: 'combed' }).yarn.effects.pilling_grade);
  // twist spirality: a ply yarn is balanced; none on a double bed
  assert(j({ count: 30, unit: 'ne', type: 'combed' }).yarn.effects.twist_spirality_deg > j({ count: 60, unit: 'ne', ply: 2, type: 'combed' }).yarn.effects.twist_spirality_deg);
  assert.strictEqual(S.analyse({ bed: 'double', gating: 'rib', grid: { C: ['K'], D: ['K'] }, yarn: { count: 30, unit: 'ne' }, target: { gsm: 220 }, machine: {} }).yarn.effects.twist_spirality_deg, null);
  // a count the system cannot spin is flagged
  assert(j({ count: 8, unit: 'ne', type: 'compact' }).checks.some((c) => /spinning makes about/.test(c.text)));
  // every role gets its own character
  const f = (...r) => r.map((role) => ({ role }));
  const fl = S.analyse({ bed: 'single', grid: { C: ['KKKK', 'KKKK', 'TMMM'] }, feeds: f('face', 'binder', 'loop'), target: { gsm: 280 }, machine: {}, yarn: { count: 30, unit: 'ne' }, yarns: { binder: { count: 75, unit: 'denier', fibre: 'polyester_filament' }, loop: { count: 10, unit: 'ne', type: 'open_end' } } });
  assert.deepStrictEqual(fl.yarn.character.map((c) => c.role), ['face', 'binder', 'loop']);
  assert(fl.yarn.character[1].look.filament, 'the binder is drawn as filament');
}
console.log('Studio yarn tests passed');
