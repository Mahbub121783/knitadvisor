// The yarns the Studio settles (from the GSM and the composition) are the yarns its 3D views draw; the count it picks is the floor's.
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const FS = require('../engine/domain/fabric-studio');

console.log('--- Running Studio Yarn-for-Views Tests ---');
const sj = FS.listTemplates().find((x) => x.id === 'single_jersey');
const run = (gsm, comp, yarn) => FS.analyse({ bed: 'single', grid: { C: sj.grid.C.map((r) => r.join('')), D: null }, feeds: sj.roles.map((r) => ({ role: r })), target: { gsm, composition: comp }, yarn: yarn || { fibre: 'cotton', type: 'combed', ply: 1 }, yarns: {}, elastane: null });

{
  // every feeder carries the yarn as the engine settled it: the blend's fibres and the elastane plated with it
  const r = run(180, '60% cotton 35% polyester 5% elastane');
  const f = r.yarn.feeds[0];
  assert(f.look && f.look.mix && Math.abs(f.look.mix.polyester - 36.8) < 1.5 && Math.abs(f.look.mix.cotton - 63.2) < 1.5, 'the blend reaches the views: ' + JSON.stringify(f.look.mix));
  assert(!('elastane' in f.look.mix), 'the elastane is not in the yarn: it is plated beside it');
  assert(f.elastane && f.elastane.denier > 0 && f.elastane.draft > 1.5, 'the elastane, its denier and its draft, is on the feeder: ' + JSON.stringify(f.elastane));
  const m = run(180, '92% modal 8% elastane'); assert(m.yarn.feeds.some((x) => x.look.mix.modal === 100), 'a modal yarn is drawn as modal');
  console.log('✓ each feeder carries its engine yarn: CVC ' + Math.round(f.look.mix.cotton) + '/' + Math.round(f.look.mix.polyester) + ', ' + f.elastane.denier + ' D elastane at ' + f.elastane.draft + ' x');
}
{
  // a composition names fibres, not spinning: a textured polyester filament stays a filament under "100% polyester"
  const r = run(180, '100% polyester', { fibre: 'polyester_filament', type: 'dty', ply: 1 });
  assert(r.yarn.feeds[0].look.filament === true && r.yarn.feeds[0].look.type === 'dty', 'the filament is kept: ' + JSON.stringify(r.yarn.feeds[0].look));
  assert(/ D$/.test(r.yarn.feeds[0].yarn), 'a filament is named in denier: ' + r.yarn.feeds[0].yarn);
  const c = run(180, '100% cotton', { fibre: 'cotton', type: 'compact', ply: 1 }); assert(c.yarn.feeds[0].look.type === 'compact', 'the spinning system the person chose is kept when the count is solved');
  console.log('✓ a filament stays a filament (' + r.yarn.feeds[0].yarn + ' DTY), a compact yarn stays compact when the count is solved');
}
{
  // the count the floor knits at this weight: cotton single jersey, against the factory records
  const want = { 160: [26, 30], 180: [22, 26], 195: [20, 22], 220: [16, 20] };
  Object.keys(want).forEach((g) => { const ne = parseFloat(run(+g, '100% cotton').yarn.ground.count); assert(ne >= want[g][0] && ne <= want[g][1], `${g} GSM cotton jersey: ${ne}s, the floor runs ${want[g].join('-')}s`); });
  console.log('✓ cotton single jersey 160 / 180 / 195 / 220 GSM picks the counts the factory records run');
}
{
  // a guard on the regression that left every left-hand control dead: the workspace moves the cards out of <aside> before the Studio binds
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'studio.js'), 'utf8');
  assert(!/querySelectorAll\('aside input, aside select'\)\.forEach/.test(src), 'no per-element binding of <aside> controls (they are no longer there when it runs)');
  assert(/document\.addEventListener\('change', function \(e\) \{ if \(wired\(e\.target\)\) schedule\(\); \}, true\)/.test(src), 'one document listener re-asks the engine for every design control');
  assert(/looks: feeds\.map/.test(src) && /elastaneR:/.test(src) && /function clothOpts\(\)/.test(src), 'the loop and real views are given the engine yarns');
  const loops = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'studio-loops.js'), 'utf8');
  assert(/export function surfaceOf/.test(loops) && /function blendTexture/.test(loops) && /spec\.back/.test(loops), 'the loop view draws each fibre, a plated back yarn and the elastane at its fineness');
  console.log('✓ every design control re-asks the engine; the loop and real views take the engine yarns');
}
console.log('Studio yarn-for-views tests passed');
