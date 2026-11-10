// Saved studio designs: what is accepted for storage, and the migration that holds them.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { cleanDesign, DesignError, MAX_DESIGNS } = require('../db/repositories/studio-repo');
console.log('--- Running Studio Designs Tests ---');

const ok = { name: '  Polo   pique  ', design: { C: [['K', 'T'], ['K', 'K']], D: null, rolls: [{ gsm: 200 }], feeds: [{ role: 'ground' }, { role: 'ground' }] } };
{
  const c = cleanDesign(ok);
  assert.strictEqual(c.name, 'Polo pique', 'name tidied');
  assert.strictEqual(JSON.parse(c.json).name, 'Polo pique');
  assert.deepStrictEqual(JSON.parse(c.json).C, ok.design.C);
}
const refuse = (body, re) => assert.throws(() => cleanDesign(body), (e) => e instanceof DesignError && re.test(e.message), JSON.stringify(body).slice(0, 80));
refuse({ name: '', design: ok.design }, /name/);
refuse({ name: 'x', design: null }, /Nothing/);
refuse({ name: 'x', design: { C: [] } }, /feeds/);
refuse({ name: 'x', design: { C: [['K', 'X']] } }, /K, T, M, E or -/);
refuse({ name: 'x', design: { C: [['K', 'K'], ['K']] } }, /same number/);
refuse({ name: 'x', design: { C: [['K']], D: [['K'], ['K']] } }, /same number of feeds/);
refuse({ name: 'x', design: { ...ok.design, rolls: new Array(13).fill({}) } }, /12 trial rolls/);
refuse({ name: 'x', design: { ...ok.design, blob: 'y'.repeat(70000) } }, /too large/);
assert(MAX_DESIGNS >= 50);

// a warp design is stored with its bars, not a K/T/M grid
{
  const w = { tech: 'warp', warp: { machine: { type: 'tricot', gauge: 28 }, bars: [{ notation: '1-0/2-3//', threading: 'X', yarn: { count: 40, unit: 'denier' } }, { notation: '1-2/1-0//', yarn: { count: 40 } }], target: { gsm: 120 } } };
  const c = cleanDesign({ name: ' Locknit  40D ', design: w });
  assert.strictEqual(c.name, 'Locknit 40D');
  assert.strictEqual(JSON.parse(c.json).warp.bars.length, 2);
  refuse({ name: 'x', design: { ...w, warp: { ...w.warp, bars: [] } } }, /1 to 8 guide bars/);
  refuse({ name: 'x', design: { ...w, warp: { ...w.warp, bars: new Array(9).fill(w.warp.bars[0]) } } }, /1 to 8 guide bars/);
  refuse({ name: 'x', design: { ...w, warp: { ...w.warp, bars: [{ notation: '1-0; DROP TABLE', yarn: {} }] } } }, /lapping is not valid/);
  refuse({ name: 'x', design: { ...w, warp: { ...w.warp, bars: [{ notation: '1-0/1-2//', threading: 'XYZ', yarn: {} }] } } }, /threading/);
  refuse({ name: 'x', design: { ...w, warp: { ...w.warp, bars: [{ notation: '1-0/1-2//' }] } } }, /its yarn/);
  refuse({ name: 'x', design: { ...w, warp: { ...w.warp, blob: 'y'.repeat(70000) } } }, /too large/);
}

// the migration matches what the repository writes: one name per account, any case
const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/035_studio_designs.sql'), 'utf8');
assert(/CREATE TABLE studio_designs/.test(sql) && /REFERENCES app_users\(id\) ON DELETE CASCADE/.test(sql));
assert(/UNIQUE INDEX uq_studio_designs_name ON studio_designs \(user_id, lower\(name\)\)/.test(sql), 'ON CONFLICT (user_id, lower(name)) needs exactly this index');
const repo = fs.readFileSync(path.join(__dirname, '../db/repositories/studio-repo.js'), 'utf8');
assert(/ON CONFLICT \(user_id, lower\(name\)\)/.test(repo));
console.log('Studio designs tests passed');
