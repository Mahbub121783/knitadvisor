// The design studio (frontend/assets/js/studio-fullwindow.js) MOVES the Studio's cards into a full window and back: every card it names must exist, be
// in a step of the workspace (its home), and be named once; the keys it binds must find their buttons; the files must load in the right order.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running Studio Full-window Tests ---');
const FRONT = path.join(__dirname, '..', '..', 'frontend');
const html = fs.readFileSync(path.join(FRONT, 'studio.html'), 'utf8');
const fw = fs.readFileSync(path.join(FRONT, 'assets', 'js', 'studio-fullwindow.js'), 'utf8');
const shell = fs.readFileSync(path.join(FRONT, 'assets', 'js', 'studio-shell.js'), 'utf8');
const css = fs.readFileSync(path.join(FRONT, 'assets', 'css', 'studio-fullwindow.css'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

{
  const head = fw.slice(fw.indexOf('var LEFT'), fw.indexOf('var fw = null'));
  const named = [...head.matchAll(/'#([\w-]+)'/g)].map((m) => m[1]);
  assert(named.length >= 8, `the window names ${named.length} cards`);
  assert.deepStrictEqual(named.filter((s) => !ids.has(s)), [], 'every card the window names is in the page');
  assert.deepStrictEqual(named.filter((s, i) => named.indexOf(s) !== i), [], 'a card is moved in once');
  const cfg = shell.slice(shell.indexOf('var CFG'), shell.indexOf('var state ='));
  const homes = new Set([...cfg.matchAll(/'#([\w-]+)'/g)].map((m) => m[1]));
  homes.add('ws-view');
  assert.deepStrictEqual(named.filter((s) => !homes.has(s)), [], 'every card moved in has a step to go back to');
  console.log(`✓ ${named.length} cards: each is in the page, named once, and has its step to return to`);
}
{
  // the keys find their buttons
  const pal = html.slice(html.indexOf('id="st-pal"'), html.indexOf('id="st-pal"') + 900);
  ['K', 'T', 'M', 'E', 'R', '-'].forEach((s) => assert(pal.includes(`data-s="${s}"`), `brush ${s} has its button`));
  ['face', 'back', 'edge', 'angle'].forEach((v) => assert(html.includes(`id="st-loopbar"`) && new RegExp(`data-view="${v}"`).test(html), `view ${v} has its button`));
  assert(/id="st-edtools"[\s\S]{0,2200}data-op="undo"/.test(html), 'the undo button is in the drawing tools');
  const tabs = [...html.matchAll(/<button type="button"[^>]*data-tab="([\w]+)"/g)].map((m) => m[1]);
  const vt = /var VIEW_TABS = \[([^\]]*)\]/.exec(fw)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  vt.forEach((t) => assert(tabs.includes(t), `viewer tab ${t} exists`));
  assert(vt[0] === '3d', 'the cloth is the first tab');
  console.log('✓ the brush keys, the four views, undo and the viewer tabs all find their buttons');
}
{
  // the files, in order: the window runs after the workspace and after the Studio
  assert(/studio-fullwindow\.css/.test(html) && /studio-fullwindow\.js/.test(html));
  assert(html.indexOf('studio-fullwindow.js') > html.indexOf('studio-shell.js') && html.indexOf('studio-fullwindow.js') > html.indexOf('assets/js/studio.js'), 'the window script loads after the workspace and the Studio');
  ['.fw-body', '.fw-left', '.fw-right', '.fw-centre', '.fw-grip', '.fw-mtabs', '.fw-top'].forEach((c) => assert(css.includes(c), `${c} is styled`));
  assert(/@media \(max-width: 900px\)/.test(css), 'a narrow window shows one column at a time');
  console.log('✓ the files load in order and the layout, the grips and the phone layout are styled');
}
{
  // leaving puts every card back: the placeholders are replaced, and the workspace is asked to restore its step and tabs
  assert(/createComment/.test(fw) && /replaceChild/.test(fw), 'cards go back through placeholders');
  assert(/KAStudioShell\.go\('weft'/.test(fw), 'the workspace restores its step on leaving');
  assert(/data-fullwindow/.test(fw) && /Escape/.test(fw), 'the page does not scroll behind the window and Esc leaves');
  console.log('✓ leaving restores the cards, the step, the scroll and the focus');
}
{
  // the links: what the window calls in the page, the page offers; what the page announces, the window listens for; the cloth view can be picked and ringed
  const studio = fs.readFileSync(path.join(FRONT, 'assets', 'js', 'studio.js'), 'utf8');
  const loops = fs.readFileSync(path.join(FRONT, 'assets', 'js', 'studio-loops.js'), 'utf8');
  const used = [...new Set([...fw.matchAll(/D\.(\w+)\(/g)].map((m) => m[1]))];
  assert(used.length >= 6, `the window calls ${used.length} engine functions`);
  const api = studio.slice(studio.indexOf('window.KAStudioDesign = {'), studio.indexOf('var painting = false;'));
  used.forEach((f) => assert(api.includes(` ${f}: function`), `KAStudioDesign.${f} exists in studio.js`));
  ['ka-design-edit', 'ka-brush', 'ka-3d-pick', 'ka-3d-hover'].forEach((ev) => {
    assert(studio.includes(`'${ev}'`), `studio.js announces ${ev}`);
    assert(fw.includes(`'${ev}'`), `the window listens for ${ev}`);
  });
  assert(/markCell\(/.test(loops) && /onPick/.test(loops) && /_stitchAt\(/.test(loops), 'the loop view can be picked and can ring a needle');
  assert(/loopView = new mod\.LoopView\(host, showTip, /.test(studio), 'the page gives the loop view its pick handler');
  assert(/data-op="redo"/.test(html) && /name === 'redo'/.test(studio), 'redo exists');
  // the root of the window must not carry an attribute a click handler looks for (it once swallowed every rail click)
  const rootAttrs = [...fw.matchAll(/fw\.setAttribute\('(data-[\w-]+)'/g)].map((m) => m[1]);
  const looked = [...fw.matchAll(/closest\('(?:[^']*?)\[(data-[\w-]+)\]'\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(rootAttrs.filter((a) => looked.includes(a)), [], 'no attribute of the window root is also a click target');
  console.log(`✓ ${used.length} engine functions, 4 announcements, the pick and the ring, redo, and no click-swallowing root attribute`);
}
console.log('Studio full-window tests passed');
