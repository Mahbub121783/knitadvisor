// Fabric Studio: stitch formation (knit-formation.js) — knock-over depth ↔
// loop length by the yarn-path geometry round needle and sinker (single bed)
// or between the hooks of the two beds (double bed).
const assert = require('assert');
const F = require('../engine/domain/knit-formation');
const S = require('../engine/domain/fabric-studio');
console.log('--- Running Studio Formation Tests ---');

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const yd = (ne) => 0.907 / Math.sqrt(ne);

// geometry: the loop grows with the depth, and depthFor inverts it
for (const [dbl, gating] of [[false, 'single'], [true, 'rib'], [true, 'interlock']]) {
  const g = F.geometry(dbl, gating, 24, yd(30));
  let prev = 0;
  for (let d = 0.2; d < 4; d += 0.2) { const l = F.loopAt(d, g); if (l == null) continue; assert(l > prev, `${gating}: monotonic`); prev = l; }
  for (const l of [2.6, 3.0, 3.6]) { const r = F.depthFor(l, g); if (r.short) continue; near(F.loopAt(r.d, g), l, 1e-6, `${gating}: inverse`); }
}
// single jersey: a 2.75 mm loop at 24 GG on 30s knocks over about a millimetre deep
{
  const d = F.depthFor(2.75 * 1.05, F.geometry(false, 'single', 24, yd(30))).d;
  assert(d > 0.8 && d < 1.6, `24 GG 30s: ${d}`);
  // the same loop on a finer gauge (closer needles) is drawn deeper
  assert(F.depthFor(2.75 * 1.05, F.geometry(false, 'single', 28, yd(30))).d > d, 'finer gauge, deeper draw');
  // a longer loop, deeper
  assert(F.depthFor(3.2 * 1.05, F.geometry(false, 'single', 24, yd(30))).d > d);
  // a loop shorter than the yarn wrapped round needle and sinker cannot be knitted
  assert(F.depthFor(1.0, F.geometry(false, 'single', 24, yd(30))).short);
}

const T = S.listTemplates();
const rows = (g) => g.map((r) => (r.join ? r.join('') : r));
const run = (id, machine, extra) => { const t = T.find((x) => x.id === id); return S.analyse({ bed: t.grid.D ? 'double' : 'single', gating: t.gating || 'rib', grid: { C: rows(t.grid.C), D: t.grid.D ? rows(t.grid.D) : null }, feeds: t.roles.map((role) => ({ role })), yarn: { fibre: 'cotton', ne: 30 }, target: { gsm: 200 }, machine: machine || {}, ...(extra || {}) }); };

// the engine reports a depth for every knitting feed
{
  const r = run('lacoste_single', { gauge: 24 });
  const fm = r.machine_setup.formation;
  assert(fm && fm.feeds.length === 4 && fm.feeds.every((f) => f.cyl_depth_mm > 0), 'a depth per feed');
  assert.strictEqual(fm.feed_system, 'positive');
  assert(fm.feeds.every((f) => Math.abs(f.needle_loop_mm + f.sinker_loop_mm - f.sl_mm) < 0.02), 'needle + sinker loop = loop');
}
// forward: a cam depth sets the stitch length, and the plan reads the same depth back
{
  const r = run('single_jersey', { gauge: 24, cam_depth_mm: 1.2 });
  assert(r.checks.some((c) => /Stitch cam set to 1.2 mm/.test(c.text)));
  near(r.machine_setup.formation.feeds[0].cyl_depth_mm, 1.2, 0.02, 'round trip');
  assert(run('single_jersey', { gauge: 24, cam_depth_mm: 1.5 }).fabric.sl_mm > r.fabric.sl_mm, 'deeper cam, longer loop');
}
// timing: delayed sets the dial shallower than the cylinder; synchronised alike; interlock is synchronised
{
  const del = run('rib_1x1', { gauge: 18 }).machine_setup.formation;
  assert.strictEqual(del.timing, 'delayed');
  assert(del.feeds[0].dial_depth_mm < del.feeds[0].cyl_depth_mm);
  const syn = run('rib_1x1', { gauge: 18, timing: 'synchronised' }).machine_setup.formation;
  near(syn.feeds[0].dial_depth_mm, syn.feeds[0].cyl_depth_mm, 1e-9, 'synchronised: equal');
  assert.strictEqual(run('interlock', { gauge: 24 }).machine_setup.formation.timing, 'synchronised');
  assert(run('interlock', { gauge: 24, timing: 'delayed' }).checks.some((c) => c.level === 'warn' && /Interlock gating runs synchronised/.test(c.text)));
}
// the mill's stitch-cam scale: a setting it runs reads back as itself
{
  const r = run('single_jersey', { gauge: 24, sl_mm: 2.8, stitch_cam: { points: [{ reading: 350, sl_mm: 2.8 }, { reading: 420, sl_mm: 3.2 }] } });
  near(r.machine_setup.formation.feeds[0].cyl_reading, 350, 0.05, 'reading at a calibration point');
}
// too short a loop for the gauge: an error, not a refusal
{
  const r = run('single_jersey', { gauge: 24, sl_mm: 0.95 });
  assert(r.success && r.checks.some((c) => c.level === 'error' && /cannot knock over/.test(c.text)));
}
console.log('Studio formation tests passed');
