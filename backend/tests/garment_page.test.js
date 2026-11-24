// The Garment studio page (frontend/garment.html + assets/js/garment.js + garment-3d.js) and what it is wired to: every id the script reads is in the page,
// the files it loads exist, the routes it calls are mounted, the Studio hands its fabric over under the key the page reads, and the menu lists the page.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running Garment Page Tests ---');
const FRONT = path.join(__dirname, '..', '..', 'frontend');
const read = (...p) => fs.readFileSync(path.join(FRONT, ...p), 'utf8');
const html = read('garment.html'), js = read('assets', 'js', 'garment.js'), js3d = read('assets', 'js', 'garment-3d.js');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

{
  const used = [...new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]))];
  const missing = used.filter((i) => !ids.has(i));
  assert.deepStrictEqual(missing, [], `ids the script reads that the page does not have: ${missing.join(', ')}`);
  console.log(`✓ the ${used.length} ids garment.js reads are all in garment.html`);
}
{
  for (const m of html.matchAll(/(?:src|href)="(assets\/[^"?]+)(?:\?[^"]*)?"/g)) assert(fs.existsSync(path.join(FRONT, m[1])), `${m[1]} is loaded by the page`);
  assert(/importmap/.test(html) && /three\.module\.js/.test(html) && /OrbitControls/.test(html), 'the page maps three for the 3D garment');
  for (const m of js.matchAll(/import\('(\/assets\/js\/[^'?]+)/g)) assert(fs.existsSync(path.join(FRONT, m[1])), `${m[1]} is imported by garment.js`);
  assert(/theme-v2\.css/.test(html), 'the page takes the site theme (the header is styled by it)');
  console.log('✓ every file the page loads or imports exists; three is mapped; the theme is loaded');
}
{
  const api = fs.readFileSync(path.join(__dirname, '..', 'routes', 'api.js'), 'utf8');
  for (const u of ['/garment/build', '/garment/parse', '/garment/template']) {
    assert(api.includes(`'${u}'`), `${u} is mounted`);
    assert(js.includes(`/api${u}`), `the page calls /api${u}`);
  }
  console.log('✓ the three routes the page calls are mounted');
}
{
  // the engine's measures are the rows of the chart, and the page's keys are the engine's
  const G = require('../engine/domain/garment-pattern');
  assert(G.POMS.length >= 14, 'the chart has its rows');
  const tpl = G.template(['S', 'M'], 'cm');
  G.POM_KEYS.forEach((k) => assert(tpl.chart[k] && tpl.chart[k].S > 0, `the template gives ${k}`));
  assert(/ka_garment_fabric/.test(js) && /ka_garment_fabric/.test(read('assets', 'js', 'studio-fullwindow.js')), 'the Studio and the page share the hand-over key');
  const studio = read('assets', 'js', 'studio.js');
  assert(/fabric: function \(\) \{/.test(studio) && /shrink_len_pct/.test(studio), 'the Studio hands over weight, width, shrinkage, loops and colour');
  ['gsm', 'width_cm', 'shrink_len_pct', 'shrink_wid_pct', 'wpc', 'cpc', 'colour', 'name'].forEach((k) => assert(js.includes(`f.${k}`), `the page takes ${k} from the Studio`));
  console.log('✓ the chart rows are the engine\'s; the Studio hands its fabric over under the key the page reads');
}
{
  const shell = read('assets', 'js', 'app-shell.js');
  assert(/href: '\/garment\.html'/.test(shell), 'the menu lists the Garment studio');
  const stale = fs.readdirSync(FRONT).filter((f) => f.endsWith('.html')).filter((f) => { const t = read(f); return /app-shell\.js\?v=/.test(t) && !/app-shell\.js\?v=20261129a/.test(t); });
  assert.deepStrictEqual(stale, [], `pages still on an old app-shell (the menu would not show the new page): ${stale.join(', ')}`);
  assert(/export class GarmentView/.test(js3d) && /setGarment/.test(js3d) && /finished/.test(js3d), 'the 3D view builds the garment from the finished pieces');
  console.log('✓ the menu lists the page on every page of the site; the 3D view is built from the finished pieces');
}
{
  // the editor: every id it reads is in the page (or made by it), every anchor role it moves exists in the engine's pieces, every seam label has a colour and a seam
  const edit = read('assets', 'js', 'garment-edit.js');
  const dynamic = new Set(['gm-edsvg', 'gm-ax', 'gm-ay', 'gm-sly', 'gm-slby', 'gm-slboth']);
  const used = [...new Set([...edit.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]))].filter((i) => !dynamic.has(i));
  assert.deepStrictEqual(used.filter((i) => !ids.has(i)), [], 'ids the editor reads that the page does not have');
  assert(/garment-edit\.js/.test(html) && html.indexOf('garment-edit.js') < html.indexOf('assets/js/garment.js'), 'the editor loads before the page script that starts it');
  const G = require('../engine/domain/garment-pattern');
  const T = G.template(['M'], 'cm'), fab = { gsm: 180, width_cm: 170 };
  const plain = G.build({ sizes: ['M'], chart: T.chart, fabric: fab }), zipped = G.build({ sizes: ['M'], chart: T.chart, fabric: fab, zipper: { on: true, kind: 'full' } }), slit = G.build({ sizes: ['M'], chart: T.chart, fabric: fab, zipper: { on: true, kind: 'partial' } });
  const roles = {}; ['front', 'back', 'sleeve', 'band'].forEach((id) => { roles[id] = new Set(plain.by_size[0].edit[id].anchors.map((a) => a.role).filter(Boolean)); });
  const rules = [...edit.matchAll(/\['(front|back|sleeve)', '(\w+)', '([xy])', ([\d.]+)\]/g)];
  assert(rules.length >= 20, `${rules.length} correction rules`);
  rules.forEach((m) => assert(roles[m[1]].has(m[2]), `the editor moves ${m[1]}.${m[2]}, which the engine has no anchor for`));
  const keys = [...edit.matchAll(/^\s+(\w+): \[(?:\[|\])/gm)].map((m) => m[1]).filter((k) => G.POM_KEYS.includes(k));
  assert(keys.length >= 10, 'the correctable measurements are the chart\'s keys');
  const labels = new Set(); [plain, zipped, slit].forEach((r) => r.by_size[0].pieces.forEach((p) => p.finished_labels.forEach((l) => labels.add(l))));
  const page = read('assets', 'js', 'garment.js'), colours = (src) => new Set([...(/var EDGE = \{([^}]*)\}/.exec(src) || [, ''])[1].matchAll(/(\w+):/g)].map((m) => m[1]));
  const seamOf = (src) => Object.fromEntries([...(/var SEAM_OF = \{([^}]*)\}/.exec(src) || [, ''])[1].matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]));
  labels.forEach((l) => { assert(colours(page).has(l), `the page colours the edge ${l}`); assert(colours(edit).has(l) || l === 'faceend' || l === 'faceedge' || l === 'cf', `the editor colours the edge ${l}`); assert(G.SEAM_LABELS[l], `the engine knows the seam of ${l}`); assert(seamOf(page)[l] === G.SEAM_LABELS[l], `the page and the engine agree on the seam of ${l}`); });
  Object.keys(G.SEAM_DEFAULTS).forEach((k) => assert(plain.seams[k] && plain.seams[k].type, `seam ${k} is configured`));
  ['gm-zon', 'gm-zkind', 'gm-seams', 'gm-ops', 'gm-bom', 'gm-sewsum', 'gm-edtools', 'gm-edpieces', 'gm-insp', 'gm-edmeas', 'gm-pane-edit-body'].forEach((i) => assert(ids.has(i), `#${i} is in the page`));
  assert(/pane-edit/.test(html) && /pane-sewing/.test(html) && /data-tab="edit"/.test(html) && /data-tab="sewing"/.test(html), 'the Edit and Sewing tabs are there');
  console.log(`✓ the editor: its ids are in the page, its ${rules.length} correction rules all name an anchor the engine draws, every edge label has a colour and the same seam in the page and the engine`);
}
console.log('Garment page tests passed');

